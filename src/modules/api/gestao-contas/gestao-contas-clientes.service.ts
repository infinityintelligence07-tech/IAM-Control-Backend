import { Injectable, Logger } from '@nestjs/common';
import { In } from 'typeorm';

import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { type_schema } from '../../config/database/typeORM.provider';
import { Alunos } from '../../config/entities/alunos.entity';
import { TurmasAlunos } from '../../config/entities/turmasAlunos.entity';
import { EStatusAlunosGeral } from '../../config/entities/enum';
import { montarChaveIdentidade } from './identidade-cliente';
import {
    ClienteGestaoContasDto,
    ClienteMatriculaDto,
    ClienteTreinamentoDto,
    ClientesGestaoContasResponseDto,
    GetClientesGestaoContasDto,
    LIMITE_MAXIMO_CLIENTES,
    LIMITE_PADRAO_CLIENTES,
} from './dto/gestao-contas-clientes.dto';

/** Tolerância em reais para tratar um saldo residual de arredondamento como quitado. */
const TOLERANCIA_SALDO = 0.01;

const EPOCH_ISO = new Date(0).toISOString();

/**
 * Webhook de saída: expõe os clientes do IAM Control para a Gestão de Contas
 * (app Lovable `gestaocontasiam`), que consome este endpoint em modo pull.
 *
 * O payload já traz `chave_dedupe` normalizada (telefone + e-mail + nome) para
 * que o outro lado consiga casar cadastros pré-existentes sem duplicar.
 */
@Injectable()
export class GestaoContasClientesService {
    private readonly logger = new Logger(GestaoContasClientesService.name);

    constructor(private readonly uow: UnitOfWorkService) {}

    async getClientes(filtros: GetClientesGestaoContasDto): Promise<ClientesGestaoContasResponseDto> {
        const inicioRequisicao = new Date();
        const page = filtros.page ?? 1;
        const limit = Math.min(filtros.limit ?? LIMITE_PADRAO_CLIENTES, LIMITE_MAXIMO_CLIENTES);

        const [alunos, total] = await this.buscarAlunos(filtros, page, limit);
        const matriculasPorAluno = await this.buscarMatriculas(alunos.map((aluno) => aluno.id));

        const clientes = alunos.map((aluno) => this.mapCliente(aluno, matriculasPorAluno.get(aluno.id) ?? []));

        this.logger.log(
            `gestao-contas.clientes | page=${page} limit=${limit} total=${total} retornados=${clientes.length} ` +
                `desde=${filtros.atualizado_desde ?? 'inicio'}`,
        );

        return {
            total,
            page,
            limit,
            total_pages: Math.max(1, Math.ceil(total / limit)),
            sincronizado_ate: inicioRequisicao.toISOString(),
            clientes,
        };
    }

    private async buscarAlunos(filtros: GetClientesGestaoContasDto, page: number, limit: number): Promise<[Alunos[], number]> {
        const query = this.uow.alunosRP
            .createQueryBuilder('aluno')
            .leftJoinAndSelect('aluno.id_polo_fk', 'polo')
            .where('aluno.deletado_em IS NULL');

        if (filtros.id_polo !== undefined) {
            query.andWhere('aluno.id_polo = :id_polo', { id_polo: filtros.id_polo });
        }

        // Uma venda pode mudar sem que o cadastro do aluno seja tocado, então o
        // recorte incremental também olha para matrículas e treinamentos.
        if (filtros.atualizado_desde) {
            query.andWhere(
                `(
                    aluno.atualizado_em >= :desde
                    OR EXISTS (
                        SELECT 1
                        FROM ${type_schema}.turmas_alunos ta
                        LEFT JOIN ${type_schema}.turmas_alunos_treinamentos tat
                            ON tat.id_turma_aluno = ta.id AND tat.deletado_em IS NULL
                        WHERE ta.id_aluno = aluno.id
                          AND ta.deletado_em IS NULL
                          AND (ta.atualizado_em >= :desde OR tat.atualizado_em >= :desde)
                    )
                )`,
                { desde: new Date(filtros.atualizado_desde) },
            );
        }

        if (filtros.somente_inadimplentes) {
            query.andWhere(
                `(
                    aluno.status_aluno_geral = :statusInadimplente
                    OR EXISTS (
                        SELECT 1
                        FROM ${type_schema}.turmas_alunos ta
                        JOIN ${type_schema}.turmas_alunos_treinamentos tat
                            ON tat.id_turma_aluno = ta.id AND tat.deletado_em IS NULL
                        WHERE ta.id_aluno = aluno.id
                          AND ta.deletado_em IS NULL
                          AND tat.preco_total_pago < tat.preco_treinamento - :tolerancia
                    )
                )`,
                { statusInadimplente: EStatusAlunosGeral.INADIMPLENTE, tolerancia: TOLERANCIA_SALDO },
            );
        }

        return query
            .orderBy('aluno.atualizado_em', 'ASC')
            .addOrderBy('aluno.id', 'ASC')
            .skip((page - 1) * limit)
            .take(limit)
            .getManyAndCount();
    }

