/**
 * Tipos do feed externo de masterclass (dash-masterclass-iam):
 * GET /api/webhooks/masterclass
 *
 * O feed é a nível de EVENTO (data, polo, cidade, palestrante, inscrições,
 * presentes). Ele NÃO traz os leads/alunos individuais — apenas contagens.
 * O tipo `leads` abaixo é opcional e só é usado caso o feed passe a incluir
 * os cadastros individuais no futuro (então eles vão para masterclass_pre_cadastros).
 */

export type MasterclassFeedOrigem = 'masterclass' | 'meta';

export type MasterclassFeedStatus = 'realizada' | 'agendada' | 'cancelada' | 'prevista';

export interface MasterclassFeedLead {
    nome?: string | null;
    nome_aluno?: string | null;
    email?: string | null;
    telefone?: string | null;
    presente?: boolean | null;
}

export interface MasterclassFeedItem {
    id: string;
    origem: MasterclassFeedOrigem;
    status: MasterclassFeedStatus;
    ja_ocorreu: boolean;
    data: string; // YYYY-MM-DD
    polo_id: string;
    polo: string;
    cidade_id: string;
    cidade: string;
    palestrante_id: string | null;
    palestrante: string;
    local_id: string | null;
    local: string | null;
    endereco_local: string | null;
    inscricoes: number;
    presentes: number;
    cancelada: boolean;
    extra: boolean;
    meta_vendas_por_mc: number | null;
    // Opcional — só existe se o feed passar a expor os cadastros individuais.
    leads?: MasterclassFeedLead[];
    registros?: MasterclassFeedLead[];
}

export interface MasterclassFeedResponse {
    ok: boolean;
    tenant_id?: string;
    gerado_em?: string;
    total?: number;
    total_masterclasses?: number;
    total_previstas_metas?: number;
    masterclasses: MasterclassFeedItem[];
    error?: string;
}

/** Resultado consolidado de uma execução de sincronização. */
export interface MasterclassSyncResult {
    total_recebidas: number;
    turmas_criadas: number;
    turmas_atualizadas: number;
    turmas_vinculadas_existentes: number;
    ignoradas_filtro: number;
    sem_polo: number;
    leads_criados: number;
    erros: number;
    detalhes_sem_polo: string[];
}
