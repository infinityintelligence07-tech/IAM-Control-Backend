import { Injectable } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { GetAlunosDto, AlunosListResponseDto, AlunoResponseDto } from './dto/alunos.dto';
import { Like, FindManyOptions, ILike } from 'typeorm';

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
                where: { id },
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
}
