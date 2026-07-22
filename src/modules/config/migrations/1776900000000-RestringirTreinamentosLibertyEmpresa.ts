import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Refina o vínculo treinamento→empresa Liberty.
 *
 * A seed inicial (177630…) também vinculou Mesa de Destino, Porsche e Líder XP
 * à Liberty. A visualização por empresa Liberty deve listar apenas:
 * - produtos com "liberty" no nome (ex.: Mentoria Liberty, Liberty Begin)
 * - Legacy XP
 * - Imersão de Negócios
 *
 * Demais treinamentos que estavam em Liberty passam para IAM.
 * Operações idempotentes (podem rodar em ambientes já corrigidos).
 */
export class RestringirTreinamentosLibertyEmpresa1776900000000
    implements MigrationInterface
{
    name = 'RestringirTreinamentosLibertyEmpresa1776900000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Garante empresas base (não sobrescreve se já existirem).
        await queryRunner.query(`
            INSERT INTO "empresas" ("nome", "sigla")
            VALUES ('IAM', 'IAM'), ('Liberty', 'LIB')
            ON CONFLICT ("nome") DO NOTHING
        `);

        // Expressão de nome normalizado (sem acento, lower) — mesma ideia da seed.
        const nomeNorm = `
            LOWER(TRANSLATE(
                t."treinamento",
                'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'
            ))
        `;

        const isLibertyProduto = `
            (
                ${nomeNorm} LIKE '%liberty%'
                OR ${nomeNorm} LIKE '%legacy xp%'
                OR ${nomeNorm} LIKE '%imersao de negocios%'
            )
        `;

        // Garante vínculo Liberty nos produtos da lista desejada.
        await queryRunner.query(`
            UPDATE "treinamentos" t
            SET "id_empresa" = (SELECT e."id" FROM "empresas" e WHERE e."nome" = 'Liberty' LIMIT 1)
            WHERE ${isLibertyProduto}
        `);

        // Remove da Liberty o que não é da lista (Mesa / Porsche / Líder XP / leftovers).
        await queryRunner.query(`
            UPDATE "treinamentos" t
            SET "id_empresa" = (SELECT e."id" FROM "empresas" e WHERE e."nome" = 'IAM' LIMIT 1)
            WHERE t."id_empresa" = (SELECT e."id" FROM "empresas" e WHERE e."nome" = 'Liberty' LIMIT 1)
              AND NOT ${isLibertyProduto}
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Restaura a heurística ampla da seed original (só o que estava em IAM e casa
        // com os padrões extras; não move de volta produtos Liberty “corretos”).
        await queryRunner.query(`
            UPDATE "treinamentos" t
            SET "id_empresa" = (SELECT e."id" FROM "empresas" e WHERE e."nome" = 'Liberty' LIMIT 1)
            WHERE t."id_empresa" = (SELECT e."id" FROM "empresas" e WHERE e."nome" = 'IAM' LIMIT 1)
              AND (
                LOWER(TRANSLATE(
                    t."treinamento",
                    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'
                )) LIKE ANY (ARRAY[
                    '%mesa de destino%',
                    '%porsche%',
                    '%lider xp%'
                ])
              )
        `);
    }
}
