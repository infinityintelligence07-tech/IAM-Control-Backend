require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE, connectionTimeoutMillis: 20000,
  });
  await c.connect();
  const al = await c.query(`SELECT id, nome, email, telefone_um, cpf, id_polo, deletado_em FROM alunos WHERE nome ILIKE '%EDUARDO%FERNANDES%SOUSA%' OR nome ILIKE '%EDUARDO%FERNANDES%SOUZA%'`);
  console.log('ALUNOS:', JSON.stringify(al.rows, null, 2));
  for (const a of al.rows) {
    const m = await c.query(`
      SELECT ta.id, ta.id_turma, t.edicao_turma, t.data_inicio, ta.numero_cracha, ta.origem_aluno,
             ta.status_aluno_turma, ta.vaga_bonus, ta.id_turma_transferencia_de, ta.id_turma_transferencia_para,
             ta.transferido_por_robo, ta.quantidade_inscricoes, ta.deletado_em, ta.criado_em
      FROM turmas_alunos ta JOIN turmas t ON t.id = ta.id_turma
      WHERE ta.id_aluno = $1 ORDER BY ta.id`, [a.id]);
    console.log(`\nMATRICULAS aluno ${a.id} (${a.nome}):`, JSON.stringify(m.rows, null, 2));
    const h = await c.query(`SELECT * FROM historico_transferencias_alunos WHERE id_aluno = $1 ORDER BY id`, [a.id]);
    console.log(`HISTORICO:`, JSON.stringify(h.rows, null, 2));
  }
  const t = await c.query(`SELECT id, edicao_turma, data_inicio, data_fim, status_turma FROM turmas WHERE edicao_turma ILIKE '%22[5-8]%' OR edicao_turma ILIKE '%240%' ORDER BY id`);
  console.log('\nTURMAS candidatas:', JSON.stringify(t.rows, null, 2));
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
