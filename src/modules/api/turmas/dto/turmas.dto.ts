import {
    IsOptional,
    IsString,
    IsNumber,
    IsEnum,
    IsBoolean,
    IsArray,
    ValidateNested,
    ValidateIf,
    IsInt,
    Min,
    IsObject,
    IsIn,
    MinLength,
    MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { EStatusTurmas, EStatusAlunosTurmas, EOrigemAlunos, EStatusEventoCalendario } from '../../../config/entities/enum';

export class UpdateStatusEventoDto {
    @IsEnum(EStatusEventoCalendario)
    status_evento: EStatusEventoCalendario;
}

export class GetTurmasDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    edicao_turma?: string;

    @IsOptional()
    @IsEnum(EStatusTurmas)
    status_turma?: EStatusTurmas;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    id_polo?: number;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    id_treinamento?: number;

    // Visualização por empresa (seletor global): filtra pelo vínculo
    // treinamento→empresa NA QUERY (antes da paginação, como o filtro por tipo).
    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    id_empresa?: number;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    tipo_treinamento?: string; // 'palestra' ou 'treinamento'

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    data_inicio?: string; // Formato: YYYY-MM-DD

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    data_final?: string; // Formato: YYYY-MM-DD

    // Filtra turmas habilitadas para credenciamento NA QUERY (antes da paginação):
    // com o volume de masterclasses sincronizadas, turmas abertas antigas por
    // criado_em ficavam fora do limit e sumiam do credenciamento.
    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === true || value === 'true')
    turma_aberta?: boolean;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    page?: number = 1;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value))
    limit?: number = 10;
}

export class CreateTurmaDto {
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_polo: number;

    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_treinamento: number;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    lider_evento?: number;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    edicao_turma?: string;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_endereco_evento?: number;

    @ValidateIf((o) => !o.id_endereco_evento)
    @IsString()
    cep?: string;

    @ValidateIf((o) => !o.id_endereco_evento)
    @IsString()
    logradouro?: string;

    @IsOptional()
    @IsString()
    complemento?: string;

    @ValidateIf((o) => !o.id_endereco_evento)
    @IsString()
    numero?: string;

    @ValidateIf((o) => !o.id_endereco_evento)
    @IsString()
    bairro?: string;

    @ValidateIf((o) => !o.id_endereco_evento)
    @IsString()
    cidade?: string;

    @ValidateIf((o) => !o.id_endereco_evento)
    @IsString()
    estado?: string;

    @IsOptional()
    @IsEnum(EStatusTurmas)
    status_turma?: EStatusTurmas = EStatusTurmas.AGUARDANDO_LIBERACAO;

    @IsOptional()
    @IsBoolean()
    autorizar_bonus?: boolean = false;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_turma_bonus?: number;

    // Mentorias não têm capacidade de sala definida.
    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    capacidade_turma?: number | null;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    meta?: number | null;

    // Mentorias não têm data de evento (período por mentorado, a partir da assinatura).
    @IsOptional()
    @IsString()
    data_inicio?: string | null;

    @IsOptional()
    @IsString()
    data_final?: string | null;

    @IsOptional()
    @IsBoolean()
    turma_aberta?: boolean = false;

    @IsOptional()
    @IsArray()
    @IsNumber({}, { each: true })
    @Transform(({ value }) => {
        if (!Array.isArray(value)) return value;
        return value.map((v: any) => (typeof v === 'string' ? parseInt(v, 10) : v));
    })
    bonus_treinamentos?: number[];

    @IsOptional()
    @IsArray()
    @IsNumber({}, { each: true })
    @Transform(({ value }) => {
        if (!Array.isArray(value)) return value;
        return value.map((v: any) => (typeof v === 'string' ? parseInt(v, 10) : v));
    })
    turmas_imersao_ofertadas?: number[];

    @IsOptional()
    @IsArray()
    @IsNumber({}, { each: true })
    @Transform(({ value }) => {
        if (!Array.isArray(value)) return value;
        return value.map((v: any) => (typeof v === 'string' ? parseInt(v, 10) : v));
    })
    turmas_ipr_relacionadas?: number[];

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    url_midia_kit?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    url_grupo_whatsapp?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    url_grupo_whatsapp_2?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    url_pagamento_cartao?: string;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    criado_por?: number;
}

export class UpdateTurmaDto {
    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_polo?: number;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_treinamento?: number;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    lider_evento?: number;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    edicao_turma?: string;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_endereco_evento?: number;

    @IsOptional()
    @IsString()
    cep?: string;

