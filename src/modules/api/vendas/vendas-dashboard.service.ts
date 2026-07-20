import { Injectable } from '@nestjs/common';
import { In, IsNull } from 'typeorm';
import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { Turmas } from '@/modules/config/entities/turmas.entity';
import { EPresencaTurmas, EStatusAlunosGeral, EStatusAlunosTurmas } from '@/modules/config/entities/enum';
import {
    CodigoEventoDashboard,
    EVENTOS_DASHBOARD,
    VendasDashboardFiltrosResponseDto,
    VendasDashboardQueryDto,
    VendasDashboardResponseDto,
    VendasDashboardStatusListaQueryDto,
    VendasDashboardStatusListaResponseDto,
} from './dto/vendas-dashboard.dto';
import {
    agregarEstrategiasAquisicao,
    agregarFormasPagamento,
    agregarVendasPorProduto,
    calcularMetricasDashboard,
    calcularRankingLideresPendencia,
    calcularRankingsLideresPorEvento,
    calcularRankingsTurmasPorEvento,
    calcularResumoStatusDashboard,
    codigoEventoDashboard,
    ContratoDashboardLinha,
    criarMapaAquisicaoVazio,
    isProcessoVendaContrato,
    listarItensStatusRecebivel,
    metricasVazia,
    obterDadosEventoContrato,
    resumoStatusVazio,
    rotuloTurmaIamControl,
    TurmaRankingInput,
} from './vendas-dashboard.aggregator';

type TimeEquipeSlim = { id: string; nome: string; liderId: string; membrosIds: string[] };

type LinhaContratoRaw = {
    id: string;
    criado_em?: string | Date | null;
    dados_contrato: unknown;
    criado_por_contrato?: string | number | null;
    criado_por_tat?: string | number | null;
    criado_por_ta?: string | number | null;
    quantidade_inscricoes: string | number;
    pendencia_pagamento: string | boolean;
    id_turma?: string | number | null;
    id_turma_destino?: string | number | null;
    sigla_destino?: string | null;
    nome_destino?: string | null;
};

@Injectable()
export class VendasDashboardService {
    constructor(private readonly uow: UnitOfWorkService) {}

    async getDashboard(filtros: VendasDashboardQueryDto): Promise<VendasDashboardResponseDto> {
        const { dataInicio, dataFim } = this.resolverPeriodo(filtros.data_inicio, filtros.data_fim);
        const eventoFiltro = filtros.evento || null;
        const liderIdFiltro = filtros.lider_id != null && Number.isFinite(Number(filtros.lider_id)) ? Number(filtros.lider_id) : null;
        const turmaIdFiltro = filtros.turma_id != null && Number.isFinite(Number(filtros.turma_id)) ? Number(filtros.turma_id) : null;

        const filtrosAplicados = {
            data_inicio: dataInicio.toISOString(),
            data_fim: dataFim.toISOString(),
            evento: eventoFiltro,
            lider_id: liderIdFiltro,
            turma_id: turmaIdFiltro,
        };

        const linhasRaw = await this.carregarLinhasContratos(dataInicio, dataFim, turmaIdFiltro);
        const contratosEnriquecidos = await this.enriquecerComStaffLider(linhasRaw);

        let contratos = contratosEnriquecidos.filter((c) => isProcessoVendaContrato(c));

        if (eventoFiltro) {
            contratos = contratos.filter((c) => obterDadosEventoContrato(c).codigo === eventoFiltro);
        }
        if (turmaIdFiltro) {
            contratos = contratos.filter((c) => c.ids_turma.includes(turmaIdFiltro));
        }
        if (liderIdFiltro) {
            contratos = contratos.filter((c) => Number(c.lider_id) === liderIdFiltro);
        }

        const turmasRanking = await this.carregarTurmasParaRanking({
            evento: eventoFiltro,
            turmaId: turmaIdFiltro,
            dataInicio,
            dataFim,
            contratos,
        });

        const domManha = turmasRanking.reduce((acc, t) => acc + Math.max(0, t.presentesCount || 0), 0);
        const aquisicaoPorEvento = await this.agregarAquisicaoPorEvento({
            dataInicio,
            dataFim,
            evento: eventoFiltro,
            turmaId: turmaIdFiltro,
            turmas: turmasRanking,
        });

        if (contratos.length === 0) {
            return {
                filtros_aplicados: filtrosAplicados,
                metricas: metricasVazia(domManha),
                formasPagamento: [],
                vendasPorProduto: [],
                statusRecebiveis: resumoStatusVazio(),
                rankingsLideres: calcularRankingsLideresPorEvento([]),
                rankingsTurmas: calcularRankingsTurmasPorEvento(turmasRanking, []),
                rankingPendencia: [],
                aquisicaoPorEvento,
            };
        }

        return {
            filtros_aplicados: filtrosAplicados,
            metricas: calcularMetricasDashboard(contratos, domManha),
            formasPagamento: agregarFormasPagamento(contratos),
            vendasPorProduto: agregarVendasPorProduto(contratos),
            statusRecebiveis: calcularResumoStatusDashboard(contratos),
            rankingsLideres: calcularRankingsLideresPorEvento(contratos),
            rankingsTurmas: calcularRankingsTurmasPorEvento(turmasRanking, contratos),
            rankingPendencia: calcularRankingLideresPendencia(contratos),
            aquisicaoPorEvento,
        };
    }

