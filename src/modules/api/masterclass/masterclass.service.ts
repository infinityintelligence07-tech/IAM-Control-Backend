import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { In, LessThanOrEqual } from 'typeorm';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { EStatusAlunosGeral } from '../../config/entities/enum';
import { MasterclassPreCadastros } from '../../config/entities/masterclassPreCadastros.entity';
import {
    CreateMasterclassEventoDto,
    UploadMasterclassCsvDto,
    MasterclassPreCadastroDto,
    ConfirmarPresencaDto,
    VincularAlunoDto,
    AlterarInteresseDto,
    MasterclassPreCadastroResponseDto,
    MasterclassEventoResponseDto,
    MasterclassListResponseDto,
    MasterclassStatsDto,
    CreateMasterclassPreCadastroDto,
    UpdateMasterclassPreCadastroDto,
    SoftDeleteMasterclassPreCadastroDto,
} from './dto/masterclass.dto';
import * as csv from 'csv-parser';
import { Readable } from 'stream';
import * as XLSX from 'xlsx';

@Injectable()
export class MasterclassService {
    constructor(private readonly uow: UnitOfWorkService) {}

    /**
     * Criar um novo evento de masterclass
     */
    async createEvento(createEventoDto: CreateMasterclassEventoDto): Promise<MasterclassEventoResponseDto> {
        try {
            // Verificar se já existe um evento com o mesmo nome e data
            const eventoExistente = await this.uow.masterclassPreCadastrosRP.findOne({
                where: {
                    evento_nome: createEventoDto.evento_nome,
                    data_evento: new Date(createEventoDto.data_evento),
                },
            });

            if (eventoExistente) {
                throw new BadRequestException('Já existe um evento com este nome e data');
            }

            // Retornar evento vazio (sem pré-cadastros ainda)
            return {
                evento_nome: createEventoDto.evento_nome,
                data_evento: new Date(createEventoDto.data_evento),
                total_inscritos: 0,
                total_presentes: 0,
                total_ausentes: 0,
                total_vinculados: 0,
                taxa_presenca: 0,
                pre_cadastros: [],
            };
        } catch (error) {
            console.error('Erro ao criar evento de masterclass:', error);
            if (error instanceof BadRequestException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao criar evento');
        }
    }

    /**
     * Detectar tipo de arquivo e converter para dados JSON
     */
    private parseFileToJson(buffer: Buffer, filename: string): any[] {
        const extension = filename.toLowerCase().split('.').pop();

        console.log('Processando arquivo:', { filename, extension, size: buffer.length });

        const rawData: any[] = [];

        if (extension === 'csv') {
            // Processar CSV
            const csvText = buffer.toString('utf-8');
            const lines = csvText.split('\n').filter((line) => line.trim());
            const headers = lines[0].split(',').map((h) => h.trim().replace(/['"]/g, ''));

            console.log('Headers do CSV:', headers);

            for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim()) {
                    const values = lines[i].split(',').map((v) => v.trim().replace(/['"]/g, ''));
                    const row: any = {};
                    headers.forEach((header, index) => {
                        row[header] = values[index] || '';
                    });
                    rawData.push(row);
                }
            }
        } else if (extension === 'xls' || extension === 'xlsx') {
            // Processar Excel - detectar automaticamente onde está o cabeçalho
            const workbook = XLSX.read(buffer, {
                type: 'buffer',
                cellText: false,
                cellDates: true,
                raw: false,
            });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            // Ler como array para ter controle total sobre as linhas
            const arrayData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            console.log('Dados brutos do Excel (primeiras 5 linhas):', arrayData.slice(0, 5));
            console.log('Total de linhas brutas do Excel:', arrayData.length);

            if (arrayData.length < 2) {
                throw new Error('Arquivo Excel deve ter pelo menos 2 linhas (cabeçalho e dados)');
            }

            // Detectar onde está o cabeçalho procurando por palavras-chave
            let headerRowIndex = 0;
            let dataStartRowIndex = 1;

            // Verificar se a linha 1 tem cabeçalhos válidos (nome, email, telefone, whatsapp)
            const linha1 = arrayData[0] || [];
            const linha1Str = linha1.map((cell: any) => cell?.toString().toLowerCase().trim() || '').join(' ');
            const temCamposObrigatorios =
                (linha1Str.includes('nome') || linha1Str.includes('name')) &&
                (linha1Str.includes('email') || linha1Str.includes('e-mail')) &&
                (linha1Str.includes('telefone') || linha1Str.includes('whatsapp') || linha1Str.includes('phone'));

            if (temCamposObrigatorios) {
                // Cabeçalho está na linha 1, dados começam na linha 2
                headerRowIndex = 0;
                dataStartRowIndex = 1;
                console.log('✅ Cabeçalho detectado na linha 1');
            } else if (arrayData.length >= 2) {
                // Verificar linha 2
                const linha2 = arrayData[1] || [];
                const linha2Str = linha2.map((cell: any) => cell?.toString().toLowerCase().trim() || '').join(' ');
                const temCamposObrigatoriosLinha2 =
                    (linha2Str.includes('nome') || linha2Str.includes('name')) &&
                    (linha2Str.includes('email') || linha2Str.includes('e-mail')) &&
                    (linha2Str.includes('telefone') || linha2Str.includes('whatsapp') || linha2Str.includes('phone'));

                if (temCamposObrigatoriosLinha2) {
                    // Cabeçalho está na linha 2, dados começam na linha 3 ou 4
                    headerRowIndex = 1;
                    // Se linha 3 parece ser um separador (vazia ou com caracteres especiais), pular
                    if (arrayData.length > 2) {
                        const linha3 = arrayData[2] || [];
                        const linha3Str = linha3.map((cell: any) => cell?.toString().trim() || '').join('');
                        const ehSeparador = linha3Str.length === 0 || linha3Str.match(/^[-=_]+$/);
                        dataStartRowIndex = ehSeparador ? 3 : 2;
                    } else {
                        dataStartRowIndex = 2;
                    }
                    console.log('✅ Cabeçalho detectado na linha 2');
                } else {
                    // Tentar usar linha 1 como cabeçalho mesmo sem detectar campos obrigatórios
                    headerRowIndex = 0;
                    dataStartRowIndex = 1;
                    console.log('⚠️ Não foi possível detectar campos obrigatórios, usando linha 1 como cabeçalho');
                }
            }

            const headers = arrayData[headerRowIndex].map((header: any) => header?.toString().trim() || '');
            console.log(`Cabeçalho detectado na linha ${headerRowIndex + 1}:`, headers);
            console.log(`Dados começam na linha ${dataStartRowIndex + 1}`);

            // Processar dados a partir da linha detectada
            for (let i = dataStartRowIndex; i < arrayData.length; i++) {
                const row = arrayData[i];
                if (row && row.some((cell: any) => cell && cell.toString().trim())) {
                    const rowData: any = {};
                    headers.forEach((header, index) => {
                        rowData[header] = row[index]?.toString().trim() || '';
                    });
                    rawData.push(rowData);
                }
            }

            console.log('Dados processados (primeiras 3 linhas):', rawData.slice(0, 3));
            console.log('Total de registros válidos:', rawData.length);
        }

        // Normalizar nomes das colunas para garantir compatibilidade
        const normalizedData = rawData
            .map((row) => {
                const normalizedRow: any = {};

                Object.keys(row).forEach((key) => {
                    const normalizedKey = key.toLowerCase().trim();
                    const value = row[key];

                    // Log detalhado para debug
                    if (value && value.toString().trim()) {
                        console.log(`Processando campo: "${key}" -> "${normalizedKey}" = "${value}"`);
                    }

                    // Pular apenas valores realmente vazios
                    if (!value || !value.toString().trim()) {
                        return;
                    }

                    const cleanValue = value?.toString().trim();

                    // Mapear campos baseado nos cabeçalhos específicos da linha 2
                    if (normalizedKey.includes('nome') || normalizedKey === 'name') {
                        normalizedRow.nome = cleanValue;
                        console.log('✅ Nome mapeado:', normalizedRow.nome);
                    } else if (normalizedKey.includes('email') || normalizedKey === 'e-mail') {
                        normalizedRow.email = cleanValue.toLowerCase();
                        console.log('✅ Email mapeado:', normalizedRow.email);
                    } else if (normalizedKey.includes('whatsapp') || normalizedKey.includes('telefone') || normalizedKey.includes('phone')) {
                        normalizedRow.telefone = cleanValue.replace(/\D/g, '');
                        console.log('✅ Telefone mapeado:', normalizedRow.telefone);
                    } else if (normalizedKey.includes('confirma') || normalizedKey.includes('presen')) {
                        // Campo de confirmação de presença - pode ser usado para valor inicial
                        normalizedRow.confirmacao_presenca = cleanValue;
                        console.log('✅ Confirmação de presença mapeada:', normalizedRow.confirmacao_presenca);
                    } else {
                        // Manter campos adicionais
                        normalizedRow[normalizedKey] = cleanValue;
                        console.log(`📝 Campo adicional: ${normalizedKey} = ${cleanValue}`);
                    }
                });

                return normalizedRow;
            })
            .filter((row) => {
                // Filtrar linhas que têm pelo menos um dos campos obrigatórios preenchidos
                return row.nome || row.email || row.telefone;
            });

        console.log('Dados normalizados - primeira linha:', normalizedData[0]);
        console.log('Total de linhas válidas:', normalizedData.length);

        return normalizedData;
    }

    /**
     * Upload e processamento de arquivo CSV/Excel
     */
    async uploadCsv(
        id_turma: number,
        fileBuffer: Buffer,
        observacoes?: string,
        filename?: string,
        criado_por?: number,
    ): Promise<{ message: string; total_processados: number; duplicados_ignorados: number; erros: string[] }> {
        try {
            const erros: string[] = [];
            let total_processados = 0;

            // Buscar dados da turma
            const turma = await this.uow.turmasRP.findOne({
                where: { id: id_turma },
                relations: ['id_treinamento_fk', 'id_polo_fk'],
            });

            if (!turma) {
                throw new NotFoundException(`Turma com ID ${id_turma} não encontrada`);
            }

            // Processar arquivo (CSV, XLS ou XLSX)
            const fileData = this.parseFileToJson(fileBuffer, filename || 'arquivo.csv');

            // Buscar pré-cadastros existentes para esta turma
            const preCadastrosExistentes = await this.uow.masterclassPreCadastrosRP.find({
                where: {
                    id_turma,
                    deletado_em: null,
                },
                select: ['email', 'telefone', 'nome_aluno'],
            });

            console.log(`Encontrados ${preCadastrosExistentes.length} pré-cadastros existentes para a turma ${id_turma}`);

            // Criar conjunto de emails, telefones e nomes existentes para verificação rápida
            const emailsExistentes = new Set(preCadastrosExistentes.map((pc) => pc.email.toLowerCase()));
            const telefonesExistentes = new Set(preCadastrosExistentes.map((pc) => pc.telefone));
            const nomesExistentes = new Set(preCadastrosExistentes.map((pc) => pc.nome_aluno.toLowerCase().trim()));

            const preCadastros: MasterclassPreCadastroDto[] = [];
            let duplicadosEncontrados = 0;

            console.log(`📊 Total de linhas no arquivo processado: ${fileData.length}`);
            console.log(`📋 Primeira linha de dados:`, fileData[0]);
            console.log(`📋 Segunda linha de dados:`, fileData[1]);

            // Processar cada linha do arquivo
            for (const row of fileData) {
                try {
                    console.log(`🔍 Processando linha:`, row);

                    // Validar dados obrigatórios
                    if (!row.nome || !row.email || !row.telefone) {
                        const camposFaltando = [];
                        if (!row.nome) camposFaltando.push('nome');
                        if (!row.email) camposFaltando.push('email');
                        if (!row.telefone) camposFaltando.push('telefone');
                        console.log(`❌ Linha inválida - campos faltando: ${camposFaltando.join(', ')}`);
                        erros.push(`Linha inválida: ${JSON.stringify(row)} - Campos obrigatórios faltando: ${camposFaltando.join(', ')}`);
                        continue;
                    }

                    // Limpar e formatar dados
                    const nomeLimpo = row.nome?.toString().trim().toLowerCase();
                    const emailLimpo = row.email?.toString().trim().toLowerCase();
                    const telefoneLimpo = row.telefone?.toString().trim().replace(/\D/g, '');

                    // Verificar se já existe um pré-cadastro com este email, telefone ou nome+email nesta turma
                    const emailExiste = emailsExistentes.has(emailLimpo);
                    const telefoneExiste = telefonesExistentes.has(telefoneLimpo);
                    const nomeEmailExiste = nomesExistentes.has(nomeLimpo) && emailsExistentes.has(emailLimpo);

                    if (emailExiste || telefoneExiste || nomeEmailExiste) {
                        duplicadosEncontrados++;
                        let motivoDuplicacao = '';
                        if (nomeEmailExiste) {
                            motivoDuplicacao = `nome e email iguais (${nomeLimpo} / ${emailLimpo})`;
                        } else if (emailExiste) {
                            motivoDuplicacao = `email já cadastrado (${emailLimpo})`;
                        } else if (telefoneExiste) {
                            motivoDuplicacao = `telefone já cadastrado (${telefoneLimpo})`;
                        }

                        erros.push(`Duplicado: ${row.nome} - ${motivoDuplicacao} já está cadastrado nesta masterclass`);
                        console.log(`⚠️ Pré-cadastro duplicado encontrado: ${row.nome} - ${motivoDuplicacao}`);
                        continue;
                    }

                    const preCadastro: MasterclassPreCadastroDto = {
                        nome_aluno: row.nome?.toString().trim(),
                        email: emailLimpo,
                        telefone: this.formatarTelefone(telefoneLimpo),
                        id_turma,
                        observacoes: observacoes || row.observacoes?.toString().trim(),
                    };

                    preCadastros.push(preCadastro);
                    total_processados++;
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
                    erros.push(`Erro ao processar linha: ${JSON.stringify(row)} - ${errorMessage}`);
                }
            }

            console.log(`Processamento concluído. Total: ${preCadastros.length} registros, ${duplicadosEncontrados} duplicados encontrados`);

            let mensagem = '';
            if (preCadastros.length > 0) {
                // Inserir no banco de dados apenas os novos registros
                const eventosParaInserir = preCadastros.map((pc) => ({
                    nome_aluno: pc.nome_aluno,
                    email: pc.email,
                    telefone: pc.telefone,
                    evento_nome: `Masterclass - ${turma.cidade}`,
                    data_evento: new Date(turma.data_inicio),
                    id_turma: pc.id_turma,
                    presente: pc.presente || false,
                    teve_interesse: pc.teve_interesse || false,
                    observacoes: pc.observacoes,
                    criado_por: criado_por,
                }));

                await this.uow.masterclassPreCadastrosRP.save(eventosParaInserir);
                mensagem = `${total_processados} pré-cadastros inseridos com sucesso.`;
            } else {
                mensagem = 'Nenhum novo pré-cadastro inserido.';
            }

            if (duplicadosEncontrados > 0) {
                mensagem += ` ${duplicadosEncontrados} registros duplicados foram ignorados.`;
            }

            if (erros.length > 0) {
                mensagem += ` ${erros.length} erros encontrados.`;
            }

            return {
                message: mensagem,
                total_processados,
                duplicados_ignorados: duplicadosEncontrados,
                erros,
            };
        } catch (error) {
            console.error('Erro ao processar CSV:', error);
            throw new Error('Erro interno do servidor ao processar arquivo CSV');
        }
    }

    /**
     * Debug: Verificar dados brutos no banco
     */
    async debugDados(): Promise<any> {
        try {
            console.log('🔍 Verificando dados brutos na tabela masterclass_pre_cadastros...');

            // Buscar todos os pré-cadastros sem filtros
            const preCadastros = await this.uow.masterclassPreCadastrosRP.find({
                order: { criado_em: 'DESC' },
                take: 10, // Limitar a 10 para debug
            });

            console.log('📊 Total de pré-cadastros encontrados:', preCadastros.length);
            console.log('📋 Primeiros 5 registros:', preCadastros.slice(0, 5));

            // Verificar se há turmas relacionadas
            const turmasComMasterclass = await this.uow.turmasRP.find({
                relations: ['id_treinamento_fk'],
                where: {
                    id_treinamento_fk: {
                        tipo_treinamento: false, // Palestras
                    },
                },
                take: 5,
            });

            console.log('🏫 Turmas de palestra encontradas:', turmasComMasterclass.length);
            console.log(
                '📋 Turmas:',
                turmasComMasterclass.map((t) => ({
                    id: t.id,
                    cidade: t.cidade,
                    treinamento: t.id_treinamento_fk?.treinamento,
                    tipo: t.id_treinamento_fk?.tipo_treinamento,
                })),
            );

            return {
                total_pre_cadastros: preCadastros.length,
                pre_cadastros: preCadastros.slice(0, 5),
                total_turmas_palestra: turmasComMasterclass.length,
                turmas_palestra: turmasComMasterclass.map((t) => ({
                    id: t.id,
                    cidade: t.cidade,
                    treinamento: t.id_treinamento_fk?.treinamento,
                    tipo: t.id_treinamento_fk?.tipo_treinamento,
                })),
            };
        } catch (error) {
            console.error('❌ Erro no debug de dados:', error);
            throw error;
        }
    }

    /**
     * Listar todos os eventos de masterclass com estatísticas
     */
    async listarEventos(page: number = 1, limit: number = 10): Promise<MasterclassListResponseDto> {
        try {
            console.log('🔍 Iniciando listagem de eventos de masterclass...');

            // Buscar turmas de palestra/masterclass
            const turmasMasterclass = await this.uow.turmasRP.find({
                relations: ['id_treinamento_fk', 'id_polo_fk'],
                where: {
                    id_treinamento_fk: {
                        tipo_treinamento: false, // Palestras/Masterclass
                    },
                    deletado_em: null,
                },
                order: { criado_em: 'DESC' },
            });

            // Para a tela de vendas, precisamos considerar também eventos em andamento
            // e não apenas turmas encerradas.
            const turmasConsideradas = turmasMasterclass;

            console.log('🏫 Turmas de masterclass encontradas:', turmasMasterclass.length);
            console.log('🏫 Turmas consideradas para vendas:', turmasConsideradas.length);

            // Agrupar por evento (nome + data)
            const eventosMap = new Map<string, MasterclassEventoResponseDto>();

            // Primeiro, adicionar todas as turmas de masterclass como eventos
            for (const turma of turmasConsideradas) {
                const eventoNome = turma.id_treinamento_fk?.treinamento || 'Evento sem nome';

                // Usar a data de início da turma como data do evento
                const dataInicioTurma = turma.data_inicio;

                // Criar data sem deslocamento de timezone
                let dataEvento: Date;
                if (dataInicioTurma) {
                    if (typeof dataInicioTurma === 'string') {
                        // Para strings "YYYY-MM-DD", criar data local
                        const [year, month, day] = dataInicioTurma.split('-').map(Number);
                        dataEvento = new Date(year, month - 1, day); // month é 0-indexado
                    } else {
                        dataEvento = dataInicioTurma;
                    }
                } else {
                    dataEvento = new Date();
                }

                const key = `${eventoNome}_${dataEvento.toISOString().split('T')[0]}`;

                if (!eventosMap.has(key)) {
                    eventosMap.set(key, {
                        evento_nome: eventoNome,
                        data_evento: dataEvento,
                        cidade: turma.cidade || turma.id_polo_fk?.cidade || 'Não informado',
                        total_inscritos: 0,
                        total_presentes: 0,
                        total_ausentes: 0,
                        total_vinculados: 0,
                        taxa_presenca: 0,
                        pre_cadastros: [],
                    });
                }
            }

            console.log('📊 Eventos agrupados:', eventosMap.size);

            // Agora buscar pré-cadastros APENAS para as turmas consideradas que já temos
            const turmasIds = turmasConsideradas.map((t) => t.id);
            const [preCadastros, total] = await this.uow.masterclassPreCadastrosRP.findAndCount({
                where: {
                    id_turma: In(turmasIds), // Só buscar pré-cadastros das turmas existentes
                    deletado_em: null,
                },
                order: { data_evento: 'DESC', criado_em: 'DESC' },
            });

            console.log('📋 Pré-cadastros encontrados para turmas existentes:', preCadastros.length);

            // Adicionar pré-cadastros aos eventos existentes (apenas turmas reais)
            for (const pc of preCadastros) {
                // Converter data_evento para Date se vier como string
                const dataEventoPC = typeof pc.data_evento === 'string' ? new Date(pc.data_evento) : pc.data_evento;

                // Buscar a turma correspondente ao pré-cadastro
                const turmaCorrespondente = turmasConsideradas.find((t) => t.id === pc.id_turma);
                if (!turmaCorrespondente) continue; // Pular se não encontrar a turma

                // Usar o nome da turma, não do pré-cadastro
                const eventoNome = turmaCorrespondente.id_treinamento_fk?.treinamento || 'Evento sem nome';
                const dataInicioTurma = turmaCorrespondente.data_inicio;

                // Criar data sem deslocamento de timezone
                let dataEventoTurma: Date;
                if (dataInicioTurma) {
                    if (typeof dataInicioTurma === 'string') {
                        // Para strings "YYYY-MM-DD", criar data local
                        const [year, month, day] = dataInicioTurma.split('-').map(Number);
                        dataEventoTurma = new Date(year, month - 1, day); // month é 0-indexado
                    } else {
                        dataEventoTurma = dataInicioTurma;
                    }
                } else {
                    dataEventoTurma = new Date();
                }

                const key = `${eventoNome}_${dataEventoTurma.toISOString().split('T')[0]}`;

                const evento = eventosMap.get(key);
                if (evento) {
                    evento.pre_cadastros.push(this.mapToResponseDto(pc));
                    evento.total_inscritos++;

                    if (pc.presente) {
                        evento.total_presentes++;
                    } else {
                        evento.total_ausentes++;
                    }

                    if (pc.id_aluno_vinculado) {
                        evento.total_vinculados++;
                    }
                }
            }

            // Calcular taxa de presença para cada evento
            eventosMap.forEach((evento) => {
                evento.taxa_presenca = evento.total_inscritos > 0 ? Math.round((evento.total_presentes / evento.total_inscritos) * 100 * 100) / 100 : 0;
            });

            const eventos = Array.from(eventosMap.values());

            // Ordenar eventos: primeiro por data (mais recente primeiro), depois por cidade
            eventos.sort((a, b) => {
                // Comparar por data (mais recente primeiro)
                const dataA = new Date(a.data_evento).getTime();
                const dataB = new Date(b.data_evento).getTime();
                if (dataA !== dataB) {
                    return dataB - dataA; // Ordem decrescente (mais recente primeiro)
                }
                // Se as datas forem iguais, ordenar por cidade
                const cidadeA = (a.cidade || '').toLowerCase();
                const cidadeB = (b.cidade || '').toLowerCase();
                return cidadeA.localeCompare(cidadeB);
            });

            console.log('✅ Total de eventos retornados:', eventos.length);

            const totalPages = Math.ceil(total / limit);

            return {
                data: eventos,
                total: eventos.length,
                page,
                limit,
                totalPages,
            };
        } catch (error) {
            console.error('Erro ao listar eventos de masterclass:', error);
            throw new Error('Erro interno do servidor ao listar eventos');
        }
    }

    /**
     * Buscar detalhes de um evento específico
     */
    async buscarEvento(id_turma: number): Promise<MasterclassEventoResponseDto> {
        try {
            console.log(`🔍 [buscarEvento] Buscando evento para turma ID: ${id_turma} (tipo: ${typeof id_turma})`);

            // Buscar dados da turma
            const turma = await this.uow.turmasRP.findOne({
                where: { id: id_turma },
                relations: ['id_treinamento_fk', 'id_polo_fk'],
            });

            if (!turma) {
                throw new NotFoundException(`Turma com ID ${id_turma} não encontrada`);
            }

            console.log(`✅ [buscarEvento] Turma encontrada: ${turma.id} - ${turma.id_treinamento_fk?.treinamento || 'N/A'}`);

            // Primeiro, buscar TODOS os pré-cadastros para esta turma (incluindo deletados) para debug
            const todosPreCadastros = await this.uow.masterclassPreCadastrosRP.find({
                where: {
                    id_turma,
                },
            });

            console.log(`📊 [buscarEvento] Total de pré-cadastros encontrados (incluindo deletados): ${todosPreCadastros.length}`);
            if (todosPreCadastros.length > 0) {
                console.log(
                    `📋 [buscarEvento] Primeiros 3 pré-cadastros encontrados:`,
                    todosPreCadastros.slice(0, 3).map((pc) => ({
                        id: pc.id,
                        nome: pc.nome_aluno,
                        id_turma: pc.id_turma,
                        deletado_em: pc.deletado_em,
                    })),
                );
            }

            // Agora buscar apenas os não deletados
            console.log(`🔍 [buscarEvento] Buscando pré-cadastros para turma ID: ${id_turma} (tipo: ${typeof id_turma})`);
            const preCadastros = await this.uow.masterclassPreCadastrosRP.find({
                where: {
                    id_turma: Number(id_turma), // Garantir que é número
                    deletado_em: null,
                },
                relations: ['aluno_vinculado', 'aluno_vinculado.id_polo_fk'],
                order: { nome_aluno: 'ASC' },
            });

            console.log(`✅ [buscarEvento] Pré-cadastros não deletados encontrados: ${preCadastros.length}`);
            if (preCadastros.length > 0) {
                console.log(
                    `📋 [buscarEvento] Primeiros 3 pré-cadastros não deletados:`,
                    preCadastros.slice(0, 3).map((pc) => ({
                        id: pc.id,
                        nome: pc.nome_aluno,
                        id_turma: pc.id_turma,
                        deletado_em: pc.deletado_em,
                    })),
                );
            } else {
                console.log(`⚠️ [buscarEvento] NENHUM pré-cadastro não deletado encontrado para turma ${id_turma}`);
                // Tentar buscar novamente sem o filtro de deletado para debug
                const todosParaDebug = await this.uow.masterclassPreCadastrosRP.find({
                    where: {
                        id_turma: Number(id_turma),
                    },
                });
                console.log(`🔍 [buscarEvento] Total de pré-cadastros (incluindo deletados) para turma ${id_turma}: ${todosParaDebug.length}`);
                if (todosParaDebug.length > 0) {
                    const deletados = todosParaDebug.filter((pc) => pc.deletado_em !== null);
                    console.log(`📊 [buscarEvento] Deletados: ${deletados.length}, Não deletados: ${todosParaDebug.length - deletados.length}`);
                }
            }

            const evento: MasterclassEventoResponseDto = {
                evento_nome: `${turma.id_treinamento_fk?.treinamento || 'Masterclass'} - ${turma.cidade}`,
                data_evento: new Date(turma.data_inicio),
                total_inscritos: preCadastros.length,
                total_presentes: preCadastros.filter((pc) => pc.presente).length,
                total_ausentes: preCadastros.filter((pc) => !pc.presente).length,
                total_vinculados: preCadastros.filter((pc) => pc.id_aluno_vinculado).length,
                taxa_presenca: 0,
                pre_cadastros: preCadastros.map((pc) => this.mapToResponseDto(pc)),
            };

            evento.taxa_presenca = evento.total_inscritos > 0 ? Math.round((evento.total_presentes / evento.total_inscritos) * 100 * 100) / 100 : 0;

            console.log(`✅ [buscarEvento] Retornando evento com ${evento.pre_cadastros.length} pré-cadastros`);
            console.log(`📊 [buscarEvento] Resumo: Total=${evento.total_inscritos}, Presentes=${evento.total_presentes}, Ausentes=${evento.total_ausentes}`);

            return evento;
        } catch (error) {
            console.error('Erro ao buscar evento:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao buscar evento');
        }
    }

    /**
     * Confirmar presença de um pré-cadastro
     */
    async confirmarPresenca(confirmarDto: ConfirmarPresencaDto): Promise<MasterclassPreCadastroResponseDto> {
        try {
            const preCadastro = await this.uow.masterclassPreCadastrosRP.findOne({
                where: {
                    id: confirmarDto.id_pre_cadastro,
                    deletado_em: null,
                },
                relations: ['aluno_vinculado', 'aluno_vinculado.id_polo_fk'],
            });

            if (!preCadastro) {
                throw new NotFoundException('Pré-cadastro não encontrado');
            }

            if (preCadastro.presente) {
                throw new BadRequestException('Presença já foi confirmada anteriormente');
            }

            // Atualizar presença
            await this.uow.masterclassPreCadastrosRP.update(
                { id: confirmarDto.id_pre_cadastro },
                {
                    presente: true,
                    observacoes: confirmarDto.observacoes || preCadastro.observacoes,
                    atualizado_por: confirmarDto.atualizado_por,
                },
            );

            // Buscar dados atualizados
            const preCadastroAtualizado = await this.uow.masterclassPreCadastrosRP.findOne({
                where: { id: confirmarDto.id_pre_cadastro },
                relations: ['aluno_vinculado', 'aluno_vinculado.id_polo_fk'],
            });

            if (!preCadastroAtualizado) {
                throw new NotFoundException('Pré-cadastro atualizado não encontrado');
            }

            return this.mapToResponseDto(preCadastroAtualizado);
        } catch (error) {
            console.error('Erro ao confirmar presença:', error);
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao confirmar presença');
        }
    }

    /**
     * Vincular pré-cadastro a um aluno existente
     */
    async vincularAluno(vincularDto: VincularAlunoDto): Promise<MasterclassPreCadastroResponseDto> {
        try {
            const preCadastro = await this.uow.masterclassPreCadastrosRP.findOne({
                where: {
                    id: vincularDto.id_pre_cadastro,
                    deletado_em: null,
                },
                relations: ['aluno_vinculado', 'aluno_vinculado.id_polo_fk'],
            });

            if (!preCadastro) {
                throw new NotFoundException('Pré-cadastro não encontrado');
            }

            if (preCadastro.id_aluno_vinculado) {
                throw new BadRequestException('Pré-cadastro já está vinculado a um aluno');
            }

            // Verificar se o aluno existe
            const aluno = await this.uow.alunosRP.findOne({
                where: { id: parseInt(vincularDto.id_aluno) },
                relations: ['id_polo_fk'],
            });

            if (!aluno) {
                throw new NotFoundException('Aluno não encontrado');
            }

            // Vincular
            await this.uow.masterclassPreCadastrosRP.update(
                { id: vincularDto.id_pre_cadastro },
                {
                    id_aluno_vinculado: vincularDto.id_aluno,
                    data_vinculacao_aluno: new Date(),
                    observacoes: vincularDto.observacoes || preCadastro.observacoes,
                },
            );

            // Buscar dados atualizados
            const preCadastroAtualizado = await this.uow.masterclassPreCadastrosRP.findOne({
                where: { id: vincularDto.id_pre_cadastro },
                relations: ['aluno_vinculado', 'aluno_vinculado.id_polo_fk'],
            });

            if (!preCadastroAtualizado) {
                throw new NotFoundException('Pré-cadastro atualizado não encontrado');
            }

            return this.mapToResponseDto(preCadastroAtualizado);
        } catch (error) {
            console.error('Erro ao vincular aluno:', error);
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }

            throw new Error('Erro interno do servidor ao vincular aluno');
        }
    }

    /**
     * Alterar interesse de um pré-cadastro
     */
    async alterarInteresse(alterarDto: AlterarInteresseDto): Promise<MasterclassPreCadastroResponseDto> {
        try {
            const preCadastro = await this.uow.masterclassPreCadastrosRP.findOne({
                where: {
                    id: alterarDto.id_pre_cadastro,
                    deletado_em: null,
                },
                relations: ['aluno_vinculado', 'aluno_vinculado.id_polo_fk'],
            });

            if (!preCadastro) {
                throw new NotFoundException('Pré-cadastro não encontrado');
            }

            // Atualizar interesse
            await this.uow.masterclassPreCadastrosRP.update(
                { id: alterarDto.id_pre_cadastro },
                {
                    teve_interesse: alterarDto.teve_interesse,
                    observacoes: alterarDto.observacoes || preCadastro.observacoes,
                    atualizado_por: alterarDto.atualizado_por,
                },
            );

            // Buscar dados atualizados
            const preCadastroAtualizado = await this.uow.masterclassPreCadastrosRP.findOne({
                where: { id: alterarDto.id_pre_cadastro },
                relations: ['aluno_vinculado', 'aluno_vinculado.id_polo_fk'],
            });

            if (!preCadastroAtualizado) {
                throw new NotFoundException('Pré-cadastro atualizado não encontrado');
            }

            return this.mapToResponseDto(preCadastroAtualizado);
        } catch (error) {
            console.error('Erro ao alterar interesse:', error);
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao alterar interesse');
        }
    }

    /**
     * Buscar alunos ausentes para campanhas de marketing
     */
    async buscarAlunosAusentesParaMarketing(evento_nome?: string): Promise<MasterclassStatsDto[]> {
        try {
            const whereCondition: any = {
                presente: false, // Apenas ausentes
                deletado_em: null,
            };

            if (evento_nome) {
                whereCondition.evento_nome = evento_nome;
            }

            const preCadastrosAusentes = await this.uow.masterclassPreCadastrosRP.find({
                where: whereCondition,
                order: { data_evento: 'DESC', evento_nome: 'ASC' },
            });

            // Agrupar por evento
            const eventosMap = new Map<string, MasterclassStatsDto>();

            for (const pc of preCadastrosAusentes) {
                const key = `${pc.evento_nome}_${pc.data_evento.toISOString().split('T')[0]}`;

                if (!eventosMap.has(key)) {
                    eventosMap.set(key, {
                        evento_nome: pc.evento_nome,
                        data_evento: pc.data_evento,
                        total_inscritos: 0,
                        total_presentes: 0,
                        total_ausentes: 0,
                        total_vinculados: 0,
                        taxa_presenca: 0,
                        alunos_ausentes_para_marketing: [],
                    });
                }

                const evento = eventosMap.get(key);
                if (evento) {
                    evento.total_ausentes++;
                    evento.alunos_ausentes_para_marketing.push({
                        id: pc.id,
                        nome_aluno: pc.nome_aluno,
                        email: pc.email,
                        telefone: pc.telefone,
                        data_evento: pc.data_evento,
                    });
                }
            }

            return Array.from(eventosMap.values());
        } catch (error) {
            console.error('Erro ao buscar alunos ausentes:', error);
            throw new Error('Erro interno do servidor ao buscar alunos ausentes');
        }
    }

    /**
     * Mapear entidade para DTO de resposta
     */
    private mapToResponseDto(pc: any): MasterclassPreCadastroResponseDto {
        return {
            id: pc.id,
            nome_aluno: pc.nome_aluno,
            email: pc.email,
            telefone: pc.telefone,
            presente: pc.presente,
            teve_interesse: pc.teve_interesse,
            evento_nome: pc.evento_nome,
            data_evento: pc.data_evento,
            id_aluno_vinculado: pc.id_aluno_vinculado,
            data_vinculacao_aluno: pc.data_vinculacao_aluno,
            observacoes: pc.observacoes,
            aluno_vinculado: pc.aluno_vinculado
                ? {
                      id: pc.aluno_vinculado.id,
                      nome: pc.aluno_vinculado.nome,
                      email: pc.aluno_vinculado.email,
                      nome_cracha: pc.aluno_vinculado.nome_cracha,
                      id_polo: pc.aluno_vinculado.id_polo,
                      polo: pc.aluno_vinculado.id_polo_fk
                          ? {
                                id: pc.aluno_vinculado.id_polo_fk.id,
                                nome: pc.aluno_vinculado.id_polo_fk.nome,
                            }
                          : undefined,
                  }
                : undefined,
            criado_em: pc.criado_em,
            atualizado_em: pc.atualizado_em,
        };
    }

    /**
     * Formatar telefone com máscara
     */
    private formatarTelefone(telefone: string): string {
        if (!telefone) return '';

        // Remove todos os caracteres não numéricos
        const numeros = telefone.replace(/\D/g, '');

        // Aplica a máscara baseada no tamanho
        if (numeros.length === 11) {
            // (11) 99999-9999
            return `(${numeros.slice(0, 2)}) ${numeros.slice(2, 7)}-${numeros.slice(7)}`;
        } else if (numeros.length === 10) {
            // (11) 9999-9999
            return `(${numeros.slice(0, 2)}) ${numeros.slice(2, 6)}-${numeros.slice(6)}`;
        } else if (numeros.length === 13) {
            // +55 (11) 99999-9999
            return `+${numeros.slice(0, 2)} (${numeros.slice(2, 4)}) ${numeros.slice(4, 9)}-${numeros.slice(9)}`;
        } else if (numeros.length === 12) {
            // +55 (11) 9999-9999
            return `+${numeros.slice(0, 2)} (${numeros.slice(2, 4)}) ${numeros.slice(4, 8)}-${numeros.slice(8)}`;
        }

        // Se não se encaixar em nenhum padrão, retorna apenas os números
        return numeros;
    }

    /**
     * Inserir novo pré-cadastro manualmente
     */
    async inserirPreCadastro(data: CreateMasterclassPreCadastroDto): Promise<MasterclassPreCadastros> {
        try {
            // Buscar dados da turma
            const turma = await this.uow.turmasRP.findOne({
                where: { id: data.id_turma },
                relations: ['id_treinamento_fk', 'id_polo_fk'],
            });

            if (!turma) {
                throw new NotFoundException(`Turma com ID ${data.id_turma} não encontrada`);
            }

            // Criar novo pré-cadastro
            const novoPreCadastro = this.uow.masterclassPreCadastrosRP.create({
                nome_aluno: data.nome_aluno,
                email: data.email,
                telefone: this.formatarTelefone(data.telefone),
                evento_nome: `Masterclass - ${turma.cidade}`,
                data_evento: new Date(turma.data_inicio),
                id_turma: data.id_turma,
                presente: data.presente || false,
                teve_interesse: data.teve_interesse || false,
                observacoes: data.observacoes,
                criado_por: data.criado_por,
            });

            return await this.uow.masterclassPreCadastrosRP.save(novoPreCadastro);
        } catch (error) {
            console.error('Erro ao inserir pré-cadastro:', error);
            throw new Error('Erro interno do servidor ao inserir pré-cadastro');
        }
    }

    /**
     * Editar pré-cadastro existente
     */
    async editarPreCadastro(id: string, data: UpdateMasterclassPreCadastroDto): Promise<MasterclassPreCadastros> {
        try {
            const preCadastro = await this.uow.masterclassPreCadastrosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
            });

            if (!preCadastro) {
                throw new NotFoundException(`Pré-cadastro com ID ${id} não encontrado`);
            }

            // Atualizar dados
            if (data.nome_aluno !== undefined) preCadastro.nome_aluno = data.nome_aluno;
            if (data.email !== undefined) preCadastro.email = data.email;
            if (data.telefone !== undefined) preCadastro.telefone = this.formatarTelefone(data.telefone);
            if (data.presente !== undefined) preCadastro.presente = data.presente;
            if (data.teve_interesse !== undefined) preCadastro.teve_interesse = data.teve_interesse;
            if (data.observacoes !== undefined) preCadastro.observacoes = data.observacoes;
            if (data.atualizado_por !== undefined) preCadastro.atualizado_por = data.atualizado_por;

            return await this.uow.masterclassPreCadastrosRP.save(preCadastro);
        } catch (error) {
            console.error('Erro ao editar pré-cadastro:', error);
            throw new Error('Erro interno do servidor ao editar pré-cadastro');
        }
    }

    /**
     * Soft delete pré-cadastro
     */
    async softDeletePreCadastro(id: string, softDeleteDto: SoftDeleteMasterclassPreCadastroDto): Promise<void> {
        try {
            const preCadastro = await this.uow.masterclassPreCadastrosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
            });

            if (!preCadastro) {
                throw new NotFoundException(`Pré-cadastro com ID ${id} não encontrado`);
            }

            preCadastro.deletado_em = new Date(softDeleteDto.deletado_em);
            preCadastro.atualizado_por = softDeleteDto.atualizado_por;

            await this.uow.masterclassPreCadastrosRP.save(preCadastro);
            console.log('Pré-cadastro marcado como deletado:', id);
        } catch (error) {
            console.error('Erro ao fazer soft delete do pré-cadastro:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao fazer soft delete do pré-cadastro');
        }
    }

    /**
     * Excluir pré-cadastro permanentemente
     */
    async excluirPreCadastro(id: string): Promise<void> {
        try {
            const preCadastro = await this.uow.masterclassPreCadastrosRP.findOne({
                where: { id },
            });

            if (!preCadastro) {
                throw new NotFoundException(`Pré-cadastro com ID ${id} não encontrado`);
            }

            await this.uow.masterclassPreCadastrosRP.remove(preCadastro);
            console.log('Pré-cadastro excluído permanentemente:', id);
        } catch (error) {
            console.error('Erro ao excluir pré-cadastro permanentemente:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao excluir pré-cadastro');
        }
    }
}
