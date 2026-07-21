import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

export type BulkItemStatus = 'PENDENTE' | 'ENVIANDO' | 'SUCESSO' | 'FALHA' | 'AGUARDANDO_RETENTATIVA';

export interface BulkSendItemSnapshot {
    id: string;
    nome: string;
    status: BulkItemStatus;
    tentativas: number;
    ultimoErro: string | null;
    proximaTentativaEm: string | null;
}

export interface BulkSendJobSnapshot {
    jobId: string;
    tipo: string;
    criadoEm: string;
    finalizadoEm: string | null;
    emAndamento: boolean;
    total: number;
    enviados: number;
    falhasDefinitivas: number;
    aguardandoRetentativa: number;
    erros: string[];
    itens: BulkSendItemSnapshot[];
}

/** Executor de envio de UM item; deve resolver com sucesso/erro (nunca deixar pendurado sem fim). */
export type BulkItemExecutor = () => Promise<{ success: boolean; error?: string }>;

export interface BulkQueueItemInput {
    id: string;
    nome: string;
    executor: BulkItemExecutor;
}

interface InternalItem {
    id: string;
    nome: string;
    status: BulkItemStatus;
    tentativas: number;
    ultimoErro: string | null;
    proximaTentativaEm: Date | null;
    executor: BulkItemExecutor;
    retryTimer: NodeJS.Timeout | null;
}

interface InternalJob {
    jobId: string;
    tipo: string;
    criadoEm: Date;
    finalizadoEm: Date | null;
    itens: InternalItem[];
}

/**
 * Fila em memória para envios de templates WhatsApp em massa (check-in,
 * confirmação, QR Code ou qualquer outro).
 *
 * Regras:
 * - O enfileiramento responde imediatamente (a request HTTP nunca espera os
 *   envios, evitando "timeout exceeded" no frontend).
 * - Cada item tem TIMEOUT individual: se o envio de um aluno travar, ele é
 *   marcado como falha da tentativa e a fila SEGUE para o próximo aluno.
 * - Falha (erro ou timeout) agenda retentativa após 2 minutos, com no máximo
 *   3 tentativas por aluno (a 1ª do loop + 2 retentativas).
 */
@Injectable()
export class WhatsAppBulkQueueService {
    private readonly logger = new Logger(WhatsAppBulkQueueService.name);
    private readonly jobs = new Map<string, InternalJob>();

    private readonly maxTentativas = this.resolveEnvInt('WHATSAPP_BULK_MAX_TENTATIVAS', 3, 1, 10);
    private readonly retryDelayMs = this.resolveEnvInt('WHATSAPP_BULK_RETRY_DELAY_MS', 2 * 60 * 1000, 1000, 60 * 60 * 1000);
    private readonly itemTimeoutMs = this.resolveEnvInt('WHATSAPP_BULK_ITEM_TIMEOUT_MS', 90 * 1000, 5000, 10 * 60 * 1000);
    private readonly concurrency = this.resolveEnvInt('WHATSAPP_BULK_CONCURRENCY', this.resolveEnvInt('CHECKIN_BULK_CONCURRENCY', 5, 1, 20), 1, 20);
    /** Jobs finalizados são mantidos por 6h para consulta de status e depois descartados. */
    private static readonly JOB_RETENTION_MS = 6 * 60 * 60 * 1000;

    private resolveEnvInt(envName: string, fallback: number, min: number, max: number): number {
        const raw = Number(process.env[envName]);
        if (!Number.isFinite(raw)) return fallback;
        return Math.min(max, Math.max(min, Math.floor(raw)));
    }

    /**
     * Cria um job de envio em massa e inicia o processamento em background.
     * Retorna imediatamente o snapshot inicial (com jobId para polling).
     */
    enqueue(tipo: string, itens: BulkQueueItemInput[]): BulkSendJobSnapshot {
        this.limparJobsAntigos();

        const job: InternalJob = {
            jobId: randomUUID(),
            tipo,
            criadoEm: new Date(),
            finalizadoEm: null,
            itens: itens.map((item) => ({
                id: item.id,
                nome: item.nome,
                status: 'PENDENTE' as BulkItemStatus,
                tentativas: 0,
                ultimoErro: null,
                proximaTentativaEm: null,
                executor: item.executor,
                retryTimer: null,
            })),
        };

        this.jobs.set(job.jobId, job);
        this.logger.log(`📦 Job de envio em massa criado: ${job.jobId} (tipo=${tipo}, total=${job.itens.length})`);

        // Processamento totalmente em background — a request que enfileirou não espera.
        void this.processarLoteInicial(job).catch((error: unknown) => {
            const msg = error instanceof Error ? error.message : 'Erro desconhecido';
            this.logger.error(`Erro inesperado no processamento do job ${job.jobId}: ${msg}`);
        });

        return this.snapshot(job);
    }

