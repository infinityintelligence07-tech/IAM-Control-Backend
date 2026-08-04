import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O seed do contrato IDN (taxa inscrição) gravou campos_documento = [].
 * Copia o conjunto padrão de campos dos contratos Liberty de treinamento
 * (PEA / Leader Skills): nome, CPF, telefone, endereço, etc.
 */
export class FixCamposContratoIdnTaxaInscricao1785800000000 implements MigrationInterface {
    name = 'FixCamposContratoIdnTaxaInscricao1785800000000';

    private camposPadraoLibertyTreinamento(): object[] {
        return [
            {
                tipo: 'texto',
                campo: 'Nome Completo do Aluno',
                opcoes: [],
                descricao: 'Nome Completo do Responsável pelo Contrato',
            },
            {
                tipo: 'documento',
                campo: 'CPF/CNPJ do Aluno',
                opcoes: [],
                descricao: 'CPF ou CNPJ do Responsável pelo Contrato',
            },
            {
                tipo: 'data',
                campo: 'Data de Nascimento do Aluno',
                opcoes: [],
                descricao: 'Data de Nascimento do Responsável pelo Contrato',
            },
            {
                tipo: 'telefone',
                campo: 'WhatsApp do Aluno',
                opcoes: [],
                descricao: 'Telefone principal de preferência com WhatsApp  do Responsável pelo Contrato',
            },
            {
                tipo: 'email',
                campo: 'E-Mail do Aluno',
                opcoes: [],
                descricao: 'E-mail principal do Responsável pelo Contrato',
            },
            {
                tipo: 'texto',
                campo: 'Endereço do Aluno',
                opcoes: [],
                descricao: 'Endereço do Responsável pelo Contrato',
            },
            {
                tipo: 'texto',
                campo: 'Cidade/Estado do Aluno',
                opcoes: [],
                descricao: 'Cidade e Estado (UF) do Responsável pelo Contrato',
            },
            {
                tipo: 'cep',
                campo: 'CEP do Aluno',
                opcoes: [],
                descricao: 'CEP do Responsável pelo Contrato',
            },
            {
                tipo: 'texto',
                campo: 'Nome do Treinamento Contratado',
                opcoes: [],
                descricao: 'Nome do Treinamento Contratado pelo Aluno',
            },
            {
                tipo: 'texto',
                campo: 'Cidade do Treinamento',
                opcoes: [],
                descricao: 'Cidade do Treinamento Contratado pelo Aluno',
            },
            {
                tipo: 'data',
                campo: 'Data Prevista do Treinamento',
                opcoes: [],
                descricao: 'Data Prevista para Realização do Treinamento Contratado pelo Aluno',
            },
            {
                tipo: 'numero',
                campo: 'Preço do Treinamento',
                opcoes: [],
                descricao: 'Preço do Treinamento Contratado pelo Aluno',
            },
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
            {
                tipo: 'texto',
                campo: 'Observações',
                opcoes: [],
                descricao: 'Campo para inserção de observações relacionadas ao contrato',
            },
            {
                tipo: 'texto',
                campo: 'Local de Assinatura do Contrato',
                opcoes: [],
                descricao: 'Cidade e Estado (UF) de Assinatura do Contrato',
            },
            {
                tipo: 'data',
                campo: 'Data de Assinatura do Contrato',
                opcoes: [],
                descricao: 'Data de Assinatura do Contrato',
            },
            {
                tipo: 'texto',
                campo: 'Nome da Testemunha 1',
                opcoes: [],
                descricao: 'Nome da Testemunha 1 que assinará o Contrato',
            },
            {
                tipo: 'documento',
                campo: 'CPF/CNPJ da Testemunha 1',
                opcoes: [],
                descricao: 'CPF ou CNPJ da Testemunha 1 que assinará o Contrato',
            },
            {
                tipo: 'texto',
                campo: 'Nome da Testemunha 2',
                opcoes: [],
                descricao: 'Nome da Testemunha 2 que assinará o Contrato',
            },
            {
                tipo: 'documento',
                campo: 'CPF/CNPJ da Testemunha 2',
                opcoes: [],
                descricao: 'CPF ou CNPJ da Testemunha 2 que assinará o Contrato',
            },
        ];
    }

    public async up(queryRunner: QueryRunner): Promise<void> {
        const camposJson = JSON.stringify(this.camposPadraoLibertyTreinamento());

        const docs = await queryRunner.query(`
            SELECT id, versao, documento, tipo_documento, clausulas, campos_documento,
                   treinamentos_relacionados, atualizado_em, atualizado_por
            FROM documentos
            WHERE tipo_documento = 'CONTRATO'
              AND deletado_em IS NULL
              AND (
                LOWER(documento) LIKE '%imers%negoc%taxa%'
                OR LOWER(documento) LIKE '%idn%taxa%inscri%'
                OR documento ILIKE '%Imersão de Negócios (taxa%'
                OR documento ILIKE '%Imersao de Negocios (taxa%'
              )
        `);

        for (const d of docs) {
            const qtd = Array.isArray(d.campos_documento) ? d.campos_documento.length : 0;
            if (qtd > 0) {
                continue;
            }

            const jaArquivada = await queryRunner.query(
                `SELECT id FROM documentos_versoes WHERE id_documento = $1 AND versao = $2 LIMIT 1`,
                [d.id, d.versao],
            );
            if (!jaArquivada?.[0]?.id) {
                await queryRunner.query(
                    `
                    INSERT INTO documentos_versoes (
                        id_documento, versao, documento, tipo_documento, clausulas,
                        campos_documento, treinamentos_relacionados,
                        conteudo_alterado_em, conteudo_alterado_por,
                        criado_em, atualizado_em
                    ) VALUES (
                        $1, $2, $3, $4, $5,
                        $6::jsonb, $7::jsonb,
                        $8, $9,
                        NOW(), NOW()
                    )
                    `,
                    [
                        d.id,
                        d.versao,
                        d.documento,
                        d.tipo_documento,
                        d.clausulas,
                        JSON.stringify(d.campos_documento || []),
                        JSON.stringify(d.treinamentos_relacionados || []),
                        d.atualizado_em,
                        d.atualizado_por,
                    ],
                );
            }

            await queryRunner.query(
                `
                UPDATE documentos
                SET campos_documento = $2::jsonb,
                    versao = COALESCE(versao, 1) + 1,
                    atualizado_em = NOW()
                WHERE id = $1
                `,
                [d.id, camposJson],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE documentos
            SET campos_documento = '[]'::jsonb,
                atualizado_em = NOW()
            WHERE tipo_documento = 'CONTRATO'
              AND deletado_em IS NULL
              AND (
                LOWER(documento) LIKE '%imers%negoc%taxa%'
                OR LOWER(documento) LIKE '%idn%taxa%inscri%'
                OR documento ILIKE '%Imersão de Negócios (taxa%'
              )
        `);
    }
}