    @IsOptional()
    @IsString()
    logradouro?: string;

    @IsOptional()
    @IsString()
    complemento?: string;

    @IsOptional()
    @IsString()
    numero?: string;

    @IsOptional()
    @IsString()
    bairro?: string;

    @IsOptional()
    @IsString()
    cidade?: string;

    @IsOptional()
    @IsString()
    estado?: string;

    @IsOptional()
    @IsEnum(EStatusTurmas)
    status_turma?: EStatusTurmas;

    @IsOptional()
    @IsBoolean()
    autorizar_bonus?: boolean;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_turma_bonus?: number;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    capacidade_turma?: number;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    meta?: number;

    @IsOptional()
    @IsString()
    data_inicio?: string;

    @IsOptional()
    @IsString()
    data_final?: string;

    @IsOptional()
    @IsBoolean()
    turma_aberta?: boolean;

    @IsOptional()
    @IsArray()
    @IsNumber({}, { each: true })
    @Transform(({ value }) => {
        if (!Array.isArray(value)) return value;
        return value.map((v: any) => (typeof v === 'string' ? parseInt(v, 10) : v));
    })
    bonus_treinamentos?: number[];

    @IsOptional()
    @IsArray()
    @IsNumber({}, { each: true })
    @Transform(({ value }) => {
        if (!Array.isArray(value)) return value;
        return value.map((v: any) => (typeof v === 'string' ? parseInt(v, 10) : v));
    })
    turmas_imersao_ofertadas?: number[];

    @IsOptional()
    @IsArray()
    @IsNumber({}, { each: true })
    @Transform(({ value }) => {
        if (!Array.isArray(value)) return value;
        return value.map((v: any) => (typeof v === 'string' ? parseInt(v, 10) : v));
    })
    turmas_ipr_relacionadas?: number[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TimeEquipeGrupoDto)
    times_equipes?: TimeEquipeGrupoDto[];

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    url_midia_kit?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    url_grupo_whatsapp?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    url_grupo_whatsapp_2?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    url_pagamento_cartao?: string;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    atualizado_por?: number;

    @IsOptional()
    @IsString()
    atualizado_em?: string;
}

export class OutroClienteTurmaAlunoDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.toString().trim())
    id?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.toString().trim())
    nome?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.toString().trim())
    email?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.toString().trim())
    telefone?: string;
}

export class AddAlunoTurmaDto {
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_aluno: number;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    nome_cracha?: string; // Se não fornecido, usa o nome_cracha do aluno

    @IsOptional()
    @IsString()
    origem_aluno?: 'COMPROU_INGRESSO' | 'ALUNO_BONUS' | 'ALUNO_CONVIDADO' | 'CORTESIA' | 'SORTEIO' | 'PRESENTE' | 'TRANSFERENCIA';

    @IsOptional()
    @IsEnum(EStatusAlunosTurmas)
    status_aluno_turma?: EStatusAlunosTurmas;

    @IsOptional()
    @IsBoolean()
    vaga_bonus?: boolean;

    @IsOptional()
    @IsString()
    id_aluno_bonus?: string;

    @IsOptional()
    @IsBoolean()
    pendencia_pagamento?: boolean;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Transform(({ value, obj }) => {
        if (value === '' || value === null || value === undefined) {
            if (obj?.contrato_duplo === true) return 2;
            if (obj?.contrato_duplo === false) return 1;
            return undefined;
        }
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return Number.isFinite(n) && n > 0 ? n : undefined;
    })
    quantidade_inscricoes?: number;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => OutroClienteTurmaAlunoDto)
    outros_clientes?: OutroClienteTurmaAlunoDto[];

    @IsOptional()
    @IsString()
    comprovante_pagamento_base64?: string;

    // Marca inserções feitas pelo fluxo de vendas/bônus (finalização de venda,
    // edição de venda no histórico). Essas inserções são a exceção da regra de
    // acessora/Cuidado de Alunos e não passam pela validação de permissão.
    @IsOptional()
    @IsBoolean()
    via_fluxo_venda?: boolean;
}

export class UpdateAlunoTurmaDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    nome_cracha?: string;

    @IsOptional()
    @IsString()
    url_comprovante_pgto?: string;

    @IsOptional()
    @IsBoolean()
    pendencia_pagamento?: boolean;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Transform(({ value, obj }) => {
        if (value === '' || value === null || value === undefined) {
            if (obj?.contrato_duplo === true) return 2;
            if (obj?.contrato_duplo === false) return 1;
            return undefined;
        }
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return Number.isFinite(n) && n > 0 ? n : undefined;
    })
    quantidade_inscricoes?: number;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => OutroClienteTurmaAlunoDto)
    outros_clientes?: OutroClienteTurmaAlunoDto[];

    @IsOptional()
    @IsString()
    comprovante_pagamento_base64?: string;

    @IsOptional()
    @IsEnum(EStatusAlunosTurmas)
    status_aluno_turma?: EStatusAlunosTurmas;

    // Motivo informado pelo usuário ao cancelar a matrícula do aluno na turma.
    // Registrado no histórico de observações agregado do aluno.
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    motivo_cancelamento?: string;

    @IsOptional()
    @IsEnum(EOrigemAlunos)
    origem_aluno?: EOrigemAlunos;

    // Turma de onde o aluno veio (usado quando a origem é TRANSFERENCIA).
    // Permite enviar null para limpar a referência.
    @IsOptional()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return Number.isFinite(n) && n > 0 ? n : null;
    })
    id_turma_transferencia_de?: number | null;

    @IsOptional()
    @IsString()
    presenca_turma?: string;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    atualizado_por?: number;

    @IsOptional()
    @IsString()
    atualizado_em?: string;

    @IsOptional()
    @IsBoolean()
    confirmacao_realizada?: boolean;

    @IsOptional()
    @IsBoolean()
    checkin_realizado?: boolean;

    // Acessor (usuário do sistema) responsável pelo aluno. Disponível apenas para
    // alunos que entraram por boleto. Aceita null para limpar a referência.
    @IsOptional()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return Number.isFinite(n) && n > 0 ? n : null;
    })
    id_acessor?: number | null;

    // Forma de pagamento definida MANUALMENTE (negociação extra sistema). Permitida
    // apenas quando o aluno NÃO tem forma de pagamento resolvida por contrato
    // ("Forma de pagamento indisponível"). Aceita null para limpar.
    @IsOptional()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        return typeof value === 'string' ? value.toUpperCase().trim() : value;
    })
    forma_pagamento_manual?: string | null;

    // Dia de vencimento do boleto (1-31) da forma de pagamento manual (somente BOLETO).
    @IsOptional()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return Number.isFinite(n) && n > 0 ? n : null;
    })
    boleto_dia_vencimento_manual?: number | null;

    // Quantidade de boletos da forma de pagamento manual (somente BOLETO).
    @IsOptional()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return Number.isFinite(n) && n > 0 ? n : null;
    })
    boleto_quantidade_manual?: number | null;

    // Datas de assinatura da mentoria (somente turmas de mentoria). Edição manual do
    // período do mentorado; registra no histórico do aluno quem fez a alteração.
    // Formato aceito AAAA-MM-DD; null limpa a data.
    @IsOptional()
    @IsString()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        return typeof value === 'string' ? value.slice(0, 10) : value;
    })
    data_inicio_mentoria?: string | null;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        return typeof value === 'string' ? value.slice(0, 10) : value;
    })
    data_fim_mentoria?: string | null;
}

