import { MigrationInterface, QueryRunner } from 'typeorm';

export class QueryMigration1757805721194 implements MigrationInterface {
    name = 'QueryMigration1757805721194';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "alunos" ADD "cidade" character varying`);
        await queryRunner.query(`ALTER TABLE "alunos" ADD "estado" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "alunos" DROP COLUMN "estado"`);
        await queryRunner.query(`ALTER TABLE "alunos" DROP COLUMN "cidade"`);
    }
}
