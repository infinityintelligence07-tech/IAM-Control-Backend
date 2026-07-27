import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { WebhookTokenGuard } from '../webhooks/webhook-token.guard';
import { MasterclassPushService } from './masterclass-push.service';
import {
    MasterclassEventosPushResult,
    MasterclassLeadsPushResult,
} from './dto/masterclass-push.dto';

/**
 * Webhooks de push do masterclass_integracao → IAM Control.
 *
 * Autenticação (mesmo token dos demais webhooks):
 *   - Header `x-webhook-token`
 *   - Header `Authorization: Bearer <token>`
 *   - Query `?token=`
 *
 * Rodam em paralelo ao sync diário do dash-masterclass-iam.
 */
@Controller('webhooks/masterclass')
@UseGuards(WebhookTokenGuard)
export class MasterclassPushController {
    constructor(private readonly masterclassPushService: MasterclassPushService) {}

    /**
     * POST /api/webhooks/masterclass/eventos
     * Body: `{ items: [ ...linhas de dados_masterclass ] }` ou array direto.
     */
    @Post('eventos')
    async receberEventos(@Body() body: unknown): Promise<{ ok: true } & MasterclassEventosPushResult> {
        const resultado = await this.masterclassPushService.receberEventos(body);
        return { ok: true, ...resultado };
    }

    /**
     * POST /api/webhooks/masterclass/leads
     * Body: `{ items: [ ...linhas de registros_masterclass ] }` ou array direto.
     */
    @Post('leads')
    async receberLeads(@Body() body: unknown): Promise<{ ok: true } & MasterclassLeadsPushResult> {
        const resultado = await this.masterclassPushService.receberLeads(body);
        return { ok: true, ...resultado };
    }
}
