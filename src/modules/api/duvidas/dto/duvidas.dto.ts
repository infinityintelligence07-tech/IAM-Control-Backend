import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class DuvidasChatDto {
    @IsString()
    @MinLength(1)
    @MaxLength(8000)
    mensagem: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    conversa_id?: number;

    /** Se true, cria sugestão pendente a partir da pergunta/resposta. */
    @IsOptional()
    @IsBoolean()
    sugerir_base?: boolean;
}

export class CriarArtigoDto {
    @IsString()
    @MinLength(1)
    @MaxLength(500)
    titulo: string;

    @IsString()
    @MinLength(1)
    conteudo_md: string;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    caminho_origem?: string;

    @IsOptional()
    tags?: string[];
}

export class AtualizarArtigoDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(500)
    titulo?: string;

    @IsOptional()
    @IsString()
    @MinLength(1)
    conteudo_md?: string;

    @IsOptional()
    @IsString()
    status?: 'publicado' | 'arquivado';

    @IsOptional()
    tags?: string[];
}

export class AprovarSugestaoDto {
    @IsOptional()
    @IsString()
    @MaxLength(500)
    titulo?: string;

    @IsOptional()
    @IsString()
    conteudo_md?: string;
}

export class ListarArtigosQueryDto {
    @IsOptional()
    @IsString()
    q?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    limit?: number;
}

export class ListarSugestoesQueryDto {
    @IsOptional()
    @IsString()
    status?: 'pendente' | 'aprovada' | 'rejeitada' | 'todas';

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    limit?: number;
}
