import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Valor (R$) da taxa de inscrição do IPR vendido com origem na masterclass
 * (por cidade/dia). NULL = usar o padrão de /configuracoes
 * (chave taxa_inscricao_ipr_masterclass).
 */
export class AddTurmasTaxaInscricaoMasterclass1785283200000 implements MigrationInterface {
    name = 'AddTurmasTaxaInscricaoMasterclass1785283200000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" ADD COLUMN IF NOT EXISTS "taxa_inscricao_masterclass" numeric(12,2)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" DROP COLUMN IF EXISTS "taxa_inscricao_masterclass"`);
    }
}
