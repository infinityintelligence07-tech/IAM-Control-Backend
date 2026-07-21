/**
 * Helpers de nome de aluno:
 * - Nomes de alunos são SEMPRE persistidos em caixa alta em todo o sistema.
 * - Buscas por nome desconsideram acentos e caracteres especiais.
 */

const SOURCE_ACCENTS = 'áàâãäéèêëíìîïóòôõöúùûüçñýÿ';
const TARGET_ACCENTS = 'aaaaaeeeeiiiiooooouuuucnyy';

/** Normaliza o nome do aluno para persistência: trim, colapsa espaços e converte para caixa alta. */
export function nomeAlunoCaixaAlta(nome: string): string;
export function nomeAlunoCaixaAlta(nome?: string | null): string | null;
export function nomeAlunoCaixaAlta(nome?: string | null): string | null {
    if (nome == null) return null;
    const limpo = String(nome).trim().replace(/\s+/g, ' ');
    if (!limpo) return limpo;
    return limpo.toUpperCase();
}

/** Normaliza um termo de busca: remove acentos e caracteres especiais, minúsculas. */
export function normalizarTermoBusca(valor?: string | null): string {
    return String(valor ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/**
 * Expressão SQL (PostgreSQL) que normaliza uma coluna texto da mesma forma que
 * normalizarTermoBusca: sem acentos, sem caracteres especiais, minúsculas.
 * Mesmo padrão usado na busca de usuários (não depende da extensão unaccent).
 */
export function sqlBuscaNormalizada(coluna: string): string {
    return `regexp_replace(translate(lower(${coluna}), '${SOURCE_ACCENTS}', '${TARGET_ACCENTS}'), '[^a-z0-9]', '', 'g')`;
}
