// src/mail/mail.service.ts
import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
    private transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    async sendPasswordRecovery(email: string, token: string) {
        const resetLink = `${process.env.FRONTEND_URL}/recoverypassword/${token}`;

        // console.log({ transporter: this.transporter, auth: this.transporter.options });
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
}
