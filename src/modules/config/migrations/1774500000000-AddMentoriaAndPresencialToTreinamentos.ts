import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMentoriaAndPresencialToTreinamentos1774500000000 implements MigrationInterface {
    name = 'AddMentoriaAndPresencialToTreinamentos1774500000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "treinamentos"
            ADD COLUMN IF NOT EXISTS "tipo_mentoria" boolean NOT NULL DEFAULT false
        `);

        await queryRunner.query(`
            ALTER TABLE "treinamentos"
            ADD COLUMN IF NOT EXISTS "tipo_presencial" boolean NOT NULL DEFAULT true
        `);

        await queryRunner.query(`
            UPDATE "treinamentos"
            SET "tipo_presencial" = CASE
                WHEN "tipo_online" = true THEN false
                ELSE true
            END
            WHERE "tipo_presencial" IS NULL OR "tipo_presencial" = true
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "treinamentos"
            DROP COLUMN IF EXISTS "tipo_presencial"
        `);

        await queryRunner.query(`
            ALTER TABLE "treinamentos"
            DROP COLUMN IF EXISTS "tipo_mentoria"
        `);
    }
}
