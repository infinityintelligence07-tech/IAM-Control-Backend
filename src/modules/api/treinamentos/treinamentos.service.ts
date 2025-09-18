import { Injectable } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { GetTreinamentosDto, TreinamentosListResponseDto, TreinamentoResponseDto } from './dto/treinamentos.dto';
import { Equal, FindManyOptions, Like, ILike } from 'typeorm';

@Injectable()
export class TreinamentosService {
    constructor(private readonly uow: UnitOfWorkService) {}

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
                    const totalTurmas = await this.uow.turmasRP.count({
                        where: { id_treinamento: treinamento.id },
                    });

                    const totalAlunos = await this.uow.turmasAlunosTreinamentosRP.count({
                        where: { id_treinamento_fk: Equal(treinamento.id) },
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
                where: { id },
            });

            if (!treinamento) {
                return null;
            }

            const totalTurmas = await this.uow.turmasRP.count({
                where: { id_treinamento: treinamento.id },
            });

            const totalAlunos = await this.uow.turmasAlunosTreinamentosRP.count({
                where: { id_treinamento_fk: treinamento.id as any },
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
                created_at: treinamento.criado_em instanceof Date ? treinamento.criado_em.toISOString() : treinamento.criado_em,
                updated_at: treinamento.atualizado_em instanceof Date ? treinamento.atualizado_em.toISOString() : treinamento.atualizado_em,
            };
        } catch (error) {
            console.error('Erro ao buscar treinamento por ID:', error);
            throw new Error('Erro interno do servidor ao buscar treinamento');
        }
    }
}
