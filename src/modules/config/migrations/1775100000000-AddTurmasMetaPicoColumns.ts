import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTurmasMetaPicoColumns1775100000000 implements MigrationInterface {
    name = 'AddTurmasMetaPicoColumns1775100000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Pico (máximo histórico) de inscritos e de alunos extras.
        // A meta é calculada sobre o pico, de modo que transferências/remoções
        // não reduzam a meta; novos picos de inscritos/extras elevam a meta.
        await queryRunner.query(`
            ALTER TABLE "turmas"
            ADD COLUMN IF NOT EXISTS "meta_pico_inscritos" integer
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas"
            ADD COLUMN IF NOT EXISTS "meta_pico_extras" integer
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" DROP COLUMN IF EXISTS "meta_pico_extras"`);
        await queryRunner.query(`ALTER TABLE "turmas" DROP COLUMN IF EXISTS "meta_pico_inscritos"`);
    }
}
