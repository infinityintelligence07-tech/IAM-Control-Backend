import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as QRCode from 'qrcode';

@Injectable()
export class ChatGuruService {
    private readonly logger = new Logger(ChatGuruService.name);
    private readonly endpoint: string;
    private readonly key: string;
    private readonly accountId: string;
    private readonly phoneId: string;
    // Configurações da Gupshup para envio direto de templates
    private readonly gupshupApiKey: string;
    private readonly gupshupAppName: string;
    private readonly gupshupSource: string;
    private readonly gupshupAppId: string;

    constructor(
        private readonly http: HttpService,
        private readonly configService: ConfigService,
    ) {
        this.endpoint = this.configService.get<string>('CHATGURU_ENDPOINT') || 'https://s17.chatguru.app/api/v1';
        this.key = this.configService.get<string>('CHATGURU_KEY') || '';
        this.accountId = this.configService.get<string>('CHATGURU_ACCOUNT_ID') || '';
        this.phoneId = this.configService.get<string>('CHATGURU_PHONE_ID') || '';
        // Configurações da Gupshup (opcionais - se não configuradas, tenta usar ChatGuru)
        this.gupshupApiKey = this.configService.get<string>('GUPSHUP_API_KEY') || '';
        // Usa GUPSHUP_DISPLAY_NAME se disponível, senão tenta GUPSHUP_APP_NAME
        this.gupshupAppName = this.configService.get<string>('GUPSHUP_DISPLAY_NAME') || this.configService.get<string>('GUPSHUP_APP_NAME') || '';
        // Usa GUPSHUP_PHONE_NUMBER se disponível, senão tenta GUPSHUP_SOURCE
        this.gupshupSource = this.configService.get<string>('GUPSHUP_PHONE_NUMBER') || this.configService.get<string>('GUPSHUP_SOURCE') || '';
        // App ID da Gupshup (opcional, mas pode ser necessário)
        this.gupshupAppId = this.configService.get<string>('GUPSHUP_APP_ID') || '';
    }

    /**
     * Normaliza o número de telefone removendo caracteres especiais
     */
    private normalizePhoneNumber(phoneNumber: string): string {
        if (!phoneNumber || typeof phoneNumber !== 'string') {
            throw new Error('Número de telefone inválido');
        }
        return phoneNumber.replace(/\D/g, '');
    }

    /**
     * Verifica o status de um chat usando o chat_add_id
     */
    async checkChatStatus(chatAddId: string): Promise<{ exists: boolean; status?: string }> {
        try {
            const params = {
                action: 'chat_add_status',
                key: this.key,
                account_id: this.accountId,
                phone_id: this.phoneId,
                chat_add_id: chatAddId,
            };

            const response = await firstValueFrom(this.http.post<{ result?: string; status?: string; chat_add_status?: string }>(this.endpoint, null, { params }));

            if (response.data?.result === 'success') {
                const status = response.data?.status || response.data?.chat_add_status;
                return {
                    exists: true,
                    status: status,
                };
            }

            return { exists: false };
        } catch (error: any) {
            // Se o chat não existe, a API pode retornar erro 404 ou 400
            if (error?.response?.status === 404 || error?.response?.status === 400) {
                return { exists: false };
            }
            // Se a ação não está disponível (erro 500), assumimos que o chat não existe
            if (error?.response?.status === 500) {
                this.logger.warn('Ação chat_add_status não disponível na API do ChatGuru');
                return { exists: false };
            }
            this.logger.error(`Erro ao verificar status do chat: ${error.message}`);
            return { exists: false };
        }
    }

    /**
     * Cria um novo chat no ChatGuru
     */
    async createChat(phoneNumber: string, contactName?: string, initialMessage?: string): Promise<any> {
        try {
            const normalizedNumber = this.normalizePhoneNumber(phoneNumber);

            const params: any = {
                action: 'chat_add',
                key: this.key,
                account_id: this.accountId,
                phone_id: this.phoneId,
                chat_number: normalizedNumber,
            };

            // O nome do contato é obrigatório ou opcional dependendo da API
            if (contactName) {
                params.name = contactName;
            } else {
                // Se não fornecer nome, usa o número como fallback
                params.name = normalizedNumber;
            }

            // Mensagem inicial (opcional)
            if (initialMessage) {
                params.text = initialMessage;
            }

            this.logger.debug(`Criando chat para ${normalizedNumber} com params:`, {
                action: params.action,
                account_id: params.account_id,
                phone_id: params.phone_id,
                chat_number: params.chat_number,
                name: params.name,
                text: params.text ? params.text.substring(0, 50) + (params.text.length > 50 ? '...' : '') : undefined,
            });

            const response = await firstValueFrom(
                this.http.post<{
                    result?: string;
                    chat_add_status?: string;
                    status?: string;
                    chat_add_id?: string;
                    chat_id?: string;
                    description?: string;
                }>(this.endpoint, null, { params }),
            );

            if (response.data?.result === 'success') {
                const status = response.data?.chat_add_status || response.data?.status;
                const chatId = response.data?.chat_add_id || response.data?.chat_id;

                this.logger.log(`Chat criado com sucesso para ${normalizedNumber}`);
                this.logger.log(`Status: ${status}, ID: ${chatId}`);

                if (initialMessage) {
                    this.logger.log(`Mensagem inicial incluída na criação do chat`);
                }

                return {
                    ...response.data,
                    chatStatus: status,
                    chatId: chatId,
                };
            }

            throw new Error(response.data?.description || 'Erro ao criar chat');
        } catch (error: any) {
            const errorMessage = error?.response?.data?.description || error.message;
            const statusCode = error?.response?.status;
            const errorData = error?.response?.data;

            this.logger.error(`Erro ao criar chat (status ${statusCode}): ${errorMessage}`, {
                errorData,
                statusCode,
            });

            // Se o chat já existe, não é um erro crítico
            if (errorMessage?.toLowerCase().includes('já existe') || errorMessage?.toLowerCase().includes('already exists')) {
                this.logger.warn(`Chat já existe para ${phoneNumber}`);
                return { result: 'success', description: 'Chat já existe' };
            }

            throw new Error(`Falha ao criar chat: ${errorMessage}`);
        }
    }

    /**
     * Envia uma mensagem para um chat no ChatGuru
     */
    async sendMessage(phoneNumber: string, message: string): Promise<any> {
        try {
            const normalizedNumber = this.normalizePhoneNumber(phoneNumber);

            // Valida se a mensagem não está vazia
            if (!message || message.trim().length === 0) {
                throw new Error('Mensagem não pode estar vazia');
            }

            // A API do ChatGuru pode esperar 'text' ao invés de 'message'
            // Vamos tentar ambos os formatos
            const params: any = {
                action: 'message_send',
                key: this.key,
                account_id: this.accountId,
                phone_id: this.phoneId,
                chat_number: normalizedNumber,
                text: message.trim(), // Tenta com 'text' primeiro
            };

            this.logger.debug(`Enviando mensagem para ${normalizedNumber} com params:`, {
                action: params.action,
                account_id: params.account_id,
                phone_id: params.phone_id,
                chat_number: params.chat_number,
                text: params.text?.substring(0, 50) + (params.text?.length > 50 ? '...' : ''), // Log apenas primeiros 50 chars
            });

            const response = await firstValueFrom(this.http.post<{ result?: string; description?: string }>(this.endpoint, null, { params }));

            if (response.data?.result === 'success') {
                this.logger.log(`Mensagem enviada com sucesso para ${normalizedNumber}`);
                return response.data;
            }

            throw new Error(response.data?.description || 'Erro ao enviar mensagem');
        } catch (error: any) {
            const errorMessage = error?.response?.data?.description || error.message;
            const statusCode = error?.response?.status;
            const errorData = error?.response?.data;

            // Se o erro for "Texto inválido" e estávamos usando 'text', tenta com 'message'
            if (statusCode === 400 && errorMessage?.toLowerCase().includes('texto inválido')) {
                this.logger.warn('Erro com campo "text", tentando com "message"');
                try {
                    const normalizedNumber = this.normalizePhoneNumber(phoneNumber);
                    const params: any = {
                        action: 'message_send',
                        key: this.key,
                        account_id: this.accountId,
                        phone_id: this.phoneId,
                        chat_number: normalizedNumber,
                        message: message.trim(), // Tenta com 'message'
                    };

                    const response = await firstValueFrom(this.http.post<{ result?: string; description?: string }>(this.endpoint, null, { params }));

                    if (response.data?.result === 'success') {
                        this.logger.log(`Mensagem enviada com sucesso para ${normalizedNumber} (usando campo "message")`);
                        return response.data;
                    }
                } catch (retryError: any) {
                    // Se ainda falhar, continua com o erro original
                    this.logger.error(`Tentativa com campo "message" também falhou: ${retryError?.response?.data?.description || retryError.message}`);
                }
            }

            this.logger.error(`Erro ao enviar mensagem (status ${statusCode}): ${errorMessage}`, {
                errorData,
                statusCode,
            });

            // Se o erro indicar que o chat não existe, retornamos informação útil
            if (
                errorMessage?.toLowerCase().includes('chat') &&
                (errorMessage?.toLowerCase().includes('não existe') || errorMessage?.toLowerCase().includes('not found') || statusCode === 404)
            ) {
                throw new Error(`Chat não encontrado. Pode ser necessário criar o chat primeiro. Detalhes: ${errorMessage}`);
            }

            throw new Error(`Falha ao enviar mensagem: ${errorMessage}`);
        }
    }

    /**
     * Aguarda um tempo determinado (em milissegundos)
     */
    private async delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Faz upload da imagem para usar em templates de mídia
     * Retorna a URL pública da imagem
     */
    async uploadImageForTemplate(imageBase64: string): Promise<string> {
        return this.uploadImageToHosting(imageBase64);
    }

