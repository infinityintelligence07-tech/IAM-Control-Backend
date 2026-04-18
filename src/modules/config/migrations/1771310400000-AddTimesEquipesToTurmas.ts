import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTimesEquipesToTurmas1771310400000 implements MigrationInterface {
    name = 'AddTimesEquipesToTurmas1771310400000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" ADD COLUMN IF NOT EXISTS "times_equipes" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" DROP COLUMN IF EXISTS "times_equipes"`);
    }
}
