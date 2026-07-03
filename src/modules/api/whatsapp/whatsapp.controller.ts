import { Controller, Post, Body, Get, Param, Query, UseGuards, UseInterceptors, ClassSerializerInterceptor, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { WhatsAppService } from './whatsapp.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { ChatGuruService } from './chatguru/chatguru.service';

export interface SendMessageDto {
    phone: string;
    message: string;
    contactName?: string;
}

export interface SendContractLinkDto {
    phone: string;
    contactName?: string;
    signingUrl: string;
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

export interface GenerateCheckInLinkDto {
    alunoTurmaId: string;
}

export interface ResendCheckInByTurmaDto {
    turmaId: number;
}

export interface SendQRCodeBulkDto {
    items: SendQRCodeDto[];
}

@UseInterceptors(ClassSerializerInterceptor)
@Controller('whatsapp')
export class WhatsAppController {
    constructor(
        private readonly whatsappService: WhatsAppService,
        private readonly chatGuruService: ChatGuruService,
    ) {}

    @Post('send-message')
    @UseGuards(JwtAuthGuard)
    async sendMessage(@Body() data: SendMessageDto) {
        console.log('Enviando mensagem WhatsApp via ChatGuru:', data);
        return this.whatsappService.sendMessage(data.phone, data.message, data.contactName);
    }

    @Post('send-contract-link')
    @UseGuards(JwtAuthGuard)
    async sendContractLink(@Body() data: SendContractLinkDto) {
        console.log('Enviando link de contrato via template WhatsApp:', data);
        return this.whatsappService.sendContractLinkTemplate(data.phone, data.signingUrl, data.contactName);
    }

    @Post('send-checkin-links')
    @UseGuards(JwtAuthGuard)
    async sendCheckInLinks(@Body() data: SendCheckInLinksDto) {
        console.log('Enviando links de check-in via WhatsApp para:', data.students.length, 'alunos');
        // Envio individual permanece inline (resposta imediata com o resultado real).
        if ((data.students?.length || 0) <= 1) {
            return this.whatsappService.sendCheckInLinksToStudents(data.students);
        }
        // Envio em MASSA vai para a fila: a request responde na hora (sem timeout
        // exceeded) e cada aluno tem timeout próprio + retentativas (2 min, máx. 3).
        const job = await this.whatsappService.enqueueCheckInLinks(data.students);
        return { success: true, queued: true, job };
    }

    @Post('send-confirmacao-links')
    @UseGuards(JwtAuthGuard)
    async sendConfirmacaoLinks(@Body() data: SendCheckInLinksDto) {
        console.log('Enviando mensagens de confirmação via WhatsApp para:', data.students.length, 'alunos');
        if ((data.students?.length || 0) <= 1) {
            return this.whatsappService.sendConfirmacaoToStudents(data.students);
        }
        const job = this.whatsappService.enqueueConfirmacaoLinks(data.students);
        return { success: true, queued: true, job };
    }

    /**
     * Envio em MASSA de QR Codes de credenciamento via fila (retorno imediato).
     * Cada aluno tem timeout próprio; falhas são retentadas a cada 2 min (máx. 3 tentativas).
     */
    @Post('send-qrcode-bulk')
    @UseGuards(JwtAuthGuard)
    sendQRCodeBulk(@Body() data: SendQRCodeBulkDto) {
        console.log('Enfileirando envio de QR Codes em massa para:', data.items?.length || 0, 'alunos');
        const job = this.whatsappService.enqueueQRCodeCredenciamento(data.items || []);
        return { success: true, queued: true, job };
    }

    /** Status de um job de envio em massa (polling do frontend). */
    @Get('bulk-status/:jobId')
    @UseGuards(JwtAuthGuard)
    getBulkStatus(@Param('jobId') jobId: string) {
        return this.whatsappService.getBulkJobStatus(jobId);
    }

    @Post('generate-checkin-link')
    @UseGuards(JwtAuthGuard)
    async generateCheckInLink(@Body() data: GenerateCheckInLinkDto) {
        console.log('Gerando link de preenchimento por alunoTurmaId:', data.alunoTurmaId);
        return this.whatsappService.generateCheckInLink(data.alunoTurmaId);
    }

    @Post('resend-checkin-by-turma')
    @UseGuards(JwtAuthGuard)
    async resendCheckInByTurma(@Body() data: ResendCheckInByTurmaDto) {
        console.log('Redisparando check-in por turma. turmaId=', data.turmaId);
        return this.whatsappService.resendCheckInLinksByTurma(Number(data.turmaId));
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

    /**
     * Serve a imagem PNG do QR Code de credenciamento de um aluno na turma.
     * Endpoint PÚBLICO (sem JWT): é consumido pela Gupshup/WhatsApp como URL de mídia
     * do template, e por isso precisa ser acessível sem autenticação.
     */
    @Get('qrcode-image/:idTurmaAluno')
    async getQrCodeImage(@Param('idTurmaAluno') idTurmaAluno: string, @Res() res: Response) {
        const buffer = await this.whatsappService.generateQRCodeImageBuffer(idTurmaAluno);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.end(buffer);
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

    /**
     * Verifica o status de uma mensagem enviada
     * Use o messageId retornado no envio para verificar se foi entregue
     */
    @Get('message-status/:messageId')
    @UseGuards(JwtAuthGuard)
    async checkMessageStatus(@Param('messageId') messageId: string) {
        console.log('🔍 Verificando status da mensagem:', messageId);
        return this.chatGuruService.checkMessageStatus(messageId);
    }

    /**
     * Lista todos os templates disponíveis na conta Gupshup
     * Útil para verificar se o template está aprovado
     */
    @Get('templates')
    @UseGuards(JwtAuthGuard)
    async listTemplates() {
        console.log('📋 Listando templates disponíveis...');
        return this.chatGuruService.listTemplates();
    }

    /**
     * Busca um template na Gupshup pelo ID (UUID) ou pelo nome (elementName).
     * Retorna o corpo da mensagem (data), meta e metadados do template, sem precisar mockar no código.
     * Ex.: GET /whatsapp/templates/8ebafac1-29e5-4d10-9ebc-03ae51126a80
     *      GET /whatsapp/templates/link_checkin
     */
    @Get('templates/:id')
    @UseGuards(JwtAuthGuard)
    async getTemplateById(@Param('id') id: string) {
        return this.chatGuruService.getTemplateById(id);
    }

    /**
     * Webhook da Gupshup - recebe callbacks de status de mensagens
     * Configure este URL no painel da Gupshup: https://seu-dominio.com/api/whatsapp/webhook-gupshup
     * Este endpoint NÃO requer autenticação JWT pois é chamado pela Gupshup
     */
    @Post('webhook-gupshup')
    async webhookGupshup(@Body() body: any) {
        const timestamp = new Date().toISOString();
        const event = this.chatGuruService.registerWebhookEvent(body);
        const inboundProcessing = await this.whatsappService.processInboundConfirmacaoWebhook(body);

        console.log('\n' + '═'.repeat(80));
        console.log('📥 WEBHOOK GUPSHUP RECEBIDO');
        console.log('═'.repeat(80));
        console.log(`⏰ Timestamp: ${timestamp}`);
        console.log(`📄 Payload completo:`, JSON.stringify(body, null, 2));

        // A Gupshup pode enviar diferentes tipos de eventos:
        // 1. Message status updates (delivered, read, failed)
        // 2. Inbound messages
        // 3. Template status updates

        const type = event.eventType || 'unknown';
        const status = event.messageId;
        const destination = event.destination;
        const errorCode = event.code;
        const errorMessage = event.reason;

        console.log(`📊 Tipo de evento: ${type}`);
        console.log(`🆔 Message ID: ${status || 'N/A'}`);
        console.log(`📱 Destinatário: ${destination || 'N/A'}`);
        if (inboundProcessing?.handled) {
            console.log(`✅ Inbound de confirmação processado:`, JSON.stringify(inboundProcessing, null, 2));
        }

        if (errorCode || errorMessage) {
            console.log('❌ ERRO DETECTADO:');
            console.log(`   Código: ${errorCode || 'N/A'}`);
            console.log(`   Mensagem: ${errorMessage || 'N/A'}`);
        }

        // Status específicos de entrega
        if (body?.payload?.type === 'message-event') {
            const eventType = body?.payload?.payload?.type;
            console.log(`📬 Status de entrega: ${eventType}`);

            if (eventType === 'failed') {
                console.log('🚨 MENSAGEM FALHOU NA ENTREGA!');
                console.log(`   Motivo: ${body?.payload?.payload?.reason || 'Não especificado'}`);
            } else if (eventType === 'delivered') {
                console.log('✅ Mensagem ENTREGUE com sucesso!');
            } else if (eventType === 'read') {
                console.log('👀 Mensagem LIDA pelo destinatário!');
            } else if (eventType === 'sent') {
                console.log('📤 Mensagem enviada (aguardando entrega)');
            }
        }

        console.log('═'.repeat(80) + '\n');

        // Retorna 200 OK para confirmar recebimento
        return {
            status: 'received',
            timestamp,
            message: 'Webhook processado com sucesso',
            tracked: {
                messageId: event.messageId,
                deliveryStatus: event.deliveryStatus,
                eventType: event.eventType,
            },
            inboundProcessing,
        };
    }

    /**
     * Webhook da Gupshup (GET) - usado para validação inicial do webhook
     * A Gupshup pode fazer uma requisição GET para validar o endpoint
     */
    @Get('webhook-gupshup')
    webhookGupshupValidation(@Query() query: any) {
        console.log('📥 Validação de webhook Gupshup recebida:', query);

        // Se a Gupshup enviar um challenge, retorna ele de volta
        if (query?.challenge) {
            return query.challenge;
        }

        return {
            status: 'ok',
            message: 'Webhook Gupshup endpoint ativo',
            timestamp: new Date().toISOString(),
        };
    }

    /**
     * Consulta eventos de webhook recebidos para um messageId específico
     * Útil para investigar "submitted" sem entrega e ver motivo de falha.
     */
    @Get('webhook-gupshup/status/:messageId')
    @UseGuards(JwtAuthGuard)
    getWebhookStatusByMessageId(@Param('messageId') messageId: string) {
        console.log('🔎 Consultando histórico de webhook para messageId:', messageId);
        return this.chatGuruService.getWebhookEventsByMessageId(messageId);
    }

    /**
     * Consulta histórico processado das respostas de confirmação (inbound)
     * Filtros opcionais:
     * - alunoTurmaId
     * - phone
     * - limit (1-500)
     */
    @Get('confirmacao-respostas')
    @UseGuards(JwtAuthGuard)
    getConfirmacaoRespostas(@Query('alunoTurmaId') alunoTurmaId?: string, @Query('phone') phone?: string, @Query('limit') limit?: string) {
        const parsedLimit = limit ? Number(limit) : undefined;
        return this.whatsappService.getConfirmacaoInboundResponses({
            alunoTurmaId,
            phone,
            limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
        });
    }

    /**
     * Diagnóstico completo do envio de templates
     * Verifica templates disponíveis e status de mensagens recentes
     */
    @Get('diagnostico')
    @UseGuards(JwtAuthGuard)
    async diagnostico() {
        console.log('🔍 Executando diagnóstico completo do WhatsApp...');

        const resultado: any = {
            timestamp: new Date().toISOString(),
            templates: null,
            configuracao: {
                gupshup_template_name: process.env.GUPSHUP_TEMPLATE_NAME || 'NÃO CONFIGURADO',
                gupshup_app_id: process.env.GUPSHUP_APP_ID ? 'Configurado' : 'NÃO CONFIGURADO',
                gupshup_api_key: process.env.GUPSHUP_API_KEY ? 'Configurado' : 'NÃO CONFIGURADO',
                gupshup_source: process.env.GUPSHUP_PHONE_NUMBER || process.env.GUPSHUP_SOURCE || 'NÃO CONFIGURADO',
            },
            recomendacoes: [],
        };

        // Tenta listar templates
        try {
            const templatesResult = await this.chatGuruService.listTemplates();
            resultado.templates = templatesResult;

            if (templatesResult.success && templatesResult.templates) {
                const templateConfigurado = process.env.GUPSHUP_TEMPLATE_NAME || 'template_iamcontrol_checkin';
                const templateEncontrado = templatesResult.templates.find((t: any) => t.elementName === templateConfigurado || t.name === templateConfigurado);

                if (!templateEncontrado) {
                    resultado.recomendacoes.push({
                        tipo: 'ERRO_CRITICO',
                        mensagem: `Template "${templateConfigurado}" NÃO ENCONTRADO na conta Gupshup!`,
                        solucao: 'Verifique o nome exato do template no painel da Gupshup e configure GUPSHUP_TEMPLATE_NAME no .env',
                    });
                } else {
                    resultado.template_encontrado = templateEncontrado;
                    if (templateEncontrado.status !== 'APPROVED') {
                        resultado.recomendacoes.push({
                            tipo: 'ERRO_CRITICO',
                            mensagem: `Template "${templateConfigurado}" está com status "${templateEncontrado.status}" - não está APPROVED!`,
                            solucao: 'Aguarde a aprovação do template pelo WhatsApp/Meta ou solicite revisão no painel da Gupshup',
                        });
                    }
                }
            }
        } catch (error: any) {
            resultado.templates = { error: error.message };
            resultado.recomendacoes.push({
                tipo: 'AVISO',
                mensagem: 'Não foi possível listar templates - verifique GUPSHUP_APP_ID e GUPSHUP_API_KEY',
                solucao: 'Configure as variáveis de ambiente corretamente',
            });
        }

        // Verifica configurações
        if (!process.env.GUPSHUP_TEMPLATE_NAME) {
            resultado.recomendacoes.push({
                tipo: 'AVISO',
                mensagem: 'GUPSHUP_TEMPLATE_NAME não está configurado',
                solucao: 'Defina GUPSHUP_TEMPLATE_NAME=nome_do_seu_template_aprovado no arquivo .env',
            });
        }

        console.log('📋 Resultado do diagnóstico:', JSON.stringify(resultado, null, 2));
        return resultado;
    }
}
