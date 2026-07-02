import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { Documentos } from '@/modules/config/entities/documentos.entity';
import { TurmasAlunosTreinamentosContratos } from '@/modules/config/entities/turmasAlunosTreinamentosContratos.entity';
import { EStatusAssinaturasContratos, EOrigemAlunos, EStatusAlunosTurmas } from '@/modules/config/entities/enum';
import * as crypto from 'crypto';
import axios from 'axios';
import { Not, IsNull, In, Between } from 'typeorm';
import {
    CreateDocumentoDto,
    UpdateDocumentoDto,
    DocumentoResponseDto,
    DocumentosListResponseDto,
    GerarContratoDto,
    CampoDocumentoDto,
    DocumentosFilterDto,
    CriarContratoZapSignDto,
    RespostaContratoZapSignDto,
    AtualizarStatusContratoDto,
    CriarTermoZapSignDto,
    RespostaTermoZapSignDto,
} from './dto/documentos.dto';
import { ETipoDocumento, EFormasPagamento } from '@/modules/config/entities/enum';
import { ZapSignService } from './zapsign.service';
import { ContractTemplateService } from './contract-template.service';
import { TermTemplateService } from './term-template.service';
import PDFDocument from 'pdfkit';
import { MailService } from '@/modules/mail/mail.service';
import { TurmasService } from '../turmas/turmas.service';
import { Turmas } from '@/modules/config/entities/turmas.entity';
import { resolverDuracaoMentoriaMeses } from '@shared/mentoria/mentoria-duracao';

const parsePositiveIntEnv = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

@Injectable()
export class DocumentosService {
    private readonly logger = new Logger(DocumentosService.name);
    private readonly estiloPadraoClausulas = "font-size: 11px; font-family: 'Times New Roman', Times, serif; margin: 0; padding: 0;";
    private readonly opcoesOrigemCacheTtlMs = 60000;
    private readonly opcoesOrigemCacheMaxEntradas = 200;
    private readonly contratosBancoCacheTtlMs = 15000;
    private readonly contratosBancoCacheMaxEntradas = 40;
    private readonly janelaCronSincronizacaoDias = 7;
    private sincronizacaoStatusCronEmExecucao = false;
    private readonly zapsignCronMaxTentativas = parsePositiveIntEnv(process.env.ZAPSIGN_CRON_MAX_TENTATIVAS, 2);
    private readonly zapsignCronRetryDelayMs = parsePositiveIntEnv(process.env.ZAPSIGN_CRON_RETRY_DELAY_MS, 2000);
    private readonly opcoesOrigemCache = new Map<
        string,
        {
            expiresAt: number;
            value: {
                treinamentos_origem: string[];
                turmas_origem: string[];
                turmas_destino: string[];
                turmas_destino_por_origem: Record<string, string[]>;
            };
        }
    >();
    private readonly contratosBancoCache = new Map<
        string,
        {
            expiresAt: number;
            value: {
                data: any[];
                total: number;
                page: number;
                limit: number;
                totalPages: number;
                resumo: {
                    total_inscricoes_vendidas: number;
                    total_inscricoes_bonus: number;
                    total_com_pendencia: number;
                    receita_total: number;
                    ranking_staff_lider: Array<{
                        lider_id: string;
                        lider_nome: string;
                        total_inscricoes: number;
                        total_vendas: number;
                        times: string[];
                        vendedores: Array<{
                            id: string;
                            nome: string;
                            total_inscricoes: number;
                            total_vendas: number;
                        }>;
                    }>;
                    inscricoes_sem_lider: {
                        total_inscricoes: number;
                        total_vendas: number;
                        vendedores: Array<{
                            vendedor_id: string;
                            vendedor_nome: string;
                            total_inscricoes: number;
                            total_vendas: number;
                        }>;
                    };
                };
            };
        }
    >();

    constructor(
        private readonly uow: UnitOfWorkService,
        private readonly zapSignService: ZapSignService,
        private readonly contractTemplateService: ContractTemplateService,
        private readonly termTemplateService: TermTemplateService,
        private readonly mailService: MailService,
        private readonly turmasService: TurmasService,
    ) {}

    private normalizarClausulasParaHtml(conteudo: string): string {
        if (!conteudo) return '';
        const possuiTagsHtml = /<\/?[a-z][\s\S]*>/i.test(conteudo);
        const htmlBase = possuiTagsHtml ? conteudo : conteudo.replace(/\n/g, '<br />');
        return htmlBase
            .replace(/\r\n/g, '\n')
            .replace(/<div><br\s*\/?><\/div>/gi, '<br />')
            .replace(/<p><br\s*\/?><\/p>/gi, '<br />')
            .replace(/<\/div>\s*<div>/gi, '<br />')
            .replace(/<\/p>\s*<p>/gi, '<br />')
            .replace(/<\/?(div|p)>/gi, '')
            .trim();
    }

