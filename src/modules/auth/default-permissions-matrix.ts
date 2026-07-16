import { EFuncoes, ESetores } from '../config/entities/enum';
import {
    createEmptyRolePermissions,
    FUNCTION_PRIORITY,
    getFunctionPriority,
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

/** Colaborador e funções com prioridade maior (STAFF/estagiário ficam de fora). */
const COLABORADOR_MIN_PRIORITY = FUNCTION_PRIORITY.COLABORADOR;

/** Autorizar pendência de pagamento e assinar como testemunha. */
function grantPendenciaETestemunha(role: RolePermissions): RolePermissions {
    let next = grantModule(role, 'autorizacaoPendencia', ['view', 'edit']);
    next = grantModule(next, 'assinarTestemunha', ['view', 'edit']);
    return next;
}

function shouldGrantPendenciaETestemunha(setor: ESetores, funcao: string): boolean {
    if (setor !== ESetores.EXPANSAO_NEGOCIOS) return false;
    if (funcao === PADRAO_SETOR_KEY) return true;
    return getFunctionPriority(funcao) >= COLABORADOR_MIN_PRIORITY;
}

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
    // Dashboard de vendas: só líderes (prioridade ≥ 80) em todos os setores.
    role = grantModule(role, 'vendasDashboard', ['view']);
    role = grantModule(role, 'usuarios', ['view', 'edit']);
    role = grantModule(role, 'relatorios', ['view']);
    role = grantModule(role, 'alunosNaTurma', 'all');

    if (setor === ESetores.CUIDADO_DE_ALUNOS) {
        role = grantModule(role, 'acessoraTurma', ['view', 'edit']);
    }

    return role;
}

function buildStaffPermissions(): RolePermissions {
    let role = createEmptyRolePermissions();
    role = grantModule(role, 'alunos', ['view']);
    role = grantModule(role, 'turmas', ['view']);
    role = grantModule(role, 'treinamentos', ['view']);
    role = grantModule(role, 'polos', ['view']);
    role = grantModule(role, 'vendas', ['view']);
    role = grantModule(role, 'credenciamento', ['view']);
    return role;
}

function buildAuthenticatedBase(): RolePermissions {
    let role = createEmptyRolePermissions();
    role = grantModule(role, 'turmas', ['view']);
    // Leitura de nomes de treinamentos/polos é pré-requisito dos filtros da tela
    // de turmas (quem vê turmas precisa listar treinamentos e polos).
    role = grantModule(role, 'treinamentos', ['view']);
    role = grantModule(role, 'polos', ['view']);
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
            role = grantModule(role, 'alunos', ['view', 'create', 'edit']);
            role = grantModule(role, 'alunosNaTurma', ['view', 'create', 'edit', 'delete']);
            role = grantModule(role, 'turmas', ['view', 'create', 'edit']);
            role = grantModule(role, 'calendario', ['view', 'create', 'edit']);
            return role;

        case ESetores.CUIDADO_DE_ALUNOS:
            // Operacional: cadastro de aluno + inserir/gerenciar na turma.
            role = grantModule(role, 'alunos', ['view', 'create', 'edit', 'delete']);
            role = grantModule(role, 'calendario', ['view']);
            role = grantModule(role, 'alunosNaTurma', 'all');
            role = grantModule(role, 'turmas', ['view']);
            role = grantModule(role, 'credenciamento', ['view']);
            return role;

        case ESetores.EVENTOS:
        case ESetores.EXPANSAO:
            role = grantModule(role, 'alunos', ['view', 'create', 'edit']);
            role = grantModule(role, 'alunosNaTurma', ['view', 'create', 'edit', 'delete']);
            // Fluxo de vendas (criar contrato + editar quantidade no histórico).
            role = grantModule(role, 'vendas', ['view', 'create', 'edit']);
            role = grantModule(role, 'documentos', ['view', 'create', 'edit']);
            role = grantModule(role, 'polos', ['view', 'create', 'edit']);
            role = grantModule(role, 'treinamentos', ['view', 'create', 'edit']);
            role = grantModule(role, 'enderecosEventos', ['view', 'create', 'edit']);
            role = grantModule(role, 'calendario', ['view', 'create', 'edit']);
            role = grantModule(role, 'turmas', ['view', 'create', 'edit']);
            return role;

        case ESetores.EXPANSAO_NEGOCIOS:
        case ESetores.COMERCIAL:
            role = grantModule(role, 'alunos', ['view', 'create', 'edit']);
            role = grantModule(role, 'alunosNaTurma', ['view', 'create', 'edit']);
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
                let staff = buildStaffPermissions();
                // STAFF de Eventos/Expansão opera vendas no evento (1→N inscrições).
                if (setor === ESetores.EVENTOS || setor === ESetores.EXPANSAO) {
                    staff = grantModule(staff, 'alunos', ['view', 'create', 'edit']);
                    staff = grantModule(staff, 'alunosNaTurma', ['view', 'create', 'edit']);
                    staff = grantModule(staff, 'vendas', ['view', 'create', 'edit']);
                    staff = grantModule(staff, 'documentos', ['view', 'create', 'edit']);
                }
                sectorRow[funcao] = staff;
                continue;
            }

            sectorRow[funcao] = buildSetorPadrao(setor);
        }

        for (const [funcao, role] of Object.entries(sectorRow)) {
            if (shouldGrantPendenciaETestemunha(setor, funcao)) {
                sectorRow[funcao] = grantPendenciaETestemunha(role);
            }
        }

        matrix[setor] = sectorRow;
    }

    return matrix;
}

export function getDefaultPermissionsMatrixClone(): PermissionsMatrix {
    return JSON.parse(JSON.stringify(buildDefaultPermissionsMatrix())) as PermissionsMatrix;
}
