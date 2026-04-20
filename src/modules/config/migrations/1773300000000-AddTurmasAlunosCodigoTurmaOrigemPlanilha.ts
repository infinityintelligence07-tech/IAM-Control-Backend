import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTurmasAlunosCodigoTurmaOrigemPlanilha1773300000000 implements MigrationInterface {
    name = 'AddTurmasAlunosCodigoTurmaOrigemPlanilha1773300000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "turmas_alunos" ADD "codigo_turma_origem_planilha" character varying(255)`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos" DROP COLUMN "codigo_turma_origem_planilha"`);
    }
}
