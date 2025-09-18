import { IsEmail, IsString, IsOptional, IsEnum, MinLength, MaxLength, Matches } from 'class-validator';
import { ESetores, EFuncoes } from '../../modules/config/entities/enum';

export class SignupDto {
    @IsString()
    @MinLength(2, { message: 'Primeiro nome deve ter no mínimo 2 caracteres' })
    @MaxLength(50, { message: 'Primeiro nome deve ter no máximo 50 caracteres' })
    primeiro_nome: string;

    @IsString()
    @MinLength(2, { message: 'Sobrenome deve ter no mínimo 2 caracteres' })
    @MaxLength(50, { message: 'Sobrenome deve ter no máximo 50 caracteres' })
    sobrenome: string;

    @IsEmail({}, { message: 'E-mail inválido' })
    email: string;

    @IsString()
    @MinLength(8, { message: 'Senha deve ter no mínimo 8 caracteres' })
    @MaxLength(16, { message: 'Senha deve ter no máximo 16 caracteres' })
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,16}$/, {
        message: 'Senha deve conter ao menos uma letra minúscula, uma maiúscula, um número e um caractere especial',
    })
    senha: string;

    @IsString()
    @Matches(/^\(\d{2}\)\s\d{4,5}-\d{4}$/, { message: 'Telefone deve estar no formato (XX) XXXX-XXXX ou (XX) XXXXX-XXXX' })
    telefone: string;

    @IsEnum(ESetores, { message: 'Setor inválido' })
    setor: ESetores;

    @IsOptional()
    @IsEnum(EFuncoes, { message: 'Função inválida' })
    funcao?: EFuncoes;

    @IsOptional()
    @IsString()
    provider?: 'google' | 'credentials';

    @IsOptional()
    @IsString()
    providerId?: string;

    @IsOptional()
    @IsString()
    picture?: string;
}

export class LoginDto {
    @IsEmail({}, { message: 'E-mail inválido' })
    email: string;

    @IsOptional()
    @IsString()
    senha?: string;

    @IsOptional()
    @IsString()
    provider?: 'google' | 'credentials';

    @IsOptional()
    @IsString()
    providerId?: string;
}

export class ForgotPasswordDto {
    @IsEmail({}, { message: 'E-mail inválido' })
    email: string;
}

export class ResetPasswordDto {
    @IsString()
    token: string;

    @IsString()
    @MinLength(8, { message: 'Senha deve ter no mínimo 8 caracteres' })
    @MaxLength(16, { message: 'Senha deve ter no máximo 16 caracteres' })
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,16}$/, {
        message: 'Senha deve conter ao menos uma letra minúscula, uma maiúscula, um número e um caractere especial',
    })
    senha: string;
}
