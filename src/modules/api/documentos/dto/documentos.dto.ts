import { IsString, IsOptional, IsArray, ValidateNested, IsNotEmpty, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ETipoDocumento } from '@/modules/config/entities/enum';

export class CampoDocumentoDto {
    @IsString()
    @IsNotEmpty()
    campo: string;

    @IsString()
    @IsNotEmpty()
    tipo: string; // 'texto', 'numero', 'data', 'email', 'telefone', 'documento', 'cep', 'checkbox', 'select'

    @IsOptional()
    @IsString()
    descricao?: string;

    @IsOptional()
    @IsArray()
    opcoes?: string[]; // Para campos do tipo 'select' ou 'checkbox'

    @IsOptional()
    @IsString()
    placeholder?: string;

    @IsOptional()
    @IsString()
    valorPadrao?: string;
}

export class CreateDocumentoDto {
    @IsString()
    @IsNotEmpty()
    documento: string;

    @IsEnum(ETipoDocumento)
    @IsNotEmpty()
    tipo_documento: ETipoDocumento;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CampoDocumentoDto)
    campos: CampoDocumentoDto[];

    @IsString()
    @IsNotEmpty()
    clausulas: string;
}

export class UpdateDocumentoDto {
    @IsOptional()
    @IsString()
    documento?: string;

    @IsOptional()
    @IsEnum(ETipoDocumento)
    tipo_documento?: ETipoDocumento;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CampoDocumentoDto)
    campos?: CampoDocumentoDto[];

    @IsOptional()
    @IsString()
    clausulas?: string;
}

export class DocumentoResponseDto {
    id: number;
    documento: string;
    tipo_documento: ETipoDocumento;
    campos: CampoDocumentoDto[];
    clausulas: string;
    created_at: Date;
    updated_at: Date;
    criado_por?: number;
    atualizado_por?: number;
    deletado_em?: Date;
}

export class DocumentosListResponseDto {
    data: DocumentoResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export class GerarContratoDto {
    @IsString()
    @IsNotEmpty()
    id_documento: string;

    @IsString()
    @IsNotEmpty()
    id_aluno: string;

    @IsOptional()
    @IsString()
    id_turma?: string;

    @IsArray()
    valoresCampos: { nome: string; valor: string }[];
}

export class DocumentosFilterDto {
    @IsOptional()
    @IsEnum(ETipoDocumento)
    tipo_documento?: ETipoDocumento;
}
