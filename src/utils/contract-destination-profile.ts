export type ContractBrand = "IAM" | "LIBERTY";

export interface ContractDestinationProfile {
  key: string;
  brand: ContractBrand;
  treinamentoLabel:
    | "TREINAMENTO"
    | "EVENTO"
    | "MENTORIA"
    | "TREINAMENTO ONLINE";
  dataLabel: "DATA PREVISTA" | "DATA DA REALIZAÇÃO" | null;
  showBonus: boolean;
  showPayment: boolean;
  allowBoletoParcelado: boolean;
  showQuantidadeInscricoes: boolean;
  // Testemunhas no contrato digital. Exceção: contratos de IPR (Imersão
  // Prosperar) e variantes (comum/especial/taxa) não usam testemunhas.
  // Nos demais treinamentos/mentorias, a QUANTIDADE varia pela origem da venda.
  showTestemunhas: boolean;
}

export const IAM_LOGO_PATH = "/images/logo/logo-iam.png";
export const LIBERTY_LOGO_PATH = "/images/logo/LOGO LIBERTY H OFICIAL.png";

const normalize = (value: string) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/**
 * Contratos da marca IAM devem exibir a logo no cabeçalho,
 * exceto Leader Skills e PEA.
 */
export const shouldShowContractHeaderLogo = (
  brand: ContractBrand,
  treinamentoNome?: string | null,
): boolean => {
  if (brand === "LIBERTY") return true;
  const n = normalize(treinamentoNome || "");
  if (!n) return true;
  if (
    n.includes("leader skills") ||
    n.includes("lider skills") ||
    n.includes("leaderskills") ||
    n.includes("liderskills")
  ) {
    return false;
  }
  // PEA como produto (evita falso positivo em palavras longas).
  if (
    n === "pea" ||
    n.startsWith("pea ") ||
    n.endsWith(" pea") ||
    n.includes(" pea ") ||
    /\bpea\b/.test(n)
  ) {
    return false;
  }
  return true;
};

const PROFILE_DEFAULT_IAM: ContractDestinationProfile = {
  key: "DEFAULT_IAM",
  brand: "IAM",
  treinamentoLabel: "TREINAMENTO",
  dataLabel: "DATA PREVISTA",
  showBonus: false,
  showPayment: true,
  allowBoletoParcelado: true,
  showQuantidadeInscricoes: false,
  showTestemunhas: true,
};

// Evento presencial da Liberty (ex.: encontros dos mentorados do Liberty /
// Liberty Begin): mantém a marca Liberty, mas o contrato é de EVENTO, como os
// eventos da IAM — e não de mentoria, apesar de "Liberty" estar no nome.
const PROFILE_LIBERTY_EVENTO: ContractDestinationProfile = {
  key: "LIBERTY_EVENTO",
  brand: "LIBERTY",
  treinamentoLabel: "EVENTO",
  dataLabel: "DATA PREVISTA",
  showBonus: false,
  showPayment: true,
  allowBoletoParcelado: true,
  showQuantidadeInscricoes: false,
  showTestemunhas: true,
};

const PROFILE_LIBERTY_DEFAULT: ContractDestinationProfile = {
  key: "LIBERTY_DEFAULT",
  brand: "LIBERTY",
  treinamentoLabel: "MENTORIA",
  dataLabel: null,
  showBonus: false,
  showPayment: true,
  allowBoletoParcelado: true,
  showQuantidadeInscricoes: false,
  showTestemunhas: true,
};

