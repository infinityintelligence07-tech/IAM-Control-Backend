import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adiciona a coluna opcional `id_acessor` em `turmas_alunos`, referenciando o
 * usuário (tabela `usuarios`) responsável por acompanhar aquele aluno. Na
 * regra de negócio, o acessor só é definido para alunos que entraram por boleto.
 * A FK é gerenciada pela relação ManyToOne da entity (synchronize); aqui apenas
 * garantimos a existência da coluna em ambientes sem synchronize.
 */
export class AddTurmaAlunoAcessor1775300000000 implements MigrationInterface {
    name = 'AddTurmaAlunoAcessor1775300000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos" ADD COLUMN IF NOT EXISTS "id_acessor" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos" DROP COLUMN IF EXISTS "id_acessor"`);
    }
}
