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

    /** Mesmo padrão dos contratos Liberty de treinamento (PEA / Leader Skills). */
    private camposDocumento(): object[] {
        return [
            { tipo: 'texto', campo: 'Nome Completo do Aluno', opcoes: [], descricao: 'Nome Completo do Responsável pelo Contrato' },
            { tipo: 'documento', campo: 'CPF/CNPJ do Aluno', opcoes: [], descricao: 'CPF ou CNPJ do Responsável pelo Contrato' },
            { tipo: 'data', campo: 'Data de Nascimento do Aluno', opcoes: [], descricao: 'Data de Nascimento do Responsável pelo Contrato' },
            { tipo: 'telefone', campo: 'WhatsApp do Aluno', opcoes: [], descricao: 'Telefone principal de preferência com WhatsApp  do Responsável pelo Contrato' },
            { tipo: 'email', campo: 'E-Mail do Aluno', opcoes: [], descricao: 'E-mail principal do Responsável pelo Contrato' },
            { tipo: 'texto', campo: 'Endereço do Aluno', opcoes: [], descricao: 'Endereço do Responsável pelo Contrato' },
            { tipo: 'texto', campo: 'Cidade/Estado do Aluno', opcoes: [], descricao: 'Cidade e Estado (UF) do Responsável pelo Contrato' },
            { tipo: 'cep', campo: 'CEP do Aluno', opcoes: [], descricao: 'CEP do Responsável pelo Contrato' },
            { tipo: 'texto', campo: 'Nome do Treinamento Contratado', opcoes: [], descricao: 'Nome do Treinamento Contratado pelo Aluno' },
            { tipo: 'texto', campo: 'Cidade do Treinamento', opcoes: [], descricao: 'Cidade do Treinamento Contratado pelo Aluno' },
            { tipo: 'data', campo: 'Data Prevista do Treinamento', opcoes: [], descricao: 'Data Prevista para Realização do Treinamento Contratado pelo Aluno' },
            { tipo: 'numero', campo: 'Preço do Treinamento', opcoes: [], descricao: 'Preço do Treinamento Contratado pelo Aluno' },
            {
                tipo: 'select',
                campo: 'À Vista',
                opcoes: [
                    'À Vista - Cartão de Crédito',
                    'À Vista - Cartão de Débito',
                    'À Vista - PIX/Transferência',
                    'À Vista - Espécie',
                ],
                descricao: 'Seção para seleção de Forma de Pagamento à vista',
            },
            {
                tipo: 'select',
                campo: 'Parcelado',
                opcoes: [
                    'Parcelado - Cartão de Crédito',
                    'Parcelado - Boleto: {{Quantidade de Boletos}} Parcelas de: {{Valor dos Boletos}}. Melhor dia de Vencimento: {{Dia do Mês para Vencimento dos Boletos}}. Data para o 1º Boleto: {{Data do Primeiro Boleto}}.',
                ],
                descricao: 'Seção para seleção de Forma de Pagamento à prazo',
            },
            { tipo: 'texto', campo: 'Observações', opcoes: [], descricao: 'Campo para inserção de observações relacionadas ao contrato' },
            { tipo: 'texto', campo: 'Local de Assinatura do Contrato', opcoes: [], descricao: 'Cidade e Estado (UF) de Assinatura do Contrato' },
            { tipo: 'data', campo: 'Data de Assinatura do Contrato', opcoes: [], descricao: 'Data de Assinatura do Contrato' },
            { tipo: 'texto', campo: 'Nome da Testemunha 1', opcoes: [], descricao: 'Nome da Testemunha 1 que assinará o Contrato' },
            { tipo: 'documento', campo: 'CPF/CNPJ da Testemunha 1', opcoes: [], descricao: 'CPF ou CNPJ da Testemunha 1 que assinará o Contrato' },
            { tipo: 'texto', campo: 'Nome da Testemunha 2', opcoes: [], descricao: 'Nome da Testemunha 2 que assinará o Contrato' },
            { tipo: 'documento', campo: 'CPF/CNPJ da Testemunha 2', opcoes: [], descricao: 'CPF ou CNPJ da Testemunha 2 que assinará o Contrato' },
        ];
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

        const camposJson = JSON.stringify(this.camposDocumento());

        if (existing?.[0]?.id) {
            await queryRunner.query(
                `
                UPDATE documentos
                SET documento = $2,
                    clausulas = $3,
                    campos_documento = CASE
                        WHEN campos_documento IS NULL
                          OR jsonb_typeof(campos_documento) <> 'array'
                          OR jsonb_array_length(campos_documento) = 0
                        THEN $5::jsonb
                        ELSE campos_documento
                    END,
                    treinamentos_relacionados = $4::jsonb,
                    atualizado_em = NOW()
                WHERE id = $1
                `,
                [existing[0].id, this.nomeDocumento, clausulas, idsJson, camposJson],
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
                $4::jsonb,
                $3::jsonb,
                1,
                NOW(),
                NOW()
            )
            `,
            [this.nomeDocumento, clausulas, idsJson, camposJson],
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
