import { IsArray, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class EmpresaTreinamentoResumoDto {
    id: number;
    treinamento: string;
    sigla_treinamento?: string | null;
    tipo_treinamento: boolean;
    tipo_palestra: boolean;
    tipo_mentoria: boolean;
    url_logo_treinamento?: string | null;
}

export class EmpresaResponseDto {
    id: number;
    nome: string;
    sigla?: string | null;
    url_logo?: string | null;
    total_treinamentos: number;
    treinamentos: EmpresaTreinamentoResumoDto[];
    created_at: string;
    updated_at: string;
    atualizado_por_nome?: string | null;
}

export class EmpresasListResponseDto {
    data: EmpresaResponseDto[];
    total: number;
}

export class GetEmpresasDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    nome?: string;
}

export class CreateEmpresaDto {
    @IsNotEmpty()
    @IsString()
    @Transform(({ value }) => value?.trim())
    nome: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    sigla?: string;

    @IsOptional()
    @IsString()
    url_logo?: string;

    @IsOptional()
    @IsNumber()
    criado_por?: number;
}

export class UpdateEmpresaDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    nome?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    sigla?: string;

    @IsOptional()
    @IsString()
    url_logo?: string | null;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;
}

export class SoftDeleteEmpresaDto {
    @IsOptional()
    @IsNumber()
    atualizado_por?: number;
}

export class SetEmpresaTreinamentosDto {
    @IsArray()
    @IsInt({ each: true })
    @Type(() => Number)
    ids: number[];

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;
}
