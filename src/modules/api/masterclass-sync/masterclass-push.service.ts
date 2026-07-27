import { Injectable, Logger } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { Turmas } from '../../config/entities/turmas.entity';
import { Polos } from '../../config/entities/polos.entity';
import { EStatusTurmas, EStatusEventoCalendario } from '../../config/entities/enum';
import {
    MasterclassEventoPushItem,
    MasterclassEventosPushResult,
    MasterclassLeadPushItem,
    MasterclassLeadsPushResult,
} from './dto/masterclass-push.dto';

/**
 * Recebe push do masterclass_integracao (dados_masterclass + registros_masterclass)
 * e grava no IAM Control em paralelo ao sync do dash-masterclass-iam.
 *
 * - Eventos → turmas (idempotente por referencia_externa = id_masterclass)
 * - Leads   → masterclass_pre_cadastros (dedup por email + turma)
 */
@Injectable()
export class MasterclassPushService {
    private readonly logger = new Logger(MasterclassPushService.name);

    constructor(private readonly uow: UnitOfWorkService) {}

    async receberEventos(body: unknown): Promise<MasterclassEventosPushResult> {
        const itens = this.extrairItens<MasterclassEventoPushItem>(body);
        const resultado: MasterclassEventosPushResult = {
            total_recebidos: itens.length,
            turmas_criadas: 0,
            turmas_atualizadas: 0,
            turmas_vinculadas_existentes: 0,
            sem_polo: 0,
            erros: 0,
            detalhes_sem_polo: [],
            detalhes_erros: [],
        };

        if (!itens.length) {
            return resultado;
        }

        const idTreinamento = await this.resolverTreinamentoMasterclassId();
        const polos = await this.uow.polosRP.find();

        for (const item of itens) {
            try {
                const idExterno = this.pickIdEvento(item);
                const data = this.normalizarData(item.data);
                const cidade = this.pickString(item.nome_cidade, item.cidade) || this.cidadeDeSlugOuTag(item);
                const poloNome = this.pickString(item.polo);

                if (!idExterno) {
                    resultado.erros++;
                    resultado.detalhes_erros.push('Item sem id_masterclass/id');
                    continue;
                }
                if (!data) {
                    resultado.erros++;
                    resultado.detalhes_erros.push(`${idExterno}: data inválida`);
                    continue;
                }

                const polo = this.resolverPolo(cidade, poloNome, item.cidade_slug, polos);
                if (!polo) {
                    resultado.sem_polo++;
                    resultado.detalhes_sem_polo.push(`${cidade || '?'} / ${poloNome || '?'} (id ${idExterno})`);
                    continue;
                }

                await this.upsertTurmaEvento(item, idExterno, data, cidade, polo, idTreinamento, resultado);
            } catch (error) {
                resultado.erros++;
                const msg = error instanceof Error ? error.message : 'erro desconhecido';
                resultado.detalhes_erros.push(msg);
                this.logger.error(`masterclass.push.evento | ${msg}`, error instanceof Error ? error.stack : undefined);
            }
        }

        this.logger.log(
            `masterclass.push.eventos | recebidos=${resultado.total_recebidos} criadas=${resultado.turmas_criadas} ` +
                `atualizadas=${resultado.turmas_atualizadas} adotadas=${resultado.turmas_vinculadas_existentes} ` +
                `sem_polo=${resultado.sem_polo} erros=${resultado.erros}`,
        );
        return resultado;
    }

