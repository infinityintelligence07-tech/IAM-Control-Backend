import { MigrationInterface, QueryRunner } from "typeorm";

export class QueryMigration1761508210466 implements MigrationInterface {
    name = 'QueryMigration1761508210466'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."ESetores" RENAME TO "ESetores_old"`);
        await queryRunner.query(`CREATE TYPE "public"."ESetores" AS ENUM('ADMINISTRADOR', 'CD', 'COMERCIAL', 'CUIDADO_DE_ALUNOS', 'EVENTOS', 'EXPANSAO', 'EXPANSAO_NEGOCIOS', 'FINANCEIRO', 'GH', 'JURIDICO', 'MARKETING', 'P7', 'TECNOLOGIA')`);
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "setor" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "setor" TYPE "public"."ESetores" USING "setor"::"text"::"public"."ESetores"`);
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "setor" SET DEFAULT 'CUIDADO_DE_ALUNOS'`);
        await queryRunner.query(`DROP TYPE "public"."ESetores_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."ESetores_old" AS ENUM('ADMINISTRADOR', 'CD', 'COMERCIAL', 'CUIDADO_DE_ALUNOS', 'EVENTOS', 'EXPANSAO', 'EXPANSAO_NEGOCIOS', 'FINANCEIRO', 'GH', 'JURIDICO', 'MARKETING', 'TECNOLOGIA')`);
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "setor" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "setor" TYPE "public"."ESetores_old" USING "setor"::"text"::"public"."ESetores_old"`);
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "setor" SET DEFAULT 'CUIDADO_DE_ALUNOS'`);
        await queryRunner.query(`DROP TYPE "public"."ESetores"`);
        await queryRunner.query(`ALTER TYPE "public"."ESetores_old" RENAME TO "ESetores"`);
    }

}
