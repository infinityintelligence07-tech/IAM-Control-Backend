import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Converte usuarios.setor de enum escalar para array de enum (ESetores[]),
 * permitindo múltiplos setores por usuário. Preserva o valor existente via ARRAY[setor].
 */
export class UsuariosSetorArray1776500000000 implements MigrationInterface {
    name = 'UsuariosSetorArray1776500000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "usuarios"
            ALTER COLUMN "setor" DROP DEFAULT
        `);

        await queryRunner.query(`
            ALTER TABLE "usuarios"
            ALTER COLUMN "setor" TYPE "ESetores"[]
            USING CASE
                WHEN "setor" IS NULL THEN ARRAY['CUIDADO_DE_ALUNOS']::"ESetores"[]
                ELSE ARRAY["setor"]::"ESetores"[]
            END
        `);

        await queryRunner.query(`
            ALTER TABLE "usuarios"
            ALTER COLUMN "setor" SET DEFAULT ARRAY['CUIDADO_DE_ALUNOS']::"ESetores"[]
        `);

        await queryRunner.query(`
            ALTER TABLE "usuarios"
            ALTER COLUMN "setor" SET NOT NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "usuarios"
            ALTER COLUMN "setor" DROP DEFAULT
        `);

        await queryRunner.query(`
            ALTER TABLE "usuarios"
            ALTER COLUMN "setor" TYPE "ESetores"
            USING COALESCE(("setor")[1], 'CUIDADO_DE_ALUNOS'::"ESetores")
        `);

        await queryRunner.query(`
            ALTER TABLE "usuarios"
            ALTER COLUMN "setor" SET DEFAULT 'CUIDADO_DE_ALUNOS'::"ESetores"
        `);

        await queryRunner.query(`
            ALTER TABLE "usuarios"
            ALTER COLUMN "setor" SET NOT NULL
        `);
    }
}
