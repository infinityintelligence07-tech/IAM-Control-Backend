/**
 * Seed / reimport da base da Central de Dúvidas a partir de um ZIP Obsidian.
 *
 * Uso (com backend rodando e token de admin):
 *   $env:DUVIDAS_SEED_TOKEN="seu_jwt"
 *   $env:DUVIDAS_SEED_API="http://localhost:3000/api"
 *   node -r ts-node/register -r tsconfig-paths/register scripts/seed-duvidas-obsidian.ts [caminho-zip]
 *
 * Default do zip: ../docs/obsidian-seed-central-duvidas.zip (raiz do monorepo)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
    const zipPath = path.resolve(
        process.argv[2] ||
            path.join(__dirname, '../../docs/obsidian-seed-central-duvidas.zip'),
    );
    const apiBase = process.env.DUVIDAS_SEED_API || 'http://localhost:3000/api';
    const token = process.env.DUVIDAS_SEED_TOKEN;

    if (!fs.existsSync(zipPath)) {
        console.error(`ZIP não encontrado: ${zipPath}`);
        process.exit(1);
    }
    if (!token) {
        console.error('Defina DUVIDAS_SEED_TOKEN com um JWT de administrador.');
        process.exit(1);
    }

    const buffer = fs.readFileSync(zipPath);
    const form = new FormData();
    form.append('file', new Blob([buffer]), path.basename(zipPath));

    const res = await fetch(`${apiBase}/duvidas/import/obsidian`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        console.error('Falha no import:', res.status, body);
        process.exit(1);
    }

    console.log('Import OK:', body);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