export class TurmaResponseDto {
    id: number;
    id_polo: number;
    id_treinamento: number;
    lider_evento?: number;
    edicao_turma?: string;
    // Identificador de origem externa (feed de masterclass). Preenchido quando a
    // turma foi importada; nulo quando criada manualmente no IAM Control.
    referencia_externa?: string | null;
    // Status do evento no calendário (cores da legenda). Ver EStatusEventoCalendario.
    status_evento?: string;
    id_endereco_evento?: number;
    cep: string;
    logradouro: string;
    complemento: string;
    numero: string;
    bairro: string;
    cidade: string;
    estado: string;
    status_turma: EStatusTurmas;
    autorizar_bonus: boolean;
    id_turma_bonus?: number;
    capacidade_turma: number;
    meta?: number;
    /** Pico (máximo histórico) de inscritos usado para congelar a meta. */
    meta_pico_inscritos?: number | null;
    /** Pico (máximo histórico) de alunos extras usado para congelar a meta. */
    meta_pico_extras?: number | null;
    data_inicio: string;
    data_final: string;
    turma_aberta: boolean;
    bonus_treinamentos?: number[];
    detalhamento_bonus?: { id_treinamento_db: number }[];
    turmas_imersao_ofertadas?: number[];
    turmas_ipr_relacionadas?: number[];
    times_equipes?: TimeEquipeGrupoDto[];
    url_midia_kit?: string;
    url_grupo_whatsapp?: string;
    url_grupo_whatsapp_2?: string;
    url_pagamento_cartao?: string;
    created_at: Date;
    updated_at: Date;
    polo?: {
        id: number;
        nome: string;
        sigla_polo?: string;
        cidade: string;
        estado: string;
    };
    treinamento?: {
        id: number;
        nome: string;
        tipo: string;
        tipo_mentoria?: boolean;
        sigla_treinamento?: string;
        treinamento?: string;
        duracao_meses?: number | null;
        url_logo_treinamento?: string;
        tipo_online?: boolean;
        /** Empresa dona do treinamento (visualização por empresa). */
        id_empresa?: number | null;
        empresa_nome?: string | null;
    };
    lider?: {
        id: number;
        nome: string;
    };
    /** Acessora da turma (usuária do Cuidado de Alunos) definida pela líder do setor. */
    id_acessora?: number | null;
    acessora?: {
        id: number;
        nome: string;
    } | null;
    /** Quando a acessora atual foi definida (null quando não há acessora). */
    acessora_definida_em?: Date | string | null;
    /** Liberação temporária pós-encerramento (janela de até 24h para venda/credenciamento). */
    liberada_temporariamente_em?: Date | string | null;
    liberada_temporariamente_ate?: Date | string | null;
    liberada_temporariamente_por?: number | null;
    liberada_temporariamente_por_nome?: string | null;
    liberacao_temporaria_observacao?: string | null;
    alunos_count?: number;
    alunos_inscricoes_extras_count?: number;
    alunos_confirmados_count?: number;
    transferidos_count?: number;
    vindos_transferencia_count?: number;
    pre_cadastrados_count?: number;
    presentes_count?: number;
    inadimplentes_count?: number;
    /** Preenchido em opções de transferência */
    treinamento_nome?: string;
    sigla_treinamento?: string;
    polo_nome?: string;
}

