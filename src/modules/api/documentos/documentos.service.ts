import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { Documentos } from '@/modules/config/entities/documentos.entity';
import {
    CreateDocumentoDto,
    UpdateDocumentoDto,
    DocumentoResponseDto,
    DocumentosListResponseDto,
    GerarContratoDto,
    CampoDocumentoDto,
    DocumentosFilterDto,
} from './dto/documentos.dto';
import { ETipoDocumento } from '@/modules/config/entities/enum';

@Injectable()
export class DocumentosService {
    constructor(private readonly uow: UnitOfWorkService) {}

    async createDocumento(createDocumentoDto: CreateDocumentoDto, userId?: number): Promise<DocumentoResponseDto> {
        try {
            const documento = this.uow.documentosRP.create({
                documento: createDocumentoDto.documento,
                tipo_documento: createDocumentoDto.tipo_documento,
                campos: createDocumentoDto.campos,
                clausulas: createDocumentoDto.clausulas,
                criado_por: userId,
                atualizado_por: userId,
            });

            const savedDocumento = await this.uow.documentosRP.save(documento);
            return this.mapToResponseDto(savedDocumento);
        } catch (error) {
            console.error('Erro ao criar documento:', error);
            throw new BadRequestException('Erro ao criar documento');
        }
    }

    async findAllDocumentos(page: number = 1, limit: number = 10, filter?: DocumentosFilterDto): Promise<DocumentosListResponseDto> {
        try {
            const whereCondition: any = { deletado_em: null }; // Excluir documentos deletados (soft delete)

            // Filtrar por tipo de documento se especificado
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
            console.error('Erro ao buscar documentos:', error);
            throw new BadRequestException('Erro ao buscar documentos');
        }
    }

    async findDocumentoById(id: number): Promise<DocumentoResponseDto> {
        try {
            const documento = await this.uow.documentosRP.findOne({
                where: { id, deletado_em: null }, // Excluir documentos deletados (soft delete)
            });

            if (!documento) {
                throw new NotFoundException('Documento não encontrado');
            }

            return this.mapToResponseDto(documento);
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error('Erro ao buscar documento:', error);
            throw new BadRequestException('Erro ao buscar documento');
        }
    }

    async updateDocumento(id: number, updateDocumentoDto: UpdateDocumentoDto, userId?: number): Promise<DocumentoResponseDto> {
        try {
            const documento = await this.uow.documentosRP.findOne({
                where: { id, deletado_em: null }, // Excluir documentos deletados (soft delete)
            });

            if (!documento) {
                throw new NotFoundException('Documento não encontrado');
            }

            // Atualizar campos fornecidos
            if (updateDocumentoDto.documento !== undefined) {
                documento.documento = updateDocumentoDto.documento;
            }
            if (updateDocumentoDto.tipo_documento !== undefined) {
                documento.tipo_documento = updateDocumentoDto.tipo_documento;
            }
            if (updateDocumentoDto.campos !== undefined) {
                documento.campos = updateDocumentoDto.campos;
            }
            if (updateDocumentoDto.clausulas !== undefined) {
                documento.clausulas = updateDocumentoDto.clausulas;
            }

            // Atualizar auditoria
            documento.atualizado_por = userId;

            const savedDocumento = await this.uow.documentosRP.save(documento);
            return this.mapToResponseDto(savedDocumento);
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error('Erro ao atualizar documento:', error);
            throw new BadRequestException('Erro ao atualizar documento');
        }
    }

    async deleteDocumento(id: number, userId?: number): Promise<{ message: string }> {
        try {
            const documento = await this.uow.documentosRP.findOne({
                where: { id, deletado_em: null }, // Excluir documentos já deletados
            });

            if (!documento) {
                throw new NotFoundException('Documento não encontrado');
            }

            // Soft delete - apenas marca como deletado
            documento.deletado_em = new Date();
            documento.atualizado_por = userId;

            await this.uow.documentosRP.save(documento);
            return { message: 'Documento removido com sucesso' };
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error('Erro ao remover documento:', error);
            throw new BadRequestException('Erro ao remover documento');
        }
    }

