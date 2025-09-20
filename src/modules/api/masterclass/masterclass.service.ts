import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { EStatusAlunosGeral } from '../../config/entities/enum';
import {
    CreateMasterclassEventoDto,
    UploadMasterclassCsvDto,
    MasterclassPreCadastroDto,
    ConfirmarPresencaDto,
    VincularAlunoDto,
    MasterclassPreCadastroResponseDto,
    MasterclassEventoResponseDto,
    MasterclassListResponseDto,
    MasterclassStatsDto,
} from './dto/masterclass.dto';
import * as csv from 'csv-parser';
import { Readable } from 'stream';

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
     * Upload e processamento de arquivo CSV/Excel
     */
    async uploadCsv(id_turma: number, csvBuffer: Buffer, observacoes?: string): Promise<{ message: string; total_processados: number; erros: string[] }> {
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

            // Converter buffer para stream
            const stream = Readable.from(csvBuffer.toString());

            const preCadastros: MasterclassPreCadastroDto[] = [];

            // Processar CSV
            await new Promise((resolve, reject) => {
                stream
                    .pipe(csv())
                    .on('data', (row) => {
                        try {
                            // Validar dados obrigatórios
                            if (!row.nome || !row.email || !row.telefone) {
                                erros.push(`Linha inválida: ${JSON.stringify(row)} - Campos obrigatórios faltando`);
                                return;
                            }

                            // Limpar e formatar dados
                            const preCadastro: MasterclassPreCadastroDto = {
                                nome_aluno: row.nome?.trim(),
                                email: row.email?.trim().toLowerCase(),
                                telefone: row.telefone?.trim().replace(/\D/g, ''), // Remover caracteres não numéricos
                                id_turma,
                                observacoes: observacoes || row.observacoes?.trim(),
                            };

                            preCadastros.push(preCadastro);
                            total_processados++;
                        } catch (error: unknown) {
                            const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
                            erros.push(`Erro ao processar linha: ${JSON.stringify(row)} - ${errorMessage}`);
                        }
                    })
                    .on('end', resolve)
                    .on('error', reject);
            });

            // Inserir no banco de dados
            const eventosParaInserir = preCadastros.map((pc) => ({
                nome_aluno: pc.nome_aluno,
                email: pc.email,
                telefone: pc.telefone,
                evento_nome: `Masterclass - ${turma.cidade}`,
                data_evento: new Date(turma.data_inicio),
                id_turma: pc.id_turma,
                observacoes: pc.observacoes,
                confirmou_presenca: false,
            }));

            await this.uow.masterclassPreCadastrosRP.save(eventosParaInserir);

            return {
                message: `CSV processado com sucesso. ${total_processados} pré-cadastros inseridos.`,
                total_processados,
                erros,
            };
        } catch (error) {
            console.error('Erro ao processar CSV:', error);
            throw new Error('Erro interno do servidor ao processar arquivo CSV');
        }
    }

    /**
     * Listar todos os eventos de masterclass com estatísticas
     */
    async listarEventos(page: number = 1, limit: number = 10): Promise<MasterclassListResponseDto> {
        try {
            const [preCadastros, total] = await this.uow.masterclassPreCadastrosRP.findAndCount({
                order: { data_evento: 'DESC', criado_em: 'DESC' },
                skip: (page - 1) * limit,
                take: limit,
            });

            // Agrupar por evento
            const eventosMap = new Map<string, MasterclassEventoResponseDto>();

            for (const pc of preCadastros) {
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
                        pre_cadastros: [],
                    });
                }

                const evento = eventosMap.get(key);
                if (evento) {
                    evento.pre_cadastros.push(this.mapToResponseDto(pc));
                    evento.total_inscritos++;
                }

                if (pc.confirmou_presenca) {
                    evento.total_presentes++;
                } else {
                    evento.total_ausentes++;
                }

                if (pc.id_aluno_vinculado) {
                    evento.total_vinculados++;
                }
            }

            // Calcular taxa de presença para cada evento
            eventosMap.forEach((evento) => {
                evento.taxa_presenca = evento.total_inscritos > 0 ? Math.round((evento.total_presentes / evento.total_inscritos) * 100 * 100) / 100 : 0;
            });

            const eventos = Array.from(eventosMap.values());

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
            // Buscar dados da turma
            const turma = await this.uow.turmasRP.findOne({
                where: { id: id_turma },
                relations: ['id_treinamento_fk', 'id_polo_fk'],
            });

            if (!turma) {
                throw new NotFoundException(`Turma com ID ${id_turma} não encontrada`);
            }

            const preCadastros = await this.uow.masterclassPreCadastrosRP.find({
                where: {
                    id_turma,
                },
                relations: ['aluno_vinculado', 'aluno_vinculado.id_polo_fk'],
                order: { nome_aluno: 'ASC' },
            });

            const evento: MasterclassEventoResponseDto = {
                evento_nome: `${turma.id_treinamento_fk?.treinamento || 'Masterclass'} - ${turma.cidade}`,
                data_evento: new Date(turma.data_inicio),
                total_inscritos: preCadastros.length,
                total_presentes: preCadastros.filter((pc) => pc.confirmou_presenca).length,
                total_ausentes: preCadastros.filter((pc) => !pc.confirmou_presenca).length,
                total_vinculados: preCadastros.filter((pc) => pc.id_aluno_vinculado).length,
                taxa_presenca: 0,
                pre_cadastros: preCadastros.map((pc) => this.mapToResponseDto(pc)),
            };

            evento.taxa_presenca = evento.total_inscritos > 0 ? Math.round((evento.total_presentes / evento.total_inscritos) * 100 * 100) / 100 : 0;

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
                where: { id: confirmarDto.id_pre_cadastro },
                relations: ['aluno_vinculado', 'aluno_vinculado.id_polo_fk'],
            });

            if (!preCadastro) {
                throw new NotFoundException('Pré-cadastro não encontrado');
            }

            if (preCadastro.confirmou_presenca) {
                throw new BadRequestException('Presença já foi confirmada anteriormente');
            }

            // Atualizar presença
            await this.uow.masterclassPreCadastrosRP.update(
                { id: confirmarDto.id_pre_cadastro },
                {
                    confirmou_presenca: true,
                    data_confirmacao_presenca: new Date(),
                    observacoes: confirmarDto.observacoes || preCadastro.observacoes,
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
                where: { id: vincularDto.id_pre_cadastro },
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
     * Buscar alunos ausentes para campanhas de marketing
     */
    async buscarAlunosAusentesParaMarketing(evento_nome?: string): Promise<MasterclassStatsDto[]> {
        try {
            const whereCondition: any = {
                confirmou_presenca: false, // Apenas ausentes
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
            evento_nome: pc.evento_nome,
            data_evento: pc.data_evento,
            confirmou_presenca: pc.confirmou_presenca,
            data_confirmacao_presenca: pc.data_confirmacao_presenca,
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
}
