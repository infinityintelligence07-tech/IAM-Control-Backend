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
    // Valor padrão (R$) da taxa de inscrição do IPR vendido com origem em
    // masterclass; cada palestra pode sobrescrever nas informações da turma.
    TAXA_INSCRICAO_IPR_MASTERCLASS: 'taxa_inscricao_ipr_masterclass',
    // Exportação Kamino (Histórico de Vendas).
    KAMINO_UNIDADES_NEGOCIO: 'kamino_unidades_negocio',
    KAMINO_CONTAS_DESTINO: 'kamino_contas_destino',
    KAMINO_TIPOS_RECEBIMENTO: 'kamino_tipos_recebimento',
    KAMINO_CODIGOS_CLASSIFICACAO: 'kamino_codigos_classificacao',
} as const;

/** Chaves cujo valor é monetário em reais (>= 0, aceita decimais). */
export const CONFIG_KEYS_MONETARIAS: string[] = [CONFIG_KEYS.TAXA_INSCRICAO_IPR_MASTERCLASS];

/** Chaves cujo valor é um percentual (0 a 100, aceita decimais). */
export const CONFIG_KEYS_PERCENTUAIS: string[] = [
    CONFIG_KEYS.TAXA_BOLETO_PERCENTUAL,
    CONFIG_KEYS.TAXA_CARTAO_CREDITO_PERCENTUAL,
    CONFIG_KEYS.TAXA_CARTAO_DEBITO_PERCENTUAL,
    CONFIG_KEYS.TAXA_PIX_PERCENTUAL,
    CONFIG_KEYS.COMISSAO_PERCENTUAL,
];

/** Chaves cujo valor é JSON de códigos Kamino (listas). */
export const CONFIG_KEYS_KAMINO_JSON: string[] = [
    CONFIG_KEYS.KAMINO_UNIDADES_NEGOCIO,
    CONFIG_KEYS.KAMINO_CONTAS_DESTINO,
    CONFIG_KEYS.KAMINO_TIPOS_RECEBIMENTO,
    CONFIG_KEYS.KAMINO_CODIGOS_CLASSIFICACAO,
];

/** Defaults dos acessores financeiros (Peterson, Luana, Elaine). */
export const DEFAULT_ASSESSORES_FINANCEIROS_IDS = [334, 171, 84];