export class TurmasListResponseDto {
    data: TurmaResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export class AlunoTurmaResponseDto {
    id: string;
    id_turma: number;
    id_aluno: string;
    nome_cracha: string;
    numero_cracha: string;
    vaga_bonus: boolean;
    origem_aluno?: string;
    /** Distinção de canal para origem COMPROU_INGRESSO */
    origem_canal_ingresso?: 'MASTERCLASS' | 'TIME_VENDAS' | 'DEMAIS_IMPORTACAO';
    /** Canal reclassificado (MESMA regra do dashboard e da planilha): Bônus, Cortesia/Sorteio, Transferência, Masterclass, Time de Vendas, Transbordo, Liberty, Vendas em Eventos. */
    canal?: string;
    /** Categoria do dashboard: 'Extra' ou 'Compra de Ingresso'. */
    categoria?: string;
    status_aluno_turma?: string;
    confirmacao_realizada?: boolean;
    checkin_realizado?: boolean;
    presenca_turma?: string;
    /** Mentorias: início do período do mentorado (data da assinatura/finalização do contrato). */
    data_inicio_mentoria?: string | null;
    /** Mentorias: fim do período do mentorado (início + duração configurada). */
    data_fim_mentoria?: string | null;
    ficha_preenchida?: boolean;
    url_comprovante_pgto?: string;
    pendencia_pagamento?: boolean;
    quantidade_inscricoes?: number;
    outros_clientes?: OutroClienteTurmaAlunoDto[];
    /**
     * Forma(s) de pagamento do contrato que trouxe o aluno para esta turma (venda
     * feita para a turma ou, em caso de transferência, o contrato da turma de origem).
     * Label amigável já formatado; "Forma de pagamento indisponível" quando não há contrato.
     */
    forma_pagamento?: string;
    /** Códigos das formas de pagamento (EFormasPagamento) do contrato, sem duplicatas. */
    formas_pagamento?: string[];
    /** true quando o aluno entrou por boleto (habilita a seleção de acessor no frontend). */
    veio_por_boleto?: boolean;
    /**
     * Forma de pagamento definida manualmente (negociação extra sistema), presente
     * apenas quando o aluno não tem contrato que resolva a forma de pagamento.
     */
    forma_pagamento_manual?: string | null;
    /** Dia de vencimento do boleto (1-31) da forma manual (somente BOLETO). */
    boleto_dia_vencimento_manual?: number | null;
    /** Quantidade de boletos da forma manual (somente BOLETO). */
    boleto_quantidade_manual?: number | null;
    /**
     * Detalhes do boleto vindos do CONTRATO da venda (quando a forma inclui BOLETO):
     * parcelas e data do 1º boleto para o frontend calcular o boleto atual pela data do sistema.
     */
    boleto_contrato?: {
        parcelas?: number | null;
        data_primeiro_boleto?: string | null;
        dia_vencimento?: number | null;
    } | null;
    /** Acessor responsável (apenas para alunos que vieram por boleto). */
    id_acessor?: number | null;
    acessor?: {
        id: number;
        nome: string;
    } | null;
    // Compatibilidade temporária com front legado
    contrato_duplo?: boolean;
    comprovante_pagamento_base64?: string;
    /** Indicador leve na listagem (sem carregar o base64). */
    tem_comprovante_pagamento?: boolean;
    created_at: Date;
    /** true quando a matrícula foi criada por uma transferência automática do robô (no-show IPR em turma congelada). */
    transferido_por_robo?: boolean;
    /** Observação interna da venda ("uso do sistema") trazida do contrato, quando houver. */
    observacao_venda?: string;
    /** Tag "Transferência Para": turma para a qual o aluno foi transferido (permanece na turma atual com esta referência). */
    transferencia_para_turma?: {
        id: number;
        edicao_turma?: string;
        data_inicio: string;
        data_final: string;
        treinamento_nome?: string;
        sigla_treinamento?: string;
        polo_nome?: string;
    };
    /** Tag "Transferência De": turma de onde o aluno veio. */
    transferencia_de_turma?: {
        id: number;
        edicao_turma?: string;
        data_inicio: string;
        data_final: string;
        treinamento_nome?: string;
        sigla_treinamento?: string;
        polo_nome?: string;
    };
    aluno?: {
        id: number;
        nome: string;
        email: string;
        telefone?: string;
        telefone_um?: string;
        telefone_dois?: string;
        nome_cracha: string;
        cpf?: string;
        instagram?: string;
        cep?: string;
        logradouro?: string;
        complemento?: string;
        numero?: string;
        bairro?: string;
        cidade?: string;
        estado?: string;
        profissao?: string;
        genero?: string;
        data_nascimento?: string;
        status_aluno_geral?: string;
        possui_deficiencia?: boolean;
        desc_deficiencia?: string;
    };
}

/** Opções de transferência: edição mais próxima por data e próxima edição no mesmo polo. */
export class OpcoesTransferenciaResponseDto {
    edicao_mais_proxima_data?: TurmaResponseDto;
    proxima_edicao_mesmo_polo?: TurmaResponseDto;
}

export class TransferirAlunoDto {
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    id_turma_destino: number;
}

export class HistoricoTransferenciaItemDto {
    id: string;
    id_aluno: number;
    id_turma_de: number;
    id_turma_para: number;
    origem_label?: string;
    turma_de: {
        id: number;
        edicao_turma?: string;
        data_inicio: string;
        data_final: string;
        treinamento_nome?: string;
        sigla_treinamento?: string;
        polo_nome?: string;
    };
    turma_para: {
        id: number;
        edicao_turma?: string;
        data_inicio: string;
        data_final: string;
        treinamento_nome?: string;
        sigla_treinamento?: string;
        polo_nome?: string;
    };
    criado_em: Date;
}

export class HistoricoTransferenciasResponseDto {
    data: HistoricoTransferenciaItemDto[];
}

export class AlunoTurmaHistoricoTemplateDto {
    key: string;
    label: string;
    descricao?: string;
}

export class AlunoTurmaHistoricoItemDto {
    id: string;
    id_turma_aluno: string;
    id_turma: number;
    id_aluno: string;
    tipo_acao: string;
    titulo: string;
    descricao: string | null;
    template_key: string | null;
    detalhes?: Record<string, unknown>;
    criado_por?: number | null;
    nome_usuario?: string | null;
    data_acao: Date;
    criado_em: Date;
}

export class AlunoTurmaHistoricoResponseDto {
    data: AlunoTurmaHistoricoItemDto[];
    templates: AlunoTurmaHistoricoTemplateDto[];
}

export class RemoveAlunoTurmaDto {
    // Motivo informado pelo usuário ao remover a matrícula do aluno da turma.
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    motivo?: string;
}

/** Libera temporariamente (24h) uma turma encerrada para venda e credenciamento. */
export class LiberarTurmaTemporariamenteDto {
    @IsString()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @MinLength(5, { message: 'Informe uma observação com pelo menos 5 caracteres para liberar a turma.' })
    @MaxLength(300, { message: 'A observação deve ter no máximo 300 caracteres.' })
    observacao: string;
}

/** Define (ou remove, com null) a acessora do Cuidado de Alunos responsável pela turma. */
export class UpdateTurmaAcessoraDto {
    @IsOptional()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return Number.isFinite(n) && n > 0 ? n : null;
    })
    id_acessora?: number | null;
}

