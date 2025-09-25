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
} from './dto/documentos.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { Request } from 'express';

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
}
