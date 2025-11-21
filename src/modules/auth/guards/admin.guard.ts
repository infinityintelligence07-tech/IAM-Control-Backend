import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { EFuncoes } from '../../config/entities/enum';

@Injectable()
export class AdminGuard implements CanActivate {
    constructor(private readonly uow: UnitOfWorkService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user || !user.sub) {
            throw new ForbiddenException('Usuário não autenticado');
        }

        try {
            // Buscar o usuário completo do banco para verificar as funções
            const usuario = await this.uow.usuariosRP.findOne({
                where: { id: user.sub },
                select: ['id', 'funcao'] as any,
            });

            if (!usuario) {
                throw new ForbiddenException('Usuário não encontrado');
            }

            // Verificar se o usuário tem a função ADMINISTRADOR
            const isAdmin = usuario.funcao && Array.isArray(usuario.funcao) && usuario.funcao.includes(EFuncoes.ADMINISTRADOR);

            if (!isAdmin) {
                throw new ForbiddenException('Acesso negado. Apenas administradores podem acessar esta rota.');
            }

            return true;
        } catch (error) {
            if (error instanceof ForbiddenException) {
                throw error;
            }
            // Se não conseguir buscar do banco, nega acesso por segurança
            throw new ForbiddenException('Erro ao verificar permissões de administrador');
        }
    }
}