    /**
     * Faz upload da imagem para um serviço de hospedagem e retorna a URL pública
     * Usa ImgBB (gratuito, aceita base64 sem necessidade de autenticação)
     */
    private async uploadImageToHosting(imageBase64: string): Promise<string> {
        try {
            // Remove o prefixo data:image/png;base64, se existir
            const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

            // ImgBB API - serviço gratuito de hospedagem de imagens
            // Aceita upload direto via base64
            // Você pode obter uma chave gratuita em https://api.imgbb.com/
            // Por enquanto, usando uma chave pública de teste (pode precisar ser substituída)
            const imgbbEndpoint = 'https://api.imgbb.com/1/upload';
            // NOTA: Para produção, adicione IMGBB_API_KEY no .env
            const imgbbKey = this.configService.get<string>('IMGBB_API_KEY') || '2c0b0c0b0c0b0c0b0c0b0c0b0c0b0c0b';

            const formData = new URLSearchParams();
            formData.append('key', imgbbKey);
            formData.append('image', base64Data);

            this.logger.debug('Fazendo upload da imagem para ImgBB...');

            const response = await firstValueFrom(
                this.http.post<{ success?: boolean; data?: { url?: string } }>(imgbbEndpoint, formData.toString(), {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                }),
            );

            if (response.data?.success && response.data?.data?.url) {
                const imageUrl = response.data.data.url;
                this.logger.log(`Imagem enviada para ImgBB: ${imageUrl}`);
                return imageUrl;
            }

            throw new Error('Falha ao fazer upload da imagem para ImgBB');
        } catch (error: any) {
            this.logger.error(`Erro ao fazer upload da imagem: ${error.message}`);
            throw new Error(`Não foi possível fazer upload da imagem: ${error.message}`);
        }
    }

    /**
     * Envia uma imagem para um chat no ChatGuru
     * Conforme documentação: action deve ser "message_file_send" e usar file_url
     * A API requer uma URL HTTP pública, então fazemos upload primeiro
     */
    async sendImage(phoneNumber: string, imageBase64: string, caption?: string): Promise<any> {
        try {
            const normalizedNumber = this.normalizePhoneNumber(phoneNumber);

            // Primeiro, faz upload da imagem para obter uma URL pública
            this.logger.debug('Fazendo upload da imagem para obter URL pública...');
            const imageUrl = await this.uploadImageToHosting(imageBase64);

            // Conforme a documentação do ChatGuru:
            // - action: "message_file_send"
            // - file_url: URL do arquivo (deve conter extensão no final)
            // - caption: Nome do arquivo
            const body: any = {
                action: 'message_file_send',
                key: this.key,
                account_id: this.accountId,
                phone_id: this.phoneId,
                chat_number: normalizedNumber,
                file_url: imageUrl, // URL HTTP pública
                caption: caption || 'qrcode.png', // Nome do arquivo (obrigatório)
            };

            this.logger.debug(`Enviando imagem para ${normalizedNumber}`, {
                action: body.action,
                caption: body.caption,
                file_url: imageUrl,
            });

            // Envia no body da requisição como form-urlencoded
            const formData = new URLSearchParams();
            Object.keys(body).forEach((key) => {
                formData.append(key, body[key]);
            });

            const response = await firstValueFrom(
                this.http.post<{ result?: string; description?: string }>(this.endpoint, formData.toString(), {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                }),
            );

            // Log completo da resposta para diagnóstico
            this.logger.debug(`📥 Resposta completa do envio de imagem:`, JSON.stringify(response.data, null, 2));

            if (response.data?.result === 'success') {
                this.logger.log(`✅ Imagem enviada com sucesso para ${normalizedNumber}`);
                this.logger.log(`   📋 Descrição: ${response.data?.description || 'N/A'}`);
                this.logger.log(`   📋 Chat ID: ${response.data?.chat_id || response.data?.chatId || 'N/A'}`);
                // Retorna tanto o formato antigo (compatibilidade) quanto o novo
                return {
                    ...response.data,
                    success: true,
                    result: response.data,
                };
            }

            // Se não retornou success, loga detalhes
            this.logger.warn(`⚠️ Resposta não indica sucesso claro:`, JSON.stringify(response.data, null, 2));

            const errorMsg = response.data?.description || 'Erro ao enviar imagem';
            this.logger.error(`❌ Falha ao enviar imagem: ${errorMsg}`);
            throw new Error(errorMsg);
        } catch (error: any) {
            const errorMessage = error?.response?.data?.description || error.message;
            const statusCode = error?.response?.status;
            const errorData = error?.response?.data;

            this.logger.error(`Erro ao enviar imagem (status ${statusCode}): ${errorMessage}`, {
                errorData: JSON.stringify(errorData, null, 2),
                statusCode,
                errorResponse: error?.response?.data,
            });

            throw new Error(`Falha ao enviar imagem: ${errorMessage}`);
        }
    }

    /**
     * Método principal: cria o chat primeiro e depois envia a mensagem
     * Usa o nome do contato e telefone primário
     */
    async createChatAndSendMessage(phoneNumber: string, message: string, contactName?: string): Promise<any> {
        try {
            const normalizedNumber = this.normalizePhoneNumber(phoneNumber);

            this.logger.log(`Iniciando processo para ${normalizedNumber}${contactName ? ` (${contactName})` : ''}`);

            // Primeiro, cria o chat para obter o chat_add_id
            // Não podemos verificar se existe sem o chat_add_id, então sempre tentamos criar
            this.logger.log(`Criando chat para ${normalizedNumber} com mensagem inicial`);
            const chatResult = await this.createChat(normalizedNumber, contactName, message);

            // Verifica se o chat foi criado com sucesso
            if (chatResult?.result === 'success') {
                const chatAddId = chatResult?.chatId || chatResult?.chat_add_id;
                const initialStatus = chatResult?.chatStatus || chatResult?.chat_add_status;

                this.logger.log(`Chat criado com sucesso. ID: ${chatAddId}, Status inicial: ${initialStatus}`);

                // Se não temos chat_add_id, não podemos verificar o status
                if (!chatAddId) {
                    this.logger.error('Não foi possível obter chat_add_id após criar o chat');
                    throw new Error('Não foi possível obter chat_add_id após criar o chat');
                }

                // Verifica o status do chat usando chat_add_status
                this.logger.log(`Verificando status do chat usando chat_add_id: ${chatAddId}`);

                // Aguarda o processamento do chat verificando o status periodicamente
                let attempts = 0;
                const maxAttempts = 10; // 10 tentativas
                let chatProcessed = false;
                let currentStatus = initialStatus;

                while (attempts < maxAttempts && !chatProcessed) {
                    attempts++;
                    const waitTime = attempts * 3; // 3s, 6s, 9s, 12s, 15s, 18s, 21s, 24s, 27s, 30s
                    this.logger.log(`Aguardando processamento do chat... Tentativa ${attempts}/${maxAttempts} (${waitTime}s)`);
                    await this.delay(waitTime * 1000);

                    // Verifica o status do chat usando chat_add_id
                    const statusResult = await this.checkChatStatus(chatAddId);
                    if (statusResult.exists) {
                        currentStatus = statusResult.status;
                        this.logger.log(`Status atual do chat: ${currentStatus}`);

                        // Se o status não é mais "pending" ou "scheduled", o chat está processado
                        if (currentStatus && currentStatus !== 'pending' && currentStatus !== 'scheduled') {
                            chatProcessed = true;
                            this.logger.log(`Chat está processado! Status: ${currentStatus}`);
                            break;
                        }
                    } else {
                        this.logger.warn(`Não foi possível verificar o status do chat na tentativa ${attempts}`);
                    }
                }

                // Após verificar que o chat está processado, envia mensagem e QR code
                if (message) {
                    // Se o status é "done" e a mensagem foi incluída no chat_add,
                    // a mensagem já foi enviada durante a criação do chat
                    if (currentStatus === 'done') {
                        this.logger.log(`Status "done" - Chat processado e mensagem já foi enviada durante a criação (via parâmetro text no chat_add)`);

                        return {
                            success: true,
                            chatCreated: true,
                            messageSent: true,
                            messageSentDuringCreation: true,
                            chatStatus: currentStatus,
                            chatId: chatAddId,
                            result: chatResult,
                            message: 'Chat criado e mensagem enviada com sucesso.',
                        };
                    }

                    // Se o status não é "done", tenta enviar a mensagem separadamente
                    this.logger.log(`Status: ${currentStatus}. Aguardando 5 segundos antes de enviar mensagem...`);
                    await this.delay(5000);

                    try {
                        this.logger.log(`Enviando mensagem para ${normalizedNumber}...`);
                        const messageResult = await this.sendMessage(normalizedNumber, message);
                        this.logger.log(`Mensagem enviada com sucesso!`);

                        return {
                            success: true,
                            chatCreated: true,
                            messageSent: true,
                            messageSentDuringCreation: false,
                            chatStatus: currentStatus || initialStatus,
                            chatId: chatAddId,
                            result: {
                                chatCreation: chatResult,
                                messageSend: messageResult,
                            },
                        };
                    } catch (sendError: any) {
                        this.logger.error(`Erro ao enviar mensagem: ${sendError.message}`);

                        // Se falhar, considera que a mensagem foi enviada durante a criação
                        this.logger.warn(`Não foi possível enviar mensagem separadamente, mas a mensagem foi incluída no chat_add e será enviada automaticamente.`);
                        return {
                            success: true,
                            chatCreated: true,
                            messageSent: true,
                            messageSentDuringCreation: true,
                            chatStatus: currentStatus || initialStatus,
                            chatId: chatAddId,
                            result: chatResult,
                            message: 'Chat criado com sucesso. A mensagem foi incluída na criação e será enviada automaticamente.',
                            warning: `Mensagem não pôde ser enviada separadamente: ${sendError.message}. Mas foi incluída na criação do chat.`,
                        };
                    }
                } else {
                    // Se não há mensagem para enviar, apenas retorna sucesso da criação
                    return {
                        success: true,
                        chatCreated: true,
                        messageSent: false,
                        chatStatus: currentStatus || initialStatus,
                        chatId: chatAddId,
                        result: chatResult,
                    };
                }
            } else {
                // Se o chat não foi criado com sucesso
                throw new Error(chatResult?.description || 'Erro ao criar chat');
            }
        } catch (error: any) {
            this.logger.error(`Erro no processo completo: ${error.message}`, {
                stack: error.stack,
            });
            throw error;
        }
    }

