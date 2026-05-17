import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillTurmaOrigemMissaoGovernarEDemais1773900000000 implements MigrationInterface {
    name = 'BackfillTurmaOrigemMissaoGovernarEDemais1773900000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "turmas_alunos_treinamentos_contratos" contrato
            SET
                "dados_contrato" = jsonb_set(
                    jsonb_set(
                        jsonb_set(
                            COALESCE(contrato."dados_contrato", '{}'::jsonb),
                            '{id_turma_origem}',
                            to_jsonb(
                                CASE
                                    WHEN lower(
                                        translate(COALESCE(treinamento."treinamento", ''), 'ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc')
                                    ) LIKE '%missao governar%'
                                        THEN 192
                                    ELSE 60
                                END
                            ),
                            true
                        ),
                        '{fluxo_evento_origem_id_turma}',
                        to_jsonb(
                            CASE
                                WHEN lower(
                                    translate(COALESCE(treinamento."treinamento", ''), 'ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc')
                                ) LIKE '%missao governar%'
                                    THEN 192
                                ELSE 60
                            END
                        ),
                        true
                    ),
                    '{turma_origem}',
                    jsonb_build_object(
                        'id',
                        CASE
                            WHEN lower(
                                translate(COALESCE(treinamento."treinamento", ''), 'ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc')
                            ) LIKE '%missao governar%'
                                THEN 192
                            ELSE 60
                        END
                    ),
                    true
                ),
                "atualizado_em" = NOW()
            FROM "turmas_alunos_treinamentos" tat
            INNER JOIN "treinamentos" treinamento
                ON treinamento."id" = tat."id_treinamento"
            WHERE contrato."id_turma_aluno_treinamento" = tat."id"
              AND contrato."deletado_em" IS NULL
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
            WHERE contrato."deletado_em" IS NULL
              AND (
                    contrato."dados_contrato"->>'id_turma_origem' IN ('192', '60')
                    OR contrato."dados_contrato"->>'fluxo_evento_origem_id_turma' IN ('192', '60')
                )
        `);
    }
}
