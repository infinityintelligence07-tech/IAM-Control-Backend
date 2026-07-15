/**
 * Busca flexível por Tânia Pagliarini e Wellington Scheffler (grafias variadas)
 * + lista completa dos alunos ativos no Confronto 57 (turma 90) com o vínculo
 *   correspondente no Confronto 56 (turma 89), inclusive deletado.
 *
 * Somente leitura. Uso: node scripts/lookup-confronto56-alunos.js
 * Saída: scripts/lookup-confronto56-alunos.result.json
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const TURMA_56 = 89;
const TURMA_57 = 90;

function loadEnv(envPath) {
    const out = {};
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        if (/^\s*#/.test(line)) continue;
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        out[m[1]] = v;
    }
    return out;
}

const UN = `translate(lower(a.nome),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')`;

(async () => {
    const env = loadEnv(path.join(__dirname, '..', '.env'));
    const client = new Client({
        host: env.DB_HOST,
        port: Number(env.DB_PORT || 5432),
        user: env.DB_USERNAME,
        password: env.DB_PASSWORD,
        database: env.DB_DATABASE,
        connectionTimeoutMillis: 20000,
    });
    const result = { gerado_em: new Date().toISOString() };
    try {
        await client.connect();

        // 1) busca por pedaços do nome (tolerante a grafia)
        const padroes = ['%tania%', '%pagliarini%', '%paliarini%', '%marilda%', '%scheffler%', '%sheffler%', '%schefler%', '%wellington%gomes%', '%welington%'];
        const buscaQ = await client.query(
            `SELECT a.id, a.nome, a.email, a.telefone_um
             FROM alunos a
             WHERE ${UN} LIKE ANY($1::text[])
             ORDER BY a.nome`,
            [padroes],
        );
        result.busca_por_nome = buscaQ.rows;

        // 2) para cada aluno encontrado, vínculos nas turmas 56/57 (inclusive deletados)
        const ids = buscaQ.rows.map((r) => r.id);
        if (ids.length) {
            const vinculosQ = await client.query(
                `SELECT ta.id AS id_turma_aluno, ta.id_aluno, a.nome, ta.id_turma, t.edicao_turma, tr.sigla_treinamento,
                        ta.origem_aluno, ta.presenca_turma, ta.status_aluno_turma,
                        ta.id_turma_transferencia_para, ta.id_turma_transferencia_de,
                        ta.criado_em, ta.deletado_em, ta.atualizado_por, u.nome AS atualizado_por_nome
                 FROM turmas_alunos ta
                 JOIN alunos a ON a.id = ta.id_aluno
                 JOIN turmas t ON t.id = ta.id_turma
                 JOIN treinamentos tr ON tr.id = t.id_treinamento
                 LEFT JOIN usuarios u ON u.id = ta.atualizado_por
                 WHERE ta.id_aluno = ANY($1::int[]) AND ta.id_turma IN ($2, $3)
                 ORDER BY a.nome, ta.id_turma`,
                [ids, TURMA_56, TURMA_57],
            );
            result.vinculos_56_57 = vinculosQ.rows;
        }

        // 3) visão geral: todos os alunos ATIVOS no Confronto 57 e o vínculo deles no 56 (se houver)
        const geralQ = await client.query(
            `SELECT ta57.id AS id_ta_57, ta57.id_aluno, a.nome, ta57.origem_aluno AS origem_57,
                    ta57.id_turma_transferencia_de AS transf_de_57, ta57.criado_em AS criado_em_57,
                    ta56.id AS id_ta_56, ta56.deletado_em AS deletado_em_56,
                    ta56.id_turma_transferencia_para AS transf_para_56, ta56.presenca_turma AS presenca_56,
                    u.nome AS atualizado_por_56
             FROM turmas_alunos ta57
             JOIN alunos a ON a.id = ta57.id_aluno
             LEFT JOIN turmas_alunos ta56 ON ta56.id_aluno = ta57.id_aluno AND ta56.id_turma = $1
             LEFT JOIN usuarios u ON u.id = ta56.atualizado_por
             WHERE ta57.id_turma = $2 AND ta57.deletado_em IS NULL
             ORDER BY a.nome`,
            [TURMA_56, TURMA_57],
        );
        result.alunos_ativos_confronto57 = geralQ.rows;

        fs.writeFileSync(path.join(__dirname, 'lookup-confronto56-alunos.result.json'), JSON.stringify(result, null, 2), 'utf8');
        console.log(`OK - ${buscaQ.rows.length} alunos na busca por nome; ${geralQ.rows.length} ativos no Confronto 57.`);
    } catch (err) {
        result.erro = String((err && err.stack) || err);
        fs.writeFileSync(path.join(__dirname, 'lookup-confronto56-alunos.result.json'), JSON.stringify(result, null, 2), 'utf8');
        console.error('ERRO:', err.message || err);
        process.exitCode = 1;
    } finally {
        try {
            await client.end();
        } catch (_) {}
    }
})();
