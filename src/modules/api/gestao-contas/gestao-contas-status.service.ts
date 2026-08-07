import { Injectable, Logger } from '@nestjs/common';
import { In } from 'typeorm';

import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { Alunos } from '../../config/entities/alunos.entity';
import { EStatusAlunosGeral, EStatusAlunosTurmas } from '../../config/entities/enum';
import { ChaveIdentidadeCliente, montarChaveIdentidade, normalizarTelefone, normalizarTexto, pontuarIdentidades } from './identidade-cliente';
import {
    DetalheItemStatusDto,
    ReceberStatusGestaoContasDto,
    ReceberStatusGestaoContasResponseDto,
    StatusClienteGestaoContasDto,
} from './dto/gestao-contas-status.dto';

/** Pontuação mínima (ver `identidade-cliente.ts`) para aceitar um candidato. */
const PONTUACAO_MINIMA = 3;

interface CandidatoAluno {
    aluno: Alunos;
    identidade: ChaveIdentidadeCliente;
}

/**
 * Webhook de entrada: recebe da Gestão de Contas (app Lovable) o status
 * financeiro dos clientes e reflete no IAM Control.
 *
 * Efeitos aplicados: `alunos.status_aluno_geral` e `turmas_alunos.pendencia_pagamento`
 * das matrículas ativas do aluno.
 */
@Injectable()
export class GestaoContasStatusService {
    private readonly logger = new Logger(GestaoContasStatusService.name);

    constructor(private readonly uow: UnitOfWorkService) {}

    async receberStatus(payload: ReceberStatusGestaoContasDto): Promise<ReceberStatusGestaoContasResponseDto> {
        const { itens } = payload;

        const alunosPorId = await this.carregarPorId(itens);
        const candidatos = await this.carregarCandidatosPorIdentidade(itens);

        const detalhes: DetalheItemStatusDto[] = [];
        for (const [indice, item] of itens.entries()) {
            detalhes.push(await this.processarItem(item, indice, alunosPorId, candidatos));
        }

        const resposta: ReceberStatusGestaoContasResponseDto = {
            recebidos: itens.length,
            atualizados: detalhes.filter((detalhe) => detalhe.resultado === 'atualizado').length,
            sem_alteracao: detalhes.filter((detalhe) => detalhe.resultado === 'sem_alteracao').length,
            nao_encontrados: detalhes.filter((detalhe) => detalhe.resultado === 'nao_encontrado').length,
            ambiguos: detalhes.filter((detalhe) => detalhe.resultado === 'ambiguo').length,
            erros: detalhes.filter((detalhe) => detalhe.resultado === 'erro').length,
            detalhes,
        };

        this.logger.log(
            `gestao-contas.status | recebidos=${resposta.recebidos} atualizados=${resposta.atualizados} ` +
                `sem_alteracao=${resposta.sem_alteracao} nao_encontrados=${resposta.nao_encontrados} ` +
                `ambiguos=${resposta.ambiguos} erros=${resposta.erros}`,
        );

        return resposta;
    }

    private async processarItem(
        item: StatusClienteGestaoContasDto,
        indice: number,
        alunosPorId: Map<number, Alunos>,
        candidatos: CandidatoAluno[],
    ): Promise<DetalheItemStatusDto> {
        const detalhe: DetalheItemStatusDto = {
            indice,
            resultado: 'nao_encontrado',
            iam_control_aluno_id: item.iam_control_aluno_id ?? null,
            gestao_contas_student_id: item.gestao_contas_student_id ?? null,
            casado_por: null,
            status_aplicado: null,
            pendencia_pagamento_aplicada: null,
            matriculas_atualizadas: 0,
            mensagem: null,
        };

        try {
            const resolucao = this.resolverAluno(item, alunosPorId, candidatos);
            if (resolucao.resultado !== 'ok') {
                detalhe.resultado = resolucao.resultado;
                detalhe.mensagem = resolucao.mensagem;
                return detalhe;
            }

            const { aluno, casadoPor } = resolucao;
            detalhe.iam_control_aluno_id = aluno.id;
            detalhe.casado_por = casadoPor;

            const inadimplente = this.resolverInadimplencia(item);
            const novoStatus = this.resolverNovoStatus(item, aluno, inadimplente);

            let houveAlteracao = false;

            if (novoStatus && novoStatus !== aluno.status_aluno_geral) {
                aluno.status_aluno_geral = novoStatus;
                await this.uow.alunosRP.save(aluno);
                detalhe.status_aplicado = novoStatus;
                houveAlteracao = true;
            } else {
                detalhe.status_aplicado = aluno.status_aluno_geral ?? null;
            }

            if (inadimplente !== null) {
                detalhe.matriculas_atualizadas = await this.aplicarPendenciaPagamento(aluno.id, inadimplente);
                detalhe.pendencia_pagamento_aplicada = inadimplente;
                houveAlteracao = houveAlteracao || detalhe.matriculas_atualizadas > 0;
            }

            detalhe.resultado = houveAlteracao ? 'atualizado' : 'sem_alteracao';
            return detalhe;
        } catch (error) {
            detalhe.resultado = 'erro';
            detalhe.mensagem = error instanceof Error ? error.message : 'Erro desconhecido ao processar o item.';
            this.logger.error(`gestao-contas.status.item | Falha no item ${indice}`, error instanceof Error ? error.stack : undefined);
            return detalhe;
        }
    }

