import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContratoComprovantesPagamento1772900000001 implements MigrationInterface {
    name = 'AddContratoComprovantesPagamento1772900000001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" ADD "comprovantes_pagamento" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" DROP COLUMN "comprovantes_pagamento"`);
    }
}
