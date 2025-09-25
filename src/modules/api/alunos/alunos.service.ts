import { Injectable, NotFoundException } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { GetAlunosDto, AlunosListResponseDto, AlunoResponseDto, CreateAlunoDto, UpdateAlunoDto, SoftDeleteAlunoDto } from './dto/alunos.dto';
import { Like, FindManyOptions, ILike } from 'typeorm';
import { Alunos } from '../../config/entities/alunos.entity';

@Injectable()
export class AlunosService {
    constructor(private readonly uow: UnitOfWorkService) {}

    async findAll(filters: GetAlunosDto): Promise<AlunosListResponseDto> {
        const { page = 1, limit = 10, nome, email, cpf, status_aluno_geral, id_polo } = filters;

        console.log('Filtros recebidos:', filters);

        // Construir condições de busca
        const whereConditions: any = {};

        if (nome) {
            whereConditions.nome = ILike(`%${nome}%`);
        }

        if (email) {
            whereConditions.email = ILike(`%${email}%`);
        }

        if (cpf) {
            whereConditions.cpf = ILike(`%${cpf}%`);
        }

        if (status_aluno_geral) {
            whereConditions.status_aluno_geral = status_aluno_geral;
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
                nome: 'ASC',
                criado_em: 'DESC',
            },
            skip: (page - 1) * limit,
            take: limit,
        };

        console.log('Opções de busca:', JSON.stringify(findOptions, null, 2));

