require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT||5432), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE, connectionTimeoutMillis: 20000 });
  await c.connect();
  const ids = ['38917','38918','38921','38922'];
  const fks = await c.query(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='turmas_alunos' AND ccu.column_name='id'`);
  console.log('FKs -> turmas_alunos.id:', JSON.stringify(fks.rows));
  for (const f of fks.rows) {
    try {
      const r = await c.query(`SELECT * FROM ${f.table_name} WHERE ${f.column_name}::text = ANY($1)`, [ids]);
      if (r.rows.length) console.log(`\n${f.table_name}.${f.column_name}:`, JSON.stringify(r.rows, null, 2));
    } catch(e) { console.log('erro', f.table_name, e.message); }
  }
  // crachás usados na turma 70
  const cr = await c.query(`SELECT numero_cracha FROM turmas_alunos WHERE id_turma=70 AND deletado_em IS NULL ORDER BY numero_cracha`);
  const usados = cr.rows.map(r=>r.numero_cracha);
  console.log('\nturma 70 total matriculas:', usados.length, 'min/max:', usados[0], usados[usados.length-1]);
  await c.end();
})().catch(e=>{console.error(e);process.exit(1)});
