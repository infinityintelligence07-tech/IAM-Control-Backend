import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marca como ASSINADO os contratos cujo documento assinado no papel já está
 * anexado (`foto_documento_aluno_base64`).
 *
 * Esses contratos nasceram na ZapSign antes de a venda passar a suportar o
 * modo "contrato escrito à mão", então continuaram com um documento lá que
 * ninguém iria assinar. A cada ciclo, a sincronização lia "pending" na ZapSign
 * e rebaixava o ASSINADO gravado no momento do anexo, deixando o contrato
 * eternamente pendente no Histórico de Vendas.
 *
 * A trava contra o rebaixamento está em `sincronizarStatusZapSign`; aqui
 * apenas corrigimos os registros que já ficaram para trás.
 */
export class BackfillContratosAssinadosNoPapel1785400000000 implements MigrationInterface {
    name = 'BackfillContratosAssinadosNoPapel1785400000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE turmas_alunos_treinamentos_contratos
            SET status_ass_aluno = 'ASSINADO',
                data_ass_aluno = COALESCE(data_ass_aluno, criado_em),
                zapsign_document_status = COALESCE(zapsign_document_status, '{}'::jsonb)
                    || jsonb_build_object('status', 'signed')
            WHERE deletado_em IS NULL
              AND COALESCE(foto_documento_aluno_base64, '') <> ''
              AND (
                status_ass_aluno <> 'ASSINADO'
                OR LOWER(COALESCE(zapsign_document_status->>'status', '')) <> 'signed'
              )
        `);
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // Irreversível: não há registro de qual era o status anterior, e o
        // anterior estava errado.
    }
}
