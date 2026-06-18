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
    '+ Inscrições Confronto'?: boolean;
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
            const isBonusFromObs = obsNormalizada.includes('BONUS');
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

            const nomePreferencialPorEmail = this.buildPreferredNameByEmail(candidates);
            const alunosParaAtualizar = Array.from(alunoByEmail.values()).filter((aluno) => {
                const nomeDesejado = nomePreferencialPorEmail.get(aluno.email);
                if (!nomeDesejado) return false;

                const nomeAtual = String(aluno.nome || '').trim();
                const nomeCrachaAtual = String(aluno.nome_cracha || '').trim();
                const nomeDesejadoNormalizado = this.normalizeText(nomeDesejado);

                const nomeAtualInvalido = !nomeAtual || this.isDateLikeText(nomeAtual);
                const nomeCrachaInvalido = !nomeCrachaAtual || this.isDateLikeText(nomeCrachaAtual);
                const nomeAtualDiferente = this.normalizeText(nomeAtual) !== nomeDesejadoNormalizado;
                const nomeCrachaDiferente = this.normalizeText(nomeCrachaAtual) !== nomeDesejadoNormalizado;

                return nomeAtualInvalido || nomeCrachaInvalido || nomeAtualDiferente || nomeCrachaDiferente;
            });

            if (alunosParaAtualizar.length > 0) {
                for (const aluno of alunosParaAtualizar) {
                    const nomeDesejado = nomePreferencialPorEmail.get(aluno.email);
                    if (!nomeDesejado) continue;
                    aluno.nome = nomeDesejado;
                    aluno.nome_cracha = nomeDesejado;
                }
                await this.uow.alunosRP.save(alunosParaAtualizar, { chunk: alunosChunkSize });
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

            // Congela a meta no novo pico de inscritos/extras das turmas de destino da importação.
            await this.uow.bumparPicoMetricasTurmas(turmaIdsDestino);

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

    async importarAlunosMasterclassPlanilha(
        file: Express.Multer.File,
        confirmar = false,
        options: { restringirDestinoEsteiraLiberty?: boolean } = {},
    ): Promise<ImportarAlunosPlanilhaResponse> {
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

        // Importação da esteira do Liberty: só aceita alunos cuja turma de destino seja
        // Imersão de Negócios (IDN) ou Legacy XP. As demais regras (origem, bônus,
        // inscrições) seguem idênticas à importação de Masterclass e Time de Vendas.
        const restringirEsteiraLiberty = options.restringirDestinoEsteiraLiberty === true;

        // Na esteira do Liberty, além do modelo padrão da Masterclass, aceitamos a
        // planilha do Time de Vendas (aba "Implantacao_Liberty_IAMControl"), que usa
        // colunas próprias (NOME TITULAR CONTRATO, WHATSAPP, SIGLA EVENTOS, etc.).
        let rows: any[][];
        let parsedRows: ReturnType<UploadService['parseMasterclassSpreadsheetRows']>;
        const libertyImplantacaoRows = restringirEsteiraLiberty ? this.parseLibertyImplantacaoXlsxRows(file.buffer) : null;
        if (libertyImplantacaoRows) {
            rows = libertyImplantacaoRows;
            parsedRows = this.parseLibertyImplantacaoRows(libertyImplantacaoRows);
        } else {
            rows = this.parseMasterclassXlsxRows(file.buffer);
            parsedRows = this.parseMasterclassSpreadsheetRows(rows);
        }
        void rows;
        const turmaCodigoMap = await this.buildTurmaCodigoMap();
        const turmaConfrontoMap = await this.buildTurmaConfrontoMap();
        const turmaImersaoProsperarMap = await this.buildTurmaImersaoProsperarMap();
        const turmaEsteiraLibertyMap = restringirEsteiraLiberty ? await this.buildTurmaEsteiraLibertyMap() : null;
        const turmaLookupCache = new Map<
            string,
            {
                turmaId: number | null;
                matchType: 'codigo' | 'edicao' | 'ambigua' | 'nao_encontrada';
                turmaCodigoNormalizado: string;
            }
        >();

        const erros: string[] = [];
        const avisos: string[] = [];
        const preview: ImportPreviewItem[] = [];
        let totalCriadas = 0;
        let totalAtualizadas = 0;
        let totalSemTurma = 0;
        const inscricoesGeradasPorPessoa = new Map<string, number>();

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
            modoConfronto: boolean;
            statusPlanilha: string;
            statusFinal: EStatusAlunosTurmas;
            origemFinal: EOrigemAlunos;
            idTurmaTransferenciaDe: number | null;
            /** Coluna TURMA ORIGEM na planilha (persistido para MC sem turma cadastrada). */
            codigoTurmaOrigemPlanilha: string | null;
            /** E-mail do titular (1ª inscrição/compra) para vincular bônus gerados por regra de evento→IPR. */
            titularBonusEmail?: string;
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
                cache: turmaLookupCache,
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
            if (restringirEsteiraLiberty && turmaEsteiraLibertyMap?.get(turmaDestinoId) !== true) {
                erros.push(
                    `Linha ${row.linha}: turma de destino "${row.turmaDestinoCodigo}" não pertence à esteira do Liberty (Imersão de Negócios ou Legacy XP). Importação permitida apenas para turmas de IDN e Legacy XP.`,
                );
                continue;
            }
            const isTurmaDestinoConfronto = turmaConfrontoMap.get(turmaDestinoId) === true;

            const origemMasterclass = this.normalizeMasterclassTurmaOrigem(row.turmaOrigemCodigo);
            // Regra: quando a origem é uma Masterclass (código MC_*), todas as
            // inscrições são compra de ingresso (COMPROU_INGRESSO), mesmo quando
            // NÚMERO DE INSCRIÇÕES > 1. Os demais inscritos da mesma linha entram
            // como compradores — nunca como bônus/convidado.
            const origemEhMasterclass = this.normalizeCodeKey(row.turmaOrigemCodigo).startsWith('MC_');
            const isBonusOrigemMasterclass = origemMasterclass.isBonusOrigem && !origemEhMasterclass;
            const codigoOrigem = this.normalizeCodeKey(origemMasterclass.codigoParaLookup || row.turmaOrigemCodigo);
            const origemVenda = origemMasterclass.isTimeDeVendas;
            const origemRaw = String(row.turmaOrigemCodigo || '').trim();
            const exibirCodigoExtraido =
                Boolean(origemMasterclass.codigoParaLookup) && this.normalizeCodeKey(origemRaw) !== this.normalizeCodeKey(origemMasterclass.codigoParaLookup);
            const origemAvisoLabel = exibirCodigoExtraido ? `"${origemRaw}" (código extraído: "${origemMasterclass.codigoParaLookup}")` : `"${origemRaw}"`;

            /** Mesma resolução que o destino: código completo no mapa ou match por edição (único). */
            let idTurmaTransferenciaDe: number | null = null;
            if (!origemVenda && String(origemMasterclass.codigoParaLookup || '').trim()) {
                const origemLookup = await this.resolveTurmaIdByCodigo({
                    codigoRaw: origemMasterclass.codigoParaLookup,
                    turmaCodigoMap,
                    cache: turmaLookupCache,
                });
                if (origemLookup.matchType === 'ambigua') {
                    erros.push(
                        `Linha ${row.linha}: turma de origem ${origemAvisoLabel} é ambígua (mais de uma turma com essa edição). Informe o código completo da turma (SIGLA_CURSO_SIGLA_POLO_EDICAO).`,
                    );
                    continue;
                }
                if (origemLookup.matchType === 'edicao') {
                    avisos.push(`Linha ${row.linha}: turma de origem ${origemAvisoLabel} encontrada por edição.`);
                }
                idTurmaTransferenciaDe = origemLookup.turmaId;
                if (!idTurmaTransferenciaDe && codigoOrigem) {
                    const origemEhMc = codigoOrigem.startsWith('MC_');
                    const sufixoMasterclass = origemEhMc ? ' Origens MC_* continuam contando como Masterclass no resumo da turma.' : '';
                    avisos.push(
                        `Linha ${row.linha}: turma de origem ${origemAvisoLabel} não encontrada no cadastro; importação sem vínculo de turma.${sufixoMasterclass}`,
                    );
                }
            }

            const codigoDestino = this.normalizeCodeKey(row.turmaDestinoCodigo);
            // Dois registros são tratados como o mesmo aluno (continuando a numeração de
            // inscrições/bônus) quando nome, e-mail e telefone são iguais para a mesma
            // origem/destino. Isso garante que o cenário "2 registros sem quantidade"
            // gere o mesmo resultado do cenário "1 registro com mais de uma inscrição".
            const dedupeKey = `${nomeNormalizado}|${emailNormalizado}|${telefoneNormalizado}|${codigoOrigem}|${codigoDestino}`;
            const inscricoesJaGeradas = inscricoesGeradasPorPessoa.get(dedupeKey) || 0;

            const quantidadeInscricoes = Math.max(1, row.quantidadeInscricoes || 1);
            // Regra: a coluna QUANTIDADE DE BÔNUS é respeitada para qualquer origem
            // (inclusive Masterclass MC_*). Os bônus são alocados na turma indicada em
            // "BÔNUS PARA QUAL TURMA?"; quando não há turma de bônus válida (vazio ou um
            // texto/nome), o bônus é ignorado por não haver turma de destino para alocá-lo.
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
                        cache: turmaLookupCache,
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

            const statusImportacao = EStatusAlunosTurmas.FALTA_ENVIAR_LINK_CONFIRMACAO;
            const slugEvento = this.normalizeCodeKey(row.turmaDestinoCodigo || 'EVENTO').toLowerCase();
            const codigoTurmaOrigemPlanilha = origemVenda ? null : origemMasterclass.codigoTurmaOrigemPlanilha;

            // Classificação de origem/destino para definir a mecânica das inscrições.
            const destinoEhIPR = turmaImersaoProsperarMap.get(turmaDestinoId) === true;
            const origemEhImersaoNegocios = codigoOrigem.startsWith('IDN_') || codigoOrigem === 'IDN';
            // "Evento" = origem que não é Masterclass (MC_*), nem Imersão de Negócios
            // (IDN_*), nem Time de Vendas, nem origem-bônus explícita, e possui código
            // (ex.: IPR_*, CONF_*, MG_*).
            const origemEhEvento = !origemEhMasterclass && !origemEhImersaoNegocios && !origemVenda && !isBonusOrigemMasterclass && Boolean(codigoOrigem);
            // Regra: destino IPR (Imersão Prosperar) + origem de evento — a 1ª inscrição
            // é compra (COMPROU_INGRESSO) e as demais entram como bônus do titular
            // ("nome bonus N", com o mesmo complemento no e-mail). Nos demais casos
            // (MC_*/IDN_* → IPR e qualquer origem → destino diferente de IPR) todas as
            // inscrições permanecem como compra ("nome insc N").
            const aplicarBonusEventoIPR = destinoEhIPR && origemEhEvento;
            if (aplicarBonusEventoIPR && quantidadeInscricoes > 1) {
                avisos.push(
                    `Linha ${row.linha}: destino IPR com origem de evento ${origemAvisoLabel} — 1ª inscrição como compra e as demais (${quantidadeInscricoes - 1}) como bônus do titular.`,
                );
            }

            // Regra nova: todas as inscrições vão para a turma de destino.
            for (let i = 0; i < quantidadeInscricoes; i++) {
                const numeroInscricao = inscricoesJaGeradas + i + 1;
                const isPrimeiraInscricao = numeroInscricao === 1;
                // 1ª inscrição é sempre o titular/compra; as demais viram bônus apenas
                // quando a regra evento→IPR se aplica. O índice de bônus reinicia em 1.
                const ehBonusEventoIPR = aplicarBonusEventoIPR && !isPrimeiraInscricao;
                const bonusIndex = numeroInscricao - 1;
                const isBonusInscricao = isBonusOrigemMasterclass || ehBonusEventoIPR;

                let nomeCracha: string;
                let emailCandidato: string;
                if (isPrimeiraInscricao) {
                    nomeCracha = row.nome.trim();
                    emailCandidato = emailNormalizado;
                } else if (ehBonusEventoIPR) {
                    nomeCracha = `${row.nome.trim()} bonus ${bonusIndex}`;
                    emailCandidato = this.buildBonusEmailFromBase(emailNormalizado, bonusIndex);
                } else {
                    nomeCracha = `${row.nome.trim()} insc ${numeroInscricao}`;
                    emailCandidato = this.buildInscricaoEmailFromBase(emailNormalizado, numeroInscricao);
                }

                candidates.push({
                    linha: row.linha,
                    nomeOriginal: row.nome.trim(),
                    nomeCracha,
                    cpfCnpj: row.cpfCnpj,
                    email: emailCandidato,
                    titularEmail: emailNormalizado,
                    emailGeradoAutomaticamente: emailGeradoAutomaticamente || !isPrimeiraInscricao,
                    telefone: telefoneNormalizado,
                    turmaDestinoId,
                    turmaDestinoCodigo: row.turmaDestinoCodigo,
                    turmaOrigemCodigo: origemMasterclass.codigoParaLookup || row.turmaOrigemCodigo,
                    turmaOrigemDescricao: origemMasterclass.descricao || row.turmaOrigemCodigo,
                    dataInclusao: row.dataInclusao,
                    quantidadeBonus: quantidadeBonusExtraPorPessoa,
                    quantidadeBonusExtraPorPessoa,
                    turmaBonusCodigo: turmaBonusCodigoFinal || undefined,
                    isTimeDeVendas: origemVenda,
                    isBonusEntry: isBonusInscricao,
                    isBonusExtraEntry: false,
                    modoConfronto: isTurmaDestinoConfronto,
                    statusPlanilha: `INCLUSAO:${row.dataInclusao || '-'}`,
                    statusFinal: statusImportacao,
                    origemFinal: isBonusInscricao ? EOrigemAlunos.ALUNO_BONUS : EOrigemAlunos.COMPROU_INGRESSO,
                    idTurmaTransferenciaDe,
                    codigoTurmaOrigemPlanilha,
                    titularBonusEmail: ehBonusEventoIPR ? emailNormalizado : undefined,
                });
            }

            inscricoesGeradasPorPessoa.set(dedupeKey, inscricoesJaGeradas + quantidadeInscricoes);

            // Regra nova: bônus da planilha gera vagas na turma de bônus.
            if (!turmaBonusId || quantidadeBonusExtraPorPessoa <= 0) {
                continue;
            }

            for (let bonusExtraPos = 0; bonusExtraPos < quantidadeBonusExtraPorPessoa; bonusExtraPos++) {
                const numeradorExtra = bonusExtraPos + 1;
                const nomeCrachaBonusExtra = `${row.nome.trim()} bonus ${numeradorExtra} ${row.turmaDestinoCodigo}`.trim();
                const emailBonusExtra = this.buildBonusEmailFromBaseWithEvent(emailNormalizado, numeradorExtra, slugEvento);

                candidates.push({
                    linha: row.linha,
                    nomeOriginal: row.nome.trim(),
                    nomeCracha: nomeCrachaBonusExtra,
                    cpfCnpj: row.cpfCnpj,
                    email: emailBonusExtra,
                    titularEmail: emailNormalizado,
                    emailGeradoAutomaticamente: true,
                    telefone: telefoneNormalizado,
                    turmaDestinoId: turmaBonusId,
                    turmaDestinoCodigo: turmaBonusCodigoFinal,
                    turmaOrigemCodigo: origemMasterclass.codigoParaLookup || row.turmaOrigemCodigo,
                    turmaOrigemDescricao: origemMasterclass.descricao || row.turmaOrigemCodigo,
                    dataInclusao: row.dataInclusao,
                    quantidadeBonus: 0,
                    quantidadeBonusExtraPorPessoa,
                    turmaBonusCodigo: turmaBonusCodigoFinal || undefined,
                    isTimeDeVendas: origemVenda,
                    isBonusEntry: true,
                    isBonusExtraEntry: true,
                    modoConfronto: false,
                    statusPlanilha: `BONUS_EXTRA:${row.dataInclusao || '-'}`,
                    statusFinal: statusImportacao,
                    origemFinal: EOrigemAlunos.ALUNO_BONUS,
                    idTurmaTransferenciaDe: null,
                    codigoTurmaOrigemPlanilha,
                });
            }
        }

        const emailsUnicos = Array.from(new Set(candidates.map((c) => c.email)));
        const firstCandidateByEmail = new Map<string, (typeof candidates)[number]>();
        for (const candidate of candidates) {
            if (!firstCandidateByEmail.has(candidate.email)) {
                firstCandidateByEmail.set(candidate.email, candidate);
            }
        }
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
                    const base = firstCandidateByEmail.get(email);
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

            const nomePreferencialPorEmail = this.buildPreferredNameByEmail(candidates);
            const alunosParaAtualizar = Array.from(alunoByEmail.values()).filter((aluno) => {
                const nomeDesejado = nomePreferencialPorEmail.get(aluno.email);
                if (!nomeDesejado) return false;

                const nomeAtual = String(aluno.nome || '').trim();
                const nomeCrachaAtual = String(aluno.nome_cracha || '').trim();
                const nomeDesejadoNormalizado = this.normalizeText(nomeDesejado);

                const nomeAtualInvalido = !nomeAtual || this.isDateLikeText(nomeAtual);
                const nomeCrachaInvalido = !nomeCrachaAtual || this.isDateLikeText(nomeCrachaAtual);
                const nomeAtualDiferente = this.normalizeText(nomeAtual) !== nomeDesejadoNormalizado;
                const nomeCrachaDiferente = this.normalizeText(nomeCrachaAtual) !== nomeDesejadoNormalizado;

                return nomeAtualInvalido || nomeCrachaInvalido || nomeAtualDiferente || nomeCrachaDiferente;
            });

            if (alunosParaAtualizar.length > 0) {
                for (const aluno of alunosParaAtualizar) {
                    const nomeDesejado = nomePreferencialPorEmail.get(aluno.email);
                    if (!nomeDesejado) continue;
                    aluno.nome = nomeDesejado;
                    aluno.nome_cracha = nomeDesejado;
                }
                await this.uow.alunosRP.save(alunosParaAtualizar, { chunk: alunosChunkSize });
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
            codigo_turma_origem_planilha: string | null;
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
                // Para bônus gerados pela regra evento→IPR, o titular pode estar em
                // outra linha da planilha (2 registros do mesmo aluno). Nesse caso o
                // firstAlunoIdByLinha (indexado por linha) não resolve, então usamos o
                // e-mail do titular (1ª inscrição/compra) como fallback.
                const idTitularViaEmail =
                    isBonus && item.titularBonusEmail && aluno
                        ? (() => {
                              const titular = alunoByEmail.get(item.titularBonusEmail);
                              return titular && String(titular.id) !== String(aluno.id) ? String(titular.id) : null;
                          })()
                        : null;
                const idAlunoBonus = isBonus ? firstAlunoIdByLinha.get(item.linha) || idTitularViaEmail || null : null;

                if (existeVinculo) {
                    if (!isBonus && aluno && !firstAlunoIdByLinha.has(item.linha)) {
                        firstAlunoIdByLinha.set(item.linha, String(aluno.id));
                    }
                    if (confirmar && vinculoPersistido) {
                        vinculoPersistido.status_aluno_turma = item.statusFinal;
                        vinculoPersistido.origem_aluno = item.origemFinal;
                        vinculoPersistido.id_aluno_bonus = idAlunoBonus;
                        // Ver comentário no create: importação não é transferência; mantém o
                        // campo nulo (origem do evento fica em codigo_turma_origem_planilha).
                        vinculoPersistido.id_turma_transferencia_de = null;
                        vinculoPersistido.codigo_turma_origem_planilha = item.codigoTurmaOrigemPlanilha;
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
                        '+ Inscrições Confronto': item.modoConfronto,
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
                        '+ Inscrições Confronto': item.modoConfronto,
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
                        // Importação cria ingresso (COMPROU_INGRESSO) / bônus — nunca uma
                        // transferência entre turmas. A turma de origem do evento fica em
                        // codigo_turma_origem_planilha e no historico_transferencias_alunos;
                        // o campo de transferência fica nulo para não "semear" origem errada
                        // que seria propagada em transferências futuras.
                        id_turma_transferencia_de: null,
                        codigo_turma_origem_planilha: item.codigoTurmaOrigemPlanilha,
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
                    '+ Inscrições Confronto': item.modoConfronto,
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

            // Congela a meta no novo pico de inscritos/extras das turmas de destino da importação.
            await this.uow.bumparPicoMetricasTurmas(turmaIdsDestino);

            const vinculosSalvos =
                idsAlunosExistentes.length > 0 && turmaIdsDestino.length > 0
                    ? await this.uow.turmasAlunosRP.find({
                          where: {
                              id_turma: In(turmaIdsDestino),
                              id_aluno: In(idsAlunosExistentes),
                              deletado_em: null,
                          },
                      })
                    : [];
            const vinculoSalvoByKey = new Map(vinculosSalvos.map((vinculo) => [`${vinculo.id_turma}|${vinculo.id_aluno}|${vinculo.nome_cracha}`, vinculo]));

            const idsAlunosNumericos = Array.from(new Set(Array.from(alunoByEmail.values()).map((aluno) => aluno.id)));
            const historicosExistentes =
                idsAlunosNumericos.length > 0 && turmaIdsDestino.length > 0
                    ? await this.uow.historicoTransferenciasRP.find({
                          where: {
                              id_aluno: In(idsAlunosNumericos),
                              id_turma_para: In(turmaIdsDestino),
                          },
                          select: ['id_aluno', 'id_turma_para', 'id_turma_aluno_para'],
                      })
                    : [];
            const historicoExistenteKeys = new Set(
                historicosExistentes.map((historico) => `${historico.id_aluno}|${historico.id_turma_para}|${historico.id_turma_aluno_para}`),
            );
            const historicosParaCriar: Array<ReturnType<typeof this.uow.historicoTransferenciasRP.create>> = [];

            // Para cada candidato, usar vínculo já carregado e criar histórico + vínculo de bônus
            for (const cand of candidates) {
                const aluno = alunoByEmail.get(cand.email);
                if (!aluno) continue;

                const vinculoKey = `${cand.turmaDestinoId}|${String(aluno.id)}|${cand.nomeCracha}`;
                const vinculoSalvo = vinculoSalvoByKey.get(vinculoKey);
                if (!vinculoSalvo) continue;

                // Criar histórico para Time de Vendas ou transferência de masterclass
                if (cand.isTimeDeVendas || cand.idTurmaTransferenciaDe) {
                    const historicoKey = `${aluno.id}|${cand.turmaDestinoId}|${vinculoSalvo.id}`;
                    if (!historicoExistenteKeys.has(historicoKey)) {
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
                        historicosParaCriar.push(historico);
                        historicoExistenteKeys.add(historicoKey);
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

            if (historicosParaCriar.length > 0) {
                await this.uow.historicoTransferenciasRP.save(historicosParaCriar, {
                    chunk: vinculosChunkSize,
                });
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

        const abaSubirAluno = workbook.SheetNames.find((sheetName) => {
            const normalized = this.normalizeText(String(sheetName || ''));
            const allowedPatterns = ['SUBIR ALUNO', 'SUBIR', 'IAM CONTROL'];
            return allowedPatterns.some((pattern) => normalized === pattern || normalized.includes(pattern));
        });

        if (!abaSubirAluno) {
            throw new BadRequestException('A planilha deve conter uma aba com "Subir aluno", "Subir" ou "IAM Control" no nome');
        }

        const worksheet = workbook.Sheets[abaSubirAluno];
        return this.sheetToRowsWithColumnCap(worksheet, 32);
    }

    private parseMasterclassXlsxRows(buffer: Buffer): any[][] {
        const workbook = XLSX.read(buffer, {
            type: 'buffer',
            cellDates: true,
            raw: false,
        });

        if (!workbook.SheetNames.length) {
            throw new BadRequestException('Planilha sem abas');
        }

        const normalizeSheetName = (sheetName: string) => this.normalizeText(String(sheetName || '')).replace(/[\s./-]/g, '');

        const hasMasterclassHeaders = (rows: any[][]): boolean => {
            if (!rows.length) return false;
            const header = (rows[0] || []).map((cell) => this.normalizeText(String(cell || '')));
            const hasTurmaOrigem = header.some((h) => h.includes('TURMA ORIGEM'));
            const hasTurmaDestino = header.some((h) => h.includes('TURMA DESTINO'));
            const hasInscricoes = header.some((h) => h.includes('NUMERO DE INSCRICOES'));
            return hasTurmaOrigem && hasTurmaDestino && hasInscricoes;
        };

        const getRowsFromSheet = (sheetName: string): any[][] => {
            const sheet = workbook.Sheets[sheetName];
            return this.sheetToRowsWithColumnCap(sheet, 16);
        };

        // Seleção por estrutura (modelo de colunas), sem priorizar data/aba específica:
        // 1) tenta primeiro abas de "subir aluno"/"iam control";
        // 2) depois escolhe a aba com estrutura masterclass e mais linhas.
        const candidateByName = workbook.SheetNames.find((sheetName) => {
            const normalized = normalizeSheetName(sheetName);
            return normalized.includes('SUBIRALUNO') || normalized.includes('SUBIR') || normalized.includes('IAMCONTROL');
        });
        if (candidateByName) {
            const rows = getRowsFromSheet(candidateByName);
            if (hasMasterclassHeaders(rows)) {
                return rows;
            }
        }

        // Fallback: escolhe a aba com cabeçalho masterclass e maior volume de dados.
        let selectedRows: any[][] | null = null;
        let selectedDataSize = -1;
        for (const sheetName of workbook.SheetNames) {
            const rows = getRowsFromSheet(sheetName);
            if (!hasMasterclassHeaders(rows)) continue;

            const dataSize = Math.max(0, rows.length - 1);
            if (dataSize > selectedDataSize) {
                selectedRows = rows;
                selectedDataSize = dataSize;
            }
        }

        if (selectedRows) {
            return selectedRows;
        }

        // Último fallback: mantém comportamento legado.
        return this.parseXlsxRows(buffer);
    }

    /**
     * Evita estouro de memória em planilhas com range muito largo (milhares de colunas vazias "formatadas").
     * Lê apenas as primeiras colunas relevantes para os importadores.
     */
    private sheetToRowsWithColumnCap(sheet: XLSX.WorkSheet, maxColumns: number): any[][] {
        if (!sheet) return [];
        const ref = sheet['!ref'];
        if (!ref) return [];

        const range = XLSX.utils.decode_range(ref);
        const cappedEndCol = Math.min(range.e.c, Math.max(0, maxColumns - 1));
        const rows: any[][] = [];

        for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex++) {
            const row: any[] = [];

            for (let colIndex = range.s.c; colIndex <= cappedEndCol; colIndex++) {
                const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
                const cell = sheet[address];

                if (!cell) {
                    row.push('');
                    continue;
                }

                const formatted = XLSX.utils.format_cell(cell);
                row.push(typeof formatted === 'string' ? formatted : String(formatted ?? cell.v ?? ''));
            }

            // Reduz payload removendo cauda vazia sem afetar busca por cabeçalho.
            while (row.length > 0 && (row[row.length - 1] === '' || row[row.length - 1] === null || row[row.length - 1] === undefined)) {
                row.pop();
            }

            rows.push(row);
        }

        return rows;
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

    /**
     * Lê a planilha do Time de Vendas usada na esteira do Liberty
     * (aba "Implantacao_Liberty_IAMControl"). Diferente do modelo padrão da
     * Masterclass, esta planilha tem colunas próprias: NOME TITULAR CONTRATO,
     * WHATSAPP, E-MAIL, DATA DA VENDA, SIGLA EVENTOS e Nª DOCUMENTO. Retorna
     * `null` quando a planilha não está nesse formato (para cair no parser padrão).
     */
    private parseLibertyImplantacaoXlsxRows(buffer: Buffer): any[][] | null {
        const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
        if (!workbook.SheetNames.length) return null;

        const normalizeSheetName = (sheetName: string) => this.normalizeText(String(sheetName || '')).replace(/[\s./-]/g, '');

        const hasLibertyImplantacaoHeaders = (rows: any[][]): boolean => {
            if (!rows.length) return false;
            const header = (rows[0] || []).map((cell) => this.normalizeText(String(cell || '')));
            const hasSiglaEventos = header.some((h) => h.includes('SIGLA EVENTOS'));
            const hasTitular = header.some((h) => h.includes('NOME TITULAR') || h.includes('TITULAR CONTRATO'));
            const hasContato = header.some((h) => h.includes('WHATSAPP') || h === 'E-MAIL' || h === 'EMAIL');
            return hasSiglaEventos && hasTitular && hasContato;
        };

        // SIGLA EVENTOS fica na ~19ª coluna; lemos um pouco além para garantir.
        const getRowsFromSheet = (sheetName: string): any[][] => this.sheetToRowsWithColumnCap(workbook.Sheets[sheetName], 24);

        // 1) tenta a aba pelo nome conhecido da esteira do Liberty.
        const candidateByName = workbook.SheetNames.find((sheetName) => {
            const normalized = normalizeSheetName(sheetName);
            return normalized.includes('IMPLANTACAOLIBERTY') || (normalized.includes('LIBERTY') && normalized.includes('IAMCONTROL'));
        });
        if (candidateByName) {
            const rows = getRowsFromSheet(candidateByName);
            if (hasLibertyImplantacaoHeaders(rows)) return rows;
        }

        // 2) fallback: qualquer aba com a estrutura desta planilha (maior volume).
        let selectedRows: any[][] | null = null;
        let selectedDataSize = -1;
        for (const sheetName of workbook.SheetNames) {
            const rows = getRowsFromSheet(sheetName);
            if (!hasLibertyImplantacaoHeaders(rows)) continue;
            const dataSize = Math.max(0, rows.length - 1);
            if (dataSize > selectedDataSize) {
                selectedRows = rows;
                selectedDataSize = dataSize;
            }
        }

        return selectedRows;
    }

    private parseLibertyImplantacaoRows(rows: any[][]): ReturnType<UploadService['parseMasterclassSpreadsheetRows']> {
        if (rows.length < 2) {
            throw new BadRequestException('A planilha precisa conter cabeçalho e dados');
        }

        const headerRow = (rows[0] || []).map((cell) => this.normalizeText(String(cell || '')));
        const idxDocumento = headerRow.findIndex((h) => h.includes('DOCUMENTO'));
        const idxDataVenda = headerRow.findIndex((h) => h.includes('DATA DA VENDA'));
        const idxNome = headerRow.findIndex((h) => h.includes('NOME TITULAR') || h.includes('TITULAR CONTRATO'));
        const idxTelefone = headerRow.findIndex((h) => h.includes('WHATSAPP') || h.includes('TELEFONE'));
        const idxEmail = headerRow.findIndex((h) => h === 'E-MAIL' || h === 'EMAIL' || h.includes('E-MAIL'));
        const idxSiglaEventos = headerRow.findIndex((h) => h.includes('SIGLA EVENTOS'));

        if ([idxNome, idxTelefone, idxEmail, idxSiglaEventos].some((idx) => idx < 0)) {
            throw new BadRequestException('Modelo de planilha inválido para importação da esteira do Liberty (Time de Vendas)');
        }

        const parsed: ReturnType<UploadService['parseMasterclassSpreadsheetRows']> = [];

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i] || [];
            const documento = idxDocumento >= 0 ? String(row[idxDocumento] ?? '').trim() : '';
            const dataInclusao = idxDataVenda >= 0 ? String(row[idxDataVenda] ?? '').trim() : '';
            const nome = String(row[idxNome] ?? '').trim();
            const telefone = String(row[idxTelefone] ?? '').trim();
            const email = String(row[idxEmail] ?? '').trim();
            const siglaEventoRaw = String(row[idxSiglaEventos] ?? '').trim();
            const turmaDestinoCodigo = this.translateEventoSiglaToTurmaCodigo(siglaEventoRaw);

            // Linha vazia ou de placeholder (ex.: "EDIÇÃO SELECIONE") é ignorada.
            if (!nome && !telefone && !email && !turmaDestinoCodigo) continue;
            if (!turmaDestinoCodigo) continue;

            parsed.push({
                linha: i + 1,
                // Origem segue o Nª DOCUMENTO (TIMEDEVENDAS_*), tratado como Time de Vendas.
                turmaOrigemCodigo: documento || 'TIME_DE_VENDAS',
                dataInclusao,
                nome,
                cpfCnpj: '',
                telefone,
                email,
                turmaDestinoCodigo,
                // Cada linha é um titular: 1 inscrição, sem bônus.
                quantidadeInscricoes: 1,
                quantidadeBonusTurma: 0,
                turmaBonusCodigo: '',
            });
        }

        return parsed;
    }

    /**
     * Converte a SIGLA EVENTOS da planilha do Time de Vendas no código de turma
     * usado no IAM Control (SIGLA_TREINAMENTO_SIGLA_POLO_EDICAO):
     *   - IMERSAO_NEGOCIOS_AM_10 => IDN_AM_10
     *   - LEGACYXP_17 / LEGACY_XP_AM_17 => LXP_17 / LXP_AM_17
     * A resolução final (com polo/nome alternativos) acontece em
     * buildCodigoLookupAlternatives.
     */
    private translateEventoSiglaToTurmaCodigo(siglaEvento: string): string {
        const normalized = this.normalizeCodeKey(siglaEvento);
        if (!normalized) return '';
        // Placeholders da planilha não representam turma.
        if (normalized.includes('SELECIONE')) return '';
        if (normalized.startsWith('IMERSAO_NEGOCIOS')) {
            return normalized.replace(/^IMERSAO_NEGOCIOS/, 'IDN');
        }
        if (normalized.startsWith('LEGACY_XP')) {
            return normalized.replace(/^LEGACY_XP/, 'LXP');
        }
        if (normalized.startsWith('LEGACYXP')) {
            return normalized.replace(/^LEGACYXP/, 'LXP');
        }
        if (normalized.startsWith('LEGACY')) {
            return normalized.replace(/^LEGACY/, 'LXP');
        }
        return normalized;
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
        const idxParceiroNome = this.findHeaderColumnIndex(normalizedHeaders, (h) => h.includes('PARCEIRO'));
        const idxStatusPrincipal = this.findHeaderColumnIndex(normalizedHeaders, (h) => h === 'STATUS');
        const idxStatusFin = this.findHeaderColumnIndex(normalizedHeaders, (h) => h.includes('STATUS FIN'));
        const isLayoutTreinamentosGerais = idxNomeParticipante >= 0 && idxStatusPrincipal >= 0 && idxStatusPrincipal !== idxStatusFin;
        const idxNomePadrao = this.findHeaderColumnIndex(
            normalizedHeaders,
            (h) => h.includes('PARCEIRO') || h === 'NOME' || h.includes('NOME ') || h.includes(' CLIENTE') || h === 'CLIENTE',
        );
        const idxEmailPadrao = this.findHeaderColumnIndex(normalizedHeaders, (h) => h === 'E-MAIL' || h === 'EMAIL');
        const idxTelefonePadrao = this.findHeaderColumnIndex(normalizedHeaders, (h) => h.includes('TELEFONE') || h.includes('TEL') || h.includes('FONE'));
        const idxObsPadrao = this.findHeaderColumnIndex(normalizedHeaders, (h) => h.includes('OBSERV') || h.includes('OBS'));
        const idxStatusSecundario = this.findHeaderColumnIndex(normalizedHeaders, (h, idx) => h.includes('STATUS') && idx !== idxStatusPrincipal);
        const hasStatusH = idxStatusPrincipal >= 0 ? true : this.isStatusHeader(headerRow[7]);
        const hasStatusI = idxStatusSecundario >= 0 ? true : this.isStatusHeader(headerRow[8]);
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

                let nome = this.getPreferredNameByHeader(row, normalizedHeaders) || participanteNome || parceiroNome;
                const email = participanteEmail || compradorEmail;
                const telefone = participanteTelefone || compradorTelefone;
                const isBonus = Boolean(participanteNome || participanteEmail || participanteTelefone);
                if (!nome || this.isDateLikeText(nome)) {
                    const nomeFromObs = this.extractNameFromObs(obs);
                    const nomeFromRow = this.extractBestNameFromAnyColumn(row, [
                        idxNomeParticipante,
                        idxParceiro,
                        idxEmailComprador,
                        idxEmailParticipante,
                        idxTelefoneComprador,
                        idxTelefoneParticipante,
                        idxObs,
                        idxStatusPrincipal,
                        idxTransferencia,
                    ]);
                    nome = nomeFromObs || nomeFromRow || '';
                }
                if (this.isDateLikeText(nome)) {
                    nome = '';
                }

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
            let nome =
                this.getPreferredNameByHeader(row, normalizedHeaders) ||
                this.extractBestNameFromRow(row, [
                    idxNomePadrao,
                    idxParceiroNome,
                    1, // Layout legado: PARCEIRO/NOME
                    2, // Fallback para variações de template
                ]);
            const email = this.getFirstNonEmptyCellValue(row, [idxEmailPadrao, 4]);
            const telefone = this.getFirstNonEmptyCellValue(row, [idxTelefonePadrao, 5]);
            const obs = this.getFirstNonEmptyCellValue(row, [idxObsPadrao, 6]);
            const statusH = this.getFirstNonEmptyCellValue(row, [idxStatusPrincipal, 7], true);
            const statusI = this.getFirstNonEmptyCellValue(row, [idxStatusSecundario, 8], true);
            if (!nome || this.isDateLikeText(nome)) {
                const nomeFromObs = this.extractNameFromObs(obs);
                const nomeFromRow = this.extractBestNameFromAnyColumn(row, [
                    idxNomePadrao,
                    idxParceiroNome,
                    idxEmailPadrao,
                    idxTelefonePadrao,
                    idxObsPadrao,
                    idxStatusPrincipal,
                    idxStatusSecundario,
                ]);
                nome = nomeFromObs || nomeFromRow || '';
            }
            if (this.isDateLikeText(nome)) {
                nome = '';
            }

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

    private getCellValue(row: any[], index: number): string {
        if (index < 0) return '';
        const value = row[index];
        if (value === null || typeof value === 'undefined') return '';
        return String(value).trim();
    }

    private getPreferredNameByHeader(row: any[], normalizedHeaders: string[]): string {
        const idxParceiro = this.findHeaderColumnIndex(normalizedHeaders, (h) => h.includes('PARCEIRO'));
        const idxNome = this.findHeaderColumnIndex(normalizedHeaders, (h) => h === 'NOME' || h.includes('NOME ') || h.includes(' NOME'));
        const idxCliente = this.findHeaderColumnIndex(normalizedHeaders, (h) => h === 'CLIENTE' || h.includes(' CLIENTE') || h.includes('CLIENTE '));

        const nomeParceiro = this.getCellValue(row, idxParceiro);
        if (nomeParceiro && !this.isDateLikeText(nomeParceiro)) {
            return nomeParceiro;
        }

        const nomeDireto = this.getCellValue(row, idxNome);
        if (nomeDireto && !this.isDateLikeText(nomeDireto)) {
            return nomeDireto;
        }

        const nomeCliente = this.getCellValue(row, idxCliente);
        if (nomeCliente && !this.isDateLikeText(nomeCliente)) {
            return nomeCliente;
        }

        return '';
    }

    private getFirstNonEmptyCellValue(row: any[], indexes: number[], allowDateLike = false): string {
        const uniques = Array.from(new Set(indexes.filter((idx) => idx >= 0)));
        for (const index of uniques) {
            const value = this.getCellValue(row, index);
            if (!value) continue;
            if (!allowDateLike && this.isDateLikeText(value)) continue;
            return value;
        }
        return '';
    }

    private extractBestNameFromRow(row: any[], indexes: number[]): string {
        const uniques = Array.from(new Set(indexes.filter((idx) => idx >= 0)));
        let firstNonDateValue = '';

        for (const index of uniques) {
            const value = this.getCellValue(row, index);
            if (!value) continue;
            if (this.isDateLikeText(value)) continue;

            if (!firstNonDateValue) {
                firstNonDateValue = value;
            }

            const normalized = this.normalizeText(value);
            if (normalized.includes('@')) continue;
            const lettersOnly = normalized.replace(/[^A-Z]/g, '');
            if (lettersOnly.length >= 3) {
                return value;
            }
        }

        return firstNonDateValue;
    }

    private extractBestNameFromAnyColumn(row: any[], excludedIndexes: number[]): string {
        const excluded = new Set(excludedIndexes.filter((idx) => idx >= 0));
        let bestCandidate = '';

        for (let i = 0; i < row.length; i++) {
            if (excluded.has(i)) continue;
            const value = this.getCellValue(row, i);
            if (!value) continue;
            if (this.isDateLikeText(value)) continue;

            const normalized = this.normalizeText(value);
            if (!normalized || normalized.includes('@')) continue;
            if (value.includes('|')) continue;
            if (/^\d+([.,]\d+)?$/.test(value)) continue;

            const blocked = ['CONFIRMADO', 'PENDENTE', 'CANCELADO', 'EXCLUIR', 'CHECKIN REALIZADO', 'NAO REGISTRADO'];
            if (blocked.some((b) => normalized.includes(b))) continue;

            const lettersOnly = normalized.replace(/[^A-Z]/g, '');
            if (lettersOnly.length < 3) continue;

            const words = normalized.split(' ').filter(Boolean).length;
            if (words >= 2 || lettersOnly.length >= 6) {
                if (!bestCandidate || normalized.length > this.normalizeText(bestCandidate).length) {
                    bestCandidate = value;
                }
            }
        }

        return bestCandidate;
    }

    private extractNameFromObs(obs: string): string {
        const raw = (obs || '').trim();
        if (!raw) return '';

        const bonusMatch = raw.match(/B[ÔO]NUS\s*-\s*([^|]+)/i);
        if (bonusMatch?.[1]) {
            const candidate = bonusMatch[1].trim();
            if (candidate && !this.isDateLikeText(candidate)) {
                return candidate;
            }
        }

        return '';
    }

    private buildPreferredNameByEmail(candidates: Array<{ email: string; nomeOriginal: string }>): Map<string, string> {
        const preferred = new Map<string, string>();
        for (const candidate of candidates) {
            const email = (candidate.email || '').trim().toLowerCase();
            const nome = (candidate.nomeOriginal || '').trim();
            if (!email || !nome || this.isDateLikeText(nome)) continue;

            const current = preferred.get(email);
            if (!current) {
                preferred.set(email, nome);
                continue;
            }

            // Prefere o nome mais "rico" para evitar manter versões truncadas.
            if (this.normalizeText(nome).length > this.normalizeText(current).length) {
                preferred.set(email, nome);
            }
        }
        return preferred;
    }

    private isDateLikeText(value: string): boolean {
        const raw = (value || '').trim();
        if (!raw) return false;

        const normalized = this.normalizeText(raw);
        if (normalized.includes('UTC') || normalized.includes('GMT')) return true;
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return true;
        if (/^\d{4}-\d{2}-\d{2}[T\s].+$/.test(raw)) return true;
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) return true;
        if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(raw)) return true;

        return false;
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

    private buildCodigoLookupAlternatives(codigoRaw: string): string[] {
        const codigoNormalizado = this.normalizeCodeKey(codigoRaw);
        if (!codigoNormalizado) return [];

        const alternatives = new Set<string>([codigoNormalizado]);

        // Também aceita a SIGLA EVENTOS da planilha do Time de Vendas sem tradução
        // prévia (IMERSAO_NEGOCIOS_* => IDN_*, LEGACY(XP)_* => LXP_*).
        if (codigoNormalizado.startsWith('IMERSAO_NEGOCIOS')) {
            alternatives.add(codigoNormalizado.replace(/^IMERSAO_NEGOCIOS/, 'IDN'));
        }
        if (codigoNormalizado.startsWith('LEGACY_XP')) {
            alternatives.add(codigoNormalizado.replace(/^LEGACY_XP/, 'LXP'));
        } else if (codigoNormalizado.startsWith('LEGACYXP')) {
            alternatives.add(codigoNormalizado.replace(/^LEGACYXP/, 'LXP'));
        } else if (codigoNormalizado.startsWith('LEGACY')) {
            alternatives.add(codigoNormalizado.replace(/^LEGACY/, 'LXP'));
        }

        // Expande cada alternativa atual com regras de polo/nome do treinamento.
        for (const codigo of Array.from(alternatives)) {
            const parts = codigo.split('_').filter(Boolean);

            // Regra de negócio: para IDN sem polo informado, assume AM (ex.: IDN_6 => IDN_AM_6).
            if (parts.length === 2 && parts[0] === 'IDN') {
                alternatives.add(`IDN_AM_${parts[1]}`);
            }

            // Legacy XP: aceita sigla curta (LXP) e nome completo (LEGACY_XP), com/sem polo AM.
            if (parts[0] === 'LXP') {
                alternatives.add(codigo.replace(/^LXP/, 'LEGACY_XP'));
                if (parts.length === 2) {
                    alternatives.add(`LXP_AM_${parts[1]}`);
                    alternatives.add(`LEGACY_XP_AM_${parts[1]}`);
                }
            }
        }

        // Edição com zero à esquerda na planilha (ex.: IDN_AM_07) deve casar com a
        // turma cadastrada sem zero (IDN_AM_7). Para cada alternativa, gera também a
        // versão com a última parte numérica sem zeros à esquerda.
        for (const codigo of Array.from(alternatives)) {
            const parts = codigo.split('_').filter(Boolean);
            const ultima = parts[parts.length - 1];
            if (parts.length >= 2 && /^\d+$/.test(ultima)) {
                const semZeros = String(Number(ultima));
                if (semZeros !== ultima) {
                    parts[parts.length - 1] = semZeros;
                    alternatives.add(parts.join('_'));
                }
            }
        }

        return Array.from(alternatives);
    }

    private normalizeMasterclassTurmaOrigem(origemRaw: string): {
        codigoParaLookup: string;
        descricao: string;
        codigoTurmaOrigemPlanilha: string | null;
        isTimeDeVendas: boolean;
        isBonusOrigem: boolean;
    } {
        const original = String(origemRaw || '').trim();
        const normalizedCode = this.normalizeCodeKey(original);
        const isTimeDeVendas = normalizedCode.includes('TIME_DE_VENDAS') || normalizedCode.includes('TIMEDEVENDAS');

        if (isTimeDeVendas) {
            return {
                codigoParaLookup: '',
                descricao: 'Time de Vendas IAM',
                codigoTurmaOrigemPlanilha: null,
                isTimeDeVendas: true,
                isBonusOrigem: false,
            };
        }

        const bonusTurmaCodigo = this.extractBonusTurmaOrigemCodigo(original);
        if (bonusTurmaCodigo) {
            return {
                codigoParaLookup: bonusTurmaCodigo,
                descricao: this.formatBonusTurmaOrigemDescricao(bonusTurmaCodigo),
                codigoTurmaOrigemPlanilha: bonusTurmaCodigo.slice(0, 255),
                isTimeDeVendas: false,
                isBonusOrigem: true,
            };
        }

        return {
            codigoParaLookup: original,
            descricao: original,
            codigoTurmaOrigemPlanilha: original.slice(0, 255) || null,
            isTimeDeVendas: false,
            isBonusOrigem: false,
        };
    }

    private extractBonusTurmaOrigemCodigo(origemRaw: string): string | null {
        const normalized = this.normalizeText(origemRaw || '');
        if (!normalized.includes('BONUS')) return null;

        const codeMatch = normalized.match(/\b([A-Z0-9]+(?:_[A-Z0-9]+)*_[A-Z0-9]{2,}_[0-9]{1,4})\b/);
        if (!codeMatch?.[1]) return null;

        return this.normalizeCodeKey(codeMatch[1]);
    }

    private formatBonusTurmaOrigemDescricao(turmaCodigo: string): string {
        const codigo = this.normalizeCodeKey(turmaCodigo);
        const partes = codigo.split('_').filter(Boolean);
        if (partes.length < 3) {
            return `Origem de BÔNUS - turma de origem ${codigo}`;
        }

        const edicao = partes[partes.length - 1];
        const polo = partes[partes.length - 2];
        const treinamento = partes.slice(0, -2).join(' ');

        return `Origem de BÔNUS - turma de origem ${treinamento} - ${edicao} (${polo})`;
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

    private buildInscricaoEmailFromBase(email: string, numeroInscricao: number): string {
        const normalized = (email || '').trim().toLowerCase();
        // Marcador "_n_comp" (inscrição que NÃO é comprador próprio): a inscrição
        // adicional não possui dados próprios e replica os dados do comprador,
        // mas precisa de e-mail único para distinguir o cadastro do titular.
        const marcador = `insc${numeroInscricao}_n_comp`;
        const atIndex = normalized.indexOf('@');
        if (atIndex <= 0) {
            return `${normalized}+${marcador}@sememail.com`;
        }
        const local = normalized.slice(0, atIndex);
        const domain = normalized.slice(atIndex + 1);
        return `${local}+${marcador}@${domain}`;
    }

    private async resolveTurmaIdByCodigo(params: {
        codigoRaw: string;
        turmaCodigoMap: Map<string, number>;
        cache?: Map<
            string,
            {
                turmaId: number | null;
                matchType: 'codigo' | 'edicao' | 'ambigua' | 'nao_encontrada';
                turmaCodigoNormalizado: string;
            }
        >;
    }): Promise<{
        turmaId: number | null;
        matchType: 'codigo' | 'edicao' | 'ambigua' | 'nao_encontrada';
        turmaCodigoNormalizado: string;
    }> {
        const codigoRaw = (params.codigoRaw || '').trim();
        const codigosAlternativos = this.buildCodigoLookupAlternatives(codigoRaw);
        const codigoNormalizado = codigosAlternativos[0] || this.normalizeCodeKey(codigoRaw);
        const cacheKey = this.normalizeText(codigoRaw);
        if (!codigoRaw) {
            return { turmaId: null, matchType: 'nao_encontrada', turmaCodigoNormalizado: codigoNormalizado };
        }
        const resultadoCache = params.cache?.get(cacheKey);
        if (resultadoCache) {
            return resultadoCache;
        }

        for (const codigoLookup of codigosAlternativos) {
            const turmaByCodigo = params.turmaCodigoMap.get(codigoLookup) || null;
            if (turmaByCodigo) {
                const result = { turmaId: turmaByCodigo, matchType: 'codigo' as const, turmaCodigoNormalizado: codigoLookup };
                params.cache?.set(cacheKey, result);
                return result;
            }
        }

        const turmasPorEdicao = await this.uow.turmasRP.find({
            where: {
                edicao_turma: ILike(codigoRaw),
                deletado_em: null,
            },
        });
        if (turmasPorEdicao.length === 1) {
            const result = {
                turmaId: turmasPorEdicao[0].id,
                matchType: 'edicao',
                turmaCodigoNormalizado: codigoNormalizado,
            } as const;
            params.cache?.set(cacheKey, result);
            return result;
        }
        if (turmasPorEdicao.length > 1) {
            const result = { turmaId: null, matchType: 'ambigua' as const, turmaCodigoNormalizado: codigoNormalizado };
            params.cache?.set(cacheKey, result);
            return result;
        }

        const result = { turmaId: null, matchType: 'nao_encontrada' as const, turmaCodigoNormalizado: codigoNormalizado };
        params.cache?.set(cacheKey, result);
        return result;
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

    private mapOrigemAluno(params: { isBonus: boolean; codigoTurmaOrigem: string | null }): EOrigemAlunos {
        if (params.isBonus) {
            return EOrigemAlunos.ALUNO_BONUS;
        }

        if (params.codigoTurmaOrigem) {
            return EOrigemAlunos.TRANSFERENCIA;
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
            // Variante normalizada (espaços => "_", sem acentos), ex.: sigla
            // "LEGACY XP" gera também a chave "LEGACY_XP_AM_17" para casar com a
            // resolução por código normalizado.
            const codigoNormalizado = this.normalizeCodeKey(codigo);
            if (codigoNormalizado && !map.has(codigoNormalizado)) {
                map.set(codigoNormalizado, turma.id);
            }
        }

        return map;
    }

    private async buildTurmaConfrontoMap(): Promise<Map<number, boolean>> {
        const turmas = await this.uow.turmasRP.find({
            where: { deletado_em: null },
            relations: ['id_treinamento_fk'],
        });

        const map = new Map<number, boolean>();
        for (const turma of turmas) {
            const nomeTreinamento = this.normalizeText(`${turma.id_treinamento_fk?.sigla_treinamento || ''} ${turma.id_treinamento_fk?.treinamento || ''}`);
            map.set(turma.id, nomeTreinamento.includes('CONFRONTO'));
        }
        return map;
    }

    /**
     * Marca quais turmas são de Imersão Prosperar (IPR). Usado na importação de
     * masterclass para decidir, quando a origem é um evento (IPR_*, CONF_*, MG_*,
     * etc.), que a 1ª inscrição é compra e as demais entram como bônus do titular.
     */
    private async buildTurmaImersaoProsperarMap(): Promise<Map<number, boolean>> {
        const turmas = await this.uow.turmasRP.find({
            where: { deletado_em: null },
            relations: ['id_treinamento_fk'],
        });

        const map = new Map<number, boolean>();
        for (const turma of turmas) {
            const sigla = this.normalizeText(turma.id_treinamento_fk?.sigla_treinamento || '');
            const nomeTreinamento = this.normalizeText(turma.id_treinamento_fk?.treinamento || '');
            const ehImersaoProsperar = sigla === 'IPR' || nomeTreinamento.includes('IMERSAO PROSPERAR');
            map.set(turma.id, ehImersaoProsperar);
        }
        return map;
    }

    /**
     * Marca quais turmas pertencem à esteira do Liberty: Imersão de Negócios (IDN)
     * e Legacy XP. Usado na importação da esteira do Liberty para aceitar apenas
     * turmas de destino desses produtos.
     */
    private async buildTurmaEsteiraLibertyMap(): Promise<Map<number, boolean>> {
        const turmas = await this.uow.turmasRP.find({
            where: { deletado_em: null },
            relations: ['id_treinamento_fk'],
        });

        const map = new Map<number, boolean>();
        for (const turma of turmas) {
            const sigla = this.normalizeText(turma.id_treinamento_fk?.sigla_treinamento || '');
            const nomeTreinamento = this.normalizeText(turma.id_treinamento_fk?.treinamento || '');
            const ehImersaoNegocios = sigla === 'IDN' || sigla.startsWith('IDN') || nomeTreinamento.includes('IMERSAO DE NEGOCIOS');
            const ehLegacyXp = sigla.includes('LXP') || sigla.includes('LEGACY') || nomeTreinamento.includes('LEGACY');
            map.set(turma.id, ehImersaoNegocios || ehLegacyXp);
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
