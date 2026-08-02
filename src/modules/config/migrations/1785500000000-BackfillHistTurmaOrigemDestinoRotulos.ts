import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corrige hist_turma_origem / hist_turma_destino gravados só com o id numérico
 * (ou vazios) nas vendas. O rótulo passa a ser "Treinamento - Edição" resolvido
 * pelos ids de fluxo_evento_* — o mesmo formato das opções do filtro EVENTOS.
 */
export class BackfillHistTurmaOrigemDestinoRotulos1785500000000 implements MigrationInterface {
    name = 'BackfillHistTurmaOrigemDestinoRotulos1785500000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            WITH rotulos AS (
                SELECT
                    c.id AS contrato_id,
                    CASE
                        WHEN NULLIF(tro.treinamento, '') IS NULL THEN NULL
                        WHEN tor.id_turma_mentoria_vinculada IS NOT NULL
                            OR ((tro.tipo_mentoria = true OR tro.treinamento ILIKE '%liberty%')
                                AND COALESCE(tor.data_final, tor.data_inicio) IS NOT NULL
                                AND EXTRACT(YEAR FROM COALESCE(tor.data_final, tor.data_inicio)) < 2999)
                            THEN TRIM(CONCAT(
                                tro.treinamento,
                                COALESCE(
                                    ' - ' || (
                                        CASE EXTRACT(MONTH FROM COALESCE(tor.data_final, tor.data_inicio))
                                            WHEN 1 THEN 'Janeiro' WHEN 2 THEN 'Fevereiro' WHEN 3 THEN 'Março'
                                            WHEN 4 THEN 'Abril' WHEN 5 THEN 'Maio' WHEN 6 THEN 'Junho'
                                            WHEN 7 THEN 'Julho' WHEN 8 THEN 'Agosto' WHEN 9 THEN 'Setembro'
                                            WHEN 10 THEN 'Outubro' WHEN 11 THEN 'Novembro' WHEN 12 THEN 'Dezembro'
                                            ELSE NULL
                                        END
                                    ),
                                    ''
                                )
                            ))
                        WHEN tro.tipo_mentoria = true
                            THEN CONCAT(tro.treinamento, ' (Mentoria)')
                        WHEN NULLIF(tor.edicao_turma, '') IS NOT NULL
                            THEN CONCAT(tro.treinamento, ' - ', tor.edicao_turma)
                        ELSE NULL
                    END AS origem_rotulo,
                    CASE
                        WHEN NULLIF(trd.treinamento, '') IS NULL THEN NULL
                        WHEN td.id_turma_mentoria_vinculada IS NOT NULL
                            OR ((trd.tipo_mentoria = true OR trd.treinamento ILIKE '%liberty%')
                                AND COALESCE(td.data_final, td.data_inicio) IS NOT NULL
                                AND EXTRACT(YEAR FROM COALESCE(td.data_final, td.data_inicio)) < 2999)
                            THEN TRIM(CONCAT(
                                trd.treinamento,
                                COALESCE(
                                    ' - ' || (
                                        CASE EXTRACT(MONTH FROM COALESCE(td.data_final, td.data_inicio))
                                            WHEN 1 THEN 'Janeiro' WHEN 2 THEN 'Fevereiro' WHEN 3 THEN 'Março'
                                            WHEN 4 THEN 'Abril' WHEN 5 THEN 'Maio' WHEN 6 THEN 'Junho'
                                            WHEN 7 THEN 'Julho' WHEN 8 THEN 'Agosto' WHEN 9 THEN 'Setembro'
                                            WHEN 10 THEN 'Outubro' WHEN 11 THEN 'Novembro' WHEN 12 THEN 'Dezembro'
                                            ELSE NULL
                                        END
                                    ),
                                    ''
                                )
                            ))
                        WHEN trd.tipo_mentoria = true
                            THEN CONCAT(trd.treinamento, ' (Mentoria)')
                        WHEN NULLIF(td.edicao_turma, '') IS NOT NULL
                            THEN CONCAT(trd.treinamento, ' - ', td.edicao_turma)
                        ELSE NULL
                    END AS destino_rotulo,
                    NULLIF(tro.treinamento, '') AS treinamento_origem
                FROM turmas_alunos_treinamentos_contratos c
                LEFT JOIN turmas tor
                    ON tor.id = NULLIF(c.dados_contrato->>'fluxo_evento_origem_id_turma', '')::int
                LEFT JOIN treinamentos tro ON tro.id = tor.id_treinamento
                LEFT JOIN turmas td
                    ON td.id = NULLIF(c.dados_contrato->>'fluxo_evento_destino_id_turma', '')::int
                LEFT JOIN treinamentos trd ON trd.id = td.id_treinamento
                WHERE c.deletado_em IS NULL
                  AND (
                    c.hist_turma_origem IS NULL
                    OR TRIM(c.hist_turma_origem) = ''
                    OR c.hist_turma_origem ~ '^[0-9]+$'
                    OR c.hist_turma_destino IS NULL
                    OR TRIM(c.hist_turma_destino) = ''
                    OR c.hist_turma_destino ~ '^[0-9]+$'
                  )
            )
            UPDATE turmas_alunos_treinamentos_contratos AS c
            SET hist_turma_origem = LEFT(TRIM(COALESCE(
                    r.origem_rotulo,
                    CASE WHEN c.hist_turma_origem ~ '^[0-9]+$' THEN NULL ELSE NULLIF(TRIM(c.hist_turma_origem), '') END
                )), 255),
                hist_turma_destino = LEFT(TRIM(COALESCE(
                    r.destino_rotulo,
                    CASE WHEN c.hist_turma_destino ~ '^[0-9]+$' THEN NULL ELSE NULLIF(TRIM(c.hist_turma_destino), '') END
                )), 255),
                hist_treinamento_origem = LEFT(TRIM(COALESCE(r.treinamento_origem, c.hist_treinamento_origem)), 255)
            FROM rotulos r
            WHERE c.id = r.contrato_id
              AND (r.origem_rotulo IS NOT NULL OR r.destino_rotulo IS NOT NULL)
        `);
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // Irreversível: os valores anteriores estavam incompletos/incorretos.
    }
}
