require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT||5432), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE, connectionTimeoutMillis: 20000 });
  await c.connect();
  const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='turmas' ORDER BY ordinal_position`);
  console.log('COLS turmas:', cols.rows.map(r=>r.column_name).join(', '));
  const t = await c.query(`SELECT id, edicao_turma, data_inicio, data_final, status_turma, id_treinamento, id_polo FROM turmas WHERE id IN (71,73,213,447) OR TRIM(edicao_turma) IN ('225','226','228','240') ORDER BY id`);
  console.table(t.rows);
  await c.end();
})().catch(e=>{console.error(e);process.exit(1)});