export const DEFAULT_KAMINO_UNIDADES_NEGOCIO = [{ codigo: '1', descricao: '' }];
export const DEFAULT_KAMINO_CONTAS_DESTINO = [{ codigo: '10201', descricao: '' }];
export const DEFAULT_KAMINO_TIPOS_RECEBIMENTO = [{ codigo: '5', descricao: '' }];
export const DEFAULT_KAMINO_CODIGOS_CLASSIFICACAO = [
    { codigo: '20102', descricao: 'Confronto', eh_return: false, id_treinamento: null },
    { codigo: '20122', descricao: 'Confronto Return', eh_return: true, id_treinamento: null },
];

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
    // Taxa de inscrição padrão (R$) do IPR vendido nas masterclasses.
    [CONFIG_KEYS.TAXA_INSCRICAO_IPR_MASTERCLASS]: '250',
    [CONFIG_KEYS.KAMINO_UNIDADES_NEGOCIO]: JSON.stringify(DEFAULT_KAMINO_UNIDADES_NEGOCIO),
    [CONFIG_KEYS.KAMINO_CONTAS_DESTINO]: JSON.stringify(DEFAULT_KAMINO_CONTAS_DESTINO),
    [CONFIG_KEYS.KAMINO_TIPOS_RECEBIMENTO]: JSON.stringify(DEFAULT_KAMINO_TIPOS_RECEBIMENTO),
    [CONFIG_KEYS.KAMINO_CODIGOS_CLASSIFICACAO]: JSON.stringify(DEFAULT_KAMINO_CODIGOS_CLASSIFICACAO),
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

    /**
     * Valor padrão (R$) da taxa de inscrição do IPR vendido com origem em
     * masterclass. Usado quando a turma de palestra não define valor próprio.
     */
    async getTaxaInscricaoIprMasterclass(): Promise<number> {
        const config = await this.findAll();
        const numero = Number(String(config[CONFIG_KEYS.TAXA_INSCRICAO_IPR_MASTERCLASS] ?? '').replace(',', '.'));
        const fallback = Number(CONFIG_DEFAULTS[CONFIG_KEYS.TAXA_INSCRICAO_IPR_MASTERCLASS]);
        return Number.isFinite(numero) && numero >= 0 ? numero : fallback;
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

            if (CONFIG_KEYS_MONETARIAS.includes(chave)) {
                const texto = String(valor ?? '')
                    .replace(',', '.')
                    .trim();
                const numero = texto === '' ? 0 : Number(texto);
                if (!Number.isFinite(numero) || numero < 0) {
                    throw new BadRequestException(`Valor inválido para "${chave}": informe um valor em reais maior ou igual a zero.`);
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

            if (CONFIG_KEYS_KAMINO_JSON.includes(chave)) {
                valor = this.normalizarValorKamino(chave, valor);
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

    /** Valida e normaliza o JSON das listas Kamino antes de persistir. */
    private normalizarValorKamino(chave: string, valor: string | null): string {
        let parsed: unknown;
        try {
            parsed = JSON.parse(String(valor ?? '[]'));
        } catch {
            throw new BadRequestException(`Valor inválido para "${chave}": JSON malformado.`);
        }
        if (!Array.isArray(parsed)) {
            throw new BadRequestException(`Valor inválido para "${chave}": esperado um array.`);
        }

        if (chave === CONFIG_KEYS.KAMINO_CODIGOS_CLASSIFICACAO) {
            const lista = parsed
                .map((item) => {
                    if (!item || typeof item !== 'object') return null;
                    const obj = item as Record<string, unknown>;
                    const codigo = String(obj.codigo ?? '').trim();
                    if (!codigo) return null;
                    const descricao = String(obj.descricao ?? '').trim();
                    const ehReturnRaw = obj.eh_return ?? obj.is_return ?? obj.return ?? false;
                    const idRaw = Number(obj.id_treinamento ?? obj.idTreinamento ?? 0);
                    return {
                        codigo,
                        descricao,
                        eh_return: ehReturnRaw === true || ehReturnRaw === 'true' || ehReturnRaw === 1,
                        id_treinamento: Number.isInteger(idRaw) && idRaw > 0 ? idRaw : null,
                    };
                })
                .filter(
                    (
                        item,
                    ): item is {
                        codigo: string;
                        descricao: string;
                        eh_return: boolean;
                        id_treinamento: number | null;
                    } => item != null,
                );
            if (lista.length === 0) {
                throw new BadRequestException('Informe ao menos um código de classificação Kamino.');
            }
            const semDescricao = lista.find((item) => !item.descricao);
            if (semDescricao) {
                throw new BadRequestException(
                    `Classificação ${semDescricao.codigo}: informe a descrição.`,
                );
            }
            return JSON.stringify(lista);
        }

        // Unidades, contas e tipos: código + descrição (aceita `nome` legado).
        const rotulos: Record<string, string> = {
            [CONFIG_KEYS.KAMINO_UNIDADES_NEGOCIO]: 'Unidade de Negócio',
            [CONFIG_KEYS.KAMINO_CONTAS_DESTINO]: 'Código da Conta de Destino',
            [CONFIG_KEYS.KAMINO_TIPOS_RECEBIMENTO]: 'Código do Tipo de Recebimento',
        };
        const rotulo = rotulos[chave] || chave;
        const lista = parsed
            .map((item) => {
                if (typeof item === 'string' || typeof item === 'number') {
                    const codigo = String(item).trim();
                    return codigo ? { codigo, descricao: '' } : null;
                }
                if (!item || typeof item !== 'object') return null;
                const obj = item as Record<string, unknown>;
                const codigo = String(obj.codigo ?? '').trim();
                if (!codigo) return null;
                return {
                    codigo,
                    descricao: String(obj.descricao ?? obj.nome ?? '').trim(),
                };
            })
            .filter((item): item is { codigo: string; descricao: string } => item != null);
        if (lista.length === 0) {
            throw new BadRequestException(`Informe ao menos um valor de ${rotulo}.`);
        }
        return JSON.stringify(lista);
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
