import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTurmasUrlPagamentoCartao1769652600000 implements MigrationInterface {
    name = 'AddTurmasUrlPagamentoCartao1769652600000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" ADD COLUMN IF NOT EXISTS "url_pagamento_cartao" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" DROP COLUMN IF EXISTS "url_pagamento_cartao"`);
    }
}
