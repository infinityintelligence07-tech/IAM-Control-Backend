export type ContractBrand = 'IAM' | 'LIBERTY';

export type ContractDestinationProfile = {
  key: string;
  brand: ContractBrand;
  treinamentoLabel: string;
  dataLabel: string;
  showTestemunhas: boolean;
  showBonus: boolean;
  showPayment: boolean;
  allowBoletoParcelado: boolean;
  showQuantidadeInscricoes: boolean;
};

export const IAM_LOGO_PATH = '/images/logo/logo-escuro.png';
export const LIBERTY_LOGO_PATH = '/images/logo/LOGO LIBERTY.png';

function normalizeTrainingName(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const PROFILE_IAM_TREINAMENTO: ContractDestinationProfile = {
  key: 'IAM_TREINAMENTO',
  brand: 'IAM',
  treinamentoLabel: 'TREINAMENTO',
  dataLabel: 'DATA PREVISTA',
  showTestemunhas: true,
  showBonus: true,
  showPayment: true,
  allowBoletoParcelado: true,
  showQuantidadeInscricoes: true,
};

const PROFILE_IAM_MENTORIA: ContractDestinationProfile = {
  key: 'IAM_MENTORIA',
  brand: 'IAM',
  treinamentoLabel: 'MENTORIA',
  dataLabel: 'DATA DA REALIZAÇÃO',
  showTestemunhas: true,
  showBonus: false,
  showPayment: true,
  allowBoletoParcelado: true,
  showQuantidadeInscricoes: false,
};

const PROFILE_IAM_PALESTRA: ContractDestinationProfile = {
  key: 'IAM_PALESTRA',
  brand: 'IAM',
  treinamentoLabel: 'EVENTO',
  dataLabel: 'DATA DA REALIZAÇÃO',
  showTestemunhas: false,
  showBonus: false,
  showPayment: true,
  allowBoletoParcelado: false,
  showQuantidadeInscricoes: false,
};

const PROFILE_LIBERTY_MENTORIA: ContractDestinationProfile = {
  key: 'LIBERTY_MENTORIA',
  brand: 'LIBERTY',
  treinamentoLabel: 'MENTORIA',
  dataLabel: 'DATA DA REALIZAÇÃO',
  showTestemunhas: true,
  // Bônus padrão (IPR/100 dias) desligado: Liberty usa fluxo próprio (cadeira / Begin).
  showBonus: false,
  showPayment: true,
  allowBoletoParcelado: true,
  showQuantidadeInscricoes: false,
};

const PROFILE_LIBERTY_BEGIN: ContractDestinationProfile = {
  key: 'LIBERTY_BEGIN',
  brand: 'LIBERTY',
  treinamentoLabel: 'MENTORIA',
  dataLabel: 'DATA DA REALIZAÇÃO',
  showTestemunhas: true,
  showBonus: false,
  showPayment: true,
  allowBoletoParcelado: true,
  showQuantidadeInscricoes: false,
};

/**
 * Perfil de contrato / PDF por nome do treinamento de destino.
 * Pasta shared do monorepo (consumida por backend e frontend via @shared/*).
 */
export function getContractDestinationProfile(
  treinamentoNome: string | null | undefined,
): ContractDestinationProfile {
  const name = normalizeTrainingName(treinamentoNome);

  if (
    name.includes('LIBERTY BEGIN') ||
    name.replace(/\s+/g, '').includes('LIBERTYBEGIN')
  ) {
    return { ...PROFILE_LIBERTY_BEGIN };
  }

  if (name.includes('LIBERTY')) {
    return { ...PROFILE_LIBERTY_MENTORIA };
  }

  if (name.includes('PALESTRA') || name.includes('MASTERCLASS')) {
    return { ...PROFILE_IAM_PALESTRA };
  }

  if (name.includes('MENTORIA')) {
    return { ...PROFILE_IAM_MENTORIA };
  }

  return { ...PROFILE_IAM_TREINAMENTO };
}
