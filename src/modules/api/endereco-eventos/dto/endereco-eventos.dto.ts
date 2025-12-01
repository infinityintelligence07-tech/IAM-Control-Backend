import { IsOptional, IsString, IsNumber, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class GetEnderecoEventosDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    local_evento?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    logradouro?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    cidade?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    estado?: string;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    id_polo?: number;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    page?: number = 1;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    limit?: number = 10;
}

export class EnderecoEventoResponseDto {
    id: number;
    id_polo: number;
    local_evento?: string;
    logradouro?: string;
    numero?: string;
    bairro?: string;
    cidade?: string;
    estado?: string;
    cep?: string;
    created_at: Date;
    updated_at: Date;
    polo?: {
        id: number;
        nome: string;
    };
}

export class EnderecoEventosListResponseDto {
    data: EnderecoEventoResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export class CreateEnderecoEventoDto {
    @IsNotEmpty()
    @IsNumber()
    id_polo: number;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    local_evento?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    logradouro?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    numero?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    bairro?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    cidade?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    estado?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    cep?: string;

    @IsOptional()
    @IsNumber()
    criado_por?: number;
}

export class UpdateEnderecoEventoDto {
    @IsOptional()
    @IsNumber()
    id_polo?: number;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    local_evento?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    logradouro?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    numero?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    bairro?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    cidade?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    estado?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    cep?: string;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;

    @IsOptional()
    @IsString()
    atualizado_em?: string;
}

export class SoftDeleteEnderecoEventoDto {
    @IsNotEmpty()
    @IsString()
    deletado_em: string;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;
}
