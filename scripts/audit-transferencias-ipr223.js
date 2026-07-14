/**
 * Auditoria de transferências da turma IPR-223 (pós-término do evento).
 *
 * - Localiza a turma IPR 223
 * - Lista transferências (historico_transferencias_alunos) com criado_em > data_final
 * - Verifica a regra de congelamento: o registro de origem deve permanecer ativo
 *   (deletado_em IS NULL) com id_turma_transferencia_para preenchido, e o registro
 *   replicado no destino deve existir ativo.
 *
 * Uso: node scripts/audit-transferencias-ipr223.js
 * Saída: scripts/audit-transferencias-ipr223.result.json
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnv(envPath) {
    const out = {};
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*#?\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        if (/^\s*#/.test(line)) continue; // pula comentadas
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        out[m[1]] = v;
    }
    return out;
}

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

        // 1) localizar a turma IPR 223
        const turmasQ = await client.query(`
            SELECT t.id, t.edicao_turma, t.data_inicio, t.data_final, t.status_turma, t.reaberta_manualmente,
                   tr.sigla_treinamento, tr.treinamento, p.polo
            FROM turmas t
            JOIN treinamentos tr ON tr.id = t.id_treinamento
            LEFT JOIN polos p ON p.id = t.id_polo
            WHERE t.deletado_em IS NULL
              AND (t.edicao_turma ILIKE '%223%')
              AND (tr.sigla_treinamento ILIKE '%IPR%' OR t.edicao_turma ILIKE '%IPR%')
            ORDER BY t.id
        `);
        result.turmas_candidatas = turmasQ.rows;
        const turma = turmasQ.rows.find((r) => /223/.test(String(r.edicao_turma))) || turmasQ.rows[0];
        if (!turma) throw new Error('Turma IPR-223 não encontrada');
        result.turma_origem = turma;

        // 2) transferências após a data de término do evento
        const transfQ = await client.query(
            `
            SELECT h.id AS historico_id,
                   h.criado_em AS data_transferencia,
                   h.id_aluno,
                   a.nome, a.email, a.telefone_um,
                   h.id_turma_de, h.id_turma_para,
                   tdest.edicao_turma AS turma_destino_edicao,
                   trdest.sigla_treinamento AS turma_destino_sigla,
                   tdest.data_inicio AS turma_destino_data_inicio,
                   h.id_turma_aluno_de, h.id_turma_aluno_para,
                   ta_de.deletado_em    AS origem_deletado_em,
                   ta_de.id_turma_transferencia_para AS origem_marcada_transf_para,
                   ta_de.presenca_turma AS origem_presenca,
                   ta_de.transferido_por_robo AS origem_robo,
                   ta_para.deletado_em  AS destino_deletado_em,
                   ta_para.origem_aluno AS destino_origem_aluno,
                   ta_para.id_turma_transferencia_de AS destino_marcada_transf_de,
                   ta_para.transferido_por_robo AS destino_robo
            FROM historico_transferencias_alunos h
            JOIN alunos a ON a.id = h.id_aluno
            LEFT JOIN turmas tdest ON tdest.id = h.id_turma_para
            LEFT JOIN treinamentos trdest ON trdest.id = tdest.id_treinamento
            LEFT JOIN turmas_alunos ta_de ON ta_de.id = h.id_turma_aluno_de
            LEFT JOIN turmas_alunos ta_para ON ta_para.id = h.id_turma_aluno_para
            WHERE h.id_turma_de = $1
              AND h.deletado_em IS NULL
              AND h.criado_em::date > $2::date
            ORDER BY h.criado_em ASC
        `,
            [turma.id, turma.data_final],
        );

        const rows = transfQ.rows.map((r) => {
            const destinoCancelada = /CANCELADA/i.test(String(r.turma_destino_edicao || ''));
            const permaneceuNaOrigem = r.origem_deletado_em === null && r.id_turma_aluno_de !== null;
            const replicadoNoDestino = r.id_turma_aluno_para !== null && r.destino_deletado_em === null;
            const marcacaoOk = r.origem_marcada_transf_para !== null;
            let status;
            if (destinoCancelada) status = 'CANCELAMENTO (turma CANCELADA)';
            else if (permaneceuNaOrigem && replicadoNoDestino) status = 'OK_CONGELADO';
            else if (!permaneceuNaOrigem) status = 'PROBLEMA_SAIU_DA_ORIGEM';
            else status = 'PROBLEMA_DESTINO_INATIVO';
            return { ...r, destinoCancelada, permaneceuNaOrigem, replicadoNoDestino, marcacao_transf_para_ok: marcacaoOk, status };
        });

        result.total_transferencias_pos_evento = rows.length;
        result.transferencias = rows;
        result.problemas = rows.filter((r) => r.status.startsWith('PROBLEMA'));

        // 3) visão extra: registros ativos na 223 marcados como transferidos (sanidade)
        const ativosMarcadosQ = await client.query(
            `
            SELECT count(*)::int AS ativos_marcados_transf_para
            FROM turmas_alunos ta
            WHERE ta.id_turma = $1 AND ta.deletado_em IS NULL AND ta.id_turma_transferencia_para IS NOT NULL
        `,
            [turma.id],
        );
        result.sanidade = ativosMarcadosQ.rows[0];

        fs.writeFileSync(path.join(__dirname, 'audit-transferencias-ipr223.result.json'), JSON.stringify(result, null, 2), 'utf8');
        console.log('OK - resultado gravado em scripts/audit-transferencias-ipr223.result.json');
        console.log(`Turma: ${turma.edicao_turma} (id=${turma.id}) data_final=${turma.data_final}`);
        console.log(`Transferências pós-evento: ${rows.length} | Problemas: ${result.problemas.length}`);
    } catch (err) {
        result.erro = String((err && err.stack) || err);
        fs.writeFileSync(path.join(__dirname, 'audit-transferencias-ipr223.result.json'), JSON.stringify(result, null, 2), 'utf8');
        console.error('ERRO:', err.message || err);
        process.exitCode = 1;
    } finally {
        try {
            await client.end();
        } catch (_) {}
    }
})();
