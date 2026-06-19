const { Client } = require('pg');
const client = new Client({ host: '209.38.128.23', port: 5432, user: 'postgres', password: 'Kakashi150695@weg', database: 'db_iam_control' });

async function main() {
  await client.connect();
  // Compara, por turma encerrada com snapshot: inscritos congelados (resumo) x inscritos atuais (live) x pico
  const rows = (await client.query(`
    SELECT t."id", t."edicao_turma",
           (s."resumo"->>'inscritos')::int AS snap_inscritos,
           t."meta_pico_inscritos" AS pico_inscritos,
           t."meta_pico_extras" AS pico_extras,
           COALESCE(c.inscritos,0) AS live_inscritos
    FROM "turmas" t
    JOIN "turmas_metricas_snapshot" s ON s."id_turma" = t."id"
    LEFT JOIN (
      SELECT ta."id_turma" AS id_turma, COUNT(*)::int AS inscritos
      FROM "turmas_alunos" ta WHERE ta."deletado_em" IS NULL GROUP BY ta."id_turma"
    ) c ON c.id_turma = t."id"
    WHERE t."deletado_em" IS NULL
    ORDER BY t."id"
  `)).rows;

  const divergSnapVsLive = rows.filter(r => Number(r.snap_inscritos) !== Number(r.live_inscritos));
  const divergPicoVsSnap = rows.filter(r => Number(r.pico_inscritos) !== Number(r.snap_inscritos));

  console.log(`Turmas com snapshot: ${rows.length}`);
  console.log(`snapshot.inscritos != live.inscritos: ${divergSnapVsLive.length}`);
  console.log(`pico.inscritos != snapshot.inscritos: ${divergPicoVsSnap.length}`);

  if (divergSnapVsLive.length) {
    console.log('--- Exemplos snapshot x live divergentes (ate 20) ---');
    console.table(divergSnapVsLive.slice(0,20).map(r => ({
      id: r.id, edicao: r.edicao_turma, snap: r.snap_inscritos, live: r.live_inscritos, pico: r.pico_inscritos
    })));
  }
  await client.end();
}
main().catch(e=>{console.error(e);process.exit(1);});
