import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export const EVENTOS_DASHBOARD = ['IPR', 'CONF', 'MG', 'IDN'] as const;
export type CodigoEventoDashboard = (typeof EVENTOS_DASHBOARD)[number];

const emptyToUndefined = ({ value }: { value: unknown }) => {
    if (value === '' || value === null || value === undefined) return undefined;
    return value;
};

export class VendasDashboardQueryDto {
    @IsOptional()
    @IsString()
    @Transform(emptyToUndefined)
    data_inicio?: string;

    @IsOptional()
    @IsString()
    @Transform(emptyToUndefined)
    data_fim?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsIn([...EVENTOS_DASHBOARD])
    evento?: CodigoEventoDashboard;

    @IsOptional()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return undefined;
        const n = Number(value);
        return Number.isFinite(n) ? n : value;
    })
    @IsInt()
    lider_id?: number;

    @IsOptional()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return undefined;
        const n = Number(value);
        return Number.isFinite(n) ? n : value;
    })
    @IsInt()
    turma_id?: number;
}

export class FatiaDashboardDto {
    label: string;
    quantidade: number;
    valor: number;
    percentual: number;
}

export class FatiaAquisicaoDto {
    label: string;
    quantidade: number;
    percentual: number;
}

export class MetricasDashboardVendasDto {
    inscricoes: number;
    vendas: number;
    ticketMedio: number;
    /** Soma dos valores dos contratos. */
    fatBruto: number;
    /** Pix + Cartão + Link. */
    liqBruto: number;
    /** (Cartão + Link) × 0,88 + Pix. */
    liquidezLiq: number;
    /** Liquidez liq ÷ Fat bruto (× 100). */
    percentualLiquidez: number;
    vendasComPendencia: number;
    vendasFechadas: number;
    inscricoesComPendencia: number;
    inscricoesFechadas: number;
    convPendencia: number;
    convFechado: number;
    taxaFechamento: number;
    cartaoLink: number;
    pix: number;
    boleto: number;
    pendencia: number;
    /** Soma de presentes (Dom Manhã) nas turmas filtradas. */
    domManha: number;
}

export class StatusResumoItemDto {
    id: 'total' | 'resolvidas' | 'no_prazo' | 'vencidas' | 'canceladas';
    quantidade: number;
    valor: number;
    inscricoes: number;
    detalheExtra?: string;
}

export class ResumoStatusDashboardDto {
    total: StatusResumoItemDto;
    resolvidas: StatusResumoItemDto;
    noPrazo: StatusResumoItemDto;
    vencidas: StatusResumoItemDto;
    canceladas: StatusResumoItemDto;
}

export class RankingLiderConversaoDto {
    lider_id: number;
    lider: string;
    evento: CodigoEventoDashboard;
    vendas: number;
    inscricoes: number;
    vendasFechadas: number;
    conversao: number;
}

export class RankingTurmaEventoDto {
    id: number;
    turma: string;
    evento: CodigoEventoDashboard;
    inscricoes: number;
    presentes: number;
    confirmados: number;
    noShowPct: number;
    conversao: number;
}

export class RankingLiderPendenciaDto {
    lider_id: number;
    lider: string;
    valor: number;
    quantidade: number;
}

export class VendasDashboardResponseDto {
    filtros_aplicados: {
        data_inicio: string;
        data_fim: string;
        evento?: CodigoEventoDashboard | null;
        lider_id?: number | null;
        turma_id?: number | null;
    };
    metricas: MetricasDashboardVendasDto;
    formasPagamento: FatiaDashboardDto[];
    vendasPorProduto: FatiaDashboardDto[];
    statusRecebiveis: ResumoStatusDashboardDto;
    rankingsLideres: Record<CodigoEventoDashboard, RankingLiderConversaoDto[]>;
    rankingsTurmas: Record<CodigoEventoDashboard, RankingTurmaEventoDto[]>;
    rankingPendencia: RankingLiderPendenciaDto[];
    aquisicaoPorEvento: Record<CodigoEventoDashboard, FatiaAquisicaoDto[]>;
}

export class VendasDashboardFiltroLiderDto {
    id: number;
    nome: string;
}

export class VendasDashboardFiltroTurmaDto {
    id: number;
    label: string;
    evento: CodigoEventoDashboard | null;
}

export class VendasDashboardFiltrosResponseDto {
    eventos: CodigoEventoDashboard[];
    lideres: VendasDashboardFiltroLiderDto[];
    turmas: VendasDashboardFiltroTurmaDto[];
}
