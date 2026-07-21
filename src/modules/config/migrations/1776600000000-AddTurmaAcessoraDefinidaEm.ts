import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adiciona a coluna opcional `acessora_definida_em` em `turmas`, registrando
 * quando a acessora atual do Cuidado de Alunos foi definida (limpa ao remover
 * a acessora). Exibida na listagem de turmas e no modal "Definir Acessora".
 */
export class AddTurmaAcessoraDefinidaEm1776600000000 implements MigrationInterface {
    name = 'AddTurmaAcessoraDefinidaEm1776600000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" ADD COLUMN IF NOT EXISTS "acessora_definida_em" TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" DROP COLUMN IF EXISTS "acessora_definida_em"`);
    }
}
