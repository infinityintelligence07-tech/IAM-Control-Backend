import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

/**
 * Token fixo e imutável dos endpoints de webhook.
 *
 * É intencionalmente hardcoded (não vem de env) para permanecer constante entre
 * deploys/ambientes. Para rotacioná-lo, altere este valor.
 */
export const WEBHOOK_TOKEN = 'iamctrl_whk_20ce9fca6b56a9ae32162eb6c4087da2d9116f6234aeb9aec050bcbe371daa5d';

/**
 * Autenticação simples por token estático para os endpoints de webhook.
 *
 * O token é lido (nesta ordem) de:
 *  - Header `x-webhook-token`
 *  - Header `Authorization: Bearer <token>`
 *  - Query param `token`
 *
 * E comparado, de forma constante (timing-safe), com o token fixo `WEBHOOK_TOKEN`.
 */
@Injectable()
export class WebhookTokenGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const expectedToken = WEBHOOK_TOKEN;

        const request = context.switchToHttp().getRequest<Request>();
        const providedToken = this.extractToken(request);

        if (!providedToken || !this.tokensMatch(providedToken, expectedToken)) {
            throw new UnauthorizedException('Token de webhook inválido ou ausente.');
        }

        return true;
    }

    private extractToken(request: Request): string | undefined {
        const headerToken = request.headers['x-webhook-token'];
        if (typeof headerToken === 'string' && headerToken.trim()) {
            return headerToken.trim();
        }

        const authHeader = request.headers.authorization;
        if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
            const bearer = authHeader.slice(7).trim();
            if (bearer) return bearer;
        }

        const queryToken = request.query?.token;
        if (typeof queryToken === 'string' && queryToken.trim()) {
            return queryToken.trim();
        }

        return undefined;
    }

    private tokensMatch(provided: string, expected: string): boolean {
        const providedBuffer = Buffer.from(provided);
        const expectedBuffer = Buffer.from(expected);

        if (providedBuffer.length !== expectedBuffer.length) {
            return false;
        }

        return timingSafeEqual(providedBuffer, expectedBuffer);
    }
}
