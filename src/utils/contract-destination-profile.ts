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
  showTestemunhas: boolean;
}

export const IAM_LOGO_PATH = "/images/logo/logo-claro.png";
export const LIBERTY_LOGO_PATH = "/images/logo/LOGO LIBERTY H OFICIAL.png";

const normalize = (value: string) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

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

const PROFILE_RULES: Array<{
  when: (normalizedTraining: string) => boolean;
  profile: ContractDestinationProfile;
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
      showTestemunhas: false,
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
    when: (n) => n.includes("imersao de negocios"),
    profile: {
      key: "IMERSAO_NEGOCIOS_TAXA",
      brand: "LIBERTY",
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
    when: (n) => n.includes("liberty begin"),
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
    when: (n) => n.includes("liberty") || n.includes("troca de pf para pj"),
    profile: {
      key: "LIBERTY_DEFAULT",
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
): ContractDestinationProfile => {
  const normalized = normalize(treinamentoNome || "");
  const found = PROFILE_RULES.find((rule) => rule.when(normalized));
  return found?.profile || PROFILE_DEFAULT_IAM;
};
