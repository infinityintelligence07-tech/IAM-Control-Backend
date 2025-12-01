import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAlunoVinculadoFields1764102340826 implements MigrationInterface {
    name = 'AddAlunoVinculadoFields1764102340826';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Criar o enum para tipo de vínculo apenas se não existir
        await queryRunner.query(
            `DO $$ BEGIN
                CREATE TYPE "public"."ETipoVinculoAluno" AS ENUM('BONUS', 'CONVIDADO');
            EXCEPTION
                WHEN duplicate_object THEN null;
            END $$;`,
        );

        // Verificar se a coluna id_aluno_vinculado já existe antes de adicionar
        const columnExistsIdAlunoVinculado = await queryRunner.query(
            `SELECT column_name 
             FROM information_schema.columns 
             WHERE table_name='alunos' AND column_name='id_aluno_vinculado'`,
        );

        if (columnExistsIdAlunoVinculado.length === 0) {
            await queryRunner.query(
                `ALTER TABLE "alunos" ADD "id_aluno_vinculado" integer`,
            );
        }

        // Verificar se a coluna tipo_vinculo já existe antes de adicionar
        const columnExistsTipoVinculo = await queryRunner.query(
            `SELECT column_name 
             FROM information_schema.columns 
             WHERE table_name='alunos' AND column_name='tipo_vinculo'`,
        );

        if (columnExistsTipoVinculo.length === 0) {
            await queryRunner.query(
                `ALTER TABLE "alunos" ADD "tipo_vinculo" "public"."ETipoVinculoAluno"`,
            );
        }

        // Verificar se a coluna id_treinamento_bonus já existe antes de adicionar
        const columnExistsTreinamentoBonus = await queryRunner.query(
            `SELECT column_name 
             FROM information_schema.columns 
             WHERE table_name='alunos' AND column_name='id_treinamento_bonus'`,
        );

        if (columnExistsTreinamentoBonus.length === 0) {
            await queryRunner.query(
                `ALTER TABLE "alunos" ADD "id_treinamento_bonus" integer`,
            );
        }

        // Verificar se a constraint já existe antes de adicionar
        const constraintExists = await queryRunner.query(
            `SELECT constraint_name 
             FROM information_schema.table_constraints 
             WHERE table_name='alunos' AND constraint_name='FK_aluno_vinculado'`,
        );

        if (constraintExists.length === 0) {
            // Adicionar foreign key constraint para id_aluno_vinculado
            await queryRunner.query(
                `ALTER TABLE "alunos" ADD CONSTRAINT "FK_aluno_vinculado" FOREIGN KEY ("id_aluno_vinculado") REFERENCES "alunos"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Verificar e remover foreign key constraint se existir
        const constraintExists = await queryRunner.query(
            `SELECT constraint_name 
             FROM information_schema.table_constraints 
             WHERE table_name='alunos' AND constraint_name='FK_aluno_vinculado'`,
        );

        if (constraintExists.length > 0) {
            await queryRunner.query(
                `ALTER TABLE "alunos" DROP CONSTRAINT "FK_aluno_vinculado"`,
            );
        }

        // Verificar e remover colunas se existirem
        const columnExistsTreinamentoBonus = await queryRunner.query(
            `SELECT column_name 
             FROM information_schema.columns 
             WHERE table_name='alunos' AND column_name='id_treinamento_bonus'`,
        );

        if (columnExistsTreinamentoBonus.length > 0) {
            await queryRunner.query(
                `ALTER TABLE "alunos" DROP COLUMN "id_treinamento_bonus"`,
            );
        }

        const columnExistsTipoVinculo = await queryRunner.query(
            `SELECT column_name 
             FROM information_schema.columns 
             WHERE table_name='alunos' AND column_name='tipo_vinculo'`,
        );

        if (columnExistsTipoVinculo.length > 0) {
            await queryRunner.query(
                `ALTER TABLE "alunos" DROP COLUMN "tipo_vinculo"`,
            );
        }

        const columnExistsIdAlunoVinculado = await queryRunner.query(
            `SELECT column_name 
             FROM information_schema.columns 
             WHERE table_name='alunos' AND column_name='id_aluno_vinculado'`,
        );

        if (columnExistsIdAlunoVinculado.length > 0) {
            await queryRunner.query(
                `ALTER TABLE "alunos" DROP COLUMN "id_aluno_vinculado"`,
            );
        }

        // Verificar se o enum existe antes de remover
        const enumExists = await queryRunner.query(
            `SELECT typname 
             FROM pg_type 
             WHERE typname = 'ETipoVinculoAluno'`,
        );

        if (enumExists.length > 0) {
            await queryRunner.query(
                `DROP TYPE IF EXISTS "public"."ETipoVinculoAluno"`,
            );
        }
    }
}

