import { Body, Controller, Get, Post, Put, Query, Req, Res, UseGuards, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt.guard';
import { GoogleAuthGuard } from './guards/google.guard';
import { Request } from 'express';
import { SignupDto, LoginDto, ForgotPasswordDto, ResetPasswordDto } from '../../common/dto/auth.dto';
import { ESetores, EFuncoes } from '../config/entities/enum';

@Controller('auth')
@UseInterceptors(ClassSerializerInterceptor)
export class AuthController {
    constructor(private readonly auth: AuthService) {}

    @Post('register')
    async register(@Body() body: any) {
        try {
            // Se os dados estão criptografados, descriptografa
            if (body.encryptedData) {
                console.log('Decrypting encrypted data...');
                const decryptedData = this.auth.decryptData(body.encryptedData);
                console.log('Decrypted data:', decryptedData);

                return this.auth.register(
                    decryptedData.primeiro_nome,
                    decryptedData.sobrenome,
                    decryptedData.email,
                    decryptedData.senha,
                    decryptedData.telefone,
                    decryptedData.setor,
                    decryptedData.provider || 'credentials',
                    decryptedData.providerId,
                    decryptedData.picture,
                );
            }

            // Se os dados não estão criptografados, usa diretamente
            console.log('Using plain data:', body);
            const dto = body as SignupDto;
            return this.auth.register(
                dto.primeiro_nome,
                dto.sobrenome,
                dto.email,
                dto.senha,
                dto.telefone,
                dto.setor,
                dto.funcao,
                dto.provider || 'credentials',
                dto.providerId,
                dto.picture,
            );
        } catch (error) {
            console.error('Error in register controller:', error);
            throw error;
        }
    }

    @Post('login')
    async login(@Body() body: any) {
        // Se os dados estão criptografados, descriptografa
        if (body.encryptedData) {
            const decryptedData = this.auth.decryptData(body.encryptedData);
            return this.auth.login(decryptedData.email, decryptedData.senha, decryptedData.provider || 'credentials', decryptedData.providerId);
        }

        // Se os dados não estão criptografados, usa diretamente
        const dto = body as LoginDto;
        return this.auth.login(dto.email, dto.senha, dto.provider || 'credentials', dto.providerId);
    }

    @Get('google')
    @UseGuards(GoogleAuthGuard)
    googleAuth() {
        // Inicia o fluxo de autenticação do Google
    }

    @Get('google/callback')
    @UseGuards(GoogleAuthGuard)
    async googleAuthRedirect(@Req() req: Request, @Res() res: any) {
        try {
            const user = req.user as any;
            const result = await this.auth.googleAuth(user.primeiro_nome, user.sobrenome, user.email, user.providerId, user.picture);

            // Redireciona para o frontend com o token
            const frontendUrl = process.env.FRONTEND_URL || 'https://localhost:3001';
            res.redirect(`${frontendUrl}/auth/google/callback?token=${result.token}`);
        } catch (error) {
            console.error('Erro no Google OAuth:', error);
            const frontendUrl = process.env.FRONTEND_URL || 'https://localhost:3001';
            res.redirect(`${frontendUrl}/signin?error=google_auth_failed`);
        }
    }

    @UseGuards(JwtAuthGuard)
    @Get('me')
    me(@Req() req: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const userId = req.user?.sub;
        return this.auth.me(userId);
    }

    @Post('forgot')
    async forgot(@Body() dto: ForgotPasswordDto) {
        const frontend = process.env.FRONTEND_URL || 'https://localhost:3001';
        await this.auth.requestPasswordReset(dto.email, frontend);
        return { ok: true };
    }

    @Post('reset')
    reset(@Body() dto: ResetPasswordDto) {
        return this.auth.resetPassword(dto.token, dto.senha);
    }

    @Get('setores')
    getSetores() {
        return Object.values(ESetores);
    }

    @Get('funcoes')
    getFuncoes() {
        return Object.values(EFuncoes);
    }

    @Put('profile')
    @UseGuards(JwtAuthGuard)
    async updateProfile(@Body() body: any, @Req() req: any) {
        try {
            const { primeiro_nome, sobrenome, email, telefone, setor, funcao } = body;
            const userId = body.id;
            console.log('Controller recebeu:', { userId, body });
            console.log('Dados extraídos:', { primeiro_nome, sobrenome, email, telefone, setor, funcao });

            return this.auth.updateProfile(userId, primeiro_nome, sobrenome, email, telefone, setor, funcao);
        } catch (error) {
            console.error('Error in updateProfile controller:', error);
            throw error;
        }
    }
}
