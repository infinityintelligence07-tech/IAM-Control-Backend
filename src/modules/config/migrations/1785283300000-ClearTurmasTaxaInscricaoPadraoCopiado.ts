import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove cópias do valor padrão da taxa IPR nas turmas de palestra/masterclass.
 *
 * O formulário de turma gravava o padrão de /configuracoes em
 * `taxa_inscricao_masterclass`, então alterar a config não refletia nas vendas
 * (a turma “vence” o fallback). Valores iguais ao default de código (250) ou
 * ao padrão atual da config são limpos; overrides individuais são preservados.
 */
export class ClearTurmasTaxaInscricaoPadraoCopiado1785283300000 implements MigrationInterface {
    name = 'ClearTurmasTaxaInscricaoPadraoCopiado1785283300000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE turmas AS t
            SET taxa_inscricao_masterclass = NULL
            FROM treinamentos AS tr
            WHERE t.id_treinamento = tr.id
              AND tr.tipo_palestra = true
              AND t.taxa_inscricao_masterclass IS NOT NULL
              AND (
                t.taxa_inscricao_masterclass = 250
                OR t.taxa_inscricao_masterclass = (
                    SELECT NULLIF(TRIM(c.valor), '')::numeric
                    FROM configuracoes_sistema c
                    WHERE c.chave = 'taxa_inscricao_ipr_masterclass'
                    LIMIT 1
                )
              )
        `);
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // Irreversível: não há como restaurar o valor copiado por turma.
    }
}
