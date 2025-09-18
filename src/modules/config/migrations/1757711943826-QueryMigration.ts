import { MigrationInterface, QueryRunner } from 'typeorm';

export class QueryMigration1757711943826 implements MigrationInterface {
    name = 'QueryMigration1757711943826';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "usuarios" ADD "primeiro_nome" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "usuarios" ADD "sobrenome" character varying NOT NULL`);
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "telefone" SET NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "telefone" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "usuarios" DROP COLUMN "sobrenome"`);
        await queryRunner.query(`ALTER TABLE "usuarios" DROP COLUMN "primeiro_nome"`);
    }
}
