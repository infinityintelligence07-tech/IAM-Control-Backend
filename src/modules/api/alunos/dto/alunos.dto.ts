import { IsOptional, IsString, IsNumber, IsEnum, IsNotEmpty, IsBoolean, IsArray, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { EStatusAlunosGeral, ETipoVinculoAluno, EProfissao } from '../../../config/entities/enum';

export class GetAlunosDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    nome?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    email?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    cpf?: string;

    @IsOptional()
    @IsEnum(EStatusAlunosGeral)
    status_aluno_geral?: EStatusAlunosGeral;

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

export class AlunoResponseDto {
    id: number;
    id_polo: number | null;
    nome: string;
    nome_cracha: string | null;
    email: string;
    genero?: string;
    cpf?: string;
    instagram?: string;
    data_nascimento?: string;
    telefone_um: string;
    telefone_dois?: string;
    cep?: string;
    logradouro?: string;
    complemento?: string;
    numero?: string;
    bairro?: string;
    cidade?: string;
    estado?: string;
    profissao?: string;
    status_aluno_geral: EStatusAlunosGeral;
    possui_deficiencia: boolean;
    desc_deficiencia?: string;
    url_foto_aluno?: string;
    id_aluno_vinculado?: number;
    tipo_vinculo?: ETipoVinculoAluno;
    id_treinamento_bonus?: number;
    created_at: Date;
    updated_at: Date;
    polo?: {
        id: number;
        nome: string;
    };
    id_aluno_vinculado_fk?: {
        id: number;
        nome: string;
        email: string;
    };
}

export class AlunosListResponseDto {
    data: AlunoResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export class CreateAlunoDto {
    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_polo?: number;

    @IsNotEmpty()
    @IsString()
    @Transform(({ value }) => value?.trim())
    nome: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => (value != null && String(value).trim() !== '' ? String(value).trim() : undefined))
    nome_cracha?: string;

    @IsNotEmpty()
    @IsString()
    @Transform(({ value }) => value?.trim())
    email: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    senha?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    genero?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    cpf?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    instagram?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    data_nascimento?: string;

    @IsNotEmpty()
    @IsString()
    @Transform(({ value }) => value?.trim())
    telefone_um: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    telefone_dois?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    cep?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    logradouro?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    complemento?: string;

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
    @IsEnum(EProfissao)
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return undefined;
        const v = typeof value === 'string' ? value.trim() : value;
        return v === '' ? undefined : v;
    })
    profissao?: EProfissao;

    @IsOptional()
    @IsEnum(EStatusAlunosGeral)
    status_aluno_geral?: EStatusAlunosGeral;

    @IsNotEmpty()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    possui_deficiencia: boolean;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    desc_deficiencia?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    url_foto_aluno?: string;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_aluno_vinculado?: number;

    @IsOptional()
    @IsEnum(ETipoVinculoAluno)
    tipo_vinculo?: ETipoVinculoAluno;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_treinamento_bonus?: number;

    @IsOptional()
    @IsNumber()
    criado_por?: number;
}

export class UpdateAlunoDto {
    @IsOptional()
    @IsNumber()
    id_polo?: number;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    nome?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    nome_cracha?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    email?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    senha?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    genero?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    cpf?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    instagram?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    data_nascimento?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    telefone_um?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    telefone_dois?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    cep?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    logradouro?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    complemento?: string;

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
    @IsEnum(EProfissao)
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return undefined;
        const v = typeof value === 'string' ? value.trim() : value;
        return v === '' ? undefined : v;
    })
    profissao?: EProfissao;

    @IsOptional()
    @IsEnum(EStatusAlunosGeral)
    status_aluno_geral?: EStatusAlunosGeral;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    possui_deficiencia?: boolean;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    desc_deficiencia?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    url_foto_aluno?: string;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_aluno_vinculado?: number;

    @IsOptional()
    @IsEnum(ETipoVinculoAluno)
    tipo_vinculo?: ETipoVinculoAluno;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_treinamento_bonus?: number;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;

    @IsOptional()
    @IsString()
    atualizado_em?: string;
}

export class SoftDeleteAlunoDto {
    @IsNotEmpty()
    @IsString()
    deletado_em: string;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;
}

export class AlunoVinculoInputDto {
    @IsEnum(ETipoVinculoAluno)
    tipo_vinculo: ETipoVinculoAluno;

    @IsNumber()
    id_aluno_vinculado: number;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_treinamento?: number | null;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_turma?: number | null;
}

export class SaveAlunoVinculosDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => AlunoVinculoInputDto)
    vinculos: AlunoVinculoInputDto[];

    @IsOptional()
    @IsNumber()
    criado_por?: number;
}

export class AlunoVinculoResponseDto {
    id: number;
    id_aluno: number;
    tipo_vinculo: ETipoVinculoAluno;
    id_aluno_vinculado: number;
    id_treinamento: number | null;
    id_turma: number | null;
    aluno_vinculado?: {
        id: number;
        nome: string;
        email: string;
    };
    treinamento?: {
        id: number;
        treinamento: string;
    };
    turma?: {
        id: number;
        edicao_turma: string;
        treinamento_nome: string;
    };
}
