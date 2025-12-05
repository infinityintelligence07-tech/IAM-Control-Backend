import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { EStatusAlunosTurmas } from '@/modules/config/entities/enum';
import { ChatGuruService } from './chatguru/chatguru.service';
import * as jwt from 'jsonwebtoken';

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
    private readonly frontendUrl: string;
    private readonly jwtSecret: string;
    // UUID do template aprovado na Gupshup (Gupshup temp ID)
    // IMPORTANTE: A API da Gupshup funciona melhor com o UUID do template, não o nome!
    private readonly CHECKIN_TEMPLATE_ID_GUPSHUP = '8ebafac1-29e5-4d10-9ebc-03ae51126a80';
    private readonly CHECKIN_TEMPLATE_NAME: string;

    constructor(
        private readonly uow: UnitOfWorkService,
        private readonly chatGuruService: ChatGuruService,
    ) {
        this.frontendUrl = process.env.FRONTEND_URL || 'http://iamcontrol.com.br';
        this.jwtSecret = process.env.JWT_SECRET;
        // UUID do template na Gupshup - use GUPSHUP_TEMPLATE_NAME para sobrescrever
        this.CHECKIN_TEMPLATE_NAME = process.env.GUPSHUP_TEMPLATE_NAME || this.CHECKIN_TEMPLATE_ID_GUPSHUP;
    }

    /**
     * Envia mensagem via ChatGuru
     * Cria o chat com o nome do contato e telefone primário
     */
    async sendMessage(phone: string, message: string, contactName?: string): Promise<{ success: boolean; message?: string; error?: string }> {
        try {
            // Formatar número de telefone (remover caracteres especiais)
            let formattedPhone = phone.replace(/\D/g, '');

            // Adicionar código do país (55) se não estiver presente
            if (!formattedPhone.startsWith('55')) {
                formattedPhone = '55' + formattedPhone;
            }

            console.log(`📱 Enviando mensagem via ChatGuru para ${formattedPhone}${contactName ? ` (${contactName})` : ''}`);

            // Usa o método createChatAndSendMessage que cria o chat com o nome e envia a mensagem
            const result = await this.chatGuruService.createChatAndSendMessage(formattedPhone, message, contactName);

            if (result.success) {
                return {
                    success: true,
                    message: 'Mensagem enviada com sucesso',
                };
            } else {
                return {
                    success: false,
                    error: 'Falha ao enviar mensagem via ChatGuru',
                };
            }
        } catch (error: unknown) {
            console.error('Erro ao enviar mensagem via ChatGuru:', error);
            const errorMessage = error instanceof Error ? error.message : 'Erro interno ao enviar mensagem';
            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Envia mensagem de template via ChatGuru/Gupshup
     * Usa template aprovado para enviar para números desconhecidos
     */
    async sendTemplateMessage(
        phone: string,
        templateId: string,
        templateParams: string[],
        contactName?: string,
    ): Promise<{ success: boolean; message?: string; error?: string; warning?: string; messageId?: string; destination?: string }> {
        try {
            // Formatar número de telefone (remover caracteres especiais)
            let formattedPhone = phone.replace(/\D/g, '');

            // Adicionar código do país (55) se não estiver presente
            if (!formattedPhone.startsWith('55')) {
                formattedPhone = '55' + formattedPhone;
            }

            console.log(`\n${'═'.repeat(80)}`);
            console.log(`📱 WHATSAPP SERVICE - ENVIANDO TEMPLATE`);
            console.log(`${'═'.repeat(80)}`);
            console.log(`📱 Telefone original: ${phone}`);
            console.log(`📱 Telefone formatado: ${formattedPhone}`);
            console.log(`👤 Nome do contato: ${contactName || 'Não informado'}`);
            console.log(`📋 Template ID: ${templateId}`);
            console.log(`📝 Parâmetros: ${JSON.stringify(templateParams)}`);
            console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
            console.log(`${'═'.repeat(80)}\n`);

            // Usa o método createChatAndSendTemplate que cria o chat e envia o template
            const result = await this.chatGuruService.createChatAndSendTemplate(formattedPhone, templateId, templateParams, contactName);

            console.log(`\n${'─'.repeat(80)}`);
            console.log(`📤 RESULTADO DO ENVIO:`);
            console.log(`${'─'.repeat(80)}`);
            console.log(`✅ Sucesso: ${result.success}`);
            console.log(`🆔 Message ID: ${result.templateResult?.messageId || 'Não retornado'}`);
            console.log(`📱 Destinatário: ${result.templateResult?.destination || formattedPhone}`);
            console.log(`⚠️ Warning: ${result.warning || 'Nenhum'}`);
            console.log(`${'─'.repeat(80)}\n`);

            if (result.success) {
                return {
                    success: true,
                    message: 'Template enviado com sucesso',
                    warning: result.warning,
                    messageId: result.templateResult?.messageId,
                    destination: formattedPhone,
                };
            } else {
                return {
                    success: false,
                    error: 'Falha ao enviar template via ChatGuru',
                };
            }
        } catch (error: unknown) {
            console.error(`\n${'X'.repeat(80)}`);
            console.error(`❌ ERRO AO ENVIAR TEMPLATE VIA WHATSAPP SERVICE`);
            console.error(`${'X'.repeat(80)}`);
            console.error(`📱 Telefone: ${phone}`);
            console.error(`📋 Template ID: ${templateId}`);
            console.error(`📄 Erro:`, error);
            console.error(`${'X'.repeat(80)}\n`);
            
            const errorMessage = error instanceof Error ? error.message : 'Erro interno ao enviar template';
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
                    relations: ['id_aluno_fk', 'id_turma_fk', 'id_turma_fk.id_polo_fk'],
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

                // Obter dados da turma para local e data
                const turma = alunoTurma.id_turma_fk;
                const poloNome = turma?.id_polo_fk?.polo || '';
                const dataEvento = turma?.data_inicio
                    ? new Date(turma.data_inicio).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                      })
                    : '';

                // Preparar parâmetros do template
                // Template espera: {{1}} = nome, {{2}} = treinamento, {{3}} = local, {{4}} = link
                const templateParams = [
                    student.alunoNome, // {{1}}
                    student.treinamentoNome, // {{2}}
                    poloNome && dataEvento ? `${poloNome} em ${dataEvento}` : poloNome || dataEvento || 'local e data a confirmar', // {{3}}
                    checkInUrl, // {{4}}
                ];

                // Enviar template em vez de mensagem livre
                const phone = alunoTurma.id_aluno_fk.telefone_um;
                const alunoNome = alunoTurma.id_aluno_fk.nome || student.alunoNome;
                
                // Usa o UUID do template diretamente (formato mais confiável para Gupshup)
                const templateId = this.CHECKIN_TEMPLATE_NAME;
                console.log(`📋 Usando template UUID: ${templateId}`);
                const sendResult = await this.sendTemplateMessage(phone, templateId, templateParams, alunoNome);
                
                if (sendResult.success) {
                    console.log(`✅ Template enviado para ${alunoNome} (${phone})`);
                    if (sendResult.warning) {
                        console.log(`⚠️ Aviso: ${sendResult.warning}`);
                    }
                }

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
     * Testa conectividade com ChatGuru
     */
    async testZApiConnection(): Promise<{ success: boolean; message: string; details?: any }> {
        try {
            console.log('🔍 Testando conectividade ChatGuru...');

            // Tenta criar um chat de teste (não envia mensagem, apenas testa a conexão)
            // Usa um número de teste que não será usado
            const testPhone = '5511999999999';
            const testResult = await this.chatGuruService.createChat(testPhone, 'Teste de conexão');

            return {
                success: true,
                message: 'Conectividade ChatGuru OK',
                details: testResult,
            };
        } catch (error: any) {
            console.error('❌ Erro ao testar ChatGuru:', error.message);
            return {
                success: false,
                message: 'Erro de conectividade ChatGuru',
                details: error.message,
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

            // Limpar telefone (remover caracteres não numéricos)
            let cleanPhone = data.alunoTelefone.replace(/\D/g, '');

            // Adicionar código do país (55) se não estiver presente
            if (!cleanPhone.startsWith('55')) {
                cleanPhone = '55' + cleanPhone;
            }

            // Gerar mensagem de texto
            const message = this.generateQRCodeMessage(data.alunoNome, data.treinamentoNome);

            console.log(`📱 Enviando QR code para ${data.alunoNome} (${cleanPhone}) via ChatGuru`);

            // Usa o método que cria chat, envia mensagem e QR code
            const result = await this.chatGuruService.createChatAndSendMessageWithQRCode(
                cleanPhone,
                message,
                qrData,
                data.alunoNome, // Nome do contato
            );

            if (result.success && result.qrCodeSent) {
                console.log(`✅ QR code enviado para ${data.alunoNome} (${cleanPhone})`);
                return {
                    success: true,
                    message: 'QR code enviado com sucesso',
                };
            } else if (result.success && !result.qrCodeSent) {
                console.warn(`⚠️ Mensagem enviada mas QR code falhou para ${data.alunoNome}`);
                return {
                    success: true,
                    message: 'Mensagem enviada, mas QR code não pôde ser enviado',
                    error: result.warning,
                };
            } else {
                return {
                    success: false,
                    error: 'Falha ao enviar QR code',
                };
            }
        } catch (error: any) {
            console.error('❌ Erro ao enviar QR code:', error);
            return {
                success: false,
                error: error.message || 'Erro interno ao enviar QR code',
            };
        }
    }

    /**
     * Envia imagem via WhatsApp usando ChatGuru
     */
    async sendImageMessage(
        phone: string,
        imageBase64: string,
        caption: string,
        contactName?: string,
    ): Promise<{ success: boolean; message?: string; error?: string }> {
        try {
            // Formatar número de telefone (remover caracteres especiais)
            let formattedPhone = phone.replace(/\D/g, '');

            // Adicionar código do país (55) se não estiver presente
            if (!formattedPhone.startsWith('55')) {
                formattedPhone = '55' + formattedPhone;
            }

            console.log(`📱 Enviando imagem para: ${formattedPhone}${contactName ? ` (${contactName})` : ''}`);

            // Primeiro cria o chat se necessário, depois envia a imagem
            await this.chatGuruService.createChat(formattedPhone, contactName);

            const result = await this.chatGuruService.sendImage(formattedPhone, imageBase64, caption);

            console.log('✅ Imagem enviada com sucesso');
            return {
                success: true,
                message: 'Imagem enviada com sucesso',
            };
        } catch (error: any) {
            console.error('❌ Erro ao enviar imagem ChatGuru:', error.message);
            return {
                success: false,
                error: error.message || 'Erro ao enviar imagem',
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

//     private generateCheckInMessage(alunoNome: string, treinamentoNome: string, checkInUrl: string, local?: string, data?: string): string {
//         const localEData = local && data ? `${local} em ${data}` : local || data || 'local e data a confirmar';

//         return `Olá ${alunoNome}, parabéns por dizer SIM a essa jornada transformadora! ✨

// Você garantiu o seu lugar no ${treinamentoNome} em ${localEData} e estamos muito animados pra te receber! 🤩

// Um novo tempo se inicia na sua vida. Permita-se viver tudo o que Deus preparou pra você nesses três dias! 🙌

// Para confirmar sua presença, é só clicar no link abaixo, preencher as informações e salvar.

// ${checkInUrl}

// Assim que finalizar, sua presença será confirmada automaticamente.

// Confirme agora mesmo, para não correr o risco de esquecer ou perder o prazo.

// Vamos Prosperar! 🙌`;
//     }
}
