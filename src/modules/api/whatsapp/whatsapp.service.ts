import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { EStatusAlunosTurmas } from '@/modules/config/entities/enum';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import * as QRCode from 'qrcode';

export interface CheckInStudentDto {
    alunoTurmaId: string;
    alunoNome: string;
    turmaId: number;
    treinamentoNome: string;
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
        this.frontendUrl = process.env.FRONTEND_URL || 'https://localhost:3001';
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

                // Gerar URL de check-in - link para formulário de preenchimento de dados
                const checkInUrl = `${this.frontendUrl}/preencherdadosaluno?token=${checkInToken}`;

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

            // Redirecionar para página de preencher dados primeiro
            // O check-in será realizado após o preenchimento dos dados
            return {
                success: true,
                message: 'Redirecionando para preencher dados...',
                redirect: `${this.frontendUrl}/preencherdadosaluno?token=${token}`,
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
     * Busca dados do aluno por token de check-in
     */
    async getDadosAlunoPorToken(token: string): Promise<any> {
        try {
            // Verificar e decodificar token
            const decoded = jwt.verify(token, this.jwtSecret) as { alunoTurmaId: string; turmaId: number; timestamp: number };

            if (!decoded.alunoTurmaId || !decoded.turmaId) {
                throw new BadRequestException('Token inválido');
            }

            // Buscar aluno na turma
            const alunoTurma = await this.uow.turmasAlunosRP.findOne({
                where: { id: decoded.alunoTurmaId },
                relations: ['id_aluno_fk', 'id_turma_fk', 'id_turma_fk.id_treinamento_fk'],
            });

            if (!alunoTurma || !alunoTurma.id_aluno_fk) {
                throw new NotFoundException('Aluno não encontrado na turma');
            }

            const aluno = alunoTurma.id_aluno_fk;

            // Retornar dados do aluno
            return {
                id: aluno.id,
                nome: aluno.nome,
                nome_cracha: aluno.nome_cracha,
                email: aluno.email,
                cpf: aluno.cpf,
                telefone_um: aluno.telefone_um,
                telefone_dois: aluno.telefone_dois,
                cep: aluno.cep,
                logradouro: aluno.logradouro,
                complemento: aluno.complemento,
                numero: aluno.numero,
                bairro: aluno.bairro,
                cidade: aluno.cidade,
                estado: aluno.estado,
                profissao: aluno.profissao,
                genero: aluno.genero,
                data_nascimento: aluno.data_nascimento,
                desc_deficiencia: aluno.desc_deficiencia,
                url_foto_aluno: aluno.url_foto_aluno,
                possui_deficiencia: aluno.possui_deficiencia,
                turma: {
                    id: alunoTurma.id_turma_fk.id,
                    nome: alunoTurma.id_turma_fk.id_treinamento_fk?.treinamento || '',
                },
            };
        } catch (error: unknown) {
            console.error('Erro ao buscar dados do aluno:', error);

            if (error instanceof Error) {
                if (error.name === 'JsonWebTokenError') {
                    throw new BadRequestException('Token inválido');
                }

                if (error.name === 'TokenExpiredError') {
                    throw new BadRequestException('Token expirado');
                }
            }

            if (error instanceof BadRequestException || error instanceof NotFoundException) {
                throw error;
            }

            throw new BadRequestException('Erro ao buscar dados do aluno');
        }
    }

    /**
     * Preenche dados do aluno e realiza check-in
     */
    async preencherDadosAluno(token: string, dados: any): Promise<{ success: boolean; message: string }> {
        try {
            // Verificar e decodificar token
            const decoded = jwt.verify(token, this.jwtSecret) as { alunoTurmaId: string; turmaId: number; timestamp: number };

            if (!decoded.alunoTurmaId || !decoded.turmaId) {
                throw new BadRequestException('Token inválido');
            }

            // Buscar aluno na turma com todas as relações necessárias
            const alunoTurma = await this.uow.turmasAlunosRP.findOne({
                where: { id: decoded.alunoTurmaId },
                relations: ['id_aluno_fk', 'id_turma_fk', 'id_turma_fk.id_treinamento_fk', 'id_turma_fk.id_polo_fk'],
            });

            if (!alunoTurma || !alunoTurma.id_aluno_fk) {
                throw new NotFoundException('Aluno não encontrado na turma');
            }

            const aluno = alunoTurma.id_aluno_fk;
            const turma = alunoTurma.id_turma_fk;
            const treinamento = turma?.id_treinamento_fk;
            const polo = turma?.id_polo_fk;

            // Atualizar dados do aluno
            await this.uow.alunosRP.update(
                { id: aluno.id },
                {
                    nome: dados.nome || aluno.nome,
                    nome_cracha: dados.nome_cracha || aluno.nome_cracha,
                    email: dados.email || aluno.email,
                    cpf: dados.cpf || aluno.cpf,
                    telefone_um: dados.telefone_um || aluno.telefone_um,
                    telefone_dois: dados.telefone_dois || aluno.telefone_dois,
                    cep: dados.cep || aluno.cep,
                    logradouro: dados.logradouro || aluno.logradouro,
                    complemento: dados.complemento || aluno.complemento,
                    numero: dados.numero || aluno.numero,
                    bairro: dados.bairro || aluno.bairro,
                    cidade: dados.cidade || aluno.cidade,
                    estado: dados.estado || aluno.estado,
                    profissao: dados.profissao || aluno.profissao,
                    genero: dados.genero || aluno.genero,
                    data_nascimento: dados.data_nascimento || aluno.data_nascimento,
                    desc_deficiencia: dados.desc_deficiencia || aluno.desc_deficiencia,
                    url_foto_aluno: dados.url_foto_aluno || aluno.url_foto_aluno,
                    possui_deficiencia: dados.possui_deficiencia !== undefined ? dados.possui_deficiencia : aluno.possui_deficiencia,
                    atualizado_em: new Date(),
                },
            );

            // Atualizar status do check-in se ainda não foi realizado
            const statusAtualizado = alunoTurma.status_aluno_turma !== EStatusAlunosTurmas.CHECKIN_REALIZADO;
            if (statusAtualizado) {
                await this.uow.turmasAlunosRP.update(
                    { id: decoded.alunoTurmaId },
                    {
                        status_aluno_turma: EStatusAlunosTurmas.CHECKIN_REALIZADO,
                        atualizado_em: new Date(),
                    },
                );
            }

            // Obter telefone atualizado (priorizar dados do formulário)
            const telefoneAtualizado = dados.telefone_um || aluno.telefone_um;

            // Enviar QR Code via WhatsApp após finalizar formulário
            if (telefoneAtualizado && turma && treinamento) {
                try {
                    const qrCodeData = {
                        alunoTurmaId: alunoTurma.id,
                        alunoNome: dados.nome || aluno.nome || aluno.nome_cracha || 'Aluno',
                        alunoTelefone: telefoneAtualizado,
                        turmaId: turma.id,
                        treinamentoNome: treinamento?.treinamento || 'Treinamento não informado',
                        poloNome: polo?.polo || 'Polo não informado',
                        dataEvento: turma.data_inicio ? new Date(turma.data_inicio).toLocaleDateString('pt-BR') : 'Data não informada',
                    };

                    console.log('📱 [preencherDadosAluno] Enviando QR Code após finalizar formulário para:', qrCodeData.alunoNome);
                    console.log('📱 [preencherDadosAluno] Dados do QR Code:', JSON.stringify(qrCodeData, null, 2));

                    const resultadoQRCode = await this.sendQRCodeCredenciamento(qrCodeData);

                    if (resultadoQRCode.success) {
                        console.log('✅ QR Code enviado com sucesso para:', qrCodeData.alunoNome);
                    } else {
                        console.error('❌ Falha ao enviar QR Code:', resultadoQRCode.error);
                    }
                } catch (error) {
                    console.error('❌ Erro ao enviar QR Code (não interrompe o fluxo):', error);
                    // Não relançar o erro para não interromper o fluxo principal
                }
            } else {
                console.warn('⚠️ QR Code não enviado - dados faltando:', {
                    temTelefone: !!telefoneAtualizado,
                    temTurma: !!turma,
                    temTreinamento: !!treinamento,
                });
            }

            return {
                success: true,
                message: 'Dados salvos e check-in realizado com sucesso!',
            };
        } catch (error: unknown) {
            console.error('Erro ao preencher dados do aluno:', error);

            if (error instanceof Error) {
                if (error.name === 'JsonWebTokenError') {
                    throw new BadRequestException('Token inválido');
                }

                if (error.name === 'TokenExpiredError') {
                    throw new BadRequestException('Token expirado');
                }
            }

            if (error instanceof BadRequestException || error instanceof NotFoundException) {
                throw error;
            }

            throw new BadRequestException('Erro ao salvar dados do aluno');
        }
    }

    /**
     * Atualiza foto do aluno por token
     */
    async atualizarFotoAluno(token: string, urlFoto: string): Promise<any> {
        try {
            // Verificar e decodificar token
            const decoded = jwt.verify(token, this.jwtSecret) as { alunoTurmaId: string; turmaId: number; timestamp: number };

            if (!decoded.alunoTurmaId) {
                throw new BadRequestException('Token inválido');
            }

            // Buscar aluno na turma
            const alunoTurma = await this.uow.turmasAlunosRP.findOne({
                where: { id: decoded.alunoTurmaId },
                relations: ['id_aluno_fk'],
            });

            if (!alunoTurma || !alunoTurma.id_aluno_fk) {
                throw new NotFoundException('Aluno não encontrado na turma');
            }

            const aluno = alunoTurma.id_aluno_fk;

            // Atualizar foto
            await this.uow.alunosRP.update(
                { id: aluno.id },
                {
                    url_foto_aluno: urlFoto,
                    atualizado_em: new Date(),
                },
            );

            // Buscar aluno atualizado
            const alunoAtualizado = await this.uow.alunosRP.findOne({
                where: { id: aluno.id },
            });

            return alunoAtualizado;
        } catch (error: unknown) {
            console.error('Erro ao atualizar foto do aluno:', error);

            if (error instanceof Error) {
                if (error.name === 'JsonWebTokenError') {
                    throw new BadRequestException('Token inválido');
                }

                if (error.name === 'TokenExpiredError') {
                    throw new BadRequestException('Token expirado');
                }
            }

            if (error instanceof BadRequestException || error instanceof NotFoundException) {
                throw error;
            }

            throw new BadRequestException('Erro ao atualizar foto do aluno');
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
    /**
     * Envia QR code de credenciamento via WhatsApp após check-in
     */
    async sendQRCodeCredenciamento(data: SendQRCodeDto): Promise<{ success: boolean; message?: string; error?: string }> {
        try {
            if (!this.zApiToken || !this.zApiInstance) {
                console.log('❌ [sendQRCodeCredenciamento] Credenciais Z-API não configuradas');
                return {
                    success: false,
                    error: 'Credenciais da Z-API não configuradas. Verifique as variáveis de ambiente.',
                };
            }

            // Gerar dados do QR code
            const qrData = {
                id_turma_aluno: data.alunoTurmaId,
                aluno_nome: data.alunoNome,
                turma_id: data.turmaId,
                treinamento: data.treinamentoNome,
                polo: data.poloNome,
                data_evento: data.dataEvento,
                timestamp: new Date().toISOString(),
            };

            // Converter para string JSON para o QR code
            const qrCodeData = JSON.stringify(qrData);

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

            // Limpar telefone (remover caracteres não numéricos)
            const cleanPhone = data.alunoTelefone.replace(/\D/g, '');

            // Gerar mensagem de texto
            const message = this.generateQRCodeMessage(data.alunoNome, data.treinamentoNome);

            // Enviar mensagem de texto primeiro
            await this.sendMessage(cleanPhone, message);

            // Enviar QR code como imagem
            const imageResult = await this.sendImageMessage(cleanPhone, qrCodeImage, `QR Code - ${data.treinamentoNome} - ${data.alunoNome}`);

            console.log(`✅ QR code enviado para ${data.alunoNome} (${cleanPhone})`);
            return imageResult;
        } catch (error: any) {
            console.error('❌ Erro ao enviar QR code:', error);
            return {
                success: false,
                error: error.message || 'Erro interno ao enviar QR code',
            };
        }
    }

    /**
     * Envia imagem via WhatsApp usando Z-API
     */
    async sendImageMessage(phone: string, imageBase64: string, caption: string): Promise<{ success: boolean; message?: string; error?: string }> {
        try {
            const headers: any = {
                'Content-Type': 'application/json',
            };

            if (this.zApiClientToken) {
                headers['Client-Token'] = this.zApiClientToken;
            }

            const payload = {
                phone: phone,
                image: imageBase64,
                caption: caption,
            };

            console.log(`📱 Enviando imagem para: ${phone}`);

            const response = await axios.post(`${this.zApiUrl}/instances/${this.zApiInstance}/token/${this.zApiToken}/send-image`, payload, { headers });

            console.log('✅ Imagem enviada com sucesso:', response.data);
            return {
                success: true,
                message: 'Imagem enviada com sucesso',
            };
        } catch (error: any) {
            console.error('❌ Erro ao enviar imagem Z-API:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || error.message || 'Erro ao enviar imagem',
            };
        }
    }

    private generateQRCodeMessage(alunoNome: string, treinamentoNome: string): string {
        return `🎉 Parabéns ${alunoNome}!

✅ Seu check-in foi realizado com sucesso para o treinamento *${treinamentoNome}*!

📱 *SEU QR CODE DE CREDENCIAMENTO:*
(Imagem anexada abaixo)

💡 *Como usar:*
• Salve a imagem do QR code
• Use na próxima vez para credenciamento rápido
• Apresente na entrada do evento`;
    }

    private generateCheckInMessage(alunoNome: string, treinamentoNome: string, checkInUrl: string): string {
        return `Olá ${alunoNome}! 👋

Você está confirmado(a) para o treinamento *${treinamentoNome}*! 🎉

Para confirmar sua presença, clique no link abaixo:
${checkInUrl}

⚠️ *IMPORTANTE:* Clique no link apenas quando estiver presente no local do evento.

Nos vemos lá! 🚀`;
    }
}
