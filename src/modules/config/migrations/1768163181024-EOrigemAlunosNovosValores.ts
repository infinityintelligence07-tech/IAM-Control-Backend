import { MigrationInterface, QueryRunner } from 'typeorm';

export class EOrigemAlunosNovosValores1768163181024 implements MigrationInterface {
    name = 'EOrigemAlunosNovosValores1768163181024';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TYPE "public"."EOrigemAlunos" ADD VALUE IF NOT EXISTS 'ALUNO_CONVIDADO'`,
        );
        await queryRunner.query(
            `ALTER TYPE "public"."EOrigemAlunos" ADD VALUE IF NOT EXISTS 'TRANSFERENCIA'`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // PostgreSQL não permite remover valores de enum diretamente; deixar sem down.
    }
}
