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

@Injectable()
export class DocumentosService {
    constructor(
        private readonly uow: UnitOfWorkService,
        private readonly zapSignService: ZapSignService,
    ) {}

    async createDocumento(createDocumentoDto: CreateDocumentoDto, userId?: number): Promise<DocumentoResponseDto> {
        try {
            const documento = this.uow.documentosRP.create({
                documento: createDocumentoDto.documento,
                tipo_documento: createDocumentoDto.tipo_documento,
                campos: createDocumentoDto.campos,
                clausulas: createDocumentoDto.clausulas,
                criado_por: userId,
                atualizado_por: userId,
            });

            const savedDocumento = await this.uow.documentosRP.save(documento);
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

            // Atualizar auditoria
            documento.atualizado_por = userId;

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

            // Calcular preço total baseado na forma de pagamento
            const precoTotal = treinamento.preco_treinamento;
            const formasPagamento: { forma: EFormasPagamento; valor: number }[] = [];

            if (criarContratoDto.forma_pagamento === 'A_VISTA') {
                formasPagamento.push({
                    forma: EFormasPagamento.PIX,
                    valor: precoTotal,
                });
            } else if (criarContratoDto.forma_pagamento === 'PARCELADO' && criarContratoDto.formas_pagamento) {
                criarContratoDto.formas_pagamento.forEach((fp) => {
                    formasPagamento.push({
                        forma: fp.forma as EFormasPagamento,
                        valor: fp.valor,
                    });
                });
            }

            // Buscar template do documento
            const template = await this.uow.documentosRP.findOne({
                where: { id: parseInt(criarContratoDto.template_id), deletado_em: null },
            });

            if (!template) {
                throw new NotFoundException('Template não encontrado');
            }

            // Criar nome do documento
            const nomeDocumento = `Contrato ${treinamento.treinamento} - ${aluno.nome} - ${new Date().toLocaleDateString('pt-BR')}`;

            // Construir documento dinamicamente baseado nos campos da tabela
            const documentoConteudo = this.construirDocumentoDinamico(template, aluno, treinamento, turma, formasPagamento, criarContratoDto);

            // Criar documento no ZapSign usando o conteúdo construído
            const documentoZapSign = await this.zapSignService.createDocumentFromContent({
                name: nomeDocumento,
                content: documentoConteudo,
                signers: signers,
                message: `Contrato para o treinamento ${treinamento.treinamento}. ${criarContratoDto.observacoes || ''}`,
            });

            // Salvar informações do contrato no banco
            // Buscar turma do aluno (se houver turma de IPR)
            let turmaAluno = null;
            if (criarContratoDto.id_turma_bonus) {
                turmaAluno = await this.uow.turmasAlunosRP.findOne({
                    where: {
                        id_turma: parseInt(criarContratoDto.id_turma_bonus),
                        id_aluno: criarContratoDto.id_aluno,
                        deletado_em: null,
                    },
                });
            }

            // Turma de IPR é opcional

            // Criar registro de treinamento do aluno
            const turmaAlunoTreinamento = this.uow.turmasAlunosTreinamentosRP.create({
                id_turma_aluno: turmaAluno?.id || '1', // ID padrão se não houver turma
                id_treinamento: parseInt(criarContratoDto.id_treinamento),
                preco_treinamento: treinamento.preco_treinamento,
                forma_pgto: formasPagamento,
                preco_total_pago: precoTotal,
                criado_por: userId,
                atualizado_por: userId,
            });

            const turmaAlunoTreinamentoSalvo = await this.uow.turmasAlunosTreinamentosRP.save(turmaAlunoTreinamento);

            // Criar registro de contrato
            const contrato = this.uow.turmasAlunosTreinamentosContratosRP.create({
                id_turma_aluno_treinamento: turmaAlunoTreinamentoSalvo.id,
                id_documento: 1, // ID do documento padrão, pode ser ajustado conforme necessário
                status_ass_aluno: 'ASSINATURA_PENDENTE' as any,
                data_ass_aluno: new Date(),
                testemunha_um: criarContratoDto.testemunha_um_id ? parseInt(criarContratoDto.testemunha_um_id) : null,
                status_ass_test_um: 'ASSINATURA_PENDENTE' as any,
                data_ass_test_um: new Date(),
                testemunha_dois: criarContratoDto.testemunha_dois_id ? parseInt(criarContratoDto.testemunha_dois_id) : null,
                status_ass_test_dois: 'ASSINATURA_PENDENTE' as any,
                data_ass_test_dois: new Date(),
                criado_por: userId,
                atualizado_por: userId,
            });

            await this.uow.turmasAlunosTreinamentosContratosRP.save(contrato);

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

    async cancelarDocumentoZapSign(documentoId: string) {
        try {
            return await this.zapSignService.cancelDocument(documentoId);
        } catch (error) {
            console.error('Erro ao cancelar documento do ZapSign:', error);
            throw new BadRequestException('Erro ao cancelar documento do ZapSign');
        }
    }

    async enviarLembreteAssinatura(documentoId: string) {
        try {
            return await this.zapSignService.sendReminder(documentoId);
        } catch (error) {
            console.error('Erro ao enviar lembrete:', error);
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
                        } else if (campoLower.includes('data')) {
                            valor = new Date().toLocaleDateString('pt-BR');
                        } else if (campoLower.includes('local')) {
                            valor = aluno.id_polo_fk?.nome || 'Local a definir';
                        } else {
                            valor = `[${campo.campo}]`;
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
        const localContrato = aluno.id_polo_fk?.nome || 'Local a definir';

        // Construir informações de pagamento
        let infoPagamento = '';
        if (dadosContrato.forma_pagamento === 'A_VISTA') {
            infoPagamento = 'À VISTA';
        } else if (dadosContrato.forma_pagamento === 'PARCELADO') {
            infoPagamento = 'PARCELADO';
            if (formasPagamento && formasPagamento.length > 0) {
                const primeiraParcela = formasPagamento[0];
                infoPagamento += ` - ${primeiraParcela.forma}: R$ ${primeiraParcela.valor.toFixed(2).replace('.', ',')}`;
                if (formasPagamento.length > 1) {
                    infoPagamento += ` + ${formasPagamento.length - 1} parcelas`;
                }
            }
        }

        // Construir informações de bônus
        let infoBonus = '';
        if (dadosContrato.id_turma_bonus && turma) {
            infoBonus = `BÔNUS: INSCRIÇÕES IMERSÃO PROSPERAR - Data: ${turma.data_inicio}`;
        } else {
            infoBonus = 'BÔNUS: NÃO SE APLICA';
        }

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

        // Construir o documento baseado no modelo
        let documento = `
INSTITUTO ACADEMY MIND

O presente instrumento tem como objetivo realizar a inscrição da pessoa abaixo nominada no seguinte treinamento:

┌─────────────────────────────────────────────────────────────────────────────────┐
│ DADOS PESSOAIS                                                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│ NOME COMPLETO: ${aluno.nome}                                                      │
│ CPF/CNPJ: ${aluno.cpf}                    DATA DE NASCIMENTO: ___/___/___        │
│ WHATSAPP: ${aluno.telefone_um}              E-MAIL: ${aluno.email}              │
│ ENDEREÇO: _________________________________________________                     │
│ CIDADE/ESTADO: ____________________________ CEP: ___________                    │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│ TREINAMENTO E BÔNUS                                                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│ TREINAMENTO: ${treinamento.treinamento}                                          │
│ CIDADE: ${localContrato}                                                         │
│ DATA PREVISTA: ___/___/___                                                      │
│ PREÇO DO CONTRATO: R$ ${treinamento.preco_treinamento.toFixed(2).replace('.', ',')}                    │
│                                                                                 │
│ BÔNUS:                                                                          │
│ ☐ NÃO SE APLICA                                                                 │
│ ☐ 100 DIAS                                                                      │
│ ${dadosContrato.id_turma_bonus ? '☑' : '☐'} INSCRIÇÕES IMERSÃO PROSPERAR - Data: ___/___/___            │
│ ☐ OUTROS: _________________________________________________                     │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│ FORMAS DE PAGAMENTO                                                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│ À VISTA:                                                                        │
│ ${dadosContrato.forma_pagamento === 'A_VISTA' ? '☑' : '☐'} CARTÃO DE CRÉDITO     ${dadosContrato.forma_pagamento === 'A_VISTA' ? '☐' : '☐'} CARTÃO DE DÉBITO    │
│ ☐ PIX/TRANSFERÊNCIA    ☐ ESPÉCIE                                               │
│                                                                                 │
│ PARCELADO:                                                                      │
│ ${dadosContrato.forma_pagamento === 'PARCELADO' ? '☑' : '☐'} CARTÃO DE CRÉDITO                                 │
│ BOLETO: ENTRADA DE R$ _____ EM ___/___/___                                      │
│ + ____ PARCELAS DE: R$ _____                                                   │
│ MELHOR DIA DE VENCIMENTO: _____                                                 │
│ 1º BOLETO PARA: ___/___/___                                                     │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│ OBSERVAÇÕES:                                                                    │
│ ${dadosContrato.observacoes || '                                                                                 '} │
│                                                                                 │
│                                                                                 │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

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
}
