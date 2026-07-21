import { BadRequestException, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { ESetores } from '../../config/entities/enum';
import { ConfiguracoesResponseDto, UpdateConfiguracoesDto } from './dto/configuracoes.dto';
import { userHasSetor } from '@/common/utils/setor.util';

/**
 * Chaves de configuração conhecidas e seus valores padrão de fallback.
 *
 * Os valores padrão são usados quando ainda não há registro no banco, garantindo
 * que o sistema funcione mesmo antes da primeira configuração pela tela.
 */
export const CONFIG_KEYS = {
    TESTEMUNHA_EMAIL_PADRAO: 'testemunha_email_padrao',
    TESTEMUNHA_TELEFONE_PADRAO: 'testemunha_telefone_padrao',
    ASSESSORES_CUIDADO_ALUNOS: 'assessores_cuidado_alunos',
    ASSESSORES_FINANCEIROS: 'assessores_financeiros',
    FINANCEIRO_NOTIFICACOES_VENDAS: 'financeiro_notificacoes_vendas_usuario',
    // Taxas (%) das formas de recebimento, usadas no cálculo da liquidez.
    TAXA_BOLETO_PERCENTUAL: 'taxa_boleto_percentual',
    TAXA_CARTAO_CREDITO_PERCENTUAL: 'taxa_cartao_credito_percentual',
    TAXA_CARTAO_DEBITO_PERCENTUAL: 'taxa_cartao_debito_percentual',
    TAXA_PIX_PERCENTUAL: 'taxa_pix_percentual',
    // Percentual usado no cálculo da comissão sobre as vendas.
    COMISSAO_PERCENTUAL: 'comissao_percentual',
} as const;

/** Chaves cujo valor é um percentual (0 a 100, aceita decimais). */
export const CONFIG_KEYS_PERCENTUAIS: string[] = [
    CONFIG_KEYS.TAXA_BOLETO_PERCENTUAL,
    CONFIG_KEYS.TAXA_CARTAO_CREDITO_PERCENTUAL,
    CONFIG_KEYS.TAXA_CARTAO_DEBITO_PERCENTUAL,
    CONFIG_KEYS.TAXA_PIX_PERCENTUAL,
    CONFIG_KEYS.COMISSAO_PERCENTUAL,
];

/** Defaults dos acessores financeiros (Peterson, Luana, Elaine). */
export const DEFAULT_ASSESSORES_FINANCEIROS_IDS = [334, 171, 84];

export const CONFIG_DEFAULTS: Record<string, string> = {
    [CONFIG_KEYS.TESTEMUNHA_EMAIL_PADRAO]: 'contato@iamtreinamentos.com.br',
    [CONFIG_KEYS.TESTEMUNHA_TELEFONE_PADRAO]: '(19) 98317-3941',
    [CONFIG_KEYS.ASSESSORES_CUIDADO_ALUNOS]: '[]',
    [CONFIG_KEYS.ASSESSORES_FINANCEIROS]: JSON.stringify(DEFAULT_ASSESSORES_FINANCEIROS_IDS),
    // Pessoa do FINANCEIRO que recebe as notificações de mudanças de venda
    // (exclusão/atualização de contrato no Histórico de Vendas). Vazio = ninguém.
    [CONFIG_KEYS.FINANCEIRO_NOTIFICACOES_VENDAS]: '',
    // Taxas e comissão em percentual ("2.99" = 2,99%). Zero = sem desconto.
    [CONFIG_KEYS.TAXA_BOLETO_PERCENTUAL]: '0',
    [CONFIG_KEYS.TAXA_CARTAO_CREDITO_PERCENTUAL]: '0',
    [CONFIG_KEYS.TAXA_CARTAO_DEBITO_PERCENTUAL]: '0',
    [CONFIG_KEYS.TAXA_PIX_PERCENTUAL]: '0',
    [CONFIG_KEYS.COMISSAO_PERCENTUAL]: '0',
};

@Injectable()
export class ConfiguracoesService {
    constructor(private readonly uow: UnitOfWorkService) {}

    /** Converte valor JSON de lista de IDs (`"[1,2]"`) em array de números únicos. */
    parseIdsJson(valor: string | null | undefined): number[] {
        if (valor == null || String(valor).trim() === '') return [];
        try {
            const parsed: unknown = JSON.parse(String(valor));
            if (!Array.isArray(parsed)) return [];
            const ids = parsed.map((item) => Number(item)).filter((id) => Number.isInteger(id) && id > 0);
            return Array.from(new Set(ids));
        } catch {
            return [];
        }
    }

    async getAssessoresCuidadoAlunosIds(): Promise<number[]> {
        const config = await this.findAll();
        return this.parseIdsJson(config[CONFIG_KEYS.ASSESSORES_CUIDADO_ALUNOS]);
    }

    async getAssessoresFinanceirosIds(): Promise<number[]> {
        const config = await this.findAll();
        const ids = this.parseIdsJson(config[CONFIG_KEYS.ASSESSORES_FINANCEIROS]);
        // Se a chave existir vazia no banco, ainda assim usamos o default de negócio.
        if (ids.length === 0) {
            return [...DEFAULT_ASSESSORES_FINANCEIROS_IDS];
        }
        return ids;
    }

    /**
     * Id do usuário do FINANCEIRO configurado para receber as notificações de
     * mudanças de venda (exclusão/atualização no Histórico de Vendas), ou null
     * quando não configurado.
     */
    async getFinanceiroNotificacoesVendasUsuarioId(): Promise<number | null> {
        const config = await this.findAll();
        const id = Number(String(config[CONFIG_KEYS.FINANCEIRO_NOTIFICACOES_VENDAS] ?? '').trim());
        return Number.isInteger(id) && id > 0 ? id : null;
    }

    /**
     * Taxas (%) das formas de recebimento e percentual de comissão, para os
     * cálculos de liquidez/comissão. Valores numéricos já normalizados.
     */
    async getTaxasEComissao(): Promise<{
        taxa_boleto: number;
        taxa_cartao_credito: number;
        taxa_cartao_debito: number;
        taxa_pix: number;
        comissao: number;
    }> {
        const config = await this.findAll();
        const lerPercentual = (chave: string): number => {
            const numero = Number(String(config[chave] ?? '').replace(',', '.'));
            return Number.isFinite(numero) && numero >= 0 && numero <= 100 ? numero : 0;
        };
        return {
            taxa_boleto: lerPercentual(CONFIG_KEYS.TAXA_BOLETO_PERCENTUAL),
            taxa_cartao_credito: lerPercentual(CONFIG_KEYS.TAXA_CARTAO_CREDITO_PERCENTUAL),
            taxa_cartao_debito: lerPercentual(CONFIG_KEYS.TAXA_CARTAO_DEBITO_PERCENTUAL),
            taxa_pix: lerPercentual(CONFIG_KEYS.TAXA_PIX_PERCENTUAL),
            comissao: lerPercentual(CONFIG_KEYS.COMISSAO_PERCENTUAL),
        };
    }

    async findAll(): Promise<ConfiguracoesResponseDto> {
        const registros = await this.uow.configuracoesSistemaRP.find();

        // Começa com os defaults e sobrescreve com o que estiver persistido.
        const resultado: ConfiguracoesResponseDto = { ...CONFIG_DEFAULTS };
        for (const registro of registros) {
            resultado[registro.chave] = registro.valor ?? null;
        }
        return resultado;
    }

    async upsertMany(dto: UpdateConfiguracoesDto): Promise<ConfiguracoesResponseDto> {
        for (const item of dto.itens) {
            const chave = (item.chave || '').trim();
            if (!chave) continue;

            let valor = item.valor ?? null;

            if (chave === CONFIG_KEYS.ASSESSORES_CUIDADO_ALUNOS || chave === CONFIG_KEYS.ASSESSORES_FINANCEIROS) {
                const ids = this.parseIdsJson(valor);
                await this.validarIdsAssessores(ids, chave === CONFIG_KEYS.ASSESSORES_CUIDADO_ALUNOS);
                valor = JSON.stringify(ids);
            }

            if (CONFIG_KEYS_PERCENTUAIS.includes(chave)) {
                const texto = String(valor ?? '')
                    .replace(',', '.')
                    .trim();
                const numero = texto === '' ? 0 : Number(texto);
                if (!Number.isFinite(numero) || numero < 0 || numero > 100) {
                    throw new BadRequestException(`Valor inválido para "${chave}": informe um percentual entre 0 e 100.`);
                }
                valor = String(numero);
            }

            if (chave === CONFIG_KEYS.FINANCEIRO_NOTIFICACOES_VENDAS) {
                const id = Number(String(valor ?? '').trim());
                if (String(valor ?? '').trim() === '') {
                    valor = '';
                } else if (!Number.isInteger(id) || id <= 0) {
                    throw new BadRequestException('Usuário do financeiro inválido.');
                } else {
                    await this.validarIdsAssessores([id], false);
                    valor = String(id);
                }
            }

            const existente = await this.uow.configuracoesSistemaRP.findOne({ where: { chave } });
            if (existente) {
                existente.valor = valor;
                if (item.descricao !== undefined) {
                    existente.descricao = item.descricao ?? null;
                }
                await this.uow.configuracoesSistemaRP.save(existente);
            } else {
                const novo = this.uow.configuracoesSistemaRP.create({
                    chave,
                    valor,
                    descricao: item.descricao ?? null,
                });
                await this.uow.configuracoesSistemaRP.save(novo);
            }
        }

        return this.findAll();
    }

    private async validarIdsAssessores(ids: number[], exigirCuidadoDeAlunos: boolean): Promise<void> {
        if (ids.length === 0) return;

        const usuarios = await this.uow.usuariosRP.find({
            where: { id: In(ids), deletado_em: null },
            select: ['id', 'nome', 'setor'] as any,
        });

        const encontrados = new Set(usuarios.map((u) => Number(u.id)));
        const ausentes = ids.filter((id) => !encontrados.has(id));
        if (ausentes.length > 0) {
            throw new BadRequestException(`Usuário(s) não encontrado(s) ou inativo(s): ${ausentes.join(', ')}.`);
        }

        if (exigirCuidadoDeAlunos) {
            const foraDoSetor = usuarios.filter((u) => !userHasSetor(u, ESetores.CUIDADO_DE_ALUNOS));
            if (foraDoSetor.length > 0) {
                const nomes = foraDoSetor.map((u) => u.nome).join(', ');
                throw new BadRequestException(`Assessores do Cuidado de Alunos devem pertencer ao setor Cuidado de Alunos. Fora do setor: ${nomes}.`);
            }
        }
    }
}
