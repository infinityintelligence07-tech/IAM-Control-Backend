import { MigrationInterface, QueryRunner } from 'typeorm';

export class QueryMigration1762790928934 implements MigrationInterface {
    name = 'QueryMigration1762790928934';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "alunos" DROP COLUMN "profissao"`);
        await queryRunner.query(
            `CREATE TYPE "public"."EProfissao" AS ENUM('CLT', 'DESEMPREGADO', 'EMPRESARIO', 'FUNCIONARIO_PUBLICO', 'LIDER', 'PROFISSIONAL_LIBERAL')`,
        );
        await queryRunner.query(`ALTER TABLE "alunos" ADD "profissao" "public"."EProfissao" DEFAULT 'CLT'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "alunos" DROP COLUMN "profissao"`);
        await queryRunner.query(`DROP TYPE "public"."EProfissao"`);
        await queryRunner.query(`ALTER TABLE "alunos" ADD "profissao" character varying`);
    }
}
