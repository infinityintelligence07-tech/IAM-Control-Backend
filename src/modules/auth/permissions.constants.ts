export const PADRAO_SETOR_KEY = '__PADRAO_SETOR__' as const;

export const ACTION_KEYS = ['view', 'create', 'edit', 'delete'] as const;
export type ActionKey = (typeof ACTION_KEYS)[number];

export const MODULE_KEYS = [
    'dashboard',
    'alunos',
    'polos',
    'treinamentos',
    'enderecosEventos',
    'turmas',
    'calendario',
    'credenciamento',
    'documentos',
    'vendas',
    'vendasDashboard',
    'usuarios',
    'relatorios',
    'alunosNaTurma',
    'acessoraTurma',
    'autorizacaoPendencia',
    'assinarTestemunha',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleActions = Record<ActionKey, boolean>;

/** Permissões de um papel (função ou padrão do setor) */
export type RolePermissions = Record<ModuleKey, ModuleActions>;

/** setor -> função (ou __PADRAO_SETOR__) -> módulos -> ações */
export type PermissionsMatrix = Record<string, Record<string, RolePermissions>>;

/**
 * Chaves legadas usadas pelos guards/@RequirePermission e pelo front (usePermissions).
 */
export type PermissionKey =
    | 'dashboard'
    | 'alunos'
    | 'excluirAluno'
    | 'polos'
    | 'treinamentos'
    | 'enderecosEventos'
    | 'turmas'
    | 'criarTurma'
    | 'calendario'
    | 'credenciamento'
    | 'alterarCredenciamento'
    | 'documentos'
    | 'vendas'
    | 'vendasDashboard'
    | 'usuarios'
    | 'aprovarUsuarios'
    | 'relatorios'
    | 'gerenciarAlunosTurma'
    | 'definirAcessoraTurma'
    | 'autorizarPendencia'
    | 'assinarTestemunha';

export const PERMISSION_KEY_MAP: Record<PermissionKey, { module: ModuleKey; action: ActionKey }> = {
    dashboard: { module: 'dashboard', action: 'view' },
    alunos: { module: 'alunos', action: 'view' },
    excluirAluno: { module: 'alunos', action: 'delete' },
    polos: { module: 'polos', action: 'view' },
    treinamentos: { module: 'treinamentos', action: 'view' },
    enderecosEventos: { module: 'enderecosEventos', action: 'view' },
    turmas: { module: 'turmas', action: 'view' },
    criarTurma: { module: 'turmas', action: 'create' },
    calendario: { module: 'calendario', action: 'view' },
    credenciamento: { module: 'credenciamento', action: 'view' },
    alterarCredenciamento: { module: 'credenciamento', action: 'edit' },
    documentos: { module: 'documentos', action: 'view' },
    vendas: { module: 'vendas', action: 'view' },
    vendasDashboard: { module: 'vendasDashboard', action: 'view' },
    usuarios: { module: 'usuarios', action: 'view' },
    aprovarUsuarios: { module: 'usuarios', action: 'edit' },
    relatorios: { module: 'relatorios', action: 'view' },
    gerenciarAlunosTurma: { module: 'alunosNaTurma', action: 'delete' },
    definirAcessoraTurma: { module: 'acessoraTurma', action: 'edit' },
    autorizarPendencia: { module: 'autorizacaoPendencia', action: 'edit' },
    assinarTestemunha: { module: 'assinarTestemunha', action: 'edit' },
};

export const PERMISSION_KEYS = Object.keys(PERMISSION_KEY_MAP) as PermissionKey[];

/** Prioridade das funções (maior = vence sozinha). */
export const FUNCTION_PRIORITY: Record<string, number> = {
    ADMINISTRADOR: 100,
    LIDER: 90,
    LIDER_DE_EVENTOS: 80,
    LIDER_DE_MASTERCLASS: 80,
    LIDER_DE_CONFRONTO: 80,
    PALESTRANTE: 55,
    TUTOR_MISSAO: 55,
    DESENVOLVEDOR: 50,
    ADVOGADO: 50,
    VENDEDOR: 45,
    INSIDE_SALES: 45,
    SOCIAL_SELLING: 45,
    RELACIONAMENTO_COM_CLIENTES: 45,
    DESIGNER_GRAFICO: 40,
    WEB_DESIGNER: 40,
    COPYWRITER: 40,
    SOCIAL_MEDIA: 40,
    TRAFEGO_DIGITAL: 40,
    EDICAO_DE_VIDEO: 40,
    FOTOGRAFO: 40,
    CLIPADOR: 40,
    DJ: 40,
    LOGISTICA: 40,
    COLABORADOR: 30,
    STAFF: 20,
    ESTAGIARIO: 10,
    [PADRAO_SETOR_KEY]: 0,
};

export const PERMISSIONS_MATRIX_CONFIG_KEY = 'permissions_matrix';
export const PERMISSIONS_MATRIX_VERSION = 7;
export const PERMISSION_METADATA_KEY = 'required_permission';

export function getFunctionPriority(funcao: string): number {
    return FUNCTION_PRIORITY[funcao] ?? 25;
}

export function pickHighestPriorityFunction(funcoes: string[] | undefined | null): string | null {
    if (!funcoes || funcoes.length === 0) return null;
    let best: string | null = null;
    let bestPriority = -1;
    for (const funcao of funcoes) {
        const priority = getFunctionPriority(funcao);
        if (priority > bestPriority) {
            bestPriority = priority;
            best = funcao;
        }
    }
    return best;
}

export function createEmptyModuleActions(defaults: Partial<ModuleActions> = {}): ModuleActions {
    return {
        view: defaults.view ?? false,
        create: defaults.create ?? false,
        edit: defaults.edit ?? false,
        delete: defaults.delete ?? false,
    };
}

export function createEmptyRolePermissions(
    defaults?: Partial<Record<ModuleKey, Partial<ModuleActions>>>,
): RolePermissions {
    return MODULE_KEYS.reduce((acc, module) => {
        acc[module] = createEmptyModuleActions(defaults?.[module]);
        return acc;
    }, {} as RolePermissions);
}

export function grantModule(role: RolePermissions, module: ModuleKey, actions: ActionKey[] | 'all'): RolePermissions {
    const next = {
        ...role,
        [module]: { ...role[module] },
    };
    const list = actions === 'all' ? ([...ACTION_KEYS] as ActionKey[]) : actions;
    for (const action of list) {
        next[module][action] = true;
    }
    return next;
}

export function grantFullAccess(): RolePermissions {
    return MODULE_KEYS.reduce((acc, module) => {
        acc[module] = createEmptyModuleActions({
            view: true,
            create: true,
            edit: true,
            delete: true,
        });
        return acc;
    }, {} as RolePermissions);
}
