import {
    CodigoEventoDashboard,
    EVENTOS_DASHBOARD,
    FatiaAquisicaoDto,
    FatiaDashboardDto,
    MetricasDashboardVendasDto,
    RankingLiderConversaoDto,
    RankingLiderPendenciaDto,
    RankingTurmaEventoDto,
    ResumoStatusDashboardDto,
    StatusResumoItemDto,
} from './dto/vendas-dashboard.dto';

type FormaPagamentoItem = {
    forma?: string;
    tipo?: string;
    valor?: number | string;
};

export type ContratoDashboardLinha = {
    id: string;
    criado_em?: string | Date | null;
    deletado_em?: string | Date | null;
    status?: string | null;
    dados_contrato: Record<string, any>;
    pendencia_pagamento?: boolean;
    quantidade_inscricoes?: number;
    lider_id?: string | null;
    lider_nome?: string | null;
    ids_turma: number[];
};

export type TurmaRankingInput = {
    id: number;
    label: string;
    codigoEvento: CodigoEventoDashboard | null;
    alunosCount?: number;
    confirmadosCount?: number;
    presentesCount?: number;
};

const normalizeForSearch = (valor?: string | null): string =>
    String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

const parseNumeroSeguro = (valor: unknown): number => {
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
    if (typeof valor === 'string') {
        const limpo = valor.replace(/[^\d,.-]/g, '').replace(',', '.');
        const n = Number(limpo);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
};

export const codigoEventoDashboard = (nomeBruto?: string, siglaBruta?: string): CodigoEventoDashboard | null => {
    const sigla = normalizeForSearch(siglaBruta);
    const nome = normalizeForSearch(nomeBruto);

    if (!sigla && !nome) return null;

    if (sigla === 'ipr' || nome.includes('ipr') || nome.includes('imersaoprosperar')) {
        return 'IPR';
    }

    if (sigla === 'conf' || nome.includes('confronto') || (sigla.startsWith('conf') && sigla.length <= 6)) {
        return 'CONF';
    }

    if (sigla === 'mg' || nome.includes('missaogovernar')) {
        return 'MG';
    }

    if (sigla === 'idn' || sigla === 'in' || nome.includes('imersaodenegocio') || nome.includes('imersaonegocio') || nome.includes('idn')) {
        return 'IDN';
    }

    return null;
};

export const rotuloTreinamentoDashboard = (nomeBruto: string, siglaBruta?: string): string => {
    const codigo = codigoEventoDashboard(nomeBruto, siglaBruta);
    if (codigo) return codigo;
    const n = normalizeForSearch(nomeBruto);
    if (!n || n === 'treinamentonaoinformado') return 'Não informado';
    return nomeBruto.trim() || 'Não informado';
};

export const rotuloFormaPagamentoDashboard = (forma?: string, tipo?: string): string => {
    const base = normalizeForSearch(`${forma || ''} ${tipo || ''}`);
    if (!base) return 'Outros';
    if (base.includes('link')) return 'Link';
    if (base.includes('boleto')) return 'Boleto';
    if (base.includes('pix') || base.includes('transferencia')) return 'Pix';
    if (base.includes('credito') || base.includes('debito') || base.includes('cartao')) return 'Cartão';
    if (base.includes('especie') || base.includes('dinheiro')) return 'Dinheiro';
    if (base.includes('pendencia') || base.includes('pendente')) return 'Pendência';
    return (forma || tipo || 'Outros').trim() || 'Outros';
};

const ordemFormaPagamento = (label: string): number => {
    const ordem: Record<string, number> = {
        Pix: 0,
        Cartão: 1,
        Link: 2,
        Boleto: 3,
        Pendência: 4,
        Dinheiro: 5,
        Outros: 6,
    };
    return ordem[label] ?? 50;
};

export const rotuloTurmaIamControl = (turma: {
    id: number;
    edicao_turma?: string | null;
    cidade?: string | null;
    polo?: { sigla_polo?: string | null; nome?: string | null } | null;
    treinamento?: {
        sigla_treinamento?: string | null;
        treinamento?: string | null;
        nome?: string | null;
    } | null;
    sigla_treinamento?: string | null;
}): string => {
    const sigla = (turma.treinamento?.sigla_treinamento || turma.sigla_treinamento || '').trim();
    const nome = (turma.treinamento?.treinamento || turma.treinamento?.nome || '').trim();
    const base = sigla || nome || 'Turma';
    const polo = (turma.polo?.sigla_polo || '').trim();
    const edicao = (turma.edicao_turma || '').trim();
    const codigo = [base, polo, edicao].filter((parte) => parte !== '').join('_');
    if (codigo) return codigo;
    const cidade = (turma.cidade || turma.polo?.nome || '').trim();
    if (cidade && edicao) return `${base} ${cidade} - ${edicao}`;
    return `${base} #${turma.id}`;
};

export const isProcessoVendaContrato = (contrato: ContratoDashboardLinha): boolean => {
    const dadosContrato = contrato.dados_contrato || {};
    const pagamento = dadosContrato.pagamento || {};
    const camposVariaveis = dadosContrato.campos_variaveis || {};
    const tipoDocumento = String(camposVariaveis['Tipo de Documento'] || '').toLowerCase();

    if (tipoDocumento.includes('termo')) return false;

    const formasPagamento: FormaPagamentoItem[] = Array.isArray(pagamento.formas_pagamento) ? pagamento.formas_pagamento : [];
    const possuiPagamento = formasPagamento.length > 0 || Boolean(pagamento.forma_pagamento);
    const possuiValorFinanceiro =
        parseNumeroSeguro(camposVariaveis['Preço do Treinamento']) > 0 ||
        parseNumeroSeguro(camposVariaveis['Valor Total']) > 0 ||
        formasPagamento.some((forma) => parseNumeroSeguro(forma.valor) > 0);

    return possuiPagamento || possuiValorFinanceiro;
};

export const obterValorTotalContrato = (contrato: ContratoDashboardLinha): number => {
    const dadosContrato = contrato.dados_contrato || {};
    const pagamento = dadosContrato.pagamento || {};
    const camposVariaveis = dadosContrato.campos_variaveis || {};
    const formas: FormaPagamentoItem[] = Array.isArray(pagamento.formas_pagamento) ? pagamento.formas_pagamento : [];
    const somaFormas = formas.reduce((acc, forma) => acc + parseNumeroSeguro(forma.valor), 0);
    const totalInformado = parseNumeroSeguro(
        pagamento.valores_formas_pagamento?.total_contrato ??
            dadosContrato.valores_formas_pagamento?.total_contrato ??
            camposVariaveis['Valor Total'] ??
            camposVariaveis['Valor Total do Contrato'],
    );
    return totalInformado > 0 ? totalInformado : somaFormas;
};

export const obterQuantidadeInscricoes = (contrato: ContratoDashboardLinha): number => {
    const dadosContrato = contrato.dados_contrato || {};
    const camposVariaveis = dadosContrato.campos_variaveis || {};
    const quantidadeRaw =
        dadosContrato.turma_aluno?.quantidade_inscricoes ??
        contrato.quantidade_inscricoes ??
        parseNumeroSeguro(camposVariaveis['Quantidade de Inscrições']);
    return Math.max(1, Math.round(parseNumeroSeguro(quantidadeRaw) || 1));
};

export const possuiPendenciaPagamento = (contrato: ContratoDashboardLinha): boolean =>
    Boolean(
        contrato.pendencia_pagamento ??
            contrato.dados_contrato?.turma_aluno?.pendencia_pagamento ??
            contrato.dados_contrato?.campos_variaveis?.['Pendência de Pagamento'] === 'true',
    );

export const obterDadosEventoContrato = (
    contrato: ContratoDashboardLinha,
): { nome: string; sigla: string; codigo: CodigoEventoDashboard | null } => {
    const dadosContrato = contrato.dados_contrato || {};
    const treinamento = dadosContrato.treinamento || {};
    const camposVariaveis = dadosContrato.campos_variaveis || {};
    const nome =
        treinamento.treinamento ||
        treinamento.nome ||
        camposVariaveis['Nome do Treinamento Contratado'] ||
        camposVariaveis['Treinamento de Destino'] ||
        camposVariaveis['Nome do Treinamento'] ||
        'Treinamento não informado';
    const sigla = treinamento.sigla_treinamento || treinamento.sigla || camposVariaveis['Sigla do Treinamento'] || '';
    return {
        nome,
        sigla,
        codigo: codigoEventoDashboard(nome, sigla),
    };
};

const mapearParaFatias = (mapa: Map<string, { quantidade: number; valor: number }>, ordenarPor: (label: string) => number): FatiaDashboardDto[] => {
    const totalValor = Array.from(mapa.values()).reduce((acc, item) => acc + item.valor, 0);

    return Array.from(mapa.entries())
        .map(([label, dados]) => ({
            label,
            quantidade: dados.quantidade,
            valor: dados.valor,
            percentual: totalValor > 0 ? (dados.valor / totalValor) * 100 : 0,
        }))
        .sort((a, b) => {
            const ordemA = ordenarPor(a.label);
            const ordemB = ordenarPor(b.label);
            if (ordemA !== ordemB && (ordemA < 50 || ordemB < 50)) {
                return ordemA - ordemB;
            }
            return b.valor - a.valor;
        });
};

export const agregarFormasPagamento = (contratos: ContratoDashboardLinha[]): FatiaDashboardDto[] => {
    const mapa = new Map<string, { quantidade: number; valor: number }>();

    const adicionar = (label: string, valor: number) => {
        if (valor <= 0) return;
        const atual = mapa.get(label) || { quantidade: 0, valor: 0 };
        atual.quantidade += 1;
        atual.valor += valor;
        mapa.set(label, atual);
    };

    for (const contrato of contratos) {
        if (!isProcessoVendaContrato(contrato)) continue;
        const pagamento = contrato.dados_contrato?.pagamento || {};
        const formas: FormaPagamentoItem[] = Array.isArray(pagamento.formas_pagamento) ? pagamento.formas_pagamento : [];
        const valorTotal = obterValorTotalContrato(contrato);
        const pendente = possuiPendenciaPagamento(contrato);

        if (formas.length > 0) {
            let somaFormas = 0;
            for (const forma of formas) {
                const valor = parseNumeroSeguro(forma.valor);
                somaFormas += valor;
                adicionar(rotuloFormaPagamentoDashboard(forma.forma, forma.tipo), valor);
            }
            const restante = valorTotal - somaFormas;
            if (pendente && restante > 0.01) {
                adicionar('Pendência', restante);
            }
            continue;
        }

        if (pendente) {
            adicionar('Pendência', valorTotal > 0 ? valorTotal : 0);
            continue;
        }

        adicionar(rotuloFormaPagamentoDashboard(pagamento.forma_pagamento), valorTotal > 0 ? valorTotal : 0);
    }

    return mapearParaFatias(mapa, ordemFormaPagamento);
};

export const agregarVendasPorProduto = (contratos: ContratoDashboardLinha[]): FatiaDashboardDto[] => {
    const mapa = new Map<string, { quantidade: number; valor: number }>();

    for (const contrato of contratos) {
        if (!isProcessoVendaContrato(contrato)) continue;
        const { nome, sigla } = obterDadosEventoContrato(contrato);
        const label = rotuloTreinamentoDashboard(nome, sigla);
        const quantidade = obterQuantidadeInscricoes(contrato);
        const valor = obterValorTotalContrato(contrato);
        const atual = mapa.get(label) || { quantidade: 0, valor: 0 };
        atual.quantidade += quantidade;
        atual.valor += valor;
        mapa.set(label, atual);
    }

    return mapearParaFatias(mapa, () => 50).sort((a, b) => b.valor - a.valor);
};

const valorFatia = (fatias: FatiaDashboardDto[], labels: string[]): number =>
    fatias.filter((f) => labels.includes(f.label)).reduce((acc, f) => acc + f.valor, 0);

export const calcularMetricasDashboard = (contratos: ContratoDashboardLinha[], domManha = 0): MetricasDashboardVendasDto => {
    let inscricoes = 0;
    let vendas = 0;
    let fatBruto = 0;
    let vendasComPendencia = 0;
    let vendasFechadas = 0;
    let inscricoesComPendencia = 0;
    let inscricoesFechadas = 0;

    for (const contrato of contratos) {
        if (!isProcessoVendaContrato(contrato)) continue;
        const qtd = obterQuantidadeInscricoes(contrato);
        const valor = obterValorTotalContrato(contrato);
        const pendente = possuiPendenciaPagamento(contrato);

        vendas += 1;
        inscricoes += qtd;
        fatBruto += valor;

        if (pendente) {
            vendasComPendencia += 1;
            inscricoesComPendencia += qtd;
        } else {
            vendasFechadas += 1;
            inscricoesFechadas += qtd;
        }
    }

    const formas = agregarFormasPagamento(contratos);
    const pix = valorFatia(formas, ['Pix']);
    const cartaoLink = valorFatia(formas, ['Cartão', 'Link']);
    const boleto = valorFatia(formas, ['Boleto']);
    const pendencia = valorFatia(formas, ['Pendência']);
    const liqBruto = Math.max(0, fatBruto - pendencia);
    const liquidezLiq = liqBruto;
    const percentualLiquidez = fatBruto > 0 ? (liquidezLiq / fatBruto) * 100 : 0;

    return {
        inscricoes,
        vendas,
        ticketMedio: vendas > 0 ? fatBruto / vendas : 0,
        fatBruto,
        liqBruto,
        liquidezLiq,
        percentualLiquidez,
        vendasComPendencia,
        vendasFechadas,
        inscricoesComPendencia,
        inscricoesFechadas,
        convPendencia: vendas > 0 ? (vendasComPendencia / vendas) * 100 : 0,
        convFechado: vendas > 0 ? (vendasFechadas / vendas) * 100 : 0,
        taxaFechamento: vendas > 0 ? (vendasFechadas / vendas) * 100 : 0,
        cartaoLink,
        pix,
        boleto,
        pendencia,
        domManha,
    };
};

const parseDataFlexivel = (valor?: string | null): Date | null => {
    if (!valor) return null;
    const bruto = String(valor).trim();
    const br = bruto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) {
        const data = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]), 0, 0, 0, 0);
        return Number.isNaN(data.getTime()) ? null : data;
    }
    const isoDateOnly = bruto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateOnly) {
        const data = new Date(Number(isoDateOnly[1]), Number(isoDateOnly[2]) - 1, Number(isoDateOnly[3]), 0, 0, 0, 0);
        return Number.isNaN(data.getTime()) ? null : data;
    }
    const fallback = new Date(bruto);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
};

