import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithRequestUserContext } from '../context/request-user.context';

@Injectable()
export class RequestUserContextInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const req = context.switchToHttp().getRequest<{
            user?: { sub?: string | number; id?: string | number };
            userId?: string | number;
        }>();

        const userId = req?.user?.sub ?? req?.user?.id ?? req?.userId;

        return runWithRequestUserContext(userId, () => next.handle());
    }
}

