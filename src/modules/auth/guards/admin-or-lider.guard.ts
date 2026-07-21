import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { EFuncoes } from '../../config/entities/enum';
import { userHasSetor } from '../../../common/utils/setor.util';

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
                select: ['id', 'funcao', 'setor'] as any,
            });

            if (!usuario) {
                throw new ForbiddenException('Usuário não encontrado');
            }

            const funcoes: string[] = Array.isArray(usuario.funcao) ? usuario.funcao.map(String) : [];
            const isAdmin =
                funcoes.includes(String(EFuncoes.ADMINISTRADOR)) ||
                funcoes.includes('ADMINISTRADOR') ||
                userHasSetor(usuario, 'ADMINISTRADOR');

            const liderFunctions: string[] = [
                String(EFuncoes.LIDER),
                String(EFuncoes.LIDER_DE_EVENTOS),
                String(EFuncoes.LIDER_DE_MASTERCLASS),
                String(EFuncoes.LIDER_DE_CONFRONTO),
                'LIDER',
                'LIDER_DE_EVENTOS',
                'LIDER_DE_MASTERCLASS',
                'LIDER_DE_CONFRONTO',
            ];
            const isLider = liderFunctions.some((liderFunc) => funcoes.includes(liderFunc));

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
