import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Materializa o staff líder (IPR) por venda para filtrar/paginar e agregar
 * ranking sem montar times em memória a cada request.
 */
export class AddHistStaffLiderId1776100000000 implements MigrationInterface {
    name = 'AddHistStaffLiderId1776100000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            ADD COLUMN IF NOT EXISTS "hist_staff_lider_id" integer
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_tatc_hist_ativo_staff_lider_criado"
            ON "turmas_alunos_treinamentos_contratos" ("hist_staff_lider_id", "criado_em" DESC)
            WHERE "deletado_em" IS NULL
        `);

        // Backfill: mapa membro/líder global a partir de times_equipes de turmas IPR.
        await queryRunner.query(`
            WITH ipr_times AS (
                SELECT
                    t.id AS id_turma,
                    time_elem AS time_obj,
                    NULLIF(TRIM(time_elem->>'liderId'), '') AS lider_id
                FROM "turmas" t
                INNER JOIN "treinamentos" tr ON tr.id = t.id_treinamento
                CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.times_equipes, '[]'::jsonb)) AS time_elem
                WHERE t.deletado_em IS NULL
                  AND (
                      LOWER(REGEXP_REPLACE(COALESCE(tr.sigla_treinamento, ''), '[^a-zA-Z]', '', 'g')) = 'ipr'
                      OR LOWER(COALESCE(tr.treinamento, '')) LIKE '%imersao prosperar%'
                      OR LOWER(COALESCE(tr.treinamento, '')) LIKE '%imersão prosperar%'
                  )
            ),
            membro_lider AS (
                SELECT DISTINCT
                    NULLIF(membro, '')::int AS membro_id,
                    NULLIF(lider_id, '')::int AS lider_id
                FROM ipr_times
                CROSS JOIN LATERAL jsonb_array_elements_text(
                    COALESCE(time_obj->'membrosIds', '[]'::jsonb) ||
                    CASE
                        WHEN lider_id IS NOT NULL AND lider_id <> ''
                            THEN jsonb_build_array(lider_id)
                        ELSE '[]'::jsonb
                    END
                ) AS membro
                WHERE lider_id IS NOT NULL
                  AND lider_id ~ '^[0-9]+$'
                  AND membro ~ '^[0-9]+$'
            )
            UPDATE "turmas_alunos_treinamentos_contratos" AS c
            SET "hist_staff_lider_id" = ml.lider_id
            FROM membro_lider ml
            WHERE c.deletado_em IS NULL
              AND c.hist_vendedor_id IS NOT NULL
              AND c.hist_vendedor_id = ml.membro_id
              AND c.hist_staff_lider_id IS NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_tatc_hist_ativo_staff_lider_criado"`);
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            DROP COLUMN IF EXISTS "hist_staff_lider_id"
        `);
    }
}
