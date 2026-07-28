/**
 * Extrai texto dos PDFs dos manuais e importa como artigos na Central de Dúvidas.
 *
 * Uso:
 *   npx ts-node -r tsconfig-paths/register scripts/import-duvidas-pdfs.ts
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PDFParse } from 'pdf-parse';
import { ds } from '../src/modules/config/database/typeORM.provider';
import { DuvidasArtigos } from '../src/modules/config/entities/duvidasArtigos.entity';

const ASSETS = path.join(
    'C:',
    'Users',
    'Usuario',
    'Desktop',
    'IAM Brain',
    '20 - IAM Control',
    'Manuais',
    '_assets',
);

const PDFS: Array<{ file: string; titulo: string; tags: string[] }> = [
    {
        file: path.join(ASSETS, 'Manual de Uso \u2014 Vendas em Masterclass.pdf'),
        titulo: 'Manual de Uso — Vendas em Masterclass',
        tags: ['manual', 'vendas', 'masterclass'],
    },
    {
        file: path.join(ASSETS, 'Manual_IAM_Control_Credenciamento.pdf'),
        titulo: 'Manual IAM Control — Credenciamento e cadastro na plataforma',
        tags: ['manual', 'credenciamento', 'masterclass', 'cadastro', 'login'],
    },
];

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

function limparTextoPdf(raw: string): string {
    return raw
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function extractPdfText(buffer: Buffer): Promise<{ text: string; pages: number }> {
    const parser = new PDFParse({ data: buffer });
    try {
        const result = await parser.getText();
        return {
            text: limparTextoPdf(String(result?.text || '')),
            pages: Number(result?.total || 0),
        };
    } finally {
        await parser.destroy?.();
    }
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
    console.log('Conectando ao banco...');
    if (!ds.isInitialized) await ds.initialize();
    const repo = ds.getRepository(DuvidasArtigos);

    let importados = 0;
    let atualizados = 0;

    for (const item of PDFS) {
        if (!fs.existsSync(item.file)) {
            console.error('PDF não encontrado:', item.file);
            continue;
        }

        const buffer = fs.readFileSync(item.file);
        const { text, pages } = await extractPdfText(buffer);
        if (!text || text.length < 40) {
            console.warn('Texto insuficiente em', item.file, '(páginas:', pages, ')');
            continue;
        }

        const caminho =
            'IAM Brain/20 - IAM Control/Manuais/_assets/' + path.basename(item.file);
        const conteudo = `# ${item.titulo}\n\n> Fonte: PDF importado (${path.basename(item.file)})\n\n${text}\n`;

        const existente = await repo.findOne({ where: { caminho_origem: caminho } as any });
        if (existente) {
            existente.titulo = item.titulo;
            existente.conteudo_md = conteudo;
            existente.status = 'publicado';
            existente.tags = item.tags;
            await repo.save(existente);
            atualizados++;
            console.log('atualizado:', item.titulo, `(${text.length} chars, ${pages} págs)`);
        } else {
            const slug = await uniqueSlug(repo, caminho.replace(/\.pdf$/i, '') || item.titulo);
            await repo.save(
                repo.create({
                    titulo: item.titulo,
                    slug,
                    conteudo_md: conteudo,
                    caminho_origem: caminho,
                    status: 'publicado',
                    tags: item.tags,
                }),
            );
            importados++;
            console.log('novo:', item.titulo, `(${text.length} chars, ${pages} págs)`);
        }
    }

    console.log({ importados, atualizados });
    await ds.destroy();
}

main().catch(async (err) => {
    console.error(err);
    if (ds.isInitialized) await ds.destroy();
    process.exit(1);
});
