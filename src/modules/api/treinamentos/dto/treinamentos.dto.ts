import { IsOptional, IsString, IsNumber, IsBoolean } from 'class-validator';
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
