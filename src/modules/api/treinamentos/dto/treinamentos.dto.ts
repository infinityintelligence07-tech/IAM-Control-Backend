import { IsOptional, IsString, IsNumber, IsBoolean, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class GetTreinamentosDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    treinamento?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => parseFloat(value))
    preco_treinamento?: number;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_treinamento?: boolean;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_palestra?: boolean;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_online?: boolean;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value, 10))
    page?: number = 1;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value, 10))
    limit?: number = 12;
}

export class TreinamentoResponseDto {
    id: number;
    treinamento: string;
    sigla_treinamento?: string;
    preco_treinamento: number;
    url_logo_treinamento?: string;
    tipo_treinamento: boolean;
    tipo_palestra: boolean;
    tipo_online: boolean;
    total_turmas: number;
    total_alunos: number;
    capacidade_total: number;
    alunos_presentes: number;
    created_at: string;
    updated_at: string;
}

export class TreinamentosListResponseDto {
    data: TreinamentoResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export class CreateTreinamentoDto {
    @IsNotEmpty()
    @IsString()
    @Transform(({ value }) => value?.trim())
    treinamento: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    sigla_treinamento?: string;

    @IsNotEmpty()
    @IsNumber()
    @Transform(({ value }) => parseFloat(value))
    preco_treinamento: number;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    url_logo_treinamento?: string;

    @IsNotEmpty()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_treinamento: boolean;

    @IsNotEmpty()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_palestra: boolean;

    @IsNotEmpty()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_online: boolean;

    @IsOptional()
    @IsNumber()
    criado_por?: number;
}

export class UpdateTreinamentoDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    treinamento?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    sigla_treinamento?: string;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseFloat(value))
    preco_treinamento?: number;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    url_logo_treinamento?: string;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_treinamento?: boolean;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_palestra?: boolean;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_online?: boolean;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;

    @IsOptional()
    @IsString()
    atualizado_em?: string;
}

export class SoftDeleteTreinamentoDto {
    @IsNotEmpty()
    @IsString()
    deletado_em: string;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;
}