    getJobSnapshot(jobId: string): BulkSendJobSnapshot {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new NotFoundException('Job de envio em massa não encontrado (pode ter expirado)');
        }
        return this.snapshot(job);
    }

    private async processarLoteInicial(job: InternalJob): Promise<void> {
        for (let i = 0; i < job.itens.length; i += this.concurrency) {
            const batch = job.itens.slice(i, i + this.concurrency);
            // allSettled: nenhuma falha individual interrompe o restante do lote.
            await Promise.allSettled(batch.map((item) => this.processarItem(job, item)));
        }
        this.verificarConclusao(job);
    }

    private async processarItem(job: InternalJob, item: InternalItem): Promise<void> {
        item.status = 'ENVIANDO';
        item.proximaTentativaEm = null;
        item.tentativas += 1;

        try {
            const resultado = await this.comTimeout(item.executor(), this.itemTimeoutMs, `no envio para ${item.nome}`);
            if (resultado?.success) {
                item.status = 'SUCESSO';
                item.ultimoErro = null;
                this.logger.log(`✅ [${job.tipo}] Enviado para ${item.nome} (tentativa ${item.tentativas}/${this.maxTentativas})`);
            } else {
                this.registrarFalhaDaTentativa(job, item, resultado?.error || 'Falha desconhecida no envio');
            }
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Erro desconhecido';
            this.registrarFalhaDaTentativa(job, item, msg);
        }

        this.verificarConclusao(job);
    }

    private registrarFalhaDaTentativa(job: InternalJob, item: InternalItem, erro: string): void {
        item.ultimoErro = erro;

        if (item.tentativas >= this.maxTentativas) {
            item.status = 'FALHA';
            this.logger.warn(`❌ [${job.tipo}] Falha DEFINITIVA para ${item.nome} após ${item.tentativas} tentativa(s): ${erro}`);
            return;
        }

        item.status = 'AGUARDANDO_RETENTATIVA';
        item.proximaTentativaEm = new Date(Date.now() + this.retryDelayMs);
        this.logger.warn(
            `🔁 [${job.tipo}] Falha para ${item.nome} (tentativa ${item.tentativas}/${this.maxTentativas}): ${erro}. ` +
                `Retentativa em ${Math.round(this.retryDelayMs / 1000)}s.`,
        );

        item.retryTimer = setTimeout(() => {
            item.retryTimer = null;
            void this.processarItem(job, item).catch((error: unknown) => {
                const msg = error instanceof Error ? error.message : 'Erro desconhecido';
                this.logger.error(`Erro inesperado na retentativa de ${item.nome} (job ${job.jobId}): ${msg}`);
            });
        }, this.retryDelayMs);
        // Não impede o processo de encerrar por causa de um timer de retentativa.
        item.retryTimer.unref?.();
    }

    /**
     * Aplica um teto de tempo à promise do envio: se o provedor travar, a
     * tentativa falha por timeout e a fila continua (o erro NÃO se propaga
     * como "timeout exceeded" para a request HTTP, que já foi respondida)
     */
    private async comTimeout<T>(promise: Promise<T>, ms: number, contexto: string): Promise<T> {
        let timer: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                promise,
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`Timeout de ${Math.round(ms / 1000)}s excedido ${contexto}`)), ms);
                    timer.unref?.();
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    private verificarConclusao(job: InternalJob): void {
        if (job.finalizadoEm) return;
        const todosTerminais = job.itens.every((item) => item.status === 'SUCESSO' || item.status === 'FALHA');
        if (!todosTerminais) return;

        job.finalizadoEm = new Date();
        const enviados = job.itens.filter((item) => item.status === 'SUCESSO').length;
        const falhas = job.itens.length - enviados;
        this.logger.log(`🏁 Job ${job.jobId} (tipo=${job.tipo}) finalizado: ${enviados} enviado(s), ${falhas} falha(s) definitiva(s).`);
    }

    private limparJobsAntigos(): void {
        const agora = Date.now();
        for (const [jobId, job] of this.jobs) {
            const terminou = job.finalizadoEm != null;
            const expirou = agora - job.criadoEm.getTime() > WhatsAppBulkQueueService.JOB_RETENTION_MS;
            if (terminou && expirou) {
                this.jobs.delete(jobId);
            }
        }
    }

    private snapshot(job: InternalJob): BulkSendJobSnapshot {
        const itens = job.itens.map<BulkSendItemSnapshot>((item) => ({
            id: item.id,
            nome: item.nome,
            status: item.status,
            tentativas: item.tentativas,
            ultimoErro: item.ultimoErro,
            proximaTentativaEm: item.proximaTentativaEm ? item.proximaTentativaEm.toISOString() : null,
        }));

        const enviados = itens.filter((item) => item.status === 'SUCESSO').length;
        const falhasDefinitivas = itens.filter((item) => item.status === 'FALHA').length;
        const aguardandoRetentativa = itens.filter((item) => item.status === 'AGUARDANDO_RETENTATIVA').length;
        const erros = itens.filter((item) => item.status === 'FALHA' && item.ultimoErro).map((item) => `Erro ao enviar para ${item.nome}: ${item.ultimoErro}`);

        return {
            jobId: job.jobId,
            tipo: job.tipo,
            criadoEm: job.criadoEm.toISOString(),
            finalizadoEm: job.finalizadoEm ? job.finalizadoEm.toISOString() : null,
            emAndamento: job.finalizadoEm == null,
            total: itens.length,
            enviados,
            falhasDefinitivas,
            aguardandoRetentativa,
            erros,
            itens,
        };
    }
}