// `somenteMentoria`/`somenteEvento`: regras aplicadas apenas quando o cadastro
// do produto informa o tipo (`tipoMentoria`). Sem essa informação, valem as
// regras de mentoria, preservando o comportamento dos contratos já existentes.
const PROFILE_RULES: Array<{
  when: (normalizedTraining: string) => boolean;
  profile: ContractDestinationProfile;
  somenteMentoria?: boolean;
  somenteEvento?: boolean;
}> = [
  {
    when: (n) =>
      n.includes("ipr especial") || (n.includes("ipr") && n.includes("taxa")),
    profile: {
      key: "IPR_ESPECIAL",
      brand: "IAM",
      treinamentoLabel: "TREINAMENTO",
      dataLabel: "DATA PREVISTA",
      showBonus: false,
      showPayment: false,
      allowBoletoParcelado: false,
      showQuantidadeInscricoes: true,
      showTestemunhas: false,
    },
  },
  {
    when: (n) => n.includes("ipr comum"),
    profile: {
      key: "IPR_COMUM",
      brand: "IAM",
      treinamentoLabel: "TREINAMENTO",
      dataLabel: "DATA PREVISTA",
      showBonus: false,
      showPayment: false,
      allowBoletoParcelado: false,
      showQuantidadeInscricoes: true,
      showTestemunhas: false,
    },
  },
  {
    // Imersão Prosperar (IPR) e demais variantes: contrato sem testemunhas.
    // Mantém o restante igual ao DEFAULT_IAM (pagamento, boleto, etc.).
    when: (n) => n.includes("imersao prosperar") || n.includes("ipr"),
    profile: {
      key: "IPR",
      brand: "IAM",
      treinamentoLabel: "TREINAMENTO",
      dataLabel: "DATA PREVISTA",
      showBonus: false,
      showPayment: true,
      allowBoletoParcelado: true,
      showQuantidadeInscricoes: false,
      showTestemunhas: false,
    },
  },
  {
    when: (n) => n.includes("prosperer com proposito"),
    profile: {
      key: "PROSPERER_ONLINE",
      brand: "IAM",
      treinamentoLabel: "TREINAMENTO ONLINE",
      dataLabel: null,
      showBonus: false,
      showPayment: false,
      allowBoletoParcelado: false,
      showQuantidadeInscricoes: false,
      showTestemunhas: true,
    },
  },
  {
    when: (n) => n.includes("mesa de destino"),
    profile: {
      key: "MESA_DESTINO",
      brand: "LIBERTY",
      treinamentoLabel: "EVENTO",
      dataLabel: "DATA PREVISTA",
      showBonus: false,
      showPayment: true,
      allowBoletoParcelado: true,
      showQuantidadeInscricoes: false,
      showTestemunhas: true,
    },
  },
  {
    when: (n) =>
      n.includes("porsche") ||
      n.includes("mentoria no porsche") ||
      n.includes("mentoria de 30 minutos"),
    profile: {
      key: "MENTORIA_PORSCHE",
      brand: "LIBERTY",
      treinamentoLabel: "MENTORIA",
      dataLabel: "DATA DA REALIZAÇÃO",
      showBonus: false,
      showPayment: true,
      allowBoletoParcelado: false,
      showQuantidadeInscricoes: false,
      showTestemunhas: true,
    },
  },
  {
    // Imersão de Negócios (IDN): contrato Liberty de treinamento com
    // quantidade de inscrições. Time de Vendas e demais canais precisam
    // registrar formas de pagamento para preencher Preço e Observações.
    when: (n) => n.includes("imersao de negocios"),
    profile: {
      key: "IMERSAO_NEGOCIOS",
      brand: "LIBERTY",
      treinamentoLabel: "TREINAMENTO",
      dataLabel: "DATA PREVISTA",
      showBonus: false,
      showPayment: true,
      allowBoletoParcelado: true,
      showQuantidadeInscricoes: true,
      showTestemunhas: true,
    },
  },
  {
    when: (n) => n.includes("liberty"),
    somenteEvento: true,
    profile: PROFILE_LIBERTY_EVENTO,
  },
  {
    when: (n) => n.includes("liberty begin"),
    somenteMentoria: true,
    profile: {
      key: "LIBERTY_BEGIN",
      brand: "LIBERTY",
      treinamentoLabel: "MENTORIA",
      dataLabel: null,
      showBonus: false,
      showPayment: true,
      allowBoletoParcelado: true,
      showQuantidadeInscricoes: false,
      showTestemunhas: true,
    },
  },
  {
    when: (n) => n.includes("lider xp"),
    profile: {
      key: "LIDER_XP",
      brand: "LIBERTY",
      treinamentoLabel: "TREINAMENTO",
      dataLabel: "DATA PREVISTA",
      showBonus: false,
      showPayment: true,
      allowBoletoParcelado: true,
      showQuantidadeInscricoes: false,
      showTestemunhas: true,
    },
  },
  {
    when: (n) => n.includes("liberty"),
    somenteMentoria: true,
    profile: PROFILE_LIBERTY_DEFAULT,
  },
  {
    when: (n) => n.includes("troca de pf para pj"),
    profile: PROFILE_LIBERTY_DEFAULT,
  },
  {
    // Aplica o perfil de Confronto (com bônus) somente ao "Confronto" propriamente
    // dito. Treinamentos como "Confronto 2"/"Confronto 3" são produtos distintos e
    // NÃO devem exibir os bônus do contrato — por isso excluímos "confronto <número>".
    when: (n) => n.includes("confronto") && !/confronto\s*\d/.test(n),
    profile: {
      key: "CONFRONTO",
      brand: "IAM",
      treinamentoLabel: "TREINAMENTO",
      dataLabel: "DATA PREVISTA",
      showBonus: true,
      showPayment: true,
      allowBoletoParcelado: true,
      showQuantidadeInscricoes: false,
      showTestemunhas: true,
    },
  },
];

export const getContractDestinationProfile = (
  treinamentoNome: string | null | undefined,
  opcoes?: { tipoMentoria?: boolean | null },
): ContractDestinationProfile => {
  const normalized = normalize(treinamentoNome || "");
  const tipoMentoria = opcoes?.tipoMentoria;
  const ehEvento = tipoMentoria === false;
  const found = PROFILE_RULES.find((rule) => {
    if (rule.somenteMentoria && ehEvento) return false;
    if (rule.somenteEvento && !ehEvento) return false;
    return rule.when(normalized);
  });
  return found?.profile || PROFILE_DEFAULT_IAM;
};
