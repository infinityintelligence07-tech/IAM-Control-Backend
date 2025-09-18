import { MigrationInterface, QueryRunner } from 'typeorm';

export class QueryMigration1758034117244 implements MigrationInterface {
    name = 'QueryMigration1758034117244';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "treinamentos" ADD "sigla_treinamento" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "treinamentos" DROP COLUMN "sigla_treinamento"`);
    }
}
