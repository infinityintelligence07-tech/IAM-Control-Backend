import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Eventos de mentoria (encontros esporádicos do Liberty / Liberty Begin):
 * adiciona em `turmas` a coluna opcional `id_turma_mentoria_vinculada`,
 * apontando para a turma da MENTORIA cujos mentorados são matriculados
 * automaticamente no evento (na criação e a cada novo mentorado, até a data
 * do evento). NULL mantém o comportamento padrão (sem inserção automática).
 *
 * A coluna e a FK também são gerenciadas pelas entities (synchronize); esta
 * migration garante a existência em ambientes sem synchronize.
 */
export class AddTurmaMentoriaVinculada1777300000000 implements MigrationInterface {
    name = 'AddTurmaMentoriaVinculada1777300000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" ADD COLUMN IF NOT EXISTS "id_turma_mentoria_vinculada" integer`);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_turmas_mentoria_vinculada"
            ON "turmas" ("id_turma_mentoria_vinculada")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_turmas_mentoria_vinculada"`);
        await queryRunner.query(`ALTER TABLE "turmas" DROP COLUMN IF EXISTS "id_turma_mentoria_vinculada"`);
    }
}
