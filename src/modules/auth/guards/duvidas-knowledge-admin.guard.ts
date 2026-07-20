import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';

/** Único usuário autorizado a gerenciar base, sugestões e import Obsidian. */
export const DUVIDAS_KNOWLEDGE_ADMIN_EMAIL = 'infinityintelligence07@gmail.com';

@Injectable()
export class DuvidasKnowledgeAdminGuard implements CanActivate {
    constructor(private readonly uow: UnitOfWorkService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user || !user.sub) {
            throw new ForbiddenException('Usuário não autenticado');
        }

        const emailFromToken = String(user.email || '').trim().toLowerCase();
        if (emailFromToken === DUVIDAS_KNOWLEDGE_ADMIN_EMAIL) {
            return true;
        }

        const usuario = await this.uow.usuariosRP.findOne({
            where: { id: user.sub },
            select: ['id', 'email'] as any,
        });

        const emailDb = String(usuario?.email || '')
            .trim()
            .toLowerCase();

        if (emailDb !== DUVIDAS_KNOWLEDGE_ADMIN_EMAIL) {
            throw new ForbiddenException(
                'Acesso restrito à gestão da base documental da Central de Dúvidas.',
            );
        }

        return true;
    }
}
