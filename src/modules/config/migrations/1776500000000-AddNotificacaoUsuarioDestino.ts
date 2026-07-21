import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Permite direcionar uma notificação a um USUÁRIO específico (além do setor).
 * Usado nas mudanças de venda (exclusão/atualização), que devem aparecer apenas
 * para a líder do Cuidado de Alunos e para a acessora da turma de destino — e
 * não para todo o setor. Idempotente (synchronize também cria no boot).
 */
export class AddNotificacaoUsuarioDestino1776500000000 implements MigrationInterface {
    name = 'AddNotificacaoUsuarioDestino1776500000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "notificacoes" ADD COLUMN IF NOT EXISTS "id_usuario_destino" integer`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_notificacoes_usuario_destino" ON "notificacoes" ("id_usuario_destino")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_notificacoes_usuario_destino"`);
        await queryRunner.query(`ALTER TABLE "notificacoes" DROP COLUMN IF EXISTS "id_usuario_destino"`);
    }
}
