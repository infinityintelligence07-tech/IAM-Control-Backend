import { Controller, Post, Body, Get, Param, Query, UseGuards, UseInterceptors, ClassSerializerInterceptor, Put } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';

export interface SendMessageDto {
    phone: string;
    message: string;
    contactName?: string;
}

export interface CheckInStudentDto {
    alunoTurmaId: string;
    alunoNome: string;
    turmaId: number;
    treinamentoNome: string;
}

export interface SendCheckInLinksDto {
    students: CheckInStudentDto[];
}

export interface SendQRCodeDto {
    alunoTurmaId: string;
    alunoNome: string;
    alunoTelefone: string;
    turmaId: number;
    treinamentoNome: string;
    poloNome: string;
    dataEvento: string;
}

@UseInterceptors(ClassSerializerInterceptor)
@Controller('whatsapp')
export class WhatsAppController {
    constructor(private readonly whatsappService: WhatsAppService) {}

    @Post('send-message')
    @UseGuards(JwtAuthGuard)
    async sendMessage(@Body() data: SendMessageDto) {
        console.log('Enviando mensagem WhatsApp via ChatGuru:', data);
        return this.whatsappService.sendMessage(data.phone, data.message, data.contactName);
    }

    @Post('send-checkin-links')
    @UseGuards(JwtAuthGuard)
    async sendCheckInLinks(@Body() data: SendCheckInLinksDto) {
        console.log('Enviando links de check-in via WhatsApp para:', data.students.length, 'alunos');
        return this.whatsappService.sendCheckInLinksToStudents(data.students);
    }

    @Get('checkin/:token')
    async processCheckIn(@Param('token') token: string, @Query('student') studentId?: string) {
        console.log('Processando check-in via token:', token, 'para aluno:', studentId);
        return this.whatsappService.processCheckIn(token, studentId);
    }

    @Post('send-qrcode')
    @UseGuards(JwtAuthGuard)
    async sendQRCode(@Body() data: SendQRCodeDto) {
        console.log('Enviando QR code de credenciamento para:', data.alunoNome);
        return this.whatsappService.sendQRCodeCredenciamento(data);
    }

    @Get('test-connection')
    @UseGuards(JwtAuthGuard)
    async testConnection() {
        console.log('Testando conectividade ChatGuru...');
        return this.whatsappService.testZApiConnection();
    }

    @Get('dados-aluno/:token')
    async getDadosAlunoPorToken(@Param('token') token: string) {
        console.log('Buscando dados do aluno por token:', token);
        return this.whatsappService.getDadosAlunoPorToken(token);
    }

    @Post('preencher-dados/:token')
    async preencherDadosAluno(@Param('token') token: string, @Body() dados: any) {
        console.log('Preenchendo dados do aluno por token:', token);
        return this.whatsappService.preencherDadosAluno(token, dados);
    }

    @Put('atualizar-foto/:token')
    async atualizarFotoAluno(@Param('token') token: string, @Body() body: { url_foto_aluno: string }) {
        console.log('Atualizando foto do aluno por token:', token);
        return this.whatsappService.atualizarFotoAluno(token, body.url_foto_aluno);
    }
}
