import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill dos períodos de mentoria por mentorado:
 * - data_inicio_mentoria = data de criação do aluno na turma (turmas_alunos.criado_em);
 * - data_fim_mentoria = data_inicio_mentoria + duração (em meses) configurada no treinamento.
 *
 * Aplica-se apenas às linhas de treinamento marcadas como mentoria (treinamentos.tipo_mentoria = true)
 * cujos mentorados ainda estão ativos (turmas_alunos.deletado_em IS NULL) e que ainda não possuem
 * data de início definida (idempotente). O encerramento automático em D+1 fica a cargo do cron diário.
 */
export class BackfillMentoriaPeriodoFromCreatedAt1775000000000 implements MigrationInterface {
    name = 'BackfillMentoriaPeriodoFromCreatedAt1775000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE turmas_alunos_treinamentos AS tat
            SET data_inicio_mentoria = ta.criado_em::date,
                data_fim_mentoria = CASE
                    WHEN tr.duracao_meses IS NOT NULL
                    THEN (ta.criado_em::date + (tr.duracao_meses || ' months')::interval)::date
                    ELSE NULL
                END
            FROM turmas_alunos AS ta, treinamentos AS tr
            WHERE tat.id_turma_aluno = ta.id
              AND tat.id_treinamento = tr.id
              AND tr.tipo_mentoria = true
              AND ta.deletado_em IS NULL
              AND tat.data_inicio_mentoria IS NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Reverte apenas as datas que correspondem exatamente à regra de backfill (created_at e created_at + duração),
        // preservando eventuais ajustes manuais feitos após a aplicação.
        await queryRunner.query(`
            UPDATE turmas_alunos_treinamentos AS tat
            SET data_inicio_mentoria = NULL,
                data_fim_mentoria = NULL
            FROM turmas_alunos AS ta, treinamentos AS tr
            WHERE tat.id_turma_aluno = ta.id
              AND tat.id_treinamento = tr.id
              AND tr.tipo_mentoria = true
              AND tat.data_inicio_mentoria = ta.criado_em::date
        `);
    }
}
