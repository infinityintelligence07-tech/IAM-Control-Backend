import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class InactivityMiddleware implements NestMiddleware {
    private readonly INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutos em millisegundos
    private userSessions = new Map<number, { lastActivity: number; timeoutId: NodeJS.Timeout }>();

    constructor(private readonly jwtService: JwtService) {}

    use(req: Request, res: Response, next: NextFunction) {
        const token = this.extractTokenFromHeader(req);

        if (!token) {
            return next();
        }

        try {
            const payload = this.jwtService.verify(token);
            const userId = payload.sub;

            // Atualiza a última atividade do usuário
            this.updateUserActivity(userId);

            // Adiciona informações do usuário ao request
            req['user'] = payload;

            next();
        } catch (error) {
            // Token inválido ou expirado
            next();
        }
    }

    private extractTokenFromHeader(request: Request): string | undefined {
        const [type, token] = request.headers.authorization?.split(' ') ?? [];
        return type === 'Bearer' ? token : undefined;
    }

    private updateUserActivity(userId: number) {
        // Cancela o timeout anterior se existir
        const existingSession = this.userSessions.get(userId);
        if (existingSession) {
            clearTimeout(existingSession.timeoutId);
        }

        // Cria um novo timeout
        const timeoutId = setTimeout(() => {
            this.userSessions.delete(userId);
        }, this.INACTIVITY_TIMEOUT);

        // Atualiza a sessão do usuário
        this.userSessions.set(userId, {
            lastActivity: Date.now(),
            timeoutId,
        });
    }

    // Método para verificar se um usuário está ativo
    isUserActive(userId: number): boolean {
        return this.userSessions.has(userId);
    }

    // Método para forçar logout de um usuário
    forceLogout(userId: number) {
        const session = this.userSessions.get(userId);
        if (session) {
            clearTimeout(session.timeoutId);
            this.userSessions.delete(userId);
        }
    }
}
