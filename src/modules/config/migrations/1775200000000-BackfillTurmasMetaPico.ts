import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Congela (inicializa) a meta de todas as turmas existentes, preenchendo o pico
 * (máximo histórico) de inscritos e de alunos extras a partir das estatísticas
 * atuais de `turmas_alunos`.
 *
 * Como não há histórico para recuperar picos anteriores, o pico é inicializado
 * com a contagem atual; a partir daqui ele só sobe (transferências/remoções não
 * o reduzem). A definição de "extras" espelha
 * `UnitOfWorkService.bumparPicoMetricasTurmas` / `TurmasService.getContadoresListagemPorTurmas`
 * (bônus + transferência + sorteio + transbordo).
 */
export class BackfillTurmasMetaPico1775200000000 implements MigrationInterface {
    name = 'BackfillTurmasMetaPico1775200000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "turmas" t
            SET "meta_pico_inscritos" = GREATEST(COALESCE(t."meta_pico_inscritos", 0), COALESCE(c.inscritos, 0)),
                "meta_pico_extras" = GREATEST(COALESCE(t."meta_pico_extras", 0), COALESCE(c.extras, 0))
            FROM (
                SELECT
                    ta."id_turma" AS id_turma,
                    COUNT(*)::int AS inscritos,
                    SUM(
                        CASE
                            WHEN ta."vaga_bonus" = true
                                OR ta."origem_aluno" IN ('ALUNO_BONUS', 'TRANSFERENCIA', 'SORTEIO')
                                OR UPPER(COALESCE(ta."codigo_turma_origem_planilha", '')) = 'TRANSBORDO'
                            THEN 1 ELSE 0
                        END
                    )::int AS extras
                FROM "turmas_alunos" ta
                WHERE ta."deletado_em" IS NULL
                GROUP BY ta."id_turma"
            ) c
            WHERE t."id" = c.id_turma
              AND t."deletado_em" IS NULL
        `);
    }

    public async down(): Promise<void> {
        // Backfill de dados: não há rollback seguro (não restaura picos anteriores).
    }
}