    /**
     * Cria chat e envia mensagem com QR code
     * Usa Gupshup diretamente para enviar mensagem de sessão + imagem
     */
    async createChatAndSendMessageWithQRCode(phoneNumber: string, message: string, qrCodeData: any, contactName?: string): Promise<any> {
        try {
            const normalizedNumber = this.normalizePhoneNumber(phoneNumber);

            this.logger.log(`\n${'='.repeat(80)}`);
            this.logger.log(`📱 INICIANDO ENVIO DE QR CODE VIA GUPSHUP`);
            this.logger.log(`${'='.repeat(80)}`);
            this.logger.log(`📱 Destinatário: ${normalizedNumber}${contactName ? ` (${contactName})` : ''}`);

            // Formata o número para Gupshup
            let destination = normalizedNumber;
            if (!destination.startsWith('55')) {
                destination = '55' + destination;
            }

            let messageSent = false;
            let qrCodeSent = false;
            let messageResult: any = null;
            let qrResult: any = null;

            // 1. Primeiro envia a mensagem de texto via Gupshup
            try {
                this.logger.log(`📝 Enviando mensagem de texto...`);
                messageResult = await this.sendMessageViaGupshup(destination, message);
                messageSent = messageResult.success;
                if (messageSent) {
                    this.logger.log(`✅ Mensagem de texto enviada com sucesso!`);
                }
            } catch (msgError: any) {
                this.logger.warn(`⚠️ Erro ao enviar mensagem de texto: ${msgError.message}`);
            }

            // 2. Gera e envia o QR code como imagem
            try {
                this.logger.log(`🔲 Gerando QR code...`);
                const qrCodeImage = await this.generateQRCode(qrCodeData);
                this.logger.log(`📤 Enviando imagem do QR code...`);
                await this.delay(1000); // Pequeno delay entre mensagem e imagem
                qrResult = await this.sendImageViaGupshup(destination, qrCodeImage, 'QR Code de Credenciamento');
                qrCodeSent = qrResult.success;
                if (qrCodeSent) {
                    this.logger.log(`✅ QR code enviado com sucesso!`);
                }
            } catch (qrError: any) {
                this.logger.warn(`⚠️ Erro ao enviar QR code: ${qrError.message}`);
            }

            this.logger.log(`${'='.repeat(80)}`);
            this.logger.log(`📊 RESULTADO: Mensagem=${messageSent ? '✅' : '❌'} | QR Code=${qrCodeSent ? '✅' : '❌'}`);
            this.logger.log(`${'='.repeat(80)}\n`);

            return {
                success: messageSent || qrCodeSent,
                messageSent,
                qrCodeSent,
                result: {
                    message: messageResult,
                    qrCode: qrResult,
                },
                warning: !qrCodeSent ? 'QR code não pôde ser enviado' : undefined,
            };
        } catch (error: any) {
            this.logger.error(`❌ Erro no processo completo com QR code: ${error.message}`, {
                stack: error.stack,
            });
            throw error;
        }
    }

