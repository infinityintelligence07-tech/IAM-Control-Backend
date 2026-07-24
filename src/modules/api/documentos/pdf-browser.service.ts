import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { execFile } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { promisify } from 'util';
import * as puppeteer from 'puppeteer';

const execFileAsync = promisify(execFile);

interface GerarPdfOptions {
    /** Estratégia de espera do setContent (preferir domcontentloaded; networkidle0 é frágil com assets externos). */
    waitUntil: puppeteer.PuppeteerLifeCycleEvent;
    /** Aguarda o carregamento das fontes antes de imprimir (layout fiel ao CSS). */
    aguardarFontes?: boolean;
    /** Opções repassadas ao page.pdf(). */
    pdfOptions: puppeteer.PDFOptions;
}

export interface PdfDiagnostico {
    ok: boolean;
    platform: string;
    cwd: string;
    cacheCandidates: string[];
    chromePath: string | null;
    headlessShellPath: string | null;
    pdfBytes?: number;
    erro?: string;
    estrategia?: string;
}

type LaunchStrategy = {
    nome: string;
    pipe: boolean;
    headless: boolean | 'shell';
    args: string[];
    usarHeadlessShell?: boolean;
};

/**
 * Dono ÚNICO do Chromium usado na geração de PDFs (contratos e termos).
 *
 * "Target.setDiscoverTargets: Target closed" = o processo Chrome inicia e
 * morre no handshake CDP (não é ZapSign, nem dados da venda). Na VPS as
 * causas típicas são: transporte `pipe`, libs faltando, OOM ou zygote.
 * Estratégias progressivas + smoke no deploy mitigam isso.
 */
@Injectable()
export class PdfBrowserService implements OnModuleDestroy {
    private static readonly IDLE_CLOSE_MS = 5 * 60 * 1000;
    private static readonly MAX_TENTATIVAS = 3;

    private browserPromise: Promise<puppeteer.Browser> | null = null;
    private fila: Promise<unknown> = Promise.resolve();
    private idleTimer: NodeJS.Timeout | null = null;
    private chromeInstallPromise: Promise<void> | null = null;
    private userDataDir: string | null = null;
    private forcarSomenteChromeProjeto = false;
    private dumpioNaProximaTentativa = false;
    /** Índice da estratégia de launch (sobe a cada falha transiente). */
    private estrategiaAtual = 0;

    async onModuleDestroy(): Promise<void> {
        this.cancelarIdleTimer();
        await this.descartarBrowser();
    }

    /**
     * Diagnóstico rápido (admin): tenta gerar um PDF mínimo e devolve
     * caminhos/erro reais — útil após deploy na VPS.
     */
    async diagnosticar(): Promise<PdfDiagnostico> {
        const cacheCandidates = this.listProjectCacheCandidates();
        const chromePath = this.findChromeInAnyProjectCache();
        const headlessShellPath = this.findHeadlessShellInAnyProjectCache();
        const base: PdfDiagnostico = {
            ok: false,
            platform: process.platform,
            cwd: process.cwd(),
            cacheCandidates,
            chromePath: chromePath ?? null,
            headlessShellPath: headlessShellPath ?? null,
        };

        try {
            if (!chromePath && !headlessShellPath) {
                await this.ensureChromeInstalled();
            }
            const pdf = await this.gerarPdf('<!DOCTYPE html><html><body><h1>PDF health</h1></body></html>', {
                waitUntil: 'domcontentloaded',
                aguardarFontes: false,
                pdfOptions: { format: 'A4', printBackground: true },
            });
            return {
                ...base,
                ok: true,
                pdfBytes: pdf.length,
                chromePath: this.findChromeInAnyProjectCache() ?? chromePath ?? null,
                headlessShellPath: this.findHeadlessShellInAnyProjectCache() ?? headlessShellPath ?? null,
                estrategia: this.estrategiasLaunch()[Math.min(this.estrategiaAtual, this.estrategiasLaunch().length - 1)]?.nome,
            };
        } catch (error) {
            return {
                ...base,
                ok: false,
                erro: error instanceof Error ? error.message : 'Erro desconhecido',
                estrategia: this.estrategiasLaunch()[Math.min(this.estrategiaAtual, this.estrategiasLaunch().length - 1)]?.nome,
            };
        }
    }

