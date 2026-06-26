import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhookTokenGuard } from './webhook-token.guard';
import { GetEventosWebhookDto, EventosWebhookResponseDto } from './dto/webhooks.dto';

@Controller('webhooks')
export class WebhooksController {
    constructor(private readonly webhooksService: WebhooksService) {}

    /**
     * GET /api/webhooks/eventos
     *
     * Retorna todos os eventos de treinamento (exceto palestras e mentorias) com suas
     * informações dentro do período informado.
     *
     * Autenticação: token fixo via header `x-webhook-token`,
     * `Authorization: Bearer <token>` ou query param `token`.
     */
    @Get('eventos')
    @UseGuards(WebhookTokenGuard)
    async getEventos(@Query() filtros: GetEventosWebhookDto): Promise<EventosWebhookResponseDto> {
        return this.webhooksService.getEventos(filtros);
    }
}
