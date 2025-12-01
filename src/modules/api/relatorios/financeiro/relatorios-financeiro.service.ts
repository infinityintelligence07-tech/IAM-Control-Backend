import { Injectable } from '@nestjs/common';
import { UnitOfWorkService } from '../../../config/unit_of_work/uow.service';
import { AlunoInadimplenteDto, AlunosInadimplentesResponseDto } from './dto/relatorios-financeiro.dto';
import { EStatusAlunosGeral } from '../../../config/entities/enum';

@Injectable()
export class RelatoriosFinanceiroService {
    constructor(private readonly uow: UnitOfWorkService) {}

    async getAlunosInadimplentes(): Promise<AlunosInadimplentesResponseDto> {
        try {
            // Buscar todos os treinamentos de alunos com relações, excluindo deletados
            const todosTreinamentos = await this.uow.turmasAlunosTreinamentosRP.find({
                where: {
                    deletado_em: null,
                },
                relations: [
                    'id_turma_aluno_fk',
                    'id_turma_aluno_fk.id_aluno_fk',
                    'id_turma_aluno_fk.id_aluno_fk.id_polo_fk',
                    'id_treinamento_fk',
                ],
            });

            // Buscar também alunos que têm status INADIMPLENTE diretamente
            const alunosComStatusInadimplente = await this.uow.alunosRP.find({
                where: {
                    deletado_em: null,
                    status_aluno_geral: EStatusAlunosGeral.INADIMPLENTE,
                },
                relations: ['id_polo_fk'],
            });

            // Filtrar apenas os que são inadimplentes (preco_total_pago < preco_treinamento)
            // e que não estão deletados
            const inadimplentes = todosTreinamentos.filter((t) => {
                const alunoEntity = t.id_turma_aluno_fk?.id_aluno_fk;
                const turmaAluno = t.id_turma_aluno_fk;
                
                // Verificar se é inadimplente
                if (t.preco_total_pago >= t.preco_treinamento) {
                    return false;
                }
                
                // Verificar se aluno não está deletado
                if (!alunoEntity || alunoEntity.deletado_em) {
                    return false;
                }
                
                // Verificar se turma_aluno não está deletada
                if (!turmaAluno || turmaAluno.deletado_em) {
                    return false;
                }
                
                return true;
            });

            // Agrupar por aluno
            const alunosMap = new Map<number, AlunoInadimplenteDto>();

            for (const treinamento of inadimplentes) {
                const alunoEntity = treinamento.id_turma_aluno_fk?.id_aluno_fk;
                
                if (!alunoEntity || alunoEntity.deletado_em) continue;

                const alunoId = alunoEntity.id;
                const valorPendente = treinamento.preco_treinamento - treinamento.preco_total_pago;

                if (!alunosMap.has(alunoId)) {
                    alunosMap.set(alunoId, {
                        id: alunoId,
                        nome: alunoEntity.nome,
                        email: alunoEntity.email || '',
                        cpf: alunoEntity.cpf,
                        telefone: alunoEntity.telefone_um || '',
                        polo: alunoEntity.id_polo_fk
                            ? {
                                  id: alunoEntity.id_polo_fk.id,
                                  nome: alunoEntity.id_polo_fk.polo,
                              }
                            : undefined,
                        treinamentos: [],
                        total_pendente: 0,
                    });
                }

                const aluno = alunosMap.get(alunoId)!;
                const treinamentoEntity = treinamento.id_treinamento_fk;

                aluno.treinamentos.push({
                    id: treinamento.id_treinamento,
                    nome: treinamentoEntity?.treinamento || 'Treinamento não encontrado',
                    valor_total: treinamento.preco_treinamento,
                    valor_pago: treinamento.preco_total_pago,
                    valor_pendente: valorPendente,
                    data_inscricao: treinamento.criado_em?.toISOString() || new Date().toISOString(),
                    status: 'INADIMPLENTE',
                });

                aluno.total_pendente += valorPendente;
            }

            // Adicionar alunos que têm status INADIMPLENTE diretamente
            // Primeiro, obter IDs dos alunos que já estão no mapa (para evitar duplicatas)
            const alunosIdsNoMapa = new Set(Array.from(alunosMap.keys()));
            
            // Filtrar apenas alunos com status INADIMPLENTE que ainda não estão no mapa
            const alunosStatusInadimplenteNovos = alunosComStatusInadimplente.filter(
                (aluno) => !alunosIdsNoMapa.has(aluno.id)
            );

            // Adicionar alunos com status inadimplente ao mapa (mesmo sem treinamentos pendentes)
            for (const alunoComStatus of alunosStatusInadimplenteNovos) {
                const alunoId = alunoComStatus.id;
                
                // Buscar treinamentos do aluno que já foram processados anteriormente
                const treinamentosDoAluno = inadimplentes.filter((t) => {
                    const alunoEntity = t.id_turma_aluno_fk?.id_aluno_fk;
                    return alunoEntity && alunoEntity.id === alunoId;
                });

                const treinamentosPendentes: AlunoInadimplenteDto['treinamentos'] = [];
                let totalPendenteAluno = 0;

                for (const treinamento of treinamentosDoAluno) {
                    const valorPendente = treinamento.preco_treinamento - treinamento.preco_total_pago;
                    const treinamentoEntity = treinamento.id_treinamento_fk;
                    
                    treinamentosPendentes.push({
                        id: treinamento.id_treinamento,
                        nome: treinamentoEntity?.treinamento || 'Treinamento não encontrado',
                        valor_total: treinamento.preco_treinamento,
                        valor_pago: treinamento.preco_total_pago,
                        valor_pendente: valorPendente,
                        data_inscricao: treinamento.criado_em?.toISOString() || new Date().toISOString(),
                        status: 'INADIMPLENTE',
                    });
                    totalPendenteAluno += valorPendente;
                }

                // Adicionar aluno ao mapa, mesmo sem treinamentos pendentes (se tem status inadimplente, deve aparecer)
                alunosMap.set(alunoId, {
                    id: alunoId,
                    nome: alunoComStatus.nome,
                    email: alunoComStatus.email || '',
                    cpf: alunoComStatus.cpf,
                    telefone: alunoComStatus.telefone_um || '',
                    polo: alunoComStatus.id_polo_fk
                        ? {
                              id: alunoComStatus.id_polo_fk.id,
                              nome: alunoComStatus.id_polo_fk.polo,
                          }
                        : undefined,
                    treinamentos: treinamentosPendentes,
                    total_pendente: totalPendenteAluno,
                });
            }

            const alunosArray = Array.from(alunosMap.values());

            return {
                data: alunosArray,
                total: alunosArray.length,
            };
        } catch (error) {
            console.error('Erro ao buscar alunos inadimplentes:', error);
            throw error;
        }
    }
}

