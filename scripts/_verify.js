require('dotenv').config();
const { Client } = require('pg');
(async () => {
    const c = new Client({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        connectionTimeoutMillis: 20000,
    });
    await c.connect();
    const r = await c.query(`
    SELECT t.id, COALESCE(NULLIF(TRIM(t.edicao_turma),''),'MC/'||t.id) AS turma,
           (SELECT COUNT(*) FROM turmas_alunos x WHERE x.id_turma=t.id AND x.deletado_em IS NULL) AS ativos,
           (SELECT COUNT(*) FROM turmas_alunos x WHERE x.id_turma=t.id AND x.id_aluno=17558 AND x.deletado_em IS NULL) AS eduardo_ativo
    FROM turmas t WHERE t.id IN (70,71,73,213,447) ORDER BY t.id`);
    console.table(r.rows);
    const orf = await c.query(`
    SELECT 'hist' AS t, id::text FROM historico_transferencias_alunos WHERE id_turma_aluno_de::text IN ('38921','38922') OR id_turma_aluno_para::text IN ('38921','38922')
    UNION ALL SELECT 'logs', id::text FROM historico_alunos_turmas_logs WHERE id_turma_aluno::text IN ('38921','38922')
    UNION ALL SELECT 'ta', id::text FROM turmas_alunos WHERE id::text IN ('38921','38922')`);
    console.log('Restos das transferências apagadas:', orf.rows.length === 0 ? 'nenhum ✅' : orf.rows);
    const d = await c.query(
        `SELECT id, numero_cracha, origem_aluno, status_aluno_turma, id_turma_transferencia_de, criado_por
     FROM turmas_alunos WHERE id_turma=70 AND id_aluno=17558 AND deletado_em IS NULL`,
    );
    console.log('Matrícula ativa no IPR 225:', d.rows);
    await c.end();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