    async gerarPdf(html: string, options: GerarPdfOptions): Promise<Buffer> {
        const executar = () => this.gerarPdfComRetentativas(html, options);
        const execucao = this.fila.then(executar, executar);
        this.fila = execucao.catch(() => undefined);
        return execucao;
    }

    private async gerarPdfComRetentativas(html: string, options: GerarPdfOptions): Promise<Buffer> {
        this.cancelarIdleTimer();
        try {
            let ultimaFalha: unknown;
            for (let tentativa = 1; tentativa <= PdfBrowserService.MAX_TENTATIVAS; tentativa++) {
                try {
                    if (!this.findChromeInAnyProjectCache() && !this.findHeadlessShellInAnyProjectCache()) {
                        await this.ensureChromeInstalled();
                    }
                    return await this.gerarPdfTentativa(html, options);
                } catch (error) {
                    ultimaFalha = error;
                    const transiente = this.isErroTransientePuppeteer(error);
                    const chromeAusente = this.isErroChromeAusente(error);
                    const targetClosed = this.isErroTargetClosed(error);
                    const launchFalhou = this.isErroLaunchFalhou(error);
                    const podeRetentar = transiente || chromeAusente || targetClosed || launchFalhou;

                    console.error(
                        `[PDF] Falha na tentativa ${tentativa}/${PdfBrowserService.MAX_TENTATIVAS} (estratégia=${this.estrategiaAtual}):`,
                        error instanceof Error ? error.message : error,
                    );

                    await this.descartarBrowser();

                    if (podeRetentar) {
                        this.forcarSomenteChromeProjeto = true;
                        this.dumpioNaProximaTentativa = true;
                        // Próxima tentativa usa estratégia mais agressiva (VPS).
                        this.estrategiaAtual = Math.min(this.estrategiaAtual + 1, this.estrategiasLaunch().length - 1);
                        if (chromeAusente || targetClosed) {
                            try {
                                await this.ensureChromeInstalled();
                            } catch (installError) {
                                console.error(
                                    '[PDF] Falha ao instalar Chrome do Puppeteer:',
                                    installError instanceof Error ? installError.message : installError,
                                );
                            }
                            await this.matarChromesOrfaosBestEffort();
                        }
                    }

                    if (!podeRetentar || tentativa === PdfBrowserService.MAX_TENTATIVAS) {
                        throw error;
                    }

                    await new Promise((resolve) => setTimeout(resolve, 750 * tentativa));
                }
            }
            throw ultimaFalha;
        } finally {
            this.agendarFechamentoPorOciosidade();
        }
    }

    private async gerarPdfTentativa(html: string, options: GerarPdfOptions): Promise<Buffer> {
        let page: puppeteer.Page | null = null;
        try {
            const browser = await this.getBrowser();

            page = await browser.newPage();
            page.setDefaultNavigationTimeout(45000);

            await page.setContent(html, { waitUntil: options.waitUntil, timeout: 45000 });

            if (options.aguardarFontes) {
                await Promise.race([
                    page.evaluate(async () => {
                        await document.fonts.ready;
                    }),
                    new Promise((resolve) => setTimeout(resolve, 5000)),
                ]);
            }

            const pdfBuffer = await page.pdf(options.pdfOptions);
            // Sucesso: volta à estratégia leve na próxima geração.
            this.estrategiaAtual = 0;
            return Buffer.from(pdfBuffer);
        } finally {
            try {
                if (page && !page.isClosed()) {
                    await page.close();
                }
            } catch (closePageError) {
                console.warn('Aviso ao fechar página do Puppeteer:', closePageError);
            }
        }
    }

