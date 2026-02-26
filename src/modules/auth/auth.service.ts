import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Not } from 'typeorm';
import { UnitOfWorkService } from '../config/unit_of_work/uow.service';
import { v4 as uuidv4 } from 'uuid';
import { MailService } from '../mail/mail.service';
import { PasswordValidator } from '../../common/validators/password.validator';
import { EncryptionService } from '../../common/services/encryption.service';
import { EFuncoes, ESetores } from '../config/entities/enum';

@Injectable()
export class AuthService {
    constructor(
        private readonly jwtService: JwtService,
        private readonly uow: UnitOfWorkService,
        private readonly mail: MailService,
        private readonly encryptionService: EncryptionService,
    ) {}

    decryptData(encryptedData: string): any {
        return this.encryptionService.decryptObject(encryptedData);
    }

    async register(
        primeiro_nome: string,
        sobrenome: string,
        email: string,
        senha: string,
        telefone: string,
        setor: ESetores,
        funcao?: EFuncoes[],
        provider: 'google' | 'credentials' = 'credentials',
        providerId?: string,
        picture?: string,
    ) {
        const exists = await this.uow.usuariosRP.findOne({ where: { email } });

        if (exists) throw new BadRequestException('E-mail já cadastrado');

        // Validação de senha apenas para credenciais normais
        if (provider === 'credentials') {
            PasswordValidator.validate(senha);
        }

        // Para Google OAuth, usamos o providerId como "senha genérica"
        // Para credenciais normais, criptografamos a senha
        const plainSecret = provider === 'google' ? providerId || senha : senha;
        if (!plainSecret) throw new BadRequestException('Senha ou token do provedor é obrigatório');

        const fullName = `${primeiro_nome} ${sobrenome}`;

        // Para Google OAuth, criptografamos o providerId
        // Para credenciais normais, criptografamos a senha
        const hash = await bcrypt.hash(plainSecret, 10);

        const user = this.uow.usuariosRP.create({
            nome: fullName,
            primeiro_nome,
            sobrenome,
            email,
            senha: hash,
            telefone,
            setor,
            funcao: funcao || [EFuncoes.COLABORADOR],
            url_foto: picture,
            provider: provider,
        });
        await this.uow.usuariosRP.save(user);

        const token = await this.signToken(user.id, user.email, user.nome);
        return {
            success: true,
            token,
            user: {
                id: user.id,
                nome: user.nome,
                email: user.email,
                primeiro_nome: user.primeiro_nome,
                sobrenome: user.sobrenome,
                telefone: user.telefone,
                setor: user.setor,
                funcao: user.funcao,
                url_foto: user.url_foto,
                provider: user.provider || provider,
            },
        };
    }

    async googleAuth(primeiro_nome: string, sobrenome: string, email: string, providerId: string, picture?: string) {
        const exists = await this.uow.usuariosRP.findOne({ where: { email } });

        if (exists) {
            // Usuário já existe, faz login
            const match = await bcrypt.compare(providerId, exists.senha);
            if (!match) {
                // Atualiza a senha com o novo providerId
                exists.senha = await bcrypt.hash(providerId, 10);
            }
            // Garante que o provider está definido como 'google'
            if (exists.provider !== 'google') {
                exists.provider = 'google';
            }
            // Atualiza a foto se fornecida
            if (picture) {
                exists.url_foto = picture;
            }
            await this.uow.usuariosRP.save(exists);

            const token = await this.signToken(exists.id, exists.email, exists.nome);
            return {
                success: true,
                token,
                user: {
                    id: exists.id,
                    nome: exists.nome,
                    email: exists.email,
                    primeiro_nome: exists.primeiro_nome,
                    sobrenome: exists.sobrenome,
                    telefone: exists.telefone,
                    setor: exists.setor,
                    url_foto: exists.url_foto,
                    provider: exists.provider || 'google',
                },
            };
        } else {
            // Usuário não existe, registra
            return this.register(
                primeiro_nome,
                sobrenome,
                email,
                providerId,
                '', // telefone vazio para Google OAuth
                ESetores.CUIDADO_DE_ALUNOS, // setor padrão
                undefined, // função não definida para Google OAuth
                'google',
                providerId,
                picture,
            );
        }
    }

