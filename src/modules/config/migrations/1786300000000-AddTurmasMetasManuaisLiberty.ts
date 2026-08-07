import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTurmasMetasManuaisLiberty1786300000000 implements MigrationInterface {
    name = 'AddTurmasMetasManuaisLiberty1786300000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "turmas"
            ADD COLUMN IF NOT EXISTS "meta_credenciados_manual" integer
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas"
            ADD COLUMN IF NOT EXISTS "meta_confirmados_manual" integer
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "turmas"
            DROP COLUMN IF EXISTS "meta_confirmados_manual"
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas"
            DROP COLUMN IF EXISTS "meta_credenciados_manual"
        `);
    }
}
