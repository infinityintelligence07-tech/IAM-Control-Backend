import { Injectable, BadRequestException } from '@nestjs/common';
import * as sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';
import { Readable } from 'stream';
import { google } from 'googleapis';
import * as XLSX from 'xlsx';
import { ILike, In } from 'typeorm';
import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { EOrigemAlunos, EStatusAlunosTurmas } from '@/modules/config/entities/enum';

/** Pasta "Alunos" no Drive: https://drive.google.com/drive/u/0/folders/1wF3z55eRG937fI3O5MXNNPP8nTUws3uD */
const DRIVE_FOLDER_ALUNOS_ID = '1wF3z55eRG937fI3O5MXNNPP8nTUws3uD';

type ImportActionType = 'CRIAR' | 'ATUALIZAR' | 'IGNORAR';

interface ImportPreviewItem {
    linha: number;
    nome_cracha: string;
    email: string;
    telefone: string;
    email_gerado_automaticamente: boolean;
    acao: ImportActionType;
    turma_destino_id: number;
    status_planilha: string;
    status_final: EStatusAlunosTurmas;
    origem_final: EOrigemAlunos;
}

export interface ImportarAlunosPlanilhaResponse {
    message: string;
    total_linhas: number;
    total_processadas: number;
    total_criadas: number;
    total_atualizadas: number;
    total_erros: number;
    total_sem_turma: number;
    erros: string[];
    avisos: string[];
    exige_confirmacao: boolean;
    confirmado: boolean;
    preview: ImportPreviewItem[];
    tempo_total_ms: number;
    lotes_executados: number;
    lotes_detalhe: {
        alunos_criados: number;
        vinculos_atualizados: number;
        vinculos_criados: number;
    };
}

@Injectable()
export class UploadService {
    private readonly uploadDir = path.join(process.cwd(), 'uploads', 'fotos');
    private driveFolderId: string | null = null;
    private driveClient: ReturnType<typeof google.drive> | null = null;

