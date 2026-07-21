import { IsOptional, IsString, IsNumber, IsEnum, IsArray, ArrayMinSize, IsEmail, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';
import { ESetores, EFuncoes } from '../../../config/entities/enum';
import { normalizeSetores } from '../../../../common/utils/setor.util';

export class GetUsuariosDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    nome?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    email?: string;

    @IsOptional()
    @IsEnum(ESetores)
    setor?: ESetores;

    @IsOptional()
    @IsEnum(EFuncoes)
    funcao?: EFuncoes;

    @IsOptional()
    @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
    aprovado?: boolean;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    page?: number = 1;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    limit?: number = 10;
}

export class UsuarioResponseDto {
    id: number;
    nome: string;
    primeiro_nome: string;
    sobrenome: string;
    email: string;
    cpf?: string;
    telefone: string;
    setor: ESetores[];
    funcao: EFuncoes[];
    url_foto?: string;
    aprovado: boolean;
    aprovado_em?: Date;
    aprovado_por?: number;
    criado_em: Date;
    atualizado_em: Date;
}

export class UsuariosListResponseDto {
    data: UsuarioResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export class UpdateUsuarioDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    primeiro_nome?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    sobrenome?: string;

    @IsOptional()
    @IsEmail()
    @Transform(({ value }) => value?.trim().toLowerCase())
    email?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    telefone?: string;

    @IsOptional()
    @Transform(({ value }) => (value === undefined ? undefined : normalizeSetores(value)))
    @IsArray({ message: 'Setor deve ser uma lista' })
    @ArrayMinSize(1, { message: 'Informe ao menos um setor' })
    @IsEnum(ESetores, { each: true })
    setor?: ESetores[];

    @IsOptional()
    @IsArray()
    @IsEnum(EFuncoes, { each: true })
    funcao?: EFuncoes[];

    @IsOptional()
    @IsString()
    url_foto?: string;
}

export class SoftDeleteUsuarioDto {
    @IsNotEmpty()
    @IsString()
    deletado_em: string;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;
}

export class AprovarUsuarioDto {
    @IsOptional()
    @Transform(({ value }) => (value === undefined ? true : value === 'true' || value === true))
    aprovado?: boolean = true;
}
