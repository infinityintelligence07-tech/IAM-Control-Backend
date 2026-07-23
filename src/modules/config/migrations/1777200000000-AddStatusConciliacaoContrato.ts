import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStatusConciliacaoContrato1777200000000 implements MigrationInterface {
    name = 'AddStatusConciliacaoContrato1777200000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            ADD COLUMN "status_conciliacao" character varying(20) NOT NULL DEFAULT 'NOVO'
        `);

        await queryRunner.query(`
            CREATE INDEX "idx_contratos_status_conciliacao"
            ON "turmas_alunos_treinamentos_contratos" ("status_conciliacao")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "idx_contratos_status_conciliacao"`);
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            DROP COLUMN "status_conciliacao"
        `);
    }
}
