import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adiciona colunas para amarrar uma venda à TURMA destino correta:
 *  - turmas_alunos_treinamentos.id_turma_destino       → qual turma do treinamento o aluno comprou
 *  - turmas_alunos_treinamentos_bonus.id_turma_aluno_treinamento → contrato ao qual o bônus pertence
 *  - turmas_alunos_treinamentos_bonus.id_turma_bonus   → qual turma o aluno recebe como bônus
 *  - turmas_alunos_treinamentos_bonus.tipo_bonus       → identificador do tipo de bônus (ex: '100_dias', 'ipr', 'outros')
 *
 * Ver: ../migrations/2026-05-vendas-turma-destino/DIAGNOSTICO.md
 *
 * Após esta migration, mover este arquivo para
 *   src/modules/config/migrations/1773700000000-AddIdTurmaDestinoVendas.ts
 * e rodar `npm run migration:run`.
 */
export class AddIdTurmaDestinoVendas1773700000000 implements MigrationInterface {
    name = 'AddIdTurmaDestinoVendas1773700000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1) Turma destino do treinamento contratado
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos"
            ADD COLUMN IF NOT EXISTS "id_turma_destino" bigint NULL
        `);

        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos"
            ADD CONSTRAINT "fk_tat_turma_destino"
            FOREIGN KEY ("id_turma_destino")
            REFERENCES "turmas"("id")
            ON DELETE SET NULL
            ON UPDATE CASCADE
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_tat_turma_destino"
            ON "turmas_alunos_treinamentos" ("id_turma_destino")
        `);

        // 2) Bônus — amarrar ao contrato + turma do bônus + tipo
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_bonus"
            ADD COLUMN IF NOT EXISTS "id_turma_aluno_treinamento" bigint NULL
        `);

        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_bonus"
            ADD COLUMN IF NOT EXISTS "id_turma_bonus" bigint NULL
        `);

        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_bonus"
            ADD COLUMN IF NOT EXISTS "tipo_bonus" varchar(64) NULL
        `);

        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_bonus"
            ADD CONSTRAINT "fk_tatb_turma_aluno_treinamento"
            FOREIGN KEY ("id_turma_aluno_treinamento")
            REFERENCES "turmas_alunos_treinamentos"("id")
            ON DELETE CASCADE
            ON UPDATE CASCADE
        `);

        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_bonus"
            ADD CONSTRAINT "fk_tatb_turma_bonus"
            FOREIGN KEY ("id_turma_bonus")
            REFERENCES "turmas"("id")
            ON DELETE SET NULL
            ON UPDATE CASCADE
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_tatb_id_tat"
            ON "turmas_alunos_treinamentos_bonus" ("id_turma_aluno_treinamento")
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_tatb_turma_bonus"
            ON "turmas_alunos_treinamentos_bonus" ("id_turma_bonus")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_tatb_turma_bonus"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_tatb_id_tat"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_bonus" DROP CONSTRAINT IF EXISTS "fk_tatb_turma_bonus"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_bonus" DROP CONSTRAINT IF EXISTS "fk_tatb_turma_aluno_treinamento"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_bonus" DROP COLUMN IF EXISTS "tipo_bonus"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_bonus" DROP COLUMN IF EXISTS "id_turma_bonus"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_bonus" DROP COLUMN IF EXISTS "id_turma_aluno_treinamento"`);

        await queryRunner.query(`DROP INDEX IF EXISTS "idx_tat_turma_destino"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos" DROP CONSTRAINT IF EXISTS "fk_tat_turma_destino"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos" DROP COLUMN IF EXISTS "id_turma_destino"`);
    }
}
