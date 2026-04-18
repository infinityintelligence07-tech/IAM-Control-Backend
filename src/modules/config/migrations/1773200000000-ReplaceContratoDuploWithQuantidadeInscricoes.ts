import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplaceContratoDuploWithQuantidadeInscricoes1773200000000 implements MigrationInterface {
    name = 'ReplaceContratoDuploWithQuantidadeInscricoes1773200000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos" RENAME COLUMN "contrato_duplo" TO "quantidade_inscricoes"`);
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos"
            ALTER COLUMN "quantidade_inscricoes" TYPE integer
            USING CASE WHEN "quantidade_inscricoes" IS TRUE THEN 2 ELSE 1 END
        `);
        await queryRunner.query(`UPDATE "turmas_alunos" SET "quantidade_inscricoes" = 1 WHERE "quantidade_inscricoes" IS NULL OR "quantidade_inscricoes" < 1`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" ALTER COLUMN "quantidade_inscricoes" SET DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" ALTER COLUMN "quantidade_inscricoes" SET NOT NULL`);

        await queryRunner.query(`
            ALTER TABLE "turmas_alunos"
            ADD "outros_clientes" jsonb NOT NULL DEFAULT '[]'::jsonb
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos" DROP COLUMN "outros_clientes"`);

        await queryRunner.query(`ALTER TABLE "turmas_alunos" ALTER COLUMN "quantidade_inscricoes" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" ALTER COLUMN "quantidade_inscricoes" DROP DEFAULT`);
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos"
            ALTER COLUMN "quantidade_inscricoes" TYPE boolean
            USING CASE WHEN "quantidade_inscricoes" > 1 THEN TRUE ELSE FALSE END
        `);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" RENAME COLUMN "quantidade_inscricoes" TO "contrato_duplo"`);
    }
}
