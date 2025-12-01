import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import {
    GetEnderecoEventosDto,
    EnderecoEventosListResponseDto,
    EnderecoEventoResponseDto,
    CreateEnderecoEventoDto,
    UpdateEnderecoEventoDto,
    SoftDeleteEnderecoEventoDto,
} from './dto/endereco-eventos.dto';
import { Like, FindManyOptions, ILike, IsNull, Not } from 'typeorm';
import { EnderecoEventos } from '../../config/entities/enderecoEventos.entity';

@Injectable()
export class EnderecoEventosService {
    constructor(private readonly uow: UnitOfWorkService) {}

    async findAll(filters: GetEnderecoEventosDto): Promise<EnderecoEventosListResponseDto> {
        const { page = 1, limit = 10, local_evento, logradouro, cidade, estado, id_polo } = filters;

        console.log('Filtros recebidos:', filters);

        // Construir condições de busca
        const whereConditions: any = {};

        if (local_evento) {
            whereConditions.local_evento = ILike(`%${local_evento}%`);
        }

        if (logradouro) {
            whereConditions.logradouro = ILike(`%${logradouro}%`);
        }

        if (cidade) {
            whereConditions.cidade = ILike(`%${cidade}%`);
        }

        if (estado) {
            whereConditions.estado = ILike(`%${estado}%`);
        }

        if (id_polo) {
            whereConditions.id_polo = id_polo;
        }

        // Adicionar condição para excluir registros deletados
        whereConditions.deletado_em = null;

        // Configurar opções de busca
        const findOptions: FindManyOptions = {
            where: whereConditions,
            relations: ['id_polo_fk'],
            order: {
                local_evento: 'ASC',
            },
            skip: (page - 1) * limit,
            take: limit,
        };

        console.log('Opções de busca:', JSON.stringify(findOptions, null, 2));

        try {
            // Buscar endereços com paginação
            const [enderecos, total] = await this.uow.enderecoEventosRP.findAndCount(findOptions);

            console.log(`Encontrados ${enderecos.length} endereços de um total de ${total}`);

            // Transformar dados para o formato de resposta
            const enderecosResponse: EnderecoEventoResponseDto[] = enderecos.map((endereco) => ({
                id: endereco.id,
                id_polo: endereco.id_polo,
                local_evento: endereco.local_evento,
                logradouro: endereco.logradouro,
                numero: endereco.numero,
                bairro: endereco.bairro,
                cidade: endereco.cidade,
                estado: endereco.estado,
                cep: endereco.cep,
                created_at: endereco.criado_em,
                updated_at: endereco.atualizado_em,
                polo: endereco.id_polo_fk
                    ? {
                          id: endereco.id_polo_fk.id,
                          nome: endereco.id_polo_fk.polo,
                      }
                    : undefined,
            }));

            const totalPages = Math.ceil(total / limit);

            console.log(`Retornando ${enderecosResponse.length} endereços para a página ${page}`);

            return {
                data: enderecosResponse,
                total,
                page,
                limit,
                totalPages,
            };
        } catch (error) {
            console.error('Erro ao buscar endereços:', error);
            if (error instanceof Error) {
                console.error('Stack trace:', error.stack);
            }
            throw new Error('Erro interno do servidor ao buscar endereços');
        }
    }

    async findById(id: number): Promise<EnderecoEventoResponseDto | null> {
        try {
            const endereco = await this.uow.enderecoEventosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
                relations: ['id_polo_fk'],
            });

            if (!endereco) {
                return null;
            }

