import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHistoricoVendasIndexes1774000000000 implements MigrationInterface {
    name = 'AddHistoricoVendasIndexes1774000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Base do histórico: filtra contratos ativos por criado_em e join via id_turma_aluno_treinamento.
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_tatc_ativo_criado_em_desc"
            ON "turmas_alunos_treinamentos_contratos" ("criado_em" DESC)
            WHERE "deletado_em" IS NULL
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_tatc_ativo_id_turma_aluno_treinamento"
            ON "turmas_alunos_treinamentos_contratos" ("id_turma_aluno_treinamento")
            WHERE "deletado_em" IS NULL
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_tatc_ativo_criado_tat"
            ON "turmas_alunos_treinamentos_contratos" ("criado_em" DESC, "id_turma_aluno_treinamento")
            WHERE "deletado_em" IS NULL
        `);

        // Joins/fallbacks do histórico: id_aluno, id_turma e id_turma_aluno.
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_ta_ativo_id_aluno_id_turma"
            ON "turmas_alunos" ("id_aluno", "id_turma")
            WHERE "deletado_em" IS NULL
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_tat_ativo_id_turma_aluno_id_treinamento"
            ON "turmas_alunos_treinamentos" ("id_turma_aluno", "id_treinamento")
            WHERE "deletado_em" IS NULL
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_tat_ativo_id_treinamento"
            ON "turmas_alunos_treinamentos" ("id_treinamento")
            WHERE "deletado_em" IS NULL
        `);

        // Consulta de origem por histórico de transferência.
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_hta_ativo_id_turma_aluno_para_criado_em"
            ON "historico_transferencias_alunos" ("id_turma_aluno_para", "criado_em" DESC)
            WHERE "deletado_em" IS NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_hta_ativo_id_turma_aluno_para_criado_em"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_tat_ativo_id_treinamento"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_tat_ativo_id_turma_aluno_id_treinamento"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_ta_ativo_id_aluno_id_turma"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_tatc_ativo_criado_tat"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_tatc_ativo_id_turma_aluno_treinamento"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_tatc_ativo_criado_em_desc"`);
    }
}
