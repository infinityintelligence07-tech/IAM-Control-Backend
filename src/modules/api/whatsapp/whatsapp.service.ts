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
    // UUID do template de check-in aprovado na Gupshup
    private readonly CHECKIN_TEMPLATE_ID_GUPSHUP = '8ebafac1-29e5-4d10-9ebc-03ae51126a80';
    private readonly CHECKIN_TEMPLATE_NAME: string;
    
    // UUID do template de QR Code aprovado na Gupshup (template com imagem)
    // Parâmetros: {{1}} = nome do aluno, {{2}} = nome do treinamento
    private readonly QRCODE_TEMPLATE_ID_GUPSHUP = '34dd38bb-6594-4ccd-9537-42e8720d29b0';
    // Facebook Template ID (pode funcionar melhor que o UUID)
    private readonly QRCODE_TEMPLATE_ID_FACEBOOK = '1187423773526893';
    private readonly QRCODE_TEMPLATE_NAME: string;

    constructor(
        private readonly uow: UnitOfWorkService,
        private readonly chatGuruService: ChatGuruService,
    ) {
        this.frontendUrl = process.env.FRONTEND_URL || 'http://iamcontrol.com.br';
        this.jwtSecret = process.env.JWT_SECRET;
        // UUID do template de check-in na Gupshup
        this.CHECKIN_TEMPLATE_NAME = process.env.GUPSHUP_TEMPLATE_NAME || this.CHECKIN_TEMPLATE_ID_GUPSHUP;
        // UUID do template de QR Code na Gupshup
        this.QRCODE_TEMPLATE_NAME = process.env.GUPSHUP_QRCODE_TEMPLATE_NAME || this.QRCODE_TEMPLATE_ID_GUPSHUP;
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

            console.log(`📱 [Z-API] Enviando mensagem via ChatGuru para ${formattedPhone}${contactName ? ` (${contactName})` : ''}`);

            // Usa o método createChatAndSendMessage que cria o chat com o nome e envia a mensagem
            let phoneToUse = formattedPhone;
            try {
                const result = await this.chatGuruService.createChatAndSendMessage(phoneToUse, message, contactName);

                if (result.success) {
                    console.log(`✅ [Z-API] Mensagem enviada com sucesso via ChatGuru`);
                    return {
                        success: true,
                        message: 'Mensagem enviada com sucesso via Z-API',
                    };
                } else {
                    const errorMsg = result.error || result.warning || 'Falha ao enviar mensagem via ChatGuru';
                    console.warn(`⚠️ [Z-API] Falha ao enviar mensagem: ${errorMsg}`);
                    
                    // Se for erro de chat não encontrado, tenta com número alternado
                    if (this.isChatNotFoundError({ message: errorMsg })) {
                        const alternatePhone = this.tryAlternatePhoneNumber(phoneToUse);
                        if (alternatePhone && alternatePhone !== phoneToUse) {
                            console.log(`🔄 [Z-API] Tentando enviar mensagem com número alternado: ${alternatePhone}`);
                            try {
                                const retryResult = await this.chatGuruService.createChatAndSendMessage(alternatePhone, message, contactName);
                                if (retryResult.success) {
                                    console.log(`✅ [Z-API] Mensagem enviada com sucesso usando número alternado ${alternatePhone}`);
                                    return {
                                        success: true,
                                        message: 'Mensagem enviada com sucesso via Z-API (número alternado)',
                                    };
                                }
                            } catch (retryError: any) {
                                console.error(`❌ [Z-API] Também falhou com número alternado: ${retryError.message}`);
                            }
                        }
                    }
                    
                    return {
                        success: false,
                        error: errorMsg,
                    };
                }
            } catch (serviceError: any) {
                console.error(`❌ [Z-API] Erro no serviço ChatGuru: ${serviceError.message}`);
                console.error(`   Stack: ${serviceError.stack}`);
                
                // Se for erro de chat não encontrado, tenta com número alternado
                if (this.isChatNotFoundError(serviceError)) {
                    const alternatePhone = this.tryAlternatePhoneNumber(phoneToUse);
                    if (alternatePhone && alternatePhone !== phoneToUse) {
                        console.log(`🔄 [Z-API] Tentando enviar mensagem com número alternado: ${alternatePhone}`);
                        try {
                            const retryResult = await this.chatGuruService.createChatAndSendMessage(alternatePhone, message, contactName);
                            if (retryResult.success) {
                                console.log(`✅ [Z-API] Mensagem enviada com sucesso usando número alternado ${alternatePhone}`);
                                return {
                                    success: true,
                                    message: 'Mensagem enviada com sucesso via Z-API (número alternado)',
                                };
                            }
                        } catch (retryError: any) {
                            console.error(`❌ [Z-API] Também falhou com número alternado: ${retryError.message}`);
                        }
                    }
                }
                
                return {
                    success: false,
                    error: serviceError.message || 'Erro ao enviar mensagem via Z-API',
                };
            }
        } catch (error: unknown) {
            console.error(`❌ [Z-API] Erro geral ao enviar mensagem via ChatGuru:`, error);
            const errorMessage = error instanceof Error ? error.message : 'Erro interno ao enviar mensagem via Z-API';
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

            // Usa o método createChatAndSendTemplate que cria o chat e envia o template
            const result = await this.chatGuruService.createChatAndSendTemplate(formattedPhone, templateId, templateParams, contactName);
            

            if (result.success) {
                const messageId = result.templateResult?.messageId || 
                                 result.templateResult?.result?.messageId ||
                                 result.templateResult?.messageId;
                
                return {
                    success: true,
                    message: 'Template enviado com sucesso',
                    warning: result.warning,
                    messageId: messageId,
                    destination: formattedPhone,
                };
            } else {
                const errorMsg = result.templateResult?.error || 
                               result.templateResult?.result?.error ||
                               result.templateResult?.result?.message ||
                               'Falha ao enviar template via ChatGuru';
                return {
                    success: false,
                    error: errorMsg,
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
                
                // IMPORTANTE: Tenta múltiplos formatos de template ID para garantir entrega
                // Ordem de tentativas (do mais específico para o mais genérico):
                // 1. Nome do template se configurado via env
                // 2. UUID do template (Gupshup)
                // 3. Nome padrão do template
                
                let sendResult: any = { success: false };
                
                // Tentativa 1: Nome do template se estiver configurado via env e for diferente do UUID
                const checkinTemplateNameFromEnv = process.env.GUPSHUP_TEMPLATE_NAME;
                if (checkinTemplateNameFromEnv && checkinTemplateNameFromEnv !== this.CHECKIN_TEMPLATE_ID_GUPSHUP) {
                    console.log(`📋 Tentativa 1: Usando nome do template da variável de ambiente: ${checkinTemplateNameFromEnv}`);
                    sendResult = await this.sendTemplateMessage(phone, checkinTemplateNameFromEnv, templateParams, alunoNome);
                }
                
                // Tentativa 2: UUID do template (Gupshup)
                if (!sendResult.success) {
                    console.log(`📋 Tentativa 2: Usando UUID do template: ${this.CHECKIN_TEMPLATE_NAME}`);
                    sendResult = await this.sendTemplateMessage(phone, this.CHECKIN_TEMPLATE_NAME, templateParams, alunoNome);
                }
                
                // Tentativa 3: Nome padrão do template (se conhecido)
                // NOTA: Substitua 'link_checkin' pelo nome real do template na Gupshup
                if (!sendResult.success) {
                    console.log(`📋 Tentativa 3: Usando nome padrão do template: link_checkin`);
                    sendResult = await this.sendTemplateMessage(phone, 'link_checkin', templateParams, alunoNome);
                }
               
                if (sendResult.success) {
                    
                    // Monta a mensagem de texto com o link de check-in
                    const checkInMessage = `Olá ${student.alunoNome}, parabéns por dizer SIM a essa jornada transformadora! ✨

Você garantiu o seu lugar no ${student.treinamentoNome}${poloNome && dataEvento ? ` em ${poloNome} em ${dataEvento}` : ''} e estamos muito animados pra te receber! 🤩

Um novo tempo se inicia na sua vida. Permita-se viver tudo o que Deus preparou pra você nesses três dias! 🙌

Para confirmar sua presença, é só clicar no link abaixo, preencher as informações e salvar.

${checkInUrl}

Assim que finalizar, sua presença será confirmada automaticamente.

Confirme agora mesmo, para não correr o risco de esquecer ou perder o prazo.

Vamos Prosperar! 🙌`;
                    
                    let redundancySuccess = false;
                    let redundancyError: string | undefined;
                    
                    try {
                        // Aguarda um pequeno delay antes de enviar a redundância
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        // Envia a mensagem de texto via ChatGuru (Z-API) como redundância
                        const redundancyResult = await this.sendMessage(phone, checkInMessage, alunoNome);
                        
                        if (redundancyResult.success) {
                            redundancySuccess = true;
                            console.log(`✅ Redundância enviada com sucesso via ChatGuru (Z-API)`);
                            console.log(`   A mensagem agora está no histórico do ChatGuru`);
                        } else {
                            redundancyError = redundancyResult.error;
                            console.warn(`⚠️ Redundância via ChatGuru falhou: ${redundancyError}`);
                            console.warn(`   O template via Gupshup foi enviado, mas a redundância falhou`);
                            console.warn(`   Verifique os logs acima para mais detalhes sobre o erro`);
                        }
                    } catch (redundancyErrorException: any) {
                        redundancyError = redundancyErrorException.message;
                        console.error(`❌ Exceção ao enviar redundância via ChatGuru: ${redundancyError}`);
                        console.error(`   Stack: ${redundancyErrorException.stack}`);
                        console.warn(`   O template via Gupshup foi enviado, mas a redundância falhou`);
                    }
                    
                } else {
                    console.error(`❌ Falha ao enviar template de check-in para ${alunoNome} (${phone})`);
                    console.error(`📄 Erro: ${sendResult.error || 'Erro desconhecido'}`);
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
     * IMPORTANTE: SEMPRE usa TEMPLATE aprovado na Gupshup (via ChatGuru)
     * NUNCA envia como mensagem livre para evitar erro 470 (janela de 24h)
     * 
     * Template: confirmacao_checkin_qrcode (ID: 34dd38bb-6594-4ccd-9537-42e8720d29b0)
     * Parâmetros: {{1}} = nome do aluno, {{2}} = nome do treinamento
     */
    async sendQRCodeCredenciamento(data: SendQRCodeDto): Promise<{ success: boolean; message?: string; error?: string; messageId?: string; redundancySent?: boolean }> {
        try {
            // Gerar dados do QR code para a imagem
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

            console.log(`\n${'═'.repeat(80)}`);
            console.log(`📱 ENVIANDO QR CODE VIA TEMPLATE GUPSHUP (CHATGURU)`);
            console.log(`⚠️ IMPORTANTE: Usando TEMPLATE aprovado (não mensagem livre)`);
            console.log(`${'═'.repeat(80)}`);
            console.log(`👤 Aluno: ${data.alunoNome}`);
            console.log(`📞 Telefone: ${cleanPhone}`);
            console.log(`📚 Treinamento: ${data.treinamentoNome}`);
            console.log(`📋 Template ID: ${this.QRCODE_TEMPLATE_NAME}`);
            console.log(`${'═'.repeat(80)}\n`);

            // Gerar imagem do QR Code
            const qrCodeImage = await this.chatGuruService.generateQRCode(qrData);
            
            // Faz upload da imagem para obter URL pública
            console.log(`🔲 Fazendo upload da imagem do QR Code...`);
            const qrCodeUrl = await this.chatGuruService.uploadImageForTemplate(qrCodeImage);
            console.log(`✅ Imagem hospedada em: ${qrCodeUrl}`);

            // Parâmetros do template conforme aprovado na Gupshup:
            // {{1}} = nome do aluno
            // {{2}} = nome do treinamento
            const templateParams = [
                data.alunoNome,           // {{1}}
                data.treinamentoNome,     // {{2}}
            ];

            console.log(`📤 Enviando template com QR Code via Gupshup...`);
            console.log(`📝 Parâmetros: ${JSON.stringify(templateParams)}`);
            console.log(`⚠️ NUNCA usar mensagem livre - sempre usar template aprovado`);

            // IMPORTANTE: Sempre usa template, nunca mensagem livre
            // Ordem de tentativas (priorizando nome do template, que geralmente funciona melhor):
            // 1. Nome do template (se configurado via env) - MAIS CONFIÁVEL
            // 2. Nome padrão do template - SEGUNDA OPÇÃO MAIS CONFIÁVEL
            // 3. Facebook Template ID
            // 4. Gupshup UUID (menos confiável)
            
            let templateResult: any = { success: false };
            const templateNameFromEnv = process.env.GUPSHUP_QRCODE_TEMPLATE_NAME;
            
            // Tentativa 1: Nome do template se estiver configurado via env
            if (templateNameFromEnv && templateNameFromEnv !== this.QRCODE_TEMPLATE_ID_GUPSHUP) {
                console.log(`📋 Tentativa 1: Usando nome do template da variável de ambiente: ${templateNameFromEnv}`);
                templateResult = await this.chatGuruService.sendTemplateWithImage(
                    cleanPhone,
                    templateNameFromEnv,
                    templateParams,
                    qrCodeUrl,
                    data.alunoNome,
                );
            }

            // Tentativa 2: Nome padrão do template (geralmente mais confiável que IDs)
            if (!templateResult.success) {
                console.log(`📋 Tentativa 2: Usando nome padrão do template: confirmacao_checkin_qrcode`);
                console.log(`   NOTA: Nomes de template geralmente funcionam melhor que IDs`);
                templateResult = await this.chatGuruService.sendTemplateWithImage(
                    cleanPhone,
                    'confirmacao_checkin_qrcode', // Nome do template conforme aprovado
                    templateParams,
                    qrCodeUrl,
                    data.alunoNome,
                );
            }

            // Tentativa 3: Facebook Template ID
            if (!templateResult.success) {
                console.log(`📋 Tentativa 3: Usando Facebook Template ID: ${this.QRCODE_TEMPLATE_ID_FACEBOOK}`);
                console.log(`   NOTA: Se esta tentativa falhar, o template pode não estar aprovado no WhatsApp`);
                templateResult = await this.chatGuruService.sendTemplateWithImage(
                    cleanPhone,
                    this.QRCODE_TEMPLATE_ID_FACEBOOK,
                    templateParams,
                    qrCodeUrl,
                    data.alunoNome,
                );
            }

            // Tentativa 4: Gupshup UUID (última opção)
            if (!templateResult.success) {
                console.log(`📋 Tentativa 4: Usando Gupshup UUID: ${this.QRCODE_TEMPLATE_NAME}`);
                console.log(`   NOTA: UUIDs podem não funcionar se o template não estiver totalmente propagado`);
                templateResult = await this.chatGuruService.sendTemplateWithImage(
                    cleanPhone,
                    this.QRCODE_TEMPLATE_NAME,
                    templateParams,
                    qrCodeUrl,
                    data.alunoNome,
                );
            }

            if (templateResult.success) {
                const messageId = templateResult.messageId || templateResult.result?.messageId || 'N/A';
                // Identifica qual template foi usado com sucesso
                let templateUsed = 'N/A';
                if (templateResult.templateId) {
                    templateUsed = templateResult.templateId;
                } else {
                    // Identifica qual tentativa funcionou baseado na ordem
                    if (templateNameFromEnv && templateNameFromEnv !== this.QRCODE_TEMPLATE_ID_GUPSHUP) {
                        templateUsed = templateNameFromEnv;
                    } else {
                        templateUsed = this.QRCODE_TEMPLATE_NAME;
                    }
                }
                
                console.log(`✅ Template QR Code enviado com sucesso para ${data.alunoNome} (${cleanPhone})`);
                console.log(`🆔 Message ID: ${messageId}`);
                console.log(`📋 Template usado: ${templateUsed}`);
                
                // Verifica se há informações adicionais no resultado
                if (templateResult.result) {
                    const templateResultData = templateResult.result;
                    if (typeof templateResultData === 'object') {
                        console.log(`📊 Status Gupshup: ${templateResultData.status || 'N/A'}`);
                        if (templateResultData.status === 'submitted') {
                            console.log(`\n⚠️ IMPORTANTE: Status "submitted" significa que a Gupshup ACEITOU a mensagem.`);
                            console.log(`   Isso NÃO garante que o WhatsApp entregará a mensagem.`);
                            console.log(`   O WhatsApp pode rejeitar se:`);
                            console.log(`   - O template não estiver aprovado no WhatsApp`);
                            console.log(`   - O template foi rejeitado pelo WhatsApp`);
                            console.log(`   - O número do destinatário estiver bloqueado`);
                            console.log(`   - A conta WhatsApp Business tiver problemas`);
                            console.log(`\n   Verifique o status real no painel da Gupshup usando o Message ID.`);
                        }
                    }
                }
                
                console.log(`\n⚠️ IMPORTANTE: Se a mensagem não chegar:`);
                console.log(`   1. Verifique no painel Gupshup o status do Message ID: ${messageId}`);
                console.log(`   2. Templates podem levar até 48h para propagar completamente no WhatsApp`);
                console.log(`   3. Verifique a qualidade da conta no Meta Business Manager`);
                console.log(`   4. Certifique-se de que o template está aprovado na Gupshup`);
                console.log(`   5. Verifique se o template está aprovado no WhatsApp (não apenas na Gupshup)`);
                console.log(`\n🔍 DIAGNÓSTICO: Se o template foi aceito (submitted) mas não entregue:`);
                console.log(`   - O template pode estar aprovado na Gupshup mas REJEITADO pelo WhatsApp`);
                console.log(`   - Verifique no Meta Business Manager se o template está realmente aprovado`);
                console.log(`   - Tente usar o NOME do template ao invés do ID (configure GUPSHUP_QRCODE_TEMPLATE_NAME)`);
                console.log(`   - O nome do template geralmente funciona melhor que IDs numéricos ou UUIDs`);
                console.log(`   - Verifique se o template não foi desaprovado recentemente pelo WhatsApp\n`);
                
                // ENVIO REDUNDANTE VIA Z-API (ChatGuru) para garantir entrega e histórico
                // IMPORTANTE: Envia como mensagem livre (não template) mas com o mesmo layout do template
                console.log(`\n${'═'.repeat(80)}`);
                console.log(`🔄 ENVIANDO REDUNDÂNCIA VIA Z-API (CHATGURU)`);
                console.log(`⚠️ IMPORTANTE: Enviando como MENSAGEM LIVRE (não template) com layout do template`);
                console.log(`${'═'.repeat(80)}`);
                console.log(`📱 Enviando QR Code via ChatGuru (Z-API) como mensagem livre...`);
                console.log(`📞 Telefone: ${cleanPhone}`);
                console.log(`👤 Contato: ${data.alunoNome}`);
                
                let redundancySuccess = false;
                let redundancyError: string | undefined;
                
                try {
                    // Aguarda um pequeno delay antes de enviar a redundância
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Gera mensagem no formato do template para enviar antes da imagem
                    const qrCodeMessage = this.generateQRCodeMessage(data.alunoNome, data.treinamentoNome);
                    
                    // Envia a imagem do QR Code via ChatGuru (Z-API) como redundância
                    // Passa a mensagem do template para ser enviada antes da imagem
                    const redundancyResult = await this.sendImageMessage(
                        cleanPhone,
                        qrCodeImage,
                        `QR Code de Credenciamento - ${data.treinamentoNome}`,
                        data.alunoNome,
                        qrCodeMessage, // Mensagem no formato do template
                    );
                    
                    if (redundancyResult.success) {
                        redundancySuccess = true;
                        console.log(`✅ Redundância enviada com sucesso via ChatGuru (Z-API)`);
                        console.log(`   A mensagem agora está no histórico do ChatGuru`);
                    } else {
                        redundancyError = redundancyResult.error;
                        console.warn(`⚠️ Redundância via ChatGuru falhou: ${redundancyError}`);
                        console.warn(`   O template via Gupshup foi enviado, mas a redundância falhou`);
                        console.warn(`   Verifique os logs acima para mais detalhes sobre o erro`);
                    }
                } catch (redundancyErrorException: any) {
                    redundancyError = redundancyErrorException.message;
                    console.error(`❌ Exceção ao enviar redundância via ChatGuru: ${redundancyError}`);
                    console.error(`   Stack: ${redundancyErrorException.stack}`);
                    console.warn(`   O template via Gupshup foi enviado, mas a redundância falhou`);
                }
                
                console.log(`${'═'.repeat(80)}`);
                console.log(`📊 RESUMO DA REDUNDÂNCIA:`);
                console.log(`   ✅ Template Gupshup: Enviado (Message ID: ${messageId})`);
                console.log(`   ${redundancySuccess ? '✅' : '❌'} Redundância Z-API: ${redundancySuccess ? 'Enviado' : 'Falhou'}`);
                if (redundancyError) {
                    console.log(`   📄 Erro: ${redundancyError}`);
                }
                console.log(`${'═'.repeat(80)}\n`);
                
                return {
                    success: true,
                    message: `QR code enviado com sucesso via template aprovado. Message ID: ${messageId}`,
                    messageId: messageId,
                    redundancySent: redundancySuccess,
                };
            }

            // Se todas as tentativas de template falharam, retorna erro
            // NUNCA tenta enviar como mensagem livre (evita erro 470)
            const errorMessage = templateResult.error || 
                               templateResult.result?.error ||
                               templateResult.result?.message ||
                               'Falha ao enviar QR code via template';
            
            console.error(`\n${'X'.repeat(80)}`);
            console.error(`❌ FALHA AO ENVIAR QR CODE VIA TEMPLATE`);
            console.error(`${'X'.repeat(80)}`);
            console.error(`📱 Destinatário: ${cleanPhone} (${data.alunoNome})`);
            console.error(`📋 Template ID Gupshup: ${this.QRCODE_TEMPLATE_NAME}`);
            console.error(`📋 Template ID Facebook: ${this.QRCODE_TEMPLATE_ID_FACEBOOK}`);
            console.error(`📄 Erro: ${errorMessage}`);
            console.error(`\n🔍 POSSÍVEIS CAUSAS:`);
            console.error(`   1. Template não está aprovado na Gupshup`);
            console.error(`   2. Template foi rejeitado pelo WhatsApp (mesmo aprovado na Gupshup)`);
            console.error(`   3. Template ID incorreto ou formato inválido`);
            console.error(`   4. Credenciais da Gupshup incorretas ou sem permissão`);
            console.error(`   5. Número do destinatário inválido ou formato incorreto`);
            console.error(`   6. Conta WhatsApp Business não está ativa ou suspensa`);
            console.error(`\n✅ AÇÃO: NÃO foi tentado envio como mensagem livre (evita erro 470)`);
            console.error(`   Verifique o template no painel da Gupshup e certifique-se de que está aprovado`);
            console.error(`   Use o mesmo template que funcionou para o check-in como referência\n`);
            console.error(`${'X'.repeat(80)}\n`);
            
            return {
                success: false,
                error: errorMessage,
            };
        } catch (error: any) {
            console.error('❌ Erro ao enviar QR code:', error);
            console.error('⚠️ Erro ocorreu ao tentar enviar via TEMPLATE (não mensagem livre)');
            return {
                success: false,
                error: error.message || 'Erro interno ao enviar QR code via template',
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
        templateMessage?: string,
    ): Promise<{ success: boolean; message?: string; error?: string }> {
        try {
            // Formatar número de telefone (remover caracteres especiais)
            let formattedPhone = phone.replace(/\D/g, '');

            // Adicionar código do país (55) se não estiver presente
            if (!formattedPhone.startsWith('55')) {
                formattedPhone = '55' + formattedPhone;
            }

            console.log(`📱 [Z-API] Enviando imagem para: ${formattedPhone}${contactName ? ` (${contactName})` : ''}`);

            // IMPORTANTE: Para Z-API funcionar, precisamos garantir que o chat existe e está ativo
            // Estratégia: Enviar uma mensagem de texto primeiro para ativar o chat, depois a imagem
            console.log(`📱 [Z-API] Garantindo que o chat está ativo antes de enviar imagem...`);
            
            let chatActive = false;
            let activationMessageId: string | undefined;
            let phoneToUse = formattedPhone; // Número que será usado (pode ser alternado)
            
            try {
                // Envia mensagem de texto no mesmo formato do template para ativar o chat
                // Isso garante que o chat existe e está na janela de 24h
                // Usa o mesmo layout do template para manter consistência
                const messageToSend = templateMessage || `📱 QR Code de Credenciamento`;
                
                try {
                    console.log(`📤 [Z-API] Enviando mensagem no formato do template para ativar chat...`);
                    console.log(`📝 [Z-API] Mensagem (primeiros 100 chars): ${messageToSend.substring(0, 100)}...`);
                    const msgResult = await this.chatGuruService.sendMessage(phoneToUse, messageToSend);
                    
                    // Log completo do resultado
                    console.log(`📥 [Z-API] Resultado da mensagem de ativação:`, JSON.stringify(msgResult, null, 2));
                    
                    // Verifica múltiplos formatos de resposta de sucesso
                    const isSuccess = msgResult && (
                        msgResult.result === 'success' ||
                        (typeof msgResult === 'object' && 'result' in msgResult && msgResult.result === 'success')
                    );
                    
                    if (isSuccess) {
                        chatActive = true;
                        activationMessageId = msgResult?.messageId || msgResult?.id;
                        console.log(`✅ [Z-API] Chat ativado com mensagem no formato do template`);
                        console.log(`   🆔 Message ID da ativação: ${activationMessageId || 'N/A'}`);
                        // Aguarda um pouco antes de enviar a imagem
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    } else {
                        console.warn(`⚠️ [Z-API] Mensagem de ativação não retornou sucesso, mas continuando...`);
                        console.warn(`   Resultado: ${JSON.stringify(msgResult)}`);
                    }
                } catch (msgError: any) {
                    const errorMsg = msgError?.message?.toLowerCase() || '';
                    // Se for erro 470 (janela de 24h), não é crítico - ainda podemos tentar enviar a imagem
                    if (errorMsg.includes('470') || errorMsg.includes('24 horas') || errorMsg.includes('re-engagement')) {
                        console.warn(`⚠️ [Z-API] Mensagem de ativação falhou (janela de 24h), mas tentando enviar imagem mesmo assim...`);
                    } else {
                        // Se falhar por outro motivo, tenta criar o chat diretamente
                        console.warn(`⚠️ [Z-API] Não foi possível ativar chat com mensagem (${msgError.message}), tentando criar chat...`);
                        try {
                            const chatResult = await this.chatGuruService.createChat(formattedPhone, contactName, messageToSend);
                            if (chatResult?.result === 'success' || chatResult?.chatId) {
                                chatActive = true;
                                console.log(`✅ [Z-API] Chat criado com sucesso`);
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        } catch (chatError: any) {
                            const chatErrorMsg = chatError?.message?.toLowerCase() || '';
                            if (chatErrorMsg.includes('já existe') || chatErrorMsg.includes('already exists') || 
                                chatErrorMsg.includes('mensagem inicial inválida')) {
                                console.log(`📱 [Z-API] Chat já existe ou erro não crítico, continuando...`);
                                chatActive = true;
                                await new Promise(resolve => setTimeout(resolve, 500));
                            } else {
                                console.warn(`⚠️ [Z-API] Não foi possível criar/ativar chat: ${chatError.message}`);
                                console.warn(`   Tentando enviar imagem mesmo assim (pode funcionar se o chat já existir)...`);
                            }
                        }
                    }
                }
            } catch (error: any) {
                console.warn(`⚠️ [Z-API] Erro ao ativar chat: ${error.message}, mas continuando com envio da imagem...`);
            }

            // Envia a imagem (esta é a parte crítica)
            try {
                console.log(`📤 [Z-API] Iniciando envio da imagem com número: ${phoneToUse}...`);
                const result = await this.chatGuruService.sendImage(phoneToUse, imageBase64, caption);
                
                // Log completo do resultado para diagnóstico
                console.log(`📥 [Z-API] Resultado completo do envio:`, JSON.stringify(result, null, 2));
                
                // Verifica se o resultado indica sucesso (múltiplos formatos possíveis)
                const isSuccess = result && (
                    result.success === true || 
                    result.result === 'success' || 
                    result.result?.result === 'success' ||
                    (typeof result === 'object' && result.result === 'success')
                );
                
                if (isSuccess) {
                    console.log(`\n${'═'.repeat(80)}`);
                    console.log(`✅ [Z-API] IMAGEM ENVIADA COM SUCESSO VIA CHATGURU`);
                    console.log(`${'═'.repeat(80)}`);
                    console.log(`   📊 Status do chat: ${chatActive ? '✅ Ativado' : '⚠️ Não ativado (mas imagem enviada)'}`);
                    console.log(`   📱 Telefone usado: ${phoneToUse}${phoneToUse !== formattedPhone ? ` (alternado de ${formattedPhone})` : ''}`);
                    console.log(`   👤 Contato: ${contactName || 'Não informado'}`);
                    console.log(`   🆔 Message ID ativação: ${activationMessageId || 'N/A'}`);
                    console.log(`   📋 Resultado completo:`, JSON.stringify(result, null, 2));
                    console.log(`\n⚠️ IMPORTANTE: Se a mensagem não chegar ao destinatário:`);
                    console.log(`   1. Verifique no ChatGuru se a mensagem aparece no histórico do chat ${formattedPhone}`);
                    console.log(`   2. Verifique se o chat existe e está ativo no ChatGuru`);
                    console.log(`   3. Verifique se a janela de 24h está ativa (mensagem de ativação foi enviada)`);
                    console.log(`   4. Verifique se o número não está bloqueado`);
                    console.log(`   5. A mensagem de ativação deve aparecer no chat antes da imagem`);
                    console.log(`   6. Se a mensagem de ativação não aparecer, a imagem também não aparecerá`);
                    console.log(`${'═'.repeat(80)}\n`);
                    return {
                        success: true,
                        message: 'Imagem enviada com sucesso via Z-API',
                    };
                } else {
                    const errorMsg = result?.description || result?.error || 'Resposta inesperada do ChatGuru';
                    console.error(`\n${'X'.repeat(80)}`);
                    console.error(`❌ [Z-API] FALHA AO ENVIAR IMAGEM`);
                    console.error(`${'X'.repeat(80)}`);
                    console.error(`   📄 Erro: ${errorMsg}`);
                    console.error(`   📊 Status do chat: ${chatActive ? 'Ativado' : 'Não ativado'}`);
                    console.error(`   📱 Telefone usado: ${phoneToUse}${phoneToUse !== formattedPhone ? ` (alternado de ${formattedPhone})` : ''}`);
                    console.error(`   👤 Contato: ${contactName || 'Não informado'}`);
                    console.error(`   📋 Resultado completo:`, JSON.stringify(result, null, 2));
                    console.error(`\n🔍 POSSÍVEIS CAUSAS:`);
                    console.error(`   1. Chat não existe ou não está ativo`);
                    console.error(`   2. Janela de 24h expirada (erro 470)`);
                    console.error(`   3. Número bloqueado ou inválido`);
                    console.error(`   4. Problemas com a conta Z-API/ChatGuru`);
                    console.error(`   5. API retornou sucesso mas não processou a mensagem`);
                    console.error(`${'X'.repeat(80)}\n`);
                    
                    // Se for erro de chat não encontrado, tenta com número alternado
                    if (this.isChatNotFoundError(result)) {
                        const alternatePhone = this.tryAlternatePhoneNumber(phoneToUse);
                        if (alternatePhone && alternatePhone !== phoneToUse) {
                            console.log(`\n🔄 [Z-API] Tentando enviar imagem com número alternado: ${alternatePhone}`);
                            try {
                                const retryResult = await this.chatGuruService.sendImage(alternatePhone, imageBase64, caption);
                                const retrySuccess = retryResult && (
                                    retryResult.success === true || 
                                    retryResult.result === 'success' || 
                                    retryResult.result?.result === 'success'
                                );
                                if (retrySuccess) {
                                    console.log(`\n${'═'.repeat(80)}`);
                                    console.log(`✅ [Z-API] IMAGEM ENVIADA COM SUCESSO COM NÚMERO ALTERNADO`);
                                    console.log(`${'═'.repeat(80)}`);
                                    console.log(`   📱 Telefone original: ${formattedPhone}`);
                                    console.log(`   📱 Telefone usado: ${alternatePhone}`);
                                    console.log(`${'═'.repeat(80)}\n`);
                                    return {
                                        success: true,
                                        message: 'Imagem enviada com sucesso via Z-API (número alternado)',
                                    };
                                }
                            } catch (retryError: any) {
                                console.error(`❌ [Z-API] Também falhou com número alternado: ${retryError.message}`);
                            }
                        }
                    }
                    
                    return {
                        success: false,
                        error: errorMsg,
                    };
                }
            } catch (imageError: any) {
                console.error(`\n${'X'.repeat(80)}`);
                console.error(`❌ [Z-API] ERRO AO ENVIAR IMAGEM`);
                console.error(`${'X'.repeat(80)}`);
                console.error(`   📄 Erro: ${imageError.message}`);
                console.error(`   📊 Status do chat: ${chatActive ? 'Ativado' : 'Não ativado'}`);
                console.error(`   📱 Telefone usado: ${phoneToUse}${phoneToUse !== formattedPhone ? ` (alternado de ${formattedPhone})` : ''}`);
                console.error(`   👤 Contato: ${contactName || 'Não informado'}`);
                if (imageError.stack) {
                    console.error(`   📋 Stack: ${imageError.stack}`);
                }
                console.error(`\n🔍 POSSÍVEIS CAUSAS:`);
                console.error(`   1. Chat não existe ou não está ativo`);
                console.error(`   2. Janela de 24h expirada (erro 470)`);
                console.error(`   3. Número bloqueado ou inválido`);
                console.error(`   4. Problemas com a conta Z-API/ChatGuru`);
                console.error(`${'X'.repeat(80)}\n`);
                
                // Se for erro de chat não encontrado, tenta com número alternado
                if (this.isChatNotFoundError(imageError)) {
                    const alternatePhone = this.tryAlternatePhoneNumber(phoneToUse);
                    if (alternatePhone && alternatePhone !== phoneToUse) {
                        console.log(`\n🔄 [Z-API] Tentando enviar imagem com número alternado: ${alternatePhone}`);
                        try {
                            const retryResult = await this.chatGuruService.sendImage(alternatePhone, imageBase64, caption);
                            const retrySuccess = retryResult && (
                                retryResult.success === true || 
                                retryResult.result === 'success' || 
                                retryResult.result?.result === 'success'
                            );
                            if (retrySuccess) {
                                console.log(`\n${'═'.repeat(80)}`);
                                console.log(`✅ [Z-API] IMAGEM ENVIADA COM SUCESSO COM NÚMERO ALTERNADO`);
                                console.log(`${'═'.repeat(80)}`);
                                console.log(`   📱 Telefone original: ${formattedPhone}`);
                                console.log(`   📱 Telefone usado: ${alternatePhone}`);
                                console.log(`${'═'.repeat(80)}\n`);
                                return {
                                    success: true,
                                    message: 'Imagem enviada com sucesso via Z-API (número alternado)',
                                };
                            }
                        } catch (retryError: any) {
                            console.error(`❌ [Z-API] Também falhou com número alternado: ${retryError.message}`);
                        }
                    }
                }
                
                return {
                    success: false,
                    error: imageError.message || 'Erro ao enviar imagem via Z-API',
                };
            }
        } catch (error: any) {
            console.error(`❌ [Z-API] Erro geral ao enviar imagem ChatGuru: ${error.message}`);
            console.error(`   Stack: ${error.stack}`);
            return {
                success: false,
                error: error.message || 'Erro interno ao enviar imagem via Z-API',
            };
        }
    }

    /**
     * Alterna o número de telefone entre com/sem o 9 quando houver erro de chat não encontrado
     * Formato esperado: 55 + DDD + número (8 ou 9 dígitos)
     * Se tem 9 dígitos (começa com 9), tenta sem o 9
     * Se tem 8 dígitos, tenta com o 9
     */
    private tryAlternatePhoneNumber(phone: string): string | null {
        // Remove caracteres não numéricos
        let cleanPhone = phone.replace(/\D/g, '');
        
        // Garante que tem código do país (55)
        if (!cleanPhone.startsWith('55')) {
            return null; // Número inválido
        }
        
        // Remove o código do país para trabalhar com DDD + número
        const withoutCountryCode = cleanPhone.substring(2);
        
        // Verifica se tem DDD (2 dígitos) + número
        if (withoutCountryCode.length < 10 || withoutCountryCode.length > 11) {
            return null; // Número inválido
        }
        
        const ddd = withoutCountryCode.substring(0, 2);
        const number = withoutCountryCode.substring(2);
        
        // Se o número tem 9 dígitos (começa com 9), tenta sem o 9
        if (number.length === 9 && number.startsWith('9')) {
            const newNumber = number.substring(1); // Remove o 9
            return `55${ddd}${newNumber}`;
        }
        
        // Se o número tem 8 dígitos, tenta com o 9
        if (number.length === 8) {
            return `55${ddd}9${number}`;
        }
        
        return null; // Não pode alternar
    }

    /**
     * Verifica se o erro é relacionado a chat não encontrado ou número inválido
     */
    private isChatNotFoundError(error: any): boolean {
        const errorMsg = (error?.message || error?.description || '').toLowerCase();
        return (
            errorMsg.includes('chat não existe') ||
            errorMsg.includes('chat não encontrado') ||
            errorMsg.includes('número informado') ||
            errorMsg.includes('not found') ||
            (error?.statusCode === 400 && errorMsg.includes('chat'))
        );
    }

    /**
     * Gera mensagem de QR Code no mesmo formato do template
     * Replica o layout do template template_checkin_iamcontrol_qrcode
     * Parâmetros do template: {{1}} = nome do aluno, {{2}} = nome do treinamento
     * Layout baseado no preview do template aprovado na Gupshup
     */
    private generateQRCodeMessage(alunoNome: string, treinamentoNome: string): string {
        // Replica exatamente o formato do template template_checkin_iamcontrol_qrcode
        // Layout conforme preview do template aprovado na Gupshup
        return `🎉 Parabéns ${alunoNome}!

✅ Seu check-in foi realizado com sucesso para o treinamento *${treinamentoNome}*!

📖 *SEU QR CODE DE CREDENCIAMENTO:*
(Utilize o QRCode para credenciamento)

💡 *Como usar:*
• Salve esta imagem
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