    /** Carrega as matrículas (e as vendas de cada uma) dos alunos da página atual. */
    private async buscarMatriculas(idsAlunos: number[]): Promise<Map<number, TurmasAlunos[]>> {
        const agrupadas = new Map<number, TurmasAlunos[]>();
        if (idsAlunos.length === 0) return agrupadas;

        const matriculas = await this.uow.turmasAlunosRP.find({
            where: { id_aluno: In(idsAlunos.map(String)), deletado_em: null },
            relations: ['turmasAlunosTreinamentos', 'turmasAlunosTreinamentos.id_treinamento_fk'],
            order: { criado_em: 'ASC' },
        });

        for (const matricula of matriculas) {
            const idAluno = Number(matricula.id_aluno);
            const lista = agrupadas.get(idAluno);
            if (lista) {
                lista.push(matricula);
            } else {
                agrupadas.set(idAluno, [matricula]);
            }
        }

        return agrupadas;
    }

    private mapCliente(aluno: Alunos, matriculas: TurmasAlunos[]): ClienteGestaoContasDto {
        const matriculasDto = matriculas.map((matricula) => this.mapMatricula(matricula));

        const valorTotalContratado = this.somar(matriculasDto, (treinamento) => treinamento.valor_total);
        const valorTotalPago = this.somar(matriculasDto, (treinamento) => treinamento.valor_pago);
        const valorPendente = this.arredondar(Math.max(0, valorTotalContratado - valorTotalPago));

        return {
            iam_control_aluno_id: aluno.id,
            nome: aluno.nome,
            email: aluno.email || null,
            cpf: aluno.cpf || null,
            whatsapp: aluno.telefone_um || null,
            telefone_secundario: aluno.telefone_dois || null,
            data_nascimento: aluno.data_nascimento || null,
            endereco: {
                cep: aluno.cep || null,
                logradouro: aluno.logradouro || null,
                numero: aluno.numero || null,
                complemento: aluno.complemento || null,
                bairro: aluno.bairro || null,
                cidade: aluno.cidade || null,
                estado: aluno.estado || null,
            },
            polo: aluno.id_polo_fk
                ? {
                      id: aluno.id_polo_fk.id,
                      nome: aluno.id_polo_fk.polo,
                      sigla: aluno.id_polo_fk.sigla_polo ?? null,
                      cidade: aluno.id_polo_fk.cidade ?? null,
                      estado: aluno.id_polo_fk.estado ?? null,
                  }
                : null,
            status_iam_control: aluno.status_aluno_geral ?? null,
            financeiro: {
                valor_total_contratado: this.arredondar(valorTotalContratado),
                valor_total_pago: this.arredondar(valorTotalPago),
                valor_pendente: valorPendente,
                inadimplente: valorPendente > TOLERANCIA_SALDO || aluno.status_aluno_geral === EStatusAlunosGeral.INADIMPLENTE,
            },
            matriculas: matriculasDto,
            chave_dedupe: montarChaveIdentidade({
                nome: aluno.nome,
                email: aluno.email,
                telefone: aluno.telefone_um,
            }),
            criado_em: aluno.criado_em?.toISOString() ?? EPOCH_ISO,
            atualizado_em: aluno.atualizado_em?.toISOString() ?? EPOCH_ISO,
        };
    }

    private mapMatricula(matricula: TurmasAlunos): ClienteMatriculaDto {
        const treinamentos = (matricula.turmasAlunosTreinamentos ?? [])
            .filter((treinamento) => !treinamento.deletado_em)
            .map<ClienteTreinamentoDto>((treinamento) => ({
                id_treinamento: treinamento.id_treinamento,
                nome: treinamento.id_treinamento_fk?.treinamento ?? '',
                sigla: treinamento.id_treinamento_fk?.sigla_treinamento ?? null,
                valor_total: this.arredondar(treinamento.preco_treinamento ?? 0),
                valor_pago: this.arredondar(treinamento.preco_total_pago ?? 0),
                valor_pendente: this.arredondar(Math.max(0, (treinamento.preco_treinamento ?? 0) - (treinamento.preco_total_pago ?? 0))),
                formas_pagamento: (treinamento.forma_pgto ?? []).map((pagamento) => ({
                    forma: pagamento.forma,
                    valor: this.arredondar(pagamento.valor ?? 0),
                })),
                data_venda: treinamento.criado_em?.toISOString() ?? null,
            }));

        return {
            id_matricula: String(matricula.id),
            id_turma: matricula.id_turma,
            status_aluno_turma: matricula.status_aluno_turma ?? null,
            pendencia_pagamento: matricula.pendencia_pagamento ?? null,
            origem_aluno: matricula.origem_aluno ?? null,
            data_matricula: matricula.criado_em?.toISOString() ?? null,
            treinamentos,
        };
    }

    private somar(matriculas: ClienteMatriculaDto[], seletor: (treinamento: ClienteTreinamentoDto) => number): number {
        return matriculas.reduce(
            (totalMatriculas, matricula) =>
                totalMatriculas + matricula.treinamentos.reduce((totalTreinamentos, treinamento) => totalTreinamentos + seletor(treinamento), 0),
            0,
        );
    }

    private arredondar(valor: number): number {
        return Math.round((valor + Number.EPSILON) * 100) / 100;
    }
}
