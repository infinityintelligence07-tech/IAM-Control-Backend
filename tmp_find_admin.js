const { Client } = require('pg');
const client = new Client({ host: '209.38.128.23', port: 5432, user: 'postgres', password: 'Kakashi150695@weg', database: 'db_iam_control' });
async function main() {
  await client.connect();
  // funcao pode ser array; tenta varias formas
  const rows = (await client.query(`
    SELECT id, nome, email, funcao
    FROM usuarios
    WHERE deletado_em IS NULL
      AND (funcao::text ILIKE '%ADMINISTRADOR%')
    ORDER BY id ASC
    LIMIT 5
  `)).rows;
  console.log(JSON.stringify(rows, null, 2));

  // ids das turmas com snapshot existente
  const snapIds = (await client.query(`SELECT id_turma FROM turmas_metricas_snapshot ORDER BY id_turma`)).rows.map(r => r.id_turma);
  console.log('TURMAS_COM_SNAPSHOT=' + JSON.stringify(snapIds));
  await client.end();
}
main().catch(e=>{console.error(e);process.exit(1);});
