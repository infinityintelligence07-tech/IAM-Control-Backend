import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Garante 3 modelos de contrato para Imersão Prosperar (IPR), alinhados aos
 * Google Docs oficiais:
 *
 * - Time de Vendas (taxa inscrição): 1acWd6rUvpTk8QQHNMpAFE9hsricNpVwA
 * - MasterClass e Eventos (padrão): 1HjjOyKtmICd2FD-tY-PHFzrNgxxkFDNx
 * - MasterClass Versão Link (exceção): 1rEZuCbn5uImgvCQKWojGGldkS28EShq8
 *
 * Vincula todos aos treinamentos cujo nome contém "prosperar" ou "ipr".
 * Renomeia o documento legado "Contrato do IPR" para o nome do padrão MC/Eventos.
 */
export class SeedContratosIprTresVariantes1777000000000
    implements MigrationInterface
{
    name = 'SeedContratosIprTresVariantes1777000000000';

    private readonly nomes = {
        TIME_VENDAS: 'Contrato IPR - Time de Vendas (taxa inscrição)',
        MC_EVENTOS: 'Contrato IPR - MasterClass e Eventos',
        MC_LINK: 'Contrato IPR - MasterClass Versão Link',
    } as const;

    private clausulasTimeVendas(): string {
        return [
            'Cláusula 1ª: O presente contrato é realizado online entre o ALUNO(A) (devidamente qualificado na ficha de inscrição) e o Instituto Academy Mind Treinamentos LTDA, pessoa jurídica devidamente inscrita no CNPJ nº 03.727.532/0001-13, com sede na Rua Major Rehder, nº 248 - Vila Rehder, Americana - SP, CEP 13465-390, doravante denominada IAM.',
            'Cláusula 2ª: O(A) aluno(a) está ciente de que por mera liberalidade a IAM cobrará apenas a taxa de matrícula/inscrição para o treinamento descrito acima.',
            'Parágrafo primeiro: Sendo que o(a) aluno(a) se encontra devidamente inscrito na turma a partir da assinatura do presente contrato.',
            'Cláusula 3ª: Por ser uma oferta feita exclusiva e com condição comercial abaixo do praticado, não será possível o cancelamento, estorno ou remarcação/alteração de data do treinamento por solicitação do aluno, estando o mesmo ciente e de acordo com o descrito.',
            'Cláusula 4ª: O(A) aluno(a) autoriza o uso de sua voz e imagem captados durante o evento para fins institucionais e publicitários.',
            'Cláusula 5ª: A data e local do treinamento são uma previsão de realização, podendo serem alterados pela IAM, contudo a comunicação qualquer alteração ocorrerá com antecedência via telefone/whatsapp ou e-mail nos dados informados. O ALUNO(a) se responsabiliza por sempre manter seus dados atualizados e comunicar quaisquer alterações.',
        ].join('\n\n');
    }

    private clausulasMcEventos(): string {
        return [
            'Cláusula 1ª: O presente contrato é realizado presencialmente entre o ALUNO (devidamente qualificado na ficha de inscrição) e o Instituto Academy Mind Treinamentos LTDA, pessoa jurídica devidamente inscrita no CNPJ nº 03.727.532/0001-13, com sede na Rua Major Rehder, nº 245 - Vila Rehder, Americana - SP, CEP 13465-390, doravante denominada IAM.',
            'Cláusula 2ª: Por ser uma oferta feita exclusiva e com condição comercial abaixo do praticado, não será possível o cancelamento, estorno, estando o mesmo ciente e de acordo com o descrito.',
            'Cláusula 3ª: A troca de turma poderá ser solicitada até 30 dias antes da data prevista para realização do treinamento, desde que haja disponibilidade e viabilidade na nova turma escolhida para efetivação da transferência.',
            'Parágrafo único: Será permitido o ALUNO(a) trocar de turma 01 (uma) vez e nessa troca haverá a cobrança de 10% do total da inscrição que for solicitada troca pelo ALUNO(a) a título de taxa administrativa, sendo isenta apenas a primeira troca.',
            'Cláusula 4ª: O(A) aluno(a) autoriza o uso de sua voz e imagem captados durante o evento para fins institucionais e publicitários.',
            'Cláusula 5ª: A data e local do treinamento são uma previsão de realização, podendo serem alterados, contudo a comunicação qualquer alteração ocorrerá com antecedência via telefone/whatsapp ou e-mail nos dados informados na ficha de inscrição. O ALUNO(a) se responsabiliza por sempre manter seus dados atualizados e comunicar quaisquer alterações.',
        ].join('\n\n');
    }

    private clausulasMcLink(): string {
        return [
            'Cláusula 1ª: O presente contrato é realizado presencialmente entre o ALUNO (devidamente qualificado na ficha de inscrição) e o Instituto Academy Mind Treinamentos LTDA, pessoa jurídica devidamente inscrita no CNPJ nº 03.727.532/0001-13, com sede na Rua São Gabriel, nº 1.175 - Vila Belvedere, Americana - SP, CEP 13472-170, doravante denominada ACADEMY.',
            'Cláusula 2ª: O cancelamento da presente inscrição acarretará multa de 20% incidente sobre o preço total pago, que será descontado a título de despesas iniciais e taxas administrativas.',
            'Parágrafo único: Não serão aceitos pedidos de cancelamento com menos de 15 dias da data contratada e escrita neste contrato, sem que haja futuramente qualquer possibilidade de cancelamento.',
            'Cláusula 3ª: A troca de turma poderá ser solicitada até 30 dias antes da data prevista para realização do treinamento, desde que haja disponibilidade e viabilidade na nova turma escolhida para efetivação da transferência.',
            'Parágrafo único: Será permitido o ALUNO(a) trocar de turma 01 (uma) vez e nessa troca haverá a cobrança de 10% do total da inscrição que for solicitada troca pelo ALUNO(a) a título de taxa administrativa, sendo isenta apenas a primeira troca.',
            'Cláusula 4ª: O(A) aluno(a) autoriza o uso de sua voz e imagem captados durante o evento para fins institucionais e publicitários.',
            'Cláusula 5ª: A data e local do treinamento são uma previsão de realização, podendo serem alterados, contudo a comunicação qualquer alteração ocorrerá com antecedência via telefone/whatsapp ou e-mail nos dados informados na ficha de inscrição. O ALUNO(a) se responsabiliza por sempre manter seus dados atualizados e comunicar quaisquer alterações.',
            'Local: AMERICANA-SP (CONTRATO ACEITO DIGITALMENTE POR MEIO DE LINK).',
            'Declaro que ao comprar pelo link concordei com todas as cláusulas deste contrato, valendo plenamente todas elas, às quais dou por firme, certo e valioso, por meio do aceite.',
        ].join('\n\n');
    }

    public async up(queryRunner: QueryRunner): Promise<void> {
        const iprIdsResult = await queryRunner.query(`
            SELECT array_agg(id ORDER BY id) AS ids
            FROM treinamentos
            WHERE deletado_em IS NULL
              AND (
                LOWER(treinamento) LIKE '%prosperar%'
                OR LOWER(treinamento) LIKE '%ipr%'
                OR LOWER(COALESCE(sigla_treinamento, '')) = 'ipr'
              )
        `);
        const ids: number[] = iprIdsResult?.[0]?.ids || [];
        if (!ids.length) {
            return;
        }
        const idsJson = JSON.stringify(ids);

        // Documento legado → variante MC/Eventos (já usado como padrão).
        await queryRunner.query(
            `
            UPDATE documentos
            SET documento = $1,
                treinamentos_relacionados = $2::jsonb,
                atualizado_em = NOW()
            WHERE tipo_documento = 'CONTRATO'
              AND deletado_em IS NULL
              AND documento = 'Contrato do IPR'
            `,
            [this.nomes.MC_EVENTOS, idsJson],
        );

        // Aplica/atualiza os 3 modelos com o texto dos Google Docs oficiais.
        await this.upsertDocumento(
            queryRunner,
            this.nomes.MC_EVENTOS,
            this.clausulasMcEventos(),
            idsJson,
        );
        await this.upsertDocumento(
            queryRunner,
            this.nomes.TIME_VENDAS,
            this.clausulasTimeVendas(),
            idsJson,
        );
        await this.upsertDocumento(
            queryRunner,
            this.nomes.MC_LINK,
            this.clausulasMcLink(),
            idsJson,
        );
    }

    private async upsertDocumento(
        queryRunner: QueryRunner,
        nome: string,
        clausulas: string,
        idsJson: string,
    ): Promise<void> {
        const existing = await queryRunner.query(
            `
            SELECT id FROM documentos
            WHERE tipo_documento = 'CONTRATO'
              AND deletado_em IS NULL
              AND documento = $1
            LIMIT 1
            `,
            [nome],
        );

        if (existing?.[0]?.id) {
            await queryRunner.query(
                `
                UPDATE documentos
                SET clausulas = $2,
                    treinamentos_relacionados = $3::jsonb,
                    atualizado_em = NOW()
                WHERE id = $1
                `,
                [existing[0].id, clausulas, idsJson],
            );
            return;
        }

        await queryRunner.query(
            `
            INSERT INTO documentos (
                documento,
                tipo_documento,
                clausulas,
                campos_documento,
                treinamentos_relacionados,
                versao,
                criado_em,
                atualizado_em
            ) VALUES (
                $1,
                'CONTRATO',
                $2,
                '[]'::jsonb,
                $3::jsonb,
                1,
                NOW(),
                NOW()
            )
            `,
            [nome, clausulas, idsJson],
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `
            UPDATE documentos
            SET documento = 'Contrato do IPR',
                atualizado_em = NOW()
            WHERE documento = $1
              AND tipo_documento = 'CONTRATO'
              AND deletado_em IS NULL
            `,
            [this.nomes.MC_EVENTOS],
        );

        await queryRunner.query(
            `
            UPDATE documentos
            SET deletado_em = NOW(),
                atualizado_em = NOW()
            WHERE tipo_documento = 'CONTRATO'
              AND documento IN ($1, $2)
              AND deletado_em IS NULL
            `,
            [this.nomes.TIME_VENDAS, this.nomes.MC_LINK],
        );
    }
}
