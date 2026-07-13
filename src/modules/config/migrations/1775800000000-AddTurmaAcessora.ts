import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adiciona a coluna opcional `id_acessora` em `turmas`, referenciando a usuária
 * do Cuidado de Alunos responsável pela turma. Quando definida, somente ela
 * (além de administradores) pode adicionar/remover alunos da turma — exceto as
 * inserções feitas pelo fluxo de vendas/bônus. A FK é gerenciada pela relação
 * ManyToOne da entity (synchronize); aqui apenas garantimos a existência da
 * coluna em ambientes sem synchronize.
 */
export class AddTurmaAcessora1775800000000 implements MigrationInterface {
    name = 'AddTurmaAcessora1775800000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" ADD COLUMN IF NOT EXISTS "id_acessora" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" DROP COLUMN IF EXISTS "id_acessora"`);
    }
}
