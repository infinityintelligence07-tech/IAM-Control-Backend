import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { EFuncoes, EOrigemAlunos, EStatusAlunosTurmas, EPresencaTurmas, EStatusTurmas, EStatusAlunosGeral } from '../../config/entities/enum';
import {
    GetTurmasDto,
    CreateTurmaDto,
    UpdateTurmaDto,
    AddAlunoTurmaDto,
    UpdateAlunoTurmaDto,
    TurmasListResponseDto,
    TurmaResponseDto,
    AlunosTurmaListResponseDto,
    AlunoTurmaResponseDto,
    AlunosDisponiveisResponseDto,
    TurmaStatusResumoResponseDto,
    TurmaStatusAlunosResponseDto,
    TurmaStatusAlunosItemDto,
    SoftDeleteTurmaDto,
    OpcoesTransferenciaResponseDto,
    HistoricoTransferenciaItemDto,
    HistoricoTransferenciasResponseDto,
} from './dto/turmas.dto';
import { FindManyOptions, ILike, Not, In } from 'typeorm';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class TurmasService {
    constructor(
        private readonly uow: UnitOfWorkService,
        private readonly whatsappService: WhatsAppService,
    ) {}

    /** Mapeia entidade Turmas (com relações id_treinamento_fk e id_polo_fk) para o objeto de tag de transferência. */
    private mapTurmaToTransferenciaTag(
        turma: any,
    ):
        | { id: number; edicao_turma?: string; data_inicio: string; data_final: string; treinamento_nome?: string; sigla_treinamento?: string; polo_nome?: string }
        | undefined {
        if (!turma) return undefined;
        return {
            id: turma.id,
            edicao_turma: turma.edicao_turma ?? undefined,
            data_inicio: turma.data_inicio ?? '',
            data_final: turma.data_final ?? '',
            treinamento_nome: turma.id_treinamento_fk?.treinamento ?? undefined,
            sigla_treinamento: turma.id_treinamento_fk?.sigla_treinamento ?? undefined,
            polo_nome: turma.id_polo_fk?.polo ?? undefined,
        };
    }

    private isAlunoTransferidoDaTurma(turmaAluno: any): boolean {
        return turmaAluno?.id_turma_transferencia_para !== null && turmaAluno?.id_turma_transferencia_para !== undefined;
    }

    private isAlunoConfirmadoNaTurma(turmaAluno: any): boolean {
        if (!turmaAluno) return false;
        if (this.isAlunoTransferidoDaTurma(turmaAluno)) return false;

        return [EStatusAlunosTurmas.CHECKIN_REALIZADO, EStatusAlunosTurmas.AGUARDANDO_CHECKIN].includes(turmaAluno.status_aluno_turma as EStatusAlunosTurmas);
    }

    private async getTransferidosCountByTurmas(turmaIds: number[]): Promise<Record<number, number>> {
        if (!turmaIds.length) return {};

        const raw = await this.uow.historicoTransferenciasRP
            .createQueryBuilder('h')
            .select('h.id_turma_de', 'id_turma_de')
            .addSelect('COUNT(*)::int', 'total')
            .where('h.id_turma_de IN (:...turmaIds)', { turmaIds })
            .andWhere('h.id_turma_de <> h.id_turma_para')
            .andWhere('h.deletado_em IS NULL')
            .groupBy('h.id_turma_de')
            .getRawMany();

        const map: Record<number, number> = {};
        for (const row of raw) {
            const id = Number(row.id_turma_de);
            map[id] = Number(row.total || 0);
        }
        return map;
    }

    /**
     * Formatar data para o formato YYYY-MM-DD (apenas data, sem hora)
     */
    private formatDateToDateOnly(dateString: string): string {
        if (!dateString) return dateString;

        // Se já está no formato YYYY-MM-DD, retornar como está
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
            return dateString;
        }

        // Tentar parsear a data e formatar
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) {
                return dateString; // Retornar original se inválida
            }
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        } catch (error) {
            console.error('Erro ao formatar data:', error);
            return dateString; // Retornar original em caso de erro
        }
    }

    /**
     * Verificar e atualizar automaticamente o status da turma para ENCERRADA
     * quando necessário (data atual > data_final OU (data atual >= data_inicio E expectativa_real >= capacidade_sala))
     */
    private async verificarEAtualizarStatusTurma(turma: any): Promise<void> {
        try {
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);

            const dataInicio = new Date(turma.data_inicio);
            dataInicio.setHours(0, 0, 0, 0);

            const dataFinal = new Date(turma.data_final);
            dataFinal.setHours(23, 59, 59, 999);

            // Verificar se a data atual é maior ou igual à data de início (evento já começou)
            const eventoJaComecou = hoje >= dataInicio;

            // Verificar se a data atual é maior que a data final (evento já terminou)
            const eventoJaTerminou = hoje > dataFinal;

            // Se o evento ainda não começou, não encerrar (e se estiver encerrada, reabrir)
            if (!eventoJaComecou && !eventoJaTerminou) {
                if (turma.status_turma === EStatusTurmas.ENCERRADA) {
                    // Reabrir turma se foi encerrada incorretamente antes do evento começar
                    turma.status_turma = EStatusTurmas.INSCRICOES_ABERTAS;
                    turma.atualizado_em = new Date();
                    await this.uow.turmasRP.save(turma);
                    console.log(`✅ Turma ${turma.id} reaberta automaticamente. Evento ainda não começou (data_inicio: ${turma.data_inicio})`);
                }
                return;
            }

            // Se já está encerrada e o evento já começou/terminou, não precisa verificar mais
            if (turma.status_turma === EStatusTurmas.ENCERRADA) {
                return;
            }

            // Calcular expectativa real
            const inscritos = turma.turmasAlunos?.length || 0;
            const alunosBonus = turma.detalhamento_bonus?.length || 0;
            const isIPR = turma.id_treinamento_fk?.sigla_treinamento === 'IPR';
            const expectativaReal = isIPR ? Math.round(inscritos + (alunosBonus - alunosBonus * 0.5) - inscritos * 0.1) : inscritos;

            // Verificar se expectativa real é maior ou igual à capacidade (turma cheia)
            const turmaCheia = expectativaReal >= turma.capacidade_turma;

            // Encerrar a turma se:
            // 1. O evento já terminou (data atual > data_final), OU
            // 2. O evento já começou (data atual >= data_inicio) E a turma está cheia (expectativa real >= capacidade)
            if (eventoJaTerminou || (eventoJaComecou && turmaCheia)) {
                turma.status_turma = EStatusTurmas.ENCERRADA;
                turma.turma_aberta = false; // Desmarcar credenciamento quando encerrar
                turma.atualizado_em = new Date();
                await this.uow.turmasRP.save(turma);

                let motivo = '';
                if (eventoJaTerminou) {
                    motivo = 'Evento já terminou';
                } else if (turmaCheia && eventoJaComecou) {
                    motivo = 'Turma cheia (expectativa real >= capacidade) e evento já começou';
                }

                console.log(`✅ Turma ${turma.id} atualizada automaticamente para ENCERRADA. Motivo: ${motivo}`);
            }
        } catch (error) {
            console.error(`Erro ao verificar status da turma ${turma.id}:`, error);
            // Não lançar erro para não interromper o fluxo principal
        }
    }

    /**
     * Buscar contadores de pré-cadastrados por turmas
     */
    private async getPreCadastrosCountByTurmas(turmasIds: number[]): Promise<Record<number, { total: number; presentes: number }>> {
        if (!turmasIds.length) return {};

        try {
            console.log(`🔍 [getPreCadastrosCountByTurmas] Buscando pré-cadastros para turmas:`, turmasIds);

            const preCadastros = await this.uow.masterclassPreCadastrosRP.find({
                where: {
                    id_turma: In(turmasIds),
                    deletado_em: null,
                },
            });

            console.log(`📊 [getPreCadastrosCountByTurmas] Total de pré-cadastros encontrados: ${preCadastros.length}`);

            const counts: Record<number, { total: number; presentes: number }> = {};

            preCadastros.forEach((pc) => {
                if (!counts[pc.id_turma]) {
                    counts[pc.id_turma] = { total: 0, presentes: 0 };
                }
                counts[pc.id_turma].total++;
                if (pc.presente) {
                    counts[pc.id_turma].presentes++;
                }
            });

            console.log(`✅ [getPreCadastrosCountByTurmas] Contadores por turma:`, counts);

            return counts;
        } catch (error) {
            console.error('❌ [getPreCadastrosCountByTurmas] Erro ao buscar contadores de pré-cadastrados:', error);
            return {};
        }
    }

    /**
     * Buscar usuários líderes para seleção em turmas
     */
    async getUsuariosLideres(): Promise<{ id: number; nome: string; email: string; cpf: string | null; telefone: string; funcao: string[] }[]> {
        try {
            // Usando query builder para trabalhar com arrays do PostgreSQL
            const usuarios = await this.uow.usuariosRP
                .createQueryBuilder('usuario')
                .where('usuario.funcao && :funcoes', { funcoes: [EFuncoes.LIDER, EFuncoes.LIDER_DE_EVENTOS, EFuncoes.ADMINISTRADOR] })
                .andWhere('usuario.deletado_em IS NULL')
                .select(['usuario.id', 'usuario.nome', 'usuario.email', 'usuario.cpf', 'usuario.telefone', 'usuario.funcao'])
                .getMany();

            return usuarios.map((usuario) => ({
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                cpf: usuario.cpf,
                telefone: usuario.telefone,
                funcao: usuario.funcao,
            }));
        } catch (error) {
            console.error('Erro ao buscar usuários líderes:', error);
            throw new BadRequestException('Erro ao buscar usuários líderes');
        }
    }

    async findAll(filters: GetTurmasDto): Promise<TurmasListResponseDto> {
        const { page = 1, limit = 10, edicao_turma, status_turma, id_polo, id_treinamento, tipo_treinamento, data_inicio, data_final } = filters;

        console.log('Filtros recebidos:', filters);

        try {
            let turmas: any[];
            let total: number;

            // Se houver filtros de data, usar QueryBuilder para condições mais complexas
            if (data_inicio || data_final) {
                const queryBuilder = this.uow.turmasRP
                    .createQueryBuilder('turma')
                    .leftJoinAndSelect('turma.id_polo_fk', 'polo', 'polo.deletado_em IS NULL')
                    .leftJoinAndSelect('turma.id_treinamento_fk', 'treinamento', 'treinamento.deletado_em IS NULL')
                    .leftJoinAndSelect('turma.lider_evento_fk', 'lider', 'lider.deletado_em IS NULL')
                    .leftJoinAndSelect('turma.turmasAlunos', 'turmasAlunos', 'turmasAlunos.deletado_em IS NULL')
                    .leftJoinAndSelect('turmasAlunos.id_aluno_fk', 'aluno', 'aluno.deletado_em IS NULL')
                    .where('turma.deletado_em IS NULL');

                // Aplicar filtros básicos
                if (edicao_turma) {
                    queryBuilder.andWhere('turma.edicao_turma ILIKE :edicao_turma', { edicao_turma: `%${edicao_turma}%` });
                }

                if (status_turma) {
                    queryBuilder.andWhere('turma.status_turma = :status_turma', { status_turma });
                }

                if (id_polo) {
                    queryBuilder.andWhere('turma.id_polo = :id_polo', { id_polo });
                }

                if (id_treinamento) {
                    queryBuilder.andWhere('turma.id_treinamento = :id_treinamento', { id_treinamento });
                }

                // Aplicar filtros de data
                // Buscar turmas que tenham sobreposição com o intervalo especificado
                // Uma turma está no intervalo se: data_inicio_turma <= data_final_filtro E data_final_turma >= data_inicio_filtro
                if (data_inicio && data_final) {
                    queryBuilder.andWhere('turma.data_inicio <= :data_final', { data_final });
                    queryBuilder.andWhere('turma.data_final >= :data_inicio', { data_inicio });
                } else if (data_inicio) {
                    // Apenas data início: buscar turmas que terminem depois ou na data inicial
                    queryBuilder.andWhere('turma.data_final >= :data_inicio', { data_inicio });
                } else if (data_final) {
                    // Apenas data final: buscar turmas que comecem antes ou na data final
                    queryBuilder.andWhere('turma.data_inicio <= :data_final', { data_final });
                }

                queryBuilder.orderBy('turma.criado_em', 'DESC');
                queryBuilder.skip((page - 1) * limit);
                queryBuilder.take(limit);

                [turmas, total] = await queryBuilder.getManyAndCount();
            } else {
                // Sem filtros de data, usar o método padrão
                const whereConditions: any = {};

                if (edicao_turma) {
                    whereConditions.edicao_turma = ILike(`%${edicao_turma}%`);
                }

                if (status_turma) {
                    whereConditions.status_turma = status_turma;
                }

                if (id_polo) {
                    whereConditions.id_polo = id_polo;
                }

                if (id_treinamento) {
                    whereConditions.id_treinamento = id_treinamento;
                }

                whereConditions.deletado_em = null;

                const findOptions: FindManyOptions = {
                    where: whereConditions,
                    relations: ['id_polo_fk', 'id_treinamento_fk', 'lider_evento_fk', 'turmasAlunos', 'turmasAlunos.id_aluno_fk'],
                    order: {
                        criado_em: 'DESC',
                    },
                    skip: (page - 1) * limit,
                    take: limit,
                };

                console.log('Opções de busca:', JSON.stringify(findOptions, null, 2));

                [turmas, total] = await this.uow.turmasRP.findAndCount(findOptions);
            }

            console.log(`Encontradas ${turmas.length} turmas de um total de ${total}`);

            // Segurança: garante que vínculos soft-deletados não entrem em listas/métricas.
            for (const turma of turmas) {
                if (Array.isArray(turma?.turmasAlunos)) {
                    turma.turmasAlunos = turma.turmasAlunos.filter((ta: any) => !ta?.deletado_em);
                }
            }

            // Filtrar por tipo de treinamento se especificado
            let turmasFiltradas = turmas;
            if (tipo_treinamento) {
                turmasFiltradas = turmas.filter((turma) => {
                    if (!turma.id_treinamento_fk) return false;
                    // Filtrar por tipo de treinamento baseado nos campos booleanos
                    if (tipo_treinamento === 'palestra') {
                        return turma.id_treinamento_fk.tipo_palestra === true;
                    } else if (tipo_treinamento === 'treinamento') {
                        return turma.id_treinamento_fk.tipo_treinamento === true;
                    }
                    return false;
                });
            }

            // Verificar e atualizar status das turmas automaticamente
            for (const turma of turmasFiltradas) {
                await this.verificarEAtualizarStatusTurma(turma);
            }

            // Debug: verificar turma 23
            const turma23 = turmasFiltradas.find((t) => t.id === 23);
            if (turma23) {
                console.log(`🎯 [DEBUG] Turma 23 encontrada:`);
                console.log(`  - id_treinamento: ${turma23.id_treinamento}`);
                console.log(`  - id_treinamento_fk: ${turma23.id_treinamento_fk ? 'EXISTS' : 'NULL'}`);
                if (turma23.id_treinamento_fk) {
                    console.log(`  - tipo_palestra: ${turma23.id_treinamento_fk.tipo_palestra}`);
                    console.log(`  - tipo_treinamento: ${turma23.id_treinamento_fk.tipo_treinamento}`);
                }
            } else {
                console.log(`⚠️ [DEBUG] Turma 23 NÃO encontrada nas turmas filtradas`);
            }

            // Buscar contadores de pré-cadastrados apenas para turmas de palestra/masterclass
            const turmasPalestras = turmasFiltradas.filter((t) => {
                const isPalestra = t.id_treinamento_fk?.tipo_palestra === true || t.id_treinamento_fk?.tipo_treinamento === false;
                if (t.id === 23) {
                    console.log(
                        `🎯 [DEBUG] Turma 23 - tipo_palestra: ${t.id_treinamento_fk?.tipo_palestra}, tipo_treinamento: ${t.id_treinamento_fk?.tipo_treinamento}, isPalestra: ${isPalestra}`,
                    );
                }
                return isPalestra;
            });
            const turmasPalestrasIds = turmasPalestras.map((t) => t.id);
            console.log(`🎯 [DEBUG] Turmas identificadas como palestras: ${turmasPalestrasIds.join(', ')}`);
            const preCadastrosCount = await this.getPreCadastrosCountByTurmas(turmasPalestrasIds);
            const transferidosCountByTurma = await this.getTransferidosCountByTurmas(turmasFiltradas.map((t) => t.id));

            // Transformar dados para o formato de resposta
            const turmasResponse: TurmaResponseDto[] = turmasFiltradas.map((turma) => {
                // Debug: verificar dados dos alunos
                console.log(`🔍 [DEBUG] Turma ${turma.id} - Total de alunos: ${turma.turmasAlunos?.length || 0}`);
                if (turma.turmasAlunos) {
                    turma.turmasAlunos.forEach((ta, index) => {
                        console.log(`  Aluno ${index + 1}: ID=${ta.id_aluno}, Status=${ta.id_aluno_fk?.status_aluno_geral}, Nome=${ta.id_aluno_fk?.nome}`);
                    });
                }

                return {
                    id: turma.id,
                    id_polo: turma.id_polo,
                    id_treinamento: turma.id_treinamento,
                    lider_evento: turma.lider_evento,
                    edicao_turma: turma.edicao_turma,
                    cep: turma.cep,
                    logradouro: turma.logradouro,
                    complemento: turma.complemento,
                    numero: turma.numero,
                    bairro: turma.bairro,
                    cidade: turma.cidade,
                    estado: turma.estado,
                    status_turma: turma.status_turma,
                    autorizar_bonus: turma.autorizar_bonus,
                    id_turma_bonus: turma.id_turma_bonus,
                    capacidade_turma: turma.capacidade_turma,
                    meta: turma.meta,
                    data_inicio: turma.data_inicio,
                    data_final: turma.data_final,
                    turma_aberta: turma.turma_aberta,
                    bonus_treinamentos: turma.detalhamento_bonus?.map((item) => item.id_treinamento_db) || [],
                    detalhamento_bonus: turma.detalhamento_bonus,
                    url_midia_kit: turma.url_midia_kit,
                    url_grupo_whatsapp: turma.url_grupo_whatsapp,
                    url_grupo_whatsapp_2: turma.url_grupo_whatsapp_2,
                    url_pagamento_cartao: turma.url_pagamento_cartao,
                    created_at: turma.criado_em,
                    updated_at: turma.atualizado_em,
                    polo: turma.id_polo_fk
                        ? {
                              id: turma.id_polo_fk.id,
                              nome: turma.id_polo_fk.polo,
                              cidade: turma.id_polo_fk.cidade,
                              estado: turma.id_polo_fk.estado,
                          }
                        : undefined,
                    treinamento: turma.id_treinamento_fk
                        ? {
                              id: turma.id_treinamento_fk.id,
                              nome: turma.id_treinamento_fk.treinamento,
                              tipo: turma.id_treinamento_fk.tipo_treinamento ? 'treinamento' : 'palestra',
                              sigla_treinamento: turma.id_treinamento_fk.sigla_treinamento,
                              treinamento: turma.id_treinamento_fk.treinamento,
                              url_logo_treinamento: turma.id_treinamento_fk.url_logo_treinamento,
                          }
                        : undefined,
                    lider: turma.lider_evento_fk
                        ? {
                              id: turma.lider_evento_fk.id,
                              nome: turma.lider_evento_fk.nome,
                          }
                        : undefined,
                    // Para palestras/masterclass, alunos_count = pré-cadastrados; para treinamentos, alunos_count = alunos
                    alunos_count: (() => {
                        const isPalestra = turma.id_treinamento_fk?.tipo_palestra === true || turma.id_treinamento_fk?.tipo_treinamento === false;
                        if (turma.id === 23) {
                            console.log(`🎯 [DEBUG] Turma 23 - Calculando alunos_count:`);
                            console.log(`  - isPalestra: ${isPalestra}`);
                            console.log(`  - preCadastrosCount[23]: ${JSON.stringify(preCadastrosCount[turma.id])}`);
                            console.log(`  - alunos_count será: ${isPalestra ? preCadastrosCount[turma.id]?.total || 0 : turma.turmasAlunos?.length || 0}`);
                        }
                        if (isPalestra) {
                            return preCadastrosCount[turma.id]?.total || 0;
                        }
                        return turma.turmasAlunos?.length || 0;
                    })(),
                    alunos_confirmados_count: turma.turmasAlunos?.filter((ta) => this.isAlunoConfirmadoNaTurma(ta)).length || 0,
                    transferidos_count: transferidosCountByTurma[turma.id] || 0,
                    vindos_transferencia_count:
                        turma.turmasAlunos?.filter(
                            (ta) =>
                                ta.origem_aluno === EOrigemAlunos.TRANSFERENCIA &&
                                ta.id_turma_transferencia_de !== null &&
                                ta.id_turma_transferencia_de !== undefined,
                        ).length || 0,
                    pre_cadastrados_count: preCadastrosCount[turma.id]?.total || 0,
                    presentes_count:
                        turma.turmasAlunos?.filter(
                            (ta) => ta.presenca_turma === EPresencaTurmas.PRESENTE && ta.id_aluno_fk?.status_aluno_geral !== EStatusAlunosGeral.INADIMPLENTE,
                        ).length || 0,
                    inadimplentes_count: (() => {
                        const inadimplentes = turma.turmasAlunos?.filter((ta) => ta.id_aluno_fk?.status_aluno_geral === EStatusAlunosGeral.INADIMPLENTE) || [];
                        console.log(`🔍 [DEBUG] Turma ${turma.id} - Inadimplentes encontrados: ${inadimplentes.length}`);
                        inadimplentes.forEach((ta, index) => {
                            console.log(
                                `  Inadimplente ${index + 1}: ID=${ta.id_aluno}, Status=${ta.id_aluno_fk?.status_aluno_geral}, Nome=${ta.id_aluno_fk?.nome}`,
                            );
                        });
                        return inadimplentes.length;
                    })(),
                };
            });

            return {
                data: turmasResponse,
                total: turmasFiltradas.length,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            };
        } catch (error) {
            console.error('Erro ao buscar turmas:', error);
            throw new BadRequestException('Erro ao buscar turmas');
        }
    }

    async findById(id: number): Promise<TurmaResponseDto | null> {
        try {
            const turma = await this.uow.turmasRP.findOne({
                where: { id, deletado_em: null },
                relations: ['id_polo_fk', 'id_treinamento_fk', 'lider_evento_fk', 'turmasAlunos', 'turmasAlunos.id_aluno_fk'],
            });

            if (!turma) {
                return null;
            }

            // Buscar contadores de pré-cadastrados apenas se for palestra/masterclass
            const isPalestra = turma.id_treinamento_fk?.tipo_palestra === true || turma.id_treinamento_fk?.tipo_treinamento === false;
            const preCadastrosCount = isPalestra ? await this.getPreCadastrosCountByTurmas([turma.id]) : {};
            if (Array.isArray(turma?.turmasAlunos)) {
                turma.turmasAlunos = turma.turmasAlunos.filter((ta: any) => !ta?.deletado_em);
            }
            const transferidosCountByTurma = await this.getTransferidosCountByTurmas([turma.id]);

            return {
                id: turma.id,
                id_polo: turma.id_polo,
                id_treinamento: turma.id_treinamento,
                lider_evento: turma.lider_evento,
                edicao_turma: turma.edicao_turma,
                id_endereco_evento: turma.id_endereco_evento,
                cep: turma.cep,
                logradouro: turma.logradouro,
                complemento: turma.complemento,
                numero: turma.numero,
                bairro: turma.bairro,
                cidade: turma.cidade,
                estado: turma.estado,
                status_turma: turma.status_turma,
                autorizar_bonus: turma.autorizar_bonus,
                id_turma_bonus: turma.id_turma_bonus,
                capacidade_turma: turma.capacidade_turma,
                meta: turma.meta,
                data_inicio: turma.data_inicio,
                data_final: turma.data_final,
                turma_aberta: turma.turma_aberta,
                bonus_treinamentos: turma.detalhamento_bonus?.map((item) => item.id_treinamento_db) || [],
                detalhamento_bonus: turma.detalhamento_bonus,
                url_midia_kit: turma.url_midia_kit,
                url_grupo_whatsapp: turma.url_grupo_whatsapp,
                url_grupo_whatsapp_2: turma.url_grupo_whatsapp_2,
                url_pagamento_cartao: turma.url_pagamento_cartao,
                created_at: turma.criado_em,
                updated_at: turma.atualizado_em,
                polo: turma.id_polo_fk
                    ? {
                          id: turma.id_polo_fk.id,
                          nome: turma.id_polo_fk.polo,
                          cidade: turma.id_polo_fk.cidade,
                          estado: turma.id_polo_fk.estado,
                      }
                    : undefined,
                treinamento: turma.id_treinamento_fk
                    ? {
                          id: turma.id_treinamento_fk.id,
                          nome: turma.id_treinamento_fk.treinamento,
                          tipo: turma.id_treinamento_fk.tipo_treinamento ? 'treinamento' : 'palestra',
                          sigla_treinamento: turma.id_treinamento_fk.sigla_treinamento,
                          treinamento: turma.id_treinamento_fk.treinamento,
                          url_logo_treinamento: turma.id_treinamento_fk.url_logo_treinamento,
                      }
                    : undefined,
                lider: turma.lider_evento_fk
                    ? {
                          id: turma.lider_evento_fk.id,
                          nome: turma.lider_evento_fk.nome,
                      }
                    : undefined,
                // Para palestras/masterclass, alunos_count = pré-cadastrados; para treinamentos, alunos_count = alunos
                alunos_count: (() => {
                    if (isPalestra) {
                        return preCadastrosCount[turma.id]?.total || 0;
                    }
                    return turma.turmasAlunos?.length || 0;
                })(),
                alunos_confirmados_count: turma.turmasAlunos?.filter((ta) => this.isAlunoConfirmadoNaTurma(ta)).length || 0,
                transferidos_count: transferidosCountByTurma[turma.id] || 0,
                vindos_transferencia_count:
                    turma.turmasAlunos?.filter(
                        (ta) =>
                            ta.origem_aluno === EOrigemAlunos.TRANSFERENCIA && ta.id_turma_transferencia_de !== null && ta.id_turma_transferencia_de !== undefined,
                    ).length || 0,
                pre_cadastrados_count: preCadastrosCount[turma.id]?.total || 0,
                presentes_count:
                    turma.turmasAlunos?.filter(
                        (ta) => ta.presenca_turma === EPresencaTurmas.PRESENTE && ta.id_aluno_fk?.status_aluno_geral !== EStatusAlunosGeral.INADIMPLENTE,
                    ).length || 0,
                inadimplentes_count: (() => {
                    const inadimplentes = turma.turmasAlunos?.filter((ta) => ta.id_aluno_fk?.status_aluno_geral === EStatusAlunosGeral.INADIMPLENTE) || [];
                    console.log(`🔍 [DEBUG] Turma ${turma.id} - Inadimplentes encontrados: ${inadimplentes.length}`);
                    inadimplentes.forEach((ta, index) => {
                        console.log(`  Inadimplente ${index + 1}: ID=${ta.id_aluno}, Status=${ta.id_aluno_fk?.status_aluno_geral}, Nome=${ta.id_aluno_fk?.nome}`);
                    });
                    return inadimplentes.length;
                })(),
            };
        } catch (error) {
            console.error('Erro ao buscar turma por ID:', error);
            throw new BadRequestException('Erro ao buscar turma');
        }
    }

    async create(createTurmaDto: CreateTurmaDto): Promise<TurmaResponseDto> {
        try {
            // Verificar se polo existe
            const polo = await this.uow.polosRP.findOne({
                where: { id: createTurmaDto.id_polo },
            });
            if (!polo) {
                throw new NotFoundException('Polo não encontrado');
            }

            // Verificar se treinamento existe
            const treinamento = await this.uow.treinamentosRP.findOne({
                where: { id: createTurmaDto.id_treinamento },
            });
            if (!treinamento) {
                throw new NotFoundException('Treinamento não encontrado');
            }

            // Verificar se líder existe (apenas se fornecido)
            if (createTurmaDto.lider_evento) {
                const lider = await this.uow.usuariosRP.findOne({
                    where: { id: createTurmaDto.lider_evento },
                });
                if (!lider) {
                    throw new NotFoundException('Líder do evento não encontrado');
                }
            }

            // Processar endereço: se tiver id_endereco_evento, buscar o endereço predefinido
            let enderecoData: {
                id_endereco_evento?: number;
                cep: string;
                logradouro: string;
                complemento?: string;
                numero: string;
                bairro: string;
                cidade: string;
                estado: string;
            };

            if (createTurmaDto.id_endereco_evento) {
                // Buscar endereço predefinido
                const enderecoEvento = await this.uow.enderecoEventosRP.findOne({
                    where: {
                        id: createTurmaDto.id_endereco_evento,
                        deletado_em: null,
                    },
                });

                if (!enderecoEvento) {
                    throw new NotFoundException('Endereço de evento não encontrado');
                }

                enderecoData = {
                    id_endereco_evento: createTurmaDto.id_endereco_evento,
                    cep: enderecoEvento.cep || '',
                    logradouro: enderecoEvento.logradouro || '',
                    complemento: createTurmaDto.complemento || enderecoEvento.numero ? undefined : undefined,
                    numero: enderecoEvento.numero || '',
                    bairro: enderecoEvento.bairro || '',
                    cidade: enderecoEvento.cidade || '',
                    estado: enderecoEvento.estado || '',
                };

                // Permitir complemento manual mesmo usando endereço predefinido
                if (createTurmaDto.complemento) {
                    enderecoData.complemento = createTurmaDto.complemento;
                }
            } else {
                // Validar que todos os campos de endereço foram fornecidos
                if (
                    !createTurmaDto.cep ||
                    !createTurmaDto.logradouro ||
                    !createTurmaDto.numero ||
                    !createTurmaDto.bairro ||
                    !createTurmaDto.cidade ||
                    !createTurmaDto.estado
                ) {
                    throw new BadRequestException(
                        'É necessário fornecer um endereço de evento predefinido (id_endereco_evento) ou preencher todos os campos de endereço (CEP, logradouro, número, bairro, cidade e estado)',
                    );
                }

                enderecoData = {
                    cep: createTurmaDto.cep,
                    logradouro: createTurmaDto.logradouro,
                    complemento: createTurmaDto.complemento,
                    numero: createTurmaDto.numero,
                    bairro: createTurmaDto.bairro,
                    cidade: createTurmaDto.cidade,
                    estado: createTurmaDto.estado,
                };
            }

            // Processar detalhamento de bônus
            let detalhamento_bonus = null;
            if (createTurmaDto.autorizar_bonus && createTurmaDto.bonus_treinamentos?.length > 0) {
                detalhamento_bonus = createTurmaDto.bonus_treinamentos.map((id_treinamento) => ({
                    id_treinamento_db: id_treinamento,
                }));
            }

            // Remover campos que não existem na entidade antes de criar
            const { bonus_treinamentos, ...createData } = createTurmaDto;

            // Formatar datas para o formato YYYY-MM-DD
            const dataInicioFormatada = this.formatDateToDateOnly(createTurmaDto.data_inicio);
            const dataFinalFormatada = this.formatDateToDateOnly(createTurmaDto.data_final);

            // Verificar se é palestra para definir turma_aberta como true por padrão
            const isPalestra = treinamento.tipo_palestra === true;
            const turmaAberta = createTurmaDto.turma_aberta !== undefined ? createTurmaDto.turma_aberta : isPalestra ? true : false;

            // Palestras/masterclass iniciam com inscrições abertas; treinamentos mantêm o fluxo anterior (padrão do DTO)
            const statusTurmaFinal = isPalestra ? EStatusTurmas.INSCRICOES_ABERTAS : (createTurmaDto.status_turma ?? EStatusTurmas.AGUARDANDO_LIBERACAO);

            // Criar nova turma
            const novaTurma = this.uow.turmasRP.create({
                ...createData,
                ...enderecoData,
                data_inicio: dataInicioFormatada,
                data_final: dataFinalFormatada,
                turma_aberta: turmaAberta,
                status_turma: statusTurmaFinal,
                id_turma_bonus: createTurmaDto.id_turma_bonus || null,
                detalhamento_bonus,
                criado_por: createTurmaDto.criado_por,
            });

            const turmaSalva = await this.uow.turmasRP.save(novaTurma);

            // Retornar turma criada com relações
            return this.findById(turmaSalva.id);
        } catch (error) {
            console.error('Erro ao criar turma:', error);
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new BadRequestException('Erro ao criar turma');
        }
    }

    /**
     * Buscar alunos disponíveis para uma turma.
     * Se search for informado, filtra por nome ou email (ILIKE); caso contrário retorna vazio quando usado em modo autocomplete.
     */
    async getAlunosDisponiveis(id_turma?: number, page: number = 1, limit: number = 10, search?: string): Promise<AlunosDisponiveisResponseDto> {
        try {
            const skip = (page - 1) * limit;

            // Quando não há busca, retornar vazio para modo autocomplete (lista inicia zerada)
            if (!search || !search.trim()) {
                return {
                    data: [],
                    total: 0,
                    page,
                    limit,
                    totalPages: 0,
                };
            }

            const qb = this.uow.alunosRP
                .createQueryBuilder('aluno')
                .where('aluno.deletado_em IS NULL')
                .andWhere('(aluno.nome ILIKE :search OR aluno.email ILIKE :search)', { search: `%${search.trim()}%` });

            if (id_turma) {
                const alunosNaTurma = await this.uow.turmasAlunosRP.find({
                    where: { id_turma, deletado_em: null },
                    select: ['id_aluno'],
                });
                const idsAlunosNaTurma = alunosNaTurma.map((ta) => ta.id_aluno);
                if (idsAlunosNaTurma.length > 0) {
                    qb.andWhere('aluno.id NOT IN (:...ids)', { ids: idsAlunosNaTurma });
                }
            }

            const [alunos, total] = await qb.orderBy('aluno.nome', 'ASC').skip(skip).take(limit).getManyAndCount();

            return {
                data: alunos.map((aluno) => ({
                    id: aluno.id,
                    nome: aluno.nome,
                    email: aluno.email,
                    cpf: aluno.cpf,
                    nome_cracha: aluno.nome_cracha || aluno.nome,
                    status_aluno_geral: aluno.status_aluno_geral,
                })),
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            };
        } catch (error) {
            console.error('Erro ao buscar alunos disponíveis:', error);
            throw new BadRequestException('Erro ao buscar alunos disponíveis');
        }
    }

    /**
     * Buscar detalhes de um aluno específico em uma turma
     */
    async getAlunoTurmaByIdDetailed(id: string): Promise<any> {
        try {
            const turmaAluno = await this.uow.turmasAlunosRP.findOne({
                where: { id: id },
                relations: [
                    'id_aluno_fk',
                    'id_turma_fk',
                    'id_turma_fk.id_treinamento_fk',
                    'id_turma_fk.id_polo_fk',
                    'id_turma_transferencia_para_fk',
                    'id_turma_transferencia_para_fk.id_treinamento_fk',
                    'id_turma_transferencia_para_fk.id_polo_fk',
                    'id_turma_transferencia_de_fk',
                    'id_turma_transferencia_de_fk.id_treinamento_fk',
                    'id_turma_transferencia_de_fk.id_polo_fk',
                ],
            });

            if (!turmaAluno) {
                throw new NotFoundException('Aluno não encontrado na turma');
            }

            return {
                id: turmaAluno.id,
                id_aluno: turmaAluno.id_aluno,
                id_turma: turmaAluno.id_turma,
                nome_cracha: turmaAluno.nome_cracha,
                numero_cracha: turmaAluno.numero_cracha,
                vaga_bonus: turmaAluno.vaga_bonus,
                status_aluno_turma: turmaAluno.status_aluno_turma,
                presenca_turma: turmaAluno.presenca_turma,
                transferencia_para_turma: this.mapTurmaToTransferenciaTag(turmaAluno.id_turma_transferencia_para_fk),
                transferencia_de_turma: this.mapTurmaToTransferenciaTag(turmaAluno.id_turma_transferencia_de_fk),
                telefone: turmaAluno.id_aluno_fk?.telefone_um || '',
                created_at: turmaAluno.criado_em,
                aluno: turmaAluno.id_aluno_fk
                    ? {
                          id: turmaAluno.id_aluno_fk.id,
                          nome: turmaAluno.id_aluno_fk.nome,
                          email: turmaAluno.id_aluno_fk.email,
                          nome_cracha: turmaAluno.id_aluno_fk.nome_cracha || turmaAluno.id_aluno_fk.nome,
                          status_aluno_geral: turmaAluno.id_aluno_fk.status_aluno_geral,
                      }
                    : undefined,
                turma: turmaAluno.id_turma_fk
                    ? {
                          id: turmaAluno.id_turma_fk.id,
                          edicao_turma: turmaAluno.id_turma_fk.edicao_turma,
                          data_inicio: turmaAluno.id_turma_fk.data_inicio,
                          data_final: turmaAluno.id_turma_fk.data_final,
                          treinamento: turmaAluno.id_turma_fk.id_treinamento_fk
                              ? {
                                    nome: turmaAluno.id_turma_fk.id_treinamento_fk.treinamento,
                                    sigla: turmaAluno.id_turma_fk.id_treinamento_fk.sigla_treinamento || turmaAluno.id_turma_fk.id_treinamento_fk.treinamento,
                                }
                              : undefined,
                          polo: turmaAluno.id_turma_fk.id_polo_fk
                              ? {
                                    nome: turmaAluno.id_turma_fk.id_polo_fk.polo,
                                    cidade: turmaAluno.id_turma_fk.id_polo_fk.cidade,
                                    estado: turmaAluno.id_turma_fk.id_polo_fk.estado,
                                }
                              : undefined,
                      }
                    : undefined,
            };
        } catch (error) {
            console.error('Erro ao buscar aluno da turma:', error);
            throw new BadRequestException('Erro ao buscar aluno da turma');
        }
    }

    /**
     * Trilha do aluno: lista todas as turmas nas quais o aluno já esteve vinculado
     * Inclui também palestras/masterclass onde o aluno participou
     * O tipo é determinado pelo tipo do treinamento (palestra ou treinamento)
     */
    async getTrilhaAluno(id_aluno: number): Promise<
        {
            id_turma_aluno: string;
            status_aluno_turma: string | null;
            presenca_turma: string | null;
            criado_em: Date;
            tipo: 'palestra' | 'treinamento';
            origem_label?: string;
            turma: {
                id: number;
                nome_evento: string;
                sigla_evento: string;
                edicao_turma?: string;
                local: string;
                data_inicio: string;
                data_final: string;
                polo?: {
                    nome: string;
                    cidade: string;
                    estado: string;
                };
            };
        }[]
    > {
        try {
            // Buscar dados do aluno para usar em buscas alternativas
            const aluno = await this.uow.alunosRP.findOne({
                where: { id: id_aluno, deletado_em: null },
            });

            // Buscar turmas onde o aluno está vinculado (excluir vínculos com data de deleção)
            const turmasAluno = await this.uow.turmasAlunosRP.find({
                where: { id_aluno: id_aluno.toString(), deletado_em: null },
                relations: ['id_turma_fk', 'id_turma_fk.id_treinamento_fk', 'id_turma_fk.id_polo_fk'],
                order: { criado_em: 'DESC' },
            });

            // Obter IDs das turmas do aluno para busca alternativa
            const idsTurmasAluno = turmasAluno.map((ta) => ta.id_turma).filter((id) => id);

            // Buscar masterclass/palestras onde o aluno está vinculado diretamente
            const idAlunoString = id_aluno.toString();

            let masterclassAluno = await this.uow.masterclassPreCadastrosRP
                .createQueryBuilder('mc')
                .distinct(true)
                .leftJoinAndSelect('mc.id_turma_fk', 'turma')
                .leftJoinAndSelect('turma.id_treinamento_fk', 'treinamento')
                .leftJoinAndSelect('turma.id_polo_fk', 'polo')
                .where('mc.deletado_em IS NULL')
                .andWhere('(CAST(mc.id_aluno_vinculado AS TEXT) = :idAluno OR mc.id_aluno_vinculado = :idAlunoNum)', {
                    idAluno: idAlunoString,
                    idAlunoNum: id_aluno,
                })
                .orderBy('mc.criado_em', 'DESC')
                .getMany();

            // Se não encontrou masterclass vinculadas diretamente, buscar por outros critérios
            if (masterclassAluno.length === 0 && aluno) {
                const qb = this.uow.masterclassPreCadastrosRP
                    .createQueryBuilder('mc')
                    .leftJoinAndSelect('mc.id_turma_fk', 'turma')
                    .leftJoinAndSelect('turma.id_treinamento_fk', 'treinamento')
                    .leftJoinAndSelect('turma.id_polo_fk', 'polo')
                    .where('mc.deletado_em IS NULL')
                    .andWhere('mc.id_aluno_vinculado IS NULL'); // Apenas masterclass não vinculadas

                const conditions: string[] = [];
                const params: any = {};

                // Buscar por email
                if (aluno.email) {
                    conditions.push('LOWER(mc.email) = LOWER(:email)');
                    params.email = aluno.email;
                }

                // Buscar por telefone (normalizar removendo caracteres especiais)
                if (aluno.telefone_um) {
                    const telefoneNormalizado = aluno.telefone_um.replace(/\D/g, '');
                    conditions.push("REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(mc.telefone, '(', ''), ')', ''), '-', ''), ' ', ''), '.', '') = :telefone");
                    params.telefone = telefoneNormalizado;
                }

                // Buscar por turmas compartilhadas
                if (idsTurmasAluno.length > 0) {
                    conditions.push('mc.id_turma IN (:...idsTurmas)');
                    params.idsTurmas = idsTurmasAluno;
                }

                if (conditions.length > 0) {
                    qb.distinct(true).andWhere(`(${conditions.join(' OR ')})`, params);
                    const masterclassEncontradas = await qb.orderBy('mc.criado_em', 'DESC').getMany();
                    // Garantir que não haja duplicatas mesmo com DISTINCT
                    const uniqueMap = new Map<string, any>();
                    masterclassEncontradas.forEach((mc) => {
                        if (!uniqueMap.has(mc.id)) {
                            uniqueMap.set(mc.id, mc);
                        }
                    });
                    masterclassAluno = Array.from(uniqueMap.values());
                }
            }

            console.log(`[getTrilhaAluno] Buscando masterclass para aluno ID: ${id_aluno} (string: "${idAlunoString}")`);
            console.log(`[getTrilhaAluno] Masterclass encontradas: ${masterclassAluno.length}`);
            if (masterclassAluno.length > 0) {
                masterclassAluno.forEach((mc, index) => {
                    console.log(`[getTrilhaAluno] Masterclass ${index + 1}:`, {
                        id: mc.id,
                        id_aluno_vinculado: mc.id_aluno_vinculado,
                        tipo_id_aluno_vinculado: typeof mc.id_aluno_vinculado,
                        evento_nome: mc.evento_nome,
                        tem_turma: !!mc.id_turma_fk,
                        turma_id: mc.id_turma_fk?.id,
                    });
                });
            } else {
                // Debug: buscar todos os masterclass para ver quais existem
                const todasMasterclass = await this.uow.masterclassPreCadastrosRP.find({
                    where: { id_aluno_vinculado: Not(null) },
                    take: 5,
                });
                console.log(
                    `[getTrilhaAluno] Exemplo de masterclass com vínculo (primeiras 5):`,
                    todasMasterclass.map((mc) => ({
                        id: mc.id,
                        id_aluno_vinculado: mc.id_aluno_vinculado,
                        tipo: typeof mc.id_aluno_vinculado,
                    })),
                );
            }

            // Função auxiliar para determinar o tipo baseado no treinamento
            const determinarTipo = (treinamento: any): 'palestra' | 'treinamento' => {
                if (!treinamento) return 'treinamento';
                return treinamento.tipo_palestra ? 'palestra' : 'treinamento';
            };

            // Mapear turmas normais
            const historicoTimeVendas = await this.uow.historicoTransferenciasRP.find({
                where: {
                    id_aluno,
                },
            });
            const historicoTimeVendasByTurmaAluno = new Map<string, Date>();
            historicoTimeVendas.forEach((h) => {
                if (h.id_turma_aluno_para && h.id_turma_de === h.id_turma_para) {
                    historicoTimeVendasByTurmaAluno.set(String(h.id_turma_aluno_para), h.criado_em);
                }
            });

            const trilhaTurmas = turmasAluno.map((ta) => {
                const turma = ta.id_turma_fk;
                const treinamento = turma?.id_treinamento_fk;
                const polo = turma?.id_polo_fk;
                const origemTimeVendasData = historicoTimeVendasByTurmaAluno.get(String(ta.id));
                const isTimeVendas = Boolean(origemTimeVendasData);

                const localParts: string[] = [];
                if (isTimeVendas) {
                    localParts.push('Americana');
                } else {
                    if (turma?.cidade) localParts.push(turma.cidade);
                    if (turma?.estado) localParts.push(turma.estado);
                }
                const local = localParts.join(' - ');
                const dataEventoOrigem = origemTimeVendasData ? origemTimeVendasData.toISOString().split('T')[0] : '';

                return {
                    id_turma_aluno: ta.id,
                    status_aluno_turma: isTimeVendas ? EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO : ta.status_aluno_turma || null,
                    presenca_turma: ta.presenca_turma || null,
                    criado_em: origemTimeVendasData || ta.criado_em,
                    tipo: determinarTipo(treinamento),
                    origem_label: isTimeVendas ? 'Time de Vendas - IAM' : undefined,
                    turma: {
                        id: turma?.id || 0,
                        nome_evento: isTimeVendas ? 'Time de Vendas - IAM' : treinamento?.treinamento || '',
                        sigla_evento: treinamento?.sigla_treinamento || treinamento?.treinamento || '',
                        edicao_turma: turma?.edicao_turma || undefined,
                        local,
                        data_inicio: isTimeVendas ? dataEventoOrigem : turma?.data_inicio || '',
                        data_final: isTimeVendas ? dataEventoOrigem : turma?.data_final || '',
                        polo: polo
                            ? {
                                  nome: polo.polo,
                                  cidade: polo.cidade,
                                  estado: polo.estado,
                              }
                            : undefined,
                    },
                };
            });

            // Remover duplicatas de masterclass baseado no ID primeiro
            // Usar Map para garantir que cada ID apareça apenas uma vez
            const masterclassMapById = new Map<string, any>();
            masterclassAluno.forEach((mc) => {
                if (!masterclassMapById.has(mc.id)) {
                    masterclassMapById.set(mc.id, mc);
                }
            });
            let masterclassUnicas = Array.from(masterclassMapById.values());

            // Deduplicação adicional: remover masterclass duplicadas mesmo com IDs diferentes
            // baseado em evento_nome + data_evento + email (chave composta)
            const masterclassMapUnicas = new Map<string, any>();
            masterclassUnicas.forEach((mc) => {
                const dataEventoStr = mc.data_evento ? new Date(mc.data_evento).toISOString().split('T')[0] : '';
                const chaveUnica = `${mc.evento_nome || ''}_${dataEventoStr}_${mc.email || ''}`.toLowerCase();

                // Se já existe uma masterclass com a mesma chave, manter apenas a mais antiga (criada primeiro)
                if (!masterclassMapUnicas.has(chaveUnica)) {
                    masterclassMapUnicas.set(chaveUnica, mc);
                } else {
                    const existente = masterclassMapUnicas.get(chaveUnica);
                    // Manter a que foi criada primeiro
                    if (new Date(mc.criado_em) < new Date(existente.criado_em)) {
                        masterclassMapUnicas.set(chaveUnica, mc);
                    }
                }
            });
            masterclassUnicas = Array.from(masterclassMapUnicas.values());

            console.log(`[getTrilhaAluno] Masterclass após deduplicação: ${masterclassUnicas.length} (de ${masterclassAluno.length} encontradas)`);

            // Re-mapear masterclass únicas
            const trilhaMasterclassUnicas = masterclassUnicas.map((mc) => {
                const turma = mc.id_turma_fk;
                const treinamento = turma?.id_treinamento_fk;
                const polo = turma?.id_polo_fk;

                // Se não tiver turma relacionada, usar dados do próprio registro de masterclass
                const localParts: string[] = [];
                if (turma?.cidade) localParts.push(turma.cidade);
                if (turma?.estado) localParts.push(turma.estado);
                // Se não tiver turma, tentar obter local de outra forma ou deixar vazio
                const local = localParts.length > 0 ? localParts.join(' - ') : 'N/A';

                // Determinar tipo: se tem treinamento, usa o tipo do treinamento, senão assume palestra
                const tipo = treinamento ? determinarTipo(treinamento) : 'palestra';

                // Data do evento: priorizar turma, senão usar data_evento do masterclass
                const dataEvento = mc.data_evento ? new Date(mc.data_evento).toISOString().split('T')[0] : '';
                const dataInicio = turma?.data_inicio || dataEvento || '';
                const dataFinal = turma?.data_final || dataEvento || '';

                return {
                    id_turma_aluno: mc.id,
                    status_aluno_turma: mc.presente ? 'PRESENTE' : null,
                    presenca_turma: mc.presente ? 'PRESENTE' : null,
                    criado_em: mc.criado_em,
                    tipo,
                    turma: {
                        id: turma?.id || 0,
                        nome_evento: mc.evento_nome || treinamento?.treinamento || 'Masterclass',
                        sigla_evento: treinamento?.sigla_treinamento || treinamento?.treinamento || mc.evento_nome || '',
                        edicao_turma: turma?.edicao_turma || undefined,
                        local,
                        data_inicio: dataInicio,
                        data_final: dataFinal,
                        polo: polo
                            ? {
                                  nome: polo.polo,
                                  cidade: polo.cidade,
                                  estado: polo.estado,
                              }
                            : undefined,
                    },
                };
            });

            // Combinar e ordenar por data de criação (mais recente primeiro)
            const trilhaCompleta = [...trilhaTurmas, ...trilhaMasterclassUnicas].sort((a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime());

            return trilhaCompleta;
        } catch (error) {
            console.error('Erro ao buscar trilha do aluno:', error);
            throw new BadRequestException('Erro ao buscar trilha do aluno');
        }
    }

    /**
     * Buscar turmas de IPR (Imersão Prosperar) com inscrições abertas para usar como bônus
     */
    async findIPRTurmasBonus(): Promise<TurmaResponseDto[]> {
        console.log('🎯 [DEBUG] Iniciando busca de turmas de IPR para bônus...');

        try {
            console.log('🎯 [DEBUG] Buscando turmas com status INSCRICOES_ABERTAS...');

            // Buscar turmas com status INSCRICOES_ABERTAS
            const turmas = await this.uow.turmasRP.find({
                where: {
                    status_turma: EStatusTurmas.INSCRICOES_ABERTAS,
                    deletado_em: null,
                },
                relations: ['id_polo_fk', 'id_treinamento_fk', 'lider_evento_fk'],
                order: {
                    data_inicio: 'ASC',
                },
            });

            console.log(`📚 [DEBUG] Encontradas ${turmas.length} turmas com inscrições abertas`);

            // Filtrar apenas turmas de IPR (Imersão Prosperar)
            const turmasIPR = turmas.filter((turma) => {
                if (!turma.id_treinamento_fk) {
                    console.log(`⚠️ [DEBUG] Turma ${turma.id} sem treinamento associado`);
                    return false;
                }

                const nomeTreinamento = turma.id_treinamento_fk.treinamento?.toLowerCase() || '';
                const edicaoTurma = turma.edicao_turma?.toLowerCase() || '';

                console.log(`🔍 [DEBUG] Turma ${turma.id}: treinamento="${nomeTreinamento}", edição="${edicaoTurma}"`);

                const isIPR =
                    nomeTreinamento.includes('imersão prosperar') ||
                    nomeTreinamento.includes('ipr') ||
                    edicaoTurma.includes('ipr') ||
                    edicaoTurma.includes('imersão prosperar');

                if (isIPR) {
                    console.log(`✅ [DEBUG] Turma ${turma.id} identificada como IPR`);
                }

                return isIPR;
            });

            console.log(`🎯 [DEBUG] Turmas de IPR filtradas: ${turmasIPR.length}`);

            // Transformar dados para o formato de resposta
            const turmasResponse: TurmaResponseDto[] = turmasIPR.map((turma) => {
                console.log(`🔄 [DEBUG] Transformando turma ${turma.id} para resposta`);

                return {
                    id: turma.id,
                    id_polo: turma.id_polo,
                    id_treinamento: turma.id_treinamento,
                    lider_evento: turma.lider_evento,
                    edicao_turma: turma.edicao_turma,
                    cep: turma.cep,
                    logradouro: turma.logradouro,
                    complemento: turma.complemento,
                    numero: turma.numero,
                    bairro: turma.bairro,
                    cidade: turma.cidade,
                    estado: turma.estado,
                    status_turma: turma.status_turma,
                    autorizar_bonus: turma.autorizar_bonus,
                    id_turma_bonus: turma.id_turma_bonus,
                    capacidade_turma: turma.capacidade_turma,
                    meta: turma.meta,
                    data_inicio: turma.data_inicio,
                    data_final: turma.data_final,
                    turma_aberta: turma.turma_aberta,
                    bonus_treinamentos: turma.detalhamento_bonus?.map((item) => item.id_treinamento_db) || [],
                    detalhamento_bonus: turma.detalhamento_bonus,
                    url_midia_kit: turma.url_midia_kit,
                    url_grupo_whatsapp: turma.url_grupo_whatsapp,
                    url_grupo_whatsapp_2: turma.url_grupo_whatsapp_2,
                    url_pagamento_cartao: turma.url_pagamento_cartao,
                    created_at: turma.criado_em,
                    updated_at: turma.atualizado_em,
                    polo: turma.id_polo_fk
                        ? {
                              id: turma.id_polo_fk.id,
                              nome: turma.id_polo_fk.polo,
                              cidade: turma.id_polo_fk.cidade,
                              estado: turma.id_polo_fk.estado,
                          }
                        : undefined,
                    treinamento: turma.id_treinamento_fk
                        ? {
                              id: turma.id_treinamento_fk.id,
                              nome: turma.id_treinamento_fk.treinamento,
                              tipo: turma.id_treinamento_fk.tipo_treinamento ? 'treinamento' : 'palestra',
                          }
                        : undefined,
                    lider: turma.lider_evento_fk
                        ? {
                              id: turma.lider_evento_fk.id,
                              nome: turma.lider_evento_fk.nome,
                          }
                        : undefined,
                    alunos_count: 0,
                    alunos_confirmados_count: 0,
                    pre_cadastrados_count: 0,
                    presentes_count: 0,
                };
            });

            console.log(`✅ [DEBUG] Turmas de IPR para bônus carregadas: ${turmasResponse.length}`);
            console.log(`📋 [DEBUG] Dados finais:`, JSON.stringify(turmasResponse, null, 2));

            return turmasResponse;
        } catch (error) {
            console.error('❌ [DEBUG] Erro ao buscar turmas de IPR para bônus:', error);
            console.error('❌ [DEBUG] Stack trace:', error instanceof Error ? error.stack : 'N/A');
            throw new BadRequestException('Erro ao buscar turmas de IPR para bônus');
        }
    }

    async update(id: number, updateTurmaDto: UpdateTurmaDto): Promise<TurmaResponseDto> {
        try {
            console.log(`[DEBUG] Atualizando turma ID: ${id}`);
            console.log(`[DEBUG] Dados recebidos:`, updateTurmaDto);

            const turma = await this.uow.turmasRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
            });

            if (!turma) {
                console.log(`[DEBUG] Turma não encontrada: ${id}`);
                throw new NotFoundException('Turma não encontrada');
            }

            // Validações se campos forem fornecidos
            if (updateTurmaDto.id_polo) {
                console.log(`[DEBUG] Validando polo ID: ${updateTurmaDto.id_polo}`);
                const polo = await this.uow.polosRP.findOne({
                    where: { id: updateTurmaDto.id_polo },
                });
                if (!polo) {
                    console.log(`[DEBUG] Polo não encontrado: ${updateTurmaDto.id_polo}`);
                    throw new NotFoundException('Polo não encontrado');
                }
            }

            if (updateTurmaDto.id_treinamento) {
                console.log(`[DEBUG] Validando treinamento ID: ${updateTurmaDto.id_treinamento}`);
                const treinamento = await this.uow.treinamentosRP.findOne({
                    where: { id: updateTurmaDto.id_treinamento },
                });
                if (!treinamento) {
                    console.log(`[DEBUG] Treinamento não encontrado: ${updateTurmaDto.id_treinamento}`);
                    throw new NotFoundException('Treinamento não encontrado');
                }
            }

            if (updateTurmaDto.lider_evento) {
                console.log(`[DEBUG] Validando lider ID: ${updateTurmaDto.lider_evento}`);
                const lider = await this.uow.usuariosRP.findOne({
                    where: { id: updateTurmaDto.lider_evento },
                });
                if (!lider) {
                    console.log(`[DEBUG] Líder não encontrado: ${updateTurmaDto.lider_evento}`);
                    throw new NotFoundException('Líder do evento não encontrado');
                }
            }

            // Processar endereço: se tiver id_endereco_evento, buscar o endereço predefinido
            let enderecoData: Partial<{
                id_endereco_evento?: number;
                cep: string;
                logradouro: string;
                complemento?: string;
                numero: string;
                bairro: string;
                cidade: string;
                estado: string;
            }> = {};

            if (updateTurmaDto.id_endereco_evento !== undefined) {
                if (updateTurmaDto.id_endereco_evento) {
                    // Buscar endereço predefinido
                    const enderecoEvento = await this.uow.enderecoEventosRP.findOne({
                        where: {
                            id: updateTurmaDto.id_endereco_evento,
                            deletado_em: null,
                        },
                    });

                    if (!enderecoEvento) {
                        throw new NotFoundException('Endereço de evento não encontrado');
                    }

                    enderecoData = {
                        id_endereco_evento: updateTurmaDto.id_endereco_evento,
                        cep: enderecoEvento.cep || '',
                        logradouro: enderecoEvento.logradouro || '',
                        numero: enderecoEvento.numero || '',
                        bairro: enderecoEvento.bairro || '',
                        cidade: enderecoEvento.cidade || '',
                        estado: enderecoEvento.estado || '',
                    };

                    // Permitir complemento manual mesmo usando endereço predefinido
                    if (updateTurmaDto.complemento !== undefined) {
                        enderecoData.complemento = updateTurmaDto.complemento;
                    }
                } else {
                    // Se id_endereco_evento for null, limpar a referência mas manter campos de endereço se fornecidos
                    enderecoData.id_endereco_evento = null;
                }
            } else if (
                updateTurmaDto.cep ||
                updateTurmaDto.logradouro ||
                updateTurmaDto.numero ||
                updateTurmaDto.bairro ||
                updateTurmaDto.cidade ||
                updateTurmaDto.estado
            ) {
                // Se campos de endereço foram fornecidos sem id_endereco_evento, validar que todos foram fornecidos
                if (
                    !updateTurmaDto.cep ||
                    !updateTurmaDto.logradouro ||
                    !updateTurmaDto.numero ||
                    !updateTurmaDto.bairro ||
                    !updateTurmaDto.cidade ||
                    !updateTurmaDto.estado
                ) {
                    throw new BadRequestException(
                        'Ao atualizar o endereço manualmente, todos os campos devem ser fornecidos (CEP, logradouro, número, bairro, cidade e estado)',
                    );
                }

                enderecoData = {
                    cep: updateTurmaDto.cep,
                    logradouro: updateTurmaDto.logradouro,
                    complemento: updateTurmaDto.complemento,
                    numero: updateTurmaDto.numero,
                    bairro: updateTurmaDto.bairro,
                    cidade: updateTurmaDto.cidade,
                    estado: updateTurmaDto.estado,
                };
            }

            // Processar detalhamento de bônus
            let detalhamento_bonus = turma.detalhamento_bonus; // Manter o existente por padrão

            if (Object.prototype.hasOwnProperty.call(updateTurmaDto, 'bonus_treinamentos')) {
                if (updateTurmaDto.autorizar_bonus && updateTurmaDto.bonus_treinamentos?.length > 0) {
                    // Criar novo detalhamento de bônus
                    detalhamento_bonus = updateTurmaDto.bonus_treinamentos.map((id_treinamento) => ({
                        id_treinamento_db: id_treinamento,
                    }));
                } else {
                    // Limpar detalhamento de bônus se não há treinamentos ou bônus não autorizado
                    detalhamento_bonus = null;
                }
            }

            // Remover campos que não existem na entidade antes de atualizar
            const { bonus_treinamentos, ...updateData } = updateTurmaDto;

            // Formatar datas se fornecidas
            const updateDataWithDates: any = { ...updateData };
            console.log(`[DEBUG] Datas recebidas no update:`, {
                data_inicio_original: updateTurmaDto.data_inicio,
                data_final_original: updateTurmaDto.data_final,
                data_inicio_undefined: updateTurmaDto.data_inicio === undefined,
                data_final_undefined: updateTurmaDto.data_final === undefined,
            });

            if (updateTurmaDto.data_inicio !== undefined && updateTurmaDto.data_inicio !== null && updateTurmaDto.data_inicio !== '') {
                updateDataWithDates.data_inicio = this.formatDateToDateOnly(updateTurmaDto.data_inicio);
                console.log(`[DEBUG] Data início formatada: ${updateDataWithDates.data_inicio}`);
            }
            if (updateTurmaDto.data_final !== undefined && updateTurmaDto.data_final !== null && updateTurmaDto.data_final !== '') {
                updateDataWithDates.data_final = this.formatDateToDateOnly(updateTurmaDto.data_final);
                console.log(`[DEBUG] Data final formatada: ${updateDataWithDates.data_final}`);
            }

            console.log(`[DEBUG] Dados finais para update:`, {
                data_inicio: updateDataWithDates.data_inicio,
                data_final: updateDataWithDates.data_final,
            });

            // Verificar se o status está sendo alterado manualmente
            const statusFoiAlteradoManualmente = updateTurmaDto.status_turma !== undefined && updateTurmaDto.status_turma !== turma.status_turma;

            // Atualizar turma
            await this.uow.turmasRP.update(id, {
                ...updateDataWithDates,
                ...enderecoData,
                detalhamento_bonus,
                atualizado_por: updateTurmaDto.atualizado_por,
            });

            // Buscar turma atualizada com relações para verificar status
            const turmaAtualizada = await this.uow.turmasRP.findOne({
                where: { id, deletado_em: null },
                relations: ['id_treinamento_fk', 'turmasAlunos'],
            });

            // Só verificar e atualizar status automaticamente se o status NÃO foi alterado manualmente
            // Se o usuário alterou o status explicitamente, respeitar a escolha manual
            if (turmaAtualizada && !statusFoiAlteradoManualmente) {
                await this.verificarEAtualizarStatusTurma(turmaAtualizada);
            }

            // Retornar turma atualizada
            return this.findById(id);
        } catch (error) {
            console.error('Erro ao atualizar turma:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao atualizar turma');
        }
    }

    async softDelete(id: number, softDeleteDto: SoftDeleteTurmaDto): Promise<void> {
        try {
            const turma = await this.uow.turmasRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
            });

            if (!turma) {
                throw new NotFoundException(`Turma com ID ${id} não encontrada`);
            }

            turma.deletado_em = new Date(softDeleteDto.deletado_em);
            turma.atualizado_por = softDeleteDto.atualizado_por;

            await this.uow.turmasRP.save(turma);
            console.log('Turma marcada como deletada:', id);
        } catch (error) {
            console.error('Erro ao fazer soft delete da turma:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao fazer soft delete da turma');
        }
    }

    async delete(id: number): Promise<void> {
        try {
            const turma = await this.uow.turmasRP.findOne({ where: { id } });

            if (!turma) {
                throw new NotFoundException('Turma não encontrada');
            }

            // Verificar se há alunos na turma
            const alunosNaTurma = await this.uow.turmasAlunosRP.count({
                where: { id_turma: id, deletado_em: null },
            });

            if (alunosNaTurma > 0) {
                throw new BadRequestException('Não é possível excluir permanentemente uma turma que possui alunos matriculados');
            }

            await this.uow.turmasRP.delete(id);
            console.log('Turma excluída permanentemente:', id);
        } catch (error) {
            console.error('Erro ao deletar turma permanentemente:', error);
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao deletar turma');
        }
    }

    // Métodos para gerenciar alunos na turma

    async getAlunosTurma(id_turma: number, page: number = 1, limit: number = 10): Promise<AlunosTurmaListResponseDto> {
        try {
            const turma = await this.uow.turmasRP.findOne({ where: { id: id_turma } });

            if (!turma) {
                throw new NotFoundException('Turma não encontrada');
            }

            const [turmasAlunos, total] = await this.uow.turmasAlunosRP.findAndCount({
                where: { id_turma, deletado_em: null },
                relations: [
                    'id_aluno_fk',
                    'id_turma_transferencia_para_fk',
                    'id_turma_transferencia_para_fk.id_treinamento_fk',
                    'id_turma_transferencia_para_fk.id_polo_fk',
                    'id_turma_transferencia_de_fk',
                    'id_turma_transferencia_de_fk.id_treinamento_fk',
                    'id_turma_transferencia_de_fk.id_polo_fk',
                ],
                order: { criado_em: 'DESC' },
                skip: (page - 1) * limit,
                take: limit,
            });

            const alunosResponse: AlunoTurmaResponseDto[] = turmasAlunos.map((turmaAluno) => ({
                id: turmaAluno.id,
                id_turma: turmaAluno.id_turma,
                id_aluno: turmaAluno.id_aluno,
                nome_cracha: turmaAluno.nome_cracha,
                numero_cracha: turmaAluno.numero_cracha,
                vaga_bonus: turmaAluno.vaga_bonus,
                origem_aluno: turmaAluno.origem_aluno ?? undefined,
                status_aluno_turma: turmaAluno.status_aluno_turma,
                presenca_turma: turmaAluno.presenca_turma,
                url_comprovante_pgto: turmaAluno.url_comprovante_pgto,
                created_at: turmaAluno.criado_em,
                transferencia_para_turma: this.mapTurmaToTransferenciaTag(turmaAluno.id_turma_transferencia_para_fk),
                transferencia_de_turma: this.mapTurmaToTransferenciaTag(turmaAluno.id_turma_transferencia_de_fk),
                aluno: turmaAluno.id_aluno_fk
                    ? {
                          id: turmaAluno.id_aluno_fk.id,
                          nome: turmaAluno.id_aluno_fk.nome,
                          email: turmaAluno.id_aluno_fk.email,
                          telefone: turmaAluno.id_aluno_fk.telefone_um,
                          nome_cracha: turmaAluno.id_aluno_fk.nome_cracha,
                          cpf: turmaAluno.id_aluno_fk.cpf,
                          status_aluno_geral: turmaAluno.id_aluno_fk.status_aluno_geral,
                          possui_deficiencia: turmaAluno.id_aluno_fk.possui_deficiencia,
                          desc_deficiencia: turmaAluno.id_aluno_fk.desc_deficiencia,
                      }
                    : undefined,
            }));

            const totalPages = Math.ceil(total / limit);

            return {
                data: alunosResponse,
                total,
                page,
                limit,
                totalPages,
            };
        } catch (error) {
            console.error('Erro ao buscar alunos da turma:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao buscar alunos da turma');
        }
    }

    async addAlunoTurma(id_turma: number, addAlunoDto: AddAlunoTurmaDto): Promise<AlunoTurmaResponseDto> {
        try {
            const turma = await this.uow.turmasRP.findOne({ where: { id: id_turma } });

            if (!turma) {
                throw new NotFoundException('Turma não encontrada');
            }

            // Verificar se a turma permite inserção de alunos
            if (turma.status_turma === EStatusTurmas.ENCERRADA) {
                const hoje = new Date();
                hoje.setHours(0, 0, 0, 0);

                const dataInicio = turma.data_inicio ? new Date(turma.data_inicio) : null;
                const dataFinal = turma.data_final ? new Date(turma.data_final) : null;

                if (dataInicio) dataInicio.setHours(0, 0, 0, 0);
                if (dataFinal) dataFinal.setHours(23, 59, 59, 999);

                const dentroPeriodoEvento = !!dataInicio && !!dataFinal && hoje >= dataInicio && hoje <= dataFinal;

                if (!dentroPeriodoEvento) {
                    throw new BadRequestException('Turma encerrada: só é possível adicionar alunos durante o período do evento');
                }
            }

            if (turma.status_turma === EStatusTurmas.INSCRICOES_PAUSADAS) {
                throw new BadRequestException('Não é possível adicionar alunos em turmas com inscrições pausadas');
            }

            const aluno = await this.uow.alunosRP.findOne({ where: { id: addAlunoDto.id_aluno } });

            if (!aluno) {
                throw new NotFoundException('Aluno não encontrado');
            }

            // Verificar se aluno já está na turma (considerar apenas vínculos ativos)
            const alunoJaNaTurma = await this.uow.turmasAlunosRP.findOne({
                where: { id_turma, id_aluno: addAlunoDto.id_aluno.toString(), deletado_em: null },
            });

            if (alunoJaNaTurma) {
                throw new BadRequestException('Aluno já está matriculado nesta turma');
            }

            // Gerar número de crachá único para esta turma
            const numeroCracha = await this.generateUniqueCrachaNumber(id_turma);

            // Usar nome do crachá fornecido ou o padrão do aluno (obrigatório na entidade)
            const nomeCracha = addAlunoDto.nome_cracha?.trim() || aluno.nome_cracha?.trim() || aluno.nome?.trim() || 'Aluno';

            // Debug: Log dos dados recebidos
            console.log('=== DADOS RECEBIDOS PARA ADICIONAR ALUNO ===');
            console.log('addAlunoDto:', addAlunoDto);
            console.log('origem_aluno:', addAlunoDto.origem_aluno);
            console.log('status_aluno_turma:', addAlunoDto.status_aluno_turma);
            console.log('vaga_bonus:', addAlunoDto.vaga_bonus);
            console.log('id_aluno_bonus:', addAlunoDto.id_aluno_bonus);

            // Criar registro na turmas_alunos
            const dadosParaSalvar = {
                id_turma,
                id_aluno: addAlunoDto.id_aluno.toString(),
                nome_cracha: nomeCracha,
                numero_cracha: numeroCracha,
                vaga_bonus: addAlunoDto.vaga_bonus || false,
                origem_aluno: (addAlunoDto.origem_aluno as EOrigemAlunos) || EOrigemAlunos.COMPROU_INGRESSO,
                status_aluno_turma: (addAlunoDto.status_aluno_turma as EStatusAlunosTurmas) || EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO,
                ...(addAlunoDto.id_aluno_bonus && { id_aluno_bonus: addAlunoDto.id_aluno_bonus }),
            };

            console.log('=== DADOS QUE SERÃO SALVOS ===');
            console.log('dadosParaSalvar:', dadosParaSalvar);

            const turmaAluno = this.uow.turmasAlunosRP.create(dadosParaSalvar);

            console.log('=== ENTIDADE CRIADA ===');
            console.log('turmaAluno antes do save:', turmaAluno);

            const turmaAlunoSalva = await this.uow.turmasAlunosRP.save(turmaAluno);

            console.log('=== ENTIDADE SALVA ===');
            console.log('turmaAlunoSalva:', turmaAlunoSalva);

            // Verificar e atualizar status da turma após adicionar aluno
            const turmaAtualizada = await this.uow.turmasRP.findOne({
                where: { id: id_turma },
                relations: ['id_treinamento_fk', 'turmasAlunos'],
            });

            if (turmaAtualizada) {
                await this.verificarEAtualizarStatusTurma(turmaAtualizada);
            }

            // Retornar com as relações
            const turmaAlunoCompleta = await this.uow.turmasAlunosRP.findOne({
                where: { id: turmaAlunoSalva.id },
                relations: ['id_aluno_fk'],
            });

            return {
                id: turmaAlunoCompleta.id,
                id_turma: turmaAlunoCompleta.id_turma,
                id_aluno: turmaAlunoCompleta.id_aluno,
                nome_cracha: turmaAlunoCompleta.nome_cracha,
                numero_cracha: turmaAlunoCompleta.numero_cracha,
                vaga_bonus: turmaAlunoCompleta.vaga_bonus,
                created_at: turmaAlunoCompleta.criado_em,
                aluno: turmaAlunoCompleta.id_aluno_fk
                    ? {
                          id: turmaAlunoCompleta.id_aluno_fk.id,
                          nome: turmaAlunoCompleta.id_aluno_fk.nome,
                          email: turmaAlunoCompleta.id_aluno_fk.email,
                          nome_cracha: turmaAlunoCompleta.id_aluno_fk.nome_cracha,
                      }
                    : undefined,
            };
        } catch (error) {
            console.error('Erro ao adicionar aluno à turma:', error);
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao adicionar aluno à turma');
        }
    }

    /**
     * Opções de transferência para um aluno na turma: apenas treinamentos (não palestras).
     * Retorna: edição mais próxima por data e próxima edição no mesmo polo.
     */
    async getOpcoesTransferencia(id_turma_aluno: string): Promise<OpcoesTransferenciaResponseDto> {
        const turmaAluno = await this.uow.turmasAlunosRP.findOne({
            where: { id: id_turma_aluno },
            relations: ['id_turma_fk', 'id_turma_fk.id_treinamento_fk', 'id_turma_fk.id_polo_fk'],
        });
        if (!turmaAluno) throw new NotFoundException('Aluno não encontrado na turma');
        const turmaOrigem = turmaAluno.id_turma_fk;
        if (!turmaOrigem) throw new NotFoundException('Turma de origem não encontrada');
        const treinamento = turmaOrigem.id_treinamento_fk;
        if (!treinamento) throw new NotFoundException('Treinamento da turma não encontrado');
        if (treinamento.tipo_palestra === true) {
            throw new BadRequestException('Transferência só é permitida para treinamentos, não para palestras');
        }
        const id_treinamento = turmaOrigem.id_treinamento;
        const id_turma_origem = turmaOrigem.id;
        const id_polo_origem = turmaOrigem.id_polo;
        const hoje = this.formatDateToDateOnly(new Date().toISOString());

        const outrasTurmas = await this.uow.turmasRP.find({
            where: {
                id_treinamento,
                id: Not(id_turma_origem),
                status_turma: Not(EStatusTurmas.ENCERRADA),
            },
            relations: ['id_treinamento_fk', 'id_polo_fk'],
            order: { data_inicio: 'ASC' },
        });
        const turmasTreinamento = outrasTurmas.filter((t) => t.id_treinamento_fk?.tipo_palestra !== true);

        const comDataFutura = turmasTreinamento.filter((t) => (t.data_inicio ?? '') >= hoje);
        const edicaoMaisProximaData = comDataFutura[0] ?? null;
        const mesmoPolo = turmasTreinamento.filter((t) => t.id_polo === id_polo_origem && (t.data_inicio ?? '') >= hoje);
        const proximaEdicaoMesmoPolo = mesmoPolo[0] ?? null;

        const toTurmaResponse = (t: any): TurmaResponseDto =>
            ({
                id: t.id,
                id_polo: t.id_polo,
                id_treinamento: t.id_treinamento,
                edicao_turma: t.edicao_turma,
                data_inicio: t.data_inicio,
                data_final: t.data_final,
                status_turma: t.status_turma,
                capacidade_turma: t.capacidade_turma,
                turma_aberta: t.turma_aberta,
                treinamento_nome: t.id_treinamento_fk?.treinamento,
                sigla_treinamento: t.id_treinamento_fk?.sigla_treinamento,
                polo_nome: t.id_polo_fk?.polo,
            }) as TurmaResponseDto;

        return {
            edicao_mais_proxima_data: edicaoMaisProximaData ? toTurmaResponse(edicaoMaisProximaData) : undefined,
            proxima_edicao_mesmo_polo: proximaEdicaoMesmoPolo ? toTurmaResponse(proximaEdicaoMesmoPolo) : undefined,
        };
    }

    /**
     * Transfere o aluno para outra turma (mesmo treinamento, outra edição).
     * Remove o vínculo ativo da turma de origem (soft delete), mantendo lastro no histórico de transferências.
     */
    async transferirAluno(id_turma_aluno: string, id_turma_destino: number): Promise<AlunoTurmaResponseDto> {
        const turmaAlunoOrigem = await this.uow.turmasAlunosRP.findOne({
            where: { id: id_turma_aluno, deletado_em: null },
            relations: ['id_aluno_fk', 'id_turma_fk', 'id_turma_fk.id_treinamento_fk'],
        });
        if (!turmaAlunoOrigem) throw new NotFoundException('Aluno não encontrado na turma');
        if (!turmaAlunoOrigem.id_aluno_fk) throw new NotFoundException('Aluno vinculado não encontrado');
        const turmaOrigem = turmaAlunoOrigem.id_turma_fk;
        if (!turmaOrigem) throw new NotFoundException('Turma de origem não encontrada');
        if (turmaOrigem.id_treinamento_fk?.tipo_palestra === true) {
            throw new BadRequestException('Transferência só é permitida para treinamentos, não para palestras');
        }
        if (this.isAlunoTransferidoDaTurma(turmaAlunoOrigem)) {
            const idTurmaDestinoMarcada = Number(turmaAlunoOrigem.id_turma_transferencia_para);
            const matriculaDestinoAtiva = await this.uow.turmasAlunosRP.findOne({
                where: {
                    id_turma: idTurmaDestinoMarcada,
                    id_aluno: turmaAlunoOrigem.id_aluno,
                    deletado_em: null,
                },
            });

            // Se não existe matrícula ativa na turma de destino marcada (ex.: foi soft delete),
            // limpamos o flag de transferência antiga para permitir uma nova transferência.
            if (!matriculaDestinoAtiva) {
                turmaAlunoOrigem.id_turma_transferencia_para = null;
                await this.uow.turmasAlunosRP.save(turmaAlunoOrigem);
            } else {
                throw new BadRequestException('Este vínculo já foi transferido desta turma. Utilize a matrícula ativa para nova transferência');
            }
        }

        const turmaDestino = await this.uow.turmasRP.findOne({
            where: { id: id_turma_destino },
            relations: ['id_treinamento_fk', 'id_polo_fk'],
        });
        if (!turmaDestino) throw new NotFoundException('Turma de destino não encontrada');
        if (turmaDestino.id_treinamento !== turmaOrigem.id_treinamento) {
            throw new BadRequestException('Só é possível transferir para outra edição do mesmo treinamento');
        }
        if (turmaDestino.id_treinamento_fk?.tipo_palestra === true) {
            throw new BadRequestException('Turma de destino não pode ser palestra');
        }
        if (turmaDestino.status_turma === EStatusTurmas.ENCERRADA) {
            throw new BadRequestException('Não é possível transferir para turma encerrada');
        }
        if (turmaDestino.status_turma === EStatusTurmas.INSCRICOES_PAUSADAS) {
            throw new BadRequestException('Não é possível transferir para turma com inscrições pausadas');
        }
        if (Number(id_turma_destino) === turmaOrigem.id) {
            throw new BadRequestException('Turma de destino deve ser diferente da turma de origem');
        }

        const idAluno = parseInt(turmaAlunoOrigem.id_aluno, 10);
        const jaNaTurmaDestino = await this.uow.turmasAlunosRP.findOne({
            where: { id_turma: id_turma_destino, id_aluno: turmaAlunoOrigem.id_aluno, deletado_em: null },
        });
        const nomeCracha = turmaAlunoOrigem.nome_cracha || turmaAlunoOrigem.id_aluno_fk?.nome_cracha || turmaAlunoOrigem.id_aluno_fk?.nome || 'Aluno';
        // Preserva a primeira turma de origem ao longo de múltiplas transferências.
        const idTurmaOrigemHistorica = turmaAlunoOrigem.id_turma_transferencia_de ?? turmaOrigem.id;

        let turmaAlunoDestinoSalvo: any;
        if (jaNaTurmaDestino) {
            // Se já existir vínculo na turma destino, reaproveita-o e marca como vindo de transferência.
            jaNaTurmaDestino.origem_aluno = EOrigemAlunos.TRANSFERENCIA;
            jaNaTurmaDestino.id_turma_transferencia_de = jaNaTurmaDestino.id_turma_transferencia_de ?? idTurmaOrigemHistorica;
            jaNaTurmaDestino.nome_cracha = jaNaTurmaDestino.nome_cracha || nomeCracha;
            jaNaTurmaDestino.status_aluno_turma = EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO;
            turmaAlunoDestinoSalvo = await this.uow.turmasAlunosRP.save(jaNaTurmaDestino);
        } else {
            const numeroCracha = await this.generateUniqueCrachaNumber(id_turma_destino);
            const turmaAlunoDestino = this.uow.turmasAlunosRP.create({
                id_turma: id_turma_destino,
                id_aluno: turmaAlunoOrigem.id_aluno,
                nome_cracha: nomeCracha,
                numero_cracha: numeroCracha,
                vaga_bonus: turmaAlunoOrigem.vaga_bonus ?? false,
                origem_aluno: EOrigemAlunos.TRANSFERENCIA,
                status_aluno_turma: EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO,
                id_turma_transferencia_de: idTurmaOrigemHistorica,
            });
            turmaAlunoDestinoSalvo = await this.uow.turmasAlunosRP.save(turmaAlunoDestino);
        }

        const historico = this.uow.historicoTransferenciasRP.create({
            id_aluno: idAluno,
            id_turma_de: turmaOrigem.id,
            id_turma_para: id_turma_destino,
            id_turma_aluno_de: turmaAlunoOrigem.id,
            id_turma_aluno_para: turmaAlunoDestinoSalvo.id,
        });
        await this.uow.historicoTransferenciasRP.save(historico);

        // Remove o aluno da turma de origem sem perder rastreabilidade.
        turmaAlunoOrigem.id_turma_transferencia_para = id_turma_destino;
        turmaAlunoOrigem.presenca_turma = null;
        turmaAlunoOrigem.deletado_em = new Date();
        await this.uow.turmasAlunosRP.save(turmaAlunoOrigem);

        const turmaAlunoCompleta = await this.uow.turmasAlunosRP.findOne({
            where: { id: turmaAlunoDestinoSalvo.id },
            relations: ['id_aluno_fk', 'id_turma_transferencia_de_fk', 'id_turma_transferencia_de_fk.id_treinamento_fk', 'id_turma_transferencia_de_fk.id_polo_fk'],
        });
        return {
            id: turmaAlunoCompleta.id,
            id_turma: turmaAlunoCompleta.id_turma,
            id_aluno: turmaAlunoCompleta.id_aluno,
            nome_cracha: turmaAlunoCompleta.nome_cracha,
            numero_cracha: turmaAlunoCompleta.numero_cracha,
            vaga_bonus: turmaAlunoCompleta.vaga_bonus,
            status_aluno_turma: turmaAlunoCompleta.status_aluno_turma,
            presenca_turma: turmaAlunoCompleta.presenca_turma,
            url_comprovante_pgto: turmaAlunoCompleta.url_comprovante_pgto,
            created_at: turmaAlunoCompleta.criado_em,
            transferencia_de_turma: this.mapTurmaToTransferenciaTag(turmaAlunoCompleta.id_turma_transferencia_de_fk),
            aluno: turmaAlunoCompleta.id_aluno_fk
                ? {
                      id: turmaAlunoCompleta.id_aluno_fk.id,
                      nome: turmaAlunoCompleta.id_aluno_fk.nome,
                      email: turmaAlunoCompleta.id_aluno_fk.email,
                      nome_cracha: turmaAlunoCompleta.id_aluno_fk.nome_cracha,
                  }
                : undefined,
        };
    }

    /**
     * Histórico de transferências do aluno (de onde saiu para onde foi).
     */
    async getHistoricoTransferencias(id_aluno: number): Promise<HistoricoTransferenciasResponseDto> {
        const list = await this.uow.historicoTransferenciasRP.find({
            where: { id_aluno, deletado_em: null },
            relations: [
                'id_turma_de_fk',
                'id_turma_de_fk.id_treinamento_fk',
                'id_turma_de_fk.id_polo_fk',
                'id_turma_para_fk',
                'id_turma_para_fk.id_treinamento_fk',
                'id_turma_para_fk.id_polo_fk',
            ],
            order: { criado_em: 'DESC' },
        });
        const data: HistoricoTransferenciaItemDto[] = list.map((h) => ({
            id: h.id,
            id_aluno: h.id_aluno,
            id_turma_de: h.id_turma_de,
            id_turma_para: h.id_turma_para,
            origem_label: h.id_turma_de === h.id_turma_para ? 'Time de Vendas IAM' : undefined,
            turma_de: {
                id: h.id_turma_de_fk?.id ?? h.id_turma_de,
                edicao_turma: h.id_turma_de_fk?.edicao_turma,
                data_inicio: h.id_turma_de_fk?.data_inicio ?? '',
                data_final: h.id_turma_de_fk?.data_final ?? '',
                treinamento_nome: h.id_turma_de_fk?.id_treinamento_fk?.treinamento,
                sigla_treinamento: h.id_turma_de_fk?.id_treinamento_fk?.sigla_treinamento,
                polo_nome: h.id_turma_de_fk?.id_polo_fk?.polo,
            },
            turma_para: {
                id: h.id_turma_para_fk?.id ?? h.id_turma_para,
                edicao_turma: h.id_turma_para_fk?.edicao_turma,
                data_inicio: h.id_turma_para_fk?.data_inicio ?? '',
                data_final: h.id_turma_para_fk?.data_final ?? '',
                treinamento_nome: h.id_turma_para_fk?.id_treinamento_fk?.treinamento,
                sigla_treinamento: h.id_turma_para_fk?.id_treinamento_fk?.sigla_treinamento,
                polo_nome: h.id_turma_para_fk?.id_polo_fk?.polo,
            },
            criado_em: h.criado_em,
        }));
        return { data };
    }

    async removeAlunoTurma(id_turma_aluno: string): Promise<void> {
        try {
            const turmaAluno = await this.uow.turmasAlunosRP.findOne({
                where: { id: id_turma_aluno },
            });

            if (!turmaAluno) {
                throw new NotFoundException('Aluno não encontrado na turma');
            }

            // First, find all related turmas_alunos_treinamentos records
            const turmasAlunosTreinamentos = await this.uow.turmasAlunosTreinamentosRP.find({
                where: {
                    id_turma_aluno: id_turma_aluno,
                    deletado_em: null,
                },
            });

            // Soft delete all related turmas_alunos_treinamentos_contratos records
            for (const turmaAlunoTreinamento of turmasAlunosTreinamentos) {
                const contratos = await this.uow.turmasAlunosTreinamentosContratosRP.find({
                    where: {
                        id_turma_aluno_treinamento: turmaAlunoTreinamento.id,
                        deletado_em: null,
                    },
                });

                for (const contrato of contratos) {
                    contrato.deletado_em = new Date();
                    await this.uow.turmasAlunosTreinamentosContratosRP.save(contrato);
                }
            }

            // Soft delete all related turmas_alunos_treinamentos records
            for (const turmaAlunoTreinamento of turmasAlunosTreinamentos) {
                turmaAlunoTreinamento.deletado_em = new Date();
                await this.uow.turmasAlunosTreinamentosRP.save(turmaAlunoTreinamento);
            }

            // Soft delete all related turmas_alunos_produtos records
            const produtos = await this.uow.turmasAlunosProdutosRP.find({
                where: {
                    id_turma_aluno: id_turma_aluno,
                    deletado_em: null,
                },
            });

            for (const produto of produtos) {
                produto.deletado_em = new Date();
                await this.uow.turmasAlunosProdutosRP.save(produto);
            }

            // Soft delete all related turmas_alunos_treinamentos_bonus records
            const bonuses = await this.uow.turmasAlunosTreinamentosBonusRP.find({
                where: {
                    id_turma_aluno: id_turma_aluno,
                    deletado_em: null,
                },
            });

            for (const bonus of bonuses) {
                bonus.deletado_em = new Date();
                await this.uow.turmasAlunosTreinamentosBonusRP.save(bonus);
            }

            // Ao remover uma matrícula, manter o histórico de transferência para fins de auditoria.
            // Apenas limpamos referências diretas em matrículas ativas relacionadas.
            const historicosTransferencia = await this.uow.historicoTransferenciasRP.find({
                where: [
                    { id_turma_aluno_de: id_turma_aluno, deletado_em: null },
                    { id_turma_aluno_para: id_turma_aluno, deletado_em: null },
                ],
            });

            for (const historico of historicosTransferencia) {
                // Limpa referência "transferência para" na matrícula de origem, se existir e estiver ativa.
                if (historico.id_turma_aluno_de && historico.id_turma_aluno_de !== id_turma_aluno) {
                    const matriculaOrigem = await this.uow.turmasAlunosRP.findOne({
                        where: { id: historico.id_turma_aluno_de, deletado_em: null },
                    });
                    if (matriculaOrigem) {
                        matriculaOrigem.id_turma_transferencia_para = null;
                        await this.uow.turmasAlunosRP.save(matriculaOrigem);
                    }
                }

                // Limpa referência "transferência de" na matrícula de destino, se existir e estiver ativa.
                if (historico.id_turma_aluno_para && historico.id_turma_aluno_para !== id_turma_aluno) {
                    const matriculaDestino = await this.uow.turmasAlunosRP.findOne({
                        where: { id: historico.id_turma_aluno_para, deletado_em: null },
                    });
                    if (matriculaDestino) {
                        matriculaDestino.id_turma_transferencia_de = null;
                        await this.uow.turmasAlunosRP.save(matriculaDestino);
                    }
                }

                // Mantém o histórico ativo (não remover da tabela de transferência).
            }

            // Finally, soft delete the turmas_alunos record
            turmaAluno.deletado_em = new Date();
            await this.uow.turmasAlunosRP.save(turmaAluno);
        } catch (error) {
            console.error('Erro ao remover aluno da turma:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao remover aluno da turma');
        }
    }

    async getTurmaStatusResumo(id_turma: number): Promise<TurmaStatusResumoResponseDto> {
        const turma = await this.uow.turmasRP.findOne({
            where: { id: id_turma, deletado_em: null },
        });
        if (!turma) {
            throw new NotFoundException('Turma não encontrada');
        }

        const rawStatus = await this.uow.turmasAlunosRP
            .createQueryBuilder('ta')
            .select('ta.status_aluno_turma', 'status')
            .addSelect('COUNT(*)::int', 'total')
            .where('ta.id_turma = :id_turma', { id_turma })
            .andWhere('ta.deletado_em IS NULL')
            .groupBy('ta.status_aluno_turma')
            .getRawMany();

        const statusCounts: Record<string, number> = {};
        Object.values(EStatusAlunosTurmas).forEach((status) => {
            statusCounts[status] = 0;
        });

        for (const row of rawStatus) {
            const key = row.status || 'SEM_STATUS';
            statusCounts[key] = Number(row.total || 0);
        }

        const inscritos = await this.uow.turmasAlunosRP.count({
            where: { id_turma, deletado_em: null },
        });

        const transferidosDessaTurmaParaOutra = await this.uow.historicoTransferenciasRP.count({
            where: {
                id_turma_de: id_turma,
                deletado_em: null,
            },
        });

        const transferidosDeOutraTurmaParaEssa = await this.uow.historicoTransferenciasRP.count({
            where: {
                id_turma_para: id_turma,
                deletado_em: null,
            },
        });

        const inadimplentes = await this.uow.turmasAlunosRP
            .createQueryBuilder('ta')
            .leftJoin('ta.id_aluno_fk', 'aluno')
            .where('ta.id_turma = :id_turma', { id_turma })
            .andWhere('ta.deletado_em IS NULL')
            .andWhere('aluno.status_aluno_geral = :status', { status: EStatusAlunosGeral.INADIMPLENTE })
            .getCount();

        return {
            id_turma,
            inscritos,
            transferidos: transferidosDessaTurmaParaOutra + transferidosDeOutraTurmaParaEssa,
            transferidos_dessa_turma_para_outra: transferidosDessaTurmaParaOutra,
            transferidos_de_outra_turma_para_essa: transferidosDeOutraTurmaParaEssa,
            falta_enviar_confirmacao: statusCounts[EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO] || 0,
            aguardando_confirmacao: statusCounts[EStatusAlunosTurmas.AGUARDANDO_CONFIRMACAO] || 0,
            falta_enviar_checkin: statusCounts.FALTA_ENVIAR_LINK_CHECKIN || 0,
            aguardando_checkin: statusCounts[EStatusAlunosTurmas.AGUARDANDO_CHECKIN] || 0,
            checkin_realizado: statusCounts[EStatusAlunosTurmas.CHECKIN_REALIZADO] || 0,
            cancelados: statusCounts[EStatusAlunosTurmas.CANCELADO] || 0,
            inadimplentes,
            status_counts: statusCounts,
        };
    }

    async getTurmaStatusAlunos(id_turma: number, tipo: string): Promise<TurmaStatusAlunosResponseDto> {
        const turma = await this.uow.turmasRP.findOne({
            where: { id: id_turma, deletado_em: null },
        });
        if (!turma) {
            throw new NotFoundException('Turma não encontrada');
        }

        const qb = this.uow.turmasAlunosRP
            .createQueryBuilder('ta')
            .leftJoin('ta.id_aluno_fk', 'aluno')
            .select('ta.id', 'id_turma_aluno')
            .addSelect('aluno.id', 'id_aluno')
            .addSelect('aluno.nome', 'nome')
            .addSelect('aluno.email', 'email')
            .addSelect('aluno.telefone_um', 'telefone')
            .addSelect('ta.status_aluno_turma', 'status_aluno_turma')
            .where('ta.id_turma = :id_turma', { id_turma })
            .andWhere('ta.deletado_em IS NULL');

        let titulo = '';
        const formatTurmaRelacionada = (
            siglaTreinamento?: string | null,
            siglaPolo?: string | null,
            edicao?: string | null,
            turmaId?: number | null,
        ): string | null => {
            const treino = (siglaTreinamento || '').trim().toUpperCase();
            const polo = (siglaPolo || '').trim().toUpperCase();
            const ed = (edicao || '').trim().toUpperCase();
            if (treino && polo && ed) return `${treino}_${polo}_${ed}`;
            if (ed) return ed;
            return turmaId ? `Turma #${turmaId}` : null;
        };

        switch (tipo) {
            case 'inscritos':
                titulo = 'Inscritos';
                break;
            case 'transferidos':
                titulo = 'Transferidos';
                {
                    const rawTransferidos = await this.uow.historicoTransferenciasRP
                        .createQueryBuilder('ht')
                        .leftJoin('ht.id_aluno_fk', 'aluno')
                        .leftJoin('ht.id_turma_aluno_para_fk', 'taPara')
                        .leftJoin('ht.id_turma_aluno_de_fk', 'taDe')
                        .leftJoin('ht.id_turma_de_fk', 'turmaDe')
                        .leftJoin('ht.id_turma_para_fk', 'turmaPara')
                        .leftJoin('turmaDe.id_treinamento_fk', 'treinoDe')
                        .leftJoin('turmaDe.id_polo_fk', 'poloDe')
                        .leftJoin('turmaPara.id_treinamento_fk', 'treinoPara')
                        .leftJoin('turmaPara.id_polo_fk', 'poloPara')
                        .select('COALESCE(ht.id_turma_aluno_para::text, ht.id_turma_aluno_de::text, ht.id::text)', 'id_turma_aluno')
                        .addSelect('aluno.id', 'id_aluno')
                        .addSelect('aluno.nome', 'nome')
                        .addSelect('aluno.email', 'email')
                        .addSelect('aluno.telefone_um', 'telefone')
                        .addSelect('COALESCE(taPara.status_aluno_turma, taDe.status_aluno_turma)', 'status_aluno_turma')
                        .addSelect('ht.id_turma_de', 'id_turma_de')
                        .addSelect('ht.id_turma_para', 'id_turma_para')
                        .addSelect('turmaDe.edicao_turma', 'turma_de_edicao')
                        .addSelect('turmaPara.edicao_turma', 'turma_para_edicao')
                        .addSelect('treinoDe.sigla_treinamento', 'turma_de_sigla_treinamento')
                        .addSelect('poloDe.sigla_polo', 'turma_de_sigla_polo')
                        .addSelect('treinoPara.sigla_treinamento', 'turma_para_sigla_treinamento')
                        .addSelect('poloPara.sigla_polo', 'turma_para_sigla_polo')
                        .where('(ht.id_turma_de = :id_turma OR ht.id_turma_para = :id_turma)', { id_turma })
                        .andWhere('ht.deletado_em IS NULL')
                        .orderBy('aluno.nome', 'ASC')
                        .getRawMany();

                    const alunosTransferidos: TurmaStatusAlunosItemDto[] = rawTransferidos.map((row) => ({
                        id_turma_aluno: String(row.id_turma_aluno),
                        id_aluno: Number(row.id_aluno),
                        nome: row.nome,
                        email: row.email,
                        telefone: row.telefone,
                        status_aluno_turma: (row.status_aluno_turma as EStatusAlunosTurmas) || null,
                        transferencia_direcao: Number(row.id_turma_para) === id_turma ? 'Transferido De' : 'Transferido Para',
                        transferencia_turma_relacionada:
                            Number(row.id_turma_para) === id_turma
                                ? formatTurmaRelacionada(row.turma_de_sigla_treinamento, row.turma_de_sigla_polo, row.turma_de_edicao, Number(row.id_turma_de))
                                : formatTurmaRelacionada(
                                      row.turma_para_sigla_treinamento,
                                      row.turma_para_sigla_polo,
                                      row.turma_para_edicao,
                                      Number(row.id_turma_para),
                                  ),
                    }));

                    return {
                        id_turma,
                        tipo,
                        titulo,
                        total: alunosTransferidos.length,
                        alunos: alunosTransferidos,
                    };
                }
            case 'transferidos_para_essa':
                titulo = 'Transferência para essa turma';
                {
                    const rawTransferidosParaEssa = await this.uow.historicoTransferenciasRP
                        .createQueryBuilder('ht')
                        .leftJoin('ht.id_aluno_fk', 'aluno')
                        .leftJoin('ht.id_turma_aluno_para_fk', 'taPara')
                        .leftJoin('ht.id_turma_de_fk', 'turmaDe')
                        .leftJoin('turmaDe.id_treinamento_fk', 'treinoDe')
                        .leftJoin('turmaDe.id_polo_fk', 'poloDe')
                        .select('COALESCE(ht.id_turma_aluno_para::text, ht.id::text)', 'id_turma_aluno')
                        .addSelect('aluno.id', 'id_aluno')
                        .addSelect('aluno.nome', 'nome')
                        .addSelect('aluno.email', 'email')
                        .addSelect('aluno.telefone_um', 'telefone')
                        .addSelect('taPara.status_aluno_turma', 'status_aluno_turma')
                        .addSelect('ht.id_turma_de', 'id_turma_de')
                        .addSelect('turmaDe.edicao_turma', 'turma_de_edicao')
                        .addSelect('treinoDe.sigla_treinamento', 'turma_de_sigla_treinamento')
                        .addSelect('poloDe.sigla_polo', 'turma_de_sigla_polo')
                        .where('ht.id_turma_para = :id_turma', { id_turma })
                        .andWhere('ht.deletado_em IS NULL')
                        .orderBy('aluno.nome', 'ASC')
                        .getRawMany();

                    const alunosTransferidosParaEssa: TurmaStatusAlunosItemDto[] = rawTransferidosParaEssa.map((row) => ({
                        id_turma_aluno: String(row.id_turma_aluno),
                        id_aluno: Number(row.id_aluno),
                        nome: row.nome,
                        email: row.email,
                        telefone: row.telefone,
                        status_aluno_turma: (row.status_aluno_turma as EStatusAlunosTurmas) || null,
                        transferencia_direcao: 'Transferido De',
                        transferencia_turma_relacionada: formatTurmaRelacionada(
                            row.turma_de_sigla_treinamento,
                            row.turma_de_sigla_polo,
                            row.turma_de_edicao,
                            Number(row.id_turma_de),
                        ),
                    }));

                    return {
                        id_turma,
                        tipo,
                        titulo,
                        total: alunosTransferidosParaEssa.length,
                        alunos: alunosTransferidosParaEssa,
                    };
                }
            case 'transferidos_para_outra':
                titulo = 'Transferências para outra turma';
                {
                    const rawTransferidosParaOutra = await this.uow.historicoTransferenciasRP
                        .createQueryBuilder('ht')
                        .leftJoin('ht.id_aluno_fk', 'aluno')
                        .leftJoin('ht.id_turma_aluno_de_fk', 'taDe')
                        .leftJoin('ht.id_turma_para_fk', 'turmaPara')
                        .leftJoin('turmaPara.id_treinamento_fk', 'treinoPara')
                        .leftJoin('turmaPara.id_polo_fk', 'poloPara')
                        .select('COALESCE(ht.id_turma_aluno_de::text, ht.id::text)', 'id_turma_aluno')
                        .addSelect('aluno.id', 'id_aluno')
                        .addSelect('aluno.nome', 'nome')
                        .addSelect('aluno.email', 'email')
                        .addSelect('aluno.telefone_um', 'telefone')
                        .addSelect('taDe.status_aluno_turma', 'status_aluno_turma')
                        .addSelect('ht.id_turma_para', 'id_turma_para')
                        .addSelect('turmaPara.edicao_turma', 'turma_para_edicao')
                        .addSelect('treinoPara.sigla_treinamento', 'turma_para_sigla_treinamento')
                        .addSelect('poloPara.sigla_polo', 'turma_para_sigla_polo')
                        .where('ht.id_turma_de = :id_turma', { id_turma })
                        .andWhere('ht.deletado_em IS NULL')
                        .orderBy('aluno.nome', 'ASC')
                        .getRawMany();

                    const alunosTransferidosParaOutra: TurmaStatusAlunosItemDto[] = rawTransferidosParaOutra.map((row) => ({
                        id_turma_aluno: String(row.id_turma_aluno),
                        id_aluno: Number(row.id_aluno),
                        nome: row.nome,
                        email: row.email,
                        telefone: row.telefone,
                        status_aluno_turma: (row.status_aluno_turma as EStatusAlunosTurmas) || null,
                        transferencia_direcao: 'Transferido Para',
                        transferencia_turma_relacionada: formatTurmaRelacionada(
                            row.turma_para_sigla_treinamento,
                            row.turma_para_sigla_polo,
                            row.turma_para_edicao,
                            Number(row.id_turma_para),
                        ),
                    }));

                    return {
                        id_turma,
                        tipo,
                        titulo,
                        total: alunosTransferidosParaOutra.length,
                        alunos: alunosTransferidosParaOutra,
                    };
                }
            case 'confirmados':
                titulo = 'Confirmados';
                qb.andWhere('ta.status_aluno_turma IN (:...status)', {
                    status: [EStatusAlunosTurmas.AGUARDANDO_CHECKIN, EStatusAlunosTurmas.CHECKIN_REALIZADO],
                });
                break;
            case 'confirmacao_aguardando':
                titulo = 'Aguardando confirmação';
                qb.andWhere('ta.status_aluno_turma IN (:...status)', {
                    status: [EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO, EStatusAlunosTurmas.AGUARDANDO_CONFIRMACAO],
                });
                break;
            case 'checkin_aguardando':
                titulo = 'Aguardando check-in';
                qb.andWhere('ta.status_aluno_turma IN (:...status)', {
                    status: ['FALTA_ENVIAR_LINK_CHECKIN', EStatusAlunosTurmas.AGUARDANDO_CHECKIN],
                });
                break;
            case 'checkin_realizado':
                titulo = 'Check-in realizado';
                qb.andWhere('ta.status_aluno_turma = :status', {
                    status: EStatusAlunosTurmas.CHECKIN_REALIZADO,
                });
                break;
            case 'cancelados':
                titulo = 'Cancelados';
                qb.andWhere('ta.status_aluno_turma = :status', {
                    status: EStatusAlunosTurmas.CANCELADO,
                });
                break;
            case 'inadimplentes':
                titulo = 'Inadimplentes';
                qb.andWhere('aluno.status_aluno_geral = :status', {
                    status: EStatusAlunosGeral.INADIMPLENTE,
                });
                break;
            default:
                titulo = 'Inscritos';
                break;
        }

        qb.orderBy('aluno.nome', 'ASC');

        const raw = await qb.getRawMany();

        const alunos: TurmaStatusAlunosItemDto[] = raw.map((row) => ({
            id_turma_aluno: String(row.id_turma_aluno),
            id_aluno: Number(row.id_aluno),
            nome: row.nome,
            email: row.email,
            telefone: row.telefone,
            status_aluno_turma: (row.status_aluno_turma as EStatusAlunosTurmas) || null,
        }));

        return {
            id_turma,
            tipo,
            titulo,
            total: alunos.length,
            alunos,
        };
    }

    async updateAlunoTurma(id_turma_aluno: string, updateAlunoDto: UpdateAlunoTurmaDto): Promise<AlunoTurmaResponseDto> {
        try {
            const turmaAluno = await this.uow.turmasAlunosRP.findOne({
                where: { id: id_turma_aluno },
                relations: ['id_aluno_fk', 'id_turma_fk', 'id_turma_fk.id_polo_fk', 'id_turma_fk.id_treinamento_fk', 'id_turma_fk.id_endereco_evento_fk'],
            });

            if (!turmaAluno) {
                throw new NotFoundException('Aluno não encontrado na turma');
            }

            // Armazenar status anterior para verificar mudança
            const statusAnterior = turmaAluno.status_aluno_turma;

            // Atualizar campos fornecidos
            if (updateAlunoDto.nome_cracha !== undefined) {
                turmaAluno.nome_cracha = updateAlunoDto.nome_cracha;
            }
            if (updateAlunoDto.url_comprovante_pgto !== undefined) {
                turmaAluno.url_comprovante_pgto = updateAlunoDto.url_comprovante_pgto;
            }
            if (updateAlunoDto.status_aluno_turma !== undefined) {
                turmaAluno.status_aluno_turma = updateAlunoDto.status_aluno_turma as EStatusAlunosTurmas;
            }
            if (updateAlunoDto.presenca_turma !== undefined) {
                turmaAluno.presenca_turma = updateAlunoDto.presenca_turma as EPresencaTurmas;
            }
            if (updateAlunoDto.atualizado_por !== undefined) {
                turmaAluno.atualizado_por = updateAlunoDto.atualizado_por;
            }

            console.log('Atualizando aluno turma com dados:', updateAlunoDto);
            console.log('Dados antes do save:', turmaAluno);

            const turmaAlunoAtualizada = await this.uow.turmasAlunosRP.save(turmaAluno);

            console.log('Dados após save:', turmaAlunoAtualizada);

            // Verificar se o status foi alterado para CHECKIN_REALIZADO
            // Enviar link do formulário para o aluno preencher seus dados
            if (statusAnterior !== EStatusAlunosTurmas.CHECKIN_REALIZADO && turmaAlunoAtualizada.status_aluno_turma === EStatusAlunosTurmas.CHECKIN_REALIZADO) {
                console.log('📧 Status alterado para CHECKIN_REALIZADO - Enviando link do formulário via WhatsApp...');

                // Enviar link do formulário via WhatsApp automaticamente
                await this.enviarLinkFormularioWhatsApp(turmaAlunoAtualizada);
            }

            return {
                id: turmaAlunoAtualizada.id,
                id_turma: turmaAlunoAtualizada.id_turma,
                id_aluno: turmaAlunoAtualizada.id_aluno,
                nome_cracha: turmaAlunoAtualizada.nome_cracha,
                numero_cracha: turmaAlunoAtualizada.numero_cracha,
                vaga_bonus: turmaAlunoAtualizada.vaga_bonus,
                created_at: turmaAlunoAtualizada.criado_em,
                aluno: turmaAlunoAtualizada.id_aluno_fk
                    ? {
                          id: turmaAlunoAtualizada.id_aluno_fk.id,
                          nome: turmaAlunoAtualizada.id_aluno_fk.nome,
                          email: turmaAlunoAtualizada.id_aluno_fk.email,
                          nome_cracha: turmaAlunoAtualizada.id_aluno_fk.nome_cracha,
                      }
                    : undefined,
            };
        } catch (error) {
            console.error('Erro ao atualizar aluno na turma:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao atualizar aluno na turma');
        }
    }

    // Método para gerar número de crachá único dentro da turma
    async generateUniqueCrachaNumber(id_turma: number): Promise<string> {
        const maxTentativas = 100;
        let tentativas = 0;

        while (tentativas < maxTentativas) {
            // Gerar número aleatório entre 0 e 99999
            const numeroAleatorio = Math.floor(Math.random() * 100000);
            const numeroCracha = numeroAleatorio.toString().padStart(5, '0');

            // Verificar se já existe na turma
            const existeNaTurma = await this.uow.turmasAlunosRP.findOne({
                where: {
                    id_turma,
                    numero_cracha: numeroCracha,
                    deletado_em: null,
                },
            });

            if (!existeNaTurma) {
                return numeroCracha;
            }

            tentativas++;
        }

        // Se não conseguir gerar um número único após muitas tentativas
        throw new Error('Não foi possível gerar um número de crachá único para esta turma');
    }

    /**
     * Envia link do formulário de preenchimento via WhatsApp quando status é alterado para CHECKIN_REALIZADO
     */
    private async enviarLinkFormularioWhatsApp(turmaAluno: any): Promise<void> {
        try {
            // Verificar se temos os dados necessários
            if (!turmaAluno.id_aluno_fk || !turmaAluno.id_turma_fk) {
                console.error('❌ Dados insuficientes para enviar link do formulário:', {
                    hasAluno: !!turmaAluno.id_aluno_fk,
                    hasTurma: !!turmaAluno.id_turma_fk,
                });
                return;
            }

            const aluno = turmaAluno.id_aluno_fk;
            const turma = turmaAluno.id_turma_fk;
            const treinamento = turma.id_treinamento_fk;
            const polo = turma.id_polo_fk;
            const enderecoEvento = turma.id_endereco_evento_fk;

            // DATA: usar exatamente o valor do banco (YYYY-MM-DD), sem fuso horário
            // Ex: "2026-03-10" e "2026-03-12" -> "10/03/2026 à 12/03/2026"
            const formatDateOnly = (dateStr: string): string => {
                if (!dateStr || typeof dateStr !== 'string') return 'A confirmar';
                const datePart = dateStr.trim().split('T')[0];
                const parts = datePart.split(/[-/]/);
                if (parts.length < 3) return 'A confirmar';
                const d = parts[2].padStart(2, '0');
                const m = parts[1].padStart(2, '0');
                const y = parts[0];
                return `${d}/${m}/${y}`;
            };
            const dataInicioStr = turma?.data_inicio;
            const dataFinalStr = turma?.data_final;
            let dataStr = 'A confirmar';
            if (dataInicioStr) {
                if (dataFinalStr && dataInicioStr !== dataFinalStr) {
                    dataStr = `${formatDateOnly(dataInicioStr)} à ${formatDateOnly(dataFinalStr)}`;
                } else {
                    dataStr = formatDateOnly(dataInicioStr);
                }
            }

            // LOCAL: nome do local do evento ou do polo
            const localStr = enderecoEvento?.local_evento || polo?.polo || 'A confirmar';

            // ENDEREÇO: logradouro, numero - bairro - cep, cidade - estado
            const buildEndereco = (e: { logradouro?: string; numero?: string; bairro?: string; cep?: string; cidade?: string; estado?: string } | null): string => {
                if (!e) return 'A confirmar';
                const partes = [];
                if (e.logradouro || e.numero) partes.push([e.logradouro, e.numero].filter(Boolean).join(', '));
                if (e.bairro) partes.push(e.bairro);
                const cepCidade = [e.cep, e.cidade].filter(Boolean).join(', ');
                if (cepCidade) partes.push(cepCidade);
                if (e.estado) partes.push(e.estado);
                return partes.length ? partes.join(' - ') : 'A confirmar';
            };
            const enderecoStr =
                buildEndereco(enderecoEvento) !== 'A confirmar'
                    ? buildEndereco(enderecoEvento)
                    : buildEndereco(
                          turma
                              ? {
                                    logradouro: turma.logradouro,
                                    numero: turma.numero,
                                    bairro: turma.bairro,
                                    cep: turma.cep,
                                    cidade: turma.cidade,
                                    estado: turma.estado,
                                }
                              : null,
                      );

            // Gerar token JWT para o link de check-in
            const jwtSecret = process.env.JWT_SECRET || 'default-secret-key';
            const checkInToken = jwt.sign(
                {
                    alunoTurmaId: turmaAluno.id,
                    turmaId: turma.id,
                    timestamp: Date.now(),
                },
                jwtSecret,
                { expiresIn: '7d' }, // Link expira em 7 dias
            );

            // Preparar dados para envio do link
            const checkInData = {
                alunoTurmaId: turmaAluno.id,
                alunoNome: aluno.nome,
                alunoTelefone: aluno.telefone_um,
                turmaId: turma.id,
                treinamentoNome: treinamento?.treinamento || 'Treinamento não informado',
            };

            console.log('📧 Enviando link do formulário para:', {
                nome: aluno.nome,
                telefone: aluno.telefone_um,
                treinamento: checkInData.treinamentoNome,
            });

            // Gerar URL do formulário de preenchimento
            const frontendUrl = process.env.FRONTEND_URL || 'http://iamcontrol.com.br';
            const formularioUrl = `${frontendUrl}/preencherdadosaluno?token=${checkInToken}`;

            // Mensagem no formato do novo template Gupshup
            const message = `Olá *${aluno.nome}*, parabéns por dizer SIM a essa jornada transformadora! ✨

Você garantiu a sua vaga no _*${checkInData.treinamentoNome}*_ e estamos muito animados pra te receber! 🤩

📌*DATA*: ${dataStr}
📌*LOCAL*: ${localStr}
📌*ENDEREÇO*: ${enderecoStr}

Um novo tempo se inicia na sua vida. Permita-se viver tudo o que Deus preparou pra você nesses três dias! 🙌
Para confirmar sua presença, é só clicar no link abaixo, preencher as informações e salvar.

_${formularioUrl}_

Assim que finalizar, sua presença será confirmada automaticamente.
Confirme agora mesmo, para não correr o risco de esquecer ou perder o prazo.

Vamos Prosperar! 🙌`;

            // Enviar mensagem via WhatsApp
            const result = await this.whatsappService.sendMessage(aluno.telefone_um, message, aluno.nome);

            if (result.success) {
                console.log('✅ Link do formulário enviado com sucesso para:', aluno.nome);
            } else {
                console.error('❌ Erro ao enviar link do formulário para:', aluno.nome, result.error);
            }
        } catch (error) {
            console.error('❌ Erro interno ao enviar link do formulário via WhatsApp:', error);
            // Não relançar o erro para não interromper o fluxo principal
        }
    }
}
