import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe, UseGuards, Req, Res, Logger } from '@nestjs/common';
import { ClassSerializerInterceptor, UseInterceptors } from '@nestjs/common';
import { DocumentosService } from './documentos.service';
import {
    CreateDocumentoDto,
    UpdateDocumentoDto,
    DocumentoResponseDto,
    DocumentosListResponseDto,
    DocumentosFilterDto,
    CriarContratoZapSignDto,
    RespostaContratoZapSignDto,
    CriarTermoZapSignDto,
    RespostaTermoZapSignDto,
    ExcluirContratoDto,
} from './dto/documentos.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { PermissionsGuard } from '@/modules/auth/guards/permissions.guard';
import { RequirePermission } from '@/modules/auth/decorators/require-permission.decorator';
import { Request } from 'express';
import { EFormasPagamento } from '@/modules/config/entities/enum';

@UseInterceptors(ClassSerializerInterceptor)
@Controller('documentos')
export class DocumentosController {
    private readonly logger = new Logger(DocumentosController.name);
    constructor(private readonly documentosService: DocumentosService) {}

    @Post()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'documentos', action: 'create' })
    async createDocumento(@Body() createDocumentoDto: CreateDocumentoDto, @Req() req: Request): Promise<DocumentoResponseDto> {
        console.log('Criando novo documento:', createDocumentoDto.documento);
        const userId = (req.user as any)?.sub;
        return this.documentosService.createDocumento(createDocumentoDto, userId);
    }

    // Leitura liberada a qualquer autenticado: a finalização da venda busca o
    // template de contrato do produto aqui e qualquer usuário pode vender.
    @Get()
    @UseGuards(JwtAuthGuard)
    async findAllDocumentos(
        @Query('page', ParseIntPipe) page: number = 1,
        @Query('limit', ParseIntPipe) limit: number = 10,
        @Query('tipo_documento') tipo_documento?: string,
    ): Promise<DocumentosListResponseDto> {
        console.log('Buscando documentos - página:', page, 'limite:', limit, 'tipo:', tipo_documento);
        const filter: DocumentosFilterDto = tipo_documento ? { tipo_documento: tipo_documento as any } : undefined;
        return this.documentosService.findAllDocumentos(page, limit, filter);
    }

    @Get(':id')
    async findDocumentoById(@Param('id', ParseIntPipe) id: number): Promise<DocumentoResponseDto> {
        console.log('Buscando documento ID:', id);
        return this.documentosService.findDocumentoById(id);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'documentos', action: 'edit' })
    async updateDocumento(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateDocumentoDto: UpdateDocumentoDto,
        @Req() req: Request,
    ): Promise<DocumentoResponseDto> {
        console.log('Atualizando documento ID:', id);
        const userId = (req.user as any)?.sub;
        return this.documentosService.updateDocumento(id, updateDocumentoDto, userId);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'documentos', action: 'delete' })
    async deleteDocumento(@Param('id', ParseIntPipe) id: number, @Req() req: Request): Promise<{ message: string }> {
        console.log('Removendo documento ID:', id);
        const userId = (req.user as any)?.sub;
        await this.documentosService.deleteDocumento(id, userId);
        return { message: 'Documento removido com sucesso' };
    }

    @Get('contratos')
    async findAllContratos(@Query('page', ParseIntPipe) page: number = 1, @Query('limit', ParseIntPipe) limit: number = 10): Promise<DocumentosListResponseDto> {
        console.log('Buscando contratos - página:', page, 'limite:', limit);
        const filter: DocumentosFilterDto = { tipo_documento: 'CONTRATO' as any };
        return this.documentosService.findAllDocumentos(page, limit, filter);
    }

    @Get('termos')
    async findAllTermos(@Query('page', ParseIntPipe) page: number = 1, @Query('limit', ParseIntPipe) limit: number = 10): Promise<DocumentosListResponseDto> {
        console.log('Buscando termos - página:', page, 'limite:', limit);
        const filter: DocumentosFilterDto = { tipo_documento: 'TERMO' as any };
        return this.documentosService.findAllDocumentos(page, limit, filter);
    }

    @Get('formas-pagamento')
    getFormasPagamento() {
        console.log('Buscando formas de pagamento disponíveis');
        return {
            formas_pagamento: Object.values(EFormasPagamento).map((forma) => ({
                id: forma,
                nome: forma
                    .replace(/_/g, ' ')
                    .toLowerCase()
                    .replace(/\b\w/g, (l) => l.toUpperCase()),
                valor: forma,
            })),
        };
    }

    // Endpoints para integração com ZapSign
    @Get('zapsign/templates')
    async buscarTemplatesZapSign() {
        console.log('=== ENDPOINT CHAMADO: /api/documentos/zapsign/templates ===');
        console.log('Buscando templates do banco de dados');
        try {
            const resultado = await this.documentosService.buscarTemplatesZapSign();
            console.log('Templates encontrados:', resultado.length);
            console.log('Primeiros templates:', resultado.slice(0, 3));
            return resultado;
        } catch (error) {
            console.error('Erro no controller:', error);
            throw error;
        }
    }

    // Endpoint público para teste (TEMPORÁRIO)
    @Get('public/templates')
    async buscarTemplatesPublico() {
        console.log('=== ENDPOINT PÚBLICO CHAMADO: /api/documentos/public/templates ===');
        try {
            const resultado = await this.documentosService.buscarTemplatesZapSign();
            console.log('Templates encontrados (público):', resultado.length);
            return resultado;
        } catch (error) {
            console.error('Erro no endpoint público:', error);
            throw error;
        }
    }

    @Get('public/documentos')
    async buscarDocumentosPublico() {
        console.log('=== ENDPOINT PÚBLICO CHAMADO: /api/documentos/public/documentos ===');
        try {
            const resultado = await this.documentosService.buscarTemplatesZapSign();
            console.log('Documentos encontrados (público):', resultado.length);
            return resultado;
        } catch (error) {
            console.error('Erro no endpoint público:', error);
            throw error;
        }
    }

    // Endpoint de teste simples
    @Get('test')
    teste() {
        console.log('=== ENDPOINT DE TESTE CHAMADO ===');
        return { message: 'Endpoint funcionando!', timestamp: new Date().toISOString() };
    }

    // Endpoint público de teste sem autenticação
    @Get('public/test')
    testePublico() {
        console.log('=== ENDPOINT PÚBLICO DE TESTE CHAMADO ===');
        return { message: 'Teste público funcionando!', timestamp: new Date().toISOString() };
    }

    // Criação de contrato liberada a qualquer autenticado: qualquer usuário
    // pode atuar como staff/vendedor no fluxo de venda.
    @Post('zapsign/criar-contrato')
    @UseGuards(JwtAuthGuard)
    async criarContratoZapSign(@Body() criarContratoDto: CriarContratoZapSignDto, @Req() req: Request): Promise<RespostaContratoZapSignDto> {
        try {
            console.log('=== CRIANDO CONTRATO NO ZAPSIGN ===');
            console.log('Dados recebidos:', JSON.stringify(criarContratoDto, null, 2));
            console.log('Formas de pagamento:', JSON.stringify(criarContratoDto.formas_pagamento, null, 2));
            console.log('Criando contrato no ZapSign para aluno:', criarContratoDto.id_aluno);
            const userId = (req.user as any)?.sub;
            return this.documentosService.criarContratoZapSign(criarContratoDto, userId);
        } catch (error: any) {
            console.error('Erro ao criar contrato:', error);
            if (error.response) {
                console.error('Erro de validação:', JSON.stringify(error.response, null, 2));
            }
            throw error;
        }
    }

    @Post('zapsign/criar-termo')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'documentos', action: 'create' })
    async criarTermoZapSign(@Body() criarTermoDto: CriarTermoZapSignDto, @Req() req: Request): Promise<RespostaTermoZapSignDto> {
        console.log('=== CRIANDO TERMO NO ZAPSIGN ===');
        console.log('Dados recebidos:', JSON.stringify(criarTermoDto, null, 2));
        console.log('Criando termo no ZapSign para aluno:', criarTermoDto.id_aluno);
        const userId = (req.user as any)?.sub;
        return this.documentosService.criarTermoZapSign(criarTermoDto, userId);
    }

    // Endpoint público para teste (TEMPORÁRIO)
    @Post('public/criar-contrato')
    @UseGuards(JwtAuthGuard)
    async criarContratoZapSignPublico(@Body() criarContratoDto: CriarContratoZapSignDto, @Req() req: Request): Promise<RespostaContratoZapSignDto> {
        console.log('Criando contrato no ZapSign para aluno (público):', criarContratoDto.id_aluno);
        const userId = (req.user as any)?.sub;
        return this.documentosService.criarContratoZapSign(criarContratoDto, userId);
    }

    // Listagem do Histórico de Vendas: qualquer usuário autenticado (sem matriz).
    @Get('public/contratos-banco')
    @UseGuards(JwtAuthGuard)
    async listarContratosBancoPublico(
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('id_aluno') id_aluno?: string,
        @Query('id_treinamento') id_treinamento?: string,
        @Query('status') status?: string,
        @Query('data_inicio') data_inicio?: string,
        @Query('data_fim') data_fim?: string,
        @Query('search') search?: string,
        @Query('canal_venda') canal_venda?: 'MASTERCLASS' | 'EVENTOS' | 'TIME_VENDAS',
        @Query('somente_com_pendencia') somente_com_pendencia?: string,
        @Query('tipo_filtro_busca') tipo_filtro_busca?: 'periodo' | 'treinamento' | 'turma',
        @Query('treinamento_origem') treinamento_origem?: string,
        @Query('turma_origem') turma_origem?: string,
        @Query('turma_destino') turma_destino?: string,
        @Query('staff_lider_id') staff_lider_id?: string,
        @Query('origem') origem?: string,
        @Query('omitir_comprovantes') omitir_comprovantes?: string,
        @Query('incluir_resumo') incluir_resumo?: string,
    ) {
        const filtros = {
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 10,
            id_aluno,
            id_treinamento,
            status,
            data_inicio,
            data_fim,
            search,
            canal_venda,
            somente_com_pendencia,
            tipo_filtro_busca,
            treinamento_origem,
            turma_origem,
            turma_destino,
            staff_lider_id,
            origem,
            omitir_comprovantes,
            incluir_resumo,
        };

        try {
            const resultado = await this.documentosService.listarContratosBanco(filtros);
            this.logger.debug(`contract.public.list | page=${filtros.page} limit=${filtros.limit} total=${resultado.total} returned=${resultado.data.length}`);
            return resultado;
        } catch (error) {
            this.logger.error('contract.public.list | Erro ao listar contratos do banco', error instanceof Error ? error.stack : undefined);
            throw error;
        }
    }

    // Contratos excluídos (auditoria do Histórico de Vendas).
    @Get('public/contratos-banco/excluidos')
    @UseGuards(JwtAuthGuard)
    async listarContratosExcluidosPublico(
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('search') search?: string,
        @Query('categoria_exclusao') categoria_exclusao?: string,
    ) {
        try {
            return await this.documentosService.listarContratosExcluidos({
                page: page ? parseInt(page, 10) : 1,
                limit: limit ? parseInt(limit, 10) : 20,
                search,
                categoria_exclusao,
            });
        } catch (error) {
            this.logger.error(
                'contract.public.list.excluidos | Erro ao listar contratos excluídos',
                error instanceof Error ? error.stack : undefined,
            );
            throw error;
        }
    }

    // Resumo/ranking isolado do Histórico de Vendas — carregar em paralelo à listagem
    // com incluir_resumo=false para liberar a grade mais cedo.
    @Get('public/contratos-banco/resumo')
    @UseGuards(JwtAuthGuard)
    async listarResumoContratosBancoPublico(
        @Query('id_aluno') id_aluno?: string,
        @Query('id_treinamento') id_treinamento?: string,
        @Query('status') status?: string,
        @Query('data_inicio') data_inicio?: string,
        @Query('data_fim') data_fim?: string,
        @Query('search') search?: string,
        @Query('canal_venda') canal_venda?: 'MASTERCLASS' | 'EVENTOS' | 'TIME_VENDAS',
        @Query('somente_com_pendencia') somente_com_pendencia?: string,
        @Query('tipo_filtro_busca') tipo_filtro_busca?: 'periodo' | 'treinamento' | 'turma',
        @Query('treinamento_origem') treinamento_origem?: string,
        @Query('turma_origem') turma_origem?: string,
        @Query('turma_destino') turma_destino?: string,
        @Query('staff_lider_id') staff_lider_id?: string,
        @Query('origem') origem?: string,
    ) {
        const resultado = await this.documentosService.listarContratosBanco({
            id_aluno,
            id_treinamento,
            status,
            data_inicio,
            data_fim,
            search,
            canal_venda,
            somente_com_pendencia,
            tipo_filtro_busca,
            treinamento_origem,
            turma_origem,
            turma_destino,
            staff_lider_id,
            origem,
            apenas_resumo: true,
            omitir_comprovantes: true,
            incluir_resumo: true,
        });
        return {
            resumo: resultado.resumo,
            total: resultado.total,
            totalPages: resultado.totalPages,
        };
    }

    @Get('public/contratos-banco/opcoes-origem')
    @UseGuards(JwtAuthGuard)
    async listarOpcoesOrigemPublico(
        @Query('data_inicio') data_inicio?: string,
        @Query('data_fim') data_fim?: string,
        @Query('search') search?: string,
        @Query('canal_venda') canal_venda?: 'MASTERCLASS' | 'EVENTOS' | 'TIME_VENDAS',
        @Query('somente_com_pendencia') somente_com_pendencia?: string,
        @Query('status') status?: string,
        @Query('treinamento_origem') treinamento_origem?: string,
        @Query('tipo_filtro_busca') tipo_filtro_busca?: 'periodo' | 'treinamento' | 'turma',
    ) {
        return this.documentosService.listarOpcoesFiltrosOrigem({
            data_inicio,
            data_fim,
            search,
            canal_venda,
            somente_com_pendencia,
            status,
            treinamento_origem,
            tipo_filtro_busca,
        });
    }

    @Post('public/contratos-banco/:id/sincronizar-bonus-ipr')
    @UseGuards(JwtAuthGuard)
    sincronizarBonusIprContratoHistorico(
        @Param('id') id: string,
        @Body()
        body: {
            linhas?: Array<{ id_turma: number; quantidade: number; edicao_turma?: string }>;
        },
    ) {
        return this.documentosService.sincronizarBonusIprCamposContratoHistorico(id, body?.linhas || []);
    }

    // Atualiza apenas as observações internas (uso do sistema) da venda, sem
    // alterar as observações do contrato propriamente dito.
    @Post('public/contratos-banco/:id/observacoes-sistema')
    @UseGuards(JwtAuthGuard)
    atualizarObservacoesSistemaContrato(
        @Param('id') id: string,
        @Body()
        body: {
            observacoes?: string;
        },
    ) {
        return this.documentosService.atualizarObservacoesSistemaContratoHistorico(id, body?.observacoes ?? '');
    }

    // Atualiza os dados DA VENDA (quantidade de inscrições, outros clientes e
    // pendência) no snapshot por venda dados_contrato.turma_aluno — fonte que a
    // listagem do histórico prioriza sobre a matrícula compartilhada de origem.
    @Post('public/contratos-banco/:id/dados-venda')
    @UseGuards(JwtAuthGuard)
    atualizarDadosVendaContrato(
        @Param('id') id: string,
        @Body()
        body: {
            quantidade_inscricoes?: number;
            outros_clientes?: Array<{ id?: string; nome?: string; email?: string; telefone?: string }>;
            pendencia_pagamento?: boolean;
        },
    ) {
        return this.documentosService.atualizarDadosVendaContratoHistorico(id, body || {});
    }

    // Ações do card de pendência no dashboard de vendas (quitar / reabrir / obs / cancel).
    @Post('public/contratos-banco/:id/pendencia-recebivel')
    @UseGuards(JwtAuthGuard)
    atualizarPendenciaRecebivel(
        @Param('id') id: string,
        @Body()
        body: {
            quitar?: boolean;
            reabrir?: { data_vencimento?: string };
            solicitou_cancelamento?: boolean;
            observacao?: string;
            autor?: string;
        },
        @Req() req: Request,
    ) {
        const autor =
            body?.autor ||
            String((req.user as { nome?: string; name?: string } | undefined)?.nome || '') ||
            String((req.user as { nome?: string; name?: string } | undefined)?.name || '') ||
            undefined;
        return this.documentosService.atualizarPendenciaRecebivelContrato(id, {
            ...(body || {}),
            autor,
        });
    }

    // Atualiza os comprovantes de pagamento da VENDA (contrato). Recebe um array
    // de data URLs base64 (imagens/PDF) ou a forma serializada usada pelo frontend.
    @Post('public/contratos-banco/:id/comprovantes')
    @UseGuards(JwtAuthGuard)
    atualizarComprovantesContrato(
        @Param('id') id: string,
        @Body()
        body: {
            comprovantes?: string[] | string | null;
            comprovante_pagamento_base64?: string | null;
        },
    ) {
        const comprovantes = body?.comprovantes ?? body?.comprovante_pagamento_base64 ?? [];
        return this.documentosService.atualizarComprovantesContratoHistorico(id, comprovantes);
    }

    @Post('admin/cache/historico/clear')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'documentos', action: 'view' })
    limparCachesHistorico() {
        const resultado = this.documentosService.limparCachesHistorico();
        return {
            message: 'Caches do histórico invalidados com sucesso.',
            ...resultado,
        };
    }

    @Post('admin/historico/recalcular-staff-lider')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'documentos', action: 'edit' })
    async recalcularHistStaffLider() {
        const resultado = await this.documentosService.recalcularHistStaffLiderContratos();
        return {
            message: 'Staff líder do histórico recalculado com sucesso.',
            ...resultado,
        };
    }

    // Endpoint para buscar contrato completo (para compatibilidade com frontend)
    @Get('contrato/:id')
    async buscarContratoCompleto(@Param('id') id: string) {
        console.log('Buscando contrato completo:', id);
        return this.documentosService.buscarContratoCompleto(id);
    }

    // Endpoint para salvar assinatura (para compatibilidade com frontend)
    @Post('salvar-assinatura')
    @UseGuards(JwtAuthGuard)
    salvarAssinatura(@Body() signatureData: any) {
        return this.documentosService.salvarAssinatura(signatureData);
    }

    // Endpoint de teste para verificar dados do contrato
    @Get('test/contrato/:id')
    async testContrato(@Param('id') id: string) {
        console.log('=== TESTE CONTRATO ===');
        console.log('ID:', id);
        const contrato = await this.documentosService.buscarContratoCompleto(id);
        console.log('Contrato retornado:', JSON.stringify(contrato, null, 2));
        return contrato;
    }

    // Endpoint de teste simples para verificar dados básicos
    @Get('test/simple/:id')
    async testSimple(@Param('id') id: string) {
        console.log('=== TESTE SIMPLES ===');
        console.log('ID:', id);

        try {
            // Buscar apenas o contrato básico usando o método do serviço
            const contratoBasico = await this.documentosService.buscarContratoBasico(id);

            console.log('Contrato básico:', contratoBasico ? 'ENCONTRADO' : 'NÃO ENCONTRADO');
            if (contratoBasico) {
                console.log('ID:', contratoBasico.id);
                console.log('ID TurmaAlunoTreinamento:', contratoBasico.id_turma_aluno_treinamento);
                console.log('ID Documento:', contratoBasico.id_documento);
                console.log('Status:', contratoBasico.status_ass_aluno);
            }

            return {
                encontrado: !!contratoBasico,
                dados: contratoBasico
                    ? {
                          id: contratoBasico.id,
                          id_turma_aluno_treinamento: contratoBasico.id_turma_aluno_treinamento,
                          id_documento: contratoBasico.id_documento,
                          status_ass_aluno: contratoBasico.status_ass_aluno,
                          dados_contrato: contratoBasico.dados_contrato,
                      }
                    : null,
            };
        } catch (error) {
            console.error('Erro no teste simples:', error);
            return { erro: (error as Error).message };
        }
    }

    // Endpoint para gerar contrato PDF usando dados salvos no banco
    @Get('gerar-pdf/:id')
    async gerarContratoPDF(@Param('id') id: string, @Res() res: any) {
        try {
            console.log('=== GERANDO CONTRATO PDF ===');
            console.log('ID do contrato:', id);

            const pdfBuffer = await this.documentosService.gerarContratoPDF(id);

            // Configurar headers para download do PDF
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="contrato-${id}.pdf"`);
            res.setHeader('Content-Length', pdfBuffer.length);

            // Enviar o PDF
            res.send(pdfBuffer);
        } catch (error) {
            console.error('Erro ao gerar PDF:', error);
            res.status(500).json({
                error: 'Erro ao gerar PDF do contrato',
                message: (error as Error).message,
            });
        }
    }

    // Cancelar documento ZapSign: qualquer usuário autenticado (fluxo de vendas).
    @Delete('zapsign/documento/:documentoId/cancelar')
    @UseGuards(JwtAuthGuard)
    async cancelarDocumentoZapSign(@Param('documentoId') documentoId: string, @Req() req: Request): Promise<{ message: string }> {
        try {
            console.log('=== CANCELANDO DOCUMENTO ZAPSIGN ===');
            console.log('ID do documento:', documentoId);

            const userId = (req.user as any)?.sub;
            return await this.documentosService.cancelarDocumentoZapSign(documentoId, userId);
        } catch (error) {
            console.error('Erro ao cancelar documento:', error);
            throw error;
        }
    }

    // Excluir venda/contrato: qualquer usuário autenticado (CRUD de vendas sem matriz).
    // Body obrigatório: categoria + observação (auditoria no Histórico de Vendas).
    @Delete('excluir-zapsign/:contratoId')
    @UseGuards(JwtAuthGuard)
    async excluirDocumentoZapSign(
        @Param('contratoId') contratoId: string,
        @Body() body: ExcluirContratoDto,
        @Req() req: Request,
    ): Promise<{ message: string }> {
        try {
            console.log('=== EXCLUINDO CONTRATO ZAPSIGN ===');
            console.log('ID do contrato:', contratoId);

            const userId = (req.user as any)?.sub;
            return await this.documentosService.excluirDocumentoZapSign(contratoId, userId, body);
        } catch (error) {
            console.error('Erro ao excluir contrato:', error);
            throw error;
        }
    }

    // Endpoint para enviar contrato por email
    // Modal final da venda (enviar contrato por e-mail) funciona para qualquer
    // usuário que esteja realizando a venda.
    @Post('enviar-email')
    @UseGuards(JwtAuthGuard)
    async enviarContratoPorEmail(@Body() body: { email: string; nomeSignatario: string; signingUrl: string }): Promise<{ message: string }> {
        try {
            await this.documentosService.enviarContratoPorEmail(body.email, body.nomeSignatario, body.signingUrl);
            return { message: 'Email enviado com sucesso' };
        } catch (error) {
            console.error('Erro ao enviar email:', error);
            throw error;
        }
    }

    @Post('sincronizar-status-zapsign/:contratoId')
    @UseGuards(JwtAuthGuard)
    async sincronizarStatusZapSign(@Param('contratoId') contratoId: string): Promise<{
        message: string;
        status: string;
        assinaturasCompletas: number;
        totalAssinaturas: number;
    }> {
        return await this.documentosService.sincronizarStatusZapSign(contratoId);
    }

    @Post('sincronizar-todos-status-zapsign')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'documentos', action: 'view' })
    async sincronizarTodosStatusZapSign(): Promise<{
        message: string;
        sincronizados: number;
        erros: number;
    }> {
        return await this.documentosService.sincronizarTodosStatusZapSign();
    }

    /**
     * Webhook do ZapSign - recebe notificações quando um documento é assinado
     * Este endpoint não requer autenticação JWT pois é chamado pelo ZapSign
     */
    @Post('webhook-zapsign')
    async webhookZapSign(@Body() body: any): Promise<{ message: string }> {
        try {
            console.log('Webhook ZapSign recebido:', JSON.stringify(body, null, 2));

            // O ZapSign pode enviar diferentes tipos de eventos
            // Vamos procurar pelo document_id ou token do documento
            const documentId = body.document_id || body.token || body.document?.token || body.document?.id;

            if (!documentId) {
                console.warn('Webhook ZapSign sem document_id');
                return { message: 'Webhook recebido, mas sem document_id' };
            }

            // Sincronizar o status usando o document_id do ZapSign
            // O método sincronizarStatusZapSignPorDocumentId será criado no service
            await this.documentosService.sincronizarStatusZapSignPorDocumentId(documentId);

            return { message: 'Status sincronizado com sucesso' };
        } catch (error: any) {
            console.error('Erro ao processar webhook do ZapSign:', error);
            // Não lançar erro para não quebrar o webhook do ZapSign
            return { message: `Erro ao processar webhook: ${error.message}` };
        }
    }
}
