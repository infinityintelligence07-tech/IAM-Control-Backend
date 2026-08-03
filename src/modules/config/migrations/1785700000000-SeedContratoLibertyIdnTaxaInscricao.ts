import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cadastra o contrato "LIBERTY - Imersão de Negócios (taxa de inscrição)"
 * e vincula ao treinamento IDN (sigla IDN / "Imersão de Negócios").
 *
 * Fonte:
 * - Google Doc: https://docs.google.com/document/d/1BVHrBU1QWz--lXEYbNOkrFhdgy3XVGnM
 * - Arquivo: "LIBERTY - Imersão de Negócios taxa de inscrição.docx"
 */
export class SeedContratoLibertyIdnTaxaInscricao1785700000000 implements MigrationInterface {
    name = 'SeedContratoLibertyIdnTaxaInscricao1785700000000';

    private readonly nomeDocumento = 'Contrato Liberty - Imersão de Negócios (taxa inscrição)';

    private clausulas(): string {
        return [
            'Cláusula 1ª: O presente contrato é realizado online entre o ALUNO(A) (devidamente qualificado na ficha de inscrição) e o LIBERTY LTDA, pessoa jurídica devidamente inscrita no CNPJ nº 47.698.745/0001-30, com sede na Rua Major Rehder, nº 248 - Vila Rehder, Americana - SP, CEP 13465-390, doravante denominada LIBERTY.',
            'Cláusula 2ª: O(A) aluno(a) está ciente de que por mera liberalidade a LIBERTY cobrará apenas a taxa de matrícula/inscrição para o treinamento descrito acima.',
            'Parágrafo primeiro: Sendo que o(a) aluno(a) se encontra devidamente inscrito na turma a partir da assinatura do presente contrato.',
            'Cláusula 3ª: Por ser uma oferta feita exclusiva e com condição comercial abaixo do praticado, não será possível a troca para outra turma do treinamento, nem o cancelamento ou estorno por solicitação do aluno, estando o mesmo ciente e de acordo com o descrito.',
            'Cláusula 4ª: Por tratar-se de condição especial fora do valor de comercialização, não há troca de turma, cancelamento ou estorno, estando o aluno ciente de que, caso não compareça seja por qualquer motivo e queira fazer nova contratação, não serão dadas a ele as mesmas condições de desconto, devendo ele contratar pelo comercial vigente à época.',
            'Cláusula 5ª: O aluno autoriza o uso de sua voz e imagem captados durante o evento para fins institucionais e publicitários.',
            'Cláusula 6ª: A data e local do treinamento são uma previsão de realização, podendo serem alterados pela LIBERTY, contudo a comunicação de qualquer alteração ocorrerá com antecedência via telefone/whatsapp ou e-mail nos dados informados. O ALUNO(A) se responsabiliza por sempre manter seus dados atualizados e comunicar quaisquer alterações.',
        ].join('\n\n');
    }

    public async up(queryRunner: QueryRunner): Promise<void> {
        const idsResult = await queryRunner.query(`
            SELECT array_agg(id ORDER BY id) AS ids
            FROM treinamentos
            WHERE deletado_em IS NULL
              AND (
                UPPER(TRIM(COALESCE(sigla_treinamento, ''))) = 'IDN'
                OR LOWER(treinamento) LIKE '%imers%negoc%'
                OR LOWER(treinamento) = 'imersão de negócios'
                OR LOWER(treinamento) = 'imersao de negocios'
              )
        `);
        const ids: number[] = idsResult?.[0]?.ids || [];
        if (!ids.length) {
            return;
        }
        const idsJson = JSON.stringify(ids);
        const clausulas = this.clausulas();

        const existing = await queryRunner.query(
            `
            SELECT id FROM documentos
            WHERE tipo_documento = 'CONTRATO'
              AND deletado_em IS NULL
              AND (
                documento = $1
                OR LOWER(documento) LIKE '%liberty%imers%negoc%taxa%'
                OR LOWER(documento) LIKE '%idn%taxa%inscri%'
              )
            LIMIT 1
            `,
            [this.nomeDocumento],
        );

        if (existing?.[0]?.id) {
            await queryRunner.query(
                `
                UPDATE documentos
                SET documento = $2,
                    clausulas = $3,
                    treinamentos_relacionados = $4::jsonb,
                    atualizado_em = NOW()
                WHERE id = $1
                `,
                [existing[0].id, this.nomeDocumento, clausulas, idsJson],
            );
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
            [this.nomeDocumento, clausulas, idsJson],
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `
            UPDATE documentos
            SET deletado_em = NOW(),
                atualizado_em = NOW()
            WHERE tipo_documento = 'CONTRATO'
              AND documento = $1
              AND deletado_em IS NULL
            `,
            [this.nomeDocumento],
        );
    }
}
