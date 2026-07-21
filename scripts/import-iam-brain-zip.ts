/**
 * Importa o vault Obsidian "IAM Brain" (Markdown + imagens) direto no Postgres.
 *
 * Uso:
 *   npx ts-node -r tsconfig-paths/register scripts/import-iam-brain-zip.ts [caminho-zip]
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip');
import { ds } from '../src/modules/config/database/typeORM.provider';
import { DuvidasArtigos } from '../src/modules/config/entities/duvidasArtigos.entity';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

function shouldSkip(p: string): boolean {
    const lower = p.toLowerCase();
    return (
        lower.includes('/.obsidian/') ||
        lower.startsWith('.obsidian/') ||
        lower.includes('/.trash/') ||
        lower.includes('__macosx/') ||
        lower.endsWith('.ds_store')
    );
}

function isImage(filePath: string): boolean {
    return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

function slugify(text: string): string {
    return (
        text
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 200) || 'artigo'
    );
}

function tituloFrom(caminho: string, conteudo: string): string {
    const h1 = conteudo.match(/^#\s+(.+)$/m);
    if (h1?.[1]?.trim()) return h1[1].trim().slice(0, 500);
    return (caminho.split('/').pop()?.replace(/\.md$/i, '') || 'Sem título').slice(0, 500);
}

function publicBase(): string {
    return (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

function salvarImagem(caminhoVault: string, data: Buffer): string {
    const safeRel = caminhoVault
        .replace(/^\/+/, '')
        .split('/')
        .map((p) => p.replace(/[<>:"|?*]/g, '_'))
        .join('/');
    const dest = path.join(process.cwd(), 'uploads', 'duvidas', safeRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
    const urlPath = safeRel
        .split('/')
        .map((p) => encodeURIComponent(p))
        .join('/');
    return `${publicBase()}/uploads/duvidas/${urlPath}`;
}

function resolveImageUrl(
    ref: string,
    mdPath: string,
    map: Map<string, string>,
): string | null {
    const cleaned = ref.trim().replace(/^<|>$/g, '').split('|')[0].trim();
    if (!cleaned) return null;
    if (/^https?:\/\//i.test(cleaned) || cleaned.startsWith('/uploads/')) return cleaned;

    const mdDir = path.posix.dirname(mdPath.replace(/\\/g, '/'));
    const candidates = [
        cleaned,
        path.posix.normalize(`${mdDir}/${cleaned}`),
        path.posix.basename(cleaned),
    ];
    for (const c of candidates) {
        const key = c.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
        const hit = map.get(key);
        if (hit) return hit;
    }
    return null;
}

function rewriteImages(conteudo: string, mdPath: string, map: Map<string, string>): string {
    let out = conteudo.replace(/!\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
        const url = resolveImageUrl(inner, mdPath, map);
        if (!url) return `![[${inner}]]`;
        const alt = path.basename(inner.split('|')[0].trim());
        return `![${alt}](${url})`;
    });
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => {
        const url = resolveImageUrl(src, mdPath, map);
        if (!url) return `![${alt}](${src})`;
        return `![${alt}](${url})`;
    });
    return out;
}

async function uniqueSlug(
    repo: ReturnType<typeof ds.getRepository<DuvidasArtigos>>,
    base: string,
    ignoreId?: number,
) {
    let slug = slugify(base);
    let n = 0;
    while (true) {
        const candidate = n === 0 ? slug : `${slug}-${n}`;
        const existing = await repo.findOne({ where: { slug: candidate } as any });
        if (!existing || existing.id === ignoreId) return candidate;
        n++;
    }
}

async function main() {
    const zipPath = path.resolve(
        process.argv[2] || path.join(__dirname, '../../docs/IAM-Brain-obsidian.zip'),
    );
    if (!fs.existsSync(zipPath)) {
        console.error('ZIP não encontrado:', zipPath);
        process.exit(1);
    }

    console.log('Conectando ao banco...');
    if (!ds.isInitialized) await ds.initialize();

    const repo = ds.getRepository(DuvidasArtigos);
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    let importados = 0;
    let atualizados = 0;
    let imagens = 0;
    let ignorados = 0;

    const imageUrlByPath = new Map<string, string>();

    for (const entry of entries) {
        if (entry.isDirectory) continue;
        const rawPath = entry.entryName.replace(/\\/g, '/');
        if (shouldSkip(rawPath) || !isImage(rawPath)) continue;
        const caminho = rawPath;
        const url = salvarImagem(caminho, entry.getData());
        imageUrlByPath.set(caminho.toLowerCase(), url);
        imageUrlByPath.set(path.basename(caminho).toLowerCase(), url);
        imagens++;
        console.log('imagem:', caminho);
    }

    for (const entry of entries) {
        if (entry.isDirectory) continue;
        const rawPath = entry.entryName.replace(/\\/g, '/');
        if (shouldSkip(rawPath)) {
            ignorados++;
            continue;
        }
        if (!rawPath.toLowerCase().endsWith('.md')) {
            if (!isImage(rawPath)) ignorados++;
            continue;
        }

        const caminho = rawPath;
        let conteudo = entry.getData().toString('utf8');
        conteudo = rewriteImages(conteudo, caminho, imageUrlByPath);
        const titulo = tituloFrom(caminho, conteudo);
        const existente = await repo.findOne({ where: { caminho_origem: caminho } as any });

        if (existente) {
            existente.titulo = titulo;
            existente.conteudo_md = conteudo;
            existente.status = 'publicado';
            await repo.save(existente);
            atualizados++;
            console.log('atualizado:', caminho);
        } else {
            const slug = await uniqueSlug(repo, caminho.replace(/\.md$/i, '') || titulo);
            await repo.save(
                repo.create({
                    titulo,
                    slug,
                    conteudo_md: conteudo,
                    caminho_origem: caminho,
                    status: 'publicado',
                    tags: null,
                }),
            );
            importados++;
            console.log('novo:', caminho);
        }
    }

    console.log({ importados, atualizados, imagens, ignorados });
    await ds.destroy();
}

main().catch(async (err) => {
    console.error(err);
    if (ds.isInitialized) await ds.destroy();
    process.exit(1);
});
