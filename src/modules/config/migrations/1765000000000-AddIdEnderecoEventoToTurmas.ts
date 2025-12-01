import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIdEnderecoEventoToTurmas1765000000000 implements MigrationInterface {
    name = 'AddIdEnderecoEventoToTurmas1765000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Verificar se a coluna já existe
        const table = await queryRunner.getTable('turmas');
        const columnExists = table?.findColumnByName('id_endereco_evento');

        if (!columnExists) {
            await queryRunner.query(`ALTER TABLE "turmas" ADD "id_endereco_evento" integer`);
        }

        // Verificar se a constraint já existe
        const constraintExists = table?.foreignKeys.find((fk) => fk.columnNames.includes('id_endereco_evento') && fk.referencedTableName === 'endereco_eventos');

        if (!constraintExists) {
            await queryRunner.query(
                `ALTER TABLE "turmas" ADD CONSTRAINT "FK_turmas_id_endereco_evento" FOREIGN KEY ("id_endereco_evento") REFERENCES "endereco_eventos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Verificar se a constraint existe antes de remover
        const table = await queryRunner.getTable('turmas');
        const constraintExists = table?.foreignKeys.find((fk) => fk.columnNames.includes('id_endereco_evento') && fk.referencedTableName === 'endereco_eventos');

        if (constraintExists) {
            await queryRunner.query(`ALTER TABLE "turmas" DROP CONSTRAINT "FK_turmas_id_endereco_evento"`);
        }

        // Verificar se a coluna existe antes de remover
        const columnExists = table?.findColumnByName('id_endereco_evento');
        if (columnExists) {
            await queryRunner.query(`ALTER TABLE "turmas" DROP COLUMN "id_endereco_evento"`);
        }
    }
}
