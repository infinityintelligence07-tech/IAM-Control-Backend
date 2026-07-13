import { IsArray, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class NotificacaoResponseDto {
    id: number;
    tipo: string;
    titulo: string;
    mensagem: string;
    setor_destino: string;
    dados: Record<string, unknown> | null;
    criado_em: Date;
    lida: boolean;
    lida_em: Date | null;
}

export class NotificacoesListResponseDto {
    data: NotificacaoResponseDto[];
    total: number;
    nao_lidas: number;
}

export class MarcarNotificacoesLidasDto {
    /** Ids das notificações a marcar como lidas. Vazio/ausente = marcar todas as visíveis. */
    @IsOptional()
    @IsArray()
    @IsInt({ each: true })
    @Type(() => Number)
    ids?: number[];
}
