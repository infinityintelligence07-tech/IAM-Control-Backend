import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IsNull } from 'typeorm';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { Turmas } from '../../config/entities/turmas.entity';
import { Polos } from '../../config/entities/polos.entity';
import { EStatusTurmas } from '../../config/entities/enum';
import {
    MasterclassFeedItem,
    MasterclassFeedLead,
    MasterclassFeedResponse,
    MasterclassSyncResult,
} from './dto/masterclass-feed.dto';

/**
 * Sincroniza as masterclasses do feed externo (dash-masterclass-iam) para dentro
 * do IAM Control.
 *
 * Modelo de dados no IAM Control:
 *  - Cada masterclass do feed vira uma TURMA (tabela `turmas`) vinculada ao
 *    treinamento de palestra "MasterClass" (tipo_palestra = true).
 *  - O polo é resolvido pela cidade/nome do polo do feed.
 *  - O UUID de origem é guardado em `turmas.referencia_externa` para que novas
 *    execuções sejam idempotentes (atualiza em vez de duplicar).
 *  - Se o feed trouxer leads individuais (hoje ele NÃO traz, só contagens), eles
 *    são gravados em `masterclass_pre_cadastros` vinculados à turma.
 */
@Injectable()
export class MasterclassSyncService {
    private readonly logger = new Logger(MasterclassSyncService.name);
    private sincronizacaoEmExecucao = false;

    constructor(private readonly uow: UnitOfWorkService) {}

    private get feedUrl(): string {
        return (process.env.MASTERCLASS_SYNC_URL || '').trim();
    }

    private get feedToken(): string {
        return (process.env.MASTERCLASS_SYNC_TOKEN || '').trim();
    }

    private get incluirMetas(): boolean {
        return (process.env.MASTERCLASS_SYNC_INCLUIR_METAS || 'true').trim().toLowerCase() !== 'false';
    }

    private get incluirCanceladas(): boolean {
        return (process.env.MASTERCLASS_SYNC_INCLUIR_CANCELADAS || 'true').trim().toLowerCase() !== 'false';
    }

    /**
     * Cron diário (configurável por MASTERCLASS_SYNC_CRON, default 02:00).
     * Desligue com MASTERCLASS_SYNC_ENABLED=false.
     */
    @Cron(process.env.MASTERCLASS_SYNC_CRON || '0 2 * * *', { name: 'masterclass-sync-diaria' })
    async sincronizarMasterclassesCron(): Promise<void> {
        if ((process.env.MASTERCLASS_SYNC_ENABLED || 'true').trim().toLowerCase() === 'false') {
            this.logger.log('masterclass.sync.cron | Rotina desabilitada (MASTERCLASS_SYNC_ENABLED=false)');
            return;
        }
        if (this.sincronizacaoEmExecucao) {
            this.logger.warn('masterclass.sync.cron | Execução anterior ainda em andamento, pulando ciclo');
            return;
        }

        this.sincronizacaoEmExecucao = true;
        try {
            const resultado = await this.sincronizar();
            this.logger.log(
                `masterclass.sync.cron | Concluída | recebidas=${resultado.total_recebidas} criadas=${resultado.turmas_criadas} ` +
                    `atualizadas=${resultado.turmas_atualizadas} adotadas=${resultado.turmas_vinculadas_existentes} ` +
                    `sem_polo=${resultado.sem_polo} ignoradas=${resultado.ignoradas_filtro} leads=${resultado.leads_criados} erros=${resultado.erros}`,
            );
        } catch (error) {
            this.logger.error('masterclass.sync.cron | Erro ao sincronizar masterclasses', error instanceof Error ? error.stack : undefined);
        } finally {
            this.sincronizacaoEmExecucao = false;
        }
    }

