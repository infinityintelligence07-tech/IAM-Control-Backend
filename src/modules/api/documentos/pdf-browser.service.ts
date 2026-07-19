import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import * as puppeteer from 'puppeteer';

const execFileAsync = promisify(execFile);

interface GerarPdfOptions {
    /** Estratégia de espera do setContent (contrato usa networkidle0; termo, domcontentloaded). */
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
 * - resolução de executablePath com fallbacks (env, cache do projeto, Chrome
 *   do sistema) e reinstalação automática do binário se estiver ausente.
 */
@Injectable()
export class PdfBrowserService implements OnModuleDestroy {
    /** Tempo ocioso (sem gerar PDF) após o qual o Chromium é fechado. */
    private static readonly IDLE_CLOSE_MS = 5 * 60 * 1000;
    private static readonly MAX_TENTATIVAS = 3;

    private browserPromise: Promise<puppeteer.Browser> | null = null;
    private fila: Promise<unknown> = Promise.resolve();
    private idleTimer: NodeJS.Timeout | null = null;
    private chromeInstallPromise: Promise<void> | null = null;

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

                    // Pequeno backoff para dar tempo do Chromium estabilizar.
                    await new Promise((resolve) => setTimeout(resolve, 300 * tentativa));
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

            await page.setContent(html, { waitUntil: options.waitUntil });

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
            } catch {
                // Launch anterior falhou; relança abaixo.
            }
        }

        const isWindows = process.platform === 'win32';
        const chromiumArgs = isWindows
            ? ['--disable-gpu', '--disable-software-rasterizer']
            : [
                  '--no-sandbox',
                  '--disable-setuid-sandbox',
                  '--disable-dev-shm-usage',
                  '--disable-accelerated-2d-canvas',
                  '--no-first-run',
                  '--disable-gpu',
                  '--disable-software-rasterizer',
              ];

        const executablePath = this.resolveExecutablePath();
        if (executablePath) {
            console.log(`[PDF] Usando Chrome em: ${executablePath}`);
        } else {
            console.warn(
                '[PDF] executablePath não resolvido — Puppeteer usará o cache padrão (.cache/puppeteer ou ~/.cache/puppeteer).',
            );
        }

        // Transporte pipe (mais estável que websocket).
        this.browserPromise = puppeteer.launch({
            headless: true,
            pipe: true,
            args: chromiumArgs,
            ignoreDefaultArgs: ['--disable-extensions'],
            protocolTimeout: 120000,
            ...(executablePath ? { executablePath } : {}),
        });
        return this.browserPromise;
    }

    /**
     * Resolve o binário do Chrome na ordem:
     * 1) PUPPETEER_EXECUTABLE_PATH (override manual na VPS)
     * 2) cache do Puppeteer do projeto (.puppeteerrc.cjs)
     * 3) Chrome/Chromium instalado no sistema
     */
    private resolveExecutablePath(): string | undefined {
        const envPath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
        if (envPath && existsSync(envPath)) {
            return envPath;
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

    /**
     * Baixa o Chrome for Testing no cache do projeto (single-flight).
     * Usado quando o launch falha com "Could not find Chrome".
     */
    private async ensureChromeInstalled(): Promise<void> {
        if (!this.chromeInstallPromise) {
            this.chromeInstallPromise = (async () => {
                console.warn('[PDF] Chrome do Puppeteer ausente — instalando via npx puppeteer browsers install chrome...');
                await execFileAsync('npx', ['puppeteer', 'browsers', 'install', 'chrome'], {
                    cwd: process.cwd(),
                    env: process.env,
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
        if (!pendente) return;
        try {
            const browser = await pendente;
            await browser.close();
        } catch (closeError) {
            console.warn('Aviso ao descartar browser do Puppeteer:', closeError);
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
            message.includes('navigation failed because browser has disconnected')
        );
    }

    private isErroChromeAusente(error: unknown): boolean {
        const message = String((error as Error)?.message || '').toLowerCase();
        return (
            message.includes('could not find chrome') ||
            message.includes('could not find browser') ||
            message.includes('browser was not found') ||
            message.includes('não encontrado') ||
            message.includes('executable doesn\'t exist') ||
            message.includes('executable doesnt exist')
        );
    }
}
