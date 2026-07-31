import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

export const LIMITE_ITENS_POR_LOTE = 500;

/** Status financeiro de um cliente enviado pela Gestão de Contas. */
export class StatusClienteGestaoContasDto {
    /**
     * Id do aluno no IAM Control. Quando presente, é usado direto e dispensa a
     * conferência por telefone/e-mail/nome.
     */
    @IsOptional()
    @IsInt()
    iam_control_aluno_id?: number;

    /** Id do `student` na Gestão de Contas. Só entra nos logs, para rastreio. */
    @IsOptional()
    @IsString()
    gestao_contas_student_id?: string;

    @IsOptional()
    @IsString()
    nome?: string;

    @IsOptional()
    @IsString()
    email?: string;

    @IsOptional()
    @IsString()
    telefone?: string;

    @IsOptional()
    @IsString()
    cpf?: string;

    /**
     * Rótulo de status da Gestão de Contas (ex.: "Inadimplente", "Em dia",
     * "Cancelado"). Interpretado por `mapearStatus` no serviço.
     */
    @IsOptional()
    @IsString()
    status?: string;

    /** Sinal explícito de inadimplência. Tem prioridade sobre `status`. */
    @IsOptional()
    @IsBoolean()
    inadimplente?: boolean;

    @IsOptional()
    @IsNumber()
    valor_pendente?: number;

    @IsOptional()
    @IsInt()
    parcelas_pagas?: number;

    @IsOptional()
    @IsInt()
    parcelas_totais?: number;

    @IsOptional()
    @IsString()
    atualizado_em?: string;
}

export class ReceberStatusGestaoContasDto {
    @IsArray()
    @ArrayMinSize(1, { message: 'Envie ao menos um item em "itens".' })
    @ArrayMaxSize(LIMITE_ITENS_POR_LOTE, { message: `Envie no máximo ${LIMITE_ITENS_POR_LOTE} itens por requisição.` })
    @ValidateNested({ each: true })
    @Type(() => StatusClienteGestaoContasDto)
    itens: StatusClienteGestaoContasDto[];

    /** Token de webhook (alternativa ao header). Validado pelo WebhookTokenGuard. */
    @IsOptional()
    @IsString()
    token?: string;
}

export type TResultadoItemStatus = 'atualizado' | 'sem_alteracao' | 'nao_encontrado' | 'ambiguo' | 'erro';

export class DetalheItemStatusDto {
    indice: number;
    resultado: TResultadoItemStatus;
    iam_control_aluno_id: number | null;
    gestao_contas_student_id: string | null;
    /** Como o aluno foi localizado: pelo id externo ou pela conferência de identidade. */
    casado_por: 'id' | 'identidade' | null;
    status_aplicado: string | null;
    pendencia_pagamento_aplicada: boolean | null;
    matriculas_atualizadas: number;
    mensagem: string | null;
}

export class ReceberStatusGestaoContasResponseDto {
    recebidos: number;
    atualizados: number;
    sem_alteracao: number;
    nao_encontrados: number;
    ambiguos: number;
    erros: number;
    detalhes: DetalheItemStatusDto[];
}
