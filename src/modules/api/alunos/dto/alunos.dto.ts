import { IsOptional, IsString, IsNumber, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';
import { EStatusAlunosGeral } from '../../../config/entities/enum';

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
    id_polo: number;
    nome: string;
    nome_cracha: string;
    email: string;
    genero?: string;
    cpf?: string;
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
    created_at: Date;
    updated_at: Date;
    polo?: {
        id: number;
        nome: string;
    };
}

export class AlunosListResponseDto {
    data: AlunoResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}
