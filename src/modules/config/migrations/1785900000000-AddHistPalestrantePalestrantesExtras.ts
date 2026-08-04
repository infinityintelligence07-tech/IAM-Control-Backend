import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Canal de venda PALESTRANTES_EXTRAS: materializa palestrante (id/nome) no
 * histórico para filtros sem parse de `dados_contrato`.
 */
export class AddHistPalestrantePalestrantesExtras1785900000000 implements MigrationInterface {
    name = 'AddHistPalestrantePalestrantesExtras1785900000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            ADD COLUMN IF NOT EXISTS "hist_palestrante_id" integer,
            ADD COLUMN IF NOT EXISTS "hist_palestrante_nome" varchar(255)
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_tatc_hist_palestrante_id"
            ON "turmas_alunos_treinamentos_contratos" ("hist_palestrante_id")
            WHERE "hist_palestrante_id" IS NOT NULL
        `);

        // Backfill a partir do snapshot (vendas futuras usam o service Nest).
        await queryRunner.query(`
            UPDATE "turmas_alunos_treinamentos_contratos" AS c
            SET
                "hist_palestrante_nome" = NULLIF(TRIM(COALESCE(
                    c.dados_contrato->'campos_variaveis'->>'Palestrante',
                    c.dados_contrato->>'palestrante_nome',
                    ''
                )), ''),
                "hist_palestrante_id" = NULLIF(
                    NULLIF(TRIM(COALESCE(
                        c.dados_contrato->'campos_variaveis'->>'Palestrante ID',
                        c.dados_contrato->>'palestrante_id',
                        ''
                    )), ''),
                    ''
                )::integer,
                "hist_canal_venda" = CASE
                    WHEN LOWER(CONCAT_WS(' ',
                        c.dados_contrato->'campos_variaveis'->>'Canal de Vendas',
                        c.dados_contrato->'campos_variaveis'->>'Canal da Venda',
                        c.dados_contrato->'campos_variaveis'->>'Origem da Venda',
                        c.dados_contrato->'campos_variaveis'->>'Origem',
                        c.dados_contrato->>'fluxo_evento_origem_treinamento',
                        c.dados_contrato->>'fluxo_evento_origem_turma'
                    )) LIKE '%palestrantes extras%'
                      OR LOWER(CONCAT_WS(' ',
                        c.dados_contrato->'campos_variaveis'->>'Canal de Vendas',
                        c.dados_contrato->'campos_variaveis'->>'Canal da Venda',
                        c.dados_contrato->'campos_variaveis'->>'Origem da Venda'
                    )) LIKE '%palestra extra%'
                      OR UPPER(TRIM(COALESCE(
                        c.dados_contrato->'campos_variaveis'->>'Canal de Vendas',
                        c.dados_contrato->>'hist_canal_venda',
                        ''
                    ))) = 'PALESTRANTES_EXTRAS'
                    THEN 'PALESTRANTES_EXTRAS'
                    ELSE c."hist_canal_venda"
                END
            WHERE c.deletado_em IS NULL
              AND (
                NULLIF(TRIM(COALESCE(
                    c.dados_contrato->'campos_variaveis'->>'Palestrante',
                    c.dados_contrato->>'palestrante_nome',
                    ''
                )), '') IS NOT NULL
                OR LOWER(CONCAT_WS(' ',
                    c.dados_contrato->'campos_variaveis'->>'Canal de Vendas',
                    c.dados_contrato->'campos_variaveis'->>'Canal da Venda',
                    c.dados_contrato->'campos_variaveis'->>'Origem da Venda'
                )) LIKE '%palestrantes extras%'
                OR LOWER(CONCAT_WS(' ',
                    c.dados_contrato->'campos_variaveis'->>'Canal de Vendas',
                    c.dados_contrato->'campos_variaveis'->>'Canal da Venda',
                    c.dados_contrato->'campos_variaveis'->>'Origem da Venda'
                )) LIKE '%palestra extra%'
              )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX IF EXISTS "IDX_tatc_hist_palestrante_id"
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            DROP COLUMN IF EXISTS "hist_palestrante_nome",
            DROP COLUMN IF EXISTS "hist_palestrante_id"
        `);
    }
}
