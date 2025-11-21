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

    constructor(
        private readonly http: HttpService,
        private readonly configService: ConfigService,
    ) {
        this.endpoint = this.configService.get<string>('CHATGURU_ENDPOINT') || 'https://s17.chatguru.app/api/v1';
        this.key = this.configService.get<string>('CHATGURU_KEY') || '';
        this.accountId = this.configService.get<string>('CHATGURU_ACCOUNT_ID') || '';
        this.phoneId = this.configService.get<string>('CHATGURU_PHONE_ID') || '';
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

            if (response.data?.result === 'success') {
                this.logger.log(`Imagem enviada com sucesso para ${normalizedNumber}`);
                return response.data;
            }

            throw new Error(response.data?.description || 'Erro ao enviar imagem');
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
     */
    async createChatAndSendMessageWithQRCode(phoneNumber: string, message: string, qrCodeData: any, contactName?: string): Promise<any> {
        try {
            const normalizedNumber = this.normalizePhoneNumber(phoneNumber);

            this.logger.log(`Iniciando processo com QR code para ${normalizedNumber}${contactName ? ` (${contactName})` : ''}`);

            // Primeiro, cria o chat e envia a mensagem
            const chatResult = await this.createChatAndSendMessage(normalizedNumber, message, contactName);

            // Gera e envia o QR code
            try {
                this.logger.log(`Gerando QR code...`);
                const qrCodeImage = await this.generateQRCode(qrCodeData);
                this.logger.log(`Enviando QR code para ${normalizedNumber}...`);
                await this.delay(1000); // Pequeno delay entre mensagem e imagem
                const qrResult = await this.sendImage(normalizedNumber, qrCodeImage, 'QR Code do evento');
                this.logger.log(`QR code enviado com sucesso!`);

                return {
                    ...chatResult,
                    qrCodeSent: true,
                    result: {
                        ...chatResult.result,
                        qrCodeSend: qrResult,
                    },
                };
            } catch (qrError: any) {
                this.logger.warn(`Erro ao enviar QR code: ${qrError.message}. Mas mensagem já foi enviada.`);
                return {
                    ...chatResult,
                    qrCodeSent: false,
                    warning: `QR code não pôde ser enviado: ${qrError.message}`,
                };
            }
        } catch (error: any) {
            this.logger.error(`Erro no processo completo com QR code: ${error.message}`, {
                stack: error.stack,
            });
            throw error;
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
}
