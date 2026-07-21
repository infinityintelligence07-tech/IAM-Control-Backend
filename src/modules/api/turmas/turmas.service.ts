import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { getRequestUserId } from '@/common/context/request-user.context';
import { userHasSetor } from '@/common/utils/setor.util';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import {
    EFuncoes,
    ESetores,
    EOrigemAlunos,
    EStatusAlunosTurmas,
    EPresencaTurmas,
    EStatusTurmas,
    EStatusAlunosGeral,
    EFormasPagamento,
    EStatusEventoCalendario,
} from '../../config/entities/enum';
import {
    GetTurmasDto,
    CreateTurmaDto,
    UpdateTurmaDto,
    AddAlunoTurmaDto,
    UpdateAlunoTurmaDto,
    TurmasListResponseDto,
    TurmaResponseDto,
    AlunosTurmaListResponseDto,
    AlunosTurmaExportResponseDto,
    AlunoTurmaResponseDto,
    AlunosDisponiveisResponseDto,
    TurmaStatusResumoResponseDto,
    TurmaStatusAlunosResponseDto,
    TurmaStatusAlunosItemDto,
    SoftDeleteTurmaDto,
    OpcoesTransferenciaResponseDto,
    HistoricoTransferenciaItemDto,
    HistoricoTransferenciasResponseDto,
    UpdateTurmaTimesDto,
    TurmaTimesResponseDto,
    AlunoTurmaHistoricoItemDto,
    AlunoTurmaHistoricoResponseDto,
    CreateAlunoTurmaHistoricoDto,
    TurmaHistoricoResponseDto,
    TurmaHistoricoItemDto,
    CreateTurmaHistoricoDto,
    AlunoTurmaHistoricoTemplateDto,
    AlunoHistoricoObservacoesResponseDto,
    AlunoHistoricoObservacaoItemDto,
    AlunoHistoricoTurmaFiltroDto,
    GetExtratoMovimentacaoDto,
    ExtratoMovimentacaoResponseDto,
    ExtratoMovimentacaoTurmaDto,
    ExtratoMovimentacaoDiaDto,
    ExtratoMovimentacaoDetalheDto,
    GetMovimentacaoAlunosDto,
    MovimentacaoAlunosResponseDto,
    GetAlunosSaldoPeriodoDto,
    AlunoSaldoPeriodoItemDto,
    AlunosSaldoPeriodoCanalDto,
    AlunosSaldoPeriodoResponseDto,
    MovimentacaoAlunoItemDto,
} from './dto/turmas.dto';
import { FindOptionsSelect, Not, In, IsNull } from 'typeorm';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { DocumentosService } from '../documentos/documentos.service';
import { ConfiguracoesService } from '../configuracoes/configuracoes.service';
import { PresentesSorteio } from '../../config/entities/presentesSorteio.entity';
import { HistoricoSorteados } from '../../config/entities/historicoSorteados.entity';
import { TurmasAlunosTreinamentos } from '../../config/entities/turmasAlunosTreinamentos.entity';
import { TurmasAlunos } from '../../config/entities/turmasAlunos.entity';
import { Usuarios } from '../../config/entities/usuarios.entity';
import { resolverDuracaoMentoriaMeses, sqlDuracaoMentoriaMeses } from '@/utils/mentoria-duracao';

export interface PresenteSorteioPayload {
    descricao: string;
    imagem_base64?: string | null;
    imagem_mime_type?: string | null;
    para_toda_turma: boolean;
}

export interface HistoricoSorteadoPayload {
    id_turma_aluno: string;
    id_turma: number;
    id_presente_sorteio: number;
    numero_cracha: string;
    sorteado_em?: string;
}

export interface HistoricoSorteadosFilters {
    id_turma?: number;
    id_presente_sorteio?: number;
    data_inicio?: string;
    data_final?: string;
    page?: number;
    limit?: number;
}

export interface RemoverHistoricoSorteadoPayload {
    observacao: string;
}

type AlunoTurmaHistoricoTipoAcao = 'CRIACAO' | 'ATUALIZACAO' | 'TRANSFERENCIA' | 'CANCELAMENTO' | 'REMOCAO' | 'OBSERVACAO';

const ALUNO_TURMA_HISTORICO_TEMPLATES: AlunoTurmaHistoricoTemplateDto[] = [
    { key: 'ALUNO_FEZ_CONFIRMACAO', label: 'Aluno fez a confirmação' },
    { key: 'ALUNO_FEZ_CHECKIN', label: 'Aluno fez o check-in' },
    { key: 'ALUNO_TRANSFERIU_TURMA', label: 'Aluno transferiu de turma' },
    { key: 'ALUNO_TRANSFERIU_TREINAMENTO', label: 'Aluno transferiu de treinamento' },
    { key: 'ALUNO_CANCELOU_INSCRICAO', label: 'Aluno cancelou a inscrição' },
    { key: 'ALUNO_SOLICITOU_CONTATO', label: 'Aluno solicitou contato' },
    { key: 'ALUNO_SEM_RETORNO', label: 'Sem retorno do aluno' },
];

// Histórico (log de alterações) da turma/evento.
type TurmaHistoricoTipoAcao = 'CRIACAO' | 'ATUALIZACAO' | 'STATUS' | 'REMOCAO' | 'IMPORTACAO' | 'OBSERVACAO';

const TURMA_HISTORICO_TEMPLATES: AlunoTurmaHistoricoTemplateDto[] = [
    { key: 'LOCAL_CONFIRMADO', label: 'Local confirmado' },
    { key: 'LOCAL_ALTERADO', label: 'Local alterado' },
    { key: 'LIDER_ALTERADO', label: 'Líder do evento alterado' },
    { key: 'DATA_ALTERADA', label: 'Data do evento alterada' },
    { key: 'EVENTO_ADIADO', label: 'Evento adiado' },
    { key: 'EVENTO_CANCELADO', label: 'Evento cancelado' },
    { key: 'OBSERVACAO_GERAL', label: 'Observação geral' },
];

const TURMA_STATUS_TIPOS_SNAPSHOT: string[] = [
    'inscritos',
    'origem_masterclass',
    'origem_presente',
    'origem_bonus',
    'origem_cortesia_sorteio',
    'origem_time_vendas',
    'origem_transbordo',
    'origem_liberty',
    'origem_transferencia',
    'origem_importacao',
    'transferidos',
    'transferidos_para_essa',
    'transferidos_para_outra',
    'confirmados',
    'confirmacao_aguardando',
    'checkin_aguardando',
    'checkin_realizado',
    'cancelados',
    'inadimplentes',
];

const TEMPLATE_AUTO_TRANSFERENCIA_NO_SHOW_IPR = 'AUTO_TRANSFERENCIA_NO_SHOW_IPR';

@Injectable()
export class TurmasService {
    private readonly logger = new Logger(TurmasService.name);
    private congelamentoMetricasCronEmExecucao = false;
    private periodosMentoriaCronEmExecucao = false;
    /** Turmas com congelamento de snapshot em geração em background (evita disparos duplicados). */
    private readonly snapshotEmGeracaoBackground = new Set<number>();

    constructor(
        private readonly uow: UnitOfWorkService,
        private readonly whatsappService: WhatsAppService,
        @Inject(forwardRef(() => DocumentosService))
        private readonly documentosService: DocumentosService,
        private readonly configuracoesService: ConfiguracoesService,
    ) {}

    async getPresentesSorteio(): Promise<PresentesSorteio[]> {
        return this.uow.presentesSorteioRP.find({
            where: { deletado_em: null },
            order: { descricao: 'ASC' },
        });
    }

    async createPresenteSorteio(payload: PresenteSorteioPayload, userId?: number): Promise<PresentesSorteio> {
        const descricao = (payload.descricao || '').trim();
        if (!descricao) {
            throw new BadRequestException('Descrição do presente é obrigatória.');
        }

        const presenteToInsert = {
            descricao,
            imagem_base64: payload.imagem_base64?.trim() || null,
            imagem_mime_type: payload.imagem_mime_type?.trim() || null,
            para_toda_turma: payload.para_toda_turma,
            criado_por: userId,
            atualizado_por: userId,
        };

        const insertResult = await this.uow.presentesSorteioRP.insert(presenteToInsert);
        const insertedId = Number(insertResult.identifiers?.[0]?.id);

        if (!insertedId) {
            throw new BadRequestException('Não foi possível criar o presente.');
        }

        const inserted = await this.uow.presentesSorteioRP.findOne({
            where: { id: insertedId, deletado_em: null },
        });

        if (!inserted) {
            throw new NotFoundException('Presente criado, mas não encontrado para retorno.');
        }

        return inserted;
    }

    async updatePresenteSorteio(id: number, payload: PresenteSorteioPayload, userId?: number): Promise<PresentesSorteio> {
        const presente = await this.uow.presentesSorteioRP.findOne({
            where: { id, deletado_em: null },
            select: ['id', 'criado_em', 'atualizado_em', 'criado_por', 'atualizado_por', 'deletado_em'] as any,
        });

        if (!presente) {
            throw new NotFoundException('Presente não encontrado.');
        }

        const descricao = (payload.descricao || '').trim();
        if (!descricao) {
            throw new BadRequestException('Descrição do presente é obrigatória.');
        }

        const shouldUpdateImagem = payload.imagem_base64 !== undefined || payload.imagem_mime_type !== undefined;
        const atualizadoEm = new Date();
        const updatePayload: any = {
            descricao,
            para_toda_turma: payload.para_toda_turma,
            atualizado_por: userId ?? presente.atualizado_por,
            atualizado_em: atualizadoEm,
        };

        if (shouldUpdateImagem) {
            updatePayload.imagem_base64 = payload.imagem_base64?.trim() || null;
            updatePayload.imagem_mime_type = payload.imagem_mime_type?.trim() || null;
        }

        await this.uow.presentesSorteioRP.update({ id, deletado_em: IsNull() as any }, updatePayload);

        return {
            ...presente,
            descricao,
            ...(shouldUpdateImagem
                ? {
                      imagem_base64: payload.imagem_base64?.trim() || null,
                      imagem_mime_type: payload.imagem_mime_type?.trim() || null,
                  }
                : {}),
            para_toda_turma: payload.para_toda_turma,
            atualizado_por: userId ?? presente.atualizado_por,
            atualizado_em: atualizadoEm,
        } as PresentesSorteio;
    }

    async softDeletePresenteSorteio(id: number, userId?: number): Promise<void> {
        const presente = await this.uow.presentesSorteioRP.findOne({
            where: { id, deletado_em: null },
            select: ['id', 'atualizado_por'] as any,
        });

        if (!presente) {
            throw new NotFoundException('Presente não encontrado.');
        }

        await this.uow.presentesSorteioRP.update(
            { id, deletado_em: IsNull() as any },
            {
                deletado_em: new Date(),
                atualizado_por: userId ?? presente.atualizado_por,
                atualizado_em: new Date(),
            },
        );
    }

    async registrarHistoricoSorteado(payload: HistoricoSorteadoPayload, userId?: number): Promise<HistoricoSorteados> {
        const numeroCracha = (payload.numero_cracha || '').trim();
        if (!payload.id_turma_aluno || !payload.id_turma || !payload.id_presente_sorteio || !numeroCracha) {
            throw new BadRequestException('Dados obrigatórios do histórico de sorteio não informados.');
        }

        const turmaAluno = await this.uow.turmasAlunosRP.findOne({
            where: { id: payload.id_turma_aluno, id_turma: payload.id_turma, deletado_em: null },
            select: ['id', 'id_turma'] as any,
        });
        if (!turmaAluno) {
            throw new NotFoundException('Aluno da turma não encontrado para registrar o sorteio.');
        }

        const presente = await this.uow.presentesSorteioRP.findOne({
            where: { id: payload.id_presente_sorteio, deletado_em: null },
            select: ['id'] as any,
        });
        if (!presente) {
            throw new NotFoundException('Presente não encontrado para registrar o sorteio.');
        }

        const historicoToInsert = {
            id_turma_aluno: payload.id_turma_aluno,
            id_turma: payload.id_turma,
            id_presente_sorteio: payload.id_presente_sorteio,
            numero_cracha: numeroCracha,
            sorteado_em: payload.sorteado_em ? new Date(payload.sorteado_em) : new Date(),
            criado_por: userId,
            atualizado_por: userId,
        };

        const insertResult = await this.uow.historicoSorteadosRP.insert(historicoToInsert);
        const insertedId = String(insertResult.identifiers?.[0]?.id || '');

        if (!insertedId) {
            throw new BadRequestException('Não foi possível registrar o histórico de sorteio.');
        }

        const historico = await this.uow.historicoSorteadosRP.findOne({
            where: { id: insertedId, deletado_em: null },
        });

        if (!historico) {
            throw new NotFoundException('Histórico criado, mas não encontrado para retorno.');
        }

        return historico;
    }

    async getHistoricoSorteados(filters: HistoricoSorteadosFilters) {
        const page = Math.max(1, Number(filters.page || 1));
        const limit = Math.max(1, Math.min(200, Number(filters.limit || 20)));

        const qb = this.uow.historicoSorteadosRP
            .createQueryBuilder('hs')
            .leftJoin('turmas_alunos', 'ta', 'ta.id = hs.id_turma_aluno')
            .leftJoin('alunos', 'a', 'a.id = ta.id_aluno')
            .leftJoin('turmas', 't', 't.id = hs.id_turma')
            .leftJoin('presentes_sorteio', 'ps', 'ps.id = hs.id_presente_sorteio')
            .leftJoin('usuarios', 'u', 'u.id = hs.criado_por')
            .where('hs.deletado_em IS NULL');

        if (filters.id_turma) {
            qb.andWhere('hs.id_turma = :id_turma', { id_turma: Number(filters.id_turma) });
        }

        if (filters.id_presente_sorteio) {
            qb.andWhere('hs.id_presente_sorteio = :id_presente_sorteio', {
                id_presente_sorteio: Number(filters.id_presente_sorteio),
            });
        }

        if (filters.data_inicio) {
            qb.andWhere('hs.sorteado_em >= :data_inicio', {
                data_inicio: `${filters.data_inicio} 00:00:00`,
            });
        }

        if (filters.data_final) {
            qb.andWhere('hs.sorteado_em <= :data_final', {
                data_final: `${filters.data_final} 23:59:59`,
            });
        }

        const total = await qb.getCount();

        const rows = await qb
            .select([
                'hs.id AS id',
                'hs.id_turma_aluno AS id_turma_aluno',
                'hs.id_turma AS id_turma',
                'hs.id_presente_sorteio AS id_presente_sorteio',
                'hs.numero_cracha AS numero_cracha',
                'hs.sorteado_em AS sorteado_em',
                'hs.criado_por AS criado_por',
                'hs.criado_em AS criado_em',
                'a.nome AS nome_aluno',
                'a.nome_cracha AS nome_cracha',
                't.edicao_turma AS edicao_turma',
                't.cidade AS cidade_turma',
                'ps.descricao AS descricao_presente',
                'u.nome AS nome_usuario',
            ])
            .orderBy('hs.sorteado_em', 'DESC')
            .skip((page - 1) * limit)
            .take(limit)
            .getRawMany();

        return {
            data: rows,
            total,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        };
    }

    async removerHistoricoSorteado(idHistorico: string, payload: RemoverHistoricoSorteadoPayload, userId?: number): Promise<void> {
        const idNormalizado = String(idHistorico || '').trim();
        if (!/^\d+$/.test(idNormalizado)) {
            throw new BadRequestException('ID do histórico de sorteio inválido.');
        }

        const motivoRemocao = String(payload?.observacao || '').trim();
        if (motivoRemocao.length < 3) {
            throw new BadRequestException('Informe um motivo para remoção com pelo menos 3 caracteres.');
        }

        const historico = await this.uow.historicoSorteadosRP.findOne({
            where: { id: idNormalizado, deletado_em: null },
            select: ['id', 'atualizado_por'] as any,
        });

        if (!historico) {
            throw new NotFoundException('Registro de histórico não encontrado.');
        }

        let nomeUsuario = 'Usuário não identificado';
        if (userId) {
            const usuario = await this.uow.usuariosRP.findOne({
                where: { id: userId, deletado_em: null },
                select: ['id', 'nome'] as any,
            });
            if (usuario?.nome) {
                nomeUsuario = usuario.nome;
            }
        }

        const observacaoRemocao = `Removido por ${nomeUsuario}${userId ? ` (ID ${userId})` : ''}. Motivo: ${motivoRemocao}`;

        await this.uow.historicoSorteadosRP.update(
            { id: idNormalizado, deletado_em: IsNull() as any },
            {
                observacao: observacaoRemocao,
                deletado_em: new Date(),
                atualizado_por: userId ?? historico.atualizado_por,
                atualizado_em: new Date(),
            },
        );
    }

    /** Mapeia entidade Turmas (com relações id_treinamento_fk e id_polo_fk) para o objeto de tag de transferência. */
    private mapTurmaToTransferenciaTag(
        turma: any,
    ):
        | { id: number; edicao_turma?: string; data_inicio: string; data_final: string; treinamento_nome?: string; sigla_treinamento?: string; polo_nome?: string }
        | undefined {
        if (!turma) return undefined;
        return {
            id: turma.id,
            edicao_turma: turma.edicao_turma ?? undefined,
            data_inicio: turma.data_inicio ?? '',
            data_final: turma.data_final ?? '',
            treinamento_nome: turma.id_treinamento_fk?.treinamento ?? undefined,
            sigla_treinamento: turma.id_treinamento_fk?.sigla_treinamento ?? undefined,
            polo_nome: turma.id_polo_fk?.polo ?? undefined,
        };
    }

    private isAlunoTransferidoDaTurma(turmaAluno: any): boolean {
        return turmaAluno?.id_turma_transferencia_para !== null && turmaAluno?.id_turma_transferencia_para !== undefined;
    }

    private isAlunoConfirmadoNaTurma(turmaAluno: any): boolean {
        if (!turmaAluno) return false;
        if (this.isAlunoTransferidoDaTurma(turmaAluno)) return false;

        return [EStatusAlunosTurmas.CHECKIN_REALIZADO, EStatusAlunosTurmas.AGUARDANDO_CHECKIN].includes(turmaAluno.status_aluno_turma as EStatusAlunosTurmas);
    }

    private buildConfirmacaoCheckinFlags(
        statusAlunoTurma?: EStatusAlunosTurmas | null,
        presencaTurma?: EPresencaTurmas | null,
    ): { confirmacao_realizada: boolean; checkin_realizado: boolean } {
        const checkinRealizado = statusAlunoTurma === EStatusAlunosTurmas.CHECKIN_REALIZADO || presencaTurma === EPresencaTurmas.PRESENTE;

        const confirmacaoRealizada = checkinRealizado || statusAlunoTurma === EStatusAlunosTurmas.AGUARDANDO_CHECKIN;

        return {
            confirmacao_realizada: confirmacaoRealizada,
            checkin_realizado: checkinRealizado,
        };
    }

    private isInscricaoExtraNaTurma(turmaAluno: any): boolean {
        if (!turmaAluno) return false;

        const origemAluno = turmaAluno?.origem_aluno as EOrigemAlunos | undefined;
        const codigoTurmaOrigemPlanilha = String(turmaAluno?.codigo_turma_origem_planilha || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toUpperCase();

        return (
            turmaAluno?.vaga_bonus === true ||
            origemAluno === EOrigemAlunos.ALUNO_BONUS ||
            origemAluno === EOrigemAlunos.TRANSFERENCIA ||
            origemAluno === EOrigemAlunos.SORTEIO ||
            codigoTurmaOrigemPlanilha === 'TRANSBORDO'
        );
    }

    /** Colunas carregadas na listagem de alunos — exclui comprovante_pagamento_base64 (TEXT pesado). */
    private readonly turmaAlunoListSelect: FindOptionsSelect<TurmasAlunos> = {
        id: true,
        id_turma: true,
        id_aluno: true,
        id_aluno_bonus: true,
        url_comprovante_pgto: true,
        pendencia_pagamento: true,
        quantidade_inscricoes: true,
        outros_clientes: true,
        origem_aluno: true,
        status_aluno_turma: true,
        confirmacao_realizada: true,
        checkin_realizado: true,
        numero_cracha: true,
        presenca_turma: true,
        vaga_bonus: true,
        id_turma_transferencia_para: true,
        id_turma_transferencia_de: true,
        codigo_turma_origem_planilha: true,
        transferido_por_robo: true,
        id_acessor: true,
        forma_pagamento_manual: true,
        boleto_dia_vencimento_manual: true,
        boleto_quantidade_manual: true,
        criado_em: true,
        id_acessor_fk: {
            id: true,
            nome: true,
        },
        id_aluno_fk: {
            id: true,
            nome: true,
            email: true,
            telefone_um: true,
            telefone_dois: true,
            nome_cracha: true,
            cpf: true,
            instagram: true,
            cep: true,
            logradouro: true,
            complemento: true,
            numero: true,
            bairro: true,
            cidade: true,
            estado: true,
            profissao: true,
            genero: true,
            data_nascimento: true,
            status_aluno_geral: true,
            possui_deficiencia: true,
            desc_deficiencia: true,
        },
        id_turma_transferencia_para_fk: {
            id: true,
            edicao_turma: true,
            data_inicio: true,
            data_final: true,
            id_treinamento_fk: {
                id: true,
                sigla_treinamento: true,
                treinamento: true,
            },
            id_polo_fk: {
                id: true,
                polo: true,
                cidade: true,
                estado: true,
            },
        },
        id_turma_transferencia_de_fk: {
            id: true,
            edicao_turma: true,
            data_inicio: true,
            data_final: true,
            id_treinamento_fk: {
                id: true,
                sigla_treinamento: true,
                treinamento: true,
            },
            id_polo_fk: {
                id: true,
                polo: true,
                cidade: true,
                estado: true,
            },
        },
    };

    private turmaAlunoListSelectComMentoria(): FindOptionsSelect<TurmasAlunos> {
        return {
            ...this.turmaAlunoListSelect,
            turmasAlunosTreinamentos: {
                id: true,
                id_turma_destino: true,
                id_treinamento: true,
                data_inicio_mentoria: true,
                data_fim_mentoria: true,
                deletado_em: true,
            },
        };
    }

    private async contarMetricasAlunosDaTurma(id_turma: number): Promise<{
        alunos_count: number;
        extras_count: number;
        confirmados_count: number;
        vindos_transferencia_count: number;
        presentes_count: number;
        inadimplentes_count: number;
    }> {
        const baseQb = () => this.uow.turmasAlunosRP.createQueryBuilder('ta').where('ta.id_turma = :id_turma', { id_turma }).andWhere('ta.deletado_em IS NULL');

        // TRANSBORDO NÃO conta como extra: aluno de transbordo comprou ingresso (entra como venda/Demais Vendas).
        // PRESENTE (importação Masterclass) conta como extra.
        const extrasCondicao = `(
            ta.vaga_bonus = true
            OR ta.origem_aluno IN (:...origensExtra)
        )`;

        const [alunos_count, extras_count, confirmados_count, vindos_transferencia_count, presentes_count, inadimplentes_count] = await Promise.all([
            baseQb().getCount(),
            baseQb()
                .andWhere(extrasCondicao, {
                    origensExtra: [EOrigemAlunos.ALUNO_BONUS, EOrigemAlunos.TRANSFERENCIA, EOrigemAlunos.SORTEIO, EOrigemAlunos.PRESENTE],
                })
                .getCount(),
            baseQb()
                .andWhere('ta.id_turma_transferencia_para IS NULL')
                .andWhere('ta.status_aluno_turma IN (:...statusConfirmados)', {
                    statusConfirmados: [EStatusAlunosTurmas.CHECKIN_REALIZADO, EStatusAlunosTurmas.AGUARDANDO_CHECKIN],
                })
                .getCount(),
            baseQb()
                .andWhere('ta.origem_aluno = :origemTransferencia', { origemTransferencia: EOrigemAlunos.TRANSFERENCIA })
                .andWhere('ta.id_turma_transferencia_de IS NOT NULL')
                .getCount(),
            baseQb()
                .innerJoin('ta.id_aluno_fk', 'aluno_presente')
                .andWhere('ta.presenca_turma = :presente', { presente: EPresencaTurmas.PRESENTE })
                .andWhere('aluno_presente.status_aluno_geral != :inadimplente', { inadimplente: EStatusAlunosGeral.INADIMPLENTE })
                .getCount(),
            baseQb()
                .innerJoin('ta.id_aluno_fk', 'aluno_inad')
                .andWhere('aluno_inad.status_aluno_geral = :inadimplente', { inadimplente: EStatusAlunosGeral.INADIMPLENTE })
                .getCount(),
        ]);

        return {
            alunos_count,
            extras_count,
            confirmados_count,
            vindos_transferencia_count,
            presentes_count,
            inadimplentes_count,
        };
    }

    /** Edições que não entram nas sugestões automáticas (mas podem ser destino explícito no modal). */
    private isTurmaBloqueadaParaTransferencia(turma: any): boolean {
        const edicao = String(turma?.edicao_turma ?? '')
            .trim()
            .toUpperCase();
        return ['SEM_TURMA', 'SEM_TURMAS', 'INADIMPLENTE', 'JURIDICA', 'JURIDICO', 'CANCELADA'].includes(edicao);
    }

    private isTurmaInadimplente(turma: any): boolean {
        const edicao = String(turma?.edicao_turma ?? '')
            .trim()
            .toUpperCase();
        return edicao === 'INADIMPLENTE';
    }

    /**
     * Turma "congelada": encerrada (status ENCERRADA) ou cujo evento já terminou (após D+1 da data_final).
     * Em turmas congeladas os registros dos alunos não saem da turma (transferência apenas replica para o destino)
     * e remoção/cancelamento (soft delete) ficam bloqueados, preservando o histórico para a trilha do aluno.
     */
    private eventoTurmaTerminou(turma: any): boolean | null {
        if (!turma?.data_final) {
            return null;
        }
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const dataFinal = new Date(turma.data_final);
        dataFinal.setHours(23, 59, 59, 999);
        // Congelamento só vale a partir de D+1 da data_final.
        return hoje > dataFinal;
    }

    private isTurmaCongelada(turma: any): boolean {
        if (!turma) {
            return false;
        }
        // Congelada (bloqueia remoção/cancelamento e altera a mecânica de transferência) exige
        // DUAS condições simultâneas:
        //   1) status ENCERRADA; e
        //   2) o evento já ter terminado de fato (D+1 da data_final).
        // Assim, uma turma marcada ENCERRADA antes do fim do evento (ex.: encerramento automático
        // por lotação) NÃO é congelada, e reabrir manualmente (status != ENCERRADA) a descongela.
        const isEncerrada = turma.status_turma === EStatusTurmas.ENCERRADA;
        const eventoTerminou = this.eventoTurmaTerminou(turma);
        // Sem data_final (ex.: mentorias) não há como aferir o fim do evento: respeita só o status.
        if (eventoTerminou === null) {
            return isEncerrada;
        }
        return isEncerrada && eventoTerminou;
    }

    private hasValue(value: unknown): boolean {
        if (value === null || value === undefined) return false;
        if (typeof value !== 'string') return true;
        return value.trim().length > 0;
    }

    /**
     * Ficha considerada preenchida quando os campos-chave do check-in estão presentes.
     */
    private isFichaPreenchida(aluno: any): boolean {
        if (!aluno) return false;
        return (
            this.hasValue(aluno.cpf) &&
            this.hasValue(aluno.instagram) &&
            this.hasValue(aluno.telefone_um) &&
            this.hasValue(aluno.genero) &&
            this.hasValue(aluno.data_nascimento)
        );
    }

    private async validarPermissaoDesmarcarPresenca(turmaAluno: any, userId?: number): Promise<void> {
        if (!userId) {
            throw new ForbiddenException('Não autorizado a desmarcar presença');
        }

        const usuario = await this.uow.usuariosRP.findOne({
            where: { id: userId, deletado_em: null },
            select: ['id', 'funcao'] as any,
        });

        const funcoesUsuario = Array.isArray(usuario?.funcao) ? usuario?.funcao : [];
        const isAdmin = funcoesUsuario.includes(EFuncoes.ADMINISTRADOR);
        const liderEventoId = turmaAluno?.id_turma_fk?.lider_evento;
        const isLiderDaTurma = Number(liderEventoId) === Number(userId);

        if (!isAdmin && !isLiderDaTurma) {
            throw new ForbiddenException('Somente o líder do evento pode desmarcar presença');
        }
    }

    private async validarPermissaoAdministrador(userId?: number): Promise<void> {
        if (!userId) {
            throw new ForbiddenException('Não autorizado');
        }

        const usuario = await this.uow.usuariosRP.findOne({
            where: { id: userId, deletado_em: null },
            select: ['id', 'funcao'] as any,
        });

        const funcoesUsuario = Array.isArray(usuario?.funcao) ? usuario?.funcao : [];
        const isAdmin = funcoesUsuario.includes(EFuncoes.ADMINISTRADOR);
        if (!isAdmin) {
            throw new ForbiddenException('Somente administrador pode executar esta ação');
        }
    }

    private isUsuarioAdministrador(usuario: Pick<Usuarios, 'setor' | 'funcao'> | null | undefined): boolean {
        const funcoes = Array.isArray(usuario?.funcao) ? usuario.funcao : [];
        return funcoes.includes(EFuncoes.ADMINISTRADOR) || userHasSetor(usuario, ESetores.ADMINISTRADOR);
    }

    private static readonly FUNCOES_LIDERANCA = [EFuncoes.LIDER, EFuncoes.LIDER_DE_EVENTOS, EFuncoes.LIDER_DE_MASTERCLASS, EFuncoes.LIDER_DE_CONFRONTO];

    /**
     * Regra de exclusão/cancelamento de alunos da turma (a adição é liberada
     * para qualquer usuário autenticado):
     * - Somente funcionários do setor Cuidado de Alunos (administradores têm bypass).
     * - Se a turma tiver acessora definida, somente ela (além de administradores)
     *   pode remover ou cancelar alunos — vale tanto para DELETE quanto para
     *   status CANCELADO (que também faz soft delete da matrícula).
     * Chamadas internas do sistema (sem userId — ex.: cancelamento de contrato,
     * robô de transferências) não passam por esta validação.
     */
    private async validarPermissaoGerenciarAlunosTurma(
        turma: { id_acessora?: number | null } | null | undefined,
        userId: number | undefined,
        acao: 'adicionar' | 'remover' | 'cancelar',
    ): Promise<void> {
        if (!userId) return; // chamada interna do sistema

        const usuario = await this.uow.usuariosRP.findOne({
            where: { id: userId, deletado_em: null },
            select: ['id', 'setor', 'funcao'] as any,
        });

        if (this.isUsuarioAdministrador(usuario)) return;

        if (!userHasSetor(usuario, ESetores.CUIDADO_DE_ALUNOS)) {
            throw new ForbiddenException(`Somente o time do Cuidado de Alunos pode ${acao} alunos da turma.`);
        }

        const idAcessora = turma?.id_acessora ?? null;
        if (idAcessora && Number(idAcessora) !== Number(userId)) {
            const acessora = await this.uow.usuariosRP.findOne({
                where: { id: idAcessora },
                select: ['id', 'nome'] as any,
                withDeleted: true,
            });
            const nomeAcessora = acessora?.nome ? ` (${acessora.nome})` : '';
            throw new ForbiddenException(`Somente a acessora definida para esta turma${nomeAcessora} pode ${acao} alunos.`);
        }
    }

    /**
     * Define (ou remove, com null) a acessora do Cuidado de Alunos responsável pela
     * turma. Somente administradores ou líderes do Cuidado de Alunos podem definir;
     * a acessora escolhida precisa ser uma colaboradora do Cuidado de Alunos.
     */
    async updateTurmaAcessora(
        id_turma: number,
        idAcessora: number | null,
        userId?: number,
    ): Promise<{ id_acessora: number | null; acessora: { id: number; nome: string } | null }> {
        if (!userId) {
            throw new ForbiddenException('Não autorizado');
        }

        const usuario = await this.uow.usuariosRP.findOne({
            where: { id: userId, deletado_em: null },
            select: ['id', 'setor', 'funcao'] as any,
        });
        const funcoes = Array.isArray(usuario?.funcao) ? usuario.funcao : [];
        const isLiderCuidadoDeAlunos =
            userHasSetor(usuario, ESetores.CUIDADO_DE_ALUNOS) &&
            TurmasService.FUNCOES_LIDERANCA.some((funcao) => funcoes.includes(funcao));

        if (!this.isUsuarioAdministrador(usuario) && !isLiderCuidadoDeAlunos) {
            throw new ForbiddenException('Somente a líder do Cuidado de Alunos pode definir a acessora da turma.');
        }

        const turma = await this.uow.turmasRP.findOne({ where: { id: id_turma, deletado_em: null } });
        if (!turma) {
            throw new NotFoundException('Turma não encontrada');
        }

        let acessora: Usuarios | null = null;
        if (idAcessora) {
            acessora = await this.uow.usuariosRP.findOne({
                where: { id: idAcessora, deletado_em: null },
                select: ['id', 'nome', 'setor'] as any,
            });
            if (!acessora) {
                throw new NotFoundException('Acessora não encontrada');
            }
            if (!userHasSetor(acessora, ESetores.CUIDADO_DE_ALUNOS)) {
                throw new BadRequestException('A acessora da turma deve ser uma colaboradora do Cuidado de Alunos.');
            }
            // Se houver whitelist em Configurações, só aceita IDs da lista.
            const idsPermitidos = await this.configuracoesService.getAssessoresCuidadoAlunosIds();
            if (idsPermitidos.length > 0 && !idsPermitidos.includes(Number(idAcessora))) {
                throw new BadRequestException('Esta colaboradora não está na lista de Assessores do Cuidado de Alunos (Configurações).');
            }
        }

        turma.id_acessora = idAcessora ?? null;
        turma.atualizado_por = userId;
        turma.atualizado_em = new Date();
        await this.uow.turmasRP.save(turma);

        return {
            id_acessora: turma.id_acessora,
            acessora: acessora ? { id: acessora.id, nome: acessora.nome } : null,
        };
    }

    private async getTransferidosCountByTurmas(turmaIds: number[]): Promise<Record<number, number>> {
        if (!turmaIds.length) return {};

        const raw = await this.uow.historicoTransferenciasRP
            .createQueryBuilder('h')
            .select('h.id_turma_de', 'id_turma_de')
            .addSelect('COUNT(*)::int', 'total')
            .where('h.id_turma_de IN (:...turmaIds)', { turmaIds })
            .andWhere('h.id_turma_de <> h.id_turma_para')
            .andWhere('h.deletado_em IS NULL')
            .groupBy('h.id_turma_de')
            .getRawMany();

        const map: Record<number, number> = {};
        for (const row of raw) {
            const id = Number(row.id_turma_de);
            map[id] = Number(row.total || 0);
        }
        return map;
    }

    /**
     * Contadores para listagem de turmas sem carregar turmas_alunos (evita N×M linhas no findAll).
     */
    private async getContadoresListagemPorTurmas(turmaIds: number[]): Promise<
        Record<
            number,
            {
                alunos_total: number;
                alunos_inscricoes_extras: number;
                alunos_confirmados: number;
                vindos_transferencia: number;
                presentes: number;
                inadimplentes: number;
            }
        >
    > {
        if (!turmaIds.length) return {};

        const empty = () => ({
            alunos_total: 0,
            alunos_inscricoes_extras: 0,
            alunos_confirmados: 0,
            vindos_transferencia: 0,
            presentes: 0,
            inadimplentes: 0,
        });
        const result: Record<number, ReturnType<typeof empty>> = {};
        for (const id of turmaIds) {
            result[id] = empty();
        }

        const stConfirm = [EStatusAlunosTurmas.CHECKIN_REALIZADO, EStatusAlunosTurmas.AGUARDANDO_CHECKIN];

        const raw = await this.uow.turmasAlunosRP
            .createQueryBuilder('ta')
            .leftJoin('ta.id_aluno_fk', 'aluno')
            .where('ta.deletado_em IS NULL')
            .andWhere('ta.id_turma IN (:...ids)', { ids: turmaIds })
            .select('ta.id_turma', 'id_turma')
            .addSelect('COUNT(*)::int', 'total')
            .addSelect(
                // TRANSBORDO NÃO conta como extra: aluno de transbordo comprou ingresso (entra como venda/Demais Vendas).
                `SUM(CASE WHEN ta.vaga_bonus = true OR ta.origem_aluno IN (:...origensExtras) THEN 1 ELSE 0 END)::int`,
                'inscricoes_extras',
            )
            .addSelect(`SUM(CASE WHEN ta.id_turma_transferencia_para IS NULL AND ta.status_aluno_turma IN (:...stConfirm) THEN 1 ELSE 0 END)::int`, 'confirmados')
            .addSelect(`SUM(CASE WHEN ta.origem_aluno = :origemTr AND ta.id_turma_transferencia_de IS NOT NULL THEN 1 ELSE 0 END)::int`, 'vindos_transferencia')
            .addSelect(
                `SUM(CASE WHEN ta.presenca_turma = :pres AND (aluno.status_aluno_geral IS NULL OR aluno.status_aluno_geral <> :inad) THEN 1 ELSE 0 END)::int`,
                'presentes',
            )
            .addSelect(`SUM(CASE WHEN aluno.status_aluno_geral = :inad2 THEN 1 ELSE 0 END)::int`, 'inadimplentes')
            .setParameter('stConfirm', stConfirm)
            .setParameter('origensExtras', [EOrigemAlunos.ALUNO_BONUS, EOrigemAlunos.TRANSFERENCIA, EOrigemAlunos.SORTEIO, EOrigemAlunos.PRESENTE])
            .setParameter('origemTr', EOrigemAlunos.TRANSFERENCIA)
            .setParameter('pres', EPresencaTurmas.PRESENTE)
            .setParameter('inad', EStatusAlunosGeral.INADIMPLENTE)
            .setParameter('inad2', EStatusAlunosGeral.INADIMPLENTE)
            .groupBy('ta.id_turma')
            .getRawMany();

        for (const row of raw) {
            const id = Number(row.id_turma);
            result[id] = {
                alunos_total: Number(row.total ?? 0),
                alunos_inscricoes_extras: Number(row.inscricoes_extras ?? 0),
                alunos_confirmados: Number(row.confirmados ?? 0),
                vindos_transferencia: Number(row.vindos_transferencia ?? 0),
                presentes: Number(row.presentes ?? 0),
                inadimplentes: Number(row.inadimplentes ?? 0),
            };
        }

        return result;
    }

    /**
     * Formatar data para o formato YYYY-MM-DD (apenas data, sem hora)
     */
    private formatDateToDateOnly(dateString: string): string {
        if (!dateString) return dateString;

        // Se já está no formato YYYY-MM-DD, retornar como está
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
            return dateString;
        }

        // Tentar parsear a data e formatar
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) {
                return dateString; // Retornar original se inválida
            }
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        } catch (error) {
            console.error('Erro ao formatar data:', error);
            return dateString; // Retornar original em caso de erro
        }
    }

    /**
     * Verificar e atualizar automaticamente o status da turma para ENCERRADA
     * quando necessário (data atual > data_final OU (data atual >= data_inicio E expectativa_real >= capacidade_sala))
     */
    private async verificarEAtualizarStatusTurma(turma: any, opts?: { inscritosParaExpectativa?: number }): Promise<void> {
        try {
            // Turma reaberta manualmente após o fim do evento: respeitar a decisão do usuário e não
            // reencerrar automaticamente. Ela só volta a congelar quando for marcada ENCERRADA de novo.
            if (turma?.reaberta_manualmente) {
                return;
            }

            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);

            const dataInicio = new Date(turma.data_inicio);
            dataInicio.setHours(0, 0, 0, 0);

            const dataFinal = new Date(turma.data_final);
            dataFinal.setHours(23, 59, 59, 999);

            // Verificar se a data atual é maior ou igual à data de início (evento já começou)
            const eventoJaComecou = hoje >= dataInicio;

            // Verificar se a data atual é maior que a data final (evento já terminou)
            const eventoJaTerminou = hoje > dataFinal;

            // Se o evento ainda não começou, não encerrar (e se estiver encerrada, reabrir)
            if (!eventoJaComecou && !eventoJaTerminou) {
                if (turma.status_turma === EStatusTurmas.ENCERRADA) {
                    // Reabrir turma se foi encerrada incorretamente antes do evento começar
                    turma.status_turma = EStatusTurmas.INSCRICOES_ABERTAS;
                    turma.atualizado_em = new Date();
                    await this.uow.turmasRP.save(turma);
                    console.log(`✅ Turma ${turma.id} reaberta automaticamente. Evento ainda não começou (data_inicio: ${turma.data_inicio})`);
                }
                return;
            }

            // Se já está encerrada e o evento já começou/terminou, não precisa verificar mais
            if (turma.status_turma === EStatusTurmas.ENCERRADA) {
                return;
            }

            // Regra: a turma só é encerrada automaticamente quando chega a D+1 da data_final
            // (evento de fato terminou). Lotação/turma cheia NÃO encerra mais a turma — ela permanece
            // aberta até o D+1. (`eventoJaTerminou` = hoje 00:00 > data_final 23:59:59, ou seja, D+1.)
            if (eventoJaTerminou) {
                turma.status_turma = EStatusTurmas.ENCERRADA;
                turma.turma_aberta = false; // Desmarcar credenciamento quando encerrar
                turma.atualizado_em = new Date();
                await this.uow.turmasRP.save(turma);

                console.log(`✅ Turma ${turma.id} atualizada automaticamente para ENCERRADA. Motivo: Evento já terminou (D+1 da data_final)`);
            }
        } catch (error) {
            console.error(`Erro ao verificar status da turma ${turma.id}:`, error);
            // Não lançar erro para não interromper o fluxo principal
        }
    }

    /**
     * Atualiza e retorna o pico (máximo histórico) de inscritos e extras de uma turma.
     *
     * A meta é congelada sobre esses picos: transferências/remoções não reduzem a meta,
     * mas, quando inscritos/extras superam o pico anterior, o pico (e portanto a meta) sobe.
     */
    private async atualizarPicoMetricasTurma(
        turmaId: number,
        inscritosAtual: number,
        extrasAtual: number,
        picoInscritosArmazenado: number | null | undefined,
        picoExtrasArmazenado: number | null | undefined,
    ): Promise<{ meta_pico_inscritos: number; meta_pico_extras: number }> {
        const inscritosBase = Math.max(0, inscritosAtual || 0);
        const extrasBase = Math.max(0, extrasAtual || 0);
        const picoInscritosArmazenadoNorm = Math.max(0, picoInscritosArmazenado ?? 0);
        const picoExtrasArmazenadoNorm = Math.max(0, picoExtrasArmazenado ?? 0);

        const picoInscritosEfetivo = Math.max(inscritosBase, picoInscritosArmazenadoNorm);
        const picoExtrasEfetivo = Math.max(extrasBase, picoExtrasArmazenadoNorm);

        const precisaAtualizar =
            picoInscritosArmazenado == null ||
            picoExtrasArmazenado == null ||
            picoInscritosEfetivo !== picoInscritosArmazenadoNorm ||
            picoExtrasEfetivo !== picoExtrasArmazenadoNorm;

        if (precisaAtualizar) {
            try {
                await this.uow.turmasRP.update({ id: turmaId }, { meta_pico_inscritos: picoInscritosEfetivo, meta_pico_extras: picoExtrasEfetivo });
            } catch (error) {
                this.logger.warn(`Falha ao atualizar pico de métricas da turma=${turmaId}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
            }
        }

        return { meta_pico_inscritos: picoInscritosEfetivo, meta_pico_extras: picoExtrasEfetivo };
    }

    private formatDateToYyyyMmDd(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private normalizarTipoStatusSnapshot(tipo?: string): string {
        const tipoNormalizado = (tipo || 'inscritos').trim().toLowerCase();
        return TURMA_STATUS_TIPOS_SNAPSHOT.includes(tipoNormalizado) ? tipoNormalizado : 'inscritos';
    }

    private obterSnapshotMetricasTurma(id_turma: number) {
        return this.uow.turmasMetricasSnapshotRP.findOne({
            where: { id_turma, deletado_em: null },
        });
    }

    /**
     * Remove (hard delete) o snapshot de métricas de uma turma. É hard delete porque a coluna
     * id_turma possui constraint UNIQUE: um soft delete deixaria a linha e impediria a regeração
     * do snapshot quando a turma voltar a ser congelada.
     */
    private async removerSnapshotMetricasTurma(id_turma: number): Promise<boolean> {
        const resultado = await this.uow.turmasMetricasSnapshotRP.delete({ id_turma });
        const removido = (resultado.affected ?? 0) > 0;
        if (removido) {
            this.logger.log(`Snapshot de métricas removido (turma descongelada) turma=${id_turma}`);
        }
        return removido;
    }

    private async tentarCongelarTurmaSePassouDataFinal(id_turma: number): Promise<void> {
        const snapshot = await this.obterSnapshotMetricasTurma(id_turma);
        if (snapshot) {
            return;
        }

        const turma = await this.uow.turmasRP.findOne({
            where: { id: id_turma, deletado_em: null },
            relations: ['id_treinamento_fk'],
        });
        if (!turma) {
            return;
        }

        // Turma reaberta manualmente: não reencerrar nem gerar snapshot automaticamente.
        if (turma.reaberta_manualmente) {
            return;
        }

        const eventoJaTerminou = this.eventoTurmaTerminou(turma) === true;
        if (!eventoJaTerminou) {
            return;
        }

        // Auto-encerra a turma (se ainda não estiver) e só então congela o snapshot.
        await this.verificarEAtualizarStatusTurma(turma);
        if (this.isTurmaCongelada(turma)) {
            await this.salvarSnapshotMetricasTurma(id_turma);
        }
    }

    /**
     * Dispara o congelamento (geração de snapshot) em background, sem bloquear a resposta HTTP.
     * O congelamento de turmas grandes é pesado (recalcula resumo, listas por tipo e dispara a
     * auto-transferência por no-show aluno a aluno) e, rodando inline em um simples GET de leitura
     * (status-resumo / status-resumo/alunos), estourava o timeout de 30s do axios no frontend — e,
     * por a request ser cancelada antes do save, o snapshot nunca persistia, tornando todo GET lento.
     * A leitura passa a retornar os dados ao vivo (agregados) imediatamente; o snapshot é gerado em
     * segundo plano (e o cron noturno também cobre o congelamento). Um guard em memória evita disparos
     * duplicados concorrentes para a mesma turma.
     */
    private agendarCongelamentoEmBackground(id_turma: number): void {
        if (this.snapshotEmGeracaoBackground.has(id_turma)) {
            return;
        }
        this.snapshotEmGeracaoBackground.add(id_turma);
        void this.tentarCongelarTurmaSePassouDataFinal(id_turma)
            .catch((error) => {
                this.logger.error(`snapshot.turma.bg | Falha ao congelar turma=${id_turma} em background`, error instanceof Error ? error.stack : undefined);
            })
            .finally(() => {
                this.snapshotEmGeracaoBackground.delete(id_turma);
            });
    }

    /**
     * Regra de congelamento (D+1): ao congelar a turma, todo aluno que não teve a presença registrada
     * passa a NO_SHOW. Atualização em lote direta (sem efeitos colaterais por aluno) para que o snapshot
     * gerado em seguida já reflita os no-shows. Não altera quem já está PRESENTE ou já é NO_SHOW.
     * Retorna os IDs dos alunos da turma que foram marcados (para disparar regras pós-snapshot).
     */
    private async marcarNoShowAlunosSemPresenca(id_turma: number): Promise<string[]> {
        const resultado = await this.uow.turmasAlunosRP
            .createQueryBuilder()
            .update()
            .set({ presenca_turma: EPresencaTurmas.NO_SHOW })
            .where('id_turma = :id_turma', { id_turma })
            .andWhere('presenca_turma IS NULL')
            .andWhere('deletado_em IS NULL')
            .returning(['id'])
            .execute();
        const idsMarcados: string[] = ((resultado.raw as Array<{ id: string | number }>) || []).map((row) => String(row.id));
        if (idsMarcados.length > 0) {
            this.logger.log(`turma.snapshot.no_show | ${idsMarcados.length} aluno(s) sem presença marcados como NO_SHOW na turma=${id_turma}`);
        }
        return idsMarcados;
    }

    /**
     * Após o snapshot ser salvo, dispara a auto-transferência por no-show (IPR + compra de ingresso)
     * para os alunos marcados em massa. Roda DEPOIS do snapshot existir para evitar recursão de congelamento
     * (tentarCongelarTurmaSePassouDataFinal retorna cedo quando o snapshot já existe). A própria
     * tentarTransferenciaAutomaticaNoShowIPR re-valida origem/sigla/uma-única-vez por aluno.
     */
    private async dispararAutoTransferenciaNoShowPosCongelamento(idsTurmaAlunos: string[], userId?: number): Promise<void> {
        for (const id of idsTurmaAlunos) {
            try {
                await this.tentarTransferenciaAutomaticaNoShowIPR(id, userId);
            } catch (error) {
                this.logger.error(
                    `turma.snapshot.no_show.auto_transfer | Falha ao auto-transferir aluno_turma=${id}`,
                    error instanceof Error ? error.stack : undefined,
                );
            }
        }
    }

    private async salvarSnapshotMetricasTurma(id_turma: number, userId?: number): Promise<boolean> {
        const jaExiste = await this.obterSnapshotMetricasTurma(id_turma);
        if (jaExiste) {
            return false;
        }

        // Só congela (e marca no-show) turmas realmente congeladas (ENCERRADA + após D+1 da data_final).
        // Snapshots de turmas ainda abertas (ex.: congelamento em lote com incluirEmAndamento) não marcam no-show.
        const turma = await this.uow.turmasRP.findOne({
            where: { id: id_turma, deletado_em: null },
        });
        let idsMarcadosNoShow: string[] = [];
        if (turma && this.isTurmaCongelada(turma)) {
            idsMarcadosNoShow = await this.marcarNoShowAlunosSemPresenca(id_turma);
        }

        const resumo = await this.getTurmaStatusResumo(id_turma, { ignorarSnapshot: true });
        const alunosPorTipo: Record<string, TurmaStatusAlunosResponseDto> = {};

        for (const tipo of TURMA_STATUS_TIPOS_SNAPSHOT) {
            alunosPorTipo[tipo] = await this.getTurmaStatusAlunos(id_turma, tipo, { ignorarSnapshot: true });
        }

        const snapshotExistente = await this.obterSnapshotMetricasTurma(id_turma);
        if (snapshotExistente) {
            return;
        }

        const snapshot = this.uow.turmasMetricasSnapshotRP.create({
            id_turma,
            snapshot_em: new Date(),
            resumo: resumo as unknown as Record<string, unknown>,
            alunos_por_tipo: alunosPorTipo as unknown as Record<string, unknown>,
        });

        try {
            await this.uow.turmasMetricasSnapshotRP.save(snapshot);
            this.logger.log(`Snapshot de métricas salvo para turma=${id_turma}`);
        } catch (error: any) {
            const message = String(error?.message || '');
            if (message.includes('uq_turmas_metricas_snapshot_turma') || message.includes('duplicate key')) {
                this.logger.warn(`Snapshot de métricas já existia para turma=${id_turma}`);
                return false;
            }
            throw error;
        }

        // Snapshot salvo: agora é seguro disparar as auto-transferências por no-show (sem recursão).
        if (idsMarcadosNoShow.length > 0) {
            await this.dispararAutoTransferenciaNoShowPosCongelamento(idsMarcadosNoShow, userId);
        }
        return true;
    }

    async regerarSnapshotMetricasTurma(id_turma: number, userId?: number): Promise<{ id_turma: number; snapshot_em: Date; message: string }> {
        await this.validarPermissaoAdministrador(userId);

        const turma = await this.uow.turmasRP.findOne({
            where: { id: id_turma, deletado_em: null },
        });
        if (!turma) {
            throw new NotFoundException('Turma não encontrada');
        }

        const resumo = await this.getTurmaStatusResumo(id_turma, { ignorarSnapshot: true });
        const alunosPorTipo: Record<string, TurmaStatusAlunosResponseDto> = {};
        for (const tipo of TURMA_STATUS_TIPOS_SNAPSHOT) {
            alunosPorTipo[tipo] = await this.getTurmaStatusAlunos(id_turma, tipo, { ignorarSnapshot: true });
        }

        const snapshotExistente = await this.obterSnapshotMetricasTurma(id_turma);
        if (snapshotExistente) {
            snapshotExistente.snapshot_em = new Date();
            snapshotExistente.resumo = resumo as unknown as Record<string, unknown>;
            snapshotExistente.alunos_por_tipo = alunosPorTipo as unknown as Record<string, unknown>;
            snapshotExistente.atualizado_por = userId;
            const salvo = await this.uow.turmasMetricasSnapshotRP.save(snapshotExistente);
            return {
                id_turma,
                snapshot_em: salvo.snapshot_em,
                message: 'Snapshot da turma regerado com sucesso.',
            };
        }

        const snapshot = this.uow.turmasMetricasSnapshotRP.create({
            id_turma,
            snapshot_em: new Date(),
            resumo: resumo as unknown as Record<string, unknown>,
            alunos_por_tipo: alunosPorTipo as unknown as Record<string, unknown>,
            criado_por: userId,
            atualizado_por: userId,
        });
        const salvo = await this.uow.turmasMetricasSnapshotRP.save(snapshot);
        return {
            id_turma,
            snapshot_em: salvo.snapshot_em,
            message: 'Snapshot da turma criado com sucesso.',
        };
    }

    private async congelarMetricasTurmasFinalizadas(): Promise<void> {
        const hoje = this.formatDateToYyyyMmDd(new Date());
        const turmasFinalizadas = await this.uow.turmasRP
            .createQueryBuilder('turma')
            .leftJoinAndSelect('turma.id_treinamento_fk', 'treinamento')
            .where('turma.deletado_em IS NULL')
            .andWhere('turma.status_turma = :statusEncerrada', { statusEncerrada: EStatusTurmas.ENCERRADA })
            .andWhere('turma.data_final < :hoje', { hoje })
            .getMany();

        for (const turma of turmasFinalizadas) {
            await this.salvarSnapshotMetricasTurma(turma.id);
        }
    }

    async congelarSnapshotsTurmasEmLote(
        userId?: number,
        opts?: { incluirEmAndamento?: boolean; forcarRegeracao?: boolean },
    ): Promise<{
        total_turmas: number;
        snapshots_criados: number;
        snapshots_regerados: number;
        snapshots_ja_existentes: number;
        message: string;
    }> {
        await this.validarPermissaoAdministrador(userId);

        const incluirEmAndamento = opts?.incluirEmAndamento === true;
        const forcarRegeracao = opts?.forcarRegeracao === true;
        const hoje = this.formatDateToYyyyMmDd(new Date());

        const qb = this.uow.turmasRP.createQueryBuilder('turma').where('turma.deletado_em IS NULL');
        if (!incluirEmAndamento) {
            qb.andWhere('turma.status_turma = :statusEncerrada', { statusEncerrada: EStatusTurmas.ENCERRADA });
            qb.andWhere('turma.data_final < :hoje', { hoje });
        }

        const turmas = await qb.orderBy('turma.id', 'ASC').getMany();

        let snapshotsCriados = 0;
        let snapshotsRegerados = 0;
        let snapshotsJaExistentes = 0;

        for (const turma of turmas) {
            const snapshotExistente = await this.obterSnapshotMetricasTurma(turma.id);

            if (forcarRegeracao && snapshotExistente) {
                await this.regerarSnapshotMetricasTurma(turma.id, userId);
                snapshotsRegerados++;
                continue;
            }

            const criado = await this.salvarSnapshotMetricasTurma(turma.id, userId);
            if (criado) {
                snapshotsCriados++;
            } else {
                snapshotsJaExistentes++;
            }
        }

        const escopo = incluirEmAndamento ? 'todas as turmas' : 'turmas finalizadas';
        return {
            total_turmas: turmas.length,
            snapshots_criados: snapshotsCriados,
            snapshots_regerados: snapshotsRegerados,
            snapshots_ja_existentes: snapshotsJaExistentes,
            message: `Congelamento em lote concluído para ${escopo}.`,
        };
    }

    private async tentarTransferenciaAutomaticaNoShowIPR(id_turma_aluno: string, userId?: number): Promise<void> {
        const turmaAluno = await this.uow.turmasAlunosRP.findOne({
            where: { id: id_turma_aluno, deletado_em: null },
            relations: ['id_turma_fk', 'id_turma_fk.id_treinamento_fk', 'id_turma_fk.id_polo_fk', 'id_aluno_fk'],
        });

        if (!turmaAluno || !turmaAluno.id_turma_fk || !turmaAluno.id_aluno_fk) {
            return;
        }

        if (turmaAluno.presenca_turma !== EPresencaTurmas.NO_SHOW) {
            return;
        }

        if (turmaAluno.origem_aluno !== EOrigemAlunos.COMPROU_INGRESSO) {
            return;
        }

        const turmaOrigem = turmaAluno.id_turma_fk;
        const siglaTreinamento = String(turmaOrigem.id_treinamento_fk?.sigla_treinamento || '')
            .trim()
            .toUpperCase();
        if (siglaTreinamento !== 'IPR') {
            return;
        }

        const houveTransferenciaNaTurmaAtual =
            turmaAluno.id_turma_transferencia_de != null ||
            turmaAluno.id_turma_transferencia_para != null ||
            (await this.uow.historicoTransferenciasRP.count({
                where: [
                    { id_aluno: Number(turmaAluno.id_aluno), id_turma_de: turmaOrigem.id, deletado_em: null },
                    { id_aluno: Number(turmaAluno.id_aluno), id_turma_para: turmaOrigem.id, deletado_em: null },
                ],
            })) > 0;

        if (houveTransferenciaNaTurmaAtual) {
            return;
        }

        const jaTeveTransferenciaAutomaticaNoShow = await this.uow.historicoAlunosTurmasLogsRP.count({
            where: {
                id_aluno: turmaAluno.id_aluno as any,
                template_key: TEMPLATE_AUTO_TRANSFERENCIA_NO_SHOW_IPR,
                deletado_em: null,
            },
        });

        if (jaTeveTransferenciaAutomaticaNoShow > 0) {
            this.logger.log(`turma.aluno.no_show.auto_transfer | Aluno=${turmaAluno.id_aluno} já teve auto transferência por no-show IPR`);
            return;
        }

        const turmasMesmaTrilha = await this.uow.turmasRP.find({
            where: {
                id: Not(turmaOrigem.id),
                id_treinamento: turmaOrigem.id_treinamento,
                id_polo: turmaOrigem.id_polo,
                deletado_em: null,
            },
            relations: ['id_treinamento_fk', 'id_polo_fk'],
            order: { data_inicio: 'ASC' },
        });

        const proximaTurmaMesmoPolo = turmasMesmaTrilha.find((turmaDestino) => {
            if (this.isTurmaBloqueadaParaTransferencia(turmaDestino)) return false;
            if (turmaDestino.status_turma === EStatusTurmas.INSCRICOES_PAUSADAS) return false;
            return String(turmaDestino.data_inicio || '') > String(turmaOrigem.data_final || '');
        });

        if (!proximaTurmaMesmoPolo) {
            this.logger.log(`turma.aluno.no_show.auto_transfer | Sem próxima turma IPR para aluno=${turmaAluno.id_aluno} turma_origem=${turmaOrigem.id}`);
            return;
        }

        await this.tentarCongelarTurmaSePassouDataFinal(turmaOrigem.id);

        // No-show de ingresso comprado: o aluno NÃO sai da turma de origem, apenas é replicado para o destino.
        // `transferidoPorRobo` marca a matrícula de destino para exibir a tag "Transferido por robô".
        const matriculaDestino = await this.transferirAluno(turmaAluno.id, proximaTurmaMesmoPolo.id, userId, {
            manterNaOrigem: true,
            transferidoPorRobo: true,
        });

        const descricaoRobo = `Aluno transferido automaticamente pelo robô para a próxima turma do mesmo polo após no-show em IPR (turma de origem congelada).`;

        await this.registrarLogAlunoTurma(
            {
                id_turma_aluno: turmaAluno.id,
                id_turma: turmaOrigem.id,
                id_aluno: turmaAluno.id_aluno,
                tipo_acao: 'TRANSFERENCIA',
                titulo: 'Transferido por robô (no-show IPR)',
                descricao: descricaoRobo,
                template_key: TEMPLATE_AUTO_TRANSFERENCIA_NO_SHOW_IPR,
                detalhes: {
                    regra: 'IPR_NO_SHOW_COMPRA_INGRESSO_UMA_VEZ',
                    transferido_por_robo: true,
                    id_turma_origem: turmaOrigem.id,
                    id_turma_destino: proximaTurmaMesmoPolo.id,
                    id_polo: turmaOrigem.id_polo,
                    id_treinamento: turmaOrigem.id_treinamento,
                },
            },
            userId,
        );

        // Também registra na matrícula de DESTINO, para a informação aparecer no histórico do
        // aluno na turma onde ele passa a constar (e ficar fácil de visualizar).
        if (matriculaDestino?.id) {
            await this.registrarLogAlunoTurma(
                {
                    id_turma_aluno: matriculaDestino.id,
                    id_turma: proximaTurmaMesmoPolo.id,
                    id_aluno: turmaAluno.id_aluno,
                    tipo_acao: 'TRANSFERENCIA',
                    titulo: 'Transferido por robô (no-show IPR)',
                    descricao: descricaoRobo,
                    template_key: TEMPLATE_AUTO_TRANSFERENCIA_NO_SHOW_IPR,
                    detalhes: {
                        regra: 'IPR_NO_SHOW_COMPRA_INGRESSO_UMA_VEZ',
                        transferido_por_robo: true,
                        id_turma_origem: turmaOrigem.id,
                        id_turma_destino: proximaTurmaMesmoPolo.id,
                        id_polo: turmaOrigem.id_polo,
                        id_treinamento: turmaOrigem.id_treinamento,
                    },
                },
                userId,
            );
        }

        this.logger.log(
            `turma.aluno.no_show.auto_transfer | Transferência automática concluída aluno=${turmaAluno.id_aluno} origem=${turmaOrigem.id} destino=${proximaTurmaMesmoPolo.id}`,
        );
    }

    @Cron('15 1 * * *')
    async congelarMetricasTurmasFinalizadasCron(): Promise<void> {
        if (this.congelamentoMetricasCronEmExecucao) {
            this.logger.warn('snapshot.turma.cron | Execução anterior ainda em andamento, pulando ciclo');
            return;
        }

        this.congelamentoMetricasCronEmExecucao = true;
        try {
            await this.congelarMetricasTurmasFinalizadas();
            this.logger.log('snapshot.turma.cron | Rotina de congelamento executada com sucesso');
        } catch (error) {
            this.logger.error('snapshot.turma.cron | Erro ao executar rotina de congelamento', error instanceof Error ? error.stack : undefined);
        } finally {
            this.congelamentoMetricasCronEmExecucao = false;
        }
    }

    @Cron('30 1 * * *')
    async sincronizarPeriodosMentoriaCron(): Promise<void> {
        if (this.periodosMentoriaCronEmExecucao) {
            this.logger.warn('mentoria.periodos.cron | Execução anterior ainda em andamento, pulando ciclo');
            return;
        }

        this.periodosMentoriaCronEmExecucao = true;
        try {
            const resultado = await this.sincronizarPeriodosMentoria();
            this.logger.log(
                `mentoria.periodos.cron | Datas preenchidas: ${resultado.datasPreenchidas} | Mentorados encerrados (soft delete): ${resultado.matriculasEncerradas}`,
            );
        } catch (error) {
            this.logger.error('mentoria.periodos.cron | Erro ao sincronizar períodos de mentoria', error instanceof Error ? error.stack : undefined);
        } finally {
            this.periodosMentoriaCronEmExecucao = false;
        }
    }

    /**
     * Regras de mentoria por mentorado:
     * 1) data_inicio_mentoria = data de criação do aluno na turma (turmas_alunos.criado_em);
     * 2) data_fim_mentoria = data_inicio_mentoria + duração (em meses) configurada no treinamento;
     * 3) ao atingir D+1 da data de encerramento, a matrícula do mentorado sofre soft delete.
     * É idempotente: só preenche datas faltantes e só encerra matrículas vencidas ainda ativas.
     */
    async sincronizarPeriodosMentoria(): Promise<{ datasPreenchidas: number; matriculasEncerradas: number }> {
        // Duração efetiva (em meses) considerando as regras fixas por produto
        // (Liberty = 12, Liberty Begin = 6) e, para os demais, a duração configurada.
        const duracaoMesesSql = sqlDuracaoMentoriaMeses('tr.treinamento', 'tr.duracao_meses');

        // 1) Preenche início (created_at) e fim (início + duração) para linhas de mentoria sem data definida.
        const updateDatas = await this.uow.turmasAlunosTreinamentosRP.query(`
            UPDATE turmas_alunos_treinamentos AS tat
            SET data_inicio_mentoria = ta.criado_em::date,
                data_fim_mentoria = (ta.criado_em::date + ((${duracaoMesesSql}) || ' months')::interval)::date
            FROM turmas_alunos AS ta, treinamentos AS tr
            WHERE tat.id_turma_aluno = ta.id
              AND tat.id_treinamento = tr.id
              AND tr.tipo_mentoria = true
              AND ta.deletado_em IS NULL
              AND tat.data_inicio_mentoria IS NULL
            RETURNING tat.id
        `);

        // 2a) Encerra (soft delete) mentorados matriculados diretamente em turmas de mentoria,
        // usando a regra padrão (created_at + duração do treinamento), ao passar de D+1.
        const updateEncerramentoTurma = await this.uow.turmasAlunosRP.query(`
            UPDATE turmas_alunos AS ta
            SET deletado_em = now()
            FROM turmas AS t, treinamentos AS tr
            WHERE ta.id_turma = t.id
              AND t.id_treinamento = tr.id
              AND tr.tipo_mentoria = true
              AND CURRENT_DATE > (ta.criado_em::date + ((${duracaoMesesSql}) || ' months')::interval)::date
              AND ta.deletado_em IS NULL
            RETURNING ta.id
        `);

        // 2b) Encerra mentorados cujo período veio de um contrato (turmas_alunos_treinamentos) com data explícita.
        const updateEncerramentoContrato = await this.uow.turmasAlunosRP.query(`
            UPDATE turmas_alunos AS ta
            SET deletado_em = now()
            FROM turmas_alunos_treinamentos AS tat, treinamentos AS tr
            WHERE tat.id_turma_aluno = ta.id
              AND tat.id_treinamento = tr.id
              AND tr.tipo_mentoria = true
              AND tat.data_fim_mentoria IS NOT NULL
              AND CURRENT_DATE > tat.data_fim_mentoria
              AND ta.deletado_em IS NULL
            RETURNING ta.id
        `);

        const contarLinhas = (resultado: unknown): number => (Array.isArray(resultado) ? resultado.length : 0);

        return {
            datasPreenchidas: contarLinhas(updateDatas),
            matriculasEncerradas: contarLinhas(updateEncerramentoTurma) + contarLinhas(updateEncerramentoContrato),
        };
    }

    /**
     * Buscar contadores de pré-cadastrados por turmas
     */
    private async getPreCadastrosCountByTurmas(turmasIds: number[]): Promise<Record<number, { total: number; presentes: number }>> {
        if (!turmasIds.length) return {};

        try {
            console.log(`🔍 [getPreCadastrosCountByTurmas] Buscando pré-cadastros para turmas:`, turmasIds);

            const preCadastros = await this.uow.masterclassPreCadastrosRP.find({
                where: {
                    id_turma: In(turmasIds),
                    deletado_em: null,
                },
            });

            console.log(`📊 [getPreCadastrosCountByTurmas] Total de pré-cadastros encontrados: ${preCadastros.length}`);

            const counts: Record<number, { total: number; presentes: number }> = {};

            preCadastros.forEach((pc) => {
                if (!counts[pc.id_turma]) {
                    counts[pc.id_turma] = { total: 0, presentes: 0 };
                }
                counts[pc.id_turma].total++;
                if (pc.presente) {
                    counts[pc.id_turma].presentes++;
                }
            });

            console.log(`✅ [getPreCadastrosCountByTurmas] Contadores por turma:`, counts);

            return counts;
        } catch (error) {
            console.error('❌ [getPreCadastrosCountByTurmas] Erro ao buscar contadores de pré-cadastrados:', error);
            return {};
        }
    }

    /**
     * Buscar usuários líderes para seleção em turmas
     */
    async getUsuariosLideres(): Promise<{ id: number; nome: string; email: string; cpf: string | null; telefone: string; funcao: string[] }[]> {
        try {
            // Usando query builder para trabalhar com arrays do PostgreSQL
            const usuarios = await this.uow.usuariosRP
                .createQueryBuilder('usuario')
                .where('usuario.funcao && :funcoes', { funcoes: [EFuncoes.LIDER, EFuncoes.LIDER_DE_EVENTOS, EFuncoes.ADMINISTRADOR] })
                .andWhere('usuario.deletado_em IS NULL')
                .select(['usuario.id', 'usuario.nome', 'usuario.email', 'usuario.cpf', 'usuario.telefone', 'usuario.funcao'])
                .getMany();

            return usuarios.map((usuario) => ({
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                cpf: usuario.cpf,
                telefone: usuario.telefone,
                funcao: usuario.funcao,
            }));
        } catch (error) {
            console.error('Erro ao buscar usuários líderes:', error);
            throw new BadRequestException('Erro ao buscar usuários líderes');
        }
    }

    private async getTurmaPresencialParaTimes(id_turma: number): Promise<any> {
        const turma = await this.uow.turmasRP.findOne({
            where: { id: id_turma, deletado_em: null },
            relations: ['id_treinamento_fk'],
        });

        if (!turma) {
            throw new NotFoundException('Turma não encontrada');
        }

        const treinamento = turma.id_treinamento_fk;
        const isPalestra = treinamento?.tipo_palestra === true || treinamento?.tipo_treinamento === false;
        const isOnline = treinamento?.tipo_online === true;

        if (isPalestra || isOnline) {
            throw new BadRequestException('Times só podem ser configurados para treinamentos presenciais');
        }

        return turma;
    }

    async getTimesTurma(id_turma: number): Promise<TurmaTimesResponseDto> {
        const turma = await this.getTurmaPresencialParaTimes(id_turma);
        return {
            id_turma: turma.id,
            times_equipes: turma.times_equipes || [],
        };
    }

    async updateTimesTurma(id_turma: number, dto: UpdateTurmaTimesDto, atualizado_por?: number): Promise<TurmaTimesResponseDto> {
        const turma = await this.getTurmaPresencialParaTimes(id_turma);
        const payload = Array.isArray(dto?.times_equipes) ? dto.times_equipes : [];

        turma.times_equipes = payload;
        turma.atualizado_por = atualizado_por;
        turma.atualizado_em = new Date();

        await this.uow.turmasRP.save(turma);

        // Times IPR mudam o vínculo membro→líder: recalcula hist_staff_lider_id em background.
        void this.documentosService.recalcularHistStaffLiderContratos().catch((error) => {
            this.logger.warn(`historico.staffLider.recalc | falha após updateTimesTurma: ${error instanceof Error ? error.message : String(error)}`);
        });

        return {
            id_turma: turma.id,
            times_equipes: turma.times_equipes || [],
        };
    }

    async findAll(filters: GetTurmasDto): Promise<TurmasListResponseDto> {
        const {
            page = 1,
            limit = 10,
            edicao_turma,
            status_turma,
            id_polo,
            id_treinamento,
            id_empresa,
            tipo_treinamento,
            data_inicio,
            data_final,
            turma_aberta,
        } = filters;

        try {
            const queryBuilder = this.uow.turmasRP
                .createQueryBuilder('turma')
                .leftJoinAndSelect('turma.id_polo_fk', 'polo', 'polo.deletado_em IS NULL')
                .leftJoinAndSelect('turma.id_treinamento_fk', 'treinamento', 'treinamento.deletado_em IS NULL')
                .leftJoinAndSelect('treinamento.id_empresa_fk', 'empresa', 'empresa.deletado_em IS NULL')
                .leftJoinAndSelect('turma.lider_evento_fk', 'lider', 'lider.deletado_em IS NULL')
                .leftJoinAndSelect('turma.id_acessora_fk', 'acessora', 'acessora.deletado_em IS NULL')
                .where('turma.deletado_em IS NULL');

            // Aplicar filtros básicos
            if (edicao_turma) {
                queryBuilder.andWhere('turma.edicao_turma ILIKE :edicao_turma', { edicao_turma: `%${edicao_turma}%` });
            }

            if (status_turma) {
                queryBuilder.andWhere('turma.status_turma = :status_turma', { status_turma });
            }

            if (id_polo) {
                queryBuilder.andWhere('turma.id_polo = :id_polo', { id_polo });
            }

            if (id_treinamento) {
                queryBuilder.andWhere('turma.id_treinamento = :id_treinamento', { id_treinamento });
            }

            // Visualização por empresa (seletor global): aplicado NA QUERY antes
            // da paginação, pelo vínculo treinamento→empresa do cadastro.
            if (id_empresa) {
                queryBuilder.andWhere('treinamento.id_empresa = :id_empresa', { id_empresa });
            }

            // Filtro do credenciamento: só turmas habilitadas, aplicado na query
            // para não perder turmas abertas antigas por criado_em após o limit.
            if (turma_aberta === true) {
                queryBuilder.andWhere('turma.turma_aberta = true');
            }

            // Filtrar por tipo de treinamento NA QUERY (antes da paginação): com o
            // volume de masterclasses sincronizadas, as turmas mais recentes por
            // criado_em são quase todas palestras e o filtro em memória (após o
            // limit) devolvia 0 turmas para as abas Treinamentos/Mentorias.
            if (tipo_treinamento === 'palestra') {
                queryBuilder.andWhere('treinamento.tipo_palestra = true');
            } else if (tipo_treinamento === 'mentoria') {
                queryBuilder.andWhere('treinamento.tipo_mentoria = true');
            } else if (tipo_treinamento === 'treinamento') {
                // Mentorias saem da aba de treinamentos e ficam na aba própria.
                queryBuilder.andWhere('treinamento.tipo_treinamento = true');
                queryBuilder.andWhere('(treinamento.tipo_mentoria IS NULL OR treinamento.tipo_mentoria = false)');
            }

            // Aplicar filtros de data
            // Buscar turmas que tenham sobreposição com o intervalo especificado
            // Uma turma está no intervalo se: data_inicio_turma <= data_final_filtro E data_final_turma >= data_inicio_filtro
            if (data_inicio && data_final) {
                queryBuilder.andWhere('turma.data_inicio <= :data_final', { data_final });
                queryBuilder.andWhere('turma.data_final >= :data_inicio', { data_inicio });
            } else if (data_inicio) {
                // Apenas data início: buscar turmas que terminem depois ou na data inicial
                queryBuilder.andWhere('turma.data_final >= :data_inicio', { data_inicio });
            } else if (data_final) {
                // Apenas data final: buscar turmas que comecem antes ou na data final
                queryBuilder.andWhere('turma.data_inicio <= :data_final', { data_final });
            }

            queryBuilder.orderBy('turma.criado_em', 'DESC');
            queryBuilder.skip((page - 1) * limit);
            queryBuilder.take(limit);

            const [turmas, total] = await queryBuilder.getManyAndCount();

            const turmasFiltradas = turmas;

            const idsListagem = turmasFiltradas.map((t) => t.id);

            const turmasPalestrasIds = turmasFiltradas
                .filter((t) => t.id_treinamento_fk?.tipo_palestra === true || t.id_treinamento_fk?.tipo_treinamento === false)
                .map((t) => t.id);

            const [preCadastrosCount, contadoresListagem, transferidosCountByTurma] = await Promise.all([
                this.getPreCadastrosCountByTurmas(turmasPalestrasIds),
                this.getContadoresListagemPorTurmas(idsListagem),
                this.getTransferidosCountByTurmas(idsListagem),
            ]);

            // Verificar e atualizar status das turmas automaticamente (usa contagens agregadas, sem carregar alunos)
            const picosPorTurma: Record<number, { meta_pico_inscritos: number; meta_pico_extras: number }> = {};
            for (const turma of turmasFiltradas) {
                const isPalestra = turma.id_treinamento_fk?.tipo_palestra === true || turma.id_treinamento_fk?.tipo_treinamento === false;
                const inscritosParaExpectativa = isPalestra ? (preCadastrosCount[turma.id]?.total ?? 0) : (contadoresListagem[turma.id]?.alunos_total ?? 0);
                await this.verificarEAtualizarStatusTurma(turma, { inscritosParaExpectativa });

                const inscritosCount = isPalestra ? (preCadastrosCount[turma.id]?.total ?? 0) : (contadoresListagem[turma.id]?.alunos_total ?? 0);
                const extrasCount = contadoresListagem[turma.id]?.alunos_inscricoes_extras ?? 0;
                picosPorTurma[turma.id] = await this.atualizarPicoMetricasTurma(
                    turma.id,
                    inscritosCount,
                    extrasCount,
                    turma.meta_pico_inscritos,
                    turma.meta_pico_extras,
                );
            }

            // Transformar dados para o formato de resposta
            const turmasResponse: TurmaResponseDto[] = turmasFiltradas.map((turma) => {
                const m = contadoresListagem[turma.id];
                const isPalestra = turma.id_treinamento_fk?.tipo_palestra === true || turma.id_treinamento_fk?.tipo_treinamento === false;

                return {
                    id: turma.id,
                    id_polo: turma.id_polo,
                    id_treinamento: turma.id_treinamento,
                    lider_evento: turma.lider_evento,
                    edicao_turma: turma.edicao_turma,
                    referencia_externa: turma.referencia_externa ?? null,
                    status_evento: turma.status_evento,
                    cep: turma.cep,
                    logradouro: turma.logradouro,
                    complemento: turma.complemento,
                    numero: turma.numero,
                    bairro: turma.bairro,
                    cidade: turma.cidade,
                    estado: turma.estado,
                    status_turma: turma.status_turma,
                    autorizar_bonus: turma.autorizar_bonus,
                    id_turma_bonus: turma.id_turma_bonus,
                    capacidade_turma: turma.capacidade_turma,
                    meta: turma.meta,
                    data_inicio: turma.data_inicio,
                    data_final: turma.data_final,
                    turma_aberta: turma.turma_aberta,
                    bonus_treinamentos: turma.detalhamento_bonus?.map((item) => item.id_treinamento_db) || [],
                    detalhamento_bonus: turma.detalhamento_bonus,
                    turmas_imersao_ofertadas: turma.turmas_imersao_ofertadas || [],
                    turmas_ipr_relacionadas: turma.turmas_ipr_relacionadas || [],
                    times_equipes: turma.times_equipes || [],
                    url_midia_kit: turma.url_midia_kit,
                    url_grupo_whatsapp: turma.url_grupo_whatsapp,
                    url_grupo_whatsapp_2: turma.url_grupo_whatsapp_2,
                    url_pagamento_cartao: turma.url_pagamento_cartao,
                    created_at: turma.criado_em,
                    updated_at: turma.atualizado_em,
                    polo: turma.id_polo_fk
                        ? {
                              id: turma.id_polo_fk.id,
                              nome: turma.id_polo_fk.polo,
                              sigla_polo: turma.id_polo_fk.sigla_polo,
                              cidade: turma.id_polo_fk.cidade,
                              estado: turma.id_polo_fk.estado,
                          }
                        : undefined,
                    treinamento: turma.id_treinamento_fk
                        ? {
                              id: turma.id_treinamento_fk.id,
                              nome: turma.id_treinamento_fk.treinamento,
                              tipo: turma.id_treinamento_fk.tipo_treinamento ? 'treinamento' : 'palestra',
                              tipo_mentoria: turma.id_treinamento_fk.tipo_mentoria === true,
                              sigla_treinamento: turma.id_treinamento_fk.sigla_treinamento,
                              treinamento: turma.id_treinamento_fk.treinamento,
                              duracao_meses: turma.id_treinamento_fk.duracao_meses ?? null,
                              url_logo_treinamento: turma.id_treinamento_fk.url_logo_treinamento,
                              tipo_online: turma.id_treinamento_fk.tipo_online,
                              id_empresa: turma.id_treinamento_fk.id_empresa ?? null,
                              empresa_nome: turma.id_treinamento_fk.id_empresa_fk?.nome ?? null,
                          }
                        : undefined,
                    lider: turma.lider_evento_fk
                        ? {
                              id: turma.lider_evento_fk.id,
                              nome: turma.lider_evento_fk.nome,
                          }
                        : undefined,
                    id_acessora: turma.id_acessora ?? null,
                    acessora: turma.id_acessora_fk
                        ? {
                              id: turma.id_acessora_fk.id,
                              nome: turma.id_acessora_fk.nome,
                          }
                        : null,
                    meta_pico_inscritos: picosPorTurma[turma.id]?.meta_pico_inscritos ?? null,
                    meta_pico_extras: picosPorTurma[turma.id]?.meta_pico_extras ?? null,
                    // Para palestras/masterclass, alunos_count = pré-cadastrados; para treinamentos, contagens agregadas
                    alunos_count: isPalestra ? preCadastrosCount[turma.id]?.total || 0 : m?.alunos_total || 0,
                    alunos_inscricoes_extras_count: m?.alunos_inscricoes_extras || 0,
                    alunos_confirmados_count: m?.alunos_confirmados || 0,
                    transferidos_count: transferidosCountByTurma[turma.id] || 0,
                    vindos_transferencia_count: m?.vindos_transferencia || 0,
                    pre_cadastrados_count: preCadastrosCount[turma.id]?.total || 0,
                    presentes_count: m?.presentes || 0,
                    inadimplentes_count: m?.inadimplentes || 0,
                };
            });

            return {
                data: turmasResponse,
                total: turmasFiltradas.length,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            };
        } catch (error) {
            console.error('Erro ao buscar turmas:', error);
            throw new BadRequestException('Erro ao buscar turmas');
        }
    }

    async findById(id: number): Promise<TurmaResponseDto | null> {
        try {
            const turma = await this.uow.turmasRP.findOne({
                where: { id, deletado_em: null },
                relations: ['id_polo_fk', 'id_treinamento_fk', 'id_treinamento_fk.id_empresa_fk', 'lider_evento_fk', 'id_acessora_fk'],
            });

            if (!turma) {
                return null;
            }

            // Buscar contadores de pré-cadastrados apenas se for palestra/masterclass
            const isPalestra = turma.id_treinamento_fk?.tipo_palestra === true || turma.id_treinamento_fk?.tipo_treinamento === false;
            const preCadastrosCount = isPalestra ? await this.getPreCadastrosCountByTurmas([turma.id]) : {};
            const [transferidosCountByTurma, metricasAlunos] = await Promise.all([
                this.getTransferidosCountByTurmas([turma.id]),
                isPalestra ? Promise.resolve(null) : this.contarMetricasAlunosDaTurma(turma.id),
            ]);

            const alunosCountCalc = isPalestra ? preCadastrosCount[turma.id]?.total || 0 : metricasAlunos?.alunos_count || 0;
            const extrasCountCalc = isPalestra ? 0 : metricasAlunos?.extras_count || 0;
            const picos = await this.atualizarPicoMetricasTurma(turma.id, alunosCountCalc, extrasCountCalc, turma.meta_pico_inscritos, turma.meta_pico_extras);

            return {
                id: turma.id,
                id_polo: turma.id_polo,
                id_treinamento: turma.id_treinamento,
                lider_evento: turma.lider_evento,
                edicao_turma: turma.edicao_turma,
                id_endereco_evento: turma.id_endereco_evento,
                cep: turma.cep,
                logradouro: turma.logradouro,
                complemento: turma.complemento,
                numero: turma.numero,
                bairro: turma.bairro,
                cidade: turma.cidade,
                estado: turma.estado,
                status_turma: turma.status_turma,
                autorizar_bonus: turma.autorizar_bonus,
                id_turma_bonus: turma.id_turma_bonus,
                capacidade_turma: turma.capacidade_turma,
                meta: turma.meta,
                meta_pico_inscritos: picos.meta_pico_inscritos,
                meta_pico_extras: picos.meta_pico_extras,
                data_inicio: turma.data_inicio,
                data_final: turma.data_final,
                turma_aberta: turma.turma_aberta,
                bonus_treinamentos: turma.detalhamento_bonus?.map((item) => item.id_treinamento_db) || [],
                detalhamento_bonus: turma.detalhamento_bonus,
                turmas_imersao_ofertadas: turma.turmas_imersao_ofertadas || [],
                turmas_ipr_relacionadas: turma.turmas_ipr_relacionadas || [],
                times_equipes: turma.times_equipes || [],
                url_midia_kit: turma.url_midia_kit,
                url_grupo_whatsapp: turma.url_grupo_whatsapp,
                url_grupo_whatsapp_2: turma.url_grupo_whatsapp_2,
                url_pagamento_cartao: turma.url_pagamento_cartao,
                created_at: turma.criado_em,
                updated_at: turma.atualizado_em,
                polo: turma.id_polo_fk
                    ? {
                          id: turma.id_polo_fk.id,
                          nome: turma.id_polo_fk.polo,
                          cidade: turma.id_polo_fk.cidade,
                          estado: turma.id_polo_fk.estado,
                      }
                    : undefined,
                treinamento: turma.id_treinamento_fk
                    ? {
                          id: turma.id_treinamento_fk.id,
                          nome: turma.id_treinamento_fk.treinamento,
                          tipo: turma.id_treinamento_fk.tipo_treinamento ? 'treinamento' : 'palestra',
                          tipo_mentoria: turma.id_treinamento_fk.tipo_mentoria === true,
                          sigla_treinamento: turma.id_treinamento_fk.sigla_treinamento,
                          treinamento: turma.id_treinamento_fk.treinamento,
                          duracao_meses: turma.id_treinamento_fk.duracao_meses ?? null,
                          url_logo_treinamento: turma.id_treinamento_fk.url_logo_treinamento,
                          tipo_online: turma.id_treinamento_fk.tipo_online,
                          id_empresa: turma.id_treinamento_fk.id_empresa ?? null,
                          empresa_nome: turma.id_treinamento_fk.id_empresa_fk?.nome ?? null,
                      }
                    : undefined,
                lider: turma.lider_evento_fk
                    ? {
                          id: turma.lider_evento_fk.id,
                          nome: turma.lider_evento_fk.nome,
                      }
                    : undefined,
                id_acessora: turma.id_acessora ?? null,
                acessora: turma.id_acessora_fk
                    ? {
                          id: turma.id_acessora_fk.id,
                          nome: turma.id_acessora_fk.nome,
                      }
                    : null,
                // Para palestras/masterclass, alunos_count = pré-cadastrados; para treinamentos, alunos_count = alunos
                alunos_count: alunosCountCalc,
                alunos_inscricoes_extras_count: extrasCountCalc,
                alunos_confirmados_count: isPalestra ? 0 : metricasAlunos?.confirmados_count || 0,
                transferidos_count: transferidosCountByTurma[turma.id] || 0,
                vindos_transferencia_count: isPalestra ? 0 : metricasAlunos?.vindos_transferencia_count || 0,
                pre_cadastrados_count: preCadastrosCount[turma.id]?.total || 0,
                presentes_count: isPalestra ? 0 : metricasAlunos?.presentes_count || 0,
                inadimplentes_count: isPalestra ? 0 : metricasAlunos?.inadimplentes_count || 0,
            };
        } catch (error) {
            console.error('Erro ao buscar turma por ID:', error);
            throw new BadRequestException('Erro ao buscar turma');
        }
    }

    async create(createTurmaDto: CreateTurmaDto): Promise<TurmaResponseDto> {
        try {
            // Verificar se polo existe
            const polo = await this.uow.polosRP.findOne({
                where: { id: createTurmaDto.id_polo },
            });
            if (!polo) {
                throw new NotFoundException('Polo não encontrado');
            }

            // Verificar se treinamento existe
            const treinamento = await this.uow.treinamentosRP.findOne({
                where: { id: createTurmaDto.id_treinamento },
            });
            if (!treinamento) {
                throw new NotFoundException('Treinamento não encontrado');
            }

            // Verificar se líder existe (apenas se fornecido)
            if (createTurmaDto.lider_evento) {
                const lider = await this.uow.usuariosRP.findOne({
                    where: { id: createTurmaDto.lider_evento },
                });
                if (!lider) {
                    throw new NotFoundException('Líder do evento não encontrado');
                }
            }

            // Processar endereço: se tiver id_endereco_evento, buscar o endereço predefinido
            let enderecoData: {
                id_endereco_evento?: number;
                cep: string;
                logradouro: string;
                complemento?: string;
                numero: string;
                bairro: string;
                cidade: string;
                estado: string;
            };

            if (createTurmaDto.id_endereco_evento) {
                // Buscar endereço predefinido
                const enderecoEvento = await this.uow.enderecoEventosRP.findOne({
                    where: {
                        id: createTurmaDto.id_endereco_evento,
                        deletado_em: null,
                    },
                });

                if (!enderecoEvento) {
                    throw new NotFoundException('Endereço de evento não encontrado');
                }

                enderecoData = {
                    id_endereco_evento: createTurmaDto.id_endereco_evento,
                    cep: enderecoEvento.cep || '',
                    logradouro: enderecoEvento.logradouro || '',
                    complemento: createTurmaDto.complemento || enderecoEvento.numero ? undefined : undefined,
                    numero: enderecoEvento.numero || '',
                    bairro: enderecoEvento.bairro || '',
                    cidade: enderecoEvento.cidade || '',
                    estado: enderecoEvento.estado || '',
                };

                // Permitir complemento manual mesmo usando endereço predefinido
                if (createTurmaDto.complemento) {
                    enderecoData.complemento = createTurmaDto.complemento;
                }
            } else {
                // Validar que todos os campos de endereço foram fornecidos
                if (
                    !createTurmaDto.cep ||
                    !createTurmaDto.logradouro ||
                    !createTurmaDto.numero ||
                    !createTurmaDto.bairro ||
                    !createTurmaDto.cidade ||
                    !createTurmaDto.estado
                ) {
                    throw new BadRequestException(
                        'É necessário fornecer um endereço de evento predefinido (id_endereco_evento) ou preencher todos os campos de endereço (CEP, logradouro, número, bairro, cidade e estado)',
                    );
                }

                enderecoData = {
                    cep: createTurmaDto.cep,
                    logradouro: createTurmaDto.logradouro,
                    complemento: createTurmaDto.complemento,
                    numero: createTurmaDto.numero,
                    bairro: createTurmaDto.bairro,
                    cidade: createTurmaDto.cidade,
                    estado: createTurmaDto.estado,
                };
            }

            // Processar detalhamento de bônus
            let detalhamento_bonus = null;
            if (createTurmaDto.autorizar_bonus && createTurmaDto.bonus_treinamentos?.length > 0) {
                detalhamento_bonus = createTurmaDto.bonus_treinamentos.map((id_treinamento) => ({
                    id_treinamento_db: id_treinamento,
                }));
            }

            // Remover campos que não existem na entidade antes de criar
            const { bonus_treinamentos, ...createData } = createTurmaDto;

            // Formatar datas para o formato YYYY-MM-DD
            const dataInicioFormatada = this.formatDateToDateOnly(createTurmaDto.data_inicio);
            const dataFinalFormatada = this.formatDateToDateOnly(createTurmaDto.data_final);

            // Verificar se é palestra para definir turma_aberta como true por padrão
            const isPalestra = treinamento.tipo_palestra === true;
            const turmaAberta = createTurmaDto.turma_aberta !== undefined ? createTurmaDto.turma_aberta : isPalestra ? true : false;

            // Palestras/masterclass iniciam com inscrições abertas; treinamentos mantêm o fluxo anterior (padrão do DTO)
            const statusTurmaFinal = isPalestra ? EStatusTurmas.INSCRICOES_ABERTAS : (createTurmaDto.status_turma ?? EStatusTurmas.AGUARDANDO_LIBERACAO);

            // Criar nova turma
            const novaTurma = this.uow.turmasRP.create({
                ...createData,
                ...enderecoData,
                data_inicio: dataInicioFormatada,
                data_final: dataFinalFormatada,
                turma_aberta: turmaAberta,
                status_turma: statusTurmaFinal,
                id_turma_bonus: createTurmaDto.id_turma_bonus || null,
                detalhamento_bonus,
                criado_por: createTurmaDto.criado_por,
            });

            const turmaSalva = await this.uow.turmasRP.save(novaTurma);

            await this.registrarLogTurma({
                id_turma: turmaSalva.id,
                tipo_acao: 'CRIACAO',
                titulo: 'Evento criado',
                descricao: 'A turma/evento foi criada no IAM Control.',
            });

            // Retornar turma criada com relações
            return this.findById(turmaSalva.id);
        } catch (error) {
            console.error('Erro ao criar turma:', error);
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new BadRequestException('Erro ao criar turma');
        }
    }

    /**
     * Buscar alunos disponíveis para uma turma.
     * Se search for informado, filtra por nome ou email (ILIKE); caso contrário retorna vazio quando usado em modo autocomplete.
     */
    async getAlunosDisponiveis(id_turma?: number, page: number = 1, limit: number = 10, search?: string): Promise<AlunosDisponiveisResponseDto> {
        try {
            const skip = (page - 1) * limit;

            // Quando não há busca, retornar vazio para modo autocomplete (lista inicia zerada)
            if (!search || !search.trim()) {
                return {
                    data: [],
                    total: 0,
                    page,
                    limit,
                    totalPages: 0,
                };
            }

            const qb = this.uow.alunosRP
                .createQueryBuilder('aluno')
                .where('aluno.deletado_em IS NULL')
                .andWhere('(aluno.nome ILIKE :search OR aluno.email ILIKE :search)', { search: `%${search.trim()}%` });

            if (id_turma) {
                const alunosNaTurma = await this.uow.turmasAlunosRP.find({
                    where: { id_turma, deletado_em: null },
                    select: ['id_aluno'],
                });
                const idsAlunosNaTurma = alunosNaTurma.map((ta) => ta.id_aluno);
                if (idsAlunosNaTurma.length > 0) {
                    qb.andWhere('aluno.id NOT IN (:...ids)', { ids: idsAlunosNaTurma });
                }
            }

            const [alunos, total] = await qb.orderBy('aluno.nome', 'ASC').skip(skip).take(limit).getManyAndCount();

            return {
                data: alunos.map((aluno) => ({
                    id: aluno.id,
                    nome: aluno.nome,
                    email: aluno.email,
                    cpf: aluno.cpf,
                    nome_cracha: aluno.nome_cracha || aluno.nome,
                    status_aluno_geral: aluno.status_aluno_geral,
                })),
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            };
        } catch (error) {
            console.error('Erro ao buscar alunos disponíveis:', error);
            throw new BadRequestException('Erro ao buscar alunos disponíveis');
        }
    }

    /**
     * Buscar detalhes de um aluno específico em uma turma
     */
    async getAlunoTurmaByIdDetailed(id: string): Promise<any> {
        try {
            const turmaAluno = await this.uow.turmasAlunosRP.findOne({
                where: { id: id },
                relations: [
                    'id_aluno_fk',
                    'id_turma_fk',
                    'id_turma_fk.id_treinamento_fk',
                    'id_turma_fk.id_polo_fk',
                    'id_turma_transferencia_para_fk',
                    'id_turma_transferencia_para_fk.id_treinamento_fk',
                    'id_turma_transferencia_para_fk.id_polo_fk',
                    'id_turma_transferencia_de_fk',
                    'id_turma_transferencia_de_fk.id_treinamento_fk',
                    'id_turma_transferencia_de_fk.id_polo_fk',
                ],
            });

            if (!turmaAluno) {
                throw new NotFoundException('Aluno não encontrado na turma');
            }

            return {
                id: turmaAluno.id,
                id_aluno: turmaAluno.id_aluno,
                id_turma: turmaAluno.id_turma,
                nome_cracha: turmaAluno.id_aluno_fk?.nome_cracha || turmaAluno.id_aluno_fk?.nome || '',
                numero_cracha: turmaAluno.numero_cracha,
                vaga_bonus: turmaAluno.vaga_bonus,
                status_aluno_turma: turmaAluno.status_aluno_turma,
                confirmacao_realizada: turmaAluno.confirmacao_realizada,
                checkin_realizado: turmaAluno.checkin_realizado,
                presenca_turma: turmaAluno.presenca_turma,
                transferencia_para_turma: this.mapTurmaToTransferenciaTag(turmaAluno.id_turma_transferencia_para_fk),
                transferencia_de_turma: this.mapTurmaToTransferenciaTag(turmaAluno.id_turma_transferencia_de_fk),
                telefone: turmaAluno.id_aluno_fk?.telefone_um || '',
                ficha_preenchida: this.isFichaPreenchida(turmaAluno.id_aluno_fk),
                created_at: turmaAluno.criado_em,
                aluno: turmaAluno.id_aluno_fk
                    ? {
                          id: turmaAluno.id_aluno_fk.id,
                          nome: turmaAluno.id_aluno_fk.nome,
                          email: turmaAluno.id_aluno_fk.email,
                          nome_cracha: turmaAluno.id_aluno_fk.nome_cracha || turmaAluno.id_aluno_fk.nome,
                          status_aluno_geral: turmaAluno.id_aluno_fk.status_aluno_geral,
                          cpf: turmaAluno.id_aluno_fk.cpf,
                          instagram: turmaAluno.id_aluno_fk.instagram,
                          telefone_um: turmaAluno.id_aluno_fk.telefone_um,
                          telefone_dois: turmaAluno.id_aluno_fk.telefone_dois,
                          cep: turmaAluno.id_aluno_fk.cep,
                          logradouro: turmaAluno.id_aluno_fk.logradouro,
                          complemento: turmaAluno.id_aluno_fk.complemento,
                          numero: turmaAluno.id_aluno_fk.numero,
                          bairro: turmaAluno.id_aluno_fk.bairro,
                          cidade: turmaAluno.id_aluno_fk.cidade,
                          estado: turmaAluno.id_aluno_fk.estado,
                          profissao: turmaAluno.id_aluno_fk.profissao,
                          genero: turmaAluno.id_aluno_fk.genero,
                          data_nascimento: turmaAluno.id_aluno_fk.data_nascimento,
                          possui_deficiencia: turmaAluno.id_aluno_fk.possui_deficiencia,
                          desc_deficiencia: turmaAluno.id_aluno_fk.desc_deficiencia,
                      }
                    : undefined,
                turma: turmaAluno.id_turma_fk
                    ? {
                          id: turmaAluno.id_turma_fk.id,
                          edicao_turma: turmaAluno.id_turma_fk.edicao_turma,
                          data_inicio: turmaAluno.id_turma_fk.data_inicio,
                          data_final: turmaAluno.id_turma_fk.data_final,
                          treinamento: turmaAluno.id_turma_fk.id_treinamento_fk
                              ? {
                                    nome: turmaAluno.id_turma_fk.id_treinamento_fk.treinamento,
                                    sigla: turmaAluno.id_turma_fk.id_treinamento_fk.sigla_treinamento || turmaAluno.id_turma_fk.id_treinamento_fk.treinamento,
                                }
                              : undefined,
                          polo: turmaAluno.id_turma_fk.id_polo_fk
                              ? {
                                    nome: turmaAluno.id_turma_fk.id_polo_fk.polo,
                                    cidade: turmaAluno.id_turma_fk.id_polo_fk.cidade,
                                    estado: turmaAluno.id_turma_fk.id_polo_fk.estado,
                                }
                              : undefined,
                      }
                    : undefined,
            };
        } catch (error) {
            console.error('Erro ao buscar aluno da turma:', error);
            throw new BadRequestException('Erro ao buscar aluno da turma');
        }
    }

    /**
     * Trilha do aluno: lista todas as turmas nas quais o aluno já esteve vinculado
     * Inclui também palestras/masterclass onde o aluno participou
     * O tipo é determinado pelo tipo do treinamento (palestra ou treinamento)
     */
    async getTrilhaAluno(id_aluno: number): Promise<
        {
            id_turma_aluno: string;
            status_aluno_turma: string | null;
            presenca_turma: string | null;
            criado_em: Date;
            tipo: 'palestra' | 'treinamento';
            origem_label?: string;
            origem_sigla?: string;
            origem_edicao?: string;
            tipo_origem_label?: string;
            tipo_origem_detalhe?: string;
            transferido_por_robo?: boolean;
            situacao?: 'ativo' | 'transferido' | 'cancelado';
            turma: {
                id: number;
                nome_evento: string;
                sigla_evento: string;
                edicao_turma?: string;
                local: string;
                data_inicio: string;
                data_final: string;
                polo?: {
                    nome: string;
                    cidade: string;
                    estado: string;
                };
            };
        }[]
    > {
        try {
            // Buscar dados do aluno para usar em buscas alternativas
            const aluno = await this.uow.alunosRP.findOne({
                where: { id: id_aluno, deletado_em: null },
            });

            // Buscar TODAS as turmas onde o aluno esteve vinculado, inclusive registros soft-deleted.
            // O registro congelado deve permanecer na trilha mesmo após transferência ou cancelamento.
            const turmasAluno = await this.uow.turmasAlunosRP.find({
                where: { id_aluno: id_aluno as any },
                relations: [
                    'id_turma_fk',
                    'id_turma_fk.id_treinamento_fk',
                    'id_turma_fk.id_polo_fk',
                    'id_turma_transferencia_de_fk',
                    'id_turma_transferencia_de_fk.id_treinamento_fk',
                ],
                order: { criado_em: 'DESC' },
            });

            // Obter IDs das turmas do aluno para busca alternativa
            const idsTurmasAluno = turmasAluno.map((ta) => ta.id_turma).filter((id) => id);

            // Buscar masterclass/palestras onde o aluno está vinculado diretamente
            const idAlunoString = String(id_aluno);

            let masterclassAluno = await this.uow.masterclassPreCadastrosRP
                .createQueryBuilder('mc')
                .distinct(true)
                .leftJoinAndSelect('mc.id_turma_fk', 'turma')
                .leftJoinAndSelect('turma.id_treinamento_fk', 'treinamento')
                .leftJoinAndSelect('turma.id_polo_fk', 'polo')
                .where('mc.deletado_em IS NULL')
                .andWhere('(CAST(mc.id_aluno_vinculado AS TEXT) = :idAluno OR mc.id_aluno_vinculado = :idAlunoNum)', {
                    idAluno: idAlunoString,
                    idAlunoNum: id_aluno,
                })
                .orderBy('mc.criado_em', 'DESC')
                .getMany();

            // Se não encontrou masterclass vinculadas diretamente, buscar por outros critérios
            if (masterclassAluno.length === 0 && aluno) {
                const qb = this.uow.masterclassPreCadastrosRP
                    .createQueryBuilder('mc')
                    .leftJoinAndSelect('mc.id_turma_fk', 'turma')
                    .leftJoinAndSelect('turma.id_treinamento_fk', 'treinamento')
                    .leftJoinAndSelect('turma.id_polo_fk', 'polo')
                    .where('mc.deletado_em IS NULL')
                    .andWhere('mc.id_aluno_vinculado IS NULL'); // Apenas masterclass não vinculadas

                const conditions: string[] = [];
                const params: any = {};

                // Buscar por email
                if (aluno.email) {
                    conditions.push('LOWER(mc.email) = LOWER(:email)');
                    params.email = aluno.email;
                }

                // Buscar por telefone (normalizar removendo caracteres especiais)
                if (aluno.telefone_um) {
                    const telefoneNormalizado = aluno.telefone_um.replace(/\D/g, '');
                    conditions.push("REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(mc.telefone, '(', ''), ')', ''), '-', ''), ' ', ''), '.', '') = :telefone");
                    params.telefone = telefoneNormalizado;
                }

                // Buscar por turmas compartilhadas
                if (idsTurmasAluno.length > 0) {
                    conditions.push('mc.id_turma IN (:...idsTurmas)');
                    params.idsTurmas = idsTurmasAluno;
                }

                if (conditions.length > 0) {
                    qb.distinct(true).andWhere(`(${conditions.join(' OR ')})`, params);
                    const masterclassEncontradas = await qb.orderBy('mc.criado_em', 'DESC').getMany();
                    // Garantir que não haja duplicatas mesmo com DISTINCT
                    const uniqueMap = new Map<string, any>();
                    masterclassEncontradas.forEach((mc) => {
                        if (!uniqueMap.has(mc.id)) {
                            uniqueMap.set(mc.id, mc);
                        }
                    });
                    masterclassAluno = Array.from(uniqueMap.values());
                }
            }

            console.log(`[getTrilhaAluno] Buscando masterclass para aluno ID: ${id_aluno} (string: "${idAlunoString}")`);
            console.log(`[getTrilhaAluno] Masterclass encontradas: ${masterclassAluno.length}`);
            if (masterclassAluno.length > 0) {
                masterclassAluno.forEach((mc, index) => {
                    console.log(`[getTrilhaAluno] Masterclass ${index + 1}:`, {
                        id: mc.id,
                        id_aluno_vinculado: mc.id_aluno_vinculado,
                        tipo_id_aluno_vinculado: typeof mc.id_aluno_vinculado,
                        evento_nome: mc.evento_nome,
                        tem_turma: !!mc.id_turma_fk,
                        turma_id: mc.id_turma_fk?.id,
                    });
                });
            } else {
                // Debug: buscar todos os masterclass para ver quais existem
                const todasMasterclass = await this.uow.masterclassPreCadastrosRP.find({
                    where: { id_aluno_vinculado: Not(null) },
                    take: 5,
                });
                console.log(
                    `[getTrilhaAluno] Exemplo de masterclass com vínculo (primeiras 5):`,
                    todasMasterclass.map((mc) => ({
                        id: mc.id,
                        id_aluno_vinculado: mc.id_aluno_vinculado,
                        tipo: typeof mc.id_aluno_vinculado,
                    })),
                );
            }

            // Função auxiliar para determinar o tipo baseado no treinamento
            const determinarTipo = (treinamento: any): 'palestra' | 'treinamento' => {
                if (!treinamento) return 'treinamento';
                return treinamento.tipo_palestra ? 'palestra' : 'treinamento';
            };

            // Mapear turmas normais
            const historicoTransfs = await this.uow.historicoTransferenciasRP.find({
                where: {
                    id_aluno,
                },
                relations: ['id_turma_de_fk', 'id_turma_de_fk.id_treinamento_fk'],
                order: { id: 'DESC' },
            });
            // Venda do Time de Vendas: registrada como "transferência" da turma para ela mesma (de === para).
            const historicoTimeVendasByTurmaAluno = new Map<string, (typeof historicoTransfs)[number]>();
            // Transferência real (de uma turma diferente da de destino) por turma_aluno de destino.
            const historicoTransferenciaByTurmaAluno = new Map<string, (typeof historicoTransfs)[number]>();
            historicoTransfs.forEach((h) => {
                if (!h.id_turma_aluno_para) {
                    return;
                }
                const key = String(h.id_turma_aluno_para);
                if (h.id_turma_de === h.id_turma_para) {
                    if (!historicoTimeVendasByTurmaAluno.has(key)) {
                        historicoTimeVendasByTurmaAluno.set(key, h);
                    }
                } else if (!historicoTransferenciaByTurmaAluno.has(key)) {
                    historicoTransferenciaByTurmaAluno.set(key, h);
                }
            });

            // Turmas de destino que receberam o aluno por auto-transferência de NO_SHOW (ingresso comprado).
            const noShowAutoTransfLogs = await this.uow.historicoAlunosTurmasLogsRP.find({
                where: {
                    id_aluno: String(id_aluno),
                    template_key: TEMPLATE_AUTO_TRANSFERENCIA_NO_SHOW_IPR,
                    deletado_em: null,
                },
            });
            const turmasDestinoNoShowAuto = new Set<number>();
            noShowAutoTransfLogs.forEach((log) => {
                const detalhes = log.detalhes || {};
                const idTurmaDestino = Number(detalhes['id_turma_destino']);
                if (idTurmaDestino) {
                    turmasDestinoNoShowAuto.add(idTurmaDestino);
                }
            });

            // Resolve os nomes dos usuários que realizaram cada operação (criado_por),
            // para exibir "usuário + data" no ícone de detalhe da operação na trilha.
            const idsUsuariosOperacao = new Set<number>();
            const coletarUsuarioOperacao = (id?: number | null) => {
                if (typeof id === 'number' && Number.isInteger(id) && id > 0) {
                    idsUsuariosOperacao.add(id);
                }
            };
            turmasAluno.forEach((ta) => {
                const histTransf = historicoTransferenciaByTurmaAluno.get(String(ta.id));
                const histTimeVendas = historicoTimeVendasByTurmaAluno.get(String(ta.id));
                coletarUsuarioOperacao(histTimeVendas?.criado_por ?? histTransf?.criado_por ?? ta.criado_por);
            });
            masterclassAluno.forEach((mc) => coletarUsuarioOperacao(mc.criado_por));
            const nomesUsuariosOperacao = new Map<number, string>();
            if (idsUsuariosOperacao.size > 0) {
                try {
                    const usuariosOperacao = await this.uow.usuariosRP
                        .createQueryBuilder('usuario')
                        .select(['usuario.id', 'usuario.nome'])
                        .where('usuario.id IN (:...ids)', { ids: Array.from(idsUsuariosOperacao) })
                        .getMany();
                    usuariosOperacao.forEach((usuario) => nomesUsuariosOperacao.set(usuario.id, usuario.nome));
                } catch (error) {
                    this.logger.warn(`turma.trilha.get | Falha ao resolver usuários das operações: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
                }
            }

            // Identifica se a turma de origem é uma Masterclass/Palestra.
            const isMasterclassTurma = (turmaOrigem?: { id_treinamento_fk?: any; edicao_turma?: string | null } | null): boolean => {
                if (!turmaOrigem) {
                    return false;
                }
                const tr = turmaOrigem.id_treinamento_fk;
                const edicao = (turmaOrigem.edicao_turma || '').trim().toUpperCase();
                return Boolean(tr?.tipo_palestra) || (tr ? tr.tipo_treinamento === false : false) || edicao.startsWith('MC_');
            };

            // Rótulo do "tipo de origem" (o meio pelo qual o aluno chegou ao destino).
            const tipoOrigemLabel = (origem?: EOrigemAlunos | null): string => {
                switch (origem) {
                    case EOrigemAlunos.TRANSFERENCIA:
                        return 'Transferência';
                    case EOrigemAlunos.ALUNO_BONUS:
                        return 'Bônus';
                    case EOrigemAlunos.CORTESIA:
                        return 'Cortesia';
                    case EOrigemAlunos.SORTEIO:
                        return 'Sorteio';
                    case EOrigemAlunos.ALUNO_CONVIDADO:
                    case EOrigemAlunos.COMPROU_INGRESSO:
                    default:
                        return 'Comprou Ingresso';
                }
            };

            // Turmas de DESTINO que receberam o aluno por uma VENDA (têm contrato de
            // venda apontando para elas). Isso distingue uma venda (ex.: IPR -> Confronto,
            // gerada pelo fluxo de vendas, gravada como TRANSFERENCIA) de uma transferência
            // real (remarcação manual entre turmas, que não gera contrato).
            const idsTurmasVendaDestino = new Set<number>();
            try {
                const contratosVendaAluno = await this.uow.turmasAlunosTreinamentosContratosRP
                    .createQueryBuilder('contrato')
                    .innerJoin('contrato.id_turma_aluno_treinamento_fk', 'tat')
                    .innerJoin('tat.id_turma_aluno_fk', 'ta')
                    .select(['contrato.id', 'contrato.dados_contrato', 'tat.id', 'tat.id_turma_destino'])
                    .where('contrato.deletado_em IS NULL')
                    .andWhere('ta.id_aluno = :idAluno', { idAluno: String(id_aluno) })
                    .getMany();

                contratosVendaAluno.forEach((contrato) => {
                    const idDestinoTat = Number(contrato.id_turma_aluno_treinamento_fk?.id_turma_destino);
                    if (Number.isInteger(idDestinoTat) && idDestinoTat > 0) {
                        idsTurmasVendaDestino.add(idDestinoTat);
                    }
                    const dados = (contrato.dados_contrato || {}) as Record<string, unknown>;
                    const idDestinoDados = Number(dados['fluxo_evento_destino_id_turma']);
                    if (Number.isInteger(idDestinoDados) && idDestinoDados > 0) {
                        idsTurmasVendaDestino.add(idDestinoDados);
                    }
                });
            } catch (error) {
                this.logger.warn(`turma.trilha.get | Falha ao identificar vendas por contrato: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
            }

            const trilhaTurmas = turmasAluno.map((ta) => {
                const turma = ta.id_turma_fk;
                const treinamento = turma?.id_treinamento_fk;
                const polo = turma?.id_polo_fk;
                const origemTimeVendasData = historicoTimeVendasByTurmaAluno.get(String(ta.id));
                const isTimeVendas = Boolean(origemTimeVendasData);
                const histTransfRegistro = historicoTransferenciaByTurmaAluno.get(String(ta.id));
                // Data e usuário da OPERAÇÃO que originou o registro (transferência/venda/criação).
                const operacao_em = origemTimeVendasData?.criado_em || histTransfRegistro?.criado_em || ta.criado_em;
                const operacao_por_id = origemTimeVendasData?.criado_por ?? histTransfRegistro?.criado_por ?? ta.criado_por ?? null;
                const operacao_por_nome = operacao_por_id ? nomesUsuariosOperacao.get(operacao_por_id) || null : null;

                // Destino = a própria turma do vínculo.
                const localParts: string[] = [];
                if (turma?.cidade) localParts.push(turma.cidade);
                if (turma?.estado) localParts.push(turma.estado);
                const local = localParts.join(' - ');

                // Determinar ORIGEM e TIPO DE ORIGEM.
                const origemAluno = ta.origem_aluno || null;

                // Turma de onde o aluno veio (transferência): prioriza FK explícita, senão histórico.
                const histTransf = historicoTransferenciaByTurmaAluno.get(String(ta.id));
                const turmaOrigem = ta.id_turma_transferencia_de_fk || histTransf?.id_turma_de_fk || null;
                const treinamentoOrigem = turmaOrigem?.id_treinamento_fk;
                const codigoOrigemPlanilha = (ta.codigo_turma_origem_planilha || '').trim().toUpperCase();

                // "Tipo de Origem" do destino. Uma VENDA (ex.: IPR -> Confronto) é gravada
                // como TRANSFERENCIA, mas possui um contrato de venda apontando para a turma
                // de destino — nesse caso o rótulo deve ser "Vendas em Eventos". Já uma
                // transferência real (remarcação manual, sem contrato) permanece como
                // "Transferência". Vendas via Time de Vendas já são sinalizadas por isTimeVendas.
                const isVendaEvento = origemAluno === EOrigemAlunos.TRANSFERENCIA && Boolean(turma?.id) && idsTurmasVendaDestino.has(turma.id);
                const tipo_origem_label = isTimeVendas ? 'Vendas do Time de Vendas' : isVendaEvento ? 'Vendas em Eventos' : tipoOrigemLabel(origemAluno);

                let origem_label: string | undefined;
                let origem_sigla: string | undefined;
                let origem_edicao: string | undefined;
                // Para origens de turma (transferência), estrutura igual ao destino: nome + sigla · edição.
                const aplicarOrigemTurma = () => {
                    origem_label = (treinamentoOrigem?.treinamento || '').trim() || (treinamentoOrigem?.sigla_treinamento || '').trim() || 'Turma';
                    origem_sigla = (treinamentoOrigem?.sigla_treinamento || '').trim() || undefined;
                    origem_edicao = (turmaOrigem?.edicao_turma || '').trim() || undefined;
                };
                if (origemAluno === EOrigemAlunos.TRANSFERENCIA && turmaOrigem) {
                    aplicarOrigemTurma();
                } else if (isTimeVendas) {
                    origem_label = 'Time de Vendas';
                } else if (isMasterclassTurma(turmaOrigem)) {
                    const cidade = (turmaOrigem?.cidade || '').trim();
                    origem_label = cidade ? `Masterclass - ${cidade}` : 'Masterclass';
                } else if (codigoOrigemPlanilha.startsWith('MC_')) {
                    origem_label = 'Masterclass';
                } else if (origemAluno === EOrigemAlunos.COMPROU_INGRESSO || origemAluno === EOrigemAlunos.ALUNO_CONVIDADO || !origemAluno) {
                    origem_label = 'Vendas em Eventos';
                } else if (turmaOrigem) {
                    aplicarOrigemTurma();
                } else {
                    origem_label = undefined;
                }

                // Situação congelada do registro: transferido (replicado para destino) ou cancelado (soft delete).
                const situacao: 'ativo' | 'transferido' | 'cancelado' = ta.id_turma_transferencia_para ? 'transferido' : ta.deletado_em ? 'cancelado' : 'ativo';

                // Detalhe da transferência automática por no-show de ingresso comprado (visível ao gestor da turma).
                let tipo_origem_detalhe: string | undefined;
                if (origemAluno === EOrigemAlunos.TRANSFERENCIA && turma?.id && turmasDestinoNoShowAuto.has(turma.id)) {
                    tipo_origem_detalhe = '1ª Transferência do Ingresso Comprado';
                }

                return {
                    id_turma_aluno: ta.id,
                    status_aluno_turma: ta.status_aluno_turma || null,
                    presenca_turma: ta.presenca_turma || null,
                    criado_em: operacao_em,
                    operacao_em,
                    operacao_por_nome,
                    tipo: determinarTipo(treinamento),
                    origem_label,
                    origem_sigla,
                    origem_edicao,
                    tipo_origem_label,
                    tipo_origem_detalhe,
                    transferido_por_robo: ta.transferido_por_robo === true,
                    situacao,
                    turma: {
                        id: turma?.id || 0,
                        nome_evento: treinamento?.treinamento || '',
                        sigla_evento: treinamento?.sigla_treinamento || treinamento?.treinamento || '',
                        edicao_turma: turma?.edicao_turma || undefined,
                        local,
                        data_inicio: turma?.data_inicio || '',
                        data_final: turma?.data_final || '',
                        polo: polo
                            ? {
                                  nome: polo.polo,
                                  cidade: polo.cidade,
                                  estado: polo.estado,
                              }
                            : undefined,
                    },
                };
            });

            // Remover duplicatas de masterclass baseado no ID primeiro
            // Usar Map para garantir que cada ID apareça apenas uma vez
            const masterclassMapById = new Map<string, any>();
            masterclassAluno.forEach((mc) => {
                if (!masterclassMapById.has(mc.id)) {
                    masterclassMapById.set(mc.id, mc);
                }
            });
            let masterclassUnicas = Array.from(masterclassMapById.values());

            // Deduplicação adicional: remover masterclass duplicadas mesmo com IDs diferentes
            // baseado em evento_nome + data_evento + email (chave composta)
            const masterclassMapUnicas = new Map<string, any>();
            masterclassUnicas.forEach((mc) => {
                const dataEventoStr = mc.data_evento ? new Date(mc.data_evento).toISOString().split('T')[0] : '';
                const chaveUnica = `${mc.evento_nome || ''}_${dataEventoStr}_${mc.email || ''}`.toLowerCase();

                // Se já existe uma masterclass com a mesma chave, manter apenas a mais antiga (criada primeiro)
                if (!masterclassMapUnicas.has(chaveUnica)) {
                    masterclassMapUnicas.set(chaveUnica, mc);
                } else {
                    const existente = masterclassMapUnicas.get(chaveUnica);
                    // Manter a que foi criada primeiro
                    if (new Date(mc.criado_em) < new Date(existente.criado_em)) {
                        masterclassMapUnicas.set(chaveUnica, mc);
                    }
                }
            });
            masterclassUnicas = Array.from(masterclassMapUnicas.values());

            console.log(`[getTrilhaAluno] Masterclass após deduplicação: ${masterclassUnicas.length} (de ${masterclassAluno.length} encontradas)`);

            // Re-mapear masterclass únicas
            const trilhaMasterclassUnicas = masterclassUnicas.map((mc) => {
                const turma = mc.id_turma_fk;
                const treinamento = turma?.id_treinamento_fk;
                const polo = turma?.id_polo_fk;

                // Se não tiver turma relacionada, usar dados do próprio registro de masterclass
                const localParts: string[] = [];
                if (turma?.cidade) localParts.push(turma.cidade);
                if (turma?.estado) localParts.push(turma.estado);
                // Se não tiver turma, tentar obter local de outra forma ou deixar vazio
                const local = localParts.length > 0 ? localParts.join(' - ') : 'N/A';

                // Determinar tipo: se tem treinamento, usa o tipo do treinamento, senão assume palestra
                const tipo = treinamento ? determinarTipo(treinamento) : 'palestra';

                // Data do evento: priorizar turma, senão usar data_evento do masterclass
                const dataEvento = mc.data_evento ? new Date(mc.data_evento).toISOString().split('T')[0] : '';
                const dataInicio = turma?.data_inicio || dataEvento || '';
                const dataFinal = turma?.data_final || dataEvento || '';

                return {
                    id_turma_aluno: mc.id,
                    status_aluno_turma: mc.presente ? 'PRESENTE' : null,
                    presenca_turma: mc.presente ? 'PRESENTE' : null,
                    criado_em: mc.criado_em,
                    operacao_em: mc.criado_em,
                    operacao_por_nome: mc.criado_por ? nomesUsuariosOperacao.get(mc.criado_por) || null : null,
                    tipo,
                    turma: {
                        id: turma?.id || 0,
                        nome_evento: mc.evento_nome || treinamento?.treinamento || 'Masterclass',
                        sigla_evento: treinamento?.sigla_treinamento || treinamento?.treinamento || mc.evento_nome || '',
                        edicao_turma: turma?.edicao_turma || undefined,
                        local,
                        data_inicio: dataInicio,
                        data_final: dataFinal,
                        polo: polo
                            ? {
                                  nome: polo.polo,
                                  cidade: polo.cidade,
                                  estado: polo.estado,
                              }
                            : undefined,
                    },
                };
            });

            // Combinar e ordenar pela ordem de registro da operação (mais antigo primeiro / crescente).
            const trilhaCompleta = [...trilhaTurmas, ...trilhaMasterclassUnicas].sort(
                (a, b) => new Date(a.operacao_em || a.criado_em).getTime() - new Date(b.operacao_em || b.criado_em).getTime(),
            );

            return trilhaCompleta;
        } catch (error) {
            this.logger.error('turma.trilha.get | Erro ao buscar trilha do aluno', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException('Erro ao buscar trilha do aluno');
        }
    }

    /**
     * Buscar turmas de IPR (Imersão Prosperar) com inscrições abertas para usar como bônus
     */
    async findIPRTurmasBonus(): Promise<TurmaResponseDto[]> {
        this.logger.debug('turma.ipr.list | Iniciando busca de turmas IPR para bônus');

        try {
            // Buscar turmas com status INSCRICOES_ABERTAS
            const turmas = await this.uow.turmasRP.find({
                where: {
                    status_turma: EStatusTurmas.INSCRICOES_ABERTAS,
                    deletado_em: null,
                },
                relations: ['id_polo_fk', 'id_treinamento_fk', 'lider_evento_fk'],
                order: {
                    data_inicio: 'ASC',
                },
            });

            // Filtrar apenas turmas de IPR (Imersão Prosperar)
            const turmasIPR = turmas.filter((turma) => {
                if (!turma.id_treinamento_fk) {
                    return false;
                }

                const nomeTreinamento = turma.id_treinamento_fk.treinamento?.toLowerCase() || '';
                const edicaoTurma = turma.edicao_turma?.toLowerCase() || '';

                const isIPR =
                    nomeTreinamento.includes('imersão prosperar') ||
                    nomeTreinamento.includes('ipr') ||
                    edicaoTurma.includes('ipr') ||
                    edicaoTurma.includes('imersão prosperar');

                return isIPR;
            });

            // Transformar dados para o formato de resposta
            const turmasResponse: TurmaResponseDto[] = turmasIPR.map((turma) => {
                return {
                    id: turma.id,
                    id_polo: turma.id_polo,
                    id_treinamento: turma.id_treinamento,
                    lider_evento: turma.lider_evento,
                    edicao_turma: turma.edicao_turma,
                    referencia_externa: turma.referencia_externa ?? null,
                    status_evento: turma.status_evento,
                    cep: turma.cep,
                    logradouro: turma.logradouro,
                    complemento: turma.complemento,
                    numero: turma.numero,
                    bairro: turma.bairro,
                    cidade: turma.cidade,
                    estado: turma.estado,
                    status_turma: turma.status_turma,
                    autorizar_bonus: turma.autorizar_bonus,
                    id_turma_bonus: turma.id_turma_bonus,
                    capacidade_turma: turma.capacidade_turma,
                    meta: turma.meta,
                    data_inicio: turma.data_inicio,
                    data_final: turma.data_final,
                    turma_aberta: turma.turma_aberta,
                    bonus_treinamentos: turma.detalhamento_bonus?.map((item) => item.id_treinamento_db) || [],
                    detalhamento_bonus: turma.detalhamento_bonus,
                    turmas_imersao_ofertadas: turma.turmas_imersao_ofertadas || [],
                    turmas_ipr_relacionadas: turma.turmas_ipr_relacionadas || [],
                    times_equipes: turma.times_equipes || [],
                    url_midia_kit: turma.url_midia_kit,
                    url_grupo_whatsapp: turma.url_grupo_whatsapp,
                    url_grupo_whatsapp_2: turma.url_grupo_whatsapp_2,
                    url_pagamento_cartao: turma.url_pagamento_cartao,
                    created_at: turma.criado_em,
                    updated_at: turma.atualizado_em,
                    polo: turma.id_polo_fk
                        ? {
                              id: turma.id_polo_fk.id,
                              nome: turma.id_polo_fk.polo,
                              sigla_polo: turma.id_polo_fk.sigla_polo,
                              cidade: turma.id_polo_fk.cidade,
                              estado: turma.id_polo_fk.estado,
                          }
                        : undefined,
                    treinamento: turma.id_treinamento_fk
                        ? {
                              id: turma.id_treinamento_fk.id,
                              nome: turma.id_treinamento_fk.treinamento,
                              tipo: turma.id_treinamento_fk.tipo_treinamento ? 'treinamento' : 'palestra',
                              tipo_online: turma.id_treinamento_fk.tipo_online,
                          }
                        : undefined,
                    lider: turma.lider_evento_fk
                        ? {
                              id: turma.lider_evento_fk.id,
                              nome: turma.lider_evento_fk.nome,
                          }
                        : undefined,
                    alunos_count: 0,
                    alunos_confirmados_count: 0,
                    pre_cadastrados_count: 0,
                    presentes_count: 0,
                };
            });

            this.logger.log(`turma.ipr.list | Turmas IPR carregadas abertas=${turmas.length} filtradas=${turmasResponse.length}`);

            return turmasResponse;
        } catch (error) {
            this.logger.error('turma.ipr.list | Erro ao buscar turmas de IPR para bônus', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException('Erro ao buscar turmas de IPR para bônus');
        }
    }

    /**
     * Atualiza somente o status do evento no calendário (cores da legenda).
     * MC_EXTRA é exclusivo de masterclass (palestra); eventos/treinamentos não podem usá-lo.
     */
    async updateStatusEvento(id: number, statusEvento: EStatusEventoCalendario, userId?: number): Promise<{ id: number; status_evento: string }> {
        const turma = await this.uow.turmasRP.findOne({
            where: { id, deletado_em: null },
            relations: ['id_treinamento_fk'],
        });
        if (!turma) {
            throw new NotFoundException(`Turma com ID ${id} não encontrada`);
        }

        const isPalestra = turma.id_treinamento_fk?.tipo_palestra === true || turma.id_treinamento_fk?.tipo_treinamento === false;
        if (statusEvento === EStatusEventoCalendario.MC_EXTRA && !isPalestra) {
            throw new BadRequestException('O status "MC extra" é exclusivo de masterclass.');
        }

        const statusAnterior = turma.status_evento;
        turma.status_evento = statusEvento;
        await this.uow.turmasRP.save(turma);
        this.logger.log(`turma.status_evento.update | id=${id} status_evento=${statusEvento}`);

        if (statusAnterior !== statusEvento) {
            await this.registrarLogTurma(
                {
                    id_turma: id,
                    tipo_acao: 'STATUS',
                    titulo: `Status alterado para "${this.labelStatusEvento(statusEvento)}"`,
                    descricao: `De "${this.labelStatusEvento(statusAnterior)}" para "${this.labelStatusEvento(statusEvento)}".`,
                    detalhes: { de: statusAnterior ?? null, para: statusEvento },
                },
                userId,
            );
        }
        return { id, status_evento: statusEvento };
    }

    async update(id: number, updateTurmaDto: UpdateTurmaDto): Promise<TurmaResponseDto> {
        try {
            this.logger.debug(`turma.repo.update | Atualizando turma id=${id}`);

            const turma = await this.uow.turmasRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
            });

            if (!turma) {
                throw new NotFoundException('Turma não encontrada');
            }

            // Snapshot dos campos-chave antes da alteração (para o histórico).
            const antesUpdate = {
                id_polo: turma.id_polo,
                id_treinamento: turma.id_treinamento,
                lider_evento: turma.lider_evento,
                data_inicio: turma.data_inicio,
                data_final: turma.data_final,
                capacidade_turma: turma.capacidade_turma,
                meta: turma.meta,
                status_turma: turma.status_turma,
                logradouro: turma.logradouro,
                cidade: turma.cidade,
            };

            // Validações se campos forem fornecidos
            if (updateTurmaDto.id_polo) {
                const polo = await this.uow.polosRP.findOne({
                    where: { id: updateTurmaDto.id_polo },
                });
                if (!polo) {
                    throw new NotFoundException('Polo não encontrado');
                }
            }

            if (updateTurmaDto.id_treinamento) {
                const treinamento = await this.uow.treinamentosRP.findOne({
                    where: { id: updateTurmaDto.id_treinamento },
                });
                if (!treinamento) {
                    throw new NotFoundException('Treinamento não encontrado');
                }
            }

            if (updateTurmaDto.lider_evento) {
                const lider = await this.uow.usuariosRP.findOne({
                    where: { id: updateTurmaDto.lider_evento },
                });
                if (!lider) {
                    throw new NotFoundException('Líder do evento não encontrado');
                }
            }

            // Processar endereço: se tiver id_endereco_evento, buscar o endereço predefinido
            let enderecoData: Partial<{
                id_endereco_evento?: number;
                cep: string;
                logradouro: string;
                complemento?: string;
                numero: string;
                bairro: string;
                cidade: string;
                estado: string;
            }> = {};

            if (updateTurmaDto.id_endereco_evento !== undefined) {
                if (updateTurmaDto.id_endereco_evento) {
                    // Buscar endereço predefinido
                    const enderecoEvento = await this.uow.enderecoEventosRP.findOne({
                        where: {
                            id: updateTurmaDto.id_endereco_evento,
                            deletado_em: null,
                        },
                    });

                    if (!enderecoEvento) {
                        throw new NotFoundException('Endereço de evento não encontrado');
                    }

                    enderecoData = {
                        id_endereco_evento: updateTurmaDto.id_endereco_evento,
                        cep: enderecoEvento.cep || '',
                        logradouro: enderecoEvento.logradouro || '',
                        numero: enderecoEvento.numero || '',
                        bairro: enderecoEvento.bairro || '',
                        cidade: enderecoEvento.cidade || '',
                        estado: enderecoEvento.estado || '',
                    };

                    // Permitir complemento manual mesmo usando endereço predefinido
                    if (updateTurmaDto.complemento !== undefined) {
                        enderecoData.complemento = updateTurmaDto.complemento;
                    }
                } else {
                    // Se id_endereco_evento for null, limpar a referência mas manter campos de endereço se fornecidos
                    enderecoData.id_endereco_evento = null;
                }
            } else if (
                updateTurmaDto.cep ||
                updateTurmaDto.logradouro ||
                updateTurmaDto.numero ||
                updateTurmaDto.bairro ||
                updateTurmaDto.cidade ||
                updateTurmaDto.estado
            ) {
                // Se campos de endereço foram fornecidos sem id_endereco_evento, validar que todos foram fornecidos
                if (
                    !updateTurmaDto.cep ||
                    !updateTurmaDto.logradouro ||
                    !updateTurmaDto.numero ||
                    !updateTurmaDto.bairro ||
                    !updateTurmaDto.cidade ||
                    !updateTurmaDto.estado
                ) {
                    throw new BadRequestException(
                        'Ao atualizar o endereço manualmente, todos os campos devem ser fornecidos (CEP, logradouro, número, bairro, cidade e estado)',
                    );
                }

                enderecoData = {
                    cep: updateTurmaDto.cep,
                    logradouro: updateTurmaDto.logradouro,
                    complemento: updateTurmaDto.complemento,
                    numero: updateTurmaDto.numero,
                    bairro: updateTurmaDto.bairro,
                    cidade: updateTurmaDto.cidade,
                    estado: updateTurmaDto.estado,
                };
            }

            // Processar detalhamento de bônus
            let detalhamento_bonus = turma.detalhamento_bonus; // Manter o existente por padrão

            if (Object.prototype.hasOwnProperty.call(updateTurmaDto, 'bonus_treinamentos')) {
                if (updateTurmaDto.autorizar_bonus && updateTurmaDto.bonus_treinamentos?.length > 0) {
                    // Criar novo detalhamento de bônus
                    detalhamento_bonus = updateTurmaDto.bonus_treinamentos.map((id_treinamento) => ({
                        id_treinamento_db: id_treinamento,
                    }));
                } else {
                    // Limpar detalhamento de bônus se não há treinamentos ou bônus não autorizado
                    detalhamento_bonus = null;
                }
            }

            // Remover campos que não existem na entidade antes de atualizar
            const { bonus_treinamentos, ...updateData } = updateTurmaDto;

            // Formatar datas se fornecidas
            const updateDataWithDates: any = { ...updateData };
            console.log(`[DEBUG] Datas recebidas no update:`, {
                data_inicio_original: updateTurmaDto.data_inicio,
                data_final_original: updateTurmaDto.data_final,
                data_inicio_undefined: updateTurmaDto.data_inicio === undefined,
                data_final_undefined: updateTurmaDto.data_final === undefined,
            });

            if (updateTurmaDto.data_inicio !== undefined && updateTurmaDto.data_inicio !== null && updateTurmaDto.data_inicio !== '') {
                updateDataWithDates.data_inicio = this.formatDateToDateOnly(updateTurmaDto.data_inicio);
                console.log(`[DEBUG] Data início formatada: ${updateDataWithDates.data_inicio}`);
            }
            if (updateTurmaDto.data_final !== undefined && updateTurmaDto.data_final !== null && updateTurmaDto.data_final !== '') {
                updateDataWithDates.data_final = this.formatDateToDateOnly(updateTurmaDto.data_final);
                console.log(`[DEBUG] Data final formatada: ${updateDataWithDates.data_final}`);
            }

            console.log(`[DEBUG] Dados finais para update:`, {
                data_inicio: updateDataWithDates.data_inicio,
                data_final: updateDataWithDates.data_final,
            });

            // Verificar se o status está sendo alterado manualmente
            const statusFoiAlteradoManualmente = updateTurmaDto.status_turma !== undefined && updateTurmaDto.status_turma !== turma.status_turma;

            // Atualizar turma
            await this.uow.turmasRP.update(id, {
                ...updateDataWithDates,
                ...enderecoData,
                detalhamento_bonus,
                atualizado_por: updateTurmaDto.atualizado_por,
            });

            // Registrar no histórico os campos que realmente mudaram.
            await this.registrarLogAlteracaoTurma(id, antesUpdate, { ...updateDataWithDates, ...enderecoData }, updateTurmaDto.atualizado_por);

            // Buscar turma atualizada com relações para verificar status
            const turmaAtualizada = await this.uow.turmasRP.findOne({
                where: { id, deletado_em: null },
                relations: ['id_treinamento_fk', 'turmasAlunos'],
            });

            // Só verificar e atualizar status automaticamente se o status NÃO foi alterado manualmente
            // Se o usuário alterou o status explicitamente, respeitar a escolha manual
            if (turmaAtualizada && !statusFoiAlteradoManualmente) {
                await this.verificarEAtualizarStatusTurma(turmaAtualizada);
            }

            if (turmaAtualizada) {
                // Quando o status é alterado manualmente, marcar/desmarcar a reabertura manual:
                // - status != ENCERRADA com o evento já encerrado => reabertura manual (não recongelar);
                // - status ENCERRADA => limpa a reabertura (a turma poderá congelar novamente em D+1).
                if (statusFoiAlteradoManualmente) {
                    const eventoTerminou = this.eventoTurmaTerminou(turmaAtualizada) === true;
                    const novaReabertura = turmaAtualizada.status_turma === EStatusTurmas.ENCERRADA ? false : eventoTerminou;
                    if (novaReabertura !== turmaAtualizada.reaberta_manualmente) {
                        turmaAtualizada.reaberta_manualmente = novaReabertura;
                        await this.uow.turmasRP.update(id, { reaberta_manualmente: novaReabertura });
                    }
                }

                // Se a turma não está congelada (ex.: status alterado de ENCERRADA para reaberta, ou
                // evento ainda não terminou), nenhum snapshot deve persistir: ele pode ter sido criado
                // por congelamento em lote/manual ou ter ficado órfão. Removemos para descongelar de fato
                // (métricas ao vivo e operações como presença/cancelamento liberadas). Será regerado do
                // zero quando a turma voltar a congelar (ENCERRADA + após D+1).
                if (!this.isTurmaCongelada(turmaAtualizada)) {
                    await this.removerSnapshotMetricasTurma(id);
                }
            }

            // Retornar turma atualizada
            return this.findById(id);
        } catch (error) {
            console.error('Erro ao atualizar turma:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao atualizar turma');
        }
    }

    async softDelete(id: number, softDeleteDto: SoftDeleteTurmaDto): Promise<void> {
        try {
            const turma = await this.uow.turmasRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
            });

            if (!turma) {
                throw new NotFoundException(`Turma com ID ${id} não encontrada`);
            }

            await this.registrarLogTurma(
                {
                    id_turma: id,
                    tipo_acao: 'REMOCAO',
                    titulo: 'Evento removido',
                    descricao: 'A turma/evento foi marcada como deletada.',
                },
                softDeleteDto.atualizado_por,
            );

            turma.deletado_em = new Date(softDeleteDto.deletado_em);
            turma.atualizado_por = softDeleteDto.atualizado_por;

            await this.uow.turmasRP.save(turma);
            console.log('Turma marcada como deletada:', id);
        } catch (error) {
            console.error('Erro ao fazer soft delete da turma:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao fazer soft delete da turma');
        }
    }

    async delete(id: number): Promise<void> {
        try {
            const turma = await this.uow.turmasRP.findOne({ where: { id } });

            if (!turma) {
                throw new NotFoundException('Turma não encontrada');
            }

            // Verificar se há alunos na turma
            const alunosNaTurma = await this.uow.turmasAlunosRP.count({
                where: { id_turma: id, deletado_em: null },
            });

            if (alunosNaTurma > 0) {
                throw new BadRequestException('Não é possível excluir permanentemente uma turma que possui alunos matriculados');
            }

            await this.uow.turmasRP.delete(id);
            console.log('Turma excluída permanentemente:', id);
        } catch (error) {
            console.error('Erro ao deletar turma permanentemente:', error);
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao deletar turma');
        }
    }

    // Métodos para gerenciar alunos na turma

    /** Rótulo amigável para cada forma de pagamento (alinhado às formas padrão do sistema). */
    private static readonly FORMA_PAGAMENTO_LABELS: Record<string, string> = {
        [EFormasPagamento.BOLETO]: 'Boleto',
        [EFormasPagamento.CARTAO_CREDITO]: 'Cartão de Crédito',
        [EFormasPagamento.CARTAO_DEBITO]: 'Cartão de Débito',
        [EFormasPagamento.PIX]: 'Pix/Transferência',
        [EFormasPagamento.DINHEIRO]: 'Espécie',
    };

    /** Monta o label exibido na coluna de pagamento a partir dos códigos de forma. */
    private formatarFormaPagamentoLabel(formas: string[]): string {
        if (!formas || formas.length === 0) {
            return 'Forma de pagamento indisponível';
        }
        return formas.map((forma) => TurmasService.FORMA_PAGAMENTO_LABELS[forma] || forma).join(' + ');
    }

    /** Extrai os códigos de forma de pagamento (sem duplicatas) de um dados_contrato (jsonb). */
    private extrairFormasDeContrato(dadosContrato: any): string[] {
        const candidatos = Array.isArray(dadosContrato?.pagamento?.formas_pagamento)
            ? dadosContrato.pagamento.formas_pagamento
            : Array.isArray(dadosContrato?.formas_pagamento)
              ? dadosContrato.formas_pagamento
              : [];
        const validas = new Set(Object.values(EFormasPagamento) as string[]);
        const formas: string[] = [];
        for (const item of candidatos) {
            const codigo = typeof item?.forma === 'string' ? item.forma.toUpperCase().trim() : '';
            if (validas.has(codigo) && !formas.includes(codigo)) {
                formas.push(codigo);
            }
        }
        return formas;
    }

    /**
     * Resolve, para cada matrícula (turmas_alunos) informada, as formas de pagamento do contrato
     * que trouxe o aluno para a turma. A informação "anda" junto com o aluno conforme ele é
     * transferido entre turmas: percorremos toda a cadeia de transferências (para trás, via
     * `id_turma_transferencia_de`) até encontrar o contrato de origem. Cobre os caminhos:
     *  - venda registrada na própria matrícula;
     *  - venda cuja turma DESTINO é uma turma da cadeia (mesmo aluno na origem);
     *  - transferência (1 ou N saltos): contrato em qualquer matrícula anterior do mesmo aluno.
     * Retorna um Map<id_turma_aluno, string[] (códigos EFormasPagamento)>.
     */
    private async resolverFormasPagamentoPorTurmaAluno(id_turma: number, turmaAlunoIds: string[]): Promise<Map<string, string[]>> {
        const dadosContratoPorTurmaAluno = await this.resolverDadosContratoPorTurmaAluno(id_turma, turmaAlunoIds);
        const resultado = new Map<string, string[]>();
        for (const [idTa, dadosContrato] of dadosContratoPorTurmaAluno.entries()) {
            resultado.set(idTa, this.extrairFormasDeContrato(dadosContrato));
        }
        return resultado;
    }

    /**
     * Extrai do `dados_contrato` os detalhes do BOLETO da venda (quando houver):
     * número de parcelas (item BOLETO de formas_pagamento), data do 1º boleto e
     * melhor dia de vencimento (campos_variaveis). Usado pelo frontend para exibir
     * o boleto atual conforme a data do sistema.
     */
    private extrairBoletoDeContrato(dadosContrato: any): { parcelas: number | null; data_primeiro_boleto: string | null; dia_vencimento: number | null } | null {
        const formasItens = Array.isArray(dadosContrato?.pagamento?.formas_pagamento)
            ? dadosContrato.pagamento.formas_pagamento
            : Array.isArray(dadosContrato?.formas_pagamento)
              ? dadosContrato.formas_pagamento
              : [];
        const itemBoleto = formasItens.find((item: any) => typeof item?.forma === 'string' && item.forma.toUpperCase().trim() === EFormasPagamento.BOLETO);
        if (!itemBoleto) {
            return null;
        }

        const parcelasRaw = itemBoleto.parcelas;
        const parcelasNum = typeof parcelasRaw === 'string' ? parseInt(parcelasRaw, 10) : parcelasRaw;
        const parcelas = Number.isFinite(parcelasNum) && parcelasNum > 0 ? Number(parcelasNum) : null;

        const camposVariaveis = dadosContrato?.campos_variaveis ?? {};
        const dataPrimeiroRaw = camposVariaveis['Data do Primeiro Boleto'];
        const data_primeiro_boleto = typeof dataPrimeiroRaw === 'string' && dataPrimeiroRaw.trim() ? dataPrimeiroRaw.trim() : null;

        const diaRaw = camposVariaveis['Melhor Dia para Boleto'] ?? camposVariaveis['Dia de Vencimento do Boleto'];
        const diaNum = typeof diaRaw === 'string' ? parseInt(diaRaw, 10) : diaRaw;
        const dia_vencimento = Number.isFinite(diaNum) && diaNum >= 1 && diaNum <= 31 ? Number(diaNum) : null;

        return { parcelas, data_primeiro_boleto, dia_vencimento };
    }

    /**
     * Extrai a observação interna da venda ("uso do sistema") do contrato — o mesmo texto
     * editável no Histórico de Vendas. Fica em `dados_contrato.campos_variaveis`.
     */
    private extrairObservacaoVendaDeContrato(dadosContrato: any): string {
        const camposVariaveis = dadosContrato?.campos_variaveis;
        const texto = camposVariaveis?.['Observações Internas (uso do sistema)'];
        return typeof texto === 'string' ? texto.trim() : '';
    }

    /**
     * Resolve, para cada matrícula (turmas_alunos), o `dados_contrato` do contrato que trouxe o
     * aluno para a turma, percorrendo a cadeia de transferências para trás. Base compartilhada
     * para derivar formas de pagamento e a observação interna da venda.
     */
    private async resolverDadosContratoPorTurmaAluno(id_turma: number, turmaAlunoIds: string[]): Promise<Map<string, any>> {
        const resultado = new Map<string, any>();
        if (!turmaAlunoIds || turmaAlunoIds.length === 0) {
            return resultado;
        }

        try {
            const linhas: Array<{ id_ta: string; dados_contrato: any }> = await this.uow.turmasAlunosRP.query(
                `
                WITH RECURSIVE alvo AS (
                    SELECT ta.id AS id_ta, ta.id_aluno
                    FROM turmas_alunos ta
                    WHERE ta.id_turma = $1
                      AND ta.id = ANY($2::bigint[])
                      AND ta.deletado_em IS NULL
                ),
                -- Uma matrícula "canônica" por (turma, aluno): a mais recente. Garante que a
                -- travessia da cadeia seja determinística (1 predecessor por turma), evitando
                -- ramificações/explosão quando há matrículas duplicadas do mesmo aluno na turma.
                canonica AS (
                    SELECT DISTINCT ON (ta.id_turma, ta.id_aluno)
                        ta.id, ta.id_turma, ta.id_aluno, ta.id_turma_transferencia_de
                    FROM turmas_alunos ta
                    WHERE ta.id_aluno IN (SELECT id_aluno FROM alvo)
                    ORDER BY ta.id_turma, ta.id_aluno, ta.criado_em DESC, ta.id DESC
                ),
                -- Cadeia de matrículas do mesmo aluno seguindo as transferências para trás.
                -- "turmas_visitadas" evita ciclos (transferências de ida e volta).
                cadeia AS (
                    SELECT
                        a.id_ta AS id_alvo,
                        base.id AS id_ta_chain,
                        base.id_aluno,
                        base.id_turma AS turma_chain,
                        base.id_turma_transferencia_de,
                        1 AS profundidade,
                        ARRAY[base.id_turma] AS turmas_visitadas
                    FROM alvo a
                    JOIN turmas_alunos base ON base.id = a.id_ta
                    UNION ALL
                    SELECT
                        c.id_alvo,
                        canon.id,
                        canon.id_aluno,
                        canon.id_turma,
                        canon.id_turma_transferencia_de,
                        c.profundidade + 1,
                        c.turmas_visitadas || canon.id_turma
                    FROM cadeia c
                    JOIN canonica canon
                      ON canon.id_aluno = c.id_aluno
                     AND canon.id_turma = c.id_turma_transferencia_de
                    WHERE c.id_turma_transferencia_de IS NOT NULL
                      AND c.profundidade < 20
                      AND NOT (c.id_turma_transferencia_de = ANY(c.turmas_visitadas))
                ),
                contratos AS (
                    SELECT c.id_alvo AS id_ta, c.profundidade, ctr.id AS id_contrato, ctr.criado_em, ctr.dados_contrato
                    FROM cadeia c
                    JOIN turmas_alunos_treinamentos tat
                      ON tat.deletado_em IS NULL
                     AND (
                          tat.id_turma_aluno = c.id_ta_chain
                          OR (
                              tat.id_turma_destino = c.turma_chain
                              AND EXISTS (
                                  SELECT 1 FROM turmas_alunos ta_o
                                  WHERE ta_o.id = tat.id_turma_aluno
                                    AND ta_o.id_aluno = c.id_aluno
                              )
                          )
                     )
                    JOIN turmas_alunos_treinamentos_contratos ctr
                      ON ctr.id_turma_aluno_treinamento = tat.id
                     AND ctr.deletado_em IS NULL
                )
                SELECT DISTINCT ON (id_ta) id_ta, dados_contrato
                FROM contratos
                ORDER BY id_ta, profundidade ASC, criado_em DESC, id_contrato DESC
                `,
                [id_turma, turmaAlunoIds],
            );

            for (const linha of linhas) {
                resultado.set(String(linha.id_ta), linha.dados_contrato);
            }
        } catch (error) {
            this.logger.error('turma.aluno.contrato | Falha ao resolver dados do contrato', error instanceof Error ? error.stack : undefined);
        }

        return resultado;
    }

    /**
     * Resolve o acessor "efetivo" de cada matrícula. Assim como a forma de pagamento, o acessor
     * acompanha o aluno conforme ele é transferido entre turmas: quando a matrícula atual não tem
     * acessor próprio, percorremos a cadeia de transferências (para trás) e usamos o acessor da
     * matrícula anterior mais próxima que o possua. Retorna Map<id_turma_aluno, { id, nome }>.
     */
    private async resolverAcessorPorTurmaAluno(id_turma: number, turmaAlunoIds: string[]): Promise<Map<string, { id: number; nome: string }>> {
        const resultado = new Map<string, { id: number; nome: string }>();
        if (!turmaAlunoIds || turmaAlunoIds.length === 0) {
            return resultado;
        }

        try {
            const linhas: Array<{ id_ta: string; id_acessor: number; nome_acessor: string }> = await this.uow.turmasAlunosRP.query(
                `
                WITH RECURSIVE alvo AS (
                    SELECT ta.id AS id_ta, ta.id_aluno
                    FROM turmas_alunos ta
                    WHERE ta.id_turma = $1
                      AND ta.id = ANY($2::bigint[])
                      AND ta.deletado_em IS NULL
                ),
                -- Matrícula canônica por (turma, aluno): mais recente. Torna a travessia
                -- determinística (1 predecessor por turma), sem ramificação/explosão.
                canonica AS (
                    SELECT DISTINCT ON (ta.id_turma, ta.id_aluno)
                        ta.id, ta.id_turma, ta.id_aluno, ta.id_acessor, ta.id_turma_transferencia_de
                    FROM turmas_alunos ta
                    WHERE ta.id_aluno IN (SELECT id_aluno FROM alvo)
                    ORDER BY ta.id_turma, ta.id_aluno, ta.criado_em DESC, ta.id DESC
                ),
                cadeia AS (
                    SELECT
                        a.id_ta AS id_alvo,
                        base.id_aluno,
                        base.id_acessor,
                        base.id_turma,
                        base.id_turma_transferencia_de,
                        1 AS profundidade,
                        ARRAY[base.id_turma] AS turmas_visitadas
                    FROM alvo a
                    JOIN turmas_alunos base ON base.id = a.id_ta
                    UNION ALL
                    SELECT
                        c.id_alvo,
                        canon.id_aluno,
                        canon.id_acessor,
                        canon.id_turma,
                        canon.id_turma_transferencia_de,
                        c.profundidade + 1,
                        c.turmas_visitadas || canon.id_turma
                    FROM cadeia c
                    JOIN canonica canon
                      ON canon.id_aluno = c.id_aluno
                     AND canon.id_turma = c.id_turma_transferencia_de
                    WHERE c.id_turma_transferencia_de IS NOT NULL
                      AND c.profundidade < 20
                      AND NOT (c.id_turma_transferencia_de = ANY(c.turmas_visitadas))
                ),
                acessores AS (
                    SELECT c.id_alvo AS id_ta, c.profundidade, u.id AS id_acessor, u.nome AS nome_acessor
                    FROM cadeia c
                    JOIN usuarios u ON u.id = c.id_acessor
                    WHERE c.id_acessor IS NOT NULL
                )
                SELECT DISTINCT ON (id_ta) id_ta, id_acessor, nome_acessor
                FROM acessores
                ORDER BY id_ta, profundidade ASC
                `,
                [id_turma, turmaAlunoIds],
            );

            for (const linha of linhas) {
                if (linha.id_acessor != null) {
                    resultado.set(String(linha.id_ta), { id: Number(linha.id_acessor), nome: linha.nome_acessor });
                }
            }
        } catch (error) {
            this.logger.error('turma.aluno.acessor | Falha ao resolver acessor', error instanceof Error ? error.stack : undefined);
        }

        return resultado;
    }

    async getAlunosTurma(id_turma: number, page: number = 1, limit: number = 10): Promise<AlunosTurmaListResponseDto> {
        try {
            const turma = await this.uow.turmasRP.findOne({
                where: { id: id_turma, deletado_em: IsNull() as any },
                relations: ['id_treinamento_fk'],
            });
            if (!turma) {
                throw new NotFoundException('Turma não encontrada');
            }

            const isMentoria = turma.id_treinamento_fk?.tipo_mentoria === true;

            const relacoesAlunos = [
                'id_aluno_fk',
                'id_acessor_fk',
                'id_turma_transferencia_para_fk',
                'id_turma_transferencia_para_fk.id_treinamento_fk',
                'id_turma_transferencia_para_fk.id_polo_fk',
                'id_turma_transferencia_de_fk',
                'id_turma_transferencia_de_fk.id_treinamento_fk',
                'id_turma_transferencia_de_fk.id_polo_fk',
            ];
            if (isMentoria) {
                relacoesAlunos.push('turmasAlunosTreinamentos');
            }

            const [turmasAlunos, total] = await this.uow.turmasAlunosRP.findAndCount({
                where: { id_turma, deletado_em: null },
                relations: relacoesAlunos,
                select: isMentoria ? this.turmaAlunoListSelectComMentoria() : this.turmaAlunoListSelect,
                order: { criado_em: 'DESC' },
                skip: (page - 1) * limit,
                take: limit,
            });

            // Mentorias: as datas seguem a regra início = created_at do aluno na turma e
            // fim = início + duração (meses) do treinamento. Um override explícito no contrato
            // (turmas_alunos_treinamentos) tem prioridade quando existir.
            const datasMentoriaPorTurmaAluno = new Map<string, { inicio: string | null; fim: string | null }>();
            if (isMentoria) {
                // Liberty = 12 meses e Liberty Begin = 6 meses por regra de negócio;
                // demais mentorias usam a duração configurada (padrão 12).
                const duracaoMesesMentoria = resolverDuracaoMentoriaMeses({
                    treinamento: turma.id_treinamento_fk?.treinamento,
                    duracao_meses: turma.id_treinamento_fk?.duracao_meses,
                });
                const paraDataIso = (valor?: Date | string | null): string | null => {
                    if (!valor) return null;
                    const data = valor instanceof Date ? valor : new Date(valor);
                    if (Number.isNaN(data.getTime())) return null;
                    return data.toISOString().slice(0, 10);
                };
                const somarMeses = (iso: string | null, meses: number | null): string | null => {
                    if (!iso || meses == null) return null;
                    const [ano, mes, dia] = iso.split('-').map((n) => parseInt(n, 10));
                    const base = new Date(Date.UTC(ano, mes - 1, dia));
                    base.setUTCMonth(base.getUTCMonth() + meses);
                    return base.toISOString().slice(0, 10);
                };
                for (const ta of turmasAlunos) {
                    const linhas = (ta as any).turmasAlunosTreinamentos as TurmasAlunosTreinamentos[] | undefined;
                    const linhasAtivas = Array.isArray(linhas) ? linhas.filter((l) => !(l as any).deletado_em) : [];
                    const linhaMentoria =
                        linhasAtivas.find((l) => String(l.id_turma_destino) === String(id_turma) && l.data_inicio_mentoria != null) ||
                        linhasAtivas.find((l) => l.id_treinamento === turma.id_treinamento && l.data_inicio_mentoria != null) ||
                        linhasAtivas.find((l) => l.data_inicio_mentoria != null);
                    const inicio = linhaMentoria?.data_inicio_mentoria ?? paraDataIso(ta.criado_em);
                    const fim = linhaMentoria?.data_fim_mentoria ?? somarMeses(inicio, duracaoMesesMentoria);
                    datasMentoriaPorTurmaAluno.set(ta.id, { inicio: inicio ?? null, fim: fim ?? null });
                }
            }

            const turmaAlunoIds = turmasAlunos.map((item) => item.id);
            const canalIngressoPorTurmaAlunoId = new Map<string, 'MASTERCLASS' | 'TIME_VENDAS' | 'DEMAIS_IMPORTACAO'>();

            if (turmaAlunoIds.length > 0) {
                const canaisRaw = await this.uow.turmasAlunosRP
                    .createQueryBuilder('ta')
                    .select('ta.id', 'id_turma_aluno')
                    .addSelect(
                        `(EXISTS (
                            SELECT 1
                            FROM historico_transferencias_alunos h
                            WHERE h.id_turma_aluno_para = ta.id
                              AND h.id_turma_para = :id_turma
                              AND h.id_turma_de = :id_turma
                              AND h.deletado_em IS NULL
                        ))`,
                        'hist_time_vendas',
                    )
                    .addSelect(
                        `(
                            COALESCE((
                                SELECT (
                                    (tr.tipo_palestra = true OR tr.tipo_treinamento = false)
                                    OR (
                                        t_de.edicao_turma IS NOT NULL
                                        AND LEFT(UPPER(TRIM(t_de.edicao_turma)), 3) = 'MC_'
                                    )
                                )
                                FROM historico_transferencias_alunos h
                                INNER JOIN turmas t_de ON t_de.id = h.id_turma_de
                                INNER JOIN treinamentos tr ON tr.id = t_de.id_treinamento
                                WHERE h.id_turma_aluno_para = ta.id
                                  AND h.id_turma_para = :id_turma
                                  AND h.id_turma_de <> :id_turma
                                  AND h.deletado_em IS NULL
                                ORDER BY h.id DESC
                                LIMIT 1
                            ), false)
                            OR (
                                ta.id_turma_transferencia_de IS NOT NULL
                                AND EXISTS (
                                    SELECT 1
                                    FROM turmas t_td
                                    INNER JOIN treinamentos tr_td ON tr_td.id = t_td.id_treinamento
                                    WHERE t_td.id = ta.id_turma_transferencia_de
                                      AND t_td.deletado_em IS NULL
                                      AND (
                                          tr_td.tipo_palestra = true
                                          OR tr_td.tipo_treinamento = false
                                          OR (
                                              t_td.edicao_turma IS NOT NULL
                                              AND LEFT(UPPER(TRIM(t_td.edicao_turma)), 3) = 'MC_'
                                          )
                                      )
                                )
                            )
                            OR (
                                ta.codigo_turma_origem_planilha IS NOT NULL
                                AND LEFT(UPPER(TRIM(ta.codigo_turma_origem_planilha)), 3) = 'MC_'
                            )
                        )`,
                        'origem_turma_eh_palestra_ou_masterclass',
                    )
                    .where('ta.id_turma = :id_turma', { id_turma })
                    .andWhere('ta.id IN (:...turmaAlunoIds)', { turmaAlunoIds })
                    .andWhere('ta.deletado_em IS NULL')
                    .setParameter('id_turma', id_turma)
                    .getRawMany();

                const isTruthyPgBool = (v: unknown): boolean => v === true || v === 'true' || v === 't' || v === 1 || v === '1';

                for (const row of canaisRaw) {
                    const idTurmaAluno = String(row.id_turma_aluno);
                    if (isTruthyPgBool(row.hist_time_vendas)) {
                        canalIngressoPorTurmaAlunoId.set(idTurmaAluno, 'TIME_VENDAS');
                        continue;
                    }
                    if (isTruthyPgBool(row.origem_turma_eh_palestra_ou_masterclass)) {
                        canalIngressoPorTurmaAlunoId.set(idTurmaAluno, 'MASTERCLASS');
                        continue;
                    }
                    canalIngressoPorTurmaAlunoId.set(idTurmaAluno, 'DEMAIS_IMPORTACAO');
                }
            }

            // Dados do contrato que trouxe cada aluno para a turma (resolvido uma única vez):
            // dele derivamos a(s) forma(s) de pagamento e a observação interna da venda.
            const dadosContratoPorTurmaAlunoId = await this.resolverDadosContratoPorTurmaAluno(id_turma, turmaAlunoIds);
            const formasPagamentoPorTurmaAlunoId = new Map<string, string[]>();
            const observacaoVendaPorTurmaAlunoId = new Map<string, string>();
            const boletoContratoPorTurmaAlunoId = new Map<string, { parcelas: number | null; data_primeiro_boleto: string | null; dia_vencimento: number | null }>();
            for (const [idTa, dadosContrato] of dadosContratoPorTurmaAlunoId.entries()) {
                const formasContrato = this.extrairFormasDeContrato(dadosContrato);
                formasPagamentoPorTurmaAlunoId.set(idTa, formasContrato);
                if (formasContrato.includes(EFormasPagamento.BOLETO)) {
                    const boletoContrato = this.extrairBoletoDeContrato(dadosContrato);
                    if (boletoContrato) {
                        boletoContratoPorTurmaAlunoId.set(idTa, boletoContrato);
                    }
                }
                const observacao = this.extrairObservacaoVendaDeContrato(dadosContrato);
                if (observacao) {
                    observacaoVendaPorTurmaAlunoId.set(idTa, observacao);
                }
            }
            // Acessor efetivo (carrega junto nas transferências quando a matrícula atual não tem o próprio).
            const acessorPorTurmaAlunoId = await this.resolverAcessorPorTurmaAluno(id_turma, turmaAlunoIds);
            // Canal/categoria reclassificados (MESMA regra do dashboard e da planilha), para a lista exibir igual.
            const classificacaoPorTurmaAlunoId = await this.getClassificacaoOrigemPorTurmaAluno(id_turma, turmaAlunoIds);

            const alunosResponse: AlunoTurmaResponseDto[] = turmasAlunos.map((turmaAluno) => {
                const formasContratoAluno = formasPagamentoPorTurmaAlunoId.get(turmaAluno.id) ?? [];
                // Sem contrato que resolva a forma de pagamento, vale a forma definida
                // MANUALMENTE pelo usuário (negociação extra sistema), quando houver.
                const formaManual = formasContratoAluno.length === 0 ? (turmaAluno.forma_pagamento_manual ?? null) : null;
                const formasAluno = formaManual ? [formaManual] : formasContratoAluno;
                const veioPorBoleto = formasAluno.includes(EFormasPagamento.BOLETO);
                const acessorResolvido = acessorPorTurmaAlunoId.get(turmaAluno.id) ?? null;
                const acessor = turmaAluno.id_acessor_fk ? { id: turmaAluno.id_acessor_fk.id, nome: turmaAluno.id_acessor_fk.nome } : acessorResolvido;
                return {
                    id: turmaAluno.id,
                    id_turma: turmaAluno.id_turma,
                    id_aluno: turmaAluno.id_aluno,
                    nome_cracha: turmaAluno.id_aluno_fk?.nome_cracha || turmaAluno.id_aluno_fk?.nome || '',
                    numero_cracha: turmaAluno.numero_cracha,
                    vaga_bonus: turmaAluno.vaga_bonus,
                    origem_aluno: turmaAluno.origem_aluno ?? undefined,
                    origem_canal_ingresso:
                        turmaAluno.origem_aluno === EOrigemAlunos.COMPROU_INGRESSO
                            ? canalIngressoPorTurmaAlunoId.get(turmaAluno.id) || 'DEMAIS_IMPORTACAO'
                            : undefined,
                    canal: classificacaoPorTurmaAlunoId.get(turmaAluno.id)?.canal,
                    categoria: classificacaoPorTurmaAlunoId.get(turmaAluno.id)?.categoria,
                    status_aluno_turma: turmaAluno.status_aluno_turma,
                    confirmacao_realizada: turmaAluno.confirmacao_realizada,
                    checkin_realizado: turmaAluno.checkin_realizado,
                    presenca_turma: turmaAluno.presenca_turma,
                    data_inicio_mentoria: datasMentoriaPorTurmaAluno.get(turmaAluno.id)?.inicio ?? null,
                    data_fim_mentoria: datasMentoriaPorTurmaAluno.get(turmaAluno.id)?.fim ?? null,
                    url_comprovante_pgto: turmaAluno.url_comprovante_pgto,
                    pendencia_pagamento: turmaAluno.pendencia_pagamento ?? undefined,
                    quantidade_inscricoes: turmaAluno.quantidade_inscricoes ?? 1,
                    outros_clientes: turmaAluno.outros_clientes ?? [],
                    contrato_duplo: (turmaAluno.quantidade_inscricoes ?? 1) > 1,
                    tem_comprovante_pagamento: Boolean(turmaAluno.url_comprovante_pgto?.trim()),
                    forma_pagamento: this.formatarFormaPagamentoLabel(formasAluno),
                    formas_pagamento: formasAluno,
                    veio_por_boleto: veioPorBoleto,
                    forma_pagamento_manual: formaManual,
                    boleto_dia_vencimento_manual: formaManual === EFormasPagamento.BOLETO ? (turmaAluno.boleto_dia_vencimento_manual ?? null) : null,
                    boleto_quantidade_manual: formaManual === EFormasPagamento.BOLETO ? (turmaAluno.boleto_quantidade_manual ?? null) : null,
                    boleto_contrato: boletoContratoPorTurmaAlunoId.get(turmaAluno.id) ?? null,
                    id_acessor: turmaAluno.id_acessor ?? acessorResolvido?.id ?? null,
                    acessor,
                    created_at: turmaAluno.criado_em,
                    transferido_por_robo: turmaAluno.transferido_por_robo === true,
                    observacao_venda: observacaoVendaPorTurmaAlunoId.get(turmaAluno.id) ?? undefined,
                    transferencia_para_turma: this.mapTurmaToTransferenciaTag(turmaAluno.id_turma_transferencia_para_fk),
                    transferencia_de_turma: this.mapTurmaToTransferenciaTag(turmaAluno.id_turma_transferencia_de_fk),
                    aluno: turmaAluno.id_aluno_fk
                        ? {
                              id: turmaAluno.id_aluno_fk.id,
                              nome: turmaAluno.id_aluno_fk.nome,
                              email: turmaAluno.id_aluno_fk.email,
                              telefone: turmaAluno.id_aluno_fk.telefone_um,
                              telefone_um: turmaAluno.id_aluno_fk.telefone_um,
                              telefone_dois: turmaAluno.id_aluno_fk.telefone_dois,
                              nome_cracha: turmaAluno.id_aluno_fk.nome_cracha,
                              cpf: turmaAluno.id_aluno_fk.cpf,
                              instagram: turmaAluno.id_aluno_fk.instagram,
                              cep: turmaAluno.id_aluno_fk.cep,
                              logradouro: turmaAluno.id_aluno_fk.logradouro,
                              complemento: turmaAluno.id_aluno_fk.complemento,
                              numero: turmaAluno.id_aluno_fk.numero,
                              bairro: turmaAluno.id_aluno_fk.bairro,
                              cidade: turmaAluno.id_aluno_fk.cidade,
                              estado: turmaAluno.id_aluno_fk.estado,
                              profissao: turmaAluno.id_aluno_fk.profissao,
                              genero: turmaAluno.id_aluno_fk.genero,
                              data_nascimento: turmaAluno.id_aluno_fk.data_nascimento,
                              status_aluno_geral: turmaAluno.id_aluno_fk.status_aluno_geral,
                              possui_deficiencia: turmaAluno.id_aluno_fk.possui_deficiencia,
                              desc_deficiencia: turmaAluno.id_aluno_fk.desc_deficiencia,
                          }
                        : undefined,
                    ficha_preenchida: this.isFichaPreenchida(turmaAluno.id_aluno_fk),
                };
            });

            const totalPages = Math.ceil(total / limit);

            return {
                data: alunosResponse,
                total,
                page,
                limit,
                totalPages,
            };
        } catch (error) {
            console.error('Erro ao buscar alunos da turma:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao buscar alunos da turma');
        }
    }

    /**
     * Classifica cada aluno da turma no MESMO canal usado pelo dashboard (buckets mutuamente
     * exclusivos por prioridade), retornando o rótulo do canal e a categoria (Extra/Compra de ingresso)
     * Espelha exatamente a partição de `getTurmaStatusResumo` (bônus > cortesia/sorteio > time de vendas
     * > transbordo > liberty > masterclass > transferência > demais). TRANSBORDO/LIBERTY = compra de ingresso.
     */
    private async getClassificacaoOrigemPorTurmaAluno(id_turma: number, turmaAlunoIds?: string[]): Promise<Map<string, { canal: string; categoria: string }>> {
        const isTruthyPgBool = (v: unknown): boolean => v === true || v === 'true' || v === 't' || v === 1 || v === '1';
        const labelPorBucket: Record<string, string> = {
            presente: 'Presente',
            bonus: 'Bônus',
            cortesia_sorteio: 'Cortesia/Sorteio',
            transferencia: 'Transferência',
            masterclass: 'Masterclass',
            time_vendas: 'Time de Vendas',
            transbordo: 'Transbordo',
            liberty: 'Liberty',
            importacao: 'Vendas em Eventos',
        };
        // Espelha o card de Extras do dashboard: extras = presente + bônus + cortesia/sorteio + transferência.
        const bucketsExtra = new Set(['presente', 'bonus', 'cortesia_sorteio', 'transferencia']);

        if (turmaAlunoIds && turmaAlunoIds.length === 0) {
            return new Map();
        }

        const qb = this.uow.turmasAlunosRP
            .createQueryBuilder('ta')
            .select('ta.id', 'id')
            .addSelect('ta.origem_aluno', 'origem_aluno')
            .addSelect('ta.vaga_bonus', 'vaga_bonus')
            .addSelect('ta.codigo_turma_origem_planilha', 'codigo')
            .addSelect(
                `(EXISTS (
                    SELECT 1 FROM historico_transferencias_alunos h
                    WHERE h.id_turma_aluno_para = ta.id
                      AND h.id_turma_para = :id_turma AND h.id_turma_de = :id_turma
                      AND h.deletado_em IS NULL
                ))`,
                'hist_time_vendas',
            )
            .addSelect(
                `(
                    COALESCE((
                        SELECT ((tr.tipo_palestra = true OR tr.tipo_treinamento = false)
                                OR (t_de.edicao_turma IS NOT NULL AND LEFT(UPPER(TRIM(t_de.edicao_turma)), 3) = 'MC_'))
                        FROM historico_transferencias_alunos h
                        INNER JOIN turmas t_de ON t_de.id = h.id_turma_de
                        INNER JOIN treinamentos tr ON tr.id = t_de.id_treinamento
                        WHERE h.id_turma_aluno_para = ta.id AND h.id_turma_para = :id_turma
                          AND h.id_turma_de <> :id_turma AND h.deletado_em IS NULL
                        ORDER BY h.id DESC LIMIT 1
                    ), false)
                    OR (
                        ta.id_turma_transferencia_de IS NOT NULL
                        AND EXISTS (
                            SELECT 1 FROM turmas t_td
                            INNER JOIN treinamentos tr_td ON tr_td.id = t_td.id_treinamento
                            WHERE t_td.id = ta.id_turma_transferencia_de AND t_td.deletado_em IS NULL
                              AND (tr_td.tipo_palestra = true OR tr_td.tipo_treinamento = false
                                   OR (t_td.edicao_turma IS NOT NULL AND LEFT(UPPER(TRIM(t_td.edicao_turma)), 3) = 'MC_'))
                        )
                    )
                    OR (ta.codigo_turma_origem_planilha IS NOT NULL AND LEFT(UPPER(TRIM(ta.codigo_turma_origem_planilha)), 3) = 'MC_')
                )`,
                'origem_eh_mc',
            )
            .where('ta.id_turma = :id_turma', { id_turma })
            .andWhere('ta.deletado_em IS NULL')
            .setParameter('id_turma', id_turma);

        if (turmaAlunoIds && turmaAlunoIds.length > 0) {
            qb.andWhere('ta.id IN (:...turmaAlunoIds)', { turmaAlunoIds });
        }

        const rows = await qb.getRawMany();

        const mapa = new Map<string, { canal: string; categoria: string }>();
        for (const row of rows) {
            const origemAluno = Object.values(EOrigemAlunos).includes(row.origem_aluno as EOrigemAlunos) ? (row.origem_aluno as EOrigemAlunos) : null;
            const vagaBonus = Boolean(row.vaga_bonus);
            const codigo = String(row.codigo || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim()
                .toUpperCase();
            const histTimeVendas = isTruthyPgBool(row.hist_time_vendas);
            const origemEhMc = isTruthyPgBool(row.origem_eh_mc);

            let bucket = 'importacao';
            // Presente (importação Masterclass): origem própria, conta como extra. Tem prioridade
            // sobre os demais buckets (inclusive MC_*) para não ser reclassificado.
            if (origemAluno === EOrigemAlunos.PRESENTE) bucket = 'presente';
            else if (vagaBonus || origemAluno === EOrigemAlunos.ALUNO_BONUS) bucket = 'bonus';
            else if (origemAluno === EOrigemAlunos.CORTESIA || origemAluno === EOrigemAlunos.SORTEIO) bucket = 'cortesia_sorteio';
            else if (histTimeVendas) bucket = 'time_vendas';
            else if (codigo === 'TRANSBORDO') bucket = 'transbordo';
            else if (codigo === 'LIBERTY') bucket = 'liberty';
            else if (origemEhMc) bucket = 'masterclass';
            else if (origemAluno === EOrigemAlunos.TRANSFERENCIA) bucket = 'transferencia';

            mapa.set(String(row.id), {
                canal: labelPorBucket[bucket] ?? 'Vendas em Eventos',
                categoria: bucketsExtra.has(bucket) ? 'Extra' : 'Compra de Ingresso',
            });
        }
        return mapa;
    }

    /** Listagem enxuta para exportação XLSX — sem comprovantes base64; inclui canal/categoria do dashboard. */
    async getAlunosTurmaExport(id_turma: number): Promise<AlunosTurmaExportResponseDto> {
        try {
            const turma = await this.uow.turmasRP.findOne({
                where: { id: id_turma, deletado_em: IsNull() as any },
                select: { id: true },
            });
            if (!turma) {
                throw new NotFoundException('Turma não encontrada');
            }

            const turmasAlunos = await this.uow.turmasAlunosRP.find({
                where: { id_turma, deletado_em: null },
                relations: ['id_aluno_fk'],
                select: {
                    id: true,
                    id_aluno: true,
                    numero_cracha: true,
                    status_aluno_turma: true,
                    origem_aluno: true,
                    criado_em: true,
                    id_aluno_fk: {
                        id: true,
                        nome: true,
                        nome_cracha: true,
                        email: true,
                        telefone_um: true,
                        telefone_dois: true,
                    },
                },
                order: { criado_em: 'DESC' },
            });

            // Canal/categoria reclassificados (mesma regra do dashboard) para os totais da planilha baterem com os indicadores.
            const classificacao = await this.getClassificacaoOrigemPorTurmaAluno(id_turma);

            const data = turmasAlunos.map((turmaAluno) => {
                const classe = classificacao.get(String(turmaAluno.id));
                return {
                    nome: turmaAluno.id_aluno_fk?.nome ?? '',
                    email: turmaAluno.id_aluno_fk?.email ?? '',
                    telefone_um: turmaAluno.id_aluno_fk?.telefone_um ?? undefined,
                    telefone_dois: turmaAluno.id_aluno_fk?.telefone_dois ?? undefined,
                    nome_cracha: turmaAluno.id_aluno_fk?.nome_cracha || turmaAluno.id_aluno_fk?.nome || '',
                    numero_cracha: turmaAluno.numero_cracha ?? '',
                    status_aluno_turma: turmaAluno.status_aluno_turma ?? undefined,
                    origem_aluno: turmaAluno.origem_aluno ?? undefined,
                    canal: classe?.canal ?? 'Vendas em Eventos',
                    categoria: classe?.categoria ?? 'Compra de Ingresso',
                    created_at: turmaAluno.criado_em instanceof Date ? turmaAluno.criado_em.toISOString() : String(turmaAluno.criado_em ?? ''),
                };
            });

            return { data, total: data.length };
        } catch (error) {
            console.error('Erro ao exportar alunos da turma:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao exportar alunos da turma');
        }
    }

    /**
     * Lista as matrículas de bônus (origem ALUNO_BONUS) vinculadas a um comprador,
     * restritas às turmas de Imersão Prosperar (IPR). Usado na edição de venda do
     * histórico para gerenciar (editar/remover/acrescentar) os bônus do comprador.
     */
    async getBonusMatriculasComprador(idAlunoComprador: number): Promise<
        Array<{
            id_turma_aluno: string;
            id_turma: number;
            id_aluno: string | null;
            edicao_turma: string;
            treinamento_nome: string;
            sigla_treinamento: string;
        }>
    > {
        const matriculas = await this.uow.turmasAlunosRP
            .createQueryBuilder('ta')
            .leftJoinAndSelect('ta.id_turma_fk', 'turma')
            .leftJoinAndSelect('turma.id_treinamento_fk', 'treinamento')
            .where('ta.id_aluno_bonus = :idAlunoComprador', { idAlunoComprador: String(idAlunoComprador) })
            .andWhere('ta.origem_aluno = :origemBonus', { origemBonus: EOrigemAlunos.ALUNO_BONUS })
            .andWhere('ta.deletado_em IS NULL')
            .getMany();

        const ehTurmaIpr = (sigla?: string, nome?: string): boolean => {
            const siglaNorm = String(sigla || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim()
                .toLowerCase();
            const nomeNorm = String(nome || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim()
                .toLowerCase();
            return siglaNorm === 'ipr' || nomeNorm.includes('imersao prosperar');
        };

        return matriculas
            .filter((ta) => {
                const treinamento = ta.id_turma_fk?.id_treinamento_fk;
                return ehTurmaIpr(treinamento?.sigla_treinamento, treinamento?.treinamento);
            })
            .map((ta) => ({
                id_turma_aluno: String(ta.id),
                id_turma: Number(ta.id_turma),
                id_aluno: ta.id_aluno ? String(ta.id_aluno) : null,
                edicao_turma: ta.id_turma_fk?.edicao_turma ?? '',
                treinamento_nome: ta.id_turma_fk?.id_treinamento_fk?.treinamento ?? '',
                sigla_treinamento: ta.id_turma_fk?.id_treinamento_fk?.sigla_treinamento ?? '',
            }));
    }

    async addAlunoTurma(id_turma: number, addAlunoDto: AddAlunoTurmaDto, userId?: number): Promise<AlunoTurmaResponseDto> {
        try {
            const turma = await this.uow.turmasRP.findOne({ where: { id: id_turma } });

            if (!turma) {
                throw new NotFoundException('Turma não encontrada');
            }

            if (turma.status_turma === EStatusTurmas.INSCRICOES_PAUSADAS) {
                throw new BadRequestException('Não é possível adicionar alunos em turmas com inscrições pausadas');
            }

            // A adição de alunos é liberada para qualquer usuário autenticado;
            // a regra de Cuidado de Alunos/acessora vale apenas para a remoção.

            const aluno = await this.uow.alunosRP.findOne({ where: { id: addAlunoDto.id_aluno } });

            if (!aluno) {
                throw new NotFoundException('Aluno não encontrado');
            }

            // Verificar se aluno já está na turma (considerar apenas vínculos ativos)
            const alunoJaNaTurma = await this.uow.turmasAlunosRP.findOne({
                where: { id_turma, id_aluno: addAlunoDto.id_aluno as any, deletado_em: null },
            });

            if (alunoJaNaTurma) {
                throw new BadRequestException('Aluno já está matriculado nesta turma');
            }

            // Gerar número de crachá único para esta turma
            const numeroCracha = await this.generateUniqueCrachaNumber(id_turma);

            // O "como gostaria de ser chamado" agora vem exclusivamente do cadastro do aluno.
            const nomeCracha = aluno.nome_cracha?.trim() || aluno.nome?.trim() || 'Aluno';

            // Debug: Log dos dados recebidos
            this.logger.debug(`turma.aluno.add | Adicionando aluno id=${String(addAlunoDto.id_aluno)} na turma id=${id_turma}`);

            // Criar registro na turmas_alunos
            const dadosParaSalvar = {
                id_turma,
                id_aluno: addAlunoDto.id_aluno as any,
                numero_cracha: numeroCracha,
                vaga_bonus: addAlunoDto.vaga_bonus || false,
                origem_aluno: (addAlunoDto.origem_aluno as EOrigemAlunos) || EOrigemAlunos.COMPROU_INGRESSO,
                status_aluno_turma: addAlunoDto.status_aluno_turma || EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO,
                ...this.buildConfirmacaoCheckinFlags(addAlunoDto.status_aluno_turma || EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO, null),
                ...(addAlunoDto.id_aluno_bonus && { id_aluno_bonus: addAlunoDto.id_aluno_bonus }),
                ...(addAlunoDto.pendencia_pagamento !== undefined && { pendencia_pagamento: addAlunoDto.pendencia_pagamento }),
                ...(addAlunoDto.quantidade_inscricoes !== undefined && { quantidade_inscricoes: addAlunoDto.quantidade_inscricoes }),
                ...(addAlunoDto.outros_clientes !== undefined && { outros_clientes: addAlunoDto.outros_clientes }),
                ...(addAlunoDto.comprovante_pagamento_base64 !== undefined && {
                    comprovante_pagamento_base64: addAlunoDto.comprovante_pagamento_base64,
                }),
            };

            const turmaAluno = this.uow.turmasAlunosRP.create(dadosParaSalvar);

            const turmaAlunoSalva = await this.uow.turmasAlunosRP.save(turmaAluno);

            await this.registrarLogAlunoTurma(
                {
                    id_turma_aluno: turmaAlunoSalva.id,
                    id_turma: turmaAlunoSalva.id_turma,
                    id_aluno: turmaAlunoSalva.id_aluno,
                    tipo_acao: 'CRIACAO',
                    titulo: 'Aluno inscrito na turma',
                    descricao: 'Matrícula criada com sucesso.',
                    detalhes: {
                        origem_aluno: turmaAlunoSalva.origem_aluno,
                        status_aluno_turma: turmaAlunoSalva.status_aluno_turma,
                        nome_cracha: nomeCracha,
                        numero_cracha: turmaAlunoSalva.numero_cracha,
                    },
                },
                userId,
            );

            // Verificar e atualizar status da turma após adicionar aluno
            const turmaAtualizada = await this.uow.turmasRP.findOne({
                where: { id: id_turma },
                relations: ['id_treinamento_fk', 'turmasAlunos'],
            });

            if (turmaAtualizada) {
                await this.verificarEAtualizarStatusTurma(turmaAtualizada);
            }

            // Congela a meta no novo pico de inscritos/extras, se aplicável.
            await this.uow.bumparPicoMetricasTurmas([id_turma]);

            // Retornar com as relações
            const turmaAlunoCompleta = await this.uow.turmasAlunosRP.findOne({
                where: { id: turmaAlunoSalva.id },
                relations: ['id_aluno_fk'],
            });

            return {
                id: turmaAlunoCompleta.id,
                id_turma: turmaAlunoCompleta.id_turma,
                id_aluno: turmaAlunoCompleta.id_aluno,
                nome_cracha: turmaAlunoCompleta.id_aluno_fk?.nome_cracha || turmaAlunoCompleta.id_aluno_fk?.nome || '',
                numero_cracha: turmaAlunoCompleta.numero_cracha,
                vaga_bonus: turmaAlunoCompleta.vaga_bonus,
                confirmacao_realizada: turmaAlunoCompleta.confirmacao_realizada,
                checkin_realizado: turmaAlunoCompleta.checkin_realizado,
                pendencia_pagamento: turmaAlunoCompleta.pendencia_pagamento,
                quantidade_inscricoes: turmaAlunoCompleta.quantidade_inscricoes ?? 1,
                outros_clientes: turmaAlunoCompleta.outros_clientes ?? [],
                contrato_duplo: (turmaAlunoCompleta.quantidade_inscricoes ?? 1) > 1,
                comprovante_pagamento_base64: turmaAlunoCompleta.comprovante_pagamento_base64,
                created_at: turmaAlunoCompleta.criado_em,
                aluno: turmaAlunoCompleta.id_aluno_fk
                    ? {
                          id: turmaAlunoCompleta.id_aluno_fk.id,
                          nome: turmaAlunoCompleta.id_aluno_fk.nome,
                          email: turmaAlunoCompleta.id_aluno_fk.email,
                          nome_cracha: turmaAlunoCompleta.id_aluno_fk.nome_cracha,
                      }
                    : undefined,
            };
        } catch (error) {
            this.logger.error('turma.aluno.add | Erro ao adicionar aluno à turma', error instanceof Error ? error.stack : undefined);
            if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ForbiddenException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao adicionar aluno à turma');
        }
    }

    /**
     * Opções de transferência para um aluno na turma de origem.
     * Retorna sugestões do mesmo treinamento: edição mais próxima por data e próxima edição no mesmo polo.
     */
    async getOpcoesTransferencia(id_turma_aluno: string): Promise<OpcoesTransferenciaResponseDto> {
        const turmaAluno = await this.uow.turmasAlunosRP.findOne({
            where: { id: id_turma_aluno },
            relations: ['id_turma_fk', 'id_turma_fk.id_treinamento_fk', 'id_turma_fk.id_polo_fk'],
        });
        if (!turmaAluno) throw new NotFoundException('Aluno não encontrado na turma');
        const turmaOrigem = turmaAluno.id_turma_fk;
        if (!turmaOrigem) throw new NotFoundException('Turma de origem não encontrada');
        const treinamento = turmaOrigem.id_treinamento_fk;
        if (!treinamento) throw new NotFoundException('Treinamento da turma não encontrado');
        if (treinamento.tipo_palestra === true) {
            throw new BadRequestException('Transferência só é permitida para treinamentos, não para palestras');
        }
        const id_treinamento = turmaOrigem.id_treinamento;
        const id_turma_origem = turmaOrigem.id;
        const id_polo_origem = turmaOrigem.id_polo;
        const hoje = this.formatDateToDateOnly(new Date().toISOString());

        const outrasTurmas = await this.uow.turmasRP.find({
            where: {
                id_treinamento,
                id: Not(id_turma_origem),
            },
            relations: ['id_treinamento_fk', 'id_polo_fk'],
            order: { data_inicio: 'ASC' },
        });
        const turmasTreinamento = outrasTurmas.filter((t) => t.id_treinamento_fk?.tipo_palestra !== true && !this.isTurmaBloqueadaParaTransferencia(t));

        const comDataFutura = turmasTreinamento.filter((t) => (t.data_inicio ?? '') >= hoje);
        const edicaoMaisProximaData = comDataFutura[0] ?? null;
        const mesmoPolo = turmasTreinamento.filter((t) => t.id_polo === id_polo_origem && (t.data_inicio ?? '') >= hoje);
        const proximaEdicaoMesmoPolo = mesmoPolo[0] ?? null;

        const toTurmaResponse = (t: any): TurmaResponseDto =>
            ({
                id: t.id,
                id_polo: t.id_polo,
                id_treinamento: t.id_treinamento,
                edicao_turma: t.edicao_turma,
                data_inicio: t.data_inicio,
                data_final: t.data_final,
                status_turma: t.status_turma,
                capacidade_turma: t.capacidade_turma,
                turma_aberta: t.turma_aberta,
                treinamento_nome: t.id_treinamento_fk?.treinamento,
                sigla_treinamento: t.id_treinamento_fk?.sigla_treinamento,
                polo_nome: t.id_polo_fk?.polo,
            }) as TurmaResponseDto;

        return {
            edicao_mais_proxima_data: edicaoMaisProximaData ? toTurmaResponse(edicaoMaisProximaData) : undefined,
            proxima_edicao_mesmo_polo: proximaEdicaoMesmoPolo ? toTurmaResponse(proximaEdicaoMesmoPolo) : undefined,
        };
    }

    /**
     * Transfere o aluno para outra turma (inclusive de outro treinamento, exceto palestras).
     * Remove o vínculo ativo da turma de origem (soft delete), mantendo lastro no histórico de transferências.
     */
    async transferirAluno(
        id_turma_aluno: string,
        id_turma_destino: number,
        userId?: number,
        opts?: { manterNaOrigem?: boolean; transferidoPorRobo?: boolean },
    ): Promise<AlunoTurmaResponseDto> {
        const turmaAlunoOrigem = await this.uow.turmasAlunosRP.findOne({
            where: { id: id_turma_aluno, deletado_em: null },
            relations: ['id_aluno_fk', 'id_turma_fk', 'id_turma_fk.id_treinamento_fk'],
        });
        if (!turmaAlunoOrigem) throw new NotFoundException('Aluno não encontrado na turma');
        if (!turmaAlunoOrigem.id_aluno_fk) throw new NotFoundException('Aluno vinculado não encontrado');
        const turmaOrigem = turmaAlunoOrigem.id_turma_fk;
        if (!turmaOrigem) throw new NotFoundException('Turma de origem não encontrada');
        const origemEhTurmaInadimplente = this.isTurmaInadimplente(turmaOrigem);
        if (origemEhTurmaInadimplente && turmaAlunoOrigem.id_aluno_fk.status_aluno_geral !== EStatusAlunosGeral.INADIMPLENTE) {
            await this.uow.alunosRP.update({ id: Number(turmaAlunoOrigem.id_aluno) }, { status_aluno_geral: EStatusAlunosGeral.INADIMPLENTE });
            turmaAlunoOrigem.id_aluno_fk.status_aluno_geral = EStatusAlunosGeral.INADIMPLENTE;
        }
        if (turmaOrigem.id_treinamento_fk?.tipo_palestra === true) {
            throw new BadRequestException('Transferência só é permitida para treinamentos, não para palestras');
        }
        if (this.isAlunoTransferidoDaTurma(turmaAlunoOrigem)) {
            const idTurmaDestinoMarcada = Number(turmaAlunoOrigem.id_turma_transferencia_para);
            const matriculaDestinoAtiva = await this.uow.turmasAlunosRP.findOne({
                where: {
                    id_turma: idTurmaDestinoMarcada,
                    id_aluno: turmaAlunoOrigem.id_aluno,
                    deletado_em: null,
                },
                relations: ['id_turma_fk'],
            });

            // Se não existe matrícula ativa na turma de destino marcada (ex.: foi soft delete),
            // limpamos o flag de transferência antiga para permitir uma nova transferência.
            if (!matriculaDestinoAtiva) {
                turmaAlunoOrigem.id_turma_transferencia_para = null;
                await this.uow.turmasAlunosRP.save(turmaAlunoOrigem);
            } else {
                const turmaAtivaDestino = matriculaDestinoAtiva.id_turma_fk;
                const edicaoAtiva = turmaAtivaDestino?.edicao_turma ? String(turmaAtivaDestino.edicao_turma).trim() : '';
                const rotuloTurmaAtiva = edicaoAtiva ? `turma ${edicaoAtiva}` : `turma ${idTurmaDestinoMarcada}`;
                throw new BadRequestException(
                    `Este vínculo já foi transferido desta turma. A matrícula ativa está na ${rotuloTurmaAtiva} — transfira a partir dela.`,
                );
            }
        }

        const turmaDestino = await this.uow.turmasRP.findOne({
            where: { id: id_turma_destino },
            relations: ['id_treinamento_fk', 'id_polo_fk'],
        });
        if (!turmaDestino) throw new NotFoundException('Turma de destino não encontrada');
        if (turmaDestino.id_treinamento_fk?.tipo_palestra === true) {
            throw new BadRequestException('Turma de destino não pode ser palestra');
        }
        const edicaoDestinoNorm = String(turmaDestino.edicao_turma ?? '')
            .trim()
            .toUpperCase();
        if (edicaoDestinoNorm === 'CANCELADA') {
            if (turmaDestino.status_turma === EStatusTurmas.INSCRICOES_PAUSADAS) {
                throw new BadRequestException('Não é possível transferir para turma com inscrições pausadas');
            }
            const idMatriculaDestino = await this.transferirCancelamentoParaTurmaCancelada(turmaAlunoOrigem, turmaDestino, userId);
            const matriculaDestinoCompleta = await this.uow.turmasAlunosRP.findOne({
                where: { id: idMatriculaDestino },
                relations: [
                    'id_aluno_fk',
                    'id_turma_transferencia_de_fk',
                    'id_turma_transferencia_de_fk.id_treinamento_fk',
                    'id_turma_transferencia_de_fk.id_polo_fk',
                ],
            });
            if (!matriculaDestinoCompleta) {
                throw new NotFoundException('Matrícula de destino após transferência para turma CANCELADA não encontrada');
            }
            return {
                id: matriculaDestinoCompleta.id,
                id_turma: matriculaDestinoCompleta.id_turma,
                id_aluno: matriculaDestinoCompleta.id_aluno,
                nome_cracha: matriculaDestinoCompleta.id_aluno_fk?.nome_cracha || matriculaDestinoCompleta.id_aluno_fk?.nome || '',
                numero_cracha: matriculaDestinoCompleta.numero_cracha,
                vaga_bonus: matriculaDestinoCompleta.vaga_bonus,
                origem_aluno: matriculaDestinoCompleta.origem_aluno,
                status_aluno_turma: matriculaDestinoCompleta.status_aluno_turma,
                confirmacao_realizada: matriculaDestinoCompleta.confirmacao_realizada,
                checkin_realizado: matriculaDestinoCompleta.checkin_realizado,
                presenca_turma: matriculaDestinoCompleta.presenca_turma,
                url_comprovante_pgto: matriculaDestinoCompleta.url_comprovante_pgto,
                pendencia_pagamento: matriculaDestinoCompleta.pendencia_pagamento,
                quantidade_inscricoes: matriculaDestinoCompleta.quantidade_inscricoes ?? 1,
                outros_clientes: matriculaDestinoCompleta.outros_clientes ?? [],
                contrato_duplo: (matriculaDestinoCompleta.quantidade_inscricoes ?? 1) > 1,
                comprovante_pagamento_base64: matriculaDestinoCompleta.comprovante_pagamento_base64,
                created_at: matriculaDestinoCompleta.criado_em,
                transferencia_de_turma: this.mapTurmaToTransferenciaTag(matriculaDestinoCompleta.id_turma_transferencia_de_fk),
                aluno: matriculaDestinoCompleta.id_aluno_fk
                    ? {
                          id: matriculaDestinoCompleta.id_aluno_fk.id,
                          nome: matriculaDestinoCompleta.id_aluno_fk.nome,
                          email: matriculaDestinoCompleta.id_aluno_fk.email,
                          nome_cracha: matriculaDestinoCompleta.id_aluno_fk.nome_cracha,
                      }
                    : undefined,
            };
        }
        if (turmaDestino.status_turma === EStatusTurmas.INSCRICOES_PAUSADAS) {
            throw new BadRequestException('Não é possível transferir para turma com inscrições pausadas');
        }
        if (Number(id_turma_destino) === turmaOrigem.id) {
            throw new BadRequestException('Turma de destino deve ser diferente da turma de origem');
        }

        // Não é permitido transferir para uma turma que já ocorreu ou está ocorrendo
        // agora (evento já começou). Mentorias (sem data_inicio) e as transferências
        // automáticas do robô (manterNaOrigem/transferidoPorRobo, que já apontam para
        // turmas futuras) são isentas.
        if (!opts?.transferidoPorRobo && !opts?.manterNaOrigem && turmaDestino.data_inicio) {
            const hojeTransferencia = new Date();
            hojeTransferencia.setHours(0, 0, 0, 0);
            // `data_inicio` é uma coluna `date` (string "YYYY-MM-DD"). `new Date(str)` sem
            // hora é interpretado como meia-noite UTC e, em fusos negativos (BRT, UTC-3),
            // "volta" um dia — fazendo uma turma que começa amanhã ser tratada como se
            // começasse hoje e bloqueando a transferência indevidamente. Parsear como
            // horário LOCAL (append T00:00:00) mantém o dia correto.
            const inicioDestino = new Date(`${String(turmaDestino.data_inicio).slice(0, 10)}T00:00:00`);
            inicioDestino.setHours(0, 0, 0, 0);
            if (inicioDestino <= hojeTransferencia) {
                throw new BadRequestException('Não é possível transferir para uma turma que já ocorreu ou está ocorrendo. Escolha uma turma futura.');
            }
        }

        const idAluno = parseInt(turmaAlunoOrigem.id_aluno, 10);
        const jaNaTurmaDestino = await this.uow.turmasAlunosRP.findOne({
            where: { id_turma: id_turma_destino, id_aluno: turmaAlunoOrigem.id_aluno, deletado_em: null },
        });
        // Registra a turma de origem IMEDIATA desta transferência (e não a "primeira da
        // cadeia"). Assim, "transferido/recebido de" reflete o salto real. A trilha completa
        // de saltos continua disponível em historico_transferencias_alunos.
        const idTurmaOrigemImediata = turmaOrigem.id;

        let turmaAlunoDestinoSalvo: any;
        if (jaNaTurmaDestino) {
            // Se já existir vínculo na turma destino, reaproveita-o e marca como vindo de transferência.
            jaNaTurmaDestino.origem_aluno = EOrigemAlunos.TRANSFERENCIA;
            jaNaTurmaDestino.id_turma_transferencia_de = idTurmaOrigemImediata;
            jaNaTurmaDestino.status_aluno_turma = EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO;
            jaNaTurmaDestino.confirmacao_realizada = false;
            jaNaTurmaDestino.checkin_realizado = false;
            // Acessor acompanha o aluno na transferência (mantém o existente, se já houver).
            jaNaTurmaDestino.id_acessor = jaNaTurmaDestino.id_acessor ?? turmaAlunoOrigem.id_acessor ?? null;
            if (opts?.transferidoPorRobo) {
                jaNaTurmaDestino.transferido_por_robo = true;
            }
            turmaAlunoDestinoSalvo = await this.uow.turmasAlunosRP.save(jaNaTurmaDestino);
        } else {
            const numeroCracha = await this.generateUniqueCrachaNumber(id_turma_destino);
            const turmaAlunoDestino = this.uow.turmasAlunosRP.create({
                id_turma: id_turma_destino,
                id_aluno: turmaAlunoOrigem.id_aluno,
                numero_cracha: numeroCracha,
                vaga_bonus: turmaAlunoOrigem.vaga_bonus ?? false,
                origem_aluno: EOrigemAlunos.TRANSFERENCIA,
                status_aluno_turma: EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO,
                confirmacao_realizada: false,
                checkin_realizado: false,
                id_turma_transferencia_de: idTurmaOrigemImediata,
                // Acessor acompanha o aluno na transferência.
                id_acessor: turmaAlunoOrigem.id_acessor ?? null,
                transferido_por_robo: opts?.transferidoPorRobo === true,
            });
            turmaAlunoDestinoSalvo = await this.uow.turmasAlunosRP.save(turmaAlunoDestino);
        }

        const historico = this.uow.historicoTransferenciasRP.create({
            id_aluno: idAluno,
            id_turma_de: turmaOrigem.id,
            id_turma_para: id_turma_destino,
            id_turma_aluno_de: turmaAlunoOrigem.id,
            id_turma_aluno_para: turmaAlunoDestinoSalvo.id,
        });
        await this.uow.historicoTransferenciasRP.save(historico);

        await this.registrarLogAlunoTurma(
            {
                id_turma_aluno: turmaAlunoOrigem.id,
                id_turma: turmaOrigem.id,
                id_aluno: turmaAlunoOrigem.id_aluno,
                tipo_acao: 'TRANSFERENCIA',
                titulo: 'Aluno transferido para outra turma',
                descricao: `Transferência da turma ${turmaOrigem.edicao_turma || turmaOrigem.id} para ${turmaDestino.edicao_turma || turmaDestino.id}.`,
                detalhes: {
                    id_turma_origem: turmaOrigem.id,
                    id_turma_destino: turmaDestino.id,
                    edicao_origem: turmaOrigem.edicao_turma,
                    edicao_destino: turmaDestino.edicao_turma,
                },
            },
            userId,
        );

        await this.registrarLogAlunoTurma(
            {
                id_turma_aluno: turmaAlunoDestinoSalvo.id,
                id_turma: turmaAlunoDestinoSalvo.id_turma,
                id_aluno: turmaAlunoDestinoSalvo.id_aluno,
                tipo_acao: 'TRANSFERENCIA',
                titulo: 'Aluno recebido por transferência',
                descricao: `Recebido da turma ${turmaOrigem.edicao_turma || turmaOrigem.id}.`,
                detalhes: {
                    id_turma_origem: turmaOrigem.id,
                    id_turma_destino: turmaDestino.id,
                    edicao_origem: turmaOrigem.edicao_turma,
                    edicao_destino: turmaDestino.edicao_turma,
                },
            },
            userId,
        );

        // Transferência: replica o aluno para a turma de destino mantendo a rastreabilidade na origem.
        turmaAlunoOrigem.id_turma_transferencia_para = id_turma_destino;
        if (opts?.manterNaOrigem || this.isTurmaCongelada(turmaOrigem)) {
            // Turma encerrada/congelada: o aluno NÃO sai da turma (registro congelado), apenas é replicado
            // para o destino. A presença (ex.: NO_SHOW) permanece congelada.
        } else {
            // Turma ativa: remove da origem (soft delete) preservando o histórico de transferência.
            turmaAlunoOrigem.presenca_turma = null;
            turmaAlunoOrigem.deletado_em = new Date();
        }
        await this.uow.turmasAlunosRP.save(turmaAlunoOrigem);

        // Congela a meta no novo pico de inscritos/extras da turma de destino.
        await this.uow.bumparPicoMetricasTurmas([id_turma_destino]);

        const turmaAlunoCompleta = await this.uow.turmasAlunosRP.findOne({
            where: { id: turmaAlunoDestinoSalvo.id },
            relations: ['id_aluno_fk', 'id_turma_transferencia_de_fk', 'id_turma_transferencia_de_fk.id_treinamento_fk', 'id_turma_transferencia_de_fk.id_polo_fk'],
        });
        return {
            id: turmaAlunoCompleta.id,
            id_turma: turmaAlunoCompleta.id_turma,
            id_aluno: turmaAlunoCompleta.id_aluno,
            nome_cracha: turmaAlunoCompleta.id_aluno_fk?.nome_cracha || turmaAlunoCompleta.id_aluno_fk?.nome || '',
            numero_cracha: turmaAlunoCompleta.numero_cracha,
            vaga_bonus: turmaAlunoCompleta.vaga_bonus,
            status_aluno_turma: turmaAlunoCompleta.status_aluno_turma,
            confirmacao_realizada: turmaAlunoCompleta.confirmacao_realizada,
            checkin_realizado: turmaAlunoCompleta.checkin_realizado,
            presenca_turma: turmaAlunoCompleta.presenca_turma,
            url_comprovante_pgto: turmaAlunoCompleta.url_comprovante_pgto,
            pendencia_pagamento: turmaAlunoCompleta.pendencia_pagamento,
            quantidade_inscricoes: turmaAlunoCompleta.quantidade_inscricoes ?? 1,
            outros_clientes: turmaAlunoCompleta.outros_clientes ?? [],
            contrato_duplo: (turmaAlunoCompleta.quantidade_inscricoes ?? 1) > 1,
            comprovante_pagamento_base64: turmaAlunoCompleta.comprovante_pagamento_base64,
            created_at: turmaAlunoCompleta.criado_em,
            transferencia_de_turma: this.mapTurmaToTransferenciaTag(turmaAlunoCompleta.id_turma_transferencia_de_fk),
            aluno: turmaAlunoCompleta.id_aluno_fk
                ? {
                      id: turmaAlunoCompleta.id_aluno_fk.id,
                      nome: turmaAlunoCompleta.id_aluno_fk.nome,
                      email: turmaAlunoCompleta.id_aluno_fk.email,
                      nome_cracha: turmaAlunoCompleta.id_aluno_fk.nome_cracha,
                  }
                : undefined,
        };
    }

    /**
     * Histórico de transferências do aluno (de onde saiu para onde foi).
     */
    async getHistoricoTransferencias(id_aluno: number): Promise<HistoricoTransferenciasResponseDto> {
        const list = await this.uow.historicoTransferenciasRP.find({
            where: { id_aluno, deletado_em: null },
            relations: [
                'id_turma_de_fk',
                'id_turma_de_fk.id_treinamento_fk',
                'id_turma_de_fk.id_polo_fk',
                'id_turma_para_fk',
                'id_turma_para_fk.id_treinamento_fk',
                'id_turma_para_fk.id_polo_fk',
            ],
            order: { criado_em: 'DESC' },
        });
        const data: HistoricoTransferenciaItemDto[] = list.map((h) => ({
            id: h.id,
            id_aluno: h.id_aluno,
            id_turma_de: h.id_turma_de,
            id_turma_para: h.id_turma_para,
            origem_label: h.id_turma_de === h.id_turma_para ? 'Time de Vendas IAM' : undefined,
            turma_de: {
                id: h.id_turma_de_fk?.id ?? h.id_turma_de,
                edicao_turma: h.id_turma_de_fk?.edicao_turma,
                data_inicio: h.id_turma_de_fk?.data_inicio ?? '',
                data_final: h.id_turma_de_fk?.data_final ?? '',
                treinamento_nome: h.id_turma_de_fk?.id_treinamento_fk?.treinamento,
                sigla_treinamento: h.id_turma_de_fk?.id_treinamento_fk?.sigla_treinamento,
                polo_nome: h.id_turma_de_fk?.id_polo_fk?.polo,
            },
            turma_para: {
                id: h.id_turma_para_fk?.id ?? h.id_turma_para,
                edicao_turma: h.id_turma_para_fk?.edicao_turma,
                data_inicio: h.id_turma_para_fk?.data_inicio ?? '',
                data_final: h.id_turma_para_fk?.data_final ?? '',
                treinamento_nome: h.id_turma_para_fk?.id_treinamento_fk?.treinamento,
                sigla_treinamento: h.id_turma_para_fk?.id_treinamento_fk?.sigla_treinamento,
                polo_nome: h.id_turma_para_fk?.id_polo_fk?.polo,
            },
            criado_em: h.criado_em,
        }));
        return { data };
    }

    /**
     * Extrato extratificado de movimentação de turmas (acompanhamento/conferência).
     * Para cada turma dentro do período, calcula saldo (no início do período), entrada,
     * saída, resultado (= saldo + entrada - saída) e performance (%), com detalhamento por
     * canal (entrada) e por motivo (saída) e a quebra diária encadeada.
     *
     * Fontes: `historico_alunos_turmas_logs` (CRIACAO/CANCELAMENTO/REMOCAO) e
     * `historico_transferencias_alunos` (entrada/saída por transferência). Cancelamentos geram
     * transferência para a turma CANCELADA — por isso transferências cujo destino é uma turma
     * especial (CANCELADA etc.) são ignoradas como saída de transferência (já contadas como
     * cancelamento), evitando dupla contagem.
     */
    async getExtratoMovimentacaoTurmas(filtros: GetExtratoMovimentacaoDto): Promise<ExtratoMovimentacaoResponseDto> {
        try {
            const dataInicioStr = (filtros?.data_inicio || '').trim();
            const dataFinalStr = (filtros?.data_final || '').trim();
            if (!dataInicioStr || !dataFinalStr) {
                throw new BadRequestException('Informe o período (data_inicio e data_final).');
            }
            const start = new Date(`${dataInicioStr}T00:00:00`);
            const endInclusive = new Date(`${dataFinalStr}T23:59:59.999`);
            if (Number.isNaN(start.getTime()) || Number.isNaN(endInclusive.getTime()) || start > endInclusive) {
                throw new BadRequestException('Período inválido.');
            }
            const agora = new Date();
            // Reconstrução do saldo inicial usa todos os movimentos do início do período até agora.
            const reconUpper = agora > endInclusive ? agora : endInclusive;

            // Janela padrão de listagem: turmas dos últimos 15 dias para frente (exclui turmas antigas).
            const cutoff = new Date(agora);
            cutoff.setDate(cutoff.getDate() - 15);
            const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;

            const treinamentoIds = (filtros.treinamento_ids || []).filter((n) => Number.isFinite(n));
            const turmaIds = (filtros.turma_ids || []).filter((n) => Number.isFinite(n));

            const EDICOES_ESPECIAIS = ['SEM_TURMA', 'SEM_TURMAS', 'INADIMPLENTE', 'JURIDICA', 'JURIDICO', 'CANCELADA'];

            // Turmas "especiais" (CANCELADA etc.): usadas para diferenciar cancelamento de transferência real.
            const specialRows = await this.uow.turmasRP
                .createQueryBuilder('t')
                .select('t.id', 'id')
                .where(`UPPER(TRIM(COALESCE(t.edicao_turma, ''))) IN (:...edicoes)`, { edicoes: EDICOES_ESPECIAIS })
                .getRawMany<{ id: number }>();
            const specialSet = new Set(specialRows.map((r) => Number(r.id)));

            // Turmas que tiveram movimentação dentro do período selecionado (logs ou transferências):
            // devem aparecer mesmo que o evento seja anterior à janela de 15 dias (ex.: importação recente
            // em turma de edição passada).
            const movimentadasIds = new Set<number>();
            const movLogRows = await this.uow.historicoAlunosTurmasLogsRP
                .createQueryBuilder('l')
                .select('DISTINCT l.id_turma', 'id_turma')
                .where(`l.tipo_acao IN ('CRIACAO', 'CANCELAMENTO', 'REMOCAO')`)
                .andWhere('l.data_acao >= :start', { start })
                .andWhere('l.data_acao <= :end', { end: endInclusive })
                .andWhere('l.deletado_em IS NULL')
                .getRawMany<{ id_turma: number }>();
            for (const r of movLogRows) {
                if (r.id_turma != null) movimentadasIds.add(Number(r.id_turma));
            }
            const movTransfRows = await this.uow.historicoTransferenciasRP
                .createQueryBuilder('h')
                .select('h.id_turma_de', 'id_turma_de')
                .addSelect('h.id_turma_para', 'id_turma_para')
                .where('h.deletado_em IS NULL')
                .andWhere('h.criado_em >= :start', { start })
                .andWhere('h.criado_em <= :end', { end: endInclusive })
                .getRawMany<{ id_turma_de: number | null; id_turma_para: number | null }>();
            for (const r of movTransfRows) {
                if (r.id_turma_de != null) movimentadasIds.add(Number(r.id_turma_de));
                if (r.id_turma_para != null) movimentadasIds.add(Number(r.id_turma_para));
            }

            // Turmas candidatas (exclui especiais).
            const turmaQb = this.uow.turmasRP
                .createQueryBuilder('t')
                .leftJoinAndSelect('t.id_treinamento_fk', 'tr')
                .where('t.deletado_em IS NULL')
                .andWhere(`(t.edicao_turma IS NULL OR UPPER(TRIM(t.edicao_turma)) NOT IN (:...edicoes))`, { edicoes: EDICOES_ESPECIAIS });
            if (turmaIds.length > 0) turmaQb.andWhere('t.id IN (:...turmaIds)', { turmaIds });
            if (treinamentoIds.length > 0) turmaQb.andWhere('t.id_treinamento IN (:...treinamentoIds)', { treinamentoIds });
            // Não listar turmas de Masterclass/palestras (treinamento palestra ou edição com prefixo "MC_").
            turmaQb.andWhere(`(tr.tipo_palestra IS NOT TRUE AND tr.tipo_treinamento IS NOT FALSE)`);
            turmaQb.andWhere(`(t.edicao_turma IS NULL OR LEFT(UPPER(TRIM(t.edicao_turma)), 3) <> 'MC_')`);
            // Por default lista as turmas dos últimos 15 dias para frente (exceto quando o usuário
            // seleciona turmas específicas) OU turmas que tiveram movimentação dentro do período selecionado.
            if (turmaIds.length === 0) {
                if (movimentadasIds.size > 0) {
                    turmaQb.andWhere(`(COALESCE(t.data_final, t.data_inicio) IS NULL OR COALESCE(t.data_final, t.data_inicio) >= :cutoff OR t.id IN (:...movIds))`, {
                        cutoff: cutoffStr,
                        movIds: Array.from(movimentadasIds),
                    });
                } else {
                    turmaQb.andWhere(`(COALESCE(t.data_final, t.data_inicio) IS NULL OR COALESCE(t.data_final, t.data_inicio) >= :cutoff)`, { cutoff: cutoffStr });
                }
            }
            // Mesmas regras de listagem da tela /turmas (sem deletadas e sem edições especiais),
            // ordenadas de forma crescente por data do evento (início, depois final).
            turmaQb.orderBy('t.data_inicio', 'ASC', 'NULLS LAST').addOrderBy('t.data_final', 'ASC', 'NULLS LAST').addOrderBy('t.id', 'ASC');
            const turmas = await turmaQb.getMany();
            const ids = turmas.map((t) => t.id);

            if (ids.length === 0) {
                return {
                    data_inicio: dataInicioStr,
                    data_final: dataFinalStr,
                    dias: [],
                    data: [],
                    totais: { saldo: 0, entrada: 0, saida: 0, resultado: 0, performance: 0 },
                };
            }

            // Saldo atual real por turma (matrículas ativas).
            const saldoRows = await this.uow.turmasAlunosRP
                .createQueryBuilder('ta')
                .select('ta.id_turma', 'id_turma')
                .addSelect('COUNT(*)', 'total')
                .where('ta.id_turma IN (:...ids)', { ids })
                .andWhere('ta.deletado_em IS NULL')
                .groupBy('ta.id_turma')
                .getRawMany<{ id_turma: number; total: string }>();
            const saldoAtualMap = new Map<number, number>();
            for (const r of saldoRows) saldoAtualMap.set(Number(r.id_turma), Number(r.total));

            // Movimentos a partir dos logs (CRIACAO/CANCELAMENTO/REMOCAO) no intervalo [start, reconUpper].
            const logRows = await this.uow.historicoAlunosTurmasLogsRP
                .createQueryBuilder('l')
                .select('l.id_turma', 'id_turma')
                .addSelect('l.id_turma_aluno', 'id_turma_aluno')
                .addSelect('l.tipo_acao', 'tipo_acao')
                .addSelect(`to_char(l.data_acao, 'YYYY-MM-DD')`, 'dia')
                .where('l.id_turma IN (:...ids)', { ids })
                .andWhere(`l.tipo_acao IN ('CRIACAO', 'CANCELAMENTO', 'REMOCAO')`)
                .andWhere('l.data_acao >= :start', { start })
                .andWhere('l.data_acao <= :reconUpper', { reconUpper })
                .andWhere('l.deletado_em IS NULL')
                .getRawMany<{ id_turma: number; id_turma_aluno: string; tipo_acao: string; dia: string }>();

            // Movimentos de transferência (entrada/saída) no intervalo.
            const transferRows = await this.uow.historicoTransferenciasRP
                .createQueryBuilder('h')
                .select('h.id_turma_de', 'id_turma_de')
                .addSelect('h.id_turma_para', 'id_turma_para')
                .addSelect(`to_char(h.criado_em, 'YYYY-MM-DD')`, 'dia')
                .where('(h.id_turma_de IN (:...ids) OR h.id_turma_para IN (:...ids))', { ids })
                .andWhere('h.id_turma_de <> h.id_turma_para')
                .andWhere('h.deletado_em IS NULL')
                .andWhere('h.criado_em >= :start', { start })
                .andWhere('h.criado_em <= :reconUpper', { reconUpper })
                .getRawMany<{ id_turma_de: number; id_turma_para: number; dia: string }>();

            type Mov = { dia: string; tipo: 'ENTRADA' | 'SAIDA'; categoria: string; id_turma_aluno?: string; classificarCanal?: boolean };
            const movsPorTurma = new Map<number, Mov[]>();
            const pushMov = (idTurma: number, mov: Mov) => {
                const arr = movsPorTurma.get(idTurma);
                if (arr) arr.push(mov);
                else movsPorTurma.set(idTurma, [mov]);
            };
            const idsSet = new Set(ids);

            // CRIACAO -> entrada (canal a classificar); CANCELAMENTO/REMOCAO -> saída.
            const criacaoIdsPorTurma = new Map<number, Set<string>>();
            for (const row of logRows) {
                const idTurma = Number(row.id_turma);
                if (row.tipo_acao === 'CRIACAO') {
                    pushMov(idTurma, {
                        dia: row.dia,
                        tipo: 'ENTRADA',
                        categoria: 'Vendas em Eventos',
                        id_turma_aluno: String(row.id_turma_aluno),
                        classificarCanal: true,
                    });
                    const set = criacaoIdsPorTurma.get(idTurma) ?? new Set<string>();
                    set.add(String(row.id_turma_aluno));
                    criacaoIdsPorTurma.set(idTurma, set);
                } else if (row.tipo_acao === 'CANCELAMENTO') {
                    pushMov(idTurma, { dia: row.dia, tipo: 'SAIDA', categoria: 'Cancelamento' });
                } else if (row.tipo_acao === 'REMOCAO') {
                    pushMov(idTurma, { dia: row.dia, tipo: 'SAIDA', categoria: 'Exclusão/Remoção' });
                }
            }

            for (const row of transferRows) {
                const de = Number(row.id_turma_de);
                const para = Number(row.id_turma_para);
                // Entrada por transferência recebida.
                if (idsSet.has(para)) {
                    pushMov(para, { dia: row.dia, tipo: 'ENTRADA', categoria: 'Transferência' });
                }
                // Saída por transferência enviada (exclui cancelamentos: destino é turma especial/CANCELADA).
                if (idsSet.has(de) && !specialSet.has(para)) {
                    pushMov(de, { dia: row.dia, tipo: 'SAIDA', categoria: 'Transferência' });
                }
            }

            // Classificação de canal (mesma regra do dashboard) para as entradas por nova inscrição.
            const canalPorTurmaAluno = new Map<string, string>(); // key `${idTurma}:${idTurmaAluno}`
            for (const [idTurma, set] of criacaoIdsPorTurma.entries()) {
                const idsAlunos = Array.from(set);
                if (idsAlunos.length === 0) continue;
                const classif = await this.getClassificacaoOrigemPorTurmaAluno(idTurma, idsAlunos);
                for (const idAluno of idsAlunos) {
                    canalPorTurmaAluno.set(`${idTurma}:${idAluno}`, classif.get(idAluno)?.canal || 'Vendas em Eventos');
                }
            }

            // Dias do período (para a quebra diária encadeada).
            const diasPeriodo: string[] = [];
            {
                const cur = new Date(start);
                while (cur <= endInclusive) {
                    diasPeriodo.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
                    cur.setDate(cur.getDate() + 1);
                }
            }

            const round1 = (n: number) => Math.round(n * 10) / 10;
            const calcPerformance = (saldoInicial: number, entrada: number, saida: number): number => {
                const diff = entrada - saida;
                if (saldoInicial > 0) return round1((diff / saldoInicial) * 100);
                if (diff === 0) return 0;
                return diff > 0 ? 100 : -100;
            };
            const agruparDetalhes = (movs: Mov[], tipo: 'ENTRADA' | 'SAIDA', idTurma: number): ExtratoMovimentacaoDetalheDto[] => {
                const mapa = new Map<string, number>();
                for (const m of movs) {
                    if (m.tipo !== tipo) continue;
                    let label = m.categoria;
                    if (tipo === 'ENTRADA' && m.classificarCanal && m.id_turma_aluno) {
                        label = canalPorTurmaAluno.get(`${idTurma}:${m.id_turma_aluno}`) || 'Vendas em Eventos';
                    }
                    mapa.set(label, (mapa.get(label) ?? 0) + 1);
                }
                return Array.from(mapa.entries())
                    .map(([label, total]) => ({ label, total }))
                    .sort((a, b) => b.total - a.total);
            };

            const data: ExtratoMovimentacaoTurmaDto[] = [];
            for (const turma of turmas) {
                const movs = movsPorTurma.get(turma.id) ?? [];
                const saldoAtual = saldoAtualMap.get(turma.id) ?? 0;

                // Reconstrução: saldo no início do período = saldo atual - net(movimentos do início até agora).
                const sinceStartEntrada = movs.filter((m) => m.tipo === 'ENTRADA').length;
                const sinceStartSaida = movs.filter((m) => m.tipo === 'SAIDA').length;
                const saldoInicio = saldoAtual - (sinceStartEntrada - sinceStartSaida);

                // Movimentos dentro do período exibido [start, end].
                const movsPeriodo = movs.filter((m) => m.dia >= dataInicioStr && m.dia <= dataFinalStr);
                const entradaPeriodo = movsPeriodo.filter((m) => m.tipo === 'ENTRADA').length;
                const saidaPeriodo = movsPeriodo.filter((m) => m.tipo === 'SAIDA').length;

                // Lista todas as turmas (independente do status/movimentação), seguindo as mesmas
                // regras de listagem da tela /turmas; turmas sem movimentação aparecem com saldo fixo.

                const resultado = saldoInicio + entradaPeriodo - saidaPeriodo;
                const performance = calcPerformance(saldoInicio, entradaPeriodo, saidaPeriodo);

                // Quebra diária encadeada.
                const porDiaMap = new Map<string, Mov[]>();
                for (const m of movsPeriodo) {
                    const arr = porDiaMap.get(m.dia);
                    if (arr) arr.push(m);
                    else porDiaMap.set(m.dia, [m]);
                }
                const por_dia: ExtratoMovimentacaoDiaDto[] = [];
                let running = saldoInicio;
                for (const dia of diasPeriodo) {
                    const movsDia = porDiaMap.get(dia) ?? [];
                    const e = movsDia.filter((m) => m.tipo === 'ENTRADA').length;
                    const s = movsDia.filter((m) => m.tipo === 'SAIDA').length;
                    const inicial = running;
                    const finalDia = inicial + e - s;
                    running = finalDia;
                    if (e === 0 && s === 0) continue;
                    por_dia.push({
                        data: dia,
                        saldo_inicial: inicial,
                        entrada: e,
                        saida: s,
                        saldo_final: finalDia,
                        performance: calcPerformance(inicial, e, s),
                        entrada_detalhes: agruparDetalhes(movsDia, 'ENTRADA', turma.id),
                        saida_detalhes: agruparDetalhes(movsDia, 'SAIDA', turma.id),
                    });
                }

                const treinamentoNome = turma.id_treinamento_fk?.treinamento ?? null;
                const sigla = turma.id_treinamento_fk?.sigla_treinamento ?? null;
                const edicao = turma.edicao_turma ?? null;
                const labelBase = treinamentoNome || sigla || `Turma ${turma.id}`;
                const turma_label = edicao ? `${labelBase} - ${edicao}` : labelBase;

                data.push({
                    id_turma: turma.id,
                    turma_label,
                    treinamento_nome: treinamentoNome,
                    sigla_treinamento: sigla,
                    edicao_turma: edicao,
                    saldo: saldoInicio,
                    entrada: entradaPeriodo,
                    saida: saidaPeriodo,
                    resultado,
                    performance,
                    entrada_detalhes: agruparDetalhes(movsPeriodo, 'ENTRADA', turma.id),
                    saida_detalhes: agruparDetalhes(movsPeriodo, 'SAIDA', turma.id),
                    por_dia,
                });
            }

            // Mantém a ordem crescente por data do evento definida na consulta das turmas
            // (data_inicio ASC, data_final ASC, id ASC).

            const totais = data.reduce(
                (acc, t) => {
                    acc.saldo += t.saldo;
                    acc.entrada += t.entrada;
                    acc.saida += t.saida;
                    acc.resultado += t.resultado;
                    return acc;
                },
                { saldo: 0, entrada: 0, saida: 0, resultado: 0, performance: 0 },
            );
            totais.performance = calcPerformance(totais.saldo, totais.entrada, totais.saida);

            // Dias (colunas) com movimentação em qualquer turma, ordenados crescentemente.
            const diasComMovimento = new Set<string>();
            for (const turma of data) {
                for (const dia of turma.por_dia) diasComMovimento.add(dia.data);
            }
            const dias = Array.from(diasComMovimento).sort();

            return { data_inicio: dataInicioStr, data_final: dataFinalStr, dias, data, totais };
        } catch (error) {
            if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
            this.logger.error(`Erro ao gerar extrato de movimentação de turmas: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
            throw new BadRequestException(error instanceof Error ? error.message : 'Erro desconhecido');
        }
    }

    /**
     * Lista os alunos que participaram das movimentações (entradas/saídas) de UMA turma dentro do período.
     * Reaproveita a mesma fonte do extrato (logs CRIACAO/CANCELAMENTO/REMOCAO + transferências) e a
     * classificação unificada de canal do dashboard, retornando apenas os alunos das movimentações.
     */
    async getMovimentacaoAlunosTurma(id_turma: number, filtros: GetMovimentacaoAlunosDto): Promise<MovimentacaoAlunosResponseDto> {
        try {
            const dataInicioStr = (filtros?.data_inicio || '').trim();
            const dataFinalStr = (filtros?.data_final || '').trim();
            if (!dataInicioStr || !dataFinalStr) {
                throw new BadRequestException('Informe o período (data_inicio e data_final).');
            }
            const start = new Date(`${dataInicioStr}T00:00:00`);
            const endInclusive = new Date(`${dataFinalStr}T23:59:59.999`);
            if (Number.isNaN(start.getTime()) || Number.isNaN(endInclusive.getTime()) || start > endInclusive) {
                throw new BadRequestException('Período inválido.');
            }

            const turma = await this.uow.turmasRP.findOne({
                where: { id: id_turma, deletado_em: IsNull() as any },
                relations: ['id_treinamento_fk'],
            });
            if (!turma) {
                throw new NotFoundException('Turma não encontrada.');
            }
            const treinamentoNome = turma.id_treinamento_fk?.treinamento ?? null;
            const sigla = turma.id_treinamento_fk?.sigla_treinamento ?? null;
            const edicao = turma.edicao_turma ?? null;
            const labelBase = treinamentoNome || sigla || `Turma ${turma.id}`;
            const turma_label = edicao ? `${labelBase} - ${edicao}` : labelBase;

            const EDICOES_ESPECIAIS = ['SEM_TURMA', 'SEM_TURMAS', 'INADIMPLENTE', 'JURIDICA', 'JURIDICO', 'CANCELADA'];
            const specialRows = await this.uow.turmasRP
                .createQueryBuilder('t')
                .select('t.id', 'id')
                .where(`UPPER(TRIM(COALESCE(t.edicao_turma, ''))) IN (:...edicoes)`, { edicoes: EDICOES_ESPECIAIS })
                .getRawMany<{ id: number }>();
            const specialSet = new Set(specialRows.map((r) => Number(r.id)));

            type ItemMov = {
                id_aluno: number;
                id_turma_aluno: string | null;
                dia: string;
                tipo: 'ENTRADA' | 'SAIDA';
                categoria: string;
                id_turma_de?: number | null;
                id_turma_para?: number | null;
            };
            const itens: ItemMov[] = [];

            // Logs (CRIACAO/CANCELAMENTO/REMOCAO) com o aluno, dentro do período.
            const logRows = await this.uow.historicoAlunosTurmasLogsRP
                .createQueryBuilder('l')
                .select('l.id_aluno', 'id_aluno')
                .addSelect('l.id_turma_aluno', 'id_turma_aluno')
                .addSelect('l.tipo_acao', 'tipo_acao')
                .addSelect(`to_char(l.data_acao, 'YYYY-MM-DD')`, 'dia')
                .where('l.id_turma = :id_turma', { id_turma })
                .andWhere(`l.tipo_acao IN ('CRIACAO', 'CANCELAMENTO', 'REMOCAO')`)
                .andWhere('l.data_acao >= :start', { start })
                .andWhere('l.data_acao <= :end', { end: endInclusive })
                .andWhere('l.deletado_em IS NULL')
                .getRawMany<{ id_aluno: string; id_turma_aluno: string; tipo_acao: string; dia: string }>();

            const criacaoIds = new Set<string>();
            for (const row of logRows) {
                const idTurmaAluno = row.id_turma_aluno != null ? String(row.id_turma_aluno) : null;
                if (row.tipo_acao === 'CRIACAO') {
                    if (idTurmaAluno) criacaoIds.add(idTurmaAluno);
                    itens.push({ id_aluno: Number(row.id_aluno), id_turma_aluno: idTurmaAluno, dia: row.dia, tipo: 'ENTRADA', categoria: 'Vendas em Eventos' });
                } else if (row.tipo_acao === 'CANCELAMENTO') {
                    itens.push({ id_aluno: Number(row.id_aluno), id_turma_aluno: idTurmaAluno, dia: row.dia, tipo: 'SAIDA', categoria: 'Cancelamento' });
                } else if (row.tipo_acao === 'REMOCAO') {
                    itens.push({ id_aluno: Number(row.id_aluno), id_turma_aluno: idTurmaAluno, dia: row.dia, tipo: 'SAIDA', categoria: 'Exclusão/Remoção' });
                }
            }

            // Classificação de canal (mesma regra do dashboard) para as entradas por nova inscrição.
            if (criacaoIds.size > 0) {
                const classif = await this.getClassificacaoOrigemPorTurmaAluno(id_turma, Array.from(criacaoIds));
                for (const item of itens) {
                    if (item.tipo === 'ENTRADA' && item.id_turma_aluno) {
                        item.categoria = classif.get(item.id_turma_aluno)?.canal || 'Vendas em Eventos';
                    }
                }
            }

            // Transferências (entrada recebida / saída enviada) dentro do período.
            const transferRows = await this.uow.historicoTransferenciasRP
                .createQueryBuilder('h')
                .select('h.id_aluno', 'id_aluno')
                .addSelect('h.id_turma_de', 'id_turma_de')
                .addSelect('h.id_turma_para', 'id_turma_para')
                .addSelect('h.id_turma_aluno_de', 'id_turma_aluno_de')
                .addSelect('h.id_turma_aluno_para', 'id_turma_aluno_para')
                .addSelect(`to_char(h.criado_em, 'YYYY-MM-DD')`, 'dia')
                .where('(h.id_turma_de = :id_turma OR h.id_turma_para = :id_turma)', { id_turma })
                .andWhere('h.id_turma_de <> h.id_turma_para')
                .andWhere('h.deletado_em IS NULL')
                .andWhere('h.criado_em >= :start', { start })
                .andWhere('h.criado_em <= :end', { end: endInclusive })
                .getRawMany<{
                    id_aluno: string;
                    id_turma_de: number;
                    id_turma_para: number;
                    id_turma_aluno_de: string | null;
                    id_turma_aluno_para: string | null;
                    dia: string;
                }>();

            for (const row of transferRows) {
                const de = Number(row.id_turma_de);
                const para = Number(row.id_turma_para);
                if (para === id_turma) {
                    itens.push({
                        id_aluno: Number(row.id_aluno),
                        id_turma_aluno: row.id_turma_aluno_para != null ? String(row.id_turma_aluno_para) : null,
                        dia: row.dia,
                        tipo: 'ENTRADA',
                        categoria: 'Transferência',
                        id_turma_de: de,
                        id_turma_para: para,
                    });
                }
                // Saída por transferência enviada (exclui cancelamentos: destino é turma especial/CANCELADA).
                if (de === id_turma && !specialSet.has(para)) {
                    itens.push({
                        id_aluno: Number(row.id_aluno),
                        id_turma_aluno: row.id_turma_aluno_de != null ? String(row.id_turma_aluno_de) : null,
                        dia: row.dia,
                        tipo: 'SAIDA',
                        categoria: 'Transferência',
                        id_turma_de: de,
                        id_turma_para: para,
                    });
                }
            }

            // Dados dos alunos (nome/email) para exibição.
            const idsAlunos = Array.from(new Set(itens.map((i) => i.id_aluno).filter((n) => Number.isFinite(n))));
            const alunoInfoMap = new Map<number, { nome: string; email: string | null }>();
            if (idsAlunos.length > 0) {
                const alunos = await this.uow.alunosRP
                    .createQueryBuilder('a')
                    .select('a.id', 'id')
                    .addSelect('a.nome', 'nome')
                    .addSelect('a.email', 'email')
                    .where('a.id IN (:...idsAlunos)', { idsAlunos })
                    .getRawMany<{ id: number; nome: string; email: string | null }>();
                for (const a of alunos) {
                    alunoInfoMap.set(Number(a.id), { nome: a.nome || 'Aluno', email: a.email ?? null });
                }
            }

            // Observações registradas para cada aluno (agregadas ao aluno, todas as turmas).
            const obsMap = new Map<number, { dia: string; texto: string }[]>();
            if (idsAlunos.length > 0) {
                const obsRows = await this.uow.historicoAlunosTurmasLogsRP
                    .createQueryBuilder('h')
                    .select('h.id_aluno', 'id_aluno')
                    .addSelect('h.titulo', 'titulo')
                    .addSelect('h.descricao', 'descricao')
                    .addSelect(`to_char(h.data_acao, 'YYYY-MM-DD')`, 'dia')
                    .where('h.id_aluno IN (:...idsAlunos)', { idsAlunos: idsAlunos.map((n) => String(n)) })
                    .andWhere(`h.tipo_acao = 'OBSERVACAO'`)
                    .andWhere('h.deletado_em IS NULL')
                    .orderBy('h.data_acao', 'DESC')
                    .addOrderBy('h.id', 'DESC')
                    .getRawMany<{ id_aluno: string; titulo: string | null; descricao: string | null; dia: string }>();
                for (const row of obsRows) {
                    const idAluno = Number(row.id_aluno);
                    if (!Number.isFinite(idAluno)) continue;
                    const texto = (row.descricao || row.titulo || '').toString().trim();
                    if (!texto) continue;
                    const lista = obsMap.get(idAluno) ?? [];
                    lista.push({ dia: row.dia, texto });
                    obsMap.set(idAluno, lista);
                }
            }

            // Rótulos das turmas de origem/destino das transferências.
            const turmaLabelMap = new Map<number, string>();
            turmaLabelMap.set(turma.id, turma_label);
            const idsTurmasRef = Array.from(
                new Set(itens.flatMap((i) => [i.id_turma_de, i.id_turma_para]).filter((n): n is number => Number.isFinite(n) && !turmaLabelMap.has(n))),
            );
            if (idsTurmasRef.length > 0) {
                const turmasRef = await this.uow.turmasRP
                    .createQueryBuilder('t')
                    .leftJoin('t.id_treinamento_fk', 'tr')
                    .select('t.id', 'id')
                    .addSelect('t.edicao_turma', 'edicao_turma')
                    .addSelect('tr.treinamento', 'treinamento')
                    .addSelect('tr.sigla_treinamento', 'sigla_treinamento')
                    .where('t.id IN (:...idsTurmasRef)', { idsTurmasRef })
                    .getRawMany<{ id: number; edicao_turma: string | null; treinamento: string | null; sigla_treinamento: string | null }>();
                for (const t of turmasRef) {
                    const base = t.treinamento || t.sigla_treinamento || `Turma ${t.id}`;
                    turmaLabelMap.set(Number(t.id), t.edicao_turma ? `${base} - ${t.edicao_turma}` : base);
                }
            }
            const labelTurma = (id?: number | null): string | null => (id != null ? (turmaLabelMap.get(Number(id)) ?? `Turma ${id}`) : null);

            const alunos: MovimentacaoAlunoItemDto[] = itens.map((i) => ({
                id_aluno: i.id_aluno,
                id_turma_aluno: i.id_turma_aluno,
                nome: alunoInfoMap.get(i.id_aluno)?.nome || 'Aluno',
                email: alunoInfoMap.get(i.id_aluno)?.email ?? null,
                dia: i.dia,
                tipo: i.tipo,
                categoria: i.categoria,
                turma_origem_label: i.categoria === 'Transferência' ? labelTurma(i.id_turma_de) : null,
                turma_destino_label: i.categoria === 'Transferência' ? labelTurma(i.id_turma_para) : null,
                observacoes: obsMap.get(i.id_aluno) ?? [],
            }));

            // Ordena por dia crescente, entradas antes de saídas, depois por nome.
            alunos.sort((a, b) => a.dia.localeCompare(b.dia) || (a.tipo === b.tipo ? 0 : a.tipo === 'ENTRADA' ? -1 : 1) || a.nome.localeCompare(b.nome));

            return { id_turma, turma_label, data_inicio: dataInicioStr, data_final: dataFinalStr, alunos };
        } catch (error) {
            if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
            this.logger.error(`Erro ao listar alunos das movimentações da turma: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
            throw new BadRequestException(error instanceof Error ? error.message : 'Erro desconhecido');
        }
    }

    /**
     * Alunos que compunham o saldo da turma no INÍCIO ou no FIM do período do
     * extrato (matrículas ativas naquele momento), agrupados por estratégia de
     * origem (canal do dashboard) com a contagem de cada uma. Usado ao clicar
     * nos números "Início" e "Saldo" do acompanhamento.
     */
    async getAlunosSaldoPeriodoTurma(id_turma: number, filtros: GetAlunosSaldoPeriodoDto): Promise<AlunosSaldoPeriodoResponseDto> {
        try {
            const dataInicioStr = (filtros?.data_inicio || '').trim();
            const dataFinalStr = (filtros?.data_final || '').trim();
            const momento = filtros?.momento === 'FIM' ? 'FIM' : 'INICIO';
            if (!dataInicioStr || !dataFinalStr) {
                throw new BadRequestException('Informe o período (data_inicio e data_final).');
            }
            const start = new Date(`${dataInicioStr}T00:00:00`);
            const endInclusive = new Date(`${dataFinalStr}T23:59:59.999`);
            if (Number.isNaN(start.getTime()) || Number.isNaN(endInclusive.getTime()) || start > endInclusive) {
                throw new BadRequestException('Período inválido.');
            }

            const turma = await this.uow.turmasRP.findOne({
                where: { id: id_turma, deletado_em: IsNull() as any },
                relations: ['id_treinamento_fk'],
            });
            if (!turma) {
                throw new NotFoundException('Turma não encontrada.');
            }
            const treinamentoNome = turma.id_treinamento_fk?.treinamento ?? null;
            const sigla = turma.id_treinamento_fk?.sigla_treinamento ?? null;
            const edicao = turma.edicao_turma ?? null;
            const labelBase = treinamentoNome || sigla || `Turma ${turma.id}`;
            const turma_label = edicao ? `${labelBase} - ${edicao}` : labelBase;

            // Matrículas ativas no momento de referência:
            // - INICIO: criadas antes do início do período e não removidas antes dele;
            // - FIM: criadas até o fim do período e não removidas até o fim dele.
            const qb = this.uow.turmasAlunosRP
                .createQueryBuilder('ta')
                .withDeleted()
                .leftJoin('ta.id_aluno_fk', 'aluno')
                .select('ta.id', 'id_turma_aluno')
                .addSelect('ta.id_aluno', 'id_aluno')
                .addSelect('aluno.nome', 'nome')
                .addSelect('aluno.email', 'email')
                .addSelect(`to_char(ta.criado_em, 'YYYY-MM-DD')`, 'dia_entrada')
                .where('ta.id_turma = :id_turma', { id_turma });
            if (momento === 'INICIO') {
                qb.andWhere('ta.criado_em < :start', { start }).andWhere('(ta.deletado_em IS NULL OR ta.deletado_em >= :start)', { start });
            } else {
                qb.andWhere('ta.criado_em <= :end', { end: endInclusive }).andWhere('(ta.deletado_em IS NULL OR ta.deletado_em > :end)', { end: endInclusive });
            }
            const rows = await qb.getRawMany<{ id_turma_aluno: string; id_aluno: number; nome: string | null; email: string | null; dia_entrada: string | null }>();

            const idsTurmaAluno = rows.map((r) => String(r.id_turma_aluno));
            const classif =
                idsTurmaAluno.length > 0
                    ? await this.getClassificacaoOrigemPorTurmaAluno(id_turma, idsTurmaAluno)
                    : new Map<string, { canal: string; categoria: string }>();

            // Observações registradas para cada aluno (agregadas ao aluno, todas as turmas).
            const idsAlunos = Array.from(new Set(rows.map((r) => Number(r.id_aluno)).filter((n) => Number.isFinite(n))));
            const obsMap = new Map<number, { dia: string; texto: string }[]>();
            if (idsAlunos.length > 0) {
                const obsRows = await this.uow.historicoAlunosTurmasLogsRP
                    .createQueryBuilder('h')
                    .select('h.id_aluno', 'id_aluno')
                    .addSelect('h.titulo', 'titulo')
                    .addSelect('h.descricao', 'descricao')
                    .addSelect(`to_char(h.data_acao, 'YYYY-MM-DD')`, 'dia')
                    .where('h.id_aluno IN (:...idsAlunos)', { idsAlunos: idsAlunos.map((n) => String(n)) })
                    .andWhere(`h.tipo_acao = 'OBSERVACAO'`)
                    .andWhere('h.deletado_em IS NULL')
                    .orderBy('h.data_acao', 'DESC')
                    .addOrderBy('h.id', 'DESC')
                    .getRawMany<{ id_aluno: string; titulo: string | null; descricao: string | null; dia: string }>();
                for (const row of obsRows) {
                    const idAluno = Number(row.id_aluno);
                    if (!Number.isFinite(idAluno)) continue;
                    const texto = (row.descricao || row.titulo || '').toString().trim();
                    if (!texto) continue;
                    const lista = obsMap.get(idAluno) ?? [];
                    lista.push({ dia: row.dia, texto });
                    obsMap.set(idAluno, lista);
                }
            }

            // Turma de origem dos alunos que chegaram por transferência (última recebida por matrícula).
            const origemTransferenciaMap = new Map<string, number>(); // id_turma_aluno -> id_turma_de
            if (idsTurmaAluno.length > 0) {
                const transfRows = await this.uow.historicoTransferenciasRP
                    .createQueryBuilder('h')
                    .select('h.id_turma_aluno_para', 'id_turma_aluno_para')
                    .addSelect('h.id_turma_de', 'id_turma_de')
                    .where('h.id_turma_para = :id_turma', { id_turma })
                    .andWhere('h.id_turma_aluno_para IN (:...idsTurmaAluno)', { idsTurmaAluno })
                    .andWhere('h.deletado_em IS NULL')
                    .orderBy('h.criado_em', 'ASC')
                    .getRawMany<{ id_turma_aluno_para: string; id_turma_de: number }>();
                for (const row of transfRows) {
                    // ASC + set: a última transferência recebida prevalece.
                    origemTransferenciaMap.set(String(row.id_turma_aluno_para), Number(row.id_turma_de));
                }
            }
            const turmaLabelMap = new Map<number, string>();
            const idsTurmasOrigem = Array.from(new Set(Array.from(origemTransferenciaMap.values()).filter((n) => Number.isFinite(n))));
            if (idsTurmasOrigem.length > 0) {
                const turmasRef = await this.uow.turmasRP
                    .createQueryBuilder('t')
                    .withDeleted()
                    .leftJoin('t.id_treinamento_fk', 'tr')
                    .select('t.id', 'id')
                    .addSelect('t.edicao_turma', 'edicao_turma')
                    .addSelect('tr.treinamento', 'treinamento')
                    .addSelect('tr.sigla_treinamento', 'sigla_treinamento')
                    .where('t.id IN (:...idsTurmasOrigem)', { idsTurmasOrigem })
                    .getRawMany<{ id: number; edicao_turma: string | null; treinamento: string | null; sigla_treinamento: string | null }>();
                for (const t of turmasRef) {
                    const base = t.treinamento || t.sigla_treinamento || `Turma ${t.id}`;
                    turmaLabelMap.set(Number(t.id), t.edicao_turma ? `${base} - ${t.edicao_turma}` : base);
                }
            }

            const grupos = new Map<string, AlunoSaldoPeriodoItemDto[]>();
            for (const row of rows) {
                const canal = classif.get(String(row.id_turma_aluno))?.canal || 'Vendas em Eventos';
                const idTurmaOrigem = origemTransferenciaMap.get(String(row.id_turma_aluno));
                const lista = grupos.get(canal) ?? [];
                lista.push({
                    id_aluno: Number(row.id_aluno),
                    id_turma_aluno: String(row.id_turma_aluno),
                    nome: row.nome || 'Aluno',
                    email: row.email ?? null,
                    dia_entrada: row.dia_entrada ?? null,
                    turma_origem_label: idTurmaOrigem != null ? (turmaLabelMap.get(idTurmaOrigem) ?? `Turma ${idTurmaOrigem}`) : null,
                    observacoes: obsMap.get(Number(row.id_aluno)) ?? [],
                });
                grupos.set(canal, lista);
            }

            // Ordem fixa das estratégias (igual ao filtro de Origem da turma), com
            // canais desconhecidos ao final por total decrescente.
            const ordemCanais = [
                'Vendas em Eventos',
                'Masterclass',
                'Time de Vendas',
                'Transbordo',
                'Liberty',
                'Bônus',
                'Cortesia/Sorteio',
                'Transferência',
                'Presente',
            ];
            const canais: AlunosSaldoPeriodoCanalDto[] = Array.from(grupos.entries())
                .map(([canal, alunos]) => ({
                    canal,
                    total: alunos.length,
                    alunos: alunos.sort((a, b) => a.nome.localeCompare(b.nome)),
                }))
                .sort((a, b) => {
                    const ia = ordemCanais.indexOf(a.canal);
                    const ib = ordemCanais.indexOf(b.canal);
                    if (ia !== -1 && ib !== -1) return ia - ib;
                    if (ia !== -1) return -1;
                    if (ib !== -1) return 1;
                    return b.total - a.total;
                });

            return {
                id_turma,
                turma_label,
                momento,
                data_referencia: momento === 'INICIO' ? dataInicioStr : dataFinalStr,
                total: rows.length,
                canais,
            };
        } catch (error) {
            if (error instanceof BadRequestException || error instanceof NotFoundException) throw error;
            this.logger.error(`Erro ao listar alunos do saldo da turma no período: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
            throw new BadRequestException(error instanceof Error ? error.message : 'Erro desconhecido');
        }
    }

    async getAlunoTurmaHistorico(id_turma_aluno: string): Promise<AlunoTurmaHistoricoResponseDto> {
        const turmaAluno = await this.uow.turmasAlunosRP.findOne({
            where: { id: id_turma_aluno },
            withDeleted: true,
            select: ['id'] as any,
        });

        if (!turmaAluno) {
            throw new NotFoundException('Matrícula do aluno não encontrada.');
        }

        const raw = await this.uow.historicoAlunosTurmasLogsRP
            .createQueryBuilder('h')
            .leftJoin('usuarios', 'u', 'u.id = h.criado_por')
            .where('h.id_turma_aluno = :id_turma_aluno', { id_turma_aluno })
            .andWhere('h.deletado_em IS NULL')
            .orderBy('h.data_acao', 'DESC')
            .addOrderBy('h.id', 'DESC')
            .select([
                'h.id AS id',
                'h.id_turma_aluno AS id_turma_aluno',
                'h.id_turma AS id_turma',
                'h.id_aluno AS id_aluno',
                'h.tipo_acao AS tipo_acao',
                'h.titulo AS titulo',
                'h.descricao AS descricao',
                'h.template_key AS template_key',
                'h.detalhes AS detalhes',
                'h.criado_por AS criado_por',
                'h.data_acao AS data_acao',
                'h.criado_em AS criado_em',
                'u.nome AS nome_usuario',
            ])
            .getRawMany();

        const data: AlunoTurmaHistoricoItemDto[] = raw.map((item) => ({
            id: String(item.id),
            id_turma_aluno: String(item.id_turma_aluno),
            id_turma: Number(item.id_turma),
            id_aluno: String(item.id_aluno),
            tipo_acao: String(item.tipo_acao),
            titulo: String(item.titulo),
            descricao: item.descricao ? String(item.descricao) : null,
            template_key: item.template_key ? String(item.template_key) : null,
            detalhes: (item.detalhes as Record<string, unknown>) || {},
            criado_por: item.criado_por ? Number(item.criado_por) : null,
            nome_usuario: item.nome_usuario ? String(item.nome_usuario) : null,
            data_acao: item.data_acao ? new Date(item.data_acao) : new Date(),
            criado_em: item.criado_em ? new Date(item.criado_em) : new Date(),
        }));

        return {
            data,
            templates: ALUNO_TURMA_HISTORICO_TEMPLATES,
        };
    }

    /**
     * Histórico de observações/operações agregado por aluno (todas as turmas em que ele esteve),
     * com rótulo da turma (treinamento/sigla - edição) para permitir filtro por turma no cadastro do aluno.
     */
    async getHistoricoObservacoesAluno(id_aluno: number): Promise<AlunoHistoricoObservacoesResponseDto> {
        const aluno = await this.uow.alunosRP.findOne({
            where: { id: id_aluno },
            withDeleted: true,
            select: ['id'] as any,
        });

        if (!aluno) {
            throw new NotFoundException('Aluno não encontrado.');
        }

        const raw = await this.uow.historicoAlunosTurmasLogsRP
            .createQueryBuilder('h')
            .leftJoin('usuarios', 'u', 'u.id = h.criado_por')
            .leftJoin('turmas', 't', 't.id = h.id_turma')
            .leftJoin('treinamentos', 'tr', 'tr.id = t.id_treinamento')
            .where('h.id_aluno = :id_aluno', { id_aluno: String(id_aluno) })
            .andWhere('h.deletado_em IS NULL')
            .orderBy('h.data_acao', 'DESC')
            .addOrderBy('h.id', 'DESC')
            .select([
                'h.id AS id',
                'h.id_turma_aluno AS id_turma_aluno',
                'h.id_turma AS id_turma',
                'h.id_aluno AS id_aluno',
                'h.tipo_acao AS tipo_acao',
                'h.titulo AS titulo',
                'h.descricao AS descricao',
                'h.template_key AS template_key',
                'h.detalhes AS detalhes',
                'h.criado_por AS criado_por',
                'h.data_acao AS data_acao',
                'h.criado_em AS criado_em',
                'u.nome AS nome_usuario',
                't.edicao_turma AS edicao_turma',
                'tr.treinamento AS treinamento_nome',
                'tr.sigla_treinamento AS sigla_treinamento',
            ])
            .getRawMany();

        const construirLabelTurma = (item: {
            treinamento_nome?: string | null;
            sigla_treinamento?: string | null;
            edicao_turma?: string | null;
            id_turma: number;
        }): string => {
            const base = (item.sigla_treinamento || item.treinamento_nome || '').toString().trim();
            const edicao = (item.edicao_turma || '').toString().trim();
            if (base && edicao) return `${base} - ${edicao}`;
            if (base) return base;
            if (edicao) return edicao;
            return `Turma ${item.id_turma}`;
        };

        const data: AlunoHistoricoObservacaoItemDto[] = raw.map((item) => ({
            id: String(item.id),
            id_turma_aluno: String(item.id_turma_aluno),
            id_turma: Number(item.id_turma),
            id_aluno: String(item.id_aluno),
            tipo_acao: String(item.tipo_acao),
            titulo: String(item.titulo),
            descricao: item.descricao ? String(item.descricao) : null,
            template_key: item.template_key ? String(item.template_key) : null,
            detalhes: (item.detalhes as Record<string, unknown>) || {},
            criado_por: item.criado_por ? Number(item.criado_por) : null,
            nome_usuario: item.nome_usuario ? String(item.nome_usuario) : null,
            data_acao: item.data_acao ? new Date(item.data_acao) : new Date(),
            criado_em: item.criado_em ? new Date(item.criado_em) : new Date(),
            turma_label: construirLabelTurma({ ...item, id_turma: Number(item.id_turma) }),
            treinamento_nome: item.treinamento_nome ? String(item.treinamento_nome) : null,
            sigla_treinamento: item.sigla_treinamento ? String(item.sigla_treinamento) : null,
            edicao_turma: item.edicao_turma ? String(item.edicao_turma) : null,
        }));

        const turmasMap = new Map<number, AlunoHistoricoTurmaFiltroDto>();
        for (const item of data) {
            if (!turmasMap.has(item.id_turma)) {
                turmasMap.set(item.id_turma, {
                    id_turma: item.id_turma,
                    label: item.turma_label,
                    treinamento_nome: item.treinamento_nome ?? null,
                    sigla_treinamento: item.sigla_treinamento ?? null,
                    edicao_turma: item.edicao_turma ?? null,
                });
            }
        }

        const turmas = Array.from(turmasMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

        return {
            data,
            turmas,
            templates: ALUNO_TURMA_HISTORICO_TEMPLATES,
        };
    }

    async createAlunoTurmaHistorico(id_turma_aluno: string, dto: CreateAlunoTurmaHistoricoDto, userId?: number): Promise<void> {
        const turmaAluno = await this.uow.turmasAlunosRP.findOne({
            where: { id: id_turma_aluno },
            withDeleted: true,
            select: ['id', 'id_turma', 'id_aluno'] as any,
        });

        if (!turmaAluno) {
            throw new NotFoundException('Matrícula do aluno não encontrada para registrar histórico.');
        }

        const template = dto.template_key ? ALUNO_TURMA_HISTORICO_TEMPLATES.find((item) => item.key === dto.template_key) : undefined;

        const tituloFinal = dto.titulo?.trim() || template?.label || 'Observação registrada';
        const descricaoFinal = dto.descricao?.trim() || template?.descricao || null;

        await this.registrarLogAlunoTurma(
            {
                id_turma_aluno: turmaAluno.id,
                id_turma: turmaAluno.id_turma,
                id_aluno: turmaAluno.id_aluno,
                tipo_acao: 'OBSERVACAO',
                titulo: tituloFinal,
                descricao: descricaoFinal,
                template_key: dto.template_key || template?.key,
                detalhes: dto.detalhes ?? {},
            },
            userId,
        );
    }

    private async registrarLogAlunoTurma(
        logData: {
            id_turma_aluno: string;
            id_turma: number;
            id_aluno: string;
            tipo_acao: AlunoTurmaHistoricoTipoAcao;
            titulo: string;
            descricao?: string | null;
            template_key?: string | null;
            detalhes?: Record<string, unknown>;
            data_acao?: Date;
        },
        userId?: number,
    ): Promise<void> {
        const titulo = (logData.titulo || '').trim();
        if (!titulo) return;

        await this.uow.historicoAlunosTurmasLogsRP.insert({
            id_turma_aluno: logData.id_turma_aluno,
            id_turma: logData.id_turma,
            id_aluno: logData.id_aluno,
            tipo_acao: logData.tipo_acao,
            titulo,
            descricao: logData.descricao?.trim() || null,
            template_key: logData.template_key?.trim() || null,
            detalhes: logData.detalhes ?? {},
            data_acao: logData.data_acao ?? new Date(),
            criado_por: userId,
            atualizado_por: userId,
        });
    }

    /* ============ Histórico (log de alterações) da turma/evento ============ */

    private labelStatusEvento(status?: string | null): string {
        switch (status) {
            case 'OK':
                return '100% OK';
            case 'VERIFICAR_LOCAL':
                return 'Verificar local';
            case 'PENDENCIAS':
                return 'Com pendências';
            case 'CANCELADA':
                return 'Cancelada ou adiada';
            case 'MC_EXTRA':
                return 'MC extra';
            default:
                return status || 'não definido';
        }
    }

    /** Insere um registro no histórico da turma. Não lança erro para não quebrar a operação principal. */
    private async registrarLogTurma(
        logData: {
            id_turma: number;
            tipo_acao: TurmaHistoricoTipoAcao;
            titulo: string;
            descricao?: string | null;
            template_key?: string | null;
            detalhes?: Record<string, unknown>;
            data_acao?: Date;
        },
        userId?: number,
    ): Promise<void> {
        const titulo = (logData.titulo || '').trim();
        if (!titulo || !logData.id_turma) return;
        // .insert() não dispara @BeforeInsert do BaseEntity, então resolvemos o
        // usuário aqui (parâmetro explícito ou contexto da requisição).
        const uid = userId ?? getRequestUserId();
        try {
            await this.uow.historicoTurmasLogsRP.insert({
                id_turma: logData.id_turma,
                tipo_acao: logData.tipo_acao,
                titulo,
                descricao: logData.descricao?.trim() || null,
                template_key: logData.template_key?.trim() || null,
                detalhes: logData.detalhes ?? {},
                data_acao: logData.data_acao ?? new Date(),
                criado_por: uid,
                atualizado_por: uid,
            });
        } catch (error) {
            this.logger.warn(
                `turma.historico.registrar | Falha ao registrar log da turma id=${logData.id_turma}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
            );
        }
    }

    /** Compara os campos-chave antes/depois e registra no histórico o que mudou. */
    private async registrarLogAlteracaoTurma(id_turma: number, antes: Record<string, unknown>, depois: Record<string, unknown>, userId?: number): Promise<void> {
        const labels: Record<string, string> = {
            id_polo: 'Polo',
            id_treinamento: 'Treinamento',
            lider_evento: 'Líder do evento',
            data_inicio: 'Data de início',
            data_final: 'Data final',
            capacidade_turma: 'Capacidade',
            meta: 'Meta',
            status_turma: 'Status da turma',
            logradouro: 'Logradouro',
            cidade: 'Cidade',
        };
        const mudancas: string[] = [];
        const detalhes: Record<string, unknown> = {};
        for (const campo of Object.keys(labels)) {
            if (!(campo in depois) || depois[campo] === undefined) continue;
            const de = antes[campo];
            const para = depois[campo];
            if (this.normalizeLogValue(de) === this.normalizeLogValue(para)) continue;
            mudancas.push(`${labels[campo]}: "${this.normalizeLogValue(de)}" → "${this.normalizeLogValue(para)}"`);
            detalhes[campo] = { de: de ?? null, para: para ?? null };
        }
        if (mudancas.length === 0) return;
        await this.registrarLogTurma(
            {
                id_turma,
                tipo_acao: 'ATUALIZACAO',
                titulo: 'Evento atualizado',
                descricao: mudancas.join(' · '),
                detalhes,
            },
            userId,
        );
    }

    /** Histórico (log de alterações) de uma turma/evento, mais recente primeiro. */
    async getTurmaHistorico(id_turma: number): Promise<TurmaHistoricoResponseDto> {
        const turma = await this.uow.turmasRP.findOne({ where: { id: id_turma }, withDeleted: true, select: ['id'] as any });
        if (!turma) {
            throw new NotFoundException('Turma não encontrada.');
        }

        const raw = await this.uow.historicoTurmasLogsRP
            .createQueryBuilder('h')
            .leftJoin('usuarios', 'u', 'u.id = h.criado_por')
            .where('h.id_turma = :id_turma', { id_turma })
            .andWhere('h.deletado_em IS NULL')
            .orderBy('h.data_acao', 'DESC')
            .addOrderBy('h.id', 'DESC')
            .select([
                'h.id AS id',
                'h.id_turma AS id_turma',
                'h.tipo_acao AS tipo_acao',
                'h.titulo AS titulo',
                'h.descricao AS descricao',
                'h.template_key AS template_key',
                'h.detalhes AS detalhes',
                'h.criado_por AS criado_por',
                'h.data_acao AS data_acao',
                'h.criado_em AS criado_em',
                'u.nome AS nome_usuario',
            ])
            .getRawMany();

        const data: TurmaHistoricoItemDto[] = raw.map((item) => ({
            id: String(item.id),
            id_turma: Number(item.id_turma),
            tipo_acao: String(item.tipo_acao),
            titulo: String(item.titulo),
            descricao: item.descricao ? String(item.descricao) : null,
            template_key: item.template_key ? String(item.template_key) : null,
            detalhes: (item.detalhes as Record<string, unknown>) || {},
            criado_por: item.criado_por ? Number(item.criado_por) : null,
            nome_usuario: item.nome_usuario ? String(item.nome_usuario) : null,
            data_acao: item.data_acao ? new Date(item.data_acao) : new Date(),
            criado_em: item.criado_em ? new Date(item.criado_em) : new Date(),
        }));

        return { data, templates: TURMA_HISTORICO_TEMPLATES };
    }

    /** Registra uma observação manual no histórico da turma. */
    async createTurmaHistorico(id_turma: number, dto: CreateTurmaHistoricoDto, userId?: number): Promise<void> {
        const turma = await this.uow.turmasRP.findOne({ where: { id: id_turma, deletado_em: null }, select: ['id'] as any });
        if (!turma) {
            throw new NotFoundException('Turma não encontrada para registrar histórico.');
        }
        const template = dto.template_key ? TURMA_HISTORICO_TEMPLATES.find((item) => item.key === dto.template_key) : undefined;
        const tituloFinal = dto.titulo?.trim() || template?.label || 'Observação registrada';
        const descricaoFinal = dto.descricao?.trim() || null;

        await this.registrarLogTurma(
            {
                id_turma,
                tipo_acao: 'OBSERVACAO',
                titulo: tituloFinal,
                descricao: descricaoFinal,
                template_key: dto.template_key || template?.key,
                detalhes: dto.detalhes ?? {},
            },
            userId,
        );
    }

    private normalizeLogValue(value: unknown): string {
        if (value === null || value === undefined) return 'vazio';
        if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch {
                return '[objeto não serializável]';
            }
        }
        if (typeof value === 'string') {
            const normalized = value.trim();
            return normalized || 'vazio';
        }
        if (typeof value === 'number' || typeof value === 'bigint') {
            return `${value}`;
        }
        if (typeof value === 'symbol') {
            return value.description ? `Symbol(${value.description})` : 'Symbol';
        }
        if (typeof value === 'function') {
            return '[função]';
        }
        return 'vazio';
    }

    private buildAlunoTurmaChanges(beforeData: Record<string, unknown>, afterData: Record<string, unknown>): Array<{ campo: string; de: string; para: string }> {
        const labels: Record<string, string> = {
            nome_cracha: 'Nome no crachá',
            url_comprovante_pgto: 'Comprovante',
            pendencia_pagamento: 'Pendência de pagamento',
            quantidade_inscricoes: 'Quantidade de inscrições',
            outros_clientes: 'Outros clientes',
            comprovante_pagamento_base64: 'Comprovante (base64)',
            status_aluno_turma: 'Status na turma',
            origem_aluno: 'Origem do aluno',
            presenca_turma: 'Presença',
            confirmacao_realizada: 'Confirmação realizada',
            checkin_realizado: 'Check-in realizado',
        };

        return Object.keys(afterData)
            .filter((key) => key in beforeData)
            .filter((key) => JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key]))
            .map((key) => ({
                campo: labels[key] || key,
                de: this.normalizeLogValue(beforeData[key]),
                para: this.normalizeLogValue(afterData[key]),
            }));
    }

    private async softDeleteAlunoTurmaCascade(id_turma_aluno: string, turmaAluno?: any): Promise<void> {
        const matricula = turmaAluno
            ? turmaAluno
            : await this.uow.turmasAlunosRP.findOne({
                  where: { id: id_turma_aluno },
              });

        if (!matricula) {
            throw new NotFoundException('Aluno não encontrado na turma');
        }

        // First, find all related turmas_alunos_treinamentos records
        const turmasAlunosTreinamentos = await this.uow.turmasAlunosTreinamentosRP.find({
            where: {
                id_turma_aluno: id_turma_aluno,
                deletado_em: null,
            },
        });

        // Soft delete all related turmas_alunos_treinamentos_contratos records
        for (const turmaAlunoTreinamento of turmasAlunosTreinamentos) {
            const contratos = await this.uow.turmasAlunosTreinamentosContratosRP.find({
                where: {
                    id_turma_aluno_treinamento: turmaAlunoTreinamento.id,
                    deletado_em: null,
                },
            });

            for (const contrato of contratos) {
                contrato.deletado_em = new Date();
                await this.uow.turmasAlunosTreinamentosContratosRP.save(contrato);
            }
        }

        // Soft delete all related turmas_alunos_treinamentos records
        for (const turmaAlunoTreinamento of turmasAlunosTreinamentos) {
            turmaAlunoTreinamento.deletado_em = new Date();
            await this.uow.turmasAlunosTreinamentosRP.save(turmaAlunoTreinamento);
        }

        // Soft delete all related turmas_alunos_produtos records
        const produtos = await this.uow.turmasAlunosProdutosRP.find({
            where: {
                id_turma_aluno: id_turma_aluno,
                deletado_em: null,
            },
        });

        for (const produto of produtos) {
            produto.deletado_em = new Date();
            await this.uow.turmasAlunosProdutosRP.save(produto);
        }

        // Soft delete all related turmas_alunos_treinamentos_bonus records
        const bonuses = await this.uow.turmasAlunosTreinamentosBonusRP.find({
            where: {
                id_turma_aluno: id_turma_aluno,
                deletado_em: null,
            },
        });

        for (const bonus of bonuses) {
            bonus.deletado_em = new Date();
            await this.uow.turmasAlunosTreinamentosBonusRP.save(bonus);
        }

        // Ao remover uma matrícula, manter o histórico de transferência para fins de auditoria.
        // Apenas limpamos referências diretas em matrículas ativas relacionadas.
        const historicosTransferencia = await this.uow.historicoTransferenciasRP.find({
            where: [
                { id_turma_aluno_de: id_turma_aluno, deletado_em: null },
                { id_turma_aluno_para: id_turma_aluno, deletado_em: null },
            ],
        });

        for (const historico of historicosTransferencia) {
            // Limpa referência "transferência para" na matrícula de origem, se existir e estiver ativa.
            if (historico.id_turma_aluno_de && historico.id_turma_aluno_de !== id_turma_aluno) {
                const matriculaOrigem = await this.uow.turmasAlunosRP.findOne({
                    where: { id: historico.id_turma_aluno_de, deletado_em: null },
                });
                if (matriculaOrigem) {
                    matriculaOrigem.id_turma_transferencia_para = null;
                    await this.uow.turmasAlunosRP.save(matriculaOrigem);
                }
            }

            // Limpa referência "transferência de" na matrícula de destino, se existir e estiver ativa.
            if (historico.id_turma_aluno_para && historico.id_turma_aluno_para !== id_turma_aluno) {
                const matriculaDestino = await this.uow.turmasAlunosRP.findOne({
                    where: { id: historico.id_turma_aluno_para, deletado_em: null },
                });
                if (matriculaDestino) {
                    matriculaDestino.id_turma_transferencia_de = null;
                    await this.uow.turmasAlunosRP.save(matriculaDestino);
                }
            }
        }

        // Finally, soft delete the turmas_alunos record
        matricula.deletado_em = new Date();
        await this.uow.turmasAlunosRP.save(matricula);
    }

    private async transferirCancelamentoParaTurmaCancelada(turmaAlunoOrigem: any, turmaCancelada: any, userId?: number): Promise<string> {
        const turmaOrigem = turmaAlunoOrigem.id_turma_fk;
        if (!turmaOrigem) {
            throw new NotFoundException('Turma de origem não encontrada');
        }

        // Turma de origem imediata (não a primeira da cadeia) — ver transferirAluno.
        const idTurmaOrigemImediata = turmaOrigem.id;
        const existenteNaCancelada = await this.uow.turmasAlunosRP.findOne({
            where: {
                id_turma: turmaCancelada.id,
                id_aluno: turmaAlunoOrigem.id_aluno,
                deletado_em: null,
            },
        });

        let matriculaDestino = existenteNaCancelada;
        if (!matriculaDestino) {
            const numeroCracha = await this.generateUniqueCrachaNumber(turmaCancelada.id);
            matriculaDestino = this.uow.turmasAlunosRP.create({
                id_turma: turmaCancelada.id,
                id_aluno: turmaAlunoOrigem.id_aluno,
                id_aluno_bonus: turmaAlunoOrigem.id_aluno_bonus,
                numero_cracha: numeroCracha,
                vaga_bonus: turmaAlunoOrigem.vaga_bonus ?? false,
                origem_aluno: turmaAlunoOrigem.origem_aluno,
                status_aluno_turma: EStatusAlunosTurmas.CANCELADO,
                confirmacao_realizada: false,
                checkin_realizado: false,
                presenca_turma: null,
                pendencia_pagamento: turmaAlunoOrigem.pendencia_pagamento,
                quantidade_inscricoes: turmaAlunoOrigem.quantidade_inscricoes ?? 1,
                outros_clientes: turmaAlunoOrigem.outros_clientes ?? [],
                comprovante_pagamento_base64: turmaAlunoOrigem.comprovante_pagamento_base64,
                url_comprovante_pgto: turmaAlunoOrigem.url_comprovante_pgto,
                id_turma_transferencia_de: idTurmaOrigemImediata,
                id_acessor: turmaAlunoOrigem.id_acessor ?? null,
            });
        } else {
            matriculaDestino.status_aluno_turma = EStatusAlunosTurmas.CANCELADO;
            matriculaDestino.confirmacao_realizada = false;
            matriculaDestino.checkin_realizado = false;
            matriculaDestino.presenca_turma = null;
            matriculaDestino.id_turma_transferencia_de = idTurmaOrigemImediata;
            matriculaDestino.id_acessor = matriculaDestino.id_acessor ?? turmaAlunoOrigem.id_acessor ?? null;
        }
        matriculaDestino = await this.uow.turmasAlunosRP.save(matriculaDestino);

        // Reaponta registros relacionados para a matrícula da turma CANCELADA,
        // preservando contratos e vínculos de bônus.
        const turmasAlunosTreinamentos = await this.uow.turmasAlunosTreinamentosRP.find({
            where: {
                id_turma_aluno: turmaAlunoOrigem.id,
                deletado_em: null,
            },
        });
        for (const item of turmasAlunosTreinamentos) {
            item.id_turma_aluno = matriculaDestino.id;
            await this.uow.turmasAlunosTreinamentosRP.save(item);
        }

        const produtos = await this.uow.turmasAlunosProdutosRP.find({
            where: {
                id_turma_aluno: turmaAlunoOrigem.id,
                deletado_em: null,
            },
        });
        for (const item of produtos) {
            item.id_turma_aluno = matriculaDestino.id;
            await this.uow.turmasAlunosProdutosRP.save(item);
        }

        const bonuses = await this.uow.turmasAlunosTreinamentosBonusRP.find({
            where: {
                id_turma_aluno: turmaAlunoOrigem.id,
                deletado_em: null,
            },
        });
        for (const item of bonuses) {
            item.deletado_em = new Date();
            await this.uow.turmasAlunosTreinamentosBonusRP.save(item);
        }

        const bonusesDestino = await this.uow.turmasAlunosTreinamentosBonusRP.find({
            where: {
                id_turma_aluno: matriculaDestino.id,
                deletado_em: null,
            },
        });
        for (const item of bonusesDestino) {
            item.deletado_em = new Date();
            await this.uow.turmasAlunosTreinamentosBonusRP.save(item);
        }

        const historico = this.uow.historicoTransferenciasRP.create({
            id_aluno: Number(turmaAlunoOrigem.id_aluno),
            id_turma_de: turmaOrigem.id,
            id_turma_para: turmaCancelada.id,
            id_turma_aluno_de: turmaAlunoOrigem.id,
            id_turma_aluno_para: matriculaDestino.id,
        });
        await this.uow.historicoTransferenciasRP.save(historico);

        await this.registrarLogAlunoTurma(
            {
                id_turma_aluno: turmaAlunoOrigem.id,
                id_turma: turmaOrigem.id,
                id_aluno: turmaAlunoOrigem.id_aluno,
                tipo_acao: 'CANCELAMENTO',
                titulo: 'Aluno cancelado e transferido para turma CANCELADA',
                descricao: `Movido para a turma ${turmaCancelada.edicao_turma || turmaCancelada.id}.`,
                detalhes: {
                    id_turma_origem: turmaOrigem.id,
                    id_turma_destino: turmaCancelada.id,
                    edicao_origem: turmaOrigem.edicao_turma,
                    edicao_destino: turmaCancelada.edicao_turma,
                },
            },
            userId,
        );

        await this.registrarLogAlunoTurma(
            {
                id_turma_aluno: matriculaDestino.id,
                id_turma: matriculaDestino.id_turma,
                id_aluno: matriculaDestino.id_aluno,
                tipo_acao: 'CANCELAMENTO',
                titulo: 'Aluno marcado como cancelado',
                descricao: 'Vínculo criado automaticamente na turma CANCELADA.',
                detalhes: {
                    id_turma_origem: turmaOrigem.id,
                    id_turma_destino: turmaCancelada.id,
                },
            },
            userId,
        );

        turmaAlunoOrigem.id_turma_transferencia_para = turmaCancelada.id;
        if (this.isTurmaCongelada(turmaOrigem)) {
            // Turma congelada: mantém o registro na origem (não remove), apenas replica para a turma CANCELADA.
        } else {
            turmaAlunoOrigem.presenca_turma = null;
            turmaAlunoOrigem.deletado_em = new Date();
        }
        await this.uow.turmasAlunosRP.save(turmaAlunoOrigem);
        return String(matriculaDestino.id);
    }

    /**
     * Remove uma matrícula de BÔNUS (ALUNO_BONUS) no contexto da edição de venda
     * do Histórico de Vendas. Diferente da remoção geral, NÃO exige setor Cuidado
     * de Alunos/acessora: qualquer usuário autenticado pode ajustar os bônus da
     * venda (CRUD de vendas sem matriz de permissões). A restrição é de domínio:
     * só matrículas com origem ALUNO_BONUS podem ser removidas por aqui.
     */
    async removeBonusVendaTurmaAluno(id_turma_aluno: string, userId?: number): Promise<void> {
        const turmaAluno = await this.uow.turmasAlunosRP.findOne({
            where: { id: id_turma_aluno },
            select: ['id', 'origem_aluno'] as any,
        });

        if (!turmaAluno) {
            throw new NotFoundException('Aluno não encontrado na turma');
        }

        if (turmaAluno.origem_aluno !== EOrigemAlunos.ALUNO_BONUS) {
            throw new BadRequestException('Esta matrícula não é de bônus; a remoção deve ser feita pela tela da turma.');
        }

        await this.removeAlunoTurma(id_turma_aluno, userId, 'Bônus removido na edição da venda (Histórico de Vendas).', {
            pularValidacaoPermissao: true,
        });
    }

    async removeAlunoTurma(id_turma_aluno: string, userId?: number, motivo?: string, opts?: { pularValidacaoPermissao?: boolean }): Promise<void> {
        try {
            const turmaAluno = await this.uow.turmasAlunosRP.findOne({
                where: { id: id_turma_aluno },
                relations: ['id_turma_fk', 'id_aluno_fk'],
            });

            if (!turmaAluno) {
                throw new NotFoundException('Aluno não encontrado na turma');
            }

            if (!opts?.pularValidacaoPermissao) {
                await this.validarPermissaoGerenciarAlunosTurma(turmaAluno.id_turma_fk, userId, 'remover');
            }

            if (this.isTurmaCongelada(turmaAluno.id_turma_fk)) {
                throw new BadRequestException('Não é possível remover alunos de uma turma encerrada. O registro permanece congelado para a trilha do aluno.');
            }

            const motivoLimpo = motivo?.trim();
            await this.registrarLogAlunoTurma(
                {
                    id_turma_aluno: turmaAluno.id,
                    id_turma: turmaAluno.id_turma,
                    id_aluno: turmaAluno.id_aluno,
                    tipo_acao: 'REMOCAO',
                    titulo: 'Aluno removido da turma',
                    descricao: motivoLimpo ? `Motivo: ${motivoLimpo}` : 'Matrícula removida manualmente.',
                    detalhes: {
                        nome_aluno: turmaAluno.id_aluno_fk?.nome,
                        status_aluno_turma: turmaAluno.status_aluno_turma,
                        motivo: motivoLimpo || null,
                    },
                },
                userId,
            );

            // Regra de remover: remove matrícula da turma e vínculos relacionados.
            await this.softDeleteAlunoTurmaCascade(id_turma_aluno, turmaAluno);
        } catch (error) {
            console.error('Erro ao remover aluno da turma:', error);
            if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ForbiddenException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao remover aluno da turma');
        }
    }

    async getTurmaStatusResumo(id_turma: number, opts?: { ignorarSnapshot?: boolean }): Promise<TurmaStatusResumoResponseDto> {
        if (!opts?.ignorarSnapshot) {
            const snapshot = await this.obterSnapshotMetricasTurma(id_turma);
            if (snapshot?.resumo) {
                return {
                    ...(snapshot.resumo as unknown as TurmaStatusResumoResponseDto),
                    congelado: true,
                    snapshot_em: snapshot.snapshot_em,
                };
            }
            // Sem snapshot: congela em background para não bloquear a leitura (turmas grandes
            // estouravam o timeout de 30s do axios). A resposta segue com os dados ao vivo.
            this.agendarCongelamentoEmBackground(id_turma);
        }

        const turma = await this.uow.turmasRP.findOne({
            where: { id: id_turma, deletado_em: null },
        });
        if (!turma) {
            throw new NotFoundException('Turma não encontrada');
        }

        const rawStatus = await this.uow.turmasAlunosRP
            .createQueryBuilder('ta')
            .select('ta.status_aluno_turma', 'status')
            .addSelect('COUNT(*)::int', 'total')
            .where('ta.id_turma = :id_turma', { id_turma })
            .andWhere('ta.deletado_em IS NULL')
            .groupBy('ta.status_aluno_turma')
            .getRawMany();

        const statusCounts: Record<string, number> = {};
        Object.values(EStatusAlunosTurmas).forEach((status) => {
            statusCounts[status] = 0;
        });

        for (const row of rawStatus) {
            const key = row.status || 'SEM_STATUS';
            statusCounts[key] = Number(row.total || 0);
        }

        const inscritos = await this.uow.turmasAlunosRP.count({
            where: { id_turma, deletado_em: null },
        });

        /**
         * Canais de entrada (mutuamente exclusivos por prioridade):
         * - Bônus
         * - Cortesia e sorteio: origem_aluno CORTESIA ou SORTEIO
         * - Time de vendas: histórico com turma de origem = esta turma
         * - Masterclass: último histórico externo qualificando OU id_turma_transferencia_de OU codigo_turma_origem_planilha começando com MC_
         * - Transferência: somente origem_aluno = TRANSFERENCIA (marcação na turma; movimentos só no histórico caem em “demais”)
         * - Demais vendas / importação: restante
         *
         * "Transferência > Para essa" (bloco abaixo) continua sendo contagem de linhas no histórico de movimentação.
         */
        const alunosOrigemEnriquecidos = await this.uow.turmasAlunosRP
            .createQueryBuilder('ta')
            .select('ta.id', 'id_turma_aluno')
            .addSelect('ta.origem_aluno', 'origem_aluno')
            .addSelect('ta.vaga_bonus', 'vaga_bonus')
            .addSelect('ta.codigo_turma_origem_planilha', 'codigo_turma_origem_planilha')
            .addSelect(
                `(EXISTS (
                    SELECT 1
                    FROM historico_transferencias_alunos h
                    WHERE h.id_turma_aluno_para = ta.id
                      AND h.id_turma_para = :id_turma
                      AND h.id_turma_de = :id_turma
                      AND h.deletado_em IS NULL
                ))`,
                'hist_time_vendas',
            )
            .addSelect(
                `(
                    COALESCE((
                        SELECT (
                            (tr.tipo_palestra = true OR tr.tipo_treinamento = false)
                            OR (
                                t_de.edicao_turma IS NOT NULL
                                AND LEFT(UPPER(TRIM(t_de.edicao_turma)), 3) = 'MC_'
                            )
                        )
                        FROM historico_transferencias_alunos h
                        INNER JOIN turmas t_de ON t_de.id = h.id_turma_de
                        INNER JOIN treinamentos tr ON tr.id = t_de.id_treinamento
                        WHERE h.id_turma_aluno_para = ta.id
                          AND h.id_turma_para = :id_turma
                          AND h.id_turma_de <> :id_turma
                          AND h.deletado_em IS NULL
                        ORDER BY h.id DESC
                        LIMIT 1
                    ), false)
                    OR (
                        ta.id_turma_transferencia_de IS NOT NULL
                        AND EXISTS (
                            SELECT 1
                            FROM turmas t_td
                            INNER JOIN treinamentos tr_td ON tr_td.id = t_td.id_treinamento
                            WHERE t_td.id = ta.id_turma_transferencia_de
                              AND t_td.deletado_em IS NULL
                              AND (
                                  tr_td.tipo_palestra = true
                                  OR tr_td.tipo_treinamento = false
                                  OR (
                                      t_td.edicao_turma IS NOT NULL
                                      AND LEFT(UPPER(TRIM(t_td.edicao_turma)), 3) = 'MC_'
                                  )
                              )
                        )
                    )
                    OR (
                        ta.codigo_turma_origem_planilha IS NOT NULL
                        AND LEFT(UPPER(TRIM(ta.codigo_turma_origem_planilha)), 3) = 'MC_'
                    )
                )`,
                'origem_turma_eh_palestra_ou_masterclass',
            )
            .where('ta.id_turma = :id_turma', { id_turma })
            .andWhere('ta.deletado_em IS NULL')
            .setParameter('id_turma', id_turma)
            .getRawMany();

        let origemMasterclass = 0;
        let origemPresente = 0;
        let origemBonus = 0;
        let origemCortesiaSorteio = 0;
        let origemTimeVendas = 0;
        let origemTransbordo = 0;
        let origemLiberty = 0;
        let origemTransferencia = 0;
        let origemImportacao = 0;

        const isTruthyPgBool = (v: unknown): boolean => v === true || v === 'true' || v === 't' || v === 1 || v === '1';

        for (const row of alunosOrigemEnriquecidos) {
            const origemAlunoBruta = row.origem_aluno;
            const origemAluno = Object.values(EOrigemAlunos).includes(origemAlunoBruta as EOrigemAlunos) ? (origemAlunoBruta as EOrigemAlunos) : null;
            const vagaBonus = Boolean(row.vaga_bonus);
            const histTimeVendas = isTruthyPgBool(row.hist_time_vendas);
            const codigoTurmaOrigemPlanilha = String(row.codigo_turma_origem_planilha || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim()
                .toUpperCase();
            /** Origem externa é MC/palestra: alinha a `isPalestra` usada em findById (tipo_palestra ou tipo_treinamento false) */
            const origemEhPalestraMc = row.origem_turma_eh_palestra_ou_masterclass;

            // Presente (importação Masterclass): origem própria que conta como extra.
            // Prioridade máxima para não ser reclassificada como MC/Demais Vendas.
            if (origemAluno === EOrigemAlunos.PRESENTE) {
                origemPresente += 1;
                continue;
            }

            if (vagaBonus || origemAluno === EOrigemAlunos.ALUNO_BONUS) {
                origemBonus += 1;
                continue;
            }

            if (origemAluno === EOrigemAlunos.CORTESIA || origemAluno === EOrigemAlunos.SORTEIO) {
                origemCortesiaSorteio += 1;
                continue;
            }

            if (histTimeVendas) {
                origemTimeVendas += 1;
                continue;
            }

            if (codigoTurmaOrigemPlanilha === 'TRANSBORDO') {
                origemTransbordo += 1;
                continue;
            }

            if (codigoTurmaOrigemPlanilha === 'LIBERTY') {
                origemLiberty += 1;
                continue;
            }

            if (isTruthyPgBool(origemEhPalestraMc)) {
                origemMasterclass += 1;
                continue;
            }

            if (origemAluno === EOrigemAlunos.TRANSFERENCIA) {
                origemTransferencia += 1;
                continue;
            }

            origemImportacao += 1;
        }

        const transferidosDessaTurmaParaOutra = await this.uow.historicoTransferenciasRP.count({
            where: {
                id_turma_de: id_turma,
                deletado_em: null,
            },
        });

        const transferidosDeOutraTurmaParaEssa = await this.uow.historicoTransferenciasRP.count({
            where: {
                id_turma_para: id_turma,
                deletado_em: null,
            },
        });

        const inadimplentes = await this.uow.turmasAlunosRP
            .createQueryBuilder('ta')
            .leftJoin('ta.id_aluno_fk', 'aluno')
            .where('ta.id_turma = :id_turma', { id_turma })
            .andWhere('ta.deletado_em IS NULL')
            .andWhere('aluno.status_aluno_geral = :status', { status: EStatusAlunosGeral.INADIMPLENTE })
            .getCount();

        return {
            id_turma,
            inscritos,
            origem_masterclass: origemMasterclass,
            origem_presente: origemPresente,
            origem_bonus: origemBonus,
            origem_time_vendas: origemTimeVendas,
            origem_transbordo: origemTransbordo,
            origem_liberty: origemLiberty,
            origem_transferencia: origemTransferencia,
            origem_cortesia_sorteio: origemCortesiaSorteio,
            origem_importacao: origemImportacao,
            transferidos: transferidosDessaTurmaParaOutra + transferidosDeOutraTurmaParaEssa,
            transferidos_dessa_turma_para_outra: transferidosDessaTurmaParaOutra,
            transferidos_de_outra_turma_para_essa: transferidosDeOutraTurmaParaEssa,
            falta_enviar_confirmacao: statusCounts[EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO] || 0,
            aguardando_confirmacao: statusCounts[EStatusAlunosTurmas.AGUARDANDO_CONFIRMACAO] || 0,
            confirmados: (statusCounts[EStatusAlunosTurmas.AGUARDANDO_CHECKIN] ?? 0) + (statusCounts[EStatusAlunosTurmas.CHECKIN_REALIZADO] ?? 0),
            falta_enviar_checkin: statusCounts.FALTA_ENVIAR_LINK_CHECKIN || 0,
            aguardando_checkin: statusCounts[EStatusAlunosTurmas.AGUARDANDO_CHECKIN] || 0,
            checkin_realizado: statusCounts[EStatusAlunosTurmas.CHECKIN_REALIZADO] || 0,
            cancelados: statusCounts[EStatusAlunosTurmas.CANCELADO] || 0,
            inadimplentes,
            status_counts: statusCounts,
        };
    }

    async getTurmaStatusAlunos(id_turma: number, tipo: string, opts?: { ignorarSnapshot?: boolean }): Promise<TurmaStatusAlunosResponseDto> {
        const tipoNormalizado = this.normalizarTipoStatusSnapshot(tipo);
        if (!opts?.ignorarSnapshot) {
            const snapshot = await this.obterSnapshotMetricasTurma(id_turma);
            const alunosPorTipo = (snapshot?.alunos_por_tipo || {}) as Record<string, TurmaStatusAlunosResponseDto>;
            if (alunosPorTipo?.[tipoNormalizado]) {
                return alunosPorTipo[tipoNormalizado];
            }
            // Sem snapshot: congela em background para não bloquear a leitura (turmas grandes
            // estouravam o timeout de 30s do axios). A resposta segue com os dados ao vivo.
            this.agendarCongelamentoEmBackground(id_turma);
        }

        tipo = tipoNormalizado;
        const turma = await this.uow.turmasRP.findOne({
            where: { id: id_turma, deletado_em: null },
        });
        if (!turma) {
            throw new NotFoundException('Turma não encontrada');
        }

        const qb = this.uow.turmasAlunosRP
            .createQueryBuilder('ta')
            .leftJoin('ta.id_aluno_fk', 'aluno')
            .leftJoin(Usuarios, 'usuarioInsercao', 'usuarioInsercao.id = ta.criado_por')
            .select('ta.id', 'id_turma_aluno')
            .addSelect('aluno.id', 'id_aluno')
            .addSelect('aluno.nome', 'nome')
            .addSelect('aluno.email', 'email')
            .addSelect('aluno.telefone_um', 'telefone')
            .addSelect('aluno.status_aluno_geral', 'status_aluno_geral')
            .addSelect('ta.status_aluno_turma', 'status_aluno_turma')
            .addSelect('ta.confirmacao_realizada', 'confirmacao_realizada')
            .addSelect('ta.checkin_realizado', 'checkin_realizado')
            .addSelect('ta.criado_em', 'inserido_em')
            .addSelect('usuarioInsercao.nome', 'inserido_por_nome')
            .where('ta.id_turma = :id_turma', { id_turma })
            .andWhere('ta.deletado_em IS NULL');

        let titulo = '';
        const formatTurmaRelacionada = (
            siglaTreinamento?: string | null,
            siglaPolo?: string | null,
            edicao?: string | null,
            turmaId?: number | null,
        ): string | null => {
            const treino = (siglaTreinamento || '').trim().toUpperCase();
            const polo = (siglaPolo || '').trim().toUpperCase();
            const ed = (edicao || '').trim().toUpperCase();
            if (treino && polo && ed) return `${treino}_${polo}_${ed}`;
            if (ed) return ed;
            return turmaId ? `Turma #${turmaId}` : null;
        };

        switch (tipo) {
            case 'inscritos':
                titulo = 'Inscritos';
                break;
            case 'origem_presente':
                titulo = 'Origem: Estratégia Presente';
                qb.andWhere('ta.origem_aluno = :origemPresente', {
                    origemPresente: EOrigemAlunos.PRESENTE,
                });
                break;
            case 'origem_masterclass':
                titulo = 'Origem: Masterclass';
                qb.andWhere('ta.vaga_bonus = false');
                qb.andWhere('(ta.origem_aluno IS NULL OR ta.origem_aluno NOT IN (:...origemExclMc))', {
                    origemExclMc: [EOrigemAlunos.CORTESIA, EOrigemAlunos.SORTEIO, EOrigemAlunos.PRESENTE],
                });
                qb.andWhere(
                    `NOT EXISTS (
                        SELECT 1
                        FROM historico_transferencias_alunos hta
                        WHERE hta.id_turma_aluno_para = ta.id
                          AND hta.id_turma_para = :id_turma
                          AND hta.id_turma_de = :id_turma
                          AND hta.deletado_em IS NULL
                    )`,
                    { id_turma },
                );
                qb.andWhere(
                    `(
                        EXISTS (
                            SELECT 1
                            FROM historico_transferencias_alunos hta
                            INNER JOIN turmas t_de ON t_de.id = hta.id_turma_de
                            INNER JOIN treinamentos tr_de ON tr_de.id = t_de.id_treinamento
                            WHERE hta.id_turma_aluno_para = ta.id
                              AND hta.id_turma_para = :id_turma
                              AND hta.id_turma_de <> :id_turma
                              AND hta.deletado_em IS NULL
                              AND hta.id = (
                                  SELECT h2.id
                                  FROM historico_transferencias_alunos h2
                                  WHERE h2.id_turma_aluno_para = ta.id
                                    AND h2.id_turma_para = :id_turma
                                    AND h2.id_turma_de <> :id_turma
                                    AND h2.deletado_em IS NULL
                                  ORDER BY h2.id DESC
                                  LIMIT 1
                              )
                              AND (
                                  (tr_de.tipo_palestra = true OR tr_de.tipo_treinamento = false)
                                  OR (
                                      t_de.edicao_turma IS NOT NULL
                                      AND LEFT(UPPER(TRIM(t_de.edicao_turma)), 3) = 'MC_'
                                  )
                              )
                        )
                        OR (
                            ta.id_turma_transferencia_de IS NOT NULL
                            AND EXISTS (
                                SELECT 1
                                FROM turmas t_td
                                INNER JOIN treinamentos tr_td ON tr_td.id = t_td.id_treinamento
                                WHERE t_td.id = ta.id_turma_transferencia_de
                                  AND t_td.deletado_em IS NULL
                                  AND (
                                      tr_td.tipo_palestra = true
                                      OR tr_td.tipo_treinamento = false
                                      OR (
                                          t_td.edicao_turma IS NOT NULL
                                          AND LEFT(UPPER(TRIM(t_td.edicao_turma)), 3) = 'MC_'
                                      )
                                      )
                            )
                        )
                        OR (
                            ta.codigo_turma_origem_planilha IS NOT NULL
                            AND LEFT(UPPER(TRIM(ta.codigo_turma_origem_planilha)), 3) = 'MC_'
                        )
                    )`,
                    { id_turma },
                );
                break;
            case 'origem_bonus':
                titulo = 'Origem: Bônus';
                qb.andWhere('(ta.vaga_bonus = true OR ta.origem_aluno = :origemBonus)', {
                    origemBonus: EOrigemAlunos.ALUNO_BONUS,
                });
                break;
            case 'origem_cortesia_sorteio':
                titulo = 'Origem: Cortesia e sorteio';
                qb.andWhere('ta.origem_aluno IN (:...origensCs)', {
                    origensCs: [EOrigemAlunos.CORTESIA, EOrigemAlunos.SORTEIO],
                });
                break;
            case 'origem_time_vendas':
                titulo = 'Origem: Time de vendas';
                qb.andWhere('ta.vaga_bonus = false');
                qb.andWhere('(ta.origem_aluno IS NULL OR ta.origem_aluno NOT IN (:...origemExclTv))', {
                    origemExclTv: [EOrigemAlunos.CORTESIA, EOrigemAlunos.SORTEIO, EOrigemAlunos.PRESENTE],
                });
                qb.andWhere(
                    `EXISTS (
                        SELECT 1
                        FROM historico_transferencias_alunos hta
                        WHERE hta.id_turma_aluno_para = ta.id
                          AND hta.id_turma_para = :id_turma
                          AND hta.id_turma_de = :id_turma
                          AND hta.deletado_em IS NULL
                    )`,
                    { id_turma },
                );
                break;
            case 'origem_transbordo':
                titulo = 'Origem: Transbordo';
                qb.andWhere("UPPER(TRIM(COALESCE(ta.codigo_turma_origem_planilha, ''))) = :origemTransbordo", {
                    origemTransbordo: 'TRANSBORDO',
                });
                break;
            case 'origem_liberty':
                titulo = 'Origem: Liberty';
                qb.andWhere("UPPER(TRIM(COALESCE(ta.codigo_turma_origem_planilha, ''))) = :origemLiberty", {
                    origemLiberty: 'LIBERTY',
                });
                break;
            case 'origem_transferencia':
                titulo = 'Origem: Transferência';
                qb.andWhere('ta.vaga_bonus = false');
                qb.andWhere('ta.origem_aluno = :origemTransferencia', {
                    origemTransferencia: EOrigemAlunos.TRANSFERENCIA,
                });
                break;
            case 'origem_importacao':
                titulo = 'Origem: Demais vendas / importação';
                qb.andWhere('ta.vaga_bonus = false');
                qb.andWhere('(ta.origem_aluno IS NULL OR ta.origem_aluno <> :origemBonus)', {
                    origemBonus: EOrigemAlunos.ALUNO_BONUS,
                });
                qb.andWhere('(ta.origem_aluno IS NULL OR ta.origem_aluno NOT IN (:...origemExclDemais))', {
                    origemExclDemais: [EOrigemAlunos.CORTESIA, EOrigemAlunos.SORTEIO, EOrigemAlunos.TRANSFERENCIA, EOrigemAlunos.PRESENTE],
                });
                qb.andWhere("UPPER(TRIM(COALESCE(ta.codigo_turma_origem_planilha, ''))) NOT IN (:...origensPlanilhaExclDemais)", {
                    origensPlanilhaExclDemais: ['TRANSBORDO', 'LIBERTY'],
                });
                qb.andWhere(
                    `NOT EXISTS (
                        SELECT 1
                        FROM historico_transferencias_alunos hta
                        WHERE hta.id_turma_aluno_para = ta.id
                          AND hta.id_turma_para = :id_turma
                          AND hta.id_turma_de = :id_turma
                          AND hta.deletado_em IS NULL
                    )`,
                    { id_turma },
                );
                qb.andWhere(
                    `NOT (
                        EXISTS (
                            SELECT 1
                            FROM historico_transferencias_alunos hta
                            INNER JOIN turmas t_de ON t_de.id = hta.id_turma_de
                            INNER JOIN treinamentos tr_de ON tr_de.id = t_de.id_treinamento
                            WHERE hta.id_turma_aluno_para = ta.id
                              AND hta.id_turma_para = :id_turma
                              AND hta.id_turma_de <> :id_turma
                              AND hta.deletado_em IS NULL
                              AND hta.id = (
                                  SELECT h2.id
                                  FROM historico_transferencias_alunos h2
                                  WHERE h2.id_turma_aluno_para = ta.id
                                    AND h2.id_turma_para = :id_turma
                                    AND h2.id_turma_de <> :id_turma
                                    AND h2.deletado_em IS NULL
                                  ORDER BY h2.id DESC
                                  LIMIT 1
                              )
                              AND (
                                  (tr_de.tipo_palestra = true OR tr_de.tipo_treinamento = false)
                                  OR (
                                      t_de.edicao_turma IS NOT NULL
                                      AND LEFT(UPPER(TRIM(t_de.edicao_turma)), 3) = 'MC_'
                                  )
                              )
                        )
                        OR (
                            ta.id_turma_transferencia_de IS NOT NULL
                            AND EXISTS (
                                SELECT 1
                                FROM turmas t_td
                                INNER JOIN treinamentos tr_td ON tr_td.id = t_td.id_treinamento
                                WHERE t_td.id = ta.id_turma_transferencia_de
                                  AND t_td.deletado_em IS NULL
                                  AND (
                                      tr_td.tipo_palestra = true
                                      OR tr_td.tipo_treinamento = false
                                      OR (
                                          t_td.edicao_turma IS NOT NULL
                                          AND LEFT(UPPER(TRIM(t_td.edicao_turma)), 3) = 'MC_'
                                      )
                                  )
                            )
                        )
                        OR (
                            ta.codigo_turma_origem_planilha IS NOT NULL
                            AND LEFT(UPPER(TRIM(ta.codigo_turma_origem_planilha)), 3) = 'MC_'
                        )
                    )`,
                    { id_turma },
                );
                break;
            case 'transferidos':
                titulo = 'Transferidos';
                {
                    const rawTransferidos = await this.uow.historicoTransferenciasRP
                        .createQueryBuilder('ht')
                        .leftJoin('ht.id_aluno_fk', 'aluno')
                        .leftJoin('ht.id_turma_aluno_para_fk', 'taPara')
                        .leftJoin('ht.id_turma_aluno_de_fk', 'taDe')
                        .leftJoin('ht.id_turma_de_fk', 'turmaDe')
                        .leftJoin('ht.id_turma_para_fk', 'turmaPara')
                        .leftJoin('turmaDe.id_treinamento_fk', 'treinoDe')
                        .leftJoin('turmaDe.id_polo_fk', 'poloDe')
                        .leftJoin('turmaPara.id_treinamento_fk', 'treinoPara')
                        .leftJoin('turmaPara.id_polo_fk', 'poloPara')
                        .leftJoin(Usuarios, 'usuarioInsercao', 'usuarioInsercao.id = ht.criado_por')
                        .select('COALESCE(ht.id_turma_aluno_para::text, ht.id_turma_aluno_de::text, ht.id::text)', 'id_turma_aluno')
                        .addSelect('ht.criado_em', 'inserido_em')
                        .addSelect('usuarioInsercao.nome', 'inserido_por_nome')
                        .addSelect('aluno.id', 'id_aluno')
                        .addSelect('aluno.nome', 'nome')
                        .addSelect('aluno.email', 'email')
                        .addSelect('aluno.telefone_um', 'telefone')
                        .addSelect('aluno.status_aluno_geral', 'status_aluno_geral')
                        .addSelect('COALESCE(taPara.status_aluno_turma, taDe.status_aluno_turma)', 'status_aluno_turma')
                        .addSelect('COALESCE(taPara.confirmacao_realizada, taDe.confirmacao_realizada)', 'confirmacao_realizada')
                        .addSelect('COALESCE(taPara.checkin_realizado, taDe.checkin_realizado)', 'checkin_realizado')
                        .addSelect('ht.id_turma_de', 'id_turma_de')
                        .addSelect('ht.id_turma_para', 'id_turma_para')
                        .addSelect('turmaDe.edicao_turma', 'turma_de_edicao')
                        .addSelect('turmaPara.edicao_turma', 'turma_para_edicao')
                        .addSelect('treinoDe.sigla_treinamento', 'turma_de_sigla_treinamento')
                        .addSelect('poloDe.sigla_polo', 'turma_de_sigla_polo')
                        .addSelect('treinoPara.sigla_treinamento', 'turma_para_sigla_treinamento')
                        .addSelect('poloPara.sigla_polo', 'turma_para_sigla_polo')
                        .where('(ht.id_turma_de = :id_turma OR ht.id_turma_para = :id_turma)', { id_turma })
                        .andWhere('ht.deletado_em IS NULL')
                        .orderBy('aluno.nome', 'ASC')
                        .getRawMany();

                    const alunosTransferidos: TurmaStatusAlunosItemDto[] = rawTransferidos.map((row) => ({
                        id_turma_aluno: String(row.id_turma_aluno),
                        id_aluno: Number(row.id_aluno),
                        nome: row.nome,
                        email: row.email,
                        telefone: row.telefone,
                        status_aluno_geral: row.status_aluno_geral || null,
                        status_aluno_turma: (row.status_aluno_turma as EStatusAlunosTurmas) || null,
                        confirmacao_realizada: row.confirmacao_realizada === true || row.confirmacao_realizada === 'true',
                        checkin_realizado: row.checkin_realizado === true || row.checkin_realizado === 'true',
                        transferencia_direcao: Number(row.id_turma_para) === id_turma ? 'Transferido De' : 'Transferido Para',
                        transferencia_turma_relacionada:
                            Number(row.id_turma_para) === id_turma
                                ? formatTurmaRelacionada(row.turma_de_sigla_treinamento, row.turma_de_sigla_polo, row.turma_de_edicao, Number(row.id_turma_de))
                                : formatTurmaRelacionada(
                                      row.turma_para_sigla_treinamento,
                                      row.turma_para_sigla_polo,
                                      row.turma_para_edicao,
                                      Number(row.id_turma_para),
                                  ),
                        inserido_em: row.inserido_em ? new Date(row.inserido_em).toISOString() : null,
                        inserido_por_nome: row.inserido_por_nome || null,
                    }));

                    return {
                        id_turma,
                        tipo,
                        titulo,
                        total: alunosTransferidos.length,
                        alunos: alunosTransferidos,
                    };
                }
            case 'transferidos_para_essa':
                titulo = 'Transferência para essa turma';
                {
                    const rawTransferidosParaEssa = await this.uow.historicoTransferenciasRP
                        .createQueryBuilder('ht')
                        .leftJoin('ht.id_aluno_fk', 'aluno')
                        .leftJoin('ht.id_turma_aluno_para_fk', 'taPara')
                        .leftJoin('ht.id_turma_de_fk', 'turmaDe')
                        .leftJoin('turmaDe.id_treinamento_fk', 'treinoDe')
                        .leftJoin('turmaDe.id_polo_fk', 'poloDe')
                        .leftJoin(Usuarios, 'usuarioInsercao', 'usuarioInsercao.id = ht.criado_por')
                        .select('COALESCE(ht.id_turma_aluno_para::text, ht.id::text)', 'id_turma_aluno')
                        .addSelect('ht.criado_em', 'inserido_em')
                        .addSelect('usuarioInsercao.nome', 'inserido_por_nome')
                        .addSelect('aluno.id', 'id_aluno')
                        .addSelect('aluno.nome', 'nome')
                        .addSelect('aluno.email', 'email')
                        .addSelect('aluno.telefone_um', 'telefone')
                        .addSelect('aluno.status_aluno_geral', 'status_aluno_geral')
                        .addSelect('taPara.status_aluno_turma', 'status_aluno_turma')
                        .addSelect('taPara.confirmacao_realizada', 'confirmacao_realizada')
                        .addSelect('taPara.checkin_realizado', 'checkin_realizado')
                        .addSelect('ht.id_turma_de', 'id_turma_de')
                        .addSelect('turmaDe.edicao_turma', 'turma_de_edicao')
                        .addSelect('treinoDe.sigla_treinamento', 'turma_de_sigla_treinamento')
                        .addSelect('poloDe.sigla_polo', 'turma_de_sigla_polo')
                        .where('ht.id_turma_para = :id_turma', { id_turma })
                        .andWhere('ht.deletado_em IS NULL')
                        .orderBy('aluno.nome', 'ASC')
                        .getRawMany();

                    const alunosTransferidosParaEssa: TurmaStatusAlunosItemDto[] = rawTransferidosParaEssa.map((row) => ({
                        id_turma_aluno: String(row.id_turma_aluno),
                        id_aluno: Number(row.id_aluno),
                        nome: row.nome,
                        email: row.email,
                        telefone: row.telefone,
                        status_aluno_geral: row.status_aluno_geral || null,
                        status_aluno_turma: (row.status_aluno_turma as EStatusAlunosTurmas) || null,
                        confirmacao_realizada: row.confirmacao_realizada === true || row.confirmacao_realizada === 'true',
                        checkin_realizado: row.checkin_realizado === true || row.checkin_realizado === 'true',
                        transferencia_direcao: 'Transferido De',
                        transferencia_turma_relacionada: formatTurmaRelacionada(
                            row.turma_de_sigla_treinamento,
                            row.turma_de_sigla_polo,
                            row.turma_de_edicao,
                            Number(row.id_turma_de),
                        ),
                        inserido_em: row.inserido_em ? new Date(row.inserido_em).toISOString() : null,
                        inserido_por_nome: row.inserido_por_nome || null,
                    }));

                    return {
                        id_turma,
                        tipo,
                        titulo,
                        total: alunosTransferidosParaEssa.length,
                        alunos: alunosTransferidosParaEssa,
                    };
                }
            case 'transferidos_para_outra':
                titulo = 'Transferências para outra turma';
                {
                    const rawTransferidosParaOutra = await this.uow.historicoTransferenciasRP
                        .createQueryBuilder('ht')
                        .leftJoin('ht.id_aluno_fk', 'aluno')
                        .leftJoin('ht.id_turma_aluno_de_fk', 'taDe')
                        .leftJoin('ht.id_turma_para_fk', 'turmaPara')
                        .leftJoin('turmaPara.id_treinamento_fk', 'treinoPara')
                        .leftJoin('turmaPara.id_polo_fk', 'poloPara')
                        .leftJoin(Usuarios, 'usuarioInsercao', 'usuarioInsercao.id = ht.criado_por')
                        .select('COALESCE(ht.id_turma_aluno_de::text, ht.id::text)', 'id_turma_aluno')
                        .addSelect('ht.criado_em', 'inserido_em')
                        .addSelect('usuarioInsercao.nome', 'inserido_por_nome')
                        .addSelect('aluno.id', 'id_aluno')
                        .addSelect('aluno.nome', 'nome')
                        .addSelect('aluno.email', 'email')
                        .addSelect('aluno.telefone_um', 'telefone')
                        .addSelect('aluno.status_aluno_geral', 'status_aluno_geral')
                        .addSelect('taDe.status_aluno_turma', 'status_aluno_turma')
                        .addSelect('taDe.confirmacao_realizada', 'confirmacao_realizada')
                        .addSelect('taDe.checkin_realizado', 'checkin_realizado')
                        .addSelect('ht.id_turma_para', 'id_turma_para')
                        .addSelect('turmaPara.edicao_turma', 'turma_para_edicao')
                        .addSelect('treinoPara.sigla_treinamento', 'turma_para_sigla_treinamento')
                        .addSelect('poloPara.sigla_polo', 'turma_para_sigla_polo')
                        .where('ht.id_turma_de = :id_turma', { id_turma })
                        .andWhere('ht.deletado_em IS NULL')
                        .orderBy('aluno.nome', 'ASC')
                        .getRawMany();

                    const alunosTransferidosParaOutra: TurmaStatusAlunosItemDto[] = rawTransferidosParaOutra.map((row) => ({
                        id_turma_aluno: String(row.id_turma_aluno),
                        id_aluno: Number(row.id_aluno),
                        nome: row.nome,
                        email: row.email,
                        telefone: row.telefone,
                        status_aluno_geral: row.status_aluno_geral || null,
                        status_aluno_turma: (row.status_aluno_turma as EStatusAlunosTurmas) || null,
                        confirmacao_realizada: row.confirmacao_realizada === true || row.confirmacao_realizada === 'true',
                        checkin_realizado: row.checkin_realizado === true || row.checkin_realizado === 'true',
                        transferencia_direcao: 'Transferido Para',
                        transferencia_turma_relacionada: formatTurmaRelacionada(
                            row.turma_para_sigla_treinamento,
                            row.turma_para_sigla_polo,
                            row.turma_para_edicao,
                            Number(row.id_turma_para),
                        ),
                        inserido_em: row.inserido_em ? new Date(row.inserido_em).toISOString() : null,
                        inserido_por_nome: row.inserido_por_nome || null,
                    }));

                    return {
                        id_turma,
                        tipo,
                        titulo,
                        total: alunosTransferidosParaOutra.length,
                        alunos: alunosTransferidosParaOutra,
                    };
                }
            case 'confirmados':
                titulo = 'Confirmados';
                qb.andWhere('ta.status_aluno_turma IN (:...status)', {
                    status: [EStatusAlunosTurmas.AGUARDANDO_CHECKIN, EStatusAlunosTurmas.CHECKIN_REALIZADO],
                });
                break;
            case 'confirmacao_aguardando':
                titulo = 'Aguardando confirmação';
                qb.andWhere('ta.status_aluno_turma IN (:...status)', {
                    status: [EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO, EStatusAlunosTurmas.AGUARDANDO_CONFIRMACAO],
                });
                break;
            case 'checkin_aguardando':
                titulo = 'Aguardando check-in';
                qb.andWhere('ta.status_aluno_turma = :status', {
                    status: EStatusAlunosTurmas.AGUARDANDO_CHECKIN,
                });
                break;
            case 'checkin_realizado':
                titulo = 'Check-in realizado';
                qb.andWhere('ta.status_aluno_turma = :status', {
                    status: EStatusAlunosTurmas.CHECKIN_REALIZADO,
                });
                break;
            case 'cancelados':
                titulo = 'Cancelados';
                qb.andWhere('ta.status_aluno_turma = :status', {
                    status: EStatusAlunosTurmas.CANCELADO,
                });
                break;
            case 'inadimplentes':
                titulo = 'Inadimplentes';
                qb.andWhere('aluno.status_aluno_geral = :status', {
                    status: EStatusAlunosGeral.INADIMPLENTE,
                });
                break;
            default:
                titulo = 'Inscritos';
                break;
        }

        qb.orderBy('aluno.nome', 'ASC');

        const raw = await qb.getRawMany();

        const alunos: TurmaStatusAlunosItemDto[] = raw.map((row) => ({
            id_turma_aluno: String(row.id_turma_aluno),
            id_aluno: Number(row.id_aluno),
            nome: row.nome,
            email: row.email,
            telefone: row.telefone,
            status_aluno_geral: row.status_aluno_geral || null,
            status_aluno_turma: (row.status_aluno_turma as EStatusAlunosTurmas) || null,
            confirmacao_realizada: row.confirmacao_realizada === true || row.confirmacao_realizada === 'true',
            checkin_realizado: row.checkin_realizado === true || row.checkin_realizado === 'true',
            inserido_em: row.inserido_em ? new Date(row.inserido_em).toISOString() : null,
            inserido_por_nome: row.inserido_por_nome || null,
        }));

        return {
            id_turma,
            tipo,
            titulo,
            total: alunos.length,
            alunos,
        };
    }

    async updateAlunoTurma(id_turma_aluno: string, updateAlunoDto: UpdateAlunoTurmaDto, userId?: number): Promise<AlunoTurmaResponseDto> {
        try {
            const turmaAluno = await this.uow.turmasAlunosRP.findOne({
                where: { id: id_turma_aluno },
                relations: ['id_aluno_fk', 'id_turma_fk', 'id_turma_fk.id_polo_fk', 'id_turma_fk.id_treinamento_fk', 'id_turma_fk.id_endereco_evento_fk'],
            });

            if (!turmaAluno) {
                throw new NotFoundException('Aluno não encontrado na turma');
            }

            // Armazenar status anterior para verificar mudança
            const statusAnterior = turmaAluno.status_aluno_turma;
            const presencaAnterior = turmaAluno.presenca_turma;
            // Datas de assinatura da mentoria atualizadas (refletidas na resposta quando editadas).
            let datasMentoriaResposta: { inicio: string | null; fim: string | null } | null = null;
            const beforeSnapshot = {
                nome_cracha: turmaAluno.id_aluno_fk?.nome_cracha,
                url_comprovante_pgto: turmaAluno.url_comprovante_pgto,
                pendencia_pagamento: turmaAluno.pendencia_pagamento,
                quantidade_inscricoes: turmaAluno.quantidade_inscricoes,
                outros_clientes: turmaAluno.outros_clientes,
                comprovante_pagamento_base64: turmaAluno.comprovante_pagamento_base64,
                status_aluno_turma: turmaAluno.status_aluno_turma,
                origem_aluno: turmaAluno.origem_aluno,
                presenca_turma: turmaAluno.presenca_turma,
                confirmacao_realizada: turmaAluno.confirmacao_realizada,
                checkin_realizado: turmaAluno.checkin_realizado,
            };

            // Atualizar campos fornecidos
            // O "como gostaria de ser chamado" agora vive apenas no cadastro do aluno.
            if (updateAlunoDto.nome_cracha !== undefined) {
                if (turmaAluno.id_aluno_fk && turmaAluno.id_aluno_fk.nome_cracha !== updateAlunoDto.nome_cracha) {
                    turmaAluno.id_aluno_fk.nome_cracha = updateAlunoDto.nome_cracha;
                    await this.uow.alunosRP.update({ id: turmaAluno.id_aluno_fk.id }, { nome_cracha: updateAlunoDto.nome_cracha });
                }
            }
            if (updateAlunoDto.url_comprovante_pgto !== undefined) {
                turmaAluno.url_comprovante_pgto = updateAlunoDto.url_comprovante_pgto;
            }
            if (updateAlunoDto.pendencia_pagamento !== undefined) {
                turmaAluno.pendencia_pagamento = updateAlunoDto.pendencia_pagamento;
            }
            if (updateAlunoDto.quantidade_inscricoes !== undefined) {
                turmaAluno.quantidade_inscricoes = updateAlunoDto.quantidade_inscricoes;
            }
            if (updateAlunoDto.outros_clientes !== undefined) {
                turmaAluno.outros_clientes = updateAlunoDto.outros_clientes;
            }
            if (updateAlunoDto.comprovante_pagamento_base64 !== undefined) {
                turmaAluno.comprovante_pagamento_base64 = updateAlunoDto.comprovante_pagamento_base64;
            }
            const novoStatusAlunoTurma = updateAlunoDto.status_aluno_turma;
            if (
                novoStatusAlunoTurma !== undefined &&
                novoStatusAlunoTurma !== turmaAluno.status_aluno_turma &&
                novoStatusAlunoTurma !== EStatusAlunosTurmas.CANCELADO &&
                turmaAluno.id_aluno_fk?.status_aluno_geral === EStatusAlunosGeral.INADIMPLENTE
            ) {
                throw new BadRequestException('Não é possível alterar o status na turma para aluno com status geral INADIMPLENTE.');
            }
            if (novoStatusAlunoTurma !== undefined) {
                turmaAluno.status_aluno_turma = novoStatusAlunoTurma;
            }
            if (updateAlunoDto.origem_aluno !== undefined) {
                turmaAluno.origem_aluno = updateAlunoDto.origem_aluno;
                turmaAluno.vaga_bonus = updateAlunoDto.origem_aluno === EOrigemAlunos.ALUNO_BONUS;
                // Ao deixar de ser TRANSFERENCIA, limpa a turma de origem registrada.
                if (updateAlunoDto.origem_aluno !== EOrigemAlunos.TRANSFERENCIA && updateAlunoDto.id_turma_transferencia_de === undefined) {
                    turmaAluno.id_turma_transferencia_de = null;
                }
            }
            // Turma de onde o aluno veio (origem TRANSFERENCIA editada manualmente).
            if (updateAlunoDto.id_turma_transferencia_de !== undefined) {
                turmaAluno.id_turma_transferencia_de = updateAlunoDto.id_turma_transferencia_de;
            }
            // Forma de pagamento MANUAL (negociação extra sistema): permitida somente
            // quando o aluno NÃO tem forma de pagamento resolvida por contrato.
            if (updateAlunoDto.forma_pagamento_manual !== undefined) {
                // Cast seguro: o valor é validado contra o enum logo abaixo (BadRequestException se inválido).
                const novaFormaManual = updateAlunoDto.forma_pagamento_manual as EFormasPagamento | null;
                if (novaFormaManual !== null) {
                    const formasValidas = Object.values(EFormasPagamento) as string[];
                    if (!formasValidas.includes(novaFormaManual)) {
                        throw new BadRequestException('Forma de pagamento inválida.');
                    }
                    const formasContrato = (await this.resolverFormasPagamentoPorTurmaAluno(turmaAluno.id_turma, [turmaAluno.id])).get(turmaAluno.id) ?? [];
                    if (formasContrato.length > 0) {
                        throw new BadRequestException(
                            'Este aluno já possui forma de pagamento vinda do contrato; a forma manual só é permitida quando ela está indisponível.',
                        );
                    }
                }
                turmaAluno.forma_pagamento_manual = novaFormaManual;
                if (novaFormaManual !== EFormasPagamento.BOLETO) {
                    // Detalhes de boleto só fazem sentido quando a forma manual é BOLETO.
                    turmaAluno.boleto_dia_vencimento_manual = null;
                    turmaAluno.boleto_quantidade_manual = null;
                }
            }
            if (updateAlunoDto.boleto_dia_vencimento_manual !== undefined) {
                const dia = updateAlunoDto.boleto_dia_vencimento_manual;
                if (dia !== null && (dia < 1 || dia > 31)) {
                    throw new BadRequestException('O dia de vencimento do boleto deve estar entre 1 e 31.');
                }
                if (dia !== null && turmaAluno.forma_pagamento_manual !== EFormasPagamento.BOLETO) {
                    throw new BadRequestException('O dia de vencimento só pode ser informado quando a forma de pagamento manual é Boleto.');
                }
                turmaAluno.boleto_dia_vencimento_manual = dia;
            }
            if (updateAlunoDto.boleto_quantidade_manual !== undefined) {
                const quantidade = updateAlunoDto.boleto_quantidade_manual;
                if (quantidade !== null && (quantidade < 1 || quantidade > 120)) {
                    throw new BadRequestException('A quantidade de boletos deve estar entre 1 e 120.');
                }
                if (quantidade !== null && turmaAluno.forma_pagamento_manual !== EFormasPagamento.BOLETO) {
                    throw new BadRequestException('A quantidade de boletos só pode ser informada quando a forma de pagamento manual é Boleto.');
                }
                turmaAluno.boleto_quantidade_manual = quantidade;
            }
            // Acessor responsável: disponível apenas para alunos que entraram por boleto.
            if (updateAlunoDto.id_acessor !== undefined) {
                if (updateAlunoDto.id_acessor !== null) {
                    const formasAluno = (await this.resolverFormasPagamentoPorTurmaAluno(turmaAluno.id_turma, [turmaAluno.id])).get(turmaAluno.id) ?? [];
                    const boletoManual = turmaAluno.forma_pagamento_manual === EFormasPagamento.BOLETO;
                    if (!formasAluno.includes(EFormasPagamento.BOLETO) && !boletoManual) {
                        throw new BadRequestException('O Acessor Financeiro só pode ser definido para alunos que entraram por boleto.');
                    }
                    const acessorExiste = await this.uow.usuariosRP.findOne({ where: { id: updateAlunoDto.id_acessor }, select: { id: true } });
                    if (!acessorExiste) {
                        throw new BadRequestException('Acessor Financeiro (usuário) não encontrado.');
                    }
                    const idsFinanceiros = await this.configuracoesService.getAssessoresFinanceirosIds();
                    if (!idsFinanceiros.includes(Number(updateAlunoDto.id_acessor))) {
                        throw new BadRequestException('Este usuário não está na lista de Assessores Financeiros (Configurações).');
                    }
                }
                turmaAluno.id_acessor = updateAlunoDto.id_acessor;
            }
            if (updateAlunoDto.presenca_turma !== undefined) {
                const novaPresenca = (updateAlunoDto.presenca_turma as EPresencaTurmas | null) ?? null;
                const mudouPresenca = (turmaAluno.presenca_turma ?? null) !== novaPresenca;
                // Presença congelada: só bloqueia quando a turma está realmente congelada
                // (status ENCERRADA + evento terminado, a partir de D+1 da data_final). Não basta existir
                // um snapshot, pois ele pode ter sido criado por congelamento em lote/manual em uma turma
                // ainda aberta. Em turma reaberta/aberta, a presença permanece editável.
                if (mudouPresenca && this.isTurmaCongelada(turmaAluno.id_turma_fk)) {
                    throw new BadRequestException('A presença desta turma está congelada (snapshot gerado). Não é possível alterar a presença após o congelamento.');
                }
                const desmarcandoPresenca = turmaAluno.presenca_turma === EPresencaTurmas.PRESENTE && updateAlunoDto.presenca_turma === 'NO_SHOW';
                if (desmarcandoPresenca) {
                    await this.validarPermissaoDesmarcarPresenca(turmaAluno, userId);
                }
                turmaAluno.presenca_turma = updateAlunoDto.presenca_turma as EPresencaTurmas;
            }
            const flagsDerivadas = this.buildConfirmacaoCheckinFlags(turmaAluno.status_aluno_turma, turmaAluno.presenca_turma);
            turmaAluno.confirmacao_realizada = flagsDerivadas.confirmacao_realizada;
            turmaAluno.checkin_realizado = flagsDerivadas.checkin_realizado;
            if (updateAlunoDto.atualizado_por !== undefined) {
                turmaAluno.atualizado_por = updateAlunoDto.atualizado_por;
            }

            // Edição manual das datas de assinatura da mentoria (início/encerramento).
            // As datas vivem em turmas_alunos_treinamentos; registramos no histórico do aluno
            // quem fez a alteração (userId).
            const querEditarDatasMentoria = updateAlunoDto.data_inicio_mentoria !== undefined || updateAlunoDto.data_fim_mentoria !== undefined;
            if (querEditarDatasMentoria) {
                const ehMentoria = turmaAluno.id_turma_fk?.id_treinamento_fk?.tipo_mentoria === true;
                if (!ehMentoria) {
                    throw new BadRequestException('As datas de assinatura só podem ser editadas em turmas de mentoria.');
                }

                const linhasTreinamento = await this.uow.turmasAlunosTreinamentosRP.find({
                    where: { id_turma_aluno: turmaAluno.id, deletado_em: null },
                });
                const idTreinamentoTurma = turmaAluno.id_turma_fk?.id_treinamento;
                let linhaMentoria =
                    linhasTreinamento.find((l) => String(l.id_turma_destino) === String(turmaAluno.id_turma) && l.data_inicio_mentoria != null) ||
                    linhasTreinamento.find((l) => l.id_treinamento === idTreinamentoTurma && l.data_inicio_mentoria != null) ||
                    linhasTreinamento.find((l) => l.data_inicio_mentoria != null) ||
                    linhasTreinamento.find((l) => String(l.id_turma_destino) === String(turmaAluno.id_turma)) ||
                    linhasTreinamento.find((l) => l.id_treinamento === idTreinamentoTurma) ||
                    linhasTreinamento[0];

                // Aluno matriculado na mentoria sem venda/contrato (adicionado manualmente,
                // importação ou transferência) não possui linha em turmas_alunos_treinamentos.
                // Nesses casos a listagem exibe as datas pela regra padrão (criado_em + duração);
                // criamos/reativamos a linha aqui para persistir o override manual, em vez de falhar.
                if (!linhaMentoria && idTreinamentoTurma) {
                    const duracaoMesesMentoria = resolverDuracaoMentoriaMeses({
                        treinamento: turmaAluno.id_turma_fk?.id_treinamento_fk?.treinamento,
                        duracao_meses: turmaAluno.id_turma_fk?.id_treinamento_fk?.duracao_meses,
                    });
                    const somarMesesIso = (iso: string | null, meses: number | null): string | null => {
                        if (!iso || meses == null) return null;
                        const [ano, mes, dia] = iso.split('-').map((n) => parseInt(n, 10));
                        const base = new Date(Date.UTC(ano, mes - 1, dia));
                        base.setUTCMonth(base.getUTCMonth() + meses);
                        return base.toISOString().slice(0, 10);
                    };
                    const inicioPadrao = turmaAluno.criado_em ? new Date(turmaAluno.criado_em).toISOString().slice(0, 10) : null;
                    const fimPadrao = somarMesesIso(inicioPadrao, duracaoMesesMentoria);

                    // Pode existir uma linha soft-deletada (constraint única por matrícula +
                    // treinamento): reativa em vez de inserir para não violar a constraint.
                    const linhaSoftDeletada = await this.uow.turmasAlunosTreinamentosRP.findOne({
                        where: { id_turma_aluno: turmaAluno.id, id_treinamento: idTreinamentoTurma },
                        withDeleted: true,
                    });
                    if (linhaSoftDeletada) {
                        linhaSoftDeletada.deletado_em = null;
                        linhaSoftDeletada.id_turma_destino = String(turmaAluno.id_turma);
                        // Base = datas padrão exibidas na listagem (o "de" do log fica coerente com a tela).
                        linhaSoftDeletada.data_inicio_mentoria = inicioPadrao;
                        linhaSoftDeletada.data_fim_mentoria = fimPadrao;
                        linhaMentoria = linhaSoftDeletada;
                    } else {
                        linhaMentoria = this.uow.turmasAlunosTreinamentosRP.create({
                            id_turma_aluno: turmaAluno.id,
                            id_treinamento: idTreinamentoTurma,
                            id_turma_destino: String(turmaAluno.id_turma),
                            preco_treinamento: 0,
                            forma_pgto: [],
                            preco_total_pago: 0,
                            data_inicio_mentoria: inicioPadrao,
                            data_fim_mentoria: fimPadrao,
                        });
                    }
                }

                if (!linhaMentoria) {
                    throw new BadRequestException('Não foi encontrado o registro de mentoria deste aluno para atualizar as datas.');
                }

                const normalizarData = (valor?: string | null): string | null => {
                    if (!valor) return null;
                    return String(valor).slice(0, 10);
                };
                const inicioAntigo = normalizarData(linhaMentoria.data_inicio_mentoria);
                const fimAntigo = normalizarData(linhaMentoria.data_fim_mentoria);
                const novoInicio = updateAlunoDto.data_inicio_mentoria !== undefined ? normalizarData(updateAlunoDto.data_inicio_mentoria) : inicioAntigo;
                const novoFim = updateAlunoDto.data_fim_mentoria !== undefined ? normalizarData(updateAlunoDto.data_fim_mentoria) : fimAntigo;

                if (novoInicio && novoFim && novoFim < novoInicio) {
                    throw new BadRequestException('A data de encerramento da assinatura não pode ser anterior à data de início.');
                }

                linhaMentoria.data_inicio_mentoria = novoInicio;
                linhaMentoria.data_fim_mentoria = novoFim;
                await this.uow.turmasAlunosTreinamentosRP.save(linhaMentoria);
                datasMentoriaResposta = { inicio: novoInicio, fim: novoFim };

                const formatarDataLog = (valor: string | null): string => {
                    if (!valor) return 'vazio';
                    const partes = valor.split('-');
                    return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : valor;
                };
                const alteracoesDatas: string[] = [];
                if (inicioAntigo !== novoInicio) {
                    alteracoesDatas.push(`Início da assinatura: ${formatarDataLog(inicioAntigo)} -> ${formatarDataLog(novoInicio)}`);
                }
                if (fimAntigo !== novoFim) {
                    alteracoesDatas.push(`Encerramento da assinatura: ${formatarDataLog(fimAntigo)} -> ${formatarDataLog(novoFim)}`);
                }
                if (alteracoesDatas.length > 0) {
                    await this.registrarLogAlunoTurma(
                        {
                            id_turma_aluno: turmaAluno.id,
                            id_turma: turmaAluno.id_turma,
                            id_aluno: turmaAluno.id_aluno,
                            tipo_acao: 'ATUALIZACAO',
                            titulo: 'Período da assinatura da mentoria atualizado',
                            descricao: alteracoesDatas.join(' | '),
                            detalhes: {
                                inicio: { de: inicioAntigo, para: novoInicio },
                                fim: { de: fimAntigo, para: novoFim },
                            },
                        },
                        userId,
                    );
                }
            }

            const solicitouCancelamento = novoStatusAlunoTurma === EStatusAlunosTurmas.CANCELADO && statusAnterior !== EStatusAlunosTurmas.CANCELADO;

            if (solicitouCancelamento) {
                // Cancelar = soft delete da matrícula: mesma regra da remoção (acessora da turma).
                await this.validarPermissaoGerenciarAlunosTurma(turmaAluno.id_turma_fk, userId, 'cancelar');
            }

            if (solicitouCancelamento && this.isTurmaCongelada(turmaAluno.id_turma_fk)) {
                throw new BadRequestException('Não é possível cancelar alunos de uma turma encerrada. O registro permanece congelado para a trilha do aluno.');
            }

            if (solicitouCancelamento) {
                const afterCancelSnapshot = {
                    ...beforeSnapshot,
                    nome_cracha: turmaAluno.id_aluno_fk?.nome_cracha,
                    url_comprovante_pgto: turmaAluno.url_comprovante_pgto,
                    pendencia_pagamento: turmaAluno.pendencia_pagamento,
                    quantidade_inscricoes: turmaAluno.quantidade_inscricoes,
                    outros_clientes: turmaAluno.outros_clientes,
                    comprovante_pagamento_base64: turmaAluno.comprovante_pagamento_base64,
                    status_aluno_turma: EStatusAlunosTurmas.CANCELADO,
                    origem_aluno: turmaAluno.origem_aluno,
                    presenca_turma: null,
                    confirmacao_realizada: false,
                    checkin_realizado: false,
                };
                const changesCancel = this.buildAlunoTurmaChanges(beforeSnapshot, afterCancelSnapshot);
                turmaAluno.presenca_turma = null;
                const motivoCancelamento = updateAlunoDto.motivo_cancelamento?.trim();
                const descricaoAlteracoes = changesCancel.length
                    ? changesCancel.map((item) => `${item.campo}: ${item.de} -> ${item.para}`).join(' | ')
                    : 'Status alterado para CANCELADO.';
                await this.registrarLogAlunoTurma(
                    {
                        id_turma_aluno: turmaAluno.id,
                        id_turma: turmaAluno.id_turma,
                        id_aluno: turmaAluno.id_aluno,
                        tipo_acao: 'CANCELAMENTO',
                        titulo: 'Inscrição cancelada',
                        descricao: motivoCancelamento ? `Motivo: ${motivoCancelamento}` : descricaoAlteracoes,
                        detalhes: { alteracoes: changesCancel, motivo: motivoCancelamento || null },
                    },
                    userId,
                );
                await this.softDeleteAlunoTurmaCascade(id_turma_aluno, turmaAluno);

                return {
                    id: turmaAluno.id,
                    id_turma: turmaAluno.id_turma,
                    id_aluno: turmaAluno.id_aluno,
                    nome_cracha: turmaAluno.id_aluno_fk?.nome_cracha || turmaAluno.id_aluno_fk?.nome || '',
                    numero_cracha: turmaAluno.numero_cracha,
                    vaga_bonus: turmaAluno.vaga_bonus,
                    origem_aluno: turmaAluno.origem_aluno,
                    status_aluno_turma: EStatusAlunosTurmas.CANCELADO,
                    confirmacao_realizada: false,
                    checkin_realizado: false,
                    presenca_turma: null,
                    pendencia_pagamento: turmaAluno.pendencia_pagamento,
                    quantidade_inscricoes: turmaAluno.quantidade_inscricoes ?? 1,
                    outros_clientes: turmaAluno.outros_clientes ?? [],
                    contrato_duplo: (turmaAluno.quantidade_inscricoes ?? 1) > 1,
                    comprovante_pagamento_base64: turmaAluno.comprovante_pagamento_base64,
                    created_at: turmaAluno.criado_em,
                    aluno: turmaAluno.id_aluno_fk
                        ? {
                              id: turmaAluno.id_aluno_fk.id,
                              nome: turmaAluno.id_aluno_fk.nome,
                              email: turmaAluno.id_aluno_fk.email,
                              nome_cracha: turmaAluno.id_aluno_fk.nome_cracha,
                          }
                        : undefined,
                };
            }

            this.logger.debug(`turma.aluno.update | Atualizando matrícula id=${id_turma_aluno}`);

            const turmaAlunoAtualizada = await this.uow.turmasAlunosRP.save(turmaAluno);
            const afterSnapshot = {
                nome_cracha: turmaAlunoAtualizada.id_aluno_fk?.nome_cracha,
                url_comprovante_pgto: turmaAlunoAtualizada.url_comprovante_pgto,
                pendencia_pagamento: turmaAlunoAtualizada.pendencia_pagamento,
                quantidade_inscricoes: turmaAlunoAtualizada.quantidade_inscricoes,
                outros_clientes: turmaAlunoAtualizada.outros_clientes,
                comprovante_pagamento_base64: turmaAlunoAtualizada.comprovante_pagamento_base64,
                status_aluno_turma: turmaAlunoAtualizada.status_aluno_turma,
                origem_aluno: turmaAlunoAtualizada.origem_aluno,
                presenca_turma: turmaAlunoAtualizada.presenca_turma,
                confirmacao_realizada: turmaAlunoAtualizada.confirmacao_realizada,
                checkin_realizado: turmaAlunoAtualizada.checkin_realizado,
            };
            const changes = this.buildAlunoTurmaChanges(beforeSnapshot, afterSnapshot);
            if (changes.length > 0) {
                await this.registrarLogAlunoTurma(
                    {
                        id_turma_aluno: turmaAlunoAtualizada.id,
                        id_turma: turmaAlunoAtualizada.id_turma,
                        id_aluno: turmaAlunoAtualizada.id_aluno,
                        tipo_acao: 'ATUALIZACAO',
                        titulo: 'Dados do aluno na turma atualizados',
                        descricao: changes.map((item) => `${item.campo}: ${item.de} -> ${item.para}`).join(' | '),
                        detalhes: { alteracoes: changes },
                    },
                    userId,
                );
            }

            // Verificar se o status foi alterado para CHECKIN_REALIZADO
            // Enviar link do formulário para o aluno preencher seus dados
            if (statusAnterior !== EStatusAlunosTurmas.CHECKIN_REALIZADO && turmaAlunoAtualizada.status_aluno_turma === EStatusAlunosTurmas.CHECKIN_REALIZADO) {
                this.logger.log('turma.aluno.status | CHECKIN_REALIZADO; enviando link do formulário via WhatsApp');

                // Enviar link do formulário via WhatsApp automaticamente
                await this.enviarLinkFormularioWhatsApp(turmaAlunoAtualizada);
            }

            const mudouParaNoShow = presencaAnterior !== EPresencaTurmas.NO_SHOW && turmaAlunoAtualizada.presenca_turma === EPresencaTurmas.NO_SHOW;
            if (mudouParaNoShow) {
                await this.tentarTransferenciaAutomaticaNoShowIPR(turmaAlunoAtualizada.id, userId);
            }

            return {
                id: turmaAlunoAtualizada.id,
                id_turma: turmaAlunoAtualizada.id_turma,
                id_aluno: turmaAlunoAtualizada.id_aluno,
                nome_cracha: turmaAlunoAtualizada.id_aluno_fk?.nome_cracha || turmaAlunoAtualizada.id_aluno_fk?.nome || '',
                numero_cracha: turmaAlunoAtualizada.numero_cracha,
                vaga_bonus: turmaAlunoAtualizada.vaga_bonus,
                origem_aluno: turmaAlunoAtualizada.origem_aluno,
                status_aluno_turma: turmaAlunoAtualizada.status_aluno_turma,
                confirmacao_realizada: turmaAlunoAtualizada.confirmacao_realizada,
                checkin_realizado: turmaAlunoAtualizada.checkin_realizado,
                presenca_turma: turmaAlunoAtualizada.presenca_turma,
                data_inicio_mentoria: datasMentoriaResposta?.inicio ?? undefined,
                data_fim_mentoria: datasMentoriaResposta?.fim ?? undefined,
                pendencia_pagamento: turmaAlunoAtualizada.pendencia_pagamento,
                quantidade_inscricoes: turmaAlunoAtualizada.quantidade_inscricoes ?? 1,
                outros_clientes: turmaAlunoAtualizada.outros_clientes ?? [],
                contrato_duplo: (turmaAlunoAtualizada.quantidade_inscricoes ?? 1) > 1,
                comprovante_pagamento_base64: turmaAlunoAtualizada.comprovante_pagamento_base64,
                id_acessor: turmaAlunoAtualizada.id_acessor ?? null,
                created_at: turmaAlunoAtualizada.criado_em,
                aluno: turmaAlunoAtualizada.id_aluno_fk
                    ? {
                          id: turmaAlunoAtualizada.id_aluno_fk.id,
                          nome: turmaAlunoAtualizada.id_aluno_fk.nome,
                          email: turmaAlunoAtualizada.id_aluno_fk.email,
                          nome_cracha: turmaAlunoAtualizada.id_aluno_fk.nome_cracha,
                      }
                    : undefined,
            };
        } catch (error) {
            this.logger.error('turma.aluno.update | Erro ao atualizar aluno na turma', error instanceof Error ? error.stack : undefined);
            // Preserva as exceções de domínio (ex.: presença congelada, regras de negócio) para que o frontend exiba a mensagem amigável.
            if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ForbiddenException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao atualizar aluno na turma');
        }
    }

    // Método para gerar número de crachá único dentro da turma
    // Regra: sequência fixa de 5 dígitos iniciando em 01100.
    async generateUniqueCrachaNumber(id_turma: number): Promise<string> {
        const numeroInicial = 1100;
        const numeroMaximo = 99999;

        const matriculasAtivas = await this.uow.turmasAlunosRP.find({
            where: {
                id_turma,
                deletado_em: null,
            },
            select: {
                numero_cracha: true,
            },
        });

        const numerosUsados = new Set<number>(
            matriculasAtivas
                .map((matricula) => matricula.numero_cracha)
                .filter((numero): numero is string => !!numero && /^\d+$/.test(numero))
                .map((numero) => Number.parseInt(numero, 10)),
        );

        for (let numero = numeroInicial; numero <= numeroMaximo; numero++) {
            if (!numerosUsados.has(numero)) {
                return numero.toString().padStart(5, '0');
            }
        }

        throw new Error('Não foi possível gerar um número de crachá único para esta turma');
    }

    /**
     * Envia link do formulário de preenchimento via WhatsApp quando status é alterado para CHECKIN_REALIZADO
     */
    private async enviarLinkFormularioWhatsApp(turmaAluno: any): Promise<void> {
        try {
            // Verificar se temos os dados necessários
            if (!turmaAluno.id_aluno_fk || !turmaAluno.id_turma_fk) {
                this.logger.warn('whatsapp.form.send | Dados insuficientes para enviar link do formulário');
                return;
            }

            const aluno = turmaAluno.id_aluno_fk;
            const turma = turmaAluno.id_turma_fk;
            const treinamento = turma.id_treinamento_fk;
            const polo = turma.id_polo_fk;
            const enderecoEvento = turma.id_endereco_evento_fk;

            // DATA: usar exatamente o valor do banco (YYYY-MM-DD), sem fuso horário
            // Ex: "2026-03-10" e "2026-03-12" -> "10/03/2026 à 12/03/2026"
            const formatDateOnly = (dateStr: string): string => {
                if (!dateStr || typeof dateStr !== 'string') return 'A confirmar';
                const datePart = dateStr.trim().split('T')[0];
                const parts = datePart.split(/[-/]/);
                if (parts.length < 3) return 'A confirmar';
                const d = parts[2].padStart(2, '0');
                const m = parts[1].padStart(2, '0');
                const y = parts[0];
                return `${d}/${m}/${y}`;
            };
            const dataInicioStr = turma?.data_inicio;
            const dataFinalStr = turma?.data_final;
            let dataStr = 'A confirmar';
            if (dataInicioStr) {
                if (dataFinalStr && dataInicioStr !== dataFinalStr) {
                    dataStr = `${formatDateOnly(dataInicioStr)} à ${formatDateOnly(dataFinalStr)}`;
                } else {
                    dataStr = formatDateOnly(dataInicioStr);
                }
            }

            // LOCAL: nome do local do evento ou do polo (se não houver, mantém vazio)
            const localStr = enderecoEvento?.local_evento?.trim() || '';

            // ENDEREÇO: logradouro, numero - bairro - cep, cidade - estado
            const buildEndereco = (e: { logradouro?: string; numero?: string; bairro?: string; cep?: string; cidade?: string; estado?: string } | null): string => {
                if (!e) return 'A confirmar';
                const partes = [];
                if (e.logradouro || e.numero) partes.push([e.logradouro, e.numero].filter(Boolean).join(', '));
                if (e.bairro) partes.push(e.bairro);
                const cepCidade = [e.cep, e.cidade].filter(Boolean).join(', ');
                if (cepCidade) partes.push(cepCidade);
                if (e.estado) partes.push(e.estado);
                return partes.length ? partes.join(' - ') : 'A confirmar';
            };
            const enderecoStr =
                buildEndereco(enderecoEvento) !== 'A confirmar'
                    ? buildEndereco(enderecoEvento)
                    : buildEndereco(
                          turma
                              ? {
                                    logradouro: turma.logradouro,
                                    numero: turma.numero,
                                    bairro: turma.bairro,
                                    cep: turma.cep,
                                    cidade: turma.cidade,
                                    estado: turma.estado,
                                }
                              : null,
                      );

            // Preparar dados para envio do link
            const checkInData = {
                alunoTurmaId: turmaAluno.id,
                alunoNome: aluno.nome,
                alunoTelefone: aluno.telefone_um,
                turmaId: turma.id,
                treinamentoNome: treinamento?.treinamento || 'Treinamento não informado',
            };

            this.logger.debug(`whatsapp.form.send | Enviando link do formulário para aluno=${aluno.nome}`);

            // Gerar URL pelo mesmo fluxo centralizado do WhatsAppService
            const generatedLinkResult = await this.whatsappService.generateCheckInLink(String(turmaAluno.id));
            if (!generatedLinkResult.success || !generatedLinkResult.link) {
                this.logger.warn(
                    `whatsapp.form.send | Falha ao gerar link de check-in para ${aluno.nome}: ${String(generatedLinkResult.error || 'erro desconhecido')}`,
                );
                return;
            }
            const formularioUrl = generatedLinkResult.link;

            // Mensagem no formato do novo template Gupshup
            const message = `Olá *${aluno.nome}*, parabéns por dizer SIM a essa jornada transformadora! ✨
Você garantiu a sua vaga e sua presença está confirmada no _*${checkInData.treinamentoNome}*_ e estamos muito animados pra te receber! 🤩

📌*DATA*: ${dataStr}
📌*HORÁRIO CREDENCIAMENTO*: 8h00
📌*ABERTURA DAS PORTAS*: 9h00
📌*LOCAL*: ${localStr}
📌*ENDEREÇO*: ${enderecoStr}

Um novo tempo se inicia na sua vida e nos seus negócios. Permita-se viver tudo o que Deus preparou pra você nesses dias! 🙌

Para confirmar sua presença, é só clicar no link abaixo, preencher as informações e salvar.

_${formularioUrl}_

Assim que finalizar, seu check-in estará realizado e você receberá um QR CODE para acessar o evento!

*Confirme agora mesmo*

Vamos Prosperar! 🙌`;

            // Enviar mensagem via WhatsApp
            const result = await this.whatsappService.sendMessage(aluno.telefone_um, message, aluno.nome);

            if (result.success) {
                this.logger.log(`whatsapp.form.send | Link enviado com sucesso para ${aluno.nome}`);
            } else {
                this.logger.warn(`whatsapp.form.send | Falha ao enviar link para ${aluno.nome}: ${String(result.error || 'erro desconhecido')}`);
            }
        } catch (error) {
            this.logger.error('whatsapp.form.send | Erro interno ao enviar link do formulário via WhatsApp', error instanceof Error ? error.stack : undefined);
            // Não relançar o erro para não interromper o fluxo principal
        }
    }
}
