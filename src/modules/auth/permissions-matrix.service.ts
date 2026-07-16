import { BadRequestException, Injectable } from '@nestjs/common';
import { UnitOfWorkService } from '../config/unit_of_work/uow.service';
import { getDefaultPermissionsMatrixClone } from './default-permissions-matrix';
import {
    ACTION_KEYS,
    createEmptyModuleActions,
    createEmptyRolePermissions,
    MODULE_KEYS,
    PADRAO_SETOR_KEY,
    PERMISSION_KEY_MAP,
    PERMISSIONS_MATRIX_CONFIG_KEY,
    PERMISSIONS_MATRIX_VERSION,
    pickHighestPriorityFunction,
    type ActionKey,
    type ModuleKey,
    type PermissionKey,
    type PermissionsMatrix,
    type RolePermissions,
} from './permissions.constants';

export type PermissionsMatrixPayload = {
    version: number;
    matrix: PermissionsMatrix | null;
    source: 'database' | 'empty';
};

type StoredPayload = {
    version: number;
    matrix: PermissionsMatrix;
};

@Injectable()
export class PermissionsMatrixService {
    private cachedMatrix: PermissionsMatrix | null = null;
    private cacheLoaded = false;

    constructor(private readonly uow: UnitOfWorkService) {}

    getDefaultMatrix(): PermissionsMatrix {
        return getDefaultPermissionsMatrixClone();
    }

    async getMatrix(): Promise<PermissionsMatrixPayload> {
        const fromDb = await this.loadStoredMatrix();
        if (fromDb) {
            // Upgrade automático (conteúdo + versão) quando a matriz salva está atrás.
            if (fromDb.version < PERMISSIONS_MATRIX_VERSION) {
                const upgradedMatrix = this.upgradeMatrixContent(fromDb.matrix, fromDb.version);
                const upgraded = await this.persistMatrix(upgradedMatrix, PERMISSIONS_MATRIX_VERSION);
                this.setCache(upgraded.matrix);
                return {
                    version: upgraded.version,
                    matrix: upgraded.matrix,
                    source: 'database',
                };
            }
            this.setCache(fromDb.matrix);
            return {
                version: fromDb.version,
                matrix: fromDb.matrix,
                source: 'database',
            };
        }

        const seeded = await this.persistMatrix(this.getDefaultMatrix(), PERMISSIONS_MATRIX_VERSION);
        this.setCache(seeded.matrix);
        return {
            version: seeded.version,
            matrix: seeded.matrix,
            source: 'database',
        };
    }

    async saveMatrix(body: { version?: number; matrix?: PermissionsMatrix } | PermissionsMatrix): Promise<PermissionsMatrixPayload> {
        const matrixCandidate =
            body && typeof body === 'object' && 'matrix' in body
                ? (body as { matrix?: PermissionsMatrix }).matrix
                : (body as PermissionsMatrix);

        const matrix = this.normalizeMatrix(matrixCandidate);
        if (!matrix) {
            throw new BadRequestException('Matriz de permissões inválida ou vazia.');
        }

        const version =
            body && typeof body === 'object' && 'version' in body
                ? Number((body as { version?: number }).version) || PERMISSIONS_MATRIX_VERSION
                : PERMISSIONS_MATRIX_VERSION;

        const saved = await this.persistMatrix(matrix, Math.max(version, PERMISSIONS_MATRIX_VERSION));
        this.setCache(saved.matrix);
        return {
            version: saved.version,
            matrix: saved.matrix,
            source: 'database',
        };
    }

    async resetToDefaults(): Promise<PermissionsMatrixPayload> {
        const saved = await this.persistMatrix(this.getDefaultMatrix(), PERMISSIONS_MATRIX_VERSION);
        this.setCache(saved.matrix);
        return {
            version: saved.version,
            matrix: saved.matrix,
            source: 'database',
        };
    }

    async hasPermission(setor: string | undefined | null, funcoes: string[] | undefined | null, key: PermissionKey): Promise<boolean> {
        const mapping = PERMISSION_KEY_MAP[key];
        return this.hasModuleAction(setor, funcoes, mapping.module, mapping.action);
    }

    async hasModuleAction(
        setor: string | undefined | null,
        funcoes: string[] | undefined | null,
        module: ModuleKey,
        action: ActionKey,
    ): Promise<boolean> {
        const matrix = await this.getResolvedMatrix();
        return this.evaluateModuleAction(matrix, setor, funcoes, module, action);
    }

    evaluateModuleAction(
        matrix: PermissionsMatrix,
        setor: string | undefined | null,
        funcoes: string[] | undefined | null,
        module: ModuleKey,
        action: ActionKey,
    ): boolean {
        const role = this.resolveEffectiveRole(matrix, setor, funcoes);
        if (!role) return false;
        return Boolean(role[module]?.[action]);
    }

