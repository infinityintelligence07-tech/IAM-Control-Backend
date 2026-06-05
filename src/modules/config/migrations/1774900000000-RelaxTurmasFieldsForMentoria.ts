import { MigrationInterface, QueryRunner } from 'typeorm';

export class RelaxTurmasFieldsForMentoria1774900000000 implements MigrationInterface {
    name = 'RelaxTurmasFieldsForMentoria1774900000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Mentorias não têm data de evento nem capacidade de sala definidas:
        // o período é por mentorado (a partir da assinatura) e não há limite de sala.
        await queryRunner.query(`
            ALTER TABLE "turmas" ALTER COLUMN "data_inicio" DROP NOT NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas" ALTER COLUMN "data_final" DROP NOT NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas" ALTER COLUMN "capacidade_turma" DROP NOT NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Reverte para NOT NULL preenchendo eventuais nulos com valores padrão.
        await queryRunner.query(`
            UPDATE "turmas" SET "data_inicio" = CURRENT_DATE WHERE "data_inicio" IS NULL
        `);
        await queryRunner.query(`
            UPDATE "turmas" SET "data_final" = "data_inicio" WHERE "data_final" IS NULL
        `);
        await queryRunner.query(`
            UPDATE "turmas" SET "capacidade_turma" = 0 WHERE "capacidade_turma" IS NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas" ALTER COLUMN "data_inicio" SET NOT NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas" ALTER COLUMN "data_final" SET NOT NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas" ALTER COLUMN "capacidade_turma" SET NOT NULL
        `);
    }
}
