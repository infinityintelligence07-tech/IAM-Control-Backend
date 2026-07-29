/**
 * Corrige venda MC contrato 864 (Cristiane):
 * - Cadastro estava como "Francisco" com o e-mail da Cristiane
 * - 2ª inscrição (Francisco) não gerou matrícula → 19/20 no extrato IPR 240
 *
 * Uso: node scripts/fix-cristiane-ipr240.js [--dry-run]
 */
require('dotenv').config();
const { Client } = require('pg');

const dryRun = process.argv.includes('--dry-run');
const ID_ALUNO_CRISTIANE = 17444;
const ID_TURMA_IPR = 213;
const ID_TURMA_MC = 454;
const EMAIL_CRISTIANE = 'soarescristiane568@gmail.com';
const EMAIL_FRANCISCO = 'soarescristiane568+insc2_n_comp@gmail.com';

async function nextCracha(c, idTurma) {
  const { rows } = await c.query(
    `SELECT numero_cracha FROM turmas_alunos WHERE id_turma = $1 AND deletado_em IS NULL`,
    [idTurma],
  );
  const usados = new Set(
    rows
      .map((r) => r.numero_cracha)
      .filter((n) => n && /^\d+$/.test(String(n)))
      .map((n) => parseInt(String(n), 10)),
  );
  for (let n = 1100; n <= 99999; n += 1) {
    if (!usados.has(n)) return String(n).padStart(5, '0');
  }
  throw new Error('Sem crachá disponível');
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

  const cristiane = await c.query(`SELECT id, nome, email, telefone_um, id_polo, cpf FROM alunos WHERE id = $1`, [
    ID_ALUNO_CRISTIANE,
  ]);
  if (!cristiane.rows[0]) throw new Error('Aluno Cristiane/Francisco não encontrado');
  console.log('Antes:', cristiane.rows[0]);

  const jaFrancisco = await c.query(`SELECT id, nome, email FROM alunos WHERE lower(email) = $1`, [
    EMAIL_FRANCISCO.toLowerCase(),
  ]);
  console.log('Francisco existente:', jaFrancisco.rows);

  const matCristiane = await c.query(
    `SELECT id, id_turma_transferencia_de, quantidade_inscricoes
     FROM turmas_alunos
     WHERE id_turma = $1 AND id_aluno = $2 AND deletado_em IS NULL`,
    [ID_TURMA_IPR, ID_ALUNO_CRISTIANE],
  );
  console.log('Matrícula IPR atual:', matCristiane.rows);

  if (dryRun) {
    console.log('[dry-run] Renomearia aluno', ID_ALUNO_CRISTIANE, '→ CRISTIANE SOARES DA MOTA');
    console.log('[dry-run] Criaria Francisco + matrícula IPR 240 com origem MC', ID_TURMA_MC);
    await c.end();
    return;
  }

  await c.query('BEGIN');
  try {
    await c.query(
      `UPDATE alunos
       SET nome = 'CRISTIANE SOARES DA MOTA',
           nome_cracha = 'CRISTIANE SOARES DA MOTA',
           atualizado_em = NOW()
       WHERE id = $1`,
      [ID_ALUNO_CRISTIANE],
    );

    let idFrancisco = jaFrancisco.rows[0]?.id;
    if (!idFrancisco) {
      const tel = '62984647496';
      const ins = await c.query(
        `INSERT INTO alunos (
           nome, nome_cracha, email, telefone_um, possui_deficiencia,
           status_aluno_geral, id_polo, id_aluno_vinculado,
           criado_em, atualizado_em
         ) VALUES (
           'FRANCISCO DA SILVA CALIXTA',
           'FRANCISCO DA SILVA CALIXTA',
           $1, $2, false,
           'ATIVO', $3, $4,
           NOW(), NOW()
         ) RETURNING id`,
        [EMAIL_FRANCISCO, tel, cristiane.rows[0].id_polo, ID_ALUNO_CRISTIANE],
      );
      idFrancisco = ins.rows[0].id;
      console.log('Francisco criado id=', idFrancisco);
    } else {
      console.log('Reusando Francisco id=', idFrancisco);
    }

    const matFran = await c.query(
      `SELECT id FROM turmas_alunos
       WHERE id_turma = $1 AND id_aluno = $2 AND deletado_em IS NULL`,
      [ID_TURMA_IPR, idFrancisco],
    );

    if (matFran.rows.length === 0) {
      const cracha = await nextCracha(c, ID_TURMA_IPR);
      const mat = await c.query(
        `INSERT INTO turmas_alunos (
           id_turma, id_aluno, numero_cracha, vaga_bonus, origem_aluno,
           status_aluno_turma, confirmacao_realizada, checkin_realizado,
           id_turma_transferencia_de, quantidade_inscricoes,
           criado_em, atualizado_em
         ) VALUES (
           $1, $2, $3, false, 'COMPROU_INGRESSO',
           'FALTA_ENVIAR_LINK_CONFIRMACAO', false, false,
           $4, 1,
           NOW(), NOW()
         ) RETURNING id, numero_cracha`,
        [ID_TURMA_IPR, idFrancisco, cracha, ID_TURMA_MC],
      );
      console.log('Matrícula Francisco IPR:', mat.rows[0]);
    } else {
      await c.query(
        `UPDATE turmas_alunos
         SET id_turma_transferencia_de = $1, atualizado_em = NOW()
         WHERE id = $2 AND id_turma_transferencia_de IS NULL`,
        [ID_TURMA_MC, matFran.rows[0].id],
      );
      console.log('Matrícula Francisco já existia:', matFran.rows[0].id);
    }

    // Garante origem MC na matrícula da Cristiane
    if (matCristiane.rows[0] && !matCristiane.rows[0].id_turma_transferencia_de) {
      await c.query(
        `UPDATE turmas_alunos SET id_turma_transferencia_de = $1, atualizado_em = NOW() WHERE id = $2`,
        [ID_TURMA_MC, matCristiane.rows[0].id],
      );
    }

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }

  const check = await c.query(`
    SELECT
      (SELECT COUNT(*)::int FROM turmas_alunos ta
       WHERE ta.id_turma = $1 AND ta.deletado_em IS NULL
         AND ta.id_turma_transferencia_de IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM turmas t JOIN treinamentos tr ON tr.id = t.id_treinamento
           WHERE t.id = ta.id_turma_transferencia_de
             AND (tr.tipo_palestra OR tr.tipo_treinamento = false
                  OR LEFT(UPPER(TRIM(COALESCE(t.edicao_turma,''))),3)='MC_')
         )
      ) AS matriculas_mc,
      (SELECT nome FROM alunos WHERE id = $2) AS nome_cristiane,
      (SELECT json_agg(json_build_object('id', ta.id, 'nome', a.nome, 'email', a.email))
       FROM turmas_alunos ta JOIN alunos a ON a.id = ta.id_aluno
       WHERE ta.id_turma = $1 AND ta.deletado_em IS NULL
         AND a.id IN ($2, (SELECT id FROM alunos WHERE lower(email)=lower($3)))
      ) AS matriculas_casal
  `, [ID_TURMA_IPR, ID_ALUNO_CRISTIANE, EMAIL_FRANCISCO]);
  console.log('Resultado:', JSON.stringify(check.rows[0], null, 2));

  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