type StatusRecebivel = 'resolvida' | 'no_prazo' | 'vencida' | 'cancelada';

const contratoTemBoleto = (contrato: ContratoDashboardLinha): boolean => {
    const pagamento = contrato.dados_contrato?.pagamento || {};
    const formas: FormaPagamentoItem[] = Array.isArray(pagamento.formas_pagamento) ? pagamento.formas_pagamento : [];
    if (formas.some((forma) => normalizeForSearch(`${forma.forma || ''} ${forma.tipo || ''}`).includes('boleto'))) {
        return true;
    }
    return normalizeForSearch(pagamento.forma_pagamento || '').includes('boleto');
};

const contratoEhCancelado = (contrato: ContratoDashboardLinha): boolean => {
    if (contrato.deletado_em) return true;
    const campos = contrato.dados_contrato?.campos_variaveis || {};
    const observacoes = contrato.dados_contrato?.observacoes || '';
    const status = String(contrato.status || '');
    const texto = normalizeForSearch(
        [status, observacoes, campos['Status'], campos['Status do Contrato'], campos['Situação'], campos['Situacao']].filter(Boolean).join(' '),
    );
    return texto.includes('cancelad') || texto.includes('cancelamento') || texto.includes('solicitoucanc');
};

const contratoSolicitouCancelamento = (contrato: ContratoDashboardLinha): boolean => {
    const campos = contrato.dados_contrato?.campos_variaveis || {};
    const observacoes = contrato.dados_contrato?.observacoes || '';
    const texto = normalizeForSearch([observacoes, campos['Observações'], campos['Observacoes']].filter(Boolean).join(' '));
    return (
        texto.includes('solicitoucanc') ||
        texto.includes('solicitoucancel') ||
        texto.includes('pedidodecancel') ||
        texto.includes('pedidocancel')
    );
};

