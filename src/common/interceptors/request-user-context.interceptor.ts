import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { runWithRequestUserContext } from '../context/request-user.context';

@Injectable()
export class RequestUserContextInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const req = context.switchToHttp().getRequest<{
            user?: { sub?: string | number; id?: string | number };
            userId?: string | number;
            headers?: Record<string, string | string[] | undefined>;
        }>();
        const res = context.switchToHttp().getResponse<{
            setHeader: (name: string, value: string) => void;
        }>();

        const userId = req?.user?.sub ?? req?.user?.id ?? req?.userId;
        const rawRequestId = req?.headers?.['x-request-id'];
        const requestId = Array.isArray(rawRequestId) ? rawRequestId[0] : rawRequestId || randomUUID();

        if (requestId) {
            res?.setHeader?.('x-request-id', requestId);
        }

        return runWithRequestUserContext({ userId, requestId }, () => next.handle());
    }
}
