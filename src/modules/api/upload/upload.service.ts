import { Injectable, BadRequestException } from '@nestjs/common';
import * as sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';
import { Readable } from 'stream';
import { google } from 'googleapis';
import * as XLSX from 'xlsx';
import { ILike, In } from 'typeorm';
import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { EOrigemAlunos, EStatusAlunosTurmas, ETipoVinculoAluno } from '@/modules/config/entities/enum';

/** Pasta "Alunos" no Drive: https://drive.google.com/drive/u/0/folders/1wF3z55eRG937fI3O5MXNNPP8nTUws3uD */
const DRIVE_FOLDER_ALUNOS_ID = '1wF3z55eRG937fI3O5MXNNPP8nTUws3uD';

type ImportActionType = 'CRIAR' | 'ATUALIZAR' | 'IGNORAR';

interface ImportPreviewItem {
    linha: number;
    nome_cracha: string;
    nome?: string;
    cpf_cnpj?: string;
    email: string;
    telefone: string;
    turma_origem_codigo?: string;
    turma_origem_descricao?: string;
    turma_destino_codigo?: string;
    email_gerado_automaticamente: boolean;
    acao: ImportActionType;
    turma_destino_id: number;
    quantidade_bonus?: number;
    quantidade_bonus_extra_por_pessoa?: number;
    data_inclusao?: string;
    turma_bonus_codigo?: string;
    tipo_linha?: 'PRINCIPAL' | 'BONUS_INSCRICAO' | 'BONUS_EXTRA';
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
        const turmaJuridico = await this.uow.turmasRP.findOne({
            where: {
                id_treinamento: turmaSelecionada.id_treinamento,
                edicao_turma: ILike('JURIDICO'),
                deletado_em: null,
            },
        });
        const turmaInadimplente = await this.uow.turmasRP.findOne({
            where: {
                id_treinamento: turmaSelecionada.id_treinamento,
                edicao_turma: ILike('INADIMPLENTE'),
                deletado_em: null,
            },
        });

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
        const bonusIndexByTitularKey = new Map<string, number>();

        const candidates: Array<{
            linha: number;
            nomeOriginal: string;
            nomeCracha: string;
            email: string;
            titularEmail: string;
            emailGeradoAutomaticamente: boolean;
            telefone: string;
            turmaDestinoId: number;
            statusPlanilha: string;
            statusFinal: EStatusAlunosTurmas;
            origemFinal: EOrigemAlunos;
            idTurmaTransferenciaDe: number | null;
            isBonusEntry: boolean;
        }> = [];

