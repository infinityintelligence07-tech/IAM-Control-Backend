import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTurmasIprImersaoRelacionamentos1773000000000 implements MigrationInterface {
    name = 'AddTurmasIprImersaoRelacionamentos1773000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" ADD "turmas_imersao_ofertadas" jsonb`);
        await queryRunner.query(`ALTER TABLE "turmas" ADD "turmas_ipr_relacionadas" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" DROP COLUMN "turmas_ipr_relacionadas"`);
        await queryRunner.query(`ALTER TABLE "turmas" DROP COLUMN "turmas_imersao_ofertadas"`);
    }
}