    async receberLeads(body: unknown): Promise<MasterclassLeadsPushResult> {
        const itens = this.extrairItens<MasterclassLeadPushItem>(body);
        const resultado: MasterclassLeadsPushResult = {
            total_recebidos: itens.length,
            leads_criados: 0,
            leads_ignorados: 0,
            sem_turma: 0,
            erros: 0,
            detalhes_sem_turma: [],
            detalhes_erros: [],
        };

        if (!itens.length) {
            return resultado;
        }

        const idTreinamento = await this.resolverTreinamentoMasterclassId();

        for (const item of itens) {
            try {
                const email = this.pickString(item.email).toLowerCase();
                const nome = this.pickString(item.name, item.nome, item.nome_aluno);
                const telefone = this.pickString(item.phone, item.telefone) || 'N/D';

                if (!email || !nome) {
                    resultado.leads_ignorados++;
                    continue;
                }

                // Só importa leads com flow concluído com sucesso (ou corrigidos).
                const status = this.pickString(item.status).toLowerCase();
                if (status && !['success', 'success_with_warning', 'corrigido', ''].includes(status)) {
                    resultado.leads_ignorados++;
                    continue;
                }

                const turma = await this.resolverTurmaDoLead(item, idTreinamento);
                if (!turma) {
                    resultado.sem_turma++;
                    resultado.detalhes_sem_turma.push(
                        `${email} | ref=${this.pickIdMasterclassDoLead(item) || '-'} tag=${this.pickString(item.tag) || '-'} data=${this.pickString(item.date, item.data) || '-'}`,
                    );
                    continue;
                }

                const jaExiste = await this.uow.masterclassPreCadastrosRP.findOne({
                    where: { id_turma: turma.id, email },
                });
                if (jaExiste) {
                    resultado.leads_ignorados++;
                    continue;
                }

                const dataEvento =
                    this.normalizarData(this.pickString(item.date, item.data)) ||
                    this.normalizarData(String(turma.data_inicio)) ||
                    new Date().toISOString().slice(0, 10);

                const observacoesParts = [
                    item.qual_sua_profissao ? `Profissão: ${item.qual_sua_profissao}` : null,
                    item.id ? `supabase_id=${item.id}` : null,
                    this.pickString(item.observacoes) || null,
                ].filter(Boolean);

                const preCadastro = this.uow.masterclassPreCadastrosRP.create({
                    nome_aluno: nome,
                    email,
                    telefone,
                    evento_nome: `MasterClass - ${turma.cidade || ''}`.trim(),
                    data_evento: new Date(dataEvento),
                    id_turma: turma.id,
                    presente: item.presente === true,
                    teve_interesse: false,
                    observacoes: observacoesParts.length ? observacoesParts.join(' | ') : null,
                });
                await this.uow.masterclassPreCadastrosRP.save(preCadastro);
                resultado.leads_criados++;
            } catch (error) {
                resultado.erros++;
                const msg = error instanceof Error ? error.message : 'erro desconhecido';
                resultado.detalhes_erros.push(msg);
                this.logger.error(`masterclass.push.lead | ${msg}`, error instanceof Error ? error.stack : undefined);
            }
        }

        this.logger.log(
            `masterclass.push.leads | recebidos=${resultado.total_recebidos} criados=${resultado.leads_criados} ` +
                `ignorados=${resultado.leads_ignorados} sem_turma=${resultado.sem_turma} erros=${resultado.erros}`,
        );
        return resultado;
    }

    private async upsertTurmaEvento(
        item: MasterclassEventoPushItem,
        idExterno: string,
        data: string,
        cidade: string,
        polo: Polos,
        idTreinamento: number,
        resultado: MasterclassEventosPushResult,
    ): Promise<void> {
        const status = this.mapearStatusTurma(item);
        const statusEvento = this.mapearStatusEvento(item);
        const logradouro = this.pickString(item.endereco, item.endereco_local, item.local).slice(0, 255) || 'A definir';
        const local = this.pickString(item.local);
        const complemento = local ? local.slice(0, 255) : null;
        const metaRaw = item.meta_vendas_por_mc ?? item.meta;
        const meta =
            metaRaw != null && String(metaRaw).trim() !== '' && Number.isFinite(Number(metaRaw))
                ? Math.round(Number(metaRaw))
                : null;

        const aplicarCampos = (turma: Turmas) => {
            turma.id_treinamento = idTreinamento;
            turma.id_polo = polo.id;
            turma.data_inicio = data;
            turma.data_final = data;
            turma.cidade = cidade || polo.cidade;
            turma.estado = polo.estado;
            turma.status_turma = status;
            turma.status_evento = statusEvento;
            turma.logradouro = logradouro;
            turma.complemento = complemento;
            if (meta != null) turma.meta = meta;
        };

        const existente = await this.uow.turmasRP.findOne({ where: { referencia_externa: idExterno } });
        if (existente) {
            aplicarCampos(existente);
            await this.uow.turmasRP.save(existente);
            resultado.turmas_atualizadas++;
            return;
        }

        // Paralelo ao dash: se já existe masterclass no mesmo polo+data
        // (com ou sem referencia_externa), atualiza em vez de criar duplicata.
        // Só grava referencia_externa quando ainda estiver vazia — preserva o UUID do dash.
        const candidato = await this.uow.turmasRP.findOne({
            where: {
                id_treinamento: idTreinamento,
                id_polo: polo.id,
                data_inicio: data,
            },
        });
        if (candidato) {
            if (!candidato.referencia_externa) {
                candidato.referencia_externa = idExterno;
                resultado.turmas_vinculadas_existentes++;
            } else {
                resultado.turmas_atualizadas++;
            }
            aplicarCampos(candidato);
            await this.uow.turmasRP.save(candidato);
            return;
        }

        const nova = this.uow.turmasRP.create({
            referencia_externa: idExterno,
            id_treinamento: idTreinamento,
            id_polo: polo.id,
            data_inicio: data,
            data_final: data,
            cidade: cidade || polo.cidade,
            estado: polo.estado,
            status_turma: status,
            status_evento: statusEvento,
            complemento,
            cep: '',
            logradouro,
            numero: 'S/N',
            bairro: '',
            meta: meta ?? undefined,
        });
        await this.uow.turmasRP.save(nova);
        resultado.turmas_criadas++;
    }

