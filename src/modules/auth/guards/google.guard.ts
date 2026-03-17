import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
    getAuthenticateOptions(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        const host = request.get('host') || '';
        const protocol = request.get('x-forwarded-proto') || request.protocol || 'http';

        // Determine callback URL based on request origin
        let callbackURL: string;
        if (host.includes('iamcontrol.com.br')) {
            callbackURL = 'https://iamcontrol.com.br/api/auth/google/callback';
        } else {
            callbackURL = `${protocol}://${host}/api/auth/google/callback`;
        }

        return { callbackURL };
    }
}