    /** Estratégias progressivas — a VPS costuma precisar das últimas. */
    private estrategiasLaunch(): LaunchStrategy[] {
        const baseLinux = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-accelerated-2d-canvas'];
        const baseCommon = [
            '--disable-extensions',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--no-default-browser-check',
            '--mute-audio',
            '--disable-background-networking',
            '--disable-crash-reporter',
            '--disable-breakpad',
        ];
        const isWindows = process.platform === 'win32';
        const linuxExtra = isWindows ? [] : baseLinux;

        return [
            {
                nome: 'ws-standard',
                // pipe=true falha com Target.setDiscoverTargets tanto no
                // Windows quanto em várias VPS Linux — WebSocket em todos.
                pipe: false,
                headless: true,
                args: [...baseCommon, ...linuxExtra],
            },
            {
                nome: 'ws-no-zygote',
                pipe: false,
                headless: true,
                args: [...baseCommon, ...linuxExtra, '--no-zygote'],
            },
            {
                nome: 'ws-single-process-shell',
                pipe: false,
                headless: 'shell',
                usarHeadlessShell: true,
                args: [...baseCommon, ...linuxExtra, '--no-zygote', '--single-process'],
            },
        ];
    }

    private async getBrowser(): Promise<puppeteer.Browser> {
        if (this.browserPromise) {
            try {
                const existente = await this.browserPromise;
                if (existente.connected) {
                    return existente;
                }
                try {
                    existente.removeAllListeners?.('disconnected');
                    await existente.close();
                } catch {
                    // Ignora.
                }
            } catch {
                // Launch anterior falhou; relança abaixo.
            }
            this.browserPromise = null;
        }

        const estrategias = this.estrategiasLaunch();
        const estrategia = estrategias[Math.min(this.estrategiaAtual, estrategias.length - 1)];

        let executablePath = this.resolveExecutablePath(estrategia.usarHeadlessShell);
        // Se pediu headless-shell e não tem, cai no Chrome for Testing.
        if (estrategia.usarHeadlessShell && !executablePath) {
            executablePath = this.resolveExecutablePath(false);
        }

        if (executablePath) {
            console.log(`[PDF] Usando Chrome em: ${executablePath} (estratégia=${estrategia.nome})`);
        } else {
            console.warn(
                `[PDF] executablePath não resolvido (estratégia=${estrategia.nome}) — Puppeteer usará o cache padrão.`,
            );
        }

        this.userDataDir = join(tmpdir(), `iam-pdf-chrome-${process.pid}-${Date.now()}`);

        const usarDumpio = this.dumpioNaProximaTentativa;
        this.dumpioNaProximaTentativa = false;

        const launchPromise = puppeteer.launch({
            headless: estrategia.headless,
            pipe: estrategia.pipe,
            args: estrategia.args,
            protocolTimeout: 120000,
            userDataDir: this.userDataDir,
            dumpio: usarDumpio,
            ...(executablePath ? { executablePath } : {}),
        });

        const browserReady = launchPromise
            .then((browser) => {
                browser.on('disconnected', () => {
                    if (this.browserPromise === browserReady) {
                        this.browserPromise = null;
                    }
                    console.warn('[PDF] Chromium desconectou — será relançado na próxima geração.');
                });
                return browser;
            })
            .catch((error) => {
                if (this.browserPromise === browserReady) {
                    this.browserPromise = null;
                }
                throw error;
            });

        this.browserPromise = browserReady;
        return browserReady;
    }

    private resolveExecutablePath(preferHeadlessShell = false): string | undefined {
        const envPath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
        if (envPath && existsSync(envPath)) {
            return envPath;
        }

        if (preferHeadlessShell) {
            const shell = this.findHeadlessShellInAnyProjectCache();
            if (shell) return shell;
        }

        const projetoChrome = this.findChromeInAnyProjectCache();
        if (projetoChrome) {
            return projetoChrome;
        }

        try {
            const bundled = puppeteer.executablePath();
            if (bundled && existsSync(bundled) && this.isCaminhoChromeProjeto(bundled)) {
                return bundled;
            }
            if (bundled && existsSync(bundled) && !this.forcarSomenteChromeProjeto) {
                console.warn(
                    `[PDF] puppeteer.executablePath() fora do cache do projeto (${bundled}) — ignorando para evitar Target closed.`,
                );
            }
        } catch {
            // Cache vazio.
        }

        const allowSystem = process.env.ALLOW_SYSTEM_CHROME === '1' && !this.forcarSomenteChromeProjeto;
        if (!allowSystem) {
            return undefined;
        }

        const candidatos =
            process.platform === 'win32'
                ? [
                      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                  ]
                : [
                      '/usr/bin/google-chrome-stable',
                      '/usr/bin/google-chrome',
                      '/usr/bin/chromium-browser',
                      '/usr/bin/chromium',
                      '/snap/bin/chromium',
                  ];

        return candidatos.find((path) => existsSync(path));
    }

