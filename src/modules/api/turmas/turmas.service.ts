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
    SoftDeleteTurmaDto,
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
            const preCadastros = await this.uow.masterclassPreCadastrosRP.find({
                where: {
                    id_turma: In(turmasIds),
                },
            });

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

            return counts;
        } catch (error) {
            console.error('Erro ao buscar contadores de pré-cadastrados:', error);
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
        const { page = 1, limit = 10, edicao_turma, status_turma, id_polo, id_treinamento, tipo_treinamento } = filters;

        console.log('Filtros recebidos:', filters);

        // Construir condições de busca
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

        // Adicionar condição para excluir registros deletados
        whereConditions.deletado_em = null;

        // Configurar opções de busca
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

        try {
            // Buscar turmas com paginação
            const [turmas, total] = await this.uow.turmasRP.findAndCount(findOptions);

            console.log(`Encontradas ${turmas.length} turmas de um total de ${total}`);

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

            // Buscar contadores de pré-cadastrados para turmas de masterclass
            const turmasIds = turmasFiltradas.map((t) => t.id);
            const preCadastrosCount = await this.getPreCadastrosCountByTurmas(turmasIds);

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
                    alunos_count: turma.turmasAlunos?.length || 0,
                    alunos_confirmados_count:
                        turma.turmasAlunos?.filter(
                            (ta) =>
                                ta.status_aluno_turma === EStatusAlunosTurmas.CHECKIN_REALIZADO &&
                                ta.id_aluno_fk?.status_aluno_geral !== EStatusAlunosGeral.INADIMPLENTE,
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

            // Buscar contadores de pré-cadastrados
            const preCadastrosCount = await this.getPreCadastrosCountByTurmas([turma.id]);

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
                alunos_count: turma.turmasAlunos?.length || 0,
                alunos_confirmados_count:
                    turma.turmasAlunos?.filter(
                        (ta) =>
                            ta.status_aluno_turma === EStatusAlunosTurmas.CHECKIN_REALIZADO &&
                            ta.id_aluno_fk?.status_aluno_geral !== EStatusAlunosGeral.INADIMPLENTE,
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

            // Verificar se líder existe
            const lider = await this.uow.usuariosRP.findOne({
                where: { id: createTurmaDto.lider_evento },
            });
            if (!lider) {
                throw new NotFoundException('Líder do evento não encontrado');
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

            // Criar nova turma
            const novaTurma = this.uow.turmasRP.create({
                ...createData,
                ...enderecoData,
                turma_aberta: createTurmaDto.turma_aberta || false,
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
     * Buscar alunos disponíveis para uma turma
     */
    async getAlunosDisponiveis(id_turma?: number, page: number = 1, limit: number = 10): Promise<AlunosDisponiveisResponseDto> {
        try {
            const skip = (page - 1) * limit;

            // Buscar alunos que não estão na turma especificada
            const whereConditions: any = {
                deletado_em: null,
            };

            if (id_turma) {
                // Excluir alunos que já estão nesta turma
                const alunosNaTurma = await this.uow.turmasAlunosRP.find({
                    where: { id_turma },
                    select: ['id_aluno'],
                });

                const idsAlunosNaTurma = alunosNaTurma.map((ta) => ta.id_aluno);
                if (idsAlunosNaTurma.length > 0) {
                    whereConditions.id = Not(In(idsAlunosNaTurma));
                }
            }

            const [alunos, total] = await this.uow.alunosRP.findAndCount({
                where: whereConditions,
                skip,
                take: limit,
                order: { nome: 'ASC' },
            });

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
                relations: ['id_aluno_fk', 'id_turma_fk', 'id_turma_fk.id_treinamento_fk', 'id_turma_fk.id_polo_fk'],
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

            // Buscar turmas onde o aluno está vinculado
            const turmasAluno = await this.uow.turmasAlunosRP.find({
                where: { id_aluno: id_aluno.toString() },
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
                .where('CAST(mc.id_aluno_vinculado AS TEXT) = :idAluno', { idAluno: idAlunoString })
                .orWhere('mc.id_aluno_vinculado = :idAlunoNum', { idAlunoNum: id_aluno })
                .orderBy('mc.criado_em', 'DESC')
                .getMany();

            // Se não encontrou masterclass vinculadas diretamente, buscar por outros critérios
            if (masterclassAluno.length === 0 && aluno) {
                const qb = this.uow.masterclassPreCadastrosRP
                    .createQueryBuilder('mc')
                    .leftJoinAndSelect('mc.id_turma_fk', 'turma')
                    .leftJoinAndSelect('turma.id_treinamento_fk', 'treinamento')
                    .leftJoinAndSelect('turma.id_polo_fk', 'polo')
                    .where('mc.id_aluno_vinculado IS NULL'); // Apenas masterclass não vinculadas

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
            const trilhaTurmas = turmasAluno.map((ta) => {
                const turma = ta.id_turma_fk;
                const treinamento = turma?.id_treinamento_fk;
                const polo = turma?.id_polo_fk;

                const localParts: string[] = [];
                if (turma?.cidade) localParts.push(turma.cidade);
                if (turma?.estado) localParts.push(turma.estado);
                const local = localParts.join(' - ');

                return {
                    id_turma_aluno: ta.id,
                    status_aluno_turma: ta.status_aluno_turma || null,
                    presenca_turma: ta.presenca_turma || null,
                    criado_em: ta.criado_em,
                    tipo: determinarTipo(treinamento),
                    turma: {
                        id: turma?.id || 0,
                        nome_evento: treinamento?.treinamento || '',
                        sigla_evento: treinamento?.sigla_treinamento || treinamento?.treinamento || '',
                        edicao_turma: turma?.edicao_turma || undefined,
                        local,
                        data_inicio: turma?.data_inicio || '',
                        data_final: turma?.data_final || '',
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

            // Verificar se o status está sendo alterado manualmente
            const statusFoiAlteradoManualmente = updateTurmaDto.status_turma !== undefined && updateTurmaDto.status_turma !== turma.status_turma;

            // Atualizar turma
            await this.uow.turmasRP.update(id, {
                ...updateData,
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
                where: { id_turma: id },
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
                where: { id_turma },
                relations: ['id_aluno_fk'],
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
                status_aluno_turma: turmaAluno.status_aluno_turma,
                presenca_turma: turmaAluno.presenca_turma, // Adicionado campo presenca_turma
                url_comprovante_pgto: turmaAluno.url_comprovante_pgto,
                created_at: turmaAluno.criado_em,
                aluno: turmaAluno.id_aluno_fk
                    ? {
                          id: turmaAluno.id_aluno_fk.id,
                          nome: turmaAluno.id_aluno_fk.nome,
                          email: turmaAluno.id_aluno_fk.email,
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
                throw new BadRequestException('Não é possível adicionar alunos em turmas encerradas');
            }

            if (turma.status_turma === EStatusTurmas.INSCRICOES_PAUSADAS) {
                throw new BadRequestException('Não é possível adicionar alunos em turmas com inscrições pausadas');
            }

            const aluno = await this.uow.alunosRP.findOne({ where: { id: addAlunoDto.id_aluno } });

            if (!aluno) {
                throw new NotFoundException('Aluno não encontrado');
            }

            // Verificar se aluno já está na turma
            const alunoJaNaTurma = await this.uow.turmasAlunosRP.findOne({
                where: { id_turma, id_aluno: addAlunoDto.id_aluno.toString() },
            });

            if (alunoJaNaTurma) {
                throw new BadRequestException('Aluno já está matriculado nesta turma');
            }

            // Gerar número de crachá único para esta turma
            const numeroCracha = await this.generateUniqueCrachaNumber(id_turma);

            // Usar nome do crachá fornecido ou o padrão do aluno
            const nomeCracha = addAlunoDto.nome_cracha || aluno.nome_cracha;

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
                status_aluno_turma: (addAlunoDto.status_aluno_turma as EStatusAlunosTurmas) || EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CHECKIN,
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

    async updateAlunoTurma(id_turma_aluno: string, updateAlunoDto: UpdateAlunoTurmaDto): Promise<AlunoTurmaResponseDto> {
        try {
            const turmaAluno = await this.uow.turmasAlunosRP.findOne({
                where: { id: id_turma_aluno },
                relations: ['id_aluno_fk', 'id_turma_fk', 'id_turma_fk.id_polo_fk', 'id_turma_fk.id_treinamento_fk'],
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
            const frontendUrl = process.env.FRONTEND_URL || 'https://localhost:3001';
            const formularioUrl = `${frontendUrl}/preencherdadosaluno?token=${checkInToken}`;

            // Gerar mensagem
            const message = `Olá ${aluno.nome}! 👋

Você está confirmado(a) para o treinamento *${checkInData.treinamentoNome}*! 🎉

📋 Para completar seu cadastro e confirmar sua presença, clique no link abaixo e preencha seus dados:

${formularioUrl}

⚠️ *IMPORTANTE:* Preencha todos os dados solicitados para completar seu check-in.

Nos vemos lá! 🚀`;

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
