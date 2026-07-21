import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import {
    GetAlunosDto,
    AlunosListResponseDto,
    AlunoResponseDto,
    CreateAlunoDto,
    UpdateAlunoDto,
    SoftDeleteAlunoDto,
    SaveAlunoVinculosDto,
    AlunoVinculoResponseDto,
    SaveAlunoEmpresasDto,
    AlunoEmpresaResponseDto,
    DemografiaAlunosResponseDto,
    DemografiaFatiaDto,
} from './dto/alunos.dto';
import { Like, FindManyOptions, ILike, IsNull, Not } from 'typeorm';
import { Alunos } from '../../config/entities/alunos.entity';
import { AlunosVinculos } from '../../config/entities/alunosVinculos.entity';
import { AlunosEmpresas } from '../../config/entities/alunosEmpresas.entity';
import { EProfissao } from '../../config/entities/enum';
import { validateBase64ImageField } from '../shared/image-base64.validator';
import { validarIdadeMinimaNascimentoAluno } from '../shared/aluno-idade.validator';

/** Campos cadastrais monitorados para registrar alterações no histórico de observações do aluno. */
const CAMPOS_CADASTRAIS_HISTORICO: Array<{ campo: keyof Alunos; label: string }> = [
    { campo: 'nome', label: 'nome' },
    { campo: 'nome_cracha', label: 'crachá (como gostaria de ser chamado)' },
    { campo: 'email', label: 'e-mail' },
    { campo: 'genero', label: 'gênero' },
    { campo: 'cpf', label: 'CPF' },
    { campo: 'instagram', label: 'Instagram' },
    { campo: 'data_nascimento', label: 'data de nascimento' },
    { campo: 'telefone_um', label: 'telefone principal' },
    { campo: 'telefone_dois', label: 'telefone secundário' },
    { campo: 'cep', label: 'CEP' },
    { campo: 'logradouro', label: 'logradouro' },
    { campo: 'numero', label: 'número' },
    { campo: 'complemento', label: 'complemento' },
    { campo: 'bairro', label: 'bairro' },
    { campo: 'cidade', label: 'cidade' },
    { campo: 'estado', label: 'estado/UF' },
    { campo: 'profissao', label: 'profissão' },
    { campo: 'status_aluno_geral', label: 'status geral' },
    { campo: 'possui_deficiencia', label: 'possui deficiência' },
    { campo: 'desc_deficiencia', label: 'descrição da deficiência' },
    { campo: 'id_polo', label: 'polo' },
];

@Injectable()
export class AlunosService {
    constructor(private readonly uow: UnitOfWorkService) {}

    /**
     * Retorna o conjunto de ids de alunos que tiveram ao menos um cancelamento (status CANCELADO)
     * em alguma turma — incluindo matrículas soft-deletadas, já que o cancelamento faz soft delete.
     */
    private async getAlunosComCancelamento(alunoIds: number[]): Promise<Set<number>> {
        if (alunoIds.length === 0) {
            return new Set<number>();
        }

        const rows = await this.uow.turmasAlunosRP
            .createQueryBuilder('ta')
            .withDeleted()
            .select('DISTINCT ta.id_aluno', 'id_aluno')
            .where('ta.id_aluno IN (:...ids)', { ids: alunoIds })
            .andWhere('ta.status_aluno_turma = :status', { status: 'CANCELADO' })
            .getRawMany<{ id_aluno: string | number }>();

        return new Set<number>(rows.map((row) => Number(row.id_aluno)));
    }

