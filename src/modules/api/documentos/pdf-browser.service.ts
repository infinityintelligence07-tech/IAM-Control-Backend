import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { execFile } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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

/**
 * Dono ÚNICO do Chromium usado na geração de PDFs (contratos e termos).
 *
 * Antes, cada geração abria um navegador próprio (~300-500MB) e, em caso de
 * erro, o processo chrome ficava órfão. Sob uso contínuo isso esgotava a
 * memória do servidor: primeiro as gerações falhavam ("Erro ao gerar PDF do
 * contrato"), depois o próprio Node caía no meio da requisição (502 no nginx).
 *
 * Proteções aplicadas aqui:
 * - navegador singleton lazy, relançado automaticamente se cair/desconectar;
 * - fila com concorrência 1: gerações simultâneas não multiplicam páginas
 *   pesadas nem picos de memória;
 * - fechamento automático do navegador após ficar ocioso (libera a memória
 *   entre vendas);
 * - página sempre fechada em finally e navegador fechado no shutdown do módulo
 *   (evita chromes órfãos também no watcher do start:dev);
 * - retentativas com backoff para erros transientes de sessão/conexão;
 * - resolução de executablePath priorizando o cache do projeto (.puppeteerrc.cjs),
 *   ignorando PUPPETEER_CACHE_DIR poluído (ex.: sandbox do Cursor) que apontava
 *   para cache vazio e forçava Chrome do sistema incompatível →
 *   "Protocol error (Target.setDiscoverTargets): Target closed";
 * - WebSocket no Windows (pipe costuma derrubar o handshake CDP).
 */
@Injectable()
export class PdfBrowserService implements OnModuleDestroy {
    /** Tempo ocioso (sem gerar PDF) após o qual o Chromium é fechado. */
    private static readonly IDLE_CLOSE_MS = 5 * 60 * 1000;
    private static readonly MAX_TENTATIVAS = 3;
    /** Cache canônico do projeto (espelha `.puppeteerrc.cjs`). */
    private static readonly PROJECT_CACHE_DIR = join(process.cwd(), '.cache', 'puppeteer');

    private browserPromise: Promise<puppeteer.Browser> | null = null;
    private fila: Promise<unknown> = Promise.resolve();
    private idleTimer: NodeJS.Timeout | null = null;
    private chromeInstallPromise: Promise<void> | null = null;
    private userDataDir: string | null = null;

    async onModuleDestroy(): Promise<void> {
        this.cancelarIdleTimer();
        await this.descartarBrowser();
    }

    /** Gera um PDF a partir de HTML, serializado na fila do navegador único. */
    async gerarPdf(html: string, options: GerarPdfOptions): Promise<Buffer> {
        const executar = () => this.gerarPdfComRetentativas(html, options);
        const execucao = this.fila.then(executar, executar);
        // A fila nunca deve ficar rejeitada: falha de uma geração não pode
        // impedir as próximas.
        this.fila = execucao.catch(() => undefined);
        return execucao;
    }