    private async resolverTurmaDoLead(item: MasterclassLeadPushItem, idTreinamento: number): Promise<Turmas | null> {
        const idMasterclass = this.pickIdMasterclassDoLead(item);
        if (idMasterclass) {
            const porRef = await this.uow.turmasRP.findOne({ where: { referencia_externa: idMasterclass } });
            if (porRef) return porRef;
        }

        const data = this.normalizarData(this.pickString(item.date, item.data));
        const cidadeHint =
            this.cidadeDeSlugOuTag(item) ||
            this.extrairCidadeDaUrl(this.pickString(item.url)) ||
            '';

        if (!data) return null;

        const candidatas = await this.uow.turmasRP.find({
            where: {
                id_treinamento: idTreinamento,
                data_inicio: data,
            },
        });
        if (!candidatas.length) return null;
        if (candidatas.length === 1) return candidatas[0];

        if (cidadeHint) {
            const cidadeNorm = this.normalizar(cidadeHint);
            const porCidade = candidatas.find(
                (t) =>
                    this.normalizar(t.cidade).includes(cidadeNorm) ||
                    cidadeNorm.includes(this.normalizar(t.cidade)),
            );
            if (porCidade) return porCidade;
        }

        // Empate: prefira turma com referencia_externa (veio do sync/push).
        return candidatas.find((t) => !!t.referencia_externa) ?? candidatas[0];
    }

    private extrairItens<T>(body: unknown): T[] {
        if (Array.isArray(body)) return body as T[];
        if (body && typeof body === 'object') {
            const obj = body as Record<string, unknown>;
            if (Array.isArray(obj.items)) return obj.items as T[];
            if (Array.isArray(obj.data)) return obj.data as T[];
            if (Array.isArray(obj.registros)) return obj.registros as T[];
            if (Array.isArray(obj.masterclasses)) return obj.masterclasses as T[];
        }
        return [];
    }

    private pickIdEvento(item: { id_masterclass?: unknown; id?: unknown }): string {
        return this.pickString(item.id_masterclass, item.id);
    }

    /** Em leads, `id` é o UUID do registro — não usar como id_masterclass. */
    private pickIdMasterclassDoLead(item: {
        id_masterclass?: unknown;
        dados_masterclass_id?: unknown;
    }): string {
        return this.pickString(item.id_masterclass, item.dados_masterclass_id);
    }

    private pickString(...values: unknown[]): string {
        for (const value of values) {
            if (value == null) continue;
            const s = String(value).trim();
            if (s) return s;
        }
        return '';
    }

    private normalizarData(valor: string | null | undefined): string | null {
        const v = (valor || '').trim();
        if (!v) return null;

        const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

        const br = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
        if (br) {
            const dd = br[1].padStart(2, '0');
            const mm = br[2].padStart(2, '0');
            let yyyy = br[3];
            if (yyyy.length === 2) {
                const n = parseInt(yyyy, 10);
                yyyy = n >= 70 ? `19${yyyy}` : `20${yyyy}`;
            }
            return `${yyyy}-${mm}-${dd}`;
        }

        // Formatos tipo 04-05-26 ou 04-05 (tag) não são data completa — ignora.
        const ts = Date.parse(v);
        return Number.isNaN(ts) ? null : new Date(ts).toISOString().slice(0, 10);
    }

    private cidadeDeSlugOuTag(item: {
        cidade_slug?: unknown;
        tag?: unknown;
        url?: unknown;
    }): string {
        const slug = this.pickString(item.cidade_slug);
        if (slug) return slug.replace(/-/g, ' ');

        const tag = this.pickString(item.tag);
        if (tag) {
            // Ex.: mc-jacarei-04-05 → jacarei
            const parts = tag.toLowerCase().split('-').filter(Boolean);
            if (parts.length >= 2) {
                const semMc = parts[0] === 'mc' ? parts.slice(1) : parts;
                // Remove sufixo dd-mm no final quando houver.
                if (semMc.length >= 3 && /^\d{1,2}$/.test(semMc[semMc.length - 1]) && /^\d{1,2}$/.test(semMc[semMc.length - 2])) {
                    return semMc.slice(0, -2).join(' ');
                }
                return semMc.join(' ');
            }
        }

        return this.extrairCidadeDaUrl(this.pickString(item.url));
    }

