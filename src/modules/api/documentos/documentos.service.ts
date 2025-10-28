import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { Documentos } from '@/modules/config/entities/documentos.entity';
import { TurmasAlunosTreinamentosContratos } from '@/modules/config/entities/turmasAlunosTreinamentosContratos.entity';
import { EStatusAssinaturasContratos, EOrigemAlunos, EStatusAlunosTurmas } from '@/modules/config/entities/enum';
import * as crypto from 'crypto';
import axios from 'axios';
import { Not, IsNull } from 'typeorm';
import {
    CreateDocumentoDto,
    UpdateDocumentoDto,
    DocumentoResponseDto,
    DocumentosListResponseDto,
    GerarContratoDto,
    CampoDocumentoDto,
    DocumentosFilterDto,
    CriarContratoZapSignDto,
    RespostaContratoZapSignDto,
    AtualizarStatusContratoDto,
} from './dto/documentos.dto';
import { ETipoDocumento, EFormasPagamento } from '@/modules/config/entities/enum';
import { ZapSignService } from './zapsign.service';
import { ContractTemplateService } from './contract-template.service';
import * as PDFDocument from 'pdfkit';
import { MailService } from '@/modules/mail/mail.service';

@Injectable()
export class DocumentosService {
    constructor(
        private readonly uow: UnitOfWorkService,
        private readonly zapSignService: ZapSignService,
        private readonly contractTemplateService: ContractTemplateService,
        private readonly mailService: MailService,
    ) {}

    async createDocumento(createDocumentoDto: CreateDocumentoDto, userId?: number): Promise<DocumentoResponseDto> {
        try {
            console.log('📄 [BACKEND] Criando documento com treinamentos relacionados:', createDocumentoDto.treinamentos_relacionados);

            const documento = this.uow.documentosRP.create({
                documento: createDocumentoDto.documento,
                tipo_documento: createDocumentoDto.tipo_documento,
                campos: createDocumentoDto.campos,
                clausulas: createDocumentoDto.clausulas,
                treinamentos_relacionados: createDocumentoDto.treinamentos_relacionados || [],
                criado_por: userId,
                atualizado_por: userId,
            });

            const savedDocumento = await this.uow.documentosRP.save(documento);
            console.log('✅ [BACKEND] Documento criado com treinamentos:', savedDocumento.treinamentos_relacionados);
            return this.mapToResponseDto(savedDocumento);
        } catch (error) {
            console.error('Erro ao criar documento:', error);
            throw new BadRequestException('Erro ao criar documento');
        }
    }

    async findAllDocumentos(page: number = 1, limit: number = 10, filter?: DocumentosFilterDto): Promise<DocumentosListResponseDto> {
        try {
            const whereCondition: any = { deletado_em: null };

            if (filter?.tipo_documento) {
                whereCondition.tipo_documento = filter.tipo_documento;
            }

            const [documentos, total] = await this.uow.documentosRP.findAndCount({
                where: whereCondition,
                order: { documento: 'ASC' },
                skip: (page - 1) * limit,
                take: limit,
            });

            const data = documentos.map((doc) => this.mapToResponseDto(doc));
            const totalPages = Math.ceil(total / limit);

            return {
                data,
                total,
                page,
                limit,
                totalPages,
            };
        } catch (error) {
            console.error('Erro ao buscar documentos:', error);
            throw new BadRequestException('Erro ao buscar documentos');
        }
    }

    async findDocumentoById(id: number): Promise<DocumentoResponseDto> {
        try {
            const documento = await this.uow.documentosRP.findOne({
                where: { id, deletado_em: null },
            });

            if (!documento) {
                throw new NotFoundException('Documento não encontrado');
            }

            return this.mapToResponseDto(documento);
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error('Erro ao buscar documento:', error);
            throw new BadRequestException('Erro ao buscar documento');
        }
    }

    async updateDocumento(id: number, updateDocumentoDto: UpdateDocumentoDto, userId?: number): Promise<DocumentoResponseDto> {
        try {
            const documento = await this.uow.documentosRP.findOne({
                where: { id, deletado_em: null },
            });

            if (!documento) {
                throw new NotFoundException('Documento não encontrado');
            }

            Object.assign(documento, updateDocumentoDto);
            documento.atualizado_por = userId;
            documento.atualizado_em = new Date();

            const savedDocumento = await this.uow.documentosRP.save(documento);
            return this.mapToResponseDto(savedDocumento);
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error('Erro ao atualizar documento:', error);
            throw new BadRequestException('Erro ao atualizar documento');
        }
    }

    async deleteDocumento(id: number, userId?: number): Promise<void> {
        try {
            const documento = await this.uow.documentosRP.findOne({
                where: { id, deletado_em: null },
            });

            if (!documento) {
                throw new NotFoundException('Documento não encontrado');
            }

            documento.deletado_em = new Date();
            // documento.deletado_por = userId; // Campo não existe na entidade

            await this.uow.documentosRP.save(documento);
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error('Erro ao deletar documento:', error);
            throw new BadRequestException('Erro ao deletar documento');
        }
    }

    async buscarTemplatesZapSign() {
        try {
            console.log('=== BUSCANDO TEMPLATES ZAPSIGN ===');

            // Buscar documentos do banco de dados local
            const documentos = await this.uow.documentosRP.find({
                where: { deletado_em: null },
                order: { documento: 'ASC' },
            });

            console.log(`Encontrados ${documentos.length} documentos no banco local`);

            // Mapear para o formato esperado pelo frontend
            const templates = documentos.map((doc) => ({
                id: doc.id.toString(),
                nome: doc.documento,
                tipo: doc.tipo_documento,
                campos: doc.campos || [],
                clausulas: doc.clausulas || '',
                treinamentos_relacionados: doc.treinamentos_relacionados || [],
            }));

            console.log('Templates mapeados:', templates.length);
            return templates;
        } catch (error) {
            console.error('Erro ao buscar templates:', error);
            throw new BadRequestException('Erro ao buscar templates');
        }
    }

