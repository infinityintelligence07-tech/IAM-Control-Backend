import { IsOptional, IsString, IsNumber, IsEnum, IsBoolean, IsArray, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { EStatusTurmas } from '../../../config/entities/enum';

export class GetTurmasDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    edicao_turma?: string;

    @IsOptional()
    @IsEnum(EStatusTurmas)
    status_turma?: EStatusTurmas;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    id_polo?: number;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    id_treinamento?: number;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    tipo_treinamento?: string; // 'palestra' ou 'treinamento'

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    page?: number = 1;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    limit?: number = 10;
}

export class CreateTurmaDto {
    @IsNumber()
    id_polo: number;

    @IsNumber()
    id_treinamento: number;

    @IsNumber()
    lider_evento: number;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    edicao_turma?: string;

    @IsString()
    cep: string;

    @IsString()
    logradouro: string;

    @IsOptional()
    @IsString()
    complemento?: string;

    @IsString()
    numero: string;

    @IsString()
    bairro: string;

    @IsString()
    cidade: string;

    @IsString()
    estado: string;

    @IsOptional()
    @IsEnum(EStatusTurmas)
    status_turma?: EStatusTurmas = EStatusTurmas.INSCRICOES_ABERTAS;

    @IsOptional()
    @IsBoolean()
    autorizar_bonus?: boolean = false;

    @IsOptional()
    @IsNumber()
    id_turma_bonus?: number;

    @IsNumber()
    capacidade_turma: number;

    @IsOptional()
    @IsNumber()
    meta?: number;

    @IsString()
    data_inicio: string;

    @IsString()
    data_final: string;

    @IsOptional()
    @IsBoolean()
    turma_aberta?: boolean = false;

    @IsOptional()
    @IsArray()
    @IsNumber({}, { each: true })
    bonus_treinamentos?: number[];

    @IsOptional()
    @IsNumber()
    criado_por?: number;
}

export class UpdateTurmaDto {
    @IsOptional()
    @IsNumber()
    id_polo?: number;

    @IsOptional()
    @IsNumber()
    id_treinamento?: number;

    @IsOptional()
    @IsNumber()
    lider_evento?: number;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    edicao_turma?: string;

    @IsOptional()
    @IsString()
    cep?: string;

    @IsOptional()
    @IsString()
    logradouro?: string;

    @IsOptional()
    @IsString()
    complemento?: string;

    @IsOptional()
    @IsString()
    numero?: string;

    @IsOptional()
    @IsString()
    bairro?: string;

    @IsOptional()
    @IsString()
    cidade?: string;

    @IsOptional()
    @IsString()
    estado?: string;

    @IsOptional()
    @IsEnum(EStatusTurmas)
    status_turma?: EStatusTurmas;

    @IsOptional()
    @IsBoolean()
    autorizar_bonus?: boolean;

    @IsOptional()
    @IsNumber()
    id_turma_bonus?: number;

    @IsOptional()
    @IsNumber()
    capacidade_turma?: number;

    @IsOptional()
    @IsNumber()
    meta?: number;

    @IsOptional()
    @IsString()
    data_inicio?: string;

    @IsOptional()
    @IsString()
    data_final?: string;

    @IsOptional()
    @IsBoolean()
    turma_aberta?: boolean;

    @IsOptional()
    @IsArray()
    @IsNumber({}, { each: true })
    bonus_treinamentos?: number[];

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;

    @IsOptional()
    @IsString()
    atualizado_em?: string;
}

export class AddAlunoTurmaDto {
    @IsNumber()
    id_aluno: number;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    nome_cracha?: string; // Se não fornecido, usa o nome_cracha do aluno

    @IsOptional()
    @IsString()
    origem_aluno?: 'COMPROU_INGRESSO' | 'ALUNO_BONUS';

    @IsOptional()
    @IsString()
    status_aluno_turma?: string;

    @IsOptional()
    @IsBoolean()
    vaga_bonus?: boolean;

    @IsOptional()
    @IsString()
    id_aluno_bonus?: string;
}

export class UpdateAlunoTurmaDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    nome_cracha?: string;

    @IsOptional()
    @IsString()
    url_comprovante_pgto?: string;

    @IsOptional()
    @IsString()
    status_aluno_turma?: string;

    @IsOptional()
    @IsString()
    presenca_turma?: string;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;

    @IsOptional()
    @IsString()
    atualizado_em?: string;
}

export class TurmaResponseDto {
    id: number;
    id_polo: number;
    id_treinamento: number;
    lider_evento: number;
    edicao_turma?: string;
    cep: string;
    logradouro: string;
    complemento: string;
    numero: string;
    bairro: string;
    cidade: string;
    estado: string;
    status_turma: EStatusTurmas;
    autorizar_bonus: boolean;
    id_turma_bonus?: number;
    capacidade_turma: number;
    meta?: number;
    data_inicio: string;
    data_final: string;
    turma_aberta: boolean;
    bonus_treinamentos?: number[];
    detalhamento_bonus?: { id_treinamento_db: number }[];
    created_at: Date;
    updated_at: Date;
    polo?: {
        id: number;
        nome: string;
        cidade: string;
        estado: string;
    };
    treinamento?: {
        id: number;
        nome: string;
        tipo: string;
    };
    lider?: {
        id: number;
        nome: string;
    };
    alunos_count?: number;
    alunos_confirmados_count?: number;
    pre_cadastrados_count?: number;
    presentes_count?: number;
}

export class TurmasListResponseDto {
    data: TurmaResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export class AlunoTurmaResponseDto {
    id: string;
    id_turma: number;
    id_aluno: string;
    nome_cracha: string;
    numero_cracha: string;
    vaga_bonus: boolean;
    status_aluno_turma?: string;
    presenca_turma?: string; // Adicionado campo presenca_turma
    url_comprovante_pgto?: string;
    created_at: Date;
    aluno?: {
        id: number;
        nome: string;
        email: string;
        nome_cracha: string;
        status_aluno_geral?: string;
    };
}

export class AlunosTurmaListResponseDto {
    data: AlunoTurmaResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export class AlunosDisponiveis {
    id: number;
    nome: string;
    email: string;
    nome_cracha: string;
    status_aluno_geral: string;
    polo?: {
        id: number;
        nome: string;
    };
}

export class AlunosDisponiveisResponseDto {
    data: AlunosDisponiveis[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export class SoftDeleteTurmaDto {
    @IsString()
    deletado_em: string;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;
}