    async getStatusRecebiveisLista(
        filtros: VendasDashboardStatusListaQueryDto,
    ): Promise<VendasDashboardStatusListaResponseDto> {
        const contratos = await this.carregarContratosFiltrados(filtros);
        const rotuloPorIdTurma = await this.montarRotulosTurmas(contratos);
        return listarItensStatusRecebivel(contratos, filtros.status, rotuloPorIdTurma);
    }

    async getFiltros(): Promise<VendasDashboardFiltrosResponseDto> {
        const turmas = await this.uow.turmasRP.find({
            where: { deletado_em: IsNull() },
            relations: ['id_treinamento_fk', 'id_polo_fk'],
            select: {
                id: true,
                edicao_turma: true,
                cidade: true,
                times_equipes: true,
                id_treinamento_fk: {
                    id: true,
                    treinamento: true,
                    sigla_treinamento: true,
                    tipo_mentoria: true,
                },
                id_polo_fk: {
                    id: true,
                    sigla_polo: true,
                    polo: true,
                },
            },
        });

        const turmasFiltro = turmas
            .filter((t) => t.id_treinamento_fk?.tipo_mentoria !== true)
            .map((t) => {
                const evento = codigoEventoDashboard(t.id_treinamento_fk?.treinamento, t.id_treinamento_fk?.sigla_treinamento);
                return {
                    id: t.id,
                    label: rotuloTurmaIamControl({
                        id: t.id,
                        edicao_turma: t.edicao_turma,
                        cidade: t.cidade,
                        polo: t.id_polo_fk
                            ? { sigla_polo: t.id_polo_fk.sigla_polo, nome: t.id_polo_fk.polo }
                            : null,
                        treinamento: t.id_treinamento_fk,
                    }),
                    evento,
                };
            })
            .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

        const liderIds = new Set<number>();
        for (const turma of turmas) {
            const ehIpr = this.turmaEhImersaoProsperar(turma.id_treinamento_fk?.sigla_treinamento, turma.id_treinamento_fk?.treinamento);
            if (!ehIpr) continue;
            const times = Array.isArray(turma.times_equipes) ? turma.times_equipes : [];
            for (const time of times) {
                const liderId = Number(time?.liderId);
                if (Number.isFinite(liderId) && liderId > 0) liderIds.add(liderId);
            }
        }

        const lideres: Array<{ id: number; nome: string }> = [];
        if (liderIds.size > 0) {
            const usuarios = await this.uow.usuariosRP.find({
                where: { id: In(Array.from(liderIds)), deletado_em: IsNull() },
                select: { id: true, nome: true, primeiro_nome: true, sobrenome: true },
            });
            for (const usuario of usuarios) {
                lideres.push({
                    id: usuario.id,
                    nome: usuario.nome || `${usuario.primeiro_nome || ''} ${usuario.sobrenome || ''}`.trim() || `Usuário ${usuario.id}`,
                });
            }
            lideres.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        }

        return {
            eventos: [...EVENTOS_DASHBOARD],
            lideres,
            turmas: turmasFiltro,
        };
    }

    private resolverPeriodo(dataInicioRaw?: string, dataFimRaw?: string): { dataInicio: Date; dataFim: Date } {
        const dataInicioPadrao = (() => {
            const d = new Date();
            d.setDate(d.getDate() - 30);
            d.setHours(0, 0, 0, 0);
            return d;
        })();
        const dataFimPadrao = (() => {
            const d = new Date();
            d.setHours(23, 59, 59, 999);
            return d;
        })();

        return {
            dataInicio: this.converterDataFiltroParaDate(dataInicioRaw, false) || dataInicioPadrao,
            dataFim: this.converterDataFiltroParaDate(dataFimRaw, true) || dataFimPadrao,
        };
    }

