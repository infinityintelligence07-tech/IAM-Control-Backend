import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe, UseGuards, Req, Res } from '@nestjs/common';
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
} from './dto/documentos.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { Request } from 'express';
import { EFormasPagamento } from '@/modules/config/entities/enum';

@UseInterceptors(ClassSerializerInterceptor)
@Controller('documentos')
export class DocumentosController {
    constructor(private readonly documentosService: DocumentosService) {}

    @Post()
    @UseGuards(JwtAuthGuard)
    async createDocumento(@Body() createDocumentoDto: CreateDocumentoDto, @Req() req: Request): Promise<DocumentoResponseDto> {
        console.log('Criando novo documento:', createDocumentoDto.documento);
        const userId = (req.user as any)?.sub;
        return this.documentosService.createDocumento(createDocumentoDto, userId);
    }

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

    @Post('zapsign/criar-contrato')
    @UseGuards(JwtAuthGuard)
    async criarContratoZapSign(@Body() criarContratoDto: CriarContratoZapSignDto, @Req() req: Request): Promise<RespostaContratoZapSignDto> {
        console.log('=== CRIANDO CONTRATO NO ZAPSIGN ===');
        console.log('Dados recebidos:', JSON.stringify(criarContratoDto, null, 2));
        console.log('Criando contrato no ZapSign para aluno:', criarContratoDto.id_aluno);
        const userId = (req.user as any)?.sub;
        return this.documentosService.criarContratoZapSign(criarContratoDto, userId);
    }

    // Endpoint público para teste (TEMPORÁRIO)
    @Post('public/criar-contrato')
    async criarContratoZapSignPublico(@Body() criarContratoDto: CriarContratoZapSignDto): Promise<RespostaContratoZapSignDto> {
        console.log('Criando contrato no ZapSign para aluno (público):', criarContratoDto.id_aluno);
        return this.documentosService.criarContratoZapSign(criarContratoDto, 1); // Usar userId 1 para teste
    }

    // Endpoint público para listar contratos do banco (para compatibilidade com frontend)
    @Get('public/contratos-banco')
    async listarContratosBancoPublico(
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('id_aluno') id_aluno?: string,
        @Query('id_treinamento') id_treinamento?: string,
        @Query('status') status?: string,
        @Query('data_inicio') data_inicio?: string,
        @Query('data_fim') data_fim?: string,
    ) {
        console.log('=== ENDPOINT PÚBLICO CHAMADO ===');
        console.log('Query params:', { page, limit, id_aluno, id_treinamento, status, data_inicio, data_fim });

        const filtros = {
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 10,
            id_aluno,
            id_treinamento,
            status,
            data_inicio,
            data_fim,
        };

        console.log('Filtros processados:', filtros);

        try {
            const resultado = await this.documentosService.listarContratosBanco(filtros);
            console.log('Resultado do serviço:', resultado);
            return resultado;
        } catch (error) {
            console.error('Erro no controller:', error);
            throw error;
        }
    }

    // Endpoint para buscar contrato completo (para compatibilidade com frontend)
    @Get('contrato/:id')
    async buscarContratoCompleto(@Param('id') id: string) {
        console.log('Buscando contrato completo:', id);
        return this.documentosService.buscarContratoCompleto(id);
    }

    // Endpoint para salvar assinatura (para compatibilidade com frontend)
    @Post('salvar-assinatura')
    salvarAssinatura(@Body() signatureData: any) {
        console.log('Salvando assinatura:', signatureData);
        // Retornar sucesso mockado para compatibilidade
        return {
            message: 'Endpoint temporariamente desabilitado - funcionalidade em migração',
            success: true,
        };
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

    // Endpoint para cancelar documento do ZapSign e fazer soft delete
    @Delete('zapsign/documento/:documentoId/cancelar')
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

    // Endpoint para excluir contrato (soft delete + remoção na Zapsign)
    @Delete('excluir-zapsign/:contratoId')
    @UseGuards(JwtAuthGuard)
    async excluirDocumentoZapSign(@Param('contratoId') contratoId: string, @Req() req: Request): Promise<{ message: string }> {
        try {
            console.log('=== EXCLUINDO CONTRATO ZAPSIGN ===');
            console.log('ID do contrato:', contratoId);

            const userId = (req.user as any)?.sub;
            return await this.documentosService.excluirDocumentoZapSign(contratoId, userId);
        } catch (error) {
            console.error('Erro ao excluir contrato:', error);
            throw error;
        }
    }

    // Endpoint para enviar contrato por email
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
}
