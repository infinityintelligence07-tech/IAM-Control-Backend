import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface ZapSignTemplate {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
}

export interface ZapSignSigner {
    name: string;
    email: string;
    phone?: string;
    action: 'sign' | 'witness';
    status?: string;
    signed_at?: string;
}

export interface ZapSignDocument {
    id?: string;
    template_id?: string;
    name: string;
    signers: ZapSignSigner[];
    message?: string;
    sandbox?: boolean;
    status?: string;
    created_at?: string;
    file_url?: string;
}

export interface ZapSignResponse {
    token: string; // ID único do documento na ZapSign
    open_id: number; // ID numérico do documento
    name: string;
    status: string;
    created_at: string;
    signers: Array<{
        token: string;
        name: string;
        email: string;
        status: string;
        signed_at?: string;
        sign_url?: string;
    }>;
    original_file?: string;
    signed_file?: string | null;
}

@Injectable()
export class ZapSignService {
    private readonly apiUrl = 'https://api.zapsign.com.br/api/v1';
    private readonly apiKey: string;

    constructor(private configService: ConfigService) {
        this.apiKey = this.configService.get<string>('ZAPSIGN_API_KEY');
        if (!this.apiKey) {
            throw new Error('ZAPSIGN_API_KEY não configurada');
        }
    }

    private getHeaders() {
        return {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'IAM-Control/1.0',
        };
    }

    /**
     * Busca todos os templates disponíveis no ZapSign
     */
    async getTemplates(): Promise<ZapSignTemplate[]> {
        try {
            const response = await axios.get(`${this.apiUrl}/templates/`, {
                headers: this.getHeaders(),
            });

            return (response.data as any)?.results || (response.data as any) || [];
        } catch (error: any) {
            console.error('Erro ao buscar templates do ZapSign:', error.response?.data || error.message);
            throw new BadRequestException('Erro ao buscar templates do ZapSign');
        }
    }

    /**
     * Cria um documento no ZapSign para assinatura
     */
    async createDocument(documentData: ZapSignDocument): Promise<ZapSignResponse> {
        try {
            console.log('Criando documento no ZapSign com dados:', {
                template_id: documentData.template_id,
                name: documentData.name,
                signers: documentData.signers,
                message: documentData.message || 'Por favor, assine este documento.',
                sandbox: documentData.sandbox || false,
            });

            const response = await axios.post(
                `${this.apiUrl}/docs/`,
                {
                    template_id: documentData.template_id,
                    name: documentData.name,
                    signers: documentData.signers,
                    message: documentData.message || 'Por favor, assine este documento.',
                    sandbox: documentData.sandbox || false,
                },
                {
                    headers: this.getHeaders(),
                },
            );

            console.log('Documento criado com sucesso no ZapSign:', response.data);
            return response.data as ZapSignResponse;
        } catch (error: any) {
            console.error('Erro ao criar documento no ZapSign - detalhes completos:');
            console.error('Status:', error.response?.status);
            console.error('Data:', JSON.stringify(error.response?.data, null, 2));
            console.error('Headers:', error.response?.headers);
            throw new BadRequestException(`Erro ao criar documento no ZapSign: ${JSON.stringify(error.response?.data || error.message)}`);
        }
    }

    /**
     * Cria um documento no ZapSign a partir de um arquivo PDF
     */
    async createDocumentFromFile(documentData: any): Promise<ZapSignResponse> {
        try {
            console.log('Criando documento no ZapSign a partir de arquivo PDF');
            console.log('Dados recebidos:', {
                name: documentData.name,
                signers: documentData.signers?.length || 0,
                message: documentData.message,
                sandbox: documentData.sandbox,
                fileType: typeof documentData.file,
                fileIsBuffer: Buffer.isBuffer(documentData.file),
                fileSize: documentData.file?.length || 0,
            });

            // Converter o buffer para base64
            const base64File = documentData.file.toString('base64');
            console.log('Base64 gerado. Tamanho:', base64File.length, 'caracteres');
            console.log('Primeiros 100 caracteres do base64:', base64File.substring(0, 100));

            const response = await axios.post(
                `${this.apiUrl}/docs/`,
                {
                    name: documentData.name,
                    signers: documentData.signers,
                    message: documentData.message || 'Por favor, assine este documento.',
                    sandbox: documentData.sandbox || false,
                    base64_pdf: base64File, // Corrigido: usar base64_pdf em vez de file
                },
                {
                    headers: this.getHeaders(),
                },
            );

            console.log('Documento criado com sucesso no ZapSign a partir de arquivo:', response.data);
            console.log('=== DEBUG ZAPSIGN API RESPONSE ===');
            console.log('response.data completo:', JSON.stringify(response.data, null, 2));

            const responseData = response.data as ZapSignResponse;
            console.log('response.data.original_file:', responseData.original_file);
            console.log('response.data.signed_file:', responseData.signed_file);
            console.log('response.data.token:', responseData.token);
            return responseData;
        } catch (error: any) {
            console.error('Erro ao criar documento no ZapSign a partir de arquivo - detalhes completos:');
            console.error('Status:', error.response?.status);
            console.error('Data:', JSON.stringify(error.response?.data, null, 2));
            console.error('Headers:', error.response?.headers);
            throw new BadRequestException(`Erro ao criar documento no ZapSign a partir de arquivo: ${JSON.stringify(error.response?.data || error.message)}`);
        }
    }

