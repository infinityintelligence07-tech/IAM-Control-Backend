/**
 * Backfill: vendas MASTERCLASS cuja matrícula no destino não tem
 * id_turma_transferencia_de — a estratificação classifica como "Vendas em Eventos".
 *
 * Uso: node scripts/backfill-origem-mc-estratificacao.js [--dry-run]
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
    connectionTimeoutMillis: 20000,
  });
  await c.connect();

  const selectSql = `
    WITH mc AS (
      SELECT
        c.id AS id_contrato,
        COALESCE(
          NULLIF(c.dados_contrato->>'fluxo_evento_origem_id_turma','')::int,
          NULLIF(c.dados_contrato->>'id_turma_origem','')::int
        ) AS id_origem,
        COALESCE(
          NULLIF(c.dados_contrato->>'fluxo_evento_destino_id_turma','')::int,
          NULLIF(c.dados_contrato->>'id_turma_destino','')::int,
          NULLIF(c.dados_contrato->'turma_destino'->>'id','')::int
        ) AS id_destino,
        ta_c.id_aluno,
        a.nome,
        a.email
      FROM turmas_alunos_treinamentos_contratos c
      JOIN turmas_alunos_treinamentos tat ON tat.id = c.id_turma_aluno_treinamento
      JOIN turmas_alunos ta_c ON ta_c.id = tat.id_turma_aluno
      JOIN alunos a ON a.id = ta_c.id_aluno
      WHERE c.deletado_em IS NULL
        AND c.hist_canal_venda = 'MASTERCLASS'
    )
    SELECT
      mc.id_contrato,
      mc.nome,
      mc.email,
      mc.id_aluno,
      mc.id_origem,
      mc.id_destino,
      ta.id AS id_turma_aluno,
      ta.id_turma,
      ta.id_turma_transferencia_de,
      t.edicao_turma,
      tr.treinamento
    FROM mc
    JOIN turmas_alunos ta
      ON ta.id_aluno = mc.id_aluno
     AND ta.deletado_em IS NULL
     AND ta.id_turma_transferencia_de IS NULL
     AND (
       (mc.id_destino IS NOT NULL AND ta.id_turma = mc.id_destino)
       OR (
         mc.id_destino IS NULL
         AND mc.id_origem IS NOT NULL
         AND ta.id_turma <> mc.id_origem
       )
     )
    JOIN turmas t ON t.id = ta.id_turma
    JOIN treinamentos tr ON tr.id = t.id_treinamento
    WHERE mc.id_origem IS NOT NULL
      AND mc.id_origem <> ta.id_turma
      AND COALESCE(tr.tipo_palestra, false) = false
      AND (t.edicao_turma IS NULL OR LEFT(UPPER(TRIM(t.edicao_turma)), 3) <> 'MC_')
      AND EXISTS (
        SELECT 1
        FROM turmas t_o
        JOIN treinamentos tr_o ON tr_o.id = t_o.id_treinamento
        WHERE t_o.id = mc.id_origem
          AND t_o.deletado_em IS NULL
          AND (
            tr_o.tipo_palestra = true
            OR tr_o.tipo_treinamento = false
            OR (t_o.edicao_turma IS NOT NULL AND LEFT(UPPER(TRIM(t_o.edicao_turma)), 3) = 'MC_')
          )
      )
    ORDER BY mc.id_contrato DESC
  `;

  const { rows } = await c.query(selectSql);
  console.log(`Encontrados ${rows.length} matrícula(s) para backfill${dryRun ? ' (dry-run)' : ''}`);
  for (const row of rows) {
    console.log(
      `- contrato=${row.id_contrato} aluno=${row.nome} ta=${row.id_turma_aluno} turma=${row.id_turma} (${row.treinamento} ${row.edicao_turma}) origem=${row.id_origem}`,
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