    private calcularIdadeAnos(dataNascimento?: string | null): number | null {
        if (dataNascimento == null || String(dataNascimento).trim() === '') {
            return null;
        }
        const somenteData = String(dataNascimento).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(somenteData)) {
            return null;
        }
        const [ano, mes, dia] = somenteData.split('-').map(Number);
        const nasc = new Date(ano, mes - 1, dia);
        if (
            Number.isNaN(nasc.getTime()) ||
            nasc.getFullYear() !== ano ||
            nasc.getMonth() !== mes - 1 ||
            nasc.getDate() !== dia
        ) {
            return null;
        }
        const hoje = new Date();
        let idade = hoje.getFullYear() - nasc.getFullYear();
        const diffMes = hoje.getMonth() - nasc.getMonth();
        if (diffMes < 0 || (diffMes === 0 && hoje.getDate() < nasc.getDate())) {
            idade -= 1;
        }
        if (idade < 0 || idade > 120) {
            return null;
        }
        return idade;
    }

    private faixaEtariaLabel(idade: number | null): string {
        if (idade == null) return 'Não informado';
        if (idade <= 17) return 'Até 17';
        if (idade <= 24) return '18–24';
        if (idade <= 34) return '25–34';
        if (idade <= 44) return '35–44';
        if (idade <= 54) return '45–54';
        return '55+';
    }

    private montarFatias(
        contagem: Map<string, number>,
        ordem: string[],
        total: number,
    ): DemografiaFatiaDto[] {
        return ordem
            .map((label) => {
                const quantidade = contagem.get(label) || 0;
                return {
                    label,
                    quantidade,
                    percentual: total > 0 ? Number(((quantidade / total) * 100).toFixed(1)) : 0,
                };
            })
            .filter((fatia) => fatia.quantidade > 0 || fatia.label === 'Não informado');
    }

    /**
     * Agrega demografia dos alunos ativos (gênero e faixa etária).
     * Restrito a Admin/Líder via guard no controller.
     */
    async getDemografia(): Promise<DemografiaAlunosResponseDto> {
        const alunos = await this.uow.alunosRP.find({
            where: { deletado_em: IsNull() },
            select: ['id', 'genero', 'data_nascimento'],
        });

        const total = alunos.length;
        const generoOrdem = ['Masculino', 'Feminino', 'Não informado'];
        const faixaOrdem = ['Até 17', '18–24', '25–34', '35–44', '45–54', '55+', 'Não informado'];

        const contagemGenero = new Map<string, number>(generoOrdem.map((l) => [l, 0]));
        const contagemFaixa = new Map<string, number>(faixaOrdem.map((l) => [l, 0]));

        for (const aluno of alunos) {
            const generoRaw = String(aluno.genero || '').trim();
            const generoLabel =
                generoRaw === 'Masculino' || generoRaw === 'Feminino'
                    ? generoRaw
                    : 'Não informado';
            contagemGenero.set(generoLabel, (contagemGenero.get(generoLabel) || 0) + 1);

            const faixa = this.faixaEtariaLabel(this.calcularIdadeAnos(aluno.data_nascimento));
            contagemFaixa.set(faixa, (contagemFaixa.get(faixa) || 0) + 1);
        }

        const porGenero = this.montarFatias(contagemGenero, generoOrdem, total).filter(
            (f) => f.quantidade > 0,
        );
        const porFaixaEtaria = this.montarFatias(contagemFaixa, faixaOrdem, total).filter(
            (f) => f.quantidade > 0,
        );

        return { total, porGenero, porFaixaEtaria };
    }

    async findAll(filters: GetAlunosDto): Promise<AlunosListResponseDto> {
        const { page = 1, limit = 10, nome, email, cpf, status_aluno_geral, id_polo } = filters;

        console.log('Filtros recebidos:', filters);

        // Construir condições de busca
        const whereConditions: any = {};

        if (nome) {
            whereConditions.nome = ILike(`%${nome}%`);
        }

        if (email) {
            whereConditions.email = ILike(`%${email}%`);
        }

        if (cpf) {
            whereConditions.cpf = ILike(`%${cpf}%`);
        }

        if (status_aluno_geral) {
            whereConditions.status_aluno_geral = status_aluno_geral;
        }

        if (id_polo) {
            whereConditions.id_polo = id_polo;
        }

        // Adicionar condição para excluir registros deletados
        whereConditions.deletado_em = null;

        // Configurar opções de busca
        const findOptions: FindManyOptions = {
            where: whereConditions,
            relations: ['id_polo_fk'],
            order: {
                nome: 'ASC',
                criado_em: 'DESC',
            },
            skip: (page - 1) * limit,
            take: limit,
        };

        console.log('Opções de busca:', JSON.stringify(findOptions, null, 2));

        try {
            // Buscar alunos com paginação
            const [alunos, total] = await this.uow.alunosRP.findAndCount(findOptions);

            console.log(`Encontrados ${alunos.length} alunos de um total de ${total}`);

            // Identifica quais alunos da página já tiveram algum cancelamento (uma única consulta).
            const alunosComCancelamento = await this.getAlunosComCancelamento(alunos.map((aluno) => aluno.id));

            // Transformar dados para o formato de resposta
            const alunosResponse: AlunoResponseDto[] = alunos.map((aluno) => ({
                id: aluno.id,
                id_polo: aluno.id_polo,
                nome: aluno.nome,
                nome_cracha: aluno.nome_cracha,
                email: aluno.email,
                genero: aluno.genero,
                cpf: aluno.cpf,
                instagram: aluno.instagram,
                data_nascimento: aluno.data_nascimento,
                telefone_um: aluno.telefone_um,
                telefone_dois: aluno.telefone_dois,
                cep: aluno.cep,
                logradouro: aluno.logradouro,
                complemento: aluno.complemento,
                numero: aluno.numero,
                bairro: aluno.bairro,
                cidade: aluno.cidade,
                estado: aluno.estado,
                profissao: aluno.profissao,
                status_aluno_geral: aluno.status_aluno_geral,
                possui_deficiencia: aluno.possui_deficiencia,
                desc_deficiencia: aluno.desc_deficiencia,
                url_foto_aluno: aluno.url_foto_aluno,
                id_aluno_vinculado: aluno.id_aluno_vinculado,
                tipo_vinculo: aluno.tipo_vinculo,
                id_treinamento_bonus: aluno.id_treinamento_bonus,
                created_at: aluno.criado_em,
                updated_at: aluno.atualizado_em,
                teve_cancelamento: alunosComCancelamento.has(aluno.id),
                polo: aluno.id_polo_fk
                    ? {
                          id: aluno.id_polo_fk.id,
                          nome: aluno.id_polo_fk.polo,
                      }
                    : undefined,
                id_aluno_vinculado_fk: aluno.id_aluno_vinculado_fk
                    ? {
                          id: aluno.id_aluno_vinculado_fk.id,
                          nome: aluno.id_aluno_vinculado_fk.nome,
                          email: aluno.id_aluno_vinculado_fk.email,
                      }
                    : undefined,
            }));

            const totalPages = Math.ceil(total / limit);

            console.log(`Retornando ${alunosResponse.length} alunos para a página ${page}`);

            return {
                data: alunosResponse,
                total,
                page,
                limit,
                totalPages,
            };
        } catch (error) {
            console.error('Erro ao buscar alunos:', error);
            if (error instanceof Error) {
                console.error('Stack trace:', error.stack);
            }
            throw new Error('Erro interno do servidor ao buscar alunos');
        }
    }

    async findById(id: number): Promise<AlunoResponseDto | null> {
        try {
            const aluno = await this.uow.alunosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
                relations: ['id_polo_fk', 'id_aluno_vinculado_fk'],
            });

            if (!aluno) {
                return null;
            }

            const alunosComCancelamento = await this.getAlunosComCancelamento([aluno.id]);

            return {
                id: aluno.id,
                id_polo: aluno.id_polo,
                nome: aluno.nome,
                nome_cracha: aluno.nome_cracha,
                email: aluno.email,
                genero: aluno.genero,
                cpf: aluno.cpf,
                instagram: aluno.instagram,
                data_nascimento: aluno.data_nascimento,
                telefone_um: aluno.telefone_um,
                telefone_dois: aluno.telefone_dois,
                cep: aluno.cep,
                logradouro: aluno.logradouro,
                complemento: aluno.complemento,
                numero: aluno.numero,
                bairro: aluno.bairro,
                cidade: aluno.cidade,
                estado: aluno.estado,
                profissao: aluno.profissao,
                status_aluno_geral: aluno.status_aluno_geral,
                possui_deficiencia: aluno.possui_deficiencia,
                desc_deficiencia: aluno.desc_deficiencia,
                url_foto_aluno: aluno.url_foto_aluno,
                id_aluno_vinculado: aluno.id_aluno_vinculado,
                tipo_vinculo: aluno.tipo_vinculo,
                id_treinamento_bonus: aluno.id_treinamento_bonus,
                created_at: aluno.criado_em,
                updated_at: aluno.atualizado_em,
                teve_cancelamento: alunosComCancelamento.has(aluno.id),
                polo: aluno.id_polo_fk
                    ? {
                          id: aluno.id_polo_fk.id,
                          nome: aluno.id_polo_fk.polo,
                      }
                    : undefined,
                id_aluno_vinculado_fk: aluno.id_aluno_vinculado_fk
                    ? {
                          id: aluno.id_aluno_vinculado_fk.id,
                          nome: aluno.id_aluno_vinculado_fk.nome,
                          email: aluno.id_aluno_vinculado_fk.email,
                      }
                    : undefined,
            };
        } catch (error) {
            console.error('Erro ao buscar aluno por ID:', error);
            throw new Error('Erro interno do servidor ao buscar aluno');
        }
    }

    async create(createAlunoDto: CreateAlunoDto): Promise<AlunoResponseDto> {
        try {
            validateBase64ImageField(createAlunoDto.url_foto_aluno, 'Foto do aluno');
            validarIdadeMinimaNascimentoAluno(createAlunoDto.data_nascimento);
            // Verificar se já existe um aluno com esse email (incluindo deletados)
            // Usar query SQL direta para garantir que busca incluindo deletados
            const queryRunner = this.uow.alunosRP.manager.connection.createQueryRunner();
            const alunoExistenteRaw = await queryRunner.query('SELECT * FROM alunos WHERE email = $1 LIMIT 1', [createAlunoDto.email]);
            await queryRunner.release();

            console.log('Buscando aluno com email:', createAlunoDto.email);
            console.log('Aluno encontrado (raw):', alunoExistenteRaw);

            let alunoExistente: Alunos | null = null;
            if (alunoExistenteRaw && alunoExistenteRaw.length > 0) {
                // Criar entidade a partir dos dados raw
                const rawData = alunoExistenteRaw[0];
                alunoExistente = this.uow.alunosRP.create();
                Object.assign(alunoExistente, rawData);
                // Converter datas se necessário
                if (rawData.criado_em) alunoExistente.criado_em = new Date(rawData.criado_em);
                if (rawData.atualizado_em) alunoExistente.atualizado_em = new Date(rawData.atualizado_em);
                if (rawData.deletado_em) alunoExistente.deletado_em = new Date(rawData.deletado_em);
                console.log('Aluno encontrado:', { id: alunoExistente.id, deletado_em: alunoExistente.deletado_em });
            } else {
                console.log('Aluno não encontrado');
            }

            if (alunoExistente) {
                // Se existe, fazer UPDATE ao invés de INSERT
                console.log('Aluno existente encontrado, fazendo UPDATE:', alunoExistente.id);

                // Preservar o criado_por original
                const criadoPorOriginal = alunoExistente.criado_por;

                // Reativar se estiver deletado
                if (alunoExistente.deletado_em) {
                    alunoExistente.deletado_em = null;
                    console.log('Aluno deletado encontrado, reativando:', alunoExistente.id);
                }

                // Atualizar com os novos dados
                Object.assign(alunoExistente, createAlunoDto);
                if (createAlunoDto.id_polo !== undefined) {
                    alunoExistente.id_polo = createAlunoDto.id_polo ?? null;
                }
                if (createAlunoDto.profissao !== undefined) {
                    alunoExistente.profissao = createAlunoDto.profissao != null ? createAlunoDto.profissao : null;
                }
                alunoExistente.nome_cracha =
                    createAlunoDto.nome_cracha != null && createAlunoDto.nome_cracha.trim() !== '' ? createAlunoDto.nome_cracha.trim() : null;
                alunoExistente.atualizado_em = new Date();
                alunoExistente.atualizado_por = createAlunoDto.criado_por;

                // Restaurar o criado_por original
                alunoExistente.criado_por = criadoPorOriginal;

                const alunoAtualizado = await this.uow.alunosRP.save(alunoExistente);
                console.log('Aluno atualizado com sucesso:', alunoAtualizado);

                return {
                    id: alunoAtualizado.id,
                    id_polo: alunoAtualizado.id_polo,
                    nome: alunoAtualizado.nome,
                    nome_cracha: alunoAtualizado.nome_cracha,
                    email: alunoAtualizado.email,
                    genero: alunoAtualizado.genero,
                    cpf: alunoAtualizado.cpf,
                    instagram: alunoAtualizado.instagram,
                    data_nascimento: alunoAtualizado.data_nascimento,
                    telefone_um: alunoAtualizado.telefone_um,
                    telefone_dois: alunoAtualizado.telefone_dois,
                    cep: alunoAtualizado.cep,
                    logradouro: alunoAtualizado.logradouro,
                    complemento: alunoAtualizado.complemento,
                    numero: alunoAtualizado.numero,
                    bairro: alunoAtualizado.bairro,
                    cidade: alunoAtualizado.cidade,
                    estado: alunoAtualizado.estado,
                    profissao: alunoAtualizado.profissao,
                    status_aluno_geral: alunoAtualizado.status_aluno_geral,
                    possui_deficiencia: alunoAtualizado.possui_deficiencia,
                    desc_deficiencia: alunoAtualizado.desc_deficiencia,
                    url_foto_aluno: alunoAtualizado.url_foto_aluno,
                    id_aluno_vinculado: alunoAtualizado.id_aluno_vinculado,
                    tipo_vinculo: alunoAtualizado.tipo_vinculo,
                    id_treinamento_bonus: alunoAtualizado.id_treinamento_bonus,
                    created_at: alunoAtualizado.criado_em,
                    updated_at: alunoAtualizado.atualizado_em,
                    polo: undefined, // Será carregado se necessário
                };
            }

            // Se não existe, criar novo
            const novoAluno = new Alunos();
            Object.assign(novoAluno, createAlunoDto);
            novoAluno.id_polo = createAlunoDto.id_polo ?? null;
            novoAluno.profissao = createAlunoDto.profissao != null ? createAlunoDto.profissao : null;
            novoAluno.nome_cracha = createAlunoDto.nome_cracha != null && createAlunoDto.nome_cracha.trim() !== '' ? createAlunoDto.nome_cracha.trim() : null;
            novoAluno.criado_por = createAlunoDto.criado_por;

            try {
                const alunoSalvo = await this.uow.alunosRP.save(novoAluno);
                console.log('Aluno criado com sucesso:', alunoSalvo);

                return {
                    id: alunoSalvo.id,
                    id_polo: alunoSalvo.id_polo,
                    nome: alunoSalvo.nome,
                    nome_cracha: alunoSalvo.nome_cracha,
                    email: alunoSalvo.email,
                    genero: alunoSalvo.genero,
                    cpf: alunoSalvo.cpf,
                    instagram: alunoSalvo.instagram,
                    data_nascimento: alunoSalvo.data_nascimento,
                    telefone_um: alunoSalvo.telefone_um,
                    telefone_dois: alunoSalvo.telefone_dois,
                    cep: alunoSalvo.cep,
                    logradouro: alunoSalvo.logradouro,
                    complemento: alunoSalvo.complemento,
                    numero: alunoSalvo.numero,
                    bairro: alunoSalvo.bairro,
                    cidade: alunoSalvo.cidade,
                    estado: alunoSalvo.estado,
                    profissao: alunoSalvo.profissao,
                    status_aluno_geral: alunoSalvo.status_aluno_geral,
                    possui_deficiencia: alunoSalvo.possui_deficiencia,
                    desc_deficiencia: alunoSalvo.desc_deficiencia,
                    url_foto_aluno: alunoSalvo.url_foto_aluno,
                    id_aluno_vinculado: alunoSalvo.id_aluno_vinculado,
                    tipo_vinculo: alunoSalvo.tipo_vinculo,
                    id_treinamento_bonus: alunoSalvo.id_treinamento_bonus,
                    created_at: alunoSalvo.criado_em,
                    updated_at: alunoSalvo.atualizado_em,
                    polo: undefined, // Será carregado se necessário
                };
            } catch (saveError: any) {
                // Verificar se é erro de sequência desincronizada
                const errorCode = saveError?.code || saveError?.driverError?.code;
                const constraint = saveError?.constraint || saveError?.driverError?.constraint;

                if (errorCode === '23505' && constraint === 'pk_alunos') {
                    console.warn('Sequência de IDs desincronizada detectada. Corrigindo...');

                    // Corrigir a sequência
                    await this.fixAlunosSequence();

                    // Criar um novo objeto para garantir que não há ID pré-definido
                    const novoAlunoRetry = new Alunos();
                    Object.assign(novoAlunoRetry, createAlunoDto);
                    novoAlunoRetry.id_polo = createAlunoDto.id_polo ?? null;
                    novoAlunoRetry.profissao = createAlunoDto.profissao != null ? createAlunoDto.profissao : null;
                    novoAlunoRetry.nome_cracha =
                        createAlunoDto.nome_cracha != null && createAlunoDto.nome_cracha.trim() !== '' ? createAlunoDto.nome_cracha.trim() : null;
                    novoAlunoRetry.criado_por = createAlunoDto.criado_por;

                    // Tentar novamente
                    const alunoSalvo = await this.uow.alunosRP.save(novoAlunoRetry);
                    console.log('Aluno criado com sucesso após correção da sequência:', alunoSalvo);

                    return {
                        id: alunoSalvo.id,
                        id_polo: alunoSalvo.id_polo,
                        nome: alunoSalvo.nome,
                        nome_cracha: alunoSalvo.nome_cracha,
                        email: alunoSalvo.email,
                        genero: alunoSalvo.genero,
                        cpf: alunoSalvo.cpf,
                        instagram: alunoSalvo.instagram,
                        data_nascimento: alunoSalvo.data_nascimento,
                        telefone_um: alunoSalvo.telefone_um,
                        telefone_dois: alunoSalvo.telefone_dois,
                        cep: alunoSalvo.cep,
                        logradouro: alunoSalvo.logradouro,
                        complemento: alunoSalvo.complemento,
                        numero: alunoSalvo.numero,
                        bairro: alunoSalvo.bairro,
                        cidade: alunoSalvo.cidade,
                        estado: alunoSalvo.estado,
                        profissao: alunoSalvo.profissao,
                        status_aluno_geral: alunoSalvo.status_aluno_geral,
                        possui_deficiencia: alunoSalvo.possui_deficiencia,
                        desc_deficiencia: alunoSalvo.desc_deficiencia,
                        url_foto_aluno: alunoSalvo.url_foto_aluno,
                        id_aluno_vinculado: alunoSalvo.id_aluno_vinculado,
                        tipo_vinculo: alunoSalvo.tipo_vinculo,
                        id_treinamento_bonus: alunoSalvo.id_treinamento_bonus,
                        created_at: alunoSalvo.criado_em,
                        updated_at: alunoSalvo.atualizado_em,
                        polo: undefined, // Será carregado se necessário
                    };
                }

                // Se não for erro de sequência, relançar o erro
                throw saveError;
            }
        } catch (error) {
            console.error('Erro ao criar/atualizar aluno:', error);
            if (error instanceof BadRequestException) {
                throw error;
            }

            // Verificar se é erro de email duplicado
            if (typeof error === 'object' && error !== null) {
                const errorObj = error as any;
                const errorCode = errorObj.code || errorObj.driverError?.code;
                const constraint = errorObj.constraint || errorObj.driverError?.constraint;
                const detail = errorObj.detail || errorObj.driverError?.detail;

                if (errorCode === '23505' && constraint?.includes('email')) {
                    const email = detail?.match(/\(email\)=\(([^)]+)\)/)?.[1] || createAlunoDto.email;
                    throw new BadRequestException(`O email ${email} já está cadastrado. Por favor, use outro email.`);
                }
            }

            throw new Error('Erro interno do servidor ao criar aluno');
        }
    }

    /** Formata um valor cadastral para exibição no histórico (datas viram dd/mm/aaaa, booleanos viram Sim/Não). */
    private formatarValorCadastral(campo: keyof Alunos, valor: unknown): string {
        if (valor === null || valor === undefined) return '';
        if (campo === 'possui_deficiencia') return valor ? 'Sim' : 'Não';
        if (campo === 'data_nascimento') {
            // Coluna date-only: formata direto da string "YYYY-MM-DD" (sem parser UTC).
            const texto = valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor).slice(0, 10);
            const [ano, mes, dia] = texto.split('-');
            return ano && mes && dia ? `${dia}/${mes}/${ano}` : texto;
        }
        return String(valor).trim();
    }

    /**
     * Registra no histórico de observações do aluno as alterações de dados
     * cadastrais (ex.: "Mudou nome de João Teste para Paula Teste"). O log é
     * ancorado na matrícula mais recente do aluno porque a tabela de histórico
     * exige turma/matrícula, mas a leitura agregada é feita por id_aluno.
     * Falha no registro não pode derrubar a atualização do cadastro.
     */
    private async registrarHistoricoAlteracaoCadastral(
        idAluno: number,
        alteracoes: Array<{ label: string; de: string; para: string }>,
        fotoAlterada: boolean,
        userId?: number,
    ): Promise<void> {
        if (alteracoes.length === 0 && !fotoAlterada) return;

        try {
            const matricula =
                (await this.uow.turmasAlunosRP.findOne({
                    where: { id_aluno: String(idAluno), deletado_em: IsNull() },
                    order: { criado_em: 'DESC' },
                    select: ['id', 'id_turma', 'id_aluno'] as any,
                })) ??
                (await this.uow.turmasAlunosRP.findOne({
                    where: { id_aluno: String(idAluno) },
                    withDeleted: true,
                    order: { criado_em: 'DESC' },
                    select: ['id', 'id_turma', 'id_aluno'] as any,
                }));

            // Aluno sem nenhuma matrícula: não há onde ancorar o log.
            if (!matricula) return;

            const linhas = alteracoes.map(({ label, de, para }) => {
                if (de && para) return `Mudou ${label} de ${de} para ${para}`;
                if (!de && para) return `Definiu ${label} como ${para}`;
                return `Removeu ${label} (antes: ${de})`;
            });
            if (fotoAlterada) {
                linhas.push('Alterou a foto do aluno');
            }

            await this.uow.historicoAlunosTurmasLogsRP.insert({
                id_turma_aluno: matricula.id,
                id_turma: matricula.id_turma,
                id_aluno: String(idAluno),
                tipo_acao: 'ATUALIZACAO',
                titulo: 'Dados cadastrais alterados',
                descricao: linhas.map((linha) => ` - ${linha}`).join('\n'),
                detalhes: {
                    alteracoes: alteracoes.map((item) => ({ campo: item.label, de: item.de || null, para: item.para || null })),
                    foto_alterada: fotoAlterada,
                },
                data_acao: new Date(),
                criado_por: userId,
                atualizado_por: userId,
            });
        } catch (error) {
            console.error('Erro ao registrar histórico de alteração cadastral do aluno:', error instanceof Error ? error.message : 'Erro desconhecido');
        }
    }

    async update(id: number, updateAlunoDto: UpdateAlunoDto, userId?: number): Promise<AlunoResponseDto> {
        try {
            validateBase64ImageField(updateAlunoDto.url_foto_aluno, 'Foto do aluno');
            if (updateAlunoDto.data_nascimento !== undefined) {
                validarIdadeMinimaNascimentoAluno(updateAlunoDto.data_nascimento);
            }
            const aluno = await this.uow.alunosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
                relations: ['id_polo_fk', 'id_aluno_vinculado_fk'],
            });

            if (!aluno) {
                throw new NotFoundException(`Aluno com ID ${id} não encontrado`);
            }

            // Snapshot dos campos cadastrais ANTES da alteração (para o histórico).
            const valoresAnteriores = new Map<keyof Alunos, unknown>();
            for (const { campo } of CAMPOS_CADASTRAIS_HISTORICO) {
                valoresAnteriores.set(campo, aluno[campo]);
            }
            const fotoAnterior = aluno.url_foto_aluno || '';

            // Atualizar campos fornecidos
            Object.assign(aluno, updateAlunoDto);
            if (updateAlunoDto.atualizado_por !== undefined) {
                aluno.atualizado_por = updateAlunoDto.atualizado_por;
            }
            if (updateAlunoDto.profissao !== undefined) {
                aluno.profissao = updateAlunoDto.profissao != null ? updateAlunoDto.profissao : null;
            }
            if (updateAlunoDto.nome_cracha !== undefined) {
                aluno.nome_cracha = updateAlunoDto.nome_cracha != null && updateAlunoDto.nome_cracha.trim() !== '' ? updateAlunoDto.nome_cracha.trim() : null;
            }
            // Garantir limpeza explícita dos campos de vínculo quando null for enviado
            if ('id_aluno_vinculado' in updateAlunoDto) {
                aluno.id_aluno_vinculado = updateAlunoDto.id_aluno_vinculado ?? null;
            }
            if ('tipo_vinculo' in updateAlunoDto) {
                aluno.tipo_vinculo = updateAlunoDto.tipo_vinculo ?? null;
            }
            if ('id_treinamento_bonus' in updateAlunoDto) {
                aluno.id_treinamento_bonus = updateAlunoDto.id_treinamento_bonus ?? null;
            }

            const alunoAtualizado = await this.uow.alunosRP.save(aluno);
            console.log('Aluno atualizado com sucesso:', alunoAtualizado);

            // Monta a lista de alterações cadastrais para o histórico de observações.
            const alteracoes: Array<{ label: string; de: string; para: string }> = [];
            for (const { campo, label } of CAMPOS_CADASTRAIS_HISTORICO) {
                const de = this.formatarValorCadastral(campo, valoresAnteriores.get(campo));
                const para = this.formatarValorCadastral(campo, alunoAtualizado[campo]);
                if (de === para) continue;

                if (campo === 'id_polo') {
                    // Ids de polo não dizem nada ao usuário: resolve os nomes.
                    const idsPolo = [de, para].map(Number).filter((valor) => Number.isInteger(valor) && valor > 0);
                    const nomesPolo = new Map<number, string>();
                    if (idsPolo.length > 0) {
                        const polos = await this.uow.polosRP.find({
                            where: idsPolo.map((idPolo) => ({ id: idPolo })),
                            withDeleted: true,
                            select: ['id', 'polo'] as any,
                        });
                        polos.forEach((polo) => nomesPolo.set(Number(polo.id), polo.polo));
                    }
                    alteracoes.push({
                        label,
                        de: de ? nomesPolo.get(Number(de)) || `Polo ${de}` : '',
                        para: para ? nomesPolo.get(Number(para)) || `Polo ${para}` : '',
                    });
                    continue;
                }

                alteracoes.push({ label, de, para });
            }
            const fotoAlterada = updateAlunoDto.url_foto_aluno !== undefined && (alunoAtualizado.url_foto_aluno || '') !== fotoAnterior;

            await this.registrarHistoricoAlteracaoCadastral(id, alteracoes, fotoAlterada, userId ?? updateAlunoDto.atualizado_por ?? undefined);

            return {
                id: alunoAtualizado.id,
                id_polo: alunoAtualizado.id_polo,
                nome: alunoAtualizado.nome,
                nome_cracha: alunoAtualizado.nome_cracha,
                email: alunoAtualizado.email,
                genero: alunoAtualizado.genero,
                cpf: alunoAtualizado.cpf,
                instagram: alunoAtualizado.instagram,
                data_nascimento: alunoAtualizado.data_nascimento,
                telefone_um: alunoAtualizado.telefone_um,
                telefone_dois: alunoAtualizado.telefone_dois,
                cep: alunoAtualizado.cep,
                logradouro: alunoAtualizado.logradouro,
                complemento: alunoAtualizado.complemento,
                numero: alunoAtualizado.numero,
                bairro: alunoAtualizado.bairro,
                cidade: alunoAtualizado.cidade,
                estado: alunoAtualizado.estado,
                profissao: alunoAtualizado.profissao,
                status_aluno_geral: alunoAtualizado.status_aluno_geral,
                possui_deficiencia: alunoAtualizado.possui_deficiencia,
                desc_deficiencia: alunoAtualizado.desc_deficiencia,
                url_foto_aluno: alunoAtualizado.url_foto_aluno,
                created_at: alunoAtualizado.criado_em,
                updated_at: alunoAtualizado.atualizado_em,
                polo: alunoAtualizado.id_polo_fk
                    ? {
                          id: alunoAtualizado.id_polo_fk.id,
                          nome: alunoAtualizado.id_polo_fk.polo,
                      }
                    : undefined,
            };
        } catch (error) {
            console.error('Erro ao atualizar aluno:', error);

            // Tratar erro específico de violação de constraint única (email duplicado)
            if (typeof error === 'object' && error !== null) {
                const errorObj = error as any;
                const errorCode = errorObj.code || errorObj.driverError?.code;
                const constraint = errorObj.constraint || errorObj.driverError?.constraint;
                const detail = errorObj.detail || errorObj.driverError?.detail;

                if (errorCode === '23505' && constraint === 'UQ_1f9a8f3f4e5a314a2d7f828a605') {
                    const email = detail?.match(/\(email\)=\(([^)]+)\)/)?.[1] || 'fornecido';
                    throw new BadRequestException(`O email ${email} já está cadastrado. Por favor, use outro email.`);
                }
            }

            // Se for uma exceção do NestJS, re-lançar
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }

            throw new Error('Erro interno do servidor ao atualizar aluno');
        }
    }

    async softDelete(id: number, softDeleteDto: SoftDeleteAlunoDto): Promise<void> {
        try {
            const aluno = await this.uow.alunosRP.findOne({
                where: {
                    id,
                    deletado_em: null,
                },
            });

            if (!aluno) {
                throw new NotFoundException(`Aluno com ID ${id} não encontrado`);
            }

            aluno.deletado_em = new Date(softDeleteDto.deletado_em);
            aluno.atualizado_por = softDeleteDto.atualizado_por;

            await this.uow.alunosRP.save(aluno);

            const dataDelecao = new Date(softDeleteDto.deletado_em);
            const turmasAlunosDoAluno = await this.uow.turmasAlunosRP.find({
                where: { id_aluno: id as any, deletado_em: null },
            });
            for (const ta of turmasAlunosDoAluno) {
                ta.deletado_em = dataDelecao;
                ta.atualizado_por = softDeleteDto.atualizado_por ?? null;
                await this.uow.turmasAlunosRP.save(ta);
            }
            if (turmasAlunosDoAluno.length > 0) {
                console.log(`Aluno ${id} marcado como deletado; ${turmasAlunosDoAluno.length} vínculo(s) em turmas também marcado(s) com data de deleção.`);
            } else {
                console.log('Aluno marcado como deletado:', id);
            }
        } catch (error) {
            console.error('Erro ao fazer soft delete do aluno:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao fazer soft delete do aluno');
        }
    }

    async delete(id: number): Promise<void> {
        try {
            const aluno = await this.uow.alunosRP.findOne({
                where: { id },
            });

            if (!aluno) {
                throw new NotFoundException(`Aluno com ID ${id} não encontrado`);
            }

            await this.uow.alunosRP.remove(aluno);
            console.log('Aluno excluído permanentemente:', id);
        } catch (error) {
            console.error('Erro ao excluir aluno permanentemente:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new Error('Erro interno do servidor ao excluir aluno');
        }
    }

    async getVinculos(id_aluno: number): Promise<AlunoVinculoResponseDto[]> {
        const vinculos = await this.uow.alunosVinculosRP.find({
            where: { id_aluno, deletado_em: null },
            relations: ['id_aluno_vinculado_fk', 'id_treinamento_fk', 'id_turma_fk', 'id_turma_fk.id_treinamento_fk'],
        });
        return vinculos.map((v) => ({
            id: v.id,
            id_aluno: v.id_aluno,
            tipo_vinculo: v.tipo_vinculo,
            id_aluno_vinculado: v.id_aluno_vinculado,
            id_treinamento: v.id_treinamento,
            id_turma: v.id_turma,
            aluno_vinculado: v.id_aluno_vinculado_fk
                ? {
                      id: v.id_aluno_vinculado_fk.id,
                      nome: v.id_aluno_vinculado_fk.nome,
                      email: v.id_aluno_vinculado_fk.email,
                  }
                : undefined,
            treinamento: v.id_treinamento_fk
                ? {
                      id: v.id_treinamento_fk.id,
                      treinamento: v.id_treinamento_fk.treinamento,
                  }
                : undefined,
            turma: v.id_turma_fk
                ? {
                      id: v.id_turma_fk.id,
                      edicao_turma: v.id_turma_fk.edicao_turma,
                      treinamento_nome: v.id_turma_fk.id_treinamento_fk?.treinamento || '',
                      sigla_treinamento: v.id_turma_fk.id_treinamento_fk?.sigla_treinamento,
                      data_inicio: v.id_turma_fk.data_inicio,
                      data_final: v.id_turma_fk.data_final,
                  }
                : undefined,
        }));
    }

    async saveVinculos(id_aluno: number, dto: SaveAlunoVinculosDto): Promise<AlunoVinculoResponseDto[]> {
        // Delete all existing vinculos for this aluno
        const existing = await this.uow.alunosVinculosRP.find({ where: { id_aluno, deletado_em: null } });
        if (existing.length > 0) {
            await this.uow.alunosVinculosRP.remove(existing);
        }
        // Create new vinculos
        if (dto.vinculos.length === 0) return [];
        const newVinculos = dto.vinculos.map((v) => {
            const vinculo = new AlunosVinculos();
            vinculo.id_aluno = id_aluno;
            vinculo.tipo_vinculo = v.tipo_vinculo;
            vinculo.id_aluno_vinculado = v.id_aluno_vinculado;
            vinculo.id_treinamento = v.id_treinamento ?? null;
            vinculo.id_turma = v.id_turma ?? null;
            vinculo.criado_por = dto.criado_por;
            return vinculo;
        });
        await this.uow.alunosVinculosRP.save(newVinculos);
        // Return with relations
        return this.getVinculos(id_aluno);
    }

    async getEmpresas(id_aluno: number): Promise<AlunoEmpresaResponseDto[]> {
        const empresas = await this.uow.alunosEmpresasRP.find({
            where: { id_aluno, deletado_em: null },
            order: { criado_em: 'ASC' },
        });
        return empresas.map((e) => ({
            id: e.id,
            id_aluno: e.id_aluno,
            cnpj: e.cnpj,
            razao_social: e.razao_social,
            nome_fantasia: e.nome_fantasia,
            email: e.email,
            telefone: e.telefone,
            cep: e.cep,
            logradouro: e.logradouro,
            numero: e.numero,
            complemento: e.complemento,
            bairro: e.bairro,
            cidade: e.cidade,
            estado: e.estado,
        }));
    }

    async saveEmpresas(id_aluno: number, dto: SaveAlunoEmpresasDto): Promise<AlunoEmpresaResponseDto[]> {
        // Substitui a lista inteira: remove as empresas existentes e regrava as enviadas.
        const existing = await this.uow.alunosEmpresasRP.find({ where: { id_aluno, deletado_em: null } });
        if (existing.length > 0) {
            await this.uow.alunosEmpresasRP.remove(existing);
        }
        if (dto.empresas.length === 0) return [];
        const novas = dto.empresas.map((e) => {
            const empresa = new AlunosEmpresas();
            empresa.id_aluno = id_aluno;
            empresa.cnpj = e.cnpj;
            empresa.razao_social = e.razao_social;
            empresa.nome_fantasia = e.nome_fantasia ?? null;
            empresa.email = e.email ?? null;
            empresa.telefone = e.telefone ?? null;
            empresa.cep = e.cep ?? null;
            empresa.logradouro = e.logradouro ?? null;
            empresa.numero = e.numero ?? null;
            empresa.complemento = e.complemento ?? null;
            empresa.bairro = e.bairro ?? null;
            empresa.cidade = e.cidade ?? null;
            empresa.estado = e.estado ?? null;
            empresa.criado_por = dto.criado_por;
            return empresa;
        });
        await this.uow.alunosEmpresasRP.save(novas);
        return this.getEmpresas(id_aluno);
    }

    /**
     * Corrige a sequência de IDs da tabela alunos quando ela está desincronizada
     * Isso pode acontecer quando dados são inseridos manualmente ou importados
     */
    private async fixAlunosSequence(): Promise<void> {
        try {
            const queryRunner = this.uow.alunosRP.manager.connection.createQueryRunner();

            // Obter o schema da tabela (pode ser 'public' ou outro)
            const schema = this.uow.alunosRP.metadata.schema || 'public';

            // Obter o maior ID atual na tabela
            const result = await queryRunner.query(`SELECT COALESCE(MAX(id), 0) as max_id FROM ${schema}.alunos`);
            const maxId = parseInt(result[0]?.max_id || '0', 10);

            // Resetar a sequência para o próximo valor após o maior ID
            // Tentar diferentes formatos de nome de sequência
            const nextId = maxId + 1;
            try {
                // Tentar com schema
                await queryRunner.query(`SELECT setval('${schema}.alunos_id_seq', $1, false)`, [nextId]);
            } catch (seqError) {
                // Se falhar, tentar sem schema (sequência pode estar no schema padrão)
                try {
                    await queryRunner.query(`SELECT setval('alunos_id_seq', $1, false)`, [nextId]);
                } catch (seqError2) {
                    // Se ainda falhar, tentar encontrar o nome real da sequência
                    const seqResult = await queryRunner.query(`SELECT pg_get_serial_sequence('${schema}.alunos', 'id') as seq_name`);
                    const seqName = seqResult[0]?.seq_name;
                    if (seqName) {
                        await queryRunner.query(`SELECT setval($1, $2, false)`, [seqName, nextId]);
                    } else {
                        throw new Error('Não foi possível encontrar a sequência');
                    }
                }
            }

            await queryRunner.release();
            console.log(`Sequência de alunos corrigida. Próximo ID será: ${nextId}`);
        } catch (error) {
            console.error('Erro ao corrigir sequência de alunos:', error);
            // Não relançar o erro, apenas logar
            // Se a correção falhar, o erro original será relançado
        }
    }
}
