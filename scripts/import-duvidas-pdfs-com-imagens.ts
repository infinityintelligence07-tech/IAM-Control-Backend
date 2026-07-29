/**
 * Reimporta PDFs dos manuais com texto + screenshot por página.
 *
 * Uso:
 *   npx ts-node -r tsconfig-paths/register scripts/import-duvidas-pdfs-com-imagens.ts
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PDFParse } from 'pdf-parse';
import { ds } from '../src/modules/config/database/typeORM.provider';
import { DuvidasArtigos } from '../src/modules/config/entities/duvidasArtigos.entity';

const ASSETS = path.join(
    process.env.USERPROFILE || 'C:\\Users\\Usuario',
    'Desktop',
    'IAM Brain',
    '20 - IAM Control',
    'Manuais',
    '_assets',
);

const PDFS: Array<{ match: RegExp; titulo: string; tags: string[]; slugBase: string }> = [
    {
        match: /vendas.*masterclass|masterclass.*vendas/i,
        titulo: 'Manual de Uso — Vendas em Masterclass',
        tags: ['manual', 'vendas', 'masterclass', 'pdf'],
        slugBase: 'manual-vendas-masterclass',
    },
    {
        match: /credenciamento/i,
        titulo: 'Manual IAM Control — Credenciamento e cadastro na plataforma',
        tags: ['manual', 'credenciamento', 'masterclass', 'cadastro', 'login', 'pdf'],
        slugBase: 'manual-credenciamento-plataforma',
    },
];

function publicBase(): string {
    return (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

function buildMediaUrl(rel: string): string {
    return `${publicBase()}/api/duvidas-media?path=${encodeURIComponent(rel.replace(/\\/g, '/'))}`;
}

function salvarBuffer(relPath: string, data: Buffer): string {
    const dest = path.join(process.cwd(), 'uploads', 'duvidas', relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
    return buildMediaUrl(relPath.replace(/\\/g, '/'));
}

function toBuffer(data: unknown): Buffer | null {
    if (!data) return null;
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof Uint8Array) return Buffer.from(data);
    if (typeof data === 'string' && data.startsWith('data:')) {
        const b64 = data.split(',')[1];
        return b64 ? Buffer.from(b64, 'base64') : null;
    }
    return null;
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

async function uniqueSlug(
    repo: ReturnType<typeof ds.getRepository<DuvidasArtigos>>,
    base: string,
) {
    let slug = slugify(base);
    let n = 0;
    while (true) {
        const candidate = n === 0 ? slug : `${slug}-${n}`;
        const existing = await repo.findOne({ where: { slug: candidate } as any });
        if (!existing) return candidate;
        n++;
    }
}

async function importPdf(filePath: string, meta: (typeof PDFS)[number]) {
    const repo = ds.getRepository(DuvidasArtigos);
    const parser = new PDFParse({ data: fs.readFileSync(filePath) });
    try {
        const textResult = await parser.getText();
        const screenshots = await parser.getScreenshot({ scale: 1.25 });

        const pagesText: string[] = [];
        if (Array.isArray((textResult as any)?.pages)) {
            for (const page of (textResult as any).pages) {
                pagesText.push(String(page?.text || '').trim());
            }
        }
        if (pagesText.length === 0) {
            // fallback: split full text roughly by form feed if available
            const full = String(textResult?.text || '').trim();
            pagesText.push(full);
        }

        const shotPages = screenshots?.pages || [];
        const totalPages = Math.max(pagesText.length, shotPages.length, Number(textResult?.total || 0));
        const parts: string[] = [
            `# ${meta.titulo}`,
            '',
            `> Fonte: PDF importado com imagens por página (${path.basename(filePath)})`,
            '',
        ];

        let imagens = 0;
        for (let i = 0; i < totalPages; i++) {
            const pageNo = i + 1;
            const pageText = (pagesText[i] || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
            parts.push(`## Página ${pageNo}`);
            parts.push('');
            if (pageText) {
                parts.push(pageText);
                parts.push('');
            }

            const shot = shotPages.find((p: any) => Number(p.pageNumber) === pageNo) || shotPages[i];
            const buf = toBuffer(shot?.data) || toBuffer(shot?.dataUrl);
            if (buf && buf.length > 100) {
                const rel = path
                    .join('pdfs', meta.slugBase, `pagina-${String(pageNo).padStart(2, '0')}.png`)
                    .replace(/\\/g, '/');
                const url = salvarBuffer(rel, buf);
                parts.push(`![${meta.titulo} — página ${pageNo}](${url})`);
                parts.push('');
                imagens++;
            }
        }

        const caminho = `IAM Brain/20 - IAM Control/Manuais/_assets/${path.basename(filePath)}`;
        const conteudo = parts.join('\n').trim() + '\n';
        const existente = await repo.findOne({ where: { caminho_origem: caminho } as any });

        if (existente) {
            existente.titulo = meta.titulo;
            existente.conteudo_md = conteudo;
            existente.status = 'publicado';
            existente.tags = meta.tags;
            await repo.save(existente);
            console.log('atualizado:', meta.titulo, { pages: totalPages, imagens, chars: conteudo.length });
        } else {
            const slug = await uniqueSlug(repo, meta.slugBase);
            await repo.save(
                repo.create({
                    titulo: meta.titulo,
                    slug,
                    conteudo_md: conteudo,
                    caminho_origem: caminho,
                    status: 'publicado',
                    tags: meta.tags,
                }),
            );
            console.log('novo:', meta.titulo, { pages: totalPages, imagens, chars: conteudo.length });
        }
    } finally {
        await parser.destroy?.();
    }
}

async function main() {
    if (!fs.existsSync(ASSETS)) {
        console.error('Pasta não encontrada:', ASSETS);
        process.exit(1);
    }

    const pdfFiles = fs.readdirSync(ASSETS).filter((f) => f.toLowerCase().endsWith('.pdf'));
    console.log('PDFs encontrados:', pdfFiles);

    await ds.initialize();

    for (const meta of PDFS) {
        const fileName = pdfFiles.find((f) => meta.match.test(f));
        if (!fileName) {
            console.warn('PDF não encontrado para', meta.titulo);
            continue;
        }
        await importPdf(path.join(ASSETS, fileName), meta);
    }

    await ds.destroy();
}

main().catch(async (err) => {
    console.error(err);
    if (ds.isInitialized) await ds.destroy();
    process.exit(1);
});
