import { IsString, IsEmail, IsOptional, IsBoolean, IsDateString, IsNumber } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateMasterclassEventoDto {
    @IsString()
    evento_nome: string;

    @IsDateString()
    data_evento: string;

    @IsOptional()
    @IsString()
    observacoes?: string;
}

export class UploadMasterclassCsvDto {
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    id_turma: number;

    @IsOptional()
    @IsString()
    observacoes?: string;
}

export class MasterclassPreCadastroDto {
    @IsString()
    nome_aluno: string;

    @IsEmail()
    email: string;

    @IsString()
    telefone: string;

    @IsNumber()
    id_turma: number;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    presente?: boolean;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    teve_interesse?: boolean;

    @IsOptional()
    @IsString()
    id_aluno_vinculado?: string;

    @IsOptional()
    @IsString()
    observacoes?: string;
}

export class ConfirmarPresencaDto {
    @IsString()
    id_pre_cadastro: string;

    @IsOptional()
    @IsString()
    observacoes?: string;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;

    @IsOptional()
    @IsString()
    atualizado_em?: string;
}

export class VincularAlunoDto {
    @IsString()
    id_pre_cadastro: string;

    @IsString()
    id_aluno: string;

    @IsOptional()
    @IsString()
    observacoes?: string;
}

export class AlterarInteresseDto {
    @IsString()
    id_pre_cadastro: string;

    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    teve_interesse: boolean;

    @IsOptional()
    @IsString()
    observacoes?: string;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;

    @IsOptional()
    @IsString()
    atualizado_em?: string;
}

export class MasterclassPreCadastroResponseDto {
    id: string;
    nome_aluno: string;
    email: string;
    telefone: string;
    evento_nome: string;
    data_evento: Date;
    presente: boolean;
    teve_interesse: boolean;
    id_aluno_vinculado?: string;
    data_vinculacao_aluno?: Date;
    observacoes?: string;
    aluno_vinculado?: {
        id: number;
        nome: string;
        email: string;
        nome_cracha: string;
        id_polo: number;
        polo?: {
            id: number;
            nome: string;
        };
    };
    criado_em: Date;
    atualizado_em: Date;
}

export class MasterclassEventoResponseDto {
    evento_nome: string;
    data_evento: Date;
    total_inscritos: number;
    total_presentes: number;
    total_ausentes: number;
    total_vinculados: number;
    taxa_presenca: number;
    pre_cadastros: MasterclassPreCadastroResponseDto[];
}

export class MasterclassListResponseDto {
    data: MasterclassEventoResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export class MasterclassStatsDto {
    evento_nome: string;
    data_evento: Date;
    total_inscritos: number;
    total_presentes: number;
    total_ausentes: number;
    total_vinculados: number;
    taxa_presenca: number;
    alunos_ausentes_para_marketing: {
        id: string;
        nome_aluno: string;
        email: string;
        telefone: string;
        data_evento: Date;
    }[];
}

export class CreateMasterclassPreCadastroDto {
    @IsString()
    nome_aluno: string;

    @IsEmail()
    email: string;

    @IsString()
    telefone: string;

    @IsNumber()
    id_turma: number;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    presente?: boolean;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    teve_interesse?: boolean;

    @IsOptional()
    @IsString()
    observacoes?: string;

    @IsOptional()
    @IsNumber()
    criado_por?: number;
}

export class UpdateMasterclassPreCadastroDto {
    @IsOptional()
    @IsString()
    nome_aluno?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    telefone?: string;

    @IsOptional()
    @IsNumber()
    id_turma?: number;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    presente?: boolean;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    teve_interesse?: boolean;

    @IsOptional()
    @IsString()
    observacoes?: string;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;

    @IsOptional()
    @IsString()
    atualizado_em?: string;
}

export class SoftDeleteMasterclassPreCadastroDto {
    @IsString()
    deletado_em: string;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;
}