    async login(email: string, senha: string, provider: 'google' | 'credentials' = 'credentials', providerId?: string) {
        const user = await this.uow.usuariosRP.findOne({ where: { email } });
        if (!user) throw new UnauthorizedException('Credenciais inválidas');

        const providedSecret = provider === 'google' ? providerId || senha : senha;
        if (!providedSecret) throw new UnauthorizedException('Credenciais inválidas');

        // Compara a senha fornecida com a hash armazenada
        const match = await bcrypt.compare(providedSecret, user.senha);
        if (!match) throw new UnauthorizedException('Credenciais inválidas');

        const token = await this.signToken(user.id, user.email, user.nome);
        return {
            success: true,
            token,
            user: {
                id: user.id,
                nome: user.nome,
                email: user.email,
                primeiro_nome: user.primeiro_nome,
                sobrenome: user.sobrenome,
                telefone: user.telefone,
                setor: user.setor,
                funcao: user.funcao,
                url_foto: user.url_foto,
            },
        };
    }

    async me(userId: number) {
        const user = await this.uow.usuariosRP.findOne({
            where: { id: userId },
            select: ['id', 'nome', 'email', 'primeiro_nome', 'sobrenome', 'telefone', 'setor', 'funcao', 'url_foto', 'provider', 'cep', 'logradouro', 'complemento', 'numero', 'bairro', 'cidade', 'estado', 'cpf', 'cnpj', 'rg', 'ctps', 'chave_pix', 'tipo_colaborador', 'data_nascimento', 'data_admissao'] as any,
        });
        return user;
    }

    async requestPasswordReset(email: string, frontendUrl: string) {
        const user = await this.uow.usuariosRP.findOne({ where: { email } });
        if (!user) return; // silently ignore

        const token = uuidv4();
        const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

        const rec = this.uow.passRecTokenRP.create({ id_usuario: user.id, token, expira_em: expires });
        await this.uow.passRecTokenRP.save(rec);

        const resetLink = `${frontendUrl.replace(/\/$/, '')}/auth/reset?token=${token}`;
        await this.mail.sendPasswordRecovery(email, resetLink);
    }

    async resetPassword(token: string, novaSenha: string) {
        const rec = await this.uow.passRecTokenRP.findOne({ where: { token } });
        if (!rec) throw new BadRequestException('Token inválido');
        if (new Date(rec.expira_em).getTime() < Date.now()) throw new BadRequestException('Token expirado');

        const user = await this.uow.usuariosRP.findOne({ where: { id: rec.id_usuario } });
        if (!user) throw new BadRequestException('Usuário inválido');

        user.senha = await bcrypt.hash(novaSenha, 10);
        await this.uow.usuariosRP.save(user);
        await this.uow.passRecTokenRP.delete({ id: rec.id });
        return { ok: true };
    }

    async resetPasswordDirect(email?: string, telefone?: string, novaSenha?: string) {
        if (!email && !telefone) {
            throw new BadRequestException('Email ou telefone é obrigatório');
        }

        if (!novaSenha) {
            throw new BadRequestException('Nova senha é obrigatória');
        }

        // Validar senha
        PasswordValidator.validate(novaSenha);

        let user;
        if (email) {
            user = await this.uow.usuariosRP.findOne({ where: { email } });
            if (!user) {
                throw new BadRequestException('Usuário não encontrado com este email');
            }
        } else if (telefone) {
            user = await this.uow.usuariosRP.findOne({ where: { telefone } });
            if (!user) {
                throw new BadRequestException('Usuário não encontrado com este telefone');
            }
        }

        if (!user) {
            throw new BadRequestException('Usuário não encontrado');
        }

        user.senha = await bcrypt.hash(novaSenha, 10);
        await this.uow.usuariosRP.save(user);

        return { ok: true, message: 'Senha redefinida com sucesso' };
    }

