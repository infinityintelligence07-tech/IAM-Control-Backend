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
} as const;

/** Defaults dos acessores financeiros (Peterson, Luana, Elaine). */
export const DEFAULT_ASSESSORES_FINANCEIROS_IDS = [334, 171, 84];

export const CONFIG_DEFAULTS: Record<string, string> = {
    [CONFIG_KEYS.TESTEMUNHA_EMAIL_PADRAO]: 'contato@iamtreinamentos.com.br',
    [CONFIG_KEYS.TESTEMUNHA_TELEFONE_PADRAO]: '(19) 98317-3941',
    [CONFIG_KEYS.ASSESSORES_CUIDADO_ALUNOS]: '[]',
    [CONFIG_KEYS.ASSESSORES_FINANCEIROS]: JSON.stringify(DEFAULT_ASSESSORES_FINANCEIROS_IDS),
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
            const ids = parsed
                .map((item) => Number(item))
                .filter((id) => Number.isInteger(id) && id > 0);
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
            throw new BadRequestException(
                `Usuário(s) não encontrado(s) ou inativo(s): ${ausentes.join(', ')}.`,
            );
        }

        if (exigirCuidadoDeAlunos) {
            const foraDoSetor = usuarios.filter((u) => !userHasSetor(u, ESetores.CUIDADO_DE_ALUNOS));
            if (foraDoSetor.length > 0) {
                const nomes = foraDoSetor.map((u) => u.nome).join(', ');
                throw new BadRequestException(
                    `Assessores do Cuidado de Alunos devem pertencer ao setor Cuidado de Alunos. Fora do setor: ${nomes}.`,
                );
            }
        }
    }
}