const obterPrimeiroVencimentoBoleto = (contrato: ContratoDashboardLinha): Date | null => {
    const campos = contrato.dados_contrato?.campos_variaveis || {};
    const primeira =
        parseDataFlexivel(campos['Data do Primeiro Boleto']) ||
        parseDataFlexivel(campos['Data do 1º Boleto']) ||
        parseDataFlexivel(campos['Data do 1o Boleto']);
    if (primeira) return primeira;
    const criadoEm =
        typeof contrato.criado_em === 'string'
            ? contrato.criado_em
            : contrato.criado_em instanceof Date
              ? contrato.criado_em.toISOString()
              : null;
    return parseDataFlexivel(criadoEm) || parseDataFlexivel(campos['Data da Venda']);
};

const classificarStatusRecebivel = (contrato: ContratoDashboardLinha, agora: Date): StatusRecebivel => {
    if (contratoEhCancelado(contrato)) return 'cancelada';

    const pendente = possuiPendenciaPagamento(contrato);
    if (!pendente) return 'resolvida';

    if (contratoTemBoleto(contrato)) {
        const vencimento = obterPrimeiroVencimentoBoleto(contrato);
        if (vencimento && vencimento.getTime() >= agora.getTime()) {
            return 'no_prazo';
        }
        return 'vencida';
    }

    return 'vencida';
};