    async changePassword(userId: number, senhaAtual: string, novaSenha: string) {
        const user = await this.uow.usuariosRP.findOne({ where: { id: userId } });
        if (!user) {
            throw new BadRequestException('Usuário não encontrado');
        }

        // Valida a nova senha
        PasswordValidator.validate(novaSenha);

        // Verifica se a senha atual está correta
        const senhaAtualValida = await bcrypt.compare(senhaAtual, user.senha);
        if (!senhaAtualValida) {
            throw new UnauthorizedException('Senha atual incorreta');
        }

        // Verifica se a nova senha é diferente da atual
        const mesmaSenha = await bcrypt.compare(novaSenha, user.senha);
        if (mesmaSenha) {
            throw new BadRequestException('A nova senha deve ser diferente da senha atual');
        }

        // Criptografa a nova senha usando o mesmo método da criação (bcrypt.hash com salt 10)
        const hash = await bcrypt.hash(novaSenha, 10);
        user.senha = hash;
        await this.uow.usuariosRP.save(user);

        return {
            ok: true,
            message: 'Senha alterada com sucesso',
        };
    }

    async updateProfile(userId: number, primeiro_nome: string, sobrenome: string, email: string, telefone: string, setor: ESetores, funcao: EFuncoes[], cep?: string, logradouro?: string, complemento?: string, numero?: string, bairro?: string, cidade?: string, estado?: string, cpf?: string, cnpj?: string, rg?: string, ctps?: string, chave_pix?: string, tipo_colaborador?: string, data_nascimento?: string, data_admissao?: string) {
        console.log('updateProfile chamado com:', { userId, primeiro_nome, sobrenome, email, telefone, setor, funcao, cep, logradouro, complemento, numero, bairro, cidade, estado, cpf, cnpj, rg, ctps, chave_pix, tipo_colaborador, data_nascimento, data_admissao });

        try {
            const user = await this.uow.usuariosRP.findOne({ where: { id: userId } });
            if (!user) {
                throw new BadRequestException('Usuário não encontrado');
            }

            // Verificar se o email já existe em outro usuário (diferente do atual)
            const emailAtualNormalizado = user.email?.toLowerCase().trim();
            const emailNovoNormalizado = email?.toLowerCase().trim();

            console.log('Validando email:', {
                emailAtual: user.email,
                emailNovo: email,
                emailAtualNormalizado,
                emailNovoNormalizado,
                userId,
            });

            // Só validar se o email realmente mudou
            if (emailNovoNormalizado !== emailAtualNormalizado) {
                console.log('Email mudou, validando duplicação...');

                const existingUserCount = await this.uow.usuariosRP
                    .createQueryBuilder('usuario')
                    .where('LOWER(TRIM(usuario.email)) = :email', { email: emailNovoNormalizado })
                    .andWhere('usuario.id != :userId', { userId })
                    .andWhere('usuario.deletado_em IS NULL')
                    .getCount();

                console.log('Contagem de usuários com mesmo email:', existingUserCount);

                if (existingUserCount > 0) {
                    throw new BadRequestException('Email já está em uso por outro usuário');
                }
            } else {
                console.log('Email não mudou, pulando validação de duplicação');
            }

            // Usar updateQueryBuilder para atualizar apenas os campos necessários
            const updateData: any = {
                primeiro_nome,
                sobrenome,
                nome: `${primeiro_nome} ${sobrenome}`,
                telefone,
                setor,
                funcao,
                atualizado_em: new Date(),
            };

            // Adicionar campos de endereço se fornecidos
            if (cep !== undefined) updateData.cep = cep;
            if (logradouro !== undefined) updateData.logradouro = logradouro;
            if (complemento !== undefined) updateData.complemento = complemento;
            if (numero !== undefined) updateData.numero = numero;
            if (bairro !== undefined) updateData.bairro = bairro;
            if (cidade !== undefined) updateData.cidade = cidade;
            if (estado !== undefined) updateData.estado = estado;

            // Adicionar novos campos se fornecidos
            if (cpf !== undefined) updateData.cpf = cpf;
            if (cnpj !== undefined) updateData.cnpj = cnpj;
            if (rg !== undefined) updateData.rg = rg;
            if (ctps !== undefined) updateData.ctps = ctps;
            if (chave_pix !== undefined) updateData.chave_pix = chave_pix;
            if (tipo_colaborador !== undefined) updateData.tipo_colaborador = tipo_colaborador;
            if (data_nascimento !== undefined) {
                // Converter AAAA-MM-DD para Date sem problemas de timezone
                // Usar new Date(ano, mês - 1, dia) para criar data local às 00:00:00
                if (data_nascimento) {
                    const dateMatch = data_nascimento.match(/^(\d{4})-(\d{2})-(\d{2})/);
                    if (dateMatch) {
                        const [, year, month, day] = dateMatch;
                        updateData.data_nascimento = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                    } else {
                        updateData.data_nascimento = new Date(data_nascimento);
                    }
                } else {
                    updateData.data_nascimento = null;
                }
            }
            if (data_admissao !== undefined) {
                // Converter AAAA-MM-DD para Date sem problemas de timezone
                // Usar new Date(ano, mês - 1, dia) para criar data local às 00:00:00
                if (data_admissao) {
                    const dateMatch = data_admissao.match(/^(\d{4})-(\d{2})-(\d{2})/);
                    if (dateMatch) {
                        const [, year, month, day] = dateMatch;
                        updateData.data_admissao = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                    } else {
                        updateData.data_admissao = new Date(data_admissao);
                    }
                } else {
                    updateData.data_admissao = null;
                }
            }

            const updateQuery = this.uow.usuariosRP
                .createQueryBuilder()
                .update('Usuarios')
                .set(updateData)
                .where('id = :userId', { userId });

            // Só atualizar email se realmente mudou
            if (emailNovoNormalizado !== emailAtualNormalizado) {
                updateQuery.set({ email: emailNovoNormalizado });
                console.log('Email será atualizado para:', emailNovoNormalizado);
            } else {
                console.log('Email não mudou, mantendo:', user.email);
            }

            const updateResult = await updateQuery.execute();
            console.log('Resultado da atualização (updateQueryBuilder):', updateResult);

            // Buscar o usuário atualizado para retornar os dados corretos
            const updatedUser = await this.uow.usuariosRP.findOne({ where: { id: userId } });

            return {
                ok: true,
                message: 'Perfil atualizado com sucesso',
                user: {
                    id: updatedUser.id,
                    nome: updatedUser.nome,
                    primeiro_nome: updatedUser.primeiro_nome,
                    sobrenome: updatedUser.sobrenome,
                    email: updatedUser.email,
                    telefone: updatedUser.telefone,
                    setor: updatedUser.setor,
                    funcao: updatedUser.funcao,
                    url_foto: updatedUser.url_foto,
                    cep: updatedUser.cep,
                    logradouro: updatedUser.logradouro,
                    complemento: updatedUser.complemento,
                    numero: updatedUser.numero,
                    bairro: updatedUser.bairro,
                    cidade: updatedUser.cidade,
                    estado: updatedUser.estado,
                    cpf: updatedUser.cpf,
                    cnpj: updatedUser.cnpj,
                    rg: updatedUser.rg,
                    ctps: updatedUser.ctps,
                    chave_pix: updatedUser.chave_pix,
                    tipo_colaborador: updatedUser.tipo_colaborador,
                    data_nascimento: updatedUser.data_nascimento,
                    data_admissao: updatedUser.data_admissao,
                },
            };
        } catch (error) {
            console.error('Error updating profile:', error);

            // Tratar erro específico de violação de constraint única
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                'constraint' in error &&
                (error as any).code === '23505' &&
                (error as any).constraint === 'UQ_446adfc18b35418aac32ae0b7b5'
            ) {
                throw new BadRequestException('Email já está em uso por outro usuário');
            }

            throw error;
        }
    }

    private async signToken(id: number, email: string, nome: string) {
        return this.jwtService.signAsync({ sub: id, email, nome });
    }
}
