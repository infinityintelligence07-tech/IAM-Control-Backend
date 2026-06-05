import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { EFuncoes } from '../../config/entities/enum';

const LIDER_ESPECIAL_FUNCTIONS = [EFuncoes.LIDER_DE_EVENTOS, EFuncoes.LIDER_DE_MASTERCLASS, EFuncoes.LIDER_DE_CONFRONTO];

@Injectable()
export class LiderGuard implements CanActivate {
    constructor(private readonly uow: UnitOfWorkService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user || !user.sub) {
            throw new ForbiddenException('Usuário não autenticado');
        }

        try {
            const usuario = await this.uow.usuariosRP.findOne({
                where: { id: user.sub },
                select: ['id', 'funcao'] as any,
            });

            if (!usuario) {
                throw new ForbiddenException('Usuário não encontrado');
            }

            if (!usuario.funcao || !Array.isArray(usuario.funcao)) {
                throw new ForbiddenException('Acesso negado. Apenas líderes podem executar esta ação.');
            }

            const hasLider = usuario.funcao.includes(EFuncoes.LIDER);
            const hasLiderEspecial = LIDER_ESPECIAL_FUNCTIONS.some((funcao) => usuario.funcao.includes(funcao));

            if (!hasLider || hasLiderEspecial) {
                throw new ForbiddenException(
                    'Acesso negado. Apenas usuários com função Líder (sem funções de líder de evento ou masterclass) podem executar esta ação.',
                );
            }

            return true;
        } catch (error) {
            if (error instanceof ForbiddenException) {
                throw error;
            }
            throw new ForbiddenException('Erro ao verificar permissões de líder');
        }
    }
}