    private removerWrapperFonteClausulas(conteudo: string): string {
        return conteudo.trim().replace(/^<div style=["'][^"']*font-size\s*:\s*\d+px;?[^"']*["']>([\s\S]*)<\/div>$/i, '$1');
    }

    private aplicarEstiloPadraoClausulas(conteudo: string): string {
        const htmlNormalizado = this.normalizarClausulasParaHtml(conteudo);
        if (!htmlNormalizado) return '';
        const htmlSemWrapperFonte = this.removerWrapperFonteClausulas(htmlNormalizado);
        return `<div style="${this.estiloPadraoClausulas}">${htmlSemWrapperFonte}</div>`;
    }

    async createDocumento(createDocumentoDto: CreateDocumentoDto, userId?: number): Promise<DocumentoResponseDto> {
        try {
            this.logger.debug('doc.repo.create | Criando documento');

            const documento = this.uow.documentosRP.create({
                documento: createDocumentoDto.documento,
                tipo_documento: createDocumentoDto.tipo_documento,
                campos: createDocumentoDto.campos,
                clausulas: this.aplicarEstiloPadraoClausulas(createDocumentoDto.clausulas),
                treinamentos_relacionados: createDocumentoDto.treinamentos_relacionados || [],
                criado_por: userId,
                atualizado_por: userId,
            });

            const savedDocumento = await this.uow.documentosRP.save(documento);
            return this.mapToResponseDto(savedDocumento);
        } catch (error) {
            this.logger.error('doc.repo.create | Erro ao criar documento', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException('Erro ao criar documento');
        }
    }

    async findAllDocumentos(page: number = 1, limit: number = 10, filter?: DocumentosFilterDto): Promise<DocumentosListResponseDto> {
        try {
            const whereCondition: any = { deletado_em: null };

            if (filter?.tipo_documento) {
                whereCondition.tipo_documento = filter.tipo_documento;
            }

            const [documentos, total] = await this.uow.documentosRP.findAndCount({
                where: whereCondition,
                order: { documento: 'ASC' },
                skip: (page - 1) * limit,
                take: limit,
            });

            const data = documentos.map((doc) => this.mapToResponseDto(doc));
            const totalPages = Math.ceil(total / limit);

            return {
                data,
                total,
                page,
                limit,
                totalPages,
            };
        } catch (error) {
            this.logger.error('doc.repo.list | Erro ao buscar documentos', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException('Erro ao buscar documentos');
        }
    }

    async findDocumentoById(id: number): Promise<DocumentoResponseDto> {
        try {
            const documento = await this.uow.documentosRP.findOne({
                where: { id, deletado_em: null },
            });

            if (!documento) {
                throw new NotFoundException('Documento não encontrado');
            }

            return this.mapToResponseDto(documento);
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            this.logger.error('doc.repo.get | Erro ao buscar documento', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException('Erro ao buscar documento');
        }
    }

    async updateDocumento(id: number, updateDocumentoDto: UpdateDocumentoDto, userId?: number): Promise<DocumentoResponseDto> {
        try {
            const documento = await this.uow.documentosRP.findOne({
                where: { id, deletado_em: null },
            });

            if (!documento) {
                throw new NotFoundException('Documento não encontrado');
            }

            const updatePayload = { ...updateDocumentoDto };
            if (typeof updatePayload.clausulas === 'string') {
                updatePayload.clausulas = this.aplicarEstiloPadraoClausulas(updatePayload.clausulas);
            }

            Object.assign(documento, updatePayload);
            documento.atualizado_por = userId;
            documento.atualizado_em = new Date();

            const savedDocumento = await this.uow.documentosRP.save(documento);
            return this.mapToResponseDto(savedDocumento);
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            this.logger.error('doc.repo.update | Erro ao atualizar documento', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException('Erro ao atualizar documento');
        }
    }

    async deleteDocumento(id: number, userId?: number): Promise<void> {
        try {
            const documento = await this.uow.documentosRP.findOne({
                where: { id, deletado_em: null },
            });

            if (!documento) {
                throw new NotFoundException('Documento não encontrado');
            }

            documento.deletado_em = new Date();
            // documento.deletado_por = userId; // Campo não existe na entidade

            await this.uow.documentosRP.save(documento);
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            this.logger.error('doc.repo.delete | Erro ao deletar documento', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException('Erro ao deletar documento');
        }
    }

    async buscarTemplatesZapSign() {
        try {
            this.logger.debug('zapsign.template.list | Buscando templates ZapSign');

            // Buscar documentos do banco de dados local
            const documentos = await this.uow.documentosRP.find({
                where: { deletado_em: null },
                order: { documento: 'ASC' },
            });

            // Mapear para o formato esperado pelo frontend
            const templates = documentos.map((doc) => ({
                id: doc.id.toString(),
                nome: doc.documento,
                tipo: doc.tipo_documento,
                campos: doc.campos || [],
                clausulas: doc.clausulas || '',
                treinamentos_relacionados: doc.treinamentos_relacionados || [],
            }));

            this.logger.log(`zapsign.template.list | Templates mapeados=${templates.length}`);
            return templates;
        } catch (error) {
            this.logger.error('zapsign.template.list | Erro ao buscar templates', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException('Erro ao buscar templates');
        }
    }

    /**
     * Normaliza o comprovante recebido para um ARRAY de strings (data URLs base64).
     * O frontend envia: (a) uma única string quando há 1 comprovante, ou
     * (b) um JSON.stringify de array quando há vários. Também aceita um array já
     * desserializado. Retorna [] quando vazio/ausente.
     */
    private normalizarComprovantesParaArray(valor?: string | string[] | null): string[] {
        if (valor === undefined || valor === null) return [];
        if (Array.isArray(valor)) {
            return valor.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        }
        const texto = valor.trim();
        if (!texto) return [];
        if (texto.startsWith('[')) {
            try {
                const parsed: unknown = JSON.parse(texto);
                if (Array.isArray(parsed)) {
                    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
                }
            } catch {
                // Não é JSON válido: trata como comprovante único abaixo.
            }
        }
        return [texto];
    }

    /**
     * Serializa um array de comprovantes para a forma esperada pelo frontend atual:
     * string única quando há 1, JSON.stringify quando há vários, null quando vazio.
     */
    private serializarComprovantes(comprovantes: string[]): string | null {
        if (!comprovantes || comprovantes.length === 0) return null;
        if (comprovantes.length === 1) return comprovantes[0];
        return JSON.stringify(comprovantes);
    }

    /**
     * Resolve a lista de comprovantes de uma venda priorizando a fonte vinculada
     * ao CONTRATO (coluna nova), depois o snapshot em dados_contrato e, por fim,
     * o turma_aluno compartilhado (legado, antes da migração por contrato).
     */
    private resolverComprovantesDoContrato(
        contrato: { comprovantes_pagamento?: string[] | null } | null | undefined,
        turmaAlunoDadosContrato: { comprovantes_pagamento?: string[] | null; comprovante_pagamento_base64?: string | null } | null | undefined,
        turmaAluno: { comprovante_pagamento_base64?: string | null } | null | undefined,
    ): string[] {
        const doContrato = this.normalizarComprovantesParaArray(contrato?.comprovantes_pagamento ?? null);
        if (doContrato.length > 0) return doContrato;

        const doSnapshotArray = this.normalizarComprovantesParaArray(turmaAlunoDadosContrato?.comprovantes_pagamento ?? null);
        if (doSnapshotArray.length > 0) return doSnapshotArray;

        const doSnapshotString = this.normalizarComprovantesParaArray(turmaAlunoDadosContrato?.comprovante_pagamento_base64 ?? null);
        if (doSnapshotString.length > 0) return doSnapshotString;

        return this.normalizarComprovantesParaArray(turmaAluno?.comprovante_pagamento_base64 ?? null);
    }

    /**
     * Calcula o período individual da mentoria para o mentorado.
     * Para mentorias, a duração (em meses, configurada no cadastro do treinamento)
     * passa a contar a partir da assinatura/finalização do contrato (data de início = hoje).
     *
     * Adiantamento/renovação: quando o aluno JÁ está na mentoria, `fimVigente`
     * traz o término vigente da mentoria dele e o novo período passa a ser
     * contado a partir desse término (data final atual + duração).
     *
     * Para treinamentos/palestras retorna nulos (a data vem da turma).
     */
    private calcularPeriodoMentoria(
        treinamento: { treinamento?: string | null; tipo_mentoria?: boolean; duracao_meses?: number | null } | null,
        fimVigente?: string | null,
    ): {
        data_inicio_mentoria: string | null;
        data_fim_mentoria: string | null;
    } {
        if (!treinamento || !treinamento.tipo_mentoria) {
            return { data_inicio_mentoria: null, data_fim_mentoria: null };
        }
        // Liberty = 12 meses (1 ano) e Liberty Begin = 6 meses por regra de negócio;
        // demais mentorias usam a duração configurada no cadastro (padrão 12).
        const duracaoMeses = resolverDuracaoMentoriaMeses({
            treinamento: treinamento.treinamento,
            duracao_meses: treinamento.duracao_meses,
        });
        // Adiantamento: conta a partir do término vigente; senão, a partir de hoje.
        const baseAdiantamento =
            fimVigente && /^\d{4}-\d{2}-\d{2}/.test(fimVigente)
                ? new Date(`${fimVigente.slice(0, 10)}T00:00:00`)
                : null;
        const inicio = baseAdiantamento ?? new Date();
        // Renovação: o novo período inicia no DIA SEGUINTE ao término vigente,
        // para não sobrepor o último dia do contrato anterior (ex.: vence 01/07
        // => novo contrato inicia 02/07 e encerra 1 duração depois).
        if (baseAdiantamento) {
            inicio.setDate(inicio.getDate() + 1);
        }
        inicio.setHours(0, 0, 0, 0);
        const fim = new Date(inicio);
        fim.setMonth(fim.getMonth() + duracaoMeses);
        const toIsoDate = (data: Date) =>
            `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
        return {
            data_inicio_mentoria: toIsoDate(inicio),
            data_fim_mentoria: toIsoDate(fim),
        };
    }

    /**
     * Conferência de adiantamento de mentoria: retorna a MAIOR data de término
     * (data_fim_mentoria) das matrículas de mentoria ativas do aluno para o
     * treinamento informado. Quando o aluno ainda não está na mentoria, retorna
     * `null` (o período é contado a partir da assinatura/hoje).
     */
    private async buscarFimMentoriaVigente(idAluno: number, idTreinamento: number): Promise<string | null> {
        const row = await this.uow.turmasAlunosTreinamentosRP
            .createQueryBuilder('tat')
            .innerJoin('tat.id_turma_aluno_fk', 'ta')
            .where('ta.id_aluno = :idAluno', { idAluno: String(idAluno) })
            .andWhere('tat.id_treinamento = :idTreinamento', { idTreinamento })
            .andWhere('tat.deletado_em IS NULL')
            .andWhere('ta.deletado_em IS NULL')
            .andWhere('tat.data_fim_mentoria IS NOT NULL')
            .select('MAX(tat.data_fim_mentoria)', 'fim')
            .getRawOne<{ fim: string | Date | null }>();

        const fim = row?.fim ?? null;
        if (!fim) return null;
        if (fim instanceof Date) {
            return `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, '0')}-${String(fim.getDate()).padStart(2, '0')}`;
        }
        return String(fim).slice(0, 10);
    }

    async criarContratoZapSign(criarContratoDto: CriarContratoZapSignDto, userId?: number): Promise<RespostaContratoZapSignDto> {
        try {
            this.logger.debug('zapsign.create.contract | Iniciando criação de contrato ZapSign');

            // Buscar dados do aluno
            const aluno = await this.uow.alunosRP.findOne({
                where: { id: parseInt(criarContratoDto.id_aluno), deletado_em: null },
                relations: ['id_polo_fk'],
            });

            if (!aluno) {
                throw new NotFoundException('Aluno não encontrado');
            }

            // Buscar dados do treinamento
            const treinamento = await this.uow.treinamentosRP.findOne({
                where: { id: parseInt(criarContratoDto.id_treinamento), deletado_em: null },
            });

            if (!treinamento) {
                throw new NotFoundException('Treinamento não encontrado');
            }

            // Buscar dados da turma de IPR se fornecida
            let turma = null;
            if (criarContratoDto.id_turma_bonus) {
                turma = await this.uow.turmasRP.findOne({
                    where: { id: parseInt(criarContratoDto.id_turma_bonus), deletado_em: null },
                    relations: ['lider_evento_fk'],
                });
            }

            // Origem do aluno. NUNCA cair para id_turma_bonus aqui — isso fazia a
            // matrícula ser criada na turma do BÔNUS, corrompendo o histórico de vendas.
            const idTurmaReferencia = criarContratoDto.id_turma ? parseInt(criarContratoDto.id_turma) : undefined;
            const treinamentoNomeNormalizado = (treinamento.treinamento || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase();
            const idTurmaOrigemPadrao = treinamentoNomeNormalizado.includes('missao governar') ? 192 : 60;
            const idTurmaOrigemContrato = idTurmaReferencia ?? idTurmaOrigemPadrao;

            const idTurmaDestino = criarContratoDto.id_turma_destino ? criarContratoDto.id_turma_destino : null;

            // Conferência de adiantamento: se o aluno já está nesta mentoria, o
            // novo período conta a partir do término vigente dele (renovação
            // antecipada); senão, conta a partir da assinatura (hoje).
            const fimMentoriaVigente = treinamento.tipo_mentoria
                ? await this.buscarFimMentoriaVigente(aluno.id, treinamento.id)
                : null;

            // Período da mentoria (início na assinatura/finalização + duração,
            // ou término vigente + duração quando for adiantamento).
            // Adiantamento: quando o usuário informou manualmente o período do
            // contrato na venda (datepickers), essas datas têm prioridade.
            const isoDate = /^\d{4}-\d{2}-\d{2}/;
            const periodoMentoriaManual =
                treinamento.tipo_mentoria &&
                criarContratoDto.data_inicio_mentoria &&
                criarContratoDto.data_fim_mentoria &&
                isoDate.test(criarContratoDto.data_inicio_mentoria) &&
                isoDate.test(criarContratoDto.data_fim_mentoria)
                    ? {
                          data_inicio_mentoria: criarContratoDto.data_inicio_mentoria.slice(0, 10),
                          data_fim_mentoria: criarContratoDto.data_fim_mentoria.slice(0, 10),
                      }
                    : null;
            const periodoMentoria =
                periodoMentoriaManual ?? this.calcularPeriodoMentoria(treinamento, fimMentoriaVigente);

            // Buscar ou criar registro de TurmasAlunos primeiro
            let turmaAluno = await this.uow.turmasAlunosRP.findOne({
                where: {
                    id_aluno: criarContratoDto.id_aluno,
                    ...(idTurmaReferencia ? { id_turma: idTurmaReferencia } : {}),
                    deletado_em: null,
                },
            });

            // Se não existir, criar um registro temporário
            if (!turmaAluno) {
                const idTurmaParaCracha = idTurmaOrigemContrato || 1;
                // Gerar número de crachá único para esta turma
                const numeroCracha = await this.turmasService.generateUniqueCrachaNumber(idTurmaParaCracha);

                turmaAluno = this.uow.turmasAlunosRP.create({
                    id_aluno: criarContratoDto.id_aluno,
                    id_turma: idTurmaParaCracha,
                    origem_aluno: EOrigemAlunos.COMPROU_INGRESSO, // Origem padrão
                    status_aluno_turma: EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO,
                    numero_cracha: numeroCracha,
                });
                turmaAluno = await this.uow.turmasAlunosRP.save(turmaAluno);
                // Congela a meta no novo pico de inscritos/extras da turma do aluno.
                await this.uow.bumparPicoMetricasTurmas([turmaAluno.id_turma, idTurmaDestino]);
            }

            // Comprovante(s) desta venda. Ficam vinculados ao CONTRATO (coluna
            // comprovantes_pagamento + snapshot em dados_contrato.turma_aluno) e
            // NÃO no turma_aluno compartilhado — assim duas vendas do mesmo aluno
            // na mesma turma de origem não sobrescrevem o comprovante uma da outra.
            const comprovantesVenda = this.normalizarComprovantesParaArray(criarContratoDto.comprovante_pagamento_base64);

            // Buscar ou criar registro de TurmasAlunosTreinamentos
            let turmaAlunoTreinamento = await this.uow.turmasAlunosTreinamentosRP.findOne({
                where: {
                    id_turma_aluno: turmaAluno.id,
                    id_treinamento: parseInt(criarContratoDto.id_treinamento),
                    deletado_em: null,
                },
            });

            // Se não existir, verificar se há um registro deletado para reativar
            if (!turmaAlunoTreinamento) {
                const registroDeletado = await this.uow.turmasAlunosTreinamentosRP.findOne({
                    where: {
                        id_turma_aluno: turmaAluno.id,
                        id_treinamento: parseInt(criarContratoDto.id_treinamento),
                    },
                });

                if (registroDeletado && registroDeletado.deletado_em) {
                    // Reativar o registro deletado
                    registroDeletado.deletado_em = null;
                    registroDeletado.id_turma_destino = idTurmaDestino;
                    registroDeletado.atualizado_em = new Date();
                    if (periodoMentoria.data_inicio_mentoria) {
                        registroDeletado.data_inicio_mentoria = periodoMentoria.data_inicio_mentoria;
                        registroDeletado.data_fim_mentoria = periodoMentoria.data_fim_mentoria;
                    }
                    if (userId) {
                        registroDeletado.atualizado_por = userId;
                    }
                    turmaAlunoTreinamento = await this.uow.turmasAlunosTreinamentosRP.save(registroDeletado);
                } else {
                    // Criar um novo registro
                    try {
                        turmaAlunoTreinamento = this.uow.turmasAlunosTreinamentosRP.create({
                            id_turma_aluno: turmaAluno.id,
                            id_treinamento: parseInt(criarContratoDto.id_treinamento),
                            id_turma_destino: idTurmaDestino,
                            preco_treinamento: treinamento.preco_treinamento || 0,
                            forma_pgto: [],
                            preco_total_pago: 0,
                            data_inicio_mentoria: periodoMentoria.data_inicio_mentoria,
                            data_fim_mentoria: periodoMentoria.data_fim_mentoria,
                        });
                        turmaAlunoTreinamento = await this.uow.turmasAlunosTreinamentosRP.save(turmaAlunoTreinamento);
                    } catch (error: any) {
                        // Verificar se é erro de constraint única
                        if (typeof error === 'object' && error !== null && 'code' in error && (error.code === '23505' || error.driverError?.code === '23505')) {
                            const constraint = error?.constraint || error?.driverError?.constraint;

                            // Se for erro de sequência desincronizada (primary key)
                            if (constraint === 'pk_turmas_alunos_trn') {
                                this.logger.warn('db.sequence.turmas_alunos_treinamentos | Sequência desincronizada detectada; corrigindo');

                                // Corrigir a sequência
                                await this.fixTurmasAlunosTreinamentosSequence();

                                // Criar um novo objeto para garantir que não há ID pré-definido
                                const novoRegistro = this.uow.turmasAlunosTreinamentosRP.create({
                                    id_turma_aluno: turmaAluno.id,
                                    id_treinamento: parseInt(criarContratoDto.id_treinamento),
                                    id_turma_destino: idTurmaDestino,
                                    preco_treinamento: treinamento.preco_treinamento || 0,
                                    forma_pgto: [],
                                    preco_total_pago: 0,
                                    data_inicio_mentoria: periodoMentoria.data_inicio_mentoria,
                                    data_fim_mentoria: periodoMentoria.data_fim_mentoria,
                                });

                                // Tentar novamente
                                turmaAlunoTreinamento = await this.uow.turmasAlunosTreinamentosRP.save(novoRegistro);
                                this.logger.log('db.sequence.turmas_alunos_treinamentos | Registro criado após correção de sequência');
                            } else {
                                // Se for outro tipo de constraint única, tentar reativar registro deletado
                                const registroExistente = await this.uow.turmasAlunosTreinamentosRP.findOne({
                                    where: {
                                        id_turma_aluno: turmaAluno.id,
                                        id_treinamento: parseInt(criarContratoDto.id_treinamento),
                                    },
                                });

                                if (registroExistente && registroExistente.deletado_em) {
                                    // Reativar o registro deletado
                                    registroExistente.deletado_em = null;
                                    registroExistente.id_turma_destino = idTurmaDestino;
                                    registroExistente.atualizado_em = new Date();
                                    if (periodoMentoria.data_inicio_mentoria) {
                                        registroExistente.data_inicio_mentoria = periodoMentoria.data_inicio_mentoria;
                                        registroExistente.data_fim_mentoria = periodoMentoria.data_fim_mentoria;
                                    }
                                    if (userId) {
                                        registroExistente.atualizado_por = userId;
                                    }
                                    turmaAlunoTreinamento = await this.uow.turmasAlunosTreinamentosRP.save(registroExistente);
                                } else {
                                    throw error;
                                }
                            }
                        } else {
                            throw error;
                        }
                    }
                }
            } else if (treinamento.tipo_mentoria && periodoMentoria.data_fim_mentoria) {
                // Adiantamento/renovação: o aluno já possui matrícula ATIVA nesta
                // mentoria. Estende o término vigente em +1 período (mantém o
                // início original) para que a contagem siga a data final atual.
                turmaAlunoTreinamento.data_fim_mentoria = periodoMentoria.data_fim_mentoria;
                if (!turmaAlunoTreinamento.data_inicio_mentoria) {
                    turmaAlunoTreinamento.data_inicio_mentoria = periodoMentoria.data_inicio_mentoria;
                }
                turmaAlunoTreinamento.atualizado_em = new Date();
                if (userId) {
                    turmaAlunoTreinamento.atualizado_por = userId;
                }
                turmaAlunoTreinamento = await this.uow.turmasAlunosTreinamentosRP.save(turmaAlunoTreinamento);
            }

            // Persistir o BÔNUS em coluna (não só no JSON do contrato) para que o
            // histórico de vendas leia origem/destino/bônus de colunas reais.
            if (criarContratoDto.id_turma_bonus) {
                const tiposBonus = Array.isArray(criarContratoDto.tipos_bonus)
                    ? criarContratoDto.tipos_bonus.filter((t) => t && t !== 'nao_aplica' && t !== 'nenhum')
                    : [];

                // Não cria vínculo de bônus quando nenhum bônus real foi selecionado.
                if (tiposBonus.length > 0) {
                    for (const tipo of tiposBonus) {
                        const jaExiste = await this.uow.turmasAlunosTreinamentosBonusRP.findOne({
                            where: {
                                id_turma_aluno: turmaAluno.id,
                                id_turma_aluno_treinamento: turmaAlunoTreinamento.id,
                                id_turma_bonus: criarContratoDto.id_turma_bonus,
                                tipo_bonus: tipo,
                                deletado_em: null,
                            },
                        });
                        if (jaExiste) continue;

                        // A coluna ganhadores_bonus é jsonb[] NOT NULL. O TypeORM
                        // não serializa corretamente arrays JS para esse tipo
                        // (tanto '{}' quanto [] geram "malformed array literal"),
                        // então inserimos via query builder gravando o literal de
                        // array vazio diretamente em SQL ('{}'::jsonb[]) e
                        // preenchendo os campos de auditoria manualmente.
                        const agoraBonus = new Date();
                        await this.uow.turmasAlunosTreinamentosBonusRP
                            .createQueryBuilder()
                            .insert()
                            .values({
                                id_turma_aluno: turmaAluno.id,
                                id_turma_aluno_treinamento: turmaAlunoTreinamento.id,
                                id_turma_bonus: criarContratoDto.id_turma_bonus,
                                tipo_bonus: tipo,
                                ganhadores_bonus: () => `'{}'::jsonb[]`,
                                criado_em: agoraBonus,
                                atualizado_em: agoraBonus,
                                ...(userId ? { criado_por: userId, atualizado_por: userId } : {}),
                            })
                            .execute();
                    }
                }
            }

            // Preparar dados para o template usando os dados do DTO
            const templateData = await this.prepareTemplateDataFromDto(aluno, treinamento, turma, criarContratoDto);

            const pdfBuffer = await this.contractTemplateService.generateContractPDF(templateData);

            // Preparar signers (aluno + testemunhas)
            const signers = [
                {
                    name: aluno.nome,
                    email: aluno.email,
                    phone: aluno.telefone_um,
                    action: 'sign' as const,
                },
            ];

            // Adicionar testemunhas aos signers se existirem
            if (criarContratoDto.testemunha_um_nome && criarContratoDto.testemunha_um_cpf) {
                signers.push({
                    name: criarContratoDto.testemunha_um_nome,
                    email: criarContratoDto.testemunha_um_email || '',
                    phone: criarContratoDto.testemunha_um_telefone || '',
                    action: 'sign' as const,
                });
            }

            if (criarContratoDto.testemunha_dois_nome && criarContratoDto.testemunha_dois_cpf) {
                signers.push({
                    name: criarContratoDto.testemunha_dois_nome,
                    email: criarContratoDto.testemunha_dois_email || '',
                    phone: criarContratoDto.testemunha_dois_telefone || '',
                    action: 'sign' as const,
                });
            }

            // Criar documento no ZapSign usando o PDF gerado
            const documentData = {
                name: `Contrato ${treinamento.treinamento} - ${aluno.nome}`,
                signers: signers,
                message: 'Por favor, assine este contrato de treinamento.',
                sandbox: false,
                file: pdfBuffer,
            };

            const zapSignResponse = await this.zapSignService.createDocumentFromFile(documentData);

            // Processar dados de bônus completos
            const bonusData = this.processBonusData(criarContratoDto, turma);

            // Processar dados específicos do boleto
            const boletoData = this.processBoletoData(criarContratoDto);
            bonusData.campos_variaveis = { ...bonusData.campos_variaveis, ...boletoData };

            // Preparar dados dos signers para o campo zapsign_signers_data
            const signersData = signers.map((signer, index) => {
                // Tentar encontrar o signer correspondente no ZapSign por índice ou nome
                const zapSignSigner = zapSignResponse.signers[index] || zapSignResponse.signers.find((s) => s.name === signer.name);

                return {
                    name: signer.name,
                    email: signer.email || undefined,
                    telefone: signer.phone || undefined,
                    cpf: this.getSignerCPF(signer, aluno, criarContratoDto),
                    status: zapSignSigner?.status || 'pending',
                    signing_url: zapSignSigner?.sign_url || '',
                };
            });

            this.logger.debug(`zapsign.create.contract | Signers preparados total=${signersData.length}`);

            // Preparar status do documento para o campo zapsign_document_status
            const documentStatus = {
                status: zapSignResponse.status,
                created_at: zapSignResponse.created_at,
                document_id: zapSignResponse.token,
                signing_url: zapSignResponse.signers[0]?.sign_url || '',
            };

            // Salvar informações do contrato no banco de dados
            const contrato = this.uow.turmasAlunosTreinamentosContratosRP.create({
                id_turma_aluno_treinamento: turmaAlunoTreinamento.id,
                id_documento: parseInt(criarContratoDto.template_id),
                status_ass_aluno: EStatusAssinaturasContratos.ASSINATURA_PENDENTE,
                // Comprovante(s) de pagamento desta venda, vinculados ao contrato.
                comprovantes_pagamento: comprovantesVenda.length > 0 ? comprovantesVenda : null,
                // Campos ZapSign específicos
                zapsign_document_id: zapSignResponse.token,
                zapsign_signers_data: signersData,
                zapsign_document_status: documentStatus,
                dados_contrato: {
                    zapsign_document_id: zapSignResponse.token,
                    zapsign_document_url: zapSignResponse.signers[0]?.sign_url || '',
                    contrato: {
                        file_url: zapSignResponse.original_file,
                        id_documento_zapsign: zapSignResponse.token,
                    },
                    treinamento: {
                        id: treinamento.id,
                        treinamento: treinamento.treinamento,
                        sigla_treinamento: treinamento.sigla_treinamento,
                        preco_treinamento: treinamento.preco_treinamento,
                        url_logo_treinamento: treinamento.url_logo_treinamento,
                        tipo_treinamento: treinamento.tipo_treinamento,
                        tipo_palestra: treinamento.tipo_palestra,
                        tipo_online: treinamento.tipo_online,
                    },
                    turma: turma
                        ? {
                              id: turma.id,
                              id_treinamento: turma.id_treinamento,
                              edicao_turma: turma.edicao_turma,
                              cidade: turma.cidade,
                              data_inicio: turma.data_inicio,
                              data_final: turma.data_final,
                          }
                        : null,
                    aluno: {
                        id: aluno.id,
                        nome: aluno.nome,
                        cpf: aluno.cpf,
                        email: aluno.email,
                        telefone_um: aluno.telefone_um,
                        logradouro: aluno.logradouro,
                        numero: aluno.numero,
                        bairro: aluno.bairro,
                        cidade: aluno.cidade,
                        estado: aluno.estado,
                        cep: aluno.cep,
                        polo: {
                            id: aluno.id_polo_fk?.id,
                            nome: aluno.id_polo_fk?.polo,
                            cidade: aluno.id_polo_fk?.cidade,
                            estado: aluno.id_polo_fk?.estado,
                        },
                    },
                    pagamento: (() => {
                        const formasProcessadas = this.processPaymentMethods(criarContratoDto);
                        this.logger.debug(`contract.payment.process | Formas processadas para salvar=${formasProcessadas.length}`);
                        return {
                            forma_pagamento: criarContratoDto.forma_pagamento,
                            formas_pagamento: formasProcessadas,
                            valores_formas_pagamento: criarContratoDto.valores_formas_pagamento || {},
                        };
                    })(),
                    formas_pagamento: this.processPaymentMethods(criarContratoDto),
                    valores_formas_pagamento: criarContratoDto.valores_formas_pagamento || {},
                    bonus_selecionados: criarContratoDto.tipos_bonus || [],
                    valores_bonus: bonusData.valores_bonus,
                    id_turma_origem: idTurmaOrigemContrato ?? null,
                    fluxo_evento_origem_id_turma: idTurmaOrigemContrato ?? null,
                    turma_origem: idTurmaOrigemContrato ? { id: idTurmaOrigemContrato } : null,
                    fluxo_evento_destino_id_turma: criarContratoDto.id_turma_destino ? Number(criarContratoDto.id_turma_destino) : null,
                    compradores_adicionais: criarContratoDto.compradores_adicionais || [],
                    // Snapshot da venda usado pelo Histórico de Vendas como fonte da
                    // pendência/quantidade quando a matrícula vinculada ao contrato é
                    // a de origem (e não a de destino onde a pendência foi marcada).
                    turma_aluno: {
                        pendencia_pagamento: criarContratoDto.pendencia_pagamento ?? false,
                        quantidade_inscricoes: criarContratoDto.quantidade_inscricoes ?? 1,
                        outros_clientes: criarContratoDto.compradores_adicionais || [],
                        // Snapshot dos comprovantes desta venda (fallback de leitura).
                        comprovantes_pagamento: comprovantesVenda,
                        comprovante_pagamento_base64: this.serializarComprovantes(comprovantesVenda),
                    },
                    campos_variaveis: bonusData.campos_variaveis,
                    observacoes: criarContratoDto.observacoes || '',
                    testemunhas: (() => {
                        const temTestemunhas = criarContratoDto.testemunha_um_nome || criarContratoDto.testemunha_dois_nome;
                        if (temTestemunhas) {
                            const testemunhasData = {
                                testemunha_um: {
                                    nome: criarContratoDto.testemunha_um_nome || '',
                                    cpf: criarContratoDto.testemunha_um_cpf || '',
                                    email: criarContratoDto.testemunha_um_email || '',
                                    telefone: criarContratoDto.testemunha_um_telefone || '',
                                    id: criarContratoDto.testemunha_um_id || null,
                                },
                                testemunha_dois: {
                                    nome: criarContratoDto.testemunha_dois_nome || '',
                                    cpf: criarContratoDto.testemunha_dois_cpf || '',
                                    email: criarContratoDto.testemunha_dois_email || '',
                                    telefone: criarContratoDto.testemunha_dois_telefone || '',
                                    id: criarContratoDto.testemunha_dois_id || null,
                                },
                            };
                            this.logger.debug('zapsign.create.contract | Testemunhas processadas para salvar no contrato');
                            return testemunhasData;
                        }
                        return undefined;
                    })(),
                },
                criado_por: userId,
                atualizado_por: userId,
            });

            const savedContrato = await this.uow.turmasAlunosTreinamentosContratosRP.save(contrato);

            // Mapear signers com informações completas incluindo testemunhas
            const signersResponse = signers.map((signer, index) => {
                const zapSignSigner = zapSignResponse.signers[index] || zapSignResponse.signers.find((s) => s.name === signer.name);
                return {
                    nome: signer.name,
                    email: signer.email || '',
                    telefone: signer.phone || '',
                    cpf: this.getSignerCPF(signer, aluno, criarContratoDto),
                    status: zapSignSigner?.status || 'pending',
                    tipo: 'sign' as const,
                    signing_url: zapSignSigner?.sign_url || '',
                };
            });

            return {
                id: zapSignResponse.token,
                nome_documento: `Contrato ${treinamento.treinamento} - ${aluno.nome}`,
                status: zapSignResponse.status,
                url_assinatura: zapSignResponse.signers[0]?.sign_url || '',
                signers: signersResponse,
                created_at: zapSignResponse.created_at,
                file_url: zapSignResponse.original_file,
            };
        } catch (error: any) {
            this.logger.error('zapsign.create.contract | Erro ao criar contrato no ZapSign', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException(`Erro ao criar contrato: ${error.message}`);
        }
    }

    /**
     * Obtém o CPF do signatário baseado no nome
     */
    private getSignerCPF(signer: any, aluno: any, criarContratoDto: CriarContratoZapSignDto): string {
        // Se for o aluno principal
        if (signer.name === aluno.nome) {
            return aluno.cpf || '';
        }

        // Se for a testemunha 1
        if (signer.name === criarContratoDto.testemunha_um_nome) {
            return criarContratoDto.testemunha_um_cpf || '';
        }

        // Se for a testemunha 2
        if (signer.name === criarContratoDto.testemunha_dois_nome) {
            return criarContratoDto.testemunha_dois_cpf || '';
        }

        return '';
    }

    /**
     * Prepara os dados para o template do contrato usando dados do DTO
     */
    private async prepareTemplateDataFromDto(aluno: any, treinamento: any, turma: any, criarContratoDto: CriarContratoZapSignDto) {
        this.logger.debug('contract.template.prepare | Preparando dados do DTO para template de contrato');

        // Buscar documento para obter as cláusulas
        let clausulas = '';
        if (criarContratoDto.template_id) {
            const documento = await this.uow.documentosRP.findOne({
                where: { id: parseInt(criarContratoDto.template_id), deletado_em: null },
            });
            clausulas = documento?.clausulas || '';
        }

        // Processar dados de bônus completos
        const bonusData = this.processBonusData(criarContratoDto, turma);

        // Processar dados específicos do boleto
        const boletoData = this.processBoletoData(criarContratoDto);
        bonusData.campos_variaveis = { ...bonusData.campos_variaveis, ...boletoData };

        return {
            aluno: {
                nome: aluno.nome,
                cpf: aluno.cpf,
                data_nascimento: aluno.data_nascimento || '',
                telefone_um: aluno.telefone_um,
                email: aluno.email,
                logradouro: aluno.logradouro,
                numero: aluno.numero,
                bairro: aluno.bairro,
                cidade: aluno.cidade,
                estado: aluno.estado,
                cep: aluno.cep,
                polo: {
                    id: aluno.id_polo_fk?.id,
                    nome: aluno.id_polo_fk?.polo,
                    cidade: aluno.id_polo_fk?.cidade,
                    estado: aluno.id_polo_fk?.estado,
                },
            },
            treinamento: {
                id: treinamento.id,
                treinamento: treinamento.treinamento,
                sigla_treinamento: treinamento.sigla_treinamento,
                preco_treinamento: treinamento.preco_treinamento,
                url_logo_treinamento: treinamento.url_logo_treinamento,
                tipo_treinamento: treinamento.tipo_treinamento,
                tipo_palestra: treinamento.tipo_palestra,
                tipo_online: treinamento.tipo_online,
            },
            pagamento: {
                forma_pagamento: criarContratoDto.forma_pagamento,
                formas_pagamento: this.processPaymentMethods(criarContratoDto),
                valores_formas_pagamento: criarContratoDto.valores_formas_pagamento || {},
            },
            formas_pagamento: this.processPaymentMethods(criarContratoDto),
            valores_formas_pagamento: criarContratoDto.valores_formas_pagamento || {},
            bonus_selecionados: criarContratoDto.tipos_bonus || [],
            valores_bonus: bonusData.valores_bonus,
            compradores_adicionais: criarContratoDto.compradores_adicionais || [],
            campos_variaveis: bonusData.campos_variaveis,
            testemunhas:
                criarContratoDto.testemunha_um_nome || criarContratoDto.testemunha_dois_nome
                    ? {
                          testemunha_um: {
                              nome: criarContratoDto.testemunha_um_nome || '',
                              cpf: criarContratoDto.testemunha_um_cpf || '',
                              email: criarContratoDto.testemunha_um_email || '',
                              telefone: criarContratoDto.testemunha_um_telefone || '',
                              id: criarContratoDto.testemunha_um_id || null,
                          },
                          testemunha_dois: {
                              nome: criarContratoDto.testemunha_dois_nome || '',
                              cpf: criarContratoDto.testemunha_dois_cpf || '',
                              email: criarContratoDto.testemunha_dois_email || '',
                              telefone: criarContratoDto.testemunha_dois_telefone || '',
                              id: criarContratoDto.testemunha_dois_id || null,
                          },
                      }
                    : undefined,
            observacoes: criarContratoDto.observacoes || '',
            clausulas: clausulas,
        };
    }

    /**
     * Calcula o preço total do contrato baseado nas formas de pagamento
     */
    private calculateContractPrice(criarContratoDto: CriarContratoZapSignDto): string {
        let total = 0;

        // Primeiro, tentar usar formas_pagamento se disponível
        if (criarContratoDto.formas_pagamento && Array.isArray(criarContratoDto.formas_pagamento)) {
            // Agrupar por forma e tipo para somar corretamente
            const groupedPayments: { [key: string]: number } = {};

            criarContratoDto.formas_pagamento.forEach((forma: any) => {
                if (forma.valor && typeof forma.valor === 'number') {
                    const key = `${forma.forma}_${forma.tipo}`;
                    if (!groupedPayments[key]) {
                        groupedPayments[key] = 0;
                    }
                    groupedPayments[key] += forma.valor;
                }
            });

            // Somar todos os grupos
            Object.values(groupedPayments).forEach((valorGrupo) => {
                total += valorGrupo;
            });
        }
        // Fallback: usar valores_formas_pagamento
        else if (criarContratoDto.valores_formas_pagamento) {
            const valoresFormas = criarContratoDto.valores_formas_pagamento;
            this.logger.debug('contract.payment.calculate | Calculando preço por valores_formas_pagamento');

            // Processar pagamentos à vista
            const formasAVista = ['À Vista - Cartão de Crédito', 'À Vista - Cartão de Débito', 'À Vista - PIX/Transferência', 'À Vista - Espécie'];

            formasAVista.forEach((chave) => {
                if (valoresFormas[chave] && valoresFormas[chave].valor) {
                    const valor = parseInt(valoresFormas[chave].valor) / 100;
                    total += valor;
                }
            });

            // Processar pagamentos parcelados
            if (valoresFormas['Parcelado - Cartão de Crédito'] && valoresFormas['Parcelado - Cartão de Crédito'].valor) {
                const valor = parseInt(valoresFormas['Parcelado - Cartão de Crédito'].valor) / 100;
                total += valor;
            }

            // Processar boleto parcelado
            const chavesBoleto = ['Parcelado - Boleto', 'Boleto Parcelado', 'Boleto'];

            for (const chave of chavesBoleto) {
                if (valoresFormas[chave]) {
                    const dadosBoleto = valoresFormas[chave];
                    const valorTotal = parseInt(dadosBoleto.valor_parcelas || dadosBoleto.valor || '0') / 100;
                    if (valorTotal > 0) {
                        total += valorTotal;
                        break; // Só processar uma vez
                    }
                }
            }
        }

        this.logger.debug(`contract.payment.calculate | Preço total calculado=${total}`);
        return this.contractTemplateService.formatPrice(total);
    }

    /**
     * Verifica se uma forma de pagamento foi selecionada
     */
    private isPaymentMethodSelected(criarContratoDto: CriarContratoZapSignDto, methodName: string): boolean {
        if (!criarContratoDto.valores_formas_pagamento) {
            return false;
        }

        const valoresFormas = criarContratoDto.valores_formas_pagamento;

        // Verificar se existe a chave exata (formato objeto)
        if (typeof valoresFormas === 'object' && !Array.isArray(valoresFormas)) {
            const hasExactKey = !!valoresFormas[methodName];
            if (hasExactKey) {
                return true;
            }
        }

        // Verificar no formato array
        if (Array.isArray(valoresFormas)) {
            // Mapear nomes para códigos
            const methodMapping: Record<string, { forma: string; tipo: string }> = {
                'À Vista - Cartão de Crédito': { forma: 'CARTAO_CREDITO', tipo: 'A_VISTA' },
                'À Vista - Cartão de Débito': { forma: 'CARTAO_DEBITO', tipo: 'A_VISTA' },
                'À Vista - PIX/Transferência': { forma: 'PIX', tipo: 'A_VISTA' },
                'À Vista - Espécie': { forma: 'ESPECIE', tipo: 'A_VISTA' },
                'Parcelado - Cartão de Crédito': { forma: 'CARTAO_CREDITO', tipo: 'PARCELADO' },
                'Parcelado - Boleto': { forma: 'BOLETO', tipo: 'PARCELADO' },
            };

            const methodConfig = methodMapping[methodName];
            if (methodConfig) {
                const found = valoresFormas.some((forma: any) => forma.forma === methodConfig.forma && forma.tipo === methodConfig.tipo);
                return found;
            }
        }

        // Verificar se há dados nas formas_pagamento salvas no banco
        if (criarContratoDto.formas_pagamento && Array.isArray(criarContratoDto.formas_pagamento)) {
            const methodMapping: Record<string, { forma: string; tipo: string }> = {
                'À Vista - Cartão de Crédito': { forma: 'CARTAO_CREDITO', tipo: 'A_VISTA' },
                'À Vista - Cartão de Débito': { forma: 'CARTAO_DEBITO', tipo: 'A_VISTA' },
                'À Vista - PIX/Transferência': { forma: 'PIX', tipo: 'A_VISTA' },
                'À Vista - Espécie': { forma: 'ESPECIE', tipo: 'A_VISTA' },
                'Parcelado - Cartão de Crédito': { forma: 'CARTAO_CREDITO', tipo: 'PARCELADO' },
                'Parcelado - Boleto': { forma: 'BOLETO', tipo: 'PARCELADO' },
            };

            const methodConfig = methodMapping[methodName];
            if (methodConfig) {
                // Para pagamentos parcelados, verifica se existe pelo menos uma parcela
                const found = criarContratoDto.formas_pagamento.some((forma: any) => {
                    const matchesFormaAndTipo = forma.forma === methodConfig.forma && forma.tipo === methodConfig.tipo;
                    return matchesFormaAndTipo;
                });
                return found;
            }
        }

        return false;
    }

    /**
     * Processa dados específicos do boleto parcelado
     */
    private processBoletoData(criarContratoDto: CriarContratoZapSignDto): any {
        const boletoData: any = {};

        if (!criarContratoDto.valores_formas_pagamento) {
            return boletoData;
        }

        const valoresFormas = criarContratoDto.valores_formas_pagamento;

        // Tentar diferentes chaves para encontrar dados do boleto
        const chavesBoleto = [
            'Parcelado - Boleto',
            'Boleto Parcelado',
            'Boleto',
            'boleto_parcelado',
            'boleto',
            'Parcelado - Boleto Bancário',
            'Boleto Bancário',
            'Parcelado - Boleto - Parcelas',
            'Boleto - Parcelas',
            'Boleto Parcelado - Parcelas',
            'Parcelas - Boleto',
        ];

        let dadosBoleto = null;

        for (const chave of chavesBoleto) {
            if (valoresFormas[chave]) {
                dadosBoleto = valoresFormas[chave];
                break;
            }
        }

        // Se não encontrou diretamente, tentar buscar em estruturas aninhadas
        if (!dadosBoleto) {
            for (const chave of Object.keys(valoresFormas)) {
                const valor = valoresFormas[chave];
                if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
                    // Buscar por campos que indiquem boleto
                    if (valor.dia || valor.data_primeiro_boleto || valor.data_1_boleto || valor.valor_parcelas) {
                        dadosBoleto = valor;
                        break;
                    }
                }
            }
        }

        if (dadosBoleto) {
            // Capturar informações específicas do boleto
            const diaVencimento = dadosBoleto.dia || dadosBoleto.dia_vencimento || dadosBoleto.dia_boleto;
            const dataPrimeiroBoleto = dadosBoleto.data_primeiro_boleto || dadosBoleto.data_1_boleto || dadosBoleto.data_inicio_boleto;
            const valorTotal = dadosBoleto.valor_parcelas || dadosBoleto.valor || dadosBoleto.valor_total || dadosBoleto.valor_boleto;
            const numeroParcelas = dadosBoleto.numero_parcelas || dadosBoleto.parcelas || dadosBoleto.num_parcelas || dadosBoleto.qtd_parcelas;

            if (diaVencimento) {
                boletoData['Dia de Vencimento do Boleto'] = diaVencimento;
            }

            if (dataPrimeiroBoleto) {
                boletoData['Data do Primeiro Boleto'] = dataPrimeiroBoleto;
            }

            if (valorTotal) {
                boletoData['Valor Total do Boleto'] = valorTotal;
            }

            if (numeroParcelas) {
                boletoData['Número de Parcelas do Boleto'] = numeroParcelas;
            }
        }

        return boletoData;
    }

    /**
     * Processa todos os dados de bônus de forma completa
     */
    private processBonusData(criarContratoDto: CriarContratoZapSignDto, turma: any): { valores_bonus: any; campos_variaveis: any } {
        const valoresBonus: any = {};
        const camposVariaveis: any = { ...criarContratoDto.campos_variaveis };

        // Processar bônus dos 100 dias
        if (this.isBonusSelected(criarContratoDto, ['100_dias', 'cem_dias'])) {
            valoresBonus['Bônus-100 Dias'] = true;
        }

        // Processar bônus do IPR (Imersão Prosperar)
        if (this.isBonusSelected(criarContratoDto, ['ipr'])) {
            valoresBonus['Bônus-IPR'] = true;

            // Adicionar quantidade de inscrições do Prosperar
            const quantidadeInscricoes = camposVariaveis['Quantidade de Inscrições'] || '1';
            valoresBonus[`Bônus-${quantidadeInscricoes} Inscrições do Imersão Prosperar`] = true;

            // Adicionar data da turma de IPR - usar a data dos campos variáveis se disponível
            if (!camposVariaveis['Data do Imersão Prosperar'] && turma && turma.data_inicio) {
                camposVariaveis['Data do Imersão Prosperar'] = this.contractTemplateService.formatDate(turma.data_inicio);
            }

            // Adicionar sigla e edição do IPR
            const siglaEdicao = camposVariaveis['IPR - Sigla e Edição'] || camposVariaveis['Turma IPR'];
            if (siglaEdicao) {
                camposVariaveis['Sigla e Edição IPR'] = siglaEdicao;
            }
        }

        // Processar outros bônus
        if (this.isBonusSelected(criarContratoDto, ['outros'])) {
            const descricaoOutros = this.getOutrosDescricao(criarContratoDto);
            if (descricaoOutros) {
                valoresBonus[`Bônus-Outros: ${descricaoOutros}`] = true;

                // Adicionar valor do bônus outros se disponível
                const valorOutros = camposVariaveis['Valor do Bônus (R$)'] || camposVariaveis['Valor do Outro Bônus'];
                if (valorOutros) {
                    camposVariaveis['Valor do Outro Bônus'] = valorOutros;
                }
            }
        }

        // Processar campos variáveis adicionais
        // Adicionar local de assinatura se não estiver presente
        if (!camposVariaveis['Local de Assinatura do Contrato']) {
            camposVariaveis['Local de Assinatura do Contrato'] = camposVariaveis['Cidade do Treinamento'] || 'Americana/SP';
        }

        this.logger.debug(`contract.bonus.process | Bônus processados=${Object.keys(valoresBonus).length}`);

        return {
            valores_bonus: valoresBonus,
            campos_variaveis: camposVariaveis,
        };
    }

    /**
     * Processa dados de boleto parcelado com diferentes formatos possíveis
     */
    private processBoletoParcelado(valoresFormas: any): any[] {
        const formasPagamento: any[] = [];

        // Tentar diferentes chaves possíveis para o boleto
        const chavesBoleto = [
            'Parcelado - Boleto',
            'Boleto Parcelado',
            'Boleto',
            'boleto_parcelado',
            'boleto',
            'Parcelado - Boleto Bancário',
            'Boleto Bancário',
            'Parcelado - Boleto - Parcelas',
            'Boleto - Parcelas',
            'Boleto Parcelado - Parcelas',
            'Parcelas - Boleto',
        ];

        let dadosBoleto = null;
        let chaveEncontrada = null;

        for (const chave of chavesBoleto) {
            if (valoresFormas[chave]) {
                dadosBoleto = valoresFormas[chave];
                chaveEncontrada = chave;
                break;
            }
        }

        // Se não encontrou diretamente, tentar buscar em estruturas aninhadas
        if (!dadosBoleto) {
            for (const chave of Object.keys(valoresFormas)) {
                const valor = valoresFormas[chave];
                if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
                    // Buscar por campos que indiquem boleto
                    if (valor.dia || valor.data_primeiro_boleto || valor.data_1_boleto || valor.valor_parcelas) {
                        dadosBoleto = valor;
                        chaveEncontrada = chave;
                        break;
                    }
                }
            }
        }

        if (!dadosBoleto) {
            this.logger.debug('contract.payment.boleto | Nenhum boleto parcelado encontrado');
            return formasPagamento;
        }

        // Tentar diferentes campos para o valor
        const valorTotal =
            parseInt(dadosBoleto.valor_parcelas || dadosBoleto.valor || dadosBoleto.valor_total || dadosBoleto.valor_boleto || dadosBoleto.valor_parcela || '0') /
            100;

        // Tentar diferentes campos para o número de parcelas
        const numeroParcelas = parseInt(
            dadosBoleto.numero_parcelas || dadosBoleto.parcelas || dadosBoleto.num_parcelas || dadosBoleto.qtd_parcelas || dadosBoleto.numero_parcelas_boleto || '1',
        );

        // Capturar informações específicas do boleto
        const diaVencimento = dadosBoleto.dia || dadosBoleto.dia_vencimento || dadosBoleto.dia_boleto;
        const dataPrimeiroBoleto = dadosBoleto.data_primeiro_boleto || dadosBoleto.data_1_boleto || dadosBoleto.data_inicio_boleto;

        const valorParcela = valorTotal / numeroParcelas;
        this.logger.debug(`contract.payment.boleto | Processado chave=${String(chaveEncontrada)} parcelas=${numeroParcelas} valorTotal=${valorTotal}`);

        for (let i = 0; i < numeroParcelas; i++) {
            formasPagamento.push({
                tipo: 'PARCELADO',
                forma: 'BOLETO',
                valor: valorParcela,
            });
        }

        return formasPagamento;
    }

    /**
     * Processa as formas de pagamento para salvar no banco
     */
    private processPaymentMethods(criarContratoDto: CriarContratoZapSignDto): any[] {
        const formasPagamento: any[] = [];

        // Primeiro, verificar se há dados diretamente no campo formas_pagamento
        if (criarContratoDto.formas_pagamento && Array.isArray(criarContratoDto.formas_pagamento) && criarContratoDto.formas_pagamento.length > 0) {
            criarContratoDto.formas_pagamento.forEach((forma: any) => {
                if (forma.valor && typeof forma.valor === 'number' && forma.valor > 0) {
                    // Determinar tipo e forma baseado no nome da forma
                    let tipo: string = 'A_VISTA';
                    let formaPagamento: string = '';
                    let parcelas: number = 1;

                    const formaNome = forma.forma || '';

                    // Verificar se é à vista ou parcelado
                    if (formaNome.toLowerCase().includes('parcelado') || formaNome.toLowerCase().includes('parcela')) {
                        tipo = 'PARCELADO';
                        // Extrair número de parcelas da descrição se disponível
                        if (forma.descricao) {
                            const matchParcelas = forma.descricao.match(/(\d+)x/);
                            if (matchParcelas) {
                                parcelas = parseInt(matchParcelas[1]) || 1;
                            }
                        }
                        // Extrair número de parcelas se estiver no objeto
                        if (forma.parcelas) {
                            parcelas = forma.parcelas;
                        }
                    }

                    // Mapear nome da forma para código
                    if (formaNome.includes('Cartão de Crédito') || formaNome.includes('Cartão de Crédito')) {
                        formaPagamento = 'CARTAO_CREDITO';
                    } else if (formaNome.includes('Cartão de Débito') || formaNome.includes('Cartão de Débito')) {
                        formaPagamento = 'CARTAO_DEBITO';
                    } else if (formaNome.includes('PIX') || formaNome.includes('Transferência')) {
                        formaPagamento = 'PIX';
                    } else if (formaNome.includes('Espécie') || formaNome.includes('Dinheiro')) {
                        formaPagamento = 'DINHEIRO';
                    } else if (formaNome.includes('Boleto')) {
                        formaPagamento = 'BOLETO';
                    }

                    if (formaPagamento) {
                        formasPagamento.push({
                            tipo: tipo,
                            forma: formaPagamento,
                            valor: forma.valor,
                            parcelas: tipo === 'PARCELADO' ? parcelas : undefined,
                            descricao: forma.descricao || formaNome,
                        });
                    }
                }
            });

            if (formasPagamento.length > 0) {
                return formasPagamento;
            }
        }

        // Processar formas de pagamento baseado nos valores_formas_pagamento
        if (criarContratoDto.valores_formas_pagamento) {
            const valoresFormas = criarContratoDto.valores_formas_pagamento;
            this.logger.debug('contract.payment.process | Processando valores_formas_pagamento');

            // Processar pagamentos à vista
            const formasAVista = [
                { chave: 'À Vista - Cartão de Crédito', forma: 'CARTAO_CREDITO' },
                { chave: 'À Vista - Cartão de Débito', forma: 'CARTAO_DEBITO' },
                { chave: 'À Vista - PIX/Transferência', forma: 'PIX' },
                { chave: 'À Vista - Espécie', forma: 'DINHEIRO' },
            ];

            formasAVista.forEach(({ chave, forma }) => {
                if (valoresFormas[chave] && valoresFormas[chave].valor) {
                    const valor = parseInt(valoresFormas[chave].valor) / 100;
                    if (valor > 0) {
                        formasPagamento.push({
                            tipo: 'A_VISTA',
                            forma: forma,
                            valor: valor,
                        });
                    }
                }
            });

            // Processar pagamentos parcelados - Cartão de Crédito
            if (valoresFormas['Parcelado - Cartão de Crédito'] && valoresFormas['Parcelado - Cartão de Crédito'].valor) {
                const valorTotal = parseInt(valoresFormas['Parcelado - Cartão de Crédito'].valor) / 100;
                const numeroParcelas = parseInt(valoresFormas['Parcelado - Cartão de Crédito'].numero_parcelas) || 1;
                const valorParcela = valorTotal / numeroParcelas;

                for (let i = 0; i < numeroParcelas; i++) {
                    formasPagamento.push({
                        tipo: 'PARCELADO',
                        forma: 'CARTAO_CREDITO',
                        valor: valorParcela,
                    });
                }
            }

            // Processar boleto parcelado usando a função específica
            const boletoParcelado = this.processBoletoParcelado(valoresFormas);
            formasPagamento.push(...boletoParcelado);
        }

        this.logger.debug(`contract.payment.process | Formas processadas=${formasPagamento.length}`);
        return formasPagamento;
    }

    /**
     * Determina se deve mostrar "NÃO SE APLICA" baseado nos tipos de bônus selecionados
     */
    private shouldShowNaoAplica(criarContratoDto: CriarContratoZapSignDto): boolean {
        const tiposBonus = criarContratoDto.tipos_bonus || [];
        const bonusSelecionados = (criarContratoDto as any).bonus_selecionados || [];

        // Se não há tipos de bônus ou se apenas 'nao_aplica' está selecionado
        if (tiposBonus.length === 0 && bonusSelecionados.length === 0) {
            return true;
        }

        if (tiposBonus.includes('nao_aplica') && tiposBonus.length === 1) {
            return true;
        }

        // Se há outros tipos de bônus selecionados, não mostra "NÃO SE APLICA"
        return false;
    }

    /**
     * Obtém a data do IPR baseado nos dados fornecidos
     */
    private getIprData(criarContratoDto: CriarContratoZapSignDto, turma: any): string {
        // Primeiro, verifica se há data específica nos campos variáveis
        if (criarContratoDto.campos_variaveis?.data_ipr) {
            return this.contractTemplateService.formatDate(criarContratoDto.campos_variaveis.data_ipr);
        }

        // Verifica se há data prevista do treinamento nos campos variáveis
        if (criarContratoDto.campos_variaveis?.['Data Prevista do Treinamento']) {
            return criarContratoDto.campos_variaveis['Data Prevista do Treinamento'];
        }

        // Se não há, usa a data da turma
        if (turma?.data_inicio) {
            return this.contractTemplateService.formatDate(turma.data_inicio);
        }

        return '';
    }

    /**
     * Obtém a descrição dos outros bônus
     */
    private getOutrosDescricao(criarContratoDto: CriarContratoZapSignDto): string {
        // Verifica em diferentes campos possíveis
        const camposVariaveis = criarContratoDto.campos_variaveis || {};

        return camposVariaveis['Descrição do Outro Bônus'] || camposVariaveis['outros_descricao'] || camposVariaveis['descricao_outros'] || '';
    }

    /**
     * Verifica se um bônus foi selecionado (considera tanto tipos_bonus quanto bonus_selecionados)
     */
    private isBonusSelected(criarContratoDto: CriarContratoZapSignDto, bonusTypes: string[]): boolean {
        const tiposBonus = criarContratoDto.tipos_bonus || [];
        const bonusSelecionados = (criarContratoDto as any).bonus_selecionados || [];

        // Verifica se algum dos tipos de bônus está presente em qualquer um dos arrays
        return bonusTypes.some((bonusType) => tiposBonus.includes(bonusType) || bonusSelecionados.includes(bonusType));
    }

    /**
     * Obtém a cidade do treinamento dos campos variáveis ou dados do treinamento
     */
    private getTreinamentoCidade(criarContratoDto: CriarContratoZapSignDto, treinamento: any): string {
        return criarContratoDto.campos_variaveis?.['Cidade do Treinamento'] || treinamento.cidade || 'Americana/SP';
    }

    /**
     * Obtém a data de início do treinamento dos campos variáveis ou dados do treinamento
     */
    private getTreinamentoDataInicio(criarContratoDto: CriarContratoZapSignDto, treinamento: any): string {
        return criarContratoDto.campos_variaveis?.['Data Prevista do Treinamento'] || this.contractTemplateService.formatDate(treinamento.data_inicio) || '';
    }

    /**
     * Obtém a data de fim do treinamento dos campos variáveis ou dados do treinamento
     */
    private getTreinamentoDataFim(criarContratoDto: CriarContratoZapSignDto, treinamento: any): string {
        return criarContratoDto.campos_variaveis?.['Data Final do Treinamento'] || this.contractTemplateService.formatDate(treinamento.data_fim) || '';
    }

    /**
     * Calcula o valor real pago baseado nas formas de pagamento
     */
    private calculateRealPaidValue(criarContratoDto: CriarContratoZapSignDto): string {
        // Por enquanto, retorna o valor total do contrato como valor pago
        // Isso pode ser modificado para considerar apenas valores efetivamente pagos
        const totalValue = this.calculateContractPrice(criarContratoDto);
        return totalValue;
    }

    /**
     * Obtém a forma de pagamento selecionada em texto legível
     */
    private getSelectedPaymentMethod(criarContratoDto: CriarContratoZapSignDto): string {
        if (!criarContratoDto.formas_pagamento || !Array.isArray(criarContratoDto.formas_pagamento) || criarContratoDto.formas_pagamento.length === 0) {
            return 'Não informado';
        }

        const formasPagamento = criarContratoDto.formas_pagamento;
        const primeiraForma = formasPagamento[0];

        // Mapear códigos para nomes legíveis
        const formaMapping: Record<string, string> = {
            CARTAO_CREDITO: 'Cartão de Crédito',
            CARTAO_DEBITO: 'Cartão de Débito',
            PIX: 'PIX/Transferência',
            ESPECIE: 'Espécie',
            BOLETO: 'Boleto',
        };

        const tipoMapping: Record<string, string> = {
            A_VISTA: 'À Vista',
            PARCELADO: 'Parcelado',
        };

        const forma = formaMapping[primeiraForma.forma] || primeiraForma.forma;
        const tipo = tipoMapping[primeiraForma.tipo] || primeiraForma.tipo;

        if (primeiraForma.tipo === 'PARCELADO') {
            const numeroParcelas = formasPagamento.length;
            return `${forma} ${tipo} (${numeroParcelas} parcelas)`;
        }

        return `${forma} ${tipo}`;
    }

    /**
     * Gera os detalhes das formas de pagamento no formato de lista
     */
    private generatePaymentDetails(criarContratoDto: CriarContratoZapSignDto): string {
        this.logger.debug('contract.payment.details | Gerando detalhes de pagamento');

        // Primeiro, tentar usar formas_pagamento se disponível
        if (criarContratoDto.formas_pagamento && Array.isArray(criarContratoDto.formas_pagamento) && criarContratoDto.formas_pagamento.length > 0) {
            const formasPagamento = criarContratoDto.formas_pagamento;

            // Agrupar formas de pagamento por tipo e forma
            const groupedPayments: { [key: string]: { valor: number; count: number; tipo: string; forma: string } } = {};

            formasPagamento.forEach((pagamento: any) => {
                const key = `${pagamento.forma}_${pagamento.tipo}`;
                if (!groupedPayments[key]) {
                    groupedPayments[key] = {
                        valor: 0,
                        count: 0,
                        tipo: pagamento.tipo,
                        forma: pagamento.forma,
                    };
                }
                groupedPayments[key].valor += pagamento.valor;
                groupedPayments[key].count += 1;
            });

            // Gerar lista de detalhes
            const details: string[] = [];

            Object.values(groupedPayments).forEach((group) => {
                const valorFormatado = this.contractTemplateService.formatPrice(group.valor);
                const formaNome = this.getFormaPagamentoNome(group.forma);

                if (group.tipo === 'PARCELADO') {
                    const valorParcela = this.contractTemplateService.formatPrice(group.valor / group.count);
                    details.push(`• ${valorFormatado} no ${formaNome} em ${group.count}x de ${valorParcela}`);
                } else {
                    details.push(`• ${valorFormatado} no ${formaNome}`);
                }
            });

            this.logger.debug(`contract.payment.details | Detalhes gerados por formas_pagamento=${details.length}`);
            return details.join('<br>');
        }

        // Fallback: usar valores_formas_pagamento
        if (criarContratoDto.valores_formas_pagamento) {
            this.logger.debug('contract.payment.details | Gerando detalhes por valores_formas_pagamento');
            return this.generatePaymentDetailsFromValoresFormas(criarContratoDto.valores_formas_pagamento, criarContratoDto.campos_variaveis || {});
        }

        this.logger.warn('contract.payment.details | Nenhuma forma de pagamento encontrada para gerar detalhes');
        return '• Não informado';
    }

    /**
     * Converte código da forma de pagamento para nome legível
     */
    private getFormaPagamentoNome(codigo: string): string {
        const mapping: Record<string, string> = {
            CARTAO_CREDITO: 'Cartão de Crédito',
            CARTAO_DEBITO: 'Cartão de Débito',
            PIX: 'PIX/Transferência',
            DINHEIRO: 'Espécie',
            ESPECIE: 'Espécie',
            BOLETO: 'Boleto',
        };
        return mapping[codigo] || codigo;
    }

    /**
     * Converte código do tipo de pagamento para nome legível
     */
    private getTipoPagamentoNome(codigo: string): string {
        const mapping: Record<string, string> = {
            A_VISTA: 'À Vista',
            PARCELADO: 'Parcelado',
        };
        return mapping[codigo] || codigo;
    }

    /**
     * Gera um contrato PDF usando dados salvos no banco
     */
    async gerarContratoPDF(contratoId: string): Promise<Buffer> {
        try {
            this.logger.log(`zapsign.pdf.generate | Gerando contrato PDF contratoId=${contratoId}`);

            // Buscar contrato completo do banco
            const contrato = await this.buscarContratoCompleto(contratoId);

            if (!contrato) {
                throw new NotFoundException('Contrato não encontrado');
            }

            // Preparar dados para o template usando dados salvos
            const templateData = this.prepareTemplateDataFromSavedContract(contrato);

            // Gerar PDF usando o template
            const pdfBuffer = await this.contractTemplateService.generateContractPDF(templateData);

            this.logger.log(`zapsign.pdf.generate | PDF gerado com sucesso bytes=${pdfBuffer.length}`);
            return pdfBuffer;
        } catch (error) {
            this.logger.error('zapsign.pdf.generate | Erro ao gerar contrato PDF', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException(`Erro ao gerar contrato PDF: ${(error as Error).message}`);
        }
    }

    /**
     * Cancela um documento do ZapSign e faz soft delete no banco
     */
    async cancelarDocumentoZapSign(documentoId: string, userId?: number): Promise<{ message: string }> {
        try {
            this.logger.log(`zapsign.cancel | Cancelando documento ZapSign documentoId=${documentoId}`);

            // Primeiro, vamos listar todos os contratos para debug
            const todosContratos = await this.uow.turmasAlunosTreinamentosContratosRP
                .createQueryBuilder('contrato')
                .where('contrato.deletado_em IS NULL')
                .select(['contrato.id', 'contrato.dados_contrato'])
                .getMany();

            this.logger.debug(`contract.repo.cancel | Contratos ativos para validação=${todosContratos.length}`);

            // Buscar contrato pelo zapsign_document_id ou por ID numérico com relacionamentos
            let contrato = await this.uow.turmasAlunosTreinamentosContratosRP
                .createQueryBuilder('contrato')
                .leftJoinAndSelect('contrato.id_turma_aluno_treinamento_fk', 'turma_aluno_treinamento')
                .leftJoinAndSelect('turma_aluno_treinamento.id_turma_aluno_fk', 'turma_aluno')
                .leftJoinAndSelect('turma_aluno.id_aluno_fk', 'aluno')
                .where('contrato.deletado_em IS NULL')
                .andWhere('contrato.zapsign_document_id = :documentoId', { documentoId })
                .getOne();

            if (!contrato) {
                this.logger.warn(`contract.repo.cancel | Contrato não encontrado por document_id=${documentoId}; tentando ID numérico`);

                // Tentar buscar por ID numérico também
                contrato = await this.uow.turmasAlunosTreinamentosContratosRP
                    .createQueryBuilder('contrato')
                    .leftJoinAndSelect('contrato.id_turma_aluno_treinamento_fk', 'turma_aluno_treinamento')
                    .leftJoinAndSelect('turma_aluno_treinamento.id_turma_aluno_fk', 'turma_aluno')
                    .leftJoinAndSelect('turma_aluno.id_aluno_fk', 'aluno')
                    .where('contrato.deletado_em IS NULL')
                    .andWhere('contrato.id = :documentoId', { documentoId: parseInt(documentoId) })
                    .getOne();

                if (!contrato) {
                    throw new NotFoundException('Contrato não encontrado no banco de dados');
                }
            }

            this.logger.log(`contract.repo.cancel | Contrato encontrado id=${contrato.id}`);

            const dadosContrato = contrato.dados_contrato || {};
            const turmaAlunoComprador = contrato.id_turma_aluno_treinamento_fk?.id_turma_aluno_fk;
            const idTurmaAlunoComprador = turmaAlunoComprador?.id || null;
            const idAlunoComprador = turmaAlunoComprador?.id_aluno || dadosContrato?.aluno?.id || dadosContrato?.aluno?.id_aluno || null;

            this.logger.debug('contract.repo.cancel | Cancelamento por IDs mapeado');

            const idsTurmasAlunosParaRemover = new Set<string>();
            const adicionarTurmaAlunoParaRemocao = (idTurmaAluno?: string | null) => {
                if (!idTurmaAluno) return;
                idsTurmasAlunosParaRemover.add(idTurmaAluno);
            };
            const podeRemoverTurmaAlunoSemAfetarOutrosContratos = async (idTurmaAluno: string) => {
                const treinamentosDaMatricula = await this.uow.turmasAlunosTreinamentosRP.find({
                    where: {
                        id_turma_aluno: idTurmaAluno,
                        deletado_em: null,
                    },
                    select: {
                        id: true,
                    },
                });

                const idsTreinamentosDaMatricula = treinamentosDaMatricula.map((item) => item.id);
                if (idsTreinamentosDaMatricula.length === 0) {
                    return true;
                }

                const outrosContratosAtivosVinculados = await this.uow.turmasAlunosTreinamentosContratosRP
                    .createQueryBuilder('contrato')
                    .where('contrato.deletado_em IS NULL')
                    .andWhere('contrato.id <> :idContratoAtual', { idContratoAtual: contrato.id })
                    .andWhere('contrato.id_turma_aluno_treinamento IN (:...idsTreinamentos)', {
                        idsTreinamentos: idsTreinamentosDaMatricula,
                    })
                    .getCount();

                return outrosContratosAtivosVinculados === 0;
            };

            // 1) Matrícula principal do aluno comprador na turma desta venda
            adicionarTurmaAlunoParaRemocao(idTurmaAlunoComprador);

            // 2) Matrículas bônus vinculadas ao comprador (somente por IDs)
            if (idAlunoComprador) {
                const idsTurmasBonusRelacionadas = new Set<number>();

                if (idTurmaAlunoComprador) {
                    const vinculosBonus = await this.uow.turmasAlunosTreinamentosBonusRP.find({
                        where: {
                            id_turma_aluno: idTurmaAlunoComprador,
                            deletado_em: null,
                        },
                    });

                    vinculosBonus.forEach((vinculo) => {
                        const ganhadores = Array.isArray(vinculo.ganhadores_bonus) ? vinculo.ganhadores_bonus : [];
                        ganhadores.forEach((ganhador) => {
                            const idTurmaBonus = Number(ganhador.id_turma_gb);
                            if (Number.isInteger(idTurmaBonus)) {
                                idsTurmasBonusRelacionadas.add(idTurmaBonus);
                            }
                        });
                    });
                }

                const turmaBonusInfo = (dadosContrato?.bonus?.turma_bonus_info || dadosContrato?.turma_bonus_info) as
                    | { id?: unknown; id_turma?: unknown }
                    | undefined;
                const idTurmaBonusInfo = Number(turmaBonusInfo?.id_turma ?? turmaBonusInfo?.id);
                if (Number.isInteger(idTurmaBonusInfo)) {
                    idsTurmasBonusRelacionadas.add(idTurmaBonusInfo);
                }

                if (idsTurmasBonusRelacionadas.size > 0) {
                    const matriculasBonus = await this.uow.turmasAlunosRP.find({
                        where: {
                            id_aluno_bonus: idAlunoComprador,
                            origem_aluno: EOrigemAlunos.ALUNO_BONUS,
                            deletado_em: null,
                            id_turma: In(Array.from(idsTurmasBonusRelacionadas)),
                        },
                    });

                    for (const turmaAlunoBonus of matriculasBonus) {
                        adicionarTurmaAlunoParaRemocao(turmaAlunoBonus.id);
                    }

                    this.logger.debug(`contract.repo.cancel | Matrículas bônus identificadas=${matriculasBonus.length}`);
                } else {
                    this.logger.debug('contract.repo.cancel | Nenhuma turma bônus vinculada por ID encontrada para este contrato');
                }
            }

            // 3) Remover matrículas apenas quando não houver outro contrato ativo vinculado
            const idsTurmasAlunosElegiveisParaRemocao = new Set<string>();
            for (const idTurmaAluno of idsTurmasAlunosParaRemover) {
                const podeRemover = await podeRemoverTurmaAlunoSemAfetarOutrosContratos(idTurmaAluno);
                if (podeRemover) {
                    idsTurmasAlunosElegiveisParaRemocao.add(idTurmaAluno);
                } else {
                    this.logger.debug(`contract.repo.cancel | Matrícula preservada por contrato ativo idTurmaAluno=${idTurmaAluno}`);
                }
            }

            this.logger.log(`contract.repo.cancel | Removendo matrículas elegíveis=${idsTurmasAlunosElegiveisParaRemocao.size}`);
            for (const idTurmaAluno of idsTurmasAlunosElegiveisParaRemocao) {
                try {
                    await this.turmasService.removeAlunoTurma(idTurmaAluno);
                    this.logger.debug(`contract.repo.cancel | Aluno removido da turma idTurmaAluno=${idTurmaAluno}`);
                } catch (error) {
                    this.logger.warn(`contract.repo.cancel | Erro ao remover aluno da turma idTurmaAluno=${idTurmaAluno}`);
                    // Continuar removendo os outros mesmo se um falhar
                }
            }

            // Cancelar documento no ZapSign
            const documentIdZapSign = contrato.zapsign_document_id || contrato.dados_contrato?.zapsign_document_id || documentoId;
            if (documentIdZapSign) {
                try {
                    await this.zapSignService.cancelDocument(documentIdZapSign);
                    this.logger.debug('zapsign.cancel | Documento cancelado no ZapSign');
                } catch (zapSignError) {
                    this.logger.warn('zapsign.cancel | Erro ao cancelar documento no ZapSign');
                    // Continuar mesmo se falhar na Zapsign
                }
            }

            // Fazer soft delete no banco
            await this.uow.turmasAlunosTreinamentosContratosRP.update(contrato.id, {
                deletado_em: new Date(),
                atualizado_por: userId,
            });

            this.logger.log('contract.repo.cancel | Contrato removido do banco (soft delete)');

            return {
                message: 'Documento cancelado com sucesso. Contrato removido e vínculos de turma/bônus tratados por ID, sem afetar contratos duplicados ativos.',
            };
        } catch (error) {
            this.logger.error('zapsign.cancel | Erro ao cancelar documento', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException(`Erro ao cancelar documento: ${(error as Error).message}`);
        }
    }

    /**
     * Exclui um contrato do ZapSign e faz soft delete no banco
     */
    async excluirDocumentoZapSign(contratoId: string, userId?: number): Promise<{ message: string }> {
        try {
            this.logger.log(`zapsign.delete | Excluindo contrato ZapSign contratoId=${contratoId}`);
            const contratoIdNumerico = Number(contratoId);
            if (!Number.isInteger(contratoIdNumerico)) {
                throw new BadRequestException('ID de contrato inválido');
            }

            // Buscar o contrato no banco de dados com relacionamentos
            const contrato = await this.uow.turmasAlunosTreinamentosContratosRP
                .createQueryBuilder('contrato')
                .leftJoinAndSelect('contrato.id_turma_aluno_treinamento_fk', 'turma_aluno_treinamento')
                .leftJoinAndSelect('turma_aluno_treinamento.id_turma_aluno_fk', 'turma_aluno')
                .leftJoinAndSelect('turma_aluno.id_aluno_fk', 'aluno')
                .where('contrato.deletado_em IS NULL')
                .andWhere('contrato.id = :contratoId', { contratoId: contratoIdNumerico })
                .getOne();

            if (!contrato) {
                throw new NotFoundException('Contrato não encontrado');
            }

            this.logger.log(`contract.repo.delete | Contrato encontrado para exclusão id=${contrato.id}`);

            const dadosContrato = contrato.dados_contrato || {};
            const turmaAlunoComprador = contrato.id_turma_aluno_treinamento_fk?.id_turma_aluno_fk;
            const idTurmaAlunoComprador = turmaAlunoComprador?.id || null;
            const idAlunoComprador = turmaAlunoComprador?.id_aluno || dadosContrato?.aluno?.id || dadosContrato?.aluno?.id_aluno || null;

            this.logger.debug('contract.repo.delete | Exclusão por IDs mapeada');

            // IDs de matrícula em turma a remover (comprador + bônus da venda)
            const idsTurmasAlunosParaRemover = new Set<string>();
            const adicionarTurmaAlunoParaRemocao = (idTurmaAluno?: string | null) => {
                if (!idTurmaAluno) return;
                idsTurmasAlunosParaRemover.add(idTurmaAluno);
            };
            const podeRemoverTurmaAlunoSemAfetarOutrosContratos = async (idTurmaAluno: string) => {
                const treinamentosDaMatricula = await this.uow.turmasAlunosTreinamentosRP.find({
                    where: {
                        id_turma_aluno: idTurmaAluno,
                        deletado_em: null,
                    },
                    select: {
                        id: true,
                    },
                });

                const idsTreinamentosDaMatricula = treinamentosDaMatricula.map((item) => item.id);
                if (idsTreinamentosDaMatricula.length === 0) {
                    return true;
                }

                const outrosContratosAtivosVinculados = await this.uow.turmasAlunosTreinamentosContratosRP
                    .createQueryBuilder('contrato')
                    .where('contrato.deletado_em IS NULL')
                    .andWhere('contrato.id <> :idContratoAtual', { idContratoAtual: contrato.id })
                    .andWhere('contrato.id_turma_aluno_treinamento IN (:...idsTreinamentos)', {
                        idsTreinamentos: idsTreinamentosDaMatricula,
                    })
                    .getCount();

                return outrosContratosAtivosVinculados === 0;
            };

            // 1) Matrícula principal do aluno comprador na turma desta venda
            adicionarTurmaAlunoParaRemocao(idTurmaAlunoComprador);

            // 2) Matrículas bônus vinculadas ao comprador (sempre por IDs)
            if (idAlunoComprador) {
                const idsTurmasBonusRelacionadas = new Set<number>();

                if (idTurmaAlunoComprador) {
                    const vinculosBonus = await this.uow.turmasAlunosTreinamentosBonusRP.find({
                        where: {
                            id_turma_aluno: idTurmaAlunoComprador,
                            deletado_em: null,
                        },
                    });

                    vinculosBonus.forEach((vinculo) => {
                        const ganhadores = Array.isArray(vinculo.ganhadores_bonus) ? vinculo.ganhadores_bonus : [];
                        ganhadores.forEach((ganhador) => {
                            const idTurmaBonus = Number(ganhador.id_turma_gb);
                            if (Number.isInteger(idTurmaBonus)) {
                                idsTurmasBonusRelacionadas.add(idTurmaBonus);
                            }
                        });
                    });
                }

                const turmaBonusInfo = (dadosContrato?.bonus?.turma_bonus_info || dadosContrato?.turma_bonus_info) as
                    | { id?: unknown; id_turma?: unknown }
                    | undefined;
                const idTurmaBonusInfo = Number(turmaBonusInfo?.id_turma ?? turmaBonusInfo?.id);
                if (Number.isInteger(idTurmaBonusInfo)) {
                    idsTurmasBonusRelacionadas.add(idTurmaBonusInfo);
                }

                if (idsTurmasBonusRelacionadas.size > 0) {
                    const matriculasBonus = await this.uow.turmasAlunosRP.find({
                        where: {
                            id_aluno_bonus: idAlunoComprador,
                            origem_aluno: EOrigemAlunos.ALUNO_BONUS,
                            deletado_em: null,
                            id_turma: In(Array.from(idsTurmasBonusRelacionadas)),
                        },
                    });

                    for (const turmaAlunoBonus of matriculasBonus) {
                        adicionarTurmaAlunoParaRemocao(turmaAlunoBonus.id);
                    }

                    this.logger.debug(`contract.repo.delete | Matrículas bônus identificadas=${matriculasBonus.length}`);
                } else {
                    this.logger.debug('contract.repo.delete | Nenhuma turma bônus vinculada por ID encontrada para esta venda');
                }
            }

            // 3) Remover matrículas de turma (não remove cadastro base do aluno)
            const idsTurmasAlunosElegiveisParaRemocao = new Set<string>();
            for (const idTurmaAluno of idsTurmasAlunosParaRemover) {
                const podeRemover = await podeRemoverTurmaAlunoSemAfetarOutrosContratos(idTurmaAluno);
                if (podeRemover) {
                    idsTurmasAlunosElegiveisParaRemocao.add(idTurmaAluno);
                } else {
                    this.logger.debug(`contract.repo.delete | Matrícula preservada por contrato ativo idTurmaAluno=${idTurmaAluno}`);
                }
            }

            this.logger.log(`contract.repo.delete | Removendo matrículas elegíveis=${idsTurmasAlunosElegiveisParaRemocao.size}`);
            for (const idTurmaAluno of idsTurmasAlunosElegiveisParaRemocao) {
                try {
                    await this.turmasService.removeAlunoTurma(idTurmaAluno);
                    this.logger.debug(`contract.repo.delete | Aluno removido da turma idTurmaAluno=${idTurmaAluno}`);
                } catch (error) {
                    this.logger.warn(`contract.repo.delete | Erro ao remover aluno da turma idTurmaAluno=${idTurmaAluno}`);
                    // Continuar removendo os outros mesmo se um falhar
                }
            }

            // Remover documento da Zapsign se existir
            const documentIdZapSign = contrato.zapsign_document_id || contrato.dados_contrato?.zapsign_document_id;
            if (documentIdZapSign) {
                try {
                    await this.zapSignService.excluirDocumento(documentIdZapSign);
                    this.logger.debug(`zapsign.delete | Documento removido da Zapsign documentId=${documentIdZapSign}`);
                } catch (zapSignError) {
                    this.logger.warn('zapsign.delete | Erro ao remover documento da Zapsign');
                    // Continuar mesmo se falhar na Zapsign
                }
            }

            // 4) Fazer soft delete do contrato (por ID do contrato)
            await this.uow.turmasAlunosTreinamentosContratosRP.update(contrato.id, {
                deletado_em: new Date(),
                atualizado_por: userId,
            });

            this.logger.log('contract.repo.delete | Contrato e vínculos de turma removidos com sucesso');
            return { message: 'Contrato, matrícula da turma e bônus removidos com sucesso. Cadastro do aluno preservado.' };
        } catch (error) {
            this.logger.error('zapsign.delete | Erro ao excluir contrato', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException(`Erro ao excluir contrato: ${(error as Error).message}`);
        }
    }

    /**
     * Prepara dados para o template usando dados salvos no banco
     */
    private prepareTemplateDataFromSavedContract(contrato: any) {
        this.logger.debug('contract.template.prepare.saved | Preparando dados do contrato salvo para template');

        // Usar diretamente os dados salvos no banco
        return {
            aluno: contrato.aluno || {},
            treinamento: contrato.treinamento || {},
            pagamento: contrato.pagamento || {},
            formas_pagamento: contrato.formas_pagamento || [],
            valores_formas_pagamento: contrato.valores_formas_pagamento || {},
            bonus_selecionados: contrato.bonus_selecionados || [],
            valores_bonus: contrato.valores_bonus || {},
            compradores_adicionais: contrato.compradores_adicionais || [],
            campos_variaveis: contrato.campos_variaveis || {},
            testemunhas: contrato.testemunhas || {},
            observacoes: contrato.observacoes || '',
            clausulas: contrato.clausulas || '',
            assinatura_aluno_base64: contrato.assinatura_aluno_base64 || '',
            assinatura_testemunha_um_base64: contrato.assinatura_testemunha_um_base64 || '',
            assinatura_testemunha_dois_base64: contrato.assinatura_testemunha_dois_base64 || '',
        };
    }

    /**
     * Métodos auxiliares para processar dados salvos no banco
     */
    private getTreinamentoCidadeFromSaved(dadosContrato: any): string {
        return dadosContrato.campos_variaveis?.['Cidade do Treinamento'] || 'Americana/SP';
    }

    private getTreinamentoDataInicioFromSaved(dadosContrato: any): string {
        return dadosContrato.campos_variaveis?.['Data Prevista do Treinamento'] || '';
    }

    private getTreinamentoDataFimFromSaved(dadosContrato: any): string {
        return dadosContrato.campos_variaveis?.['Data Final do Treinamento'] || '';
    }

    private calculateContractPriceFromSaved(dadosContrato: any): string {
        if (!dadosContrato.formas_pagamento || !Array.isArray(dadosContrato.formas_pagamento)) {
            return 'R$ 0,00';
        }

        let total = 0;
        dadosContrato.formas_pagamento.forEach((pagamento: any) => {
            if (pagamento.valor) {
                total += pagamento.valor;
            }
        });

        return this.contractTemplateService.formatPrice(total);
    }

    private calculateRealPaidValueFromSaved(dadosContrato: any): string {
        return this.calculateContractPriceFromSaved(dadosContrato);
    }

    private getSelectedPaymentMethodFromSaved(dadosContrato: any): string {
        if (!dadosContrato.formas_pagamento || !Array.isArray(dadosContrato.formas_pagamento) || dadosContrato.formas_pagamento.length === 0) {
            return 'Não informado';
        }

        const primeiraForma = dadosContrato.formas_pagamento[0];
        const forma = this.getFormaPagamentoNome(primeiraForma.forma);
        const tipo = this.getTipoPagamentoNome(primeiraForma.tipo);

        if (primeiraForma.tipo === 'PARCELADO') {
            const numeroParcelas = dadosContrato.formas_pagamento.length;
            return `${forma} ${tipo} (${numeroParcelas} parcelas)`;
        }

        return `${forma} ${tipo}`;
    }

    /**
     * Gera detalhes de pagamento a partir de valores_formas_pagamento (fallback)
     */
    private generatePaymentDetailsFromValoresFormas(valoresFormas: any, camposVariaveis: any): string {
        this.logger.debug('contract.payment.details.saved | Gerando detalhes a partir de valores_formas_pagamento');

        const details: string[] = [];

        // Processar pagamentos à vista
        Object.keys(valoresFormas).forEach((key) => {
            if (key.includes('À Vista') && valoresFormas[key] && valoresFormas[key].valor) {
                const valor = this.contractTemplateService.formatPrice(valoresFormas[key].valor / 100);
                let formaNome = '';

                if (key.includes('Cartão de Crédito')) formaNome = 'Cartão de Crédito';
                else if (key.includes('Cartão de Débito')) formaNome = 'Cartão de Débito';
                else if (key.includes('PIX')) formaNome = 'PIX/Transferência';
                else if (key.includes('Espécie')) formaNome = 'Espécie';

                if (formaNome) {
                    details.push(`• ${valor} no ${formaNome} à vista`);
                }
            }
        });

        // Processar pagamentos parcelados
        Object.keys(valoresFormas).forEach((key) => {
            if (key.includes('Parcelado') && valoresFormas[key]) {
                let valor,
                    numeroParcelas,
                    valorParcela,
                    formaNome = '';

                // Processar Cartão de Crédito parcelado
                if (key.includes('Cartão de Crédito') && valoresFormas[key].valor) {
                    valor = this.contractTemplateService.formatPrice(valoresFormas[key].valor / 100);
                    numeroParcelas = valoresFormas[key].numero_parcelas || 1;
                    valorParcela = this.contractTemplateService.formatPrice(valoresFormas[key].valor / 100 / numeroParcelas);
                    formaNome = 'Cartão de Crédito';
                }
                // Processar Boleto parcelado
                else if (key.includes('Boleto') && valoresFormas[key].valor_parcelas) {
                    valor = this.contractTemplateService.formatPrice(valoresFormas[key].valor_parcelas / 100);
                    numeroParcelas = valoresFormas[key].numero_parcelas || 1;
                    valorParcela = this.contractTemplateService.formatPrice(valoresFormas[key].valor_parcelas / 100 / numeroParcelas);
                    formaNome = 'Boleto';
                }

                if (formaNome) {
                    let infoParcela = `• ${valor} no ${formaNome} em ${numeroParcelas}x de ${valorParcela}`;

                    // Adicionar informações específicas do boleto
                    if (key.includes('Boleto')) {
                        const diaVencimento = valoresFormas[key].melhor_dia_vencimento || camposVariaveis?.['Dia de Vencimento do Boleto'];
                        const dataPrimeiroBoleto = valoresFormas[key].data_primeiro_boleto || camposVariaveis?.['Data do Primeiro Boleto'];

                        if (diaVencimento) {
                            infoParcela += ` (vencimento dia ${diaVencimento})`;
                        }

                        if (dataPrimeiroBoleto) {
                            infoParcela += ` - 1° boleto: ${dataPrimeiroBoleto}`;
                        }
                    }

                    details.push(infoParcela);
                }
            }
        });

        this.logger.debug(`contract.payment.details.saved | Detalhes gerados=${details.length}`);
        return details.length > 0 ? details.join('\n') : '• Não informado';
    }

    private generatePaymentDetailsFromSaved(dadosContrato: any): string {
        this.logger.debug('contract.payment.details.saved | Gerando detalhes a partir de dados salvos');

        // Tentar acessar formas_pagamento de diferentes locais possíveis
        const formasPagamento = dadosContrato.formas_pagamento || dadosContrato.pagamento?.formas_pagamento || [];
        const valoresFormasPagamento = dadosContrato.valores_formas_pagamento || dadosContrato.pagamento?.valores_formas_pagamento || {};
        const camposVariaveis = dadosContrato.campos_variaveis || {};

        if (!formasPagamento || !Array.isArray(formasPagamento) || formasPagamento.length === 0) {
            this.logger.debug('contract.payment.details.saved | Nenhuma forma salva encontrada; usando fallback de valores_formas_pagamento');

            // Fallback: tentar usar valores_formas_pagamento se formas_pagamento não estiver disponível
            if (valoresFormasPagamento && typeof valoresFormasPagamento === 'object' && Object.keys(valoresFormasPagamento).length > 0) {
                return this.generatePaymentDetailsFromValoresFormas(valoresFormasPagamento, camposVariaveis);
            }

            this.logger.warn('contract.payment.details.saved | Nenhuma forma de pagamento encontrada nos dados salvos');
            return '• Não informado';
        }

        // Agrupar formas de pagamento por tipo e forma
        const groupedPayments: { [key: string]: { valor: number; count: number; tipo: string; forma: string } } = {};

        formasPagamento.forEach((pagamento: any) => {
            const key = `${pagamento.forma}_${pagamento.tipo}`;
            if (!groupedPayments[key]) {
                groupedPayments[key] = {
                    valor: 0,
                    count: 0,
                    tipo: pagamento.tipo,
                    forma: pagamento.forma,
                };
            }
            groupedPayments[key].valor += pagamento.valor;
            groupedPayments[key].count += 1;
        });

        // Gerar lista de detalhes
        const details: string[] = [];

        Object.values(groupedPayments).forEach((group) => {
            const valorFormatado = this.contractTemplateService.formatPrice(group.valor);
            const formaNome = this.getFormaPagamentoNome(group.forma);

            if (group.tipo === 'PARCELADO') {
                const valorParcela = this.contractTemplateService.formatPrice(group.valor / group.count);

                // Adicionar informações específicas do boleto
                if (group.forma === 'BOLETO') {
                    const diaVencimento = camposVariaveis?.['Dia de Vencimento do Boleto'];
                    const dataPrimeiroBoleto = camposVariaveis?.['Data do Primeiro Boleto'];

                    let infoBoleto = `• ${valorFormatado} no ${formaNome} em ${group.count}x de ${valorParcela}`;

                    if (diaVencimento) {
                        infoBoleto += ` (vencimento dia ${diaVencimento})`;
                    }

                    if (dataPrimeiroBoleto) {
                        infoBoleto += ` - 1° boleto: ${dataPrimeiroBoleto}`;
                    }

                    details.push(infoBoleto);
                } else {
                    details.push(`• ${valorFormatado} no ${formaNome} em ${group.count}x de ${valorParcela}`);
                }
            } else {
                details.push(`• ${valorFormatado} no ${formaNome}`);
            }
        });

        return details.join('<br>');
    }

    private shouldShowNaoAplicaFromSaved(dadosContrato: any): boolean {
        const bonusSelecionados = dadosContrato.bonus_selecionados || [];
        return bonusSelecionados.length === 0;
    }

    private isBonusSelectedFromSaved(dadosContrato: any, bonusTypes: string[]): boolean {
        const bonusSelecionados = dadosContrato.bonus_selecionados || [];
        return bonusTypes.some((bonusType) => bonusSelecionados.includes(bonusType));
    }

    private getIprDataFromSaved(dadosContrato: any): string {
        return dadosContrato.campos_variaveis?.['Data Prevista do Treinamento'] || '';
    }

    private getOutrosDescricaoFromSaved(dadosContrato: any): string {
        return dadosContrato.campos_variaveis?.['Descrição do Outro Bônus'] || '';
    }

    private isPaymentMethodSelectedFromSaved(dadosContrato: any, methodName: string): boolean {
        if (!dadosContrato.formas_pagamento || !Array.isArray(dadosContrato.formas_pagamento)) {
            return false;
        }

        const methodMapping: Record<string, { forma: string; tipo: string }> = {
            'À Vista - Cartão de Crédito': { forma: 'CARTAO_CREDITO', tipo: 'A_VISTA' },
            'À Vista - Cartão de Débito': { forma: 'CARTAO_DEBITO', tipo: 'A_VISTA' },
            'À Vista - PIX/Transferência': { forma: 'PIX', tipo: 'A_VISTA' },
            'À Vista - Espécie': { forma: 'ESPECIE', tipo: 'A_VISTA' },
            'Parcelado - Cartão de Crédito': { forma: 'CARTAO_CREDITO', tipo: 'PARCELADO' },
            'Parcelado - Boleto': { forma: 'BOLETO', tipo: 'PARCELADO' },
        };

        const methodConfig = methodMapping[methodName];
        if (methodConfig) {
            return dadosContrato.formas_pagamento.some((forma: any) => forma.forma === methodConfig.forma && forma.tipo === methodConfig.tipo);
        }

        return false;
    }

    /**
     * Salva a assinatura/anexo de um contrato.
     *
     * Para o contrato escrito à mão (fluxo "Anexar contrato escrito à mão"), o
     * campo `documentPhoto` recebe a(s) foto(s) OU o PDF do contrato em base64
     * (data URL). Quando há mais de um arquivo, o frontend envia um JSON com o
     * array de data URLs. Tudo é persistido em `foto_documento_aluno_base64`.
     *
     * O `contratoId` pode ser o id numérico do registro (tela de gerenciamento)
     * ou o token do documento no ZapSign (fluxo de vendas), por isso buscamos
     * por ambos.
     */
    async salvarAssinatura(signatureData: {
        contratoId: string;
        signer: 'aluno' | 'testemunha1' | 'testemunha2';
        signatureType?: 'escrita' | 'nome' | null;
        signatureData?: string | null;
        signatureName?: string | null;
        documentPhoto?: string | null;
        signedAt?: string | null;
    }): Promise<{ message: string; success: boolean }> {
        const { contratoId, signer } = signatureData;

        if (!contratoId || !signer) {
            throw new BadRequestException('contratoId e signer são obrigatórios para salvar a assinatura');
        }

        let contrato: TurmasAlunosTreinamentosContratos | null = null;

        // Quando o id é totalmente numérico tentamos pelo id do registro
        if (/^\d+$/.test(String(contratoId))) {
            contrato = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
                where: { id: String(contratoId), deletado_em: null },
            });
        }

        // Caso não encontre (ou seja um token), buscamos pelo zapsign_document_id
        if (!contrato) {
            contrato = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
                where: { zapsign_document_id: String(contratoId), deletado_em: null },
            });
        }

        if (!contrato) {
            throw new NotFoundException('Contrato não encontrado para salvar a assinatura');
        }

        const dataAssinatura = signatureData.signedAt ? new Date(signatureData.signedAt) : new Date();

        if (signer === 'aluno') {
            if (signatureData.signatureData) {
                contrato.assinatura_aluno_base64 = signatureData.signatureData;
            }
            if (signatureData.signatureType) {
                contrato.tipo_assinatura_aluno = signatureData.signatureType;
            }
            // Foto(s) ou PDF do contrato escrito à mão
            if (signatureData.documentPhoto) {
                contrato.foto_documento_aluno_base64 = signatureData.documentPhoto;
            }
            contrato.status_ass_aluno = EStatusAssinaturasContratos.ASSINADO;
            contrato.data_ass_aluno = dataAssinatura;
        } else if (signer === 'testemunha1') {
            if (signatureData.signatureData) {
                contrato.assinatura_testemunha_um_base64 = signatureData.signatureData;
            }
            if (signatureData.signatureType) {
                contrato.tipo_assinatura_testemunha_um = signatureData.signatureType;
            }
            contrato.status_ass_test_um = EStatusAssinaturasContratos.ASSINADO;
            contrato.data_ass_test_um = dataAssinatura;
        } else if (signer === 'testemunha2') {
            if (signatureData.signatureData) {
                contrato.assinatura_testemunha_dois_base64 = signatureData.signatureData;
            }
            if (signatureData.signatureType) {
                contrato.tipo_assinatura_testemunha_dois = signatureData.signatureType;
            }
            contrato.status_ass_test_dois = EStatusAssinaturasContratos.ASSINADO;
            contrato.data_ass_test_dois = dataAssinatura;
        }

        await this.uow.turmasAlunosTreinamentosContratosRP.save(contrato);

        this.logger.debug(
            `contract.signature.save | Assinatura salva | contratoId=${contrato.id} signer=${signer} hasDocument=${Boolean(signatureData.documentPhoto)}`,
        );

        return { message: 'Assinatura salva com sucesso', success: true };
    }

    async buscarContratoBasico(contratoId: string): Promise<any> {
        try {
            const contratoBasico = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
                where: {
                    id: contratoId,
                    deletado_em: null,
                },
            });

            return contratoBasico;
        } catch (error) {
            this.logger.error('contract.repo.get.basic | Erro ao buscar contrato básico', error instanceof Error ? error.stack : undefined);
            throw new Error('Erro ao buscar contrato básico');
        }
    }

    async buscarContratoCompleto(contratoId: string): Promise<any> {
        try {
            // Primeiro, vamos buscar o contrato básico
            const contratoBasico = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
                where: {
                    id: contratoId,
                    deletado_em: null,
                },
                relations: [
                    'id_turma_aluno_treinamento_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_aluno_fk',
                    'id_turma_aluno_treinamento_fk.id_treinamento_fk',
                    'id_documento_fk',
                ],
                select: {
                    id: true,
                    id_turma_aluno_treinamento: true,
                    id_documento: true,
                    status_ass_aluno: true,
                    data_ass_aluno: true,
                    testemunha_um: true,
                    status_ass_test_um: true,
                    data_ass_test_um: true,
                    testemunha_dois: true,
                    status_ass_test_dois: true,
                    data_ass_test_dois: true,
                    dados_contrato: true, // Garantir que o campo JSON seja carregado
                    comprovantes_pagamento: true, // Comprovante(s) vinculados ao contrato
                    zapsign_document_id: true, // ✅ Campo ZapSign adicionado
                    zapsign_signers_data: true, // ✅ Campo ZapSign adicionado
                    zapsign_document_status: true, // ✅ Campo ZapSign adicionado
                    assinatura_aluno_base64: true,
                    tipo_assinatura_aluno: true,
                    foto_documento_aluno_base64: true,
                    assinatura_testemunha_um_base64: true,
                    tipo_assinatura_testemunha_um: true,
                    assinatura_testemunha_dois_base64: true,
                    tipo_assinatura_testemunha_dois: true,
                    criado_em: true,
                    atualizado_em: true,
                    criado_por: true,
                    atualizado_por: true,
                    deletado_em: true,
                },
            });

            const contrato = contratoBasico;

            if (!contrato) {
                throw new NotFoundException('Contrato não encontrado');
            }

            // Mapear dados para o formato esperado pelo frontend
            const dadosContrato = contrato.dados_contrato || {};
            let turmaAlunoTreinamento = contrato.id_turma_aluno_treinamento_fk;
            let turmaAluno = turmaAlunoTreinamento?.id_turma_aluno_fk;
            const documento = contrato.id_documento_fk;

            if (!turmaAluno) {
                const fallbackAlunoId = Number(dadosContrato?.aluno?.id || 0);
                const fallbackTreinamentoId = Number(dadosContrato?.treinamento?.id || turmaAlunoTreinamento?.id_treinamento || 0);

                if (fallbackAlunoId && fallbackTreinamentoId) {
                    const turmaAlunoTreinamentoFallback = await this.uow.turmasAlunosTreinamentosRP
                        .createQueryBuilder('turma_aluno_treinamento')
                        .leftJoinAndSelect('turma_aluno_treinamento.id_turma_aluno_fk', 'turma_aluno')
                        .where('turma_aluno_treinamento.id_treinamento = :idTreinamento', {
                            idTreinamento: fallbackTreinamentoId,
                        })
                        .andWhere('turma_aluno.id_aluno = :idAluno', { idAluno: fallbackAlunoId })
                        .andWhere('turma_aluno_treinamento.deletado_em IS NULL')
                        .andWhere('turma_aluno.deletado_em IS NULL')
                        .orderBy('turma_aluno_treinamento.atualizado_em', 'DESC')
                        .addOrderBy('turma_aluno_treinamento.id', 'DESC')
                        .getOne();

                    if (turmaAlunoTreinamentoFallback?.id_turma_aluno_fk) {
                        turmaAlunoTreinamento = turmaAlunoTreinamentoFallback;
                        turmaAluno = turmaAlunoTreinamentoFallback.id_turma_aluno_fk;
                    }
                }

                if (!turmaAluno && fallbackAlunoId) {
                    const turmaAlunoDiretoFallback = await this.uow.turmasAlunosRP
                        .createQueryBuilder('turma_aluno')
                        .where('turma_aluno.id_aluno = :idAluno', {
                            idAluno: fallbackAlunoId,
                        })
                        .andWhere('turma_aluno.deletado_em IS NULL')
                        .orderBy(
                            `CASE
                                WHEN turma_aluno.pendencia_pagamento IS TRUE
                                  OR COALESCE(turma_aluno.quantidade_inscricoes, 1) > 1
                                  OR turma_aluno.comprovante_pagamento_base64 IS NOT NULL
                                THEN 0
                                ELSE 1
                              END`,
                            'ASC',
                        )
                        .addOrderBy('turma_aluno.atualizado_em', 'DESC')
                        .addOrderBy('turma_aluno.id', 'DESC')
                        .getOne();

                    if (turmaAlunoDiretoFallback) {
                        turmaAluno = turmaAlunoDiretoFallback;
                    }
                }
            }
            const aluno = turmaAluno?.id_aluno_fk;
            const polo = aluno?.id_polo_fk;
            // Buscar treinamento dos dados do contrato ou das relations
            const treinamento = dadosContrato.treinamento || turmaAlunoTreinamento?.id_treinamento_fk || null;
            const turmaAlunoDadosContrato = dadosContrato.turma_aluno || {};
            const pendenciaPagamento = turmaAluno?.pendencia_pagamento ?? turmaAlunoDadosContrato.pendencia_pagamento ?? false;
            const quantidadeInscricoes = turmaAluno?.quantidade_inscricoes ?? turmaAlunoDadosContrato.quantidade_inscricoes ?? 1;
            const contratoDuplo = quantidadeInscricoes > 1;
            const outrosClientes = turmaAluno?.outros_clientes ?? turmaAlunoDadosContrato.outros_clientes ?? [];
            // Comprovante(s) por VENDA: prioriza a coluna do contrato; cai para o
            // snapshot do contrato e, por último, para o turma_aluno legado.
            const comprovantesPagamento = this.resolverComprovantesDoContrato(contrato, turmaAlunoDadosContrato, turmaAluno);
            const comprovantePagamentoBase64 = this.serializarComprovantes(comprovantesPagamento);

            this.logger.debug(
                `contract.repo.get.full | Contrato mapeado contratoId=${contrato.id} alunoId=${String(aluno?.id || '')} treinamentoId=${String(
                    treinamento?.id || '',
                )}`,
            );

            const contratoMapeado = {
                id: contrato.id,
                status_ass_aluno: contrato.status_ass_aluno,
                status_ass_test_um: contrato.status_ass_test_um,
                status_ass_test_dois: contrato.status_ass_test_dois,
                data_ass_aluno: contrato.data_ass_aluno,
                data_ass_test_um: contrato.data_ass_test_um,
                data_ass_test_dois: contrato.data_ass_test_dois,
                criado_em: contrato.criado_em,
                atualizado_em: contrato.atualizado_em,
                // Campos para compatibilidade com frontend
                created_at: contrato.criado_em,
                updated_at: contrato.atualizado_em,
                zapsign_document_id: contrato.zapsign_document_id,
                zapsign_signers_data: contrato.zapsign_signers_data,
                zapsign_document_status: contrato.zapsign_document_status,
                // Contrato manuscrito anexado (foto(s) ou PDF) no fluxo de venda manual.
                foto_documento_aluno_base64: contrato.foto_documento_aluno_base64 ?? null,
                aluno_nome: aluno?.nome,
                treinamento_nome: treinamento?.treinamento,
                comprovantes_pagamento: comprovantesPagamento,
                turma_aluno: {
                    pendencia_pagamento: pendenciaPagamento,
                    quantidade_inscricoes: quantidadeInscricoes,
                    outros_clientes: outrosClientes,
                    contrato_duplo: contratoDuplo,
                    comprovante_pagamento_base64: comprovantePagamentoBase64,
                    comprovantes_pagamento: comprovantesPagamento,
                },
                dados_contrato: {
                    aluno: {
                        id: aluno?.id,
                        nome: aluno?.nome,
                        cpf: aluno?.cpf,
                        email: aluno?.email,
                        data_nascimento: aluno?.data_nascimento,
                        telefone_um: aluno?.telefone_um,
                        polo: {
                            id: polo?.id,
                            cidade: polo?.cidade,
                            estado: polo?.estado,
                        },
                        endereco: dadosContrato.aluno?.endereco || {
                            logradouro: aluno?.logradouro || '',
                            numero: aluno?.numero || '',
                            complemento: aluno?.complemento || '',
                            bairro: aluno?.bairro || '',
                            cidade: aluno?.cidade || '',
                            estado: aluno?.estado || '',
                            cep: aluno?.cep || '',
                        },
                    },
                    treinamento: {
                        id: treinamento?.id,
                        nome: treinamento?.treinamento,
                        sigla: treinamento?.sigla_treinamento,
                        preco: treinamento?.preco_treinamento,
                        url_logo_treinamento: treinamento?.url_logo_treinamento,
                    },
                    template: {
                        id: documento?.id,
                        nome: documento?.documento,
                        clausulas: documento?.clausulas,
                    },
                    pagamento: {
                        forma_pagamento: dadosContrato.pagamento?.forma_pagamento || dadosContrato.forma_pagamento || 'A_VISTA',
                        formas_pagamento: dadosContrato.pagamento?.formas_pagamento || dadosContrato.formas_pagamento || [],
                        valores_formas_pagamento: dadosContrato.pagamento?.valores_formas_pagamento || dadosContrato.valores_formas_pagamento || {},
                    },
                    // Garantir que os dados de pagamento estejam disponíveis no nível raiz também
                    forma_pagamento: dadosContrato.pagamento?.forma_pagamento || dadosContrato.forma_pagamento || 'A_VISTA',
                    formas_pagamento: dadosContrato.pagamento?.formas_pagamento || dadosContrato.formas_pagamento || [],
                    valores_formas_pagamento: dadosContrato.pagamento?.valores_formas_pagamento || dadosContrato.valores_formas_pagamento || {},
                    testemunhas: dadosContrato.testemunhas || {},
                    campos_variaveis: dadosContrato.campos_variaveis || {},
                    bonus_selecionados: dadosContrato.bonus_selecionados || [],
                    valores_bonus: dadosContrato.valores_bonus || {},
                    bonus: {
                        tipos_bonus: dadosContrato.bonus_selecionados || [],
                        valores_bonus: dadosContrato.valores_bonus || {},
                        turma_bonus_info: dadosContrato.turma_bonus_info || null,
                    },
                    observacoes: dadosContrato.observacoes || '',
                    data_inicio_treinamento: dadosContrato.data_inicio_treinamento,
                    data_final_treinamento: dadosContrato.data_final_treinamento,
                    cidade_treinamento: dadosContrato.cidade_treinamento,
                    comprovantes_pagamento: comprovantesPagamento,
                    turma_aluno: {
                        pendencia_pagamento: pendenciaPagamento,
                        quantidade_inscricoes: quantidadeInscricoes,
                        outros_clientes: outrosClientes,
                        contrato_duplo: contratoDuplo,
                        comprovante_pagamento_base64: comprovantePagamentoBase64,
                        comprovantes_pagamento: comprovantesPagamento,
                    },
                },
            };

            return contratoMapeado;
        } catch (error) {
            this.logger.error('contract.repo.get.full | Erro ao buscar contrato completo', error instanceof Error ? error.stack : undefined);
            throw new Error('Erro ao buscar contrato completo');
        }
    }

    private normalizarTexto(valor?: string | null): string {
        return String(valor || '')
            .trim()
            .toLowerCase();
    }

    private inferirCanalVendaServidor(
        treinamentoOrigem: string,
        turmaOrigem: string,
        camposVariaveis: Record<string, string>,
    ): 'MASTERCLASS' | 'EVENTOS' | 'TIME_VENDAS' {
        const texto = [
            treinamentoOrigem,
            turmaOrigem,
            camposVariaveis['Canal de Vendas'],
            camposVariaveis['Canal da Venda'],
            camposVariaveis['Origem da Venda'],
            camposVariaveis['Origem'],
            camposVariaveis['Observações'],
        ]
            .join(' ')
            .toLowerCase();

        if (texto.includes('masterclass')) return 'MASTERCLASS';
        if (texto.includes('time de vendas') || texto.includes('vendas iam')) {
            return 'TIME_VENDAS';
        }
        return 'EVENTOS';
    }

    private extrairTreinamentoOrigemServidor(contrato: any): string {
        const dadosContrato = contrato?.dados_contrato || {};
        const camposVariaveis = contrato?.dados_contrato?.campos_variaveis || {};
        return (
            (contrato?.fluxo_evento_origem_treinamento || '').trim() ||
            String(dadosContrato?.fluxo_evento_origem_treinamento || '').trim() ||
            camposVariaveis['Treinamento de Origem'] ||
            camposVariaveis['Treinamento Origem'] ||
            camposVariaveis['Treinamento de Entrada'] ||
            ''
        );
    }

    private extrairTurmaOrigemServidor(contrato: any): string {
        const dadosContrato = contrato?.dados_contrato || {};
        const camposVariaveis = contrato?.dados_contrato?.campos_variaveis || {};
        return (
            (contrato?.fluxo_evento_origem_turma || '').trim() ||
            String(dadosContrato?.fluxo_evento_origem_turma || '').trim() ||
            camposVariaveis['Turma de Origem'] ||
            camposVariaveis['Turma Origem'] ||
            ''
        );
    }

    private extrairTurmaDestinoServidor(contrato: any): string {
        const dadosContrato = contrato?.dados_contrato || {};
        const camposVariaveis = dadosContrato?.campos_variaveis || {};
        const turmaAluno = contrato?.id_turma_aluno_treinamento_fk?.id_turma_aluno_fk;
        const turmaDestinoRel = turmaAluno?.id_turma_fk;
        const treinamentoViaRelacao = String(turmaDestinoRel?.id_treinamento_fk?.treinamento || '').trim();
        const edicaoViaRelacao = String(turmaDestinoRel?.edicao_turma || '').trim();
        const turmaViaRelacao = treinamentoViaRelacao && edicaoViaRelacao ? `${treinamentoViaRelacao} - ${edicaoViaRelacao}` : treinamentoViaRelacao;
        return (
            (contrato?.fluxo_evento_destino_turma || '').trim() ||
            String(dadosContrato?.fluxo_evento_destino_turma || '').trim() ||
            camposVariaveis['Turma de Destino'] ||
            camposVariaveis['Turma Destino'] ||
            turmaViaRelacao ||
            ''
        );
    }

    private ehModoFiltroTurma(tipo?: string | null): boolean {
        return tipo === 'treinamento' || tipo === 'turma';
    }

    private turmaHistoricoOrigemElegivel(dataInicio?: Date | string | null): boolean {
        if (!dataInicio) return false;
        const inicio = dataInicio instanceof Date ? dataInicio : new Date(dataInicio);
        if (Number.isNaN(inicio.getTime())) return false;
        const hojeFim = new Date();
        hojeFim.setHours(23, 59, 59, 999);
        return inicio.getTime() <= hojeFim.getTime();
    }

    private formatarTurmaHistorico(treinamento?: string | null, edicao?: string | null): string {
        const nomeTreinamento = String(treinamento || '').trim();
        const edicaoTurma = String(edicao || '').trim();
        if (!nomeTreinamento) return '';
        return edicaoTurma ? `${nomeTreinamento} - ${edicaoTurma}` : nomeTreinamento;
    }

    private ordenarListaTurmasHistorico(turmas: Iterable<string>): string[] {
        const extrairPartesTurma = (valor: string): { treinamento: string; edicaoTexto: string; edicaoNumero: number } => {
            const partes = String(valor || '')
                .split(' - ')
                .map((parte) => parte.trim())
                .filter(Boolean);
            if (partes.length <= 1) {
                const texto = String(valor || '').trim();
                return {
                    treinamento: texto,
                    edicaoTexto: '',
                    edicaoNumero: Number.MAX_SAFE_INTEGER,
                };
            }
            const edicaoTexto = partes[partes.length - 1];
            const treinamento = partes.slice(0, -1).join(' - ');
            const numeroEdicao = edicaoTexto.match(/\d+/)?.[0];
            return {
                treinamento,
                edicaoTexto,
                edicaoNumero: numeroEdicao ? parseInt(numeroEdicao, 10) : Number.MAX_SAFE_INTEGER,
            };
        };

        return Array.from(turmas).sort((a, b) => {
            const turmaA = extrairPartesTurma(a);
            const turmaB = extrairPartesTurma(b);
            const comparacaoTreinamento = turmaA.treinamento.localeCompare(turmaB.treinamento, 'pt-BR', {
                sensitivity: 'base',
            });
            if (comparacaoTreinamento !== 0) return comparacaoTreinamento;
            if (turmaA.edicaoNumero !== turmaB.edicaoNumero) {
                return turmaA.edicaoNumero - turmaB.edicaoNumero;
            }
            const comparacaoEdicaoTexto = turmaA.edicaoTexto.localeCompare(turmaB.edicaoTexto, 'pt-BR', {
                sensitivity: 'base',
                numeric: true,
            });
            if (comparacaoEdicaoTexto !== 0) return comparacaoEdicaoTexto;
            return a.localeCompare(b, 'pt-BR');
        });
    }

    private statusContratoEhConcluido(status?: string | null): boolean {
        const s = this.normalizarTexto(status);
        return s === 'signed' || s === 'complete' || s === 'completed' || s === 'assinado';
    }

    private converterDataFiltroParaDate(valor?: string, fimDoDia: boolean = false): Date | null {
        const bruto = String(valor || '').trim();
        if (!bruto) return null;

        const contemHorario = /\d{2}:\d{2}/.test(bruto);
        const possuiTimezone = /([zZ]|[+-]\d{2}:\d{2})$/.test(bruto);
        const valorNormalizado = bruto.includes(' ') ? bruto.replace(' ', 'T') : bruto;
        const candidatoIso = possuiTimezone ? valorNormalizado : `${valorNormalizado}Z`;
        let data = new Date(candidatoIso);

        if (Number.isNaN(data.getTime())) {
            const somenteData = bruto.split(' ')[0]?.split('T')[0]?.trim();
            if (!somenteData) return null;
            data = new Date(`${somenteData}T${fimDoDia ? '23:59:59.999' : '00:00:00.000'}Z`);
            if (Number.isNaN(data.getTime())) return null;
            return data;
        }

        if (!contemHorario) {
            data = new Date(`${valorNormalizado}T${fimDoDia ? '23:59:59.999' : '00:00:00.000'}Z`);
        }

        return Number.isNaN(data.getTime()) ? null : data;
    }

    private montarChaveCacheOpcoesOrigem(filtros?: {
        data_inicio?: string;
        data_fim?: string;
        search?: string;
        canal_venda?: 'MASTERCLASS' | 'EVENTOS' | 'TIME_VENDAS';
        somente_com_pendencia?: boolean | string;
        status?: string;
        treinamento_origem?: string;
        tipo_filtro_busca?: 'periodo' | 'treinamento' | 'turma';
    }): string {
        return JSON.stringify({
            data_inicio: filtros?.data_inicio || '',
            data_fim: filtros?.data_fim || '',
            search: this.normalizarTexto(filtros?.search),
            canal_venda: filtros?.canal_venda || '',
            somente_com_pendencia: filtros?.somente_com_pendencia === true || filtros?.somente_com_pendencia === 'true' || filtros?.somente_com_pendencia === '1',
            status: this.normalizarTexto(filtros?.status),
            treinamento_origem: this.normalizarTexto(filtros?.treinamento_origem),
            tipo_filtro_busca: filtros?.tipo_filtro_busca || 'periodo',
        });
    }

    private lerCacheOpcoesOrigem(chave: string): {
        treinamentos_origem: string[];
        turmas_origem: string[];
        turmas_destino: string[];
        turmas_destino_por_origem: Record<string, string[]>;
    } | null {
        const registro = this.opcoesOrigemCache.get(chave);
        if (!registro) return null;

        if (Date.now() > registro.expiresAt) {
            this.opcoesOrigemCache.delete(chave);
            return null;
        }

        return registro.value;
    }

    private salvarCacheOpcoesOrigem(
        chave: string,
        valor: {
            treinamentos_origem: string[];
            turmas_origem: string[];
            turmas_destino: string[];
            turmas_destino_por_origem: Record<string, string[]>;
        },
    ): void {
        const agora = Date.now();
        this.opcoesOrigemCache.set(chave, {
            expiresAt: agora + this.opcoesOrigemCacheTtlMs,
            value: valor,
        });

        if (this.opcoesOrigemCache.size <= this.opcoesOrigemCacheMaxEntradas) {
            return;
        }

        for (const [cacheKey, cacheValue] of this.opcoesOrigemCache.entries()) {
            if (cacheValue.expiresAt <= agora) {
                this.opcoesOrigemCache.delete(cacheKey);
            }
        }

        if (this.opcoesOrigemCache.size <= this.opcoesOrigemCacheMaxEntradas) {
            return;
        }

        const excesso = this.opcoesOrigemCache.size - this.opcoesOrigemCacheMaxEntradas;
        let removidos = 0;
        for (const cacheKey of this.opcoesOrigemCache.keys()) {
            this.opcoesOrigemCache.delete(cacheKey);
            removidos += 1;
            if (removidos >= excesso) break;
        }
    }

    limparCachesHistorico(): {
        contratosBancoRemovidos: number;
        opcoesOrigemRemovidas: number;
    } {
        const contratosBancoRemovidos = this.contratosBancoCache.size;
        const opcoesOrigemRemovidas = this.opcoesOrigemCache.size;

        this.contratosBancoCache.clear();
        this.opcoesOrigemCache.clear();

        this.logger.log(`contract.cache.clear | contratosBanco=${contratosBancoRemovidos} opcoesOrigem=${opcoesOrigemRemovidas}`);

        return {
            contratosBancoRemovidos,
            opcoesOrigemRemovidas,
        };
    }

    async sincronizarBonusIprCamposContratoHistorico(
        contratoId: string,
        linhas: Array<{ id_turma: number; quantidade: number; edicao_turma?: string }>,
    ): Promise<{ atualizado: boolean }> {
        const contrato = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
            where: { id: contratoId, deletado_em: IsNull() },
        });
        if (!contrato) {
            throw new NotFoundException('Contrato não encontrado');
        }

        const dadosContrato = { ...(contrato.dados_contrato || {}) };
        const camposVariaveis = { ...(dadosContrato.campos_variaveis || {}) };
        const linhasValidas = linhas.filter((linha) => linha.id_turma > 0 && linha.quantidade > 0);
        const total = linhasValidas.reduce((acc, linha) => acc + linha.quantidade, 0);

        if (total <= 0) {
            delete camposVariaveis['Quantidade de Inscrições do Imersão Prosperar'];
            delete camposVariaveis['Quantidade de Inscricoes do Imersao Prosperar'];
            delete camposVariaveis['Turmas do Imersão Prosperar'];
            delete camposVariaveis['Turmas do Imersao Prosperar'];
            delete camposVariaveis['Turmas do IPR'];
        } else {
            camposVariaveis['Quantidade de Inscrições do Imersão Prosperar'] = String(total);
            const partes = linhasValidas.map(
                (linha, index) => `Turma ${index + 1}: ${String(linha.edicao_turma || '').trim()} (${linha.quantidade} inscrição(ões))`,
            );
            camposVariaveis['Turmas do Imersão Prosperar'] = partes.join('|');
        }

        dadosContrato.campos_variaveis = camposVariaveis;
        await this.uow.turmasAlunosTreinamentosContratosRP.update(contrato.id, {
            dados_contrato: dadosContrato,
        });
        this.contratosBancoCache.clear();

        return { atualizado: true };
    }

    // Persiste/edita somente a observação interna (uso do sistema) da venda na
    // coluna dados_contrato, sem tocar nas observações do contrato.
    async atualizarObservacoesSistemaContratoHistorico(contratoId: string, observacoes: string): Promise<{ atualizado: boolean }> {
        const contrato = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
            where: { id: contratoId, deletado_em: IsNull() },
        });
        if (!contrato) {
            throw new NotFoundException('Contrato não encontrado');
        }

        const dadosContrato = { ...(contrato.dados_contrato || {}) };
        const camposVariaveis = { ...(dadosContrato.campos_variaveis || {}) };
        const texto = (observacoes || '').trim();

        if (texto) {
            camposVariaveis['Observações Internas (uso do sistema)'] = texto;
        } else {
            delete camposVariaveis['Observações Internas (uso do sistema)'];
        }

        dadosContrato.campos_variaveis = camposVariaveis;
        await this.uow.turmasAlunosTreinamentosContratosRP.update(contrato.id, {
            dados_contrato: dadosContrato,
        });
        this.contratosBancoCache.clear();

        return { atualizado: true };
    }

    // Atualiza os comprovantes de pagamento VINCULADOS À VENDA (contrato), sem
    // tocar no turma_aluno compartilhado — evitando sobrescrever o comprovante de
    // outras vendas do mesmo aluno na mesma turma de origem.
    async atualizarComprovantesContratoHistorico(contratoId: string, comprovantes: string[] | string | null): Promise<{ atualizado: boolean; total: number }> {
        const contrato = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
            where: { id: contratoId, deletado_em: IsNull() },
        });
        if (!contrato) {
            throw new NotFoundException('Contrato não encontrado');
        }

        const comprovantesArray = this.normalizarComprovantesParaArray(comprovantes);

        const dadosContrato = { ...(contrato.dados_contrato || {}) };
        const turmaAlunoSnapshot = { ...(dadosContrato.turma_aluno || {}) };
        turmaAlunoSnapshot.comprovantes_pagamento = comprovantesArray;
        turmaAlunoSnapshot.comprovante_pagamento_base64 = this.serializarComprovantes(comprovantesArray);
        dadosContrato.turma_aluno = turmaAlunoSnapshot;

        await this.uow.turmasAlunosTreinamentosContratosRP.update(contrato.id, {
            comprovantes_pagamento: comprovantesArray.length > 0 ? comprovantesArray : null,
            dados_contrato: dadosContrato,
        });
        this.contratosBancoCache.clear();

        return { atualizado: true, total: comprovantesArray.length };
    }

    private async obterMarcadorAtualizacaoHistorico(): Promise<string> {
        const [contratoRaw, turmaAlunoRaw] = await Promise.all([
            this.uow.turmasAlunosTreinamentosContratosRP
                .createQueryBuilder('contrato')
                .select('COALESCE(MAX(contrato.atualizado_em), MAX(contrato.criado_em), NOW())', 'max_atualizacao')
                .where('contrato.deletado_em IS NULL')
                .getRawOne<{ max_atualizacao?: string | Date }>(),
            this.uow.turmasAlunosRP
                .createQueryBuilder('turma_aluno')
                .select('COALESCE(MAX(turma_aluno.atualizado_em), MAX(turma_aluno.criado_em), NOW())', 'max_atualizacao')
                .where('turma_aluno.deletado_em IS NULL')
                .getRawOne<{ max_atualizacao?: string | Date }>(),
        ]);

        const marcadorContrato = contratoRaw?.max_atualizacao ? new Date(contratoRaw.max_atualizacao).toISOString() : '0';
        const marcadorTurmaAluno = turmaAlunoRaw?.max_atualizacao ? new Date(turmaAlunoRaw.max_atualizacao).toISOString() : '0';

        return `${marcadorContrato}|${marcadorTurmaAluno}`;
    }

    async listarOpcoesFiltrosOrigem(filtros?: {
        data_inicio?: string;
        data_fim?: string;
        search?: string;
        canal_venda?: 'MASTERCLASS' | 'EVENTOS' | 'TIME_VENDAS';
        somente_com_pendencia?: boolean | string;
        status?: string;
        treinamento_origem?: string;
        tipo_filtro_busca?: 'periodo' | 'treinamento' | 'turma';
    }): Promise<{
        treinamentos_origem: string[];
        turmas_origem: string[];
        turmas_destino: string[];
        turmas_destino_por_origem: Record<string, string[]>;
    }> {
        const cacheKey = this.montarChaveCacheOpcoesOrigem(filtros);
        const cacheHit = this.lerCacheOpcoesOrigem(cacheKey);
        if (cacheHit) {
            return cacheHit;
        }

        const filtroTurmaAtivo = this.ehModoFiltroTurma(filtros?.tipo_filtro_busca);
        const aplicarFiltroPeriodo = !filtroTurmaAtivo || Boolean(filtros?.data_inicio) || Boolean(filtros?.data_fim);
        const dataInicioPadrao = (() => {
            const d = new Date();
            d.setDate(d.getDate() - 30);
            d.setHours(0, 0, 0, 0);
            return d;
        })();
        const dataFimPadrao = (() => {
            const d = new Date();
            d.setHours(23, 59, 59, 999);
            return d;
        })();
        const dataInicioPeriodo = this.converterDataFiltroParaDate(filtros?.data_inicio, false) || dataInicioPadrao;
        const dataFimPeriodo = this.converterDataFiltroParaDate(filtros?.data_fim, true) || dataFimPadrao;

        // Consulta enxuta via QueryBuilder: seleciona apenas as colunas usadas
        // para montar as opções de filtro. O `find` com relações carregava a
        // entidade completa do contrato (colunas TEXT pesadas como
        // assinatura/foto base64) e do aluno (url_foto), o que estourava o
        // timeout do frontend — especialmente no modo "turma" (sem período),
        // que percorre TODOS os contratos.
        const contratosQuery = this.uow.turmasAlunosTreinamentosContratosRP
            .createQueryBuilder('contrato')
            .leftJoin('contrato.id_turma_aluno_treinamento_fk', 'tat')
            .leftJoin('tat.id_turma_aluno_fk', 'turma_aluno')
            .leftJoin('turma_aluno.id_aluno_fk', 'aluno')
            .leftJoin('turma_aluno.id_turma_fk', 'turma_destino')
            .leftJoin('turma_destino.id_treinamento_fk', 'treinamento_destino')
            .select([
                'contrato.id',
                'contrato.dados_contrato',
                'contrato.zapsign_document_status',
                'contrato.criado_em',
                'tat.id',
                'tat.id_turma_destino',
                'turma_aluno.id',
                'turma_aluno.id_turma',
                'turma_aluno.pendencia_pagamento',
                'aluno.id',
                'aluno.nome',
                'aluno.email',
                'turma_destino.id',
                'turma_destino.edicao_turma',
                'treinamento_destino.id',
                'treinamento_destino.treinamento',
            ])
            .where('contrato.deletado_em IS NULL')
            .orderBy('contrato.criado_em', 'DESC');

        if (aplicarFiltroPeriodo) {
            contratosQuery.andWhere('contrato.criado_em BETWEEN :dataInicioPeriodo AND :dataFimPeriodo', {
                dataInicioPeriodo,
                dataFimPeriodo,
            });
        }

        const contratos = await contratosQuery.getMany();

        const termoBusca = this.normalizarTexto(filtros?.search);
        const treinamentoOrigemSelecionado = this.normalizarTexto(filtros?.treinamento_origem);
        const canalVendaFiltro = filtros?.canal_venda || '';
        const somentePendenciaAtivo = filtros?.somente_com_pendencia === true || filtros?.somente_com_pendencia === 'true' || filtros?.somente_com_pendencia === '1';
        const statusFiltro = this.normalizarTexto(filtros?.status);
        const normalizarComparacao = (valor?: string | null): string =>
            String(valor || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim();
        const termosTurmaInvalidos = ['cancelad', 'inadimplente', 'sem turma'];
        const turmaEhInvalida = (turma?: string | null): boolean => {
            const nome = normalizarComparacao(turma);
            return !nome || termosTurmaInvalidos.some((termo) => nome.includes(termo));
        };
        const idsTurmaOrigemViaDadosContrato = Array.from(
            new Set(
                contratos
                    .map((contrato) => {
                        const dadosContrato = (contrato as any)?.dados_contrato || {};
                        return Number(dadosContrato?.fluxo_evento_origem_id_turma || dadosContrato?.id_turma_origem || dadosContrato?.turma_origem?.id || 0);
                    })
                    .filter((id) => Number.isFinite(id) && id > 0),
            ),
        );
        const turmasOrigemPorId = new Map<
            number,
            {
                treinamento: string;
                turma: string;
                data_inicio: Date | string | null;
            }
        >();
        if (idsTurmaOrigemViaDadosContrato.length > 0) {
            const turmasOrigemViaDadosContrato = await this.uow.turmasRP.find({
                where: {
                    id: In(idsTurmaOrigemViaDadosContrato),
                    deletado_em: IsNull(),
                },
                relations: ['id_treinamento_fk'],
            });
            turmasOrigemViaDadosContrato.forEach((turma) => {
                const treinamento = String(turma?.id_treinamento_fk?.treinamento || '').trim();
                const edicao = String(turma?.edicao_turma || '').trim();
                const turmaFormatada = this.formatarTurmaHistorico(treinamento, edicao);
                turmasOrigemPorId.set(turma.id, {
                    treinamento,
                    turma: turmaFormatada,
                    data_inicio: turma?.data_inicio ?? null,
                });
            });
        }

        const idsTurmaDestinoViaDadosContrato = Array.from(
            new Set(
                contratos
                    .map((contrato) => {
                        const dadosContrato = (contrato as any)?.dados_contrato || {};
                        const turmaAluno = (contrato as any)?.id_turma_aluno_treinamento_fk?.id_turma_aluno_fk;
                        const idViaRelacao = Number(turmaAluno?.id_turma_fk?.id || turmaAluno?.id_turma || 0);
                        const idViaTat = Number((contrato as any)?.id_turma_aluno_treinamento_fk?.id_turma_destino || 0);
                        const idViaDados = Number(dadosContrato?.fluxo_evento_destino_id_turma || dadosContrato?.id_turma_destino || dadosContrato?.turma?.id || 0);
                        return idViaDados || idViaTat || idViaRelacao;
                    })
                    .filter((id) => Number.isFinite(id) && id > 0),
            ),
        );
        const turmasDestinoPorId = new Map<
            number,
            {
                treinamento: string;
                turma: string;
            }
        >();
        if (idsTurmaDestinoViaDadosContrato.length > 0) {
            const turmasDestinoViaDadosContrato = await this.uow.turmasRP.find({
                where: {
                    id: In(idsTurmaDestinoViaDadosContrato),
                    deletado_em: IsNull(),
                },
                relations: ['id_treinamento_fk'],
            });
            turmasDestinoViaDadosContrato.forEach((turma) => {
                const treinamento = String(turma?.id_treinamento_fk?.treinamento || '').trim();
                const edicao = String(turma?.edicao_turma || '').trim();
                turmasDestinoPorId.set(turma.id, {
                    treinamento,
                    turma: this.formatarTurmaHistorico(treinamento, edicao),
                });
            });
        }

        const turmasCadastradas = await this.uow.turmasRP.find({
            where: {
                deletado_em: IsNull(),
            },
            relations: ['id_treinamento_fk'],
        });
        const turmasOrigemElegiveisPorNome = new Map<string, string>();
        turmasCadastradas.forEach((turma) => {
            const nomeTreinamento = String(turma?.id_treinamento_fk?.treinamento || '').trim();
            const edicao = String(turma?.edicao_turma || '').trim();
            const turmaFormatada = this.formatarTurmaHistorico(nomeTreinamento, edicao);
            if (!turmaFormatada || turmaEhInvalida(turmaFormatada)) return;
            if (!this.turmaHistoricoOrigemElegivel(turma?.data_inicio)) return;
            if (treinamentoOrigemSelecionado && this.normalizarTexto(nomeTreinamento) !== treinamentoOrigemSelecionado) return;
            turmasOrigemElegiveisPorNome.set(this.normalizarTexto(turmaFormatada), turmaFormatada);
        });

        const treinamentos = new Set<string>();
        const turmasOrigem = new Set<string>();
        const turmasDestino = new Set<string>();
        // Mapa origem -> destinos com vendas: usado para filtrar as turmas de
        // destino conforme a(s) turma(s) de origem selecionada(s) no frontend.
        const turmasDestinoPorOrigem = new Map<string, Set<string>>();

        contratos.forEach((contrato) => {
            const contratoAny = contrato as any;
            const turmaAluno = contratoAny?.id_turma_aluno_treinamento_fk?.id_turma_aluno_fk;
            const alunoRelacao = turmaAluno?.id_aluno_fk;
            const dadosContrato = contratoAny?.dados_contrato || {};
            const camposVariaveis = dadosContrato?.campos_variaveis || {};
            const idTurmaOrigemViaDadosContrato =
                Number(dadosContrato?.fluxo_evento_origem_id_turma || dadosContrato?.id_turma_origem || dadosContrato?.turma_origem?.id || 0) || 0;
            const fallbackOrigemViaId = turmasOrigemPorId.get(idTurmaOrigemViaDadosContrato);
            const treinamentoOrigem = String(this.extrairTreinamentoOrigemServidor(contratoAny) || fallbackOrigemViaId?.treinamento || '').trim();
            const turmaOrigem = String(this.extrairTurmaOrigemServidor(contratoAny) || fallbackOrigemViaId?.turma || '').trim();
            const idTurmaDestinoViaDadosContrato =
                Number(
                    dadosContrato?.fluxo_evento_destino_id_turma ||
                        dadosContrato?.id_turma_destino ||
                        dadosContrato?.turma?.id ||
                        turmaAluno?.id_turma_fk?.id ||
                        turmaAluno?.id_turma ||
                        contratoAny?.id_turma_aluno_treinamento_fk?.id_turma_destino ||
                        0,
                ) || 0;
            const fallbackDestinoViaId = turmasDestinoPorId.get(idTurmaDestinoViaDadosContrato);
            // A turma de destino é sempre listada como "Treinamento - Edição";
            // por isso a resolução pela turma (id -> treinamento + edição) tem
            // prioridade sobre os textos crus de campos_variaveis (que muitas
            // vezes guardam só o número da edição).
            const turmaDestino = String(fallbackDestinoViaId?.turma || this.extrairTurmaDestinoServidor(contratoAny) || '').trim();
            const nomeAluno = this.normalizarTexto(alunoRelacao?.nome || dadosContrato?.aluno?.nome);
            const emailAluno = this.normalizarTexto(alunoRelacao?.email || dadosContrato?.aluno?.email);
            const pendenciaPagamento = Boolean(turmaAluno?.pendencia_pagamento || dadosContrato?.turma_aluno?.pendencia_pagamento);
            const statusDocumento = contratoAny?.zapsign_document_status?.status || '';
            const concluido = this.statusContratoEhConcluido(statusDocumento);
            const canalVenda = this.inferirCanalVendaServidor(treinamentoOrigem, turmaOrigem, camposVariaveis);

            const matchBusca = !termoBusca || nomeAluno.includes(termoBusca) || emailAluno.includes(termoBusca);
            const matchCanal = !canalVendaFiltro || canalVenda === canalVendaFiltro;
            const matchPendencia = !somentePendenciaAtivo || pendenciaPagamento;
            const matchStatus = !statusFiltro || statusFiltro === 'all' || (statusFiltro === 'completed' ? concluido : !concluido);
            if (!(matchBusca && matchCanal && matchPendencia && matchStatus)) {
                return;
            }

            if (treinamentoOrigem) {
                treinamentos.add(treinamentoOrigem);
            }

            const origemElegivelPorId = idTurmaOrigemViaDadosContrato > 0 ? this.turmaHistoricoOrigemElegivel(fallbackOrigemViaId?.data_inicio ?? null) : false;
            const origemElegivelPorNome = turmasOrigemElegiveisPorNome.has(this.normalizarTexto(turmaOrigem));
            if (
                turmaOrigem &&
                !turmaEhInvalida(turmaOrigem) &&
                (origemElegivelPorId || origemElegivelPorNome) &&
                (!treinamentoOrigemSelecionado || this.normalizarTexto(treinamentoOrigem) === treinamentoOrigemSelecionado)
            ) {
                turmasOrigem.add(turmaOrigem);
            }

            if (turmaDestino && !turmaEhInvalida(turmaDestino)) {
                turmasDestino.add(turmaDestino);

                if (turmaOrigem && !turmaEhInvalida(turmaOrigem)) {
                    const destinosDaOrigem = turmasDestinoPorOrigem.get(turmaOrigem) ?? new Set<string>();
                    destinosDaOrigem.add(turmaDestino);
                    turmasDestinoPorOrigem.set(turmaOrigem, destinosDaOrigem);
                }
            }
        });

        turmasOrigemElegiveisPorNome.forEach((turmaFormatada) => {
            turmasOrigem.add(turmaFormatada);
            const [treinamento] = turmaFormatada.split(' - ');
            if (treinamento) {
                treinamentos.add(treinamento.trim());
            }
        });

        const treinamentosOrdenados = Array.from(treinamentos).sort((a, b) => a.localeCompare(b, 'pt-BR'));
        const turmasOrigemOrdenadas = this.ordenarListaTurmasHistorico(turmasOrigem);
        const turmasDestinoOrdenadas = this.ordenarListaTurmasHistorico(turmasDestino);
        const turmasDestinoPorOrigemOrdenadas: Record<string, string[]> = {};
        turmasDestinoPorOrigem.forEach((destinos, origem) => {
            turmasDestinoPorOrigemOrdenadas[origem] = this.ordenarListaTurmasHistorico(destinos);
        });

        const resultado = {
            treinamentos_origem: treinamentosOrdenados,
            turmas_origem: turmasOrigemOrdenadas,
            turmas_destino: turmasDestinoOrdenadas,
            turmas_destino_por_origem: turmasDestinoPorOrigemOrdenadas,
        };
        this.salvarCacheOpcoesOrigem(cacheKey, resultado);

        return resultado;
    }

    private parseJsonSeguroHistorico(valor: unknown): Record<string, any> {
        if (!valor) return {};
        if (typeof valor === 'object') return valor as Record<string, any>;
        if (typeof valor !== 'string') return {};
        try {
            const parsed = JSON.parse(valor);
            return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : {};
        } catch {
            return {};
        }
    }

    private obterQuantidadeInscricoesVendidasResumo(contratoMapeado: {
        turma_aluno?: { quantidade_inscricoes?: number; outros_clientes?: unknown[] };
        dados_contrato?: Record<string, any>;
    }): number {
        const dadosContrato = contratoMapeado?.dados_contrato || {};
        const camposVariaveis = dadosContrato?.campos_variaveis || {};
        const turmaAluno = contratoMapeado?.turma_aluno || dadosContrato?.turma_aluno || {};
        const quantidadeViaTurmaAluno = Number(turmaAluno?.quantidade_inscricoes ?? 0);
        const quantidadeViaCampos = Number.parseInt(String(camposVariaveis['Quantidade de Inscrições'] || camposVariaveis['Quantidade de Inscricoes'] || ''), 10);
        const outrosClientes = Array.isArray(turmaAluno?.outros_clientes) ? turmaAluno.outros_clientes : [];
        const quantidadeViaOutrosClientes = outrosClientes.length + 1;

        return Math.max(
            1,
            Number.isFinite(quantidadeViaTurmaAluno) && quantidadeViaTurmaAluno > 0 ? quantidadeViaTurmaAluno : 0,
            Number.isFinite(quantidadeViaCampos) && quantidadeViaCampos > 0 ? quantidadeViaCampos : 0,
            quantidadeViaOutrosClientes,
        );
    }

    private obterQuantidadeInscricoesBonusResumoHistorico(contratoMapeado: {
        turma_aluno?: { quantidade_inscricoes?: number };
        dados_contrato?: Record<string, any>;
    }): number {
        const camposVariaveis = contratoMapeado?.dados_contrato?.campos_variaveis || {};
        const valoresBonus = contratoMapeado?.dados_contrato?.bonus?.valores_bonus || {};
        const quantidadeInscricoes = this.obterQuantidadeInscricoesVendidasResumo(contratoMapeado);

        // Fonte primária (alinhada ao card de bônus do frontend): a quantidade vem
        // de "Quantidade de Inscrições do Imersão Prosperar"; com mais de uma turma
        // (campo costuma vir vazio) soma as quantidades de "Turmas do Imersão Prosperar".
        const descricaoTurmasIpr = String(
            camposVariaveis?.['Turmas do Imersão Prosperar'] || camposVariaveis?.['Turmas do Imersao Prosperar'] || camposVariaveis?.['Turmas do IPR'] || '',
        );
        const quantidadesPorTurmaIpr = descricaoTurmasIpr
            .split('|')
            .map((entrada) => entrada.trim())
            .filter(Boolean)
            .map((entrada) => {
                const parsed = Number.parseInt(entrada.match(/(\d+)\s*inscri[cç][aã]o/i)?.[1] || '', 10);
                return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
            });
        const somaQuantidadesIpr = quantidadesPorTurmaIpr.reduce((acc, valor) => acc + valor, 0);
        const quantidadeViaCampoIpr = Number.parseInt(
            String(camposVariaveis?.['Quantidade de Inscrições do Imersão Prosperar'] || camposVariaveis?.['Quantidade de Inscricoes do Imersao Prosperar'] || ''),
            10,
        );
        const quantidadeIpr =
            quantidadesPorTurmaIpr.length > 1
                ? somaQuantidadesIpr
                : Number.isFinite(quantidadeViaCampoIpr) && quantidadeViaCampoIpr > 0
                  ? quantidadeViaCampoIpr
                  : somaQuantidadesIpr;
        if (quantidadeIpr > 0) {
            return quantidadeIpr;
        }

        const bonusMatriculasQuantidade = Number((contratoMapeado as { bonus_ipr_inscricoes_quantidade?: number }).bonus_ipr_inscricoes_quantidade || 0);
        if (bonusMatriculasQuantidade > 0) {
            return bonusMatriculasQuantidade;
        }

        const quantidadeBonusDiretaKeys = [
            'Quantidade de Inscrições Bônus',
            'Quantidade de Inscrições Bonus',
            'Quantidade Inscrições Bônus',
            'Quantidade Inscrições Bonus',
            'Quantidade de Bônus',
            'Quantidade de Bonus',
            'Quantidade Bônus',
            'Quantidade Bonus',
        ];
        const quantidadeBonusDireta = quantidadeBonusDiretaKeys.reduce((acc, key) => {
            if (acc > 0) return acc;
            const parsed = Number.parseInt(String(camposVariaveis?.[key] || ''), 10);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
        }, 0);
        if (quantidadeBonusDireta > 0) {
            return quantidadeBonusDireta;
        }

        const bonusPorInscricaoKeys = [
            'Bônus por Inscrição',
            'Bonus por Inscrição',
            'Bônus por Inscricao',
            'Bonus por Inscricao',
            'Quantidade de Bônus por Inscrição',
            'Quantidade de Bonus por Inscrição',
            'Quantidade de Bônus por Inscricao',
            'Quantidade de Bonus por Inscricao',
            'Ingressos Bônus por Inscrição',
            'Ingressos Bonus por Inscrição',
            'Ingressos Bônus por Inscricao',
            'Ingressos Bonus por Inscricao',
        ];
        const bonusPorInscricao = bonusPorInscricaoKeys.reduce((acc, key) => {
            if (acc > 0) return acc;
            const parsed = Number.parseInt(String(camposVariaveis?.[key] || ''), 10);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
        }, 0);
        if (bonusPorInscricao > 0) {
            return quantidadeInscricoes * bonusPorInscricao;
        }

        const quantidadeBonusViaValores = Object.keys(valoresBonus || {}).reduce((acc, key) => {
            if (acc > 0) return acc;
            const match = key.match(/B[oô]nus-(\d+)\s+Inscri[cç][aã]o/i);
            if (!match?.[1]) return 0;
            const parsed = Number.parseInt(match[1], 10);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
        }, 0);
        if (quantidadeBonusViaValores > 0) {
            return quantidadeBonusViaValores;
        }

        return 0;
    }

    private obterValorTotalVendaResumo(dadosContrato: Record<string, any>): number {
        const formasPagamento = Array.isArray(dadosContrato?.pagamento?.formas_pagamento)
            ? dadosContrato.pagamento.formas_pagamento
            : Array.isArray(dadosContrato?.formas_pagamento)
              ? dadosContrato.formas_pagamento
              : [];

        return formasPagamento.reduce((totalAtual: number, forma: any) => {
            const valor = typeof forma?.valor === 'number' ? forma.valor : Number.parseFloat(String(forma?.valor || 0));
            return totalAtual + (Number.isFinite(valor) ? valor : 0);
        }, 0);
    }

    private obterCriadoPorResumoHistorico(row: {
        dados_contrato: unknown;
        criado_por_contrato?: string | number | null;
        criado_por_tat?: string | number | null;
        criado_por_ta?: string | number | null;
    }): string {
        const dadosContrato = this.parseJsonSeguroHistorico(row.dados_contrato);
        const criadoPorConfronto = dadosContrato?.criado_por_confronto || {};
        const candidatos = [
            criadoPorConfronto?.consolidado,
            row.criado_por_contrato,
            dadosContrato?.criado_por,
            criadoPorConfronto?.contrato,
            row.criado_por_tat,
            criadoPorConfronto?.turma_aluno_treinamento,
            row.criado_por_ta,
            criadoPorConfronto?.turma_aluno,
        ];
        for (const candidato of candidatos) {
            const id = String(candidato ?? '').trim();
            if (id) return id;
        }
        return '';
    }

    private obterIdsTurmasResumoHistorico(row: { dados_contrato: unknown; id_turma?: string | number | null; id_turma_destino?: string | number | null }): number[] {
        const dadosContrato = this.parseJsonSeguroHistorico(row.dados_contrato);
        const candidatos = [
            row.id_turma,
            row.id_turma_destino,
            dadosContrato?.fluxo_evento_origem_id_turma,
            dadosContrato?.id_turma_origem,
            dadosContrato?.turma_origem?.id,
            dadosContrato?.fluxo_evento_destino_id_turma,
            dadosContrato?.turma?.id,
        ];
        return Array.from(new Set(candidatos.map((valor) => Number(valor)).filter((valor) => Number.isFinite(valor) && valor > 0)));
    }

    private async carregarLinhasHistoricoVendas(baseQb: ReturnType<typeof this.uow.turmasAlunosTreinamentosContratosRP.createQueryBuilder>): Promise<
        Array<{
            id: string;
            criado_em?: string | Date | null;
            dados_contrato: unknown;
            criado_por_contrato?: string | number | null;
            criado_por_tat?: string | number | null;
            criado_por_ta?: string | number | null;
            quantidade_inscricoes: string | number;
            outros_clientes: unknown;
            pendencia_pagamento: string | boolean;
            id_turma?: string | number | null;
            id_turma_destino?: string | number | null;
        }>
    > {
        const resumoRowsRaw = await baseQb
            .clone()
            .select('contrato.id', 'id')
            .addSelect('contrato.criado_em', 'criado_em')
            .addSelect('contrato.dados_contrato', 'dados_contrato')
            .addSelect('contrato.criado_por', 'criado_por_contrato')
            .addSelect('tat.criado_por', 'criado_por_tat')
            .addSelect('ta.criado_por', 'criado_por_ta')
            .addSelect('COALESCE(ta.quantidade_inscricoes, 1)', 'quantidade_inscricoes')
            .addSelect('ta.outros_clientes', 'outros_clientes')
            .addSelect('COALESCE(ta.pendencia_pagamento, false)', 'pendencia_pagamento')
            .addSelect('ta.id_turma', 'id_turma')
            .addSelect('tat.id_turma_destino', 'id_turma_destino')
            .distinct(true)
            .getRawMany();

        const resumoRowsMap = new Map<string, (typeof resumoRowsRaw)[number]>();
        resumoRowsRaw.forEach((row) => {
            const contratoId = String(row.id || '').trim();
            if (!contratoId) return;
            if (!resumoRowsMap.has(contratoId)) {
                resumoRowsMap.set(contratoId, row);
            }
        });
        return Array.from(resumoRowsMap.values());
    }

    private async montarMapasTimesHistorico(
        linhas: Array<{
            dados_contrato: unknown;
            id_turma?: string | number | null;
            id_turma_destino?: string | number | null;
        }>,
    ): Promise<{
        timesPorTurma: Map<number, Array<{ id: string; nome: string; liderId: string; membrosIds: string[] }>>;
        liderPorMembroGlobal: Map<string, string>;
    }> {
        const idsTurmas = Array.from(new Set(linhas.flatMap((row) => this.obterIdsTurmasResumoHistorico(row))));
        const timesPorTurma = new Map<number, Array<{ id: string; nome: string; liderId: string; membrosIds: string[] }>>();
        if (idsTurmas.length > 0) {
            const turmas = await this.uow.turmasRP.find({
                where: { id: In(idsTurmas), deletado_em: IsNull() },
                select: { id: true, times_equipes: true },
            });
            turmas.forEach((turma) => {
                const times = Array.isArray(turma.times_equipes) ? turma.times_equipes : [];
                timesPorTurma.set(
                    turma.id,
                    times.map((time) => ({
                        id: String(time.id || ''),
                        nome: String(time.nome || ''),
                        liderId: String(time.liderId || '').trim(),
                        membrosIds: Array.isArray(time.membrosIds) ? time.membrosIds.map((id) => String(id).trim()) : [],
                    })),
                );
            });
        }

        const liderPorMembroGlobal = new Map<string, string>();
        timesPorTurma.forEach((times) => {
            times.forEach((time) => {
                if (!time.liderId) return;
                liderPorMembroGlobal.set(time.liderId, time.liderId);
                time.membrosIds.forEach((membroId) => {
                    if (membroId) liderPorMembroGlobal.set(membroId, time.liderId);
                });
            });
        });

        return { timesPorTurma, liderPorMembroGlobal };
    }

    private resolverLiderIdLinhaHistorico(
        row: {
            dados_contrato: unknown;
            criado_por_contrato?: string | number | null;
            criado_por_tat?: string | number | null;
            criado_por_ta?: string | number | null;
            id_turma?: string | number | null;
            id_turma_destino?: string | number | null;
        },
        timesPorTurma: Map<number, Array<{ id: string; nome: string; liderId: string; membrosIds: string[] }>>,
        liderPorMembroGlobal: Map<string, string>,
    ): string {
        const vendedorId = this.obterCriadoPorResumoHistorico(row);
        if (!vendedorId) return '';
        const idsTurmaDaVenda = this.obterIdsTurmasResumoHistorico(row);
        const timesDaVenda = idsTurmaDaVenda.flatMap((idTurma) => timesPorTurma.get(idTurma) || []);
        const timeDoVendedor = timesDaVenda.find((time) => time.liderId === vendedorId || time.membrosIds.includes(vendedorId));
        return timeDoVendedor?.liderId || liderPorMembroGlobal.get(vendedorId) || '';
    }

    private async calcularResumoHistoricoVendas(
        baseQb: ReturnType<typeof this.uow.turmasAlunosTreinamentosContratosRP.createQueryBuilder>,
        options?: { staff_lider_id?: string },
    ): Promise<{
        total_inscricoes_vendidas: number;
        total_inscricoes_bonus: number;
        total_com_pendencia: number;
        receita_total: number;
        ranking_staff_lider: Array<{
            lider_id: string;
            lider_nome: string;
            total_inscricoes: number;
            total_vendas: number;
            times: string[];
            vendedores: Array<{
                id: string;
                nome: string;
                total_inscricoes: number;
                total_vendas: number;
            }>;
        }>;
        inscricoes_sem_lider: {
            total_inscricoes: number;
            total_vendas: number;
            vendedores: Array<{
                vendedor_id: string;
                vendedor_nome: string;
                total_inscricoes: number;
                total_vendas: number;
            }>;
        };
    }> {
        const resumoRows = await this.carregarLinhasHistoricoVendas(baseQb);
        const { timesPorTurma, liderPorMembroGlobal } = await this.montarMapasTimesHistorico(resumoRows);
        const staffLiderId = String(options?.staff_lider_id || '').trim();
        const linhasAtivas = staffLiderId
            ? resumoRows.filter((row) => this.resolverLiderIdLinhaHistorico(row, timesPorTurma, liderPorMembroGlobal) === staffLiderId)
            : resumoRows;

        const resumoBase = linhasAtivas.reduce(
            (acc, row) => {
                const dadosContrato = this.parseJsonSeguroHistorico(row.dados_contrato);
                const turmaAlunoDados = dadosContrato?.turma_aluno || {};
                const outrosClientesRaw = row.outros_clientes ?? turmaAlunoDados?.outros_clientes;
                const contratoMapeado = {
                    turma_aluno: {
                        quantidade_inscricoes: Number(row.quantidade_inscricoes || 1) || 1,
                        // OR com o snapshot em dados_contrato.turma_aluno: a matrícula
                        // vinculada (origem) costuma vir com pendência = false explícito.
                        pendencia_pagamento:
                            row.pendencia_pagamento === true ||
                            String(row.pendencia_pagamento).toLowerCase() === 'true' ||
                            Boolean((turmaAlunoDados as { pendencia_pagamento?: boolean })?.pendencia_pagamento),
                        outros_clientes: Array.isArray(outrosClientesRaw) ? outrosClientesRaw : [],
                    },
                    dados_contrato: dadosContrato,
                };
                const quantidadeInscricoes = this.obterQuantidadeInscricoesVendidasResumo(contratoMapeado);
                const pendenciaPagamento = Boolean(contratoMapeado.turma_aluno.pendencia_pagamento);
                const valorTotalVenda = this.obterValorTotalVendaResumo(dadosContrato);

                acc.total_inscricoes_vendidas += quantidadeInscricoes;
                acc.total_inscricoes_bonus += this.obterQuantidadeInscricoesBonusResumoHistorico(contratoMapeado);
                if (pendenciaPagamento) {
                    acc.total_com_pendencia += 1;
                }
                acc.receita_total += valorTotalVenda;
                return acc;
            },
            {
                total_inscricoes_vendidas: 0,
                total_inscricoes_bonus: 0,
                total_com_pendencia: 0,
                receita_total: 0,
            },
        );

        const idsUsuarios = Array.from(
            new Set(
                linhasAtivas
                    .flatMap((row) => {
                        const vendedorId = this.obterCriadoPorResumoHistorico(row);
                        const idsTurmaDaVenda = this.obterIdsTurmasResumoHistorico(row);
                        const lideres = idsTurmaDaVenda.flatMap((idTurma) => timesPorTurma.get(idTurma) || []).map((time) => time.liderId);
                        return [vendedorId, ...lideres].filter(Boolean);
                    })
                    .map((id) => Number(id))
                    .filter((id) => Number.isFinite(id) && id > 0),
            ),
        );
        const nomeUsuarioPorId = new Map<number, string>();
        if (idsUsuarios.length > 0) {
            const usuarios = await this.uow.usuariosRP.find({
                where: { id: In(idsUsuarios), deletado_em: IsNull() },
                select: { id: true, nome: true, primeiro_nome: true, sobrenome: true },
            });
            usuarios.forEach((usuario) => {
                const nomeCompleto = usuario.nome || `${usuario.primeiro_nome || ''} ${usuario.sobrenome || ''}`.trim() || `Usuário ${usuario.id}`;
                nomeUsuarioPorId.set(usuario.id, nomeCompleto);
            });
        }

        type TVendedorAgrupado = {
            id: string;
            nome: string;
            totalInscricoes: number;
            totalVendas: number;
        };
        type TLiderAgrupado = {
            liderId: string;
            liderNome: string;
            totalInscricoes: number;
            totalVendas: number;
            vendedores: Record<string, TVendedorAgrupado>;
            times: Set<string>;
        };

        const mapaLider = new Map<string, TLiderAgrupado>();
        const mapaSemLider = new Map<string, { vendedorNome: string; totalInscricoes: number; totalVendas: number }>();
        let totalInscricoesSemLider = 0;

        linhasAtivas.forEach((row) => {
            const vendedorId = this.obterCriadoPorResumoHistorico(row) || 'Não informado';
            const vendedorNome = nomeUsuarioPorId.get(Number(vendedorId)) || `ID ${vendedorId}`;
            const dadosContrato = this.parseJsonSeguroHistorico(row.dados_contrato);
            const contratoMapeado = {
                turma_aluno: {
                    quantidade_inscricoes: Number(row.quantidade_inscricoes || 1) || 1,
                    outros_clientes: Array.isArray(row.outros_clientes) ? row.outros_clientes : [],
                },
                dados_contrato: dadosContrato,
            };
            const inscricoesDaVenda = this.obterQuantidadeInscricoesVendidasResumo(contratoMapeado);
            const idsTurmaDaVenda = this.obterIdsTurmasResumoHistorico(row);
            const timesDaVenda = idsTurmaDaVenda.flatMap((idTurma) => timesPorTurma.get(idTurma) || []);
            const timeDoVendedor = timesDaVenda.find((time) => time.liderId === vendedorId || time.membrosIds.includes(vendedorId));
            const liderId = timeDoVendedor?.liderId || liderPorMembroGlobal.get(vendedorId) || '';

            if (!liderId) {
                totalInscricoesSemLider += inscricoesDaVenda;
                const atual = mapaSemLider.get(vendedorId) || {
                    vendedorNome,
                    totalInscricoes: 0,
                    totalVendas: 0,
                };
                atual.totalInscricoes += inscricoesDaVenda;
                atual.totalVendas += 1;
                mapaSemLider.set(vendedorId, atual);
                return;
            }

            const liderNome = nomeUsuarioPorId.get(Number(liderId)) || (liderId === vendedorId ? vendedorNome : `Líder ID ${liderId}`);
            const registroLider =
                mapaLider.get(liderId) ||
                ({
                    liderId,
                    liderNome,
                    totalInscricoes: 0,
                    totalVendas: 0,
                    vendedores: {},
                    times: new Set<string>(),
                } as TLiderAgrupado);

            registroLider.totalInscricoes += inscricoesDaVenda;
            registroLider.totalVendas += 1;
            if (timeDoVendedor?.nome) {
                registroLider.times.add(timeDoVendedor.nome);
            }

            const vendedorAtual =
                registroLider.vendedores[vendedorId] ||
                ({
                    id: vendedorId,
                    nome: vendedorNome,
                    totalInscricoes: 0,
                    totalVendas: 0,
                } as TVendedorAgrupado);
            vendedorAtual.totalInscricoes += inscricoesDaVenda;
            vendedorAtual.totalVendas += 1;
            registroLider.vendedores[vendedorId] = vendedorAtual;
            mapaLider.set(liderId, registroLider);
        });

        const rankingStaffLider = Array.from(mapaLider.values())
            .map((item) => ({
                lider_id: item.liderId,
                lider_nome: item.liderNome,
                total_inscricoes: item.totalInscricoes,
                total_vendas: item.totalVendas,
                times: Array.from(item.times),
                vendedores: Object.values(item.vendedores)
                    .map((vendedor) => ({
                        id: vendedor.id,
                        nome: vendedor.nome,
                        total_inscricoes: vendedor.totalInscricoes,
                        total_vendas: vendedor.totalVendas,
                    }))
                    .sort((a, b) => b.total_inscricoes - a.total_inscricoes || b.total_vendas - a.total_vendas || a.nome.localeCompare(b.nome, 'pt-BR')),
            }))
            .sort((a, b) => b.total_inscricoes - a.total_inscricoes || b.total_vendas - a.total_vendas || a.lider_nome.localeCompare(b.lider_nome, 'pt-BR'));

        const vendedoresSemLider = Array.from(mapaSemLider.entries())
            .map(([vendedorId, dados]) => ({
                vendedor_id: vendedorId,
                vendedor_nome: dados.vendedorNome,
                total_inscricoes: dados.totalInscricoes,
                total_vendas: dados.totalVendas,
            }))
            .sort((a, b) => b.total_inscricoes - a.total_inscricoes || b.total_vendas - a.total_vendas || a.vendedor_nome.localeCompare(b.vendedor_nome, 'pt-BR'));

        return {
            ...resumoBase,
            ranking_staff_lider: rankingStaffLider,
            inscricoes_sem_lider: {
                total_inscricoes: totalInscricoesSemLider,
                total_vendas: vendedoresSemLider.reduce((acc, item) => acc + item.total_vendas, 0),
                vendedores: vendedoresSemLider,
            },
        };
    }

    async listarContratosBanco(filtros?: {
        page?: number;
        limit?: number;
        id_aluno?: string;
        id_treinamento?: string;
        status?: string;
        data_inicio?: string;
        data_fim?: string;
        search?: string;
        canal_venda?: 'MASTERCLASS' | 'EVENTOS' | 'TIME_VENDAS';
        somente_com_pendencia?: boolean | string;
        tipo_filtro_busca?: 'periodo' | 'treinamento' | 'turma';
        treinamento_origem?: string;
        turma_origem?: string;
        turma_destino?: string;
        staff_lider_id?: string;
    }): Promise<{
        data: any[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    }> {
        try {
            const page = filtros?.page || 1;
            const limit = filtros?.limit || 10;
            const offset = (page - 1) * limit;
            const filtroTurmaSemPeriodo = this.ehModoFiltroTurma(filtros?.tipo_filtro_busca);
            // Quando há busca por nome/CPF, a pesquisa deve cobrir TODAS as datas
            // (retornando somente o aluno buscado), sem restringir ao período
            // padrão dos últimos dias. Datas explícitas do usuário ainda são
            // respeitadas.
            const buscaPorTextoAtiva = Boolean(this.normalizarTexto(filtros?.search));
            const temDatasExplicitas = Boolean(filtros?.data_inicio) || Boolean(filtros?.data_fim);
            const aplicarFiltroPeriodo =
                (!filtroTurmaSemPeriodo || temDatasExplicitas) && (!buscaPorTextoAtiva || temDatasExplicitas);
            const dataInicioPadrao = (() => {
                const d = new Date();
                d.setDate(d.getDate() - 30);
                d.setHours(0, 0, 0, 0);
                return d;
            })();
            const dataFimPadrao = (() => {
                const d = new Date();
                d.setHours(23, 59, 59, 999);
                return d;
            })();
            const dataInicioPeriodo = this.converterDataFiltroParaDate(filtros?.data_inicio, false) || dataInicioPadrao;
            const dataFimPeriodo = this.converterDataFiltroParaDate(filtros?.data_fim, true) || dataFimPadrao;
            const staffLiderId = String(filtros?.staff_lider_id || '').trim() || undefined;
            const marcadorAtualizacao = await this.obterMarcadorAtualizacaoHistorico();
            const chaveCache = JSON.stringify({
                page,
                limit,
                marcadorAtualizacao,
                id_aluno: filtros?.id_aluno || null,
                id_treinamento: filtros?.id_treinamento || null,
                status: filtros?.status || null,
                data_inicio: dataInicioPeriodo.toISOString(),
                data_fim: dataFimPeriodo.toISOString(),
                search: filtros?.search || null,
                canal_venda: filtros?.canal_venda || null,
                somente_com_pendencia: filtros?.somente_com_pendencia || null,
                tipo_filtro_busca: filtros?.tipo_filtro_busca || null,
                treinamento_origem: filtros?.treinamento_origem || null,
                turma_origem: filtros?.turma_origem || null,
                turma_destino: filtros?.turma_destino || null,
                staff_lider_id: staffLiderId || null,
            });
            const cacheExistente = this.contratosBancoCache.get(chaveCache);

            if (cacheExistente && cacheExistente.expiresAt > Date.now()) {
                return cacheExistente.value;
            }

            const termoBuscaFiltro = this.normalizarTexto(filtros?.search);
            const statusFiltro = this.normalizarTexto(filtros?.status);
            const treinamentoOrigemFiltro = this.normalizarTexto(filtros?.treinamento_origem);
            // Aceita múltiplas turmas separadas por "|" (multi-seleção no frontend).
            const turmasOrigemFiltro = String(filtros?.turma_origem || '')
                .split('|')
                .map((valor) => this.normalizarTexto(valor))
                .filter(Boolean);
            const turmasDestinoFiltro = String(filtros?.turma_destino || '')
                .split('|')
                .map((valor) => this.normalizarTexto(valor))
                .filter(Boolean);
            const filtroTurmaAtivo = this.ehModoFiltroTurma(filtros?.tipo_filtro_busca);
            const somentePendenciaAtivo =
                filtros?.somente_com_pendencia === true || filtros?.somente_com_pendencia === 'true' || filtros?.somente_com_pendencia === '1';
            const idTurmaOrigemDadosContratoSql = `NULLIF(COALESCE(
                contrato.dados_contrato->>'fluxo_evento_origem_id_turma',
                contrato.dados_contrato->>'id_turma_origem',
                contrato.dados_contrato->'turma_origem'->>'id',
                ''
            ), '')::int`;

            const treinamentoOrigemSql = `LOWER(TRIM(COALESCE(
                NULLIF(contrato.dados_contrato->>'fluxo_evento_origem_treinamento', ''),
                NULLIF(treinamento_origem_evento.treinamento, ''),
                NULLIF(contrato.dados_contrato->'campos_variaveis'->>'Treinamento de Origem', ''),
                NULLIF(contrato.dados_contrato->'campos_variaveis'->>'Treinamento Origem', ''),
                NULLIF(contrato.dados_contrato->'campos_variaveis'->>'Treinamento de Entrada', ''),
                ''
            )))`;
            const turmaOrigemSql = `LOWER(TRIM(COALESCE(
                NULLIF(contrato.dados_contrato->>'fluxo_evento_origem_turma', ''),
                NULLIF(contrato.dados_contrato->'campos_variaveis'->>'Turma de Origem', ''),
                NULLIF(contrato.dados_contrato->'campos_variaveis'->>'Turma Origem', ''),
                CASE
                    WHEN treinamento_origem_evento.treinamento IS NOT NULL AND turma_origem_evento.edicao_turma IS NOT NULL
                        THEN CONCAT(treinamento_origem_evento.treinamento, ' - ', turma_origem_evento.edicao_turma)
                    ELSE treinamento_origem_evento.treinamento
                END,
                ''
            )))`;
            const idTurmaDestinoDadosContratoSql = `NULLIF(COALESCE(
                contrato.dados_contrato->>'fluxo_evento_destino_id_turma',
                contrato.dados_contrato->>'id_turma_destino',
                contrato.dados_contrato->'turma'->>'id',
                tat.id_turma_destino::text,
                ta.id_turma::text,
                ''
            ), '')::int`;
            // A turma de destino é sempre normalizada como "Treinamento - Edição"
            // (resolvendo pela turma), com prioridade sobre os textos crus de
            // campos_variaveis. Mantém a lista de opções e o filtro consistentes.
            const turmaDestinoSql = `LOWER(TRIM(COALESCE(
                CASE
                    WHEN treinamento_destino_evento.treinamento IS NOT NULL AND turma_destino_evento.edicao_turma IS NOT NULL
                        THEN CONCAT(treinamento_destino_evento.treinamento, ' - ', turma_destino_evento.edicao_turma)
                    WHEN treinamento_destino_tat.treinamento IS NOT NULL AND turma_destino_tat.edicao_turma IS NOT NULL
                        THEN CONCAT(treinamento_destino_tat.treinamento, ' - ', turma_destino_tat.edicao_turma)
                    WHEN treinamento_destino.treinamento IS NOT NULL AND turma_destino.edicao_turma IS NOT NULL
                        THEN CONCAT(treinamento_destino.treinamento, ' - ', turma_destino.edicao_turma)
                    ELSE NULL
                END,
                NULLIF(contrato.dados_contrato->>'fluxo_evento_destino_turma', ''),
                NULLIF(contrato.dados_contrato->'campos_variaveis'->>'Turma de Destino', ''),
                NULLIF(contrato.dados_contrato->'campos_variaveis'->>'Turma Destino', ''),
                COALESCE(treinamento_destino_evento.treinamento, treinamento_destino_tat.treinamento, treinamento_destino.treinamento, ''),
                ''
            )))`;
            const canalTextoSql = `LOWER(CONCAT_WS(' ',
                ${treinamentoOrigemSql},
                ${turmaOrigemSql},
                COALESCE(contrato.dados_contrato->'campos_variaveis'->>'Canal de Vendas', ''),
                COALESCE(contrato.dados_contrato->'campos_variaveis'->>'Canal da Venda', ''),
                COALESCE(contrato.dados_contrato->'campos_variaveis'->>'Origem da Venda', ''),
                COALESCE(contrato.dados_contrato->'campos_variaveis'->>'Origem', ''),
                COALESCE(contrato.dados_contrato->'campos_variaveis'->>'Observações', '')
            ))`;
            const pendenciaJsonSql = `CASE
                WHEN contrato.dados_contrato->'turma_aluno'->>'pendencia_pagamento' IN ('true', 'false')
                    THEN (contrato.dados_contrato->'turma_aluno'->>'pendencia_pagamento')::boolean
                ELSE false
            END`;
            const statusDocumentoSql = `LOWER(COALESCE(contrato.zapsign_document_status->>'status', ''))`;
            const baseQb = this.uow.turmasAlunosTreinamentosContratosRP
                .createQueryBuilder('contrato')
                .leftJoin('contrato.id_turma_aluno_treinamento_fk', 'tat')
                .leftJoin('tat.id_turma_aluno_fk', 'ta')
                .leftJoin('ta.id_aluno_fk', 'aluno')
                .leftJoin('ta.id_turma_fk', 'turma_destino')
                .leftJoin('turma_destino.id_treinamento_fk', 'treinamento_destino')
                .leftJoin('tat.id_treinamento_fk', 'treinamento_tat')
                .leftJoin(Turmas, 'turma_origem_evento', `turma_origem_evento.id = ${idTurmaOrigemDadosContratoSql}`)
                .leftJoin('turma_origem_evento.id_treinamento_fk', 'treinamento_origem_evento')
                .leftJoin(Turmas, 'turma_destino_evento', `turma_destino_evento.id = ${idTurmaDestinoDadosContratoSql}`)
                .leftJoin('turma_destino_evento.id_treinamento_fk', 'treinamento_destino_evento')
                .leftJoin(Turmas, 'turma_destino_tat', 'turma_destino_tat.id = tat.id_turma_destino')
                .leftJoin('turma_destino_tat.id_treinamento_fk', 'treinamento_destino_tat')
                .where('contrato.deletado_em IS NULL');

            if (aplicarFiltroPeriodo) {
                baseQb.andWhere('contrato.criado_em BETWEEN :dataInicioPeriodo AND :dataFimPeriodo', {
                    dataInicioPeriodo,
                    dataFimPeriodo,
                });
            }

            if (filtros?.id_aluno) {
                const idAluno = Number(filtros.id_aluno);
                if (Number.isFinite(idAluno) && idAluno > 0) {
                    baseQb.andWhere('aluno.id = :idAluno', { idAluno });
                }
            }

            if (filtros?.id_treinamento) {
                const idTreinamento = Number(filtros.id_treinamento);
                if (Number.isFinite(idTreinamento) && idTreinamento > 0) {
                    baseQb.andWhere('(tat.id_treinamento = :idTreinamento OR turma_destino.id_treinamento = :idTreinamento)', {
                        idTreinamento,
                    });
                }
            }

            if (termoBuscaFiltro) {
                // Busca somente por NOME ou CPF (não varrer todo o JSON do
                // contrato, que causava resultados incorretos). O CPF é comparado
                // apenas pelos dígitos, ignorando pontuação em ambos os lados.
                const termoBuscaDigitos = termoBuscaFiltro.replace(/\D/g, '');
                const condicoesBusca = [
                    `LOWER(COALESCE(aluno.nome, '')) LIKE :termoBusca`,
                    `LOWER(COALESCE(contrato.dados_contrato->'aluno'->>'nome', '')) LIKE :termoBusca`,
                ];
                const parametrosBusca: Record<string, string> = {
                    termoBusca: `%${termoBuscaFiltro}%`,
                };
                if (termoBuscaDigitos.length >= 3) {
                    condicoesBusca.push(`REGEXP_REPLACE(COALESCE(aluno.cpf, ''), '[^0-9]', '', 'g') LIKE :termoBuscaCpf`);
                    condicoesBusca.push(`REGEXP_REPLACE(COALESCE(contrato.dados_contrato->'aluno'->>'cpf', ''), '[^0-9]', '', 'g') LIKE :termoBuscaCpf`);
                    parametrosBusca.termoBuscaCpf = `%${termoBuscaDigitos}%`;
                }
                baseQb.andWhere(`(${condicoesBusca.join(' OR ')})`, parametrosBusca);
            }

            if (somentePendenciaAtivo) {
                baseQb.andWhere(`(COALESCE(ta.pendencia_pagamento, false) = true OR ${pendenciaJsonSql} = true)`);
            }

            if (statusFiltro && statusFiltro !== 'all') {
                if (statusFiltro === 'completed') {
                    baseQb.andWhere(`${statusDocumentoSql} IN (:...statusConcluido)`, {
                        statusConcluido: ['signed', 'complete', 'completed', 'assinado'],
                    });
                } else {
                    baseQb.andWhere(`(${statusDocumentoSql} = '' OR ${statusDocumentoSql} NOT IN (:...statusConcluido))`, {
                        statusConcluido: ['signed', 'complete', 'completed', 'assinado'],
                    });
                }
            }

            if (filtroTurmaAtivo && treinamentoOrigemFiltro) {
                baseQb.andWhere(`${treinamentoOrigemSql} = :treinamentoOrigemFiltro`, {
                    treinamentoOrigemFiltro,
                });
            }

            if (filtroTurmaAtivo && turmasOrigemFiltro.length > 0) {
                baseQb.andWhere(`${turmaOrigemSql} IN (:...turmasOrigemFiltro)`, {
                    turmasOrigemFiltro,
                });
            }

            if (filtroTurmaAtivo && turmasDestinoFiltro.length > 0) {
                baseQb.andWhere(`${turmaDestinoSql} IN (:...turmasDestinoFiltro)`, {
                    turmasDestinoFiltro,
                });
            }

            if (filtros?.canal_venda === 'MASTERCLASS') {
                baseQb.andWhere(`${canalTextoSql} LIKE :canalMasterclass`, {
                    canalMasterclass: '%masterclass%',
                });
            } else if (filtros?.canal_venda === 'TIME_VENDAS') {
                baseQb.andWhere(`(${canalTextoSql} LIKE :canalTimeVendas OR ${canalTextoSql} LIKE :canalVendasIam)`, {
                    canalTimeVendas: '%time de vendas%',
                    canalVendasIam: '%vendas iam%',
                });
            } else if (filtros?.canal_venda === 'EVENTOS') {
                baseQb.andWhere(
                    `(${canalTextoSql} NOT LIKE :canalMasterclass AND ${canalTextoSql} NOT LIKE :canalTimeVendas AND ${canalTextoSql} NOT LIKE :canalVendasIam)`,
                    {
                        canalMasterclass: '%masterclass%',
                        canalTimeVendas: '%time de vendas%',
                        canalVendasIam: '%vendas iam%',
                    },
                );
            }

            let total: number;
            let totalPages: number;
            let idsPagina: string[];

            if (staffLiderId) {
                const linhasHistorico = await this.carregarLinhasHistoricoVendas(baseQb);
                const { timesPorTurma, liderPorMembroGlobal } = await this.montarMapasTimesHistorico(linhasHistorico);
                const idsOrdenados = linhasHistorico
                    .filter((row) => this.resolverLiderIdLinhaHistorico(row, timesPorTurma, liderPorMembroGlobal) === staffLiderId)
                    .sort((a, b) => new Date(String(b.criado_em || 0)).getTime() - new Date(String(a.criado_em || 0)).getTime())
                    .map((row) => String(row.id));
                total = idsOrdenados.length;
                totalPages = Math.max(1, Math.ceil(total / limit));
                idsPagina = idsOrdenados.slice(offset, offset + limit);
            } else {
                // Contagem por contrato distinto: os múltiplos LEFT JOINs (turma de
                // origem/destino, treinamentos, etc.) podem multiplicar as linhas e
                // inflar o getCount(), gerando páginas a mais. COUNT(DISTINCT) garante
                // o total real de vendas (alinhado ao resumo).
                const totalRow = await baseQb.clone().select('COUNT(DISTINCT contrato.id)', 'total').getRawOne<{ total: string | number }>();
                total = Number(totalRow?.total ?? 0);
                totalPages = Math.max(1, Math.ceil(total / limit));
                const idsPaginaRaw = await baseQb
                    .clone()
                    .select('contrato.id', 'id')
                    .addSelect('MAX(contrato.criado_em)', 'ordem_criado_em')
                    .groupBy('contrato.id')
                    .orderBy('MAX(contrato.criado_em)', 'DESC')
                    .offset(offset)
                    .limit(limit)
                    .getRawMany<{ id: string }>();
                idsPagina = idsPaginaRaw.map((item) => String(item.id));
            }

            const resumo = await this.calcularResumoHistoricoVendas(baseQb, { staff_lider_id: staffLiderId });

            if (idsPagina.length === 0) {
                const resultadoVazio = {
                    data: [],
                    total,
                    page,
                    limit,
                    totalPages,
                    resumo,
                };
                this.contratosBancoCache.set(chaveCache, {
                    expiresAt: Date.now() + this.contratosBancoCacheTtlMs,
                    value: resultadoVazio,
                });
                return resultadoVazio;
            }

            const contratos = await this.uow.turmasAlunosTreinamentosContratosRP.find({
                where: {
                    id: In(idsPagina),
                    deletado_em: null,
                },
                select: {
                    id: true,
                    id_turma_aluno_treinamento: true,
                    status_ass_aluno: true,
                    status_ass_test_um: true,
                    status_ass_test_dois: true,
                    data_ass_aluno: true,
                    data_ass_test_um: true,
                    data_ass_test_dois: true,
                    criado_em: true,
                    atualizado_em: true,
                    criado_por: true,
                    dados_contrato: true,
                    comprovantes_pagamento: true,
                    zapsign_document_id: true,
                    zapsign_signers_data: true,
                    zapsign_document_status: true,
                    id_turma_aluno_treinamento_fk: {
                        id: true,
                        id_turma_aluno: true,
                        id_treinamento: true,
                        id_turma_destino: true,
                        criado_por: true,
                        id_turma_aluno_fk: {
                            id: true,
                            id_turma: true,
                            id_aluno: true,
                            pendencia_pagamento: true,
                            quantidade_inscricoes: true,
                            outros_clientes: true,
                            comprovante_pagamento_base64: true,
                            criado_por: true,
                            id_turma_transferencia_de: true,
                            id_turma_transferencia_para: true,
                            id_aluno_fk: {
                                id: true,
                                nome: true,
                                cpf: true,
                                email: true,
                                data_nascimento: true,
                                telefone_um: true,
                                logradouro: true,
                                numero: true,
                                complemento: true,
                                bairro: true,
                                cidade: true,
                                estado: true,
                                cep: true,
                                id_polo_fk: {
                                    id: true,
                                    cidade: true,
                                    estado: true,
                                },
                            },
                            id_turma_fk: {
                                id: true,
                                id_treinamento: true,
                                edicao_turma: true,
                                turmas_ipr_relacionadas: true,
                                id_treinamento_fk: {
                                    id: true,
                                    treinamento: true,
                                    sigla_treinamento: true,
                                },
                            },
                            id_turma_transferencia_de_fk: {
                                id: true,
                                id_treinamento: true,
                                edicao_turma: true,
                                id_treinamento_fk: {
                                    id: true,
                                    treinamento: true,
                                    sigla_treinamento: true,
                                },
                            },
                            id_turma_transferencia_para_fk: {
                                id: true,
                                id_treinamento: true,
                                edicao_turma: true,
                                id_treinamento_fk: {
                                    id: true,
                                    treinamento: true,
                                    sigla_treinamento: true,
                                },
                            },
                        },
                        id_treinamento_fk: {
                            id: true,
                            treinamento: true,
                            sigla_treinamento: true,
                            preco_treinamento: true,
                            url_logo_treinamento: true,
                        },
                    },
                    id_documento_fk: {
                        id: true,
                        documento: true,
                        clausulas: true,
                    },
                },
                relations: [
                    'id_turma_aluno_treinamento_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_aluno_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_aluno_fk.id_polo_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_turma_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_turma_fk.id_treinamento_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_turma_transferencia_de_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_turma_transferencia_de_fk.id_treinamento_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_turma_transferencia_para_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_turma_transferencia_para_fk.id_treinamento_fk',
                    'id_turma_aluno_treinamento_fk.id_treinamento_fk',
                    'id_documento_fk',
                ],
            });
            const ordemIdsPagina = new Map(idsPagina.map((id, index) => [id, index]));
            contratos.sort((a, b) => (ordemIdsPagina.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) - (ordemIdsPagina.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER));

            // Identifica quais contratos da página foram anexados manualmente
            // (contrato escrito à mão) sem trafegar o base64 da(s) foto(s)/PDF.
            const idsContratoManual = new Set<string>();
            if (idsPagina.length > 0) {
                const idsManuscritoRows = await this.uow.turmasAlunosTreinamentosContratosRP
                    .createQueryBuilder('contrato')
                    .select('contrato.id', 'id')
                    .where('contrato.id IN (:...idsPagina)', { idsPagina })
                    .andWhere('contrato.foto_documento_aluno_base64 IS NOT NULL')
                    .andWhere("COALESCE(contrato.foto_documento_aluno_base64, '') <> ''")
                    .getRawMany<{ id: string }>();
                idsManuscritoRows.forEach((row) => idsContratoManual.add(String(row.id)));
            }

            // Mapear dados para o formato esperado pelo frontend
            const cacheTurmaPorId = new Map<number, Turmas | null>();
            const cacheTurmaOrigemPorTurmaAluno = new Map<string, Turmas | null>();
            const cacheTurmaOrigemIprPorAluno = new Map<number, Turmas | null>();
            const cacheBonusIprPorComprador = new Map<number, { quantidade: number; descricao: string }>();
            const fallbackContextoPorContratoId = new Map<
                string,
                {
                    fallbackAlunoId: number;
                    fallbackTreinamentoId: number;
                    fallbackIdTurmaDestino: number;
                }
            >();
            const idsTurmaOrigemViaContrato = Array.from(
                new Set(
                    contratos
                        .map((contrato) => {
                            const dadosContrato = contrato?.dados_contrato || {};
                            return Number(dadosContrato?.fluxo_evento_origem_id_turma || dadosContrato?.id_turma_origem || dadosContrato?.turma_origem?.id || 0);
                        })
                        .filter((id) => Number.isFinite(id) && id > 0),
                ),
            );
            // Destino salvo no contrato (ex.: Confronto), que pode divergir da turma
            // de matrícula (turma_aluno.id_turma_fk) usada como fallback.
            const idsTurmaDestinoViaContrato = Array.from(
                new Set(
                    contratos
                        .map((contrato) => {
                            const dadosContrato = contrato?.dados_contrato || {};
                            return Number(dadosContrato?.fluxo_evento_destino_id_turma || dadosContrato?.id_turma_destino || 0);
                        })
                        .filter((id) => Number.isFinite(id) && id > 0),
                ),
            );
            const idsTurmasIprRelacionadas = Array.from(
                new Set(
                    contratos.flatMap((contrato) => {
                        const turmasRelacionadas = contrato?.id_turma_aluno_treinamento_fk?.id_turma_aluno_fk?.id_turma_fk?.turmas_ipr_relacionadas;
                        if (!Array.isArray(turmasRelacionadas)) return [];
                        return turmasRelacionadas.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
                    }),
                ),
            );
            const idsTurmasCacheInicial = Array.from(new Set([...idsTurmaOrigemViaContrato, ...idsTurmaDestinoViaContrato, ...idsTurmasIprRelacionadas]));

            if (idsTurmasCacheInicial.length > 0) {
                const turmasOrigemViaContrato = await this.uow.turmasRP.find({
                    where: {
                        id: In(idsTurmasCacheInicial),
                        deletado_em: IsNull(),
                    },
                    relations: ['id_treinamento_fk'],
                });

                turmasOrigemViaContrato.forEach((turma) => {
                    cacheTurmaPorId.set(turma.id, turma);
                });
                idsTurmasCacheInicial.forEach((id) => {
                    if (!cacheTurmaPorId.has(id)) {
                        cacheTurmaPorId.set(id, null);
                    }
                });
            }

            const contextoSemTurmaAluno = contratos
                .map((contrato) => {
                    const dadosContrato = contrato.dados_contrato || {};
                    const turmaAlunoTreinamento = contrato.id_turma_aluno_treinamento_fk;
                    const turmaAluno = turmaAlunoTreinamento?.id_turma_aluno_fk;
                    if (turmaAluno) return null;

                    const fallbackIdTurmaDestino =
                        Number(turmaAlunoTreinamento?.id_turma_destino || dadosContrato?.fluxo_evento_destino_id_turma || dadosContrato?.turma?.id || 0) || 0;
                    const fallbackAlunoId = Number(dadosContrato?.aluno?.id || 0);
                    const fallbackTreinamentoId = Number(dadosContrato?.treinamento?.id || turmaAlunoTreinamento?.id_treinamento || 0) || 0;

                    return {
                        contratoId: String(contrato.id),
                        fallbackAlunoId,
                        fallbackTreinamentoId,
                        fallbackIdTurmaDestino,
                    };
                })
                .filter(
                    (
                        item,
                    ): item is {
                        contratoId: string;
                        fallbackAlunoId: number;
                        fallbackTreinamentoId: number;
                        fallbackIdTurmaDestino: number;
                    } => Boolean(item),
                );

            contextoSemTurmaAluno.forEach((contexto) => {
                fallbackContextoPorContratoId.set(contexto.contratoId, {
                    fallbackAlunoId: contexto.fallbackAlunoId,
                    fallbackTreinamentoId: contexto.fallbackTreinamentoId,
                    fallbackIdTurmaDestino: contexto.fallbackIdTurmaDestino,
                });
            });

            const montarChaveFallback = (idAluno: number, idTreinamento: number, idTurmaDestino: number) =>
                `${idAluno}|${idTreinamento}|${idTurmaDestino > 0 ? idTurmaDestino : 0}`;

            const idsFallbackAlunos = Array.from(new Set(contextoSemTurmaAluno.map((item) => item.fallbackAlunoId).filter((id) => id > 0)));
            const idsFallbackTreinamentos = Array.from(new Set(contextoSemTurmaAluno.map((item) => item.fallbackTreinamentoId).filter((id) => id > 0)));
            const turmaAlunoTreinamentoFallbackPorChave = new Map<string, any>();
            const turmaAlunoDiretoFallbackPorChave = new Map<string, any>();

            if (idsFallbackAlunos.length > 0 && idsFallbackTreinamentos.length > 0) {
                const tatFallbackLote = await this.uow.turmasAlunosTreinamentosRP
                    .createQueryBuilder('tat_fallback')
                    .leftJoinAndSelect('tat_fallback.id_turma_aluno_fk', 'turma_aluno')
                    .where('tat_fallback.id_treinamento IN (:...idsTreinamento)', {
                        idsTreinamento: idsFallbackTreinamentos,
                    })
                    .andWhere('turma_aluno.id_aluno IN (:...idsAluno)', {
                        idsAluno: idsFallbackAlunos,
                    })
                    .andWhere('tat_fallback.deletado_em IS NULL')
                    .andWhere('turma_aluno.deletado_em IS NULL')
                    .orderBy('tat_fallback.atualizado_em', 'DESC')
                    .addOrderBy('tat_fallback.id', 'DESC')
                    .getMany();

                tatFallbackLote.forEach((item) => {
                    const idAluno = Number(item?.id_turma_aluno_fk?.id_aluno || 0);
                    const idTreinamento = Number(item?.id_treinamento || 0);
                    const idTurmaDestino = Number(item?.id_turma_aluno_fk?.id_turma || 0);
                    if (!idAluno || !idTreinamento) return;

                    const chaveComDestino = montarChaveFallback(idAluno, idTreinamento, idTurmaDestino);
                    const chaveSemDestino = montarChaveFallback(idAluno, idTreinamento, 0);

                    if (!turmaAlunoTreinamentoFallbackPorChave.has(chaveComDestino)) {
                        turmaAlunoTreinamentoFallbackPorChave.set(chaveComDestino, item);
                    }
                    if (!turmaAlunoTreinamentoFallbackPorChave.has(chaveSemDestino)) {
                        turmaAlunoTreinamentoFallbackPorChave.set(chaveSemDestino, item);
                    }
                });
            }

            if (idsFallbackAlunos.length > 0) {
                const turmaAlunoFallbackLote = await this.uow.turmasAlunosRP
                    .createQueryBuilder('ta_fallback')
                    .where('ta_fallback.id_aluno IN (:...idsAluno)', {
                        idsAluno: idsFallbackAlunos,
                    })
                    .andWhere('ta_fallback.deletado_em IS NULL')
                    .orderBy(
                        `CASE
                            WHEN ta_fallback.pendencia_pagamento IS TRUE
                            OR COALESCE(ta_fallback.quantidade_inscricoes, 1) > 1
                            OR ta_fallback.comprovante_pagamento_base64 IS NOT NULL
                            THEN 0
                            ELSE 1
                        END`,
                        'ASC',
                    )
                    .addOrderBy('ta_fallback.atualizado_em', 'DESC')
                    .addOrderBy('ta_fallback.id', 'DESC')
                    .getMany();

                turmaAlunoFallbackLote.forEach((item) => {
                    const idAluno = Number(item?.id_aluno || 0);
                    const idTurmaDestino = Number(item?.id_turma || 0);
                    if (!idAluno) return;

                    const chaveComDestino = `${idAluno}|${idTurmaDestino > 0 ? idTurmaDestino : 0}`;
                    const chaveSemDestino = `${idAluno}|0`;
                    if (!turmaAlunoDiretoFallbackPorChave.has(chaveComDestino)) {
                        turmaAlunoDiretoFallbackPorChave.set(chaveComDestino, item);
                    }
                    if (!turmaAlunoDiretoFallbackPorChave.has(chaveSemDestino)) {
                        turmaAlunoDiretoFallbackPorChave.set(chaveSemDestino, item);
                    }
                });

                const idsTurmaAlunoParaHistorico = Array.from(
                    new Set(
                        contratos
                            .map((contrato) =>
                                Number(
                                    contrato?.id_turma_aluno_treinamento_fk?.id_turma_aluno_fk?.id ||
                                        turmaAlunoDiretoFallbackPorChave.get(
                                            `${Number((contrato?.dados_contrato || {})?.aluno?.id || 0)}|${Number(contrato?.id_turma_aluno_treinamento_fk?.id_turma_destino || (contrato?.dados_contrato || {})?.fluxo_evento_destino_id_turma || (contrato?.dados_contrato || {})?.turma?.id || 0 || 0)}`,
                                        )?.id ||
                                        0,
                                ),
                            )
                            .filter((id) => Number.isFinite(id) && id > 0),
                    ),
                );

                if (idsTurmaAlunoParaHistorico.length > 0) {
                    const historicoOrigemLote = await this.uow.historicoTransferenciasRP
                        .createQueryBuilder('historico')
                        .leftJoinAndSelect('historico.id_turma_de_fk', 'turma_origem')
                        .leftJoinAndSelect('turma_origem.id_treinamento_fk', 'treinamento_origem')
                        .where('historico.id_turma_aluno_para IN (:...idsTurmaAlunoPara)', {
                            idsTurmaAlunoPara: idsTurmaAlunoParaHistorico,
                        })
                        .andWhere('historico.deletado_em IS NULL')
                        .andWhere('historico.id_turma_de <> historico.id_turma_para')
                        .orderBy('historico.criado_em', 'DESC')
                        .addOrderBy('historico.id', 'DESC')
                        .getMany();

                    historicoOrigemLote.forEach((item) => {
                        const idTurmaAlunoPara = String(item?.id_turma_aluno_para || '');
                        if (!idTurmaAlunoPara) return;
                        if (!cacheTurmaOrigemPorTurmaAluno.has(idTurmaAlunoPara)) {
                            cacheTurmaOrigemPorTurmaAluno.set(idTurmaAlunoPara, item?.id_turma_de_fk || null);
                        }
                    });
                }

                const idsAlunoIpr = Array.from(
                    new Set(
                        contratos
                            .map((contrato) => {
                                const dadosContrato = contrato?.dados_contrato || {};
                                const idAlunoDireto = Number(contrato?.id_turma_aluno_treinamento_fk?.id_turma_aluno_fk?.id_aluno || 0);
                                if (idAlunoDireto > 0) return idAlunoDireto;
                                return Number(dadosContrato?.aluno?.id || 0);
                            })
                            .filter((id) => Number.isFinite(id) && id > 0),
                    ),
                );

                if (idsAlunoIpr.length > 0) {
                    const preencherCacheIpr = async (incluirBonus: boolean, idsAlvo: number[]) => {
                        if (idsAlvo.length === 0) return;
                        const qb = this.uow.turmasAlunosRP
                            .createQueryBuilder('turma_aluno')
                            .leftJoinAndSelect('turma_aluno.id_turma_fk', 'turma')
                            .leftJoinAndSelect('turma.id_treinamento_fk', 'treinamento')
                            .where('turma_aluno.id_aluno IN (:...idsAluno)', {
                                idsAluno: idsAlvo,
                            })
                            .andWhere('turma_aluno.deletado_em IS NULL')
                            .andWhere('turma.deletado_em IS NULL')
                            .andWhere(
                                "(LOWER(COALESCE(treinamento.treinamento, '')) LIKE :imersao OR LOWER(COALESCE(treinamento.treinamento, '')) LIKE :imersaoAcento OR LOWER(COALESCE(treinamento.treinamento, '')) LIKE :ipr)",
                                {
                                    imersao: '%imersao prosperar%',
                                    imersaoAcento: '%imersão prosperar%',
                                    ipr: '%ipr%',
                                },
                            )
                            .orderBy('turma_aluno.atualizado_em', 'DESC')
                            .addOrderBy('turma_aluno.id', 'DESC');

                        if (!incluirBonus) {
                            qb.andWhere('(turma_aluno.vaga_bonus = false OR turma_aluno.vaga_bonus IS NULL)').andWhere(
                                '(turma_aluno.origem_aluno IS NULL OR turma_aluno.origem_aluno <> :origemBonus)',
                                {
                                    origemBonus: EOrigemAlunos.ALUNO_BONUS,
                                },
                            );
                        }

                        const matriculas = await qb.getMany();
                        matriculas.forEach((matricula) => {
                            const idAluno = Number(matricula?.id_aluno || 0);
                            if (!idAluno || cacheTurmaOrigemIprPorAluno.has(idAluno)) return;
                            cacheTurmaOrigemIprPorAluno.set(idAluno, matricula?.id_turma_fk || null);
                        });
                    };

                    await preencherCacheIpr(false, idsAlunoIpr);
                    const idsSemIpr = idsAlunoIpr.filter((idAluno) => !cacheTurmaOrigemIprPorAluno.has(idAluno));
                    await preencherCacheIpr(true, idsSemIpr);
                }

                if (idsAlunoIpr.length > 0) {
                    const idsCompradorBonus = idsAlunoIpr.map((id) => String(id));
                    const bonusMatriculasIpr = await this.uow.turmasAlunosRP
                        .createQueryBuilder('turma_aluno_bonus')
                        .leftJoinAndSelect('turma_aluno_bonus.id_turma_fk', 'turma_bonus')
                        .leftJoinAndSelect('turma_bonus.id_treinamento_fk', 'treinamento_bonus')
                        .where('turma_aluno_bonus.id_aluno_bonus IN (:...idsCompradorBonus)', {
                            idsCompradorBonus,
                        })
                        .andWhere('turma_aluno_bonus.origem_aluno = :origemBonus', {
                            origemBonus: EOrigemAlunos.ALUNO_BONUS,
                        })
                        .andWhere('turma_aluno_bonus.deletado_em IS NULL')
                        .andWhere('turma_bonus.deletado_em IS NULL')
                        .andWhere(
                            "(LOWER(COALESCE(treinamento_bonus.treinamento, '')) LIKE :imersao OR LOWER(COALESCE(treinamento_bonus.treinamento, '')) LIKE :imersaoAcento OR LOWER(COALESCE(treinamento_bonus.sigla_treinamento, '')) = :ipr)",
                            {
                                imersao: '%imersao prosperar%',
                                imersaoAcento: '%imersão prosperar%',
                                ipr: 'ipr',
                            },
                        )
                        .getMany();

                    const bonusPorComprador = new Map<number, string[]>();
                    const bonusQuantidadePorComprador = new Map<number, number>();
                    bonusMatriculasIpr.forEach((matricula) => {
                        const idComprador = Number(matricula?.id_aluno_bonus || 0);
                        if (!idComprador) return;
                        bonusQuantidadePorComprador.set(idComprador, (bonusQuantidadePorComprador.get(idComprador) || 0) + 1);
                        const edicao = String(matricula?.id_turma_fk?.edicao_turma || '').trim();
                        const lista = bonusPorComprador.get(idComprador) || [];
                        if (edicao) lista.push(edicao);
                        bonusPorComprador.set(idComprador, lista);
                    });

                    bonusQuantidadePorComprador.forEach((quantidade, idComprador) => {
                        const edicoes = bonusPorComprador.get(idComprador) || [];
                        const edicoesUnicas = Array.from(new Set(edicoes)).sort((a, b) => {
                            const numA = Number.parseInt(a.match(/\d+/)?.[0] || '', 10);
                            const numB = Number.parseInt(b.match(/\d+/)?.[0] || '', 10);
                            if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB) {
                                return numA - numB;
                            }
                            return a.localeCompare(b, 'pt-BR', { numeric: true });
                        });
                        cacheBonusIprPorComprador.set(idComprador, {
                            quantidade,
                            descricao: edicoesUnicas.length ? `Imersão Prosperar - ${edicoesUnicas.join(', ')}` : '',
                        });
                    });
                }
            }

            const contratosMapeados = await Promise.all(
                contratos.map((contrato) => {
                    const dadosContrato = contrato.dados_contrato || {};
                    let turmaAlunoTreinamento = contrato.id_turma_aluno_treinamento_fk;
                    let turmaAluno = turmaAlunoTreinamento?.id_turma_aluno_fk;
                    const documento = contrato.id_documento_fk;
                    const fallbackIdTurmaDestino =
                        Number(turmaAlunoTreinamento?.id_turma_destino || dadosContrato?.fluxo_evento_destino_id_turma || dadosContrato?.turma?.id || 0) || 0;
                    if (!turmaAluno) {
                        const contextoFallback = fallbackContextoPorContratoId.get(String(contrato.id));
                        if (contextoFallback?.fallbackAlunoId && contextoFallback?.fallbackTreinamentoId) {
                            const chaveComDestino = montarChaveFallback(
                                contextoFallback.fallbackAlunoId,
                                contextoFallback.fallbackTreinamentoId,
                                contextoFallback.fallbackIdTurmaDestino || fallbackIdTurmaDestino,
                            );
                            const chaveSemDestino = montarChaveFallback(contextoFallback.fallbackAlunoId, contextoFallback.fallbackTreinamentoId, 0);
                            const turmaAlunoTreinamentoFallback =
                                turmaAlunoTreinamentoFallbackPorChave.get(chaveComDestino) || turmaAlunoTreinamentoFallbackPorChave.get(chaveSemDestino);
                            if (turmaAlunoTreinamentoFallback?.id_turma_aluno_fk) {
                                turmaAlunoTreinamento = turmaAlunoTreinamentoFallback;
                                turmaAluno = turmaAlunoTreinamentoFallback.id_turma_aluno_fk;
                            }
                        }

                        if (!turmaAluno && contextoFallback?.fallbackAlunoId) {
                            const chaveDiretoComDestino = `${contextoFallback.fallbackAlunoId}|${
                                (contextoFallback.fallbackIdTurmaDestino || fallbackIdTurmaDestino) > 0
                                    ? contextoFallback.fallbackIdTurmaDestino || fallbackIdTurmaDestino
                                    : 0
                            }`;
                            const chaveDiretoSemDestino = `${contextoFallback.fallbackAlunoId}|0`;
                            turmaAluno = turmaAlunoDiretoFallbackPorChave.get(chaveDiretoComDestino) || turmaAlunoDiretoFallbackPorChave.get(chaveDiretoSemDestino);
                        }
                    }
                    const aluno = turmaAluno?.id_aluno_fk;
                    const polo = aluno?.id_polo_fk;

                    // Usar treinamento das relations ou dos dados do contrato
                    const treinamento = turmaAlunoTreinamento?.id_treinamento_fk || dadosContrato.treinamento || null;
                    let turmaDestinoEvento = turmaAluno?.id_turma_fk || null;
                    const fluxoEventoDestinoIdViaDadosContrato =
                        Number(dadosContrato?.fluxo_evento_destino_id_turma || dadosContrato?.id_turma_destino || 0) || null;
                    // Prioridade máxima: respeitar a turma de destino salva no contrato
                    // (o evento efetivamente vendido, ex.: Confronto), que pode diferir
                    // da turma de matrícula usada como fallback.
                    if (fluxoEventoDestinoIdViaDadosContrato && fluxoEventoDestinoIdViaDadosContrato > 0) {
                        if (cacheTurmaPorId.has(fluxoEventoDestinoIdViaDadosContrato)) {
                            turmaDestinoEvento = cacheTurmaPorId.get(fluxoEventoDestinoIdViaDadosContrato) || turmaDestinoEvento;
                        }
                    }
                    let turmaOrigemEvento = turmaAluno?.id_turma_transferencia_de_fk || null;
                    const idAlunoContrato = Number(turmaAluno?.id_aluno || dadosContrato?.aluno?.id || 0);
                    const idTurmaAlunoContrato = turmaAluno?.id ? String(turmaAluno.id) : null;
                    const fluxoEventoOrigemIdViaDadosContrato =
                        Number(dadosContrato?.fluxo_evento_origem_id_turma || dadosContrato?.id_turma_origem || dadosContrato?.turma_origem?.id || 0) || null;

                    // Prioridade máxima: respeitar a turma de origem salva no contrato.
                    if (fluxoEventoOrigemIdViaDadosContrato && fluxoEventoOrigemIdViaDadosContrato > 0) {
                        if (cacheTurmaPorId.has(fluxoEventoOrigemIdViaDadosContrato)) {
                            turmaOrigemEvento = cacheTurmaPorId.get(fluxoEventoOrigemIdViaDadosContrato) || turmaOrigemEvento;
                        }
                    }

                    // Prioridade 1: histórico de transferência da própria matrícula
                    // (garante origem real da venda quando o relacionamento direto não estiver preenchido).
                    if (!turmaOrigemEvento && idTurmaAlunoContrato) {
                        turmaOrigemEvento = cacheTurmaOrigemPorTurmaAluno.get(idTurmaAlunoContrato) || null;
                    }

                    // Para vendas de Confronto com bônus de IPR, a origem deve refletir
                    // a turma IPR de compra (não a turma bônus ofertada).
                    if (!turmaOrigemEvento && idAlunoContrato > 0) {
                        turmaOrigemEvento = cacheTurmaOrigemIprPorAluno.get(idAlunoContrato) || null;
                    }

                    // Fallback relacional: quando a transferência de origem não está gravada,
                    // usar a relação de turmas IPR vinculadas à turma de destino.
                    if (!turmaOrigemEvento && turmaDestinoEvento?.id) {
                        const turmasIprRelacionadas = Array.isArray(turmaDestinoEvento?.turmas_ipr_relacionadas) ? turmaDestinoEvento.turmas_ipr_relacionadas : [];

                        if (turmasIprRelacionadas.length > 0) {
                            const idsTurmasOrigem = turmasIprRelacionadas.map((id) => Number(id)).filter((id) => Number.isFinite(id));

                            const turmasCandidatas = idsTurmasOrigem
                                .map((id) => cacheTurmaPorId.get(id))
                                .filter((turma): turma is NonNullable<typeof turma> => Boolean(turma));

                            const turmasCandidatasSemDestino = turmasCandidatas.filter((turma) => turma.id !== turmaDestinoEvento.id);
                            const turmaIpr = turmasCandidatasSemDestino.find((turma) => {
                                const nomeTreinamento = (turma.id_treinamento_fk?.treinamento || '').toLowerCase();
                                return (
                                    nomeTreinamento.includes('imersão prosperar') || nomeTreinamento.includes('imersao prosperar') || nomeTreinamento.includes('ipr')
                                );
                            });

                            turmaOrigemEvento = turmaIpr || turmasCandidatasSemDestino[0] || turmasCandidatas[0] || null;
                        }
                    }
                    const formatarTurmaEvento = (
                        turma:
                            | {
                                  id?: number;
                                  edicao_turma?: string | null;
                                  id_treinamento_fk?: { treinamento?: string | null } | null;
                              }
                            | null
                            | undefined,
                    ): string | null => {
                        if (!turma) return null;
                        const nomeTreinamento = turma.id_treinamento_fk?.treinamento || 'Treinamento';
                        const edicao = turma.edicao_turma || null;
                        return edicao ? `${nomeTreinamento} - ${edicao}` : `${nomeTreinamento} - ${turma.id ?? ''}`.trim();
                    };
                    const fluxoEventoOrigemTreinamento = turmaOrigemEvento?.id_treinamento_fk?.treinamento || null;
                    const fluxoEventoDestinoTreinamento = turmaDestinoEvento?.id_treinamento_fk?.treinamento || treinamento?.treinamento || null;
                    const fluxoEventoOrigemTurma = formatarTurmaEvento(turmaOrigemEvento);
                    const fluxoEventoDestinoTurma = formatarTurmaEvento(turmaDestinoEvento);
                    const turmaAlunoDadosContrato = dadosContrato.turma_aluno || {};
                    // A matrícula vinculada ao contrato (origem) costuma vir com
                    // pendência = false explícito; por isso fazemos OR com o snapshot
                    // salvo em dados_contrato.turma_aluno (marcado no ato da venda).
                    const pendenciaPagamento = Boolean(turmaAluno?.pendencia_pagamento) || Boolean(turmaAlunoDadosContrato.pendencia_pagamento);
                    const quantidadeInscricoes = turmaAluno?.quantidade_inscricoes ?? turmaAlunoDadosContrato.quantidade_inscricoes ?? 1;
                    const contratoDuplo = quantidadeInscricoes > 1;
                    const outrosClientes = turmaAluno?.outros_clientes ?? turmaAlunoDadosContrato.outros_clientes ?? [];
                    // Comprovante(s) por VENDA: prioriza a coluna do contrato; cai
                    // para o snapshot do contrato e, por último, para o turma_aluno legado.
                    const comprovantesPagamento = this.resolverComprovantesDoContrato(contrato, turmaAlunoDadosContrato, turmaAluno);
                    const comprovantePagamentoBase64 = this.serializarComprovantes(comprovantesPagamento);
                    const criadoPorContrato = contrato?.criado_por ?? null;
                    const criadoPorTurmaAlunoTreinamento = turmaAlunoTreinamento?.criado_por ?? null;
                    const criadoPorTurmaAluno = turmaAluno?.criado_por ?? null;
                    const criadosPorValidos = [criadoPorContrato, criadoPorTurmaAlunoTreinamento, criadoPorTurmaAluno].filter(
                        (value) => value !== null && value !== undefined,
                    );
                    const criadosPorUnicos = Array.from(new Set(criadosPorValidos.map((value) => String(value))));
                    const criadoPorConsolidado = criadoPorContrato ?? criadoPorTurmaAlunoTreinamento ?? criadoPorTurmaAluno ?? null;
                    const criadoPorDivergente = criadosPorUnicos.length > 1;
                    const bonusIprResumo = cacheBonusIprPorComprador.get(idAlunoContrato);

                    return Promise.resolve({
                        id: contrato.id,
                        id_turma_aluno_treinamento: turmaAlunoTreinamento?.id ?? null,
                        id_turma_aluno: turmaAluno?.id ?? null,
                        id_turma: turmaAluno?.id_turma ?? null,
                        fluxo_evento_origem_id_turma: turmaOrigemEvento?.id ?? fluxoEventoOrigemIdViaDadosContrato,
                        fluxo_evento_origem_id_treinamento: turmaOrigemEvento?.id_treinamento ?? null,
                        fluxo_evento_origem_treinamento: fluxoEventoOrigemTreinamento,
                        fluxo_evento_origem_turma: fluxoEventoOrigemTurma,
                        fluxo_evento_destino_id_turma: turmaDestinoEvento?.id ?? null,
                        fluxo_evento_destino_id_treinamento: turmaDestinoEvento?.id_treinamento ?? turmaAlunoTreinamento?.id_treinamento ?? null,
                        fluxo_evento_destino_treinamento: fluxoEventoDestinoTreinamento,
                        fluxo_evento_destino_turma: fluxoEventoDestinoTurma,
                        bonus_ipr_inscricoes_quantidade: bonusIprResumo?.quantidade ?? 0,
                        bonus_ipr_inscricoes_descricao: bonusIprResumo?.descricao ?? '',
                        status_ass_aluno: contrato.status_ass_aluno,
                        status_ass_test_um: contrato.status_ass_test_um,
                        status_ass_test_dois: contrato.status_ass_test_dois,
                        data_ass_aluno: contrato.data_ass_aluno,
                        data_ass_test_um: contrato.data_ass_test_um,
                        data_ass_test_dois: contrato.data_ass_test_dois,
                        criado_em: contrato.criado_em,
                        atualizado_em: contrato.atualizado_em,
                        criado_por: criadoPorConsolidado,
                        criado_por_contrato: criadoPorContrato,
                        criado_por_turma_aluno_treinamento: criadoPorTurmaAlunoTreinamento,
                        criado_por_turma_aluno: criadoPorTurmaAluno,
                        criado_por_divergente: criadoPorDivergente,
                        criado_por_confronto: {
                            consolidado: criadoPorConsolidado,
                            contrato: criadoPorContrato,
                            turma_aluno_treinamento: criadoPorTurmaAlunoTreinamento,
                            turma_aluno: criadoPorTurmaAluno,
                            divergente: criadoPorDivergente,
                            valores_distintos: criadosPorUnicos,
                        },
                        // Campos para compatibilidade com frontend
                        created_at: contrato.criado_em,
                        updated_at: contrato.atualizado_em,
                        zapsign_document_id: contrato.zapsign_document_id,
                        zapsign_signers_data: contrato.zapsign_signers_data,
                        zapsign_document_status: contrato.zapsign_document_status,
                        // Indica que o contrato foi anexado manualmente (escrito à mão),
                        // dispensando o envio para assinatura digital.
                        contrato_manual: idsContratoManual.has(String(contrato.id)),
                        // Campos diretos para compatibilidade com frontend.
                        // Fallback no snapshot JSON (dados_contrato.aluno) quando a relação
                        // estiver vazia — por exemplo, matrícula soft-deleted por transferência.
                        aluno_nome: aluno?.nome || dadosContrato?.aluno?.nome || null,
                        treinamento_nome: treinamento?.treinamento || dadosContrato?.treinamento?.treinamento || null,
                        comprovantes_pagamento: comprovantesPagamento,
                        turma_aluno: {
                            pendencia_pagamento: pendenciaPagamento,
                            quantidade_inscricoes: quantidadeInscricoes,
                            outros_clientes: outrosClientes,
                            contrato_duplo: contratoDuplo,
                            comprovante_pagamento_base64: comprovantePagamentoBase64,
                            comprovantes_pagamento: comprovantesPagamento,
                        },
                        dados_contrato: {
                            // Mescla relação (fonte de verdade atualizada) com o snapshot
                            // do contrato. Snapshot serve de fallback se a matrícula estiver
                            // soft-deleted por transferência, perda de FK, etc.
                            aluno: {
                                id: aluno?.id ?? dadosContrato?.aluno?.id ?? null,
                                nome: aluno?.nome ?? dadosContrato?.aluno?.nome ?? null,
                                cpf: aluno?.cpf ?? dadosContrato?.aluno?.cpf ?? null,
                                email: aluno?.email ?? dadosContrato?.aluno?.email ?? null,
                                data_nascimento: aluno?.data_nascimento ?? dadosContrato?.aluno?.data_nascimento ?? null,
                                telefone_um: aluno?.telefone_um ?? dadosContrato?.aluno?.telefone_um ?? null,
                                polo: {
                                    id: polo?.id ?? dadosContrato?.aluno?.polo?.id ?? null,
                                    cidade: polo?.cidade ?? dadosContrato?.aluno?.polo?.cidade ?? null,
                                    estado: polo?.estado ?? dadosContrato?.aluno?.polo?.estado ?? null,
                                },
                                endereco: dadosContrato.aluno?.endereco || {
                                    logradouro: aluno?.logradouro || '',
                                    numero: aluno?.numero || '',
                                    complemento: aluno?.complemento || '',
                                    bairro: aluno?.bairro || '',
                                    cidade: aluno?.cidade || polo?.cidade || '',
                                    estado: aluno?.estado || polo?.estado || '',
                                    cep: aluno?.cep || '',
                                },
                            },
                            treinamento: {
                                id: treinamento?.id,
                                nome: treinamento?.treinamento,
                                sigla: treinamento?.sigla_treinamento,
                                preco: treinamento?.preco_treinamento,
                                url_logo_treinamento: treinamento?.url_logo_treinamento,
                            },
                            template: {
                                id: documento?.id,
                                nome: documento?.documento,
                                clausulas: documento?.clausulas,
                            },
                            pagamento: {
                                forma_pagamento: dadosContrato.pagamento?.forma_pagamento || dadosContrato.forma_pagamento || 'A_VISTA',
                                formas_pagamento: dadosContrato.pagamento?.formas_pagamento || dadosContrato.formas_pagamento || [],
                                valores_formas_pagamento: dadosContrato.pagamento?.valores_formas_pagamento || dadosContrato.valores_formas_pagamento || {},
                            },
                            testemunhas: dadosContrato.testemunhas || {},
                            campos_variaveis: dadosContrato.campos_variaveis || {},
                            formas_pagamento: dadosContrato.formas_pagamento || [],
                            valores_formas_pagamento: dadosContrato.valores_formas_pagamento || {},
                            bonus_selecionados: dadosContrato.bonus_selecionados || [],
                            valores_bonus: dadosContrato.valores_bonus || {},
                            bonus: {
                                tipos_bonus: dadosContrato.bonus_selecionados || [],
                                valores_bonus: dadosContrato.valores_bonus || {},
                                turma_bonus_info: dadosContrato.turma_bonus_info || null,
                            },
                            observacoes: dadosContrato.observacoes || '',
                            data_inicio_treinamento: dadosContrato.data_inicio_treinamento,
                            data_final_treinamento: dadosContrato.data_final_treinamento,
                            cidade_treinamento: dadosContrato.cidade_treinamento,
                            comprovantes_pagamento: comprovantesPagamento,
                            turma_aluno: {
                                pendencia_pagamento: pendenciaPagamento,
                                quantidade_inscricoes: quantidadeInscricoes,
                                outros_clientes: outrosClientes,
                                contrato_duplo: contratoDuplo,
                                comprovante_pagamento_base64: comprovantePagamentoBase64,
                                comprovantes_pagamento: comprovantesPagamento,
                            },
                        },
                    });
                }),
            );

            const dataPagina = contratosMapeados;
            const idsCriadoresUnicos = Array.from(
                new Set(
                    dataPagina
                        .flatMap((contrato) => [
                            contrato.criado_por,
                            contrato.criado_por_contrato,
                            contrato.criado_por_turma_aluno_treinamento,
                            contrato.criado_por_turma_aluno,
                        ])
                        .map((valor) => Number(valor))
                        .filter((valor) => Number.isFinite(valor) && valor > 0),
                ),
            );

            const nomeUsuarioPorId = new Map<number, string>();
            if (idsCriadoresUnicos.length > 0) {
                const usuarios = await this.uow.usuariosRP.find({
                    where: {
                        id: In(idsCriadoresUnicos),
                        deletado_em: IsNull(),
                    },
                    select: {
                        id: true,
                        nome: true,
                        primeiro_nome: true,
                        sobrenome: true,
                    },
                });

                usuarios.forEach((usuario) => {
                    const nomeCompleto = usuario.nome || `${usuario.primeiro_nome || ''} ${usuario.sobrenome || ''}`.trim() || `Usuário ${usuario.id}`;
                    nomeUsuarioPorId.set(usuario.id, nomeCompleto);
                });
            }

            const obterNomePorId = (valor?: number | string | null): string | null => {
                if (valor === null || valor === undefined) return null;
                const id = Number(valor);
                if (!Number.isFinite(id) || id <= 0) return null;
                return nomeUsuarioPorId.get(id) || null;
            };

            const data = dataPagina.map((contratoMapeado) => ({
                ...contratoMapeado,
                criado_por_nome: obterNomePorId(contratoMapeado.criado_por),
                criado_por_contrato_nome: obterNomePorId(contratoMapeado.criado_por_contrato),
                criado_por_turma_aluno_treinamento_nome: obterNomePorId(contratoMapeado.criado_por_turma_aluno_treinamento),
                criado_por_turma_aluno_nome: obterNomePorId(contratoMapeado.criado_por_turma_aluno),
                criado_por_confronto: {
                    ...contratoMapeado.criado_por_confronto,
                    consolidado_nome: obterNomePorId(contratoMapeado.criado_por_confronto?.consolidado),
                    contrato_nome: obterNomePorId(contratoMapeado.criado_por_confronto?.contrato),
                    turma_aluno_treinamento_nome: obterNomePorId(contratoMapeado.criado_por_confronto?.turma_aluno_treinamento),
                    turma_aluno_nome: obterNomePorId(contratoMapeado.criado_por_confronto?.turma_aluno),
                },
            }));

            const resultado = {
                data,
                total,
                page,
                limit,
                totalPages,
                resumo,
            };

            this.contratosBancoCache.set(chaveCache, {
                expiresAt: Date.now() + this.contratosBancoCacheTtlMs,
                value: resultado,
            });
            if (this.contratosBancoCache.size > this.contratosBancoCacheMaxEntradas) {
                const chaveMaisAntiga = this.contratosBancoCache.keys().next().value;
                if (chaveMaisAntiga) {
                    this.contratosBancoCache.delete(chaveMaisAntiga);
                }
            }

            this.logger.debug(`contract.repo.list | Listagem concluída total=${total} pagina=${page} limite=${limit}`);
            return resultado;
        } catch (error) {
            this.logger.error('contract.repo.list | Erro ao listar contratos do banco', error instanceof Error ? error.stack : undefined);
            throw new Error('Erro ao listar contratos do banco de dados');
        }
    }

    async enviarContratoPorEmail(email: string, nomeSignatario: string, signingUrl: string): Promise<void> {
        try {
            await this.mailService.sendContractEmail(email, nomeSignatario, signingUrl);
        } catch (error) {
            this.logger.error('contract.email.send | Erro ao enviar email de contrato', error instanceof Error ? error.stack : undefined);

            // Verificar se é erro de configuração SMTP
            if (error instanceof Error && error.message && error.message.includes('SMTP não configurado')) {
                throw new BadRequestException('Serviço de email não configurado. Configure as variáveis MAIL_HOST, MAIL_PORT, MAIL_USER e MAIL_PASS');
            }

            // Verificar se é erro de autenticação (credenciais inválidas)
            // O nodemailer retorna o código EAUTH em error.code
            const errorObj = error as any;
            if (
                errorObj?.code === 'EAUTH' ||
                (error instanceof Error &&
                    error.message &&
                    (error.message.includes('EAUTH') || error.message.includes('Bad Credentials') || error.message.includes('Username and Password not accepted')))
            ) {
                throw new BadRequestException('Credenciais de email inválidas. Verifique MAIL_USER e MAIL_PASS. Para Gmail, use uma App Password.');
            }

            throw new BadRequestException('Erro ao enviar email de contrato. Verifique as configurações MAIL_* no servidor.');
        }
    }

    async criarTermoZapSign(criarTermoDto: CriarTermoZapSignDto, userId?: number): Promise<RespostaTermoZapSignDto> {
        try {
            this.logger.debug('zapsign.create.term | Iniciando criação de termo ZapSign');

            // Buscar dados do aluno
            const aluno = await this.uow.alunosRP.findOne({
                where: { id: parseInt(criarTermoDto.id_aluno), deletado_em: null },
                relations: ['id_polo_fk'],
            });

            if (!aluno) {
                throw new NotFoundException('Aluno não encontrado');
            }

            // Buscar cláusulas do banco de dados se template_id foi fornecido
            let clausulas = '';
            if (criarTermoDto.template_id) {
                const documento = await this.uow.documentosRP.findOne({
                    where: { id: parseInt(criarTermoDto.template_id), deletado_em: null },
                });
                clausulas = documento?.clausulas || criarTermoDto.clausulas || '';
            } else {
                clausulas = criarTermoDto.clausulas || '';
            }

            // Preparar dados para o template do termo
            const templateData = {
                aluno: {
                    id: aluno.id,
                    nome: aluno.nome,
                    cpf: aluno.cpf,
                    email: aluno.email,
                    telefone_um: aluno.telefone_um,
                    logradouro: aluno.logradouro,
                    numero: aluno.numero,
                    bairro: aluno.bairro,
                    cidade: aluno.cidade,
                    estado: aluno.estado,
                    cep: aluno.cep,
                },
                termo: {
                    titulo: criarTermoDto.termo_titulo,
                    texto_introducao: criarTermoDto.texto_introducao || '',
                    clausulas: clausulas,
                    possui_testemunhas: criarTermoDto.possui_testemunhas || false,
                    local_assinatura: criarTermoDto.local_assinatura || 'Americana/SP',
                    observacoes: criarTermoDto.observacoes || '',
                },
                testemunhas: {
                    testemunha_um: {
                        nome: criarTermoDto.testemunha_um_nome || '',
                        cpf: criarTermoDto.testemunha_um_cpf || '',
                        email: criarTermoDto.testemunha_um_email || '',
                    },
                    testemunha_dois: {
                        nome: criarTermoDto.testemunha_dois_nome || '',
                        cpf: criarTermoDto.testemunha_dois_cpf || '',
                        email: criarTermoDto.testemunha_dois_email || '',
                    },
                },
                campos_variaveis: criarTermoDto.campos_variaveis || {},
            };

            // Gerar PDF do termo usando o template
            const pdfBuffer = await this.generateTermPDF(templateData);

            // Preparar signers
            const signers = [
                {
                    name: aluno.nome,
                    email: aluno.email,
                    phone: aluno.telefone_um,
                    action: 'sign' as const,
                },
            ];

            // Adicionar testemunhas se necessário
            if (criarTermoDto.possui_testemunhas) {
                if (criarTermoDto.testemunha_um_nome && criarTermoDto.testemunha_um_cpf) {
                    signers.push({
                        name: criarTermoDto.testemunha_um_nome,
                        email: criarTermoDto.testemunha_um_email || '',
                        phone: '',
                        action: 'sign' as const,
                    });
                }

                if (criarTermoDto.testemunha_dois_nome && criarTermoDto.testemunha_dois_cpf) {
                    signers.push({
                        name: criarTermoDto.testemunha_dois_nome,
                        email: criarTermoDto.testemunha_dois_email || '',
                        phone: '',
                        action: 'sign' as const,
                    });
                }
            }

            // Criar documento no ZapSign
            const documentData = {
                name: criarTermoDto.termo_titulo,
                signers: signers,
                message: 'Por favor, assine este termo.',
                sandbox: false,
                file: pdfBuffer,
            };

            this.logger.debug(`zapsign.create.term | Documento de termo sendo criado: ${documentData.name}`);

            const zapSignResponse = await this.zapSignService.createDocumentFromFile(documentData);

            // Preparar dados dos signers
            const signersData = signers.map((signer, index) => ({
                name: signer.name,
                email: signer.email || undefined,
                telefone: signer.phone || undefined,
                cpf: index === 0 ? aluno.cpf : index === 1 ? criarTermoDto.testemunha_um_cpf : criarTermoDto.testemunha_dois_cpf || '',
                status: 'pending',
                signing_url: zapSignResponse.signers.find((s) => s.name === signer.name)?.sign_url || '',
            }));

            // Preparar status do documento
            const documentStatus = {
                status: zapSignResponse.status,
                created_at: zapSignResponse.created_at,
                document_id: zapSignResponse.token,
                signing_url: zapSignResponse.signers[0]?.sign_url || '',
            };

            // Para termos, precisamos criar um registro temporário de turma_aluno_treinamento
            // Buscar ou criar registro de TurmasAlunos primeiro
            let turmaAluno = await this.uow.turmasAlunosRP.findOne({
                where: {
                    id_aluno: criarTermoDto.id_aluno,
                    deletado_em: null,
                },
            });

            // Se não existir, criar um registro temporário
            if (!turmaAluno) {
                const idTurmaParaCracha = 1; // Turma padrão temporária
                // Gerar número de crachá único para esta turma
                const numeroCracha = await this.turmasService.generateUniqueCrachaNumber(idTurmaParaCracha);

                turmaAluno = this.uow.turmasAlunosRP.create({
                    id_aluno: criarTermoDto.id_aluno,
                    id_turma: idTurmaParaCracha,
                    origem_aluno: EOrigemAlunos.COMPROU_INGRESSO,
                    status_aluno_turma: EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO,
                    numero_cracha: numeroCracha,
                });
                turmaAluno = await this.uow.turmasAlunosRP.save(turmaAluno);
                // Congela a meta no novo pico de inscritos/extras da turma do aluno.
                await this.uow.bumparPicoMetricasTurmas([turmaAluno.id_turma]);
            }

            // Buscar um treinamento válido ou usar um existente
            const treinamentoParaTermo = await this.uow.treinamentosRP.findOne({
                where: { deletado_em: null },
                order: { id: 'ASC' },
            });

            // Criar registro temporário de TurmasAlunosTreinamentos se não existir
            let turmaAlunoTreinamento = await this.uow.turmasAlunosTreinamentosRP.findOne({
                where: {
                    id_turma_aluno: turmaAluno.id,
                    deletado_em: null,
                },
            });

            if (!turmaAlunoTreinamento && treinamentoParaTermo) {
                // Verificar se há um registro deletado para reativar
                const registroDeletado = await this.uow.turmasAlunosTreinamentosRP.findOne({
                    where: {
                        id_turma_aluno: turmaAluno.id,
                        id_treinamento: treinamentoParaTermo.id,
                    },
                });

                if (registroDeletado && registroDeletado.deletado_em) {
                    // Reativar o registro deletado
                    registroDeletado.deletado_em = null;
                    registroDeletado.atualizado_em = new Date();
                    if (userId) {
                        registroDeletado.atualizado_por = userId;
                    }
                    turmaAlunoTreinamento = await this.uow.turmasAlunosTreinamentosRP.save(registroDeletado);
                } else {
                    // Criar um novo registro
                    try {
                        turmaAlunoTreinamento = this.uow.turmasAlunosTreinamentosRP.create({
                            id_turma_aluno: turmaAluno.id,
                            id_treinamento: treinamentoParaTermo.id,
                            preco_treinamento: 0,
                            forma_pgto: [],
                            preco_total_pago: 0,
                        });
                        turmaAlunoTreinamento = await this.uow.turmasAlunosTreinamentosRP.save(turmaAlunoTreinamento);
                    } catch (error: any) {
                        // Verificar se é erro de constraint única
                        if (typeof error === 'object' && error !== null && 'code' in error && (error.code === '23505' || error.driverError?.code === '23505')) {
                            const constraint = error?.constraint || error?.driverError?.constraint;

                            // Se for erro de sequência desincronizada (primary key)
                            if (constraint === 'pk_turmas_alunos_trn') {
                                this.logger.warn('db.sequence.turmas_alunos_treinamentos | Sequência desincronizada detectada; corrigindo');

                                // Corrigir a sequência
                                await this.fixTurmasAlunosTreinamentosSequence();

                                // Criar um novo objeto para garantir que não há ID pré-definido
                                const novoRegistro = this.uow.turmasAlunosTreinamentosRP.create({
                                    id_turma_aluno: turmaAluno.id,
                                    id_treinamento: treinamentoParaTermo.id,
                                    preco_treinamento: 0,
                                    forma_pgto: [],
                                    preco_total_pago: 0,
                                });

                                // Tentar novamente
                                turmaAlunoTreinamento = await this.uow.turmasAlunosTreinamentosRP.save(novoRegistro);
                                this.logger.log('db.sequence.turmas_alunos_treinamentos | Registro criado após correção de sequência');
                            } else {
                                // Se for outro tipo de constraint única, tentar reativar registro deletado
                                const registroExistente = await this.uow.turmasAlunosTreinamentosRP.findOne({
                                    where: {
                                        id_turma_aluno: turmaAluno.id,
                                        id_treinamento: treinamentoParaTermo.id,
                                    },
                                });

                                if (registroExistente && registroExistente.deletado_em) {
                                    // Reativar o registro deletado
                                    registroExistente.deletado_em = null;
                                    registroExistente.atualizado_em = new Date();
                                    if (userId) {
                                        registroExistente.atualizado_por = userId;
                                    }
                                    turmaAlunoTreinamento = await this.uow.turmasAlunosTreinamentosRP.save(registroExistente);
                                } else {
                                    throw error;
                                }
                            }
                        } else {
                            throw error;
                        }
                    }
                }
            } else if (!turmaAlunoTreinamento) {
                // Se não houver treinamento, criar um termo sem vínculo completo
                throw new NotFoundException('Não foi possível criar o termo. Nenhum treinamento disponível.');
            }

            // Salvar informações do termo no banco de dados
            const termo = this.uow.turmasAlunosTreinamentosContratosRP.create({
                id_turma_aluno_treinamento: turmaAlunoTreinamento.id,
                id_documento: parseInt(criarTermoDto.template_id),
                status_ass_aluno: EStatusAssinaturasContratos.ASSINATURA_PENDENTE,
                zapsign_document_id: zapSignResponse.token,
                zapsign_signers_data: signersData,
                zapsign_document_status: documentStatus,
                dados_contrato: {
                    zapsign_document_id: zapSignResponse.token,
                    zapsign_document_url: zapSignResponse.signers[0]?.sign_url || '',
                    termo: {
                        file_url: zapSignResponse.original_file,
                        id_documento_zapsign: zapSignResponse.token,
                    },
                    aluno: {
                        id: aluno.id,
                        nome: aluno.nome,
                        cpf: aluno.cpf,
                        email: aluno.email,
                        telefone_um: aluno.telefone_um,
                        logradouro: aluno.logradouro,
                        numero: aluno.numero,
                        bairro: aluno.bairro,
                        cidade: aluno.cidade,
                        estado: aluno.estado,
                        cep: aluno.cep,
                    },
                    termo_info: {
                        titulo: criarTermoDto.termo_titulo,
                        texto_introducao: criarTermoDto.texto_introducao,
                        clausulas: criarTermoDto.clausulas,
                        possui_testemunhas: criarTermoDto.possui_testemunhas,
                        local_assinatura: criarTermoDto.local_assinatura,
                        observacoes: criarTermoDto.observacoes,
                    },
                    campos_variaveis: criarTermoDto.campos_variaveis || {},
                    testemunhas: {
                        testemunha_um: {
                            nome: criarTermoDto.testemunha_um_nome || '',
                            cpf: criarTermoDto.testemunha_um_cpf || '',
                            email: criarTermoDto.testemunha_um_email || '',
                        },
                        testemunha_dois: {
                            nome: criarTermoDto.testemunha_dois_nome || '',
                            cpf: criarTermoDto.testemunha_dois_cpf || '',
                            email: criarTermoDto.testemunha_dois_email || '',
                        },
                    },
                },
                criado_por: userId,
                atualizado_por: userId,
            });

            await this.uow.turmasAlunosTreinamentosContratosRP.save(termo);

            return {
                id: zapSignResponse.token,
                nome_documento: criarTermoDto.termo_titulo || 'Termo',
                status: zapSignResponse.status,
                url_assinatura: zapSignResponse.signers[0]?.sign_url || '',
                signers: signers.map((signer) => ({
                    nome: signer.name,
                    email: signer.email,
                    status: 'pending',
                    tipo: 'sign' as const,
                })),
                created_at: zapSignResponse.created_at,
                file_url: zapSignResponse.original_file,
            };
        } catch (error: any) {
            this.logger.error('zapsign.create.term | Erro ao criar termo no ZapSign', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException(`Erro ao criar termo: ${error.message}`);
        }
    }

    /**
     * Sincroniza o status de assinatura do contrato com o ZapSign
     * Atualiza os status individuais e determina o status geral do documento
     */
    async sincronizarStatusZapSign(contratoId: string): Promise<{
        message: string;
        status: string;
        assinaturasCompletas: number;
        totalAssinaturas: number;
    }> {
        try {
            // Buscar o contrato
            const contrato = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
                where: {
                    id: contratoId,
                    deletado_em: null,
                },
            });

            if (!contrato) {
                throw new NotFoundException('Contrato não encontrado');
            }

            if (!contrato.zapsign_document_id) {
                throw new BadRequestException('Contrato não possui documento no ZapSign');
            }

            // Buscar o status atual do documento no ZapSign
            const zapSignDocument = await this.zapSignService.getDocument(contrato.zapsign_document_id);

            const normalizeCpf = (value?: string): string => (value || '').replace(/\D/g, '');

            const alunoCpf = normalizeCpf(contrato.dados_contrato?.aluno?.cpf);
            const testemunhaUmCpf = normalizeCpf(contrato.dados_contrato?.testemunhas?.testemunha_um?.cpf);
            const testemunhaDoisCpf = normalizeCpf(contrato.dados_contrato?.testemunhas?.testemunha_dois?.cpf);

            const signersDataExistentes = Array.isArray(contrato.zapsign_signers_data) ? contrato.zapsign_signers_data : [];

            // Atualizar os dados dos signatários preservando CPF/telefone quando ZapSign não retornar esses dados
            const signersData = zapSignDocument.signers.map((signer: any, index: number) => {
                const signerEmail = (signer.email || '').toLowerCase().trim();
                const signerName = (signer.name || '').toLowerCase().trim();

                const signerExistente = signersDataExistentes.find((item: any) => {
                    const itemEmail = (item?.email || '').toLowerCase().trim();
                    const itemName = (item?.name || '').toLowerCase().trim();
                    return (signerEmail && itemEmail && signerEmail === itemEmail) || (signerName && itemName && signerName === itemName);
                });

                const cpfDoZapSign = normalizeCpf(
                    signer?.cpf || signer?.document || signer?.document_number || signer?.tax_id || signer?.cpf_cnpj || signer?.cpfCnpj || signer?.identifier,
                );
                const cpfExistente = normalizeCpf(signerExistente?.cpf);
                const cpfPorOrdem = index === 0 ? alunoCpf : index === 1 ? testemunhaUmCpf : index === 2 ? testemunhaDoisCpf : '';
                const cpfFinal = cpfDoZapSign || cpfExistente || cpfPorOrdem;

                return {
                    name: signer.name || signerExistente?.name || '',
                    email: signer.email || signerExistente?.email || '',
                    telefone: signer?.phone || signerExistente?.telefone || '',
                    cpf: cpfFinal,
                    status: signer.status,
                    signing_url: signer.sign_url || signerExistente?.signing_url || '',
                };
            });

            // Atualizar o status do documento
            const documentStatus = {
                status: zapSignDocument.status,
                created_at: zapSignDocument.created_at,
                document_id: zapSignDocument.token,
                signing_url: zapSignDocument.signers[0]?.sign_url || '',
            };

            // Contar assinaturas
            const totalSigners = zapSignDocument.signers.length;
            const assinaturasCompletas = zapSignDocument.signers.filter((signer) => signer.status === 'signed' || signer.status === 'completed').length;

            // Determinar qual signatário é qual baseado na ordem e nos dados do contrato
            // Assumindo que o primeiro signatário é sempre o aluno
            const alunoSigner = zapSignDocument.signers[0];
            const testemunhaUmSigner = zapSignDocument.signers[1];
            const testemunhaDoisSigner = zapSignDocument.signers[2];

            // Atualizar status do aluno
            if (alunoSigner) {
                if (alunoSigner.status === 'signed' || alunoSigner.status === 'completed') {
                    // Se for 1 assinatura de 1: ASSINADO
                    // Se for 1 assinatura de 3 ou mais: PARCIALMENTE_ASSINADO
                    if (totalSigners === 1) {
                        contrato.status_ass_aluno = EStatusAssinaturasContratos.ASSINADO;
                    } else if (totalSigners > 1 && assinaturasCompletas < totalSigners) {
                        contrato.status_ass_aluno = EStatusAssinaturasContratos.PARCIALMENTE_ASSINADO;
                    } else if (assinaturasCompletas === totalSigners) {
                        contrato.status_ass_aluno = EStatusAssinaturasContratos.ASSINADO;
                    } else {
                        contrato.status_ass_aluno = EStatusAssinaturasContratos.ASSINATURA_PENDENTE;
                    }

                    if (alunoSigner.signed_at) {
                        contrato.data_ass_aluno = new Date(alunoSigner.signed_at);
                    }
                } else {
                    contrato.status_ass_aluno = EStatusAssinaturasContratos.ASSINATURA_PENDENTE;
                }
            }

            // Atualizar status da testemunha 1
            if (testemunhaUmSigner && contrato.testemunha_um) {
                if (testemunhaUmSigner.status === 'signed' || testemunhaUmSigner.status === 'completed') {
                    contrato.status_ass_test_um = EStatusAssinaturasContratos.ASSINADO;
                    if (testemunhaUmSigner.signed_at) {
                        contrato.data_ass_test_um = new Date(testemunhaUmSigner.signed_at);
                    }
                } else {
                    contrato.status_ass_test_um = EStatusAssinaturasContratos.ASSINATURA_PENDENTE;
                }
            }

            // Atualizar status da testemunha 2
            if (testemunhaDoisSigner && contrato.testemunha_dois) {
                if (testemunhaDoisSigner.status === 'signed' || testemunhaDoisSigner.status === 'completed') {
                    contrato.status_ass_test_dois = EStatusAssinaturasContratos.ASSINADO;
                    if (testemunhaDoisSigner.signed_at) {
                        contrato.data_ass_test_dois = new Date(testemunhaDoisSigner.signed_at);
                    }
                } else {
                    contrato.status_ass_test_dois = EStatusAssinaturasContratos.ASSINATURA_PENDENTE;
                }
            }

            // Atualizar dados do ZapSign no contrato
            contrato.zapsign_signers_data = signersData;
            contrato.zapsign_document_status = documentStatus;

            // Salvar as alterações
            await this.uow.turmasAlunosTreinamentosContratosRP.save(contrato);

            // Determinar mensagem de status
            let statusMessage = '';
            if (assinaturasCompletas === totalSigners && totalSigners > 0) {
                statusMessage = 'Documento totalmente assinado';
            } else if (assinaturasCompletas > 0 && assinaturasCompletas < totalSigners) {
                statusMessage = 'Documento parcialmente assinado';
            } else {
                statusMessage = 'Documento pendente de assinatura';
            }

            return {
                message: statusMessage,
                status: zapSignDocument.status,
                assinaturasCompletas,
                totalAssinaturas: totalSigners,
            };
        } catch (error: any) {
            this.logger.error('zapsign.sync | Erro ao sincronizar status do ZapSign', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException(`Erro ao sincronizar status: ${error.message || 'Erro desconhecido'}`);
        }
    }

    /**
     * Sincroniza o status de um contrato pelo document_id do ZapSign
     * Usado principalmente por webhooks
     */
    async sincronizarStatusZapSignPorDocumentId(zapsignDocumentId: string): Promise<{
        message: string;
        status: string;
        assinaturasCompletas: number;
        totalAssinaturas: number;
    }> {
        try {
            // Buscar o contrato pelo zapsign_document_id
            const contrato = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
                where: {
                    zapsign_document_id: zapsignDocumentId,
                    deletado_em: null,
                },
            });

            if (!contrato) {
                throw new NotFoundException(`Contrato não encontrado para document_id: ${zapsignDocumentId}`);
            }

            return await this.sincronizarStatusZapSign(contrato.id);
        } catch (error: any) {
            this.logger.error('zapsign.sync | Erro ao sincronizar status por document_id', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException(`Erro ao sincronizar status: ${error.message || 'Erro desconhecido'}`);
        }
    }

    /**
     * Sincroniza o status de todos os contratos com documentos no ZapSign
     */
    async sincronizarTodosStatusZapSign(): Promise<{
        message: string;
        sincronizados: number;
        erros: number;
    }> {
        try {
            // Buscar todos os contratos com documento no ZapSign
            const contratos = await this.uow.turmasAlunosTreinamentosContratosRP.find({
                where: {
                    zapsign_document_id: Not(IsNull()),
                    deletado_em: null,
                },
            });

            let sincronizados = 0;
            let erros = 0;

            for (const contrato of contratos) {
                try {
                    await this.sincronizarStatusZapSign(contrato.id);
                    sincronizados++;
                } catch (error) {
                    this.logger.warn(`zapsign.sync | Erro ao sincronizar contrato id=${contrato.id}`);
                    erros++;
                }
            }

            return {
                message: `Sincronização concluída: ${sincronizados} contratos atualizados, ${erros} erros`,
                sincronizados,
                erros,
            };
        } catch (error: any) {
            this.logger.error('zapsign.sync | Erro ao sincronizar todos os status', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException(`Erro ao sincronizar status: ${error.message || 'Erro desconhecido'}`);
        }
    }

    @Cron('*/20 * * * *')
    async sincronizarStatusZapSignCron(): Promise<void> {
        if (this.sincronizacaoStatusCronEmExecucao) {
            this.logger.warn('zapsign.sync.cron | Execução anterior ainda em andamento, pulando ciclo');
            return;
        }

        this.sincronizacaoStatusCronEmExecucao = true;

        try {
            const resultado = await this.executarSincronizacaoZapSignCronComRetry(this.janelaCronSincronizacaoDias);
            this.logger.log(
                `zapsign.sync.cron | Concluído em janela=${this.janelaCronSincronizacaoDias}d sincronizados=${resultado.sincronizados} erros=${resultado.erros}`,
            );
        } catch (error) {
            this.logger.error('zapsign.sync.cron | Erro ao executar sincronização automática', error instanceof Error ? error.stack : undefined);
        } finally {
            this.sincronizacaoStatusCronEmExecucao = false;
        }
    }

    private isErroConexaoTransitorio(error: unknown): boolean {
        const message = String((error as any)?.message || '').toLowerCase();
        return (
            message.includes('connection terminated unexpectedly') ||
            message.includes('terminating connection') ||
            message.includes('connection reset') ||
            message.includes('econnreset') ||
            message.includes('timeout') ||
            message.includes('connection not open')
        );
    }

    private async aguardar(ms: number): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async executarSincronizacaoZapSignCronComRetry(janelaDias: number): Promise<{ sincronizados: number; erros: number }> {
        for (let tentativa = 1; tentativa <= this.zapsignCronMaxTentativas; tentativa++) {
            try {
                return await this.sincronizarStatusContratosPendentesRecentesZapSign(janelaDias);
            } catch (error) {
                const erroTransitorio = this.isErroConexaoTransitorio(error);
                const ultimaTentativa = tentativa >= this.zapsignCronMaxTentativas;

                if (!erroTransitorio || ultimaTentativa) {
                    throw error;
                }

                this.logger.warn(
                    `zapsign.sync.cron | Falha transitória de conexão na tentativa ${tentativa}/${this.zapsignCronMaxTentativas}; retry em ${this.zapsignCronRetryDelayMs}ms`,
                );
                await this.aguardar(this.zapsignCronRetryDelayMs);
            }
        }

        return { sincronizados: 0, erros: 0 };
    }

    private async sincronizarStatusContratosPendentesRecentesZapSign(janelaDias: number): Promise<{
        sincronizados: number;
        erros: number;
    }> {
        const dataLimite = new Date();
        dataLimite.setDate(dataLimite.getDate() - janelaDias);

        const contratos = await this.uow.turmasAlunosTreinamentosContratosRP.find({
            where: {
                zapsign_document_id: Not(IsNull()),
                deletado_em: null,
                criado_em: Between(dataLimite, new Date()),
                status_ass_aluno: Not(EStatusAssinaturasContratos.ASSINADO),
            },
        });

        let sincronizados = 0;
        let erros = 0;

        for (const contrato of contratos) {
            try {
                await this.sincronizarStatusZapSign(contrato.id);
                sincronizados++;
            } catch (error) {
                this.logger.warn(`zapsign.sync.cron | Erro ao sincronizar contrato id=${contrato.id}`, error instanceof Error ? error.message : undefined);
                erros++;
            }
        }

        return {
            sincronizados,
            erros,
        };
    }

    private async generateTermPDF(templateData: any): Promise<Buffer> {
        // Usar o novo term template service
        return await this.termTemplateService.generateTermPDF(templateData);
    }

    private mapToResponseDto(documento: Documentos): DocumentoResponseDto {
        return {
            id: documento.id,
            documento: documento.documento,
            tipo_documento: documento.tipo_documento,
            campos: documento.campos || [],
            clausulas: documento.clausulas || '',
            treinamentos_relacionados: documento.treinamentos_relacionados || [],
            created_at: documento.criado_em,
            updated_at: documento.atualizado_em,
            criado_por: documento.criado_por,
            atualizado_por: documento.atualizado_por,
            deletado_em: documento.deletado_em,
        };
    }

    /**
     * Corrige a sequência de IDs da tabela turmas_alunos_treinamentos quando ela está desincronizada
     * Isso pode acontecer quando dados são inseridos manualmente ou importados
     */
    private async fixTurmasAlunosTreinamentosSequence(): Promise<void> {
        try {
            const queryRunner = this.uow.turmasAlunosTreinamentosRP.manager.connection.createQueryRunner();

            // Obter o schema da tabela (pode ser 'public' ou outro)
            const schema = this.uow.turmasAlunosTreinamentosRP.metadata.schema || 'public';

            // Obter o maior ID atual na tabela
            const result = await queryRunner.query(`SELECT COALESCE(MAX(id::bigint), 0) as max_id FROM ${schema}.turmas_alunos_treinamentos`);
            const maxId = parseInt(result[0]?.max_id || '0', 10);

            // Resetar a sequência para o próximo valor após o maior ID
            const nextId = maxId + 1;
            try {
                // Tentar com schema
                await queryRunner.query(`SELECT setval('${schema}.turmas_alunos_treinamentos_id_seq', $1, false)`, [nextId]);
            } catch (seqError) {
                // Se falhar, tentar sem schema (sequência pode estar no schema padrão)
                try {
                    await queryRunner.query(`SELECT setval('turmas_alunos_treinamentos_id_seq', $1, false)`, [nextId]);
                } catch (seqError2) {
                    // Se ainda falhar, tentar encontrar o nome real da sequência
                    const seqResult = await queryRunner.query(`SELECT pg_get_serial_sequence('${schema}.turmas_alunos_treinamentos', 'id') as seq_name`);
                    const seqName = seqResult[0]?.seq_name;
                    if (seqName) {
                        await queryRunner.query(`SELECT setval($1, $2, false)`, [seqName, nextId]);
                    } else {
                        throw new Error('Não foi possível encontrar a sequência');
                    }
                }
            }

            await queryRunner.release();
            this.logger.log(`db.sequence.turmas_alunos_treinamentos | Sequência corrigida próximoId=${nextId}`);
        } catch (error) {
            this.logger.error('db.sequence.turmas_alunos_treinamentos | Erro ao corrigir sequência', error instanceof Error ? error.stack : undefined);
            // Não relançar o erro, apenas logar
            // Se a correção falhar, o erro original será relançado
        }
    }
}
