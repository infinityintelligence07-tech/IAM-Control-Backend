import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { GetUsuariosDto, UsuariosListResponseDto, UsuarioResponseDto, UpdateUsuarioDto } from './dto/usuarios.dto';
import { ILike, IsNull, Not } from 'typeorm';
import { Usuarios } from '../../config/entities/usuarios.entity';
import { ESetores, EFuncoes } from '../../config/entities/enum';

@Injectable()
export class UsuariosService {
    constructor(private readonly uow: UnitOfWorkService) {}

    async findAll(filters: GetUsuariosDto): Promise<UsuariosListResponseDto> {
        const { page = 1, limit = 10, nome, email, setor } = filters;

        console.log('Filtros recebidos:', filters);

        // Construir condições de busca
        const whereConditions: any = {
            deletado_em: IsNull(),
        };

        if (nome) {
            whereConditions.nome = ILike(`%${nome}%`);
        }

        if (email) {
            whereConditions.email = ILike(`%${email}%`);
        }

        if (setor) {
            whereConditions.setor = setor;
        }

        try {
            // Buscar usuários com paginação
            const [usuarios, total] = await this.uow.usuariosRP.findAndCount({
                where: whereConditions,
                order: {
                    nome: 'ASC',
                    criado_em: 'DESC',
                },
                skip: (page - 1) * limit,
                take: limit,
            });

            console.log(`Encontrados ${usuarios.length} usuários de um total de ${total}`);

            // Transformar dados para o formato de resposta
            const usuariosResponse: UsuarioResponseDto[] = usuarios.map((usuario) => ({
                id: usuario.id,
                nome: usuario.nome,
                primeiro_nome: usuario.primeiro_nome,
                sobrenome: usuario.sobrenome,
                email: usuario.email,
                cpf: usuario.cpf,
                telefone: usuario.telefone,
                setor: usuario.setor,
                funcao: usuario.funcao,
                url_foto: usuario.url_foto,
                criado_em: usuario.criado_em,
                atualizado_em: usuario.atualizado_em,
            }));

            const totalPages = Math.ceil(total / limit);

            console.log(`Retornando ${usuariosResponse.length} usuários para a página ${page}`);

            return {
                data: usuariosResponse,
                total,
                page,
                limit,
                totalPages,
            };
        } catch (error) {
            console.error('Erro ao buscar usuários:', error);
            if (error instanceof Error) {
                console.error('Stack trace:', error.stack);
            }
            throw new Error('Erro interno do servidor ao buscar usuários');
        }
    }

    async findById(id: number): Promise<UsuarioResponseDto | null> {
        try {
            const usuario = await this.uow.usuariosRP.findOne({
                where: {
                    id,
                    deletado_em: IsNull(),
                },
            });

            if (!usuario) {
                return null;
            }

            return {
                id: usuario.id,
                nome: usuario.nome,
                primeiro_nome: usuario.primeiro_nome,
                sobrenome: usuario.sobrenome,
                email: usuario.email,
                cpf: usuario.cpf,
                telefone: usuario.telefone,
                setor: usuario.setor,
                funcao: usuario.funcao,
                url_foto: usuario.url_foto,
                criado_em: usuario.criado_em,
                atualizado_em: usuario.atualizado_em,
            };
        } catch (error) {
            console.error('Erro ao buscar usuário por ID:', error);
            throw new Error('Erro interno do servidor ao buscar usuário');
        }
    }

    async update(id: number, updateUsuarioDto: UpdateUsuarioDto): Promise<UsuarioResponseDto> {
        try {
            const usuario = await this.uow.usuariosRP.findOne({
                where: { id, deletado_em: IsNull() },
            });

            if (!usuario) {
                throw new NotFoundException('Usuário não encontrado');
            }

            // Verificar se o email já existe em outro usuário (se estiver sendo alterado)
            if (updateUsuarioDto.email) {
                const emailNormalizado = updateUsuarioDto.email.toLowerCase().trim();
                const emailAtualNormalizado = usuario.email?.toLowerCase().trim();

                if (emailNormalizado !== emailAtualNormalizado) {
                    const existingUser = await this.uow.usuariosRP.findOne({
                        where: {
                            email: ILike(emailNormalizado),
                            deletado_em: IsNull(),
                            id: Not(id),
                        },
                    });

                    if (existingUser) {
                        throw new BadRequestException('Email já está em uso por outro usuário');
                    }
                }
            }

            // Atualizar campos
            if (updateUsuarioDto.primeiro_nome !== undefined) {
                usuario.primeiro_nome = updateUsuarioDto.primeiro_nome;
                // Atualizar nome completo também
                usuario.nome = `${updateUsuarioDto.primeiro_nome} ${usuario.sobrenome}`;
            }

            if (updateUsuarioDto.sobrenome !== undefined) {
                usuario.sobrenome = updateUsuarioDto.sobrenome;
                // Atualizar nome completo também
                usuario.nome = `${usuario.primeiro_nome} ${updateUsuarioDto.sobrenome}`;
            }

            if (updateUsuarioDto.email !== undefined) {
                usuario.email = updateUsuarioDto.email.toLowerCase().trim();
            }

            if (updateUsuarioDto.telefone !== undefined) {
                usuario.telefone = updateUsuarioDto.telefone;
            }

            if (updateUsuarioDto.setor !== undefined) {
                usuario.setor = updateUsuarioDto.setor;
            }

            if (updateUsuarioDto.funcao !== undefined) {
                usuario.funcao = updateUsuarioDto.funcao;
            }

            if (updateUsuarioDto.url_foto !== undefined) {
                usuario.url_foto = updateUsuarioDto.url_foto;
            }

            // Salvar atualizações
            await this.uow.usuariosRP.save(usuario);

            // Buscar o usuário atualizado
            const usuarioAtualizado = await this.uow.usuariosRP.findOne({
                where: { id },
            });

            return {
                id: usuarioAtualizado.id,
                nome: usuarioAtualizado.nome,
                primeiro_nome: usuarioAtualizado.primeiro_nome,
                sobrenome: usuarioAtualizado.sobrenome,
                email: usuarioAtualizado.email,
                cpf: usuarioAtualizado.cpf,
                telefone: usuarioAtualizado.telefone,
                setor: usuarioAtualizado.setor,
                funcao: usuarioAtualizado.funcao,
                url_foto: usuarioAtualizado.url_foto,
                criado_em: usuarioAtualizado.criado_em,
                atualizado_em: usuarioAtualizado.atualizado_em,
            };
        } catch (error) {
            console.error('Erro ao atualizar usuário:', error);
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao atualizar usuário');
        }
    }
}
