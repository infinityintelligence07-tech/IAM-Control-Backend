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
    confirmou_presenca?: boolean;

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

export class MasterclassPreCadastroResponseDto {
    id: string;
    nome_aluno: string;
    email: string;
    telefone: string;
    evento_nome: string;
    data_evento: Date;
    confirmou_presenca: boolean;
    data_confirmacao_presenca?: Date;
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
