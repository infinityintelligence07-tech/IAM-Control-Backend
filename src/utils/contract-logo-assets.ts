import * as fs from 'fs';
import * as path from 'path';
import { IAM_LOGO_PATH, LIBERTY_LOGO_PATH } from './contract-destination-profile';

/**
 * Resolve logos de marca (IAM/Liberty) como data URI embutida.
 * O PDF do Puppeteer usa waitUntil=domcontentloaded e não espera imagens
 * remotas — por isso logos via FRONTEND_URL costumam sumir no ZapSign.
 */
const LOGO_FILE_BY_PUBLIC_PATH: Record<string, string> = {
  [IAM_LOGO_PATH]: 'logo-iam.png',
  [LIBERTY_LOGO_PATH]: 'logo-liberty.png',
  // Fallbacks de nomes antigos / aliases.
  '/images/logo/logo-claro.png': 'logo-iam.png',
  '/images/logo/LOGO LIBERTY H OFICIAL.png': 'logo-liberty.png',
};

function candidatosDiretorioLogos(): string[] {
  return [
    // Compilado: nest copia src/assets/logos → dist/assets/logos
    path.join(__dirname, '..', 'assets', 'logos'),
    // Deploy / cwd na raiz do backend
    path.join(process.cwd(), 'dist', 'assets', 'logos'),
    path.join(process.cwd(), 'assets', 'logos'),
    path.join(process.cwd(), 'src', 'assets', 'logos'),
  ];
}

function mimePorExtensao(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

/**
 * Retorna data URI da logo local, ou null se o arquivo não existir.
 */
export function resolveContractLogoDataUri(
  publicPath?: string | null,
): string | null {
  if (!publicPath) return null;
  if (publicPath.startsWith('data:')) return publicPath;

  const fileName =
    LOGO_FILE_BY_PUBLIC_PATH[publicPath] || path.basename(publicPath);

  for (const dir of candidatosDiretorioLogos()) {
    const fullPath = path.join(dir, fileName);
    try {
      if (!fs.existsSync(fullPath)) continue;
      const buffer = fs.readFileSync(fullPath);
      if (!buffer.length) continue;
      return `data:${mimePorExtensao(fullPath)};base64,${buffer.toString('base64')}`;
    } catch {
      // tenta o próximo candidato
    }
  }

  return null;
}
