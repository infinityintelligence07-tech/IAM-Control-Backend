import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { Documentos } from '@/modules/config/entities/documentos.entity';
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
import * as PDFDocument from 'pdfkit';

@Injectable()
export class DocumentosService {
    constructor(
        private readonly uow: UnitOfWorkService,
        private readonly zapSignService: ZapSignService,
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
            const whereCondition: any = { deletado_em: null }; // Excluir documentos deletados (soft delete)

            // Filtrar por tipo de documento se especificado
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
                where: { id, deletado_em: null }, // Excluir documentos deletados (soft delete)
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
                where: { id, deletado_em: null }, // Excluir documentos deletados (soft delete)
            });

            if (!documento) {
                throw new NotFoundException('Documento não encontrado');
            }

            // Atualizar campos fornecidos
            if (updateDocumentoDto.documento !== undefined) {
                documento.documento = updateDocumentoDto.documento;
            }
            if (updateDocumentoDto.tipo_documento !== undefined) {
                documento.tipo_documento = updateDocumentoDto.tipo_documento;
            }
            if (updateDocumentoDto.campos !== undefined) {
                documento.campos = updateDocumentoDto.campos;
            }
            if (updateDocumentoDto.clausulas !== undefined) {
                documento.clausulas = updateDocumentoDto.clausulas;
            }
            if (updateDocumentoDto.treinamentos_relacionados !== undefined) {
                console.log('📝 [BACKEND] Atualizando treinamentos relacionados:', updateDocumentoDto.treinamentos_relacionados);
                documento.treinamentos_relacionados = updateDocumentoDto.treinamentos_relacionados;
            }

            // Atualizar auditoria
            documento.atualizado_por = userId;

            const savedDocumento = await this.uow.documentosRP.save(documento);
            console.log('✅ [BACKEND] Documento atualizado com treinamentos:', savedDocumento.treinamentos_relacionados);
            return this.mapToResponseDto(savedDocumento);
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error('Erro ao atualizar documento:', error);
            throw new BadRequestException('Erro ao atualizar documento');
        }
    }

    async deleteDocumento(id: number, userId?: number): Promise<{ message: string }> {
        try {
            const documento = await this.uow.documentosRP.findOne({
                where: { id, deletado_em: null }, // Excluir documentos já deletados
            });

            if (!documento) {
                throw new NotFoundException('Documento não encontrado');
            }

            // Soft delete - apenas marca como deletado
            documento.deletado_em = new Date();
            documento.atualizado_por = userId;

            await this.uow.documentosRP.save(documento);
            return { message: 'Documento removido com sucesso' };
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error('Erro ao remover documento:', error);
            throw new BadRequestException('Erro ao remover documento');
        }
    }

    async duplicateDocumento(id: number, userId?: number): Promise<DocumentoResponseDto> {
        try {
            const documentoOriginal = await this.uow.documentosRP.findOne({
                where: { id, deletado_em: null }, // Excluir documentos deletados
            });

            if (!documentoOriginal) {
                throw new NotFoundException('Documento não encontrado');
            }

            // Criar novo documento baseado no original
            const novoDocumento = this.uow.documentosRP.create({
                documento: `${documentoOriginal.documento} (Cópia)`,
                tipo_documento: documentoOriginal.tipo_documento,
                campos: documentoOriginal.campos,
                clausulas: documentoOriginal.clausulas,
                treinamentos_relacionados: documentoOriginal.treinamentos_relacionados || [],
                criado_por: userId,
                atualizado_por: userId,
            });

            const savedDocumento = await this.uow.documentosRP.save(novoDocumento);
            return this.mapToResponseDto(savedDocumento);
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error('Erro ao duplicar documento:', error);
            throw new BadRequestException('Erro ao duplicar documento');
        }
    }

    async gerarContrato(gerarContratoDto: GerarContratoDto): Promise<{ contrato: string; campos: any }> {
        try {
            const documento = await this.uow.documentosRP.findOne({
                where: { id: parseInt(gerarContratoDto.id_documento), deletado_em: null }, // Excluir documentos deletados
            });

            if (!documento) {
                throw new NotFoundException('Documento não encontrado');
            }

            // Processar campos do documento
            let contratoProcessado = documento.clausulas;
            const camposProcessados: any = {};

            // Substituir placeholders pelos valores fornecidos
            for (const valorCampo of gerarContratoDto.valoresCampos) {
                const placeholder = `{{${valorCampo.nome}}}`;
                contratoProcessado = contratoProcessado.replace(new RegExp(placeholder, 'g'), valorCampo.valor);
                camposProcessados[valorCampo.nome] = valorCampo.valor;
            }

            return {
                contrato: contratoProcessado,
                campos: camposProcessados,
            };
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error('Erro ao gerar contrato:', error);
            throw new BadRequestException('Erro ao gerar contrato');
        }
    }

    private mapToResponseDto(documento: Documentos): DocumentoResponseDto {
        return {
            id: documento.id,
            documento: documento.documento,
            tipo_documento: documento.tipo_documento,
            campos: documento.campos || [],
            clausulas: documento.clausulas,
            treinamentos_relacionados: documento.treinamentos_relacionados || [],
            created_at: documento.criado_em,
            updated_at: documento.atualizado_em,
            criado_por: documento.criado_por,
            atualizado_por: documento.atualizado_por,
            deletado_em: documento.deletado_em,
        };
    }

    // Método para extrair campos de um template de contrato
    extrairCamposDeTemplate(template: string): CampoDocumentoDto[] {
        const campos: CampoDocumentoDto[] = [];
        const regex = /\{\{([^}]+)\}\}/g;
        let match;

        while ((match = regex.exec(template)) !== null) {
            const nomeCampo = match[1].trim();

            // Verificar se o campo já foi processado
            if (!campos.find((campo) => campo.campo === nomeCampo)) {
                // Determinar o tipo do campo baseado no nome
                const tipo = this.determinarTipoCampo(nomeCampo);

                campos.push({
                    campo: nomeCampo,
                    tipo: tipo,
                    descricao: this.gerarDescricaoCampo(nomeCampo),
                });
            }
        }

        return campos;
    }

    private determinarTipoCampo(nomeCampo: string): string {
        const nome = nomeCampo.toLowerCase();

        if (nome.includes('data') || nome.includes('date')) return 'data';
        if (nome.includes('email') || nome.includes('e-mail')) return 'email';
        if (nome.includes('whatsapp') || nome.includes('telefone') || nome.includes('celular')) return 'telefone';
        if (nome.includes('cpf') || nome.includes('cnpj') || nome.includes('documento')) return 'documento';
        if (nome.includes('cep')) return 'cep';
        if (nome.includes('preço') || nome.includes('valor') || nome.includes('valor')) return 'numero';
        if (nome.includes('checkbox') || nome.includes('aplica') || nome.includes('selecionar')) return 'checkbox';
        if (nome.includes('quantidade') || nome.includes('parcelas')) return 'numero';

        return 'texto';
    }

    private gerarDescricaoCampo(nomeCampo: string): string {
        const nome = nomeCampo.toLowerCase();

        if (nome.includes('nome')) return 'Nome completo';
        if (nome.includes('data nascimento')) return 'Data de nascimento';
        if (nome.includes('endereço')) return 'Endereço completo';
        if (nome.includes('cidade')) return 'Cidade';
        if (nome.includes('estado')) return 'Estado';
        if (nome.includes('treinamento')) return 'Nome do treinamento';
        if (nome.includes('preço')) return 'Preço do contrato';
        if (nome.includes('data prevista')) return 'Data prevista do treinamento';

        return nomeCampo;
    }

    // Método para gerar PDF real usando PDFKit
    private gerarPDFReal(titulo: string, conteudo: string): Promise<string> {
        const doc = new PDFDocument({
            size: 'A4',
            margins: {
                top: 50,
                bottom: 50,
                left: 50,
                right: 50,
            },
        });

        const buffers: Buffer[] = [];
        doc.on('data', buffers.push.bind(buffers));

        return new Promise((resolve, reject) => {
            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(buffers);
                resolve(pdfBuffer.toString('base64'));
            });

            doc.on('error', reject);

            // Título
            doc.fontSize(18).font('Helvetica-Bold').text(titulo, { align: 'center' }).moveDown(2);

            // Conteúdo
            doc.fontSize(12).font('Helvetica').text(conteudo, {
                align: 'justify',
                lineGap: 5,
            });

            doc.end();
        });
    }

    // Métodos para integração com ZapSign
    async buscarTemplatesZapSign() {
        try {
            console.log('Iniciando busca de documentos para templates...');

            // Buscar documentos do banco de dados local
            const documentos = await this.uow.documentosRP.find({
                where: { deletado_em: null },
                select: ['id', 'documento', 'tipo_documento', 'campos', 'clausulas', 'criado_em', 'atualizado_em'],
                order: { documento: 'ASC' },
            });

            console.log('Documentos encontrados:', documentos.length);
            console.log('Primeiros documentos:', documentos.slice(0, 3));

            const resultado = documentos.map((doc) => ({
                id: doc.id.toString(),
                name: doc.documento,
                tipo_documento: doc.tipo_documento,
                campos: doc.campos || [],
                clausulas: doc.clausulas || '',
                created_at: doc.criado_em,
                updated_at: doc.atualizado_em,
            }));

            console.log('Resultado final:', resultado.length, 'documentos processados');
            return resultado;
        } catch (error) {
            console.error('Erro ao buscar documentos do banco:', error);
            throw new BadRequestException('Erro ao buscar documentos');
        }
    }

    async buscarTemplatesZapSignReais() {
        try {
            console.log('Buscando templates reais do ZapSign...');
            const templates = await this.zapSignService.getTemplates();
            console.log('Templates do ZapSign encontrados:', templates.length);
            return templates;
        } catch (error) {
            console.error('Erro ao buscar templates do ZapSign:', error);
            throw new BadRequestException('Erro ao buscar templates do ZapSign');
        }
    }

    async buscarAluno(query: string) {
        try {
            if (!query || query.length < 3) {
                return [];
            }

            const alunos = await this.uow.alunosRP
                .createQueryBuilder('aluno')
                .where('aluno.deletado_em IS NULL')
                .andWhere('(aluno.nome ILIKE :query OR aluno.email ILIKE :query OR aluno.cpf ILIKE :query)', { query: `%${query}%` })
                .limit(10)
                .getMany();

            return alunos.map((aluno) => ({
                id: aluno.id.toString(),
                nome: aluno.nome,
                email: aluno.email,
                cpf: aluno.cpf,
                telefone_um: aluno.telefone_um,
            }));
        } catch (error) {
            console.error('Erro ao buscar aluno:', error);
            throw new BadRequestException('Erro ao buscar aluno');
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

            // Turma de IPR é opcional

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
                // Testemunha do banco de alunos
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
                // Testemunha com informações manuais
                signers.push({
                    name: criarContratoDto.testemunha_um_nome,
                    email: `${criarContratoDto.testemunha_um_cpf}@testemunha.local`,
                    phone: '',
                    action: 'sign' as const,
                });
            }

            if (criarContratoDto.testemunha_dois_id) {
                // Testemunha do banco de alunos
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
                // Testemunha com informações manuais
                signers.push({
                    name: criarContratoDto.testemunha_dois_nome,
                    email: `${criarContratoDto.testemunha_dois_cpf}@testemunha.local`,
                    phone: '',
                    action: 'sign' as const,
                });
            }

            // Calcular preço total e processar formas de pagamento
            const precoTotal = treinamento.preco_treinamento;
            console.log('Preço total calculado:', precoTotal, 'Tipo:', typeof precoTotal);
            const formasPagamento: { tipo: string; forma: EFormasPagamento; valor: number; descricao?: string }[] = [];

            if (criarContratoDto.forma_pagamento === 'A_VISTA') {
                formasPagamento.push({
                    tipo: 'A_VISTA',
                    forma: EFormasPagamento.PIX,
                    valor: precoTotal,
                });
            } else if (criarContratoDto.forma_pagamento === 'PARCELADO' && criarContratoDto.formas_pagamento) {
                criarContratoDto.formas_pagamento.forEach((fp) => {
                    formasPagamento.push({
                        tipo: 'PARCELADO',
                        forma: fp.forma as EFormasPagamento,
                        valor: fp.valor,
                    });
                });
            } else if (criarContratoDto.forma_pagamento === 'PARCELADO' && criarContratoDto.valores_formas_pagamento) {
                // Processar formas de pagamento do novo formato para PARCELADO
                const valoresFormas = criarContratoDto.valores_formas_pagamento;

                // Parcelado - Cartão de Crédito
                if (valoresFormas['Parcelado - Cartão de Crédito']) {
                    const valorParcelado = parseInt(valoresFormas['Parcelado - Cartão de Crédito'].valor) / 100;
                    const numeroParcelas = parseInt(valoresFormas['Parcelado - Cartão de Crédito'].numero_parcelas);
                    const valorParcela = valorParcelado / numeroParcelas;

                    // Adicionar entrada
                    formasPagamento.push({
                        tipo: 'PARCELADO',
                        forma: EFormasPagamento.CARTAO_CREDITO,
                        valor: valorParcela,
                    });

                    // Adicionar parcelas restantes (todas no cartão de crédito)
                    for (let i = 1; i < numeroParcelas; i++) {
                        formasPagamento.push({
                            tipo: 'PARCELADO',
                            forma: EFormasPagamento.CARTAO_CREDITO,
                            valor: valorParcela,
                        });
                    }
                }

                // Parcelado - Boleto
                if (valoresFormas['Parcelado - Boleto:  Parcelas de: . Melhor dia de Vencimento: . Data para o 1º Boleto: .']) {
                    const dadosBoleto = valoresFormas['Parcelado - Boleto:  Parcelas de: . Melhor dia de Vencimento: . Data para o 1º Boleto: .'];
                    const valorTotal = parseInt(dadosBoleto.valor_parcelas) / 100; // Valor total em reais
                    const numeroParcelas = parseInt(dadosBoleto.numero_parcelas);
                    const valorParcela = valorTotal / numeroParcelas;

                    // Adicionar todas as parcelas em boleto
                    for (let i = 0; i < numeroParcelas; i++) {
                        formasPagamento.push({
                            tipo: 'PARCELADO',
                            forma: EFormasPagamento.BOLETO,
                            valor: valorParcela,
                        });
                    }
                }
            } else if (criarContratoDto.forma_pagamento === 'AMBOS' && criarContratoDto.valores_formas_pagamento) {
                // Processar formas de pagamento do novo formato para AMBOS
                const valoresFormas = criarContratoDto.valores_formas_pagamento;

                // À Vista - Cartão de Crédito
                if (valoresFormas['À Vista - Cartão de Crédito']) {
                    formasPagamento.push({
                        tipo: 'A_VISTA',
                        forma: EFormasPagamento.CARTAO_CREDITO,
                        valor: parseInt(valoresFormas['À Vista - Cartão de Crédito'].valor) / 100, // Converter centavos para reais
                    });
                }

                // À Vista - Cartão de Débito
                if (valoresFormas['À Vista - Cartão de Débito']) {
                    formasPagamento.push({
                        tipo: 'A_VISTA',
                        forma: EFormasPagamento.CARTAO_DEBITO,
                        valor: parseInt(valoresFormas['À Vista - Cartão de Débito'].valor) / 100, // Converter centavos para reais
                    });
                }

                // À Vista - PIX/Transferência
                if (valoresFormas['À Vista - PIX/Transferência']) {
                    formasPagamento.push({
                        tipo: 'A_VISTA',
                        forma: EFormasPagamento.PIX,
                        valor: parseInt(valoresFormas['À Vista - PIX/Transferência'].valor) / 100, // Converter centavos para reais
                    });
                }

                // À Vista - Espécie
                if (valoresFormas['À Vista - Espécie']) {
                    formasPagamento.push({
                        tipo: 'A_VISTA',
                        forma: EFormasPagamento.DINHEIRO,
                        valor: parseInt(valoresFormas['À Vista - Espécie'].valor) / 100, // Converter centavos para reais
                    });
                }

                // Parcelado - Cartão de Crédito
                if (valoresFormas['Parcelado - Cartão de Crédito']) {
                    formasPagamento.push({
                        tipo: 'PARCELADO',
                        forma: EFormasPagamento.CARTAO_CREDITO,
                        valor: parseInt(valoresFormas['Parcelado - Cartão de Crédito'].valor) / 100, // Converter centavos para reais
                    });
                }

                // Parcelado - Boleto (com chave longa)
                const chaveBoletoLonga = 'Parcelado - Boleto:  Parcelas de: . Melhor dia de Vencimento: . Data para o 1º Boleto: .';
                if (valoresFormas[chaveBoletoLonga]) {
                    const valorTotalCentavos = parseInt(valoresFormas[chaveBoletoLonga].valor_parcelas); // Valor total em centavos
                    formasPagamento.push({
                        tipo: 'PARCELADO',
                        forma: EFormasPagamento.BOLETO,
                        valor: valorTotalCentavos / 100, // Converter para reais
                    });
                }

                // Parcelado - Boleto (chave nova)
                if (valoresFormas['Parcelado - Boleto']) {
                    const valorTotalCentavos = parseInt(valoresFormas['Parcelado - Boleto'].valor); // Valor total em centavos
                    formasPagamento.push({
                        tipo: 'PARCELADO',
                        forma: EFormasPagamento.BOLETO,
                        valor: valorTotalCentavos / 100, // Converter para reais
                    });
                }
            }

            // Buscar template do documento
            const template = await this.uow.documentosRP.findOne({
                where: { id: parseInt(criarContratoDto.template_id), deletado_em: null },
            });

            if (!template) {
                throw new NotFoundException('Template não encontrado');
            }

            // Mapear template local para template do ZapSign
            const templateZapSignMap = {
                '1': '6954d3cd-c6ea-4b9d-beaa-5c9934138e07', // Contrato do Confronto
                '2': 'a35062c6-c47b-4558-8413-a1362ac19293', // Todos os Demais Treinamentos
                '3': '40cacb5c-e713-49e1-bf0e-cfe56182de3b', // Liberty
                '4': '4ada6bdb-6902-4013-a2b9-3b385edd6ea2', // Liberty Begin
                '6': '56817967-021c-40b4-a863-5a515147a825', // Mesa de Destino
                '7': 'a35062c6-c47b-4558-8413-a1362ac19293', // Demais Treinamentos
                '8': '40cbde33-00c1-4355-869c-fbc990f0b7c5', // Termo de Autorização
                '9': '6a564088-c79b-4907-a3d8-02d55368e9d3', // Termo de Consentimento
            };

            const templateIdZapSign = templateZapSignMap[criarContratoDto.template_id] || '6954d3cd-c6ea-4b9d-beaa-5c9934138e07';

            // Criar nome do documento
            const nomeDocumento = `Contrato ${treinamento.treinamento} - ${aluno.nome} - ${new Date().toLocaleDateString('pt-BR')}`;

            // Construir documento dinamicamente baseado nos campos da tabela
            const documentoConteudo = this.construirDocumentoDinamico(template, aluno, treinamento, turma, formasPagamento, criarContratoDto);

            // Criar documento no ZapSign usando conteúdo gerado
            console.log('Criando documento no ZapSign com conteúdo gerado');
            console.log('Signers:', JSON.stringify(signers, null, 2));

            // Gerar PDF real com o conteúdo do contrato
            console.log('Iniciando geração de PDF...');
            const pdfBase64 = await this.gerarPDFReal(nomeDocumento, documentoConteudo);

            console.log('PDF gerado com sucesso! Tamanho:', pdfBase64.length);
            console.log('PDF gerado (primeiros 100 caracteres):', pdfBase64.substring(0, 100));

            const documentoZapSign = await this.zapSignService.createDocumentFromContent({
                name: nomeDocumento,
                content: pdfBase64,
                signers: signers,
                message: `Contrato para o treinamento ${treinamento.treinamento}. ${criarContratoDto.observacoes || ''}`,
            });

            // Salvar informações do contrato no banco
            // Buscar turma do aluno (se houver turma de IPR)
            let turmaAlunoBonus = null;
            if (criarContratoDto.id_turma_bonus) {
                turmaAlunoBonus = await this.uow.turmasAlunosRP.findOne({
                    where: {
                        id_turma: parseInt(criarContratoDto.id_turma_bonus),
                        id_aluno: criarContratoDto.id_aluno,
                        deletado_em: null,
                    },
                });
            }

            // Buscar ou criar uma turma válida para o contrato
            let turmaIdParaContrato = turma?.id;

            if (!turmaIdParaContrato) {
                // Buscar uma turma válida existente
                const turmaExistente = await this.uow.turmasRP.findOne({
                    where: {
                        deletado_em: null,
                        id_treinamento: parseInt(criarContratoDto.id_treinamento),
                    },
                    order: {
                        criado_em: 'DESC',
                    },
                });

                if (turmaExistente) {
                    turmaIdParaContrato = turmaExistente.id;
                    console.log('Usando turma existente:', turmaIdParaContrato);
                } else {
                    // Se não há turma para o treinamento, buscar qualquer turma válida
                    const turmaQualquer = await this.uow.turmasRP.findOne({
                        where: {
                            deletado_em: null,
                        },
                        order: {
                            criado_em: 'DESC',
                        },
                    });

                    if (turmaQualquer) {
                        turmaIdParaContrato = turmaQualquer.id;
                        console.log('Usando turma genérica:', turmaIdParaContrato);
                    } else {
                        throw new Error('Nenhuma turma válida encontrada no sistema');
                    }
                }
            }

            // Criar registro de turma_aluno se não existir
            let turmaAluno = await this.uow.turmasAlunosRP.findOne({
                where: {
                    id_aluno: criarContratoDto.id_aluno,
                    id_turma: turmaIdParaContrato,
                },
            });

            if (!turmaAluno) {
                // Criar registro de turma_aluno
                turmaAluno = this.uow.turmasAlunosRP.create({
                    id_turma: turmaIdParaContrato,
                    id_aluno: criarContratoDto.id_aluno,
                    nome_cracha: aluno.nome,
                    numero_cracha: `CR${Date.now()}`, // Número único para o crachá
                    criado_por: userId,
                    atualizado_por: userId,
                });
                turmaAluno = await this.uow.turmasAlunosRP.save(turmaAluno);
                console.log('Registro turma_aluno criado:', turmaAluno.id);
            }

            // Criar registro de treinamento do aluno
            console.log('Dados para criar turmaAlunoTreinamento:', {
                id_turma_aluno: turmaAluno.id,
                id_treinamento: parseInt(criarContratoDto.id_treinamento),
                preco_treinamento: treinamento.preco_treinamento,
                forma_pgto: formasPagamento,
                preco_total_pago: precoTotal,
            });

            const turmaAlunoTreinamento = this.uow.turmasAlunosTreinamentosRP.create({
                id_turma_aluno: turmaAluno.id, // Usar o ID real da turma_aluno
                id_treinamento: parseInt(criarContratoDto.id_treinamento),
                preco_treinamento: treinamento.preco_treinamento,
                forma_pgto: formasPagamento,
                preco_total_pago: precoTotal,
                criado_por: userId,
                atualizado_por: userId,
            });

            const turmaAlunoTreinamentoSalvo = await this.uow.turmasAlunosTreinamentosRP.save(turmaAlunoTreinamento);

            // Compilar todos os dados do contrato para armazenamento
            const dadosContrato = this.compilarDadosContrato(criarContratoDto, aluno, treinamento, turma, formasPagamento, template, documentoConteudo);

            // Criar registro de contrato
            const contrato = this.uow.turmasAlunosTreinamentosContratosRP.create({
                id_turma_aluno_treinamento: turmaAlunoTreinamentoSalvo.id,
                id_documento: parseInt(criarContratoDto.template_id),
                status_ass_aluno: 'ASSINATURA_PENDENTE' as any,
                data_ass_aluno: new Date(),
                testemunha_um: criarContratoDto.testemunha_um_id ? parseInt(criarContratoDto.testemunha_um_id) : null,
                status_ass_test_um: 'ASSINATURA_PENDENTE' as any,
                data_ass_test_um: new Date(),
                testemunha_dois: criarContratoDto.testemunha_dois_id ? parseInt(criarContratoDto.testemunha_dois_id) : null,
                status_ass_test_dois: 'ASSINATURA_PENDENTE' as any,
                data_ass_test_dois: new Date(),
                dados_contrato: dadosContrato,
                criado_por: userId,
                atualizado_por: userId,
            });

            const contratoSalvo = await this.uow.turmasAlunosTreinamentosContratosRP.save(contrato);

            // Atualizar o objeto dados_contrato com o ID do ZapSign e informações das testemunhas
            const dadosContratoAtualizado = { ...dadosContrato };

            // Adicionar ID do ZapSign
            dadosContratoAtualizado.contrato.id_documento_zapsign = documentoZapSign.id;

            // Preencher informações das testemunhas se forem do banco
            if (criarContratoDto.testemunha_um_id) {
                const testemunhaUm = await this.uow.alunosRP.findOne({
                    where: { id: parseInt(criarContratoDto.testemunha_um_id), deletado_em: null },
                });
                if (testemunhaUm) {
                    dadosContratoAtualizado.testemunhas.testemunha_um.email = testemunhaUm.email;
                    dadosContratoAtualizado.testemunhas.testemunha_um.telefone = testemunhaUm.telefone_um;
                }
            }

            if (criarContratoDto.testemunha_dois_id) {
                const testemunhaDois = await this.uow.alunosRP.findOne({
                    where: { id: parseInt(criarContratoDto.testemunha_dois_id), deletado_em: null },
                });
                if (testemunhaDois) {
                    dadosContratoAtualizado.testemunhas.testemunha_dois.email = testemunhaDois.email;
                    dadosContratoAtualizado.testemunhas.testemunha_dois.telefone = testemunhaDois.telefone_um;
                }
            }

            // Atualizar o registro com os dados completos
            contratoSalvo.dados_contrato = dadosContratoAtualizado;
            await this.uow.turmasAlunosTreinamentosContratosRP.save(contratoSalvo);

            // Retornar resposta formatada
            return {
                id: documentoZapSign.id,
                nome_documento: nomeDocumento,
                status: documentoZapSign.status,
                url_assinatura: documentoZapSign.signers[0]?.status === 'pending' ? `https://zapsign.com.br/assinatura/${documentoZapSign.id}` : undefined,
                signers: documentoZapSign.signers.map((signer) => ({
                    nome: signer.name,
                    email: signer.email,
                    status: signer.status,
                    tipo: signer.status === 'signed' ? 'sign' : 'witness',
                })),
                created_at: documentoZapSign.created_at,
                file_url: documentoZapSign.file_url,
            };
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error('Erro ao criar contrato no ZapSign:', error);
            throw new BadRequestException('Erro ao criar contrato no ZapSign');
        }
    }

    async buscarDocumentoZapSign(documentoId: string): Promise<RespostaContratoZapSignDto> {
        try {
            const documento = await this.zapSignService.getDocument(documentoId);

            return {
                id: documento.id,
                nome_documento: documento.name,
                status: documento.status,
                url_assinatura: documento.signers.some((s) => s.status === 'pending') ? `https://zapsign.com.br/assinatura/${documento.id}` : undefined,
                signers: documento.signers.map((signer) => ({
                    nome: signer.name,
                    email: signer.email,
                    status: signer.status,
                    tipo: signer.status === 'signed' ? 'sign' : 'witness',
                })),
                created_at: documento.created_at,
                file_url: documento.file_url,
            };
        } catch (error) {
            console.error('Erro ao buscar documento do ZapSign:', error);
            throw new BadRequestException('Erro ao buscar documento do ZapSign');
        }
    }

    async listarDocumentosZapSign() {
        try {
            return await this.zapSignService.getDocuments();
        } catch (error) {
            console.error('Erro ao listar documentos do ZapSign:', error);
            throw new BadRequestException('Erro ao listar documentos do ZapSign');
        }
    }

    async cancelarDocumentoZapSign(contratoId: string) {
        try {
            console.log('=== INICIANDO SOFT DELETE DE CONTRATO ===');
            console.log('ID do contrato recebido:', contratoId);

            // Validar se o ID é um número válido
            const contratoIdNum = parseInt(contratoId);
            if (isNaN(contratoIdNum)) {
                throw new BadRequestException('ID do contrato inválido');
            }

            // Buscar o contrato no banco de dados
            const contrato = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
                where: { id: contratoIdNum.toString() },
            });

            if (!contrato) {
                console.log('Contrato não encontrado no banco de dados');
                throw new BadRequestException('Contrato não encontrado');
            }

            // Verificar se o contrato já foi deletado
            if (contrato.deletado_em) {
                console.log('Contrato já foi deletado anteriormente');
                throw new BadRequestException('Este contrato já foi removido anteriormente');
            }

            console.log('Contrato encontrado:', {
                id: contrato.id,
                temDadosContrato: !!contrato.dados_contrato,
                statusAssAluno: contrato.status_ass_aluno,
                jaDeletado: !!contrato.deletado_em,
            });

            // Tentar cancelar no ZapSign se o contrato foi criado lá
            let resultadoZapSign = null;
            if (contrato.dados_contrato) {
                console.log('=== TENTANDO CANCELAR NO ZAPSIGN ===');

                // Extrair o ID do ZapSign dos dados do contrato
                const idDocumentoZapSign = contrato.dados_contrato?.contrato?.id_documento_zapsign;
                const idDocumentoZapSignAlt1 = contrato.dados_contrato?.id_documento_zapsign;
                const idDocumentoZapSignAlt2 = contrato.dados_contrato?.documento_final?.id_zapsign;

                const idFinal = idDocumentoZapSign || idDocumentoZapSignAlt1 || idDocumentoZapSignAlt2;
                console.log('ID do documento ZapSign encontrado:', idFinal);

                if (idFinal) {
                    try {
                        console.log('Cancelando documento no ZapSign com ID:', idFinal);
                        resultadoZapSign = await this.zapSignService.cancelDocument(idFinal);
                        console.log('Documento cancelado no ZapSign com sucesso');
                    } catch (error) {
                        console.log('Erro ao cancelar no ZapSign (continuando com soft delete):', error instanceof Error ? error.message : 'Erro desconhecido');
                        // Não falha o processo se não conseguir cancelar no ZapSign
                    }
                } else {
                    console.log('ID do ZapSign não encontrado - apenas soft delete será realizado');
                }
            } else {
                console.log('Contrato não possui dados_contrato - apenas soft delete será realizado');
            }

            // Realizar soft delete no banco de dados
            console.log('=== REALIZANDO SOFT DELETE ===');
            contrato.deletado_em = new Date();
            contrato.atualizado_em = new Date();

            await this.uow.turmasAlunosTreinamentosContratosRP.save(contrato);

            console.log('Soft delete realizado com sucesso');
            console.log('Data de deleção:', contrato.deletado_em);

            return {
                message: 'Contrato removido com sucesso',
                deletado_em: contrato.deletado_em,
                zapSign_cancelado: !!resultadoZapSign,
                zapSign_resultado: resultadoZapSign,
            };
        } catch (error) {
            console.error('=== ERRO NO SOFT DELETE ===');
            console.error('Erro ao realizar soft delete do contrato:', error);
            // Se já é um BadRequestException, relançar sem modificar
            if (error instanceof BadRequestException) {
                throw error;
            }
            // Para outros erros, criar uma nova exceção
            throw new BadRequestException('Erro ao remover contrato');
        }
    }

    async enviarLembreteAssinatura(contratoId: string) {
        try {
            console.log('=== INICIANDO ENVIO DE LEMBRETE ===');
            console.log('ID do contrato recebido:', contratoId);

            // Validar se o ID é um número válido
            const contratoIdNum = parseInt(contratoId);
            if (isNaN(contratoIdNum)) {
                throw new BadRequestException('ID do contrato inválido');
            }

            // Buscar o contrato no banco de dados
            const contrato = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
                where: { id: contratoIdNum.toString() },
            });

            if (!contrato) {
                console.log('Contrato não encontrado no banco de dados');
                throw new BadRequestException('Contrato não encontrado');
            }

            console.log('Contrato encontrado:', {
                id: contrato.id,
                temDadosContrato: !!contrato.dados_contrato,
                statusAssAluno: contrato.status_ass_aluno,
            });

            // Verificar se o contrato tem dados_contrato
            if (!contrato.dados_contrato) {
                console.log('Contrato não possui dados_contrato');
                throw new BadRequestException('Este contrato não possui dados completos. Não é possível enviar lembrete no ZapSign.');
            }

            // Extrair o ID do ZapSign dos dados do contrato
            console.log('=== BUSCANDO ID DO ZAPSIGN ===');
            console.log('Estrutura dos dados_contrato:', JSON.stringify(contrato.dados_contrato, null, 2));

            // Tentar diferentes caminhos para encontrar o ID do ZapSign
            const idDocumentoZapSign = contrato.dados_contrato?.contrato?.id_documento_zapsign;
            const idDocumentoZapSignAlt1 = contrato.dados_contrato?.id_documento_zapsign;
            const idDocumentoZapSignAlt2 = contrato.dados_contrato?.documento_final?.id_zapsign;

            console.log('ID do documento ZapSign (caminho 1):', idDocumentoZapSign);
            console.log('ID do documento ZapSign (caminho 2):', idDocumentoZapSignAlt1);
            console.log('ID do documento ZapSign (caminho 3):', idDocumentoZapSignAlt2);

            const idFinal = idDocumentoZapSign || idDocumentoZapSignAlt1 || idDocumentoZapSignAlt2;
            console.log('ID final escolhido:', idFinal);

            if (!idFinal) {
                console.log('=== FALLBACK: BUSCANDO POR NOME ===');
                // Fallback: tentar encontrar o documento pelo nome
                try {
                    const documentos = await this.zapSignService.getDocuments();
                    console.log('Documentos encontrados no ZapSign:', documentos.length);

                    const nomeDocumento = contrato.dados_contrato?.documento_final?.nome;
                    const nomeAluno = contrato.dados_contrato?.aluno?.nome;

                    console.log('Procurando documento com nome:', nomeDocumento);
                    console.log('Nome do aluno:', nomeAluno);

                    const documentoEncontrado = documentos.find((doc) => {
                        const matchNome = doc.name === nomeDocumento;
                        const matchAluno = doc.name?.includes(nomeAluno);
                        console.log(`Documento "${doc.name}" - Match nome: ${matchNome}, Match aluno: ${matchAluno}`);
                        return matchNome || matchAluno;
                    });

                    if (documentoEncontrado) {
                        console.log('Documento encontrado no ZapSign:', documentoEncontrado.id);
                        return await this.zapSignService.sendReminder(documentoEncontrado.id);
                    } else {
                        console.log('Documento não encontrado no ZapSign. Este contrato pode não ter sido criado no ZapSign ou já foi cancelado.');
                        throw new BadRequestException('Documento não encontrado no ZapSign. Este contrato pode não ter sido criado no ZapSign ou já foi cancelado.');
                    }
                } catch (error) {
                    console.log('Erro ao buscar documentos no ZapSign:', error instanceof Error ? error.message : 'Erro desconhecido');
                    throw new BadRequestException('Não foi possível enviar lembrete. Verifique se o contrato foi criado no ZapSign.');
                }
            }

            console.log('=== ENVIANDO LEMBRETE NO ZAPSIGN ===');
            console.log('ID do documento ZapSign:', idFinal);
            return await this.zapSignService.sendReminder(idFinal);
        } catch (error) {
            console.error('=== ERRO NO ENVIO DE LEMBRETE ===');
            console.error('Erro ao enviar lembrete:', error);
            // Se já é um BadRequestException, relançar sem modificar
            if (error instanceof BadRequestException) {
                throw error;
            }
            // Para outros erros, criar uma nova exceção
            throw new BadRequestException('Erro ao enviar lembrete');
        }
    }

    private construirDocumentoDinamico(template: any, aluno: any, treinamento: any, turma: any, formasPagamento: any[], dadosContrato: any): string {
        // Construir o documento baseado no modelo fornecido
        let documento = this.construirEstruturaContrato(template, aluno, treinamento, turma, formasPagamento, dadosContrato);

        // Substituir campos dinâmicos baseados nos campos da tabela documentos
        if (template.campos && Array.isArray(template.campos)) {
            template.campos.forEach((campo: any) => {
                const placeholder = `{{${campo.campo}}}`;
                let valor = '';

                // Mapear campos específicos baseados no nome do campo
                switch (campo.campo) {
                    case 'Nome Completo do Aluno':
                    case 'Nome Completo':
                        valor = aluno.nome;
                        break;
                    case 'Nome do Treinamento Contratado':
                        valor = treinamento.treinamento;
                        break;
                    case 'Email do Aluno':
                        valor = aluno.email;
                        break;
                    case 'CPF do Aluno':
                        valor = aluno.cpf;
                        break;
                    case 'Telefone do Aluno':
                        valor = aluno.telefone_um;
                        break;
                    case 'Preço do Treinamento':
                        valor = `R$ ${treinamento.preco_treinamento.toFixed(2).replace('.', ',')}`;
                        break;
                    case 'Forma de Pagamento':
                        valor = dadosContrato.forma_pagamento;
                        break;
                    case 'Data do Contrato':
                        valor = new Date().toLocaleDateString('pt-BR');
                        break;
                    case 'Local do Contrato':
                        valor = aluno.id_polo_fk?.nome || 'Local a definir';
                        break;
                    case 'Observações':
                        valor = dadosContrato.observacoes || '';
                        break;
                    default: {
                        // Tentar mapear automaticamente baseado em palavras-chave
                        const campoLower = campo.campo.toLowerCase();
                        if (campoLower.includes('nome') && campoLower.includes('aluno')) {
                            valor = aluno.nome;
                        } else if (campoLower.includes('treinamento')) {
                            valor = treinamento.treinamento;
                        } else if (campoLower.includes('email')) {
                            valor = aluno.email;
                        } else if (campoLower.includes('cpf')) {
                            valor = aluno.cpf;
                        } else if (campoLower.includes('telefone')) {
                            valor = aluno.telefone_um;
                        } else if (campoLower.includes('preço') || campoLower.includes('valor')) {
                            valor = `R$ ${treinamento.preco_treinamento.toFixed(2).replace('.', ',')}`;
                        } else if (campoLower.includes('data') && campoLower.includes('imersão') && campoLower.includes('prosperar')) {
                            valor = turma?.data_inicio ? new Date(turma.data_inicio).toLocaleDateString('pt-BR') : '___/___/___';
                        } else if (campoLower.includes('data')) {
                            valor = new Date().toLocaleDateString('pt-BR');
                        } else if (campoLower.includes('local')) {
                            valor = aluno.id_polo_fk?.nome || 'Local a definir';
                        } else if (campoLower.includes('quantidade') && campoLower.includes('inscrições')) {
                            valor = dadosContrato.campos_variaveis?.['Quantidade de Inscrições'] || '1';
                        } else {
                            // Verificar se é um campo variável
                            if (dadosContrato.campos_variaveis && dadosContrato.campos_variaveis[campo.campo]) {
                                valor = dadosContrato.campos_variaveis[campo.campo];
                            } else {
                                valor = `[${campo.campo}]`;
                            }
                        }
                        break;
                    }
                }

                documento = documento.replace(new RegExp(placeholder, 'g'), valor);
            });
        }

        return documento;
    }

    private construirEstruturaContrato(template: any, aluno: any, treinamento: any, turma: any, formasPagamento: any[], dadosContrato: any): string {
        const dataAtual = new Date().toLocaleDateString('pt-BR');
        const localContrato = dadosContrato.campos_variaveis?.['Local de Assinatura do Contrato'] || aluno.id_polo_fk?.nome || 'Local a definir';
        const cidadeTreinamento = dadosContrato.campos_variaveis?.['Cidade do Treinamento'] || 'Local a definir';
        const dataInicioTreinamento = dadosContrato.campos_variaveis?.['Data Prevista do Treinamento'] || 'Data Prevista do Treinamento';
        const dataFimTreinamento = dadosContrato.campos_variaveis?.['Data Final do Treinamento'] || 'Data Final do Treinamento';

        // Construir informações de pagamento detalhadas
        const infoPagamento = this.construirInfoPagamentoDetalhada(dadosContrato, formasPagamento);

        // Construir informações de bônus detalhadas
        const infoBonus = this.construirInfoBonusDetalhada(dadosContrato, turma);

        // Construir informações de testemunhas
        let infoTestemunhas = '';
        if (dadosContrato.testemunha_um_id || dadosContrato.testemunha_um_nome) {
            const testemunhaUm = dadosContrato.testemunha_um_nome || 'Testemunha 1';
            const cpfTestemunhaUm = dadosContrato.testemunha_um_cpf || 'CPF da testemunha';
            infoTestemunhas += `Testemunha 1:\nNome: ${testemunhaUm}\nCPF: ${cpfTestemunhaUm}\n\n`;
        }

        if (dadosContrato.testemunha_dois_id || dadosContrato.testemunha_dois_nome) {
            const testemunhaDois = dadosContrato.testemunha_dois_nome || 'Testemunha 2';
            const cpfTestemunhaDois = dadosContrato.testemunha_dois_cpf || 'CPF da testemunha';
            infoTestemunhas += `Testemunha 2:\nNome: ${testemunhaDois}\nCPF: ${cpfTestemunhaDois}\n\n`;
        }

        // Construir o documento no novo formato
        let documento = `
INSTITUTO ACADEMY MIND

O presente instrumento tem como objetivo realizar a inscrição da pessoa abaixo nominada no seguinte treinamento:

1. Dados Pessoais

Nome completo: ${aluno.nome}

CPF: ${aluno.cpf}

WhatsApp: ${aluno.telefone_um}

E-mail: ${aluno.email}

Endereço: ${aluno.logradouro || ''} ${aluno.numero || ''} ${aluno.complemento || ''} ${aluno.bairro || ''}

Cidade/Estado: ${aluno.cidade || ''}/${aluno.estado || ''}

CEP: ${aluno.cep || ''}
===================
2. Treinamento e Bônus

Treinamento: ${treinamento.treinamento}

Cidade: ${cidadeTreinamento}

Data prevista: ${dataInicioTreinamento} à ${dataFimTreinamento}

Preço do contrato: ${this.calcularPrecoTotalContrato(dadosContrato)}

Bônus incluídos: ${infoBonus}
===============
3. Formas de Pagamento

${infoPagamento}

Local: ${localContrato}                    Data: ${dataAtual}

Declaro que li e concordo com todas as cláusulas deste contrato, redigidas em 2 laudas, estando ciente de todas elas, por meio da assinatura abaixo e na presença de 2 testemunhas.

Assinatura do ALUNO/Contratante:
_________________________________

${infoTestemunhas}
`;

        // Adicionar as cláusulas do template se existirem
        if (template.clausulas && template.clausulas.trim()) {
            documento += `\n\n─────────────────────────────────────────────────────────────────────────────────\n`;
            documento += `CLÁUSULAS DO CONTRATO\n`;
            documento += `─────────────────────────────────────────────────────────────────────────────────\n\n`;
            documento += template.clausulas;
        }

        return documento;
    }

    /**
     * Constrói informações detalhadas de pagamento no formato solicitado
     */
    private construirInfoPagamentoDetalhada(dadosContrato: any, formasPagamento: any[]): string {
        const valoresFormas = dadosContrato.valores_formas_pagamento || {};
        let infoPagamento = '';

        if (dadosContrato.forma_pagamento === 'A_VISTA') {
            // Processar formas à vista
            const formasVista = [];
            if (valoresFormas['À Vista - Cartão de Crédito']) {
                const valor = parseInt(valoresFormas['À Vista - Cartão de Crédito'].valor) / 100;
                formasVista.push(`☑ Cartão de Crédito - ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
            }
            if (valoresFormas['À Vista - Cartão de Débito']) {
                const valor = parseInt(valoresFormas['À Vista - Cartão de Débito'].valor) / 100;
                formasVista.push(`☑ Cartão de Débito - ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
            }
            if (valoresFormas['À Vista - PIX/Transferência']) {
                const valor = parseInt(valoresFormas['À Vista - PIX/Transferência'].valor) / 100;
                formasVista.push(`☑ PIX/Transferência - ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
            }
            if (valoresFormas['À Vista - Espécie']) {
                const valor = parseInt(valoresFormas['À Vista - Espécie'].valor) / 100;
                formasVista.push(`☑ Espécie - ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
            }

            infoPagamento = `À vista: ${formasVista.join(', ')}`;
        } else if (dadosContrato.forma_pagamento === 'PARCELADO') {
            // Processar formas parceladas
            const formasParceladas = [];
            if (valoresFormas['Parcelado - Cartão de Crédito']) {
                const dados = valoresFormas['Parcelado - Cartão de Crédito'];
                const valor = parseInt(dados.valor || dados.valor_parcelas) / 100; // Valor total - usar valor_parcelas se valor não existir
                const numeroParcelas = parseInt(dados.numero_parcelas);
                const valorParcela = valor / numeroParcelas;
                formasParceladas.push(
                    `☑ Cartão de Crédito - ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} - Em ${numeroParcelas}x de ${valorParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
                );
            }

            // Processar boleto com chave longa
            const chaveBoletoLonga = 'Parcelado - Boleto:  Parcelas de: . Melhor dia de Vencimento: . Data para o 1º Boleto: .';
            if (valoresFormas[chaveBoletoLonga]) {
                const dados = valoresFormas[chaveBoletoLonga];
                const valor = parseInt(dados.valor || dados.valor_parcelas) / 100; // Valor total - usar valor_parcelas se valor não existir
                const numeroParcelas = parseInt(dados.numero_parcelas);
                const valorParcela = valor / numeroParcelas;
                const melhorDia = dados.melhor_dia_vencimento || '1';
                const primeiroBoleto = dados.data_primeiro_boleto || 'data do primeiro boleto';
                formasParceladas.push(
                    `☑ Boleto - ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (${numeroParcelas}x de ${valorParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}) Primeiro boleto: ${primeiroBoleto}, Melhor dia de vencimento: dia ${melhorDia} de cada mês`,
                );
            }

            infoPagamento = `Parcelado: ${formasParceladas.join(', ')}`;
        } else if (dadosContrato.forma_pagamento === 'AMBOS') {
            // Processar formas mistas
            const formasVista = [];
            const formasParceladas = [];

            // À vista
            if (valoresFormas['À Vista - Cartão de Crédito']) {
                const valor = parseInt(valoresFormas['À Vista - Cartão de Crédito'].valor) / 100;
                formasVista.push(`☑ Cartão de Crédito - ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
            }
            if (valoresFormas['À Vista - Cartão de Débito']) {
                const valor = parseInt(valoresFormas['À Vista - Cartão de Débito'].valor) / 100;
                formasVista.push(`☑ Cartão de Débito - ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
            }
            if (valoresFormas['À Vista - PIX/Transferência']) {
                const valor = parseInt(valoresFormas['À Vista - PIX/Transferência'].valor) / 100;
                formasVista.push(`☑ PIX/Transferência - ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
            }
            if (valoresFormas['À Vista - Espécie']) {
                const valor = parseInt(valoresFormas['À Vista - Espécie'].valor) / 100;
                formasVista.push(`☑ Espécie - ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
            }

            // Parcelado
            if (valoresFormas['Parcelado - Cartão de Crédito']) {
                const dados = valoresFormas['Parcelado - Cartão de Crédito'];
                const valor = parseInt(dados.valor || dados.valor_parcelas) / 100; // Valor total - usar valor_parcelas se valor não existir
                const numeroParcelas = parseInt(dados.numero_parcelas);
                const valorParcela = valor / numeroParcelas;
                formasParceladas.push(
                    `☑ Cartão de Crédito - ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} - Em ${numeroParcelas}x de ${valorParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
                );
            }

            // Processar boleto com chave longa
            const chaveBoletoLonga = 'Parcelado - Boleto:  Parcelas de: . Melhor dia de Vencimento: . Data para o 1º Boleto: .';
            if (valoresFormas[chaveBoletoLonga]) {
                const dados = valoresFormas[chaveBoletoLonga];
                const valor = parseInt(dados.valor || dados.valor_parcelas) / 100; // Valor total - usar valor_parcelas se valor não existir
                const numeroParcelas = parseInt(dados.numero_parcelas);
                const valorParcela = valor / numeroParcelas;
                const melhorDia = dados.melhor_dia_vencimento || '1';
                const primeiroBoleto = dados.data_primeiro_boleto || 'data do primeiro boleto';
                formasParceladas.push(
                    `☑ Boleto - ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (${numeroParcelas}x de ${valorParcela.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}) Primeiro boleto: ${primeiroBoleto}, Melhor dia de vencimento: dia ${melhorDia} de cada mês`,
                );
            }

            const partes = [];
            if (formasVista.length > 0) {
                partes.push(`À vista: ${formasVista.join(', ')}`);
            }
            if (formasParceladas.length > 0) {
                partes.push(`Parcelado: ${formasParceladas.join(', ')}`);
            }

            infoPagamento = partes.join('\n\n');
        }

        return infoPagamento;
    }

    /**
     * Constrói informações detalhadas de bônus no formato solicitado
     */
    private construirInfoBonusDetalhada(dadosContrato: any, turma: any): string {
        const tiposBonus = dadosContrato.tipos_bonus || [];
        const valoresBonus = dadosContrato.valores_bonus || {};
        const camposVariaveis = dadosContrato.campos_variaveis || {};
        const bonusAtivos = [];

        // Verificar quais bônus estão ativos
        if (tiposBonus.includes('100_dias')) {
            bonusAtivos.push('☑ 100 Dias');
        }

        if (tiposBonus.includes('ipr') && dadosContrato.id_turma_bonus && turma) {
            const quantidadeInscricoes = camposVariaveis['Quantidade de Inscrições'] || camposVariaveis['Quantidade de Inscrições do Prosperar'] || '1';
            const dataImersao = turma.data_inicio ? new Date(turma.data_inicio).toLocaleDateString('pt-BR') : '09/10/2025';
            bonusAtivos.push(`☑ ${quantidadeInscricoes} - Inscrição Imersão Prosperar – Data: ${dataImersao}`);
        }

        if (valoresBonus['Bônus-Outros: {{Descrição do Outro Bônus}}'] && camposVariaveis['Descrição do Outro Bônus']) {
            const descricaoOutros = camposVariaveis['Descrição do Outro Bônus'];
            bonusAtivos.push(`☑ Outros: ${descricaoOutros}`);
        }

        // Se não há bônus ativos, mostrar "Não se aplica"
        if (bonusAtivos.length === 0) {
            return '☑ Não se aplica';
        }

        return bonusAtivos.join('\n');
    }

    /**
     * Calcula o preço total do contrato somando todas as formas de pagamento
     */
    private calcularPrecoTotalContrato(dadosContrato: any): string {
        const valoresFormas = dadosContrato.valores_formas_pagamento || {};
        let total = 0;

        // Somar todos os valores das formas de pagamento
        Object.values(valoresFormas).forEach((dados: any) => {
            if (dados.valor) {
                const valor = typeof dados.valor === 'string' ? parseInt(dados.valor) : dados.valor;
                total += valor / 100; // Converter de centavos para reais
            }
        });

        return total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    /**
     * Enriquece os dados de formas de pagamento com campos calculados
     */
    private enriquecerValoresFormasPagamento(valoresFormas: Record<string, any>): Record<string, any> {
        const valoresEnriquecidos = { ...valoresFormas };

        // Processar boleto parcelado
        if (valoresFormas['Parcelado - Boleto']) {
            const dadosBoleto = valoresFormas['Parcelado - Boleto'];
            const valorTotalCentavos = parseInt(dadosBoleto.valor); // Valor total em centavos
            const valorTotalReais = valorTotalCentavos / 100; // Converter para reais
            const numeroParcelas = parseInt(dadosBoleto.numero_parcelas);
            const valorParcelaReais = valorTotalReais / numeroParcelas;

            valoresEnriquecidos['Parcelado - Boleto'] = {
                ...dadosBoleto,
                valor_parcelas: valorParcelaReais.toFixed(2), // Valor por parcela em reais com 2 casas decimais
            };
        }

        // Processar boleto com chave longa (formato antigo)
        const chaveBoletoLonga = 'Parcelado - Boleto:  Parcelas de: . Melhor dia de Vencimento: . Data para o 1º Boleto: .';
        if (valoresFormas[chaveBoletoLonga]) {
            const dadosBoleto = valoresFormas[chaveBoletoLonga];
            const valorTotalCentavos = parseInt(dadosBoleto.valor_parcelas); // Valor total em centavos
            const valorTotalReais = valorTotalCentavos / 100; // Converter para reais
            const numeroParcelas = parseInt(dadosBoleto.numero_parcelas);
            const valorParcelaReais = valorTotalReais / numeroParcelas;

            valoresEnriquecidos[chaveBoletoLonga] = {
                ...dadosBoleto,
                valor: valorTotalCentavos.toString(), // Valor total em centavos
                valor_parcelas: valorParcelaReais.toFixed(2), // Valor por parcela em reais com 2 casas decimais
            };
        }

        // Processar cartão de crédito parcelado
        if (valoresFormas['Parcelado - Cartão de Crédito']) {
            const dadosCartao = valoresFormas['Parcelado - Cartão de Crédito'];
            const valorTotalCentavos = parseInt(dadosCartao.valor); // Valor total em centavos
            const valorTotalReais = valorTotalCentavos / 100; // Converter para reais
            const numeroParcelas = parseInt(dadosCartao.numero_parcelas);
            const valorParcelaReais = valorTotalReais / numeroParcelas;

            valoresEnriquecidos['Parcelado - Cartão de Crédito'] = {
                ...dadosCartao,
                valor_parcelas: valorParcelaReais.toFixed(2), // Valor por parcela em reais com 2 casas decimais
            };
        }

        return valoresEnriquecidos;
    }

    /**
     * Compila todos os dados do contrato em um objeto estruturado para armazenamento
     */
    private compilarDadosContrato(
        criarContratoDto: CriarContratoZapSignDto,
        aluno: any,
        treinamento: any,
        turma: any,
        formasPagamento: any[],
        template: any,
        documentoConteudo: string,
    ): any {
        const dataAtual = new Date();

        return {
            // Informações básicas do contrato
            contrato: {
                id_documento_zapsign: null, // Será preenchido após criação no ZapSign
                template_id: criarContratoDto.template_id,
                data_criacao: dataAtual.toISOString(),
                data_criacao_brasil: dataAtual.toLocaleDateString('pt-BR'),
                observacoes: criarContratoDto.observacoes || null,
                status: 'PENDENTE_ASSINATURA',
            },

            // Dados do aluno
            aluno: {
                id: aluno.id,
                nome: aluno.nome,
                email: aluno.email,
                cpf: aluno.cpf,
                telefone_um: aluno.telefone_um,
                telefone_dois: aluno.telefone_dois || null,
                data_nascimento: aluno.data_nascimento || null,
                endereco: {
                    logradouro: aluno.logradouro || null,
                    numero: aluno.numero || null,
                    complemento: aluno.complemento || null,
                    bairro: aluno.bairro || null,
                    cidade: aluno.cidade || null,
                    estado: aluno.estado || null,
                    cep: aluno.cep || null,
                },
                polo: {
                    id: aluno.id_polo_fk?.id || null,
                    nome: aluno.id_polo_fk?.nome || null,
                    cidade: aluno.id_polo_fk?.cidade || null,
                    estado: aluno.id_polo_fk?.estado || null,
                },
            },

            // Dados do treinamento
            treinamento: {
                id: treinamento.id,
                nome: treinamento.treinamento,
                sigla: treinamento.sigla_treinamento || null,
                preco: treinamento.preco_treinamento,
                descricao: treinamento.descricao || null,
                carga_horaria: treinamento.carga_horaria || null,
                modalidade: treinamento.modalidade || null,
                url_logo_treinamento: treinamento.url_logo_treinamento || null,
            },

            // Dados da turma bônus (IPR)
            turma_bonus: turma
                ? {
                      id: turma.id,
                      turma: turma.turma,
                      edicao_turma: turma.edicao_turma || null,
                      data_inicio: turma.data_inicio,
                      data_fim: turma.data_final,
                      status_turma: turma.status_turma,
                      cidade: turma.cidade,
                      estado: turma.estado,
                      lider_evento: turma.lider_evento_fk
                          ? {
                                id: turma.lider_evento_fk.id,
                                nome: turma.lider_evento_fk.nome,
                                email: turma.lider_evento_fk.email,
                            }
                          : null,
                  }
                : null,

            // Formas de pagamento
            pagamento: {
                forma_pagamento: criarContratoDto.forma_pagamento,
                formas_pagamento: formasPagamento.map((fp) => ({
                    tipo: fp.tipo,
                    forma: fp.forma,
                    valor: fp.valor,
                    descricao: fp.descricao || null,
                })),
                valores_formas_pagamento: this.enriquecerValoresFormasPagamento(criarContratoDto.valores_formas_pagamento || {}),
            },

            // Bônus e campos variáveis
            bonus: {
                tipos_bonus: criarContratoDto.tipos_bonus || [],
                valores_bonus: criarContratoDto.valores_bonus || {},
                id_turma_bonus: criarContratoDto.id_turma_bonus || null,
                turma_bonus_info: turma
                    ? {
                          id: turma.id,
                          turma: turma.turma,
                          edicao_turma: turma.edicao_turma || null,
                          data_inicio: turma.data_inicio,
                          data_fim: turma.data_final,
                          status_turma: turma.status_turma,
                          cidade: turma.cidade,
                          estado: turma.estado,
                      }
                    : null,
            },

            // Campos variáveis do contrato
            campos_variaveis: criarContratoDto.campos_variaveis || {},

            // Testemunhas
            testemunhas: {
                testemunha_um: {
                    tipo: criarContratoDto.testemunha_um_id ? 'banco' : 'manual',
                    id: criarContratoDto.testemunha_um_id || null,
                    nome: criarContratoDto.testemunha_um_nome || null,
                    cpf: criarContratoDto.testemunha_um_cpf || null,
                    email: null, // Será preenchido se for do banco
                    telefone: null, // Será preenchido se for do banco
                },
                testemunha_dois: {
                    tipo: criarContratoDto.testemunha_dois_id ? 'banco' : 'manual',
                    id: criarContratoDto.testemunha_dois_id || null,
                    nome: criarContratoDto.testemunha_dois_nome || null,
                    cpf: criarContratoDto.testemunha_dois_cpf || null,
                    email: null, // Será preenchido se for do banco
                    telefone: null, // Será preenchido se for do banco
                },
            },

            // Template utilizado
            template: {
                id: template.id,
                nome: template.documento,
                tipo_documento: template.tipo_documento,
                campos_disponiveis: template.campos || [],
                clausulas: template.clausulas || null,
            },

            // Documento final gerado
            documento_final: {
                nome: `Contrato ${treinamento.treinamento} - ${aluno.nome} - ${dataAtual.toLocaleDateString('pt-BR')}`,
                conteudo: documentoConteudo,
                data_geracao: dataAtual.toISOString(),
            },

            // Metadados do sistema
            metadata: {
                versao_dados_contrato: '1.0',
                criado_por: null, // Será preenchido pelo userId
                data_compilacao: dataAtual.toISOString(),
                origem: 'CRIACAO_CONTRATO_ZAPSIGN',
            },
        };
    }

    /**
     * Busca um contrato específico com todos os dados armazenados
     */
    async buscarContratoCompleto(contratoId: string): Promise<any> {
        try {
            const contrato = await this.uow.turmasAlunosTreinamentosContratosRP.findOne({
                where: { id: contratoId, deletado_em: null },
                relations: ['id_turma_aluno_treinamento_fk', 'id_documento_fk', 'testemunha_um_fk', 'testemunha_dois_fk'],
            });

            if (!contrato) {
                throw new NotFoundException('Contrato não encontrado');
            }

            return {
                id: contrato.id,
                status_ass_aluno: contrato.status_ass_aluno,
                data_ass_aluno: contrato.data_ass_aluno,
                status_ass_test_um: contrato.status_ass_test_um,
                data_ass_test_um: contrato.data_ass_test_um,
                status_ass_test_dois: contrato.status_ass_test_dois,
                data_ass_test_dois: contrato.data_ass_test_dois,
                dados_contrato: {
                    ...contrato.dados_contrato,
                    contrato: {
                        ...contrato.dados_contrato?.contrato,
                        url_assinatura: contrato.dados_contrato?.contrato?.id_documento_zapsign
                            ? `https://zapsign.com.br/assinatura/${contrato.dados_contrato.contrato.id_documento_zapsign}`
                            : null,
                        file_url: contrato.dados_contrato?.contrato?.file_url || null,
                    },
                },
                aluno_nome: contrato.dados_contrato?.aluno?.nome || 'N/A',
                treinamento_nome: contrato.dados_contrato?.treinamento?.nome || 'N/A',
                testemunhas: {
                    testemunha_um: contrato.testemunha_um_fk
                        ? {
                              id: contrato.testemunha_um_fk.id,
                              nome: contrato.testemunha_um_fk.nome,
                              email: contrato.testemunha_um_fk.email,
                          }
                        : null,
                    testemunha_dois: contrato.testemunha_dois_fk
                        ? {
                              id: contrato.testemunha_dois_fk.id,
                              nome: contrato.testemunha_dois_fk.nome,
                              email: contrato.testemunha_dois_fk.email,
                          }
                        : null,
                },
                documento: contrato.id_documento_fk
                    ? {
                          id: contrato.id_documento_fk.id,
                          nome: contrato.id_documento_fk.documento,
                          tipo: contrato.id_documento_fk.tipo_documento,
                      }
                    : null,
                turma_aluno_treinamento: contrato.id_turma_aluno_treinamento_fk,
                created_at: contrato.criado_em,
                updated_at: contrato.atualizado_em,
            };
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error('Erro ao buscar contrato completo:', error);
            throw new BadRequestException('Erro ao buscar contrato completo');
        }
    }

    /**
     * Lista contratos com filtros opcionais
     */
    async listarContratos(filtros?: {
        id_aluno?: string;
        id_treinamento?: string;
        status?: string;
        data_inicio?: string;
        data_fim?: string;
        page?: number;
        limit?: number;
    }): Promise<any> {
        try {
            const query = this.uow.turmasAlunosTreinamentosContratosRP
                .createQueryBuilder('contrato')
                .leftJoinAndSelect('contrato.id_turma_aluno_treinamento_fk', 'tat')
                .leftJoinAndSelect('contrato.id_documento_fk', 'doc')
                .leftJoinAndSelect('contrato.testemunha_um_fk', 'test1')
                .leftJoinAndSelect('contrato.testemunha_dois_fk', 'test2')
                .where('contrato.deletado_em IS NULL');

            // Aplicar filtros
            if (filtros?.id_aluno) {
                query.andWhere('JSON_EXTRACT(contrato.dados_contrato, "$.aluno.id") = :id_aluno', { id_aluno: filtros.id_aluno });
            }

            if (filtros?.id_treinamento) {
                query.andWhere('JSON_EXTRACT(contrato.dados_contrato, "$.treinamento.id") = :id_treinamento', { id_treinamento: filtros.id_treinamento });
            }

            if (filtros?.status) {
                query.andWhere('JSON_EXTRACT(contrato.dados_contrato, "$.contrato.status") = :status', { status: filtros.status });
            }

            if (filtros?.data_inicio) {
                query.andWhere('DATE(contrato.criado_em) >= :data_inicio', { data_inicio: filtros.data_inicio });
            }

            if (filtros?.data_fim) {
                query.andWhere('DATE(contrato.criado_em) <= :data_fim', { data_fim: filtros.data_fim });
            }

            // Paginação
            const page = filtros?.page || 1;
            const limit = filtros?.limit || 10;
            const skip = (page - 1) * limit;

            query.orderBy('contrato.criado_em', 'DESC').skip(skip).take(limit);

            const [contratos, total] = await query.getManyAndCount();

            return {
                data: contratos.map((contrato) => ({
                    id: contrato.id,
                    dados_contrato: contrato.dados_contrato,
                    status_ass_aluno: contrato.status_ass_aluno,
                    data_ass_aluno: contrato.data_ass_aluno,
                    created_at: contrato.criado_em,
                    aluno_nome: contrato.dados_contrato?.aluno?.nome || 'N/A',
                    treinamento_nome: contrato.dados_contrato?.treinamento?.nome || 'N/A',
                })),
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            };
        } catch (error) {
            console.error('Erro ao listar contratos:', error);
            throw new BadRequestException('Erro ao listar contratos');
        }
    }
}
