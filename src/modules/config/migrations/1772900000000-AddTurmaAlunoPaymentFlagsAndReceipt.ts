import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTurmaAlunoPaymentFlagsAndReceipt1772900000000 implements MigrationInterface {
    name = 'AddTurmaAlunoPaymentFlagsAndReceipt1772900000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos" ADD "pendencia_pagamento" boolean`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" ADD "contrato_duplo" boolean`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" ADD "comprovante_pagamento_base64" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos" DROP COLUMN "comprovante_pagamento_base64"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" DROP COLUMN "contrato_duplo"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" DROP COLUMN "pendencia_pagamento"`);
    }
}
