require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT||5432), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE, connectionTimeoutMillis: 20000 });
  await c.connect();
  const u = await c.query(`SELECT id, nome, email, deletado_em FROM usuarios WHERE nome ILIKE '%lilian%' OR nome ILIKE '%lilia%' ORDER BY id`);
  console.table(u.rows);
  const u2 = await c.query(`SELECT id, nome, email FROM usuarios WHERE id IN (1,244,418)`);
  console.table(u2.rows);
  await c.end();
})().catch(e=>{console.error(e);process.exit(1)});