const baseStatus = (): Omit<StatusResumoItemDto, 'id'> => ({
    quantidade: 0,
    valor: 0,
    inscricoes: 0,
});

export const calcularResumoStatusDashboard = (contratos: ContratoDashboardLinha[]): ResumoStatusDashboardDto => {
    const agora = new Date();
    agora.setHours(0, 0, 0, 0);

    const resolvidas = baseStatus();
    const noPrazo = baseStatus();
    const vencidas = baseStatus();
    const canceladas = baseStatus();
    let solicitouCancVencidas = 0;

    for (const contrato of contratos) {
        if (!isProcessoVendaContrato(contrato)) continue;
        const status = classificarStatusRecebivel(contrato, agora);
        const valor = obterValorTotalContrato(contrato);
        const inscricoes = obterQuantidadeInscricoes(contrato);
        const alvo = status === 'resolvida' ? resolvidas : status === 'no_prazo' ? noPrazo : status === 'vencida' ? vencidas : canceladas;

        alvo.quantidade += 1;
        alvo.valor += valor;
        alvo.inscricoes += inscricoes;

        if (status === 'vencida' && contratoSolicitouCancelamento(contrato)) {
            solicitouCancVencidas += 1;
        }
    }

    const totalQtd = resolvidas.quantidade + noPrazo.quantidade + vencidas.quantidade;
    const totalValor = resolvidas.valor + noPrazo.valor + vencidas.valor;
    const totalInsc = resolvidas.inscricoes + noPrazo.inscricoes + vencidas.inscricoes;

    return {
        total: { id: 'total', quantidade: totalQtd, valor: totalValor, inscricoes: totalInsc },
        resolvidas: { id: 'resolvidas', ...resolvidas },
        noPrazo: { id: 'no_prazo', ...noPrazo },
        vencidas: {
            id: 'vencidas',
            ...vencidas,
            detalheExtra: solicitouCancVencidas > 0 ? `${solicitouCancVencidas} solicitou canc.` : undefined,
        },
        canceladas: { id: 'canceladas', ...canceladas },
    };
};

