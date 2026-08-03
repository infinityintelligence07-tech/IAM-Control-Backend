import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Passa a coluna `token` de password_recovery_tokens de uuid para varchar(64),
 * que armazena o SHA-256 (hex) do token enviado por e-mail.
 *
 * Os registros existentes guardam tokens em claro e não podem ser convertidos —
 * são apagados. Efeito prático: links de recuperação emitidos antes do deploy
 * param de funcionar (validade era de 30 minutos).
 */
export class HashPasswordRecoveryTokens1785700000000 implements MigrationInterface {
    name = 'HashPasswordRecoveryTokens1785700000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "password_recovery_tokens"`);
        await queryRunner.query(`ALTER TABLE "password_recovery_tokens" ALTER COLUMN "token" TYPE varchar(64) USING "token"::text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM "password_recovery_tokens"`);
        await queryRunner.query(`ALTER TABLE "password_recovery_tokens" ALTER COLUMN "token" TYPE uuid USING "token"::uuid`);
    }
}
