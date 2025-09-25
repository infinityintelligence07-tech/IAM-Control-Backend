import { Injectable, NotFoundException } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import {
    GetTreinamentosDto,
    TreinamentosListResponseDto,
    TreinamentoResponseDto,
    CreateTreinamentoDto,
    UpdateTreinamentoDto,
    SoftDeleteTreinamentoDto,
} from './dto/treinamentos.dto';
import { Equal, FindManyOptions, Like, ILike, Not, In } from 'typeorm';
import { Treinamentos } from '../../config/entities/treinamentos.entity';
import { EPresencaTurmas, EStatusAlunosTurmas } from '../../config/entities/enum';

@Injectable()
export class TreinamentosService {
    constructor(private readonly uow: UnitOfWorkService) {}

    private async calcularEstatisticasTreinamento(treinamento: Treinamentos) {
        // Buscar turmas do treinamento
        const turmasIds = await this.uow.turmasRP.find({
            where: { id_treinamento: treinamento.id },
            select: ['id'],
        });

        let totalAlunos = 0;
        if (turmasIds.length > 0) {
            // Para treinamentos normais: contar alunos presentes
            totalAlunos = await this.uow.turmasAlunosRP.count({
                where: {
                    id_turma: In(turmasIds.map((t) => t.id)),
                    presenca_turma: EPresencaTurmas.PRESENTE,
                },
            });

            // Para masterclass/palestras: somar pré-cadastrados presentes
            if (treinamento.tipo_palestra) {
                const preCadastrosPresentes = await this.uow.masterclassPreCadastrosRP.count({
                    where: {
                        id_turma: In(turmasIds.map((t) => t.id)),
                        presente: true,
                    },
                });
                totalAlunos += preCadastrosPresentes;
            }
        }

        // Calcular capacidade total das turmas
        const turmasDoTreinamento = await this.uow.turmasRP.find({
            where: { id_treinamento: treinamento.id },
            select: ['capacidade_turma'],
        });
        const capacidadeTotal = turmasDoTreinamento.reduce((sum, turma) => sum + turma.capacidade_turma, 0);

        // Total de turmas
        const totalTurmas = turmasIds.length;

        return {
            totalTurmas,
            totalAlunos,
            capacidadeTotal,
            alunosPresentes: totalAlunos, // São os mesmos
        };
    }

    async findAll(filters: GetTreinamentosDto): Promise<TreinamentosListResponseDto> {
        const { page = 1, limit = 12, treinamento, preco_treinamento, tipo_treinamento, tipo_palestra, tipo_online } = filters;

        // Construir condições de busca
        const whereConditions: any = {};

        if (treinamento) {
            whereConditions.treinamento = ILike(`%${treinamento}%`);
        }

        if (preco_treinamento) {
            whereConditions.preco_treinamento = Like(`%${preco_treinamento}%`);
        }

        if (tipo_treinamento !== undefined) {
            whereConditions.tipo_treinamento = tipo_treinamento;
        }

        if (tipo_palestra !== undefined) {
            whereConditions.tipo_palestra = tipo_palestra;
        }

        if (tipo_online !== undefined) {
            whereConditions.tipo_online = tipo_online;
        }

        // Adicionar condição para excluir registros deletados
        whereConditions.deletado_em = null;

        // Configurar opções de busca
        const findOptions: FindManyOptions = {
            where: whereConditions,
            order: {
                treinamento: 'ASC',
                criado_em: 'DESC',
            },
            skip: (page - 1) * limit,
            take: limit,
        };

        try {
            // Buscar treinamentos com paginação
            const [treinamentos, total] = await this.uow.treinamentosRP.findAndCount(findOptions);

            // Buscar contagem de turmas e alunos para cada treinamento
            const treinamentosWithCount = await Promise.all(
                treinamentos.map(async (treinamento) => {
                    const stats = await this.calcularEstatisticasTreinamento(treinamento);

                    return {
                        id: treinamento.id,
                        treinamento: treinamento.treinamento,
                        sigla_treinamento: treinamento.sigla_treinamento,
                        preco_treinamento: treinamento.preco_treinamento,
                        url_logo_treinamento: treinamento.url_logo_treinamento,
                        tipo_treinamento: treinamento.tipo_treinamento,
                        tipo_palestra: treinamento.tipo_palestra,
                        tipo_online: treinamento.tipo_online,
                        total_turmas: stats.totalTurmas,
                        total_alunos: stats.totalAlunos,
                        capacidade_total: stats.capacidadeTotal,
                        alunos_presentes: stats.alunosPresentes,
                        created_at: treinamento.criado_em,
                        updated_at: treinamento.atualizado_em,
                    };
                }),
            );

            const totalPages = Math.ceil(total / limit);

            return {
                data: treinamentosWithCount.map((treinamento) => ({
                    ...treinamento,
                    created_at: treinamento.created_at instanceof Date ? treinamento.created_at.toISOString() : treinamento.created_at,
                    updated_at: treinamento.updated_at instanceof Date ? treinamento.updated_at.toISOString() : treinamento.updated_at,
                })),
                total,
                page,
                limit,
                totalPages,
            };
        } catch (error) {
            console.error('Erro ao buscar treinamentos:', error);
            throw new Error('Erro interno do servidor ao buscar treinamentos');
        }
    }

