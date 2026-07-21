import { ESetores } from '../../modules/config/entities/enum';

/** Normaliza setor da API (string legada ou array) para ESetores[]. */
export function normalizeSetores(setor: unknown): ESetores[] {
    if (setor == null) return [];
    if (Array.isArray(setor)) {
        return setor.filter((s): s is ESetores => typeof s === 'string' && s.length > 0) as ESetores[];
    }
    if (typeof setor === 'string' && setor.length > 0) {
        return [setor as ESetores];
    }
    return [];
}

/** Verifica se o usuário pertence a um setor (suporta setor escalar legado ou array). */
export function userHasSetor(
    usuario: { setor?: ESetores | ESetores[] | string | string[] | null } | null | undefined,
    setor: ESetores | string,
): boolean {
    if (!usuario?.setor) return false;
    const setores = normalizeSetores(usuario.setor);
    return setores.includes(setor as ESetores) || setores.includes(String(setor) as ESetores);
}

/** Verifica se o usuário pertence a algum dos setores informados. */
export function userHasAnySetor(
    usuario: { setor?: ESetores | ESetores[] | string | string[] | null } | null | undefined,
    setores: Array<ESetores | string>,
): boolean {
    return setores.some((s) => userHasSetor(usuario, s));
}