    /**
     * Executa a sincronização completa: busca o feed e faz upsert das masterclasses.
     * Pode ser chamada manualmente (endpoint) ou pelo cron.
     */
    async sincronizar(): Promise<MasterclassSyncResult> {
        const resultado: MasterclassSyncResult = {
            total_recebidas: 0,
            turmas_criadas: 0,
            turmas_atualizadas: 0,
            turmas_vinculadas_existentes: 0,
            ignoradas_filtro: 0,
            sem_polo: 0,
            leads_criados: 0,
            erros: 0,
            detalhes_sem_polo: [],
        };

        if (!this.feedUrl || !this.feedToken) {
            throw new Error('masterclass.sync | MASTERCLASS_SYNC_URL e MASTERCLASS_SYNC_TOKEN precisam estar configurados');
        }

        const itens = await this.buscarFeed();
        resultado.total_recebidas = itens.length;
        this.logger.log(`masterclass.sync | Feed recebido | itens=${itens.length}`);

        const idTreinamentoMasterclass = await this.resolverTreinamentoMasterclassId();
        const polos = await this.uow.polosRP.find();

        for (const item of itens) {
            try {
                // Filtros de negócio.
                if (item.origem === 'meta' && !this.incluirMetas) {
                    resultado.ignoradas_filtro++;
                    continue;
                }
                if (item.cancelada && !this.incluirCanceladas) {
                    resultado.ignoradas_filtro++;
                    continue;
                }

                const polo = this.resolverPolo(item, polos);
                if (!polo) {
                    resultado.sem_polo++;
                    resultado.detalhes_sem_polo.push(`${item.cidade || '?'} / ${item.polo || '?'} (id externo ${item.id})`);
                    this.logger.warn(`masterclass.sync.polo | Polo não encontrado | cidade="${item.cidade}" polo="${item.polo}" id=${item.id}`);
                    continue;
                }

                const turma = await this.upsertTurma(item, idTreinamentoMasterclass, polo, resultado);

                // Leads (só se o feed trouxer — atualmente não traz).
                const leads = item.leads ?? item.registros;
                if (turma && Array.isArray(leads) && leads.length > 0) {
                    resultado.leads_criados += await this.upsertLeads(turma, item, leads);
                }
            } catch (error) {
                resultado.erros++;
                this.logger.error(
                    `masterclass.sync.item | Erro ao processar masterclass id=${item.id}`,
                    error instanceof Error ? error.stack : undefined,
                );
            }
        }

        return resultado;
    }