export const calcularRankingsLideresPorEvento = (
    contratos: ContratoDashboardLinha[],
): Record<CodigoEventoDashboard, RankingLiderConversaoDto[]> => {
    const resultado: Record<CodigoEventoDashboard, RankingLiderConversaoDto[]> = {
        IPR: [],
        CONF: [],
        MG: [],
        IDN: [],
    };

    const mapa = new Map<
        string,
        {
            evento: CodigoEventoDashboard;
            lider_id: number;
            lider: string;
            vendas: number;
            inscricoes: number;
            vendasFechadas: number;
        }
    >();

    for (const contrato of contratos) {
        if (!isProcessoVendaContrato(contrato)) continue;
        const { codigo } = obterDadosEventoContrato(contrato);
        if (!codigo) continue;
        const liderId = Number(contrato.lider_id);
        if (!Number.isFinite(liderId) || liderId <= 0) continue;
        const liderNome = String(contrato.lider_nome || `Líder ${liderId}`).trim();

        const chave = `${codigo}::${liderId}`;
        const atual = mapa.get(chave) || {
            evento: codigo,
            lider_id: liderId,
            lider: liderNome,
            vendas: 0,
            inscricoes: 0,
            vendasFechadas: 0,
        };
        atual.vendas += 1;
        atual.inscricoes += obterQuantidadeInscricoes(contrato);
        if (!possuiPendenciaPagamento(contrato) && !contratoEhCancelado(contrato)) {
            atual.vendasFechadas += 1;
        }
        mapa.set(chave, atual);
    }

    for (const item of mapa.values()) {
        resultado[item.evento].push({
            lider_id: item.lider_id,
            lider: item.lider,
            evento: item.evento,
            vendas: item.vendas,
            inscricoes: item.inscricoes,
            vendasFechadas: item.vendasFechadas,
            conversao: item.vendas > 0 ? (item.vendasFechadas / item.vendas) * 100 : 0,
        });
    }

    for (const evento of EVENTOS_DASHBOARD) {
        resultado[evento].sort((a, b) => {
            if (b.conversao !== a.conversao) return b.conversao - a.conversao;
            return b.inscricoes - a.inscricoes;
        });
    }

    return resultado;
};

