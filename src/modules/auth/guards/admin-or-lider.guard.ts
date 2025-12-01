import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { EFuncoes } from '../../config/entities/enum';

@Injectable()
export class AdminOrLiderGuard implements CanActivate {
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

            if (!usuario.funcao || !Array.isArray(usuario.funcao)) {
                throw new ForbiddenException('Acesso negado. Apenas administradores ou líderes podem acessar esta rota.');
            }

            // Verificar se o usuário tem a função ADMINISTRADOR
            const isAdmin = usuario.funcao.includes(EFuncoes.ADMINISTRADOR);

            // Verificar se o usuário tem alguma função de LÍDER
            const liderFunctions = [
                EFuncoes.LIDER,
                EFuncoes.LIDER_DE_EVENTOS,
                EFuncoes.LIDER_DE_MASTERCLASS,
                EFuncoes.LIDER_DE_CONFRONTO,
            ];
            const isLider = liderFunctions.some((liderFunc) => usuario.funcao.includes(liderFunc));

            if (!isAdmin && !isLider) {
                throw new ForbiddenException('Acesso negado. Apenas administradores ou líderes podem acessar esta rota.');
            }

            return true;
        } catch (error) {
            if (error instanceof ForbiddenException) {
                throw error;
            }
            // Se não conseguir buscar do banco, nega acesso por segurança
            throw new ForbiddenException('Erro ao verificar permissões de acesso');
        }
    }
}

