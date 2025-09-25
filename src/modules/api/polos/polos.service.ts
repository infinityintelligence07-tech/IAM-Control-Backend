import { Injectable, NotFoundException } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { GetPolosDto, PolosListResponseDto, PoloResponseDto, CreatePoloDto, UpdatePoloDto, SoftDeletePoloDto } from './dto/polos.dto';
import { Like, FindManyOptions, ILike, In } from 'typeorm';
import { Polos } from '../../config/entities/polos.entity';
import { EPresencaTurmas } from '../../config/entities/enum';

@Injectable()
export class PolosService {
    constructor(private readonly uow: UnitOfWorkService) {}

    async findAll(filters: GetPolosDto): Promise<PolosListResponseDto> {
        const { page = 1, limit = 10, polo, cidade, estado } = filters;

        // Construir condições de busca
        const whereConditions: any = {};

        if (polo) {
            whereConditions.polo = ILike(`%${polo}%`);
        }

        if (cidade) {
            whereConditions.cidade = ILike(`%${cidade}%`);
        }

        if (estado) {
            whereConditions.estado = ILike(`%${estado}%`);
        }

        // Adicionar condição para excluir registros deletados
        whereConditions.deletado_em = null;

        // Configurar opções de busca
        const findOptions: FindManyOptions = {
            where: whereConditions,
            order: {
                polo: 'ASC',
                criado_em: 'DESC',
            },
            skip: (page - 1) * limit,
            take: limit,
        };

        try {
            // Buscar polos com paginação
            const [polos, total] = await this.uow.polosRP.findAndCount(findOptions);

            // Buscar contagem de alunos para cada polo
            const polosWithCount = await Promise.all(
                polos.map(async (polo) => {
                    const totalAlunos = await this.uow.alunosRP.count({
                        where: { id_polo: polo.id },
                    });

                    return {
                        id: polo.id,
                        polo: polo.polo,
                        sigla_polo: polo.sigla_polo,
                        cidade: polo.cidade,
                        estado: polo.estado,
                        created_at: polo.criado_em,
                        updated_at: polo.atualizado_em,
                        total_alunos: totalAlunos,
                    };
                }),
            );

            const totalPages = Math.ceil(total / limit);

            return {
                data: polosWithCount,
                total,
                page,
                limit,
                totalPages,
            };
        } catch (error) {
            console.error('Erro ao buscar polos:', error);
            throw new Error('Erro interno do servidor ao buscar polos');
        }
    }

