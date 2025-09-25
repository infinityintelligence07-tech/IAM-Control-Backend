import { IsOptional, IsString, IsNumber, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class GetPolosDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    polo?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    cidade?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    estado?: string;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    page?: number = 1;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    limit?: number = 10;
}

export class PoloResponseDto {
    id: number;
    polo: string;
    sigla_polo?: string;
    cidade: string;
    estado: string;
    created_at: Date;
    updated_at: Date;
    total_alunos?: number;
}

export class PolosListResponseDto {
    data: PoloResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export class CreatePoloDto {
    @IsNotEmpty()
    @IsString()
    @Transform(({ value }) => value?.trim())
    polo: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    sigla_polo?: string;

    @IsNotEmpty()
    @IsString()
    @Transform(({ value }) => value?.trim())
    cidade: string;

    @IsNotEmpty()
    @IsString()
    @Transform(({ value }) => value?.trim())
    estado: string;

    @IsOptional()
    @IsNumber()
    criado_por?: number;
}

export class UpdatePoloDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    polo?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    sigla_polo?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    cidade?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    estado?: string;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;

    @IsOptional()
    @IsString()
    atualizado_em?: string;
}

export class SoftDeletePoloDto {
    @IsNotEmpty()
    @IsString()
    deletado_em: string;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;
}