        for (const row of parsed) {
            const telefoneNormalizado = this.normalizePhone(row.telefone);
            const nomeNormalizado = this.normalizeText(row.nome);
            const emailNormalizadoRaw = this.normalizeEmail(row.email);
            const emailNormalizado = emailNormalizadoRaw || this.buildFallbackEmail(row.nome || '', telefoneNormalizado);
            const emailGeradoAutomaticamente = !emailNormalizadoRaw;
            const statusNormalizado = this.normalizeText(row.status);
            const enviarParaSemTurma = statusNormalizado.includes('EXCLUIR') || statusNormalizado.includes('CANCELADO');

            if (!nomeNormalizado || !telefoneNormalizado) {
                if (enviarParaSemTurma) {
                    totalSemTurma++;
                }
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
            const isBonusByDuplicate = nextOccurrence > 1;
            let emailCandidato = isBonusByDuplicate ? this.buildBonusEmailFromBase(emailNormalizado, nextOccurrence - 1) : emailNormalizado;

            const nomeCracha = nextOccurrence === 1 ? row.nome.trim() : `${row.nome.trim()} ${nextOccurrence}`;
            const obsNormalizada = this.normalizeText(row.obs);
            const statusAlunoTurma = this.mapStatusToAlunoTurma(statusNormalizado);
            const enviarParaInadimplente = statusNormalizado.includes('NEGATIVADO') || statusNormalizado.includes('NEGATIVACAO');
            const enviarParaJuridico = statusNormalizado.includes('JURIDICO');
            const isTransferenciaPorStatus = statusNormalizado.includes('TRANSFER');
            let idTurmaDestino = turmaSelecionada.id;
            let idTurmaTransferenciaDeByStatus: number | null = null;

            if (isTransferenciaPorStatus) {
                const codigoTransferenciaRaw = (row.turmaTransferenciaDestino || '').trim();
                const codigoTransferencia = this.normalizeCodeKey(codigoTransferenciaRaw);
                if (!codigoTransferenciaRaw) {
                    erros.push(`Linha ${row.linha}: status "${row.status}" exige turma de destino na coluna de transferência.`);
                    preview.push({
                        linha: row.linha,
                        nome_cracha: row.nome || '',
                        email: emailNormalizado,
                        telefone: telefoneNormalizado,
                        email_gerado_automaticamente: emailGeradoAutomaticamente,
                        acao: 'IGNORAR',
                        turma_destino_id: idTurmaSelecionada,
                        status_planilha: row.status || '',
                        status_final: statusAlunoTurma,
                        origem_final: EOrigemAlunos.TRANSFERENCIA,
                    });
                    continue;
                }

                let turmaDestinoTransferenciaId = origemTurmaMap.get(codigoTransferencia) || null;
                if (!turmaDestinoTransferenciaId) {
                    const turmaPorEdicao = await this.uow.turmasRP.findOne({
                        where: {
                            id_treinamento: turmaSelecionada.id_treinamento,
                            edicao_turma: ILike(codigoTransferenciaRaw),
                            deletado_em: null,
                        },
                    });
                    turmaDestinoTransferenciaId = turmaPorEdicao?.id || null;
                }

                if (!turmaDestinoTransferenciaId) {
                    erros.push(
                        `Linha ${row.linha}: turma de transferência "${codigoTransferenciaRaw}" não encontrada para o treinamento ${turmaSelecionada.id_treinamento}.`,
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
                        status_final: statusAlunoTurma,
                        origem_final: EOrigemAlunos.TRANSFERENCIA,
                    });
                    continue;
                }

                idTurmaDestino = turmaDestinoTransferenciaId;
                idTurmaTransferenciaDeByStatus = turmaSelecionada.id;
            } else if (enviarParaInadimplente) {
                if (!turmaInadimplente) {
                    erros.push(
                        `Linha ${row.linha}: status "${row.status}" exige turma INADIMPLENTE para o treinamento ${turmaSelecionada.id_treinamento}, mas ela não foi encontrada.`,
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
                        status_final: statusAlunoTurma,
                        origem_final: EOrigemAlunos.COMPROU_INGRESSO,
                    });
                    continue;
                }

                idTurmaDestino = turmaInadimplente.id;
            } else if (enviarParaJuridico) {
                if (!turmaJuridico) {
                    erros.push(
                        `Linha ${row.linha}: status "${row.status}" exige turma JURIDICO para o treinamento ${turmaSelecionada.id_treinamento}, mas ela não foi encontrada.`,
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
                        status_final: statusAlunoTurma,
                        origem_final: EOrigemAlunos.COMPROU_INGRESSO,
                    });
                    continue;
                }
                idTurmaDestino = turmaJuridico.id;
            } else if (enviarParaSemTurma) {
                if (!turmaSemTurma) {
                    totalSemTurma++;
                    erros.push(
                        `Linha ${row.linha}: status "${row.status}" exige turma SEM_TURMA para o treinamento ${turmaSelecionada.id_treinamento}, mas ela não foi encontrada.`,
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
                        status_final: statusAlunoTurma,
                        origem_final: EOrigemAlunos.COMPROU_INGRESSO,
                    });
                    continue;
                }
                idTurmaDestino = turmaSemTurma.id;
            }

            if (enviarParaSemTurma) {
                totalSemTurma++;
            }

            const codigoTurmaOrigem = this.extractCodigoTurmaOrigem(row.obs);
            // A 1a ocorrência do titular deve permanecer como ingresso.
            // "BONUS" em observação só reforça vínculo em repetições.
            const isBonusFromObs = isBonusByDuplicate && obsNormalizada.includes('BONUS');
            const isBonus = isBonusByDuplicate || row.isBonus || isBonusFromObs;

            // Se houver linha de bônus/convidado sem e-mail do bônus, replicar e-mail do titular com +bonusN.
            if (isBonus && row.isBonus && !row.hasEmailBonus) {
                const emailTitular = this.normalizeEmail(row.emailTitular || '') || emailNormalizado;
                const telefoneTitular = this.normalizePhone(row.telefoneTitular || '') || telefoneNormalizado;
                const bonusKeyTitular = `${emailTitular}|${telefoneTitular}`;
                const nextBonusIndex = (bonusIndexByTitularKey.get(bonusKeyTitular) || 0) + 1;
                bonusIndexByTitularKey.set(bonusKeyTitular, nextBonusIndex);
                emailCandidato = this.buildBonusEmailFromBase(emailTitular, nextBonusIndex);
            }
            let origemAluno = this.mapOrigemAluno({
                isBonus,
                codigoTurmaOrigem,
                occurrence: nextOccurrence,
            });
            if (isTransferenciaPorStatus) {
                origemAluno = EOrigemAlunos.TRANSFERENCIA;
            }

            let idTurmaTransferenciaDe: number | null = null;
            if (idTurmaTransferenciaDeByStatus) {
                idTurmaTransferenciaDe = idTurmaTransferenciaDeByStatus;
            } else if (codigoTurmaOrigem) {
                idTurmaTransferenciaDe = origemTurmaMap.get(codigoTurmaOrigem) || null;
                if (!idTurmaTransferenciaDe) {
                    avisos.push(`Linha ${row.linha}: código de turma de origem "${codigoTurmaOrigem}" não encontrado no cadastro.`);
                }
            }

            candidates.push({
                linha: row.linha,
                nomeOriginal: row.nome.trim(),
                nomeCracha,
                email: emailCandidato,
                titularEmail: emailNormalizado,
                emailGeradoAutomaticamente,
                telefone: telefoneNormalizado,
                turmaDestinoId: idTurmaDestino,
                statusPlanilha: row.status || '',
                statusFinal: statusAlunoTurma,
                origemFinal: origemAluno,
                idTurmaTransferenciaDe,
                isBonusEntry: isBonus,
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
        const turmaIdsDestino = Array.from(new Set(candidates.map((c) => c.turmaDestinoId)));
        const vinculosExistentes =
            idsAlunosExistentes.length > 0 && turmaIdsDestino.length > 0
                ? await this.uow.turmasAlunosRP.find({
                      where: {
                          id_turma: In(turmaIdsDestino),
                          id_aluno: In(idsAlunosExistentes),
                          deletado_em: null,
                      },
                  })
                : [];

        const vinculoByKey = new Map<string, (typeof vinculosExistentes)[number]>(
            vinculosExistentes.map((v) => [`${v.id_turma}|${v.id_aluno}|${v.nome_cracha}`, v]),
        );
        const runtimeVinculoKeys = new Set(vinculosExistentes.map((v) => `${v.id_turma}|${v.id_aluno}|${v.nome_cracha}`));

        const numerosCrachaExistentes = turmaIdsDestino.length
            ? await this.uow.turmasAlunosRP.find({
                  where: {
                      id_turma: In(turmaIdsDestino),
                      deletado_em: null,
                  },
                  select: ['id_turma', 'numero_cracha'],
              })
            : [];
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
                    const crachaSet = crachaSetByTurma.get(item.turmaDestinoId);
                    if (!crachaSet) {
                        throw new Error(`Não foi possível obter controle de crachá para turma ${item.turmaDestinoId}`);
                    }
                    const numeroCracha = this.generateCrachaNumberFromSet(crachaSet);
                    createsToSave.push({
                        id_turma: item.turmaDestinoId,
                        id_aluno: String(aluno.id),
                        nome_cracha: item.nomeCracha,
                        numero_cracha: numeroCracha,
                        origem_aluno: item.origemFinal,
                        status_aluno_turma: item.statusFinal,
                        vaga_bonus: item.isBonusEntry,
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

            for (const cand of candidates) {
                if (!cand.isBonusEntry) continue;
                const alunoBonus = alunoByEmail.get(cand.email);
                const alunoTitular = alunoByEmail.get(cand.titularEmail);
                if (!alunoBonus || !alunoTitular) continue;
                if (alunoBonus.id === alunoTitular.id) continue;

                await this.ensureBidirectionalAlunoVinculo({
                    titularAlunoId: alunoTitular.id,
                    bonusAlunoId: alunoBonus.id,
                    turmaId: cand.turmaDestinoId,
                    tipoVinculo: ETipoVinculoAluno.BONUS,
                });
            }
        }

        const totalProcessadas = totalCriadas + totalAtualizadas;
        const previewLimit = preview.slice(0, 120);
        const tituloModo = confirmar ? 'Importação concluída' : 'Pré-visualização concluída';
        const acaoFinal = confirmar ? 'processado(s)' : 'pronto(s) para processamento';

        return {
            message: `${tituloModo}. ${totalProcessadas} vínculo(s) ${acaoFinal}, ${totalSemTurma} enviado(s) para SEM_TURMA por status EXCLUIR/CANCELADO.`,
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

    async importarAlunosMasterclassPlanilha(file: Express.Multer.File, confirmar = false): Promise<ImportarAlunosPlanilhaResponse> {
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

        const rows = this.parseXlsxRows(file.buffer);
        const parsedRows = this.parseMasterclassSpreadsheetRows(rows);
        const turmaCodigoMap = await this.buildTurmaCodigoMap();

        const erros: string[] = [];
        const avisos: string[] = [];
        const preview: ImportPreviewItem[] = [];
        let totalCriadas = 0;
        let totalAtualizadas = 0;
        let totalSemTurma = 0;
        const occurrenceByPessoa = new Map<string, number>();

        const candidates: Array<{
            linha: number;
            nomeOriginal: string;
            nomeCracha: string;
            cpfCnpj: string;
            email: string;
            titularEmail: string;
            emailGeradoAutomaticamente: boolean;
            telefone: string;
            turmaDestinoId: number;
            turmaDestinoCodigo: string;
            turmaOrigemCodigo: string;
            turmaOrigemDescricao: string;
            dataInclusao: string;
            quantidadeBonus: number;
            quantidadeBonusExtraPorPessoa: number;
            turmaBonusCodigo?: string;
            isTimeDeVendas: boolean;
            isBonusEntry: boolean;
            isBonusExtraEntry: boolean;
            statusPlanilha: string;
            statusFinal: EStatusAlunosTurmas;
            origemFinal: EOrigemAlunos;
            idTurmaTransferenciaDe: number | null;
        }> = [];

        for (const row of parsedRows) {
            const nomeNormalizado = this.normalizeText(row.nome);
            const telefoneNormalizado = this.normalizePhone(row.telefone);
            const emailNormalizadoRaw = this.normalizeEmail(row.email);
            const emailNormalizado = emailNormalizadoRaw || this.buildFallbackEmail(row.nome || '', telefoneNormalizado);
            const emailGeradoAutomaticamente = !emailNormalizadoRaw;

            if (!nomeNormalizado) {
                erros.push(`Linha ${row.linha}: nome não informado`);
                continue;
            }

            if (!telefoneNormalizado && !emailNormalizadoRaw) {
                erros.push(`Linha ${row.linha}: informe pelo menos telefone ou e-mail válido`);
                continue;
            }

            const destinoLookup = await this.resolveTurmaIdByCodigo({
                codigoRaw: row.turmaDestinoCodigo,
                turmaCodigoMap,
            });
            if (destinoLookup.matchType === 'edicao') {
                avisos.push(`Linha ${row.linha}: turma de destino "${row.turmaDestinoCodigo}" encontrada por edição.`);
            }
            if (destinoLookup.matchType === 'ambigua') {
                erros.push(
                    `Linha ${row.linha}: turma de destino "${row.turmaDestinoCodigo}" é ambígua (mais de uma turma com essa edição). Informe o código completo da turma (SIGLA_CURSO_SIGLA_POLO_EDICAO).`,
                );
                continue;
            }
            const turmaDestinoId = destinoLookup.turmaId;
            if (!turmaDestinoId) {
                totalSemTurma++;
                erros.push(`Linha ${row.linha}: turma de destino "${row.turmaDestinoCodigo}" não encontrada`);
                continue;
            }

            const codigoOrigem = this.normalizeCodeKey(row.turmaOrigemCodigo);
            const origemVenda = codigoOrigem.includes('TIME_DE_VENDAS') || codigoOrigem.includes('TIMEDEVENDAS');
            const idTurmaTransferenciaDe = origemVenda ? null : turmaCodigoMap.get(codigoOrigem) || null;
            if (!origemVenda && !idTurmaTransferenciaDe && codigoOrigem) {
                avisos.push(`Linha ${row.linha}: turma de origem "${row.turmaOrigemCodigo}" não encontrada; será importado sem vínculo de transferência.`);
            }

            const codigoDestino = this.normalizeCodeKey(row.turmaDestinoCodigo);
            // Detectar se esta linha é repetição de mesmo nome+origem (bônus por duplicação)
            const dedupeKey = `${nomeNormalizado}|${codigoOrigem}|${codigoDestino}`;
            const prevOccurrence = occurrenceByPessoa.get(dedupeKey) || 0;
            occurrenceByPessoa.set(dedupeKey, prevOccurrence + 1);
            const isLinhaRepetida = prevOccurrence > 0;

            const quantidadeInscricoes = Math.max(1, row.quantidadeInscricoes || 1);
            const quantidadeBonusExtraPorPessoa = Math.max(0, row.quantidadeBonusTurma || 0);
            let turmaBonusId: number | null = null;
            let turmaBonusCodigoFinal = row.turmaBonusCodigo || '';

            if (quantidadeBonusExtraPorPessoa > 0) {
                if (!turmaBonusCodigoFinal) {
                    avisos.push(
                        `Linha ${row.linha}: quantidade de bônus (${quantidadeBonusExtraPorPessoa}) informada sem "BÔNUS PARA QUAL TURMA?". Bônus extra ignorado.`,
                    );
                } else {
                    const bonusLookup = await this.resolveTurmaIdByCodigo({
                        codigoRaw: turmaBonusCodigoFinal,
                        turmaCodigoMap,
                    });
                    if (bonusLookup.matchType === 'edicao') {
                        avisos.push(`Linha ${row.linha}: turma de bônus "${turmaBonusCodigoFinal}" encontrada por edição.`);
                    } else if (bonusLookup.matchType === 'ambigua') {
                        erros.push(
                            `Linha ${row.linha}: turma de bônus "${turmaBonusCodigoFinal}" é ambígua. Informe o código completo da turma (SIGLA_CURSO_SIGLA_POLO_EDICAO).`,
                        );
                    }
                    turmaBonusId = bonusLookup.turmaId;
                    turmaBonusCodigoFinal = bonusLookup.turmaCodigoNormalizado || turmaBonusCodigoFinal;
                }
            }

            // Total de candidatos a gerar: inscrições da coluna + se for repetida, a própria linha é bônus
            const startIndex = isLinhaRepetida ? 0 : 0;
            const totalSlots = isLinhaRepetida ? quantidadeInscricoes : quantidadeInscricoes;
            // Offset global para numerar bônus: acumulado de ocorrências anteriores
            const globalBonusOffset = isLinhaRepetida ? prevOccurrence * Math.max(1, quantidadeInscricoes) : 0;

            for (let i = startIndex; i < totalSlots; i++) {
                const globalIndex = globalBonusOffset + i;
                const isBonus = isLinhaRepetida || i > 0;
                const nomeCracha = globalIndex === 0 ? row.nome.trim() : `${row.nome.trim()} ${globalIndex + 1}`;
                const origemFinal = isBonus ? EOrigemAlunos.ALUNO_BONUS : EOrigemAlunos.COMPROU_INGRESSO;
                const emailCandidato = isBonus ? this.buildBonusEmailFromBase(emailNormalizado, globalIndex) : emailNormalizado;
                const quantidadeBonusRegraAtual = Math.max(0, quantidadeInscricoes - 1) + (isLinhaRepetida ? quantidadeInscricoes : 0);
                const quantidadeBonusTotalLinha = quantidadeBonusRegraAtual + quantidadeBonusExtraPorPessoa;
                const statusImportacao = EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO;
                const slugEvento = this.normalizeCodeKey(row.turmaDestinoCodigo || 'EVENTO').toLowerCase();

                candidates.push({
                    linha: row.linha,
                    nomeOriginal: row.nome.trim(),
                    nomeCracha,
                    cpfCnpj: row.cpfCnpj,
                    email: emailCandidato,
                    titularEmail: emailNormalizado,
                    emailGeradoAutomaticamente,
                    telefone: telefoneNormalizado,
                    turmaDestinoId,
                    turmaDestinoCodigo: row.turmaDestinoCodigo,
                    turmaOrigemCodigo: row.turmaOrigemCodigo,
                    turmaOrigemDescricao: origemVenda ? 'Time de Vendas IAM' : row.turmaOrigemCodigo,
                    dataInclusao: row.dataInclusao,
                    quantidadeBonus: quantidadeBonusTotalLinha,
                    quantidadeBonusExtraPorPessoa,
                    turmaBonusCodigo: turmaBonusCodigoFinal || undefined,
                    isTimeDeVendas: origemVenda,
                    isBonusEntry: isBonus,
                    isBonusExtraEntry: false,
                    statusPlanilha: `INCLUSAO:${row.dataInclusao || '-'}`,
                    statusFinal: statusImportacao,
                    origemFinal,
                    idTurmaTransferenciaDe: isBonus ? null : idTurmaTransferenciaDe,
                });

                if (!turmaBonusId || quantidadeBonusExtraPorPessoa <= 0) {
                    continue;
                }

                for (let bonusExtraPos = 0; bonusExtraPos < quantidadeBonusExtraPorPessoa; bonusExtraPos++) {
                    const numeradorExtra = globalIndex * quantidadeBonusExtraPorPessoa + bonusExtraPos + 1;
                    const nomeCrachaBonusExtra = `${row.nome.trim()} ${numeradorExtra} ${row.turmaDestinoCodigo}`.trim();
                    const emailBonusExtra = this.buildBonusEmailFromBaseWithEvent(emailCandidato, numeradorExtra, slugEvento);

                    candidates.push({
                        linha: row.linha,
                        nomeOriginal: row.nome.trim(),
                        nomeCracha: nomeCrachaBonusExtra,
                        cpfCnpj: row.cpfCnpj,
                        email: emailBonusExtra,
                        titularEmail: emailCandidato,
                        emailGeradoAutomaticamente: true,
                        telefone: telefoneNormalizado,
                        turmaDestinoId: turmaBonusId,
                        turmaDestinoCodigo: turmaBonusCodigoFinal,
                        turmaOrigemCodigo: row.turmaOrigemCodigo,
                        turmaOrigemDescricao: `Bônus de ${row.turmaDestinoCodigo}`,
                        dataInclusao: row.dataInclusao,
                        quantidadeBonus: 0,
                        quantidadeBonusExtraPorPessoa,
                        turmaBonusCodigo: turmaBonusCodigoFinal || undefined,
                        isTimeDeVendas: origemVenda,
                        isBonusEntry: true,
                        isBonusExtraEntry: true,
                        statusPlanilha: `BONUS_EXTRA:${row.dataInclusao || '-'}`,
                        statusFinal: statusImportacao,
                        origemFinal: EOrigemAlunos.ALUNO_BONUS,
                        idTurmaTransferenciaDe: null,
                    });
                }
            }
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
            const novosAlunos = emailsFaltantes
                .map((email) => {
                    const base = candidates.find((c) => c.email === email);
                    if (!base) return null;
                    return this.uow.alunosRP.create({
                        nome: base.nomeOriginal || 'Aluno',
                        nome_cracha: base.nomeOriginal || 'Aluno',
                        email,
                        cpf: base.cpfCnpj || null,
                        telefone_um: base.telefone || '00000000000',
                        possui_deficiencia: false,
                    });
                })
                .filter((a): a is NonNullable<typeof a> => Boolean(a));

            if (novosAlunos.length > 0) {
                await this.uow.alunosRP.save(novosAlunos, { chunk: alunosChunkSize });
                lotesAlunosCriados += Math.ceil(novosAlunos.length / alunosChunkSize);
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
        const turmaIdsDestino = Array.from(new Set(candidates.map((c) => c.turmaDestinoId)));
        const vinculosExistentes =
            idsAlunosExistentes.length > 0 && turmaIdsDestino.length > 0
                ? await this.uow.turmasAlunosRP.find({
                      where: {
                          id_turma: In(turmaIdsDestino),
                          id_aluno: In(idsAlunosExistentes),
                          deletado_em: null,
                      },
                  })
                : [];

        const vinculoByKey = new Map<string, (typeof vinculosExistentes)[number]>(
            vinculosExistentes.map((v) => [`${v.id_turma}|${v.id_aluno}|${v.nome_cracha}`, v]),
        );
        const runtimeVinculoKeys = new Set(vinculosExistentes.map((v) => `${v.id_turma}|${v.id_aluno}|${v.nome_cracha}`));

        const numerosCrachaExistentes = turmaIdsDestino.length
            ? await this.uow.turmasAlunosRP.find({
                  where: {
                      id_turma: In(turmaIdsDestino),
                      deletado_em: null,
                  },
                  select: ['id_turma', 'numero_cracha'],
              })
            : [];

        const crachaSetByTurma = new Map<number, Set<string>>();
        for (const row of numerosCrachaExistentes) {
            if (!crachaSetByTurma.has(row.id_turma)) {
                crachaSetByTurma.set(row.id_turma, new Set());
            }
            crachaSetByTurma.get(row.id_turma)?.add(row.numero_cracha);
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
            id_aluno_bonus: string | null;
            id_turma_transferencia_de: number | null;
        }> = [];

        const firstAlunoIdByLinha = new Map<number, string>();
        for (const item of candidates) {
            try {
                const aluno = alunoByEmail.get(item.email) || null;
                const alunoId = aluno ? String(aluno.id) : '';
                const vinculoKey = `${item.turmaDestinoId}|${alunoId}|${item.nomeCracha}`;
                const existeVinculo = Boolean(aluno && runtimeVinculoKeys.has(vinculoKey));
                const vinculoPersistido = aluno ? vinculoByKey.get(vinculoKey) : undefined;
                const isBonus = item.origemFinal === EOrigemAlunos.ALUNO_BONUS;
                const idAlunoBonus = isBonus ? firstAlunoIdByLinha.get(item.linha) || null : null;

                if (existeVinculo) {
                    if (!isBonus && aluno && !firstAlunoIdByLinha.has(item.linha)) {
                        firstAlunoIdByLinha.set(item.linha, String(aluno.id));
                    }
                    if (confirmar && vinculoPersistido) {
                        vinculoPersistido.status_aluno_turma = item.statusFinal;
                        vinculoPersistido.origem_aluno = item.origemFinal;
                        vinculoPersistido.id_aluno_bonus = idAlunoBonus;
                        vinculoPersistido.id_turma_transferencia_de = item.idTurmaTransferenciaDe;
                        updatesToSave.push(vinculoPersistido);
                    }
                    totalAtualizadas++;
                    preview.push({
                        linha: item.linha,
                        nome_cracha: item.nomeCracha,
                        nome: item.nomeOriginal,
                        cpf_cnpj: item.cpfCnpj,
                        email: item.email,
                        telefone: item.telefone,
                        turma_origem_codigo: item.turmaOrigemCodigo,
                        turma_origem_descricao: item.turmaOrigemDescricao,
                        turma_destino_codigo: item.turmaDestinoCodigo,
                        email_gerado_automaticamente: item.emailGeradoAutomaticamente,
                        acao: 'ATUALIZAR',
                        turma_destino_id: item.turmaDestinoId,
                        quantidade_bonus: item.quantidadeBonus,
                        quantidade_bonus_extra_por_pessoa: item.quantidadeBonusExtraPorPessoa,
                        data_inclusao: item.dataInclusao,
                        turma_bonus_codigo: item.turmaBonusCodigo,
                        tipo_linha: item.isBonusExtraEntry ? 'BONUS_EXTRA' : item.isBonusEntry ? 'BONUS_INSCRICAO' : 'PRINCIPAL',
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
                        nome: item.nomeOriginal,
                        cpf_cnpj: item.cpfCnpj,
                        email: item.email,
                        telefone: item.telefone,
                        turma_origem_codigo: item.turmaOrigemCodigo,
                        turma_origem_descricao: item.turmaOrigemDescricao,
                        turma_destino_codigo: item.turmaDestinoCodigo,
                        email_gerado_automaticamente: item.emailGeradoAutomaticamente,
                        acao: 'CRIAR',
                        turma_destino_id: item.turmaDestinoId,
                        quantidade_bonus: item.quantidadeBonus,
                        quantidade_bonus_extra_por_pessoa: item.quantidadeBonusExtraPorPessoa,
                        data_inclusao: item.dataInclusao,
                        turma_bonus_codigo: item.turmaBonusCodigo,
                        tipo_linha: item.isBonusExtraEntry ? 'BONUS_EXTRA' : item.isBonusEntry ? 'BONUS_INSCRICAO' : 'PRINCIPAL',
                        status_planilha: item.statusPlanilha,
                        status_final: item.statusFinal,
                        origem_final: item.origemFinal,
                    });
                    continue;
                }

                if (!aluno) {
                    throw new Error('Não foi possível criar/alocar o aluno para importação');
                }

                if (!isBonus && !firstAlunoIdByLinha.has(item.linha)) {
                    firstAlunoIdByLinha.set(item.linha, String(aluno.id));
                }

                if (confirmar) {
                    if (!crachaSetByTurma.has(item.turmaDestinoId)) {
                        crachaSetByTurma.set(item.turmaDestinoId, new Set());
                    }
                    const crachaSet = crachaSetByTurma.get(item.turmaDestinoId);
                    if (!crachaSet) {
                        throw new Error(`Não foi possível obter controle de crachá para turma ${item.turmaDestinoId}`);
                    }
                    const numeroCracha = this.generateCrachaNumberFromSet(crachaSet);
                    createsToSave.push({
                        id_turma: item.turmaDestinoId,
                        id_aluno: String(aluno.id),
                        nome_cracha: item.nomeCracha,
                        numero_cracha: numeroCracha,
                        origem_aluno: item.origemFinal,
                        status_aluno_turma: item.statusFinal,
                        vaga_bonus: isBonus,
                        id_aluno_bonus: idAlunoBonus,
                        id_turma_transferencia_de: item.idTurmaTransferenciaDe,
                    });
                }

                runtimeVinculoKeys.add(`${item.turmaDestinoId}|${aluno.id}|${item.nomeCracha}`);
                totalCriadas++;
                preview.push({
                    linha: item.linha,
                    nome_cracha: item.nomeCracha,
                    nome: item.nomeOriginal,
                    cpf_cnpj: item.cpfCnpj,
                    email: item.email,
                    telefone: item.telefone,
                    turma_origem_codigo: item.turmaOrigemCodigo,
                    turma_origem_descricao: item.turmaOrigemDescricao,
                    turma_destino_codigo: item.turmaDestinoCodigo,
                    email_gerado_automaticamente: item.emailGeradoAutomaticamente,
                    acao: 'CRIAR',
                    turma_destino_id: item.turmaDestinoId,
                    quantidade_bonus: item.quantidadeBonus,
                    quantidade_bonus_extra_por_pessoa: item.quantidadeBonusExtraPorPessoa,
                    data_inclusao: item.dataInclusao,
                    turma_bonus_codigo: item.turmaBonusCodigo,
                    tipo_linha: item.isBonusExtraEntry ? 'BONUS_EXTRA' : item.isBonusEntry ? 'BONUS_INSCRICAO' : 'PRINCIPAL',
                    status_planilha: item.statusPlanilha,
                    status_final: item.statusFinal,
                    origem_final: item.origemFinal,
                });
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Erro desconhecido';
                erros.push(`Linha ${item.linha}: ${msg}`);
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

            // Para cada candidato, buscar o vínculo salvo e criar histórico + vínculo de bônus
            for (const cand of candidates) {
                const aluno = alunoByEmail.get(cand.email);
                if (!aluno) continue;

                const vinculoSalvo = await this.uow.turmasAlunosRP.findOne({
                    where: {
                        id_turma: cand.turmaDestinoId,
                        id_aluno: String(aluno.id),
                        nome_cracha: cand.nomeCracha,
                        deletado_em: null,
                    },
                });
                if (!vinculoSalvo) continue;

                // Criar histórico para Time de Vendas ou transferência de masterclass
                if (cand.isTimeDeVendas || cand.idTurmaTransferenciaDe) {
                    const existsHistorico = await this.uow.historicoTransferenciasRP.findOne({
                        where: {
                            id_aluno: aluno.id,
                            id_turma_para: cand.turmaDestinoId,
                            id_turma_aluno_para: vinculoSalvo.id,
                        },
                    });
                    if (!existsHistorico) {
                        const historico = this.uow.historicoTransferenciasRP.create({
                            id_aluno: aluno.id,
                            id_turma_de: cand.idTurmaTransferenciaDe || cand.turmaDestinoId,
                            id_turma_para: cand.turmaDestinoId,
                            id_turma_aluno_de: null,
                            id_turma_aluno_para: vinculoSalvo.id,
                        });
                        const dataInclusaoDate = this.parseDateFromSpreadsheet(cand.dataInclusao);
                        if (dataInclusaoDate) {
                            historico.criado_em = dataInclusaoDate;
                            historico.atualizado_em = dataInclusaoDate;
                        }
                        await this.uow.historicoTransferenciasRP.save(historico);
                    }
                }

                // Criar vínculo de bônus na tabela alunos_vinculos
                if (cand.isBonusEntry) {
                    const titularAluno = alunoByEmail.get(cand.titularEmail);
                    if (titularAluno && titularAluno.id !== aluno.id) {
                        await this.ensureBidirectionalAlunoVinculo({
                            titularAlunoId: titularAluno.id,
                            bonusAlunoId: aluno.id,
                            turmaId: cand.turmaDestinoId,
                            tipoVinculo: ETipoVinculoAluno.BONUS,
                        });
                    }
                }
            }
        }

        const totalProcessadas = totalCriadas + totalAtualizadas;
        const tituloModo = confirmar ? 'Importação de masterclass concluída' : 'Pré-visualização de masterclass concluída';

        return {
            message: `${tituloModo}. ${totalProcessadas} vínculo(s) processado(s).`,
            total_linhas: parsedRows.length,
            total_processadas: totalProcessadas,
            total_criadas: totalCriadas,
            total_atualizadas: totalAtualizadas,
            total_erros: erros.length,
            total_sem_turma: totalSemTurma,
            erros,
            avisos,
            exige_confirmacao: !confirmar,
            confirmado: confirmar,
            preview: preview.slice(0, 120),
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

        const abaSubirAluno = workbook.SheetNames.find((sheetName) => this.normalizeText(String(sheetName || '')).includes('SUBIR ALUNO'));

        if (!abaSubirAluno) {
            throw new BadRequestException('A planilha deve conter uma aba com "Subir aluno" no nome');
        }

        const worksheet = workbook.Sheets[abaSubirAluno];
        return XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    }

    private parseMasterclassSpreadsheetRows(rows: any[][]): Array<{
        linha: number;
        turmaOrigemCodigo: string;
        dataInclusao: string;
        nome: string;
        cpfCnpj: string;
        telefone: string;
        email: string;
        turmaDestinoCodigo: string;
        quantidadeInscricoes: number;
        quantidadeBonusTurma: number;
        turmaBonusCodigo: string;
    }> {
        if (rows.length < 2) {
            throw new BadRequestException('A planilha precisa conter cabeçalho e dados');
        }

        const headerRow = (rows[0] || []).map((cell) => this.normalizeText(String(cell || '')));
        const idxTurmaOrigem = headerRow.findIndex((h) => h.includes('TURMA ORIGEM'));
        const idxDataInclusao = headerRow.findIndex((h) => h.includes('DATA DA INCLUSAO'));
        const idxNome = headerRow.findIndex((h) => h.includes('PARCEIRO DE NEGOCIO') || h === 'CLIENTE' || h.includes(' CLIENTE') || h.includes('CLIENTE '));
        const idxCpfCnpj = headerRow.findIndex((h) => h === 'CPF' || h.includes('CNPJ'));
        const idxTelefone = headerRow.findIndex((h) => h.includes('TELEFONE'));
        const idxEmail = headerRow.findIndex((h) => h.includes('E-MAIL') || h === 'EMAIL');
        const idxTurmaDestino = headerRow.findIndex((h) => h.includes('TURMA DESTINO'));
        const idxInscricoes = headerRow.findIndex((h) => h.includes('NUMERO DE INSCRICOES'));
        const idxQuantidadeBonusTurma = headerRow.findIndex((h) => h.includes('QUANTIDADE DE BONUS'));
        const idxTurmaBonus = headerRow.findIndex((h) => h.includes('BONUS PARA QUAL TURMA'));

        if ([idxTurmaOrigem, idxNome, idxTelefone, idxEmail, idxTurmaDestino, idxInscricoes].some((idx) => idx < 0)) {
            throw new BadRequestException('Modelo de planilha inválido para importação de masterclass');
        }

        const parsed: Array<{
            linha: number;
            turmaOrigemCodigo: string;
            dataInclusao: string;
            nome: string;
            cpfCnpj: string;
            telefone: string;
            email: string;
            turmaDestinoCodigo: string;
            quantidadeInscricoes: number;
            quantidadeBonusTurma: number;
            turmaBonusCodigo: string;
        }> = [];

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i] || [];
            const turmaOrigemCodigo = String(row[idxTurmaOrigem] ?? '').trim();
            const dataInclusao = idxDataInclusao >= 0 ? String(row[idxDataInclusao] ?? '').trim() : '';
            const nome = String(row[idxNome] ?? '').trim();
            const cpfCnpj = idxCpfCnpj >= 0 ? String(row[idxCpfCnpj] ?? '').trim() : '';
            const telefone = String(row[idxTelefone] ?? '').trim();
            const email = String(row[idxEmail] ?? '').trim();
            const turmaDestinoCodigo = String(row[idxTurmaDestino] ?? '').trim();
            const inscricoesRaw = String(row[idxInscricoes] ?? '').trim();
            const quantidadeInscricoes = Math.max(1, parseInt(inscricoesRaw, 10) || 1);
            const quantidadeBonusTurmaRaw = idxQuantidadeBonusTurma >= 0 ? String(row[idxQuantidadeBonusTurma] ?? '').trim() : '';
            const quantidadeBonusTurma = Math.max(0, parseInt(quantidadeBonusTurmaRaw, 10) || 0);
            const turmaBonusCodigo = idxTurmaBonus >= 0 ? String(row[idxTurmaBonus] ?? '').trim() : '';

            if (!turmaOrigemCodigo && !nome && !telefone && !email && !turmaDestinoCodigo) {
                continue;
            }

            parsed.push({
                linha: i + 1,
                turmaOrigemCodigo,
                dataInclusao,
                nome,
                cpfCnpj,
                telefone,
                email,
                turmaDestinoCodigo,
                quantidadeInscricoes,
                quantidadeBonusTurma,
                turmaBonusCodigo,
            });
        }

        return parsed;
    }

    private parseDateFromSpreadsheet(value: string): Date | null {
        const raw = (value || '').trim();
        if (!raw) return null;

        const direct = new Date(raw);
        if (!Number.isNaN(direct.getTime())) return direct;

        const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) {
            const d = Number(m[1]);
            const mo = Number(m[2]) - 1;
            const y = Number(m[3]);
            const dt = new Date(y, mo, d, 0, 0, 0, 0);
            if (!Number.isNaN(dt.getTime())) return dt;
        }

        return null;
    }

    private buildBonusEmailFromBase(email: string, bonusIndex: number): string {
        const normalized = (email || '').trim().toLowerCase();
        const atIndex = normalized.indexOf('@');
        if (atIndex <= 0) {
            return `${normalized}+bonus${bonusIndex}@sememail.com`;
        }
        const local = normalized.slice(0, atIndex);
        const domain = normalized.slice(atIndex + 1);
        return `${local}+bonus${bonusIndex}@${domain}`;
    }

    private parseSpreadsheetRows(rows: any[][]): Array<{
        linha: number;
        nome: string;
        email: string;
        telefone: string;
        obs: string;
        status: string;
        turmaTransferenciaDestino?: string;
        isBonus?: boolean;
        emailTitular?: string;
        telefoneTitular?: string;
        hasEmailBonus?: boolean;
        hasTelefoneBonus?: boolean;
    }> {
        if (rows.length < 2) {
            throw new BadRequestException('A planilha precisa conter cabeçalho e dados');
        }

        const headerIndex = this.findHeaderIndex(rows);
        const dataStart = headerIndex + 1;
        const headerRow = rows[headerIndex] || [];
        const normalizedHeaders = headerRow.map((v) => this.normalizeText(String(v ?? '')));
        const idxNomeParticipante = this.findHeaderColumnIndex(normalizedHeaders, (h) => h === 'NOME' || h.includes('NOME CONV'));
        const idxStatusPrincipal = this.findHeaderColumnIndex(normalizedHeaders, (h) => h === 'STATUS');
        const idxStatusFin = this.findHeaderColumnIndex(normalizedHeaders, (h) => h.includes('STATUS FIN'));
        const isLayoutTreinamentosGerais = idxNomeParticipante >= 0 && idxStatusPrincipal >= 0 && idxStatusPrincipal !== idxStatusFin;
        const hasStatusH = this.isStatusHeader(headerRow[7]);
        const hasStatusI = this.isStatusHeader(headerRow[8]);
        const parsed: Array<{
            linha: number;
            nome: string;
            email: string;
            telefone: string;
            obs: string;
            status: string;
            turmaTransferenciaDestino?: string;
            isBonus?: boolean;
            emailTitular?: string;
            telefoneTitular?: string;
            hasEmailBonus?: boolean;
            hasTelefoneBonus?: boolean;
        }> = [];

        if (isLayoutTreinamentosGerais) {
            const idxParceiro = this.findHeaderColumnIndex(normalizedHeaders, (h) => h.includes('PARCEIRO'));
            const idxObs = this.findHeaderColumnIndex(normalizedHeaders, (h) => h.includes('OBSERV') || h.includes('OBS'));
            const idxTelefoneComprador = this.findHeaderColumnIndex(
                normalizedHeaders,
                (h, idx) => (h.includes('TELEFONE') || h.includes('TEL') || h.includes('FONE')) && idx < idxNomeParticipante,
            );
            const idxEmailComprador = this.findHeaderColumnIndex(normalizedHeaders, (h, idx) => (h === 'E-MAIL' || h === 'EMAIL') && idx < idxNomeParticipante);
            const idxTelefoneParticipante = this.findHeaderColumnIndex(
                normalizedHeaders,
                (h, idx) => (h.includes('TELEFONE') || h.includes('TEL') || h.includes('FONE')) && idx > idxNomeParticipante,
            );
            const idxEmailParticipante = this.findHeaderColumnIndex(normalizedHeaders, (h, idx) => (h === 'E-MAIL' || h === 'EMAIL') && idx > idxNomeParticipante);
            let idxTransferencia = this.findHeaderColumnIndex(
                normalizedHeaders,
                (h, idx) => (h.includes('TRANSFER') || h.includes('TRANFER')) && idx > idxStatusPrincipal,
            );
            if (idxTransferencia < 0 && idxStatusPrincipal >= 0 && idxStatusPrincipal + 1 < headerRow.length) {
                idxTransferencia = idxStatusPrincipal + 1;
            }

            for (let i = dataStart; i < rows.length; i++) {
                const row = rows[i] || [];
                const parceiroNome = String(row[idxParceiro] ?? '').trim();
                const participanteNome = String(row[idxNomeParticipante] ?? '').trim();
                const compradorEmail = String(row[idxEmailComprador] ?? '').trim();
                const participanteEmail = String(row[idxEmailParticipante] ?? '').trim();
                const compradorTelefone = String(row[idxTelefoneComprador] ?? '').trim();
                const participanteTelefone = String(row[idxTelefoneParticipante] ?? '').trim();
                const obs = idxObs >= 0 ? String(row[idxObs] ?? '').trim() : '';
                const status = String(row[idxStatusPrincipal] ?? '').trim();
                const turmaTransferenciaDestino = idxTransferencia >= 0 ? String(row[idxTransferencia] ?? '').trim() : '';

                const nome = participanteNome || parceiroNome;
                const email = participanteEmail || compradorEmail;
                const telefone = participanteTelefone || compradorTelefone;
                const isBonus = Boolean(participanteNome || participanteEmail || participanteTelefone);

                if (!nome && !email && !telefone && !obs && !status && !turmaTransferenciaDestino) {
                    continue;
                }

                parsed.push({
                    linha: i + 1,
                    nome,
                    email,
                    telefone,
                    obs,
                    status,
                    turmaTransferenciaDestino,
                    isBonus,
                    emailTitular: compradorEmail,
                    telefoneTitular: compradorTelefone,
                    hasEmailBonus: Boolean(participanteEmail),
                    hasTelefoneBonus: Boolean(participanteTelefone),
                });
            }

            return parsed;
        }

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
                turmaTransferenciaDestino: '',
                isBonus: false,
                emailTitular: '',
                telefoneTitular: '',
                hasEmailBonus: false,
                hasTelefoneBonus: false,
            });
        }

        return parsed;
    }

    private findHeaderIndex(rows: any[][]): number {
        const maxScan = Math.min(rows.length, 10);
        for (let i = 0; i < maxScan; i++) {
            const row = rows[i] || [];
            const joined = this.normalizeText(row.map((v) => String(v ?? '')).join(' '));
            const hasParceiro = joined.includes('PARCEIRO');
            const hasEmail = joined.includes('E-MAIL') || joined.includes('EMAIL');
            const hasTelefone = joined.includes('TELEFONE') || joined.includes('FONE');
            if (hasParceiro && hasEmail && hasTelefone) {
                return i;
            }
        }
        return 1;
    }

    private findHeaderColumnIndex(headers: string[], matcher: (header: string, index: number) => boolean): number {
        for (let i = 0; i < headers.length; i++) {
            if (matcher(headers[i], i)) return i;
        }
        return -1;
    }

    private chooseStatus(statusH: string, statusI: string, hasStatusH: boolean, hasStatusI: boolean): string {
        const h = this.normalizeText(statusH);
        const i = this.normalizeText(statusI);
        const known = ['CONFIRMADO', 'CONFIRMADOS', 'CONFIRMACAO', 'CONFIRMACOES', 'EXCLUIR', 'CANCELADO'];

        if (known.some((k) => i.includes(k))) return statusI;
        if (known.some((k) => h.includes(k))) return statusH;

        if (hasStatusI && statusI) return statusI;
        if (hasStatusH && statusH) return statusH;
        if (statusI) return statusI;
        if (statusH) return statusH;

        return '';
    }

    private isStatusHeader(value: unknown): boolean {
        const normalized = this.normalizeText(typeof value === 'string' || typeof value === 'number' ? String(value) : '');
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

    private async ensureBidirectionalAlunoVinculo(params: {
        titularAlunoId: number;
        bonusAlunoId: number;
        turmaId: number;
        tipoVinculo: ETipoVinculoAluno;
    }): Promise<void> {
        const relationsToEnsure = [
            { id_aluno: params.titularAlunoId, id_aluno_vinculado: params.bonusAlunoId },
            { id_aluno: params.bonusAlunoId, id_aluno_vinculado: params.titularAlunoId },
        ];

        for (const rel of relationsToEnsure) {
            const exists = await this.uow.alunosVinculosRP.findOne({
                where: {
                    id_aluno: rel.id_aluno,
                    id_aluno_vinculado: rel.id_aluno_vinculado,
                    tipo_vinculo: params.tipoVinculo,
                    id_turma: params.turmaId,
                    deletado_em: null,
                },
            });
            if (exists) continue;

            const vinculo = this.uow.alunosVinculosRP.create({
                id_aluno: rel.id_aluno,
                id_aluno_vinculado: rel.id_aluno_vinculado,
                tipo_vinculo: params.tipoVinculo,
                id_turma: params.turmaId,
            });
            await this.uow.alunosVinculosRP.save(vinculo);
        }
    }

    private normalizeCodeKey(value: string): string {
        return this.normalizeText(value).replace(/\s+/g, '_');
    }

    private buildBonusEmailFromBaseWithEvent(email: string, bonusIndex: number, eventoSlug: string): string {
        const normalized = (email || '').trim().toLowerCase();
        const safeEvento = (eventoSlug || 'evento').replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'evento';
        const atIndex = normalized.indexOf('@');
        if (atIndex <= 0) {
            return `${normalized}+bonus${bonusIndex}-${safeEvento}@sememail.com`;
        }
        const local = normalized.slice(0, atIndex);
        const domain = normalized.slice(atIndex + 1);
        return `${local}+bonus${bonusIndex}-${safeEvento}@${domain}`;
    }

    private async resolveTurmaIdByCodigo(params: { codigoRaw: string; turmaCodigoMap: Map<string, number> }): Promise<{
        turmaId: number | null;
        matchType: 'codigo' | 'edicao' | 'ambigua' | 'nao_encontrada';
        turmaCodigoNormalizado: string;
    }> {
        const codigoRaw = (params.codigoRaw || '').trim();
        const codigoNormalizado = this.normalizeCodeKey(codigoRaw);
        if (!codigoRaw) {
            return { turmaId: null, matchType: 'nao_encontrada', turmaCodigoNormalizado: codigoNormalizado };
        }

        const turmaByCodigo = params.turmaCodigoMap.get(codigoNormalizado) || null;
        if (turmaByCodigo) {
            return { turmaId: turmaByCodigo, matchType: 'codigo', turmaCodigoNormalizado: codigoNormalizado };
        }

        const turmasPorEdicao = await this.uow.turmasRP.find({
            where: {
                edicao_turma: ILike(codigoRaw),
                deletado_em: null,
            },
        });
        if (turmasPorEdicao.length === 1) {
            return {
                turmaId: turmasPorEdicao[0].id,
                matchType: 'edicao',
                turmaCodigoNormalizado: codigoNormalizado,
            };
        }
        if (turmasPorEdicao.length > 1) {
            return { turmaId: null, matchType: 'ambigua', turmaCodigoNormalizado: codigoNormalizado };
        }

        return { turmaId: null, matchType: 'nao_encontrada', turmaCodigoNormalizado: codigoNormalizado };
    }

    private normalizeEmail(value: string): string {
        const raw = (value || '').trim().toLowerCase();
        const matched = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
        if (matched?.[0]) {
            return matched[0].toLowerCase().trim();
        }

        const cleaned = raw
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
        const nomeToken =
            this.normalizeText(nome)
                .replace(/[^A-Z0-9]/g, '')
                .toLowerCase()
                .slice(0, 12) || 'aluno';
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
        const statusNaoConfirmado = statusNormalizado.includes('NAO CONFIRM');
        const statusConfirmado = /CONFIRMAD|CONFIRMACA/.test(statusNormalizado);
        if (statusConfirmado && !statusNaoConfirmado) {
            return EStatusAlunosTurmas.CHECKIN_REALIZADO;
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