    async findAllGrouped(): Promise<any> {
        try {
            // Buscar todos os polos não deletados
            const polos = await this.uow.polosRP.find({
                where: {
                    deletado_em: null,
                },
                order: {
                    polo: 'ASC',
                    cidade: 'ASC',
                },
            });

            // Agrupar por nome do polo
            const groupedPolos = polos.reduce((acc, polo) => {
                const poloName = polo.polo;

                if (!acc[poloName]) {
                    acc[poloName] = {
                        nome: poloName,
                        cidades: [],
                    };
                }

                acc[poloName].cidades.push({
                    id: polo.id,
                    cidade: polo.cidade,
                    estado: polo.estado,
                    created_at: polo.criado_em,
                    updated_at: polo.atualizado_em,
                });

                return acc;
            }, {} as any);

            // Buscar contagem de alunos para cada cidade
            const result = await Promise.all(
                Object.values(groupedPolos).map(async (grupo: any) => {
                    const cidadesComCount = await Promise.all(
                        grupo.cidades.map(async (cidade: any) => {
                            const totalAlunos = await this.uow.alunosRP.count({
                                where: { id_polo: cidade.id },
                            });

                            return {
                                ...cidade,
                                total_alunos: totalAlunos,
                            };
                        }),
                    );

                    // Calcular dados de Masterclass (MC) para este polo
                    const poloIds = grupo.cidades.map((cidade: any) => cidade.id);
                    console.log(`[DEBUG] Polo ${grupo.nome} - IDs das cidades:`, poloIds);

                    // Buscar turmas de todas as cidades deste polo
                    const turmasTodasCidades = await this.uow.turmasRP.find({
                        where: {
                            id_polo: In(poloIds),
                            deletado_em: null,
                        },
                        relations: ['id_treinamento_fk'],
                    });

                    console.log(`[DEBUG] Polo ${grupo.nome} - Total de turmas encontradas:`, turmasTodasCidades.length);
                    console.log(
                        `[DEBUG] Polo ${grupo.nome} - Turmas:`,
                        turmasTodasCidades.map((t) => ({
                            id: t.id,
                            tipo: t.id_treinamento_fk?.tipo_treinamento,
                            nome: t.id_treinamento_fk?.treinamento,
                        })),
                    );

                    // Filtrar apenas turmas que são palestras/masterclass (tipo_treinamento = false = palestra)
                    const turmasPalestras = turmasTodasCidades.filter((turma) => turma.id_treinamento_fk?.tipo_treinamento === false);

                    // Buscar pré-cadastros de masterclass para essas turmas
                    let totalPresentesMC = 0;
                    let totalPreCadastradosMC = 0;

                    if (turmasPalestras.length > 0) {
                        const turmasIds = turmasPalestras.map((t) => t.id);
                        const preCadastros = await this.uow.masterclassPreCadastrosRP.find({
                            where: {
                                id_turma: In(turmasIds),
                                deletado_em: null,
                            },
                        });

                        totalPreCadastradosMC = preCadastros.length;
                        totalPresentesMC = preCadastros.filter((pc) => pc.presente).length;
                    }

                    // Calcular dados de IPR para este polo
                    const turmasIPR = turmasTodasCidades.filter(
                        (turma) =>
                            turma.id_treinamento_fk?.tipo_treinamento === true &&
                            (turma.id_treinamento_fk?.treinamento?.toLowerCase().includes('ipr') ||
                                turma.id_treinamento_fk?.treinamento?.toLowerCase().includes('imersão') ||
                                turma.id_treinamento_fk?.treinamento?.toLowerCase().includes('prosperar')),
                    );

                    console.log(`[DEBUG] Polo ${grupo.nome} - Turmas IPR encontradas:`, turmasIPR.length);
                    console.log(
                        `[DEBUG] Polo ${grupo.nome} - Turmas IPR:`,
                        turmasIPR.map((t) => ({
                            id: t.id,
                            nome: t.id_treinamento_fk?.treinamento,
                        })),
                    );

                    let totalPresentesIPR = 0;
                    let totalInscritosIPR = 0;

                    if (turmasIPR.length > 0) {
                        for (const turma of turmasIPR) {
                            const alunosTurma = await this.uow.turmasAlunosRP.find({
                                where: { id_turma: turma.id },
                            });

                            console.log(`[DEBUG] Turma ${turma.id} - Alunos inscritos:`, alunosTurma.length);
                            console.log(
                                `[DEBUG] Turma ${turma.id} - Alunos presentes:`,
                                alunosTurma.filter((at) => at.presenca_turma === EPresencaTurmas.PRESENTE).length,
                            );

                            totalInscritosIPR += alunosTurma.length;
                            totalPresentesIPR += alunosTurma.filter((at) => at.presenca_turma === EPresencaTurmas.PRESENTE).length;
                        }
                    }

                    console.log(`[DEBUG] Polo ${grupo.nome} - Total inscritos IPR:`, totalInscritosIPR);
                    console.log(`[DEBUG] Polo ${grupo.nome} - Total presentes IPR:`, totalPresentesIPR);

                    // Calcular percentuais
                    const percentualMC = totalPreCadastradosMC > 0 ? Math.round((totalPresentesMC / totalPreCadastradosMC) * 100) : 0;

                    const percentualIPR = totalInscritosIPR > 0 ? Math.round((totalPresentesIPR / totalInscritosIPR) * 100) : 0;

                    return {
                        ...grupo,
                        cidades: cidadesComCount,
                        total_cidades: cidadesComCount.length,
                        total_alunos: cidadesComCount.reduce((sum, cidade) => sum + cidade.total_alunos, 0),
                        // Dados de Masterclass (MC)
                        total_presentes_mc: totalPresentesMC,
                        total_pre_cadastrados_mc: totalPreCadastradosMC,
                        percentual_presentes_mc: percentualMC,
                        // Dados de Imersão Prosperar (IPR)
                        total_presentes_ipr: totalPresentesIPR,
                        total_inscritos_ipr: totalInscritosIPR,
                        percentual_presentes_ipr: percentualIPR,
                    };
                }),
            );

            return result;
        } catch (error) {
            console.error('Erro ao buscar polos agrupados:', error);
            throw new Error('Erro interno do servidor ao buscar polos agrupados');
        }
    }

    async findById(id: number): Promise<PoloResponseDto | null> {
        try {
            const polo = await this.uow.polosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
            });