    async findById(id: number): Promise<TreinamentoResponseDto | null> {
        try {
            const treinamento = await this.uow.treinamentosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
            });

            if (!treinamento) {
                return null;
            }

            const totalTurmas = await this.uow.turmasRP.count({
                where: { id_treinamento: treinamento.id },
            });

            const totalAlunos = await this.uow.turmasAlunosTreinamentosRP.count({
                where: {
                    id_treinamento_fk: treinamento.id as any,
                    id_turma_aluno_fk: {
                        status_aluno_turma: Not(EStatusAlunosTurmas.CANCELADO),
                    },
                },
                relations: ['id_turma_aluno_fk'],
            });

            // Calcular capacidade total das turmas
            const turmasDoTreinamento = await this.uow.turmasRP.find({
                where: { id_treinamento: treinamento.id },
                select: ['capacidade_turma'],
            });
            const capacidadeTotal = turmasDoTreinamento.reduce((sum, turma) => sum + turma.capacidade_turma, 0);

            // Contar alunos presentes (que já marcaram presença)
            const alunosPresentes = await this.uow.turmasAlunosTreinamentosRP.count({
                where: {
                    id_treinamento_fk: treinamento.id as any,
                    id_turma_aluno_fk: {
                        presenca_turma: EPresencaTurmas.PRESENTE,
                    },
                },
                relations: ['id_turma_aluno_fk'],
            });

