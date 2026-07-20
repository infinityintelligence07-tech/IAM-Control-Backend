/**
 * Importa o vault Obsidian "IAM Brain" direto no Postgres (sem HTTP).
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

async function uniqueSlug(repo: ReturnType<typeof ds.getRepository<DuvidasArtigos>>, base: string, ignoreId?: number) {
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
    let importados = 0;
    let atualizados = 0;
    let ignorados = 0;

    for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const rawPath = entry.entryName.replace(/\\/g, '/');
        if (shouldSkip(rawPath) || !rawPath.toLowerCase().endsWith('.md')) {
            ignorados++;
            continue;
        }

        const caminho = rawPath;
        const conteudo = entry.getData().toString('utf8');
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

    console.log({ importados, atualizados, ignorados });
    await ds.destroy();
}

main().catch(async (err) => {
    console.error(err);
    if (ds.isInitialized) await ds.destroy();
    process.exit(1);
});
