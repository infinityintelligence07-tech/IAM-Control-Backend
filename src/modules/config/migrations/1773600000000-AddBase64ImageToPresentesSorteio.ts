import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBase64ImageToPresentesSorteio1773600000000 implements MigrationInterface {
    name = 'AddBase64ImageToPresentesSorteio1773600000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "presentes_sorteio" ADD "imagem_base64" text`);
        await queryRunner.query(`ALTER TABLE "presentes_sorteio" ADD "imagem_mime_type" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "presentes_sorteio" DROP COLUMN "imagem_mime_type"`);
        await queryRunner.query(`ALTER TABLE "presentes_sorteio" DROP COLUMN "imagem_base64"`);
    }
}
