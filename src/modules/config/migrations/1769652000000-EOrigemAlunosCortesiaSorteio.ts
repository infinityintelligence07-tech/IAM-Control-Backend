import { MigrationInterface, QueryRunner } from 'typeorm';

export class EOrigemAlunosCortesiaSorteio1769652000000 implements MigrationInterface {
    name = 'EOrigemAlunosCortesiaSorteio1769652000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."EOrigemAlunos" ADD VALUE IF NOT EXISTS 'CORTESIA'`);
        await queryRunner.query(`ALTER TYPE "public"."EOrigemAlunos" ADD VALUE IF NOT EXISTS 'SORTEIO'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // PostgreSQL nao permite remover valores de enum diretamente.
    }
}
