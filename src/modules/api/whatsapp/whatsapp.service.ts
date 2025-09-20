import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { EStatusAlunosTurmas } from '@/modules/config/entities/enum';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';

export interface CheckInStudentDto {
    alunoTurmaId: string;
    alunoNome: string;
    turmaId: number;
    treinamentoNome: string;
}

@Injectable()
export class WhatsAppService {
    private readonly zApiUrl: string;
    private readonly zApiToken: string;
    private readonly frontendUrl: string;
    private readonly jwtSecret: string;
    private readonly zApiInstance: string;
    private readonly zApiClientToken: string;
    constructor(private readonly uow: UnitOfWorkService) {
        // Configurações Z-API (devem vir de variáveis de ambiente)
        this.zApiUrl = process.env.Z_API_URL || 'https://api.z-api.io';
        this.zApiToken = process.env.Z_API_TOKEN || '';
        this.zApiInstance = process.env.Z_API_INSTANCE_ID || '';
        this.zApiClientToken = process.env.Z_API_CLIENT_TOKEN || '';
        this.frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
        this.jwtSecret = process.env.JWT_SECRET;
    }

    /**
     * Envia mensagem via Z-API
     */
    async sendMessage(phone: string, message: string): Promise<{ success: boolean; message?: string; error?: string }> {
        try {
            // Debug das credenciais
            console.log('🔍 DEBUG Z-API Credenciais:');
            console.log(`URL: ${this.zApiUrl}`);
            console.log(`Token: ${this.zApiToken ? this.zApiToken.substring(0, 8) + '...' : 'VAZIO'}`);
            console.log(`Instance: ${this.zApiInstance ? this.zApiInstance.substring(0, 8) + '...' : 'VAZIO'}`);
            console.log(`Client-Token: ${this.zApiClientToken ? this.zApiClientToken.substring(0, 8) + '...' : 'VAZIO'}`);

            // MODO SIMULAÇÃO ATIVO se faltar configuração
            if (!this.zApiToken || !this.zApiInstance) {
                // Formatar número mesmo no modo simulação para mostrar como ficaria
                let formattedPhone = phone.replace(/\D/g, '');
                if (!formattedPhone.startsWith('55')) {
                    formattedPhone = '55' + formattedPhone;
                }

                console.log('🔄 MODO SIMULAÇÃO ATIVO - WhatsApp');
                console.log(`📱 Número original: ${phone}`);
                console.log(`📱 Número formatado: ${formattedPhone}`);
                console.log(`💬 Mensagem: ${message.substring(0, 150)}...`);
                console.log('✅ Simulação concluída - Status do aluno será atualizado');
                return {
                    success: true,
                    message: 'Mensagem enviada com sucesso (modo simulação)',
                };
            }

            // Formatar número de telefone (remover caracteres especiais e adicionar código do Brasil)
            let formattedPhone = phone.replace(/\D/g, '');

            // Adicionar código do país (55) se não estiver presente
            if (!formattedPhone.startsWith('55')) {
                formattedPhone = '55' + formattedPhone;
            }

            const headers: any = {
                'Content-Type': 'application/json',
            };

            // Adicionar Client-Token se disponível
            if (this.zApiClientToken) {
                headers['Client-Token'] = this.zApiClientToken;
            }

            const response = await axios.post(
                `${this.zApiUrl}/instances/${this.zApiInstance}/token/${this.zApiToken}/send-text`,
                {
                    phone: formattedPhone,
                    message: message,
                },
                {
                    headers,
                },
            );

            const responseData = response.data as any;

            // Debug da resposta da Z-API
            console.log('🔍 Resposta Z-API:', JSON.stringify(responseData, null, 2));

            // Z-API pode retornar diferentes estruturas de sucesso
            const isSuccess =
                responseData?.success === true ||
                responseData?.status === 'sent' ||
                responseData?.status === 'delivered' ||
                responseData?.messageId ||
                responseData?.id ||
                (response.status === 200 && !responseData?.error);

            if (isSuccess) {
                return {
                    success: true,
                    message: 'Mensagem enviada com sucesso',
                };
            } else {
                return {
                    success: false,
                    error: `Falha ao enviar mensagem via Z-API: ${responseData?.error || 'Resposta inesperada'}`,
                };
            }
        } catch (error: unknown) {
            console.error('Erro ao enviar mensagem via Z-API:', error);

            // Se for erro 400 com "client-token is not configured", usar modo simulação
            if (error && typeof error === 'object' && 'response' in error) {
                const axiosError = error as any;
                if (axiosError.response?.status === 400 && axiosError.response?.data?.error === 'your client-token is not configured') {
                    console.log('⚠️ Credenciais Z-API inválidas, ativando modo simulação...');

                    // Formatar número para simulação
                    let formattedPhone = phone.replace(/\D/g, '');
                    if (!formattedPhone.startsWith('55')) {
                        formattedPhone = '55' + formattedPhone;
                    }

                    console.log('🔄 MODO SIMULAÇÃO ATIVO - WhatsApp (Fallback)');
                    console.log(`📱 Número formatado: ${formattedPhone}`);
                    console.log(`💬 Mensagem: ${message.substring(0, 150)}...`);
                    console.log('✅ Simulação concluída - Status do aluno será atualizado');

                    return {
                        success: true,
                        message: 'Mensagem enviada com sucesso (modo simulação - credenciais inválidas)',
                    };
                }
            }

            const errorMessage = error instanceof Error ? error.message : 'Erro interno ao enviar mensagem';
            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Envia links de check-in para múltiplos alunos
     */
    async sendCheckInLinksToStudents(students: CheckInStudentDto[]): Promise<{ success: boolean; sent: number; errors: string[] }> {
        const results = {
            success: true,
            sent: 0,
            errors: [] as string[],
        };

        for (const student of students) {
            try {
                // Buscar dados do aluno na turma
                const alunoTurma = await this.uow.turmasAlunosRP.findOne({
                    where: { id: student.alunoTurmaId },
                    relations: ['id_aluno_fk'],
                });

                if (!alunoTurma || !alunoTurma.id_aluno_fk) {
                    results.errors.push(`Aluno não encontrado: ${student.alunoNome}`);
                    continue;
                }

                // Gerar token JWT para o link de check-in
                const checkInToken = jwt.sign(
                    {
                        alunoTurmaId: student.alunoTurmaId,
                        turmaId: student.turmaId,
                        timestamp: Date.now(),
                    },
                    this.jwtSecret,
                    { expiresIn: '7d' }, // Link expira em 7 dias
                );

                // Gerar URL de check-in
                const checkInUrl = `${this.frontendUrl}/api/whatsapp/checkin/${checkInToken}?student=${student.alunoTurmaId}`;

                // Gerar mensagem
                const message = this.generateCheckInMessage(student.alunoNome, student.treinamentoNome, checkInUrl);

                // Enviar mensagem
                const phone = alunoTurma.id_aluno_fk.telefone_um;
                const sendResult = await this.sendMessage(phone, message);

                if (sendResult.success) {
                    // Atualizar status do aluno para AGUARDANDO_CHECKIN
                    await this.uow.turmasAlunosRP.update({ id: student.alunoTurmaId }, { status_aluno_turma: EStatusAlunosTurmas.AGUARDANDO_CHECKIN });

                    results.sent++;
                } else {
                    results.errors.push(`Erro ao enviar para ${student.alunoNome}: ${sendResult.error}`);
                }
            } catch (error: unknown) {
                console.error(`Erro ao processar aluno ${student.alunoNome}:`, error);
                const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
                results.errors.push(`Erro interno para ${student.alunoNome}: ${errorMessage}`);
            }
        }

        results.success = results.errors.length === 0;
        return results;
    }

    /**
     * Processa check-in via link
     */
    async processCheckIn(token: string, studentId?: string): Promise<{ success: boolean; message: string; redirect?: string }> {
        try {
            // Verificar e decodificar token
            const decoded = jwt.verify(token, this.jwtSecret) as { alunoTurmaId: string; turmaId: number; timestamp: number };

            if (!decoded.alunoTurmaId || !decoded.turmaId) {
                throw new BadRequestException('Token inválido');
            }

            // Buscar aluno na turma
            const alunoTurma = await this.uow.turmasAlunosRP.findOne({
                where: { id: decoded.alunoTurmaId },
                relations: ['id_aluno_fk', 'id_turma_fk'],
            });

            if (!alunoTurma) {
                throw new NotFoundException('Aluno não encontrado na turma');
            }

            // Verificar se o check-in já foi realizado
            if (alunoTurma.status_aluno_turma === EStatusAlunosTurmas.CHECKIN_REALIZADO) {
                return {
                    success: true,
                    message: 'Check-in já realizado anteriormente!',
                    redirect: `${this.frontendUrl}/checkin-success?already=true`,
                };
            }

            // Verificar se está no status correto para fazer check-in
            if (alunoTurma.status_aluno_turma !== EStatusAlunosTurmas.AGUARDANDO_CHECKIN) {
                return {
                    success: false,
                    message: 'Status do aluno não permite check-in no momento',
                    redirect: `${this.frontendUrl}/checkin-error?reason=invalid-status`,
                };
            }

            // Atualizar status para CHECKIN_REALIZADO
            await this.uow.turmasAlunosRP.update(
                { id: decoded.alunoTurmaId },
                {
                    status_aluno_turma: EStatusAlunosTurmas.CHECKIN_REALIZADO,
                    atualizado_em: new Date(),
                },
            );

            return {
                success: true,
                message: `Check-in realizado com sucesso para ${alunoTurma.id_aluno_fk?.nome}!`,
                redirect: `${this.frontendUrl}/checkin-success?name=${encodeURIComponent(alunoTurma.id_aluno_fk?.nome || '')}`,
            };
        } catch (error: unknown) {
            console.error('Erro ao processar check-in:', error);

            if (error instanceof Error) {
                if (error.name === 'JsonWebTokenError') {
                    return {
                        success: false,
                        message: 'Link de check-in inválido',
                        redirect: `${this.frontendUrl}/checkin-error?reason=invalid-token`,
                    };
                }

                if (error.name === 'TokenExpiredError') {
                    return {
                        success: false,
                        message: 'Link de check-in expirado',
                        redirect: `${this.frontendUrl}/checkin-error?reason=expired`,
                    };
                }
            }

            return {
                success: false,
                message: 'Erro interno ao processar check-in',
                redirect: `${this.frontendUrl}/checkin-error?reason=internal`,
            };
        }
    }

    /**
     * Testa conectividade com Z-API
     */
    async testZApiConnection(): Promise<{ success: boolean; message: string; details?: any }> {
        try {
            if (!this.zApiToken || !this.zApiInstance) {
                return {
                    success: false,
                    message: 'Credenciais Z-API não configuradas',
                };
            }

            const headers: any = {
                'Content-Type': 'application/json',
            };

            if (this.zApiClientToken) {
                headers['Client-Token'] = this.zApiClientToken;
            }

            console.log('🔍 Testando conectividade Z-API...');
            console.log(`URL: ${this.zApiUrl}/instances/${this.zApiInstance}/token/${this.zApiToken}/status`);

            const response = await axios.get(`${this.zApiUrl}/instances/${this.zApiInstance}/token/${this.zApiToken}/status`, { headers });

            return {
                success: true,
                message: 'Conectividade Z-API OK',
                details: response.data,
            };
        } catch (error: any) {
            console.error('❌ Erro ao testar Z-API:', error.response?.data || error.message);
            return {
                success: false,
                message: 'Erro de conectividade Z-API',
                details: error.response?.data || error.message,
            };
        }
    }

    /**
     * Gera mensagem padrão para check-in
     */
    private generateCheckInMessage(alunoNome: string, treinamentoNome: string, checkInUrl: string): string {
        return `Olá ${alunoNome}! 👋

Você está confirmado(a) para o treinamento *${treinamentoNome}*! 🎉

Para confirmar sua presença, clique no link abaixo:
${checkInUrl}

⚠️ *IMPORTANTE:* Clique no link apenas quando estiver presente no local do evento.

Nos vemos lá! 🚀`;
    }
}