    private findChromeInAnyProjectCache(): string | undefined {
        for (const cacheDir of this.listProjectCacheCandidates()) {
            const found = this.findBrowserInCache(cacheDir, 'chrome');
            if (found) return found;
        }
        return undefined;
    }

    private findHeadlessShellInAnyProjectCache(): string | undefined {
        for (const cacheDir of this.listProjectCacheCandidates()) {
            const found = this.findBrowserInCache(cacheDir, 'chrome-headless-shell');
            if (found) return found;
        }
        return undefined;
    }

    private listProjectCacheCandidates(): string[] {
        const candidatos: string[] = [];
        const add = (dir: string | undefined) => {
            if (!dir?.trim()) return;
            const normalized = dir.trim();
            if (!candidatos.includes(normalized)) {
                candidatos.push(normalized);
            }
        };

        add(join(process.cwd(), '.cache', 'puppeteer'));

        let dir = __dirname;
        for (let i = 0; i < 8; i++) {
            if (existsSync(join(dir, '.puppeteerrc.cjs')) || existsSync(join(dir, 'package.json'))) {
                add(join(dir, '.cache', 'puppeteer'));
                break;
            }
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }

        const envCache = process.env.PUPPETEER_CACHE_DIR?.trim();
        if (envCache && (this.findBrowserInCache(envCache, 'chrome') || this.findBrowserInCache(envCache, 'chrome-headless-shell'))) {
            add(envCache);
        }

        return candidatos;
    }

    private isCaminhoChromeProjeto(executablePath: string): boolean {
        const normalized = executablePath.replace(/\\/g, '/').toLowerCase();
        return this.listProjectCacheCandidates().some((cache) =>
            normalized.includes(cache.replace(/\\/g, '/').toLowerCase()),
        );
    }