    async duplicateDocumento(id: number, userId?: number): Promise<DocumentoResponseDto> {
        try {
            const documentoOriginal = await this.uow.documentosRP.findOne({
                where: { id, deletado_em: null }, // Excluir documentos deletados
            });

            if (!documentoOriginal) {
                throw new NotFoundException('Documento não encontrado');
            }

            // Criar novo documento baseado no original
            const novoDocumento = this.uow.documentosRP.create({
                documento: `${documentoOriginal.documento} (Cópia)`,
                tipo_documento: documentoOriginal.tipo_documento,
                campos: documentoOriginal.campos,
                clausulas: documentoOriginal.clausulas,
                criado_por: userId,
                atualizado_por: userId,
            });

            const savedDocumento = await this.uow.documentosRP.save(novoDocumento);
            return this.mapToResponseDto(savedDocumento);
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error('Erro ao duplicar documento:', error);
            throw new BadRequestException('Erro ao duplicar documento');
        }
    }

    async gerarContrato(gerarContratoDto: GerarContratoDto): Promise<{ contrato: string; campos: any }> {
        try {
            const documento = await this.uow.documentosRP.findOne({
                where: { id: parseInt(gerarContratoDto.id_documento), deletado_em: null }, // Excluir documentos deletados
            });

            if (!documento) {
                throw new NotFoundException('Documento não encontrado');
            }

            // Processar campos do documento
            let contratoProcessado = documento.clausulas;
            const camposProcessados: any = {};

            // Substituir placeholders pelos valores fornecidos
            for (const valorCampo of gerarContratoDto.valoresCampos) {
                const placeholder = `{{${valorCampo.nome}}}`;
                contratoProcessado = contratoProcessado.replace(new RegExp(placeholder, 'g'), valorCampo.valor);
                camposProcessados[valorCampo.nome] = valorCampo.valor;
            }

            return {
                contrato: contratoProcessado,
                campos: camposProcessados,
            };
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error('Erro ao gerar contrato:', error);
            throw new BadRequestException('Erro ao gerar contrato');
        }
    }

    private mapToResponseDto(documento: Documentos): DocumentoResponseDto {
        return {
            id: documento.id,
            documento: documento.documento,
            tipo_documento: documento.tipo_documento,
            campos: documento.campos || [],
            clausulas: documento.clausulas,
            created_at: documento.criado_em,
            updated_at: documento.atualizado_em,
            criado_por: documento.criado_por,
            atualizado_por: documento.atualizado_por,
            deletado_em: documento.deletado_em,
        };
    }

    // Método para extrair campos de um template de contrato
    extrairCamposDeTemplate(template: string): CampoDocumentoDto[] {
        const campos: CampoDocumentoDto[] = [];
        const regex = /\{\{([^}]+)\}\}/g;
        let match;

        while ((match = regex.exec(template)) !== null) {
            const nomeCampo = match[1].trim();

            // Verificar se o campo já foi processado
            if (!campos.find((campo) => campo.campo === nomeCampo)) {
                // Determinar o tipo do campo baseado no nome
                const tipo = this.determinarTipoCampo(nomeCampo);

                campos.push({
                    campo: nomeCampo,
                    tipo: tipo,
                    descricao: this.gerarDescricaoCampo(nomeCampo),
                });
            }
        }

        return campos;
    }

    private determinarTipoCampo(nomeCampo: string): string {
        const nome = nomeCampo.toLowerCase();

        if (nome.includes('data') || nome.includes('date')) return 'data';
        if (nome.includes('email') || nome.includes('e-mail')) return 'email';
        if (nome.includes('whatsapp') || nome.includes('telefone') || nome.includes('celular')) return 'telefone';
        if (nome.includes('cpf') || nome.includes('cnpj') || nome.includes('documento')) return 'documento';
        if (nome.includes('cep')) return 'cep';
        if (nome.includes('preço') || nome.includes('valor') || nome.includes('valor')) return 'numero';
        if (nome.includes('checkbox') || nome.includes('aplica') || nome.includes('selecionar')) return 'checkbox';
        if (nome.includes('quantidade') || nome.includes('parcelas')) return 'numero';

        return 'texto';
    }

    private gerarDescricaoCampo(nomeCampo: string): string {
        const nome = nomeCampo.toLowerCase();

        if (nome.includes('nome')) return 'Nome completo';
        if (nome.includes('data nascimento')) return 'Data de nascimento';
        if (nome.includes('endereço')) return 'Endereço completo';
        if (nome.includes('cidade')) return 'Cidade';
        if (nome.includes('estado')) return 'Estado';
        if (nome.includes('treinamento')) return 'Nome do treinamento';
        if (nome.includes('preço')) return 'Preço do contrato';
        if (nome.includes('data prevista')) return 'Data prevista do treinamento';

        return nomeCampo;
    }
}