    async criarContratoZapSign(criarContratoDto: CriarContratoZapSignDto, userId?: number): Promise<RespostaContratoZapSignDto> {
        try {
            console.log('=== CRIAR CONTRATO ZAPSIGN - INÍCIO ===');
            console.log('criarContratoDto:', JSON.stringify(criarContratoDto, null, 2));

            // Buscar dados do aluno
            const aluno = await this.uow.alunosRP.findOne({
                where: { id: parseInt(criarContratoDto.id_aluno), deletado_em: null },
                relations: ['id_polo_fk'],
            });

            if (!aluno) {
                throw new NotFoundException('Aluno não encontrado');
            }

            // Buscar dados do treinamento
            const treinamento = await this.uow.treinamentosRP.findOne({
                where: { id: parseInt(criarContratoDto.id_treinamento), deletado_em: null },
            });

            if (!treinamento) {
                throw new NotFoundException('Treinamento não encontrado');
            }

            // Buscar dados da turma de IPR se fornecida
            let turma = null;
            if (criarContratoDto.id_turma_bonus) {
                turma = await this.uow.turmasRP.findOne({
                    where: { id: parseInt(criarContratoDto.id_turma_bonus), deletado_em: null },
                    relations: ['lider_evento_fk'],
                });
            }

            // Buscar ou criar registro de TurmasAlunos primeiro
            let turmaAluno = await this.uow.turmasAlunosRP.findOne({
                where: {
                    id_aluno: criarContratoDto.id_aluno,
                    deletado_em: null,
                },
            });

            // Se não existir, criar um registro temporário
            if (!turmaAluno) {
                turmaAluno = this.uow.turmasAlunosRP.create({
                    id_aluno: criarContratoDto.id_aluno,
                    id_turma: 1, // Turma padrão temporária
                    origem_aluno: EOrigemAlunos.COMPROU_INGRESSO, // Origem padrão
                    status_aluno_turma: EStatusAlunosTurmas.AGUARDANDO_CHECKIN, // Status padrão
                    nome_cracha: aluno.nome_cracha || aluno.nome,
                    numero_cracha: 'TEMP001', // Número temporário
                });
                turmaAluno = await this.uow.turmasAlunosRP.save(turmaAluno);
            }

            // Buscar ou criar registro de TurmasAlunosTreinamentos
            let turmaAlunoTreinamento = await this.uow.turmasAlunosTreinamentosRP.findOne({
                where: {
                    id_turma_aluno: turmaAluno.id,
                    id_treinamento: parseInt(criarContratoDto.id_treinamento),
                    deletado_em: null,
                },
            });

            // Se não existir, criar um registro temporário
            if (!turmaAlunoTreinamento) {
                turmaAlunoTreinamento = this.uow.turmasAlunosTreinamentosRP.create({
                    id_turma_aluno: turmaAluno.id,
                    id_treinamento: parseInt(criarContratoDto.id_treinamento),
                    preco_treinamento: treinamento.preco_treinamento || 0,
                    forma_pgto: [],
                    preco_total_pago: 0,
                });
                turmaAlunoTreinamento = await this.uow.turmasAlunosTreinamentosRP.save(turmaAlunoTreinamento);
            }

            // Preparar dados para o template usando os dados do DTO
            const templateData = await this.prepareTemplateDataFromDto(aluno, treinamento, turma, criarContratoDto);

            const pdfBuffer = await this.contractTemplateService.generateContractPDF(templateData);

            // Preparar signers (aluno + testemunhas)
            const signers = [
                {
                    name: aluno.nome,
                    email: aluno.email,
                    phone: aluno.telefone_um,
                    action: 'sign' as const,
                },
            ];

            // Adicionar testemunhas se fornecidas
            if (criarContratoDto.testemunha_um_nome && criarContratoDto.testemunha_um_cpf) {
                signers.push({
                    name: criarContratoDto.testemunha_um_nome,
                    email: criarContratoDto.testemunha_um_email || '',
                    phone: criarContratoDto.testemunha_um_telefone || '',
                    action: 'sign' as const,
                });
            }

            if (criarContratoDto.testemunha_dois_nome && criarContratoDto.testemunha_dois_cpf) {
                signers.push({
                    name: criarContratoDto.testemunha_dois_nome,
                    email: criarContratoDto.testemunha_dois_email || '',
                    phone: criarContratoDto.testemunha_dois_telefone || '',
                    action: 'sign' as const,
                });
            }

            // Criar documento no ZapSign usando o PDF gerado
            const documentData = {
                name: `Contrato ${treinamento.treinamento} - ${aluno.nome}`,
                signers: signers,
                message: 'Por favor, assine este contrato de treinamento.',
                sandbox: false,
                file: pdfBuffer,
            };

            const zapSignResponse = await this.zapSignService.createDocumentFromFile(documentData);

            // Processar dados de bônus completos
            const bonusData = this.processBonusData(criarContratoDto, turma);

            // Processar dados específicos do boleto
            const boletoData = this.processBoletoData(criarContratoDto);
            bonusData.campos_variaveis = { ...bonusData.campos_variaveis, ...boletoData };

            // Preparar dados dos signers para o campo zapsign_signers_data
            const signersData = signers.map((signer) => ({
                name: signer.name,
                email: signer.email || undefined,
                telefone: signer.phone || undefined,
                cpf: this.getSignerCPF(signer, aluno, criarContratoDto),
                status: 'pending',
                signing_url: zapSignResponse.signers.find((s) => s.name === signer.name)?.sign_url || '',
            }));

            // Preparar status do documento para o campo zapsign_document_status
            const documentStatus = {
                status: zapSignResponse.status,
                created_at: zapSignResponse.created_at,
                document_id: zapSignResponse.token,
                signing_url: zapSignResponse.signers[0]?.sign_url || '',
            };

            // Salvar informações do contrato no banco de dados
            const contrato = this.uow.turmasAlunosTreinamentosContratosRP.create({
                id_turma_aluno_treinamento: turmaAlunoTreinamento.id,
                id_documento: parseInt(criarContratoDto.template_id),
                status_ass_aluno: EStatusAssinaturasContratos.ASSINATURA_PENDENTE,
                // Campos ZapSign específicos
                zapsign_document_id: zapSignResponse.token,
                zapsign_signers_data: signersData,
                zapsign_document_status: documentStatus,
                dados_contrato: {
                    zapsign_document_id: zapSignResponse.token,
                    zapsign_document_url: zapSignResponse.signers[0]?.sign_url || '',
                    contrato: {
                        file_url: zapSignResponse.original_file,
                        id_documento_zapsign: zapSignResponse.token,
                    },
                    treinamento: {
                        id: treinamento.id,
                        treinamento: treinamento.treinamento,
                        sigla_treinamento: treinamento.sigla_treinamento,
                        preco_treinamento: treinamento.preco_treinamento,
                        url_logo_treinamento: treinamento.url_logo_treinamento,
                        tipo_treinamento: treinamento.tipo_treinamento,
                        tipo_palestra: treinamento.tipo_palestra,
                        tipo_online: treinamento.tipo_online,
                    },
                    aluno: {
                        id: aluno.id,
                        nome: aluno.nome,
                        cpf: aluno.cpf,
                        email: aluno.email,
                        telefone_um: aluno.telefone_um,
                        logradouro: aluno.logradouro,
                        numero: aluno.numero,
                        bairro: aluno.bairro,
                        cidade: aluno.cidade,
                        estado: aluno.estado,
                        cep: aluno.cep,
                        polo: {
                            id: aluno.id_polo_fk?.id,
                            nome: aluno.id_polo_fk?.polo,
                            cidade: aluno.id_polo_fk?.cidade,
                            estado: aluno.id_polo_fk?.estado,
                        },
                    },
                    pagamento: {
                        forma_pagamento: criarContratoDto.forma_pagamento,
                        formas_pagamento: this.processPaymentMethods(criarContratoDto),
                        valores_formas_pagamento: criarContratoDto.valores_formas_pagamento || {},
                    },
                    formas_pagamento: this.processPaymentMethods(criarContratoDto),
                    valores_formas_pagamento: criarContratoDto.valores_formas_pagamento || {},
                    bonus_selecionados: criarContratoDto.tipos_bonus || [],
                    valores_bonus: bonusData.valores_bonus,
                    campos_variaveis: bonusData.campos_variaveis,
                    observacoes: criarContratoDto.observacoes || '',
                    testemunhas: {
                        testemunha_um: {
                            nome: criarContratoDto.testemunha_um_nome || '',
                            cpf: criarContratoDto.testemunha_um_cpf || '',
                            email: criarContratoDto.testemunha_um_email || '',
                            telefone: criarContratoDto.testemunha_um_telefone || '',
                            id: criarContratoDto.testemunha_um_id || null,
                        },
                        testemunha_dois: {
                            nome: criarContratoDto.testemunha_dois_nome || '',
                            cpf: criarContratoDto.testemunha_dois_cpf || '',
                            email: criarContratoDto.testemunha_dois_email || '',
                            telefone: criarContratoDto.testemunha_dois_telefone || '',
                            id: criarContratoDto.testemunha_dois_id || null,
                        },
                    },
                },
                criado_por: userId,
                atualizado_por: userId,
            });

            const savedContrato = await this.uow.turmasAlunosTreinamentosContratosRP.save(contrato);

            return {
                id: zapSignResponse.token,
                nome_documento: `Contrato ${treinamento.treinamento} - ${aluno.nome}`,
                status: zapSignResponse.status,
                url_assinatura: zapSignResponse.signers[0]?.sign_url || '',
                signers: signers.map((signer) => ({
                    nome: signer.name,
                    email: signer.email,
                    status: 'pending',
                    tipo: 'sign' as const,
                })),
                created_at: zapSignResponse.created_at,
                file_url: zapSignResponse.original_file,
            };
        } catch (error: any) {
            console.error('Erro ao criar contrato no ZapSign:', error);
            throw new BadRequestException(`Erro ao criar contrato: ${error.message}`);
        }
    }

    /**
     * Obtém o CPF do signatário baseado no nome
     */
    private getSignerCPF(signer: any, aluno: any, criarContratoDto: CriarContratoZapSignDto): string {
        // Se for o aluno principal
        if (signer.name === aluno.nome) {
            return aluno.cpf || '';
        }

        // Se for a testemunha 1
        if (signer.name === criarContratoDto.testemunha_um_nome) {
            return criarContratoDto.testemunha_um_cpf || '';
        }

        // Se for a testemunha 2
        if (signer.name === criarContratoDto.testemunha_dois_nome) {
            return criarContratoDto.testemunha_dois_cpf || '';
        }

        return '';
    }

    /**
     * Prepara os dados para o template do contrato usando dados do DTO
     */
    private async prepareTemplateDataFromDto(aluno: any, treinamento: any, turma: any, criarContratoDto: CriarContratoZapSignDto) {
        console.log('=== PREPARANDO DADOS DO DTO PARA TEMPLATE ===');
        console.log('criarContratoDto:', JSON.stringify(criarContratoDto, null, 2));

        // Buscar documento para obter as cláusulas
        let clausulas = '';
        if (criarContratoDto.template_id) {
            const documento = await this.uow.documentosRP.findOne({
                where: { id: parseInt(criarContratoDto.template_id), deletado_em: null },
            });
            clausulas = documento?.clausulas || '';
        }

        // Processar dados de bônus completos
        const bonusData = this.processBonusData(criarContratoDto, turma);

        // Processar dados específicos do boleto
        const boletoData = this.processBoletoData(criarContratoDto);
        bonusData.campos_variaveis = { ...bonusData.campos_variaveis, ...boletoData };

        return {
            aluno: {
                nome: aluno.nome,
                cpf: aluno.cpf,
                data_nascimento: aluno.data_nascimento || '',
                telefone_um: aluno.telefone_um,
                email: aluno.email,
                logradouro: aluno.logradouro,
                numero: aluno.numero,
                bairro: aluno.bairro,
                cidade: aluno.cidade,
                estado: aluno.estado,
                cep: aluno.cep,
                polo: {
                    id: aluno.id_polo_fk?.id,
                    nome: aluno.id_polo_fk?.polo,
                    cidade: aluno.id_polo_fk?.cidade,
                    estado: aluno.id_polo_fk?.estado,
                },
            },
            treinamento: {
                id: treinamento.id,
                treinamento: treinamento.treinamento,
                sigla_treinamento: treinamento.sigla_treinamento,
                preco_treinamento: treinamento.preco_treinamento,
                url_logo_treinamento: treinamento.url_logo_treinamento,
                tipo_treinamento: treinamento.tipo_treinamento,
                tipo_palestra: treinamento.tipo_palestra,
                tipo_online: treinamento.tipo_online,
            },
            pagamento: {
                forma_pagamento: criarContratoDto.forma_pagamento,
                formas_pagamento: this.processPaymentMethods(criarContratoDto),
                valores_formas_pagamento: criarContratoDto.valores_formas_pagamento || {},
            },
            formas_pagamento: this.processPaymentMethods(criarContratoDto),
            valores_formas_pagamento: criarContratoDto.valores_formas_pagamento || {},
            bonus_selecionados: criarContratoDto.tipos_bonus || [],
            valores_bonus: bonusData.valores_bonus,
            campos_variaveis: bonusData.campos_variaveis,
            testemunhas: {
                testemunha_um: {
                    nome: criarContratoDto.testemunha_um_nome || '',
                    cpf: criarContratoDto.testemunha_um_cpf || '',
                    email: criarContratoDto.testemunha_um_email || '',
                    telefone: criarContratoDto.testemunha_um_telefone || '',
                    id: criarContratoDto.testemunha_um_id || null,
                },
                testemunha_dois: {
                    nome: criarContratoDto.testemunha_dois_nome || '',
                    cpf: criarContratoDto.testemunha_dois_cpf || '',
                    email: criarContratoDto.testemunha_dois_email || '',
                    telefone: criarContratoDto.testemunha_dois_telefone || '',
                    id: criarContratoDto.testemunha_dois_id || null,
                },
            },
            observacoes: criarContratoDto.observacoes || '',
            clausulas: clausulas,
        };
    }