/** Item do histórico de observações agregado por aluno (todas as turmas). */
export class AlunoHistoricoObservacaoItemDto extends AlunoTurmaHistoricoItemDto {
    /** Rótulo da turma onde a operação ocorreu: "<treinamento|sigla> - <edição>". */
    turma_label: string;
    treinamento_nome?: string | null;
    sigla_treinamento?: string | null;
    edicao_turma?: string | null;
}

/** Turma disponível como filtro no histórico de observações do aluno. */
export class AlunoHistoricoTurmaFiltroDto {
    id_turma: number;
    label: string;
    treinamento_nome?: string | null;
    sigla_treinamento?: string | null;
    edicao_turma?: string | null;
}

export class AlunoHistoricoObservacoesResponseDto {
    data: AlunoHistoricoObservacaoItemDto[];
    turmas: AlunoHistoricoTurmaFiltroDto[];
    templates: AlunoTurmaHistoricoTemplateDto[];
}

export class CreateAlunoTurmaHistoricoDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    template_key?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    titulo?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    descricao?: string;

    @IsOptional()
    @IsObject()
    detalhes?: Record<string, unknown>;
}

/* ============ Histórico (log de alterações) da turma/evento ============ */

export class TurmaHistoricoItemDto {
    id: string;
    id_turma: number;
    tipo_acao: string;
    titulo: string;
    descricao: string | null;
    template_key: string | null;
    detalhes?: Record<string, unknown>;
    criado_por?: number | null;
    nome_usuario?: string | null;
    data_acao: Date;
    criado_em: Date;
}

export class TurmaHistoricoResponseDto {
    data: TurmaHistoricoItemDto[];
    templates: AlunoTurmaHistoricoTemplateDto[];
}

export class CreateTurmaHistoricoDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    template_key?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    titulo?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    descricao?: string;

    @IsOptional()
    @IsObject()
    detalhes?: Record<string, unknown>;
}

export class AlunosTurmaListResponseDto {
    data: AlunoTurmaResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

/** Campos mínimos para exportação XLSX (sem comprovantes ou transferências); inclui canal/categoria do dashboard. */
export class AlunoTurmaExportItemDto {
    nome: string;
    email: string;
    /** Canal reclassificado (mesma regra do dashboard): Bônus, Cortesia/Sorteio, Transferência, Masterclass, Time de Vendas, Transbordo, Liberty, Vendas em Eventos. */
    canal?: string;
    /** Categoria do dashboard: 'Extra' ou 'Compra de Ingresso'. */
    categoria?: string;
    telefone_um?: string;
    telefone_dois?: string;
    nome_cracha?: string;
    numero_cracha?: string;
    status_aluno_turma?: string;
    origem_aluno?: string;
    created_at: string;
}

export class AlunosTurmaExportResponseDto {
    data: AlunoTurmaExportItemDto[];
    total: number;
}

export class AlunosDisponiveis {
    id: number;
    nome: string;
    email: string;
    nome_cracha: string;
    status_aluno_geral: string;
    polo?: {
        id: number;
        nome: string;
    };
}

export class AlunosDisponiveisResponseDto {
    data: AlunosDisponiveis[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export class TurmaStatusResumoResponseDto {
    id_turma: number;
    inscritos: number;
    origem_masterclass: number;
    /** Presente (importação Masterclass): conta como extra. */
    origem_presente: number;
    origem_bonus: number;
    origem_time_vendas: number;
    origem_transbordo: number;
    origem_liberty: number;
    origem_transferencia: number;
    /** Cortesia + sorteio (origem_aluno) */
    origem_cortesia_sorteio: number;
    /**
     * Demais vendas / importação: tudo que não entrou nos outros canais (inclui COMPROU_INGRESSO com ou sem histórico de transferência).
     */
    origem_importacao: number;
    transferidos: number;
    transferidos_dessa_turma_para_outra: number;
    transferidos_de_outra_turma_para_essa: number;
    falta_enviar_confirmacao: number;
    aguardando_confirmacao: number;
    /** Confirmado = passou da etapa de confirmação (aguardando check-in + check-in realizado). */
    confirmados: number;
    falta_enviar_checkin: number;
    aguardando_checkin: number;
    checkin_realizado: number;
    cancelados: number;
    inadimplentes: number;
    status_counts: Record<string, number>;
    /** Indica que os números vêm de um snapshot congelado (turma encerrada e D+1 da data final). */
    congelado?: boolean;
    /** Momento em que o snapshot foi congelado (apenas quando congelado=true). */
    snapshot_em?: Date | string;
}

export class TurmaStatusAlunosItemDto {
    id_turma_aluno: string;
    id_aluno: number;
    nome: string;
    email: string;
    telefone: string | null;
    status_aluno_geral: string | null;
    status_aluno_turma: EStatusAlunosTurmas | null;
    confirmacao_realizada?: boolean;
    checkin_realizado?: boolean;
    transferencia_direcao?: 'Transferido De' | 'Transferido Para' | null;
    transferencia_turma_relacionada?: string | null;
    /** Data/hora em que o aluno foi inserido na turma/estratégia (criado_em da matrícula). */
    inserido_em?: string | null;
    /** Nome do usuário que inseriu o aluno (criado_por da matrícula). */
    inserido_por_nome?: string | null;
}

export class TurmaStatusAlunosResponseDto {
    id_turma: number;
    tipo: string;
    titulo: string;
    total: number;
    alunos: TurmaStatusAlunosItemDto[];
}

export class TimeEquipeGrupoDto {
    @IsString()
    @Transform(({ value }) => value?.toString().trim())
    id: string;

    @IsString()
    @Transform(({ value }) => value?.toString().trim())
    nome: string;

    @IsString()
    @Transform(({ value }) => value?.toString().trim())
    liderId: string;

    @IsArray()
    @IsString({ each: true })
    @Transform(({ value }) => (Array.isArray(value) ? value.map((item) => item?.toString().trim()).filter(Boolean) : []))
    membrosIds: string[];
}

export class UpdateTurmaTimesDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TimeEquipeGrupoDto)
    times_equipes: TimeEquipeGrupoDto[];
}

export class TurmaTimesResponseDto {
    id_turma: number;
    times_equipes: TimeEquipeGrupoDto[];
}

export class SoftDeleteTurmaDto {
    @IsString()
    deletado_em: string;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === '' || value === null || value === undefined) return null;
        const n = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(n) ? null : n;
    })
    atualizado_por?: number;
}

