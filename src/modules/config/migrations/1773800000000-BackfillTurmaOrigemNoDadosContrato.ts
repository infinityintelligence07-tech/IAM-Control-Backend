import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillTurmaOrigemNoDadosContrato1773800000000 implements MigrationInterface {
    name = 'BackfillTurmaOrigemNoDadosContrato1773800000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "turmas_alunos_treinamentos_contratos" contrato
            SET
                "dados_contrato" = jsonb_set(
                    jsonb_set(
                        jsonb_set(
                            COALESCE(contrato."dados_contrato", '{}'::jsonb),
                            '{id_turma_origem}',
                            to_jsonb(turma_aluno."id_turma"),
                            true
                        ),
                        '{fluxo_evento_origem_id_turma}',
                        to_jsonb(turma_aluno."id_turma"),
                        true
                    ),
                    '{turma_origem}',
                    jsonb_build_object('id', turma_aluno."id_turma"),
                    true
                ),
                "atualizado_em" = NOW()
            FROM "turmas_alunos_treinamentos" turma_aluno_treinamento
            INNER JOIN "turmas_alunos" turma_aluno
                ON turma_aluno."id" = turma_aluno_treinamento."id_turma_aluno"
            WHERE contrato."id_turma_aluno_treinamento" = turma_aluno_treinamento."id"
              AND contrato."deletado_em" IS NULL
              AND turma_aluno."deletado_em" IS NULL
              AND turma_aluno."id_turma" = 192
              AND (
                    contrato."dados_contrato" IS NULL
                    OR NOT (contrato."dados_contrato" ? 'fluxo_evento_origem_id_turma')
                    OR COALESCE(contrato."dados_contrato"->>'fluxo_evento_origem_id_turma', '') = ''
                    OR contrato."dados_contrato"->>'fluxo_evento_origem_id_turma' = '0'
                )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "turmas_alunos_treinamentos_contratos" contrato
            SET
                "dados_contrato" = (
                    (
                        COALESCE(contrato."dados_contrato", '{}'::jsonb)
                        - 'id_turma_origem'
                    )
                    - 'fluxo_evento_origem_id_turma'
                )
                - 'turma_origem',
                "atualizado_em" = NOW()
            FROM "turmas_alunos_treinamentos" turma_aluno_treinamento
            INNER JOIN "turmas_alunos" turma_aluno
                ON turma_aluno."id" = turma_aluno_treinamento."id_turma_aluno"
            WHERE contrato."id_turma_aluno_treinamento" = turma_aluno_treinamento."id"
              AND contrato."deletado_em" IS NULL
              AND turma_aluno."deletado_em" IS NULL
              AND turma_aluno."id_turma" = 192
              AND (
                    contrato."dados_contrato"->>'id_turma_origem' = '192'
                    OR contrato."dados_contrato"->>'fluxo_evento_origem_id_turma' = '192'
                )
        `);
    }
}
