import { MigrationInterface, QueryRunner } from 'typeorm';

export class QueryMigration1757805261828 implements MigrationInterface {
    name = 'QueryMigration1757805261828';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "polos" ADD "sigla_polo" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "polos" ALTER COLUMN "polo" SET NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "polos" ALTER COLUMN "polo" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "polos" DROP COLUMN "sigla_polo"`);
    }
}
