import { Injectable, NotFoundException, BadRequestException, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { Documentos } from '@/modules/config/entities/documentos.entity';
import { TurmasAlunosTreinamentosContratos } from '@/modules/config/entities/turmasAlunosTreinamentosContratos.entity';
import {
    EStatusAssinaturasContratos,
    EOrigemAlunos,
    EStatusAlunosTurmas,
    ETipoDocumento,
    EFormasPagamento,
    ECategoriaExclusaoContrato,
    ESetores,
    EFuncoes,
} from '@/modules/config/entities/enum';
import * as crypto from 'crypto';
import axios from 'axios';
import { Not, IsNull, In, Between, Brackets } from 'typeorm';
import {
    CreateDocumentoDto,
    UpdateDocumentoDto,
    DocumentoResponseDto,
    DocumentosListResponseDto,
    DocumentoVersaoResumoDto,
    DocumentoVersaoDetalheDto,
    DocumentoVersoesListResponseDto,
    GerarContratoDto,
    CampoDocumentoDto,
    DocumentosFilterDto,
    CriarContratoZapSignDto,
    RespostaContratoZapSignDto,
    AtualizarStatusContratoDto,
    CriarTermoZapSignDto,
    RespostaTermoZapSignDto,
    ExcluirContratoDto,
} from './dto/documentos.dto';
import { ZapSignService, ZapSignResponse } from './zapsign.service';
import { normalizarTermoBusca, sqlBuscaNormalizada } from '../shared/nome-aluno.helper';
import { ContractTemplateService } from './contract-template.service';
import { TermTemplateService } from './term-template.service';
import PDFDocument from 'pdfkit';
import { MailService } from '@/modules/mail/mail.service';
import { TurmasService } from '../turmas/turmas.service';
import { NotificacoesService } from '../notificacoes/notificacoes.service';
import { CONFIG_KEYS } from '../configuracoes/configuracoes.service';
import { Turmas } from '@/modules/config/entities/turmas.entity';
import { TurmasAlunos } from '@/modules/config/entities/turmasAlunos.entity';
import { Usuarios } from '@/modules/config/entities/usuarios.entity';
import { DocumentosVersoes } from '@/modules/config/entities/documentosVersoes.entity';
import { resolverDuracaoMentoriaMeses } from '@/utils/mentoria-duracao';

const parsePositiveIntEnv = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

type ResumoHistoricoVendas = {
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

type LinhaHistoricoVendasResumo = {
    id: string;
    criado_em?: string | Date | null;
    dados_contrato?: unknown;
    criado_por_contrato?: string | number | null;
    criado_por_tat?: string | number | null;
    criado_por_ta?: string | number | null;
    quantidade_inscricoes?: string | number;
    outros_clientes?: unknown;
    pendencia_pagamento?: string | boolean;
    id_turma?: string | number | null;
    id_turma_destino?: string | number | null;
    hist_qtd_inscricoes?: string | number | null;
    hist_qtd_bonus?: string | number | null;
    hist_pendencia_pagamento?: string | boolean | null;
    hist_receita_total?: string | number | null;
    hist_vendedor_id?: string | number | null;
    hist_staff_lider_id?: string | number | null;
};

@Injectable()
export class DocumentosService {
    private readonly logger = new Logger(DocumentosService.name);
    private readonly estiloPadraoClausulas = "font-size: 11px; font-family: 'Times New Roman', Times, serif; margin: 0; padding: 0;";
    private readonly opcoesOrigemCacheTtlMs = 60000;
    private readonly opcoesOrigemCacheMaxEntradas = 200;
    // Listagem: TTL maior porque mutações já invalidam o cache; 15s quase não hitava.
    private readonly contratosBancoCacheTtlMs = 60000;
    private readonly contratosBancoCacheMaxEntradas = 80;
    // Resumo/ranking: custo alto (full-scan). Cache separado da paginação e TTL maior.
    private readonly resumoHistoricoCacheTtlMs = 180000;
    private readonly resumoHistoricoCacheMaxEntradas = 60;
    // Versão local: evita 2× MAX(atualizado_em) full-table a cada request.
    // Mutações do histórico incrementam a versão (e o admin/cache/clear também).
    private historicoVendasCacheVersao = 0;
    // Valor sentinela usado pelo filtro "Staff Líder" para agrupar as vendas
    // que não se vinculam a nenhum líder de time de Imersão Prosperar
    // (ex.: vendas de Masterclass sem time/líder definido).
    private readonly staffLiderSemVinculoSentinela = '__SEM_STAFF_LIDER__';
    private readonly janelaCronSincronizacaoDias = 7;
    private sincronizacaoStatusCronEmExecucao = false;
    /** Cache curto do mapa global membro→líder IPR (invalidado com caches do histórico). */
    private mapaLiderIprCache: {
        expiresAt: number;
        timesPorTurma: Map<number, Array<{ id: string; nome: string; liderId: string; membrosIds: string[] }>>;
        liderPorMembroGlobal: Map<string, string>;
        timesPorLider: Map<string, Set<string>>;
    } | null = null;
    private readonly mapaLiderIprCacheTtlMs = 120000;
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
                resumo: ResumoHistoricoVendas | null;
            };
        }
    >();
    private readonly resumoHistoricoCache = new Map<
        string,
        {
            expiresAt: number;
            value: ResumoHistoricoVendas;
        }
    >();

    constructor(
        private readonly uow: UnitOfWorkService,
        private readonly zapSignService: ZapSignService,
        private readonly contractTemplateService: ContractTemplateService,
        private readonly termTemplateService: TermTemplateService,
        private readonly mailService: MailService,
        @Inject(forwardRef(() => TurmasService))
        private readonly turmasService: TurmasService,
        private readonly notificacoesService: NotificacoesService,
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

            const nomesUsuarios = await this.montarNomesUsuariosDocumentos(documentos);
            const data = documentos.map((doc) => this.mapToResponseDto(doc, nomesUsuarios));
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

            const nomesUsuarios = await this.montarNomesUsuariosDocumentos([documento]);
            return this.mapToResponseDto(documento, nomesUsuarios);
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

            // Versionamento: arquiva o estado ANTERIOR antes de aplicar a edição.
            await this.arquivarVersaoDocumento(documento);

            Object.assign(documento, updatePayload);
            documento.versao = (documento.versao || 1) + 1;
            documento.atualizado_por = userId;
            documento.atualizado_em = new Date();

            const savedDocumento = await this.uow.documentosRP.save(documento);
            const nomesUsuarios = await this.montarNomesUsuariosDocumentos([savedDocumento]);
            return this.mapToResponseDto(savedDocumento, nomesUsuarios);
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            this.logger.error('doc.repo.update | Erro ao atualizar documento', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException('Erro ao atualizar documento');
        }
    }

    /**
     * Arquiva o estado ATUAL do documento em `documentos_versoes` (snapshot da
     * versão vigente antes de uma edição/restauração sobrescrevê-la).
     */
    private async arquivarVersaoDocumento(documento: Documentos): Promise<void> {
        const snapshot = this.uow.documentosVersoesRP.create({
            id_documento: documento.id,
            versao: documento.versao || 1,
            documento: documento.documento,
            tipo_documento: documento.tipo_documento,
            campos: documento.campos || [],
            clausulas: documento.clausulas || '',
            treinamentos_relacionados: documento.treinamentos_relacionados || [],
            conteudo_alterado_em: documento.atualizado_em ?? documento.criado_em ?? null,
            conteudo_alterado_por: documento.atualizado_por ?? documento.criado_por ?? null,
        });
        await this.uow.documentosVersoesRP.save(snapshot);
    }

    /** Resolve nomes de usuários das versões (autor do conteúdo e quem arquivou). */
    private async montarNomesUsuariosVersoes(versoes: DocumentosVersoes[]): Promise<Record<number, string>> {
        const ids = [
            ...new Set(
                versoes.flatMap((versao) => [versao.conteudo_alterado_por, versao.criado_por]).filter((id): id is number => typeof id === 'number' && id > 0),
            ),
        ];
        if (ids.length === 0) return {};
        try {
            const usuarios = await this.uow.usuariosRP.find({
                where: { id: In(ids) },
                select: ['id', 'nome'],
                withDeleted: true,
            });
            return Object.fromEntries(usuarios.map((usuario) => [usuario.id, usuario.nome]));
        } catch (error) {
            this.logger.warn(
                `doc.versoes.usuarios | Falha ao resolver nomes de usuários das versões: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
            );
            return {};
        }
    }

    private mapVersaoToResumoDto(versao: DocumentosVersoes, nomesUsuarios: Record<number, string>): DocumentoVersaoResumoDto {
        return {
            id: versao.id,
            versao: versao.versao,
            documento: versao.documento,
            tipo_documento: versao.tipo_documento,
            total_campos: Array.isArray(versao.campos) ? versao.campos.length : 0,
            conteudo_alterado_em: versao.conteudo_alterado_em ?? null,
            conteudo_alterado_por_nome: (versao.conteudo_alterado_por && nomesUsuarios[versao.conteudo_alterado_por]) || null,
            arquivada_em: versao.criado_em,
            arquivada_por_nome: (versao.criado_por && nomesUsuarios[versao.criado_por]) || null,
        };
    }

    /** Lista o histórico de versões arquivadas de um documento (mais recentes primeiro). */
    async listarVersoesDocumento(id: number): Promise<DocumentoVersoesListResponseDto> {
        const documento = await this.uow.documentosRP.findOne({ where: { id, deletado_em: null } });
        if (!documento) {
            throw new NotFoundException('Documento não encontrado');
        }

        const versoes = await this.uow.documentosVersoesRP.find({
            where: { id_documento: id },
            order: { versao: 'DESC', id: 'DESC' },
        });
        const nomesUsuarios = await this.montarNomesUsuariosVersoes(versoes);

        return {
            id_documento: documento.id,
            documento: documento.documento,
            versao_atual: documento.versao || 1,
            data: versoes.map((versao) => this.mapVersaoToResumoDto(versao, nomesUsuarios)),
        };
    }

    /** Conteúdo completo de uma versão arquivada (pré-visualização no histórico). */
    async getVersaoDocumento(id: number, idVersao: number): Promise<DocumentoVersaoDetalheDto> {
        const versao = await this.uow.documentosVersoesRP.findOne({
            where: { id: idVersao, id_documento: id },
        });
        if (!versao) {
            throw new NotFoundException('Versão do documento não encontrada');
        }
        const nomesUsuarios = await this.montarNomesUsuariosVersoes([versao]);
        return {
            ...this.mapVersaoToResumoDto(versao, nomesUsuarios),
            campos: versao.campos || [],
            clausulas: versao.clausulas || '',
            treinamentos_relacionados: versao.treinamentos_relacionados || [],
        };
    }

    /**
     * Restaura uma versão arquivada: o estado atual é arquivado como uma nova
     * versão (nada se perde) e o conteúdo da versão escolhida volta a vigorar,
     * com a versão vigente incrementada.
     */
    async restaurarVersaoDocumento(id: number, idVersao: number, userId?: number): Promise<DocumentoResponseDto> {
        const documento = await this.uow.documentosRP.findOne({ where: { id, deletado_em: null } });
        if (!documento) {
            throw new NotFoundException('Documento não encontrado');
        }
        const versao = await this.uow.documentosVersoesRP.findOne({
            where: { id: idVersao, id_documento: id },
        });
        if (!versao) {
            throw new NotFoundException('Versão do documento não encontrada');
        }

        // Arquiva o estado atual antes de sobrescrevê-lo com a versão restaurada.
        await this.arquivarVersaoDocumento(documento);

        documento.documento = versao.documento ?? documento.documento;
        documento.campos = versao.campos || [];
        documento.clausulas = versao.clausulas || '';
        documento.treinamentos_relacionados = versao.treinamentos_relacionados || [];
        if (versao.tipo_documento && Object.values(ETipoDocumento).includes(versao.tipo_documento as ETipoDocumento)) {
            documento.tipo_documento = versao.tipo_documento as ETipoDocumento;
        }
        documento.versao = (documento.versao || 1) + 1;
        documento.atualizado_por = userId;
        documento.atualizado_em = new Date();

        const savedDocumento = await this.uow.documentosRP.save(documento);
        this.logger.log(`doc.versoes.restore | Documento ${id} restaurado para a versão ${versao.versao} (nova versão ${savedDocumento.versao})`);

        const nomesUsuarios = await this.montarNomesUsuariosDocumentos([savedDocumento]);
        return this.mapToResponseDto(savedDocumento, nomesUsuarios);
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
        const baseAdiantamento = fimVigente && /^\d{4}-\d{2}-\d{2}/.test(fimVigente) ? new Date(`${fimVigente.slice(0, 10)}T00:00:00`) : null;
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
        const toIsoDate = (data: Date) => `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
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
            const fimMentoriaVigente = treinamento.tipo_mentoria ? await this.buscarFimMentoriaVigente(aluno.id, treinamento.id) : null;

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
            const periodoMentoria = periodoMentoriaManual ?? this.calcularPeriodoMentoria(treinamento, fimMentoriaVigente);

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

            // Contrato escrito à mão: o documento físico já foi anexado pelo
            // usuário na venda, então NÃO geramos PDF nem criamos documento na
            // ZapSign. Apenas registramos a venda; as fotos/PDF do contrato são
            // anexadas em seguida via salvarAssinatura (foto_documento_aluno_base64).
            const isContratoManual = criarContratoDto.contrato_manual === true;

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

            let zapSignResponse: ZapSignResponse | null = null;
            if (isContratoManual) {
                this.logger.debug('zapsign.create.contract | Contrato escrito à mão — pulando geração de PDF e criação na ZapSign');
            } else {
                // Preparar dados para o template usando os dados do DTO.
                // Quando a venda é para Pessoa Jurídica, o CONTRATANTE do contrato
                // passa a ser a empresa (razão social/CNPJ/endereço). O signatário
                // (signers) continua sendo a pessoa física do id_aluno.
                const alunoParaTemplate = this.aplicarEmpresaContratante(aluno, criarContratoDto);
                const templateData = await this.prepareTemplateDataFromDto(alunoParaTemplate, treinamento, turma, criarContratoDto);

                const pdfBuffer = await this.contractTemplateService.generateContractPDF(templateData);

                // Criar documento no ZapSign usando o PDF gerado
                const documentData = {
                    name: `Contrato ${treinamento.treinamento} - ${aluno.nome}`,
                    signers: signers,
                    message: 'Por favor, assine este contrato de treinamento.',
                    sandbox: false,
                    file: pdfBuffer,
                };

                zapSignResponse = await this.zapSignService.createDocumentFromFile(documentData);
            }

            // Processar dados de bônus completos
            const bonusData = this.processBonusData(criarContratoDto, turma);

            // Processar dados específicos do boleto
            const boletoData = this.processBoletoData(criarContratoDto);
            bonusData.campos_variaveis = { ...bonusData.campos_variaveis, ...boletoData };

            // Preparar dados dos signers para o campo zapsign_signers_data
            const signersData = signers.map((signer, index) => {
                // Tentar encontrar o signer correspondente no ZapSign por índice ou nome
                const zapSignSigner = zapSignResponse?.signers[index] || zapSignResponse?.signers.find((s) => s.name === signer.name);

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
            const documentStatus = zapSignResponse
                ? {
                      status: zapSignResponse.status,
                      created_at: zapSignResponse.created_at,
                      document_id: zapSignResponse.token,
                      signing_url: zapSignResponse.signers[0]?.sign_url || '',
                  }
                : null;

            // Salvar informações do contrato no banco de dados
            const contrato = this.uow.turmasAlunosTreinamentosContratosRP.create({
                id_turma_aluno_treinamento: turmaAlunoTreinamento.id,
                id_documento: parseInt(criarContratoDto.template_id),
                status_ass_aluno: EStatusAssinaturasContratos.ASSINATURA_PENDENTE,
                // Comprovante(s) de pagamento desta venda, vinculados ao contrato.
                comprovantes_pagamento: comprovantesVenda.length > 0 ? comprovantesVenda : null,
                // Campos ZapSign específicos (ausentes quando contrato escrito à mão)
                zapsign_document_id: zapSignResponse?.token ?? undefined,
                zapsign_signers_data: signersData,
                zapsign_document_status: documentStatus ?? undefined,
                dados_contrato: {
                    zapsign_document_id: zapSignResponse?.token ?? null,
                    zapsign_document_url: zapSignResponse?.signers[0]?.sign_url || '',
                    contrato: {
                        file_url: zapSignResponse?.original_file ?? null,
                        id_documento_zapsign: zapSignResponse?.token ?? null,
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
                    // Contratante do contrato: PF (aluno) ou PJ (empresa do aluno).
                    // `aluno` acima permanece sendo a pessoa física (base do casamento
                    // de assinatura por CPF); `contratante` é o que aparece impresso.
                    tipo_pessoa: this.isContratantePJ(criarContratoDto) ? 'PJ' : 'PF',
                    empresa_contratante: this.isContratantePJ(criarContratoDto) ? criarContratoDto.empresa_contratante : null,
                    contratante: (() => {
                        const c = this.aplicarEmpresaContratante(aluno, criarContratoDto);
                        return {
                            nome: c.nome,
                            cpf: c.cpf,
                            email: c.email,
                            telefone_um: c.telefone_um,
                            logradouro: c.logradouro,
                            numero: c.numero,
                            complemento: c.complemento,
                            bairro: c.bairro,
                            cidade: c.cidade,
                            estado: c.estado,
                            cep: c.cep,
                        };
                    })(),
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
                    // Comprovante compartilhado: outras compras pagas pelo mesmo
                    // comprovante desta venda (identifica quem paga para quem).
                    comprovante_vinculos_compras: criarContratoDto.comprovante_vinculos_compras || [],
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
            Object.assign(
                contrato,
                await this.montarColunasHistoricoVendaCompletas(contrato.dados_contrato, userId, [idTurmaOrigemContrato, criarContratoDto.id_turma_destino]),
            );

            const savedContrato = await this.uow.turmasAlunosTreinamentosContratosRP.save(contrato);
            this.invalidarCachesHistoricoVendas();

            // CAUSA RAIZ das vendas sem aluno na turma: a matrícula do comprador
            // na turma de destino era feita pelo FRONTEND em uma request separada
            // (após o contrato), com falha engolida em console.warn — timeout/rede
            // no navegador deixava a venda registrada sem matrícula. Agora a
            // matrícula é criada aqui no servidor, na mesma request do contrato.
            // "Aluno já está matriculado" não é erro (renovação de mentoria ou
            // aluno já presente na turma). O resultado vai na resposta para o
            // frontend decidir se precisa de fallback/aviso.
            let matriculaDestino: { criada: boolean; ja_matriculado?: boolean; erro?: string } | undefined;
            if (criarContratoDto.id_turma_destino) {
                const idTurmaDestinoMatricula = Number(criarContratoDto.id_turma_destino);
                try {
                    await this.turmasService.addAlunoTurma(
                        idTurmaDestinoMatricula,
                        {
                            id_aluno: parseInt(criarContratoDto.id_aluno),
                            origem_aluno: 'COMPROU_INGRESSO',
                            pendencia_pagamento: criarContratoDto.pendencia_pagamento ?? false,
                            quantidade_inscricoes: criarContratoDto.quantidade_inscricoes && criarContratoDto.quantidade_inscricoes > 0 ? criarContratoDto.quantidade_inscricoes : 1,
                            comprovante_pagamento_base64: this.serializarComprovantes(comprovantesVenda) ?? undefined,
                        },
                        userId,
                    );
                    matriculaDestino = { criada: true };
                } catch (error) {
                    const mensagem = error instanceof Error ? error.message : 'Erro desconhecido';
                    if (mensagem.toLowerCase().includes('já está matriculado')) {
                        matriculaDestino = { criada: false, ja_matriculado: true };
                    } else {
                        this.logger.error(
                            `zapsign.create.contract | Falha ao matricular comprador na turma de destino id=${idTurmaDestinoMatricula} contrato=${savedContrato.id}: ${mensagem}`,
                        );
                        matriculaDestino = { criada: false, erro: mensagem };
                    }
                }
            }

            // Comprovante compartilhado: registra nas compras relacionadas quem
            // está pagando por elas (best-effort: falha não derruba a venda).
            try {
                await this.registrarComprovanteCompartilhadoNasCompras(savedContrato.id, aluno?.nome || '', criarContratoDto.comprovante_vinculos_compras);
            } catch (error) {
                this.logger.warn(
                    `zapsign.create.contract | Falha ao registrar vínculo de comprovante compartilhado: ${
                        error instanceof Error ? error.message : 'Erro desconhecido'
                    }`,
                );
            }

            // Mapear signers com informações completas incluindo testemunhas
            const signersResponse = signers.map((signer, index) => {
                const zapSignSigner = zapSignResponse?.signers[index] || zapSignResponse?.signers.find((s) => s.name === signer.name);
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
                // Contrato escrito à mão não tem token da ZapSign: retornamos o id
                // numérico do registro para que a anexação subsequente das fotos/PDF
                // (salvarAssinatura) consiga localizar o contrato.
                id: zapSignResponse?.token ?? String(savedContrato.id),
                nome_documento: `Contrato ${treinamento.treinamento} - ${aluno.nome}`,
                status: zapSignResponse?.status ?? 'manual',
                url_assinatura: zapSignResponse?.signers[0]?.sign_url || '',
                signers: signersResponse,
                created_at: zapSignResponse?.created_at ?? new Date().toISOString(),
                file_url: zapSignResponse?.original_file,
                matricula_destino: matriculaDestino,
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
    /**
     * Indica se a venda é para Pessoa Jurídica (contrato emitido no CNPJ de uma
     * empresa do aluno) com dados de empresa preenchidos.
     */
    private isContratantePJ(dto: CriarContratoZapSignDto): boolean {
        return String(dto.tipo_pessoa || '').toUpperCase() === 'PJ' && !!dto.empresa_contratante && !!dto.empresa_contratante.cnpj;
    }

    /**
     * Retorna o objeto de contratante usado nos placeholders do contrato. Para PF
     * devolve o próprio aluno; para PJ sobrepõe nome/CPF-CNPJ/endereço/contato com
     * os dados da empresa (sem alterar a entidade original do aluno, que segue
     * sendo o signatário e a base do casamento de assinatura pelo CPF).
     */
    private aplicarEmpresaContratante(aluno: any, dto: CriarContratoZapSignDto): any {
        if (!this.isContratantePJ(dto)) return aluno;
        const emp = dto.empresa_contratante;
        if (!emp) return aluno;
        const fantasia = (emp.nome_fantasia || '').trim();
        const razao = (emp.razao_social || '').trim();
        const nomeContratante = razao ? (fantasia ? `${razao} (${fantasia})` : razao) : aluno?.nome;
        return {
            ...aluno,
            nome: nomeContratante,
            cpf: emp.cnpj || aluno?.cpf,
            data_nascimento: '',
            email: emp.email || aluno?.email,
            telefone_um: emp.telefone || aluno?.telefone_um,
            logradouro: emp.logradouro ?? aluno?.logradouro,
            numero: emp.numero ?? aluno?.numero,
            complemento: emp.complemento ?? aluno?.complemento,
            bairro: emp.bairro ?? aluno?.bairro,
            cidade: emp.cidade ?? aluno?.cidade,
            estado: emp.estado ?? aluno?.estado,
            cep: emp.cep ?? aluno?.cep,
        };
    }

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

            // Matrículas NÃO são removidas no cancelamento do contrato —
            // a exclusão de aluno da turma fica só com a acessora do Cuidado de Alunos.

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

            this.logger.log('contract.repo.cancel | Contrato removido do banco (soft delete); matrículas preservadas');

            return {
                message: 'Documento cancelado com sucesso. As matrículas do aluno e os bônus foram mantidos nas turmas.',
            };
        } catch (error) {
            this.logger.error('zapsign.cancel | Erro ao cancelar documento', error instanceof Error ? error.stack : undefined);
            throw new BadRequestException(`Erro ao cancelar documento: ${(error as Error).message}`);
        }
    }

    /**
     * Exclui um contrato do ZapSign e faz soft delete no banco
     */
    async excluirDocumentoZapSign(contratoId: string, userId?: number, motivo?: ExcluirContratoDto): Promise<{ message: string }> {
        try {
            this.logger.log(`zapsign.delete | Excluindo contrato ZapSign contratoId=${contratoId}`);
            const contratoIdNumerico = Number(contratoId);
            if (!Number.isInteger(contratoIdNumerico)) {
                throw new BadRequestException('ID de contrato inválido');
            }

            if (!motivo?.categoria_exclusao || !motivo?.observacao_exclusao?.trim()) {
                throw new BadRequestException('Informe a categoria e a observação da exclusão antes de apagar o contrato.');
            }

            const observacaoExclusao = motivo.observacao_exclusao.trim();
            if (observacaoExclusao.length < 5) {
                throw new BadRequestException('A observação da exclusão deve ter pelo menos 5 caracteres.');
            }
            if (observacaoExclusao.length > 150) {
                throw new BadRequestException('A observação da exclusão deve ter no máximo 150 caracteres.');
            }

            const categoriasValidas = Object.values(ECategoriaExclusaoContrato);
            if (!categoriasValidas.includes(motivo.categoria_exclusao)) {
                throw new BadRequestException('Categoria de exclusão inválida.');
            }

            // Buscar o contrato no banco de dados com relacionamentos
            const contrato = await this.uow.turmasAlunosTreinamentosContratosRP
                .createQueryBuilder('contrato')
                .leftJoinAndSelect('contrato.id_turma_aluno_treinamento_fk', 'turma_aluno_treinamento')
                .leftJoinAndSelect('turma_aluno_treinamento.id_turma_aluno_fk', 'turma_aluno')
                .leftJoinAndSelect('turma_aluno.id_aluno_fk', 'aluno')
                .leftJoinAndSelect('turma_aluno.id_turma_fk', 'turma')
                .leftJoinAndSelect('turma.id_treinamento_fk', 'treinamento')
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

            // Matrículas a REMOVER automaticamente junto com a exclusão da venda:
            // - o aluno da venda (comprador + inscrições adicionais) na turma de
            //   DESTINO do contrato;
            // - as matrículas de BÔNUS nas turmas de bônus.
            // A matrícula da turma de ORIGEM (a vinculada ao contrato) é PRESERVADA:
            // ela representa a participação real do aluno no evento em que comprou.

            // 1) Matrículas bônus vinculadas ao comprador (sempre por IDs)
            let matriculasBonusParaRemover: TurmasAlunos[] = [];
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
                    matriculasBonusParaRemover = await this.uow.turmasAlunosRP.find({
                        where: {
                            id_aluno_bonus: idAlunoComprador,
                            origem_aluno: EOrigemAlunos.ALUNO_BONUS,
                            deletado_em: null,
                            id_turma: In(Array.from(idsTurmasBonusRelacionadas)),
                        },
                        relations: ['id_aluno_fk'],
                    });

                    this.logger.debug(`contract.repo.delete | Matrículas bônus identificadas=${matriculasBonusParaRemover.length}`);
                } else {
                    this.logger.debug('contract.repo.delete | Nenhuma turma bônus vinculada por ID encontrada para esta venda');
                }
            }

            // 2) Matrículas na turma de DESTINO da venda (comprador + inscrições
            // adicionais). A resolução do destino aqui é ESTRITA (ids gravados no
            // ato da venda), sem fallback para a turma de origem — senão a
            // exclusão removeria a participação real do aluno no evento de origem.
            const idTurmaDestinoRemocao = (() => {
                const candidatos = [
                    dadosContrato?.fluxo_evento_destino_id_turma,
                    dadosContrato?.id_turma_destino,
                    contrato.id_turma_aluno_treinamento_fk?.id_turma_destino,
                ];
                for (const candidato of candidatos) {
                    const id = Number(candidato);
                    if (Number.isInteger(id) && id > 0) return id;
                }
                return null;
            })();

            const matriculasDestinoParaRemover = await this.localizarMatriculasVendaNaTurmaDestino({
                idTurmaDestino: idTurmaDestinoRemocao,
                idAlunoComprador,
                emailComprador: dadosContrato?.aluno?.email || turmaAlunoComprador?.id_aluno_fk?.email || null,
                outrosClientes: Array.isArray(dadosContrato?.turma_aluno?.outros_clientes)
                    ? dadosContrato.turma_aluno.outros_clientes
                    : Array.isArray(dadosContrato?.compradores_adicionais)
                      ? dadosContrato.compradores_adicionais
                      : [],
            });

            // Guarda: se existe OUTRA venda ativa do mesmo aluno para a mesma turma
            // de destino, a matrícula do comprador é compartilhada entre as vendas
            // e não pode ser removida por esta exclusão.
            let matriculaCompradorMantidaOutraVenda = false;
            if (idAlunoComprador && idTurmaDestinoRemocao) {
                try {
                    const outrasVendasAtivas = await this.uow.turmasAlunosTreinamentosContratosRP
                        .createQueryBuilder('c')
                        .where('c.deletado_em IS NULL')
                        .andWhere('c.id != :idContratoExcluido', { idContratoExcluido: contrato.id })
                        .andWhere("(c.dados_contrato->>'fluxo_evento_destino_id_turma') = :idTurmaDestinoTexto", {
                            idTurmaDestinoTexto: String(idTurmaDestinoRemocao),
                        })
                        .andWhere("COALESCE(c.dados_contrato->'aluno'->>'id', c.dados_contrato->'aluno'->>'id_aluno') = :idAlunoCompradorTexto", {
                            idAlunoCompradorTexto: String(idAlunoComprador),
                        })
                        .getCount();
                    matriculaCompradorMantidaOutraVenda = outrasVendasAtivas > 0;
                } catch (error) {
                    this.logger.warn(
                        `contract.repo.delete | Falha ao verificar outras vendas ativas do comprador: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
                    );
                }
            }

            const matriculasParaRemover = new Map<string, TurmasAlunos>();
            for (const matricula of [...matriculasDestinoParaRemover, ...matriculasBonusParaRemover]) {
                if (
                    matriculaCompradorMantidaOutraVenda &&
                    matricula.origem_aluno !== EOrigemAlunos.ALUNO_BONUS &&
                    String(matricula.id_aluno) === String(idAlunoComprador)
                ) {
                    continue;
                }
                matriculasParaRemover.set(String(matricula.id), matricula);
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

            const agora = new Date();

            // 3) Soft delete do contrato + auditoria obrigatória (categoria, obs, quem, quando)
            await this.uow.turmasAlunosTreinamentosContratosRP.update(contrato.id, {
                deletado_em: agora,
                atualizado_por: userId,
                categoria_exclusao: motivo.categoria_exclusao,
                observacao_exclusao: observacaoExclusao,
                excluido_por: userId ?? null,
                excluido_em: agora,
            });

            this.invalidarCachesHistoricoVendas();

            const categoriaLabel = this.labelCategoriaExclusaoContrato(motivo.categoria_exclusao);

            // 4) Remover AUTOMATICAMENTE as matrículas da venda (aluno na turma de
            // destino + bônus). Falha em uma matrícula não bloqueia as demais nem a
            // exclusão do contrato (ex.: turma congelada) — as falhas vão na notificação.
            const motivoRemocao = `Contrato ${contrato.id} excluído no Histórico de Vendas (${categoriaLabel}): ${observacaoExclusao}`;
            const idsMatriculasRemovidas: string[] = [];
            const falhasRemocao: string[] = [];
            let alunosRemovidos = 0;
            let bonusRemovidos = 0;
            for (const matricula of matriculasParaRemover.values()) {
                try {
                    await this.turmasService.removeAlunoTurma(String(matricula.id), userId, motivoRemocao, {
                        pularValidacaoPermissao: true,
                    });
                    idsMatriculasRemovidas.push(String(matricula.id));
                    if (matricula.origem_aluno === EOrigemAlunos.ALUNO_BONUS) {
                        bonusRemovidos++;
                    } else {
                        alunosRemovidos++;
                    }
                } catch (error) {
                    const nomeMatricula = matricula.id_aluno_fk?.nome || `matrícula ${matricula.id}`;
                    falhasRemocao.push(`${nomeMatricula} (${error instanceof Error ? error.message : 'erro desconhecido'})`);
                }
            }
            this.logger.log(`contract.repo.delete | Remoção automática: alunos=${alunosRemovidos} bonus=${bonusRemovidos} falhas=${falhasRemocao.length}`);

            // 5) Notificar líder do Cuidado de Alunos + acessora da turma de destino
            // sobre a exclusão e as remoções automáticas realizadas.
            const turmaVenda = turmaAlunoComprador?.id_turma_fk;
            const treinamentoVenda = turmaVenda?.id_treinamento_fk;
            // Nome do COMPRADOR do contrato: snapshot da venda com prioridade
            // (a relação pode apontar para outra pessoa após upsert por e-mail).
            const nomeAluno = dadosContrato?.aluno?.nome || turmaAlunoComprador?.id_aluno_fk?.nome || 'Aluno não identificado';
            const turmaLabel = turmaVenda
                ? `${treinamentoVenda?.treinamento || `Treinamento #${turmaVenda.id_treinamento}`} - ${turmaVenda.edicao_turma || 'Sem edição'}`
                : null;

            let nomeUsuarioExclusao: string | null = null;
            if (userId) {
                const usuarioExclusao = await this.uow.usuariosRP.findOne({
                    where: { id: userId },
                    select: ['id', 'nome'] as any,
                    withDeleted: true,
                });
                nomeUsuarioExclusao = usuarioExclusao?.nome || null;
            }

            // Notificação clara e DIRECIONADA: líder(es) do Cuidado de Alunos +
            // acessora da turma de destino (não o setor inteiro).
            const idTurmaDestino = this.resolverIdTurmaDestinoContrato(dadosContrato, turmaVenda?.id ?? null);
            const destinatarios = await this.resolverDestinatariosMudancaVenda(idTurmaDestino);

            const linhasMensagem = [
                `Aluno: ${nomeAluno}`,
                `Excluído por: ${nomeUsuarioExclusao || 'Usuário não identificado'} - ${this.formatarDataHoraBr(agora)}`,
                `Observações: ${categoriaLabel}. ${observacaoExclusao}`,
                `Removidos automaticamente: ${alunosRemovidos} aluno(s) da turma de destino e ${bonusRemovidos} bônus.`,
            ];
            if (matriculaCompradorMantidaOutraVenda) {
                linhasMensagem.push('Matrícula do comprador mantida: há outra venda ativa para a mesma turma de destino.');
            }
            if (falhasRemocao.length > 0) {
                linhasMensagem.push(`Atenção: ${falhasRemocao.length} matrícula(s) não puderam ser removidas: ${falhasRemocao.join('; ')}`);
            }

            await this.notificacoesService.criarNotificacaoParaUsuarios(
                {
                    tipo: 'CONTRATO_EXCLUIDO',
                    titulo: `Contrato excluído: ID ${contrato.id}`,
                    mensagem: linhasMensagem.join('\n'),
                    setorDestino: ESetores.CUIDADO_DE_ALUNOS,
                    criadoPor: userId,
                    dados: {
                        id_contrato: contrato.id,
                        id_aluno: idAlunoComprador,
                        nome_aluno: nomeAluno,
                        id_turma: turmaVenda?.id ?? null,
                        id_turma_destino: idTurmaDestino,
                        turma_label: turmaLabel,
                        ids_turmas_alunos_removidos: idsMatriculasRemovidas,
                        quantidade_alunos_removidos: alunosRemovidos,
                        quantidade_matriculas_bonus_removidas: bonusRemovidos,
                        matricula_comprador_mantida_outra_venda: matriculaCompradorMantidaOutraVenda,
                        falhas_remocao: falhasRemocao,
                        excluido_por: userId ?? null,
                        excluido_por_nome: nomeUsuarioExclusao,
                        categoria_exclusao: motivo.categoria_exclusao,
                        categoria_exclusao_label: categoriaLabel,
                        observacao_exclusao: observacaoExclusao,
                        excluido_em: agora.toISOString(),
                    },
                },
                destinatarios,
            );

            this.logger.log('contract.repo.delete | Contrato removido; matrículas de destino/bônus removidas e líder/acessora notificados');
            const resumoRemocao = `${alunosRemovidos} aluno(s) e ${bonusRemovidos} bônus removidos automaticamente das turmas de destino`;
            return {
                message:
                    falhasRemocao.length > 0
                        ? `Contrato excluído com sucesso. ${resumoRemocao}, mas ${falhasRemocao.length} matrícula(s) não puderam ser removidas (${falhasRemocao.join('; ')}).`
                        : `Contrato excluído com sucesso. ${resumoRemocao}. O Cuidado de Alunos foi notificado.`,
            };
        } catch (error) {
            this.logger.error('zapsign.delete | Erro ao excluir contrato', error instanceof Error ? error.stack : undefined);
            if (error instanceof BadRequestException || error instanceof NotFoundException) {
                throw error;
            }
            throw new BadRequestException(`Erro ao excluir contrato: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        }
    }

    private labelCategoriaExclusaoContrato(categoria: ECategoriaExclusaoContrato | string | null | undefined): string {
        const labels: Record<ECategoriaExclusaoContrato, string> = {
            [ECategoriaExclusaoContrato.ERRO_PREENCHIMENTO]: 'Erro de preenchimento',
            [ECategoriaExclusaoContrato.CANCELAMENTO_ALUNO]: 'Cancelamento de aluno',
            [ECategoriaExclusaoContrato.OUTRO_MOTIVO]: 'Outro motivo',
        };
        return (categoria && labels[categoria as ECategoriaExclusaoContrato]) || 'Não informado';
    }

    /** Funções consideradas de liderança (mesmo conjunto usado nas turmas). */
    private static readonly FUNCOES_LIDERANCA_CA = [EFuncoes.LIDER, EFuncoes.LIDER_DE_EVENTOS, EFuncoes.LIDER_DE_MASTERCLASS, EFuncoes.LIDER_DE_CONFRONTO];

    /** Formata uma data/hora no fuso de São Paulo como dd/mm/aaaa hh:mm. */
    private formatarDataHoraBr(data: Date): string {
        try {
            return new Intl.DateTimeFormat('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'America/Sao_Paulo',
            })
                .format(data)
                .replace(',', '');
        } catch {
            return data.toISOString();
        }
    }

    /**
     * Resolve os DESTINATÁRIOS de uma mudança de venda (exclusão/atualização):
     * a(s) líder(es) do Cuidado de Alunos + a acessora da turma de DESTINO +
     * a pessoa do FINANCEIRO definida em /configuracoes (chave
     * `financeiro_notificacoes_vendas_usuario`).
     * Retorna ids de usuário únicos (sem nulos). Nunca lança.
     */
    private async resolverDestinatariosMudancaVenda(idTurmaDestino?: number | null): Promise<number[]> {
        const ids = new Set<number>();

        try {
            const lideres = await this.uow.usuariosRP
                .createQueryBuilder('usuario')
                .select(['usuario.id'])
                .where('usuario.deletado_em IS NULL')
                .andWhere('usuario.setor && :setores', { setores: [ESetores.CUIDADO_DE_ALUNOS] })
                .andWhere('usuario.funcao && :funcoes', { funcoes: DocumentosService.FUNCOES_LIDERANCA_CA })
                .getMany();
            lideres.forEach((lider) => {
                if (lider?.id) ids.add(Number(lider.id));
            });
        } catch (error) {
            this.logger.warn(
                `notificacoes.destinatarios | Falha ao buscar líderes do Cuidado de Alunos: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
            );
        }

        const idTurma = Number(idTurmaDestino);
        if (Number.isInteger(idTurma) && idTurma > 0) {
            try {
                const turma = await this.uow.turmasRP.findOne({
                    where: { id: idTurma },
                    select: ['id', 'id_acessora'] as any,
                });
                if (turma?.id_acessora) {
                    ids.add(Number(turma.id_acessora));
                }
            } catch (error) {
                this.logger.warn(
                    `notificacoes.destinatarios | Falha ao buscar acessora da turma de destino ${idTurma}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
                );
            }
        }

        // Pessoa do FINANCEIRO configurada em /configuracoes para acompanhar
        // as mudanças de venda (exclusões/atualizações de contrato).
        try {
            const configFinanceiro = await this.uow.configuracoesSistemaRP.findOne({
                where: { chave: CONFIG_KEYS.FINANCEIRO_NOTIFICACOES_VENDAS },
            });
            const idFinanceiro = Number(String(configFinanceiro?.valor ?? '').trim());
            if (Number.isInteger(idFinanceiro) && idFinanceiro > 0) {
                ids.add(idFinanceiro);
            }
        } catch (error) {
            this.logger.warn(
                `notificacoes.destinatarios | Falha ao buscar usuário do financeiro configurado: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
            );
        }

        return Array.from(ids);
    }

    /** Resolve a turma de DESTINO de uma venda a partir do snapshot do contrato. */
    private resolverIdTurmaDestinoContrato(dadosContrato: any, turmaAlunoTurmaId?: number | null): number | null {
        const candidatos = [dadosContrato?.fluxo_evento_destino_id_turma, dadosContrato?.id_turma_destino, dadosContrato?.turma?.id, turmaAlunoTurmaId];
        for (const candidato of candidatos) {
            const id = Number(candidato);
            if (Number.isInteger(id) && id > 0) return id;
        }
        return null;
    }

    /** Escapa curingas de LIKE (%/_/\) para uso com ESCAPE '\'. */
    private escaparLikeSql(texto: string): string {
        return texto.replace(/[\\%_]/g, (caractere) => `\\${caractere}`);
    }

    /**
     * Localiza as matrículas ATIVAS criadas por uma venda na turma de DESTINO
     * do contrato: o comprador, as réplicas de inscrições adicionais (e-mail
     * marcado "local+insc..._n_comp@dominio") e os "outros clientes" da venda
     * (por id ou e-mail). Só considera matrículas com origem COMPROU_INGRESSO
     * — a origem usada pelo fluxo de venda — preservando matrículas do mesmo
     * aluno vindas de bônus, transferência ou importação.
     */
    private async localizarMatriculasVendaNaTurmaDestino(params: {
        idTurmaDestino: number | null;
        idAlunoComprador: string | number | null;
        emailComprador: string | null;
        outrosClientes: Array<{ id?: unknown; email?: unknown }>;
    }): Promise<TurmasAlunos[]> {
        const { idTurmaDestino, idAlunoComprador } = params;
        if (!idTurmaDestino) {
            return [];
        }

        const emailComprador = String(params.emailComprador || '')
            .trim()
            .toLowerCase();
        const paraTexto = (valor: unknown): string => (typeof valor === 'string' || typeof valor === 'number' ? String(valor).trim() : '');
        const idsOutrosClientes = params.outrosClientes.map((cliente) => paraTexto(cliente?.id)).filter((id) => /^\d+$/.test(id));
        const emailsOutrosClientes = params.outrosClientes.map((cliente) => paraTexto(cliente?.email).toLowerCase()).filter((email) => email.includes('@'));

        const posicaoArroba = emailComprador.indexOf('@');
        const temEmailComprador = posicaoArroba > 0;
        if (!idAlunoComprador && !temEmailComprador && idsOutrosClientes.length === 0 && emailsOutrosClientes.length === 0) {
            return [];
        }

        const query = this.uow.turmasAlunosRP
            .createQueryBuilder('ta')
            .leftJoinAndSelect('ta.id_aluno_fk', 'aluno')
            .where('ta.id_turma = :idTurmaDestino', { idTurmaDestino })
            .andWhere('ta.deletado_em IS NULL')
            .andWhere('ta.origem_aluno = :origemCompra', { origemCompra: EOrigemAlunos.COMPROU_INGRESSO });

        query.andWhere(
            new Brackets((where) => {
                if (idAlunoComprador) {
                    where.orWhere('ta.id_aluno = :idAlunoComprador', { idAlunoComprador: String(idAlunoComprador) });
                }
                if (temEmailComprador) {
                    // Réplicas de inscrições adicionais: "local+insc..._n_comp@dominio"
                    // (cobre também o titular de item de combo "insc1_combo{n}_n_comp").
                    const local = this.escaparLikeSql(emailComprador.slice(0, posicaoArroba));
                    const dominio = this.escaparLikeSql(emailComprador.slice(posicaoArroba + 1));
                    where.orWhere("LOWER(aluno.email) LIKE :padraoReplica ESCAPE '\\'", {
                        padraoReplica: `${local}+insc%\\_n\\_comp@${dominio}`,
                    });
                }
                if (idsOutrosClientes.length > 0) {
                    where.orWhere('ta.id_aluno IN (:...idsOutrosClientes)', { idsOutrosClientes });
                }
                if (emailsOutrosClientes.length > 0) {
                    where.orWhere('LOWER(aluno.email) IN (:...emailsOutrosClientes)', { emailsOutrosClientes });
                }
            }),
        );

        return query.getMany();
    }

    /**
     * Listagem de contratos já excluídos no Histórico de Vendas (consulta de auditoria).
     */
    async listarContratosExcluidos(filtros?: { page?: number; limit?: number; search?: string; categoria_exclusao?: string }): Promise<{
        data: Array<{
            id: string;
            aluno_nome: string;
            aluno_email: string | null;
            aluno_cpf: string | null;
            treinamento: string | null;
            turma_origem: string | null;
            turma_destino: string | null;
            receita: number;
            categoria_exclusao: ECategoriaExclusaoContrato | null;
            categoria_exclusao_label: string;
            observacao_exclusao: string | null;
            excluido_em: Date | null;
            excluido_por: number | null;
            excluido_por_nome: string | null;
            criado_em: Date;
        }>;
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    }> {
        const page = Math.max(1, Number(filtros?.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(filtros?.limit) || 20));
        const offset = (page - 1) * limit;
        const termoBusca = this.normalizarTexto(filtros?.search);
        const categoriaFiltro = String(filtros?.categoria_exclusao || '').trim();

        const qb = this.uow.turmasAlunosTreinamentosContratosRP
            .createQueryBuilder('contrato')
            .withDeleted()
            .leftJoin('contrato.id_turma_aluno_treinamento_fk', 'tat')
            .leftJoin('tat.id_turma_aluno_fk', 'ta')
            .leftJoin('ta.id_aluno_fk', 'aluno')
            .leftJoin(Usuarios, 'usuario_exclusao', 'usuario_exclusao.id = contrato.excluido_por')
            .where('contrato.deletado_em IS NOT NULL');

        if (categoriaFiltro && Object.values(ECategoriaExclusaoContrato).includes(categoriaFiltro as ECategoriaExclusaoContrato)) {
            qb.andWhere('contrato.categoria_exclusao = :categoriaFiltro', { categoriaFiltro });
        }

        if (termoBusca) {
            const termoBuscaDigitos = termoBusca.replace(/\D/g, '');
            const condicoesBusca = [
                `LOWER(COALESCE(aluno.nome, '')) LIKE :termoBusca`,
                `LOWER(COALESCE(contrato.dados_contrato->'aluno'->>'nome', '')) LIKE :termoBusca`,
                `LOWER(COALESCE(contrato.observacao_exclusao, '')) LIKE :termoBusca`,
                `CAST(contrato.id AS text) LIKE :termoBuscaId`,
            ];
            const parametrosBusca: Record<string, string> = {
                termoBusca: `%${termoBusca}%`,
                termoBuscaId: `%${termoBusca}%`,
            };
            if (termoBuscaDigitos.length >= 3) {
                condicoesBusca.push(`REGEXP_REPLACE(COALESCE(aluno.cpf, ''), '[^0-9]', '', 'g') LIKE :termoBuscaCpf`);
                condicoesBusca.push(`REGEXP_REPLACE(COALESCE(contrato.dados_contrato->'aluno'->>'cpf', ''), '[^0-9]', '', 'g') LIKE :termoBuscaCpf`);
                parametrosBusca.termoBuscaCpf = `%${termoBuscaDigitos}%`;
            }
            qb.andWhere(`(${condicoesBusca.join(' OR ')})`, parametrosBusca);
        }

        const total = await qb.clone().getCount();

        const rows = await qb
            .select([
                'contrato.id AS id',
                'contrato.criado_em AS criado_em',
                'contrato.deletado_em AS deletado_em',
                'contrato.excluido_em AS excluido_em',
                'contrato.excluido_por AS excluido_por',
                'contrato.categoria_exclusao AS categoria_exclusao',
                'contrato.observacao_exclusao AS observacao_exclusao',
                'contrato.hist_receita_total AS hist_receita_total',
                'contrato.hist_turma_origem AS hist_turma_origem',
                'contrato.hist_turma_destino AS hist_turma_destino',
                'contrato.hist_treinamento_origem AS hist_treinamento_origem',
                'contrato.dados_contrato AS dados_contrato',
                'aluno.nome AS aluno_nome_rel',
                'aluno.email AS aluno_email_rel',
                'aluno.cpf AS aluno_cpf_rel',
                'usuario_exclusao.nome AS excluido_por_nome',
            ])
            .orderBy('contrato.excluido_em', 'DESC', 'NULLS LAST')
            .addOrderBy('contrato.deletado_em', 'DESC')
            .offset(offset)
            .limit(limit)
            .getRawMany();

        const data = rows.map((row) => {
            const dadosContrato =
                typeof row.dados_contrato === 'string'
                    ? (() => {
                          try {
                              return JSON.parse(row.dados_contrato);
                          } catch {
                              return {};
                          }
                      })()
                    : row.dados_contrato || {};
            const alunoSnapshot = dadosContrato?.aluno || {};
            const alunoNome = alunoSnapshot?.nome || row.aluno_nome_rel || 'Aluno não identificado';
            const alunoEmail = alunoSnapshot?.email || row.aluno_email_rel || null;
            const alunoCpf = alunoSnapshot?.cpf || row.aluno_cpf_rel || null;
            const treinamento = dadosContrato?.treinamento?.nome || dadosContrato?.treinamento?.treinamento || row.hist_treinamento_origem || null;
            const turmaOrigem = dadosContrato?.fluxo_evento_origem_label || dadosContrato?.turma_origem?.edicao_turma || row.hist_turma_origem || null;
            const turmaDestino = dadosContrato?.fluxo_evento_destino_label || dadosContrato?.turma?.edicao_turma || row.hist_turma_destino || null;
            const receita = Number(row.hist_receita_total || dadosContrato?.pagamento?.valor_total || 0) || 0;
            const categoria = (row.categoria_exclusao as ECategoriaExclusaoContrato | null) || null;

            return {
                id: String(row.id),
                aluno_nome: String(alunoNome),
                aluno_email: alunoEmail ? String(alunoEmail) : null,
                aluno_cpf: alunoCpf ? String(alunoCpf) : null,
                treinamento: treinamento ? String(treinamento) : null,
                turma_origem: turmaOrigem ? String(turmaOrigem) : null,
                turma_destino: turmaDestino ? String(turmaDestino) : null,
                receita,
                categoria_exclusao: categoria,
                categoria_exclusao_label: this.labelCategoriaExclusaoContrato(categoria),
                observacao_exclusao: row.observacao_exclusao ? String(row.observacao_exclusao) : null,
                excluido_em: row.excluido_em || row.deletado_em || null,
                excluido_por: row.excluido_por != null ? Number(row.excluido_por) : null,
                excluido_por_nome: row.excluido_por_nome ? String(row.excluido_por_nome) : null,
                criado_em: row.criado_em,
            };
        });

        return {
            data,
            total,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        };
    }

    /**
     * Prepara dados para o template usando dados salvos no banco
     */
    private prepareTemplateDataFromSavedContract(contrato: any) {
        this.logger.debug('contract.template.prepare.saved | Preparando dados do contrato salvo para template');

        // Usar diretamente os dados salvos no banco. Para vendas PJ, o contratante
        // impresso é a empresa (`contrato.contratante`); PF cai no `contrato.aluno`.
        return {
            aluno: contrato.contratante || contrato.aluno || {},
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

    async buscarContratoCompleto(contratoId: string, incluirExcluidos = false): Promise<any> {
        try {
            // Primeiro, vamos buscar o contrato básico. Quando `incluirExcluidos`
            // é true (aba "Contratos excluídos"), o soft delete é ignorado para
            // permitir consultar os detalhes da venda apagada.
            const contratoBasico = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
                where: incluirExcluidos ? { id: contratoId } : { id: contratoId, deletado_em: null },
                withDeleted: incluirExcluidos,
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
            // Comprador PRINCIPAL do contrato: snapshot da venda com prioridade
            // sobre a relação (que pode apontar para outra pessoa — ex.: registro
            // de aluno renomeado por upsert de e-mail ao lançar 2ª inscrição/combo).
            const alunoComprador = this.resolverAlunoCompradorContrato(aluno, dadosContrato?.aluno);
            // Buscar treinamento dos dados do contrato ou das relations
            const treinamento = dadosContrato.treinamento || turmaAlunoTreinamento?.id_treinamento_fk || null;
            const turmaAlunoDadosContrato = dadosContrato.turma_aluno || {};
            const pendenciaPagamento = turmaAluno?.pendencia_pagamento ?? turmaAlunoDadosContrato.pendencia_pagamento ?? false;
            // Quantidade de inscrições DA VENDA: prioriza o snapshot gravado no ato
            // da venda (dados_contrato.turma_aluno); a matrícula vinculada ao
            // contrato costuma ser a da turma de ORIGEM e carrega a quantidade de
            // outra venda (fallback apenas para contratos legados sem snapshot).
            const quantidadeInscricoes = turmaAlunoDadosContrato.quantidade_inscricoes ?? turmaAluno?.quantidade_inscricoes ?? 1;
            const contratoDuplo = quantidadeInscricoes > 1;
            // Outros clientes DA VENDA: mesmo racional — o snapshot da venda tem
            // prioridade sobre a matrícula de origem (que carrega os clientes
            // adicionais de OUTRA venda feita a partir da mesma turma).
            const outrosClientes = turmaAlunoDadosContrato.outros_clientes ?? turmaAluno?.outros_clientes ?? [];
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
                aluno_nome: alunoComprador.nome ?? undefined,
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
                        id: alunoComprador.id,
                        nome: alunoComprador.nome,
                        cpf: alunoComprador.cpf,
                        email: alunoComprador.email,
                        data_nascimento: alunoComprador.data_nascimento,
                        telefone_um: alunoComprador.telefone_um,
                        telefone_dois: alunoComprador.telefone_dois,
                        polo: alunoComprador.polo,
                        endereco: alunoComprador.endereco,
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
                    // Contratante: 'PF' (CPF do aluno) ou 'PJ' (CNPJ da empresa do aluno).
                    tipo_pessoa: dadosContrato.tipo_pessoa || 'PF',
                    empresa_contratante: dadosContrato.empresa_contratante || null,
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

    /**
     * Resolve o COMPRADOR PRINCIPAL do contrato para exibição no Histórico de
     * Vendas. A fonte de verdade é SEMPRE o snapshot gravado em
     * `dados_contrato.aluno` no ato da venda (é o nome impresso no contrato).
     * A matrícula vinculada ao contrato pode apontar para OUTRA pessoa — ex.:
     * o upsert de alunos por e-mail renomeia o registro quando a 2ª inscrição
     * ou o titular do combo entra com os dados de um familiar usando o mesmo
     * e-mail — então a relação só complementa campos ausentes quando for
     * comprovadamente a MESMA pessoa (mesmo CPF ou mesmo nome). Contratos
     * legados sem snapshot continuam usando a relação integralmente.
     */
    private resolverAlunoCompradorContrato(
        alunoRelacao: Record<string, any> | null | undefined,
        alunoSnapshotRaw: Record<string, any> | null | undefined,
    ): {
        id: number | null;
        nome: string | null;
        cpf: string | null;
        email: string | null;
        data_nascimento: string | Date | null;
        telefone_um: string | null;
        telefone_dois: string | null;
        polo: { id: number | null; cidade: string | null; estado: string | null };
        endereco: {
            logradouro: string;
            numero: string;
            complemento: string;
            bairro: string;
            cidade: string;
            estado: string;
            cep: string;
        };
    } {
        const normalizarNome = (valor?: string | null): string =>
            String(valor || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
        const somenteDigitos = (valor?: string | null): string => String(valor || '').replace(/\D/g, '');

        const snapshot = alunoSnapshotRaw && typeof alunoSnapshotRaw === 'object' ? alunoSnapshotRaw : {};
        const nomeSnapshot = normalizarNome(snapshot.nome);
        const cpfSnapshot = somenteDigitos(snapshot.cpf);
        const cpfRelacao = somenteDigitos(alunoRelacao?.cpf);
        // Sem snapshot (contrato legado) a relação é confiável; com snapshot,
        // a relação só é usada como complemento se for a mesma pessoa.
        const relacaoConfiavel = !nomeSnapshot
            ? alunoRelacao || null
            : alunoRelacao && ((cpfSnapshot && cpfRelacao && cpfSnapshot === cpfRelacao) || normalizarNome(alunoRelacao?.nome) === nomeSnapshot)
              ? alunoRelacao
              : null;

        const poloSnapshot = snapshot.polo && typeof snapshot.polo === 'object' ? snapshot.polo : {};
        const poloRelacao = relacaoConfiavel?.id_polo_fk || null;
        // O snapshot da criação grava o endereço em campos achatados
        // (logradouro/numero/...); vendas antigas podem ter o objeto `endereco`.
        const enderecoSnapshot: Record<string, string> =
            snapshot.endereco && typeof snapshot.endereco === 'object'
                ? snapshot.endereco
                : {
                      logradouro: snapshot.logradouro || '',
                      numero: snapshot.numero || '',
                      complemento: snapshot.complemento || '',
                      bairro: snapshot.bairro || '',
                      cidade: snapshot.cidade || '',
                      estado: snapshot.estado || '',
                      cep: snapshot.cep || '',
                  };
        const temEnderecoSnapshot = Object.values(enderecoSnapshot).some((valor) => String(valor || '').trim());

        return {
            id: snapshot.id ?? relacaoConfiavel?.id ?? null,
            nome: snapshot.nome ?? relacaoConfiavel?.nome ?? null,
            cpf: snapshot.cpf ?? relacaoConfiavel?.cpf ?? null,
            email: snapshot.email ?? relacaoConfiavel?.email ?? null,
            data_nascimento: snapshot.data_nascimento ?? relacaoConfiavel?.data_nascimento ?? null,
            telefone_um: snapshot.telefone_um ?? relacaoConfiavel?.telefone_um ?? null,
            telefone_dois: snapshot.telefone_dois ?? relacaoConfiavel?.telefone_dois ?? null,
            polo: {
                id: poloSnapshot.id ?? poloRelacao?.id ?? null,
                cidade: poloSnapshot.cidade ?? poloRelacao?.cidade ?? null,
                estado: poloSnapshot.estado ?? poloRelacao?.estado ?? null,
            },
            endereco: temEnderecoSnapshot
                ? {
                      logradouro: enderecoSnapshot.logradouro || '',
                      numero: enderecoSnapshot.numero || '',
                      complemento: enderecoSnapshot.complemento || '',
                      bairro: enderecoSnapshot.bairro || '',
                      cidade: enderecoSnapshot.cidade || '',
                      estado: enderecoSnapshot.estado || '',
                      cep: enderecoSnapshot.cep || '',
                  }
                : {
                      logradouro: relacaoConfiavel?.logradouro || '',
                      numero: relacaoConfiavel?.numero || '',
                      complemento: relacaoConfiavel?.complemento || '',
                      bairro: relacaoConfiavel?.bairro || '',
                      cidade: relacaoConfiavel?.cidade || poloRelacao?.cidade || '',
                      estado: relacaoConfiavel?.estado || poloRelacao?.estado || '',
                      cep: relacaoConfiavel?.cep || '',
                  },
        };
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

    /**
     * Deriva as colunas materializadas do Histórico de Vendas a partir do JSON
     * `dados_contrato` (+ criado_por). Mantém listagem/resumo/filtros sem parse
     * de blobs/cláusulas em runtime.
     */
    private montarColunasHistoricoVenda(
        dadosContratoRaw: Record<string, any> | null | undefined,
        criadoPor?: number | string | null,
    ): {
        hist_qtd_inscricoes: number;
        hist_qtd_bonus: number;
        hist_pendencia_pagamento: boolean;
        hist_receita_total: number;
        hist_canal_venda: 'MASTERCLASS' | 'EVENTOS' | 'TIME_VENDAS';
        hist_treinamento_origem: string | null;
        hist_turma_origem: string | null;
        hist_turma_destino: string | null;
        hist_vendedor_id: number | null;
    } {
        const dadosContrato = dadosContratoRaw || {};
        const contratoFake = { dados_contrato: dadosContrato };
        const turmaAluno = dadosContrato?.turma_aluno || {};
        const camposVariaveis = (dadosContrato?.campos_variaveis || {}) as Record<string, string>;
        const contratoMapeado = {
            turma_aluno: {
                quantidade_inscricoes: Number(turmaAluno?.quantidade_inscricoes ?? 1) || 1,
                outros_clientes: Array.isArray(turmaAluno?.outros_clientes) ? turmaAluno.outros_clientes : [],
                pendencia_pagamento: Boolean(turmaAluno?.pendencia_pagamento),
            },
            dados_contrato: dadosContrato,
        };
        const treinamentoOrigem = String(this.extrairTreinamentoOrigemServidor(contratoFake) || '').trim();
        const turmaOrigem = String(this.extrairTurmaOrigemServidor(contratoFake) || '').trim();
        const turmaDestino = String(this.extrairTurmaDestinoServidor(contratoFake) || '').trim();
        const criadoPorConfronto = dadosContrato?.criado_por_confronto || {};
        const vendedorCandidatos = [criadoPorConfronto?.consolidado, criadoPor, dadosContrato?.criado_por, criadoPorConfronto?.contrato];
        let histVendedorId: number | null = null;
        for (const candidato of vendedorCandidatos) {
            const id = Number(candidato);
            if (Number.isFinite(id) && id > 0) {
                histVendedorId = id;
                break;
            }
        }

        return {
            hist_qtd_inscricoes: this.obterQuantidadeInscricoesVendidasResumo(contratoMapeado),
            hist_qtd_bonus: this.obterQuantidadeInscricoesBonusResumoHistorico(contratoMapeado),
            hist_pendencia_pagamento: Boolean(turmaAluno?.pendencia_pagamento),
            hist_receita_total: this.obterValorTotalVendaResumo(dadosContrato),
            hist_canal_venda: this.inferirCanalVendaServidor(treinamentoOrigem, turmaOrigem, camposVariaveis),
            hist_treinamento_origem: treinamentoOrigem ? treinamentoOrigem.slice(0, 255) : null,
            hist_turma_origem: turmaOrigem ? turmaOrigem.slice(0, 255) : null,
            hist_turma_destino: turmaDestino ? turmaDestino.slice(0, 255) : null,
            hist_vendedor_id: histVendedorId,
        };
    }

    private obterIdsTurmasParaStaffLider(
        dadosContratoRaw: Record<string, any> | null | undefined,
        extras: Array<string | number | null | undefined> = [],
    ): number[] {
        const dadosContrato = dadosContratoRaw || {};
        const candidatos = [
            ...extras,
            dadosContrato?.fluxo_evento_origem_id_turma,
            dadosContrato?.id_turma_origem,
            dadosContrato?.turma_origem?.id,
            dadosContrato?.fluxo_evento_destino_id_turma,
            dadosContrato?.id_turma_destino,
            dadosContrato?.turma?.id,
        ];
        return Array.from(new Set(candidatos.map((valor) => Number(valor)).filter((valor) => Number.isFinite(valor) && valor > 0)));
    }

    private async obterMapaLiderIprCacheado(): Promise<{
        timesPorTurma: Map<number, Array<{ id: string; nome: string; liderId: string; membrosIds: string[] }>>;
        liderPorMembroGlobal: Map<string, string>;
        timesPorLider: Map<string, Set<string>>;
    }> {
        if (this.mapaLiderIprCache && this.mapaLiderIprCache.expiresAt > Date.now()) {
            return this.mapaLiderIprCache;
        }

        const turmas = await this.uow.turmasRP.find({
            where: { deletado_em: IsNull() },
            relations: ['id_treinamento_fk'],
        });

        const timesPorTurma = new Map<number, Array<{ id: string; nome: string; liderId: string; membrosIds: string[] }>>();
        const liderPorMembroGlobal = new Map<string, string>();
        const timesPorLider = new Map<string, Set<string>>();

        turmas.forEach((turma) => {
            const ehIpr = this.turmaEhImersaoProsperarHistorico(turma?.id_treinamento_fk?.sigla_treinamento, turma?.id_treinamento_fk?.treinamento);
            if (!ehIpr) {
                timesPorTurma.set(turma.id, []);
                return;
            }
            const times = Array.isArray(turma.times_equipes) ? turma.times_equipes : [];
            const timesNorm = times.map((time) => ({
                id: String(time.id || ''),
                nome: String(time.nome || ''),
                liderId: String(time.liderId || '').trim(),
                membrosIds: Array.isArray(time.membrosIds) ? time.membrosIds.map((id) => String(id).trim()) : [],
            }));
            timesPorTurma.set(turma.id, timesNorm);
            timesNorm.forEach((time) => {
                if (!time.liderId) return;
                liderPorMembroGlobal.set(time.liderId, time.liderId);
                if (time.nome) {
                    const set = timesPorLider.get(time.liderId) || new Set<string>();
                    set.add(time.nome);
                    timesPorLider.set(time.liderId, set);
                }
                time.membrosIds.forEach((membroId) => {
                    if (membroId) liderPorMembroGlobal.set(membroId, time.liderId);
                });
            });
        });

        this.mapaLiderIprCache = {
            expiresAt: Date.now() + this.mapaLiderIprCacheTtlMs,
            timesPorTurma,
            liderPorMembroGlobal,
            timesPorLider,
        };
        return this.mapaLiderIprCache;
    }

    private async resolverHistStaffLiderId(vendedorId: number | null, idsTurmas: number[]): Promise<number | null> {
        if (!vendedorId) return null;
        const vendedorKey = String(vendedorId);
        const { timesPorTurma, liderPorMembroGlobal } = await this.obterMapaLiderIprCacheado();
        const timesDaVenda = idsTurmas.flatMap((idTurma) => timesPorTurma.get(idTurma) || []);
        const timeDoVendedor = timesDaVenda.find((time) => time.liderId === vendedorKey || time.membrosIds.includes(vendedorKey));
        const liderId = timeDoVendedor?.liderId || liderPorMembroGlobal.get(vendedorKey) || '';
        const parsed = Number(liderId);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    private async montarColunasHistoricoVendaCompletas(
        dadosContratoRaw: Record<string, any> | null | undefined,
        criadoPor?: number | string | null,
        idsTurmasExtras: Array<string | number | null | undefined> = [],
    ): Promise<{
        hist_qtd_inscricoes: number;
        hist_qtd_bonus: number;
        hist_pendencia_pagamento: boolean;
        hist_receita_total: number;
        hist_canal_venda: 'MASTERCLASS' | 'EVENTOS' | 'TIME_VENDAS';
        hist_treinamento_origem: string | null;
        hist_turma_origem: string | null;
        hist_turma_destino: string | null;
        hist_vendedor_id: number | null;
        hist_staff_lider_id: number | null;
    }> {
        const base = this.montarColunasHistoricoVenda(dadosContratoRaw, criadoPor);
        const idsTurmas = this.obterIdsTurmasParaStaffLider(dadosContratoRaw, idsTurmasExtras);
        const hist_staff_lider_id = await this.resolverHistStaffLiderId(base.hist_vendedor_id, idsTurmas);
        return { ...base, hist_staff_lider_id };
    }

    /**
     * Recalcula hist_staff_lider_id de todos os contratos ativos (ex.: após editar times IPR).
     */
    async recalcularHistStaffLiderContratos(): Promise<{ atualizados: number }> {
        const { timesPorTurma, liderPorMembroGlobal } = await this.obterMapaLiderIprCacheado();
        const contratos = await this.uow.turmasAlunosTreinamentosContratosRP
            .createQueryBuilder('contrato')
            .leftJoin('contrato.id_turma_aluno_treinamento_fk', 'tat')
            .leftJoin('tat.id_turma_aluno_fk', 'ta')
            .select('contrato.id', 'id')
            .addSelect('contrato.hist_vendedor_id', 'hist_vendedor_id')
            .addSelect('contrato.hist_staff_lider_id', 'hist_staff_lider_id')
            .addSelect('ta.id_turma', 'id_turma')
            .addSelect('tat.id_turma_destino', 'id_turma_destino')
            .addSelect(`contrato.dados_contrato->>'fluxo_evento_origem_id_turma'`, 'origem_id')
            .addSelect(`contrato.dados_contrato->>'fluxo_evento_destino_id_turma'`, 'destino_id')
            .where('contrato.deletado_em IS NULL')
            .getRawMany<{
                id: string;
                hist_vendedor_id?: string | number | null;
                hist_staff_lider_id?: string | number | null;
                id_turma?: string | number | null;
                id_turma_destino?: string | number | null;
                origem_id?: string | number | null;
                destino_id?: string | number | null;
            }>();

        let atualizados = 0;
        const chunkSize = 200;
        for (let i = 0; i < contratos.length; i += chunkSize) {
            const chunk = contratos.slice(i, i + chunkSize);
            await Promise.all(
                chunk.map(async (row) => {
                    const vendedorId = Number(row.hist_vendedor_id);
                    if (!Number.isFinite(vendedorId) || vendedorId <= 0) {
                        if (row.hist_staff_lider_id !== null && row.hist_staff_lider_id !== undefined) {
                            await this.uow.turmasAlunosTreinamentosContratosRP.update(row.id, { hist_staff_lider_id: null });
                            atualizados += 1;
                        }
                        return;
                    }
                    const vendedorKey = String(vendedorId);
                    const idsTurmas = [row.id_turma, row.id_turma_destino, row.origem_id, row.destino_id]
                        .map((v) => Number(v))
                        .filter((v) => Number.isFinite(v) && v > 0);
                    const timesDaVenda = idsTurmas.flatMap((idTurma) => timesPorTurma.get(idTurma) || []);
                    const timeDoVendedor = timesDaVenda.find((time) => time.liderId === vendedorKey || time.membrosIds.includes(vendedorKey));
                    const liderStr = timeDoVendedor?.liderId || liderPorMembroGlobal.get(vendedorKey) || '';
                    const liderId = Number(liderStr);
                    const novo = Number.isFinite(liderId) && liderId > 0 ? liderId : null;
                    const atual = row.hist_staff_lider_id === null || row.hist_staff_lider_id === undefined ? null : Number(row.hist_staff_lider_id);
                    if (atual !== novo) {
                        await this.uow.turmasAlunosTreinamentosContratosRP.update(row.id, { hist_staff_lider_id: novo });
                        atualizados += 1;
                    }
                }),
            );
        }

        this.invalidarCachesHistoricoVendas();
        this.logger.log(`contract.historico.staffLider.recalc | atualizados=${atualizados} total=${contratos.length}`);
        return { atualizados };
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
            turmaViaRelacao ||
            (contrato?.fluxo_evento_destino_turma || '').trim() ||
            String(dadosContrato?.fluxo_evento_destino_turma || '').trim() ||
            camposVariaveis['Turma de Destino'] ||
            camposVariaveis['Turma Destino'] ||
            ''
        );
    }

    private ehModoFiltroTurma(tipo?: string | null): boolean {
        return tipo === 'treinamento' || tipo === 'turma';
    }

    /**
     * Expressões SQL COMPARTILHADAS entre a listagem (`listarContratosBanco`) e
     * as opções de filtro (`listarOpcoesFiltrosOrigem`). Opções e filtro DEVEM
     * usar exatamente a mesma expressão, senão o rótulo exibido nunca casa com
     * o valor comparado e o filtro volta vazio.
     *
     * Requerem os joins: turma_origem_evento/treinamento_origem_evento,
     * turma_destino_evento/treinamento_destino_evento, turma_destino_tat/
     * treinamento_destino_tat, tat, ta e turma_destino/treinamento_destino.
     */
    private get sqlIdTurmaOrigemHistorico(): string {
        return `NULLIF(COALESCE(
            contrato.dados_contrato->>'fluxo_evento_origem_id_turma',
            contrato.dados_contrato->>'id_turma_origem',
            contrato.dados_contrato->'turma_origem'->>'id',
            ''
        ), '')::int`;
    }

    private get sqlIdTurmaDestinoHistorico(): string {
        return `NULLIF(COALESCE(
            contrato.dados_contrato->>'fluxo_evento_destino_id_turma',
            contrato.dados_contrato->>'id_turma_destino',
            contrato.dados_contrato->'turma'->>'id',
            tat.id_turma_destino::text,
            ta.id_turma::text,
            ''
        ), '')::int`;
    }

    /** Treinamento de origem: resolve pela relação antes dos textos crus. */
    private get sqlTreinamentoOrigemHistoricoDisplay(): string {
        return `TRIM(COALESCE(
            NULLIF(treinamento_origem_evento.treinamento, ''),
            NULLIF(contrato.dados_contrato->>'fluxo_evento_origem_treinamento', ''),
            NULLIF(contrato.dados_contrato->'campos_variaveis'->>'Treinamento de Origem', ''),
            NULLIF(contrato.dados_contrato->'campos_variaveis'->>'Treinamento Origem', ''),
            NULLIF(contrato.dados_contrato->'campos_variaveis'->>'Treinamento de Entrada', ''),
            ''
        ))`;
    }

    /**
     * Turma de origem normalizada "Treinamento - Edição": resolve pela relação
     * (id do dados_contrato) com prioridade sobre os textos crus, igual à turma
     * de destino — senão a opção exibiria só o nº da edição.
     */
    private get sqlTurmaOrigemHistoricoDisplay(): string {
        return `TRIM(COALESCE(
            CASE
                WHEN treinamento_origem_evento.treinamento IS NOT NULL AND turma_origem_evento.edicao_turma IS NOT NULL
                    THEN CONCAT(treinamento_origem_evento.treinamento, ' - ', turma_origem_evento.edicao_turma)
                ELSE NULL
            END,
            NULLIF(contrato.dados_contrato->>'fluxo_evento_origem_turma', ''),
            NULLIF(contrato.dados_contrato->'campos_variaveis'->>'Turma de Origem', ''),
            NULLIF(contrato.dados_contrato->'campos_variaveis'->>'Turma Origem', ''),
            NULLIF(treinamento_origem_evento.treinamento, ''),
            ''
        ))`;
    }

    /** Turma de destino normalizada "Treinamento - Edição" (relação primeiro). */
    private get sqlTurmaDestinoHistoricoDisplay(): string {
        return `TRIM(COALESCE(
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
        ))`;
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

    private invalidarCachesHistoricoVendas(): void {
        this.historicoVendasCacheVersao += 1;
        this.contratosBancoCache.clear();
        this.resumoHistoricoCache.clear();
        this.mapaLiderIprCache = null;
    }

    limparCachesHistorico(): {
        contratosBancoRemovidos: number;
        opcoesOrigemRemovidas: number;
        resumoHistoricoRemovidos: number;
        versao: number;
    } {
        const contratosBancoRemovidos = this.contratosBancoCache.size;
        const opcoesOrigemRemovidas = this.opcoesOrigemCache.size;
        const resumoHistoricoRemovidos = this.resumoHistoricoCache.size;

        this.invalidarCachesHistoricoVendas();
        this.opcoesOrigemCache.clear();

        this.logger.log(
            `contract.cache.clear | contratosBanco=${contratosBancoRemovidos} opcoesOrigem=${opcoesOrigemRemovidas} resumo=${resumoHistoricoRemovidos} versao=${this.historicoVendasCacheVersao}`,
        );

        return {
            contratosBancoRemovidos,
            opcoesOrigemRemovidas,
            resumoHistoricoRemovidos,
            versao: this.historicoVendasCacheVersao,
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
            // A edição NUNCA pode sair vazia (gravaria "Turma 1:  (19 ...)" e o
            // frontend perderia o vínculo turma↔bônus): quando o payload não
            // trouxer a edição (ex.: turma fora da lista carregada na tela),
            // resolve pelo banco; em último caso usa o próprio id da turma.
            const edicoesResolvidas = new Map<number, string>();
            for (const linha of linhasValidas) {
                const edicaoPayload = String(linha.edicao_turma || '').trim();
                if (edicaoPayload) {
                    edicoesResolvidas.set(linha.id_turma, edicaoPayload);
                    continue;
                }
                const turma = await this.uow.turmasRP.findOne({ where: { id: linha.id_turma }, withDeleted: true });
                edicoesResolvidas.set(linha.id_turma, String(turma?.edicao_turma || '').trim() || String(linha.id_turma));
            }
            const partes = linhasValidas.map((linha, index) => `Turma ${index + 1}: ${edicoesResolvidas.get(linha.id_turma)} (${linha.quantidade} inscrição(ões))`);
            camposVariaveis['Turmas do Imersão Prosperar'] = partes.join('|');
        }

        dadosContrato.campos_variaveis = camposVariaveis;
        await this.uow.turmasAlunosTreinamentosContratosRP.update(contrato.id, {
            dados_contrato: dadosContrato,
            ...(await this.montarColunasHistoricoVendaCompletas(dadosContrato, contrato.criado_por)),
        });
        this.invalidarCachesHistoricoVendas();

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
        this.invalidarCachesHistoricoVendas();

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
        this.invalidarCachesHistoricoVendas();

        return { atualizado: true, total: comprovantesArray.length };
    }

    /**
     * Lista compras (contratos ativos) que podem estar ligadas ao MESMO
     * comprovante de pagamento de uma venda em andamento: contratos com a
     * mesma turma de ORIGEM e/ou criados no mesmo dia. Usado pelo autocomplete
     * da etapa de comprovantes do fluxo de venda para identificar quem está
     * pagando para quem.
     */
    async listarComprasVinculaveisComprovante(params: { id_turma_origem?: number; data?: string; termo?: string }): Promise<{
        data: Array<{
            id: string;
            aluno_nome: string;
            treinamento: string;
            turma_destino: string | null;
            criado_em: Date | string;
            valor_total: string | number | null;
            mesma_turma_origem: boolean;
            mesmo_dia: boolean;
        }>;
    }> {
        const idTurma = Number(params.id_turma_origem);
        const temTurma = Number.isFinite(idTurma) && idTurma > 0;
        const dia = String(params.data || '').trim();
        const temDia = /^\d{4}-\d{2}-\d{2}$/.test(dia);
        if (!temTurma && !temDia) {
            return { data: [] };
        }

        const sqlAlunoNome = `COALESCE(NULLIF(TRIM(contrato.dados_contrato->'aluno'->>'nome'), ''), aluno.nome, '')`;
        const sqlTreinamento = `COALESCE(
            NULLIF(TRIM(contrato.dados_contrato->'treinamento'->>'nome'), ''),
            NULLIF(TRIM(contrato.dados_contrato->'treinamento'->>'treinamento'), ''),
            NULLIF(TRIM(contrato.dados_contrato->'campos_variaveis'->>'Nome do Treinamento Contratado'), ''),
            ''
        )`;

        const qb = this.uow.turmasAlunosTreinamentosContratosRP
            .createQueryBuilder('contrato')
            .leftJoin('contrato.id_turma_aluno_treinamento_fk', 'tat')
            .leftJoin('tat.id_turma_aluno_fk', 'ta')
            .leftJoin('ta.id_aluno_fk', 'aluno')
            .select('contrato.id', 'id')
            .addSelect(sqlAlunoNome, 'aluno_nome')
            .addSelect(sqlTreinamento, 'treinamento')
            .addSelect('contrato.hist_turma_destino', 'turma_destino')
            .addSelect('contrato.criado_em', 'criado_em')
            .addSelect('contrato.hist_receita_total', 'valor_total')
            .addSelect('ta.id_turma', 'id_turma_matricula')
            .addSelect(this.sqlIdTurmaOrigemHistorico, 'id_turma_origem_snapshot')
            .where('contrato.deletado_em IS NULL')
            .andWhere(
                new Brackets((w) => {
                    if (temTurma) {
                        w.orWhere(`(ta.id_turma = :idTurmaVinculo OR ${this.sqlIdTurmaOrigemHistorico} = :idTurmaVinculo)`, { idTurmaVinculo: idTurma });
                    }
                    if (temDia) {
                        w.orWhere('contrato.criado_em::date = :diaVinculo', { diaVinculo: dia });
                    }
                }),
            );

        const termo = normalizarTermoBusca(params.termo);
        if (termo) {
            // Busca por nome desconsiderando acentos e caracteres especiais.
            qb.andWhere(`${sqlBuscaNormalizada(`(${sqlAlunoNome})`)} LIKE :termoVinculo`, { termoVinculo: `%${termo}%` });
        }

        const rows = await qb.orderBy('contrato.criado_em', 'DESC').limit(200).getRawMany<{
            id: string;
            aluno_nome: string;
            treinamento: string;
            turma_destino: string | null;
            criado_em: Date | string;
            valor_total: string | number | null;
            id_turma_matricula: string | number | null;
            id_turma_origem_snapshot: string | number | null;
        }>();

        return {
            data: rows.map((row) => {
                const idsOrigem = [Number(row.id_turma_matricula), Number(row.id_turma_origem_snapshot)].filter((v) => Number.isFinite(v) && v > 0);
                const criadoEmDia = row.criado_em ? new Date(row.criado_em).toISOString().slice(0, 10) : '';
                return {
                    id: String(row.id),
                    aluno_nome: row.aluno_nome || '',
                    treinamento: row.treinamento || '',
                    turma_destino: row.turma_destino || null,
                    criado_em: row.criado_em,
                    valor_total: row.valor_total ?? null,
                    mesma_turma_origem: temTurma && idsOrigem.includes(idTurma),
                    mesmo_dia: temDia && criadoEmDia === dia,
                };
            }),
        };
    }

    /**
     * Comprovante de pagamento compartilhado: grava nas observações internas de
     * cada compra relacionada quem está pagando por ela (comprador + id do novo
     * contrato). Chamado ao criar o contrato da venda que anexou o comprovante.
     */
    private async registrarComprovanteCompartilhadoNasCompras(
        contratoNovoId: string,
        nomeCompradorPagante: string,
        vinculos?: Array<{ contrato_id: number; aluno_nome?: string }>,
    ): Promise<void> {
        const lista = (vinculos || []).filter((v) => Number.isFinite(Number(v?.contrato_id)) && Number(v.contrato_id) > 0);
        if (lista.length === 0) return;

        const agora = new Date();
        const chaveObs = 'Observações Internas (uso do sistema)';
        for (const vinculo of lista) {
            try {
                const contratoRelacionado = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
                    where: { id: String(vinculo.contrato_id), deletado_em: IsNull() },
                });
                if (!contratoRelacionado) continue;

                const dadosContrato = { ...(contratoRelacionado.dados_contrato || {}) };
                const camposVariaveis = { ...(dadosContrato.campos_variaveis || {}) };
                const linhaVinculo =
                    `Comprovante de pagamento compartilhado: o pagamento desta compra está no comprovante anexado na venda de ` +
                    `${nomeCompradorPagante || 'comprador não identificado'} (contrato ID ${contratoNovoId}) - ${this.formatarDataHoraBr(agora)}`;
                const textoAtual = String(camposVariaveis[chaveObs] || '').trim();
                const textoBase = textoAtual && textoAtual !== '—' ? textoAtual : '';
                camposVariaveis[chaveObs] = [textoBase, linhaVinculo].filter(Boolean).join('\n');
                dadosContrato.campos_variaveis = camposVariaveis;

                await this.uow.turmasAlunosTreinamentosContratosRP.update(contratoRelacionado.id, {
                    dados_contrato: dadosContrato,
                });
            } catch (error) {
                this.logger.warn(
                    `contract.comprovante.vinculo | Falha ao registrar vínculo no contrato ${vinculo.contrato_id}: ${
                        error instanceof Error ? error.message : 'Erro desconhecido'
                    }`,
                );
            }
        }
        this.invalidarCachesHistoricoVendas();
    }

    // Atualiza os dados DA VENDA (quantidade de inscrições, outros clientes e
    // pendência) no snapshot por venda `dados_contrato.turma_aluno` e nos
    // campos variáveis do contrato. A listagem do histórico prioriza esse
    // snapshot sobre a matrícula compartilhada da turma de origem (que carrega
    // valores de outras vendas), então editar SÓ a matrícula não altera o que
    // é exibido — este método é o que faz a edição da venda refletir na tela.
    async atualizarDadosVendaContratoHistorico(
        contratoId: string,
        dados: {
            quantidade_inscricoes?: number;
            outros_clientes?: Array<{ id?: string; nome?: string; email?: string; telefone?: string }>;
            pendencia_pagamento?: boolean;
        },
        userId?: number,
    ): Promise<{ atualizado: boolean }> {
        const contrato = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
            where: { id: contratoId, deletado_em: IsNull() },
        });
        if (!contrato) {
            throw new NotFoundException('Contrato não encontrado');
        }

        const dadosContrato = { ...(contrato.dados_contrato || {}) };
        const turmaAlunoSnapshot = { ...(dadosContrato.turma_aluno || {}) };
        const camposVariaveis = { ...(dadosContrato.campos_variaveis || {}) };
        const alteracoes: string[] = [];

        if (dados.quantidade_inscricoes !== undefined) {
            const quantidade = Math.max(1, Math.trunc(Number(dados.quantidade_inscricoes) || 1));
            const anterior = Number(turmaAlunoSnapshot.quantidade_inscricoes) || null;
            turmaAlunoSnapshot.quantidade_inscricoes = quantidade;
            // O frontend/resumo calculam max(snapshot, campos variáveis, outros
            // clientes + 1); sem sincronizar os campos variáveis, uma redução de
            // quantidade nunca refletiria na tela.
            camposVariaveis['Quantidade de Inscrições'] = String(quantidade);
            delete camposVariaveis['Quantidade de Inscricoes'];
            alteracoes.push(
                anterior && anterior !== quantidade ? `Quantidade de inscrições: ${anterior} → ${quantidade}` : `Quantidade de inscrições: ${quantidade}`,
            );
        }
        if (dados.outros_clientes !== undefined) {
            turmaAlunoSnapshot.outros_clientes = Array.isArray(dados.outros_clientes) ? dados.outros_clientes : [];
            // O snapshot por venda tem prioridade sobre compradores_adicionais na
            // exibição; manter os dois coerentes evita listas divergentes.
            if (Array.isArray(dadosContrato.compradores_adicionais)) {
                dadosContrato.compradores_adicionais = turmaAlunoSnapshot.outros_clientes;
            }
            alteracoes.push(`Outros clientes: ${turmaAlunoSnapshot.outros_clientes.length}`);
        }
        if (dados.pendencia_pagamento !== undefined) {
            turmaAlunoSnapshot.pendencia_pagamento = Boolean(dados.pendencia_pagamento);
            if (dados.pendencia_pagamento) {
                camposVariaveis['Pendência de Pagamento'] = 'true';
            } else {
                camposVariaveis['Pendência de Pagamento'] = 'false';
            }
            alteracoes.push(`Pendência de pagamento: ${dados.pendencia_pagamento ? 'sim' : 'não'}`);
        }

        dadosContrato.turma_aluno = turmaAlunoSnapshot;
        dadosContrato.campos_variaveis = camposVariaveis;
        await this.uow.turmasAlunosTreinamentosContratosRP.update(contrato.id, {
            dados_contrato: dadosContrato,
            ...(await this.montarColunasHistoricoVendaCompletas(dadosContrato, contrato.criado_por)),
        });
        this.invalidarCachesHistoricoVendas();

        await this.notificarAtualizacaoVenda(contrato.id, dadosContrato, alteracoes, userId);

        return { atualizado: true };
    }

    /**
     * Notifica a líder do Cuidado de Alunos e a acessora da turma de destino
     * sobre uma ATUALIZAÇÃO de venda no Histórico. Mesmo formato claro da
     * exclusão. Nunca lança (falha em notificar não derruba a edição).
     */
    private async notificarAtualizacaoVenda(contratoId: string, dadosContrato: any, alteracoes: string[], userId?: number): Promise<void> {
        try {
            if (!alteracoes || alteracoes.length === 0) {
                return;
            }

            const nomeAluno = dadosContrato?.aluno?.nome || 'Aluno não identificado';
            const idTurmaDestino = this.resolverIdTurmaDestinoContrato(dadosContrato, null);
            const destinatarios = await this.resolverDestinatariosMudancaVenda(idTurmaDestino);
            if (destinatarios.length === 0) {
                return;
            }

            let nomeUsuario: string | null = null;
            if (userId) {
                const usuario = await this.uow.usuariosRP.findOne({
                    where: { id: userId },
                    select: ['id', 'nome'] as any,
                    withDeleted: true,
                });
                nomeUsuario = usuario?.nome || null;
            }

            const agora = new Date();
            const linhasMensagem = [
                `Aluno: ${nomeAluno}`,
                `Atualizado por: ${nomeUsuario || 'Usuário não identificado'} - ${this.formatarDataHoraBr(agora)}`,
                `Alterações: ${alteracoes.join('; ')}`,
            ];

            await this.notificacoesService.criarNotificacaoParaUsuarios(
                {
                    tipo: 'VENDA_ATUALIZADA',
                    titulo: `Venda atualizada: ID ${contratoId}`,
                    mensagem: linhasMensagem.join('\n'),
                    setorDestino: ESetores.CUIDADO_DE_ALUNOS,
                    criadoPor: userId,
                    dados: {
                        id_contrato: contratoId,
                        nome_aluno: nomeAluno,
                        id_turma_destino: idTurmaDestino,
                        alteracoes,
                        atualizado_por: userId ?? null,
                        atualizado_por_nome: nomeUsuario,
                        atualizado_em: agora.toISOString(),
                    },
                },
                destinatarios,
            );
        } catch (error) {
            this.logger.warn(
                `notificacoes.venda.atualizada | Falha ao notificar atualização do contrato ${contratoId}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
            );
        }
    }

    /**
     * Ações do card de pendência no dashboard (vencidas / no prazo):
     * quitar, reabrir prazo, flag solicitou cancelamento, append observação.
     */
    async atualizarPendenciaRecebivelContrato(
        contratoId: string,
        body: {
            quitar?: boolean;
            reabrir?: { data_vencimento?: string };
            solicitou_cancelamento?: boolean;
            observacao?: string;
            autor?: string;
        },
    ): Promise<{ atualizado: boolean }> {
        const contrato = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
            where: { id: contratoId, deletado_em: IsNull() },
        });
        if (!contrato) {
            throw new NotFoundException('Contrato não encontrado');
        }

        const dadosContrato = { ...(contrato.dados_contrato || {}) };
        const turmaAlunoSnapshot = { ...(dadosContrato.turma_aluno || {}) };
        const camposVariaveis = { ...(dadosContrato.campos_variaveis || {}) };

        const formatarDataBr = (isoOuBr: string): string | null => {
            const bruto = String(isoOuBr || '').trim();
            if (!bruto) return null;
            const br = bruto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            if (br) return `${br[1]}/${br[2]}/${br[3]}`;
            const iso = bruto.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
            const d = new Date(bruto);
            if (Number.isNaN(d.getTime())) return null;
            const dia = String(d.getDate()).padStart(2, '0');
            const mes = String(d.getMonth() + 1).padStart(2, '0');
            return `${dia}/${mes}/${d.getFullYear()}`;
        };

        if (body.quitar === true) {
            turmaAlunoSnapshot.pendencia_pagamento = false;
            camposVariaveis['Pendência de Pagamento'] = 'false';
        }

        if (body.reabrir?.data_vencimento) {
            const dataBr = formatarDataBr(body.reabrir.data_vencimento);
            if (!dataBr) {
                throw new BadRequestException('Data de vencimento inválida para reabrir a pendência.');
            }
            // Mantém pendência ativa e joga para "no prazo" via classificação.
            turmaAlunoSnapshot.pendencia_pagamento = true;
            camposVariaveis['Pendência de Pagamento'] = 'true';
            camposVariaveis['Data de Vencimento da Pendência'] = dataBr;
            // Espelha no campo de boleto para listagens que ainda leem essa chave.
            camposVariaveis['Data do Primeiro Boleto'] = dataBr;
        }

        if (typeof body.solicitou_cancelamento === 'boolean') {
            camposVariaveis['Solicitou Cancelamento'] = body.solicitou_cancelamento ? 'true' : 'false';
        }

        const textoObs = String(body.observacao || '').trim();
        if (textoObs) {
            let historico: Array<{ data: string; texto: string; autor?: string | null }> = [];
            const bruto = camposVariaveis['Histórico Observações Pendência'];
            if (typeof bruto === 'string' && bruto.trim()) {
                try {
                    const parsed = JSON.parse(bruto);
                    if (Array.isArray(parsed)) historico = parsed;
                } catch {
                    historico = [];
                }
            } else if (Array.isArray(bruto)) {
                historico = bruto as Array<{ data: string; texto: string; autor?: string | null }>;
            }

            const agora = new Date();
            const dia = String(agora.getDate()).padStart(2, '0');
            const mes = String(agora.getMonth() + 1).padStart(2, '0');
            historico.push({
                data: `${dia}/${mes}/${agora.getFullYear()}`,
                texto: textoObs,
                autor: String(body.autor || '').trim() || null,
            });
            camposVariaveis['Histórico Observações Pendência'] = JSON.stringify(historico);
        }

        dadosContrato.turma_aluno = turmaAlunoSnapshot;
        dadosContrato.campos_variaveis = camposVariaveis;
        await this.uow.turmasAlunosTreinamentosContratosRP.update(contrato.id, {
            dados_contrato: dadosContrato,
            ...(await this.montarColunasHistoricoVendaCompletas(dadosContrato, contrato.criado_por)),
        });
        this.invalidarCachesHistoricoVendas();

        return { atualizado: true };
    }

    private obterMarcadorAtualizacaoHistorico(): string {
        return String(this.historicoVendasCacheVersao);
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

        // Rótulos resolvidos "Treinamento - Edição" pelas MESMAS expressões da
        // listagem (relação via ids do dados_contrato antes dos textos crus).
        // As colunas materializadas hist_* guardam texto cru (ex.: só o nº da
        // edição) e podem estar vazias em registros antigos — usá-las aqui
        // deixava a lista de origem vazia e a de destino com números soltos.
        const opcoesQb = this.uow.turmasAlunosTreinamentosContratosRP
            .createQueryBuilder('contrato')
            .leftJoin('contrato.id_turma_aluno_treinamento_fk', 'tat')
            .leftJoin('tat.id_turma_aluno_fk', 'ta')
            .leftJoin('ta.id_turma_fk', 'turma_destino')
            .leftJoin('turma_destino.id_treinamento_fk', 'treinamento_destino')
            .leftJoin(Turmas, 'turma_origem_evento', `turma_origem_evento.id = ${this.sqlIdTurmaOrigemHistorico}`)
            .leftJoin('turma_origem_evento.id_treinamento_fk', 'treinamento_origem_evento')
            .leftJoin(Turmas, 'turma_destino_evento', `turma_destino_evento.id = ${this.sqlIdTurmaDestinoHistorico}`)
            .leftJoin('turma_destino_evento.id_treinamento_fk', 'treinamento_destino_evento')
            .leftJoin(Turmas, 'turma_destino_tat', 'turma_destino_tat.id = tat.id_turma_destino')
            .leftJoin('turma_destino_tat.id_treinamento_fk', 'treinamento_destino_tat')
            .select(this.sqlTreinamentoOrigemHistoricoDisplay, 'treinamento_origem')
            .addSelect(this.sqlTurmaOrigemHistoricoDisplay, 'turma_origem')
            .addSelect(this.sqlTurmaDestinoHistoricoDisplay, 'turma_destino')
            .addSelect('contrato.hist_canal_venda', 'canal_venda')
            .addSelect(`LOWER(COALESCE(contrato.zapsign_document_status->>'status', ''))`, 'status_documento')
            .where('contrato.deletado_em IS NULL');

        if (aplicarFiltroPeriodo) {
            opcoesQb.andWhere('contrato.criado_em BETWEEN :dataInicioPeriodo AND :dataFimPeriodo', {
                dataInicioPeriodo,
                dataFimPeriodo,
            });
        }

        if (termoBusca) {
            opcoesQb
                .leftJoin('ta.id_aluno_fk', 'aluno')
                .addSelect('aluno.nome', 'aluno_nome')
                .addSelect('aluno.email', 'aluno_email')
                .addSelect(`contrato.dados_contrato->'aluno'->>'nome'`, 'aluno_nome_snapshot')
                .addSelect(`contrato.dados_contrato->'aluno'->>'email'`, 'aluno_email_snapshot');
        }

        if (canalVendaFiltro) {
            opcoesQb.andWhere('contrato.hist_canal_venda = :canalVendaFiltro', { canalVendaFiltro });
        }
        if (somentePendenciaAtivo) {
            opcoesQb.andWhere('contrato.hist_pendencia_pagamento = true');
        }

        const linhasOpcoes = await opcoesQb.getRawMany<{
            treinamento_origem?: string | null;
            turma_origem?: string | null;
            turma_destino?: string | null;
            canal_venda?: string | null;
            status_documento?: string | null;
            aluno_nome?: string | null;
            aluno_email?: string | null;
            aluno_nome_snapshot?: string | null;
            aluno_email_snapshot?: string | null;
        }>();

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
        const turmasDestinoPorOrigem = new Map<string, Set<string>>();

        linhasOpcoes.forEach((linha) => {
            const treinamentoOrigem = String(linha.treinamento_origem || '').trim();
            const turmaOrigem = String(linha.turma_origem || '').trim();
            const turmaDestino = String(linha.turma_destino || '').trim();
            const statusDocumento = String(linha.status_documento || '');
            const concluido = this.statusContratoEhConcluido(statusDocumento);

            if (termoBusca) {
                // Compara relação E snapshot (a listagem exibe o snapshot do
                // comprador; a relação pode divergir após upsert por e-mail).
                const candidatosBusca = [linha.aluno_nome_snapshot, linha.aluno_nome, linha.aluno_email_snapshot, linha.aluno_email].map((valor) =>
                    this.normalizarTexto(valor),
                );
                if (!candidatosBusca.some((valor) => valor && valor.includes(termoBusca))) {
                    return;
                }
            }

            const matchStatus = !statusFiltro || statusFiltro === 'all' || (statusFiltro === 'completed' ? concluido : !concluido);
            if (!matchStatus) return;

            if (treinamentoOrigem) {
                treinamentos.add(treinamentoOrigem);
            }

            const origemElegivelPorNome = turmasOrigemElegiveisPorNome.has(this.normalizarTexto(turmaOrigem));
            if (
                turmaOrigem &&
                !turmaEhInvalida(turmaOrigem) &&
                (origemElegivelPorNome || Boolean(treinamentoOrigem)) &&
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
        const entradasTurmasIpr = descricaoTurmasIpr
            .split('|')
            .map((entrada) => entrada.trim())
            .filter(Boolean);
        // Entradas sem edição (ex.: "Turma 1:  (19 inscrição(ões))") são registros
        // corrompidos: sem a edição não há turma de bônus vinculável a esta venda,
        // então não contam (mesma regra do frontend).
        const quantidadesPorTurmaIpr = entradasTurmasIpr
            .filter((entrada) => /Turma\s+\d+:\s*\d{2,4}/i.test(entrada))
            .map((entrada) => {
                const parsed = Number.parseInt(entrada.match(/(\d+)\s*inscri[cç][aã]o/i)?.[1] || '', 10);
                return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
            });
        if (entradasTurmasIpr.length > 0 && quantidadesPorTurmaIpr.length === 0) {
            return 0;
        }
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

        // NÃO usar bonus_ipr_inscricoes_quantidade como fallback: esse valor é
        // contado por COMPRADOR (matrículas ALUNO_BONUS de todas as vendas) e
        // atribuía o bônus de outra venda a contratos sem bônus, inflando o
        // total consolidado. O bônus do resumo é sempre por venda
        // (campos_variaveis do próprio contrato).

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
        dados_contrato?: unknown;
        criado_por_contrato?: string | number | null;
        criado_por_tat?: string | number | null;
        criado_por_ta?: string | number | null;
        hist_vendedor_id?: string | number | null;
    }): string {
        const histVendedor = String(row.hist_vendedor_id ?? '').trim();
        if (histVendedor) return histVendedor;

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

    private obterIdsTurmasResumoHistorico(row: {
        dados_contrato?: unknown;
        id_turma?: string | number | null;
        id_turma_destino?: string | number | null;
    }): number[] {
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

    private obterMetricasLinhaHistorico(row: LinhaHistoricoVendasResumo): {
        quantidadeInscricoes: number;
        quantidadeBonus: number;
        pendenciaPagamento: boolean;
        valorTotalVenda: number;
    } {
        const histQtd = Number(row.hist_qtd_inscricoes);
        const histBonus = Number(row.hist_qtd_bonus);
        const histReceita = Number(row.hist_receita_total);
        const temHist =
            row.hist_qtd_inscricoes !== null &&
            row.hist_qtd_inscricoes !== undefined &&
            (Number.isFinite(histQtd) || Number.isFinite(histBonus) || row.hist_pendencia_pagamento !== null || Number.isFinite(histReceita));

        if (temHist) {
            return {
                quantidadeInscricoes: Number.isFinite(histQtd) && histQtd > 0 ? histQtd : 1,
                quantidadeBonus: Number.isFinite(histBonus) && histBonus > 0 ? histBonus : 0,
                pendenciaPagamento: row.hist_pendencia_pagamento === true || String(row.hist_pendencia_pagamento).toLowerCase() === 'true',
                valorTotalVenda: Number.isFinite(histReceita) && histReceita > 0 ? histReceita : 0,
            };
        }

        // Fallback legado (pré-materialização).
        const dadosContrato = this.parseJsonSeguroHistorico(row.dados_contrato);
        const turmaAlunoDados = dadosContrato?.turma_aluno || {};
        const outrosClientesRaw = (turmaAlunoDados as { outros_clientes?: unknown })?.outros_clientes ?? row.outros_clientes;
        const contratoMapeado = {
            turma_aluno: {
                quantidade_inscricoes: Number((turmaAlunoDados as { quantidade_inscricoes?: number })?.quantidade_inscricoes ?? row.quantidade_inscricoes ?? 1) || 1,
                pendencia_pagamento:
                    row.pendencia_pagamento === true ||
                    String(row.pendencia_pagamento).toLowerCase() === 'true' ||
                    Boolean((turmaAlunoDados as { pendencia_pagamento?: boolean })?.pendencia_pagamento),
                outros_clientes: Array.isArray(outrosClientesRaw) ? outrosClientesRaw : [],
            },
            dados_contrato: dadosContrato,
        };
        return {
            quantidadeInscricoes: this.obterQuantidadeInscricoesVendidasResumo(contratoMapeado),
            quantidadeBonus: this.obterQuantidadeInscricoesBonusResumoHistorico(contratoMapeado),
            pendenciaPagamento: Boolean(contratoMapeado.turma_aluno.pendencia_pagamento),
            valorTotalVenda: this.obterValorTotalVendaResumo(dadosContrato),
        };
    }

    private async carregarLinhasHistoricoVendas(
        baseQb: ReturnType<typeof this.uow.turmasAlunosTreinamentosContratosRP.createQueryBuilder>,
    ): Promise<LinhaHistoricoVendasResumo[]> {
        // Preferência: colunas materializadas (sem JSON/blobs). Fallback de ids
        // de turma ainda vem das FKs para resolver times/líder.
        const resumoRowsRaw = await baseQb
            .clone()
            .select('contrato.id', 'id')
            .addSelect('contrato.criado_em', 'criado_em')
            .addSelect('contrato.hist_qtd_inscricoes', 'hist_qtd_inscricoes')
            .addSelect('contrato.hist_qtd_bonus', 'hist_qtd_bonus')
            .addSelect('contrato.hist_pendencia_pagamento', 'hist_pendencia_pagamento')
            .addSelect('contrato.hist_receita_total', 'hist_receita_total')
            .addSelect('contrato.hist_vendedor_id', 'hist_vendedor_id')
            .addSelect('contrato.hist_staff_lider_id', 'hist_staff_lider_id')
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

    /**
     * O conceito de "Staff Líder" no Histórico de Vendas é exclusivo das turmas
     * de Imersão Prosperar (IPR): os líderes de time (e seus membros) só valem
     * quando definidos em uma turma de IPR. Turmas de outros treinamentos (ex.:
     * Confronto) também possuem `times_equipes`, mas não devem influenciar o
     * ranking/filtro de staff líder.
     */
    private turmaEhImersaoProsperarHistorico(sigla?: string | null, nome?: string | null): boolean {
        const siglaNorm = this.normalizarTexto(sigla).replace(/[^a-z]/g, '');
        const nomeNorm = this.normalizarTexto(nome);
        return siglaNorm === 'ipr' || nomeNorm.includes('imersao prosperar') || nomeNorm.includes('imersão prosperar');
    }

    private async montarMapasTimesHistorico(linhas: LinhaHistoricoVendasResumo[]): Promise<{
        timesPorTurma: Map<number, Array<{ id: string; nome: string; liderId: string; membrosIds: string[] }>>;
        liderPorMembroGlobal: Map<string, string>;
    }> {
        const idsTurmas = Array.from(new Set(linhas.flatMap((row) => this.obterIdsTurmasResumoHistorico(row))));
        const timesPorTurma = new Map<number, Array<{ id: string; nome: string; liderId: string; membrosIds: string[] }>>();
        if (idsTurmas.length > 0) {
            const turmas = await this.uow.turmasRP.find({
                where: { id: In(idsTurmas), deletado_em: IsNull() },
                relations: ['id_treinamento_fk'],
            });
            turmas.forEach((turma) => {
                // Só consideram-se times de turmas de Imersão Prosperar: em
                // outros treinamentos os `times_equipes` são ignorados para não
                // poluir o staff líder das IPR.
                const ehIpr = this.turmaEhImersaoProsperarHistorico(turma?.id_treinamento_fk?.sigla_treinamento, turma?.id_treinamento_fk?.treinamento);
                if (!ehIpr) {
                    timesPorTurma.set(turma.id, []);
                    return;
                }
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
        row: LinhaHistoricoVendasResumo,
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

    private aplicarFiltroStaffLiderNoQb(qb: ReturnType<typeof this.uow.turmasAlunosTreinamentosContratosRP.createQueryBuilder>, staffLiderId?: string): void {
        const valor = String(staffLiderId || '').trim();
        if (!valor) return;
        if (valor === this.staffLiderSemVinculoSentinela) {
            qb.andWhere('contrato.hist_staff_lider_id IS NULL');
            return;
        }
        const liderNumerico = Number(valor);
        if (Number.isFinite(liderNumerico) && liderNumerico > 0) {
            qb.andWhere('contrato.hist_staff_lider_id = :staffLiderFiltroHist', { staffLiderFiltroHist: liderNumerico });
        }
    }

    private async calcularResumoHistoricoVendas(
        baseQb: ReturnType<typeof this.uow.turmasAlunosTreinamentosContratosRP.createQueryBuilder>,
        options?: { staff_lider_id?: string; linhasPreload?: LinhaHistoricoVendasResumo[] },
    ): Promise<ResumoHistoricoVendas> {
        // Path SQL: agrega sobre contratos distintos (hist_*), sem carregar JSON.
        // linhasPreload fica só como fallback legado (pré-materialização staff).
        const staffLiderId = String(options?.staff_lider_id || '').trim();
        if (options?.linhasPreload && options.linhasPreload.length > 0 && !options.linhasPreload.some((r) => r.hist_staff_lider_id !== undefined)) {
            return this.calcularResumoHistoricoVendasEmMemoria(options.linhasPreload, staffLiderId);
        }

        const qb = baseQb.clone();
        this.aplicarFiltroStaffLiderNoQb(qb, staffLiderId);

        const distinctQb = qb
            .clone()
            .select('contrato.id', 'id')
            .addSelect('MAX(contrato.hist_qtd_inscricoes)', 'hist_qtd_inscricoes')
            .addSelect('MAX(contrato.hist_qtd_bonus)', 'hist_qtd_bonus')
            .addSelect('BOOL_OR(contrato.hist_pendencia_pagamento)', 'hist_pendencia_pagamento')
            .addSelect('MAX(contrato.hist_receita_total)', 'hist_receita_total')
            .addSelect('MAX(contrato.hist_staff_lider_id)', 'hist_staff_lider_id')
            .addSelect('MAX(COALESCE(contrato.hist_vendedor_id, contrato.criado_por))', 'hist_vendedor_id')
            .groupBy('contrato.id');

        const [subSql, subParams] = distinctQb.getQueryAndParameters();
        const manager = this.uow.turmasAlunosTreinamentosContratosRP.manager;

        const [totaisRow] = await manager.query(
            `
            SELECT
                COALESCE(SUM(q.hist_qtd_inscricoes), 0)::float AS total_inscricoes_vendidas,
                COALESCE(SUM(q.hist_qtd_bonus), 0)::float AS total_inscricoes_bonus,
                COALESCE(SUM(CASE WHEN q.hist_pendencia_pagamento THEN 1 ELSE 0 END), 0)::int AS total_com_pendencia,
                COALESCE(SUM(q.hist_receita_total), 0)::float AS receita_total
            FROM (${subSql}) q
            `,
            subParams,
        );

        const rankingRows = await manager.query(
            `
            SELECT
                q.hist_staff_lider_id AS lider_id,
                q.hist_vendedor_id AS vendedor_id,
                COALESCE(SUM(q.hist_qtd_inscricoes), 0)::float AS total_inscricoes,
                COUNT(*)::int AS total_vendas
            FROM (${subSql}) q
            GROUP BY q.hist_staff_lider_id, q.hist_vendedor_id
            `,
            subParams,
        );

        const { timesPorLider } = await this.obterMapaLiderIprCacheado();
        const idsUsuarios = Array.from(
            new Set(
                rankingRows
                    .flatMap((row) => [row.lider_id, row.vendedor_id])
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

        type TVendedorAgrupado = { id: string; nome: string; totalInscricoes: number; totalVendas: number };
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

        rankingRows.forEach((row) => {
            const vendedorId = String(row.vendedor_id || '').trim() || 'Não informado';
            const vendedorNome = nomeUsuarioPorId.get(Number(vendedorId)) || `ID ${vendedorId}`;
            const inscricoes = Number(row.total_inscricoes) || 0;
            const vendas = Number(row.total_vendas) || 0;
            const liderId = row.lider_id === null || row.lider_id === undefined || String(row.lider_id).trim() === '' ? '' : String(row.lider_id);

            if (!liderId) {
                totalInscricoesSemLider += inscricoes;
                const atual = mapaSemLider.get(vendedorId) || { vendedorNome, totalInscricoes: 0, totalVendas: 0 };
                atual.totalInscricoes += inscricoes;
                atual.totalVendas += vendas;
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
                    times: new Set<string>(Array.from(timesPorLider.get(liderId) || [])),
                } as TLiderAgrupado);

            registroLider.totalInscricoes += inscricoes;
            registroLider.totalVendas += vendas;
            const vendedorAtual =
                registroLider.vendedores[vendedorId] || ({ id: vendedorId, nome: vendedorNome, totalInscricoes: 0, totalVendas: 0 } as TVendedorAgrupado);
            vendedorAtual.totalInscricoes += inscricoes;
            vendedorAtual.totalVendas += vendas;
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
            total_inscricoes_vendidas: Number(totaisRow?.total_inscricoes_vendidas || 0),
            total_inscricoes_bonus: Number(totaisRow?.total_inscricoes_bonus || 0),
            total_com_pendencia: Number(totaisRow?.total_com_pendencia || 0),
            receita_total: Number(totaisRow?.receita_total || 0),
            ranking_staff_lider: rankingStaffLider,
            inscricoes_sem_lider: {
                total_inscricoes: totalInscricoesSemLider,
                total_vendas: vendedoresSemLider.reduce((acc, item) => acc + item.total_vendas, 0),
                vendedores: vendedoresSemLider,
            },
        };
    }

    /** Fallback legado quando hist_staff_lider_id ainda não está disponível nas linhas. */
    private async calcularResumoHistoricoVendasEmMemoria(resumoRows: LinhaHistoricoVendasResumo[], staffLiderId: string): Promise<ResumoHistoricoVendas> {
        const { timesPorTurma, liderPorMembroGlobal } = await this.montarMapasTimesHistorico(resumoRows);
        const filtrandoSemLider = staffLiderId === this.staffLiderSemVinculoSentinela;
        const linhasAtivas = staffLiderId
            ? resumoRows.filter((row) => {
                  const liderResolvido = this.resolverLiderIdLinhaHistorico(row, timesPorTurma, liderPorMembroGlobal);
                  return filtrandoSemLider ? !liderResolvido : liderResolvido === staffLiderId;
              })
            : resumoRows;

        const resumoBase = linhasAtivas.reduce(
            (acc, row) => {
                const metricas = this.obterMetricasLinhaHistorico(row);
                acc.total_inscricoes_vendidas += metricas.quantidadeInscricoes;
                acc.total_inscricoes_bonus += metricas.quantidadeBonus;
                if (metricas.pendenciaPagamento) acc.total_com_pendencia += 1;
                acc.receita_total += metricas.valorTotalVenda;
                return acc;
            },
            { total_inscricoes_vendidas: 0, total_inscricoes_bonus: 0, total_com_pendencia: 0, receita_total: 0 },
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
                nomeUsuarioPorId.set(usuario.id, usuario.nome || `${usuario.primeiro_nome || ''} ${usuario.sobrenome || ''}`.trim() || `Usuário ${usuario.id}`);
            });
        }

        type TVendedorAgrupado = { id: string; nome: string; totalInscricoes: number; totalVendas: number };
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
            const inscricoesDaVenda = this.obterMetricasLinhaHistorico(row).quantidadeInscricoes;
            const liderId = this.resolverLiderIdLinhaHistorico(row, timesPorTurma, liderPorMembroGlobal);
            if (!liderId) {
                totalInscricoesSemLider += inscricoesDaVenda;
                const atual = mapaSemLider.get(vendedorId) || { vendedorNome, totalInscricoes: 0, totalVendas: 0 };
                atual.totalInscricoes += inscricoesDaVenda;
                atual.totalVendas += 1;
                mapaSemLider.set(vendedorId, atual);
                return;
            }
            const liderNome = nomeUsuarioPorId.get(Number(liderId)) || (liderId === vendedorId ? vendedorNome : `Líder ID ${liderId}`);
            const registroLider =
                mapaLider.get(liderId) || ({ liderId, liderNome, totalInscricoes: 0, totalVendas: 0, vendedores: {}, times: new Set<string>() } as TLiderAgrupado);
            registroLider.totalInscricoes += inscricoesDaVenda;
            registroLider.totalVendas += 1;
            const idsTurmaDaVenda = this.obterIdsTurmasResumoHistorico(row);
            const timesDaVenda = idsTurmaDaVenda.flatMap((idTurma) => timesPorTurma.get(idTurma) || []);
            const timeDoVendedor = timesDaVenda.find((time) => time.liderId === vendedorId || time.membrosIds.includes(vendedorId));
            if (timeDoVendedor?.nome) registroLider.times.add(timeDoVendedor.nome);
            const vendedorAtual =
                registroLider.vendedores[vendedorId] || ({ id: vendedorId, nome: vendedorNome, totalInscricoes: 0, totalVendas: 0 } as TVendedorAgrupado);
            vendedorAtual.totalInscricoes += inscricoesDaVenda;
            vendedorAtual.totalVendas += 1;
            registroLider.vendedores[vendedorId] = vendedorAtual;
            mapaLider.set(liderId, registroLider);
        });

        return {
            ...resumoBase,
            ranking_staff_lider: Array.from(mapaLider.values())
                .map((item) => ({
                    lider_id: item.liderId,
                    lider_nome: item.liderNome,
                    total_inscricoes: item.totalInscricoes,
                    total_vendas: item.totalVendas,
                    times: Array.from(item.times),
                    vendedores: Object.values(item.vendedores)
                        .map((v) => ({ id: v.id, nome: v.nome, total_inscricoes: v.totalInscricoes, total_vendas: v.totalVendas }))
                        .sort((a, b) => b.total_inscricoes - a.total_inscricoes || b.total_vendas - a.total_vendas || a.nome.localeCompare(b.nome, 'pt-BR')),
                }))
                .sort((a, b) => b.total_inscricoes - a.total_inscricoes || b.total_vendas - a.total_vendas || a.lider_nome.localeCompare(b.lider_nome, 'pt-BR')),
            inscricoes_sem_lider: {
                total_inscricoes: totalInscricoesSemLider,
                total_vendas: Array.from(mapaSemLider.values()).reduce((acc, item) => acc + item.totalVendas, 0),
                vendedores: Array.from(mapaSemLider.entries())
                    .map(([vendedor_id, dados]) => ({
                        vendedor_id,
                        vendedor_nome: dados.vendedorNome,
                        total_inscricoes: dados.totalInscricoes,
                        total_vendas: dados.totalVendas,
                    }))
                    .sort(
                        (a, b) =>
                            b.total_inscricoes - a.total_inscricoes || b.total_vendas - a.total_vendas || a.vendedor_nome.localeCompare(b.vendedor_nome, 'pt-BR'),
                    ),
            },
        };
    }

    private armazenarCacheResumoHistorico(chave: string, value: ResumoHistoricoVendas): void {
        this.resumoHistoricoCache.set(chave, {
            expiresAt: Date.now() + this.resumoHistoricoCacheTtlMs,
            value,
        });
        if (this.resumoHistoricoCache.size > this.resumoHistoricoCacheMaxEntradas) {
            const chaveMaisAntiga = this.resumoHistoricoCache.keys().next().value;
            if (chaveMaisAntiga) {
                this.resumoHistoricoCache.delete(chaveMaisAntiga);
            }
        }
    }

    private async obterResumoHistoricoCacheado(
        baseQb: ReturnType<typeof this.uow.turmasAlunosTreinamentosContratosRP.createQueryBuilder>,
        chaveCacheResumo: string,
        options?: { staff_lider_id?: string; linhasPreload?: LinhaHistoricoVendasResumo[] },
    ): Promise<ResumoHistoricoVendas> {
        const cacheExistente = this.resumoHistoricoCache.get(chaveCacheResumo);
        if (cacheExistente && cacheExistente.expiresAt > Date.now()) {
            return cacheExistente.value;
        }

        const resumo = await this.calcularResumoHistoricoVendas(baseQb, options);
        this.armazenarCacheResumoHistorico(chaveCacheResumo, resumo);
        return resumo;
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
        // Origem do aluno (canal do dashboard/planilha). Aceita múltiplos valores
        // separados por "|" (ex.: "Bônus|Transbordo"). Filtra tanto a listagem
        // quanto o resumo consolidado (ambos derivam do mesmo baseQb).
        origem?: string;
        // Listagem leve por padrão: omite comprovantes base64 (passe false para incluir).
        omitir_comprovantes?: boolean | string;
        // Quando false, a listagem não calcula cards/ranking (use /resumo).
        incluir_resumo?: boolean | string;
        // Só calcula o resumo (pula paginação/hidratação da grade).
        apenas_resumo?: boolean | string;
    }): Promise<{
        data: any[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        resumo: ResumoHistoricoVendas | null;
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
            // Filtro por aluno (aba Contratos / deep link): sem datas explícitas,
            // não restringe aos últimos 30 dias — senão some o histórico antigo.
            const filtroPorAlunoAtivo = (() => {
                const id = Number(filtros?.id_aluno);
                return Number.isFinite(id) && id > 0;
            })();
            const aplicarFiltroPeriodo =
                (!filtroTurmaSemPeriodo || temDatasExplicitas) &&
                (!buscaPorTextoAtiva || temDatasExplicitas) &&
                (!filtroPorAlunoAtivo || temDatasExplicitas);
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
            // Default TRUE: listagem do histórico nunca precisa dos blobs na grade.
            // Opt-in explícito: omitir_comprovantes=false|0.
            const incluirComprovantesExplicit =
                filtros?.omitir_comprovantes === false || filtros?.omitir_comprovantes === 'false' || filtros?.omitir_comprovantes === '0';
            const omitirComprovantes = !incluirComprovantesExplicit;
            const apenasResumo = filtros?.apenas_resumo === true || filtros?.apenas_resumo === 'true' || filtros?.apenas_resumo === '1';
            // Default TRUE para compatibilidade com o front atual. Passe false e
            // chame GET .../resumo em paralelo para liberar a tabela mais cedo.
            const omitirResumoExplicit = filtros?.incluir_resumo === false || filtros?.incluir_resumo === 'false' || filtros?.incluir_resumo === '0';
            const incluirResumo = apenasResumo || !omitirResumoExplicit;
            const marcadorAtualizacao = this.obterMarcadorAtualizacaoHistorico();
            const chaveFiltrosResumo = {
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
                origem: filtros?.origem || null,
            };
            const chaveCacheResumo = JSON.stringify(chaveFiltrosResumo);
            const chaveCache = JSON.stringify({
                page,
                limit,
                omitir_comprovantes: omitirComprovantes,
                incluir_resumo: incluirResumo,
                ...chaveFiltrosResumo,
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
            const idTurmaOrigemDadosContratoSql = this.sqlIdTurmaOrigemHistorico;

            // Expressões compartilhadas com listarOpcoesFiltrosOrigem: o rótulo
            // exibido nas opções e o valor comparado no filtro são idênticos
            // ("Treinamento - Edição" resolvido pela relação antes do texto cru).
            const treinamentoOrigemSql = `LOWER(${this.sqlTreinamentoOrigemHistoricoDisplay})`;
            const turmaOrigemSql = `LOWER(${this.sqlTurmaOrigemHistoricoDisplay})`;
            const idTurmaDestinoDadosContratoSql = this.sqlIdTurmaDestinoHistorico;
            const turmaDestinoSql = `LOWER(${this.sqlTurmaDestinoHistoricoDisplay})`;
            const canalTextoSql = `LOWER(CONCAT_WS(' ',
                ${treinamentoOrigemSql},
                ${turmaOrigemSql},
                COALESCE(contrato.dados_contrato->'campos_variaveis'->>'Canal de Vendas', ''),
                COALESCE(contrato.dados_contrato->'campos_variaveis'->>'Canal da Venda', ''),
                COALESCE(contrato.dados_contrato->'campos_variaveis'->>'Origem da Venda', ''),
                COALESCE(contrato.dados_contrato->'campos_variaveis'->>'Origem', ''),
                COALESCE(contrato.dados_contrato->'campos_variaveis'->>'Observações', '')
            ))`;
            // Classifica cada venda pela origem do ALUNO na turma de ORIGEM da venda
            // (fluxo_evento_origem_id_turma), com a mesma partição de
            // TurmasService.getClassificacaoOrigemPorTurmaAluno / dashboard:
            // Presente > Bônus > Cortesia/Sorteio > Time de Vendas > Transbordo > Liberty
            // (conta como Vendas em Eventos) > Masterclass > Transferência > Vendas em Eventos.
            const idTurmaOrigemClassificacaoSql = idTurmaOrigemDadosContratoSql;
            // Matrícula ATIVA do aluno na turma de origem da venda (join direto,
            // sem subquery correlacionada — que fazia a query inteira degradar).
            const taOrigemJoinCondSql = `ta_origem.id_turma = ${idTurmaOrigemClassificacaoSql}
                AND ta_origem.id_aluno = ta.id_aluno
                AND ta_origem.deletado_em IS NULL`;
            const origemAlunoOrigemSql = `UPPER(TRIM(COALESCE(ta_origem.origem_aluno::text, '')))`;
            const codigoOrigemPlanilhaOrigemSql = `UPPER(TRIM(COALESCE(ta_origem.codigo_turma_origem_planilha, '')))`;
            const histTimeVendasOrigemSql = `(
                EXISTS (
                    SELECT 1
                    FROM historico_transferencias_alunos h
                    WHERE h.id_turma_aluno_para = ta_origem.id
                      AND h.id_turma_para = ${idTurmaOrigemClassificacaoSql}
                      AND h.id_turma_de = ${idTurmaOrigemClassificacaoSql}
                      AND h.deletado_em IS NULL
                )
            )`;
            const origemEhMcOrigemSql = `(
                COALESCE((
                    SELECT (
                        (tr.tipo_palestra = true OR tr.tipo_treinamento = false)
                        OR (t_de.edicao_turma IS NOT NULL AND LEFT(UPPER(TRIM(t_de.edicao_turma)), 3) = 'MC_')
                    )
                    FROM historico_transferencias_alunos h
                    INNER JOIN turmas t_de ON t_de.id = h.id_turma_de
                    INNER JOIN treinamentos tr ON tr.id = t_de.id_treinamento
                    WHERE h.id_turma_aluno_para = ta_origem.id
                      AND h.id_turma_para = ${idTurmaOrigemClassificacaoSql}
                      AND h.id_turma_de <> ${idTurmaOrigemClassificacaoSql}
                      AND h.deletado_em IS NULL
                    ORDER BY h.id DESC
                    LIMIT 1
                ), false)
                OR (
                    ta_origem.id_turma_transferencia_de IS NOT NULL
                    AND EXISTS (
                        SELECT 1
                        FROM turmas t_td
                        INNER JOIN treinamentos tr_td ON tr_td.id = t_td.id_treinamento
                        WHERE t_td.id = ta_origem.id_turma_transferencia_de
                          AND t_td.deletado_em IS NULL
                          AND (
                              tr_td.tipo_palestra = true
                              OR tr_td.tipo_treinamento = false
                              OR (t_td.edicao_turma IS NOT NULL AND LEFT(UPPER(TRIM(t_td.edicao_turma)), 3) = 'MC_')
                          )
                    )
                )
                OR (
                    ta_origem.codigo_turma_origem_planilha IS NOT NULL
                    AND LEFT(UPPER(TRIM(ta_origem.codigo_turma_origem_planilha)), 3) = 'MC_'
                )
            )`;
            const origemLabelSql = `CASE
                WHEN ${idTurmaOrigemClassificacaoSql} IS NULL OR ta_origem.id IS NULL THEN 'Vendas em Eventos'
                WHEN ${origemAlunoOrigemSql} = 'PRESENTE' THEN 'Presente'
                WHEN COALESCE(ta_origem.vaga_bonus, false) = true OR ${origemAlunoOrigemSql} = 'ALUNO_BONUS' THEN 'Bônus'
                WHEN ${origemAlunoOrigemSql} IN ('CORTESIA', 'SORTEIO') THEN 'Cortesia/Sorteio'
                WHEN ${histTimeVendasOrigemSql} THEN 'Time de Vendas'
                WHEN ${codigoOrigemPlanilhaOrigemSql} = 'TRANSBORDO' THEN 'Transbordo'
                WHEN ${codigoOrigemPlanilhaOrigemSql} = 'LIBERTY' THEN 'Vendas em Eventos'
                WHEN ${origemEhMcOrigemSql} THEN 'Masterclass'
                WHEN ${origemAlunoOrigemSql} = 'TRANSFERENCIA' THEN 'Transferência'
                ELSE 'Vendas em Eventos'
            END`;
            const origensFiltro = String(filtros?.origem || '')
                .split('|')
                .map((valor) => valor.trim())
                .filter(Boolean);
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

            // O join com a matrícula na turma de origem só entra quando o filtro
            // de origem está ativo, para não onerar a listagem padrão.
            if (origensFiltro.length > 0) {
                baseQb.leftJoin(TurmasAlunos, 'ta_origem', taOrigemJoinCondSql);
            }

            if (aplicarFiltroPeriodo) {
                baseQb.andWhere('contrato.criado_em BETWEEN :dataInicioPeriodo AND :dataFimPeriodo', {
                    dataInicioPeriodo,
                    dataFimPeriodo,
                });
            }

            if (filtros?.id_aluno) {
                const idAluno = Number(filtros.id_aluno);
                if (Number.isFinite(idAluno) && idAluno > 0) {
                    // Matrícula vinculada OU id gravado no JSON do contrato
                    // (cobre casos em que o join turma_aluno→aluno não resolve).
                    baseQb.andWhere(
                        `(aluno.id = :idAluno
                          OR COALESCE(
                            contrato.dados_contrato->'aluno'->>'id',
                            contrato.dados_contrato->'aluno'->>'id_aluno'
                          ) = :idAlunoTexto)`,
                        {
                            idAluno,
                            idAlunoTexto: String(idAluno),
                        },
                    );
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
                baseQb.andWhere(`contrato.hist_pendencia_pagamento = true`);
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

            // O filtro compara o MESMO rótulo resolvido exibido nas opções (não
            // usar hist_* cru aqui: pode estar vazio/só com o nº da edição e
            // nunca casaria com a opção "Treinamento - Edição").
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
                baseQb.andWhere(`contrato.hist_canal_venda = :canalMasterclass`, {
                    canalMasterclass: 'MASTERCLASS',
                });
            } else if (filtros?.canal_venda === 'TIME_VENDAS') {
                baseQb.andWhere(`contrato.hist_canal_venda = :canalTimeVendas`, {
                    canalTimeVendas: 'TIME_VENDAS',
                });
            } else if (filtros?.canal_venda === 'EVENTOS') {
                baseQb.andWhere(`contrato.hist_canal_venda = :canalEventos`, {
                    canalEventos: 'EVENTOS',
                });
            }

            // Filtro por origem do aluno (multi-seleção). Aplicado ao baseQb, portanto
            // reflete simultaneamente na contagem, na listagem paginada e no resumo/ranking.
            if (origensFiltro.length > 0) {
                baseQb.andWhere(`(${origemLabelSql}) IN (:...origensFiltro)`, {
                    origensFiltro,
                });
            }

            if (apenasResumo) {
                const [resumoIsolado, totalRow] = await Promise.all([
                    this.obterResumoHistoricoCacheado(baseQb, chaveCacheResumo, {
                        staff_lider_id: staffLiderId,
                    }),
                    baseQb.clone().select('COUNT(DISTINCT contrato.id)', 'total').getRawOne<{ total: string | number }>(),
                ]);
                const totalResumo = Number(totalRow?.total ?? 0);
                return {
                    data: [],
                    total: totalResumo,
                    page: 1,
                    limit: 0,
                    totalPages: Math.max(1, Math.ceil(totalResumo / 10)),
                    resumo: resumoIsolado,
                };
            }

            let total: number;
            let totalPages: number;
            let idsPagina: string[];
            let resumo: ResumoHistoricoVendas | null = null;

            // Staff líder agora filtra no SQL via hist_staff_lider_id (sem full-scan em Node).
            this.aplicarFiltroStaffLiderNoQb(baseQb, staffLiderId);

            {
                const paginacaoPromise = (async () => {
                    const totalRow = await baseQb.clone().select('COUNT(DISTINCT contrato.id)', 'total').getRawOne<{ total: string | number }>();
                    const totalLocal = Number(totalRow?.total ?? 0);
                    const totalPagesLocal = Math.max(1, Math.ceil(totalLocal / limit));
                    const idsPaginaRaw = await baseQb
                        .clone()
                        .select('contrato.id', 'id')
                        .addSelect('MAX(contrato.criado_em)', 'ordem_criado_em')
                        .groupBy('contrato.id')
                        .orderBy('MAX(contrato.criado_em)', 'DESC')
                        .offset(offset)
                        .limit(limit)
                        .getRawMany<{ id: string }>();
                    return {
                        total: totalLocal,
                        totalPages: totalPagesLocal,
                        idsPagina: idsPaginaRaw.map((item) => String(item.id)),
                    };
                })();

                const [paginacao, resumoParalelo] = await Promise.all([
                    paginacaoPromise,
                    incluirResumo ? this.obterResumoHistoricoCacheado(baseQb, chaveCacheResumo, { staff_lider_id: staffLiderId }) : Promise.resolve(null),
                ]);
                total = paginacao.total;
                totalPages = paginacao.totalPages;
                idsPagina = paginacao.idsPagina;
                resumo = resumoParalelo;
            }

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

            const selectContrato: Record<string, any> = {
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
                },
            };
            if (!omitirComprovantes) {
                selectContrato.comprovantes_pagamento = true;
                selectContrato.id_turma_aluno_treinamento_fk.id_turma_aluno_fk.comprovante_pagamento_base64 = true;
            }

            const contratos = await this.uow.turmasAlunosTreinamentosContratosRP.find({
                where: {
                    id: In(idsPagina),
                    deletado_em: null,
                },
                select: selectContrato,
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
            const idsComComprovantes = new Set<string>();
            if (idsPagina.length > 0) {
                const [idsManuscritoRows, idsComprovantesRows] = await Promise.all([
                    this.uow.turmasAlunosTreinamentosContratosRP
                        .createQueryBuilder('contrato')
                        .select('contrato.id', 'id')
                        .where('contrato.id IN (:...idsPagina)', { idsPagina })
                        .andWhere('contrato.foto_documento_aluno_base64 IS NOT NULL')
                        .andWhere("COALESCE(contrato.foto_documento_aluno_base64, '') <> ''")
                        .getRawMany<{ id: string }>(),
                    omitirComprovantes
                        ? this.uow.turmasAlunosTreinamentosContratosRP
                              .createQueryBuilder('contrato')
                              .select('contrato.id', 'id')
                              .where('contrato.id IN (:...idsPagina)', { idsPagina })
                              .andWhere(
                                  `(
                                    (jsonb_typeof(contrato.comprovantes_pagamento) = 'array' AND jsonb_array_length(contrato.comprovantes_pagamento) > 0)
                                    OR COALESCE(contrato.dados_contrato->'turma_aluno'->>'comprovante_pagamento_base64', '') <> ''
                                    OR (jsonb_typeof(contrato.dados_contrato->'turma_aluno'->'comprovantes_pagamento') = 'array'
                                        AND jsonb_array_length(contrato.dados_contrato->'turma_aluno'->'comprovantes_pagamento') > 0)
                                  )`,
                              )
                              .getRawMany<{ id: string }>()
                        : Promise.resolve([] as Array<{ id: string }>),
                ]);
                idsManuscritoRows.forEach((row) => idsContratoManual.add(String(row.id)));
                idsComprovantesRows.forEach((row) => idsComComprovantes.add(String(row.id)));
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
                    // Comprador PRINCIPAL do contrato: o snapshot da venda tem
                    // prioridade sobre a relação — a matrícula vinculada pode
                    // apontar para OUTRA pessoa (registro de aluno renomeado por
                    // upsert de e-mail na 2ª inscrição/titular de combo).
                    const alunoComprador = this.resolverAlunoCompradorContrato(aluno, dadosContrato?.aluno);

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
                    // Quantidade de inscrições DA VENDA: prioriza o snapshot gravado
                    // no ato da venda (dados_contrato.turma_aluno); a matrícula
                    // vinculada é a da turma de ORIGEM e carrega a quantidade de
                    // outra venda (fallback só para contratos legados sem snapshot).
                    const quantidadeInscricoes = turmaAlunoDadosContrato.quantidade_inscricoes ?? turmaAluno?.quantidade_inscricoes ?? 1;
                    const contratoDuplo = quantidadeInscricoes > 1;
                    // Outros clientes DA VENDA: mesmo racional — o snapshot da venda
                    // tem prioridade sobre a matrícula de origem (que carrega os
                    // clientes adicionais de OUTRA venda da mesma turma de origem).
                    const outrosClientes = turmaAlunoDadosContrato.outros_clientes ?? turmaAluno?.outros_clientes ?? [];
                    // Comprovante(s) por VENDA: prioriza a coluna do contrato; cai
                    // para o snapshot do contrato e, por último, para o turma_aluno legado.
                    // No modo omitir_comprovantes os base64 saem vazios (a mesma string
                    // se repetiria em vários campos por item e estoura o JSON.stringify
                    // em páginas grandes); possui_comprovantes preserva o indicador.
                    const comprovantesPagamentoCompletos = omitirComprovantes
                        ? []
                        : this.resolverComprovantesDoContrato(contrato, turmaAlunoDadosContrato, turmaAluno);
                    const possuiComprovantes = omitirComprovantes ? idsComComprovantes.has(String(contrato.id)) : comprovantesPagamentoCompletos.length > 0;
                    const comprovantesPagamento = omitirComprovantes ? [] : comprovantesPagamentoCompletos;
                    const comprovantePagamentoBase64 = omitirComprovantes ? '' : this.serializarComprovantes(comprovantesPagamento);
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
                        // Nome do COMPRADOR do contrato (snapshot da venda), com a
                        // relação apenas complementando contratos legados sem snapshot.
                        aluno_nome: alunoComprador.nome ?? null,
                        treinamento_nome: treinamento?.treinamento || dadosContrato?.treinamento?.treinamento || null,
                        comprovantes_pagamento: comprovantesPagamento,
                        possui_comprovantes: possuiComprovantes,
                        turma_aluno: {
                            pendencia_pagamento: pendenciaPagamento,
                            quantidade_inscricoes: quantidadeInscricoes,
                            outros_clientes: outrosClientes,
                            contrato_duplo: contratoDuplo,
                            comprovante_pagamento_base64: comprovantePagamentoBase64,
                            comprovantes_pagamento: comprovantesPagamento,
                        },
                        dados_contrato: {
                            // Comprador PRINCIPAL do contrato: snapshot da venda como
                            // fonte de verdade; a relação só complementa quando é a
                            // mesma pessoa (ou em contratos legados sem snapshot).
                            aluno: {
                                id: alunoComprador.id,
                                nome: alunoComprador.nome,
                                cpf: alunoComprador.cpf,
                                email: alunoComprador.email,
                                data_nascimento: alunoComprador.data_nascimento,
                                telefone_um: alunoComprador.telefone_um,
                                telefone_dois: alunoComprador.telefone_dois,
                                polo: alunoComprador.polo,
                                endereco: alunoComprador.endereco,
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
                                // Cláusulas (HTML grande) nunca vão na listagem —
                                // o detalhe do contrato usa GET contrato/:id.
                                clausulas: '',
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

    private mapToResponseDto(documento: Documentos, nomesUsuarios?: Record<number, string>): DocumentoResponseDto {
        const idUltimaAlteracao = documento.atualizado_por ?? documento.criado_por ?? null;
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
            atualizado_por_nome: (idUltimaAlteracao && nomesUsuarios?.[idUltimaAlteracao]) || null,
            versao: documento.versao || 1,
            deletado_em: documento.deletado_em,
        };
    }

    /**
     * Resolve os nomes dos usuários responsáveis pela última alteração dos
     * documentos (log "quem e quando alterou" exibido nos cards de documentos).
     */
    private async montarNomesUsuariosDocumentos(documentos: Documentos[]): Promise<Record<number, string>> {
        const ids = [...new Set(documentos.flatMap((doc) => [doc.atualizado_por, doc.criado_por]).filter((id): id is number => typeof id === 'number' && id > 0))];
        if (ids.length === 0) return {};
        try {
            const usuarios = await this.uow.usuariosRP.find({
                where: { id: In(ids) },
                select: ['id', 'nome'],
                withDeleted: true,
            });
            return Object.fromEntries(usuarios.map((usuario) => [usuario.id, usuario.nome]));
        } catch (error) {
            this.logger.warn(
                `doc.repo.usuarios | Falha ao resolver nomes de usuários dos documentos: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
            );
            return {};
        }
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
