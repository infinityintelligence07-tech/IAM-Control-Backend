/**
 * Corrige o aluno EDUARDO FERNANDES DE SOUSA (id 17558).
 *
 * Situação errada:
 *   38917  MC 447 (30/07)   compra do ingresso            ATIVA
 *   38918  IPR 240 (t213)   deletada -> transf. p/ 228
 *   38921  IPR 228 (t73)    deletada -> transf. p/ 226
 *   38922  IPR 226 (t71)    ATIVA
 *   historico_transferencias_alunos 5334 (240->228) e 5335 (228->226)
 *   4 logs TRANSFERENCIA (26237, 26238, 26314, 26315)
 *
 * Situação desejada:
 *   - Apagar de vez as transferências para 228 e 226 (matrículas, histórico e logs).
 *   - Venda do ingresso na MC continua apontando para o IPR 240 (não é alterada).
 *   - Criar uma transferência real IPR 240 (t213) -> IPR 225 (t70), registrada
 *     pela usuária LILLIAN KAREN DA SILVA BULLA DE SÁ (id 418), replicando
 *     exatamente o comportamento de TurmasService.transferirAluno().
 *
 * Uso:
 *   node scripts/fix-eduardo-fernandes-ipr225.js --dry-run
 *   node scripts/fix-eduardo-fernandes-ipr225.js
 */
require('dotenv').config();
const { Client } = require('pg');

const dryRun = process.argv.includes('--dry-run');

const ID_ALUNO = 17558;
const ID_USUARIO_LILIAN = 418;

const T_MC = 447; // masterclass 30/07 (origem da compra)
const T_IPR240 = 213; // origem da transferência
const T_IPR228 = 73; // transferência a apagar
const T_IPR226 = 71; // transferência a apagar
const T_IPR225 = 70; // destino correto

const MAT_MC = '38917';
const MAT_240 = '38918';
const MAT_228 = '38921';
const MAT_226 = '38922';

const HIST_TRANSF_APAGAR = ['5334', '5335'];
const LOGS_APAGAR = ['26237', '26238', '26314', '26315'];

/** Mesma regra de TurmasService.generateUniqueCrachaNumber: menor livre a partir de 01100. */
async function gerarCracha(c, idTurma) {
    const { rows } = await c.query(`SELECT numero_cracha FROM turmas_alunos WHERE id_turma = $1 AND deletado_em IS NULL`, [idTurma]);
    const usados = new Set(
        rows
            .map((r) => r.numero_cracha)
            .filter((n) => !!n && /^\d+$/.test(String(n)))
            .map((n) => Number.parseInt(String(n), 10)),
    );
    for (let n = 1100; n <= 99999; n += 1) {
        if (!usados.has(n)) return String(n).padStart(5, '0');
    }
    throw new Error('Não foi possível gerar um número de crachá único para a turma ' + idTurma);
}

async function registrarLog(c, { id_turma_aluno, id_turma, id_aluno, titulo, descricao, detalhes }) {
    await c.query(
        `INSERT INTO historico_alunos_turmas_logs
           (id_turma_aluno, id_turma, id_aluno, tipo_acao, titulo, descricao, template_key, detalhes, data_acao, criado_em, atualizado_em, criado_por, atualizado_por)
         VALUES ($1, $2, $3, 'TRANSFERENCIA', $4, $5, NULL, $6::jsonb, NOW(), NOW(), NOW(), $7, $7)`,
        [id_turma_aluno, id_turma, id_aluno, titulo, descricao, JSON.stringify(detalhes), ID_USUARIO_LILIAN],
    );
}

async function snapshot(c, rotulo) {
    const mats = await c.query(
        `SELECT ta.id, ta.id_turma, COALESCE(NULLIF(TRIM(t.edicao_turma), ''), 'MC/' || t.id) AS turma,
                ta.numero_cracha, ta.origem_aluno, ta.status_aluno_turma,
                ta.id_turma_transferencia_de AS transf_de, ta.id_turma_transferencia_para AS transf_para,
                ta.deletado_em IS NOT NULL AS deletada
         FROM turmas_alunos ta JOIN turmas t ON t.id = ta.id_turma
         WHERE ta.id_aluno = $1 ORDER BY ta.id`,
        [ID_ALUNO],
    );
    const hist = await c.query(
        `SELECT id, id_turma_de, id_turma_para, id_turma_aluno_de, id_turma_aluno_para, criado_por
         FROM historico_transferencias_alunos WHERE id_aluno = $1 ORDER BY id`,
        [ID_ALUNO],
    );
    const logs = await c.query(
        `SELECT id, id_turma_aluno, id_turma, tipo_acao, titulo, descricao, criado_por
         FROM historico_alunos_turmas_logs WHERE id_aluno = $1 ORDER BY id`,
        [ID_ALUNO],
    );
    const venda = await c.query(
        `SELECT id, id_turma_aluno, id_treinamento, id_turma_destino, preco_treinamento
         FROM turmas_alunos_treinamentos WHERE id_turma_aluno = $1`,
        [MAT_MC],
    );
    console.log(`\n===== ${rotulo} =====`);
    console.log('MATRÍCULAS:');
    console.table(mats.rows);
    console.log('HISTÓRICO DE TRANSFERÊNCIAS:');
    console.table(hist.rows);
    console.log('LOGS:');
    console.table(logs.rows);
    console.log('VENDA DO INGRESSO NA MC (turmas_alunos_treinamentos):');
    console.table(venda.rows);
}