    private async gerarPdfComRetentativas(html: string, options: GerarPdfOptions): Promise<Buffer> {
        this.cancelarIdleTimer();
        try {
            let ultimaFalha: unknown;
            for (let tentativa = 1; tentativa <= PdfBrowserService.MAX_TENTATIVAS; tentativa++) {
                try {
                    return await this.gerarPdfTentativa(html, options);
                } catch (error) {
                    ultimaFalha = error;
                    const transiente = this.isErroTransientePuppeteer(error);
                    const chromeAusente = this.isErroChromeAusente(error);

                    console.error(
                        `[PDF] Falha na tentativa ${tentativa}/${PdfBrowserService.MAX_TENTATIVAS}:`,
                        error instanceof Error ? error.message : error,
                    );

                    // Chrome ausente (comum após deploy): tenta baixar 1x e relança.
                    if (chromeAusente) {
                        await this.descartarBrowser();
                        try {
                            await this.ensureChromeInstalled();
                        } catch (installError) {
                            console.error(
                                '[PDF] Falha ao instalar Chrome do Puppeteer:',
                                installError instanceof Error ? installError.message : installError,
                            );
                        }
                    } else if (transiente) {
                        // Erro de sessão/conexão do Chromium: descarta o navegador
                        // para relançar um novo na próxima tentativa.
                        await this.descartarBrowser();
                    }

                    if ((!transiente && !chromeAusente) || tentativa === PdfBrowserService.MAX_TENTATIVAS) {
                        throw error;
                    }

                    // Backoff crescente para dar tempo do Chromium estabilizar /
                    // liberar locks de profile no Windows.
                    await new Promise((resolve) => setTimeout(resolve, 500 * tentativa));
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
                await page.evaluate(async () => {
                    await document.fonts.ready;
                });
            }

            const pdfBuffer = await page.pdf(options.pdfOptions);
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

    private async getBrowser(): Promise<puppeteer.Browser> {
        if (this.browserPromise) {
            try {
                const existente = await this.browserPromise;
                if (existente.connected) {
                    return existente;
                }
                // Instância morta ainda referenciada — fecha best-effort antes de relançar.
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

        const isWindows = process.platform === 'win32';
        // Args estáveis: no Windows o pipe CDP é instável (Target.setDiscoverTargets /
        // Target closed). Mantemos flags leves de GPU; no Linux, sandbox off (VPS).
        const chromiumArgs = [
            '--disable-extensions',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--no-default-browser-check',
            ...(isWindows
                ? []
                : ['--no-sandbox', '--disable-setuid-sandbox', '--disable-accelerated-2d-canvas']),
        ];

        const executablePath = this.resolveExecutablePath();
        if (executablePath) {
            console.log(`[PDF] Usando Chrome em: ${executablePath}`);
        } else {
            console.warn(
                '[PDF] executablePath não resolvido — Puppeteer usará o cache padrão (.cache/puppeteer ou ~/.cache/puppeteer).',
            );
        }

        // Profile temporário exclusivo por instância: evita "profile in use" /
        // Target closed quando um chrome anterior não liberou o diretório.
        this.userDataDir = join(tmpdir(), `iam-pdf-chrome-${process.pid}-${Date.now()}`);

        const launchPromise = puppeteer.launch({
            headless: true,
            // pipe=true no Windows costuma falhar no handshake CDP com
            // "Protocol error (Target.setDiscoverTargets): Target closed".
            pipe: !isWindows,
            args: chromiumArgs,
            protocolTimeout: 120000,
            userDataDir: this.userDataDir,
            ...(executablePath ? { executablePath } : {}),
        });

        const browserReady = launchPromise
            .then((browser) => {
                browser.on('disconnected', () => {
                    // Só limpa se ainda for a instância vigente (evita apagar
                    // um relançamento posterior).
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

    /**
     * Resolve o binário do Chrome na ordem:
     * 1) PUPPETEER_EXECUTABLE_PATH (override manual na VPS)
     * 2) cache do projeto em `.cache/puppeteer` (ignora PUPPETEER_CACHE_DIR poluído)
     * 3) puppeteer.executablePath() se o arquivo existir de fato
     * 4) Chrome/Chromium instalado no sistema
     */
    private resolveExecutablePath(): string | undefined {
        const envPath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
        if (envPath && existsSync(envPath)) {
            return envPath;
        }

        const projetoChrome = this.findChromeInCache(PdfBrowserService.PROJECT_CACHE_DIR);
        if (projetoChrome) {
            return projetoChrome;
        }

        try {
            const bundled = puppeteer.executablePath();
            if (bundled && existsSync(bundled)) {
                return bundled;
            }
        } catch {
            // Cache vazio / versão ainda não baixada.
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

    /** Localiza chrome.exe / chrome dentro de um cache do Puppeteer. */
    private findChromeInCache(cacheDir: string): string | undefined {
        const chromeRoot = join(cacheDir, 'chrome');
        if (!existsSync(chromeRoot)) {
            return undefined;
        }

        try {
            const versoes = readdirSync(chromeRoot, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                // Preferir versões mais recentes (nome win64-142... / linux-142...).
                .map((entry) => entry.name)
                .sort((a, b) => b.localeCompare(a));

            for (const versao of versoes) {
                const candidatos =
                    process.platform === 'win32'
                        ? [join(chromeRoot, versao, 'chrome-win64', 'chrome.exe'), join(chromeRoot, versao, 'chrome-win', 'chrome.exe')]
                        : [
                              join(chromeRoot, versao, 'chrome-linux64', 'chrome'),
                              join(chromeRoot, versao, 'chrome-linux', 'chrome'),
                              join(chromeRoot, versao, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
                              join(chromeRoot, versao, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
                          ];

                const encontrado = candidatos.find((path) => existsSync(path));
                if (encontrado) {
                    return encontrado;
                }
            }
        } catch (error) {
            console.warn(
                '[PDF] Falha ao varrer cache local do Chrome:',
                error instanceof Error ? error.message : error,
            );
        }

        return undefined;
    }

    /**
     * Baixa o Chrome for Testing no cache do projeto (single-flight).
     * Usado quando o launch falha com "Could not find Chrome".
     */
    private async ensureChromeInstalled(): Promise<void> {
        if (!this.chromeInstallPromise) {
            this.chromeInstallPromise = (async () => {
                console.warn('[PDF] Chrome do Puppeteer ausente — instalando via npx puppeteer browsers install chrome...');
                // Força o cache do projeto mesmo se PUPPETEER_CACHE_DIR estiver poluído.
                await execFileAsync('npx', ['puppeteer', 'browsers', 'install', 'chrome'], {
                    cwd: process.cwd(),
                    env: {
                        ...process.env,
                        PUPPETEER_CACHE_DIR: PdfBrowserService.PROJECT_CACHE_DIR,
                    },
                    timeout: 5 * 60 * 1000,
                    shell: process.platform === 'win32',
                });
                console.log('[PDF] Chrome do Puppeteer instalado com sucesso.');
            })().catch((error) => {
                // Permite nova tentativa em falha (ex.: rede intermitente).
                this.chromeInstallPromise = null;
                throw error;
            });
        }
        await this.chromeInstallPromise;
    }

    /** Fecha e descarta o navegador compartilhado. */
    private async descartarBrowser(): Promise<void> {
        const pendente = this.browserPromise;
        this.browserPromise = null;
        if (!pendente) {
            this.userDataDir = null;
            return;
        }
        try {
            const browser = await pendente;
            // removeAllListeners evita vazamento do handler disconnected.
            browser.removeAllListeners?.('disconnected');
            await browser.close();
        } catch (closeError) {
            console.warn('Aviso ao descartar browser do Puppeteer:', closeError);
            // Se o close falhar (processo zumbi), tenta matar via process.
            try {
                const browser = await pendente.catch(() => null);
                const proc = browser?.process?.();
                if (proc?.pid) {
                    proc.kill('SIGKILL');
                }
            } catch {
                // Ignora — best effort.
            }
        } finally {
            this.userDataDir = null;
        }
    }

    /** Fecha o Chromium após o período ocioso para liberar memória entre vendas. */
    private agendarFechamentoPorOciosidade(): void {
        this.cancelarIdleTimer();
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            void this.descartarBrowser();
        }, PdfBrowserService.IDLE_CLOSE_MS);
        // Não impede o processo de encerrar por causa do timer pendente.
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
}
