const normalize = (value: string) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** Duração padrão (em meses) das mentorias sem regra específica. */
export const DURACAO_MENTORIA_PADRAO_MESES = 12;

/** Liberty Begin: mentoria de 6 meses. */
export const DURACAO_LIBERTY_BEGIN_MESES = 6;

/** Liberty: mentoria de 1 ano (12 meses). */
export const DURACAO_LIBERTY_MESES = 12;

export interface MentoriaDuracaoInput {
  treinamento?: string | null;
  nome?: string | null;
  duracao_meses?: number | null;
}

/**
 * Resolve a duração (em meses) de uma mentoria.
 *
 * Regras de negócio fixas por produto (têm prioridade sobre o cadastro):
 *  - "Liberty Begin": 6 meses;
 *  - "Liberty" (demais variações): 12 meses (1 ano).
 *
 * As demais mentorias usam a duração configurada no cadastro
 * (`duracao_meses`); na ausência de um valor válido, aplica-se o padrão de
 * 12 meses.
 */
/** Liberty Begin ou Liberty (mentoria pura, pelo nome do produto). */
export const isMentoriaLibertyProduto = (
  input: MentoriaDuracaoInput | { treinamento?: string | null; nome?: string | null; tipo_mentoria?: boolean | null } | null | undefined,
): boolean => {
  const nome = normalize(
    (input as MentoriaDuracaoInput)?.treinamento ||
      (input as MentoriaDuracaoInput)?.nome ||
      '',
  );
  if (!nome.includes('liberty')) return false;
  // Eventos da mentoria às vezes reutilizam o nome; se tipo_mentoria=false explícito, não conta.
  if (
    input &&
    typeof input === 'object' &&
    'tipo_mentoria' in input &&
    input.tipo_mentoria === false
  ) {
    return false;
  }
  return true;
};

export const resolverDuracaoMentoriaMeses = (
  input: MentoriaDuracaoInput | null | undefined,
): number => {
  const nome = normalize(input?.treinamento || input?.nome || "");

  if (nome.includes("liberty begin")) return DURACAO_LIBERTY_BEGIN_MESES;
  if (nome.includes("liberty")) return DURACAO_LIBERTY_MESES;

  const configurada = Number(input?.duracao_meses);
  if (Number.isFinite(configurada) && configurada > 0) {
    return Math.round(configurada);
  }

  return DURACAO_MENTORIA_PADRAO_MESES;
};

/**
 * Expressão SQL (Postgres) equivalente a `resolverDuracaoMentoriaMeses`,
 * para uso em UPDATE/SELECT em lote. `coluna` é a referência da coluna de
 * nome do treinamento (ex.: "tr.treinamento") e `colunaDuracao` a coluna de
 * duração configurada (ex.: "tr.duracao_meses").
 */
export const sqlDuracaoMentoriaMeses = (
  coluna: string,
  colunaDuracao: string,
): string => `
  CASE
    WHEN lower(${coluna}) LIKE '%liberty begin%' THEN ${DURACAO_LIBERTY_BEGIN_MESES}
    WHEN lower(${coluna}) LIKE '%liberty%' THEN ${DURACAO_LIBERTY_MESES}
    WHEN ${colunaDuracao} IS NOT NULL AND ${colunaDuracao} > 0 THEN ${colunaDuracao}
    ELSE ${DURACAO_MENTORIA_PADRAO_MESES}
  END
`;
