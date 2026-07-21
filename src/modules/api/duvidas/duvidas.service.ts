import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { IsNull } from 'typeorm';
import * as fs from 'node:fs';
import * as path from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip') as typeof import('adm-zip');

import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { DuvidasArtigos } from '@/modules/config/entities/duvidasArtigos.entity';
import { DuvidasSugestoes } from '@/modules/config/entities/duvidasSugestoes.entity';
import {
    AprovarSugestaoDto,
    AtualizarArtigoDto,
    CriarArtigoDto,
    DuvidasChatDto,
} from './dto/duvidas.dto';

const LACUNA_MARKER = '[[LACUNA]]';
const MAX_CONTEXT_CHARS = 24000;
const TOP_K_ARTIGOS = 8;
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

@Injectable()
export class DuvidasService {
    private readonly logger = new Logger(DuvidasService.name);
    private anthropic: Anthropic | null = null;

    constructor(
        private readonly uow: UnitOfWorkService,
        private readonly config: ConfigService,
    ) {}

    private getAnthropic(): Anthropic {
        if (this.anthropic) return this.anthropic;
        const apiKey = this.config.get<string>('ANTHROPIC_API_KEY') || process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new ServiceUnavailableException(
                'ANTHROPIC_API_KEY não configurada. Defina a chave no .env do backend.',
            );
        }
        this.anthropic = new Anthropic({ apiKey });
        return this.anthropic;
    }

    private getModel(): string {
        return (
            this.config.get<string>('ANTHROPIC_MODEL') ||
            process.env.ANTHROPIC_MODEL ||
            'claude-sonnet-5'
        );
    }

    /* ========================= Artigos ========================= */

    async listarArtigos(opts: { q?: string; page?: number; limit?: number }) {
        const page = Math.max(1, opts.page || 1);
        const limit = Math.min(100, Math.max(1, opts.limit || 20));
        const skip = (page - 1) * limit;

        if (opts.q?.trim()) {
            const rows = await this.buscarArtigosFts(opts.q.trim(), limit, skip);
            const total = await this.contarArtigosFts(opts.q.trim());
            return { data: rows, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
        }

        const [data, total] = await this.uow.duvidasArtigosRP.findAndCount({
            where: { status: 'publicado', deletado_em: IsNull() },
            order: { atualizado_em: 'DESC' },
            skip,
            take: limit,
        });
        return { data, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
    }

    async obterArtigo(id: number) {
        const artigo = await this.uow.duvidasArtigosRP.findOne({
            where: { id, deletado_em: IsNull() },
        });
        if (!artigo) throw new NotFoundException('Artigo não encontrado');
        return artigo;
    }

    async criarArtigo(dto: CriarArtigoDto, userId: number) {
        const slug = await this.gerarSlugUnico(dto.titulo);
        const artigo = this.uow.duvidasArtigosRP.create({
            titulo: dto.titulo.trim(),
            slug,
            conteudo_md: dto.conteudo_md,
            caminho_origem: dto.caminho_origem?.trim() || null,
            status: 'publicado',
            tags: dto.tags ?? null,
            criado_por: userId,
            atualizado_por: userId,
        });
        return this.uow.duvidasArtigosRP.save(artigo);
    }

    async atualizarArtigo(id: number, dto: AtualizarArtigoDto, userId: number) {
        const artigo = await this.obterArtigo(id);
        if (dto.titulo !== undefined) {
            const novoTitulo = dto.titulo.trim();
            if (novoTitulo !== artigo.titulo) {
                artigo.titulo = novoTitulo;
                artigo.slug = await this.gerarSlugUnico(novoTitulo, id);
            }
        }
        if (dto.conteudo_md !== undefined) artigo.conteudo_md = dto.conteudo_md;
        if (dto.status !== undefined) artigo.status = dto.status;
        if (dto.tags !== undefined) artigo.tags = dto.tags;
        artigo.atualizado_por = userId;
        return this.uow.duvidasArtigosRP.save(artigo);
    }

    async arquivarArtigo(id: number, userId: number) {
        return this.atualizarArtigo(id, { status: 'arquivado' }, userId);
    }

    /* ========================= Import Obsidian ========================= */

    async importarObsidianZip(file: Express.Multer.File, userId: number) {
        if (!file?.buffer?.length) {
            throw new BadRequestException('Arquivo ZIP inválido ou vazio');
        }

        let zip: InstanceType<typeof AdmZip>;
        try {
            zip = new AdmZip(file.buffer);
        } catch {
            throw new BadRequestException('Não foi possível ler o ZIP. Verifique se o arquivo é válido.');
        }

        const entries = zip.getEntries();
        let importados = 0;
        let atualizados = 0;
        let imagens = 0;
        let ignorados = 0;
        const erros: string[] = [];

        // 1) Extrai imagens do vault → uploads/duvidas
        const imageUrlByPath = new Map<string, string>();
        for (const entry of entries) {
            if (entry.isDirectory) continue;
            const rawPath = entry.entryName.replace(/\\/g, '/');
            if (this.shouldSkipObsidianPath(rawPath)) continue;
            if (!this.isImagePath(rawPath)) continue;

            try {
                const caminho = this.normalizeVaultPath(rawPath);
                const url = this.salvarImagemVault(caminho, entry.getData());
                imageUrlByPath.set(caminho.toLowerCase(), url);
                imageUrlByPath.set(path.basename(caminho).toLowerCase(), url);
                imagens++;
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'erro desconhecido';
                erros.push(`${rawPath}: ${msg}`);
                this.logger.warn(`Falha ao importar imagem ${rawPath}: ${msg}`);
            }
        }

        // 2) Importa notas Markdown e reescreve links de imagem
        for (const entry of entries) {
            if (entry.isDirectory) continue;
            const rawPath = entry.entryName.replace(/\\/g, '/');
            if (this.shouldSkipObsidianPath(rawPath)) {
                ignorados++;
                continue;
            }
            if (!rawPath.toLowerCase().endsWith('.md')) {
                if (!this.isImagePath(rawPath)) ignorados++;
                continue;
            }

            try {
                const caminho = this.normalizeVaultPath(rawPath);
                let conteudo = entry.getData().toString('utf8');
                conteudo = this.reescreverImagensMarkdown(conteudo, caminho, imageUrlByPath);
                const titulo = this.tituloFromPath(caminho, conteudo);
                const slugBase = this.slugify(caminho.replace(/\.md$/i, ''));

                const existente = await this.uow.duvidasArtigosRP.findOne({
                    where: { caminho_origem: caminho, deletado_em: IsNull() },
                });

                if (existente) {
                    existente.titulo = titulo;
                    existente.conteudo_md = conteudo;
                    existente.status = 'publicado';
                    existente.atualizado_por = userId;
                    await this.uow.duvidasArtigosRP.save(existente);
                    atualizados++;
                } else {
                    const slug = await this.gerarSlugUnico(slugBase || titulo);
                    const artigo = this.uow.duvidasArtigosRP.create({
                        titulo,
                        slug,
                        conteudo_md: conteudo,
                        caminho_origem: caminho,
                        status: 'publicado',
                        tags: null,
                        criado_por: userId,
                        atualizado_por: userId,
                    });
                    await this.uow.duvidasArtigosRP.save(artigo);
                    importados++;
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'erro desconhecido';
                erros.push(`${rawPath}: ${msg}`);
                this.logger.warn(`Falha ao importar ${rawPath}: ${msg}`);
            }
        }

        return {
            importados,
            atualizados,
            imagens,
            ignorados,
            erros,
            total_md: importados + atualizados,
        };
    }

    private isImagePath(filePath: string): boolean {
        return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
    }

    private getPublicBackendBase(): string {
        return (
            process.env.BACKEND_URL ||
            this.config.get<string>('BACKEND_URL') ||
            `http://localhost:${process.env.PORT || 3000}`
        ).replace(/\/$/, '');
    }

    private salvarImagemVault(caminhoVault: string, data: Buffer): string {
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
        return `${this.getPublicBackendBase()}/uploads/duvidas/${urlPath}`;
    }

    private resolveImageUrl(
        ref: string,
        mdPath: string,
        imageUrlByPath: Map<string, string>,
    ): string | null {
        const cleaned = ref.trim().replace(/^<|>$/g, '').split('|')[0].trim();
        if (!cleaned) return null;
        if (/^https?:\/\//i.test(cleaned) || cleaned.startsWith('/uploads/')) {
            return cleaned;
        }

        const mdDir = path.posix.dirname(mdPath.replace(/\\/g, '/'));
        const candidates = [
            cleaned,
            path.posix.normalize(`${mdDir}/${cleaned}`),
            path.posix.basename(cleaned),
        ];

        for (const c of candidates) {
            const key = c.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
            const hit = imageUrlByPath.get(key);
            if (hit) return hit;
        }
        return null;
    }

    private reescreverImagensMarkdown(
        conteudo: string,
        mdPath: string,
        imageUrlByPath: Map<string, string>,
    ): string {
        // Obsidian: ![[arquivo.png]] ou ![[pasta/arquivo.png|400]]
        let out = conteudo.replace(/!\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
            const url = this.resolveImageUrl(inner, mdPath, imageUrlByPath);
            if (!url) return `![[${inner}]]`;
            const alt = path.basename(inner.split('|')[0].trim());
            return `![${alt}](${url})`;
        });

        // Markdown clássico: ![alt](path)
        out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => {
            const url = this.resolveImageUrl(src, mdPath, imageUrlByPath);
            if (!url) return `![${alt}](${src})`;
            return `![${alt}](${url})`;
        });

        return out;
    }

    private shouldSkipObsidianPath(pathName: string): boolean {
        const lower = pathName.toLowerCase();
        if (lower.includes('/.obsidian/') || lower.startsWith('.obsidian/')) return true;
        if (lower.includes('/.trash/') || lower.startsWith('.trash/')) return true;
        if (lower.includes('__macosx/')) return true;
        if (lower.endsWith('.ds_store')) return true;
        return false;
    }

    private normalizeVaultPath(entryName: string): string {
        const parts = entryName.replace(/\\/g, '/').split('/').filter(Boolean);
        return parts.join('/');
    }

    private tituloFromPath(caminho: string, conteudo: string): string {
        const h1 = conteudo.match(/^#\s+(.+)$/m);
        if (h1?.[1]?.trim()) return h1[1].trim().slice(0, 500);
        const base = caminho.split('/').pop()?.replace(/\.md$/i, '') || 'Sem título';
        return base.slice(0, 500);
    }

    /* ========================= Busca FTS ========================= */

    async buscarArtigosFts(query: string, limit = TOP_K_ARTIGOS, offset = 0): Promise<DuvidasArtigos[]> {
        const q = query.trim();
        if (!q) return [];

        const tokens = this.extrairTokensBusca(q);
        if (tokens.length === 0) return [];

        // 1) FTS com OR entre tokens (não exige todas as palavras)
        try {
            const tsQuery = tokens.map((t) => `${t}:*`).join(' | ');
            const rows: DuvidasArtigos[] = await this.uow.duvidasArtigosRP.query(
                `
                SELECT a.*
                FROM duvidas_artigos a
                WHERE a.deletado_em IS NULL
                  AND a.status = 'publicado'
                  AND to_tsvector('portuguese', coalesce(a.titulo, '') || ' ' || coalesce(a.conteudo_md, ''))
                      @@ to_tsquery('portuguese', $1)
                ORDER BY
                  CASE
                    WHEN lower(a.titulo) LIKE ANY($4) THEN 0
                    WHEN lower(a.caminho_origem) LIKE '%/manuais/%' THEN 1
                    ELSE 2
                  END,
                  ts_rank(
                    to_tsvector('portuguese', coalesce(a.titulo, '') || ' ' || coalesce(a.conteudo_md, '')),
                    to_tsquery('portuguese', $1)
                  ) DESC
                LIMIT $2 OFFSET $3
                `,
                [tsQuery, limit, offset, tokens.map((t) => `%${t}%`)],
            );
            if (rows.length > 0) return rows;
        } catch (err) {
            this.logger.warn(`FTS falhou, usando ILIKE: ${err instanceof Error ? err.message : err}`);
        }

        // 2) Fallback: ILIKE por tokens (OR)
        const likePatterns = tokens.map((t) => `%${t}%`);
        const rows: DuvidasArtigos[] = await this.uow.duvidasArtigosRP.query(
            `
            SELECT a.*
            FROM duvidas_artigos a
            WHERE a.deletado_em IS NULL
              AND a.status = 'publicado'
              AND (
                a.titulo ILIKE ANY($1)
                OR a.conteudo_md ILIKE ANY($1)
                OR a.caminho_origem ILIKE ANY($1)
              )
            ORDER BY
              CASE
                WHEN lower(a.titulo) LIKE ANY($4) THEN 0
                WHEN lower(coalesce(a.caminho_origem, '')) LIKE '%/manuais/%' THEN 1
                ELSE 2
              END,
              a.atualizado_em DESC
            LIMIT $2 OFFSET $3
            `,
            [likePatterns, limit, offset, tokens.map((t) => `%${t}%`)],
        );
        return rows;
    }

    /** Extrai tokens úteis e adiciona sinônimos comuns do domínio. */
    private extrairTokensBusca(query: string): string[] {
        const stop = new Set([
            'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'da', 'do', 'das', 'dos',
            'e', 'ou', 'em', 'no', 'na', 'nos', 'nas', 'para', 'por', 'com', 'sem', 'ao', 'à',
            'como', 'faco', 'faço', 'fazer', 'quero', 'preciso', 'pode', 'me', 'meu', 'minha',
            'aqui', 'isso', 'isto', 'esse', 'essa', 'este', 'esta', 'que', 'qual', 'quais',
            'sobre', 'pra', 'pro', 'pelo', 'pela', 'ser', 'ter', 'há', 'eh', 'é',
        ]);

        const synonyms: Record<string, string[]> = {
            cadastrar: ['registrar', 'criar', 'incluir', 'lancar', 'lançar'],
            registrar: ['cadastrar', 'criar', 'incluir', 'lancar', 'lançar'],
            venda: ['vendas', 'comercial'],
            vendas: ['venda', 'comercial'],
            aluno: ['alunos'],
            alunos: ['aluno'],
            turma: ['turmas'],
            turmas: ['turma'],
        };

        const base = query
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .map((t) => t.trim())
            .filter((t) => t.length >= 3 && !stop.has(t));

        const expanded = new Set<string>();
        for (const t of base) {
            expanded.add(t);
            for (const s of synonyms[t] || []) {
                expanded.add(
                    s
                        .normalize('NFD')
                        .replace(/[\u0300-\u036f]/g, '')
                        .toLowerCase(),
                );
            }
        }
        return Array.from(expanded).slice(0, 12);
    }

    private async contarArtigosFts(query: string): Promise<number> {
        const tokens = this.extrairTokensBusca(query);
        if (tokens.length === 0) return 0;
        const likePatterns = tokens.map((t) => `%${t}%`);
        try {
            const tsQuery = tokens.map((t) => `${t}:*`).join(' | ');
            const rows: Array<{ count: string }> = await this.uow.duvidasArtigosRP.query(
                `
                SELECT COUNT(*)::text AS count
                FROM duvidas_artigos a
                WHERE a.deletado_em IS NULL
                  AND a.status = 'publicado'
                  AND to_tsvector('portuguese', coalesce(a.titulo, '') || ' ' || coalesce(a.conteudo_md, ''))
                      @@ to_tsquery('portuguese', $1)
                `,
                [tsQuery],
            );
            const n = Number(rows[0]?.count || 0);
            if (n > 0) return n;
        } catch {
            /* fallback abaixo */
        }
        const rows: Array<{ count: string }> = await this.uow.duvidasArtigosRP.query(
            `
            SELECT COUNT(*)::text AS count
            FROM duvidas_artigos a
            WHERE a.deletado_em IS NULL
              AND a.status = 'publicado'
              AND (
                a.titulo ILIKE ANY($1)
                OR a.conteudo_md ILIKE ANY($1)
                OR a.caminho_origem ILIKE ANY($1)
              )
            `,
            [likePatterns],
        );
        return Number(rows[0]?.count || 0);
    }

    /* ========================= Chat ========================= */

    async chat(dto: DuvidasChatDto, userId: number) {
        const mensagem = dto.mensagem.trim();
        if (!mensagem) throw new BadRequestException('Mensagem vazia');

        let conversa = dto.conversa_id
            ? await this.uow.duvidasConversasRP.findOne({
                  where: { id: dto.conversa_id, id_usuario: userId, deletado_em: IsNull() },
              })
            : null;

        if (dto.conversa_id && !conversa) {
            throw new NotFoundException('Conversa não encontrada');
        }

        if (!conversa) {
            conversa = await this.uow.duvidasConversasRP.save(
                this.uow.duvidasConversasRP.create({
                    id_usuario: userId,
                    titulo: mensagem.slice(0, 120),
                    criado_por: userId,
                    atualizado_por: userId,
                }),
            );
        }

        await this.uow.duvidasMensagensRP.save(
            this.uow.duvidasMensagensRP.create({
                id_conversa: conversa.id,
                role: 'user',
                conteudo: mensagem,
                fontes: null,
                lacuna_detectada: false,
                criado_por: userId,
                atualizado_por: userId,
            }),
        );

        const artigos = await this.buscarArtigosFts(mensagem, TOP_K_ARTIGOS);
        const contexto = this.montarContexto(artigos);
        const historico = await this.uow.duvidasMensagensRP.find({
            where: { id_conversa: conversa.id, deletado_em: IsNull() },
            order: { id: 'ASC' },
            take: 20,
        });

        const { texto, lacuna } = await this.chamarClaude(contexto, historico, mensagem);

        const fontes = artigos.map((a) => ({
            id: a.id,
            titulo: a.titulo,
            caminho_origem: a.caminho_origem,
        }));

        const msgAssistant = await this.uow.duvidasMensagensRP.save(
            this.uow.duvidasMensagensRP.create({
                id_conversa: conversa.id,
                role: 'assistant',
                conteudo: texto,
                fontes,
                lacuna_detectada: lacuna,
                criado_por: userId,
                atualizado_por: userId,
            }),
        );

        let sugestao: DuvidasSugestoes | null = null;
        if (dto.sugerir_base || lacuna) {
            sugestao = await this.criarSugestaoDeChat({
                pergunta: mensagem,
                resposta: texto,
                conversaId: conversa.id,
                mensagemId: msgAssistant.id,
                userId,
            });
        }

        return {
            conversa_id: conversa.id,
            mensagem: {
                id: msgAssistant.id,
                role: 'assistant' as const,
                conteudo: texto,
                fontes,
                lacuna_detectada: lacuna,
            },
            sugestao: sugestao
                ? { id: sugestao.id, status: sugestao.status }
                : null,
        };
    }

    private montarContexto(artigos: DuvidasArtigos[]): string {
        if (!artigos.length) {
            return 'Nenhum artigo relevante encontrado na base documental.';
        }
        let total = 0;
        const parts: string[] = [];
        for (const a of artigos) {
            const block = `### [${a.id}] ${a.titulo}\nCaminho: ${a.caminho_origem || 'n/a'}\n\n${a.conteudo_md}`;
            if (total + block.length > MAX_CONTEXT_CHARS) {
                const remaining = MAX_CONTEXT_CHARS - total;
                if (remaining > 200) {
                    parts.push(block.slice(0, remaining) + '\n…');
                }
                break;
            }
            parts.push(block);
            total += block.length;
        }
        return parts.join('\n\n---\n\n');
    }

    private async chamarClaude(
        contexto: string,
        historico: Array<{ role: string; conteudo: string }>,
        perguntaAtual: string,
    ): Promise<{ texto: string; lacuna: boolean }> {
        const client = this.getAnthropic();
        const system = `Você é o assistente da Central de Dúvidas do IAM Control.
Responda em português do Brasil, de forma clara e objetiva, em passo a passo quando for tutorial.
Use APENAS as informações da DOCUMENTAÇÃO abaixo. Se a documentação não cobrir a pergunta, diga que não encontrou na base e termine a resposta com exatamente a marcação ${LACUNA_MARKER} (em uma linha própria).
Quando usar informação da base, cite o título do artigo entre aspas.
Priorize artigos de Manuais / passo a passo quando existirem no contexto.
Não invente processos, telas ou regras que não estejam na documentação.

Imagens: a documentação pode conter imagens em Markdown no formato ![descrição](url).
Quando uma imagem ajudar a explicar (telas, fluxos, exemplos), inclua-a na resposta copiando exatamente a sintaxe ![descrição](url) da documentação, na ordem dos passos.
Não invente URLs de imagens. Não remova o protocolo/domínio das URLs existentes.

DOCUMENTAÇÃO:
${contexto}`;

        const messages: Anthropic.MessageParam[] = [];
        for (const m of historico) {
            if (m.role !== 'user' && m.role !== 'assistant') continue;
            // última user message será a perguntaAtual — evita duplicar
            messages.push({
                role: m.role as 'user' | 'assistant',
                content: m.conteudo,
            });
        }
        // Garante que a última mensagem do usuário está presente
        const last = messages[messages.length - 1];
        if (!last || last.role !== 'user' || last.content !== perguntaAtual) {
            messages.push({ role: 'user', content: perguntaAtual });
        }

        try {
            const response = await client.messages.create({
                model: this.getModel(),
                max_tokens: 4096,
                system,
                messages,
            });

            const textoBruto = response.content
                .filter((b): b is Anthropic.TextBlock => b.type === 'text')
                .map((b) => b.text)
                .join('\n')
                .trim();

            const lacuna = textoBruto.includes(LACUNA_MARKER);
            const texto = textoBruto.replace(LACUNA_MARKER, '').trim();
            return { texto, lacuna };
        } catch (err) {
            this.logger.error('Erro Anthropic', err);
            const msg = err instanceof Error ? err.message : 'Erro ao chamar o modelo';
            throw new ServiceUnavailableException(`Falha ao consultar o agente: ${msg}`);
        }
    }

    private async criarSugestaoDeChat(params: {
        pergunta: string;
        resposta: string;
        conversaId: number;
        mensagemId: number;
        userId: number;
    }) {
        const titulo = params.pergunta.slice(0, 120);
        const conteudoMd = `# ${titulo}\n\n## Pergunta\n\n${params.pergunta}\n\n## Resposta proposta\n\n${params.resposta}\n`;

        const sugestao = this.uow.duvidasSugestoesRP.create({
            pergunta: params.pergunta,
            resposta_proposta: params.resposta,
            conteudo_md_proposto: conteudoMd,
            titulo_proposto: titulo,
            status: 'pendente',
            id_conversa: params.conversaId,
            id_mensagem: params.mensagemId,
            id_artigo: null,
            criado_por: params.userId,
            atualizado_por: params.userId,
        });
        return this.uow.duvidasSugestoesRP.save(sugestao);
    }

    async sugerirDaMensagem(mensagemId: number, userId: number) {
        const mensagem = await this.uow.duvidasMensagensRP.findOne({
            where: { id: mensagemId, deletado_em: IsNull() },
        });
        if (!mensagem) throw new NotFoundException('Mensagem não encontrada');

        const conversa = await this.uow.duvidasConversasRP.findOne({
            where: { id: mensagem.id_conversa, id_usuario: userId, deletado_em: IsNull() },
        });
        if (!conversa) throw new NotFoundException('Conversa não encontrada');

        const anteriores = await this.uow.duvidasMensagensRP.find({
            where: { id_conversa: conversa.id, deletado_em: IsNull() },
            order: { id: 'ASC' },
        });
        const idx = anteriores.findIndex((m) => m.id === mensagemId);
        const pergunta =
            [...anteriores.slice(0, idx)].reverse().find((m) => m.role === 'user')?.conteudo ||
            mensagem.conteudo;

        return this.criarSugestaoDeChat({
            pergunta,
            resposta: mensagem.conteudo,
            conversaId: conversa.id,
            mensagemId: mensagem.id,
            userId,
        });
    }

    async listarConversas(userId: number) {
        return this.uow.duvidasConversasRP.find({
            where: { id_usuario: userId, deletado_em: IsNull() },
            order: { atualizado_em: 'DESC' },
            take: 50,
        });
    }

    async obterConversa(id: number, userId: number) {
        const conversa = await this.uow.duvidasConversasRP.findOne({
            where: { id, id_usuario: userId, deletado_em: IsNull() },
        });
        if (!conversa) throw new NotFoundException('Conversa não encontrada');
        const mensagens = await this.uow.duvidasMensagensRP.find({
            where: { id_conversa: id, deletado_em: IsNull() },
            order: { id: 'ASC' },
        });
        return { ...conversa, mensagens };
    }

    /* ========================= Sugestões admin ========================= */

    async listarSugestoes(opts: {
        status?: string;
        page?: number;
        limit?: number;
    }) {
        const page = Math.max(1, opts.page || 1);
        const limit = Math.min(100, Math.max(1, opts.limit || 20));
        const skip = (page - 1) * limit;
        const status = opts.status && opts.status !== 'todas' ? opts.status : undefined;

        const where: any = { deletado_em: IsNull() };
        if (status) where.status = status;

        const [data, total] = await this.uow.duvidasSugestoesRP.findAndCount({
            where,
            order: { criado_em: 'DESC' },
            skip,
            take: limit,
        });
        return { data, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
    }

    async aprovarSugestao(id: number, dto: AprovarSugestaoDto, userId: number) {
        const sugestao = await this.uow.duvidasSugestoesRP.findOne({
            where: { id, deletado_em: IsNull() },
        });
        if (!sugestao) throw new NotFoundException('Sugestão não encontrada');
        if (sugestao.status !== 'pendente') {
            throw new BadRequestException('Sugestão já foi processada');
        }

        const titulo = (dto.titulo || sugestao.titulo_proposto || sugestao.pergunta).slice(0, 500);
        const conteudo = dto.conteudo_md || sugestao.conteudo_md_proposto;
        const artigo = await this.criarArtigo(
            {
                titulo,
                conteudo_md: conteudo,
                caminho_origem: `sugestoes/${Date.now()}-${this.slugify(titulo).slice(0, 40)}.md`,
            },
            userId,
        );

        sugestao.status = 'aprovada';
        sugestao.id_artigo = artigo.id;
        sugestao.atualizado_por = userId;
        if (dto.titulo) sugestao.titulo_proposto = dto.titulo;
        if (dto.conteudo_md) sugestao.conteudo_md_proposto = dto.conteudo_md;
        await this.uow.duvidasSugestoesRP.save(sugestao);

        return { sugestao, artigo };
    }

    async rejeitarSugestao(id: number, userId: number) {
        const sugestao = await this.uow.duvidasSugestoesRP.findOne({
            where: { id, deletado_em: IsNull() },
        });
        if (!sugestao) throw new NotFoundException('Sugestão não encontrada');
        if (sugestao.status !== 'pendente') {
            throw new BadRequestException('Sugestão já foi processada');
        }
        sugestao.status = 'rejeitada';
        sugestao.atualizado_por = userId;
        return this.uow.duvidasSugestoesRP.save(sugestao);
    }

    /* ========================= Helpers ========================= */

    private slugify(text: string): string {
        return text
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 200) || 'artigo';
    }

    private async gerarSlugUnico(base: string, ignoreId?: number): Promise<string> {
        let slug = this.slugify(base);
        let n = 0;
        while (true) {
            const candidate = n === 0 ? slug : `${slug}-${n}`;
            const existing = await this.uow.duvidasArtigosRP.findOne({
                where: { slug: candidate, deletado_em: IsNull() },
            });
            if (!existing || existing.id === ignoreId) return candidate;
            n++;
        }
    }
}
