import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Materializa métricas/labels do Histórico de Vendas para evitar full-scan +
 * parse de `dados_contrato` (JSON com cláusulas/base64) em listagem, resumo e
 * opções de filtro.
 */
export class AddHistoricoVendasMaterializedColumns1776000000000 implements MigrationInterface {
    name = 'AddHistoricoVendasMaterializedColumns1776000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            ADD COLUMN IF NOT EXISTS "hist_qtd_inscricoes" integer NOT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS "hist_qtd_bonus" integer NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS "hist_pendencia_pagamento" boolean NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS "hist_receita_total" numeric(14,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS "hist_canal_venda" varchar(32),
            ADD COLUMN IF NOT EXISTS "hist_treinamento_origem" varchar(255),
            ADD COLUMN IF NOT EXISTS "hist_turma_origem" varchar(255),
            ADD COLUMN IF NOT EXISTS "hist_turma_destino" varchar(255),
            ADD COLUMN IF NOT EXISTS "hist_vendedor_id" integer
        `);

        // Backfill aproximado (regras completas de bônus/canal ficam no service;
        // creates/updates recalculam com a lógica Nest).
        await queryRunner.query(`
            UPDATE "turmas_alunos_treinamentos_contratos" AS c
            SET
                "hist_qtd_inscricoes" = GREATEST(
                    1,
                    COALESCE(
                        NULLIF((c.dados_contrato->'turma_aluno'->>'quantidade_inscricoes')::int, 0),
                        NULLIF((c.dados_contrato->'campos_variaveis'->>'Quantidade de Inscrições')::int, 0),
                        NULLIF((c.dados_contrato->'campos_variaveis'->>'Quantidade de Inscricoes')::int, 0),
                        1
                    )
                ),
                "hist_qtd_bonus" = GREATEST(
                    0,
                    COALESCE(
                        NULLIF((c.dados_contrato->'campos_variaveis'->>'Quantidade de Inscrições do Imersão Prosperar')::int, 0),
                        NULLIF((c.dados_contrato->'campos_variaveis'->>'Quantidade de Inscricoes do Imersao Prosperar')::int, 0),
                        0
                    )
                ),
                "hist_pendencia_pagamento" = COALESCE(
                    CASE
                        WHEN c.dados_contrato->'turma_aluno'->>'pendencia_pagamento' IN ('true', 'false')
                            THEN (c.dados_contrato->'turma_aluno'->>'pendencia_pagamento')::boolean
                        ELSE NULL
                    END,
                    false
                ),
                "hist_receita_total" = COALESCE((
                    SELECT SUM(COALESCE(NULLIF(elem->>'valor', '')::numeric, 0))
                    FROM jsonb_array_elements(
                        CASE
                            WHEN jsonb_typeof(c.dados_contrato->'pagamento'->'formas_pagamento') = 'array'
                                THEN c.dados_contrato->'pagamento'->'formas_pagamento'
                            WHEN jsonb_typeof(c.dados_contrato->'formas_pagamento') = 'array'
                                THEN c.dados_contrato->'formas_pagamento'
                            ELSE '[]'::jsonb
                        END
                    ) AS elem
                ), 0),
                "hist_canal_venda" = CASE
                    WHEN LOWER(CONCAT_WS(' ',
                        c.dados_contrato->>'fluxo_evento_origem_treinamento',
                        c.dados_contrato->>'fluxo_evento_origem_turma',
                        c.dados_contrato->'campos_variaveis'->>'Canal de Vendas',
                        c.dados_contrato->'campos_variaveis'->>'Canal da Venda',
                        c.dados_contrato->'campos_variaveis'->>'Origem da Venda',
                        c.dados_contrato->'campos_variaveis'->>'Origem',
                        c.dados_contrato->'campos_variaveis'->>'Observações'
                    )) LIKE '%masterclass%' THEN 'MASTERCLASS'
                    WHEN LOWER(CONCAT_WS(' ',
                        c.dados_contrato->>'fluxo_evento_origem_treinamento',
                        c.dados_contrato->>'fluxo_evento_origem_turma',
                        c.dados_contrato->'campos_variaveis'->>'Canal de Vendas',
                        c.dados_contrato->'campos_variaveis'->>'Canal da Venda',
                        c.dados_contrato->'campos_variaveis'->>'Origem da Venda',
                        c.dados_contrato->'campos_variaveis'->>'Origem',
                        c.dados_contrato->'campos_variaveis'->>'Observações'
                    )) LIKE '%time de vendas%'
                      OR LOWER(CONCAT_WS(' ',
                        c.dados_contrato->>'fluxo_evento_origem_treinamento',
                        c.dados_contrato->>'fluxo_evento_origem_turma',
                        c.dados_contrato->'campos_variaveis'->>'Canal de Vendas',
                        c.dados_contrato->'campos_variaveis'->>'Canal da Venda'
                    )) LIKE '%vendas iam%' THEN 'TIME_VENDAS'
                    ELSE 'EVENTOS'
                END,
                "hist_treinamento_origem" = NULLIF(LEFT(TRIM(COALESCE(
                    NULLIF(c.dados_contrato->>'fluxo_evento_origem_treinamento', ''),
                    NULLIF(c.dados_contrato->'campos_variaveis'->>'Treinamento de Origem', ''),
                    NULLIF(c.dados_contrato->'campos_variaveis'->>'Treinamento Origem', ''),
                    NULLIF(c.dados_contrato->'campos_variaveis'->>'Treinamento de Entrada', ''),
                    ''
                )), 255), ''),
                "hist_turma_origem" = NULLIF(LEFT(TRIM(COALESCE(
                    NULLIF(c.dados_contrato->>'fluxo_evento_origem_turma', ''),
                    NULLIF(c.dados_contrato->'campos_variaveis'->>'Turma de Origem', ''),
                    NULLIF(c.dados_contrato->'campos_variaveis'->>'Turma Origem', ''),
                    ''
                )), 255), ''),
                "hist_turma_destino" = NULLIF(LEFT(TRIM(COALESCE(
                    NULLIF(c.dados_contrato->>'fluxo_evento_destino_turma', ''),
                    NULLIF(c.dados_contrato->'campos_variaveis'->>'Turma de Destino', ''),
                    NULLIF(c.dados_contrato->'campos_variaveis'->>'Turma Destino', ''),
                    ''
                )), 255), ''),
                "hist_vendedor_id" = COALESCE(
                    NULLIF((c.dados_contrato->'criado_por_confronto'->>'consolidado')::int, 0),
                    NULLIF((c.dados_contrato->>'criado_por')::int, 0),
                    c.criado_por
                )
            WHERE c.deletado_em IS NULL
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_tatc_hist_ativo_criado_canal"
            ON "turmas_alunos_treinamentos_contratos" ("criado_em" DESC, "hist_canal_venda")
            WHERE "deletado_em" IS NULL
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_tatc_hist_ativo_pendencia_criado"
            ON "turmas_alunos_treinamentos_contratos" ("hist_pendencia_pagamento", "criado_em" DESC)
            WHERE "deletado_em" IS NULL
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_tatc_hist_ativo_turma_origem"
            ON "turmas_alunos_treinamentos_contratos" (LOWER(TRIM("hist_turma_origem")))
            WHERE "deletado_em" IS NULL AND "hist_turma_origem" IS NOT NULL
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_tatc_hist_ativo_turma_destino"
            ON "turmas_alunos_treinamentos_contratos" (LOWER(TRIM("hist_turma_destino")))
            WHERE "deletado_em" IS NULL AND "hist_turma_destino" IS NOT NULL
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_tatc_hist_ativo_vendedor_criado"
            ON "turmas_alunos_treinamentos_contratos" ("hist_vendedor_id", "criado_em" DESC)
            WHERE "deletado_em" IS NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_tatc_hist_ativo_vendedor_criado"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_tatc_hist_ativo_turma_destino"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_tatc_hist_ativo_turma_origem"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_tatc_hist_ativo_pendencia_criado"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_tatc_hist_ativo_criado_canal"`);
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos_contratos"
            DROP COLUMN IF EXISTS "hist_vendedor_id",
            DROP COLUMN IF EXISTS "hist_turma_destino",
            DROP COLUMN IF EXISTS "hist_turma_origem",
            DROP COLUMN IF EXISTS "hist_treinamento_origem",
            DROP COLUMN IF EXISTS "hist_canal_venda",
            DROP COLUMN IF EXISTS "hist_receita_total",
            DROP COLUMN IF EXISTS "hist_pendencia_pagamento",
            DROP COLUMN IF EXISTS "hist_qtd_bonus",
            DROP COLUMN IF EXISTS "hist_qtd_inscricoes"
        `);
    }
}
