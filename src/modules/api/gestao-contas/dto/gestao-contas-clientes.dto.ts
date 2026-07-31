import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

const DATA_ISO_REGEX = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

export const LIMITE_PADRAO_CLIENTES = 200;
export const LIMITE_MAXIMO_CLIENTES = 500;

const paraBooleano = ({ value }: { value: unknown }): unknown => {
    if (typeof value !== 'string') return value;
    const normalizado = value.trim().toLowerCase();
    if (normalizado === 'true' || normalizado === '1') return true;
    if (normalizado === 'false' || normalizado === '0') return false;
    return value;
};

const paraInteiro = ({ value }: { value: unknown }): unknown => {
    if (typeof value !== 'string') return value;
    const numero = parseInt(value, 10);
    return Number.isNaN(numero) ? value : numero;
};

/** Filtros do webhook de saída de clientes. */
export class GetClientesGestaoContasDto {
    /**
     * Traz apenas clientes alterados a partir desta data (YYYY-MM-DD ou ISO
     * completo). É o que permite à Gestão de Contas fazer sync incremental.
     */
    @IsOptional()
    @IsString()
    @Matches(DATA_ISO_REGEX, { message: 'atualizado_desde deve estar no formato YYYY-MM-DD ou ISO 8601.' })
    @Transform(({ value }) => value?.toString().trim())
    atualizado_desde?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Transform(paraInteiro)
    page?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(LIMITE_MAXIMO_CLIENTES)
    @Transform(paraInteiro)
    limit?: number;

    @IsOptional()
    @IsInt()
    @Transform(paraInteiro)
    id_polo?: number;

    /** Restringe o retorno aos clientes com saldo devedor ou marcados como inadimplentes. */
    @IsOptional()
    @IsBoolean()
    @Transform(paraBooleano)
    somente_inadimplentes?: boolean;

    /** Token de webhook (alternativa ao header). Validado pelo WebhookTokenGuard. */
    @IsOptional()
    @IsString()
    token?: string;
}

export class ClienteEnderecoDto {
    cep: string | null;
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    estado: string | null;
}

export class ClientePoloDto {
    id: number;
    nome: string;
    sigla: string | null;
    cidade: string | null;
    estado: string | null;
}

export class ClienteTreinamentoDto {
    id_treinamento: number;
    nome: string;
    sigla: string | null;
    valor_total: number;
    valor_pago: number;
    valor_pendente: number;
    formas_pagamento: { forma: string; valor: number }[];
    data_venda: string | null;
}

export class ClienteMatriculaDto {
    id_matricula: string;
    id_turma: number;
    status_aluno_turma: string | null;
    pendencia_pagamento: boolean | null;
    origem_aluno: string | null;
    data_matricula: string | null;
    treinamentos: ClienteTreinamentoDto[];
}

export class ClienteFinanceiroDto {
    valor_total_contratado: number;
    valor_total_pago: number;
    valor_pendente: number;
    /** true quando há saldo devedor ou o cadastro já está marcado como INADIMPLENTE. */
    inadimplente: boolean;
}

/**
 * Chaves já normalizadas pelo IAM Control para a Gestão de Contas conferir e
 * não duplicar cadastros. Ver `identidade-cliente.ts`.
 */
export class ClienteChaveDedupeDto {
    telefone: string;
    email: string;
    nome: string;
}

export class ClienteGestaoContasDto {
    /** Identificador estável a ser gravado em `students.iam_control_aluno_id`. */
    iam_control_aluno_id: number;
    nome: string;
    email: string | null;
    cpf: string | null;
    whatsapp: string | null;
    telefone_secundario: string | null;
    data_nascimento: string | null;
    endereco: ClienteEnderecoDto;
    polo: ClientePoloDto | null;
    status_iam_control: string | null;
    financeiro: ClienteFinanceiroDto;
    matriculas: ClienteMatriculaDto[];
    chave_dedupe: ClienteChaveDedupeDto;
    criado_em: string;
    atualizado_em: string;
}

export class ClientesGestaoContasResponseDto {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
    /** Marca d'água para a próxima chamada incremental (`atualizado_desde`). */
    sincronizado_ate: string;
    clientes: ClienteGestaoContasDto[];
}
