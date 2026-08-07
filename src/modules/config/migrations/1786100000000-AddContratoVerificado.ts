import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContratoVerificado1786100000000 implements MigrationInterface {
    name = 'AddContratoVerificado1786100000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            ADD COLUMN "verificado" boolean NOT NULL DEFAULT false
        `);

        await queryRunner.query(`
            CREATE INDEX "idx_contratos_verificado"
            ON "turmas_alunos_treinamentos_contratos" ("verificado")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "idx_contratos_verificado"`);
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            DROP COLUMN "verificado"
        `);
    }
}
