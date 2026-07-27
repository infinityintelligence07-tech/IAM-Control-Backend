import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Garante que as mentorias Liberty Begin e Liberty (Mentoria Liberty) estejam:
 * - marcadas como `tipo_mentoria = true`
 * - vinculadas à empresa Liberty
 * - com duração correta (Begin = 6 meses, Liberty = 12 meses)
 *
 * Necessário para aparecerem no formulário de criação de turmas na área Liberty.
 */
export class EnsureLibertyMentoriasTipoEEmpresa1777500000000
    implements MigrationInterface
{
    name = 'EnsureLibertyMentoriasTipoEEmpresa1777500000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            INSERT INTO "empresas" ("nome", "sigla")
            VALUES ('IAM', 'IAM'), ('Liberty', 'LIB')
            ON CONFLICT ("nome") DO NOTHING
        `);

        const nomeNorm = `
            LOWER(TRANSLATE(
                t."treinamento",
                'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'
            ))
        `;

        // Liberty Begin
        await queryRunner.query(`
            UPDATE "treinamentos" t
            SET
                "tipo_mentoria" = true,
                "duracao_meses" = 6,
                "id_empresa" = (SELECT e."id" FROM "empresas" e WHERE e."nome" = 'Liberty' LIMIT 1)
            WHERE t."deletado_em" IS NULL
              AND ${nomeNorm} LIKE '%liberty begin%'
        `);

        // Mentoria Liberty / produto "Liberty" (sem Begin / Legacy / Imersão)
        await queryRunner.query(`
            UPDATE "treinamentos" t
            SET
                "tipo_mentoria" = true,
                "duracao_meses" = COALESCE(t."duracao_meses", 12),
                "id_empresa" = (SELECT e."id" FROM "empresas" e WHERE e."nome" = 'Liberty' LIMIT 1)
            WHERE t."deletado_em" IS NULL
              AND (
                ${nomeNorm} LIKE '%mentoria liberty%'
                OR ${nomeNorm} = 'liberty'
                OR (
                    ${nomeNorm} LIKE '%liberty%'
                    AND ${nomeNorm} NOT LIKE '%liberty begin%'
                    AND ${nomeNorm} NOT LIKE '%legacy%'
                    AND ${nomeNorm} NOT LIKE '%imersao%'
                    AND t."tipo_mentoria" = true
                )
              )
        `);
    }

    public async down(): Promise<void> {
        // Não reverte flags de negócio já aplicadas em produção.
    }
}
