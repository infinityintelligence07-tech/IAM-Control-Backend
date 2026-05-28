// src/mail/mail.service.ts
import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
    private transporter;
    private isConfigured = false;

    constructor() {
        if (process.env.MAIL_HOST && process.env.MAIL_PORT && process.env.MAIL_USER && process.env.MAIL_PASS) {
            this.transporter = nodemailer.createTransport({
                host: process.env.MAIL_HOST,
                port: Number(process.env.MAIL_PORT),
                secure: false,
                auth: {
                    user: process.env.MAIL_USER,
                    pass: process.env.MAIL_PASS,
                },
            });
            this.isConfigured = true;
            console.log('✅ Configuração SMTP carregada com sucesso');
        } else {
            console.warn('⚠️  Configurações SMTP não encontradas. Envio de emails desabilitado.');
        }
    }

    private checkConfiguration(): void {
        if (!this.isConfigured || !this.transporter) {
            throw new Error('SMTP não configurado. Configure as variáveis SMTP_HOST, SMTP_PORT, SMTP_USER e SMTP_PASS');
        }
    }

    async sendPasswordRecovery(email: string, token: string) {
        this.checkConfiguration();

        const resetLink = `${process.env.FRONTEND_URL}/recoverypassword/${token}`;

        await this.transporter.sendMail({
            from: '"IAM Control" <no-reply@iamcontrol.com>',
            to: email,
            subject: 'Recuperação de senha - IAM Control',
            html: `
        <p>Você solicitou a recuperação de senha.</p>
        <p><a href="${resetLink}">Clique aqui para redefinir sua senha</a></p>
        <p>Este link expira em 30 minutos.</p>
      `,
        });
    }

    async sendContractEmail(email: string, signerName: string, signingUrl: string) {
        this.checkConfiguration();

        await this.transporter.sendMail({
            from: '"IAM Control" <no-reply@iamcontrol.com>',
            to: email,
            subject: 'Contrato para Assinar - IAM Control',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Olá ${signerName}! 👋</h2>
            <p>Você recebeu um contrato para assinar.</p>
            <p>Por favor, clique no botão abaixo para acessar e assinar o contrato:</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${signingUrl}" style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                    Assinar Contrato
                </a>
            </div>
            <p style="color: #666; font-size: 14px;">Ou copie e cole o link abaixo no seu navegador:</p>
            <p style="color: #666; font-size: 12px; word-break: break-all;">${signingUrl}</p>
            <p style="margin-top: 30px; color: #666;">Obrigado! 📝</p>
        </div>
      `,
        });
    }
}