/**
 * Helper de Transform: aceita "1,2,3" (string CSV) ou ["1","2"] (array) e devolve number[].
 */
const transformToNumberArray = ({ value }: { value: unknown }): number[] => {
    if (value === null || value === undefined || value === '') return [];
    const raw = Array.isArray(value) ? value : String(value).split(',');
    return raw.map((item) => parseInt(String(item).trim(), 10)).filter((n) => !Number.isNaN(n));
};

/** Filtros do extrato de movimentação de turmas (acompanhamento extratificado). */
export class GetExtratoMovimentacaoDto {
    @IsString()
    @Transform(({ value }) => value?.toString().trim())
    data_inicio: string; // YYYY-MM-DD

    @IsString()
    @Transform(({ value }) => value?.toString().trim())
    data_final: string; // YYYY-MM-DD

    @IsOptional()
    @IsArray()
    @Transform(transformToNumberArray)
    treinamento_ids?: number[];

    @IsOptional()
    @IsArray()
    @Transform(transformToNumberArray)
    turma_ids?: number[];
}

/** Detalhe de uma categoria/motivo dentro de entrada ou saída. */
export class ExtratoMovimentacaoDetalheDto {
    /** Rótulo da categoria (ex.: Masterclass, Time de Vendas, Cancelamento, Transferência). */
    label: string;
    /** Quantidade de alunos nessa categoria no período/dia. */
    total: number;
}

/** Movimentação de um único dia dentro do período (quebra diária). */
export class ExtratoMovimentacaoDiaDto {
    /** Data do dia no formato YYYY-MM-DD. */
    data: string;
    saldo_inicial: number;
    entrada: number;
    saida: number;
    saldo_final: number;
    /** Percentual de variação do dia: (entrada - saída) / saldo_inicial * 100. */
    performance: number;
    entrada_detalhes: ExtratoMovimentacaoDetalheDto[];
    saida_detalhes: ExtratoMovimentacaoDetalheDto[];
}

/** Linha do extrato: uma turma agregada no período, com quebra diária. */
export class ExtratoMovimentacaoTurmaDto {
    id_turma: number;
    /** Rótulo da turma: "<treinamento> - <edição>". */
    turma_label: string;
    treinamento_nome?: string | null;
    sigla_treinamento?: string | null;
    edicao_turma?: string | null;
    /** Saldo no início do período. */
    saldo: number;
    entrada: number;
    saida: number;
    /** Resultado/saldo final = saldo + entrada - saída. */
    resultado: number;
    /** Performance do período: (entrada - saída) / saldo * 100. */
    performance: number;
    /**
     * Estratificação do saldo inicial por estratégia/canal de origem (mesma
     * partição do modal de alunos do saldo): quantos alunos de cada estratégia
     * compunham a turma no início do período.
     */
    inicio_detalhes: ExtratoMovimentacaoDetalheDto[];
    entrada_detalhes: ExtratoMovimentacaoDetalheDto[];
    saida_detalhes: ExtratoMovimentacaoDetalheDto[];
    por_dia: ExtratoMovimentacaoDiaDto[];
}

