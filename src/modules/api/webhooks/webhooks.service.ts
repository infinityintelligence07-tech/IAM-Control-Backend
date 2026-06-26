import { BadRequestException, Injectable } from '@nestjs/common';
import { TurmasService } from '../turmas/turmas.service';
import { TurmaResponseDto } from '../turmas/dto/turmas.dto';
import { GetEventosWebhookDto, EventoWebhookItemDto, EventosWebhookResponseDto } from './dto/webhooks.dto';

const LIMITE_EVENTOS_WEBHOOK = 100000;

@Injectable()
export class WebhooksService {
    constructor(private readonly turmasService: TurmasService) {}

    /**
     * Retorna todos os eventos de treinamento (exceto palestras e mentorias) com suas
     * informações. Os treinamentos são filtrados pela sobreposição do período do evento
     * com o intervalo informado.
     */
    async getEventos(filtros: GetEventosWebhookDto): Promise<EventosWebhookResponseDto> {
        const { data_inicio, data_final, id_treinamento, id_polo } = filtros;

        if (data_inicio > data_final) {
            throw new BadRequestException('data_inicio não pode ser maior que data_final.');
        }

        const treinamentosResult = await this.turmasService.findAll({
            data_inicio,
            data_final,
            tipo_treinamento: 'treinamento',
            id_treinamento,
            id_polo,
            page: 1,
            limit: LIMITE_EVENTOS_WEBHOOK,
        });

        const eventos = treinamentosResult.data.map((turma) => this.mapEvento(turma));

        return {
            data_inicio,
            data_final,
            total: eventos.length,
            eventos,
        };
    }

    private mapEvento(turma: TurmaResponseDto): EventoWebhookItemDto {
        return {
            id: turma.id,
            tipo: 'treinamento',
            edicao: turma.edicao_turma ?? null,
            status: turma.status_turma,
            treinamento: {
                id: turma.treinamento?.id ?? turma.id_treinamento,
                nome: turma.treinamento?.treinamento ?? turma.treinamento?.nome ?? '',
                sigla: turma.treinamento?.sigla_treinamento ?? null,
                url_logo: turma.treinamento?.url_logo_treinamento ?? null,
                online: turma.treinamento?.tipo_online ?? undefined,
            },
            data_inicio: turma.data_inicio ?? null,
            data_final: turma.data_final ?? null,
            capacidade: turma.capacidade_turma ?? null,
            meta: turma.meta ?? null,
            endereco: {
                cep: turma.cep ?? null,
                logradouro: turma.logradouro ?? null,
                numero: turma.numero ?? null,
                complemento: turma.complemento ?? null,
                bairro: turma.bairro ?? null,
                cidade: turma.cidade ?? null,
                estado: turma.estado ?? null,
            },
            polo: turma.polo
                ? {
                      id: turma.polo.id,
                      nome: turma.polo.nome,
                      cidade: turma.polo.cidade,
                      estado: turma.polo.estado,
                  }
                : undefined,
            lider: turma.lider
                ? {
                      id: turma.lider.id,
                      nome: turma.lider.nome,
                  }
                : undefined,
            metricas: {
                inscritos: turma.alunos_count ?? 0,
                inscricoes_extras: turma.alunos_inscricoes_extras_count ?? 0,
                confirmados: turma.alunos_confirmados_count ?? 0,
                presentes: turma.presentes_count ?? 0,
                inadimplentes: turma.inadimplentes_count ?? 0,
                transferidos: turma.transferidos_count ?? 0,
                vindos_transferencia: turma.vindos_transferencia_count ?? 0,
            },
            urls: {
                midia_kit: turma.url_midia_kit ?? null,
                grupo_whatsapp: turma.url_grupo_whatsapp ?? null,
                grupo_whatsapp_2: turma.url_grupo_whatsapp_2 ?? null,
                pagamento_cartao: turma.url_pagamento_cartao ?? null,
            },
            created_at: turma.created_at,
            updated_at: turma.updated_at,
        };
    }
}
