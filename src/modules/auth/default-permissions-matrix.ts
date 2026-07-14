import { EFuncoes, ESetores } from '../config/entities/enum';
import {
    createEmptyRolePermissions,
    grantFullAccess,
    grantModule,
    PADRAO_SETOR_KEY,
    type PermissionsMatrix,
    type RolePermissions,
} from './permissions.constants';

const ALL_SETORES = Object.values(ESetores);
const ALL_FUNCOES = Object.values(EFuncoes);

const LIDER_FUNCOES = [
    EFuncoes.LIDER,
    EFuncoes.LIDER_DE_EVENTOS,
    EFuncoes.LIDER_DE_MASTERCLASS,
    EFuncoes.LIDER_DE_CONFRONTO,
] as const;

function buildLiderPermissions(setor: ESetores): RolePermissions {
    let role = createEmptyRolePermissions();
    role = grantModule(role, 'dashboard', ['view']);
    role = grantModule(role, 'alunos', 'all');
    role = grantModule(role, 'polos', ['view', 'create', 'edit']);
    role = grantModule(role, 'treinamentos', ['view', 'create', 'edit']);
    role = grantModule(role, 'enderecosEventos', ['view', 'create', 'edit']);
    role = grantModule(role, 'turmas', ['view', 'create', 'edit']);
    role = grantModule(role, 'calendario', ['view', 'create', 'edit']);
    role = grantModule(role, 'credenciamento', ['view', 'edit']);
    role = grantModule(role, 'documentos', ['view', 'create', 'edit']);
    role = grantModule(role, 'vendas', ['view', 'create', 'edit']);
    role = grantModule(role, 'usuarios', ['view', 'edit']);
    role = grantModule(role, 'relatorios', ['view']);
    role = grantModule(role, 'alunosNaTurma', ['view', 'edit', 'delete']);

    if (setor === ESetores.CUIDADO_DE_ALUNOS) {
        role = grantModule(role, 'acessoraTurma', ['view', 'edit']);
    }

    return role;
}

function buildStaffPermissions(): RolePermissions {
    let role = createEmptyRolePermissions();
    role = grantModule(role, 'alunos', ['view']);
    role = grantModule(role, 'turmas', ['view']);
    role = grantModule(role, 'vendas', ['view']);
    role = grantModule(role, 'credenciamento', ['view']);
    return role;
}

function buildAuthenticatedBase(): RolePermissions {
    let role = createEmptyRolePermissions();
    role = grantModule(role, 'turmas', ['view']);
    role = grantModule(role, 'vendas', ['view']);
    role = grantModule(role, 'credenciamento', ['view']);
    return role;
}

function buildSetorPadrao(setor: ESetores): RolePermissions {
    let role = buildAuthenticatedBase();

    switch (setor) {
        case ESetores.ADMINISTRADOR:
            return grantFullAccess();

        case ESetores.CD:
            role = grantModule(role, 'turmas', ['view', 'create', 'edit']);
            role = grantModule(role, 'calendario', ['view', 'create', 'edit']);
            return role;

        case ESetores.CUIDADO_DE_ALUNOS:
            role = grantModule(role, 'alunos', ['view', 'edit', 'delete']);
            role = grantModule(role, 'calendario', ['view']);
            role = grantModule(role, 'alunosNaTurma', ['view', 'edit', 'delete']);
            role = grantModule(role, 'turmas', ['view']);
            role = grantModule(role, 'credenciamento', ['view']);
            return role;

        case ESetores.EVENTOS:
        case ESetores.EXPANSAO:
            role = grantModule(role, 'alunos', ['view']);
            role = grantModule(role, 'polos', ['view', 'create', 'edit']);
            role = grantModule(role, 'treinamentos', ['view', 'create', 'edit']);
            role = grantModule(role, 'enderecosEventos', ['view', 'create', 'edit']);
            role = grantModule(role, 'calendario', ['view', 'create', 'edit']);
            role = grantModule(role, 'turmas', ['view', 'create', 'edit']);
            return role;

        case ESetores.EXPANSAO_NEGOCIOS:
        case ESetores.COMERCIAL:
            role = grantModule(role, 'alunos', ['view', 'edit']);
            return role;

        case ESetores.JURIDICO:
            role = grantModule(role, 'documentos', ['view', 'create', 'edit']);
            return role;

        case ESetores.FINANCEIRO:
            role = grantModule(role, 'relatorios', ['view']);
            role = grantModule(role, 'vendas', ['view']);
            return role;

        default:
            return role;
    }
}

/** Matriz padrão v2: módulos × ações (igual ao front). */
export function buildDefaultPermissionsMatrix(): PermissionsMatrix {
    const matrix: PermissionsMatrix = {};

    for (const setor of ALL_SETORES) {
        const sectorRow: Record<string, RolePermissions> = {
            [PADRAO_SETOR_KEY]: buildSetorPadrao(setor),
        };

        for (const funcao of ALL_FUNCOES) {
            if (funcao === EFuncoes.ADMINISTRADOR) {
                sectorRow[funcao] = grantFullAccess();
                continue;
            }

            if ((LIDER_FUNCOES as readonly string[]).includes(funcao)) {
                const lider = buildLiderPermissions(setor);
                if (funcao === EFuncoes.LIDER) {
                    sectorRow[funcao] = grantModule(lider, 'usuarios', ['view', 'edit', 'create']);
                } else {
                    sectorRow[funcao] = lider;
                }
                continue;
            }

            if (funcao === EFuncoes.STAFF) {
                sectorRow[funcao] = buildStaffPermissions();
                continue;
            }

            sectorRow[funcao] = buildSetorPadrao(setor);
        }

        matrix[setor] = sectorRow;
    }

    return matrix;
}

export function getDefaultPermissionsMatrixClone(): PermissionsMatrix {
    return JSON.parse(JSON.stringify(buildDefaultPermissionsMatrix())) as PermissionsMatrix;
}