export class ExtratoMovimentacaoResponseDto {
    data_inicio: string;
    data_final: string;
    /** Dias (YYYY-MM-DD) com movimentação no período — colunas da tabela extratificada. */
    dias: string[];
    data: ExtratoMovimentacaoTurmaDto[];
    /** Totais consolidados de todas as turmas filtradas. */
    totais: {
        saldo: number;
        entrada: number;
        saida: number;
        resultado: number;
        performance: number;
    };
}

/** Filtros (período) para listar os alunos das movimentações de uma turma. */
export class GetMovimentacaoAlunosDto {
    @IsString()
    @Transform(({ value }) => value?.toString().trim())
    data_inicio: string; // YYYY-MM-DD

    @IsString()
    @Transform(({ value }) => value?.toString().trim())
    data_final: string; // YYYY-MM-DD
}

/** Um aluno presente em uma movimentação (entrada/saída) da turma dentro do período. */
export class MovimentacaoAlunoItemDto {
    id_aluno: number;
    id_turma_aluno: string | null;
    nome: string;
    email: string | null;
    /** Dia da movimentação (YYYY-MM-DD). */
    dia: string;
    tipo: 'ENTRADA' | 'SAIDA';
    /** Canal (entrada) ou motivo (saída): Masterclass, Bônus, Cancelamento, Transferência etc. */
    categoria: string;
    /** Turma de origem (apenas para transferências): de onde o aluno veio. */
    turma_origem_label?: string | null;
    /** Turma de destino (apenas para transferências): para onde o aluno foi. */
    turma_destino_label?: string | null;
    /** Observações registradas para o aluno (agregadas ao aluno, todas as turmas). */
    observacoes?: { dia: string; texto: string }[];
}

export class MovimentacaoAlunosResponseDto {
    id_turma: number;
    turma_label: string;
    data_inicio: string;
    data_final: string;
    /** Cada item é uma movimentação (um aluno pode aparecer em mais de uma). */
    alunos: MovimentacaoAlunoItemDto[];
}

/** Filtros para listar os alunos que compõem o saldo da turma no início ou no fim do período. */
export class GetAlunosSaldoPeriodoDto {
    @IsString()
    @Transform(({ value }) => value?.toString().trim())
    data_inicio: string; // YYYY-MM-DD

    @IsString()
    @Transform(({ value }) => value?.toString().trim())
    data_final: string; // YYYY-MM-DD

    /** Momento do saldo: INICIO (antes do período) ou FIM (ao final do período). */
    @IsIn(['INICIO', 'FIM'])
    @Transform(({ value }) => value?.toString().trim().toUpperCase())
    momento: 'INICIO' | 'FIM';
}

/** Um aluno que compunha o saldo da turma no momento consultado. */
export class AlunoSaldoPeriodoItemDto {
    id_aluno: number;
    id_turma_aluno: string;
    nome: string;
    email: string | null;
    /** Dia em que o aluno entrou na turma (YYYY-MM-DD). */
    dia_entrada: string | null;
    /** Turma de origem quando o aluno chegou por transferência. */
    turma_origem_label?: string | null;
    /** Observações registradas para o aluno (agregadas ao aluno, todas as turmas). */
    observacoes?: { dia: string; texto: string }[];
}

/** Grupo de alunos do saldo por estratégia de origem (canal do dashboard). */
export class AlunosSaldoPeriodoCanalDto {
    /** Canal: Vendas em Eventos, Masterclass, Time de Vendas, Transbordo, Bônus, Cortesia/Sorteio, Transferência, Presente, Liberty. */
    canal: string;
    total: number;
    alunos: AlunoSaldoPeriodoItemDto[];
}

export class AlunosSaldoPeriodoResponseDto {
    id_turma: number;
    turma_label: string;
    momento: 'INICIO' | 'FIM';
    /** Data de referência do saldo (YYYY-MM-DD): início ou fim do período. */
    data_referencia: string;
    /** Total de alunos que compunham o saldo no momento consultado. */
    total: number;
    canais: AlunosSaldoPeriodoCanalDto[];
}