    private findBrowserInCache(cacheDir: string, browserName: 'chrome' | 'chrome-headless-shell'): string | undefined {
        const root = join(cacheDir, browserName);
        if (!existsSync(root)) {
            return undefined;
        }

        try {
            const versoes = readdirSync(root, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
                .sort((a, b) => b.localeCompare(a));

            for (const versao of versoes) {
                const candidatos =
                    process.platform === 'win32'
                        ? browserName === 'chrome'
                            ? [join(root, versao, 'chrome-win64', 'chrome.exe'), join(root, versao, 'chrome-win', 'chrome.exe')]
                            : [
                                  join(root, versao, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
                                  join(root, versao, 'chrome-headless-shell-win', 'chrome-headless-shell.exe'),
                              ]
                        : browserName === 'chrome'
                          ? [
                                join(root, versao, 'chrome-linux64', 'chrome'),
                                join(root, versao, 'chrome-linux', 'chrome'),
                            ]
                          : [
                                join(root, versao, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
                                join(root, versao, 'chrome-headless-shell-linux', 'chrome-headless-shell'),
                            ];

                const encontrado = candidatos.find((path) => existsSync(path));
                if (encontrado) return encontrado;
            }
        } catch (error) {
            console.warn(
                `[PDF] Falha ao varrer cache ${browserName}:`,
                error instanceof Error ? error.message : error,
            );
        }

        return undefined;
    }

    private async ensureChromeInstalled(): Promise<void> {
        if (!this.chromeInstallPromise) {
            const cacheDir = this.listProjectCacheCandidates()[0] || join(process.cwd(), '.cache', 'puppeteer');
            this.chromeInstallPromise = (async () => {
                console.warn(`[PDF] Garantindo Chrome for Testing em ${cacheDir}...`);
                const env = {
                    ...process.env,
                    PUPPETEER_CACHE_DIR: cacheDir,
                };
                await execFileAsync('npx', ['puppeteer', 'browsers', 'install', 'chrome'], {
                    cwd: process.cwd(),
                    env,
                    timeout: 5 * 60 * 1000,
                    shell: process.platform === 'win32',
                });
                // Headless shell é mais leve e estável em VPS com pouca RAM.
                try {
                    await execFileAsync('npx', ['puppeteer', 'browsers', 'install', 'chrome-headless-shell'], {
                        cwd: process.cwd(),
                        env,
                        timeout: 5 * 60 * 1000,
                        shell: process.platform === 'win32',
                    });
                } catch (shellError) {
                    console.warn(
                        '[PDF] chrome-headless-shell não instalado (não bloqueante):',
                        shellError instanceof Error ? shellError.message : shellError,
                    );
                }
                console.log('[PDF] Chrome do Puppeteer instalado com sucesso.');
            })().catch((error) => {
                this.chromeInstallPromise = null;
                throw error;
            });
        }
        await this.chromeInstallPromise;
    }

    private async descartarBrowser(): Promise<void> {
        const pendente = this.browserPromise;
        this.browserPromise = null;
        if (!pendente) {
            this.userDataDir = null;
            return;
        }
        try {
            const browser = await pendente;
            browser.removeAllListeners?.('disconnected');
            await browser.close();
        } catch (closeError) {
            console.warn('Aviso ao descartar browser do Puppeteer:', closeError);
            try {
                const browser = await pendente.catch(() => null);
                const proc = browser?.process?.();
                if (proc?.pid) {
                    proc.kill('SIGKILL');
                }
            } catch {
                // Ignora.
            }
        } finally {
            this.userDataDir = null;
        }
    }

    private async matarChromesOrfaosBestEffort(): Promise<void> {
        try {
            if (process.platform === 'win32') {
                await execFileAsync(
                    'powershell.exe',
                    [
                        '-NoProfile',
                        '-Command',
                        "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*iam-pdf-chrome*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
                    ],
                    { timeout: 10000 },
                );
            } else {
                await execFileAsync('bash', ['-lc', "pkill -f 'iam-pdf-chrome-' 2>/dev/null || true"], {
                    timeout: 10000,
                });
            }
        } catch {
            // Best effort.
        }
    }

    private agendarFechamentoPorOciosidade(): void {
        this.cancelarIdleTimer();
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            void this.descartarBrowser();
        }, PdfBrowserService.IDLE_CLOSE_MS);
        this.idleTimer.unref?.();
    }

    private cancelarIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    private isErroTransientePuppeteer(error: unknown): boolean {
        const message = String((error as Error)?.message || '').toLowerCase();
        return (
            message.includes('econnreset') ||
            message.includes('target closed') ||
            message.includes('session closed') ||
            message.includes('protocol error') ||
            message.includes('browser has disconnected') ||
            message.includes('navigation failed because browser has disconnected') ||
            message.includes('navigating frame was detached') ||
            message.includes('page crashed')
        );
    }

    private isErroTargetClosed(error: unknown): boolean {
        const message = String((error as Error)?.message || '').toLowerCase();
        return (
            message.includes('target closed') ||
            message.includes('setdiscovertargets') ||
            (message.includes('protocol error') && message.includes('target'))
        );
    }

    private isErroChromeAusente(error: unknown): boolean {
        const message = String((error as Error)?.message || '').toLowerCase();
        return (
            message.includes('could not find chrome') ||
            message.includes('could not find browser') ||
            message.includes('browser was not found') ||
            message.includes('não encontrado') ||
            message.includes("executable doesn't exist") ||
            message.includes('executable doesnt exist')
        );
    }

    /** Chrome inicia e morre (libs faltando, crashpad, code 127) — vale trocar estratégia. */
    private isErroLaunchFalhou(error: unknown): boolean {
        const message = String((error as Error)?.message || '').toLowerCase();
        return (
            message.includes('failed to launch the browser process') ||
            message.includes('cannot open shared object file') ||
            message.includes('error while loading shared libraries') ||
            message.includes('chrome_crashpad_handler')
        );
    }
}
