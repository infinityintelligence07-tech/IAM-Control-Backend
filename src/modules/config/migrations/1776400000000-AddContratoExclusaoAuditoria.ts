import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Auditoria obrigatória ao excluir contrato no Histórico de Vendas:
 * categoria (erro de preenchimento / cancelamento de aluno / outro),
 * observação (até 150 caracteres), quem excluiu e quando.
 * Idempotente: synchronize: true também pode criar no boot.
 */
export class AddContratoExclusaoAuditoria1776400000000 implements MigrationInterface {
    name = 'AddContratoExclusaoAuditoria1776400000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DO $$ BEGIN
                CREATE TYPE "ECategoriaExclusaoContrato" AS ENUM (
                    'ERRO_PREENCHIMENTO',
                    'CANCELAMENTO_ALUNO',
                    'OUTRO_MOTIVO'
                );
            EXCEPTION
                WHEN duplicate_object THEN null;
            END $$;
        `);

        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            ADD COLUMN IF NOT EXISTS "categoria_exclusao" "ECategoriaExclusaoContrato"
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            ADD COLUMN IF NOT EXISTS "observacao_exclusao" character varying(150)
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            ADD COLUMN IF NOT EXISTS "excluido_por" integer
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            ADD COLUMN IF NOT EXISTS "excluido_em" TIMESTAMP
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_contratos_excluido_em"
            ON "turmas_alunos_treinamentos_contratos" ("excluido_em")
            WHERE "deletado_em" IS NOT NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_contratos_excluido_em"`);
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            DROP COLUMN IF EXISTS "excluido_em"
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            DROP COLUMN IF EXISTS "excluido_por"
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            DROP COLUMN IF EXISTS "observacao_exclusao"
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            DROP COLUMN IF EXISTS "categoria_exclusao"
        `);
        await queryRunner.query(`DROP TYPE IF EXISTS "ECategoriaExclusaoContrato"`);
    }
}
