import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nomes de alunos passam a ser sempre em caixa alta em todo o sistema.
 * Backfill dos registros existentes (nome e nome_cracha); a partir daqui,
 * os services normalizam na escrita (nomeAlunoCaixaAlta).
 */
export class AlunosNomesCaixaAlta1776800000000 implements MigrationInterface {
    name = 'AlunosNomesCaixaAlta1776800000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`UPDATE "alunos" SET "nome" = UPPER("nome") WHERE "nome" IS NOT NULL AND "nome" <> UPPER("nome")`);
        await queryRunner.query(
            `UPDATE "alunos" SET "nome_cracha" = UPPER("nome_cracha") WHERE "nome_cracha" IS NOT NULL AND "nome_cracha" <> UPPER("nome_cracha")`,
        );
    }

    public async down(): Promise<void> {
        // Sem reversão: a capitalização original não é preservada.
    }
}