    private extrairCidadeDaUrl(url: string): string {
        if (!url) return '';
        try {
            const path = new URL(url).pathname.toLowerCase();
            const parts = path.split('/').filter(Boolean);
            // Heurística: segmento com mc-<cidade>-<dd>-<mm>
            for (const part of parts) {
                if (part.startsWith('mc-') || part.includes('-')) {
                    const segs = part.split('-').filter(Boolean);
                    const base = segs[0] === 'mc' ? segs.slice(1) : segs;
                    if (base.length >= 3 && /^\d{1,2}$/.test(base[base.length - 1]) && /^\d{1,2}$/.test(base[base.length - 2])) {
                        return base.slice(0, -2).join(' ');
                    }
                }
            }
        } catch {
            // URL inválida — ignora
        }
        return '';
    }

    private resolverPolo(
        cidade: string,
        poloNome: string,
        cidadeSlug: unknown,
        polos: Polos[],
    ): Polos | null {
        const cidadeNorm = this.normalizar(cidade || this.pickString(cidadeSlug).replace(/-/g, ' '));
        const poloNorm = this.normalizar(poloNome);

        if (cidadeNorm) {
            const porCidade = polos.find((p) => this.normalizar(p.cidade) === cidadeNorm);
            if (porCidade) return porCidade;
            const parcial = polos.find(
                (p) =>
                    this.normalizar(p.cidade).includes(cidadeNorm) ||
                    cidadeNorm.includes(this.normalizar(p.cidade)),
            );
            if (parcial) return parcial;
        }
        if (poloNorm) {
            const porPolo = polos.find((p) => this.normalizar(p.polo) === poloNorm);
            if (porPolo) return porPolo;
        }
        return null;
    }

    private mapearStatusTurma(item: MasterclassEventoPushItem): EStatusTurmas {
        if (this.isTruthy(item.cancelada) || this.pickString(item.status).toLowerCase() === 'cancelada') {
            return EStatusTurmas.INSCRICOES_PAUSADAS;
        }
        const status = this.pickString(item.status).toLowerCase();
        switch (status) {
            case 'realizada':
                return EStatusTurmas.ENCERRADA;
            case 'agendada':
                return EStatusTurmas.INSCRICOES_ABERTAS;
            case 'prevista':
                return EStatusTurmas.AGUARDANDO_LIBERACAO;
            default: {
                const data = this.normalizarData(this.pickString(item.data));
                if (data && data < new Date().toISOString().slice(0, 10)) {
                    return EStatusTurmas.ENCERRADA;
                }
                return EStatusTurmas.INSCRICOES_ABERTAS;
            }
        }
    }

    private mapearStatusEvento(item: MasterclassEventoPushItem): EStatusEventoCalendario {
        if (this.isTruthy(item.cancelada) || this.pickString(item.status).toLowerCase() === 'cancelada') {
            return EStatusEventoCalendario.CANCELADA;
        }
        if (this.isTruthy(item.extra)) return EStatusEventoCalendario.MC_EXTRA;
        if (this.pickString(item.status).toLowerCase() === 'prevista') {
            return EStatusEventoCalendario.VERIFICAR_LOCAL;
        }
        return EStatusEventoCalendario.OK;
    }

    private isTruthy(value: unknown): boolean {
        if (typeof value === 'boolean') return value;
        const s = String(value ?? '')
            .trim()
            .toLowerCase();
        return s === 'true' || s === '1' || s === 'sim' || s === 'yes';
    }

    private async resolverTreinamentoMasterclassId(): Promise<number> {
        const palestras = await this.uow.treinamentosRP.find({ where: { tipo_palestra: true } });
        if (palestras.length === 0) {
            throw new Error(
                'masterclass.push | Nenhum treinamento de palestra (tipo_palestra=true) encontrado',
            );
        }
        const preferido = palestras.find((t) => (t.sigla_treinamento || '').toUpperCase() === 'MC');
        return (preferido ?? palestras[0]).id;
    }

    private normalizar(valor: string | null | undefined): string {
        return (valor || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();
    }
}