    /**
     * Envia uma mensagem de texto via Gupshup (mensagem de sessão, não template)
     * Funciona apenas se houver uma conversa aberta nas últimas 24h
     */
    async sendMessageViaGupshup(phoneNumber: string, message: string): Promise<any> {
        try {
            const normalizedNumber = this.normalizePhoneNumber(phoneNumber);

            // Verifica se as credenciais da Gupshup estão configuradas
            if (!this.gupshupApiKey || !this.gupshupSource) {
                throw new Error('Credenciais da Gupshup não configuradas');
            }

            let destination = normalizedNumber;
            if (!destination.startsWith('55')) {
                destination = '55' + destination;
            }

            this.logger.log(`📤 Enviando mensagem via Gupshup para ${destination}`);

            // Endpoint para mensagens de sessão
            const gupshupEndpoint = 'https://api.gupshup.io/wa/api/v1/msg';

            // Payload para mensagem de texto
            const formData = new URLSearchParams();
            formData.append('channel', 'whatsapp');
            formData.append('source', this.gupshupSource);
            formData.append('destination', destination);
            formData.append(
                'message',
                JSON.stringify({
                    type: 'text',
                    text: message,
                }),
            );

            if (this.gupshupAppName) {
                formData.append('src.name', this.gupshupAppName);
            }

            const response = await firstValueFrom(
                this.http.post<any>(gupshupEndpoint, formData.toString(), {
                    headers: {
                        apikey: this.gupshupApiKey,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Cache-Control': 'no-cache',
                    },
                }),
            );

            const responseData = response.data || response;
            const hasMessageId = !!(responseData?.messageId || responseData?.id);
            const status = responseData?.status?.toLowerCase();
            const isSuccess = status === 'submitted' || status === 'success' || hasMessageId;

            if (isSuccess) {
                this.logger.log(`✅ Mensagem enviada via Gupshup: ${responseData?.messageId || 'sem messageId'}`);
                return {
                    success: true,
                    messageId: responseData?.messageId || responseData?.id,
                    result: responseData,
                };
            }

            throw new Error(responseData?.message || responseData?.error || 'Erro ao enviar mensagem');
        } catch (error: any) {
            const errorMessage = error?.response?.data?.message || error?.response?.data?.error || error.message;
            this.logger.error(`❌ Erro ao enviar mensagem via Gupshup: ${errorMessage}`);
            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Envia uma imagem via Gupshup (mensagem de sessão, não template)
     * Funciona apenas se houver uma conversa aberta nas últimas 24h
     */
    async sendImageViaGupshup(phoneNumber: string, imageBase64: string, caption?: string): Promise<any> {
        try {
            const normalizedNumber = this.normalizePhoneNumber(phoneNumber);

            // Verifica se as credenciais da Gupshup estão configuradas
            if (!this.gupshupApiKey || !this.gupshupSource) {
                throw new Error('Credenciais da Gupshup não configuradas');
            }

            let destination = normalizedNumber;
            if (!destination.startsWith('55')) {
                destination = '55' + destination;
            }

            this.logger.log(`📤 Enviando imagem via Gupshup para ${destination}`);

            // Primeiro, faz upload da imagem para obter uma URL pública
            let imageUrl: string;
            try {
                imageUrl = await this.uploadImageToHosting(imageBase64);
                this.logger.log(`✅ Imagem enviada para hosting: ${imageUrl}`);
            } catch (uploadError: any) {
                this.logger.error(`❌ Erro ao fazer upload da imagem: ${uploadError.message}`);
                throw new Error(`Falha ao fazer upload da imagem: ${uploadError.message}`);
            }

            // Endpoint para mensagens de sessão
            const gupshupEndpoint = 'https://api.gupshup.io/wa/api/v1/msg';

            // Payload para mensagem de imagem
            const formData = new URLSearchParams();
            formData.append('channel', 'whatsapp');
            formData.append('source', this.gupshupSource);
            formData.append('destination', destination);
            formData.append(
                'message',
                JSON.stringify({
                    type: 'image',
                    originalUrl: imageUrl,
                    previewUrl: imageUrl,
                    caption: caption || '',
                }),
            );

            if (this.gupshupAppName) {
                formData.append('src.name', this.gupshupAppName);
            }

            const response = await firstValueFrom(
                this.http.post<any>(gupshupEndpoint, formData.toString(), {
                    headers: {
                        apikey: this.gupshupApiKey,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Cache-Control': 'no-cache',
                    },
                }),
            );

            const responseData = response.data || response;
            const hasMessageId = !!(responseData?.messageId || responseData?.id);
            const status = responseData?.status?.toLowerCase();
            const isSuccess = status === 'submitted' || status === 'success' || hasMessageId;

            if (isSuccess) {
                this.logger.log(`✅ Imagem enviada via Gupshup: ${responseData?.messageId || 'sem messageId'}`);
                return {
                    success: true,
                    messageId: responseData?.messageId || responseData?.id,
                    result: responseData,
                };
            }

            throw new Error(responseData?.message || responseData?.error || 'Erro ao enviar imagem');
        } catch (error: any) {
            const errorMessage = error?.response?.data?.message || error?.response?.data?.error || error.message;
            this.logger.error(`❌ Erro ao enviar imagem via Gupshup: ${errorMessage}`);
            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Gera um QR code como imagem base64
     */
    async generateQRCode(data: any): Promise<string> {
        try {
            // Converter para string JSON para o QR code
            const qrCodeData = JSON.stringify(data);

            // Gerar QR code como imagem base64
            const qrCodeImage = await QRCode.toDataURL(qrCodeData, {
                errorCorrectionLevel: 'M',
                margin: 1,
                color: {
                    dark: '#000000',
                    light: '#FFFFFF',
                },
                width: 256,
            });

            this.logger.log('QR code gerado com sucesso');
            return qrCodeImage;
        } catch (error: any) {
            this.logger.error(`Erro ao gerar QR code: ${error.message}`);
            throw new Error(`Falha ao gerar QR code: ${error.message}`);
        }
    }

    /**
     * Envia uma mensagem de template via ChatGuru/Gupshup
     * @param phoneNumber Número do telefone do destinatário
     * @param templateId ID do template na Gupshup (Gupshup temp ID)
     * @param templateParams Array de parâmetros para os campos variáveis do template
     * @param contactName Nome do contato (opcional)
     */
    async sendTemplateMessage(phoneNumber: string, templateId: string, templateParams: string[], contactName?: string): Promise<any> {
        const normalizedNumber = this.normalizePhoneNumber(phoneNumber);

        try {
            this.logger.log(`Enviando template ${templateId} para ${normalizedNumber}${contactName ? ` (${contactName})` : ''}`);

            // Prepara os parâmetros do template
            // A API do ChatGuru/Gupshup espera os parâmetros em formato específico
            // Tenta diferentes formatos de template_id
            const params: any = {
                action: 'template_send',
                key: this.key,
                account_id: this.accountId,
                phone_id: this.phoneId,
                chat_number: normalizedNumber,
            };

            // Tenta primeiro com template_id (Gupshup format)
            params.template_id = templateId;

            // Adiciona os parâmetros do template
            // O formato pode variar, mas geralmente é params[0], params[1], etc.
            templateParams.forEach((param, index) => {
                params[`params[${index}]`] = param;
            });

            this.logger.debug(`Enviando template com params:`, {
                action: params.action,
                template_id: params.template_id,
                params_count: templateParams.length,
            });

            const response = await firstValueFrom(this.http.post<{ result?: string; description?: string }>(this.endpoint, null, { params }));

            if (response.data?.result === 'success') {
                this.logger.log(`Template enviado com sucesso para ${normalizedNumber}`);
                return {
                    success: true,
                    result: response.data,
                };
            }

            throw new Error(response.data?.description || 'Erro ao enviar template');
        } catch (error: any) {
            const errorMessage = error?.response?.data?.description || error.message;
            const statusCode = error?.response?.status;

            this.logger.error(`Erro ao enviar template (status ${statusCode}): ${errorMessage}`);

            // Se a ação template_send não existir ou retornar 500, tenta com formatos alternativos
            if (
                statusCode === 400 ||
                statusCode === 500 ||
                errorMessage?.toLowerCase().includes('invalid action') ||
                errorMessage?.toLowerCase().includes('ação inválida')
            ) {
                this.logger.warn('Ação template_send não disponível ou falhou, tentando formatos alternativos...');
                try {
                    return await this.sendTemplateMessageAlternative(normalizedNumber, templateId, templateParams);
                } catch (altError: any) {
                    this.logger.warn(`Formato alternativo 1 falhou: ${altError.message}, tentando formato alternativo 2...`);
                    try {
                        return await this.sendTemplateMessageAlternative2(normalizedNumber, templateId, templateParams);
                    } catch (altError2: any) {
                        this.logger.warn(`Formato alternativo 2 falhou: ${altError2.message}, tentando API Gupshup diretamente...`);
                        try {
                            return await this.sendTemplateViaGupshupDirect(normalizedNumber, templateId, templateParams);
                        } catch (gupshupError: any) {
                            const gupshupErrorMsg = gupshupError.message || '';
                            // Se o erro for sobre credenciais não configuradas, fornece instruções claras
                            if (gupshupErrorMsg.includes('Credenciais da Gupshup não configuradas')) {
                                throw new Error(
                                    `Falha ao enviar template: O ChatGuru não suporta envio de templates diretamente. ` +
                                        `Para usar templates, configure as credenciais da Gupshup nas variáveis de ambiente: ` +
                                        `GUPSHUP_API_KEY, GUPSHUP_SOURCE (e opcionalmente GUPSHUP_APP_NAME). ` +
                                        `Erro original: ${errorMessage}`,
                                );
                            }
                            throw new Error(`Falha ao enviar template: ${errorMessage}. Todas as tentativas falharam. Último erro: ${gupshupErrorMsg}`);
                        }
                    }
                }
            }

            throw new Error(`Falha ao enviar template: ${errorMessage}`);
        }
    }

    /**
     * Envia uma mensagem de template com imagem (header de mídia) via Gupshup
     * Usado para templates do tipo "Media" que incluem imagem
     * @param phoneNumber Número do telefone do destinatário
     * @param templateId ID do template na Gupshup (Gupshup temp ID)
     * @param templateParams Array de parâmetros para os campos variáveis do template (body)
     * @param imageUrl URL pública da imagem para o header do template
     * @param contactName Nome do contato (opcional)
     */
    async sendTemplateWithImage(phoneNumber: string, templateId: string, templateParams: string[], imageUrl: string, contactName?: string): Promise<any> {
        try {
            const normalizedNumber = this.normalizePhoneNumber(phoneNumber);

            // Verifica se as credenciais da Gupshup estão configuradas
            if (!this.gupshupApiKey || !this.gupshupSource) {
                throw new Error('Credenciais da Gupshup não configuradas');
            }

            let destination = normalizedNumber;
            if (!destination.startsWith('55')) {
                destination = '55' + destination;
            }

            this.logger.log(`\n${'='.repeat(80)}`);
            this.logger.log(`📤 ENVIANDO TEMPLATE COM IMAGEM VIA GUPSHUP`);
            this.logger.log(`${'='.repeat(80)}`);
            this.logger.log(`📱 Destinatário: ${destination}${contactName ? ` (${contactName})` : ''}`);
            this.logger.log(`📋 Template ID: ${templateId}`);
            this.logger.log(`📝 Parâmetros: ${JSON.stringify(templateParams)}`);
            this.logger.log(`🖼️ URL da Imagem: ${imageUrl}`);
            this.logger.log(`⏰ Timestamp: ${new Date().toISOString()}`);
            this.logger.log(`${'='.repeat(80)}`);

            // Endpoint para templates
            const gupshupEndpoint = 'https://api.gupshup.io/wa/api/v1/template/msg';

            // Formato correto da Gupshup para templates com header de imagem:
            // - 'template': objeto com id e params (SEM a mídia)
            // - 'message': objeto com type e image.link (mídia vai aqui!)
            const templatePayload = {
                id: templateId,
                params: templateParams,
            };

            // Objeto de mensagem com a imagem do header
            // Formato correto: {"type":"image","image":{"link":"URL"}}
            const messagePayload = {
                type: 'image',
                image: {
                    link: imageUrl,
                },
            };

            // Verifica se src.name está configurado (OBRIGATÓRIO segundo documentação Gupshup)
            if (!this.gupshupAppName) {
                this.logger.error('❌ ERRO: GUPSHUP_APP_NAME ou GUPSHUP_DISPLAY_NAME não configurado!');
                this.logger.error('Este campo é OBRIGATÓRIO para envio de templates.');
                throw new Error('src.name (GUPSHUP_APP_NAME) não configurado - campo obrigatório');
            }

            // Formata o payload conforme documentação:
            // https://docs.gupshup.io/reference/sending-image-template
            const formData = new URLSearchParams();
            formData.append('channel', 'whatsapp');
            formData.append('source', this.gupshupSource);
            formData.append('destination', destination);
            formData.append('src.name', this.gupshupAppName); // OBRIGATÓRIO!
            formData.append('template', JSON.stringify(templatePayload));
            formData.append('message', JSON.stringify(messagePayload));

            this.logger.debug('Payload COMPLETO do template com imagem:', {
                channel: 'whatsapp',
                source: this.gupshupSource,
                destination: destination,
                'src.name': this.gupshupAppName,
                template: JSON.stringify(templatePayload),
                message: JSON.stringify(messagePayload),
            });

            const response = await firstValueFrom(
                this.http.post<any>(gupshupEndpoint, formData.toString(), {
                    headers: {
                        apikey: this.gupshupApiKey,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Cache-Control': 'no-cache',
                    },
                }),
            );

            const responseData = response.data || response;
            const status = responseData?.status?.toLowerCase();
            const hasMessageId = !!(responseData?.messageId || responseData?.id);
            const isSuccess = status === 'submitted' || status === 'success' || hasMessageId;

            this.logger.log(`📥 Resposta da Gupshup:`, JSON.stringify(responseData, null, 2));

            // Verifica se há avisos ou erros na resposta
            if (responseData?.warning) {
                this.logger.warn(`⚠️ Aviso da Gupshup: ${responseData.warning}`);
            }
            if (responseData?.error) {
                this.logger.error(`❌ Erro na resposta da Gupshup: ${responseData.error}`);
            }

            if (isSuccess) {
                const messageId = responseData?.messageId || responseData?.id;
                this.logger.log(`\n${'='.repeat(80)}`);
                this.logger.log(`✅ TEMPLATE COM IMAGEM ACEITO PELA GUPSHUP`);
                this.logger.log(`${'='.repeat(80)}`);
                this.logger.log(`📱 Destinatário: ${destination}`);
                this.logger.log(`📋 Template ID: ${templateId}`);
                this.logger.log(`🆔 Message ID: ${messageId || 'não retornado'}`);
                this.logger.log(`📊 Status Gupshup: ${status || 'N/A'}`);
                this.logger.log(`\n⚠️ IMPORTANTE:`);
                this.logger.log(`   "submitted" significa que a Gupshup ACEITOU a mensagem.`);
                this.logger.log(`   Isso NÃO garante que o WhatsApp entregará a mensagem.`);
                this.logger.log(`   O WhatsApp pode rejeitar se:`);
                this.logger.log(`   - O template não estiver aprovado no WhatsApp`);
                this.logger.log(`   - O template foi rejeitado pelo WhatsApp`);
                this.logger.log(`   - O número do destinatário estiver bloqueado`);
                this.logger.log(`   - A conta WhatsApp Business tiver problemas`);
                this.logger.log(`\n🔍 SE A MENSAGEM NÃO CHEGAR:`);
                this.logger.log(`   1. Verifique no Meta Business Manager se o template está APROVADO`);
                this.logger.log(`   2. Tente usar o NOME do template ao invés do ID`);
                this.logger.log(`   3. Verifique se o template não foi desaprovado recentemente`);
                this.logger.log(`   4. O nome do template geralmente funciona melhor que IDs`);
                this.logger.log(`\n   Verifique o status real no painel da Gupshup usando o Message ID.`);
                this.logger.log(`${'='.repeat(80)}\n`);

                // Aguarda alguns segundos e verifica o status real da mensagem
                // NOTA: A verificação de status pode falhar, mas isso não significa que a mensagem não foi enviada
                if (messageId) {
                    this.logger.log(`⏳ Aguardando 5 segundos para verificar status real da mensagem...`);
                    await new Promise((resolve) => setTimeout(resolve, 5000));

                    try {
                        const statusResult = await this.checkMessageStatus(messageId);
                        if (statusResult.success && statusResult.status) {
                            this.logger.log(`📊 Status real da mensagem:`, JSON.stringify(statusResult.status, null, 2));

                            // Verifica se há erros no status
                            const statusStr = JSON.stringify(statusResult.status).toLowerCase();
                            if (statusStr.includes('failed') || statusStr.includes('error') || statusStr.includes('rejected')) {
                                this.logger.warn(`\n${'!'.repeat(80)}`);
                                this.logger.warn(`⚠️ ATENÇÃO: A mensagem foi rejeitada ou falhou!`);
                                this.logger.warn(`⚠️ Verifique o status completo no painel da Gupshup`);
                                this.logger.warn(`⚠️ Message ID: ${messageId}`);
                                this.logger.warn(`⚠️ Possíveis causas:`);
                                this.logger.warn(`⚠️   1. Template não está aprovado no WhatsApp`);
                                this.logger.warn(`⚠️   2. Template foi rejeitado pelo WhatsApp`);
                                this.logger.warn(`⚠️   3. Número do destinatário inválido ou bloqueado`);
                                this.logger.warn(`⚠️   4. Conta WhatsApp Business não está ativa`);
                                this.logger.warn(`${'!'.repeat(80)}\n`);
                            } else {
                                this.logger.log(`✅ Status da mensagem verificado com sucesso`);
                            }
                        } else {
                            this.logger.warn(`⚠️ Não foi possível obter o status da mensagem, mas a Gupshup aceitou o envio`);
                            this.logger.warn(`   Isso é comum - a verificação de status pode não estar disponível imediatamente`);
                            this.logger.warn(`   Verifique manualmente no painel da Gupshup: Message ID ${messageId}`);
                        }
                    } catch (statusError: any) {
                        this.logger.warn(`\n${'─'.repeat(80)}`);
                        this.logger.warn(`⚠️ Não foi possível verificar o status da mensagem: ${statusError.message}`);
                        this.logger.warn(`⚠️ IMPORTANTE: Isso NÃO significa que a mensagem não foi enviada!`);
                        this.logger.warn(`⚠️ A Gupshup aceitou a mensagem (status: submitted, messageId: ${messageId})`);
                        this.logger.warn(`⚠️ Verifique manualmente no painel da Gupshup se a mensagem foi entregue`);
                        this.logger.warn(`⚠️ Possíveis razões para o erro de verificação:`);
                        this.logger.warn(`⚠️   - Endpoint de status pode não estar disponível para este tipo de conta`);
                        this.logger.warn(`⚠️   - Message ID pode precisar de mais tempo para estar disponível`);
                        this.logger.warn(`⚠️   - API de status pode ter limitações`);
                        this.logger.warn(`${'─'.repeat(80)}\n`);
                    }
                }

                return {
                    success: true,
                    messageId,
                    templateId: templateId,
                    result: responseData,
                };
            }

            const errorMsg = responseData?.message || responseData?.error || 'Erro desconhecido';
            throw new Error(errorMsg);
        } catch (error: any) {
            const errorMessage = error?.response?.data?.message || error?.response?.data?.error || error.message;
            const statusCode = error?.response?.status;

            this.logger.error(`\n${'X'.repeat(80)}`);
            this.logger.error(`❌ ERRO AO ENVIAR TEMPLATE COM IMAGEM`);
            this.logger.error(`${'X'.repeat(80)}`);
            this.logger.error(`📱 Destinatário: ${phoneNumber}`);
            this.logger.error(`📋 Template ID: ${templateId}`);
            this.logger.error(`📊 Status HTTP: ${statusCode}`);
            this.logger.error(`📄 Erro: ${errorMessage}`);
            this.logger.error(`${'X'.repeat(80)}\n`);

            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Envia uma mensagem de sessão com texto e imagem via Gupshup
     * Usado quando já existe uma conversa ativa (janela de 24h)
     * @param phoneNumber Número do telefone do destinatário
     * @param message Texto da mensagem
     * @param imageBase64 Imagem em base64
     * @param contactName Nome do contato (opcional)
     */
    async sendSessionMessageWithImage(phoneNumber: string, message: string, imageBase64: string, contactName?: string): Promise<any> {
        try {
            const normalizedNumber = this.normalizePhoneNumber(phoneNumber);

            // Verifica se as credenciais da Gupshup estão configuradas
            if (!this.gupshupApiKey || !this.gupshupSource) {
                throw new Error('Credenciais da Gupshup não configuradas');
            }

            let destination = normalizedNumber;
            if (!destination.startsWith('55')) {
                destination = '55' + destination;
            }

            this.logger.log(`\n${'='.repeat(80)}`);
            this.logger.log(`📤 ENVIANDO MENSAGEM DE SESSÃO COM IMAGEM VIA GUPSHUP`);
            this.logger.log(`${'='.repeat(80)}`);
            this.logger.log(`📱 Destinatário: ${destination}${contactName ? ` (${contactName})` : ''}`);
            this.logger.log(`⏰ Timestamp: ${new Date().toISOString()}`);
            this.logger.log(`${'='.repeat(80)}`);

            // Endpoint para mensagens de sessão
            const gupshupEndpoint = 'https://api.gupshup.io/wa/api/v1/msg';

            // 1. Primeiro envia a mensagem de texto
            const textFormData = new URLSearchParams();
            textFormData.append('channel', 'whatsapp');
            textFormData.append('source', this.gupshupSource);
            textFormData.append('destination', destination);
            textFormData.append(
                'message',
                JSON.stringify({
                    type: 'text',
                    text: message,
                }),
            );

            if (this.gupshupAppName) {
                textFormData.append('src.name', this.gupshupAppName);
            }

            this.logger.debug('Enviando mensagem de texto...');

            const textResponse = await firstValueFrom(
                this.http.post<any>(gupshupEndpoint, textFormData.toString(), {
                    headers: {
                        apikey: this.gupshupApiKey,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Cache-Control': 'no-cache',
                    },
                }),
            );

            const textResult = textResponse.data || textResponse;
            this.logger.log(`📥 Resposta do texto: ${JSON.stringify(textResult)}`);

            // Verifica se a mensagem de texto foi enviada (se falhar, provavelmente está fora da janela de 24h)
            if (textResult?.status?.toLowerCase() !== 'submitted' && !textResult?.messageId) {
                this.logger.warn(`⚠️ Mensagem de texto não foi aceita - provavelmente fora da janela de 24h`);
                return {
                    success: false,
                    error: 'Fora da janela de 24h para mensagens de sessão',
                };
            }

            // 2. Faz upload da imagem para obter URL pública
            this.logger.debug('Fazendo upload da imagem...');
            const imageUrl = await this.uploadImageToHosting(imageBase64);
            this.logger.log(`🖼️ Imagem hospedada em: ${imageUrl}`);

            // 3. Envia a imagem
            const imageFormData = new URLSearchParams();
            imageFormData.append('channel', 'whatsapp');
            imageFormData.append('source', this.gupshupSource);
            imageFormData.append('destination', destination);
            imageFormData.append(
                'message',
                JSON.stringify({
                    type: 'image',
                    originalUrl: imageUrl,
                    previewUrl: imageUrl,
                    caption: '📲 QR Code de Credenciamento',
                }),
            );

            if (this.gupshupAppName) {
                imageFormData.append('src.name', this.gupshupAppName);
            }

            this.logger.debug('Enviando imagem...');

            const imageResponse = await firstValueFrom(
                this.http.post<any>(gupshupEndpoint, imageFormData.toString(), {
                    headers: {
                        apikey: this.gupshupApiKey,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Cache-Control': 'no-cache',
                    },
                }),
            );

            const imageResult = imageResponse.data || imageResponse;
            this.logger.log(`📥 Resposta da imagem: ${JSON.stringify(imageResult)}`);

            const imageSuccess = imageResult?.status?.toLowerCase() === 'submitted' || imageResult?.messageId;

            if (imageSuccess) {
                this.logger.log(`\n${'='.repeat(80)}`);
                this.logger.log(`✅ MENSAGEM DE SESSÃO COM IMAGEM ENVIADA COM SUCESSO`);
                this.logger.log(`${'='.repeat(80)}`);
                this.logger.log(`📱 Destinatário: ${destination}`);
                this.logger.log(`🆔 Message ID (texto): ${textResult?.messageId || 'N/A'}`);
                this.logger.log(`🆔 Message ID (imagem): ${imageResult?.messageId || 'N/A'}`);
                this.logger.log(`${'='.repeat(80)}\n`);

                return {
                    success: true,
                    textMessageId: textResult?.messageId,
                    imageMessageId: imageResult?.messageId,
                };
            }

            throw new Error(imageResult?.message || 'Falha ao enviar imagem');
        } catch (error: any) {
            const errorMessage = error?.response?.data?.message || error?.response?.data?.error || error.message;
            const statusCode = error?.response?.status;

            this.logger.error(`\n${'X'.repeat(80)}`);
            this.logger.error(`❌ ERRO AO ENVIAR MENSAGEM DE SESSÃO COM IMAGEM`);
            this.logger.error(`${'X'.repeat(80)}`);
            this.logger.error(`📱 Destinatário: ${phoneNumber}`);
            this.logger.error(`📊 Status HTTP: ${statusCode}`);
            this.logger.error(`📄 Erro: ${errorMessage}`);
            this.logger.error(`${'X'.repeat(80)}\n`);

            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Método alternativo 1 para enviar template (usando message_send com template)
     */
    private async sendTemplateMessageAlternative(phoneNumber: string, templateId: string, templateParams: string[]): Promise<any> {
        try {
            const normalizedNumber = this.normalizePhoneNumber(phoneNumber);

            // Formato alternativo usando a API do ChatGuru que pode repassar para Gupshup
            const params: any = {
                action: 'message_send',
                key: this.key,
                account_id: this.accountId,
                phone_id: this.phoneId,
                chat_number: normalizedNumber,
                template: templateId,
            };

            // Adiciona os parâmetros como JSON string
            if (templateParams.length > 0) {
                params.template_params = JSON.stringify(templateParams);
            }

            const response = await firstValueFrom(this.http.post<{ result?: string; description?: string }>(this.endpoint, null, { params }));

            if (response.data?.result === 'success') {
                this.logger.log(`Template enviado com sucesso (formato alternativo 1) para ${normalizedNumber}`);
                return {
                    success: true,
                    result: response.data,
                };
            }

            throw new Error(response.data?.description || 'Erro ao enviar template');
        } catch (error: any) {
            const errorMessage = error?.response?.data?.description || error.message;
            throw new Error(`Falha ao enviar template (alternativo 1): ${errorMessage}`);
        }
    }

    /**
     * Método alternativo 2 para enviar template (usando message_send com template_id e params separados)
     */
    private async sendTemplateMessageAlternative2(phoneNumber: string, templateId: string, templateParams: string[]): Promise<any> {
        try {
            const normalizedNumber = this.normalizePhoneNumber(phoneNumber);

            // Formato alternativo 2: usando template_id e params como array
            const params: any = {
                action: 'message_send',
                key: this.key,
                account_id: this.accountId,
                phone_id: this.phoneId,
                chat_number: normalizedNumber,
                template_id: templateId,
            };

            // Adiciona os parâmetros individualmente
            templateParams.forEach((param, index) => {
                params[`param${index + 1}`] = param;
            });

            this.logger.debug(`Tentando formato alternativo 2 com params:`, {
                action: params.action,
                template_id: params.template_id,
                params_count: templateParams.length,
            });

            const response = await firstValueFrom(this.http.post<{ result?: string; description?: string }>(this.endpoint, null, { params }));

            if (response.data?.result === 'success') {
                this.logger.log(`Template enviado com sucesso (formato alternativo 2) para ${normalizedNumber}`);
                return {
                    success: true,
                    result: response.data,
                };
            }

            throw new Error(response.data?.description || 'Erro ao enviar template');
        } catch (error: any) {
            const errorMessage = error?.response?.data?.description || error.message;
            throw new Error(`Falha ao enviar template (alternativo 2): ${errorMessage}`);
        }
    }

    /**
     * Envia template usando a API da Gupshup diretamente
     * Usa a API oficial da Gupshup quando o ChatGuru não suporta templates
     */
    private async sendTemplateViaGupshupDirect(phoneNumber: string, templateId: string, templateParams: string[]): Promise<any> {
        try {
            const normalizedNumber = this.normalizePhoneNumber(phoneNumber);

            // Verifica se as credenciais da Gupshup estão configuradas
            if (!this.gupshupApiKey || !this.gupshupSource) {
                throw new Error(
                    'Credenciais da Gupshup não configuradas. Configure GUPSHUP_API_KEY e GUPSHUP_PHONE_NUMBER (ou GUPSHUP_SOURCE) nas variáveis de ambiente.',
                );
            }

            // Log detalhado para rastrear o envio
            this.logger.log(`\n${'='.repeat(80)}`);
            this.logger.log(`📤 INICIANDO ENVIO DE TEMPLATE VIA GUPSHUP`);
            this.logger.log(`${'='.repeat(80)}`);
            this.logger.log(`📱 Número destinatário: ${normalizedNumber}`);
            this.logger.log(`📋 Template ID: ${templateId}`);
            this.logger.log(`📝 Parâmetros: ${JSON.stringify(templateParams)}`);
            this.logger.log(`⏰ Timestamp: ${new Date().toISOString()}`);

            // Log das credenciais (parcialmente mascaradas para segurança)
            this.logger.log(`Enviando template via API Gupshup diretamente para ${normalizedNumber}`);
            this.logger.debug('Credenciais Gupshup configuradas:', {
                apiKey: this.gupshupApiKey
                    ? `${this.gupshupApiKey.substring(0, 10)}...${this.gupshupApiKey.substring(this.gupshupApiKey.length - 5)}`
                    : 'não configurada',
                source: this.gupshupSource || 'não configurado',
                appName: this.gupshupAppName || 'não configurado',
                appId: this.gupshupAppId || 'não configurado',
            });

            // API da Gupshup para envio de templates
            // Endpoint CORRETO para TEMPLATES: /wa/api/v1/template/msg
            // NÃO usar /wa/api/v1/msg para templates - esse é para mensagens comuns
            const gupshupEndpoint = 'https://api.gupshup.io/wa/api/v1/template/msg';

            // Formata o número para o formato esperado pela Gupshup
            // A Gupshup geralmente espera o número com código do país (ex: 55119978172098)
            // Mas pode variar, então vamos tentar com o número completo primeiro
            let destination = normalizedNumber;
            // Se não tiver código do país, adiciona 55
            if (!destination.startsWith('55')) {
                destination = '55' + destination;
            }

            // Prepara o payload conforme documentação da Gupshup
            // Para templates, a Gupshup espera form-urlencoded
            // O campo 'message' pode ser necessário mesmo para templates
            const formData = new URLSearchParams();
            formData.append('channel', 'whatsapp');
            formData.append('source', this.gupshupSource);
            formData.append('destination', destination);

            // Para templates, a Gupshup pode aceitar diferentes formatos
            // IMPORTANTE: A Gupshup geralmente usa o Facebook temp ID (numérico) para templates
            // O Gupshup temp ID (UUID) pode não funcionar diretamente na API
            // Vamos tentar primeiro com o ID fornecido, mas se falhar, pode precisar do Facebook temp ID

            // Verifica se o template ID é UUID (Gupshup) ou numérico (Facebook)
            const isFacebookId = /^\d+$/.test(templateId);
            const isGupshupId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateId);

            this.logger.debug('🔍 Tipo do Template ID:', {
                template_id: templateId,
                is_facebook_id: isFacebookId,
                is_gupshup_id: isGupshupId,
                note: isFacebookId
                    ? 'Facebook ID (numérico) - formato correto para API'
                    : isGupshupId
                      ? 'Gupshup ID (UUID) - pode precisar ser convertido'
                      : 'Formato desconhecido',
            });

            // FORMATO CORRETO DA GUPSHUP PARA TEMPLATES:
            // O template deve ser enviado no campo 'template' (NÃO no campo 'message')
            // template={"id":"nome_template","params":["param1","param2"]}
            // Se usar 'message', a Gupshup interpreta como texto e envia o JSON literalmente!
            const templatePayload = {
                id: templateId,
                params: templateParams,
            };

            // Log do template antes de enviar
            this.logger.debug('📋 Template que será enviado:', {
                template_id: templateId,
                template_id_type: templateId.match(/^\d+$/) ? 'Facebook (numérico)' : 'Nome do template',
                params: templateParams,
                params_count: templateParams.length,
            });

            // Adiciona o template - FORMATO CORRETO: campo 'template', não 'message'
            formData.append('template', JSON.stringify(templatePayload));

            // Log do payload que está sendo enviado
            this.logger.debug('Payload do template sendo enviado:', {
                template_id: templateId,
                template_payload: JSON.stringify(templatePayload),
                params: templateParams,
                params_count: templateParams.length,
            });

            // Se tiver appName configurado, adiciona src.name
            if (this.gupshupAppName) {
                formData.append('src.name', this.gupshupAppName);
            }

            // Log do payload completo para debug
            this.logger.debug('Payload completo do envio:', {
                template: JSON.stringify(templatePayload),
                form_data: Object.fromEntries(formData.entries()),
            });

            this.logger.debug(`Enviando template via Gupshup:`, {
                endpoint: gupshupEndpoint,
                channel: 'whatsapp',
                source: this.gupshupSource,
                destination: destination,
                template_id: templateId,
                params_count: templateParams.length,
                template_payload: JSON.stringify(templatePayload),
            });

            let response: any;
            let lastError: any = null;

            try {
                this.logger.debug(`Enviando template com apikey...`);

                // A Gupshup espera form-urlencoded
                response = await firstValueFrom(
                    this.http.post<any>(gupshupEndpoint, formData.toString(), {
                        headers: {
                            apikey: this.gupshupApiKey,
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Cache-Control': 'no-cache',
                        },
                    }),
                );
                // Log completo da resposta
                this.logger.log(
                    '📥 Resposta completa da Gupshup:',
                    JSON.stringify(
                        {
                            status: response.status,
                            statusText: response.statusText,
                            data: response.data,
                            headers: response.headers,
                        },
                        null,
                        2,
                    ),
                );
            } catch (error: any) {
                lastError = error;
                const errorMsg = error?.response?.data?.message || error?.response?.data?.error || error.message;
                const statusCode = error?.response?.status;
                this.logger.error(`Erro ao enviar template (${statusCode}): ${errorMsg}`);

                // Se for erro 401, pode ser problema de API key
                if (statusCode === 401) {
                    this.logger.error('Erro 401: API key pode estar incorreta ou não autorizada para este app.');
                    throw error;
                }

                // Tenta endpoint alternativo
                this.logger.warn(`Tentando endpoint alternativo /sm/api/v1/msg...`);
                try {
                    const altEndpoint = 'https://api.gupshup.io/sm/api/v1/msg';
                    response = await firstValueFrom(
                        this.http.post<any>(altEndpoint, formData.toString(), {
                            headers: {
                                apikey: this.gupshupApiKey,
                                'Content-Type': 'application/x-www-form-urlencoded',
                                'Cache-Control': 'no-cache',
                            },
                        }),
                    );
                    this.logger.debug('Resposta da Gupshup (endpoint alternativo):', JSON.stringify(response.data, null, 2));
                } catch (altError: any) {
                    lastError = altError;
                    throw altError;
                }
            }

            // Se não conseguiu resposta, lança o último erro
            if (!response) {
                throw lastError || new Error('Falha ao enviar template - nenhuma tentativa foi bem-sucedida');
            }

            // Verifica diferentes formatos de resposta de sucesso
            const responseData = response.data || response;

            // Log completo da resposta para debug
            this.logger.log(`📥 Resposta completa da Gupshup para ${normalizedNumber}:`, JSON.stringify(responseData, null, 2));
            this.logger.log(`📥 Tipo da resposta:`, typeof responseData);
            this.logger.log(`📥 Keys da resposta:`, Object.keys(responseData || {}));

            // Verifica diferentes formatos de resposta de sucesso da Gupshup
            // A Gupshup pode retornar diferentes formatos:
            // 1. { status: 'success', messageId: '...' }
            // 2. { status: 'submitted', ... }
            // 3. { status: 'accepted', ... }
            // 4. { messageId: '...' } (sem status)
            // 5. String com "success"
            // 6. Objeto vazio ou com apenas timestamp
            const status = responseData?.status?.toLowerCase();
            const hasMessageId = !!(responseData?.messageId || responseData?.id || responseData?.msgid);
            const hasError = !!(responseData?.error || responseData?.message?.toLowerCase().includes('error'));

            this.logger.log(`\n${'─'.repeat(60)}`);
            this.logger.log(`📥 RESPOSTA DA GUPSHUP RECEBIDA`);
            this.logger.log(`${'─'.repeat(60)}`);
            this.logger.log(`📱 Destinatário: ${destination}`);
            this.logger.log(`📊 Status HTTP: ${response?.status || 'N/A'}`);
            this.logger.log(`📄 Resposta completa: ${JSON.stringify(responseData, null, 2)}`);
            this.logger.log(`🔍 Análise:`);
            this.logger.log(`   - Status: ${status || 'não informado'}`);
            this.logger.log(`   - Tem MessageId: ${hasMessageId}`);
            this.logger.log(`   - Tem Erro: ${hasError}`);
            this.logger.log(`   - MessageId: ${responseData?.messageId || responseData?.id || responseData?.msgid || 'não retornado'}`);
            this.logger.log(`${'─'.repeat(60)}\n`);

            const isSuccess =
                status === 'success' ||
                status === 'submitted' ||
                status === 'accepted' ||
                hasMessageId ||
                (status && !hasError && status !== 'error' && status !== 'failed') ||
                (typeof responseData === 'string' && responseData.toLowerCase().includes('success'));

            if (isSuccess) {
                const messageId = responseData?.messageId || responseData?.id || responseData?.msgid;
                this.logger.log(`\n${'='.repeat(80)}`);
                this.logger.log(`✅ TEMPLATE ENVIADO COM SUCESSO`);
                this.logger.log(`${'='.repeat(80)}`);
                this.logger.log(`📱 Destinatário: ${destination}`);
                this.logger.log(`📋 Template ID: ${templateId}`);
                this.logger.log(`🆔 Message ID: ${messageId || 'NÃO RETORNADO'}`);
                this.logger.log(`📊 Status: ${status || 'N/A'}`);
                this.logger.log(`⏰ Timestamp: ${new Date().toISOString()}`);

                // IMPORTANTE: Mesmo que a API retorne sucesso, isso não garante entrega
                // A Gupshup aceita a mensagem, mas a entrega depende do WhatsApp
                if (!messageId) {
                    this.logger.warn(`\n⚠️ ${'!'.repeat(70)}`);
                    this.logger.warn(`⚠️ ATENÇÃO: API retornou sucesso MAS SEM messageId!`);
                    this.logger.warn(`⚠️ Isso pode indicar que a mensagem foi ACEITA mas NÃO PROCESSADA.`);
                    this.logger.warn(`⚠️ Verifique:`);
                    this.logger.warn(`⚠️   1. Se o template "${templateId}" está APROVADO na Gupshup`);
                    this.logger.warn(`⚠️   2. Se o número ${destination} possui WhatsApp ativo`);
                    this.logger.warn(`⚠️   3. Se o número ${destination} não bloqueou o remetente`);
                    this.logger.warn(`⚠️ ${'!'.repeat(70)}\n`);
                } else {
                    this.logger.log(`✅ MessageId recebido: ${messageId} - Mensagem ACEITA pela Gupshup`);
                    this.logger.log(`📌 IMPORTANTE: Mensagem aceita ≠ Mensagem entregue!`);
                    this.logger.log(`   A entrega depende do WhatsApp (número ativo, não bloqueado, etc)`);
                }
                this.logger.log(`${'='.repeat(80)}\n`);

                // Retorna sucesso mesmo que não tenha messageId (algumas APIs não retornam)
                return {
                    success: true,
                    result: responseData,
                    method: 'gupshup_direct',
                    messageId: messageId,
                    destination: destination,
                    templateId: templateId,
                    warning: messageId ? undefined : 'API retornou sucesso mas sem messageId. Verifique a entrega manualmente.',
                };
            }

            // Se não é sucesso claro, verifica se há mensagem de erro
            const errorMsg = responseData?.message || responseData?.error || responseData?.description;
            if (errorMsg) {
                this.logger.warn(`⚠️ Resposta da Gupshup indica erro: ${errorMsg}`);
                throw new Error(`Erro ao enviar template via Gupshup: ${errorMsg}`);
            }

            // Se chegou aqui, a resposta não é clara - mas pode ser sucesso mesmo assim
            // Algumas APIs retornam apenas um objeto vazio ou com timestamp em caso de sucesso
            this.logger.warn(`⚠️ Resposta da Gupshup não reconhecida claramente:`, JSON.stringify(responseData, null, 2));

            // Se não há erro explícito e a resposta existe, assume sucesso
            if (responseData && !hasError) {
                this.logger.warn(`⚠️ Assumindo sucesso baseado na ausência de erro explícito`);
                return {
                    success: true,
                    result: responseData,
                    method: 'gupshup_direct',
                    messageId: responseData?.messageId || responseData?.id || responseData?.msgid,
                    warning: 'Resposta não reconhecida claramente, mas assumindo sucesso',
                };
            }

            throw new Error('Resposta da Gupshup não reconhecida. Verifique os logs para mais detalhes.');
        } catch (error: any) {
            const errorMessage = error?.response?.data?.message || error?.response?.data?.error || error?.response?.data?.description || error.message;
            const statusCode = error?.response?.status;
            const errorData = error?.response?.data;

            this.logger.error(`\n${'X'.repeat(80)}`);
            this.logger.error(`❌ ERRO AO ENVIAR TEMPLATE VIA GUPSHUP`);
            this.logger.error(`${'X'.repeat(80)}`);
            this.logger.error(`📱 Destinatário: ${phoneNumber}`);
            this.logger.error(`📋 Template ID: ${templateId}`);
            this.logger.error(`📊 Status HTTP: ${statusCode}`);
            this.logger.error(`📄 Mensagem de erro: ${errorMessage}`);
            this.logger.error(`📄 Dados do erro: ${JSON.stringify(errorData, null, 2)}`);
            this.logger.error(`⏰ Timestamp: ${new Date().toISOString()}`);
            this.logger.error(`${'X'.repeat(80)}\n`);

            throw new Error(`Falha ao enviar template via Gupshup: ${errorMessage}`);
        }
    }

    /**
     * Consulta o status de uma mensagem enviada via Gupshup
     * Usa o messageId retornado no envio para verificar o status real
     */
    async checkMessageStatus(messageId: string): Promise<any> {
        try {
            if (!this.gupshupApiKey) {
                throw new Error('Credenciais da Gupshup não configuradas');
            }

            this.logger.log(`\n${'='.repeat(80)}`);
            this.logger.log(`🔍 CONSULTANDO STATUS DA MENSAGEM`);
            this.logger.log(`${'='.repeat(80)}`);
            this.logger.log(`🆔 Message ID: ${messageId}`);
            this.logger.log(`⏰ Timestamp: ${new Date().toISOString()}`);

            // Endpoint para consultar status de mensagem
            // A Gupshup oferece diferentes endpoints dependendo do tipo de conta
            const statusEndpoint = `https://api.gupshup.io/wa/api/v1/msg/${messageId}/status`;

            try {
                const response = await firstValueFrom(
                    this.http.get<any>(statusEndpoint, {
                        headers: {
                            apikey: this.gupshupApiKey,
                            'Content-Type': 'application/json',
                        },
                    }),
                );

                this.logger.log(`📥 Resposta do status:`);
                this.logger.log(JSON.stringify(response.data, null, 2));
                this.logger.log(`${'='.repeat(80)}\n`);

                return {
                    success: true,
                    messageId,
                    status: response.data,
                };
            } catch (error: any) {
                // Tenta endpoint alternativo
                this.logger.warn(`Endpoint principal falhou, tentando alternativo...`);

                const altEndpoint = `https://api.gupshup.io/sm/api/v1/msg/${messageId}`;
                try {
                    const response = await firstValueFrom(
                        this.http.get<any>(altEndpoint, {
                            headers: {
                                apikey: this.gupshupApiKey,
                                'Content-Type': 'application/json',
                            },
                        }),
                    );

                    this.logger.log(`📥 Resposta do status (endpoint alternativo):`);
                    this.logger.log(JSON.stringify(response.data, null, 2));
                    this.logger.log(`${'='.repeat(80)}\n`);

                    return {
                        success: true,
                        messageId,
                        status: response.data,
                    };
                } catch (altError: any) {
                    throw error; // Mantém o erro original
                }
            }
        } catch (error: any) {
            const errorMessage =
                error?.response?.data?.message ||
                error?.response?.data?.error ||
                (typeof error?.response?.data === 'object' ? JSON.stringify(error?.response?.data) : error?.response?.data) ||
                error.message;
            const statusCode = error?.response?.status;
            const errorData = error?.response?.data;

            this.logger.error(`\n${'X'.repeat(80)}`);
            this.logger.error(`❌ ERRO AO CONSULTAR STATUS DA MENSAGEM`);
            this.logger.error(`${'X'.repeat(80)}`);
            this.logger.error(`🆔 Message ID: ${messageId}`);
            this.logger.error(`📊 Status HTTP: ${statusCode}`);
            this.logger.error(`📄 Erro: ${errorMessage}`);
            if (errorData) {
                this.logger.error(`📄 Dados do erro: ${JSON.stringify(errorData, null, 2)}`);
            }
            this.logger.error(`\n⚠️ NOTA: O erro na verificação de status NÃO significa que a mensagem não foi enviada.`);
            this.logger.error(`   A Gupshup aceitou a mensagem (status: submitted).`);
            this.logger.error(`   Verifique no painel da Gupshup se a mensagem foi realmente entregue.`);
            this.logger.error(`${'X'.repeat(80)}\n`);

            return {
                success: false,
                messageId,
                error: errorMessage,
                statusCode,
            };
        }
    }

    /**
     * Lista templates disponíveis na conta Gupshup
     */
    async listTemplates(): Promise<any> {
        try {
            if (!this.gupshupApiKey || !this.gupshupAppId) {
                throw new Error('Credenciais da Gupshup não configuradas (API Key e App ID necessários)');
            }

            this.logger.log(`\n${'='.repeat(80)}`);
            this.logger.log(`📋 LISTANDO TEMPLATES DISPONÍVEIS`);
            this.logger.log(`${'='.repeat(80)}`);
            this.logger.log(`🆔 App ID: ${this.gupshupAppId}`);
            this.logger.log(`⏰ Timestamp: ${new Date().toISOString()}`);

            // Endpoint para listar templates
            const templatesEndpoint = `https://api.gupshup.io/wa/app/${this.gupshupAppId}/template`;

            const response = await firstValueFrom(
                this.http.get<any>(templatesEndpoint, {
                    headers: {
                        apikey: this.gupshupApiKey,
                        'Content-Type': 'application/json',
                    },
                }),
            );

            this.logger.log(`📥 Templates encontrados:`);

            // Processa e exibe os templates de forma legível
            const templates = response.data?.templates || response.data || [];
            if (Array.isArray(templates)) {
                templates.forEach((template: any, index: number) => {
                    this.logger.log(`\n📄 Template ${index + 1}:`);
                    this.logger.log(`   - Nome: ${template.elementName || template.name || 'N/A'}`);
                    this.logger.log(`   - ID: ${template.id || 'N/A'}`);
                    this.logger.log(`   - Status: ${template.status || 'N/A'}`);
                    this.logger.log(`   - Categoria: ${template.category || 'N/A'}`);
                    this.logger.log(`   - Linguagem: ${template.languageCode || template.language || 'N/A'}`);
                });
            }

            this.logger.log(`\n${'='.repeat(80)}\n`);

            return {
                success: true,
                templates: templates,
                count: Array.isArray(templates) ? templates.length : 0,
            };
        } catch (error: any) {
            const errorMessage = error?.response?.data?.message || error?.response?.data?.error || error.message;
            const statusCode = error?.response?.status;

            this.logger.error(`\n${'X'.repeat(80)}`);
            this.logger.error(`❌ ERRO AO LISTAR TEMPLATES`);
            this.logger.error(`${'X'.repeat(80)}`);
            this.logger.error(`📊 Status HTTP: ${statusCode}`);
            this.logger.error(`📄 Erro: ${errorMessage}`);
            this.logger.error(`📄 Dados: ${JSON.stringify(error?.response?.data, null, 2)}`);
            this.logger.error(`${'X'.repeat(80)}\n`);

            return {
                success: false,
                error: errorMessage,
                statusCode,
            };
        }
    }

    /**
     * Busca um template na Gupshup pelo ID ou pelo nome (elementName).
     * A API Gupshup não expõe "get by id" direto; fazemos GET da lista e filtramos.
     * Útil para obter o corpo do template (data), placeholders e meta sem mockar no código.
     * @param templateId ID do template (UUID Gupshup) ou nome do template (elementName)
     * @returns O objeto do template ou null se não encontrado. Inclui: id, elementName, data (body com {{1}}, {{2}}), meta, status, etc.
     */
    async getTemplateById(templateId: string): Promise<{ success: boolean; template?: any; error?: string }> {
        try {
            if (!templateId || !templateId.trim()) {
                return { success: false, error: 'templateId é obrigatório' };
            }
            const result = await this.listTemplates();
            if (!result.success || !Array.isArray(result.templates)) {
                return {
                    success: false,
                    error: result.error || 'Falha ao listar templates da Gupshup',
                };
            }
            const idOrName = templateId.trim();
            const template = result.templates.find(
                (t: any) =>
                    (t.id && String(t.id).toLowerCase() === idOrName.toLowerCase()) ||
                    (t.elementName && String(t.elementName).toLowerCase() === idOrName.toLowerCase()) ||
                    (t.name && String(t.name).toLowerCase() === idOrName.toLowerCase()),
            );
            if (!template) {
                return {
                    success: true,
                    template: undefined,
                    error: `Template não encontrado: "${templateId}". Use GET /whatsapp/templates para listar IDs e nomes.`,
                };
            }
            return {
                success: true,
                template: {
                    id: template.id,
                    elementName: template.elementName || template.name,
                    name: template.name || template.elementName,
                    data: template.data,
                    meta: template.meta,
                    status: template.status,
                    category: template.category,
                    languageCode: template.languageCode || template.language,
                    templateType: template.templateType,
                },
            };
        } catch (error: any) {
            const errorMessage = error?.response?.data?.message || error?.response?.data?.error || error.message;
            this.logger.error(`Erro ao buscar template por ID "${templateId}": ${errorMessage}`);
            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Cria chat e envia template
     */
    async createChatAndSendTemplate(phoneNumber: string, templateId: string, templateParams: string[], contactName?: string): Promise<any> {
        try {
            const normalizedNumber = this.normalizePhoneNumber(phoneNumber);

            this.logger.log(`Iniciando processo de template para ${normalizedNumber}${contactName ? ` (${contactName})` : ''}`);

            // Tenta criar o chat primeiro (sem mensagem inicial)
            // Se falhar, continua mesmo assim - o template pode criar o chat automaticamente
            let chatResult = null;
            try {
                chatResult = await this.createChat(normalizedNumber, contactName);
                this.logger.log(`Chat criado com sucesso antes de enviar template`);
                // Aguarda um pouco para o chat ser processado
                await this.delay(2000);
            } catch (chatError: any) {
                // Se o erro for sobre mensagem inicial inválida ou chat já existe, continua
                const errorMsg = chatError.message?.toLowerCase() || '';
                if (errorMsg.includes('mensagem inicial inválida') || errorMsg.includes('já existe') || errorMsg.includes('already exists')) {
                    this.logger.warn(`Não foi possível criar chat antes do template (pode já existir ou não ser necessário): ${chatError.message}`);
                    // Continua mesmo assim - o template pode funcionar sem criar o chat primeiro
                } else {
                    // Para outros erros, loga mas continua
                    this.logger.warn(`Erro ao criar chat antes do template: ${chatError.message}. Continuando mesmo assim...`);
                }
            }

            // Envia o template (pode criar o chat automaticamente se necessário)
            const templateResult = await this.sendTemplateMessage(normalizedNumber, templateId, templateParams, contactName);

            // Verifica se o template foi realmente enviado com sucesso
            if (templateResult.success) {
                return {
                    success: true,
                    chatCreated: chatResult !== null,
                    templateSent: true,
                    chatResult,
                    templateResult,
                    warning: templateResult.warning, // Propaga o warning se houver
                };
            } else {
                // Se o template não foi enviado, retorna erro
                throw new Error(templateResult.error || 'Falha ao enviar template');
            }
        } catch (error: any) {
            this.logger.error(`Erro no processo completo de template: ${error.message}`, {
                stack: error.stack,
            });
            throw error;
        }
    }
}
