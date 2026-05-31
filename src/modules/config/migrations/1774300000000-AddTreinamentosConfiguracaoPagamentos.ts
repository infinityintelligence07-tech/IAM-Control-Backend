import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTreinamentosConfiguracaoPagamentos1774300000000 implements MigrationInterface {
    name = 'AddTreinamentosConfiguracaoPagamentos1774300000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "treinamentos"
            ADD COLUMN IF NOT EXISTS "configuracao_pagamentos" jsonb
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "treinamentos"
            DROP COLUMN IF EXISTS "configuracao_pagamentos"
        `);
    }
}
