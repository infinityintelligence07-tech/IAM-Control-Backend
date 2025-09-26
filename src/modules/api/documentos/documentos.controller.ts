import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe, UseGuards, Req } from '@nestjs/common';
import { ClassSerializerInterceptor, UseInterceptors } from '@nestjs/common';
import { DocumentosService } from './documentos.service';
import {
    CreateDocumentoDto,
    UpdateDocumentoDto,
    DocumentoResponseDto,
    DocumentosListResponseDto,
    GerarContratoDto,
    DocumentosFilterDto,
    CriarContratoZapSignDto,
    RespostaContratoZapSignDto,
    AtualizarStatusContratoDto,
} from './dto/documentos.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { Request } from 'express';
import { EFormasPagamento } from '@/modules/config/entities/enum';

@UseInterceptors(ClassSerializerInterceptor)
@Controller('documentos')
@UseGuards(JwtAuthGuard)
export class DocumentosController {
    constructor(private readonly documentosService: DocumentosService) {}

    @Post()
    async createDocumento(@Body() createDocumentoDto: CreateDocumentoDto, @Req() req: Request): Promise<DocumentoResponseDto> {
        console.log('Criando novo documento:', createDocumentoDto.documento);
        const userId = (req.user as any)?.sub;
        return this.documentosService.createDocumento(createDocumentoDto, userId);
    }

    @Get()
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
        return this.documentosService.deleteDocumento(id, userId);
    }

    @Post(':id/duplicate')
    async duplicateDocumento(@Param('id', ParseIntPipe) id: number, @Req() req: Request): Promise<DocumentoResponseDto> {
        console.log('Duplicando documento ID:', id);
        const userId = (req.user as any)?.sub;
        return this.documentosService.duplicateDocumento(id, userId);
    }

    @Post('gerar-contrato')
    async gerarContrato(@Body() gerarContratoDto: GerarContratoDto): Promise<{ contrato: string; campos: any }> {
        console.log('Gerando contrato para documento:', gerarContratoDto.id_documento);
        return this.documentosService.gerarContrato(gerarContratoDto);
    }

    @Post('extrair-campos')
    extrairCamposDeTemplate(@Body('template') template: string): { campos: any[] } {
        console.log('Extraindo campos do template');
        const campos = this.documentosService.extrairCamposDeTemplate(template);
        return { campos };
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

    @Get('zapsign/buscar-aluno')
    async buscarAluno(@Query('q') query: string) {
        console.log('Buscando aluno por:', query);
        return this.documentosService.buscarAluno(query);
    }

    @Post('zapsign/criar-contrato')
    async criarContratoZapSign(@Body() criarContratoDto: CriarContratoZapSignDto, @Req() req: Request): Promise<RespostaContratoZapSignDto> {
        console.log('Criando contrato no ZapSign para aluno:', criarContratoDto.id_aluno);
        const userId = (req.user as any)?.sub;
        return this.documentosService.criarContratoZapSign(criarContratoDto, userId);
    }

    @Get('zapsign/documento/:id')
    async buscarDocumentoZapSign(@Param('id') id: string): Promise<RespostaContratoZapSignDto> {
        console.log('Buscando documento do ZapSign:', id);
        return this.documentosService.buscarDocumentoZapSign(id);
    }

    @Get('zapsign/documentos')
    async listarDocumentosZapSign() {
        console.log('Listando documentos do ZapSign');
        return this.documentosService.listarDocumentosZapSign();
    }

    @Delete('zapsign/documento/:id/cancelar')
    async cancelarDocumentoZapSign(@Param('id') id: string) {
        console.log('Cancelando documento do ZapSign:', id);
        return this.documentosService.cancelarDocumentoZapSign(id);
    }

    @Post('zapsign/documento/:id/lembrete')
    async enviarLembreteAssinatura(@Param('id') id: string) {
        console.log('Enviando lembrete para documento:', id);
        return this.documentosService.enviarLembreteAssinatura(id);
    }
}