    private converterDataFiltroParaDate(valor?: string, fimDoDia: boolean = false): Date | null {
        const bruto = String(valor || '').trim();
        if (!bruto) return null;

        const contemHorario = /\d{2}:\d{2}/.test(bruto);
        const possuiTimezone = /([zZ]|[+-]\d{2}:\d{2})$/.test(bruto);
        const valorNormalizado = bruto.includes(' ') ? bruto.replace(' ', 'T') : bruto;
        const candidatoIso = possuiTimezone ? valorNormalizado : `${valorNormalizado}Z`;
        let data = new Date(candidatoIso);

        if (Number.isNaN(data.getTime())) {
            const somenteData = bruto.split(' ')[0]?.split('T')[0]?.trim();
            if (!somenteData) return null;
            data = new Date(`${somenteData}T${fimDoDia ? '23:59:59.999' : '00:00:00.000'}Z`);
            if (Number.isNaN(data.getTime())) return null;
            return data;
        }

        if (!contemHorario) {
            data = new Date(`${valorNormalizado}T${fimDoDia ? '23:59:59.999' : '00:00:00.000'}Z`);
        }

        return Number.isNaN(data.getTime()) ? null : data;
    }

    private async carregarContratosFiltrados(
        filtros: VendasDashboardQueryDto,
    ): Promise<ContratoDashboardLinha[]> {
        const { dataInicio, dataFim } = this.resolverPeriodo(filtros.data_inicio, filtros.data_fim);
        const eventoFiltro = filtros.evento || null;
        const liderIdFiltro =
            filtros.lider_id != null && Number.isFinite(Number(filtros.lider_id))
                ? Number(filtros.lider_id)
                : null;
        const turmaIdFiltro =
            filtros.turma_id != null && Number.isFinite(Number(filtros.turma_id))
                ? Number(filtros.turma_id)
                : null;

        const linhasRaw = await this.carregarLinhasContratos(dataInicio, dataFim, turmaIdFiltro);
        const contratosEnriquecidos = await this.enriquecerComStaffLider(linhasRaw);

        let contratos = contratosEnriquecidos.filter((c) => isProcessoVendaContrato(c));

        if (eventoFiltro) {
            contratos = contratos.filter((c) => obterDadosEventoContrato(c).codigo === eventoFiltro);
        }
        if (turmaIdFiltro) {
            contratos = contratos.filter((c) => c.ids_turma.includes(turmaIdFiltro));
        }
        if (liderIdFiltro) {
            contratos = contratos.filter((c) => Number(c.lider_id) === liderIdFiltro);
        }

        return contratos;
    }

    private async montarRotulosTurmas(
        contratos: ContratoDashboardLinha[],
    ): Promise<Map<number, string>> {
        const ids = new Set<number>();
        for (const contrato of contratos) {
            for (const id of contrato.ids_turma || []) {
                if (Number.isFinite(id) && id > 0) ids.add(id);
            }
            const dados = contrato.dados_contrato || {};
            for (const candidato of [
                dados.fluxo_evento_origem_id_turma,
                dados.id_turma_origem,
                dados.turma_origem?.id,
                dados.fluxo_evento_destino_id_turma,
                dados.id_turma_destino,
                dados.turma?.id,
            ]) {
                const n = Number(candidato);
                if (Number.isFinite(n) && n > 0) ids.add(n);
            }
        }

        const mapa = new Map<number, string>();
        if (ids.size === 0) return mapa;

        const turmas = await this.uow.turmasRP.find({
            where: { id: In(Array.from(ids)), deletado_em: IsNull() },
            relations: ['id_treinamento_fk', 'id_polo_fk'],
            select: {
                id: true,
                edicao_turma: true,
                cidade: true,
                id_treinamento_fk: {
                    id: true,
                    treinamento: true,
                    sigla_treinamento: true,
                },
                id_polo_fk: {
                    id: true,
                    sigla_polo: true,
                    polo: true,
                },
            },
        });

        for (const turma of turmas) {
            mapa.set(
                turma.id,
                rotuloTurmaIamControl({
                    id: turma.id,
                    edicao_turma: turma.edicao_turma,
                    cidade: turma.cidade,
                    treinamento: turma.id_treinamento_fk
                        ? {
                              treinamento: turma.id_treinamento_fk.treinamento,
                              sigla_treinamento: turma.id_treinamento_fk.sigla_treinamento,
                          }
                        : null,
                    polo: turma.id_polo_fk
                        ? {
                              sigla_polo: turma.id_polo_fk.sigla_polo,
                              nome: turma.id_polo_fk.polo,
                          }
                        : null,
                }),
            );
        }

        return mapa;
    }

