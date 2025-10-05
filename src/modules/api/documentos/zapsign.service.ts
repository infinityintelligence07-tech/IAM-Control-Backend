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
    id: string;
    name: string;
    status: string;
    created_at: string;
    signers: Array<{
        id: string;
        name: string;
        email: string;
        status: string;
        signed_at?: string;
    }>;
    file_url?: string;
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

    async createDocumentFromTemplate(templateId: string, documentData: ZapSignDocument): Promise<ZapSignResponse> {
        try {
            console.log('Criando documento no ZapSign usando template:', templateId);

            const response = await axios.post(
                `${this.apiUrl}/docs/`,
                {
                    template_id: templateId,
                    name: documentData.name,
                    signers: documentData.signers,
                    message: documentData.message || 'Por favor, assine este documento.',
                    sandbox: documentData.sandbox || false,
                },
                {
                    headers: this.getHeaders(),
                },
            );

            console.log('Documento criado com sucesso no ZapSign usando template:', response.data);
            return response.data as ZapSignResponse;
        } catch (error: any) {
            console.error('Erro ao criar documento no ZapSign usando template - detalhes completos:');
            console.error('Status:', error.response?.status);
            console.error('Data:', JSON.stringify(error.response?.data, null, 2));
            console.error('Headers:', error.response?.headers);
            throw new BadRequestException(`Erro ao criar documento no ZapSign usando template: ${JSON.stringify(error.response?.data || error.message)}`);
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
     * Cancela um documento
     */
    async cancelDocument(documentId: string): Promise<{ message: string }> {
        try {
            await axios.delete(`${this.apiUrl}/docs/${documentId}/`, {
                headers: this.getHeaders(),
            });

            return { message: 'Documento cancelado com sucesso' };
        } catch (error: any) {
            console.error('Erro ao cancelar documento do ZapSign:', error.response?.data || error.message);
            throw new BadRequestException('Erro ao cancelar documento do ZapSign');
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

    async createDocumentFromContent(data: { name: string; content: string; signers: ZapSignSigner[]; message?: string }): Promise<ZapSignDocument> {
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

            console.log('Documento criado com sucesso!', response.data);
            return response.data as ZapSignDocument;
        } catch (error: any) {
            console.error('Erro ao criar documento com conteúdo:', error.response?.data || error.message);
            console.error('Status:', error.response?.status);
            console.error('Data completa:', JSON.stringify(error.response?.data, null, 2));
            throw new BadRequestException('Erro ao criar documento no ZapSign');
        }
    }
}
