/**
 * Correlação de identidade entre um aluno do IAM Control e um `student` da
 * Gestão de Contas (app Lovable).
 *
 * O vínculo definitivo é o `iam_control_aluno_id` gravado do lado da Gestão de
 * Contas. Enquanto ele não existe (primeira sincronização, cadastro feito
 * manualmente lá, etc.) o casamento é feito por telefone + e-mail + nome.
 */

/** Chave de correlação normalizada de um cliente. */
export interface ChaveIdentidadeCliente {
    /** DDD + 8 dígitos finais. Vazio quando não há telefone utilizável. */
    telefone: string;
    /** E-mail em minúsculas, sem espaços. */
    email: string;
    /** Primeiro nome + último sobrenome, sem acentos. */
    nome: string;
}

/** Pontuação mínima para considerar que dois registros são a mesma pessoa. */
const PONTUACAO_MINIMA_MATCH = 3;

const PESO_TELEFONE = 2;
const PESO_EMAIL = 2;
const PESO_NOME = 1;

/**
 * Reduz o telefone a DDD + 8 dígitos finais.
 *
 * Absorve as três variações que convivem na base: com e sem DDI 55, e com e sem
 * o nono dígito dos celulares. `+55 (11) 98765-4321`, `11987654321` e
 * `1187654321` produzem todos `1187654321`.
 */
export function normalizarTelefone(valor: string | null | undefined): string {
    let digitos = (valor || '').replace(/\D/g, '');

    if (digitos.length > 11 && digitos.startsWith('55')) {
        digitos = digitos.slice(2);
    }
    if (digitos.length < 10) {
        return digitos;
    }

    const ddd = digitos.slice(0, 2);
    return `${ddd}${digitos.slice(-8)}`;
}

export function normalizarEmail(valor: string | null | undefined): string {
    return (valor || '').trim().toLowerCase();
}

/** Minúsculo, sem acentos e sem espaços duplicados. */
export function normalizarTexto(valor: string | null | undefined): string {
    return (valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * "Parte do nome" usada na conferência: primeiro nome + último sobrenome.
 *
 * Ignorar os nomes do meio evita falsos negativos quando um dos sistemas tem o
 * nome abreviado ou incompleto ("Maria Silva Souza" x "Maria Souza").
 */
export function chaveNome(valor: string | null | undefined): string {
    const partes = normalizarTexto(valor)
        .split(' ')
        .filter((parte) => parte.length > 0);

    if (partes.length === 0) return '';
    if (partes.length === 1) return partes[0];

    return `${partes[0]} ${partes[partes.length - 1]}`;
}

export function montarChaveIdentidade(dados: {
    nome?: string | null;
    email?: string | null;
    telefone?: string | null;
}): ChaveIdentidadeCliente {
    return {
        telefone: normalizarTelefone(dados.telefone),
        email: normalizarEmail(dados.email),
        nome: chaveNome(dados.nome),
    };
}

/**
 * Pontua a semelhança entre duas identidades.
 *
 * Telefone e e-mail valem 2 pontos cada e o nome vale 1. Com o corte em 3
 * pontos, um match exige sempre dois sinais independentes (nome + contato, ou
 * telefone + e-mail) — nome igual sozinho nunca é suficiente, o que evita
 * fundir homônimos.
 */
export function pontuarIdentidades(a: ChaveIdentidadeCliente, b: ChaveIdentidadeCliente): number {
    let pontos = 0;

    if (a.telefone && a.telefone === b.telefone) pontos += PESO_TELEFONE;
    if (a.email && a.email === b.email) pontos += PESO_EMAIL;
    if (a.nome && a.nome === b.nome) pontos += PESO_NOME;

    return pontos;
}

export function identidadesCasam(a: ChaveIdentidadeCliente, b: ChaveIdentidadeCliente): boolean {
    return pontuarIdentidades(a, b) >= PONTUACAO_MINIMA_MATCH;
}
