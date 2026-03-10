import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTurmasUrlsMidiaKitWhatsapp1768163181020 implements MigrationInterface {
    name = 'AddTurmasUrlsMidiaKitWhatsapp1768163181020';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "turmas" ADD COLUMN IF NOT EXISTS "url_midia_kit" character varying`,
        );
        await queryRunner.query(
            `ALTER TABLE "turmas" ADD COLUMN IF NOT EXISTS "url_grupo_whatsapp" character varying`,
        );
        await queryRunner.query(
            `ALTER TABLE "turmas" ADD COLUMN IF NOT EXISTS "url_grupo_whatsapp_2" character varying`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "turmas" DROP COLUMN IF EXISTS "url_grupo_whatsapp_2"`,
        );
        await queryRunner.query(
            `ALTER TABLE "turmas" DROP COLUMN IF EXISTS "url_grupo_whatsapp"`,
        );
        await queryRunner.query(
            `ALTER TABLE "turmas" DROP COLUMN IF EXISTS "url_midia_kit"`,
        );
    }
}