    /**
     * Calcula o preço total do contrato baseado nas formas de pagamento
     */
    private calculateContractPrice(criarContratoDto: CriarContratoZapSignDto): string {
        let total = 0;

        // Primeiro, tentar usar formas_pagamento se disponível
        if (criarContratoDto.formas_pagamento && Array.isArray(criarContratoDto.formas_pagamento)) {
            // Agrupar por forma e tipo para somar corretamente
            const groupedPayments: { [key: string]: number } = {};

            criarContratoDto.formas_pagamento.forEach((forma: any) => {
                if (forma.valor && typeof forma.valor === 'number') {
                    const key = `${forma.forma}_${forma.tipo}`;
                    if (!groupedPayments[key]) {
                        groupedPayments[key] = 0;
                    }
                    groupedPayments[key] += forma.valor;
                    console.log(`Adicionando ${forma.valor} (${forma.forma} - ${forma.tipo}). Total grupo: ${groupedPayments[key]}`);
                }
            });

            // Somar todos os grupos
            Object.values(groupedPayments).forEach((valorGrupo) => {
                total += valorGrupo;
                console.log(`Adicionando grupo ${valorGrupo} ao total. Total atual: ${total}`);
            });
        }
        // Fallback: usar valores_formas_pagamento
        else if (criarContratoDto.valores_formas_pagamento) {
            const valoresFormas = criarContratoDto.valores_formas_pagamento;
            console.log('Usando valores_formas_pagamento para calcular total');

            // Processar pagamentos à vista
            const formasAVista = ['À Vista - Cartão de Crédito', 'À Vista - Cartão de Débito', 'À Vista - PIX/Transferência', 'À Vista - Espécie'];

            formasAVista.forEach((chave) => {
                if (valoresFormas[chave] && valoresFormas[chave].valor) {
                    const valor = parseInt(valoresFormas[chave].valor) / 100;
                    total += valor;
                    console.log(`Adicionando ${valor} (${chave}). Total: ${total}`);
                }
            });

            // Processar pagamentos parcelados
            if (valoresFormas['Parcelado - Cartão de Crédito'] && valoresFormas['Parcelado - Cartão de Crédito'].valor) {
                const valor = parseInt(valoresFormas['Parcelado - Cartão de Crédito'].valor) / 100;
                total += valor;
                console.log(`Adicionando ${valor} (Parcelado - Cartão de Crédito). Total: ${total}`);
            }

            // Processar boleto parcelado
            const chavesBoleto = ['Parcelado - Boleto', 'Boleto Parcelado', 'Boleto'];

            for (const chave of chavesBoleto) {
                if (valoresFormas[chave]) {
                    const dadosBoleto = valoresFormas[chave];
                    const valorTotal = parseInt(dadosBoleto.valor_parcelas || dadosBoleto.valor || '0') / 100;
                    if (valorTotal > 0) {
                        total += valorTotal;
                        console.log(`Adicionando ${valorTotal} (${chave}). Total: ${total}`);
                        break; // Só processar uma vez
                    }
                }
            }
        }

        console.log('Total final calculado:', total);
        return this.contractTemplateService.formatPrice(total);
    }

    /**
     * Verifica se uma forma de pagamento foi selecionada
     */
    private isPaymentMethodSelected(criarContratoDto: CriarContratoZapSignDto, methodName: string): boolean {
        if (!criarContratoDto.valores_formas_pagamento) {
            console.log('valores_formas_pagamento é null/undefined');
            return false;
        }

        const valoresFormas = criarContratoDto.valores_formas_pagamento;

        // Verificar se existe a chave exata (formato objeto)
        if (typeof valoresFormas === 'object' && !Array.isArray(valoresFormas)) {
            const hasExactKey = !!valoresFormas[methodName];
            console.log('Chave exata encontrada:', hasExactKey);
            if (hasExactKey) {
                return true;
            }
        }

        // Verificar no formato array
        if (Array.isArray(valoresFormas)) {
            console.log('Verificando array de formas de pagamento...');

            // Mapear nomes para códigos
            const methodMapping: Record<string, { forma: string; tipo: string }> = {
                'À Vista - Cartão de Crédito': { forma: 'CARTAO_CREDITO', tipo: 'A_VISTA' },
                'À Vista - Cartão de Débito': { forma: 'CARTAO_DEBITO', tipo: 'A_VISTA' },
                'À Vista - PIX/Transferência': { forma: 'PIX', tipo: 'A_VISTA' },
                'À Vista - Espécie': { forma: 'ESPECIE', tipo: 'A_VISTA' },
                'Parcelado - Cartão de Crédito': { forma: 'CARTAO_CREDITO', tipo: 'PARCELADO' },
                'Parcelado - Boleto': { forma: 'BOLETO', tipo: 'PARCELADO' },
            };

            const methodConfig = methodMapping[methodName];
            if (methodConfig) {
                const found = valoresFormas.some((forma: any) => forma.forma === methodConfig.forma && forma.tipo === methodConfig.tipo);
                console.log('Forma encontrada no array:', found);
                return found;
            }
        }

        // Verificar se há dados nas formas_pagamento salvas no banco
        if (criarContratoDto.formas_pagamento && Array.isArray(criarContratoDto.formas_pagamento)) {
            const methodMapping: Record<string, { forma: string; tipo: string }> = {
                'À Vista - Cartão de Crédito': { forma: 'CARTAO_CREDITO', tipo: 'A_VISTA' },
                'À Vista - Cartão de Débito': { forma: 'CARTAO_DEBITO', tipo: 'A_VISTA' },
                'À Vista - PIX/Transferência': { forma: 'PIX', tipo: 'A_VISTA' },
                'À Vista - Espécie': { forma: 'ESPECIE', tipo: 'A_VISTA' },
                'Parcelado - Cartão de Crédito': { forma: 'CARTAO_CREDITO', tipo: 'PARCELADO' },
                'Parcelado - Boleto': { forma: 'BOLETO', tipo: 'PARCELADO' },
            };

            const methodConfig = methodMapping[methodName];
            if (methodConfig) {
                // Para pagamentos parcelados, verifica se existe pelo menos uma parcela
                const found = criarContratoDto.formas_pagamento.some((forma: any) => {
                    const matchesFormaAndTipo = forma.forma === methodConfig.forma && forma.tipo === methodConfig.tipo;
                    console.log(`Verificando forma: ${forma.forma} (${forma.tipo}) vs ${methodConfig.forma} (${methodConfig.tipo}) = ${matchesFormaAndTipo}`);
                    return matchesFormaAndTipo;
                });
                console.log('Forma encontrada nas formas_pagamento:', found);
                return found;
            }
        }

        return false;
    }

    /**
     * Processa dados específicos do boleto parcelado
     */
    private processBoletoData(criarContratoDto: CriarContratoZapSignDto): any {
        const boletoData: any = {};

        if (!criarContratoDto.valores_formas_pagamento) {
            return boletoData;
        }

        const valoresFormas = criarContratoDto.valores_formas_pagamento;

        // Tentar diferentes chaves para encontrar dados do boleto
        const chavesBoleto = [
            'Parcelado - Boleto',
            'Boleto Parcelado',
            'Boleto',
            'boleto_parcelado',
            'boleto',
            'Parcelado - Boleto Bancário',
            'Boleto Bancário',
            'Parcelado - Boleto - Parcelas',
            'Boleto - Parcelas',
            'Boleto Parcelado - Parcelas',
            'Parcelas - Boleto',
        ];

        let dadosBoleto = null;

        for (const chave of chavesBoleto) {
            if (valoresFormas[chave]) {
                dadosBoleto = valoresFormas[chave];
                break;
            }
        }

        // Se não encontrou diretamente, tentar buscar em estruturas aninhadas
        if (!dadosBoleto) {
            for (const chave of Object.keys(valoresFormas)) {
                const valor = valoresFormas[chave];
                if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
                    // Buscar por campos que indiquem boleto
                    if (valor.dia || valor.data_primeiro_boleto || valor.data_1_boleto || valor.valor_parcelas) {
                        dadosBoleto = valor;
                        break;
                    }
                }
            }
        }

        if (dadosBoleto) {
            // Capturar informações específicas do boleto
            const diaVencimento = dadosBoleto.dia || dadosBoleto.dia_vencimento || dadosBoleto.dia_boleto;
            const dataPrimeiroBoleto = dadosBoleto.data_primeiro_boleto || dadosBoleto.data_1_boleto || dadosBoleto.data_inicio_boleto;
            const valorTotal = dadosBoleto.valor_parcelas || dadosBoleto.valor || dadosBoleto.valor_total || dadosBoleto.valor_boleto;
            const numeroParcelas = dadosBoleto.numero_parcelas || dadosBoleto.parcelas || dadosBoleto.num_parcelas || dadosBoleto.qtd_parcelas;

            if (diaVencimento) {
                boletoData['Dia de Vencimento do Boleto'] = diaVencimento;
            }

            if (dataPrimeiroBoleto) {
                boletoData['Data do Primeiro Boleto'] = dataPrimeiroBoleto;
            }

            if (valorTotal) {
                boletoData['Valor Total do Boleto'] = valorTotal;
            }

            if (numeroParcelas) {
                boletoData['Número de Parcelas do Boleto'] = numeroParcelas;
            }
        }