    resolveEffectiveRole(
        matrix: PermissionsMatrix,
        setor: string | undefined | null,
        funcoes: string[] | undefined | null,
    ): RolePermissions | null {
        if (!setor || !matrix[setor]) return null;

        const winning = pickHighestPriorityFunction(funcoes);
        if (winning && matrix[setor][winning]) {
            return matrix[setor][winning];
        }
        return matrix[setor][PADRAO_SETOR_KEY] ?? null;
    }

    invalidateCache(): void {
        this.cachedMatrix = null;
        this.cacheLoaded = false;
    }

    private async getResolvedMatrix(): Promise<PermissionsMatrix> {
        if (this.cacheLoaded && this.cachedMatrix) {
            return this.cachedMatrix;
        }
        const payload = await this.getMatrix();
        return payload.matrix ?? this.getDefaultMatrix();
    }

    private setCache(matrix: PermissionsMatrix): void {
        this.cachedMatrix = matrix;
        this.cacheLoaded = true;
    }

    private async loadStoredMatrix(): Promise<StoredPayload | null> {
        const registro = await this.uow.configuracoesSistemaRP.findOne({
            where: { chave: PERMISSIONS_MATRIX_CONFIG_KEY },
        });

        if (!registro?.valor) {
            return null;
        }

        try {
            const parsed = JSON.parse(registro.valor) as StoredPayload | PermissionsMatrix;
            const matrixCandidate =
                parsed && typeof parsed === 'object' && 'matrix' in parsed
                    ? (parsed as StoredPayload).matrix
                    : (parsed as PermissionsMatrix);
            const matrix = this.normalizeMatrix(matrixCandidate);
            if (!matrix) return null;

            const version =
                parsed && typeof parsed === 'object' && 'version' in parsed
                    ? Number((parsed as StoredPayload).version) || 1
                    : 1;

            return { version, matrix };
        } catch {
            return null;
        }
    }

    private async persistMatrix(matrix: PermissionsMatrix, version: number): Promise<StoredPayload> {
        const normalized = this.normalizeMatrix(matrix);
        if (!normalized) {
            throw new BadRequestException('Matriz de permissões inválida ou vazia.');
        }

        const payload: StoredPayload = { version, matrix: normalized };
        const valor = JSON.stringify(payload);

        const existente = await this.uow.configuracoesSistemaRP.findOne({
            where: { chave: PERMISSIONS_MATRIX_CONFIG_KEY },
        });

        if (existente) {
            existente.valor = valor;
            existente.descricao = 'Matriz de permissões por setor/função (módulos × ações)';
            await this.uow.configuracoesSistemaRP.save(existente);
        } else {
            const novo = this.uow.configuracoesSistemaRP.create({
                chave: PERMISSIONS_MATRIX_CONFIG_KEY,
                valor,
                descricao: 'Matriz de permissões por setor/função (módulos × ações)',
            });
            await this.uow.configuracoesSistemaRP.save(novo);
        }

        return payload;
    }

    private normalizeRole(raw: unknown): RolePermissions {
        const base = createEmptyRolePermissions();
        if (!raw || typeof raw !== 'object') return base;

        const source = raw as Record<string, unknown>;
        const looksLikeV2 = MODULE_KEYS.some((module) => source[module] && typeof source[module] === 'object');

        if (looksLikeV2) {
            for (const module of MODULE_KEYS) {
                const actions = source[module];
                if (!actions || typeof actions !== 'object') continue;
                const next = createEmptyModuleActions();
                for (const action of ACTION_KEYS) {
                    const value = (actions as Record<string, unknown>)[action];
                    if (typeof value === 'boolean') next[action] = value;
                }
                base[module] = next;
            }
            return base;
        }

        // Migração v1 → v2 (flags flat)
        for (const [legacyKey, mapping] of Object.entries(PERMISSION_KEY_MAP)) {
            if (source[legacyKey] === true) {
                base[mapping.module][mapping.action] = true;
                if (mapping.action !== 'view') {
                    base[mapping.module].view = true;
                }
            }
        }

        // Na matriz antiga, "alunos" liberava o módulo inteiro (inclui cadastro).
        if (source.alunos === true) {
            base.alunos.view = true;
            base.alunos.create = true;
            base.alunos.edit = true;
        }

        return base;
    }

