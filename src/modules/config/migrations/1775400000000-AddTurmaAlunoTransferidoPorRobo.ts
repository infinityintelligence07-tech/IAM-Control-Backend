import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adiciona a coluna `transferido_por_robo` em `turmas_alunos`. Ela marca a matrícula
 * gerada por uma transferência AUTOMÁTICA do robô (auto-transferência de no-show de
 * ingresso comprado quando a turma de origem é congelada), permitindo exibir o ícone
 * de "Transferido por robô" ao lado do nome do aluno na listagem da turma.
 */
export class AddTurmaAlunoTransferidoPorRobo1775400000000 implements MigrationInterface {
    name = 'AddTurmaAlunoTransferidoPorRobo1775400000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "turmas_alunos" ADD COLUMN IF NOT EXISTS "transferido_por_robo" boolean NOT NULL DEFAULT false`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos" DROP COLUMN IF EXISTS "transferido_por_robo"`);
    }
}