    constructor(private readonly uow: UnitOfWorkService) {
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

    async importarAlunosPlanilha(idTurmaSelecionada: number, file: Express.Multer.File, confirmar = false): Promise<ImportarAlunosPlanilhaResponse> {
        const startedAt = Date.now();
        const alunosChunkSize = 300;
        const vinculosChunkSize = 250;
        let lotesAlunosCriados = 0;
        let lotesVinculosAtualizados = 0;
        let lotesVinculosCriados = 0;

        if (!file?.buffer) {
            throw new BadRequestException('Arquivo inválido');
        }

        const allowed = ['.xls', '.xlsx'];
        const ext = path.extname(file.originalname || '').toLowerCase();
        if (!allowed.includes(ext)) {
            throw new BadRequestException('Formato inválido. Envie um arquivo .xls ou .xlsx');
        }

        const turmaSelecionada = await this.uow.turmasRP.findOne({
            where: { id: idTurmaSelecionada, deletado_em: null },
            relations: ['id_treinamento_fk'],
        });

        if (!turmaSelecionada) {
            throw new BadRequestException(`Turma ${idTurmaSelecionada} não encontrada`);
        }

        const turmaSemTurma = await this.uow.turmasRP.findOne({
            where: {
                id_treinamento: turmaSelecionada.id_treinamento,
                edicao_turma: ILike('SEM_TURMA'),
                deletado_em: null,
            },
        });

        if (!turmaSemTurma) {
            throw new BadRequestException(
                `Não foi encontrada edição SEM_TURMA para o treinamento ${turmaSelecionada.id_treinamento}. Cadastre a turma SEM_TURMA antes de importar.`,
            );
        }

        const rows = this.parseXlsxRows(file.buffer);
        const parsed = this.parseSpreadsheetRows(rows);
        const origemTurmaMap = await this.buildTurmaCodigoMap();

        let totalCriadas = 0;
        let totalAtualizadas = 0;
        let totalSemTurma = 0;
        const erros: string[] = [];
        const avisos: string[] = [];
        const preview: ImportPreviewItem[] = [];
        const occurrenceByPessoa = new Map<string, number>();

        const candidates: Array<{
            linha: number;
            nomeOriginal: string;
            nomeCracha: string;
            email: string;
            emailGeradoAutomaticamente: boolean;
            telefone: string;
            turmaDestinoId: number;
            statusPlanilha: string;
            statusFinal: EStatusAlunosTurmas;
            origemFinal: EOrigemAlunos;
            idTurmaTransferenciaDe: number | null;
        }> = [];

        for (const row of parsed) {
            const telefoneNormalizado = this.normalizePhone(row.telefone);
            const nomeNormalizado = this.normalizeText(row.nome);
            const emailNormalizadoRaw = this.normalizeEmail(row.email);
            const emailNormalizado = emailNormalizadoRaw || this.buildFallbackEmail(row.nome || '', telefoneNormalizado);
            const emailGeradoAutomaticamente = !emailNormalizadoRaw;

            if (!nomeNormalizado || !telefoneNormalizado) {
                erros.push(
                    `Linha ${row.linha}: dados obrigatórios incompletos (nome/telefone). Nome="${row.nome}", Email="${row.email}", Telefone="${row.telefone}"`,
                );
                preview.push({
                    linha: row.linha,
                    nome_cracha: row.nome || '',
                    email: emailNormalizado,
                    telefone: telefoneNormalizado,
                    email_gerado_automaticamente: emailGeradoAutomaticamente,
                    acao: 'IGNORAR',
                    turma_destino_id: idTurmaSelecionada,
                    status_planilha: row.status || '',
                    status_final: EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO,
                    origem_final: EOrigemAlunos.COMPROU_INGRESSO,
                });
                continue;
            }

            const dedupeKey = `${nomeNormalizado}|${emailNormalizado}|${telefoneNormalizado}`;
            const nextOccurrence = (occurrenceByPessoa.get(dedupeKey) || 0) + 1;
            occurrenceByPessoa.set(dedupeKey, nextOccurrence);

            const nomeCracha = nextOccurrence === 1 ? row.nome.trim() : `${row.nome.trim()} ${nextOccurrence}`;
            const statusNormalizado = this.normalizeText(row.status);
            const obsNormalizada = this.normalizeText(row.obs);
            const statusAlunoTurma = this.mapStatusToAlunoTurma(statusNormalizado);
            const enviarParaSemTurma = statusNormalizado.includes('EXCLUIR') || statusNormalizado.includes('CANCELADO');
            const idTurmaDestino = enviarParaSemTurma ? turmaSemTurma.id : turmaSelecionada.id;

            if (enviarParaSemTurma) {
                totalSemTurma++;
            }

            const codigoTurmaOrigem = this.extractCodigoTurmaOrigem(row.obs);
            const isBonus = obsNormalizada.includes('BONUS');
            const origemAluno = this.mapOrigemAluno({
                isBonus,
                codigoTurmaOrigem,
                occurrence: nextOccurrence,
            });

            let idTurmaTransferenciaDe: number | null = null;
            if (codigoTurmaOrigem) {
                idTurmaTransferenciaDe = origemTurmaMap.get(codigoTurmaOrigem) || null;
                if (!idTurmaTransferenciaDe) {
                    avisos.push(`Linha ${row.linha}: código de turma de origem "${codigoTurmaOrigem}" não encontrado no cadastro.`);
                }
            }

            candidates.push({
                linha: row.linha,
                nomeOriginal: row.nome.trim(),
                nomeCracha,
                email: emailNormalizado,
                emailGeradoAutomaticamente,
                telefone: telefoneNormalizado,
                turmaDestinoId: idTurmaDestino,
                statusPlanilha: row.status || '',
                statusFinal: statusAlunoTurma,
                origemFinal: origemAluno,
                idTurmaTransferenciaDe,
            });
        }

        const emailsUnicos = Array.from(new Set(candidates.map((c) => c.email)));
        const alunosExistentes = emailsUnicos.length
            ? await this.uow.alunosRP.find({
                  where: { email: In(emailsUnicos) },
              })
            : [];
        const alunoByEmail = new Map(alunosExistentes.map((aluno) => [aluno.email, aluno]));

        if (confirmar) {
            const emailsFaltantes = emailsUnicos.filter((email) => !alunoByEmail.has(email));
            if (emailsFaltantes.length > 0) {
                const novosAlunos = emailsFaltantes
                    .map((email) => {
                        const base = candidates.find((c) => c.email === email);
                        if (!base) return null;
                        return this.uow.alunosRP.create({
                            nome: base.nomeOriginal || 'Aluno',
                            nome_cracha: base.nomeOriginal || 'Aluno',
                            email,
                            telefone_um: base.telefone || '00000000000',
                            possui_deficiencia: false,
                        });
                    })
                    .filter((a): a is NonNullable<typeof a> => Boolean(a));

                if (novosAlunos.length > 0) {
                    await this.uow.alunosRP.save(novosAlunos, { chunk: alunosChunkSize });
                    lotesAlunosCriados += Math.ceil(novosAlunos.length / alunosChunkSize);
                }
            }

            const alunosRecarregados = emailsUnicos.length
                ? await this.uow.alunosRP.find({
                      where: { email: In(emailsUnicos) },
                  })
                : [];
            for (const aluno of alunosRecarregados) {
                alunoByEmail.set(aluno.email, aluno);
            }
        }

        const idsAlunosExistentes = Array.from(new Set(Array.from(alunoByEmail.values()).map((aluno) => String(aluno.id))));
        const vinculosExistentes =
            idsAlunosExistentes.length > 0
                ? await this.uow.turmasAlunosRP.find({
                      where: {
                          id_turma: In([turmaSelecionada.id, turmaSemTurma.id]),
                          id_aluno: In(idsAlunosExistentes),
                          deletado_em: null,
                      },
                  })
                : [];

        const vinculoByKey = new Map<string, (typeof vinculosExistentes)[number]>(
            vinculosExistentes.map((v) => [`${v.id_turma}|${v.id_aluno}|${v.nome_cracha}`, v]),
        );
        const runtimeVinculoKeys = new Set(vinculosExistentes.map((v) => `${v.id_turma}|${v.id_aluno}|${v.nome_cracha}`));

        const numerosCrachaExistentes = await this.uow.turmasAlunosRP.find({
            where: {
                id_turma: In([turmaSelecionada.id, turmaSemTurma.id]),
                deletado_em: null,
            },
            select: ['id_turma', 'numero_cracha'],
        });
        const crachaSetByTurma = new Map<number, Set<string>>();
        for (const row of numerosCrachaExistentes) {
            const keyTurma = row.id_turma;
            if (!crachaSetByTurma.has(keyTurma)) crachaSetByTurma.set(keyTurma, new Set());
            crachaSetByTurma.get(keyTurma)?.add(row.numero_cracha);
        }

        const updatesToSave: typeof vinculosExistentes = [];
        const createsToSave: Array<{
            id_turma: number;
            id_aluno: string;
            nome_cracha: string;
            numero_cracha: string;
            origem_aluno: EOrigemAlunos;
            status_aluno_turma: EStatusAlunosTurmas;
            vaga_bonus: boolean;
            id_turma_transferencia_de: number | null;
        }> = [];

        for (const item of candidates) {
            try {
                const aluno = alunoByEmail.get(item.email) || null;

                const alunoId = aluno ? String(aluno.id) : '';
                const vinculoKey = `${item.turmaDestinoId}|${alunoId}|${item.nomeCracha}`;
                const existeVinculo = Boolean(aluno && runtimeVinculoKeys.has(vinculoKey));
                const vinculoPersistido = aluno ? vinculoByKey.get(vinculoKey) : undefined;

                if (existeVinculo) {
                    if (confirmar && vinculoPersistido) {
                        vinculoPersistido.status_aluno_turma = item.statusFinal;
                        vinculoPersistido.origem_aluno = item.origemFinal;
                        vinculoPersistido.id_turma_transferencia_de = item.idTurmaTransferenciaDe;
                        updatesToSave.push(vinculoPersistido);
                    }
                    totalAtualizadas++;
                    preview.push({
                        linha: item.linha,
                        nome_cracha: item.nomeCracha,
                        email: item.email,
                        telefone: item.telefone,
                        email_gerado_automaticamente: item.emailGeradoAutomaticamente,
                        acao: 'ATUALIZAR',
                        turma_destino_id: item.turmaDestinoId,
                        status_planilha: item.statusPlanilha,
                        status_final: item.statusFinal,
                        origem_final: item.origemFinal,
                    });
                    continue;
                }

                if (!aluno && !confirmar) {
                    totalCriadas++;
                    preview.push({
                        linha: item.linha,
                        nome_cracha: item.nomeCracha,
                        email: item.email,
                        telefone: item.telefone,
                        email_gerado_automaticamente: item.emailGeradoAutomaticamente,
                        acao: 'CRIAR',
                        turma_destino_id: item.turmaDestinoId,
                        status_planilha: item.statusPlanilha,
                        status_final: item.statusFinal,
                        origem_final: item.origemFinal,
                    });
                    continue;
                }

                if (!aluno) {
                    throw new Error('Não foi possível criar/alocar o aluno para importação');
                }

                if (confirmar) {
                    if (!crachaSetByTurma.has(item.turmaDestinoId)) {
                        crachaSetByTurma.set(item.turmaDestinoId, new Set());
                    }
                    const numeroCracha = this.generateCrachaNumberFromSet(crachaSetByTurma.get(item.turmaDestinoId)!);
                    createsToSave.push({
                        id_turma: item.turmaDestinoId,
                        id_aluno: String(aluno.id),
                        nome_cracha: item.nomeCracha,
                        numero_cracha: numeroCracha,
                        origem_aluno: item.origemFinal,
                        status_aluno_turma: item.statusFinal,
                        vaga_bonus: false,
                        id_turma_transferencia_de: item.idTurmaTransferenciaDe,
                    });
                }

                runtimeVinculoKeys.add(`${item.turmaDestinoId}|${aluno.id}|${item.nomeCracha}`);
                totalCriadas++;
                preview.push({
                    linha: item.linha,
                    nome_cracha: item.nomeCracha,
                    email: item.email,
                    telefone: item.telefone,
                    email_gerado_automaticamente: item.emailGeradoAutomaticamente,
                    acao: 'CRIAR',
                    turma_destino_id: item.turmaDestinoId,
                    status_planilha: item.statusPlanilha,
                    status_final: item.statusFinal,
                    origem_final: item.origemFinal,
                });
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Erro desconhecido';
                erros.push(`Linha ${item.linha}: ${msg}`);
                preview.push({
                    linha: item.linha,
                    nome_cracha: item.nomeCracha,
                    email: item.email,
                    telefone: item.telefone,
                    email_gerado_automaticamente: item.emailGeradoAutomaticamente,
                    acao: 'IGNORAR',
                    turma_destino_id: item.turmaDestinoId,
                    status_planilha: item.statusPlanilha,
                    status_final: item.statusFinal,
                    origem_final: item.origemFinal,
                });
            }
        }

        if (confirmar) {
            if (updatesToSave.length > 0) {
                await this.uow.turmasAlunosRP.save(updatesToSave, { chunk: vinculosChunkSize });
                lotesVinculosAtualizados += Math.ceil(updatesToSave.length / vinculosChunkSize);
            }
            if (createsToSave.length > 0) {
                const entities = createsToSave.map((data) => this.uow.turmasAlunosRP.create(data));
                await this.uow.turmasAlunosRP.save(entities, { chunk: vinculosChunkSize });
                lotesVinculosCriados += Math.ceil(entities.length / vinculosChunkSize);
            }
        }

        const totalProcessadas = totalCriadas + totalAtualizadas;
        const previewLimit = preview.slice(0, 120);
        const tituloModo = confirmar ? 'Importação concluída' : 'Pré-visualização concluída';
        const acaoFinal = confirmar ? 'processado(s)' : 'pronto(s) para processamento';

        return {
            message: `${tituloModo}. ${totalProcessadas} vínculo(s) ${acaoFinal}, ${totalSemTurma} enviado(s) para SEM_TURMA.`,
            total_linhas: parsed.length,
            total_processadas: totalProcessadas,
            total_criadas: totalCriadas,
            total_atualizadas: totalAtualizadas,
            total_erros: erros.length,
            total_sem_turma: totalSemTurma,
            erros,
            avisos,
            exige_confirmacao: !confirmar,
            confirmado: confirmar,
            preview: previewLimit,
            tempo_total_ms: Date.now() - startedAt,
            lotes_executados: lotesAlunosCriados + lotesVinculosAtualizados + lotesVinculosCriados,
            lotes_detalhe: {
                alunos_criados: lotesAlunosCriados,
                vinculos_atualizados: lotesVinculosAtualizados,
                vinculos_criados: lotesVinculosCriados,
            },
        };
    }

    private parseXlsxRows(buffer: Buffer): any[][] {
        const workbook = XLSX.read(buffer, {
            type: 'buffer',
            cellDates: true,
            raw: false,
        });

        if (!workbook.SheetNames.length) {
            throw new BadRequestException('Planilha sem abas');
        }

        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        return XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];
    }

