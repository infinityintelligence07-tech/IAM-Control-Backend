/**
 * Auditoria de transferências da turma Confronto 56 (pós-congelamento) → Confronto 57
 * + investigação de quem removeu os registros congelados (Confronto 56 e IPR-223).
 *
 * Somente leitura (SELECTs). Uso: node scripts/audit-transferencias-confronto56.js
 * Saída: scripts/audit-transferencias-confronto56.result.json
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ALUNOS_ALVO = ['Tânia Marilda Ferreira Pagliarini', 'Adriana Maria Schena', 'Wellington Gomes Scheffler'];
// Registros da IPR-223 (turma 68) soft-deletados em 13/07 — investigar quem removeu.
const IDS_TURMA_ALUNO_IPR223 = ['35987', '32634', '32183', '32182'];

function loadEnv(envPath) {
    const out = {};
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        if (/^\s*#/.test(line)) continue;
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        out[m[1]] = v;
    }
    return out;
}

// Remove acentos para busca tolerante por nome.
const SQL_UNACCENT_NAME = `translate(lower(a.nome),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')`;

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

        // 1) localizar turmas do Confronto edições 56 e 57
        const turmasQ = await client.query(`
            SELECT t.id, t.edicao_turma, t.data_inicio, t.data_final, t.status_turma, t.reaberta_manualmente,
                   tr.sigla_treinamento, tr.treinamento, p.polo
            FROM turmas t
            JOIN treinamentos tr ON tr.id = t.id_treinamento
            LEFT JOIN polos p ON p.id = t.id_polo
            WHERE t.deletado_em IS NULL
              AND (tr.treinamento ILIKE '%confronto%' OR tr.sigla_treinamento ILIKE '%conf%')
              AND (t.edicao_turma ILIKE '%56%' OR t.edicao_turma ILIKE '%57%')
            ORDER BY t.id
        `);
        result.turmas_confronto = turmasQ.rows;
        const turma56 = turmasQ.rows.find((r) => /(^|\D)56(\D|$)/.test(String(r.edicao_turma)));
        const turma57 = turmasQ.rows.find((r) => /(^|\D)57(\D|$)/.test(String(r.edicao_turma)));
        if (!turma56) throw new Error('Turma Confronto 56 não encontrada. Candidatas: ' + JSON.stringify(turmasQ.rows));
        result.turma_56 = turma56;
        result.turma_57 = turma57 || null;

        // 2) auditoria geral: transferências saindo da 56 após a data_final
        const transfQ = await client.query(
            `
            SELECT h.id AS historico_id,
                   h.criado_em AS data_transferencia,
                   h.id_aluno, a.nome, a.email, a.telefone_um,
                   h.id_turma_de, h.id_turma_para,
                   tdest.edicao_turma AS turma_destino_edicao,
                   trdest.sigla_treinamento AS turma_destino_sigla,
                   h.id_turma_aluno_de, h.id_turma_aluno_para,
                   ta_de.deletado_em AS origem_deletado_em,
                   ta_de.atualizado_por AS origem_atualizado_por,
                   u_de.nome AS origem_atualizado_por_nome,
                   ta_de.id_turma_transferencia_para AS origem_marcada_transf_para,
                   ta_de.presenca_turma AS origem_presenca,
                   ta_para.deletado_em AS destino_deletado_em,
                   ta_para.origem_aluno AS destino_origem_aluno,
                   ta_para.id_turma_transferencia_de AS destino_marcada_transf_de
            FROM historico_transferencias_alunos h
            JOIN alunos a ON a.id = h.id_aluno
            LEFT JOIN turmas tdest ON tdest.id = h.id_turma_para
            LEFT JOIN treinamentos trdest ON trdest.id = tdest.id_treinamento
            LEFT JOIN turmas_alunos ta_de ON ta_de.id = h.id_turma_aluno_de
            LEFT JOIN usuarios u_de ON u_de.id = ta_de.atualizado_por
            LEFT JOIN turmas_alunos ta_para ON ta_para.id = h.id_turma_aluno_para
            WHERE h.id_turma_de = $1
              AND h.deletado_em IS NULL
              AND h.criado_em::date > $2::date
            ORDER BY h.criado_em ASC
        `,
            [turma56.id, turma56.data_final],
        );
        const rows = transfQ.rows.map((r) => {
            const destinoCancelada = /CANCELADA/i.test(String(r.turma_destino_edicao || ''));
            const permaneceuNaOrigem = r.origem_deletado_em === null && r.id_turma_aluno_de !== null;
            const replicadoNoDestino = r.id_turma_aluno_para !== null && r.destino_deletado_em === null;
            let status;
            if (destinoCancelada) status = 'CANCELAMENTO (turma CANCELADA)';
            else if (permaneceuNaOrigem && replicadoNoDestino) status = 'OK_CONGELADO';
            else if (!permaneceuNaOrigem) status = 'PROBLEMA_SAIU_DA_ORIGEM';
            else status = 'PROBLEMA_DESTINO_INATIVO';
            return { ...r, permaneceuNaOrigem, replicadoNoDestino, status };
        });
        result.total_transferencias_pos_evento = rows.length;
        result.transferencias = rows;
        result.problemas = rows.filter((r) => r.status.startsWith('PROBLEMA'));

        // 3) os 3 alunos citados: todos os vínculos (inclusive deletados) nas turmas 56/57
        result.alunos_alvo = {};
        for (const nomeAlvo of ALUNOS_ALVO) {
            const chave = nomeAlvo;
            const alvoNorm = nomeAlvo
                .toLowerCase()
                .normalize('NFD')
                .replace(/[̀-ͯ]/g, '');
            const alunosQ = await client.query(
                `SELECT a.id, a.nome, a.email, a.telefone_um FROM alunos a
                 WHERE ${SQL_UNACCENT_NAME} LIKE '%' || $1 || '%'`,
                [alvoNorm],
            );
            const registros = [];
            for (const al of alunosQ.rows) {
                const taQ = await client.query(
                    `
                    SELECT ta.id AS id_turma_aluno, ta.id_turma, t.edicao_turma, tr.sigla_treinamento,
                           ta.origem_aluno, ta.presenca_turma, ta.status_aluno_turma,
                           ta.id_turma_transferencia_para, ta.id_turma_transferencia_de,
                           ta.criado_em, ta.deletado_em, ta.atualizado_em,
                           ta.atualizado_por, u.nome AS atualizado_por_nome
                    FROM turmas_alunos ta
                    JOIN turmas t ON t.id = ta.id_turma
                    JOIN treinamentos tr ON tr.id = t.id_treinamento
                    LEFT JOIN usuarios u ON u.id = ta.atualizado_por
                    WHERE ta.id_aluno = $1 AND ta.id_turma = ANY($2::int[])
                    ORDER BY ta.id_turma, ta.criado_em
                `,
                    [al.id, [turma56.id, turma57 ? turma57.id : -1]],
                );
                const histQ = await client.query(
                    `SELECT h.id, h.id_turma_de, h.id_turma_para, h.id_turma_aluno_de, h.id_turma_aluno_para, h.criado_em
                     FROM historico_transferencias_alunos h
                     WHERE h.id_aluno = $1 AND (h.id_turma_de = $2 OR h.id_turma_para = $2 OR h.id_turma_de = $3 OR h.id_turma_para = $3)
                     ORDER BY h.criado_em`,
                    [al.id, turma56.id, turma57 ? turma57.id : -1],
                );
                const idsTa = taQ.rows.map((r) => r.id_turma_aluno);
                let logs = [];
                if (idsTa.length) {
                    const logsQ = await client.query(
                        `SELECT l.id_turma_aluno, l.id_turma, l.tipo_acao, l.titulo, l.descricao, l.template_key,
                                l.data_acao, l.criado_por, u.nome AS criado_por_nome
                         FROM historico_alunos_turmas_logs l
                         LEFT JOIN usuarios u ON u.id = l.criado_por
                         WHERE l.id_turma_aluno = ANY($1::bigint[])
                         ORDER BY l.data_acao`,
                        [idsTa],
                    );
                    logs = logsQ.rows;
                }
                registros.push({ aluno: al, vinculos_56_57: taQ.rows, historico_transferencias: histQ.rows, logs });
            }
            result.alunos_alvo[chave] = registros;
        }

        // 4) IPR-223: quem removeu os 4 registros congelados
        const iprQ = await client.query(
            `
            SELECT ta.id AS id_turma_aluno, a.nome, ta.deletado_em, ta.atualizado_em,
                   ta.atualizado_por, u.nome AS atualizado_por_nome, u.email AS atualizado_por_email
            FROM turmas_alunos ta
            JOIN alunos a ON a.id = ta.id_aluno
            LEFT JOIN usuarios u ON u.id = ta.atualizado_por
            WHERE ta.id = ANY($1::bigint[])
        `,
            [IDS_TURMA_ALUNO_IPR223],
        );
        const iprLogsQ = await client.query(
            `SELECT l.id_turma_aluno, l.id_turma, l.tipo_acao, l.titulo, l.descricao, l.template_key,
                    l.data_acao, l.criado_por, u.nome AS criado_por_nome
             FROM historico_alunos_turmas_logs l
             LEFT JOIN usuarios u ON u.id = l.criado_por
             WHERE l.id_turma_aluno = ANY($1::bigint[])
             ORDER BY l.data_acao`,
            [IDS_TURMA_ALUNO_IPR223],
        );
        result.ipr223_quem_removeu = { registros: iprQ.rows, logs: iprLogsQ.rows };

        fs.writeFileSync(path.join(__dirname, 'audit-transferencias-confronto56.result.json'), JSON.stringify(result, null, 2), 'utf8');
        console.log('OK - resultado gravado em scripts/audit-transferencias-confronto56.result.json');
        console.log(`Turma 56: id=${turma56.id} (${turma56.edicao_turma}) | Turma 57: ${turma57 ? turma57.id : 'NAO ENCONTRADA'}`);
        console.log(`Transferências pós-evento: ${rows.length} | Problemas: ${result.problemas.length}`);
    } catch (err) {
        result.erro = String((err && err.stack) || err);
        fs.writeFileSync(path.join(__dirname, 'audit-transferencias-confronto56.result.json'), JSON.stringify(result, null, 2), 'utf8');
        console.error('ERRO:', err.message || err);
        process.exitCode = 1;
    } finally {
        try {
            await client.end();
        } catch (_) {}
    }
})();