export const calcularRankingLideresPendencia = (contratos: ContratoDashboardLinha[]): RankingLiderPendenciaDto[] => {
    const mapa = new Map<number, { lider: string; valor: number; quantidade: number }>();

    for (const contrato of contratos) {
        if (!isProcessoVendaContrato(contrato)) continue;
        if (!possuiPendenciaPagamento(contrato)) continue;
        if (contratoEhCancelado(contrato)) continue;

        const liderId = Number(contrato.lider_id);
        if (!Number.isFinite(liderId) || liderId <= 0) continue;
        const liderNome = String(contrato.lider_nome || `Líder ${liderId}`).trim();

        const atual = mapa.get(liderId) || { lider: liderNome, valor: 0, quantidade: 0 };
        atual.quantidade += 1;
        atual.valor += obterValorTotalContrato(contrato);
        mapa.set(liderId, atual);
    }

    return Array.from(mapa.entries())
        .map(([lider_id, dados]) => ({
            lider_id,
            lider: dados.lider,
            valor: dados.valor,
            quantidade: dados.quantidade,
        }))
        .sort((a, b) => {
            if (b.valor !== a.valor) return b.valor - a.valor;
            return b.quantidade - a.quantidade;
        });
};

export const calcularRankingsTurmasPorEvento = (
    turmas: TurmaRankingInput[],
    contratos: ContratoDashboardLinha[],
): Record<CodigoEventoDashboard, RankingTurmaEventoDto[]> => {
    const resultado: Record<CodigoEventoDashboard, RankingTurmaEventoDto[]> = {
        IPR: [],
        CONF: [],
        MG: [],
        IDN: [],
    };

    const inscricoesPorTurma = new Map<number, number>();
    for (const contrato of contratos) {
        if (!isProcessoVendaContrato(contrato)) continue;
        const inscricoes = obterQuantidadeInscricoes(contrato);
        for (const idTurma of contrato.ids_turma) {
            inscricoesPorTurma.set(idTurma, (inscricoesPorTurma.get(idTurma) || 0) + inscricoes);
        }
    }

    for (const turma of turmas) {
        if (!turma.codigoEvento) continue;
        const confirmados = Math.max(0, turma.confirmadosCount || turma.alunosCount || 0);
        const presentes = Math.max(0, turma.presentesCount || 0);
        const noShow = Math.max(0, confirmados - presentes);
        const noShowPct = confirmados > 0 ? (noShow / confirmados) * 100 : 0;
        const inscricoes = inscricoesPorTurma.get(turma.id) || Math.max(0, turma.alunosCount || 0);
        const baseConversao = Math.max(presentes, confirmados, 0);
        const conversao = baseConversao > 0 ? (inscricoes / baseConversao) * 100 : 0;

        resultado[turma.codigoEvento].push({
            id: turma.id,
            turma: turma.label,
            evento: turma.codigoEvento,
            inscricoes,
            presentes,
            confirmados,
            noShowPct,
            conversao,
        });
    }

    for (const evento of EVENTOS_DASHBOARD) {
        resultado[evento].sort((a, b) => {
            if (b.conversao !== a.conversao) return b.conversao - a.conversao;
            return b.inscricoes - a.inscricoes;
        });
    }

    return resultado;
};