    /** Busca em lote os alunos referenciados diretamente por `iam_control_aluno_id`. */
    private async carregarPorId(itens: StatusClienteGestaoContasDto[]): Promise<Map<number, Alunos>> {
        const ids = [...new Set(itens.map((item) => item.iam_control_aluno_id).filter((id): id is number => typeof id === 'number'))];
        if (ids.length === 0) return new Map();

        const alunos = await this.uow.alunosRP.find({ where: { id: In(ids), deletado_em: null } });
        return new Map(alunos.map((aluno) => [aluno.id, aluno]));
    }

    /**
     * Pré-carrega, numa única consulta, todos os alunos que compartilham e-mail
     * ou final de telefone com algum item do lote. O SQL faz um filtro amplo e a
     * pontuação exata acontece em memória.
     */
    private async carregarCandidatosPorIdentidade(itens: StatusClienteGestaoContasDto[]): Promise<CandidatoAluno[]> {
        const emails = new Set<string>();
        const sufixosTelefone = new Set<string>();

        for (const item of itens) {
            if (item.iam_control_aluno_id !== undefined) continue;

            const email = (item.email || '').trim().toLowerCase();
            if (email) emails.add(email);

            const telefone = normalizarTelefone(item.telefone);
            if (telefone.length >= 8) sufixosTelefone.add(`%${telefone.slice(-8)}`);
        }

        if (emails.size === 0 && sufixosTelefone.size === 0) return [];

        const query = this.uow.alunosRP.createQueryBuilder('aluno').where('aluno.deletado_em IS NULL');

        const condicoes: string[] = [];
        const parametros: Record<string, unknown> = {};

        if (emails.size > 0) {
            condicoes.push('lower(btrim(aluno.email)) = ANY(:emails)');
            parametros.emails = [...emails];
        }
        if (sufixosTelefone.size > 0) {
            condicoes.push("regexp_replace(coalesce(aluno.telefone_um, ''), '\\D', '', 'g') LIKE ANY(:sufixos)");
            parametros.sufixos = [...sufixosTelefone];
        }

        const alunos = await query.andWhere(`(${condicoes.join(' OR ')})`, parametros).getMany();

        return alunos.map((aluno) => ({
            aluno,
            identidade: montarChaveIdentidade({ nome: aluno.nome, email: aluno.email, telefone: aluno.telefone_um }),
        }));
    }

    private resolverAluno(
        item: StatusClienteGestaoContasDto,
        alunosPorId: Map<number, Alunos>,
        candidatos: CandidatoAluno[],
    ):
        | { resultado: 'ok'; aluno: Alunos; casadoPor: 'id' | 'identidade' }
        | { resultado: 'nao_encontrado' | 'ambiguo'; mensagem: string } {
        if (item.iam_control_aluno_id !== undefined) {
            const aluno = alunosPorId.get(item.iam_control_aluno_id);
            if (aluno) return { resultado: 'ok', aluno, casadoPor: 'id' };
            return {
                resultado: 'nao_encontrado',
                mensagem: `Nenhum aluno ativo com id ${item.iam_control_aluno_id} no IAM Control.`,
            };
        }

        const identidadeItem = montarChaveIdentidade({ nome: item.nome, email: item.email, telefone: item.telefone });
        if (!identidadeItem.telefone && !identidadeItem.email) {
            return {
                resultado: 'nao_encontrado',
                mensagem: 'Informe iam_control_aluno_id ou ao menos telefone/e-mail para localizar o aluno.',
            };
        }

        const pontuados = candidatos
            .map((candidato) => ({ candidato, pontos: pontuarIdentidades(identidadeItem, candidato.identidade) }))
            .filter((avaliacao) => avaliacao.pontos >= PONTUACAO_MINIMA)
            .sort((a, b) => b.pontos - a.pontos);

        if (pontuados.length === 0) {
            return {
                resultado: 'nao_encontrado',
                mensagem: `Nenhum aluno confere com telefone/e-mail/nome informados (${identidadeItem.telefone || 's/ telefone'} | ${
                    identidadeItem.email || 's/ e-mail'
                } | ${identidadeItem.nome || 's/ nome'}).`,
            };
        }

        const melhorPontuacao = pontuados[0].pontos;
        const empatados = pontuados.filter((avaliacao) => avaliacao.pontos === melhorPontuacao);
        if (empatados.length > 1) {
            return {
                resultado: 'ambiguo',
                mensagem: `${empatados.length} alunos conferem com os mesmos dados (ids: ${empatados
                    .map((avaliacao) => avaliacao.candidato.aluno.id)
                    .join(', ')}). Envie iam_control_aluno_id para desambiguar.`,
            };
        }

        return { resultado: 'ok', aluno: pontuados[0].candidato.aluno, casadoPor: 'identidade' };
    }

