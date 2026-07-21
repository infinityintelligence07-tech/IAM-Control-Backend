import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { EFuncoes } from '../../config/entities/enum';
import type { PermissionRequirement } from '../decorators/require-permission.decorator';
import { PERMISSION_METADATA_KEY, PERMISSION_KEY_MAP, type PermissionKey } from '../permissions.constants';
import { PermissionsMatrixService } from '../permissions-matrix.service';
import { userHasSetor } from '../../../common/utils/setor.util';

function isPermissionKey(value: PermissionRequirement): value is PermissionKey {
    return typeof value === 'string';
}

@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly uow: UnitOfWorkService,
        private readonly permissionsMatrix: PermissionsMatrixService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(PERMISSION_METADATA_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!requirement) {
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user?.sub) {
            throw new ForbiddenException('Usuário não autenticado');
        }

        const usuario = await this.uow.usuariosRP.findOne({
            where: { id: user.sub },
            select: ['id', 'setor', 'funcao'] as any,
        });

        if (!usuario) {
            throw new ForbiddenException('Usuário não encontrado');
        }

        const funcoes = (Array.isArray(usuario.funcao) ? usuario.funcao : []).map(String);
        const isAdmin =
            funcoes.includes(EFuncoes.ADMINISTRADOR) ||
            funcoes.includes('ADMINISTRADOR') ||
            userHasSetor(usuario, 'ADMINISTRADOR');
        if (isAdmin) {
            return true;
        }

        const { module, action } = isPermissionKey(requirement) ? PERMISSION_KEY_MAP[requirement] : requirement;

        const allowed = await this.permissionsMatrix.hasModuleAction(usuario.setor, funcoes, module, action);
        if (!allowed) {
            throw new ForbiddenException(`Acesso negado. Permissão necessária: ${module}.${action}.`);
        }

        return true;
    }
}
