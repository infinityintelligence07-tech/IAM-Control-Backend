import { MigrationInterface, QueryRunner } from 'typeorm';

export class EStatusAlunosTurmasConfirmacao1768163181025 implements MigrationInterface {
    name = 'EStatusAlunosTurmasConfirmacao1768163181025';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Só adiciona os novos valores ao enum. O UPDATE deve rodar em outra migration
        // (PostgreSQL: "New enum values must be committed before they can be used").
        await queryRunner.query(`ALTER TYPE "public"."EStatusAlunosTurmas" ADD VALUE IF NOT EXISTS 'AGUARDANDO_CONFIRMACAO'`);
        await queryRunner.query(`ALTER TYPE "public"."EStatusAlunosTurmas" ADD VALUE IF NOT EXISTS 'FALTA_ENVIAR_LINK_CONFIRMACAO'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // PostgreSQL não permite remover valores de enum de forma simples
    }
}
