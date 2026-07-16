import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adiciona em `turmas_alunos` as colunas de forma de pagamento MANUAL (negociação
 * extra sistema), usadas quando o aluno não tem contrato/venda que resolva a forma
 * de pagamento ("Forma de pagamento indisponível"):
 *  - forma_pagamento_manual: código EFormasPagamento escolhido pelo usuário;
 *  - boleto_dia_vencimento_manual / boleto_quantidade_manual: detalhes quando BOLETO.
 * Em ambientes com synchronize as colunas também são criadas pelo TypeORM.
 */
export class AddTurmaAlunoFormaPagamentoManual1776200000000 implements MigrationInterface {
    name = 'AddTurmaAlunoFormaPagamentoManual1776200000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos" ADD COLUMN IF NOT EXISTS "forma_pagamento_manual" character varying(30)`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" ADD COLUMN IF NOT EXISTS "boleto_dia_vencimento_manual" integer`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" ADD COLUMN IF NOT EXISTS "boleto_quantidade_manual" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos" DROP COLUMN IF EXISTS "boleto_quantidade_manual"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" DROP COLUMN IF EXISTS "boleto_dia_vencimento_manual"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" DROP COLUMN IF EXISTS "forma_pagamento_manual"`);
    }
}