    /**
     * `inadimplente` explícito vence; caso contrário deduz do rótulo de status.
     * Retorna `null` quando o item não permite concluir nada — nesse caso a
     * pendência de pagamento não é tocada.
     */
    private resolverInadimplencia(item: StatusClienteGestaoContasDto): boolean | null {
        if (typeof item.inadimplente === 'boolean') return item.inadimplente;

        const statusMapeado = this.mapearStatus(item.status);
        if (statusMapeado === EStatusAlunosGeral.INADIMPLENTE) return true;
        if (statusMapeado === EStatusAlunosGeral.ATIVO) return false;

        return null;
    }

    /** Traduz o rótulo livre da Gestão de Contas para o enum do IAM Control. */
    private mapearStatus(status: string | null | undefined): EStatusAlunosGeral | null {
        const normalizado = normalizarTexto(status);
        if (!normalizado) return null;

        if (normalizado.includes('inadimpl')) return EStatusAlunosGeral.INADIMPLENTE;

        // Mais específico primeiro: "Cancelamento solicitado" ≠ cancelamento definitivo.
        if (
            normalizado.includes('cancelamento solicitado') ||
            (normalizado.includes('solicit') && normalizado.includes('cancel'))
        ) {
            return EStatusAlunosGeral.CANCELAMENTO_SOLICITADO;
        }
        if (
            normalizado.includes('contrato cancelado') ||
            normalizado.includes('cancel') ||
            normalizado.includes('distrat')
        ) {
            return EStatusAlunosGeral.CONTRATO_CANCELADO;
        }

        if (normalizado.includes('suspens')) return EStatusAlunosGeral.SUSPENSO;
        if (normalizado.includes('inativ')) return EStatusAlunosGeral.INATIVO;
        if (normalizado.includes('adimpl') || normalizado.includes('quitad') || normalizado.includes('em dia') || normalizado.includes('ativo')) {
            return EStatusAlunosGeral.ATIVO;
        }

        return null;
    }

    /** Status que o booleano `inadimplente` sozinho não pode sobrescrever. */
    private statusProtegidoDeInadimplenciaAutomatica(status: EStatusAlunosGeral | null | undefined): boolean {
        return (
            status === EStatusAlunosGeral.CANCELAMENTO_SOLICITADO ||
            status === EStatusAlunosGeral.CONTRATO_CANCELADO ||
            status === EStatusAlunosGeral.CANCELADO ||
            status === EStatusAlunosGeral.SUSPENSO ||
            status === EStatusAlunosGeral.INATIVO
        );
    }

    /**
     * Decide o status a gravar.
     *
     * Um rótulo explícito da Gestão de Contas sempre vale. Quando a decisão vem
     * apenas do sinal booleano, a única transição automática permitida é
     * INADIMPLENTE <-> ATIVO: quitar a dívida limpa a inadimplência, mas não
     * promove um cadastro PENDENTE nem reativa quem foi cancelado/suspenso aqui.
     */
    private resolverNovoStatus(item: StatusClienteGestaoContasDto, aluno: Alunos, inadimplente: boolean | null): EStatusAlunosGeral | null {
        const statusExplicito = this.mapearStatus(item.status);
        if (statusExplicito) return statusExplicito;

        if (inadimplente === null) return null;
        if (this.statusProtegidoDeInadimplenciaAutomatica(aluno.status_aluno_geral)) return null;
        if (inadimplente) return EStatusAlunosGeral.INADIMPLENTE;

        return aluno.status_aluno_geral === EStatusAlunosGeral.INADIMPLENTE ? EStatusAlunosGeral.ATIVO : null;
    }

    /** Reflete a inadimplência nas matrículas ativas do aluno. Retorna quantas mudaram. */
    private async aplicarPendenciaPagamento(idAluno: number, pendencia: boolean): Promise<number> {
        const matriculas = await this.uow.turmasAlunosRP.find({
            where: { id_aluno: String(idAluno), deletado_em: null },
        });

        const alteradas = matriculas.filter(
            (matricula) => matricula.status_aluno_turma !== EStatusAlunosTurmas.CANCELADO && matricula.pendencia_pagamento !== pendencia,
        );
        if (alteradas.length === 0) return 0;

        for (const matricula of alteradas) {
            matricula.pendencia_pagamento = pendencia;
        }
        await this.uow.turmasAlunosRP.save(alteradas);

        return alteradas.length;
    }
}
