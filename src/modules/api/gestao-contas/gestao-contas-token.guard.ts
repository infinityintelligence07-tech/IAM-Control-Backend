import { Injectable } from '@nestjs/common';

import { WEBHOOK_TOKEN, WebhookTokenGuard } from '../webhooks/webhook-token.guard';

/**
 * Token exclusivo da integração com a Gestão de Contas (app Lovable).
 *
 * É separado do `WEBHOOK_TOKEN` de propósito: aquele também autoriza o push de
 * masterclass, e a credencial entregue a um sistema externo não deve alcançar
 * integrações que não são dele. Para rotacionar, troque este valor e atualize o
 * secret `IAM_CONTROL_WEBHOOK_TOKEN` no projeto Supabase da Gestão de Contas.
 */
export const GESTAO_CONTAS_WEBHOOK_TOKEN = 'iamctrl_gc_1aa30225c9cd186138cb0a3a967d921a285455dc79afec835fd2b69a6a01dfff';

/**
 * Aceita o token dedicado da Gestão de Contas. O token mestre continua valendo
 * para depuração interna e para não quebrar chamadas já existentes.
 */
@Injectable()
export class GestaoContasTokenGuard extends WebhookTokenGuard {
    protected get tokensAceitos(): string[] {
        return [GESTAO_CONTAS_WEBHOOK_TOKEN, WEBHOOK_TOKEN];
    }
}