    /** Busca o feed externo com autenticação por token. */
    private async buscarFeed(): Promise<MasterclassFeedItem[]> {
        const url = new URL(this.feedUrl);
        // Reduz o payload quando os filtros estão desligados.
        url.searchParams.set('incluir_metas', this.incluirMetas ? 'true' : 'false');
        url.searchParams.set('incluir_canceladas', this.incluirCanceladas ? 'true' : 'false');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const resposta = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.feedToken}`,
                    'x-webhook-token': this.feedToken,
                    Accept: 'application/json',
                },
                signal: controller.signal,
            });

            const texto = await resposta.text();
            if (!resposta.ok) {
                throw new Error(`masterclass.sync | Feed respondeu ${resposta.status}: ${texto.slice(0, 300)}`);
            }

            let corpo: MasterclassFeedResponse;
            try {
                corpo = JSON.parse(texto) as MasterclassFeedResponse;
            } catch {
                throw new Error(`masterclass.sync | Resposta do feed não é JSON válido: ${texto.slice(0, 300)}`);
            }

            if (!corpo.ok) {
                throw new Error(`masterclass.sync | Feed retornou ok=false: ${corpo.error ?? 'sem detalhe'}`);
            }

            return Array.isArray(corpo.masterclasses) ? corpo.masterclasses : [];
        } finally {
            clearTimeout(timeout);
        }
    }

    /** Cria ou atualiza a turma correspondente à masterclass (idempotente por referencia_externa). */
    private async upsertTurma(
        item: MasterclassFeedItem,
        idTreinamento: number,
        polo: Polos,
        resultado: MasterclassSyncResult,
    ): Promise<Turmas> {
        const status = this.mapearStatus(item);
        // Dados de endereço da masterclass (o que importa aqui): cidade, polo,
        // endereço (endereco_local -> logradouro) e local/nome do espaço (-> complemento).
        const logradouro = (item.endereco_local || item.local || 'A definir').slice(0, 255);
        const complemento = item.local ? item.local.slice(0, 255) : null;
        const meta = item.meta_vendas_por_mc != null ? Math.round(item.meta_vendas_por_mc) : null;

        const aplicarCampos = (turma: Turmas) => {
            turma.id_treinamento = idTreinamento;
            turma.id_polo = polo.id;
            turma.data_inicio = item.data;
            turma.data_final = item.data;
            turma.cidade = item.cidade || polo.cidade;
            turma.estado = polo.estado;
            turma.status_turma = status;
            turma.logradouro = logradouro;
            turma.complemento = complemento;
            turma.meta = meta ?? turma.meta;
        };

        // 1) Já importada antes: casa pelo UUID de origem (idempotência).
        const existente = await this.uow.turmasRP.findOne({ where: { referencia_externa: item.id } });
        if (existente) {
            aplicarCampos(existente);
            const salva = await this.uow.turmasRP.save(existente);
            resultado.turmas_atualizadas++;
            this.logger.log(`masterclass.sync.turma.update | id=${salva.id} ref=${item.id} status=${status} polo=${polo.id}`);
            return salva;
        }

        // 2) Anti-duplicidade: adota uma masterclass já existente (ex.: criada
        //    manualmente) com mesmo treinamento + polo + data e sem referência
        //    externa ainda, vinculando o UUID a ela em vez de criar outra.
        const candidato = await this.uow.turmasRP.findOne({
            where: {
                id_treinamento: idTreinamento,
                id_polo: polo.id,
                data_inicio: item.data,
                referencia_externa: IsNull(),
            },
        });
        if (candidato) {
            candidato.referencia_externa = item.id;
            aplicarCampos(candidato);
            const salva = await this.uow.turmasRP.save(candidato);
            resultado.turmas_vinculadas_existentes++;
            this.logger.log(`masterclass.sync.turma.adotar | id=${salva.id} ref=${item.id} status=${status} polo=${polo.id} data=${item.data}`);
            return salva;
        }

        // 3) Nova masterclass.
        const nova = this.uow.turmasRP.create({
            referencia_externa: item.id,
            id_treinamento: idTreinamento,
            id_polo: polo.id,
            data_inicio: item.data,
            data_final: item.data,
            cidade: item.cidade || polo.cidade,
            estado: polo.estado,
            status_turma: status,
            complemento,
            // Campos obrigatórios da turma sem correspondência direta no feed.
            cep: '',
            logradouro,
            numero: 'S/N',
            bairro: '',
            meta: meta ?? undefined,
        });
        const salva = await this.uow.turmasRP.save(nova);
        resultado.turmas_criadas++;
        this.logger.log(`masterclass.sync.turma.create | id=${salva.id} ref=${item.id} status=${status} polo=${polo.id} data=${item.data}`);
        return salva;
    }

    /**
     * Grava os leads da masterclass em masterclass_pre_cadastros (dedup por email+turma).
     * Só roda se o feed trouxer os cadastros individuais.
     */
    private async upsertLeads(turma: Turmas, item: MasterclassFeedItem, leads: MasterclassFeedLead[]): Promise<number> {
        let criados = 0;
        for (const lead of leads) {
            const email = (lead.email || '').trim().toLowerCase();
            const nome = (lead.nome || lead.nome_aluno || '').trim();
            const telefone = (lead.telefone || '').trim();
            if (!email || !nome) continue; // nome/email são obrigatórios no pré-cadastro

            const jaExiste = await this.uow.masterclassPreCadastrosRP.findOne({
                where: { id_turma: turma.id, email },
            });
            if (jaExiste) continue;

            const preCadastro = this.uow.masterclassPreCadastrosRP.create({
                nome_aluno: nome,
                email,
                telefone: telefone || 'N/D',
                evento_nome: `MasterClass - ${item.cidade || turma.cidade || ''}`.trim(),
                data_evento: new Date(item.data),
                id_turma: turma.id,
                presente: lead.presente === true,
                teve_interesse: false,
            });
            await this.uow.masterclassPreCadastrosRP.save(preCadastro);
            criados++;
        }
        if (criados > 0) {
            this.logger.log(`masterclass.sync.leads | turma=${turma.id} leads_criados=${criados}`);
        }
        return criados;
    }

    /** Traduz o status do feed para o enum de status de turma do IAM Control. */
    private mapearStatus(item: MasterclassFeedItem): EStatusTurmas {
        if (item.cancelada || item.status === 'cancelada') return EStatusTurmas.INSCRICOES_PAUSADAS;
        switch (item.status) {
            case 'realizada':
                return EStatusTurmas.ENCERRADA;
            case 'agendada':
                return EStatusTurmas.INSCRICOES_ABERTAS;
            case 'prevista':
            default:
                return EStatusTurmas.AGUARDANDO_LIBERACAO;
        }
    }

    /**
     * Resolve o polo do IAM Control para a masterclass. Prioriza a cidade (mais
     * específica) e cai para o nome do polo (hub) quando a cidade não bate.
     */
    private resolverPolo(item: MasterclassFeedItem, polos: Polos[]): Polos | null {
        const cidadeFeed = this.normalizar(item.cidade);
        const poloFeed = this.normalizar(item.polo);

        if (cidadeFeed) {
            const porCidade = polos.find((p) => this.normalizar(p.cidade) === cidadeFeed);
            if (porCidade) return porCidade;
        }
        if (poloFeed) {
            const porPolo = polos.find((p) => this.normalizar(p.polo) === poloFeed);
            if (porPolo) return porPolo;
        }
        return null;
    }

    /** Descobre o treinamento de masterclass (palestra). Prefere a sigla "MC". */
    private async resolverTreinamentoMasterclassId(): Promise<number> {
        const palestras = await this.uow.treinamentosRP.find({ where: { tipo_palestra: true } });
        if (palestras.length === 0) {
            throw new Error('masterclass.sync | Nenhum treinamento de palestra (tipo_palestra=true) encontrado para vincular as masterclasses');
        }
        const preferido = palestras.find((t) => (t.sigla_treinamento || '').toUpperCase() === 'MC');
        return (preferido ?? palestras[0]).id;
    }

    /** Normaliza texto para comparação: minúsculo, sem acento, sem espaços extras. */
    private normalizar(valor: string | null | undefined): string {
        return (valor || '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .trim()
            .toLowerCase();
    }
}