    /**
     * Busca informações de um documento específico
     */
    async getDocument(documentId: string): Promise<ZapSignResponse> {
        try {
            const response = await axios.get(`${this.apiUrl}/docs/${documentId}/`, {
                headers: this.getHeaders(),
            });

            return response.data as ZapSignResponse;
        } catch (error: any) {
            console.error('Erro ao buscar documento do ZapSign:', error.response?.data || error.message);
            throw new BadRequestException('Erro ao buscar documento do ZapSign');
        }
    }

    /**
     * Lista todos os documentos criados
     */
    async getDocuments(): Promise<ZapSignResponse[]> {
        try {
            const response = await axios.get(`${this.apiUrl}/docs/`, {
                headers: this.getHeaders(),
            });

            return (response.data as any)?.results || (response.data as any) || [];
        } catch (error: any) {
            console.error('Erro ao listar documentos do ZapSign:', error.response?.data || error.message);
            throw new BadRequestException('Erro ao listar documentos do ZapSign');
        }
    }

    /**
     * Envia lembretes para assinantes pendentes
     */
    async sendReminder(documentId: string): Promise<{ message: string }> {
        try {
            await axios.post(
                `${this.apiUrl}/docs/${documentId}/send-reminder/`,
                {},
                {
                    headers: this.getHeaders(),
                },
            );

            return { message: 'Lembrete enviado com sucesso' };
        } catch (error: any) {
            console.error('Erro ao enviar lembrete:', error.response?.data || error.message);
            throw new BadRequestException('Erro ao enviar lembrete');
        }
    }

    async createDocumentFromContent(data: { name: string; content: string; signers: ZapSignSigner[]; message?: string }): Promise<ZapSignResponse> {
        try {
            console.log('createDocumentFromContent - Recebendo content (primeiros 100 caracteres):', data.content.substring(0, 100));
            console.log('createDocumentFromContent - É base64?:', /^[A-Za-z0-9+/]+=*$/.test(data.content.substring(0, 100)));

            // O conteúdo já vem em base64, não precisa converter novamente
            const response = await axios.post(
                `${this.apiUrl}/docs/`,
                {
                    name: data.name,
                    base64_pdf: data.content, // Usar diretamente o conteúdo que já é base64
                    signers: data.signers,
                    message: data.message || 'Documento para assinatura',
                },
                {
                    headers: this.getHeaders(),
                },
            );

            const responseData = response.data as ZapSignResponse;

            console.log('✅ Documento criado com sucesso no ZapSign!');
            console.log('📋 Token do documento:', responseData.token);
            console.log('📋 Open ID:', responseData.open_id);
            console.log('📋 Status:', responseData.status);
            console.log('📋 Data completa:', JSON.stringify(responseData, null, 2));

            if (!responseData.token) {
                console.error('❌ ERRO: ZapSign não retornou um token para o documento!');
                throw new BadRequestException('ZapSign não retornou um token para o documento');
            }

            return responseData;
        } catch (error: any) {
            console.error('Erro ao criar documento com conteúdo:', error.response?.data || error.message);
            console.error('Status:', error.response?.status);
            console.error('Data completa:', JSON.stringify(error.response?.data, null, 2));
            throw new BadRequestException('Erro ao criar documento no ZapSign');
        }
    }

    /**
     * Cancela um documento no ZapSign
     */
    async cancelDocument(documentId: string): Promise<void> {
        try {
            console.log('Cancelando documento no ZapSign:', documentId);

            const response = await axios.post(
                `${this.apiUrl}/docs/${documentId}/cancel/`,
                {},
                {
                    headers: this.getHeaders(),
                },
            );

            console.log('✅ Documento cancelado com sucesso no ZapSign');
            console.log('📋 Resposta:', response.data);
        } catch (error: any) {
            console.error('Erro ao cancelar documento no ZapSign:', error.response?.data || error.message);
            throw new BadRequestException('Erro ao cancelar documento no ZapSign');
        }
    }

    /**
     * Exclui um documento no ZapSign
     */
    async excluirDocumento(documentId: string): Promise<void> {
        try {
            console.log('Excluindo documento no ZapSign:', documentId);

            const response = await axios.delete(`${this.apiUrl}/docs/${documentId}/`, {
                headers: this.getHeaders(),
            });

            console.log('✅ Documento excluído com sucesso no ZapSign');
            console.log('📋 Resposta:', response.data);
        } catch (error: any) {
            console.error('Erro ao excluir documento no ZapSign:', error.response?.data || error.message);
            throw new BadRequestException('Erro ao excluir documento no ZapSign');
        }
    }
}