    private parseJsonSeguro(valor: unknown): Record<string, any> {
        if (!valor) return {};
        if (typeof valor === 'object') return valor as Record<string, any>;
        if (typeof valor !== 'string') return {};
        try {
            const parsed = JSON.parse(valor);
            return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : {};
        } catch {
            return {};
        }
    }

    private normalizarTexto(valor?: string | null): string {
        return String(valor || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }

    private turmaEhImersaoProsperar(sigla?: string | null, nome?: string | null): boolean {
        const siglaNorm = this.normalizarTexto(sigla).replace(/[^a-z]/g, '');
        const nomeNorm = this.normalizarTexto(nome);
        return siglaNorm === 'ipr' || nomeNorm.includes('imersao prosperar') || nomeNorm.includes('imersão prosperar');
    }

    private idTurmaOrigemSql(): string {
        return `NULLIF(COALESCE(
            contrato.dados_contrato->>'fluxo_evento_origem_id_turma',
            contrato.dados_contrato->>'id_turma_origem',
            contrato.dados_contrato->'turma_origem'->>'id',
            ''
        ), '')::int`;
    }

    private idTurmaDestinoSql(): string {
        return `NULLIF(COALESCE(
            contrato.dados_contrato->>'fluxo_evento_destino_id_turma',
            contrato.dados_contrato->>'id_turma_destino',
            contrato.dados_contrato->'turma'->>'id',
            tat.id_turma_destino::text,
            ta.id_turma::text,
            ''
        ), '')::int`;
    }

    private async carregarLinhasContratos(dataInicio: Date, dataFim: Date, turmaId?: number | null): Promise<LinhaContratoRaw[]> {
        const idTurmaOrigem = this.idTurmaOrigemSql();
        const idTurmaDestino = this.idTurmaDestinoSql();

        const qb = this.uow.turmasAlunosTreinamentosContratosRP
            .createQueryBuilder('contrato')
            .leftJoin('contrato.id_turma_aluno_treinamento_fk', 'tat')
            .leftJoin('tat.id_turma_aluno_fk', 'ta')
            .leftJoin(Turmas, 'turma_destino_evento', `turma_destino_evento.id = ${idTurmaDestino}`)
            .leftJoin('turma_destino_evento.id_treinamento_fk', 'treinamento_destino_evento')
            .where('contrato.deletado_em IS NULL')
            .andWhere('contrato.criado_em BETWEEN :dataInicio AND :dataFim', { dataInicio, dataFim });

        if (turmaId) {
            qb.andWhere(`(${idTurmaOrigem} = :turmaId OR ${idTurmaDestino} = :turmaId OR ta.id_turma = :turmaId OR tat.id_turma_destino = :turmaId)`, {
                turmaId,
            });
        }

        const rows = await qb
            .select('contrato.id', 'id')
            .addSelect('contrato.criado_em', 'criado_em')
            .addSelect('contrato.dados_contrato', 'dados_contrato')
            .addSelect('contrato.criado_por', 'criado_por_contrato')
            .addSelect('tat.criado_por', 'criado_por_tat')
            .addSelect('ta.criado_por', 'criado_por_ta')
            .addSelect('COALESCE(ta.quantidade_inscricoes, 1)', 'quantidade_inscricoes')
            .addSelect('COALESCE(ta.pendencia_pagamento, false)', 'pendencia_pagamento')
            .addSelect('ta.id_turma', 'id_turma')
            .addSelect('tat.id_turma_destino', 'id_turma_destino')
            .addSelect('treinamento_destino_evento.sigla_treinamento', 'sigla_destino')
            .addSelect('treinamento_destino_evento.treinamento', 'nome_destino')
            .distinct(true)
            .getRawMany<LinhaContratoRaw>();

        const map = new Map<string, LinhaContratoRaw>();
        for (const row of rows) {
            const id = String(row.id || '').trim();
            if (!id || map.has(id)) continue;
            map.set(id, row);
        }
        return Array.from(map.values());
    }

    private obterCriadoPor(row: LinhaContratoRaw): string {
        const dadosContrato = this.parseJsonSeguro(row.dados_contrato);
        const criadoPorConfronto = dadosContrato?.criado_por_confronto || {};
        const candidatos = [
            criadoPorConfronto?.consolidado,
            row.criado_por_contrato,
            dadosContrato?.criado_por,
            criadoPorConfronto?.contrato,
            row.criado_por_tat,
            criadoPorConfronto?.turma_aluno_treinamento,
            row.criado_por_ta,
            criadoPorConfronto?.turma_aluno,
        ];
        for (const candidato of candidatos) {
            const id = String(candidato ?? '').trim();
            if (id) return id;
        }
        return '';
    }

    private obterIdsTurmas(row: LinhaContratoRaw): number[] {
        const dadosContrato = this.parseJsonSeguro(row.dados_contrato);
        const candidatos = [
            row.id_turma,
            row.id_turma_destino,
            dadosContrato?.fluxo_evento_origem_id_turma,
            dadosContrato?.id_turma_origem,
            dadosContrato?.turma_origem?.id,
            dadosContrato?.fluxo_evento_destino_id_turma,
            dadosContrato?.id_turma_destino,
            dadosContrato?.turma?.id,
            dadosContrato?.id_turma,
        ];
        return Array.from(new Set(candidatos.map((valor) => Number(valor)).filter((valor) => Number.isFinite(valor) && valor > 0)));
    }

    private async montarMapasTimes(
        linhas: LinhaContratoRaw[],
    ): Promise<{
        timesPorTurma: Map<number, TimeEquipeSlim[]>;
        liderPorMembroGlobal: Map<string, string>;
    }> {
        const idsTurmas = Array.from(new Set(linhas.flatMap((row) => this.obterIdsTurmas(row))));
        const timesPorTurma = new Map<number, TimeEquipeSlim[]>();

        if (idsTurmas.length > 0) {
            const turmas = await this.uow.turmasRP.find({
                where: { id: In(idsTurmas), deletado_em: IsNull() },
                relations: ['id_treinamento_fk'],
            });
            for (const turma of turmas) {
                const ehIpr = this.turmaEhImersaoProsperar(turma?.id_treinamento_fk?.sigla_treinamento, turma?.id_treinamento_fk?.treinamento);
                if (!ehIpr) {
                    timesPorTurma.set(turma.id, []);
                    continue;
                }
                const times = Array.isArray(turma.times_equipes) ? turma.times_equipes : [];
                timesPorTurma.set(
                    turma.id,
                    times.map((time) => ({
                        id: String(time.id || ''),
                        nome: String(time.nome || ''),
                        liderId: String(time.liderId || '').trim(),
                        membrosIds: Array.isArray(time.membrosIds) ? time.membrosIds.map((id) => String(id).trim()) : [],
                    })),
                );
            }
        }

        const liderPorMembroGlobal = new Map<string, string>();
        timesPorTurma.forEach((times) => {
            times.forEach((time) => {
                if (!time.liderId) return;
                liderPorMembroGlobal.set(time.liderId, time.liderId);
                time.membrosIds.forEach((membroId) => {
                    if (membroId) liderPorMembroGlobal.set(membroId, time.liderId);
                });
            });
        });

        return { timesPorTurma, liderPorMembroGlobal };
    }

    private resolverLiderId(
        row: LinhaContratoRaw,
        timesPorTurma: Map<number, TimeEquipeSlim[]>,
        liderPorMembroGlobal: Map<string, string>,
    ): string {
        const vendedorId = this.obterCriadoPor(row);
        if (!vendedorId) return '';
        const idsTurmaDaVenda = this.obterIdsTurmas(row);
        const timesDaVenda = idsTurmaDaVenda.flatMap((idTurma) => timesPorTurma.get(idTurma) || []);
        const timeDoVendedor = timesDaVenda.find((time) => time.liderId === vendedorId || time.membrosIds.includes(vendedorId));
        return timeDoVendedor?.liderId || liderPorMembroGlobal.get(vendedorId) || '';
    }

    private async enriquecerComStaffLider(linhas: LinhaContratoRaw[]): Promise<ContratoDashboardLinha[]> {
        const { timesPorTurma, liderPorMembroGlobal } = await this.montarMapasTimes(linhas);
        const liderIds = new Set<number>();

        const intermediarias = linhas.map((row) => {
            const dadosContrato = this.parseJsonSeguro(row.dados_contrato);
            const turmaAlunoSnapshot = dadosContrato?.turma_aluno || {};
            const pendencia =
                row.pendencia_pagamento === true ||
                String(row.pendencia_pagamento).toLowerCase() === 'true' ||
                Boolean(turmaAlunoSnapshot?.pendencia_pagamento);
            const quantidade =
                Number(turmaAlunoSnapshot?.quantidade_inscricoes ?? row.quantidade_inscricoes ?? 1) || 1;
            const liderId = this.resolverLiderId(row, timesPorTurma, liderPorMembroGlobal);
            if (liderId) {
                const n = Number(liderId);
                if (Number.isFinite(n) && n > 0) liderIds.add(n);
            }

            // Enriquece dados_contrato com sigla/nome do destino quando faltarem no JSON.
            if (!dadosContrato.treinamento) dadosContrato.treinamento = {};
            if (!dadosContrato.treinamento.sigla_treinamento && row.sigla_destino) {
                dadosContrato.treinamento.sigla_treinamento = row.sigla_destino;
            }
            if (!dadosContrato.treinamento.treinamento && !dadosContrato.treinamento.nome && row.nome_destino) {
                dadosContrato.treinamento.treinamento = row.nome_destino;
            }

            return {
                id: String(row.id),
                criado_em: row.criado_em,
                deletado_em: null,
                status: dadosContrato?.zapsign_document_status?.status || null,
                dados_contrato: dadosContrato,
                pendencia_pagamento: pendencia,
                quantidade_inscricoes: quantidade,
                lider_id: liderId || null,
                lider_nome: null as string | null,
                ids_turma: this.obterIdsTurmas(row),
            } satisfies ContratoDashboardLinha;
        });

        const nomePorId = new Map<number, string>();
        if (liderIds.size > 0) {
            const usuarios = await this.uow.usuariosRP.find({
                where: { id: In(Array.from(liderIds)), deletado_em: IsNull() },
                select: { id: true, nome: true, primeiro_nome: true, sobrenome: true },
            });
            for (const usuario of usuarios) {
                nomePorId.set(
                    usuario.id,
                    usuario.nome || `${usuario.primeiro_nome || ''} ${usuario.sobrenome || ''}`.trim() || `Usuário ${usuario.id}`,
                );
            }
        }

        return intermediarias.map((item) => ({
            ...item,
            lider_nome: item.lider_id ? nomePorId.get(Number(item.lider_id)) || `Líder ${item.lider_id}` : null,
        }));
    }

    private async getContadoresPorTurmas(
        turmaIds: number[],
    ): Promise<Record<number, { alunos_total: number; alunos_confirmados: number; presentes: number }>> {
        if (!turmaIds.length) return {};

        const result: Record<number, { alunos_total: number; alunos_confirmados: number; presentes: number }> = {};
        for (const id of turmaIds) {
            result[id] = { alunos_total: 0, alunos_confirmados: 0, presentes: 0 };
        }

        const stConfirm = [EStatusAlunosTurmas.CHECKIN_REALIZADO, EStatusAlunosTurmas.AGUARDANDO_CHECKIN];
        const raw = await this.uow.turmasAlunosRP
            .createQueryBuilder('ta')
            .leftJoin('ta.id_aluno_fk', 'aluno')
            .where('ta.deletado_em IS NULL')
            .andWhere('ta.id_turma IN (:...ids)', { ids: turmaIds })
            .select('ta.id_turma', 'id_turma')
            .addSelect('COUNT(*)::int', 'total')
            .addSelect(
                `SUM(CASE WHEN ta.id_turma_transferencia_para IS NULL AND ta.status_aluno_turma IN (:...stConfirm) THEN 1 ELSE 0 END)::int`,
                'confirmados',
            )
            .addSelect(
                `SUM(CASE WHEN ta.presenca_turma = :pres AND (aluno.status_aluno_geral IS NULL OR aluno.status_aluno_geral <> :inad) THEN 1 ELSE 0 END)::int`,
                'presentes',
            )
            .setParameter('stConfirm', stConfirm)
            .setParameter('pres', EPresencaTurmas.PRESENTE)
            .setParameter('inad', EStatusAlunosGeral.INADIMPLENTE)
            .groupBy('ta.id_turma')
            .getRawMany();

        for (const row of raw) {
            const id = Number(row.id_turma);
            result[id] = {
                alunos_total: Number(row.total ?? 0),
                alunos_confirmados: Number(row.confirmados ?? 0),
                presentes: Number(row.presentes ?? 0),
            };
        }

        return result;
    }

    private async carregarTurmasParaRanking(opts: {
        evento: CodigoEventoDashboard | null;
        turmaId: number | null;
        dataInicio: Date;
        dataFim: Date;
        contratos: ContratoDashboardLinha[];
    }): Promise<TurmaRankingInput[]> {
        const idsDosContratos = new Set<number>();
        for (const c of opts.contratos) {
            for (const id of c.ids_turma) idsDosContratos.add(id);
        }

        const turmas = await this.uow.turmasRP.find({
            where: { deletado_em: IsNull() },
            relations: ['id_treinamento_fk', 'id_polo_fk'],
            select: {
                id: true,
                edicao_turma: true,
                cidade: true,
                data_inicio: true,
                id_treinamento_fk: {
                    id: true,
                    treinamento: true,
                    sigla_treinamento: true,
                    tipo_mentoria: true,
                },
                id_polo_fk: {
                    id: true,
                    sigla_polo: true,
                    polo: true,
                },
            },
        });

        const inicioMs = opts.dataInicio.getTime();
        const fimMs = opts.dataFim.getTime();

        let candidatas = turmas
            .filter((t) => t.id_treinamento_fk?.tipo_mentoria !== true)
            .map((t) => {
                const codigoEvento = codigoEventoDashboard(t.id_treinamento_fk?.treinamento, t.id_treinamento_fk?.sigla_treinamento);
                const dataInicioMs = t.data_inicio ? new Date(t.data_inicio).getTime() : null;
                return {
                    id: t.id,
                    label: rotuloTurmaIamControl({
                        id: t.id,
                        edicao_turma: t.edicao_turma,
                        cidade: t.cidade,
                        polo: t.id_polo_fk
                            ? { sigla_polo: t.id_polo_fk.sigla_polo, nome: t.id_polo_fk.polo }
                            : null,
                        treinamento: t.id_treinamento_fk,
                    }),
                    codigoEvento,
                    dataInicioMs: dataInicioMs != null && !Number.isNaN(dataInicioMs) ? dataInicioMs : null,
                };
            })
            .filter((t) => {
                if (!t.codigoEvento) return false;
                if (opts.evento && t.codigoEvento !== opts.evento) return false;
                if (opts.turmaId && t.id !== opts.turmaId) return false;
                if (idsDosContratos.has(t.id)) return true;
                if (t.dataInicioMs == null) return false;
                return t.dataInicioMs >= inicioMs && t.dataInicioMs <= fimMs;
            });

        // Dom Manhã / rankings: se filtro de turma, só ela; senão limitamos impacto.
        if (!opts.turmaId) {
            candidatas = candidatas.sort((a, b) => (b.dataInicioMs || 0) - (a.dataInicioMs || 0));
        }

        const contadores = await this.getContadoresPorTurmas(candidatas.map((t) => t.id));

        return candidatas.map((t) => ({
            id: t.id,
            label: t.label,
            codigoEvento: t.codigoEvento,
            alunosCount: contadores[t.id]?.alunos_total || 0,
            confirmadosCount: contadores[t.id]?.alunos_confirmados || 0,
            presentesCount: contadores[t.id]?.presentes || 0,
        }));
    }

    /**
     * Aquisição por evento: mesma partição do status-resumo, filtrada por
     * `turmas_alunos.criado_em` no período (inserido_em).
     */
    private async agregarAquisicaoPorEvento(opts: {
        dataInicio: Date;
        dataFim: Date;
        evento: CodigoEventoDashboard | null;
        turmaId: number | null;
        turmas: TurmaRankingInput[];
    }): Promise<Record<CodigoEventoDashboard, ReturnType<typeof agregarEstrategiasAquisicao>>> {
        const resultado = criarMapaAquisicaoVazio();
        const turmaIds = opts.turmas.map((t) => t.id);
        if (turmaIds.length === 0) return resultado;

        const eventoPorTurma = new Map<number, CodigoEventoDashboard>();
        for (const t of opts.turmas) {
            if (t.codigoEvento) eventoPorTurma.set(t.id, t.codigoEvento);
        }

        const origemAlunoSql = `UPPER(TRIM(COALESCE(ta.origem_aluno::text, '')))`;
        const codigoPlanilhaSql = `UPPER(TRIM(COALESCE(ta.codigo_turma_origem_planilha, '')))`;
        const histTimeVendasSql = `(
            EXISTS (
                SELECT 1
                FROM historico_transferencias_alunos h
                WHERE h.id_turma_aluno_para = ta.id
                  AND h.id_turma_para = ta.id_turma
                  AND h.id_turma_de = ta.id_turma
                  AND h.deletado_em IS NULL
            )
        )`;
        const origemEhMcSql = `(
            COALESCE((
                SELECT (
                    (tr.tipo_palestra = true OR tr.tipo_treinamento = false)
                    OR (t_de.edicao_turma IS NOT NULL AND LEFT(UPPER(TRIM(t_de.edicao_turma)), 3) = 'MC_')
                )
                FROM historico_transferencias_alunos h
                INNER JOIN turmas t_de ON t_de.id = h.id_turma_de
                INNER JOIN treinamentos tr ON tr.id = t_de.id_treinamento
                WHERE h.id_turma_aluno_para = ta.id
                  AND h.id_turma_para = ta.id_turma
                  AND h.id_turma_de <> ta.id_turma
                  AND h.deletado_em IS NULL
                ORDER BY h.id DESC
                LIMIT 1
            ), false)
            OR (
                ta.id_turma_transferencia_de IS NOT NULL
                AND EXISTS (
                    SELECT 1
                    FROM turmas t_td
                    INNER JOIN treinamentos tr_td ON tr_td.id = t_td.id_treinamento
                    WHERE t_td.id = ta.id_turma_transferencia_de
                      AND t_td.deletado_em IS NULL
                      AND (
                          tr_td.tipo_palestra = true
                          OR tr_td.tipo_treinamento = false
                          OR (t_td.edicao_turma IS NOT NULL AND LEFT(UPPER(TRIM(t_td.edicao_turma)), 3) = 'MC_')
                      )
                )
            )
            OR (
                ta.codigo_turma_origem_planilha IS NOT NULL
                AND LEFT(UPPER(TRIM(ta.codigo_turma_origem_planilha)), 3) = 'MC_'
            )
        )`;

        const canalSql = `CASE
            WHEN ${origemAlunoSql} = 'PRESENTE' THEN 'Presente'
            WHEN COALESCE(ta.vaga_bonus, false) = true OR ${origemAlunoSql} = 'ALUNO_BONUS' THEN 'Bônus'
            WHEN ${origemAlunoSql} IN ('CORTESIA', 'SORTEIO') THEN 'Cortesia/Sorteio'
            WHEN ${histTimeVendasSql} THEN 'Time de Vendas'
            WHEN ${codigoPlanilhaSql} = 'TRANSBORDO' THEN 'Transbordo'
            WHEN ${codigoPlanilhaSql} = 'LIBERTY' THEN 'Liberty'
            WHEN ${origemEhMcSql} THEN 'Masterclass'
            WHEN ${origemAlunoSql} = 'TRANSFERENCIA' THEN 'Transferência'
            ELSE 'Vendas em Eventos'
        END`;

        const rows = await this.uow.turmasAlunosRP
            .createQueryBuilder('ta')
            .select('ta.id_turma', 'id_turma')
            .addSelect(canalSql, 'canal')
            .addSelect('COUNT(*)::int', 'quantidade')
            .where('ta.deletado_em IS NULL')
            .andWhere('ta.id_turma IN (:...turmaIds)', { turmaIds })
            .andWhere('ta.criado_em BETWEEN :dataInicio AND :dataFim', {
                dataInicio: opts.dataInicio,
                dataFim: opts.dataFim,
            })
            .groupBy('ta.id_turma')
            .addGroupBy(canalSql)
            .getRawMany<{ id_turma: string | number; canal: string; quantidade: string | number }>();

        const porEvento = new Map<CodigoEventoDashboard, Array<{ canal: string; quantidade: number }>>();
        for (const evento of EVENTOS_DASHBOARD) {
            porEvento.set(evento, []);
        }

        for (const row of rows) {
            const idTurma = Number(row.id_turma);
            const evento = eventoPorTurma.get(idTurma);
            if (!evento) continue;
            if (opts.evento && evento !== opts.evento) continue;
            if (opts.turmaId && idTurma !== opts.turmaId) continue;
            porEvento.get(evento)!.push({
                canal: String(row.canal || 'Vendas em Eventos'),
                quantidade: Number(row.quantidade || 0),
            });
        }

        for (const evento of EVENTOS_DASHBOARD) {
            resultado[evento] = agregarEstrategiasAquisicao(porEvento.get(evento) || []);
        }

        return resultado;
    }
}
