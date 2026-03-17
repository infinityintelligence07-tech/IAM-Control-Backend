import { Injectable, BadRequestException } from '@nestjs/common';
import * as sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';
import { Readable } from 'stream';
import { google } from 'googleapis';

/** Pasta "Alunos" no Drive: https://drive.google.com/drive/u/0/folders/1wF3z55eRG937fI3O5MXNNPP8nTUws3uD */
const DRIVE_FOLDER_ALUNOS_ID = '1wF3z55eRG937fI3O5MXNNPP8nTUws3uD';

@Injectable()
export class UploadService {
    private readonly uploadDir = path.join(process.cwd(), 'uploads', 'fotos');
    private driveFolderId: string | null = null;
    private driveClient: ReturnType<typeof google.drive> | null = null;

    constructor() {
        if (!fs.existsSync(this.uploadDir)) {
            fs.mkdirSync(this.uploadDir, { recursive: true });
        }
        this.initDrive();
    }

    private initDrive(): void {
        const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || DRIVE_FOLDER_ALUNOS_ID;
        if (!folderId) {
            console.warn('[UploadService] Drive desativado: GOOGLE_DRIVE_FOLDER_ID não definido');
            return;
        }

        // Opção 1: OAuth com refresh token do usuário (recomendado para conta pessoal sem Google Workspace)
        const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
        const oauthClientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID;
        const oauthClientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET;

        if (refreshToken && oauthClientId && oauthClientSecret) {
            try {
                const oauth2Client = new google.auth.OAuth2(oauthClientId, oauthClientSecret, 'urn:ietf:wg:oauth:2.0:oob');
                oauth2Client.setCredentials({ refresh_token: refreshToken });
                this.driveClient = google.drive({ version: 'v3', auth: oauth2Client });
                this.driveFolderId = folderId;
                console.log('[UploadService] Google Drive INICIALIZADO (OAuth). Pasta:', folderId);
                return;
            } catch (err) {
                console.error('[UploadService] Falha ao usar OAuth (refresh token):', err instanceof Error ? err.message : err);
            }
        }

        // Opção 2: Conta de serviço (pode dar 403 em contas pessoais por falta de cota da SA)
        const jsonFileName = 'responsive-cab-468017-d2-a53d5a4a7052.json';
        const possiblePaths = [
            process.env.GOOGLE_APPLICATION_CREDENTIALS,
            path.join(process.cwd(), jsonFileName),
            path.resolve(__dirname, '..', '..', '..', '..', jsonFileName),
        ].filter((p): p is string => Boolean(p));

        let credentialsPath: string | null = null;
        for (const p of possiblePaths) {
            if (p && fs.existsSync(p)) {
                credentialsPath = p;
                break;
            }
        }

        if (!credentialsPath) {
            console.warn('[UploadService] Google Drive DESATIVADO. Para ativar:');
            console.warn('[UploadService]   - OAuth (conta pessoal): defina GOOGLE_DRIVE_REFRESH_TOKEN, GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env');
            console.warn('[UploadService]   - Conta de serviço: coloque o JSON de credenciais em', path.join(process.cwd(), jsonFileName));
            return;
        }

        try {
            const GoogleAuth = google.auth.GoogleAuth;
            const auth = new GoogleAuth({
                keyFile: credentialsPath,
                scopes: ['https://www.googleapis.com/auth/drive'],
            });
            this.driveClient = google.drive({ version: 'v3', auth });
            this.driveFolderId = folderId;
            console.log('[UploadService] Google Drive INICIALIZADO (conta de serviço). Pasta:', folderId);
        } catch (err) {
            console.error('[UploadService] Falha ao inicializar Google Drive:', err instanceof Error ? err.message : err);
            this.driveClient = null;
            this.driveFolderId = null;
        }
    }

    async uploadFotoAluno(file: Express.Multer.File, alunoNome?: string): Promise<string> {
        if (!file) throw new BadRequestException('Arquivo não fornecido');

        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!allowedMimes.includes(file.mimetype)) {
            throw new BadRequestException('Formato de imagem inválido. Use JPEG, PNG, WEBP ou GIF.');
        }

        let processedBuffer: Buffer;
        try {
            processedBuffer = await sharp(file.buffer).resize(400, 400, { fit: 'cover', position: 'center' }).jpeg({ quality: 85 }).toBuffer();
        } catch {
            processedBuffer = file.buffer;
        }

        const fileName = `foto_aluno_${Date.now()}_${(alunoNome || 'aluno').replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;

        if (this.driveClient && this.driveFolderId) {
            try {
                const url = await this.uploadToDrive(processedBuffer, fileName);
                if (url) return url;
            } catch (err) {
                const msg =
                    err instanceof Error
                        ? err.message
                        : err && typeof (err as { message?: string }).message === 'string'
                          ? (err as { message: string }).message
                          : 'Erro desconhecido';
                const cause = err instanceof Error && err.cause ? (err.cause as Error)?.message : '';
                console.error('[UploadService] Erro ao enviar foto para o Drive:', msg, cause || '');
                const resData =
                    err && typeof (err as { response?: { data?: unknown } }).response?.data !== 'undefined'
                        ? (err as { response: { data: unknown } }).response.data
                        : null;
                if (resData) console.error('[UploadService] Resposta da API Google:', JSON.stringify(resData, null, 2));
                // Fallback para local em caso de erro no Drive
            }
        } else {
            console.warn('[UploadService] Drive não inicializado; salvando foto localmente em', this.uploadDir);
        }

        const filePath = path.join(this.uploadDir, fileName);
        fs.writeFileSync(filePath, processedBuffer);
        const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
        return `${baseUrl}/uploads/fotos/${fileName}`;
    }

    /**
     * Envia o arquivo para a pasta "Alunos" do Drive (Meu Drive > Fotos > Alunos).
     * A pasta deve estar compartilhada com a conta de serviço como Editor.
     * parents=[folderId] faz o arquivo ser criado na sua pasta (com cota), evitando 403.
     */
    private async uploadToDrive(buffer: Buffer, fileName: string): Promise<string> {
        if (!this.driveClient || !this.driveFolderId) return '';

        console.log('[UploadService] Enviando foto para o Drive, pasta:', this.driveFolderId);
        const res = await this.driveClient.files.create({
            requestBody: {
                name: fileName,
                parents: [this.driveFolderId],
            },
            media: {
                mimeType: 'image/jpeg',
                body: Readable.from(buffer),
            },
            fields: 'id, webViewLink',
            supportsAllDrives: true,
        });

        const id = res.data.id;
        if (!id) return '';
        const url = `https://drive.google.com/file/d/${id}/view`;
        console.log('[UploadService] Foto enviada para o Google Drive:', url);
        return url;
    }
}
