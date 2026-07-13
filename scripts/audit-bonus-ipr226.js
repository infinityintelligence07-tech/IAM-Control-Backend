/**
 * Auditoria de bônus — vendas no IPR 223 com bônus destinados à turma IPR 226.
 * SOMENTE LEITURA (apenas SELECTs). Não altera nada no banco.
 *
 * Uso: node scripts/audit-bonus-ipr226.js
 * Saída: scripts/audit-bonus-ipr226.result.json + resumo no console.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnv(file) {
    const env = {};
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        if (line.trim().startsWith('#')) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        env[m[1]] = v;
    }
    return env;
}

const NUM_ORIGEM = '223';
const NUM_DESTINO = '226';

function edicaoBate(edicao, numero) {
    const nums = String(edicao || '').match(/\d+/g) || [];
    return nums.includes(numero);
}

// Extrai do texto "Turmas do Imersão Prosperar" a quantidade destinada à edição alvo.
// Formato típico: "IPR - 226ª Edição - 10/08/2026 - 5 inscrições | IPR - 227ª ..." (variações possíveis)
function parseQtdPorEdicao(descricao, qtdCampoUnico) {
    const resultado = { porEdicao: {}, entradas: [] };
    const texto = String(descricao || '').trim();
    if (!texto) return resultado;
    const entradas = texto.split('|').map((e) => e.trim()).filter(Boolean);
    for (const entrada of entradas) {
        const nums = entrada.match(/\d+/g) || [];
        // edição = primeiro número que não parece dia/mês/ano nem quantidade "N inscrições"
        const qtdMatch = entrada.match(/(\d+)\s*inscri[cç][õoaã]/i);
        const qtd = qtdMatch ? parseInt(qtdMatch[1], 10) : null;
        let edicao = null;
        for (const n of nums) {
            if (qtdMatch && n === qtdMatch[1] && String(edicao) !== null && edicao !== null) continue;
            const v = parseInt(n, 10);
            if (v >= 100 && v < 1000) { edicao = String(v); break; } // edições são 3 dígitos hoje (223, 226...)
        }
        resultado.entradas.push({ entrada, edicao, qtd });
        if (edicao) {
            resultado.porEdicao[edicao] = (resultado.porEdicao[edicao] || 0) + (qtd != null ? qtd : 0);
            if (qtd == null) resultado.porEdicao[edicao + '_sem_qtd'] = true;
        }
    }
    // Uma única entrada sem "N inscrições": usa o campo "Quantidade de Inscrições do Imersão Prosperar"
    if (entradas.length === 1) {
        const unica = resultado.entradas[0];
        if (unica && unica.edicao && (unica.qtd == null || unica.qtd === 0)) {
            const q = parseInt(String(qtdCampoUnico || ''), 10);
            if (Number.isFinite(q) && q > 0) resultado.porEdicao[unica.edicao] = q;
        }
    }
    return resultado;
}

(async () => {
    const env = loadEnv(path.join(__dirname, '..', '.env'));
    const client = new Client({
        host: env.DB_HOST,
        port: parseInt(env.DB_PORT || '5432', 10),
        user: env.DB_USERNAME,
        password: env.DB_PASSWORD,
        database: env.DB_DATABASE,
    });
    await client.connect();
    const out = { gerado_em: new Date().toISOString(), parametros: { origem: NUM_ORIGEM, destino: NUM_DESTINO } };

    try {
        // 1) Turmas candidatas (223 e 226)
        const turmasRes = await client.query(`
            SELECT t.id, t.edicao_turma, t.data_inicio, t.status_turma, t.status_evento, t.deletado_em,
                   tr.id AS id_treinamento, tr.sigla_treinamento, tr.treinamento
            FROM turmas t
            JOIN treinamentos tr ON tr.id = t.id_treinamento
            WHERE t.edicao_turma ~ '(223|226)'
            ORDER BY t.id`);
        const isIpr = (r) =>
            String(r.sigla_treinamento || '').toUpperCase() === 'IPR' ||
            /imers[aã]o prosperar/i.test(String(r.treinamento || ''));
        const turmas223 = turmasRes.rows.filter((r) => !r.deletado_em && isIpr(r) && edicaoBate(r.edicao_turma, NUM_ORIGEM));
        const turmas226 = turmasRes.rows.filter((r) => !r.deletado_em && isIpr(r) && edicaoBate(r.edicao_turma, NUM_DESTINO));
        out.turmas_candidatas = turmasRes.rows;
        out.turmas_223 = turmas223;
        out.turmas_226 = turmas226;
        if (turmas226.length === 0) throw new Error('Nenhuma turma IPR 226 encontrada');
        const ids223 = turmas223.map((t) => t.id);
        const ids226 = turmas226.map((t) => t.id);

        // 2) Matrículas BÔNUS na(s) turma(s) 226 — incluindo deletadas para diagnóstico
        const bonus226 = await client.query(`
            SELECT ta.id, ta.id_turma, ta.id_aluno, ta.id_aluno_bonus, ta.origem_aluno, ta.vaga_bonus,
                   ta.status_aluno_turma, ta.quantidade_inscricoes, ta.criado_em, ta.deletado_em,
                   ta.criado_por, ta.atualizado_por, ta.atualizado_em,
                   a.nome  AS aluno_nome,  a.email AS aluno_email,
                   comp.nome AS comprador_nome, comp.email AS comprador_email
            FROM turmas_alunos ta
            LEFT JOIN alunos a    ON a.id = ta.id_aluno
            LEFT JOIN alunos comp ON comp.id = ta.id_aluno_bonus
            WHERE ta.id_turma = ANY($1::int[])
              AND (ta.origem_aluno = 'ALUNO_BONUS' OR ta.vaga_bonus = true)
            ORDER BY ta.criado_em`, [ids226]);
        out.bonus_na_226 = bonus226.rows;

        // 3) Vendas (contratos) com origem nas turmas 223 — ativos e deletados
        const vendas = await client.query(`
            SELECT c.id AS contrato_id, c.criado_em, c.deletado_em,
                   ta.id AS id_turma_aluno_comprador, ta.id_turma AS id_turma_matricula,
                   ta.id_aluno AS id_comprador, ta.deletado_em AS matricula_deletada_em,
                   a.nome AS comprador_nome, a.email AS comprador_email,
                   tr.sigla_treinamento AS treinamento_vendido, tat.id_turma_destino,
                   c.dados_contrato->>'fluxo_evento_origem_id_turma'  AS origem_id_turma,
                   c.dados_contrato->>'fluxo_evento_destino_id_turma' AS destino_id_turma,
                   COALESCE(c.dados_contrato->'campos_variaveis'->>'Turmas do Imersão Prosperar',
                            c.dados_contrato->'campos_variaveis'->>'Turmas do Imersao Prosperar',
                            c.dados_contrato->'campos_variaveis'->>'Turmas do IPR')            AS turmas_ipr_txt,
                   COALESCE(c.dados_contrato->'campos_variaveis'->>'Quantidade de Inscrições do Imersão Prosperar',
                            c.dados_contrato->'campos_variaveis'->>'Quantidade de Inscricoes do Imersao Prosperar') AS qtd_ipr_txt
            FROM turmas_alunos_treinamentos_contratos c
            JOIN turmas_alunos_treinamentos tat ON tat.id = c.id_turma_aluno_treinamento
            JOIN turmas_alunos ta ON ta.id = tat.id_turma_aluno
            LEFT JOIN alunos a ON a.id = ta.id_aluno
            LEFT JOIN treinamentos tr ON tr.id = tat.id_treinamento
            WHERE ta.id_turma = ANY($1::int[])
               OR (c.dados_contrato->>'fluxo_evento_origem_id_turma') = ANY($2::text[])
            ORDER BY c.criado_em`, [ids223, ids223.map(String)]);
        out.vendas_origem_223 = vendas.rows;

        // 4) Vínculos na tabela de bônus (turmas_alunos_treinamentos_bonus) dos compradores da 223
        const vinculos = await client.query(`
            SELECT b.id, b.id_turma_aluno, b.id_turma_bonus, b.tipo_bonus, b.criado_em, b.deletado_em,
                   array_to_json(b.ganhadores_bonus) AS ganhadores, ta.id_aluno AS id_comprador
            FROM turmas_alunos_treinamentos_bonus b
            JOIN turmas_alunos ta ON ta.id = b.id_turma_aluno
            WHERE ta.id_turma = ANY($1::int[])
            ORDER BY b.criado_em`, [ids223]);
        out.vinculos_bonus_223 = vinculos.rows;

        // 5) Matrículas bônus (qualquer turma) cujo comprador vem das vendas da 223
        const idsCompradores = Array.from(new Set(vendas.rows.map((v) => v.id_comprador).filter(Boolean)));
        let bonusDosCompradores = { rows: [] };
        if (idsCompradores.length) {
            bonusDosCompradores = await client.query(`
                SELECT ta.id, ta.id_turma, t.edicao_turma, tr.sigla_treinamento,
                       ta.id_aluno, ta.id_aluno_bonus, ta.origem_aluno, ta.status_aluno_turma,
                       ta.criado_em, ta.deletado_em, a.nome AS aluno_nome, a.email AS aluno_email
                FROM turmas_alunos ta
                JOIN turmas t ON t.id = ta.id_turma
                JOIN treinamentos tr ON tr.id = t.id_treinamento
                LEFT JOIN alunos a ON a.id = ta.id_aluno
                WHERE ta.origem_aluno = 'ALUNO_BONUS'
                  AND ta.id_aluno_bonus = ANY($1::bigint[])
                ORDER BY ta.criado_em`, [idsCompradores]);
        }
        out.bonus_dos_compradores_223 = bonusDosCompradores.rows;

        // 6) Logs da(s) turma(s) 226 para as matrículas bônus (quem removeu/alterou, quando)
        const idsBonus226 = bonus226.rows.map((r) => r.id);
        let logs = { rows: [] };
        if (idsBonus226.length) {
            logs = await client.query(`
                SELECT l.id_turma_aluno, l.id_turma, l.tipo_acao, l.titulo, l.descricao, l.data_acao, l.detalhes
                FROM historico_alunos_turmas_log l
                WHERE l.id_turma_aluno = ANY($1::bigint[])
                ORDER BY l.data_acao`, [idsBonus226]);
        }
        out.logs_bonus_226 = logs.rows;

        // ===================== ANÁLISE =====================
        const vendasAtivas = vendas.rows.filter((v) => !v.deletado_em);
        const analiseVendas = [];
        for (const v of vendas.rows) {
            const parsed = parseQtdPorEdicao(v.turmas_ipr_txt, v.qtd_ipr_txt);
            const esperado226 = parsed.porEdicao[NUM_DESTINO] || 0;
            if (esperado226 > 0 || Object.keys(parsed.porEdicao).length > 0) {
                analiseVendas.push({
                    contrato_id: v.contrato_id,
                    contrato_deletado: !!v.deletado_em,
                    criado_em: v.criado_em,
                    comprador: v.comprador_nome,
                    comprador_email: v.comprador_email,
                    id_comprador: v.id_comprador,
                    treinamento_vendido: v.treinamento_vendido,
                    turmas_ipr_txt: v.turmas_ipr_txt,
                    qtd_ipr_txt: v.qtd_ipr_txt,
                    esperado_226: esperado226,
                    por_edicao: parsed.porEdicao,
                });
            }
        }
        const vendasCom226 = analiseVendas.filter((v) => v.esperado_226 > 0 && !v.contrato_deletado);
        const vendasCom226Deletadas = analiseVendas.filter((v) => v.esperado_226 > 0 && v.contrato_deletado);

        // atual por comprador na 226 (ativos)
        const ativos226 = bonus226.rows.filter((r) => !r.deletado_em);
        const deletados226 = bonus226.rows.filter((r) => r.deletado_em);
        const atualPorComprador = new Map();
        for (const r of ativos226) {
            const k = String(r.id_aluno_bonus || 'SEM_VINCULO');
            atualPorComprador.set(k, (atualPorComprador.get(k) || 0) + 1);
        }

        const comparativo = [];
        const esperadoPorComprador = new Map();
        for (const v of vendasCom226) {
            const k = String(v.id_comprador || 'SEM_ID');
            esperadoPorComprador.set(k, (esperadoPorComprador.get(k) || 0) + v.esperado_226);
        }
        for (const [idComprador, esperado] of esperadoPorComprador.entries()) {
            const atual = atualPorComprador.get(idComprador) || 0;
            const vendasDoComprador = vendasCom226.filter((v) => String(v.id_comprador) === idComprador);
            const emOutrasTurmas = bonusDosCompradores.rows.filter(
                (b) => String(b.id_aluno_bonus) === idComprador && !ids226.includes(b.id_turma) && !b.deletado_em,
            );
            const deletadosNa226 = deletados226.filter((b) => String(b.id_aluno_bonus) === idComprador);
            comparativo.push({
                id_comprador: idComprador,
                comprador: vendasDoComprador[0] ? vendasDoComprador[0].comprador : '?',
                comprador_email: vendasDoComprador[0] ? vendasDoComprador[0].comprador_email : '?',
                contratos: vendasDoComprador.map((v) => v.contrato_id),
                esperado_226: esperado,
                criados_ativos_226: atual,
                faltando: Math.max(0, esperado - atual),
                excedente: Math.max(0, atual - esperado),
                bonus_deletados_na_226: deletadosNa226.map((b) => ({ id: b.id, aluno: b.aluno_nome, deletado_em: b.deletado_em })),
                bonus_em_outras_turmas: emOutrasTurmas.map((b) => ({ id: b.id, turma: b.edicao_turma, aluno: b.aluno_nome, criado_em: b.criado_em })),
            });
        }
        comparativo.sort((a, b) => b.faltando - a.faltando);

        // bônus na 226 sem venda correspondente na 223
        const setCompradores226 = new Set(Array.from(esperadoPorComprador.keys()));
        const semVenda = ativos226.filter((r) => !setCompradores226.has(String(r.id_aluno_bonus || 'SEM_VINCULO')));

        out.analise = {
            total_vendas_origem_223_ativas: vendasAtivas.length,
            vendas_ativas_com_bonus_226: vendasCom226.length,
            vendas_deletadas_com_bonus_226: vendasCom226Deletadas.map((v) => ({
                contrato_id: v.contrato_id, comprador: v.comprador, esperado_226: v.esperado_226,
            })),
            esperado_total_226: vendasCom226.reduce((acc, v) => acc + v.esperado_226, 0),
            bonus_226_ativos_total: ativos226.length,
            bonus_226_ativos_origem_bonus: ativos226.filter((r) => r.origem_aluno === 'ALUNO_BONUS').length,
            bonus_226_ativos_por_status: ativos226.reduce((acc, r) => {
                const s = r.status_aluno_turma || 'NULL';
                acc[s] = (acc[s] || 0) + 1;
                return acc;
            }, {}),
            bonus_226_deletados: deletados226.map((b) => ({
                id: b.id, aluno: b.aluno_nome, email: b.aluno_email, comprador: b.comprador_nome,
                criado_em: b.criado_em, deletado_em: b.deletado_em, atualizado_por: b.atualizado_por,
            })),
            bonus_226_sem_venda_na_223: semVenda.map((b) => ({
                id: b.id, aluno: b.aluno_nome, comprador: b.comprador_nome, comprador_email: b.comprador_email,
                origem: b.origem_aluno, vaga_bonus: b.vaga_bonus, criado_em: b.criado_em,
            })),
            comparativo_por_comprador: comparativo,
        };

        // ===================== RESUMO CONSOLE =====================
        const A = out.analise;
        const linhas = [];
        linhas.push('==================== RESUMO ====================');
        linhas.push(`Turmas 223: ${turmas223.map((t) => `#${t.id} ${t.edicao_turma}`).join(' | ') || 'NENHUMA'}`);
        linhas.push(`Turmas 226: ${turmas226.map((t) => `#${t.id} ${t.edicao_turma}`).join(' | ')}`);
        linhas.push(`Vendas ativas com origem 223: ${A.total_vendas_origem_223_ativas}`);
        linhas.push(`Vendas ativas com bônus p/ 226: ${A.vendas_ativas_com_bonus_226} (esperado total = ${A.esperado_total_226})`);
        linhas.push(`Bônus ATIVOS na 226: ${A.bonus_226_ativos_total} (status: ${JSON.stringify(A.bonus_226_ativos_por_status)})`);
        linhas.push(`Bônus DELETADOS na 226: ${A.bonus_226_deletados.length}`);
        linhas.push(`Bônus na 226 sem venda na 223: ${A.bonus_226_sem_venda_na_223.length}`);
        linhas.push(`Vendas DELETADAS que citavam 226: ${A.vendas_deletadas_com_bonus_226.length}`);
        linhas.push('--- Compradores com bônus FALTANDO na 226 ---');
        for (const c of comparativo.filter((c) => c.faltando > 0)) {
            linhas.push(`  ${c.comprador} (${c.comprador_email}) contratos=${c.contratos.join(',')} esperado=${c.esperado_226} criados=${c.criados_ativos_226} FALTAM=${c.faltando}` +
                (c.bonus_deletados_na_226.length ? ` [deletados na 226: ${c.bonus_deletados_na_226.length}]` : '') +
                (c.bonus_em_outras_turmas.length ? ` [em outras turmas: ${c.bonus_em_outras_turmas.map((b) => b.turma).join(', ')}]` : ''));
        }
        const resumo = linhas.join('\n');
        console.log(resumo);
        out.resumo = resumo;

        fs.writeFileSync(path.join(__dirname, 'audit-bonus-ipr226.result.json'), JSON.stringify(out, null, 2), 'utf8');
        console.log('\nResultado completo salvo em scripts/audit-bonus-ipr226.result.json');
    } finally {
        await client.end();
    }
})().catch((err) => {
    console.error('ERRO:', err.message);
    try {
        fs.writeFileSync(path.join(__dirname, 'audit-bonus-ipr226.result.json'), JSON.stringify({ erro: err.message, stack: err.stack }, null, 2), 'utf8');
    } catch (_) {}
    process.exit(1);
});
