import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStatusAlunosGeralCancelamento1786200000000 implements MigrationInterface {
    name = 'AddStatusAlunosGeralCancelamento1786200000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TYPE "public"."EStatusAlunosGeral" ADD VALUE IF NOT EXISTS 'CANCELAMENTO_SOLICITADO'`,
        );
        await queryRunner.query(
            `ALTER TYPE "public"."EStatusAlunosGeral" ADD VALUE IF NOT EXISTS 'CONTRATO_CANCELADO'`,
        );
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // Postgres não remove valores de ENUM com segurança; down intencional vazio.
    }
}