            return {
                id: endereco.id,
                id_polo: endereco.id_polo,
                local_evento: endereco.local_evento,
                logradouro: endereco.logradouro,
                numero: endereco.numero,
                bairro: endereco.bairro,
                cidade: endereco.cidade,
                estado: endereco.estado,
                cep: endereco.cep,
                created_at: endereco.criado_em,
                updated_at: endereco.atualizado_em,
                polo: endereco.id_polo_fk
                    ? {
                          id: endereco.id_polo_fk.id,
                          nome: endereco.id_polo_fk.polo,
                      }
                    : undefined,
            };
        } catch (error) {
            console.error('Erro ao buscar endereço por ID:', error);
            throw new Error('Erro interno do servidor ao buscar endereço');
        }
    }

    async create(createEnderecoEventoDto: CreateEnderecoEventoDto): Promise<EnderecoEventoResponseDto> {
        try {
            // Verificar se o polo existe
            const polo = await this.uow.polosRP.findOne({
                where: { id: createEnderecoEventoDto.id_polo },
            });

            if (!polo) {
                throw new BadRequestException('Polo não encontrado');
            }

            // Criar novo endereço
            const novoEndereco = this.uow.enderecoEventosRP.create({
                id_polo: createEnderecoEventoDto.id_polo,
                local_evento: createEnderecoEventoDto.local_evento,
                logradouro: createEnderecoEventoDto.logradouro,
                numero: createEnderecoEventoDto.numero,
                bairro: createEnderecoEventoDto.bairro,
                cidade: createEnderecoEventoDto.cidade,
                estado: createEnderecoEventoDto.estado,
                cep: createEnderecoEventoDto.cep,
                criado_por: createEnderecoEventoDto.criado_por,
            });

            const enderecoSalvo = await this.uow.enderecoEventosRP.save(novoEndereco);

            // Buscar endereço com relações
            const enderecoCompleto = await this.uow.enderecoEventosRP.findOne({
                where: { id: enderecoSalvo.id },
                relations: ['id_polo_fk'],
            });

            if (!enderecoCompleto) {
                throw new NotFoundException('Endereço não encontrado após criação');
            }

            return {
                id: enderecoCompleto.id,
                id_polo: enderecoCompleto.id_polo,
                local_evento: enderecoCompleto.local_evento,
                logradouro: enderecoCompleto.logradouro,
                numero: enderecoCompleto.numero,
                bairro: enderecoCompleto.bairro,
                cidade: enderecoCompleto.cidade,
                estado: enderecoCompleto.estado,
                cep: enderecoCompleto.cep,
                created_at: enderecoCompleto.criado_em,
                updated_at: enderecoCompleto.atualizado_em,
                polo: enderecoCompleto.id_polo_fk
                    ? {
                          id: enderecoCompleto.id_polo_fk.id,
                          nome: enderecoCompleto.id_polo_fk.polo,
                      }
                    : undefined,
            };
        } catch (error) {
            console.error('Erro ao criar endereço:', error);
            if (error instanceof BadRequestException || error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao criar endereço');
        }
    }

    async update(id: number, updateEnderecoEventoDto: UpdateEnderecoEventoDto): Promise<EnderecoEventoResponseDto> {
        try {
            const endereco = await this.uow.enderecoEventosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
            });

            if (!endereco) {
                throw new NotFoundException('Endereço não encontrado');
            }

            // Verificar se o polo existe (se foi fornecido)
            if (updateEnderecoEventoDto.id_polo) {
                const polo = await this.uow.polosRP.findOne({
                    where: { id: updateEnderecoEventoDto.id_polo },
                });

                if (!polo) {
                    throw new BadRequestException('Polo não encontrado');
                }
            }

            // Atualizar campos
            Object.assign(endereco, {
                ...(updateEnderecoEventoDto.id_polo !== undefined && { id_polo: updateEnderecoEventoDto.id_polo }),
                ...(updateEnderecoEventoDto.local_evento !== undefined && { local_evento: updateEnderecoEventoDto.local_evento }),
                ...(updateEnderecoEventoDto.logradouro !== undefined && { logradouro: updateEnderecoEventoDto.logradouro }),
                ...(updateEnderecoEventoDto.numero !== undefined && { numero: updateEnderecoEventoDto.numero }),
                ...(updateEnderecoEventoDto.bairro !== undefined && { bairro: updateEnderecoEventoDto.bairro }),
                ...(updateEnderecoEventoDto.cidade !== undefined && { cidade: updateEnderecoEventoDto.cidade }),
                ...(updateEnderecoEventoDto.estado !== undefined && { estado: updateEnderecoEventoDto.estado }),
                ...(updateEnderecoEventoDto.cep !== undefined && { cep: updateEnderecoEventoDto.cep }),
                ...(updateEnderecoEventoDto.atualizado_por !== undefined && { atualizado_por: updateEnderecoEventoDto.atualizado_por }),
            });

            const enderecoAtualizado = await this.uow.enderecoEventosRP.save(endereco);

            // Buscar endereço atualizado com relações
            const enderecoCompleto = await this.uow.enderecoEventosRP.findOne({
                where: { id: enderecoAtualizado.id },
                relations: ['id_polo_fk'],
            });

            if (!enderecoCompleto) {
                throw new NotFoundException('Endereço não encontrado após atualização');
            }

            return {
                id: enderecoCompleto.id,
                id_polo: enderecoCompleto.id_polo,
                local_evento: enderecoCompleto.local_evento,
                logradouro: enderecoCompleto.logradouro,
                numero: enderecoCompleto.numero,
                bairro: enderecoCompleto.bairro,
                cidade: enderecoCompleto.cidade,
                estado: enderecoCompleto.estado,
                cep: enderecoCompleto.cep,
                created_at: enderecoCompleto.criado_em,
                updated_at: enderecoCompleto.atualizado_em,
                polo: enderecoCompleto.id_polo_fk
                    ? {
                          id: enderecoCompleto.id_polo_fk.id,
                          nome: enderecoCompleto.id_polo_fk.polo,
                      }
                    : undefined,
            };
        } catch (error) {
            console.error('Erro ao atualizar endereço:', error);
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao atualizar endereço');
        }
    }

    async softDelete(id: number, softDeleteDto: SoftDeleteEnderecoEventoDto): Promise<void> {
        try {
            const endereco = await this.uow.enderecoEventosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
            });

            if (!endereco) {
                throw new NotFoundException('Endereço não encontrado');
            }

            endereco.deletado_em = new Date(softDeleteDto.deletado_em);
            if (softDeleteDto.atualizado_por !== undefined) {
                endereco.atualizado_por = softDeleteDto.atualizado_por;
            }

            await this.uow.enderecoEventosRP.save(endereco);
        } catch (error) {
            console.error('Erro ao fazer soft delete do endereço:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao deletar endereço');
        }
    }
}
