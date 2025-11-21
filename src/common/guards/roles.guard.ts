import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UnitOfWorkService } from '../../modules/config/unit_of_work/uow.service';
import { EFuncoes, ESetores } from '../../modules/config/entities/enum';

@Injectable()
export class RolesGuard implements CanActivate {
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
                select: ['id', 'funcao', 'setor'] as any,
            });

            if (!usuario) {
                throw new ForbiddenException('Usuário não encontrado');
            }

            // Verificar se é ADMINISTRADOR (tem acesso total)
            const isAdmin = usuario.funcao && Array.isArray(usuario.funcao) && usuario.funcao.includes(EFuncoes.ADMINISTRADOR);
            
            if (isAdmin) {
                // Administradores têm acesso a tudo
                return true;
            }

            // Verificar funções permitidas
            const allowedFunctions = this.getAllowedFunctions(request);
            const hasFunction = allowedFunctions.length === 0 || allowedFunctions.some(funcao => 
                usuario.funcao && Array.isArray(usuario.funcao) && usuario.funcao.includes(funcao)
            );

            // Verificar setores permitidos
            const allowedSectors = this.getAllowedSectors(request);
            const hasSector = allowedSectors.length === 0 || allowedSectors.includes(usuario.setor);

            // Verificar se tem função E setor (se ambos estiverem definidos)
            if (allowedFunctions.length > 0 && allowedSectors.length > 0) {
                return hasFunction && hasSector;
            }

            // Verificar se tem função OU setor
            if (allowedFunctions.length > 0 || allowedSectors.length > 0) {
                return hasFunction || hasSector;
            }

            return true;
        } catch (error) {
            if (error instanceof ForbiddenException) {
                throw error;
            }
            throw new ForbiddenException('Erro ao verificar permissões');
        }
    }

    private getAllowedFunctions(request: any): EFuncoes[] {
        // Retorna as funções permitidas definidas no metadata do handler
        return Reflect.getMetadata('allowedFunctions', request.route?.stack?.[0]?.handle) || [];
    }

    private getAllowedSectors(request: any): ESetores[] {
        // Retorna os setores permitidos definidos no metadata do handler
        return Reflect.getMetadata('allowedSectors', request.route?.stack?.[0]?.handle) || [];
    }
}

// Decorator para definir funções permitidas
export const RequireFunctions = (...funcoes: EFuncoes[]) => {
    return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
        Reflect.defineMetadata('allowedFunctions', funcoes, descriptor.value);
        return descriptor;
    };
};

// Decorator para definir setores permitidos
export const RequireSectors = (...setores: ESetores[]) => {
    return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
        Reflect.defineMetadata('allowedSectors', setores, descriptor.value);
        return descriptor;
    };
};