async function main() {
    const c = new Client({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        connectionTimeoutMillis: 20000,
    });
    await c.connect();

    await snapshot(c, 'ANTES');

    // --- Validações de segurança -------------------------------------------------
    const orig = await c.query(`SELECT id, id_turma, id_aluno, id_acessor, vaga_bonus, id_turma_transferencia_de FROM turmas_alunos WHERE id = $1`, [MAT_240]);
    if (!orig.rows[0]) throw new Error(`Matrícula de origem ${MAT_240} não encontrada`);
    if (Number(orig.rows[0].id_turma) !== T_IPR240) throw new Error(`Matrícula ${MAT_240} não está na turma ${T_IPR240}`);
    if (Number(orig.rows[0].id_aluno) !== ID_ALUNO) throw new Error(`Matrícula ${MAT_240} não pertence ao aluno ${ID_ALUNO}`);
    if (Number(orig.rows[0].id_turma_transferencia_de) !== T_MC) {
        console.warn(`AVISO: origem MC esperada ${T_MC}, encontrada ${orig.rows[0].id_turma_transferencia_de}`);
    }

    const jaNo225 = await c.query(`SELECT id FROM turmas_alunos WHERE id_turma = $1 AND id_aluno = $2 AND deletado_em IS NULL`, [T_IPR225, ID_ALUNO]);
    if (jaNo225.rows.length) throw new Error(`Aluno já possui matrícula ativa na turma ${T_IPR225}: ${jaNo225.rows[0].id}`);

    // Nada além de histórico/logs (que serão apagados) pode referenciar 38921/38922.
    const deps = await c.query(
        `SELECT 'turmas_alunos_produtos' AS tabela, id::text FROM turmas_alunos_produtos WHERE id_turma_aluno::text = ANY($1)
         UNION ALL SELECT 'turmas_alunos_treinamentos', id::text FROM turmas_alunos_treinamentos WHERE id_turma_aluno::text = ANY($1)
         UNION ALL SELECT 'turmas_alunos_treinamentos_bonus', id::text FROM turmas_alunos_treinamentos_bonus WHERE id_turma_aluno::text = ANY($1)`,
        [[MAT_228, MAT_226]],
    );
    if (deps.rows.length) {
        console.error('Dependências inesperadas nas matrículas a apagar:', deps.rows);
        throw new Error('Abortado: há registros vinculados às matrículas 38921/38922.');
    }

    const cracha = await gerarCracha(c, T_IPR225);
    console.log(`\nCrachá gerado para a turma ${T_IPR225} (IPR 225): ${cracha}`);

    if (dryRun) {
        console.log('\n[dry-run] Nenhuma alteração aplicada. O script faria:');
        console.log(`  1. DELETE historico_transferencias_alunos ${HIST_TRANSF_APAGAR.join(', ')}`);
        console.log(`  2. DELETE historico_alunos_turmas_logs ${LOGS_APAGAR.join(', ')}`);
        console.log(`  3. DELETE turmas_alunos ${MAT_228} (IPR 228) e ${MAT_226} (IPR 226)`);
        console.log(`  4. UPDATE turmas_alunos ${MAT_240}: id_turma_transferencia_para = ${T_IPR225}, presenca_turma = NULL, deletado_em = NOW()`);
        console.log(`  5. INSERT turmas_alunos na turma ${T_IPR225} (crachá ${cracha}, origem TRANSFERENCIA, transferencia_de = ${T_IPR240})`);
        console.log(`  6. INSERT historico_transferencias_alunos ${T_IPR240} -> ${T_IPR225} (criado_por ${ID_USUARIO_LILIAN})`);
        console.log(`  7. INSERT 2 logs TRANSFERENCIA (origem e destino), criado_por ${ID_USUARIO_LILIAN}`);
        console.log(`  8. Bump de meta_pico_inscritos/extras da turma ${T_IPR225}`);
        await c.end();
        return;
    }

    await c.query('BEGIN');
    let novaMatriculaId;
    try {
        // 1/2/3 — apaga de vez os artefatos das transferências para 228 e 226
        const delHist = await c.query(`DELETE FROM historico_transferencias_alunos WHERE id::text = ANY($1) RETURNING id`, [HIST_TRANSF_APAGAR]);
        const delLogs = await c.query(`DELETE FROM historico_alunos_turmas_logs WHERE id::text = ANY($1) RETURNING id`, [LOGS_APAGAR]);
        const delMats = await c.query(`DELETE FROM turmas_alunos WHERE id::text = ANY($1) RETURNING id, id_turma`, [[MAT_228, MAT_226]]);
        console.log('Histórico apagado:', delHist.rows.map((r) => r.id));
        console.log('Logs apagados:', delLogs.rows.map((r) => r.id));
        console.log('Matrículas apagadas:', delMats.rows);

        // 4 — matrícula do IPR 240 volta a ser a ORIGEM, agora transferida para o IPR 225
        await c.query(
            `UPDATE turmas_alunos
             SET id_turma_transferencia_para = $1,
                 presenca_turma = NULL,
                 deletado_em = NOW(),
                 atualizado_em = NOW(),
                 atualizado_por = $2
             WHERE id = $3`,
            [T_IPR225, ID_USUARIO_LILIAN, MAT_240],
        );

        // 5 — nova matrícula no IPR 225
        const ins = await c.query(
            `INSERT INTO turmas_alunos (
               id_turma, id_aluno, numero_cracha, vaga_bonus, origem_aluno,
               status_aluno_turma, confirmacao_realizada, checkin_realizado,
               id_turma_transferencia_de, id_acessor, transferido_por_robo,
               quantidade_inscricoes, criado_em, atualizado_em, criado_por, atualizado_por
             ) VALUES (
               $1, $2, $3, $4, 'TRANSFERENCIA',
               'FALTA_ENVIAR_LINK_CONFIRMACAO', false, false,
               $5, $6, false,
               1, NOW(), NOW(), $7, $7
             ) RETURNING id, numero_cracha`,
            [T_IPR225, ID_ALUNO, cracha, orig.rows[0].vaga_bonus === true, T_IPR240, orig.rows[0].id_acessor ?? null, ID_USUARIO_LILIAN],
        );
        novaMatriculaId = ins.rows[0].id;
        console.log('Nova matrícula no IPR 225:', ins.rows[0]);

        // 6 — histórico da transferência 240 -> 225
        const histNovo = await c.query(
            `INSERT INTO historico_transferencias_alunos
               (id_aluno, id_turma_de, id_turma_para, id_turma_aluno_de, id_turma_aluno_para, criado_em, atualizado_em, criado_por, atualizado_por)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6, $6) RETURNING id`,
            [ID_ALUNO, T_IPR240, T_IPR225, MAT_240, novaMatriculaId, ID_USUARIO_LILIAN],
        );
        console.log('Histórico de transferência criado:', histNovo.rows[0].id);

        // 7 — logs (mesmo formato de TurmasService.transferirAluno)
        const detalhes = { id_turma_origem: T_IPR240, id_turma_destino: T_IPR225, edicao_origem: '240', edicao_destino: '225' };
        await registrarLog(c, {
            id_turma_aluno: MAT_240,
            id_turma: T_IPR240,
            id_aluno: ID_ALUNO,
            titulo: 'Aluno transferido para outra turma',
            descricao: 'Transferência da turma 240 para 225.',
            detalhes,
        });
        await registrarLog(c, {
            id_turma_aluno: novaMatriculaId,
            id_turma: T_IPR225,
            id_aluno: ID_ALUNO,
            titulo: 'Aluno recebido por transferência',
            descricao: 'Recebido da turma 240.',
            detalhes,
        });

        // 8 — bump do pico de métricas da turma destino
        await c.query(
            `UPDATE turmas t
             SET meta_pico_inscritos = GREATEST(COALESCE(t.meta_pico_inscritos, 0), c.inscritos),
                 meta_pico_extras   = GREATEST(COALESCE(t.meta_pico_extras, 0), c.extras)
             FROM (
               SELECT ta.id_turma,
                      COUNT(*)::int AS inscritos,
                      SUM(CASE WHEN ta.vaga_bonus = true OR ta.origem_aluno IN ('ALUNO_BONUS','TRANSFERENCIA','SORTEIO','PRESENTE') THEN 1 ELSE 0 END)::int AS extras
               FROM turmas_alunos ta
               WHERE ta.deletado_em IS NULL AND ta.id_turma = $1
               GROUP BY ta.id_turma
             ) c
             WHERE t.id = c.id_turma`,
            [T_IPR225],
        );

        await c.query('COMMIT');
        console.log('\nCOMMIT efetuado.');
    } catch (e) {
        await c.query('ROLLBACK');
        console.error('ROLLBACK — nada foi alterado.');
        throw e;
    }

    await snapshot(c, 'DEPOIS');
    await c.end();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