    private parseSpreadsheetRows(rows: any[][]): Array<{ linha: number; nome: string; email: string; telefone: string; obs: string; status: string }> {
        if (rows.length < 2) {
            throw new BadRequestException('A planilha precisa conter cabeçalho e dados');
        }

        const headerIndex = this.findHeaderIndex(rows);
        const dataStart = headerIndex + 1;
        const headerRow = rows[headerIndex] || [];
        const hasStatusH = this.isStatusHeader(headerRow[7]);
        const hasStatusI = this.isStatusHeader(headerRow[8]);
        const parsed: Array<{ linha: number; nome: string; email: string; telefone: string; obs: string; status: string }> = [];

        for (let i = dataStart; i < rows.length; i++) {
            const row = rows[i] || [];
            const nome = String(row[1] ?? '').trim();
            const email = String(row[4] ?? '').trim();
            const telefone = String(row[5] ?? '').trim();
            const obs = String(row[6] ?? '').trim();
            const statusH = String(row[7] ?? '').trim();
            const statusI = String(row[8] ?? '').trim();

            if (!nome && !email && !telefone && !obs && !statusH && !statusI) {
                continue;
            }

            const status = this.chooseStatus(statusH, statusI, hasStatusH, hasStatusI);
            parsed.push({
                linha: i + 1,
                nome,
                email,
                telefone,
                obs,
                status,
            });
        }

        return parsed;
    }

