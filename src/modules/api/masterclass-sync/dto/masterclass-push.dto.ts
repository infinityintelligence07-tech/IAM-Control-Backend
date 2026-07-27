/**
 * Payloads dos webhooks de push vindos do masterclass_integracao (Supabase).
 *
 * Aceitam:
 *  - `{ items: [...] }`
 *  - `{ data: [...] }`
 *  - array direto no body
 *
 * Os itens espelham as colunas das tabelas Supabase (campos em snake_case / aliases).
 */

export interface MasterclassEventoPushItem {
    id_masterclass?: string | null;
    id?: string | null;
    tag?: string | null;
    cidade_slug?: string | null;
    nome_cidade?: string | null;
    cidade?: string | null;
    polo?: string | null;
    data?: string | null;
    local?: string | null;
    endereco?: string | null;
    endereco_local?: string | null;
    palestrante?: string | null;
    cancelada?: boolean | string | null;
    extra?: boolean | string | null;
    status?: string | null;
    meta?: number | string | null;
    meta_vendas_por_mc?: number | string | null;
    [key: string]: unknown;
}

export interface MasterclassLeadPushItem {
    id?: string | null;
    name?: string | null;
    nome?: string | null;
    nome_aluno?: string | null;
    email?: string | null;
    phone?: string | null;
    telefone?: string | null;
    date?: string | null;
    data?: string | null;
    url?: string | null;
    tag?: string | null;
    id_masterclass?: string | null;
    dados_masterclass_id?: string | null;
    status?: string | null;
    qual_sua_profissao?: string | null;
    observacoes?: string | null;
    presente?: boolean | null;
    [key: string]: unknown;
}

export interface MasterclassEventosPushResult {
    total_recebidos: number;
    turmas_criadas: number;
    turmas_atualizadas: number;
    turmas_vinculadas_existentes: number;
    sem_polo: number;
    erros: number;
    detalhes_sem_polo: string[];
    detalhes_erros: string[];
}

export interface MasterclassLeadsPushResult {
    total_recebidos: number;
    leads_criados: number;
    leads_ignorados: number;
    sem_turma: number;
    erros: number;
    detalhes_sem_turma: string[];
    detalhes_erros: string[];
}