            if (!polo) {
                return null;
            }

            const totalAlunos = await this.uow.alunosRP.count({
                where: { id_polo: polo.id },
            });

            return {
                id: polo.id,
                polo: polo.polo,
                sigla_polo: polo.sigla_polo,
                cidade: polo.cidade,
                estado: polo.estado,
                created_at: polo.criado_em,
                updated_at: polo.atualizado_em,
                total_alunos: totalAlunos,
            };
        } catch (error) {
            console.error('Erro ao buscar polo por ID:', error);
            throw new Error('Erro interno do servidor ao buscar polo');
        }
    }

    async create(createPoloDto: CreatePoloDto): Promise<PoloResponseDto> {
        try {
            const novoPolo = new Polos();
            novoPolo.polo = createPoloDto.polo;
            novoPolo.sigla_polo = createPoloDto.sigla_polo || '';
            novoPolo.cidade = createPoloDto.cidade;
            novoPolo.estado = createPoloDto.estado;
            novoPolo.criado_por = createPoloDto.criado_por;

            const poloSalvo = await this.uow.polosRP.save(novoPolo);
            console.log('Polo criado com sucesso:', poloSalvo);

            return {
                id: poloSalvo.id,
                polo: poloSalvo.polo,
                sigla_polo: poloSalvo.sigla_polo,
                cidade: poloSalvo.cidade,
                estado: poloSalvo.estado,
                created_at: poloSalvo.criado_em,
                updated_at: poloSalvo.atualizado_em,
                total_alunos: 0,
            };
        } catch (error) {
            console.error('Erro ao criar polo:', error);
            throw new Error('Erro interno do servidor ao criar polo');
        }
    }

    async update(id: number, updatePoloDto: UpdatePoloDto): Promise<PoloResponseDto> {
        try {
            const polo = await this.uow.polosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
            });

            if (!polo) {
                throw new NotFoundException(`Polo com ID ${id} não encontrado`);
            }

            // Atualizar apenas os campos fornecidos
            if (updatePoloDto.polo !== undefined) {
                polo.polo = updatePoloDto.polo;
            }
            if (updatePoloDto.sigla_polo !== undefined) {
                polo.sigla_polo = updatePoloDto.sigla_polo;
            }
            if (updatePoloDto.cidade !== undefined) {
                polo.cidade = updatePoloDto.cidade;
            }
            if (updatePoloDto.estado !== undefined) {
                polo.estado = updatePoloDto.estado;
            }
            if (updatePoloDto.atualizado_por !== undefined) {
                polo.atualizado_por = updatePoloDto.atualizado_por;
            }

            const poloAtualizado = await this.uow.polosRP.save(polo);
            console.log('Polo atualizado com sucesso:', poloAtualizado);

            // Buscar contagem atualizada de alunos
            const totalAlunos = await this.uow.alunosRP.count({
                where: { id_polo: polo.id },
            });

            return {
                id: poloAtualizado.id,
                polo: poloAtualizado.polo,
                sigla_polo: poloAtualizado.sigla_polo,
                cidade: poloAtualizado.cidade,
                estado: poloAtualizado.estado,
                created_at: poloAtualizado.criado_em,
                updated_at: poloAtualizado.atualizado_em,
                total_alunos: totalAlunos,
            };
        } catch (error) {
            console.error('Erro ao atualizar polo:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao atualizar polo');
        }
    }

    async softDelete(id: number, softDeleteDto: SoftDeletePoloDto): Promise<void> {
        try {
            const polo = await this.uow.polosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
            });

            if (!polo) {
                throw new NotFoundException(`Polo com ID ${id} não encontrado`);
            }

            polo.deletado_em = new Date(softDeleteDto.deletado_em);
            polo.atualizado_por = softDeleteDto.atualizado_por;

            await this.uow.polosRP.save(polo);
            console.log('Polo marcado como deletado:', id);
        } catch (error) {
            console.error('Erro ao fazer soft delete do polo:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao fazer soft delete do polo');
        }
    }

    async delete(id: number): Promise<void> {
        try {
            const polo = await this.uow.polosRP.findOne({
                where: { id },
            });

            if (!polo) {
                throw new NotFoundException(`Polo com ID ${id} não encontrado`);
            }

            await this.uow.polosRP.remove(polo);
            console.log('Polo excluído permanentemente:', id);
        } catch (error) {
            console.error('Erro ao excluir polo permanentemente:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao excluir polo');
        }
    }
}
