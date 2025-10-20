import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { Documentos } from '@/modules/config/entities/documentos.entity';
import { TurmasAlunosTreinamentosContratos } from '@/modules/config/entities/turmasAlunosTreinamentosContratos.entity';
import { EStatusAssinaturasContratos } from '@/modules/config/entities/enum';
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

@Injectable()
export class DocumentosService {
    constructor(
        private readonly uow: UnitOfWorkService,
        private readonly zapSignService: ZapSignService,
        private readonly contractTemplateService: ContractTemplateService,
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

            // Preparar dados para o template
            const templateData = this.prepareTemplateData(aluno, treinamento, turma, criarContratoDto);

            // Gerar PDF usando o novo template
            console.log('=== GERANDO PDF DO CONTRATO ===');
            const pdfBuffer = await this.contractTemplateService.generateContractPDF(templateData);
            console.log('PDF gerado com sucesso. Tamanho:', pdfBuffer.length, 'bytes');
            console.log('PDF é um Buffer:', Buffer.isBuffer(pdfBuffer));

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
            if (criarContratoDto.testemunha_um_id) {
                const testemunhaUm = await this.uow.alunosRP.findOne({
                    where: { id: parseInt(criarContratoDto.testemunha_um_id), deletado_em: null },
                });
                if (testemunhaUm) {
                    signers.push({
                        name: testemunhaUm.nome,
                        email: testemunhaUm.email,
                        phone: testemunhaUm.telefone_um,
                        action: 'sign' as const,
                    });
                }
            } else if (criarContratoDto.testemunha_um_nome && criarContratoDto.testemunha_um_cpf) {
                signers.push({
                    name: criarContratoDto.testemunha_um_nome,
                    email: '', // Deixar email vazio quando apenas CPF é preenchido
                    phone: '',
                    action: 'sign' as const,
                });
            }

            if (criarContratoDto.testemunha_dois_id) {
                const testemunhaDois = await this.uow.alunosRP.findOne({
                    where: { id: parseInt(criarContratoDto.testemunha_dois_id), deletado_em: null },
                });
                if (testemunhaDois) {
                    signers.push({
                        name: testemunhaDois.nome,
                        email: testemunhaDois.email,
                        phone: testemunhaDois.telefone_um,
                        action: 'sign' as const,
                    });
                }
            } else if (criarContratoDto.testemunha_dois_nome && criarContratoDto.testemunha_dois_cpf) {
                signers.push({
                    name: criarContratoDto.testemunha_dois_nome,
                    email: '', // Deixar email vazio quando apenas CPF é preenchido
                    phone: '',
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

            // Log para debug das testemunhas
            console.log('=== DEBUG TESTEMUNHAS ===');
            console.log('testemunha_um_nome:', criarContratoDto.testemunha_um_nome);
            console.log('testemunha_um_cpf:', criarContratoDto.testemunha_um_cpf);
            console.log('testemunha_um_id:', criarContratoDto.testemunha_um_id);
            console.log('testemunha_dois_nome:', criarContratoDto.testemunha_dois_nome);
            console.log('testemunha_dois_cpf:', criarContratoDto.testemunha_dois_cpf);
            console.log('testemunha_dois_id:', criarContratoDto.testemunha_dois_id);

            // Processar dados de bônus completos
            const bonusData = this.processBonusData(criarContratoDto, turma);

            // Processar dados específicos do boleto
            const boletoData = this.processBoletoData(criarContratoDto);
            bonusData.campos_variaveis = { ...bonusData.campos_variaveis, ...boletoData };

            // Salvar informações do contrato no banco de dados
            const contrato = this.uow.turmasAlunosTreinamentosContratosRP.create({
                id_turma_aluno_treinamento: '1', // Será necessário buscar ou criar o registro correto
                id_documento: parseInt(criarContratoDto.template_id),
                status_ass_aluno: EStatusAssinaturasContratos.ASSINATURA_PENDENTE,
                dados_contrato: {
                    zapsign_document_id: zapSignResponse.token,
                    zapsign_document_url: zapSignResponse.signers[0]?.sign_url || '',
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
                            id: criarContratoDto.testemunha_um_id || null,
                        },
                        testemunha_dois: {
                            nome: criarContratoDto.testemunha_dois_nome || '',
                            cpf: criarContratoDto.testemunha_dois_cpf || '',
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
     * Prepara os dados para o template do contrato
     */
    private prepareTemplateData(aluno: any, treinamento: any, turma: any, criarContratoDto: CriarContratoZapSignDto) {
        // Log para debug dos bônus
        console.log('=== DEBUG BÔNUS ===');
        console.log('tipos_bonus:', criarContratoDto.tipos_bonus);
        console.log('100_dias incluído:', criarContratoDto.tipos_bonus?.includes('100_dias'));
        console.log('ipr incluído:', criarContratoDto.tipos_bonus?.includes('ipr'));

        // Preparar endereço completo do aluno
        let enderecoCompleto = '';
        if (aluno.endereco) {
            const partesEndereco = [aluno.endereco.logradouro, aluno.endereco.numero, aluno.endereco.bairro].filter((parte) => parte && parte.trim() !== '');
            enderecoCompleto = partesEndereco.join(', ');
        }

        return {
            aluno: {
                nome: aluno.nome,
                cpf: this.contractTemplateService.formatCPF(aluno.cpf),
                data_nascimento: this.contractTemplateService.formatDate(aluno.data_nascimento),
                telefone_um: aluno.telefone_um,
                email: aluno.email,
                endereco: enderecoCompleto,
                cidade_estado: `${aluno.cidade || ''}/${aluno.estado || ''}`,
                cep: this.contractTemplateService.formatCEP(aluno.cep),
            },
            treinamento: {
                nome: treinamento.treinamento || treinamento.nome,
                cidade: this.getTreinamentoCidade(criarContratoDto, treinamento),
                data_inicio: this.getTreinamentoDataInicio(criarContratoDto, treinamento),
                data_fim: this.getTreinamentoDataFim(criarContratoDto, treinamento),
                preco_formatado: this.calculateContractPrice(criarContratoDto),
            },
            valor_real_pago: this.calculateRealPaidValue(criarContratoDto),
            forma_pagamento_selecionada: this.getSelectedPaymentMethod(criarContratoDto),
            detalhes_formas_pagamento: this.generatePaymentDetails(criarContratoDto),
            bonus: {
                nao_aplica: this.shouldShowNaoAplica(criarContratoDto),
                cem_dias: this.isBonusSelected(criarContratoDto, ['cem_dias', '100_dias']),
                ipr: this.isBonusSelected(criarContratoDto, ['ipr']),
                ipr_data: this.getIprData(criarContratoDto, turma),
                outros: this.isBonusSelected(criarContratoDto, ['outros']),
                outros_descricao: this.getOutrosDescricao(criarContratoDto),
            },
            pagamento: {
                cartao_credito_avista: this.isPaymentMethodSelected(criarContratoDto, 'À Vista - Cartão de Crédito'),
                cartao_debito_avista: this.isPaymentMethodSelected(criarContratoDto, 'À Vista - Cartão de Débito'),
                pix_avista: this.isPaymentMethodSelected(criarContratoDto, 'À Vista - PIX/Transferência'),
                especie_avista: this.isPaymentMethodSelected(criarContratoDto, 'À Vista - Espécie'),
                cartao_credito_parcelado: this.isPaymentMethodSelected(criarContratoDto, 'Parcelado - Cartão de Crédito'),
                boleto_parcelado: this.isPaymentMethodSelected(criarContratoDto, 'Parcelado - Boleto'),
            },
            observacoes: criarContratoDto.observacoes || '',
            contrato: {
                local: 'Americana/SP',
                data: this.contractTemplateService.formatDate(new Date()),
            },
            testemunhas: {
                testemunha_1: {
                    nome: criarContratoDto.testemunha_um_nome || '',
                    cpf: this.contractTemplateService.formatCPF(criarContratoDto.testemunha_um_cpf || ''),
                },
                testemunha_2: {
                    nome: criarContratoDto.testemunha_dois_nome || '',
                    cpf: this.contractTemplateService.formatCPF(criarContratoDto.testemunha_dois_cpf || ''),
                },
            },
        };
    }

    /**
     * Calcula o preço total do contrato baseado nas formas de pagamento
     */
    private calculateContractPrice(criarContratoDto: CriarContratoZapSignDto): string {
        console.log('=== CALCULANDO PREÇO DO CONTRATO ===');
        console.log('valores_formas_pagamento:', criarContratoDto.valores_formas_pagamento);

        if (!criarContratoDto.valores_formas_pagamento) {
            console.log('valores_formas_pagamento é null/undefined');
            return 'R$ 0,00';
        }

        let total = 0;
        const valoresFormas = criarContratoDto.valores_formas_pagamento;

        // Se for um objeto com chaves de formas de pagamento
        if (typeof valoresFormas === 'object' && !Array.isArray(valoresFormas)) {
            Object.keys(valoresFormas).forEach((key) => {
                const forma = valoresFormas[key];
                console.log(`Processando forma ${key}:`, forma);

                if (forma && typeof forma === 'object' && forma.valor) {
                    const valor = typeof forma.valor === 'string' ? parseInt(forma.valor) : forma.valor;
                    const valorEmReais = valor / 100; // Converter de centavos para reais
                    total += valorEmReais;
                    console.log(`Adicionando ${valorEmReais} ao total. Total atual: ${total}`);
                }
            });
        }
        // Se for um array de formas de pagamento
        else if (Array.isArray(valoresFormas)) {
            valoresFormas.forEach((forma, index) => {
                console.log(`Processando forma ${index}:`, forma);

                if (forma && typeof forma === 'object' && forma.valor) {
                    const valor = typeof forma.valor === 'string' ? parseFloat(forma.valor) : forma.valor;
                    total += valor;
                    console.log(`Adicionando ${valor} ao total. Total atual: ${total}`);
                }
            });
        }

        console.log('Total final calculado:', total);
        return this.contractTemplateService.formatPrice(total);
    }

    /**
     * Verifica se uma forma de pagamento foi selecionada
     */
    private isPaymentMethodSelected(criarContratoDto: CriarContratoZapSignDto, methodName: string): boolean {
        console.log('=== VERIFICANDO FORMA DE PAGAMENTO ===');
        console.log('Método procurado:', methodName);
        console.log('valores_formas_pagamento:', criarContratoDto.valores_formas_pagamento);

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
        console.log('=== PROCESSANDO DADOS DE BÔNUS ===');

        const valoresBonus: any = {};
        const camposVariaveis: any = { ...criarContratoDto.campos_variaveis };

        // Processar bônus dos 100 dias
        if (this.isBonusSelected(criarContratoDto, ['100_dias', 'cem_dias'])) {
            valoresBonus['Bônus-100 Dias'] = true;
        }

        // Processar bônus do IPR (Imersão Prosperar)
        if (this.isBonusSelected(criarContratoDto, ['ipr'])) {
            valoresBonus['Bônus-IPR'] = true;

            // Adicionar quantidade de inscrições do Prosperar
            const quantidadeInscricoes = camposVariaveis['Quantidade de Inscrições'] || '1';
            valoresBonus[`Bônus-${quantidadeInscricoes} Inscrições do Prosperar`] = true;

            // Adicionar data da turma de IPR
            if (turma && turma.data_inicio) {
                camposVariaveis['Data do Imersão Prosperar'] = this.contractTemplateService.formatDate(turma.data_inicio);
            }
        }

        // Processar outros bônus
        if (this.isBonusSelected(criarContratoDto, ['outros'])) {
            const descricaoOutros = this.getOutrosDescricao(criarContratoDto);
            if (descricaoOutros) {
                valoresBonus[`Bônus-Outros: ${descricaoOutros}`] = true;

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

        // Primeiro, verificar se há dados diretamente no campo formas_pagamento
        if (criarContratoDto.formas_pagamento && Array.isArray(criarContratoDto.formas_pagamento)) {
            console.log('=== PROCESSANDO FORMAS DE PAGAMENTO DIRETAS ===');
            console.log('Formas pagamento recebidas:', criarContratoDto.formas_pagamento);

            criarContratoDto.formas_pagamento.forEach((forma: any) => {
                formasPagamento.push({
                    tipo: forma.tipo || 'PARCELADO',
                    forma: forma.forma || 'CARTAO_CREDITO',
                    valor: forma.valor || 0,
                });
            });

            console.log('Formas processadas:', formasPagamento);
            return formasPagamento;
        }

        // Processar formas de pagamento baseado nos valores_formas_pagamento
        if (criarContratoDto.valores_formas_pagamento) {
            const valoresFormas = criarContratoDto.valores_formas_pagamento;
            console.log('=== PROCESSANDO VALORES FORMAS PAGAMENTO ===');
            console.log('Valores formas pagamento:', JSON.stringify(valoresFormas, null, 2));
            console.log('Chaves disponíveis:', Object.keys(valoresFormas));

            // Processar pagamentos à vista
            if (valoresFormas['À Vista - Cartão de Crédito']) {
                formasPagamento.push({
                    tipo: 'A_VISTA',
                    forma: 'CARTAO_CREDITO',
                    valor: parseInt(valoresFormas['À Vista - Cartão de Crédito'].valor) / 100,
                });
            }

            if (valoresFormas['À Vista - Cartão de Débito']) {
                formasPagamento.push({
                    tipo: 'A_VISTA',
                    forma: 'CARTAO_DEBITO',
                    valor: parseInt(valoresFormas['À Vista - Cartão de Débito'].valor) / 100,
                });
            }

            if (valoresFormas['À Vista - PIX/Transferência']) {
                formasPagamento.push({
                    tipo: 'A_VISTA',
                    forma: 'PIX',
                    valor: parseInt(valoresFormas['À Vista - PIX/Transferência'].valor) / 100,
                });
            }

            if (valoresFormas['À Vista - Espécie']) {
                formasPagamento.push({
                    tipo: 'A_VISTA',
                    forma: 'DINHEIRO',
                    valor: parseInt(valoresFormas['À Vista - Espécie'].valor) / 100,
                });
            }

            // Processar pagamentos parcelados
            if (valoresFormas['Parcelado - Cartão de Crédito']) {
                const valorParcelado = parseInt(valoresFormas['Parcelado - Cartão de Crédito'].valor) / 100;
                const numeroParcelas = parseInt(valoresFormas['Parcelado - Cartão de Crédito'].numero_parcelas);
                const valorParcela = valorParcelado / numeroParcelas;

                for (let i = 0; i < numeroParcelas; i++) {
                    formasPagamento.push({
                        tipo: 'PARCELADO',
                        forma: 'CARTAO_CREDITO',
                        valor: valorParcela,
                    });
                }
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
        if (!criarContratoDto.formas_pagamento || !Array.isArray(criarContratoDto.formas_pagamento) || criarContratoDto.formas_pagamento.length === 0) {
            return '• Não informado';
        }

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
            const tipoNome = this.getTipoPagamentoNome(group.tipo);

            if (group.tipo === 'PARCELADO') {
                const valorParcela = this.contractTemplateService.formatPrice(group.valor / group.count);
                details.push(`• ${valorFormatado} no ${formaNome} em ${group.count}x de ${valorParcela}`);
            } else {
                details.push(`• ${valorFormatado} no ${formaNome}`);
            }
        });

        return details.join('<br>');
    }

    /**
     * Converte código da forma de pagamento para nome legível
     */
    private getFormaPagamentoNome(codigo: string): string {
        const mapping: Record<string, string> = {
            CARTAO_CREDITO: 'Cartão de Crédito',
            CARTAO_DEBITO: 'Cartão de Débito',
            PIX: 'PIX',
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

            // Usar query builder para buscar contrato pelo document_id no JSON
            const contrato = await this.uow.turmasAlunosTreinamentosContratosRP
                .createQueryBuilder('contrato')
                .where('contrato.deletado_em IS NULL')
                .andWhere("contrato.dados_contrato->>'zapsign_document_id' = :documentoId", { documentoId })
                .select(['contrato.id', 'contrato.dados_contrato'])
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

                    // Cancelar documento no ZapSign usando o document_id do banco
                    const documentIdZapSign = contratoEncontrado.dados_contrato?.zapsign_document_id;
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
     * Prepara dados para o template usando dados salvos no banco
     */
    private prepareTemplateDataFromSavedContract(contrato: any) {
        const dadosContrato = contrato.dados_contrato || {};
        const aluno = contrato.dados_contrato?.aluno || {};
        const treinamento = contrato.dados_contrato?.treinamento || {};

        // Preparar endereço completo do aluno
        let enderecoCompleto = '';
        if (aluno.endereco) {
            const partesEndereco = [aluno.endereco.logradouro, aluno.endereco.numero, aluno.endereco.bairro].filter((parte) => parte && parte.trim() !== '');
            enderecoCompleto = partesEndereco.join(', ');
        }

        return {
            aluno: {
                nome: aluno.nome || '',
                cpf: this.contractTemplateService.formatCPF(aluno.cpf || ''),
                data_nascimento: this.contractTemplateService.formatDate(aluno.data_nascimento),
                telefone_um: aluno.telefone_um || '',
                email: aluno.email || '',
                endereco: enderecoCompleto,
                cidade_estado: `${aluno.polo?.cidade || ''}/${aluno.polo?.estado || ''}`,
                cep: this.contractTemplateService.formatCEP(aluno.cep || ''),
            },
            treinamento: {
                nome: treinamento.nome || '',
                cidade: this.getTreinamentoCidadeFromSaved(dadosContrato),
                data_inicio: this.getTreinamentoDataInicioFromSaved(dadosContrato),
                data_fim: this.getTreinamentoDataFimFromSaved(dadosContrato),
                preco_formatado: this.calculateContractPriceFromSaved(dadosContrato),
            },
            valor_real_pago: this.calculateRealPaidValueFromSaved(dadosContrato),
            forma_pagamento_selecionada: this.getSelectedPaymentMethodFromSaved(dadosContrato),
            detalhes_formas_pagamento: this.generatePaymentDetailsFromSaved(dadosContrato),
            bonus: {
                nao_aplica: this.shouldShowNaoAplicaFromSaved(dadosContrato),
                cem_dias: this.isBonusSelectedFromSaved(dadosContrato, ['cem_dias', '100_dias']),
                ipr: this.isBonusSelectedFromSaved(dadosContrato, ['ipr']),
                ipr_data: this.getIprDataFromSaved(dadosContrato),
                outros: this.isBonusSelectedFromSaved(dadosContrato, ['outros']),
                outros_descricao: this.getOutrosDescricaoFromSaved(dadosContrato),
            },
            pagamento: {
                cartao_credito_avista: this.isPaymentMethodSelectedFromSaved(dadosContrato, 'À Vista - Cartão de Crédito'),
                cartao_debito_avista: this.isPaymentMethodSelectedFromSaved(dadosContrato, 'À Vista - Cartão de Débito'),
                pix_avista: this.isPaymentMethodSelectedFromSaved(dadosContrato, 'À Vista - PIX/Transferência'),
                especie_avista: this.isPaymentMethodSelectedFromSaved(dadosContrato, 'À Vista - Espécie'),
                cartao_credito_parcelado: this.isPaymentMethodSelectedFromSaved(dadosContrato, 'Parcelado - Cartão de Crédito'),
                boleto_parcelado: this.isPaymentMethodSelectedFromSaved(dadosContrato, 'Parcelado - Boleto'),
            },
            observacoes: dadosContrato.observacoes || '',
            contrato: {
                local: dadosContrato.campos_variaveis?.['Local de Assinatura do Contrato'] || 'Americana/SP',
                data: this.contractTemplateService.formatDate(new Date()),
            },
            testemunhas: {
                testemunha_1: {
                    nome: dadosContrato.testemunhas?.testemunha_um?.nome || '',
                    cpf: this.contractTemplateService.formatCPF(dadosContrato.testemunhas?.testemunha_um?.cpf || ''),
                },
                testemunha_2: {
                    nome: dadosContrato.testemunhas?.testemunha_dois?.nome || '',
                    cpf: this.contractTemplateService.formatCPF(dadosContrato.testemunhas?.testemunha_dois?.cpf || ''),
                },
            },
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

    private generatePaymentDetailsFromSaved(dadosContrato: any): string {
        if (!dadosContrato.formas_pagamento || !Array.isArray(dadosContrato.formas_pagamento) || dadosContrato.formas_pagamento.length === 0) {
            return '• Não informado';
        }

        // Agrupar formas de pagamento por tipo e forma
        const groupedPayments: { [key: string]: { valor: number; count: number; tipo: string; forma: string } } = {};

        dadosContrato.formas_pagamento.forEach((pagamento: any) => {
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
                    const diaVencimento = dadosContrato.campos_variaveis?.['Dia de Vencimento do Boleto'];
                    const dataPrimeiroBoleto = dadosContrato.campos_variaveis?.['Data do Primeiro Boleto'];

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
        console.log('=== BUSCANDO CONTRATO BÁSICO ===');
        console.log('ID do contrato:', contratoId);
        try {
            const contratoBasico = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
                where: { id: contratoId },
            });

            console.log('Contrato básico encontrado:', contratoBasico ? 'SIM' : 'NÃO');
            if (contratoBasico) {
                console.log('ID:', contratoBasico.id);
                console.log('ID TurmaAlunoTreinamento:', contratoBasico.id_turma_aluno_treinamento);
                console.log('ID Documento:', contratoBasico.id_documento);
                console.log('Status:', contratoBasico.status_ass_aluno);
                console.log('Dados do contrato:', contratoBasico.dados_contrato);
            }

            return contratoBasico;
        } catch (error) {
            console.error('Erro ao buscar contrato básico:', error);
            throw new Error('Erro ao buscar contrato básico');
        }
    }

    async buscarContratoCompleto(contratoId: string): Promise<any> {
        console.log('=== BUSCANDO CONTRATO COMPLETO ===');
        console.log('ID do contrato:', contratoId);
        try {
            // Primeiro, vamos buscar o contrato básico
            const contratoBasico = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
                where: { id: contratoId },
                relations: [
                    'id_turma_aluno_treinamento_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_aluno_fk',
                    'id_turma_aluno_treinamento_fk.id_treinamento_fk',
                    'id_documento_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_aluno_fk.id_polo_fk',
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

            console.log('Contrato básico encontrado:', contratoBasico ? 'SIM' : 'NÃO');
            if (contratoBasico) {
                console.log('ID do contrato:', contratoBasico.id);
                console.log('ID turma_aluno_treinamento:', contratoBasico.id_turma_aluno_treinamento);
                console.log('Relacionamentos carregados:', {
                    turma_aluno_treinamento: !!contratoBasico.id_turma_aluno_treinamento_fk,
                    turma_aluno: !!contratoBasico.id_turma_aluno_treinamento_fk?.id_turma_aluno_fk,
                    aluno: !!contratoBasico.id_turma_aluno_treinamento_fk?.id_turma_aluno_fk?.id_aluno_fk,
                    treinamento: !!contratoBasico.id_turma_aluno_treinamento_fk?.id_treinamento_fk,
                    documento: !!contratoBasico.id_documento_fk,
                });
            }

            const contrato = contratoBasico;

            if (!contrato) {
                throw new NotFoundException('Contrato não encontrado');
            }

            console.log('=== DADOS DO CONTRATO ===');
            console.log('ID do contrato:', contrato.id);
            console.log('Dados do contrato (JSON):', JSON.stringify(contrato.dados_contrato, null, 2));
            console.log('Tipo do dados_contrato:', typeof contrato.dados_contrato);
            console.log('É null?', contrato.dados_contrato === null);
            console.log('É undefined?', contrato.dados_contrato === undefined);

            // Verificar cada nível dos relacionamentos
            console.log('=== VERIFICANDO RELACIONAMENTOS ===');
            console.log('1. TurmaAlunoTreinamento:', contrato.id_turma_aluno_treinamento_fk ? 'CARREGADO' : 'NULL');
            if (contrato.id_turma_aluno_treinamento_fk) {
                console.log('   - ID:', contrato.id_turma_aluno_treinamento_fk.id);
                console.log('   - TurmaAluno:', contrato.id_turma_aluno_treinamento_fk.id_turma_aluno_fk ? 'CARREGADO' : 'NULL');
                if (contrato.id_turma_aluno_treinamento_fk.id_turma_aluno_fk) {
                    console.log('     - ID TurmaAluno:', contrato.id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id);
                    console.log('     - Aluno:', contrato.id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_aluno_fk ? 'CARREGADO' : 'NULL');
                    if (contrato.id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_aluno_fk) {
                        console.log('       - ID Aluno:', contrato.id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_aluno_fk.id);
                        console.log('       - Nome Aluno:', contrato.id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_aluno_fk.nome);
                        console.log('       - CPF Aluno:', contrato.id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_aluno_fk.cpf);
                    }
                }
                console.log('   - Treinamento:', contrato.id_turma_aluno_treinamento_fk.id_treinamento_fk ? 'CARREGADO' : 'NULL');
                if (contrato.id_turma_aluno_treinamento_fk.id_treinamento_fk) {
                    console.log('     - ID Treinamento:', contrato.id_turma_aluno_treinamento_fk.id_treinamento_fk.id);
                    console.log('     - Nome Treinamento:', contrato.id_turma_aluno_treinamento_fk.id_treinamento_fk.treinamento);
                    console.log('     - Preço Treinamento:', contrato.id_turma_aluno_treinamento_fk.id_treinamento_fk.preco_treinamento);
                }
            }
            console.log('2. Documento:', contrato.id_documento_fk ? 'CARREGADO' : 'NULL');
            if (contrato.id_documento_fk) {
                console.log('   - ID Documento:', contrato.id_documento_fk.id);
                console.log('   - Nome Documento:', contrato.id_documento_fk.documento);
                console.log('   - Cláusulas:', contrato.id_documento_fk.clausulas ? 'CARREGADAS' : 'VAZIAS');
                if (contrato.id_documento_fk.clausulas) {
                    console.log('   - Tamanho das cláusulas:', contrato.id_documento_fk.clausulas.length, 'caracteres');
                    console.log('   - Primeiros 200 caracteres:', contrato.id_documento_fk.clausulas.substring(0, 200));
                }
            }

            // Mapear dados para o formato esperado pelo frontend
            const dadosContrato = contrato.dados_contrato || {};
            const aluno = contrato.id_turma_aluno_treinamento_fk?.id_turma_aluno_fk?.id_aluno_fk;
            const treinamento = contrato.id_turma_aluno_treinamento_fk?.id_treinamento_fk;
            const documento = contrato.id_documento_fk;
            const polo = aluno?.id_polo_fk;

            console.log('=== DADOS EXTRAÍDOS ===');
            console.log('Aluno:', {
                existe: !!aluno,
                id: aluno?.id,
                nome: aluno?.nome,
                cpf: aluno?.cpf,
                email: aluno?.email,
                logradouro: aluno?.logradouro,
                numero: aluno?.numero,
                bairro: aluno?.bairro,
                cidade: aluno?.cidade,
                estado: aluno?.estado,
                cep: aluno?.cep,
            });
            console.log('Treinamento:', {
                existe: !!treinamento,
                id: treinamento?.id,
                nome: treinamento?.treinamento,
                preco: treinamento?.preco_treinamento,
            });
            console.log('Bônus:', {
                bonus_selecionados: dadosContrato.bonus_selecionados,
                valores_bonus: dadosContrato.valores_bonus,
                tem_100_dias: dadosContrato.bonus_selecionados?.includes('100_dias'),
                tem_ipr: dadosContrato.bonus_selecionados?.includes('ipr'),
            });
            console.log('Documento:', {
                existe: !!documento,
                id: documento?.id,
                nome: documento?.documento,
            });

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
        console.log('Listando contratos do banco de dados:', filtros);
        try {
            const page = filtros?.page || 1;
            const limit = filtros?.limit || 10;
            const offset = (page - 1) * limit;

            // Usar find com relations para garantir que os relacionamentos sejam carregados
            const contratos = await this.uow.turmasAlunosTreinamentosContratosRP.find({
                relations: [
                    'id_turma_aluno_treinamento_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_aluno_fk',
                    'id_turma_aluno_treinamento_fk.id_treinamento_fk',
                    'id_documento_fk',
                    'id_turma_aluno_treinamento_fk.id_turma_aluno_fk.id_aluno_fk.id_polo_fk',
                ],
                order: { criado_em: 'DESC' },
                skip: offset,
                take: limit,
            });

            // Contar total (simplificado para teste)
            const total = await this.uow.turmasAlunosTreinamentosContratosRP.count();

            console.log('=== LISTAGEM DE CONTRATOS ===');
            console.log('Contratos encontrados:', contratos.length);
            if (contratos.length > 0) {
                console.log('Primeiro contrato:', {
                    id: contratos[0].id,
                    aluno_nome: contratos[0].id_turma_aluno_treinamento_fk?.id_turma_aluno_fk?.id_aluno_fk?.nome,
                    treinamento_nome: contratos[0].id_turma_aluno_treinamento_fk?.id_treinamento_fk?.treinamento,
                    criado_em: contratos[0].criado_em,
                });
            }

            // Mapear dados para o formato esperado pelo frontend
            const contratosMapeados = contratos.map((contrato) => {
                const dadosContrato = contrato.dados_contrato || {};
                const aluno = contrato.id_turma_aluno_treinamento_fk?.id_turma_aluno_fk?.id_aluno_fk;
                const treinamento = contrato.id_turma_aluno_treinamento_fk?.id_treinamento_fk;
                const documento = contrato.id_documento_fk;
                const polo = aluno?.id_polo_fk;

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

            console.log('=== CONTRATOS MAPEADOS ===');
            if (contratosMapeados.length > 0) {
                console.log('Primeiro contrato mapeado:', {
                    id: contratosMapeados[0].id,
                    aluno_nome: contratosMapeados[0].aluno_nome,
                    treinamento_nome: contratosMapeados[0].treinamento_nome,
                    criado_em: contratosMapeados[0].criado_em,
                });
            }

            const totalPages = Math.ceil(total / limit);

            return {
                data: contratosMapeados,
                total,
                page,
                limit,
                totalPages,
            };
        } catch (error) {
            console.error('Erro ao listar contratos do banco:', error);
            throw new Error('Erro ao listar contratos do banco de dados');
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