    /**
     * Aplica upgrades de conteúdo entre versões da matriz persistida.
     * v3: libera alunos.create onde o padrão já prevê create.
     * v4: libera alunosNaTurma.create (inserir aluno na turma) onde o padrão prevê create.
     * v5: libera autorizacaoPendencia/assinarTestemunha onde o padrão prevê (Expansão de Negócios, colaborador+).
     * v6: quem pode criar vendas ganha documentos view/create/edit (finalizar a venda
     *     busca o template em GET /documentos e emite o contrato em POST zapsign/criar-contrato).
     * v7: libera vendasDashboard.view para líderes (prioridade ≥ 80) em todos os setores.
     */
    private upgradeMatrixContent(matrix: PermissionsMatrix, fromVersion: number): PermissionsMatrix {
        const next = JSON.parse(JSON.stringify(matrix)) as PermissionsMatrix;
        if (fromVersion >= PERMISSIONS_MATRIX_VERSION) return next;

        const defaults = this.getDefaultMatrix();

        for (const [setor, funcoes] of Object.entries(next)) {
            if (!funcoes || typeof funcoes !== 'object') continue;

            for (const [funcao, role] of Object.entries(funcoes)) {
                if (!role || typeof role !== 'object') continue;

                const defaultRole =
                    defaults[setor]?.[funcao] || defaults[setor]?.[PADRAO_SETOR_KEY] || null;
                if (!defaultRole) continue;

                if (fromVersion < 3 && defaultRole.alunos?.create) {
                    role.alunos = {
                        view: true,
                        create: true,
                        edit: Boolean(role.alunos?.edit || defaultRole.alunos.edit),
                        delete: Boolean(role.alunos?.delete || defaultRole.alunos.delete),
                    };
                }

                if (fromVersion < 4 && defaultRole.alunosNaTurma?.create) {
                    role.alunosNaTurma = {
                        view: true,
                        create: true,
                        edit: Boolean(role.alunosNaTurma?.edit || defaultRole.alunosNaTurma.edit),
                        delete: Boolean(
                            role.alunosNaTurma?.delete || defaultRole.alunosNaTurma.delete,
                        ),
                    };
                }

                if (fromVersion < 5) {
                    if (defaultRole.autorizacaoPendencia?.edit) {
                        role.autorizacaoPendencia = {
                            view: true,
                            create: Boolean(
                                role.autorizacaoPendencia?.create ||
                                    defaultRole.autorizacaoPendencia.create,
                            ),
                            edit: true,
                            delete: Boolean(
                                role.autorizacaoPendencia?.delete ||
                                    defaultRole.autorizacaoPendencia.delete,
                            ),
                        };
                    }
                    if (defaultRole.assinarTestemunha?.edit) {
                        role.assinarTestemunha = {
                            view: true,
                            create: Boolean(
                                role.assinarTestemunha?.create ||
                                    defaultRole.assinarTestemunha.create,
                            ),
                            edit: true,
                            delete: Boolean(
                                role.assinarTestemunha?.delete ||
                                    defaultRole.assinarTestemunha.delete,
                            ),
                        };
                    }
                }

                if (fromVersion < 6) {
                    this.aplicarInvarianteVendasDocumentos(role);
                }

                if (fromVersion < 7 && defaultRole.vendasDashboard?.view) {
                    role.vendasDashboard = {
                        view: true,
                        create: Boolean(
                            role.vendasDashboard?.create || defaultRole.vendasDashboard.create,
                        ),
                        edit: Boolean(
                            role.vendasDashboard?.edit || defaultRole.vendasDashboard.edit,
                        ),
                        delete: Boolean(
                            role.vendasDashboard?.delete || defaultRole.vendasDashboard.delete,
                        ),
                    };
                }
            }
        }

        return next;
    }

    /**
     * Invariante de consistência: vendas.create ⇒ documentos view/create/edit.
     * Sem documentos, o vendedor consegue preencher toda a venda mas o finalizar
     * falha com 403 (GET /documentos exige view; criar-contrato exige create).
     */
    private aplicarInvarianteVendasDocumentos(role: RolePermissions): void {
        if (!role.vendas?.create) return;
        role.documentos = {
            view: true,
            create: true,
            edit: true,
            delete: Boolean(role.documentos?.delete),
        };
    }

    private normalizeMatrix(raw: unknown): PermissionsMatrix | null {
        if (!raw || typeof raw !== 'object') return null;

        const source = raw as PermissionsMatrix;
        const normalized: PermissionsMatrix = {};

        for (const [setor, funcoes] of Object.entries(source)) {
            if (!setor || !funcoes || typeof funcoes !== 'object') continue;
            normalized[setor] = {};

            for (const [funcao, role] of Object.entries(funcoes)) {
                if (!funcao) continue;
                const normalizedRole = this.normalizeRole(role);
                this.aplicarInvarianteVendasDocumentos(normalizedRole);
                normalized[setor][funcao] = normalizedRole;
            }

            if (!normalized[setor][PADRAO_SETOR_KEY]) {
                normalized[setor][PADRAO_SETOR_KEY] = createEmptyRolePermissions({
                    turmas: { view: true },
                    treinamentos: { view: true },
                    polos: { view: true },
                    vendas: { view: true },
                    credenciamento: { view: true },
                });
            }
        }

        return Object.keys(normalized).length > 0 ? normalized : null;
    }
}
