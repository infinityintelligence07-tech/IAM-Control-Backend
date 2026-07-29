/**
 * Backfill: inscrições adicionais de vendas MASTERCLASS sem id_turma_transferencia_de.
 * Casa o e-mail do comprador adicional do contrato com a matrícula no destino.
 *
 * Uso: node scripts/backfill-extras-mc-estratificacao.js [--dry-run]
 */
require('dotenv').config();
const { Client } = require('pg');

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionTimeoutMillis: 25000,
  });
  await c.connect();

  const selectSql = `
    WITH extras AS (
      SELECT
        c.id AS id_contrato,
        COALESCE(
          NULLIF(c.dados_contrato->>'fluxo_evento_origem_id_turma','')::int,
          NULLIF(c.dados_contrato->>'id_turma_origem','')::int
        ) AS id_origem,
        COALESCE(
          NULLIF(c.dados_contrato->>'fluxo_evento_destino_id_turma','')::int,
          NULLIF(c.dados_contrato->>'id_turma_destino','')::int
        ) AS id_destino,
        LOWER(TRIM(extra->>'email')) AS email_extra,
        TRIM(extra->>'nome') AS nome_extra
      FROM turmas_alunos_treinamentos_contratos c
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(c.dados_contrato->'turma_aluno'->'outros_clientes') = 'array'
            THEN c.dados_contrato->'turma_aluno'->'outros_clientes'
          WHEN jsonb_typeof(c.dados_contrato->'compradores_adicionais') = 'array'
            THEN c.dados_contrato->'compradores_adicionais'
          ELSE '[]'::jsonb
        END
      ) AS extra
      WHERE c.deletado_em IS NULL
        AND c.hist_canal_venda = 'MASTERCLASS'
        AND NULLIF(TRIM(extra->>'email'), '') IS NOT NULL
    )
    SELECT DISTINCT ON (ta.id)
      e.id_contrato,
      e.id_origem,
      e.id_destino,
      e.email_extra,
      e.nome_extra,
      a.id AS id_aluno,
      a.nome,
      ta.id AS id_turma_aluno,
      ta.id_turma,
      ta.id_turma_transferencia_de
    FROM extras e
    JOIN alunos a ON LOWER(TRIM(a.email)) = e.email_extra
    JOIN turmas_alunos ta
      ON ta.id_aluno = a.id
     AND ta.deletado_em IS NULL
     AND ta.id_turma_transferencia_de IS NULL
     AND ta.origem_aluno = 'COMPROU_INGRESSO'
     AND (
       (e.id_destino IS NOT NULL AND ta.id_turma = e.id_destino)
       OR (e.id_destino IS NULL AND e.id_origem IS NOT NULL AND ta.id_turma <> e.id_origem)
     )
    JOIN turmas t ON t.id = ta.id_turma
    JOIN treinamentos tr ON tr.id = t.id_treinamento
    WHERE e.id_origem IS NOT NULL
      AND e.id_origem <> ta.id_turma
      AND COALESCE(tr.tipo_palestra, false) = false
      AND (t.edicao_turma IS NULL OR LEFT(UPPER(TRIM(t.edicao_turma)), 3) <> 'MC_')
      AND EXISTS (
        SELECT 1
        FROM turmas t_o
        JOIN treinamentos tr_o ON tr_o.id = t_o.id_treinamento
        WHERE t_o.id = e.id_origem
          AND t_o.deletado_em IS NULL
          AND (
            tr_o.tipo_palestra = true
            OR tr_o.tipo_treinamento = false
            OR (t_o.edicao_turma IS NOT NULL AND LEFT(UPPER(TRIM(t_o.edicao_turma)), 3) = 'MC_')
            OR UPPER(COALESCE(tr_o.treinamento, '')) LIKE '%MASTERCLASS%'
          )
      )
    ORDER BY ta.id, e.id_contrato DESC
  `;

  const { rows } = await c.query(selectSql);
  console.log(`Encontrados ${rows.length} inscrição(ões) extra(s)${dryRun ? ' (dry-run)' : ''}`);
  for (const row of rows) {
    console.log(
      `- contrato=${row.id_contrato} extra=${row.nome} <${row.email_extra}> ta=${row.id_turma_aluno} origem=${row.id_origem}`,
    );
  }

  if (!dryRun && rows.length > 0) {
    const upd = await c.query(
      `
      WITH targets AS (${selectSql})
      UPDATE turmas_alunos ta
      SET id_turma_transferencia_de = t.id_origem,
          atualizado_em = NOW()
      FROM targets t
      WHERE ta.id = t.id_turma_aluno
      RETURNING ta.id, ta.id_turma, ta.id_aluno, ta.id_turma_transferencia_de
      `,
    );
    console.log(`Atualizados: ${upd.rowCount}`);
    console.log(JSON.stringify(upd.rows, null, 2));
  }

  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
