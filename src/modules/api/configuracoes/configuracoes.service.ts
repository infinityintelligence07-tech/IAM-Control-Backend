import { Injectable } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { ConfiguracoesResponseDto, UpdateConfiguracoesDto } from './dto/configuracoes.dto';

/**
 * Chaves de configuração conhecidas e seus valores padrão de fallback.
 *
 * Os valores padrão são usados quando ainda não há registro no banco, garantindo
 * que o sistema funcione mesmo antes da primeira configuração pela tela.
 */
export const CONFIG_KEYS = {
    TESTEMUNHA_EMAIL_PADRAO: 'testemunha_email_padrao',
    TESTEMUNHA_TELEFONE_PADRAO: 'testemunha_telefone_padrao',
} as const;

export const CONFIG_DEFAULTS: Record<string, string> = {
    [CONFIG_KEYS.TESTEMUNHA_EMAIL_PADRAO]: 'contato@iamtreinamentos.com.br',
    [CONFIG_KEYS.TESTEMUNHA_TELEFONE_PADRAO]: '(19) 98317-3941',
};

@Injectable()
export class ConfiguracoesService {
    constructor(private readonly uow: UnitOfWorkService) {}

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

            const existente = await this.uow.configuracoesSistemaRP.findOne({ where: { chave } });
            if (existente) {
                existente.valor = item.valor ?? null;
                if (item.descricao !== undefined) {
                    existente.descricao = item.descricao ?? null;
                }
                await this.uow.configuracoesSistemaRP.save(existente);
            } else {
                const novo = this.uow.configuracoesSistemaRP.create({
                    chave,
                    valor: item.valor ?? null,
                    descricao: item.descricao ?? null,
                });
                await this.uow.configuracoesSistemaRP.save(novo);
            }
        }

        return this.findAll();
    }
}
