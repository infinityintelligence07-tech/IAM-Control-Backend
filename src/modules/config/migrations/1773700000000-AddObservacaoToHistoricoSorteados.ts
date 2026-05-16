import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddObservacaoToHistoricoSorteados1773700000000 implements MigrationInterface {
    name = 'AddObservacaoToHistoricoSorteados1773700000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "historico_sorteados"
            ADD COLUMN "observacao" text
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "historico_sorteados"
            DROP COLUMN "observacao"
        `);
    }
}