export const agregarEstrategiasAquisicao = (
    contagens: Array<{
        canal: string;
        quantidade: number;
    }>,
): FatiaAquisicaoDto[] => {
    let masterclass = 0;
    let timeVendas = 0;
    let demaisVendas = 0;
    let presente = 0;
    let bonus = 0;
    let transferencia = 0;
    let cortesiaSorteio = 0;

    for (const item of contagens) {
        const qtd = Math.max(0, Number(item.quantidade) || 0);
        switch (item.canal) {
            case 'Presente':
                presente += qtd;
                break;
            case 'Bônus':
                bonus += qtd;
                break;
            case 'Cortesia/Sorteio':
                cortesiaSorteio += qtd;
                break;
            case 'Time de Vendas':
                timeVendas += qtd;
                break;
            case 'Masterclass':
                masterclass += qtd;
                break;
            case 'Transferência':
                transferencia += qtd;
                break;
            case 'Transbordo':
            case 'Liberty':
            case 'Demais Vendas':
            case 'Importação':
                demaisVendas += qtd;
                break;
            default:
                demaisVendas += qtd;
                break;
        }
    }

    const itens = [
        { label: 'Masterclass', quantidade: masterclass },
        { label: 'Time de Vendas', quantidade: timeVendas },
        { label: 'Demais vendas', quantidade: demaisVendas },
        { label: 'Presente', quantidade: presente },
        { label: 'Bônus', quantidade: bonus },
        { label: 'Transferência', quantidade: transferencia },
        { label: 'Cortesia / Sorteio', quantidade: cortesiaSorteio },
    ].filter((item) => item.quantidade > 0);

    const total = itens.reduce((acc, item) => acc + item.quantidade, 0);

    return itens.map((item) => ({
        ...item,
        percentual: total > 0 ? (item.quantidade / total) * 100 : 0,
    }));
};

export const criarMapaAquisicaoVazio = (): Record<CodigoEventoDashboard, FatiaAquisicaoDto[]> => ({
    IPR: [],
    CONF: [],
    MG: [],
    IDN: [],
});

export const criarMapaRankingsLideresVazio = (): Record<CodigoEventoDashboard, RankingLiderConversaoDto[]> => ({
    IPR: [],
    CONF: [],
    MG: [],
    IDN: [],
});

export const criarMapaRankingsTurmasVazio = (): Record<CodigoEventoDashboard, RankingTurmaEventoDto[]> => ({
    IPR: [],
    CONF: [],
    MG: [],
    IDN: [],
});

export const metricasVazia = (domManha = 0): MetricasDashboardVendasDto => ({
    inscricoes: 0,
    vendas: 0,
    ticketMedio: 0,
    fatBruto: 0,
    liqBruto: 0,
    liquidezLiq: 0,
    percentualLiquidez: 0,
    vendasComPendencia: 0,
    vendasFechadas: 0,
    inscricoesComPendencia: 0,
    inscricoesFechadas: 0,
    convPendencia: 0,
    convFechado: 0,
    taxaFechamento: 0,
    cartaoLink: 0,
    pix: 0,
    boleto: 0,
    pendencia: 0,
    domManha,
});

export const resumoStatusVazio = (): ResumoStatusDashboardDto => ({
    total: { id: 'total', quantidade: 0, valor: 0, inscricoes: 0 },
    resolvidas: { id: 'resolvidas', quantidade: 0, valor: 0, inscricoes: 0 },
    noPrazo: { id: 'no_prazo', quantidade: 0, valor: 0, inscricoes: 0 },
    vencidas: { id: 'vencidas', quantidade: 0, valor: 0, inscricoes: 0 },
    canceladas: { id: 'canceladas', quantidade: 0, valor: 0, inscricoes: 0 },
});
