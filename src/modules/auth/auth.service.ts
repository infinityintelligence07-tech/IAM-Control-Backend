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
        funcao?: EFuncoes,
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
            funcao,
            url_foto: picture,
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
                await this.uow.usuariosRP.save(exists);
            }

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
            select: ['id', 'nome', 'email', 'primeiro_nome', 'sobrenome', 'telefone', 'setor', 'funcao', 'url_foto'] as any,
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

    async updateProfile(userId: number, primeiro_nome: string, sobrenome: string, email: string, telefone: string, setor: ESetores, funcao: EFuncoes) {
        console.log('updateProfile chamado com:', { userId, primeiro_nome, sobrenome, email, telefone, setor, funcao });

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
            const updateQuery = this.uow.usuariosRP
                .createQueryBuilder()
                .update('Usuarios')
                .set({
                    primeiro_nome,
                    sobrenome,
                    nome: `${primeiro_nome} ${sobrenome}`,
                    telefone,
                    setor,
                    funcao,
                    atualizado_em: new Date(),
                })
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
