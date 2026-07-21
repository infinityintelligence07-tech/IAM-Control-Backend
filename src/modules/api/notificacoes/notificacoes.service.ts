import { Injectable, Logger } from '@nestjs/common';
import { In } from 'typeorm';

import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { ESetores } from '@/modules/config/entities/enum';
import { normalizeSetores, userHasSetor } from '@/common/utils/setor.util';
import { NotificacaoResponseDto, NotificacoesListResponseDto } from './dto/notificacoes.dto';

/** Janela de exibição das notificações: última quinzena (15 dias). */
const JANELA_NOTIFICACOES_DIAS = 15;

export interface CriarNotificacaoParams {
    tipo: string;
    titulo: string;
    mensagem: string;
    setorDestino: ESetores | string;
    dados?: Record<string, unknown> | null;
    criadoPor?: number;
    /**
     * Quando informado, a notificação fica visível SOMENTE para este usuário
     * (não para todo o `setorDestino`). Usado nas mudanças de venda.
     */
    usuarioDestino?: number | null;
}

@Injectable()
export class NotificacoesService {
    private readonly logger = new Logger(NotificacoesService.name);

    constructor(private readonly uow: UnitOfWorkService) {}

    /**
     * Cria uma notificação direcionada a um setor. Nunca lança: falha em
     * notificar não deve interromper a operação de negócio que a originou.
     */
    async criarNotificacao(params: CriarNotificacaoParams): Promise<void> {
        try {
            const notificacao = this.uow.notificacoesRP.create({
                tipo: params.tipo,
                titulo: params.titulo,
                mensagem: params.mensagem,
                setor_destino: String(params.setorDestino),
                id_usuario_destino: params.usuarioDestino ?? null,
                dados: params.dados ?? null,
                criado_por: params.criadoPor,
            });
            await this.uow.notificacoesRP.save(notificacao);
        } catch (error) {
            this.logger.error(
                `notificacoes.criar | Erro ao criar notificação tipo=${params.tipo}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
            );
        }
    }

    /**
     * Cria a MESMA notificação para uma lista de usuários específicos (uma linha
     * por usuário, com `id_usuario_destino`). Deduplica e ignora ids inválidos.
     * Cada destinatário controla sua própria leitura. Nunca lança.
     */
    async criarNotificacaoParaUsuarios(
        params: Omit<CriarNotificacaoParams, 'usuarioDestino'>,
        usuariosDestino: Array<number | null | undefined>,
    ): Promise<void> {
        const idsUnicos = Array.from(
            new Set(
                (usuariosDestino || [])
                    .map((id) => Number(id))
                    .filter((id) => Number.isInteger(id) && id > 0),
            ),
        );
        if (idsUnicos.length === 0) {
            return;
        }
        for (const idUsuario of idsUnicos) {
            await this.criarNotificacao({ ...params, usuarioDestino: idUsuario });
        }
    }

    /**
     * Lista as notificações do setor do usuário logado (última quinzena),
     * com o estado de leitura individual (lida/não lida) do próprio usuário.
     * Administradores enxergam as notificações de todos os setores.
     */
    async listarNotificacoesDoUsuario(userId: number): Promise<NotificacoesListResponseDto> {
        const usuario = await this.uow.usuariosRP.findOne({
            where: { id: userId, deletado_em: null },
            select: ['id', 'setor', 'funcao'] as any,
        });
        if (!usuario) {
            return { data: [], total: 0, nao_lidas: 0 };
        }

        const funcoes = Array.isArray(usuario.funcao) ? usuario.funcao : [];
        const isAdmin = funcoes.includes('ADMINISTRADOR' as any) || userHasSetor(usuario, ESetores.ADMINISTRADOR);

        const dataLimite = new Date();
        dataLimite.setDate(dataLimite.getDate() - JANELA_NOTIFICACOES_DIAS);

        const query = this.uow.notificacoesRP
            .createQueryBuilder('notificacao')
            .where('notificacao.deletado_em IS NULL')
            .andWhere('notificacao.criado_em >= :dataLimite', { dataLimite })
            .orderBy('notificacao.criado_em', 'DESC');

        // Regras de visibilidade:
        // - notificação de SETOR (id_usuario_destino IS NULL): quem é do setor
        //   (admins veem todas);
        // - notificação DIRECIONADA (id_usuario_destino preenchido): SOMENTE o
        //   próprio destinatário — nem os demais do setor, nem admins. Usada nas
        //   mudanças de venda (líder do Cuidado de Alunos + acessora da turma).
        if (isAdmin) {
            query.andWhere('(notificacao.id_usuario_destino IS NULL OR notificacao.id_usuario_destino = :userId)', {
                userId,
            });
        } else {
            const setoresUsuario = normalizeSetores(usuario.setor).map(String);
            if (setoresUsuario.length === 0) {
                query.andWhere('notificacao.id_usuario_destino = :userId', { userId });
            } else {
                query.andWhere(
                    '((notificacao.id_usuario_destino IS NULL AND notificacao.setor_destino IN (:...setoresUsuario)) OR notificacao.id_usuario_destino = :userId)',
                    { setoresUsuario, userId },
                );
            }
        }

        const notificacoes = await query.getMany();
        if (notificacoes.length === 0) {
            return { data: [], total: 0, nao_lidas: 0 };
        }

        const leituras = await this.uow.notificacoesLeiturasRP.find({
            where: {
                id_usuario: userId,
                id_notificacao: In(notificacoes.map((n) => n.id)),
                deletado_em: null,
            },
        });
        const leituraPorNotificacao = new Map(leituras.map((leitura) => [leitura.id_notificacao, leitura]));

        const data: NotificacaoResponseDto[] = notificacoes.map((notificacao) => {
            const leitura = leituraPorNotificacao.get(notificacao.id);
            return {
                id: notificacao.id,
                tipo: notificacao.tipo,
                titulo: notificacao.titulo,
                mensagem: notificacao.mensagem,
                setor_destino: notificacao.setor_destino,
                dados: notificacao.dados ?? null,
                criado_em: notificacao.criado_em,
                lida: !!leitura,
                lida_em: leitura?.criado_em ?? null,
            };
        });

        return {
            data,
            total: data.length,
            nao_lidas: data.filter((n) => !n.lida).length,
        };
    }

    /**
     * Marca notificações como lidas para o usuário logado. Sem ids, marca
     * todas as notificações visíveis (setor + quinzena) como lidas.
     */
    async marcarComoLidas(userId: number, ids?: number[]): Promise<{ marcadas: number }> {
        let idsParaMarcar: number[];

        if (ids && ids.length > 0) {
            idsParaMarcar = ids;
        } else {
            const visiveis = await this.listarNotificacoesDoUsuario(userId);
            idsParaMarcar = visiveis.data.filter((n) => !n.lida).map((n) => n.id);
        }

        if (idsParaMarcar.length === 0) {
            return { marcadas: 0 };
        }

        const leiturasExistentes = await this.uow.notificacoesLeiturasRP.find({
            where: { id_usuario: userId, id_notificacao: In(idsParaMarcar), deletado_em: null },
            select: ['id', 'id_notificacao'] as any,
        });
        const jaLidas = new Set(leiturasExistentes.map((leitura) => leitura.id_notificacao));

        const novasLeituras = idsParaMarcar
            .filter((idNotificacao) => !jaLidas.has(idNotificacao))
            .map((idNotificacao) =>
                this.uow.notificacoesLeiturasRP.create({
                    id_notificacao: idNotificacao,
                    id_usuario: userId,
                }),
            );

        if (novasLeituras.length > 0) {
            await this.uow.notificacoesLeiturasRP.save(novasLeituras);
        }

        return { marcadas: novasLeituras.length };
    }
}