            return {
                id: treinamento.id,
                treinamento: treinamento.treinamento,
                sigla_treinamento: treinamento.sigla_treinamento,
                preco_treinamento: treinamento.preco_treinamento,
                url_logo_treinamento: treinamento.url_logo_treinamento,
                tipo_treinamento: treinamento.tipo_treinamento,
                tipo_palestra: treinamento.tipo_palestra,
                tipo_online: treinamento.tipo_online,
                total_turmas: totalTurmas,
                total_alunos: totalAlunos,
                capacidade_total: capacidadeTotal,
                alunos_presentes: alunosPresentes,
                created_at: treinamento.criado_em instanceof Date ? treinamento.criado_em.toISOString() : treinamento.criado_em,
                updated_at: treinamento.atualizado_em instanceof Date ? treinamento.atualizado_em.toISOString() : treinamento.atualizado_em,
            };
        } catch (error) {
            console.error('Erro ao buscar treinamento por ID:', error);
            throw new Error('Erro interno do servidor ao buscar treinamento');
        }
    }

    async create(createTreinamentoDto: CreateTreinamentoDto): Promise<TreinamentoResponseDto> {
        try {
            const novoTreinamento = new Treinamentos();
            novoTreinamento.treinamento = createTreinamentoDto.treinamento;
            novoTreinamento.sigla_treinamento = createTreinamentoDto.sigla_treinamento;
            novoTreinamento.preco_treinamento = createTreinamentoDto.preco_treinamento;
            novoTreinamento.url_logo_treinamento = createTreinamentoDto.url_logo_treinamento;
            novoTreinamento.tipo_treinamento = createTreinamentoDto.tipo_treinamento;
            novoTreinamento.tipo_palestra = createTreinamentoDto.tipo_palestra;
            novoTreinamento.tipo_online = createTreinamentoDto.tipo_online;
            novoTreinamento.criado_por = createTreinamentoDto.criado_por;

            const treinamentoSalvo = await this.uow.treinamentosRP.save(novoTreinamento);
            console.log('Treinamento criado com sucesso:', treinamentoSalvo);

            return {
                id: treinamentoSalvo.id,
                treinamento: treinamentoSalvo.treinamento,
                sigla_treinamento: treinamentoSalvo.sigla_treinamento,
                preco_treinamento: treinamentoSalvo.preco_treinamento,
                url_logo_treinamento: treinamentoSalvo.url_logo_treinamento,
                tipo_treinamento: treinamentoSalvo.tipo_treinamento,
                tipo_palestra: treinamentoSalvo.tipo_palestra,
                tipo_online: treinamentoSalvo.tipo_online,
                total_turmas: 0,
                total_alunos: 0,
                capacidade_total: 0,
                alunos_presentes: 0,
                created_at: treinamentoSalvo.criado_em instanceof Date ? treinamentoSalvo.criado_em.toISOString() : treinamentoSalvo.criado_em,
                updated_at: treinamentoSalvo.atualizado_em instanceof Date ? treinamentoSalvo.atualizado_em.toISOString() : treinamentoSalvo.atualizado_em,
            };
        } catch (error) {
            console.error('Erro ao criar treinamento:', error);
            throw new Error('Erro interno do servidor ao criar treinamento');
        }
    }

    async update(id: number, updateTreinamentoDto: UpdateTreinamentoDto): Promise<TreinamentoResponseDto> {
        try {
            const treinamento = await this.uow.treinamentosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
            });

            if (!treinamento) {
                throw new NotFoundException(`Treinamento com ID ${id} não encontrado`);
            }

            // Atualizar apenas os campos fornecidos
            if (updateTreinamentoDto.treinamento !== undefined) {
                treinamento.treinamento = updateTreinamentoDto.treinamento;
            }
            if (updateTreinamentoDto.sigla_treinamento !== undefined) {
                treinamento.sigla_treinamento = updateTreinamentoDto.sigla_treinamento;
            }
            if (updateTreinamentoDto.preco_treinamento !== undefined) {
                treinamento.preco_treinamento = updateTreinamentoDto.preco_treinamento;
            }
            if (updateTreinamentoDto.url_logo_treinamento !== undefined) {
                treinamento.url_logo_treinamento = updateTreinamentoDto.url_logo_treinamento;
            }
            if (updateTreinamentoDto.tipo_treinamento !== undefined) {
                treinamento.tipo_treinamento = updateTreinamentoDto.tipo_treinamento;
            }
            if (updateTreinamentoDto.tipo_palestra !== undefined) {
                treinamento.tipo_palestra = updateTreinamentoDto.tipo_palestra;
            }
            if (updateTreinamentoDto.tipo_online !== undefined) {
                treinamento.tipo_online = updateTreinamentoDto.tipo_online;
            }
            if (updateTreinamentoDto.atualizado_por !== undefined) {
                treinamento.atualizado_por = updateTreinamentoDto.atualizado_por;
            }

            const treinamentoAtualizado = await this.uow.treinamentosRP.save(treinamento);
            console.log('Treinamento atualizado com sucesso:', treinamentoAtualizado);

            // Buscar contagens atualizadas
            const totalTurmas = await this.uow.turmasRP.count({
                where: { id_treinamento: treinamento.id },
            });

            const totalAlunos = await this.uow.turmasAlunosTreinamentosRP.count({
                where: {
                    id_treinamento_fk: treinamento.id as any,
                    id_turma_aluno_fk: {
                        status_aluno_turma: Not(EStatusAlunosTurmas.CANCELADO),
                    },
                },
                relations: ['id_turma_aluno_fk'],
            });

            // Calcular capacidade total das turmas
            const turmasDoTreinamento = await this.uow.turmasRP.find({
                where: { id_treinamento: treinamento.id },
                select: ['capacidade_turma'],
            });
            const capacidadeTotal = turmasDoTreinamento.reduce((sum, turma) => sum + turma.capacidade_turma, 0);

            // Contar alunos presentes (que já marcaram presença)
            const alunosPresentes = await this.uow.turmasAlunosTreinamentosRP.count({
                where: {
                    id_treinamento_fk: treinamento.id as any,
                    id_turma_aluno_fk: {
                        presenca_turma: EPresencaTurmas.PRESENTE,
                    },
                },
                relations: ['id_turma_aluno_fk'],
            });

            return {
                id: treinamentoAtualizado.id,
                treinamento: treinamentoAtualizado.treinamento,
                sigla_treinamento: treinamentoAtualizado.sigla_treinamento,
                preco_treinamento: treinamentoAtualizado.preco_treinamento,
                url_logo_treinamento: treinamentoAtualizado.url_logo_treinamento,
                tipo_treinamento: treinamentoAtualizado.tipo_treinamento,
                tipo_palestra: treinamentoAtualizado.tipo_palestra,
                tipo_online: treinamentoAtualizado.tipo_online,
                total_turmas: totalTurmas,
                total_alunos: totalAlunos,
                capacidade_total: capacidadeTotal,
                alunos_presentes: alunosPresentes,
                created_at: treinamentoAtualizado.criado_em instanceof Date ? treinamentoAtualizado.criado_em.toISOString() : treinamentoAtualizado.criado_em,
                updated_at:
                    treinamentoAtualizado.atualizado_em instanceof Date ? treinamentoAtualizado.atualizado_em.toISOString() : treinamentoAtualizado.atualizado_em,
            };
        } catch (error) {
            console.error('Erro ao atualizar treinamento:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao atualizar treinamento');
        }
    }

    async softDelete(id: number, softDeleteDto: SoftDeleteTreinamentoDto): Promise<void> {
        try {
            const treinamento = await this.uow.treinamentosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
            });

            if (!treinamento) {
                throw new NotFoundException(`Treinamento com ID ${id} não encontrado`);
            }

            treinamento.deletado_em = new Date(softDeleteDto.deletado_em);
            treinamento.atualizado_por = softDeleteDto.atualizado_por;

            await this.uow.treinamentosRP.save(treinamento);
            console.log('Treinamento marcado como deletado:', id);
        } catch (error) {
            console.error('Erro ao fazer soft delete do treinamento:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao fazer soft delete do treinamento');
        }
    }

    async delete(id: number): Promise<void> {
        try {
            const treinamento = await this.uow.treinamentosRP.findOne({
                where: { id },
            });

            if (!treinamento) {
                throw new NotFoundException(`Treinamento com ID ${id} não encontrado`);
            }

            await this.uow.treinamentosRP.remove(treinamento);
            console.log('Treinamento excluído permanentemente:', id);
        } catch (error) {
            console.error('Erro ao excluir treinamento permanentemente:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao excluir treinamento');
        }
    }
}
