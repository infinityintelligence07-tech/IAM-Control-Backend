import { MigrationInterface, QueryRunner } from "typeorm";

export class QueryMigration1758394107813 implements MigrationInterface {
    name = 'QueryMigration1758394107813'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "masterclass_pre_cadastros" DROP COLUMN "confirmou_presenca"`);
        await queryRunner.query(`ALTER TABLE "masterclass_pre_cadastros" DROP COLUMN "data_confirmacao_presenca"`);
        await queryRunner.query(`ALTER TABLE "masterclass_pre_cadastros" ADD "presente" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "masterclass_pre_cadastros" ADD "teve_interesse" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "masterclass_pre_cadastros" DROP COLUMN "teve_interesse"`);
        await queryRunner.query(`ALTER TABLE "masterclass_pre_cadastros" DROP COLUMN "presente"`);
        await queryRunner.query(`ALTER TABLE "masterclass_pre_cadastros" ADD "data_confirmacao_presenca" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "masterclass_pre_cadastros" ADD "confirmou_presenca" boolean NOT NULL DEFAULT false`);
    }

}
