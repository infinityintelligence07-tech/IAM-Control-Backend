/** Duração fixa da mentoria Liberty (anos → meses). */
export const DURACAO_LIBERTY_MESES = 12;

/** Duração fixa da mentoria Liberty Begin. */
export const DURACAO_LIBERTY_BEGIN_MESES = 6;

/** Fallback quando não há duração configurada. */
export const DURACAO_MENTORIA_PADRAO_MESES = 12;

function normalizeTrainingName(value: string | null | undefined): string {
    return String(value || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();
}

export function isLibertyBegin(treinamentoNome: string | null | undefined): boolean {
    const name = normalizeTrainingName(treinamentoNome);
    return name.includes('LIBERTY BEGIN') || name.includes('LIBERTYBEGIN');
}

export function isLiberty(treinamentoNome: string | null | undefined): boolean {
    const name = normalizeTrainingName(treinamentoNome);
    return name.includes('LIBERTY') && !isLibertyBegin(treinamentoNome);
}

/**
 * Resolve a duração efetiva da mentoria em meses.
 * Liberty = 12, Liberty Begin = 6; demais usam duracao_meses (padrão 12).
 */
export function resolverDuracaoMentoriaMeses(input: {
    treinamento?: string | null;
    duracao_meses?: number | null;
}): number {
    if (isLibertyBegin(input.treinamento)) return DURACAO_LIBERTY_BEGIN_MESES;
    if (isLiberty(input.treinamento)) return DURACAO_LIBERTY_MESES;

    const configured = Number(input.duracao_meses);
    if (Number.isFinite(configured) && configured > 0) {
        return Math.floor(configured);
    }
    return DURACAO_MENTORIA_PADRAO_MESES;
}

/**
 * Expressão SQL (PostgreSQL) que replica as regras de duração.
 * @param treinamentoColumn ex.: 'tr.treinamento'
 * @param duracaoColumn ex.: 'tr.duracao_meses'
 */
export function sqlDuracaoMentoriaMeses(treinamentoColumn: string, duracaoColumn: string): string {
    const normalized = `UPPER(TRANSLATE(COALESCE(${treinamentoColumn}, ''), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))`;
    return `CASE
      WHEN ${normalized} LIKE '%LIBERTY BEGIN%' OR REPLACE(${normalized}, ' ', '') LIKE '%LIBERTYBEGIN%' THEN ${DURACAO_LIBERTY_BEGIN_MESES}
      WHEN ${normalized} LIKE '%LIBERTY%' THEN ${DURACAO_LIBERTY_MESES}
      WHEN COALESCE(${duracaoColumn}, 0) > 0 THEN ${duracaoColumn}
      ELSE ${DURACAO_MENTORIA_PADRAO_MESES}
    END`;
}
