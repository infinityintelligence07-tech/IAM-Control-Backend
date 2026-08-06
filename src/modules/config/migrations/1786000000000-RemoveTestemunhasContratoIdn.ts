import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove campos de testemunha do modelo de contrato Liberty - Imersão de
 * Negócios (taxa inscrição). O perfil IMERSAO_NEGOCIOS passou a
 * showTestemunhas=false: o layout e o ZapSign não usam mais testemunhas.
 */
export class RemoveTestemunhasContratoIdn1786000000000 implements MigrationInterface {
    name = 'RemoveTestemunhasContratoIdn1786000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE documentos
            SET campos_documento = COALESCE((
                SELECT jsonb_agg(campo)
                FROM jsonb_array_elements(COALESCE(campos_documento, '[]'::jsonb)) AS campo
                WHERE LOWER(COALESCE(campo->>'campo', '')) NOT LIKE '%testemunha%'
            ), '[]'::jsonb),
                atualizado_em = NOW()
            WHERE tipo_documento = 'CONTRATO'
              AND deletado_em IS NULL
              AND (
                documento ILIKE '%Imersão de Negócios%'
                OR documento ILIKE '%Imersao de Negocios%'
                OR LOWER(documento) LIKE '%idn%taxa%inscri%'
                OR LOWER(documento) LIKE '%liberty%imers%negoc%'
              )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Reinsere os 4 campos de testemunha no final do array, se ainda não existirem.
        await queryRunner.query(`
            UPDATE documentos
            SET campos_documento = COALESCE(campos_documento, '[]'::jsonb)
                || jsonb_build_array(
                    jsonb_build_object(
                        'tipo', 'texto',
                        'campo', 'Nome da Testemunha 1',
                        'opcoes', '[]'::jsonb,
                        'descricao', 'Nome da Testemunha 1 que assinará o Contrato'
                    ),
                    jsonb_build_object(
                        'tipo', 'documento',
                        'campo', 'CPF/CNPJ da Testemunha 1',
                        'opcoes', '[]'::jsonb,
                        'descricao', 'CPF ou CNPJ da Testemunha 1 que assinará o Contrato'
                    ),
                    jsonb_build_object(
                        'tipo', 'texto',
                        'campo', 'Nome da Testemunha 2',
                        'opcoes', '[]'::jsonb,
                        'descricao', 'Nome da Testemunha 2 que assinará o Contrato'
                    ),
                    jsonb_build_object(
                        'tipo', 'documento',
                        'campo', 'CPF/CNPJ da Testemunha 2',
                        'opcoes', '[]'::jsonb,
                        'descricao', 'CPF ou CNPJ da Testemunha 2 que assinará o Contrato'
                    )
                ),
                atualizado_em = NOW()
            WHERE tipo_documento = 'CONTRATO'
              AND deletado_em IS NULL
              AND (
                documento ILIKE '%Imersão de Negócios%'
                OR documento ILIKE '%Imersao de Negocios%'
                OR LOWER(documento) LIKE '%idn%taxa%inscri%'
                OR LOWER(documento) LIKE '%liberty%imers%negoc%'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(campos_documento, '[]'::jsonb)) AS campo
                WHERE LOWER(COALESCE(campo->>'campo', '')) LIKE '%testemunha%'
              )
        `);
    }
}
