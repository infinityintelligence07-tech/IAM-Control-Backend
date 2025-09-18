import { MigrationInterface, QueryRunner } from 'typeorm';

export class QueryMigration1758049192610 implements MigrationInterface {
    name = 'QueryMigration1758049192610';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" ADD "turma_aberta" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" DROP COLUMN "turma_aberta"`);
    }
}
