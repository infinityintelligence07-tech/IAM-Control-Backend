import { Type } from 'class-transformer';
import {
    IsDateString,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    MaxLength,
    Min,
} from 'class-validator';

export class TurmaDisponibilidadeResponseDto {
    id: number;
    id_turma: number;
    data_hora: string;
    qtd_manha: number;
    qtd_tarde: number;
    qtd_noite: number;
    qtd_fila_pitch: number;
    qtd_fila_repitch: number;
    observacao: string | null;
    turma?: {
        id: number;
        edicao_turma: string | null;
        id_treinamento: number;
        treinamento?: string | null;
        sigla_treinamento?: string | null;
    } | null;
    criado_em: string;
    atualizado_em: string;
    criado_por_nome?: string | null;
    atualizado_por_nome?: string | null;
}

export class TurmaDisponibilidadeListResponseDto {
    data: TurmaDisponibilidadeResponseDto[];
    total: number;
}

export class GetTurmaDisponibilidadeDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    id_turma?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    id_empresa?: number;
}

export class CreateTurmaDisponibilidadeDto {
    @IsNotEmpty()
    @Type(() => Number)
    @IsInt()
    id_turma: number;

    @IsNotEmpty()
    @IsDateString()
    data_hora: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    qtd_manha?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    qtd_tarde?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    qtd_noite?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    qtd_fila_pitch?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    qtd_fila_repitch?: number;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    observacao?: string;

    @IsOptional()
    @IsNumber()
    criado_por?: number;
}

export class UpdateTurmaDisponibilidadeDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    id_turma?: number;

    @IsOptional()
    @IsDateString()
    data_hora?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    qtd_manha?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    qtd_tarde?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    qtd_noite?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    qtd_fila_pitch?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    qtd_fila_repitch?: number;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    observacao?: string | null;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;
}

export class SoftDeleteTurmaDisponibilidadeDto {
    @IsOptional()
    @IsNumber()
    atualizado_por?: number;
}
