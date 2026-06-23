import { MigrationInterface, QueryRunner } from 'typeorm';

export class EOrigemAlunosPresente1775600000000 implements MigrationInterface {
    name = 'EOrigemAlunosPresente1775600000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."EOrigemAlunos" ADD VALUE IF NOT EXISTS 'PRESENTE'`);
    }

    public async down(): Promise<void> {
        // PostgreSQL nao permite remover valores de enum diretamente.
    }
}
