import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAguardandoLiberacaoStatus1764738521274 implements MigrationInterface {
    name = 'AddAguardandoLiberacaoStatus1764738521274'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Verificar se o valor já existe no enum antes de adicionar
        const enumValues = await queryRunner.query(`
            SELECT enumlabel 
            FROM pg_enum 
            WHERE enumtypid = (
                SELECT oid 
                FROM pg_type 
                WHERE typname = 'EStatusTurmas'
            ) AND enumlabel = 'AGUARDANDO_LIBERACAO'
        `);

        // Adicionar novo valor ao enum EStatusTurmas apenas se não existir
        if (enumValues.length === 0) {
            await queryRunner.query(`ALTER TYPE "public"."EStatusTurmas" ADD VALUE 'AGUARDANDO_LIBERACAO'`);
        }
        
        // Alterar o default da coluna status_turma para AGUARDANDO_LIBERACAO
        await queryRunner.query(`ALTER TABLE "turmas" ALTER COLUMN "status_turma" SET DEFAULT 'AGUARDANDO_LIBERACAO'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Reverter o default para INSCRICOES_ABERTAS
        await queryRunner.query(`ALTER TABLE "turmas" ALTER COLUMN "status_turma" SET DEFAULT 'INSCRICOES_ABERTAS'`);
        
        // Nota: Não é possível remover um valor de um enum em PostgreSQL sem recriar o tipo
        // Por isso, apenas revertemos o default. O valor permanecerá no enum.
    }
}