        return boletoData;
    }

    /**
     * Processa todos os dados de bônus de forma completa
     */
    private processBonusData(criarContratoDto: CriarContratoZapSignDto, turma: any): { valores_bonus: any; campos_variaveis: any } {
        const valoresBonus: any = {};
        const camposVariaveis: any = { ...criarContratoDto.campos_variaveis };

        console.log('=== PROCESSANDO DADOS DE BÔNUS ===');
        console.log('Tipos bônus:', criarContratoDto.tipos_bonus);
        console.log('Valores bônus:', criarContratoDto.valores_bonus);
        console.log('Campos variáveis:', camposVariaveis);

        // Processar bônus dos 100 dias
        if (this.isBonusSelected(criarContratoDto, ['100_dias', 'cem_dias'])) {
            valoresBonus['Bônus-100 Dias'] = true;
            console.log('Bônus 100 dias selecionado');
        }

        // Processar bônus do IPR (Imersão Prosperar)
        if (this.isBonusSelected(criarContratoDto, ['ipr'])) {
            valoresBonus['Bônus-IPR'] = true;
            console.log('Bônus IPR selecionado');

            // Adicionar quantidade de inscrições do Prosperar
            const quantidadeInscricoes = camposVariaveis['Quantidade de Inscrições'] || '1';
            valoresBonus[`Bônus-${quantidadeInscricoes} Inscrições do Imersão Prosperar`] = true;
            console.log(`Quantidade de inscrições: ${quantidadeInscricoes}`);

            // Adicionar data da turma de IPR - usar a data dos campos variáveis se disponível
            if (camposVariaveis['Data do Imersão Prosperar']) {
                console.log('Data do IPR dos campos variáveis:', camposVariaveis['Data do Imersão Prosperar']);
            } else if (turma && turma.data_inicio) {
                camposVariaveis['Data do Imersão Prosperar'] = this.contractTemplateService.formatDate(turma.data_inicio);
                console.log('Data do IPR adicionada:', camposVariaveis['Data do Imersão Prosperar']);
            }

            // Adicionar sigla e edição do IPR
            const siglaEdicao = camposVariaveis['IPR - Sigla e Edição'] || camposVariaveis['Turma IPR'];
            if (siglaEdicao) {
                camposVariaveis['Sigla e Edição IPR'] = siglaEdicao;
                console.log('Sigla e edição IPR:', siglaEdicao);
            }
        }

        // Processar outros bônus
        if (this.isBonusSelected(criarContratoDto, ['outros'])) {
            const descricaoOutros = this.getOutrosDescricao(criarContratoDto);
            if (descricaoOutros) {
                valoresBonus[`Bônus-Outros: ${descricaoOutros}`] = true;
                console.log('Bônus outros selecionado:', descricaoOutros);

                // Adicionar valor do bônus outros se disponível
                const valorOutros = camposVariaveis['Valor do Bônus (R$)'] || camposVariaveis['Valor do Outro Bônus'];
                if (valorOutros) {
                    camposVariaveis['Valor do Outro Bônus'] = valorOutros;
                }
            }
        }

        // Processar campos variáveis adicionais
        // Adicionar local de assinatura se não estiver presente
        if (!camposVariaveis['Local de Assinatura do Contrato']) {
            camposVariaveis['Local de Assinatura do Contrato'] = camposVariaveis['Cidade do Treinamento'] || 'Americana/SP';
        }

        console.log('Valores bônus processados:', valoresBonus);
        console.log('Campos variáveis processados:', camposVariaveis);

        return {
            valores_bonus: valoresBonus,
            campos_variaveis: camposVariaveis,
        };
    }

    /**
     * Processa dados de boleto parcelado com diferentes formatos possíveis
     */
    private processBoletoParcelado(valoresFormas: any): any[] {
        const formasPagamento: any[] = [];

        console.log('=== INICIANDO PROCESSAMENTO DE BOLETO ===');
        console.log('Valores formas recebidos:', JSON.stringify(valoresFormas, null, 2));
        console.log('Tipo dos valores formas:', typeof valoresFormas);
        console.log('É array?', Array.isArray(valoresFormas));

        // Tentar diferentes chaves possíveis para o boleto
        const chavesBoleto = [
            'Parcelado - Boleto',
            'Boleto Parcelado',
            'Boleto',
            'boleto_parcelado',
            'boleto',
            'Parcelado - Boleto Bancário',
            'Boleto Bancário',
            'Parcelado - Boleto - Parcelas',
            'Boleto - Parcelas',
            'Boleto Parcelado - Parcelas',
            'Parcelas - Boleto',
        ];

        console.log('Chaves que serão testadas:', chavesBoleto);
        console.log('Chaves disponíveis no objeto:', Object.keys(valoresFormas));

        let dadosBoleto = null;
        let chaveEncontrada = null;

        for (const chave of chavesBoleto) {
            console.log(`Testando chave: "${chave}"`);
            if (valoresFormas[chave]) {
                dadosBoleto = valoresFormas[chave];
                chaveEncontrada = chave;
                console.log(`Chave encontrada: "${chave}"`);
                break;
            }
        }

        // Se não encontrou diretamente, tentar buscar em estruturas aninhadas
        if (!dadosBoleto) {
            console.log('Buscando em estruturas aninhadas...');
            for (const chave of Object.keys(valoresFormas)) {
                const valor = valoresFormas[chave];
                if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
                    console.log(`Verificando objeto aninhado: "${chave}"`);
                    // Buscar por campos que indiquem boleto
                    if (valor.dia || valor.data_primeiro_boleto || valor.data_1_boleto || valor.valor_parcelas) {
                        dadosBoleto = valor;
                        chaveEncontrada = chave;
                        console.log(`Boleto encontrado em estrutura aninhada: "${chave}"`);
                        break;
                    }
                }
            }
        }

        if (!dadosBoleto) {
            console.log('Nenhum boleto parcelado encontrado nas chaves:', chavesBoleto);
            console.log('Todas as chaves disponíveis:', Object.keys(valoresFormas));
            return formasPagamento;
        }

        console.log('=== PROCESSANDO BOLETO PARCELADO ===');
        console.log('Chave encontrada:', chaveEncontrada);
        console.log('Dados do boleto:', dadosBoleto);

        // Tentar diferentes campos para o valor
        const valorTotal =
            parseInt(dadosBoleto.valor_parcelas || dadosBoleto.valor || dadosBoleto.valor_total || dadosBoleto.valor_boleto || dadosBoleto.valor_parcela || '0') /
            100;

        // Tentar diferentes campos para o número de parcelas
        const numeroParcelas = parseInt(
            dadosBoleto.numero_parcelas || dadosBoleto.parcelas || dadosBoleto.num_parcelas || dadosBoleto.qtd_parcelas || dadosBoleto.numero_parcelas_boleto || '1',
        );

        // Capturar informações específicas do boleto
        const diaVencimento = dadosBoleto.dia || dadosBoleto.dia_vencimento || dadosBoleto.dia_boleto;
        const dataPrimeiroBoleto = dadosBoleto.data_primeiro_boleto || dadosBoleto.data_1_boleto || dadosBoleto.data_inicio_boleto;

        const valorParcela = valorTotal / numeroParcelas;

        console.log('Valor total:', valorTotal);
        console.log('Número de parcelas:', numeroParcelas);
        console.log('Valor da parcela:', valorParcela);
        console.log('Dia de vencimento:', diaVencimento);
        console.log('Data do primeiro boleto:', dataPrimeiroBoleto);

        for (let i = 0; i < numeroParcelas; i++) {
            formasPagamento.push({
                tipo: 'PARCELADO',
                forma: 'BOLETO',
                valor: valorParcela,
            });
        }

        return formasPagamento;
    }

    /**
     * Processa as formas de pagamento para salvar no banco
     */
    private processPaymentMethods(criarContratoDto: CriarContratoZapSignDto): any[] {
        const formasPagamento: any[] = [];

        console.log('=== PROCESSANDO FORMAS DE PAGAMENTO ===');
        console.log('Valores formas pagamento:', JSON.stringify(criarContratoDto.valores_formas_pagamento, null, 2));
        console.log('Formas pagamento:', JSON.stringify(criarContratoDto.formas_pagamento, null, 2));

        // Primeiro, verificar se há dados diretamente no campo formas_pagamento
        if (criarContratoDto.formas_pagamento && Array.isArray(criarContratoDto.formas_pagamento)) {
            console.log('Usando formas_pagamento diretas');

            // Agrupar por forma e tipo para calcular valores corretos
            const groupedPayments: { [key: string]: { valor: number; parcelas: number } } = {};

            criarContratoDto.formas_pagamento.forEach((forma: any) => {
                if (forma.valor && typeof forma.valor === 'number') {
                    const key = `${forma.forma}_${forma.tipo}`;
                    if (!groupedPayments[key]) {
                        groupedPayments[key] = { valor: 0, parcelas: 0 };
                    }
                    groupedPayments[key].valor += forma.valor;
                    groupedPayments[key].parcelas += 1;
                }
            });

            // Converter grupos em formas de pagamento individuais
            Object.entries(groupedPayments).forEach(([key, dados]) => {
                const [forma, tipo] = key.split('_');
                const valorTotal = dados.valor;
                const numeroParcelas = dados.parcelas;

                if (tipo === 'A_VISTA') {
                    formasPagamento.push({
                        tipo: 'A_VISTA',
                        forma: forma,
                        valor: valorTotal,
                    });
                    console.log(`Adicionado: ${forma} à vista - R$ ${valorTotal}`);
                } else {
                    // Para parcelados, criar uma entrada com o valor total
                    formasPagamento.push({
                        tipo: 'PARCELADO',
                        forma: forma,
                        valor: valorTotal,
                        parcelas: numeroParcelas,
                    });
                    console.log(`Adicionado: ${forma} parcelado - R$ ${valorTotal} em ${numeroParcelas}x`);
                }
            });

            console.log('Formas processadas:', formasPagamento);
            return formasPagamento;
        }

        // Processar formas de pagamento baseado nos valores_formas_pagamento
        if (criarContratoDto.valores_formas_pagamento) {
            const valoresFormas = criarContratoDto.valores_formas_pagamento;
            console.log('Processando valores_formas_pagamento');

            // Processar pagamentos à vista
            const formasAVista = [
                { chave: 'À Vista - Cartão de Crédito', forma: 'CARTAO_CREDITO' },
                { chave: 'À Vista - Cartão de Débito', forma: 'CARTAO_DEBITO' },
                { chave: 'À Vista - PIX/Transferência', forma: 'PIX' },
                { chave: 'À Vista - Espécie', forma: 'DINHEIRO' },
            ];

            formasAVista.forEach(({ chave, forma }) => {
                if (valoresFormas[chave] && valoresFormas[chave].valor) {
                    const valor = parseInt(valoresFormas[chave].valor) / 100;
                    if (valor > 0) {
                        formasPagamento.push({
                            tipo: 'A_VISTA',
                            forma: forma,
                            valor: valor,
                        });
                        console.log(`Adicionado: ${forma} à vista - R$ ${valor}`);
                    }
                }
            });

            // Processar pagamentos parcelados - Cartão de Crédito
            if (valoresFormas['Parcelado - Cartão de Crédito'] && valoresFormas['Parcelado - Cartão de Crédito'].valor) {
                const valorTotal = parseInt(valoresFormas['Parcelado - Cartão de Crédito'].valor) / 100;
                const numeroParcelas = parseInt(valoresFormas['Parcelado - Cartão de Crédito'].numero_parcelas) || 1;
                const valorParcela = valorTotal / numeroParcelas;

                for (let i = 0; i < numeroParcelas; i++) {
                    formasPagamento.push({
                        tipo: 'PARCELADO',
                        forma: 'CARTAO_CREDITO',
                        valor: valorParcela,
                    });
                }
                console.log(`Adicionado: Cartão de Crédito parcelado - ${numeroParcelas}x de R$ ${valorParcela}`);
            }

            // Processar boleto parcelado usando a função específica
            const boletoParcelado = this.processBoletoParcelado(valoresFormas);
            formasPagamento.push(...boletoParcelado);
        }

        console.log('=== RESULTADO FINAL PROCESSAMENTO ===');
        console.log('Formas pagamento finais:', formasPagamento);
        return formasPagamento;
    }

    /**
     * Determina se deve mostrar "NÃO SE APLICA" baseado nos tipos de bônus selecionados
     */
    private shouldShowNaoAplica(criarContratoDto: CriarContratoZapSignDto): boolean {
        const tiposBonus = criarContratoDto.tipos_bonus || [];
        const bonusSelecionados = (criarContratoDto as any).bonus_selecionados || [];

        // Se não há tipos de bônus ou se apenas 'nao_aplica' está selecionado
        if (tiposBonus.length === 0 && bonusSelecionados.length === 0) {
            return true;
        }

        if (tiposBonus.includes('nao_aplica') && tiposBonus.length === 1) {
            return true;
        }

        // Se há outros tipos de bônus selecionados, não mostra "NÃO SE APLICA"
        return false;
    }

    /**
     * Obtém a data do IPR baseado nos dados fornecidos
     */
    private getIprData(criarContratoDto: CriarContratoZapSignDto, turma: any): string {
        // Primeiro, verifica se há data específica nos campos variáveis
        if (criarContratoDto.campos_variaveis?.data_ipr) {
            return this.contractTemplateService.formatDate(criarContratoDto.campos_variaveis.data_ipr);
        }

        // Verifica se há data prevista do treinamento nos campos variáveis
        if (criarContratoDto.campos_variaveis?.['Data Prevista do Treinamento']) {
            return criarContratoDto.campos_variaveis['Data Prevista do Treinamento'];
        }

        // Se não há, usa a data da turma
        if (turma?.data_inicio) {
            return this.contractTemplateService.formatDate(turma.data_inicio);
        }

        return '';
    }

    /**
     * Obtém a descrição dos outros bônus
     */
    private getOutrosDescricao(criarContratoDto: CriarContratoZapSignDto): string {
        // Verifica em diferentes campos possíveis
        const camposVariaveis = criarContratoDto.campos_variaveis || {};

        return camposVariaveis['Descrição do Outro Bônus'] || camposVariaveis['outros_descricao'] || camposVariaveis['descricao_outros'] || '';
    }

    /**
     * Verifica se um bônus foi selecionado (considera tanto tipos_bonus quanto bonus_selecionados)
     */
    private isBonusSelected(criarContratoDto: CriarContratoZapSignDto, bonusTypes: string[]): boolean {
        const tiposBonus = criarContratoDto.tipos_bonus || [];
        const bonusSelecionados = (criarContratoDto as any).bonus_selecionados || [];

        // Verifica se algum dos tipos de bônus está presente em qualquer um dos arrays
        return bonusTypes.some((bonusType) => tiposBonus.includes(bonusType) || bonusSelecionados.includes(bonusType));
    }

    /**
     * Obtém a cidade do treinamento dos campos variáveis ou dados do treinamento
     */
    private getTreinamentoCidade(criarContratoDto: CriarContratoZapSignDto, treinamento: any): string {
        return criarContratoDto.campos_variaveis?.['Cidade do Treinamento'] || treinamento.cidade || 'Americana/SP';
    }

    /**
     * Obtém a data de início do treinamento dos campos variáveis ou dados do treinamento
     */
    private getTreinamentoDataInicio(criarContratoDto: CriarContratoZapSignDto, treinamento: any): string {
        return criarContratoDto.campos_variaveis?.['Data Prevista do Treinamento'] || this.contractTemplateService.formatDate(treinamento.data_inicio) || '';
    }

    /**
     * Obtém a data de fim do treinamento dos campos variáveis ou dados do treinamento
     */
    private getTreinamentoDataFim(criarContratoDto: CriarContratoZapSignDto, treinamento: any): string {
        return criarContratoDto.campos_variaveis?.['Data Final do Treinamento'] || this.contractTemplateService.formatDate(treinamento.data_fim) || '';
    }

    /**
     * Calcula o valor real pago baseado nas formas de pagamento
     */
    private calculateRealPaidValue(criarContratoDto: CriarContratoZapSignDto): string {
        // Por enquanto, retorna o valor total do contrato como valor pago
        // Isso pode ser modificado para considerar apenas valores efetivamente pagos
        const totalValue = this.calculateContractPrice(criarContratoDto);
        return totalValue;
    }

    /**
     * Obtém a forma de pagamento selecionada em texto legível
     */
    private getSelectedPaymentMethod(criarContratoDto: CriarContratoZapSignDto): string {
        if (!criarContratoDto.formas_pagamento || !Array.isArray(criarContratoDto.formas_pagamento) || criarContratoDto.formas_pagamento.length === 0) {
            return 'Não informado';
        }

        const formasPagamento = criarContratoDto.formas_pagamento;
        const primeiraForma = formasPagamento[0];

        // Mapear códigos para nomes legíveis
        const formaMapping: Record<string, string> = {
            CARTAO_CREDITO: 'Cartão de Crédito',
            CARTAO_DEBITO: 'Cartão de Débito',
            PIX: 'PIX/Transferência',
            ESPECIE: 'Espécie',
            BOLETO: 'Boleto',
        };

        const tipoMapping: Record<string, string> = {
            A_VISTA: 'À Vista',
            PARCELADO: 'Parcelado',
        };

        const forma = formaMapping[primeiraForma.forma] || primeiraForma.forma;
        const tipo = tipoMapping[(primeiraForma as any).tipo] || (primeiraForma as any).tipo;

        if ((primeiraForma as any).tipo === 'PARCELADO') {
            const numeroParcelas = formasPagamento.length;
            return `${forma} ${tipo} (${numeroParcelas} parcelas)`;
        }

        return `${forma} ${tipo}`;
    }

    /**
     * Gera os detalhes das formas de pagamento no formato de lista
     */
    private generatePaymentDetails(criarContratoDto: CriarContratoZapSignDto): string {
        console.log('=== GERANDO DETALHES DE PAGAMENTO ===');
        console.log('Formas pagamento:', JSON.stringify(criarContratoDto.formas_pagamento, null, 2));
        console.log('Valores formas pagamento:', JSON.stringify(criarContratoDto.valores_formas_pagamento, null, 2));

        // Primeiro, tentar usar formas_pagamento se disponível
        if (criarContratoDto.formas_pagamento && Array.isArray(criarContratoDto.formas_pagamento) && criarContratoDto.formas_pagamento.length > 0) {
            console.log('Usando formas_pagamento para gerar detalhes');
            const formasPagamento = criarContratoDto.formas_pagamento;

            // Agrupar formas de pagamento por tipo e forma
            const groupedPayments: { [key: string]: { valor: number; count: number; tipo: string; forma: string } } = {};

            formasPagamento.forEach((pagamento: any) => {
                const key = `${pagamento.forma}_${pagamento.tipo}`;
                if (!groupedPayments[key]) {
                    groupedPayments[key] = {
                        valor: 0,
                        count: 0,
                        tipo: pagamento.tipo,
                        forma: pagamento.forma,
                    };
                }
                groupedPayments[key].valor += pagamento.valor;
                groupedPayments[key].count += 1;
            });

            // Gerar lista de detalhes
            const details: string[] = [];

            Object.values(groupedPayments).forEach((group) => {
                const valorFormatado = this.contractTemplateService.formatPrice(group.valor);
                const formaNome = this.getFormaPagamentoNome(group.forma);

                if (group.tipo === 'PARCELADO') {
                    const valorParcela = this.contractTemplateService.formatPrice(group.valor / group.count);
                    details.push(`• ${valorFormatado} no ${formaNome} em ${group.count}x de ${valorParcela}`);
                } else {
                    details.push(`• ${valorFormatado} no ${formaNome}`);
                }
            });

            console.log('Detalhes gerados:', details);
            return details.join('<br>');
        }

        // Fallback: usar valores_formas_pagamento
        if (criarContratoDto.valores_formas_pagamento) {
            console.log('Usando valores_formas_pagamento para gerar detalhes');
            return this.generatePaymentDetailsFromValoresFormas(criarContratoDto.valores_formas_pagamento, criarContratoDto.campos_variaveis || {});
        }

        console.log('Nenhuma forma de pagamento encontrada');
        return '• Não informado';
    }

    /**
     * Converte código da forma de pagamento para nome legível
     */
    private getFormaPagamentoNome(codigo: string): string {
        const mapping: Record<string, string> = {
            CARTAO_CREDITO: 'Cartão de Crédito',
            CARTAO_DEBITO: 'Cartão de Débito',
            PIX: 'PIX/Transferência',
            DINHEIRO: 'Espécie',
            ESPECIE: 'Espécie',
            BOLETO: 'Boleto',
        };
        return mapping[codigo] || codigo;
    }

    /**
     * Converte código do tipo de pagamento para nome legível
     */
    private getTipoPagamentoNome(codigo: string): string {
        const mapping: Record<string, string> = {
            A_VISTA: 'À Vista',
            PARCELADO: 'Parcelado',
        };
        return mapping[codigo] || codigo;
    }

    /**
     * Gera um contrato PDF usando dados salvos no banco
     */
    async gerarContratoPDF(contratoId: string): Promise<Buffer> {
        try {
            console.log('=== GERANDO CONTRATO PDF ===');
            console.log('ID do contrato:', contratoId);

            // Buscar contrato completo do banco
            const contrato = await this.buscarContratoCompleto(contratoId);

            if (!contrato) {
                throw new NotFoundException('Contrato não encontrado');
            }

            // Preparar dados para o template usando dados salvos
            const templateData = this.prepareTemplateDataFromSavedContract(contrato);

            // Gerar PDF usando o template
            const pdfBuffer = await this.contractTemplateService.generateContractPDF(templateData);

            console.log('PDF gerado com sucesso. Tamanho:', pdfBuffer.length, 'bytes');
            return pdfBuffer;
        } catch (error) {
            console.error('Erro ao gerar contrato PDF:', error);
            throw new BadRequestException(`Erro ao gerar contrato PDF: ${(error as Error).message}`);
        }
    }

    /**
     * Cancela um documento do ZapSign e faz soft delete no banco
     */
    async cancelarDocumentoZapSign(documentoId: string, userId?: number): Promise<{ message: string }> {
        try {
            console.log('=== CANCELANDO DOCUMENTO ZAPSIGN ===');
            console.log('ID do documento:', documentoId);

            // Primeiro, vamos listar todos os contratos para debug
            const todosContratos = await this.uow.turmasAlunosTreinamentosContratosRP
                .createQueryBuilder('contrato')
                .where('contrato.deletado_em IS NULL')
                .select(['contrato.id', 'contrato.dados_contrato'])
                .getMany();

            console.log('=== DEBUG: TODOS OS CONTRATOS ===');
            console.log('Total de contratos encontrados:', todosContratos.length);

            todosContratos.forEach((c, index) => {
                const dadosContrato = c.dados_contrato;
                console.log(`Contrato ${index + 1}:`, {
                    id: c.id,
                    dados_contrato: dadosContrato,
                    zapsign_document_id: dadosContrato?.zapsign_document_id || 'N/A',
                });
            });

            // Usar query builder para buscar contrato pelo zapsign_document_id específico
            const contrato = await this.uow.turmasAlunosTreinamentosContratosRP
                .createQueryBuilder('contrato')
                .where('contrato.deletado_em IS NULL')
                .andWhere('contrato.zapsign_document_id = :documentoId', { documentoId })
                .select(['contrato.id', 'contrato.zapsign_document_id', 'contrato.dados_contrato'])
                .getOne();

            if (!contrato) {
                console.log('Contrato não encontrado para o document_id:', documentoId);
                console.log('Tentando buscar por ID numérico...');

                // Tentar buscar por ID numérico também
                const contratoPorId = await this.uow.turmasAlunosTreinamentosContratosRP
                    .createQueryBuilder('contrato')
                    .where('contrato.deletado_em IS NULL')
                    .andWhere('contrato.id = :documentoId', { documentoId: parseInt(documentoId) })
                    .select(['contrato.id', 'contrato.dados_contrato'])
                    .getOne();

                if (contratoPorId) {
                    console.log('Contrato encontrado por ID numérico:', contratoPorId.id);
                    // Usar o contrato encontrado por ID
                    const contratoEncontrado = contratoPorId;

                    // Cancelar documento no ZapSign usando o zapsign_document_id específico
                    const documentIdZapSign = contratoEncontrado.zapsign_document_id || contratoEncontrado.dados_contrato?.zapsign_document_id;
                    if (documentIdZapSign) {
                        await this.zapSignService.cancelDocument(documentIdZapSign);
                        console.log('Documento cancelado no ZapSign com sucesso');
                    }

                    // Fazer soft delete no banco
                    await this.uow.turmasAlunosTreinamentosContratosRP.update(contratoEncontrado.id, {
                        deletado_em: new Date(),
                        atualizado_por: userId,
                    });

                    console.log('Contrato removido do banco (soft delete)');
                    return { message: 'Documento cancelado e removido com sucesso' };
                } else {
                    throw new NotFoundException('Contrato não encontrado no banco de dados');
                }
            }

            console.log('Contrato encontrado no banco:', contrato.id);

            // Cancelar documento no ZapSign
            await this.zapSignService.cancelDocument(documentoId);
            console.log('Documento cancelado no ZapSign com sucesso');

            // Fazer soft delete no banco (atualizar deleted_em)
            await this.uow.turmasAlunosTreinamentosContratosRP.update(contrato.id, {
                deletado_em: new Date(),
                atualizado_por: userId,
            });

            console.log('Contrato removido do banco (soft delete)');

            return { message: 'Documento cancelado e removido com sucesso' };
        } catch (error) {
            console.error('Erro ao cancelar documento:', error);
            throw new BadRequestException(`Erro ao cancelar documento: ${(error as Error).message}`);
        }
    }

    /**
     * Exclui um contrato do ZapSign e faz soft delete no banco
     */
    async excluirDocumentoZapSign(contratoId: string, userId?: number): Promise<{ message: string }> {
        try {
            console.log('=== EXCLUINDO CONTRATO ZAPSIGN ===');
            console.log('ID do contrato:', contratoId);

            // Buscar o contrato no banco de dados
            const contrato = await this.uow.turmasAlunosTreinamentosContratosRP
                .createQueryBuilder('contrato')
                .where('contrato.deletado_em IS NULL')
                .andWhere('contrato.id = :contratoId', { contratoId: parseInt(contratoId) })
                .select(['contrato.id', 'contrato.zapsign_document_id', 'contrato.dados_contrato'])
                .getOne();

            if (!contrato) {
                throw new NotFoundException('Contrato não encontrado');
            }

            console.log('Contrato encontrado no banco:', contrato.id);

            // Remover documento da Zapsign se existir
            const documentIdZapSign = contrato.zapsign_document_id || contrato.dados_contrato?.zapsign_document_id;
            if (documentIdZapSign) {
                try {
                    await this.zapSignService.excluirDocumento(documentIdZapSign);
                    console.log('Documento removido da Zapsign:', documentIdZapSign);
                } catch (zapSignError) {
                    console.error('Erro ao remover da Zapsign:', zapSignError);
                    // Continuar mesmo se falhar na Zapsign
                }
            }

            // Fazer soft delete do contrato
            await this.uow.turmasAlunosTreinamentosContratosRP.update(contrato.id, {
                deletado_em: new Date(),
                atualizado_por: userId,
            });

            console.log('Contrato excluído com sucesso');
            return { message: 'Contrato excluído com sucesso' };
        } catch (error) {
            console.error('Erro ao excluir contrato:', error);
            throw new BadRequestException(`Erro ao excluir contrato: ${(error as Error).message}`);
        }
    }

    /**
     * Prepara dados para o template usando dados salvos no banco
     */
    private prepareTemplateDataFromSavedContract(contrato: any) {
        console.log('=== PREPARANDO DADOS DO CONTRATO SALVO ===');
        console.log('Dados do contrato:', JSON.stringify(contrato, null, 2));

        // Usar diretamente os dados salvos no banco
        return {
            aluno: contrato.aluno || {},
            treinamento: contrato.treinamento || {},
            pagamento: contrato.pagamento || {},
            formas_pagamento: contrato.formas_pagamento || [],
            valores_formas_pagamento: contrato.valores_formas_pagamento || {},
            bonus_selecionados: contrato.bonus_selecionados || [],
            valores_bonus: contrato.valores_bonus || {},
            campos_variaveis: contrato.campos_variaveis || {},
            testemunhas: contrato.testemunhas || {},
            observacoes: contrato.observacoes || '',
            clausulas: contrato.clausulas || '',
            assinatura_aluno_base64: contrato.assinatura_aluno_base64 || '',
            assinatura_testemunha_um_base64: contrato.assinatura_testemunha_um_base64 || '',
            assinatura_testemunha_dois_base64: contrato.assinatura_testemunha_dois_base64 || '',
        };
    }

    /**
     * Métodos auxiliares para processar dados salvos no banco
     */
    private getTreinamentoCidadeFromSaved(dadosContrato: any): string {
        return dadosContrato.campos_variaveis?.['Cidade do Treinamento'] || 'Americana/SP';
    }

    private getTreinamentoDataInicioFromSaved(dadosContrato: any): string {
        return dadosContrato.campos_variaveis?.['Data Prevista do Treinamento'] || '';
    }

    private getTreinamentoDataFimFromSaved(dadosContrato: any): string {
        return dadosContrato.campos_variaveis?.['Data Final do Treinamento'] || '';
    }

    private calculateContractPriceFromSaved(dadosContrato: any): string {
        if (!dadosContrato.formas_pagamento || !Array.isArray(dadosContrato.formas_pagamento)) {
            return 'R$ 0,00';
        }

        let total = 0;
        dadosContrato.formas_pagamento.forEach((pagamento: any) => {
            if (pagamento.valor) {
                total += pagamento.valor;
            }
        });

        return this.contractTemplateService.formatPrice(total);
    }

    private calculateRealPaidValueFromSaved(dadosContrato: any): string {
        return this.calculateContractPriceFromSaved(dadosContrato);
    }

    private getSelectedPaymentMethodFromSaved(dadosContrato: any): string {
        if (!dadosContrato.formas_pagamento || !Array.isArray(dadosContrato.formas_pagamento) || dadosContrato.formas_pagamento.length === 0) {
            return 'Não informado';
        }

        const primeiraForma = dadosContrato.formas_pagamento[0];
        const forma = this.getFormaPagamentoNome(primeiraForma.forma);
        const tipo = this.getTipoPagamentoNome(primeiraForma.tipo);

        if (primeiraForma.tipo === 'PARCELADO') {
            const numeroParcelas = dadosContrato.formas_pagamento.length;
            return `${forma} ${tipo} (${numeroParcelas} parcelas)`;
        }

        return `${forma} ${tipo}`;
    }

    /**
     * Gera detalhes de pagamento a partir de valores_formas_pagamento (fallback)
     */
    private generatePaymentDetailsFromValoresFormas(valoresFormas: any, camposVariaveis: any): string {
        console.log('=== GERANDO DETALHES PAGAMENTO A PARTIR DE VALORES_FORMAS_PAGAMENTO ===');
        console.log('Valores formas:', JSON.stringify(valoresFormas, null, 2));

        const details: string[] = [];

        // Processar pagamentos à vista
        Object.keys(valoresFormas).forEach((key) => {
            if (key.includes('À Vista') && valoresFormas[key] && valoresFormas[key].valor) {
                const valor = this.contractTemplateService.formatPrice(valoresFormas[key].valor / 100);
                let formaNome = '';

                if (key.includes('Cartão de Crédito')) formaNome = 'Cartão de Crédito';
                else if (key.includes('Cartão de Débito')) formaNome = 'Cartão de Débito';
                else if (key.includes('PIX')) formaNome = 'PIX/Transferência';
                else if (key.includes('Espécie')) formaNome = 'Espécie';

                if (formaNome) {
                    details.push(`• ${valor} no ${formaNome} à vista`);
                }
            }
        });

        // Processar pagamentos parcelados
        Object.keys(valoresFormas).forEach((key) => {
            if (key.includes('Parcelado') && valoresFormas[key]) {
                let valor,
                    numeroParcelas,
                    valorParcela,
                    formaNome = '';

                // Processar Cartão de Crédito parcelado
                if (key.includes('Cartão de Crédito') && valoresFormas[key].valor) {
                    valor = this.contractTemplateService.formatPrice(valoresFormas[key].valor / 100);
                    numeroParcelas = valoresFormas[key].numero_parcelas || 1;
                    valorParcela = this.contractTemplateService.formatPrice(valoresFormas[key].valor / 100 / numeroParcelas);
                    formaNome = 'Cartão de Crédito';
                }
                // Processar Boleto parcelado
                else if (key.includes('Boleto') && valoresFormas[key].valor_parcelas) {
                    valor = this.contractTemplateService.formatPrice(valoresFormas[key].valor_parcelas / 100);
                    numeroParcelas = valoresFormas[key].numero_parcelas || 1;
                    valorParcela = this.contractTemplateService.formatPrice(valoresFormas[key].valor_parcelas / 100 / numeroParcelas);
                    formaNome = 'Boleto';
                }

                if (formaNome) {
                    let infoParcela = `• ${valor} no ${formaNome} em ${numeroParcelas}x de ${valorParcela}`;

                    // Adicionar informações específicas do boleto
                    if (key.includes('Boleto')) {
                        const diaVencimento = valoresFormas[key].melhor_dia_vencimento || camposVariaveis?.['Dia de Vencimento do Boleto'];
                        const dataPrimeiroBoleto = valoresFormas[key].data_primeiro_boleto || camposVariaveis?.['Data do Primeiro Boleto'];

                        if (diaVencimento) {
                            infoParcela += ` (vencimento dia ${diaVencimento})`;
                        }

                        if (dataPrimeiroBoleto) {
                            infoParcela += ` - 1° boleto: ${dataPrimeiroBoleto}`;
                        }
                    }

                    details.push(infoParcela);
                }
            }
        });

        console.log('Detalhes gerados:', details);
        return details.length > 0 ? details.join('\n') : '• Não informado';
    }

    private generatePaymentDetailsFromSaved(dadosContrato: any): string {
        console.log('=== DEBUG GERAR DETALHES PAGAMENTO SALVO ===');
        console.log('Dados contrato recebidos:', JSON.stringify(dadosContrato, null, 2));

        // Tentar acessar formas_pagamento de diferentes locais possíveis
        const formasPagamento = dadosContrato.formas_pagamento || dadosContrato.pagamento?.formas_pagamento || [];
        const valoresFormasPagamento = dadosContrato.valores_formas_pagamento || dadosContrato.pagamento?.valores_formas_pagamento || {};
        const camposVariaveis = dadosContrato.campos_variaveis || {};

        console.log('Formas pagamento encontradas:', formasPagamento);
        console.log('Valores formas pagamento:', valoresFormasPagamento);
        console.log('Campos variáveis:', camposVariaveis);
        console.log('Total de formas pagamento encontradas:', formasPagamento.length);
        console.log('Chaves dos valores formas pagamento:', Object.keys(valoresFormasPagamento));

        if (!formasPagamento || !Array.isArray(formasPagamento) || formasPagamento.length === 0) {
            console.log('Nenhuma forma de pagamento encontrada, tentando usar valores_formas_pagamento');

            // Fallback: tentar usar valores_formas_pagamento se formas_pagamento não estiver disponível
            if (valoresFormasPagamento && typeof valoresFormasPagamento === 'object' && Object.keys(valoresFormasPagamento).length > 0) {
                console.log('Usando valores_formas_pagamento como fallback');
                return this.generatePaymentDetailsFromValoresFormas(valoresFormasPagamento, camposVariaveis);
            }

            console.log('Nenhuma forma de pagamento encontrada, retornando "Não informado"');
            return '• Não informado';
        }

        // Agrupar formas de pagamento por tipo e forma
        const groupedPayments: { [key: string]: { valor: number; count: number; tipo: string; forma: string } } = {};

        formasPagamento.forEach((pagamento: any) => {
            const key = `${pagamento.forma}_${pagamento.tipo}`;
            if (!groupedPayments[key]) {
                groupedPayments[key] = {
                    valor: 0,
                    count: 0,
                    tipo: pagamento.tipo,
                    forma: pagamento.forma,
                };
            }
            groupedPayments[key].valor += pagamento.valor;
            groupedPayments[key].count += 1;
        });

        // Gerar lista de detalhes
        const details: string[] = [];

        Object.values(groupedPayments).forEach((group) => {
            const valorFormatado = this.contractTemplateService.formatPrice(group.valor);
            const formaNome = this.getFormaPagamentoNome(group.forma);

            if (group.tipo === 'PARCELADO') {
                const valorParcela = this.contractTemplateService.formatPrice(group.valor / group.count);

                // Adicionar informações específicas do boleto
                if (group.forma === 'BOLETO') {
                    const diaVencimento = camposVariaveis?.['Dia de Vencimento do Boleto'];
                    const dataPrimeiroBoleto = camposVariaveis?.['Data do Primeiro Boleto'];

                    let infoBoleto = `• ${valorFormatado} no ${formaNome} em ${group.count}x de ${valorParcela}`;

                    if (diaVencimento) {
                        infoBoleto += ` (vencimento dia ${diaVencimento})`;
                    }

                    if (dataPrimeiroBoleto) {
                        infoBoleto += ` - 1° boleto: ${dataPrimeiroBoleto}`;
                    }

                    details.push(infoBoleto);
                } else {
                    details.push(`• ${valorFormatado} no ${formaNome} em ${group.count}x de ${valorParcela}`);
                }
            } else {
                details.push(`• ${valorFormatado} no ${formaNome}`);
            }
        });

        return details.join('<br>');
    }

    private shouldShowNaoAplicaFromSaved(dadosContrato: any): boolean {
        const bonusSelecionados = dadosContrato.bonus_selecionados || [];
        return bonusSelecionados.length === 0;
    }

    private isBonusSelectedFromSaved(dadosContrato: any, bonusTypes: string[]): boolean {
        const bonusSelecionados = dadosContrato.bonus_selecionados || [];
        return bonusTypes.some((bonusType) => bonusSelecionados.includes(bonusType));
    }

    private getIprDataFromSaved(dadosContrato: any): string {
        return dadosContrato.campos_variaveis?.['Data Prevista do Treinamento'] || '';
    }

    private getOutrosDescricaoFromSaved(dadosContrato: any): string {
        return dadosContrato.campos_variaveis?.['Descrição do Outro Bônus'] || '';
    }

    private isPaymentMethodSelectedFromSaved(dadosContrato: any, methodName: string): boolean {
        if (!dadosContrato.formas_pagamento || !Array.isArray(dadosContrato.formas_pagamento)) {
            return false;
        }

        const methodMapping: Record<string, { forma: string; tipo: string }> = {
            'À Vista - Cartão de Crédito': { forma: 'CARTAO_CREDITO', tipo: 'A_VISTA' },
            'À Vista - Cartão de Débito': { forma: 'CARTAO_DEBITO', tipo: 'A_VISTA' },
            'À Vista - PIX/Transferência': { forma: 'PIX', tipo: 'A_VISTA' },
            'À Vista - Espécie': { forma: 'ESPECIE', tipo: 'A_VISTA' },
            'Parcelado - Cartão de Crédito': { forma: 'CARTAO_CREDITO', tipo: 'PARCELADO' },
            'Parcelado - Boleto': { forma: 'BOLETO', tipo: 'PARCELADO' },
        };

        const methodConfig = methodMapping[methodName];
        if (methodConfig) {
            return dadosContrato.formas_pagamento.some((forma: any) => forma.forma === methodConfig.forma && forma.tipo === methodConfig.tipo);
        }

        return false;
    }

    async buscarContratoBasico(contratoId: string): Promise<any> {
        try {
            const contratoBasico = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
                where: {
                    id: contratoId,
                    deletado_em: null,
                },
            });

            return contratoBasico;
        } catch (error) {
            console.error('Erro ao buscar contrato básico:', error);
            throw new Error('Erro ao buscar contrato básico');
        }
    }

    async buscarContratoCompleto(contratoId: string): Promise<any> {
        try {
            // Primeiro, vamos buscar o contrato básico
            const contratoBasico = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
                where: {
                    id: contratoId,
                    deletado_em: null,
                },
                relations: [
                    'id_turma_aluno_treinamento_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_aluno_fk',
                    'id_turma_aluno_treinamento_fk.id_treinamento_fk',
                    'id_documento_fk',
                ],
                select: {
                    id: true,
                    id_turma_aluno_treinamento: true,
                    id_documento: true,
                    status_ass_aluno: true,
                    data_ass_aluno: true,
                    testemunha_um: true,
                    status_ass_test_um: true,
                    data_ass_test_um: true,
                    testemunha_dois: true,
                    status_ass_test_dois: true,
                    data_ass_test_dois: true,
                    dados_contrato: true, // Garantir que o campo JSON seja carregado
                    zapsign_document_id: true, // ✅ Campo ZapSign adicionado
                    zapsign_signers_data: true, // ✅ Campo ZapSign adicionado
                    zapsign_document_status: true, // ✅ Campo ZapSign adicionado
                    assinatura_aluno_base64: true,
                    tipo_assinatura_aluno: true,
                    foto_documento_aluno_base64: true,
                    assinatura_testemunha_um_base64: true,
                    tipo_assinatura_testemunha_um: true,
                    assinatura_testemunha_dois_base64: true,
                    tipo_assinatura_testemunha_dois: true,
                    criado_em: true,
                    atualizado_em: true,
                    criado_por: true,
                    atualizado_por: true,
                    deletado_em: true,
                },
            });

            const contrato = contratoBasico;

            if (!contrato) {
                throw new NotFoundException('Contrato não encontrado');
            }

            // Mapear dados para o formato esperado pelo frontend
            const dadosContrato = contrato.dados_contrato || {};
            const turmaAlunoTreinamento = contrato.id_turma_aluno_treinamento_fk;
            const turmaAluno = turmaAlunoTreinamento?.id_turma_aluno_fk;
            const aluno = turmaAluno?.id_aluno_fk;
            const documento = contrato.id_documento_fk;
            const polo = aluno?.id_polo_fk;
            // Buscar treinamento dos dados do contrato ou das relations
            const treinamento = dadosContrato.treinamento || turmaAlunoTreinamento?.id_treinamento_fk || null;

            // Log para debug do treinamento
            console.log('=== DEBUG BUSCAR CONTRATO COMPLETO ===');
            console.log('Treinamento dos dados_contrato:', dadosContrato.treinamento);
            console.log('Treinamento das relations:', turmaAlunoTreinamento?.id_treinamento_fk);
            console.log('Treinamento final usado:', treinamento);
            console.log('Dados contrato completos:', JSON.stringify(dadosContrato, null, 2));
            console.log('Pagamento nos dados contrato:', dadosContrato.pagamento);

            const contratoMapeado = {
                id: contrato.id,
                status_ass_aluno: contrato.status_ass_aluno,
                status_ass_test_um: contrato.status_ass_test_um,
                status_ass_test_dois: contrato.status_ass_test_dois,
                data_ass_aluno: contrato.data_ass_aluno,
                data_ass_test_um: contrato.data_ass_test_um,
                data_ass_test_dois: contrato.data_ass_test_dois,
                criado_em: contrato.criado_em,
                atualizado_em: contrato.atualizado_em,
                // Campos para compatibilidade com frontend
                created_at: contrato.criado_em,
                updated_at: contrato.atualizado_em,
                zapsign_document_id: contrato.zapsign_document_id,
                zapsign_signers_data: contrato.zapsign_signers_data,
                zapsign_document_status: contrato.zapsign_document_status,
                aluno_nome: aluno?.nome,
                treinamento_nome: treinamento?.treinamento,
                dados_contrato: {
                    aluno: {
                        id: aluno?.id,
                        nome: aluno?.nome,
                        cpf: aluno?.cpf,
                        email: aluno?.email,
                        data_nascimento: aluno?.data_nascimento,
                        telefone_um: aluno?.telefone_um,
                        polo: {
                            id: polo?.id,
                            cidade: polo?.cidade,
                            estado: polo?.estado,
                        },
                        endereco: dadosContrato.aluno?.endereco || {
                            logradouro: aluno?.logradouro || '',
                            numero: aluno?.numero || '',
                            complemento: aluno?.complemento || '',
                            bairro: aluno?.bairro || '',
                            cidade: aluno?.cidade || '',
                            estado: aluno?.estado || '',
                            cep: aluno?.cep || '',
                        },
                    },
                    treinamento: {
                        id: treinamento?.id,
                        nome: treinamento?.treinamento,
                        sigla: treinamento?.sigla_treinamento,
                        preco: treinamento?.preco_treinamento,
                        url_logo_treinamento: treinamento?.url_logo_treinamento,
                    },
                    template: {
                        id: documento?.id,
                        nome: documento?.documento,
                        clausulas: documento?.clausulas,
                    },
                    pagamento: {
                        forma_pagamento: dadosContrato.pagamento?.forma_pagamento || dadosContrato.forma_pagamento || 'A_VISTA',
                        formas_pagamento: dadosContrato.pagamento?.formas_pagamento || dadosContrato.formas_pagamento || [],
                        valores_formas_pagamento: dadosContrato.pagamento?.valores_formas_pagamento || dadosContrato.valores_formas_pagamento || {},
                    },
                    // Garantir que os dados de pagamento estejam disponíveis no nível raiz também
                    forma_pagamento: dadosContrato.pagamento?.forma_pagamento || dadosContrato.forma_pagamento || 'A_VISTA',
                    formas_pagamento: dadosContrato.pagamento?.formas_pagamento || dadosContrato.formas_pagamento || [],
                    valores_formas_pagamento: dadosContrato.pagamento?.valores_formas_pagamento || dadosContrato.valores_formas_pagamento || {},
                    testemunhas: dadosContrato.testemunhas || {},
                    campos_variaveis: dadosContrato.campos_variaveis || {},
                    bonus_selecionados: dadosContrato.bonus_selecionados || [],
                    valores_bonus: dadosContrato.valores_bonus || {},
                    bonus: {
                        tipos_bonus: dadosContrato.bonus_selecionados || [],
                        valores_bonus: dadosContrato.valores_bonus || {},
                        turma_bonus_info: dadosContrato.turma_bonus_info || null,
                    },
                    observacoes: dadosContrato.observacoes || '',
                    data_inicio_treinamento: dadosContrato.data_inicio_treinamento,
                    data_final_treinamento: dadosContrato.data_final_treinamento,
                    cidade_treinamento: dadosContrato.cidade_treinamento,
                },
            };

            console.log('Contrato mapeado final:', JSON.stringify(contratoMapeado, null, 2));
            return contratoMapeado;
        } catch (error) {
            console.error('Erro ao buscar contrato completo:', error);
            throw new Error('Erro ao buscar contrato completo');
        }
    }

    async listarContratosBanco(filtros?: {
        page?: number;
        limit?: number;
        id_aluno?: string;
        id_treinamento?: string;
        status?: string;
        data_inicio?: string;
        data_fim?: string;
    }): Promise<{
        data: any[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    }> {
        try {
            const page = filtros?.page || 1;
            const limit = filtros?.limit || 10;
            const offset = (page - 1) * limit;

            // Primeiro, vamos verificar quantos contratos existem no total
            const totalContratos = await this.uow.turmasAlunosTreinamentosContratosRP.count({
                where: { deletado_em: null },
            });

            // Usar find com relations para garantir que os relacionamentos sejam carregados
            const contratos = await this.uow.turmasAlunosTreinamentosContratosRP.find({
                where: { deletado_em: null },
                relations: [
                    'id_turma_aluno_treinamento_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_aluno_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_aluno_fk.id_polo_fk',
                    'id_turma_aluno_treinamento_fk.id_treinamento_fk',
                    'id_documento_fk',
                ],
                order: { criado_em: 'DESC' },
                skip: offset,
                take: limit,
            });

            // Contar total (simplificado para teste)
            const total = await this.uow.turmasAlunosTreinamentosContratosRP.count({
                where: { deletado_em: null },
            });

            // Mapear dados para o formato esperado pelo frontend
            const contratosMapeados = contratos.map((contrato) => {
                const dadosContrato = contrato.dados_contrato || {};
                const turmaAlunoTreinamento = contrato.id_turma_aluno_treinamento_fk;
                const turmaAluno = turmaAlunoTreinamento?.id_turma_aluno_fk;
                const aluno = turmaAluno?.id_aluno_fk;
                const documento = contrato.id_documento_fk;
                const polo = aluno?.id_polo_fk;

                // Usar treinamento das relations ou dos dados do contrato
                const treinamento = turmaAlunoTreinamento?.id_treinamento_fk || dadosContrato.treinamento || null;

                return {
                    id: contrato.id,
                    status_ass_aluno: contrato.status_ass_aluno,
                    status_ass_test_um: contrato.status_ass_test_um,
                    status_ass_test_dois: contrato.status_ass_test_dois,
                    data_ass_aluno: contrato.data_ass_aluno,
                    data_ass_test_um: contrato.data_ass_test_um,
                    data_ass_test_dois: contrato.data_ass_test_dois,
                    criado_em: contrato.criado_em,
                    atualizado_em: contrato.atualizado_em,
                    // Campos para compatibilidade com frontend
                    created_at: contrato.criado_em,
                    updated_at: contrato.atualizado_em,
                    zapsign_document_id: contrato.zapsign_document_id,
                    zapsign_signers_data: contrato.zapsign_signers_data,
                    zapsign_document_status: contrato.zapsign_document_status,
                    // Campos diretos para compatibilidade com frontend
                    aluno_nome: aluno?.nome,
                    treinamento_nome: treinamento?.treinamento,
                    dados_contrato: {
                        aluno: {
                            id: aluno?.id,
                            nome: aluno?.nome,
                            cpf: aluno?.cpf,
                            email: aluno?.email,
                            data_nascimento: aluno?.data_nascimento,
                            telefone_um: aluno?.telefone_um,
                            polo: {
                                id: polo?.id,
                                cidade: polo?.cidade,
                                estado: polo?.estado,
                            },
                            endereco: dadosContrato.aluno?.endereco || {
                                logradouro: aluno?.logradouro || '',
                                numero: aluno?.numero || '',
                                complemento: aluno?.complemento || '',
                                bairro: aluno?.bairro || '',
                                cidade: aluno?.cidade || polo?.cidade || '',
                                estado: aluno?.estado || polo?.estado || '',
                                cep: aluno?.cep || '',
                            },
                        },
                        treinamento: {
                            id: treinamento?.id,
                            nome: treinamento?.treinamento,
                            sigla: treinamento?.sigla_treinamento,
                            preco: treinamento?.preco_treinamento,
                            url_logo_treinamento: treinamento?.url_logo_treinamento,
                        },
                        template: {
                            id: documento?.id,
                            nome: documento?.documento,
                            clausulas: documento?.clausulas,
                        },
                        pagamento: {
                            forma_pagamento: dadosContrato.pagamento?.forma_pagamento || dadosContrato.forma_pagamento || 'A_VISTA',
                            formas_pagamento: dadosContrato.pagamento?.formas_pagamento || dadosContrato.formas_pagamento || [],
                            valores_formas_pagamento: dadosContrato.pagamento?.valores_formas_pagamento || dadosContrato.valores_formas_pagamento || {},
                        },
                        testemunhas: dadosContrato.testemunhas || {},
                        campos_variaveis: dadosContrato.campos_variaveis || {},
                        formas_pagamento: dadosContrato.formas_pagamento || [],
                        valores_formas_pagamento: dadosContrato.valores_formas_pagamento || {},
                        bonus_selecionados: dadosContrato.bonus_selecionados || [],
                        valores_bonus: dadosContrato.valores_bonus || {},
                        bonus: {
                            tipos_bonus: dadosContrato.bonus_selecionados || [],
                            valores_bonus: dadosContrato.valores_bonus || {},
                            turma_bonus_info: dadosContrato.turma_bonus_info || null,
                        },
                        observacoes: dadosContrato.observacoes || '',
                        data_inicio_treinamento: dadosContrato.data_inicio_treinamento,
                        data_final_treinamento: dadosContrato.data_final_treinamento,
                        cidade_treinamento: dadosContrato.cidade_treinamento,
                    },
                };
            });

            const totalPages = Math.ceil(total / limit);

            const resultado = {
                data: contratosMapeados,
                total,
                page,
                limit,
                totalPages,
            };

            console.log('Retornando resultado:', JSON.stringify(resultado, null, 2));
            return resultado;
        } catch (error) {
            console.error('Erro ao listar contratos do banco:', error);
            throw new Error('Erro ao listar contratos do banco de dados');
        }
    }

    async enviarContratoPorEmail(email: string, nomeSignatario: string, signingUrl: string): Promise<void> {
        try {
            await this.mailService.sendContractEmail(email, nomeSignatario, signingUrl);
        } catch (error) {
            console.error('Erro ao enviar email de contrato:', error);

            // Verificar se é erro de configuração SMTP
            if (error instanceof Error && error.message && error.message.includes('SMTP não configurado')) {
                throw new BadRequestException('Serviço de email não configurado. Configure as variáveis MAIL_HOST, MAIL_PORT, MAIL_USER e MAIL_PASS');
            }

            // Verificar se é erro de autenticação (credenciais inválidas)
            // O nodemailer retorna o código EAUTH em error.code
            const errorObj = error as any;
            if (
                errorObj?.code === 'EAUTH' ||
                (error instanceof Error &&
                    error.message &&
                    (error.message.includes('EAUTH') || error.message.includes('Bad Credentials') || error.message.includes('Username and Password not accepted')))
            ) {
                throw new BadRequestException('Credenciais de email inválidas. Verifique MAIL_USER e MAIL_PASS. Para Gmail, use uma App Password.');
            }

            throw new BadRequestException('Erro ao enviar email de contrato. Verifique as configurações MAIL_* no servidor.');
        }
    }

    private mapToResponseDto(documento: Documentos): DocumentoResponseDto {
        return {
            id: documento.id,
            documento: documento.documento,
            tipo_documento: documento.tipo_documento,
            campos: documento.campos || [],
            clausulas: documento.clausulas || '',
            treinamentos_relacionados: documento.treinamentos_relacionados || [],
            created_at: documento.criado_em,
            updated_at: documento.atualizado_em,
            criado_por: documento.criado_por,
            atualizado_por: documento.atualizado_por,
            deletado_em: documento.deletado_em,
        };
    }
}
