import { IsOptional, IsString, IsNumber, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros do webhook de eventos (treinamentos, exceto palestras e mentorias). */
export class GetEventosWebhookDto {
    /** Data inicial do período (YYYY-MM-DD). */
    @IsString({ message: 'data_inicio é obrigatória (formato YYYY-MM-DD).' })
    @Matches(DATE_REGEX, { message: 'data_inicio deve estar no formato YYYY-MM-DD.' })
    @Transform(({ value }) => value?.toString().trim())
    data_inicio: string;

    /** Data final do período (YYYY-MM-DD). */
    @IsString({ message: 'data_final é obrigatória (formato YYYY-MM-DD).' })
    @Matches(DATE_REGEX, { message: 'data_final deve estar no formato YYYY-MM-DD.' })
    @Transform(({ value }) => value?.toString().trim())
    data_final: string;

    /** Filtro opcional por treinamento. */
    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value, 10))
    id_treinamento?: number;

    /** Filtro opcional por polo. */
    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value, 10))
    id_polo?: number;

    /** Token de webhook (alternativa ao header). Validado pelo WebhookTokenGuard. */
    @IsOptional()
    @IsString()
    token?: string;
}

export class EventoWebhookTreinamentoDto {
    id: number;
    nome: string;
    sigla?: string | null;
    url_logo?: string | null;
    online?: boolean;
    /** Duração em meses (apenas mentorias). */
    duracao_meses?: number | null;
}

export class EventoWebhookEnderecoDto {
    cep?: string | null;
    logradouro?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
}

export class EventoWebhookPoloDto {
    id: number;
    nome: string;
    cidade: string;
    estado: string;
}

export class EventoWebhookLiderDto {
    id: number;
    nome: string;
}

export class EventoWebhookMetricasDto {
    inscritos: number;
    inscricoes_extras: number;
    confirmados: number;
    presentes: number;
    inadimplentes: number;
    transferidos: number;
    vindos_transferencia: number;
}

export class EventoWebhookUrlsDto {
    midia_kit?: string | null;
    grupo_whatsapp?: string | null;
    grupo_whatsapp_2?: string | null;
    pagamento_cartao?: string | null;
}

export class EventoWebhookItemDto {
    id: number;
    tipo: 'treinamento';
    edicao?: string | null;
    status: string;
    treinamento: EventoWebhookTreinamentoDto;
    data_inicio: string | null;
    data_final: string | null;
    capacidade?: number | null;
    meta?: number | null;
    endereco: EventoWebhookEnderecoDto;
    polo?: EventoWebhookPoloDto;
    lider?: EventoWebhookLiderDto;
    metricas: EventoWebhookMetricasDto;
    urls: EventoWebhookUrlsDto;
    created_at: Date;
    updated_at: Date;
}

export class EventosWebhookResponseDto {
    data_inicio: string;
    data_final: string;
    total: number;
    eventos: EventoWebhookItemDto[];
}
