import { MigrationInterface, QueryRunner } from 'typeorm';

export class QueryMigration1758057820945 implements MigrationInterface {
    name = 'QueryMigration1758057820945';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" ADD "cidade" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "turmas" ADD "estado" character varying NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" DROP COLUMN "estado"`);
        await queryRunner.query(`ALTER TABLE "turmas" DROP COLUMN "cidade"`);
    }
}
