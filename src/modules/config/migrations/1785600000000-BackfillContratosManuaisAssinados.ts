import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Contratos feitos à mão que nasceram como ZapSign (pending) e nunca tiveram
 * o anexo/`contrato_manual` gravado. Sem isso, o Histórico marca "sem
 * assinatura" e a sync ZapSign rebaixaria qualquer ASSINADO manual.
 *
 * Lista: 29 vendas (origem IPR 215–220 → Confronto) conferidas com o time.
 */
export class BackfillContratosManuaisAssinados1785600000000 implements MigrationInterface {
    name = 'BackfillContratosManuaisAssinados1785600000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE turmas_alunos_treinamentos_contratos
            SET
                status_ass_aluno = 'ASSINADO',
                data_ass_aluno = COALESCE(data_ass_aluno, NOW()),
                dados_contrato = COALESCE(dados_contrato, '{}'::jsonb)
                    || jsonb_build_object('contrato_manual', true),
                zapsign_document_status = COALESCE(zapsign_document_status, '{}'::jsonb)
                    || jsonb_build_object('status', 'signed'),
                zapsign_signers_data = CASE
                    WHEN jsonb_typeof(zapsign_signers_data) = 'array'
                         AND jsonb_array_length(zapsign_signers_data) > 0
                    THEN (
                        SELECT jsonb_agg(
                            CASE
                                WHEN ord.ordinality = 1
                                THEN elem || jsonb_build_object('status', 'signed')
                                ELSE elem
                            END
                        )
                        FROM jsonb_array_elements(zapsign_signers_data) WITH ORDINALITY AS ord(elem, ordinality)
                    )
                    ELSE zapsign_signers_data
                END
            WHERE deletado_em IS NULL
              AND id IN (
                237, 240, 241, 242, 243, 245, 246, 259, 261, 262, 263, 265, 266, 267, 268,
                269, 270, 271, 272, 273, 275, 276, 318, 319, 324, 327, 328, 329, 455
              )
        `);
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // Irreversível: o estado anterior (pending) estava incorreto para
        // contratos assinados no papel.
    }
}