    private findHeaderIndex(rows: any[][]): number {
        const maxScan = Math.min(rows.length, 10);
        for (let i = 0; i < maxScan; i++) {
            const row = rows[i] || [];
            const joined = this.normalizeText(row.map((v) => String(v ?? '')).join(' '));
            if (joined.includes('PARCEIRO') && joined.includes('E-MAIL') && joined.includes('TELEFONE')) {
                return i;
            }
        }
        return 1;
    }

    private chooseStatus(statusH: string, statusI: string, hasStatusH: boolean, hasStatusI: boolean): string {
        const h = this.normalizeText(statusH);
        const i = this.normalizeText(statusI);
        const known = ['CONFIRMADO', 'CONFIRMACAO', 'EXCLUIR', 'CANCELADO'];

        if (hasStatusI && known.some((k) => i.includes(k))) return statusI;
        if (hasStatusH && known.some((k) => h.includes(k))) return statusH;

        if (hasStatusI && statusI) return statusI;
        if (hasStatusH && statusH) return statusH;

        return '';
    }

    private isStatusHeader(value: unknown): boolean {
        const normalized = this.normalizeText(String(value || ''));
        return normalized.includes('STATUS');
    }

    private normalizeText(value: string): string {
        return (value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    private normalizeEmail(value: string): string {
        const raw = (value || '').trim().toLowerCase();
        const matched = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
        if (matched?.[0]) {
            return matched[0].toLowerCase().trim();
        }

        let cleaned = raw
            .replace(/e-?mail\s*:/gi, '')
            .replace(/\s+/g, '')
            .replace(/[<>'"()[\]]/g, '')
            .replace(/[-:;.,]+$/g, '');

        if (!cleaned.includes('@')) {
            return '';
        }

        return cleaned;
    }

    private generateCrachaNumberFromSet(used: Set<string>): string {
        const maxTentativas = 400;
        let tentativas = 0;

        while (tentativas < maxTentativas) {
            const numeroAleatorio = Math.floor(Math.random() * 100000);
            const numeroCracha = numeroAleatorio.toString().padStart(5, '0');
            if (!used.has(numeroCracha)) {
                used.add(numeroCracha);
                return numeroCracha;
            }
            tentativas++;
        }

        throw new Error('Não foi possível gerar número de crachá único em lote');
    }

    private buildFallbackEmail(nome: string, telefone: string): string {
        const nomeToken = this.normalizeText(nome).replace(/[^A-Z0-9]/g, '').toLowerCase().slice(0, 12) || 'aluno';
        const telToken = (telefone || '').replace(/\D/g, '').slice(-11) || '00000000000';
        return `sememail+${nomeToken}${telToken}@sememail.com`;
    }

    private normalizePhone(value: string): string {
        return (value || '').replace(/\D/g, '');
    }

    private mapStatusToAlunoTurma(statusNormalizado: string): EStatusAlunosTurmas {
        if (statusNormalizado.includes('CANCELADO') || statusNormalizado.includes('EXCLUIR')) {
            return EStatusAlunosTurmas.CANCELADO;
        }

        if (statusNormalizado.includes('CONFIRMADO') || statusNormalizado.includes('CONFIRMACAO')) {
            return EStatusAlunosTurmas.AGUARDANDO_CHECKIN;
        }

        return EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO;
    }

    private extractCodigoTurmaOrigem(obs: string): string | null {
        const original = (obs || '').trim().toUpperCase();
        if (!original) return null;
        const match = original.match(/\b([A-Z]{2,}_[A-Z0-9]{2,}_[0-9]{1,4})\b/);
        return match ? match[1] : null;
    }

    private mapOrigemAluno(params: { isBonus: boolean; codigoTurmaOrigem: string | null; occurrence: number }): EOrigemAlunos {
        if (params.codigoTurmaOrigem) {
            return EOrigemAlunos.TRANSFERENCIA;
        }

        if (params.isBonus) {
            return params.occurrence === 1 ? EOrigemAlunos.COMPROU_INGRESSO : EOrigemAlunos.ALUNO_BONUS;
        }

        return EOrigemAlunos.COMPROU_INGRESSO;
    }

    private async findAlunoByEmail(email: string) {
        if (!email) return null;
        return this.uow.alunosRP.findOne({
            where: { email },
        });
    }

    private async findOrCreateAluno(params: { nome: string; email: string; telefone: string }) {
        let aluno = await this.uow.alunosRP.findOne({
            where: { email: params.email },
        });

        if (aluno) {
            if (aluno.deletado_em) {
                aluno.deletado_em = null;
            }
            aluno.nome = params.nome || aluno.nome;
            aluno.telefone_um = params.telefone || aluno.telefone_um;
            aluno = await this.uow.alunosRP.save(aluno);
            return aluno;
        }

        try {
            const novo = this.uow.alunosRP.create({
                nome: params.nome,
                nome_cracha: params.nome,
                email: params.email,
                telefone_um: params.telefone,
                possui_deficiencia: false,
            });
            return await this.uow.alunosRP.save(novo);
        } catch (error) {
            const again = await this.uow.alunosRP.findOne({
                where: { email: params.email },
            });
            if (again) return again;
            throw error;
        }
    }

    private async buildTurmaCodigoMap(): Promise<Map<string, number>> {
        const turmas = await this.uow.turmasRP.find({
            where: { deletado_em: null },
            relations: ['id_treinamento_fk', 'id_polo_fk'],
        });

        const map = new Map<string, number>();
        for (const turma of turmas) {
            const siglaTreinamento = (turma.id_treinamento_fk?.sigla_treinamento || '').toUpperCase().trim();
            const siglaPolo = (turma.id_polo_fk?.sigla_polo || '').toUpperCase().trim();
            const edicao = (turma.edicao_turma || '').toUpperCase().trim();

            if (!siglaTreinamento || !siglaPolo || !edicao) continue;
            const codigo = `${siglaTreinamento}_${siglaPolo}_${edicao}`;
            map.set(codigo, turma.id);
        }

        return map;
    }

    private async generateUniqueCrachaNumber(id_turma: number): Promise<string> {
        const maxTentativas = 100;
        let tentativas = 0;

        while (tentativas < maxTentativas) {
            const numeroAleatorio = Math.floor(Math.random() * 100000);
            const numeroCracha = numeroAleatorio.toString().padStart(5, '0');

            const existeNaTurma = await this.uow.turmasAlunosRP.findOne({
                where: {
                    id_turma,
                    numero_cracha: numeroCracha,
                    deletado_em: null,
                },
            });

            if (!existeNaTurma) {
                return numeroCracha;
            }

            tentativas++;
        }

        throw new Error('Não foi possível gerar um número de crachá único para esta turma');
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
