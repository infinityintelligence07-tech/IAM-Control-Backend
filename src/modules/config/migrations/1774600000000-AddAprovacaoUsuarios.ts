import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAprovacaoUsuarios1774600000000 implements MigrationInterface {
    name = 'AddAprovacaoUsuarios1774600000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "usuarios" ADD COLUMN "aprovado" boolean`);
        await queryRunner.query(`ALTER TABLE "usuarios" ADD COLUMN "aprovado_em" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "usuarios" ADD COLUMN "aprovado_por" integer`);

        // Usuários já existentes são tratados como aprovados para evitar bloqueio após deploy.
        await queryRunner.query(`UPDATE "usuarios" SET "aprovado" = true, "aprovado_em" = now() WHERE "aprovado" IS NULL`);

        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "aprovado" SET DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "aprovado" SET NOT NULL`);
        await queryRunner.query(
            `ALTER TABLE "usuarios" ADD CONSTRAINT "fk_usuarios_aprovado_por" FOREIGN KEY ("aprovado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "usuarios" DROP CONSTRAINT "fk_usuarios_aprovado_por"`);
        await queryRunner.query(`ALTER TABLE "usuarios" DROP COLUMN "aprovado_por"`);
        await queryRunner.query(`ALTER TABLE "usuarios" DROP COLUMN "aprovado_em"`);
        await queryRunner.query(`ALTER TABLE "usuarios" DROP COLUMN "aprovado"`);
    }
}
