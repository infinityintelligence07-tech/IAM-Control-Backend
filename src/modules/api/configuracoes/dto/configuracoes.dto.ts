import { IsOptional, IsString, ValidateNested, IsArray, ArrayNotEmpty } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class ConfiguracaoItemDto {
    @IsString()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    chave: string;

    @IsOptional()
    @IsString()
    valor?: string | null;

    @IsOptional()
    @IsString()
    descricao?: string | null;
}

export class UpdateConfiguracoesDto {
    @IsArray()
    @ArrayNotEmpty()
    @ValidateNested({ each: true })
    @Type(() => ConfiguracaoItemDto)
    itens: ConfiguracaoItemDto[];
}

export interface ConfiguracoesResponseDto {
    [chave: string]: string | null;
}
