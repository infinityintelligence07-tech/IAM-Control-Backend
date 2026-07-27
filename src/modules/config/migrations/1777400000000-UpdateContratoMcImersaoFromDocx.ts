import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Atualiza o contrato padrão Masterclass/Eventos → Imersão Prosperar
 * com o texto oficial do arquivo "IAM - Contrato MC para Imersão.docx".
 *
 * Documento alvo: "Contrato IPR - MasterClass e Eventos" (variante MC_EVENTOS),
 * usado nas vendas com origem MASTERCLASS (padrão) e EVENTOS.
 */
export class UpdateContratoMcImersaoFromDocx1777400000000
    implements MigrationInterface
{
    name = 'UpdateContratoMcImersaoFromDocx1777400000000';

    private readonly nomeDocumento =
        'Contrato IPR - MasterClass e Eventos';

    private clausulasMcImersao(): string {
        return [
            'Cláusula 1ª: O presente contrato é realizado presencialmente entre o ALUNO (devidamente qualificado na ficha de inscrição) e o Instituto Academy Mind Treinamentos LTDA, pessoa jurídica devidamente inscrita no CNPJ nº 03.727.532/0001-13, com sede na Rua Major Rehder, nº 245 - Vila Rehder, Americana - SP, CEP 13465-390, doravante denominada IAM.',
            'Cláusula 2ª: Por ser uma oferta feita exclusiva e com condição comercial abaixo do praticado, não será possível o cancelamento, estorno, estando o mesmo ciente e de acordo com o descrito.',
            'Cláusula 3ª: A troca de turma poderá ser solicitada até 30 dias antes da data prevista para realização do treinamento, desde que haja disponibilidade e viabilidade na nova turma escolhida para efetivação da transferência.',
            'Parágrafo único - Será permitido o ALUNO(a) trocar de turma 01 (uma) vez e nessa troca haverá a cobrança de 10% do total da inscrição que for solicitada troca pelo ALUNO(a) a título de taxa administrativa, sendo isenta apenas a primeira troca.',
            'Cláusula 4ª. O(A) aluno(a) autoriza o uso de sua voz e imagem captados durante o evento para fins institucionais e publicitários',
            'Cláusula 5ª: A data e local do treinamento são uma previsão de realização, podendo serem alterados, contudo a comunicação qualquer alteração ocorrerá com antecedência via telefone/whatsapp ou e-mail nos dados informados na ficha de inscrição. o ALUNO(a) se responsabiliza por sempre manter seus dados atualizados e comunicar quaisquer alterações',
        ].join('\n\n');
    }

    public async up(queryRunner: QueryRunner): Promise<void> {
        const clausulas = this.clausulasMcImersao();

        const updated = await queryRunner.query(
            `
            UPDATE documentos
            SET clausulas = $2,
                atualizado_em = NOW()
            WHERE tipo_documento = 'CONTRATO'
              AND deletado_em IS NULL
              AND (
                documento = $1
                OR documento = 'Contrato do IPR'
                OR LOWER(documento) LIKE '%mc para imers%'
                OR LOWER(documento) LIKE '%masterclass e eventos%'
              )
            RETURNING id
            `,
            [this.nomeDocumento, clausulas],
        );

        if (updated?.length) {
            return;
        }

        // Se ainda não existir o documento (ambiente sem seed anterior), cria
        // vinculado aos treinamentos IPR.
        const iprIdsResult = await queryRunner.query(`
            SELECT array_agg(id ORDER BY id) AS ids
            FROM treinamentos
            WHERE deletado_em IS NULL
              AND (
                LOWER(treinamento) LIKE '%prosperar%'
                OR LOWER(treinamento) LIKE '%ipr%'
                OR LOWER(COALESCE(sigla_treinamento, '')) = 'ipr'
              )
        `);
        const ids: number[] = iprIdsResult?.[0]?.ids || [];
        if (!ids.length) {
            return;
        }

        await queryRunner.query(
            `
            INSERT INTO documentos (
                documento,
                tipo_documento,
                clausulas,
                campos_documento,
                treinamentos_relacionados,
                versao,
                criado_em,
                atualizado_em
            ) VALUES (
                $1,
                'CONTRATO',
                $2,
                '[]'::jsonb,
                $3::jsonb,
                1,
                NOW(),
                NOW()
            )
            `,
            [this.nomeDocumento, clausulas, JSON.stringify(ids)],
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Não restaura o texto anterior (desconhecido em cada ambiente).
        await queryRunner.query(
            `
            UPDATE documentos
            SET atualizado_em = NOW()
            WHERE tipo_documento = 'CONTRATO'
              AND deletado_em IS NULL
              AND documento = $1
            `,
            [this.nomeDocumento],
        );
    }
}