        try {
            // Buscar alunos com paginação
            const [alunos, total] = await this.uow.alunosRP.findAndCount(findOptions);

            console.log(`Encontrados ${alunos.length} alunos de um total de ${total}`);

            // Transformar dados para o formato de resposta
            const alunosResponse: AlunoResponseDto[] = alunos.map((aluno) => ({
                id: aluno.id,
                id_polo: aluno.id_polo,
                nome: aluno.nome,
                nome_cracha: aluno.nome_cracha,
                email: aluno.email,
                genero: aluno.genero,
                cpf: aluno.cpf,
                data_nascimento: aluno.data_nascimento,
                telefone_um: aluno.telefone_um,
                telefone_dois: aluno.telefone_dois,
                cep: aluno.cep,
                logradouro: aluno.logradouro,
                complemento: aluno.complemento,
                numero: aluno.numero,
                bairro: aluno.bairro,
                cidade: aluno.cidade,
                estado: aluno.estado,
                profissao: aluno.profissao,
                status_aluno_geral: aluno.status_aluno_geral,
                possui_deficiencia: aluno.possui_deficiencia,
                desc_deficiencia: aluno.desc_deficiencia,
                url_foto_aluno: aluno.url_foto_aluno,
                created_at: aluno.criado_em,
                updated_at: aluno.atualizado_em,
                polo: aluno.id_polo_fk
                    ? {
                          id: aluno.id_polo_fk.id,
                          nome: aluno.id_polo_fk.polo,
                      }
                    : undefined,
            }));

            const totalPages = Math.ceil(total / limit);

            console.log(`Retornando ${alunosResponse.length} alunos para a página ${page}`);

            return {
                data: alunosResponse,
                total,
                page,
                limit,
                totalPages,
            };
        } catch (error) {
            console.error('Erro ao buscar alunos:', error);
            if (error instanceof Error) {
                console.error('Stack trace:', error.stack);
            }
            throw new Error('Erro interno do servidor ao buscar alunos');
        }
    }

    async findById(id: number): Promise<AlunoResponseDto | null> {
        try {
            const aluno = await this.uow.alunosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
                relations: ['id_polo_fk'],
            });

            if (!aluno) {
                return null;
            }

            return {
                id: aluno.id,
                id_polo: aluno.id_polo,
                nome: aluno.nome,
                nome_cracha: aluno.nome_cracha,
                email: aluno.email,
                genero: aluno.genero,
                cpf: aluno.cpf,
                data_nascimento: aluno.data_nascimento,
                telefone_um: aluno.telefone_um,
                telefone_dois: aluno.telefone_dois,
                cep: aluno.cep,
                logradouro: aluno.logradouro,
                complemento: aluno.complemento,
                numero: aluno.numero,
                bairro: aluno.bairro,
                cidade: aluno.cidade,
                estado: aluno.estado,
                profissao: aluno.profissao,
                status_aluno_geral: aluno.status_aluno_geral,
                possui_deficiencia: aluno.possui_deficiencia,
                desc_deficiencia: aluno.desc_deficiencia,
                url_foto_aluno: aluno.url_foto_aluno,
                created_at: aluno.criado_em,
                updated_at: aluno.atualizado_em,
                polo: aluno.id_polo_fk
                    ? {
                          id: aluno.id_polo_fk.id,
                          nome: aluno.id_polo_fk.polo,
                      }
                    : undefined,
            };
        } catch (error) {
            console.error('Erro ao buscar aluno por ID:', error);
            throw new Error('Erro interno do servidor ao buscar aluno');
        }
    }

    async create(createAlunoDto: CreateAlunoDto): Promise<AlunoResponseDto> {
        try {
            const novoAluno = new Alunos();
            Object.assign(novoAluno, createAlunoDto);
            novoAluno.criado_por = createAlunoDto.criado_por;

            const alunoSalvo = await this.uow.alunosRP.save(novoAluno);
            console.log('Aluno criado com sucesso:', alunoSalvo);

            return {
                id: alunoSalvo.id,
                id_polo: alunoSalvo.id_polo,
                nome: alunoSalvo.nome,
                nome_cracha: alunoSalvo.nome_cracha,
                email: alunoSalvo.email,
                genero: alunoSalvo.genero,
                cpf: alunoSalvo.cpf,
                data_nascimento: alunoSalvo.data_nascimento,
                telefone_um: alunoSalvo.telefone_um,
                telefone_dois: alunoSalvo.telefone_dois,
                cep: alunoSalvo.cep,
                logradouro: alunoSalvo.logradouro,
                complemento: alunoSalvo.complemento,
                numero: alunoSalvo.numero,
                bairro: alunoSalvo.bairro,
                cidade: alunoSalvo.cidade,
                estado: alunoSalvo.estado,
                profissao: alunoSalvo.profissao,
                status_aluno_geral: alunoSalvo.status_aluno_geral,
                possui_deficiencia: alunoSalvo.possui_deficiencia,
                desc_deficiencia: alunoSalvo.desc_deficiencia,
                url_foto_aluno: alunoSalvo.url_foto_aluno,
                created_at: alunoSalvo.criado_em,
                updated_at: alunoSalvo.atualizado_em,
                polo: undefined, // Será carregado se necessário
            };
        } catch (error) {
            console.error('Erro ao criar aluno:', error);
            throw new Error('Erro interno do servidor ao criar aluno');
        }
    }

    async update(id: number, updateAlunoDto: UpdateAlunoDto): Promise<AlunoResponseDto> {
        try {
            const aluno = await this.uow.alunosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
                relations: ['id_polo_fk'],
            });

            if (!aluno) {
                throw new NotFoundException(`Aluno com ID ${id} não encontrado`);
            }

            // Atualizar campos fornecidos
            Object.assign(aluno, updateAlunoDto);
            if (updateAlunoDto.atualizado_por !== undefined) {
                aluno.atualizado_por = updateAlunoDto.atualizado_por;
            }

            const alunoAtualizado = await this.uow.alunosRP.save(aluno);
            console.log('Aluno atualizado com sucesso:', alunoAtualizado);

            return {
                id: alunoAtualizado.id,
                id_polo: alunoAtualizado.id_polo,
                nome: alunoAtualizado.nome,
                nome_cracha: alunoAtualizado.nome_cracha,
                email: alunoAtualizado.email,
                genero: alunoAtualizado.genero,
                cpf: alunoAtualizado.cpf,
                data_nascimento: alunoAtualizado.data_nascimento,
                telefone_um: alunoAtualizado.telefone_um,
                telefone_dois: alunoAtualizado.telefone_dois,
                cep: alunoAtualizado.cep,
                logradouro: alunoAtualizado.logradouro,
                complemento: alunoAtualizado.complemento,
                numero: alunoAtualizado.numero,
                bairro: alunoAtualizado.bairro,
                cidade: alunoAtualizado.cidade,
                estado: alunoAtualizado.estado,
                profissao: alunoAtualizado.profissao,
                status_aluno_geral: alunoAtualizado.status_aluno_geral,
                possui_deficiencia: alunoAtualizado.possui_deficiencia,
                desc_deficiencia: alunoAtualizado.desc_deficiencia,
                url_foto_aluno: alunoAtualizado.url_foto_aluno,
                created_at: alunoAtualizado.criado_em,
                updated_at: alunoAtualizado.atualizado_em,
                polo: alunoAtualizado.id_polo_fk
                    ? {
                          id: alunoAtualizado.id_polo_fk.id,
                          nome: alunoAtualizado.id_polo_fk.polo,
                      }
                    : undefined,
            };
        } catch (error) {
            console.error('Erro ao atualizar aluno:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao atualizar aluno');
        }
    }

    async softDelete(id: number, softDeleteDto: SoftDeleteAlunoDto): Promise<void> {
        try {
            const aluno = await this.uow.alunosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
            });

            if (!aluno) {
                throw new NotFoundException(`Aluno com ID ${id} não encontrado`);
            }

            aluno.deletado_em = new Date(softDeleteDto.deletado_em);
            aluno.atualizado_por = softDeleteDto.atualizado_por;

            await this.uow.alunosRP.save(aluno);
            console.log('Aluno marcado como deletado:', id);
        } catch (error) {
            console.error('Erro ao fazer soft delete do aluno:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao fazer soft delete do aluno');
        }
    }

    async delete(id: number): Promise<void> {
        try {
            const aluno = await this.uow.alunosRP.findOne({
                where: { id },
            });

            if (!aluno) {
                throw new NotFoundException(`Aluno com ID ${id} não encontrado`);
            }

            await this.uow.alunosRP.remove(aluno);
            console.log('Aluno excluído permanentemente:', id);
        } catch (error) {
            console.error('Erro ao excluir aluno permanentemente:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao excluir aluno');
        }
    }
}
