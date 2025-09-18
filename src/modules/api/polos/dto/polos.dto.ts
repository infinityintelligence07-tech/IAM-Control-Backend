import { IsOptional, IsString, IsNumber } from 'class-validator';
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
