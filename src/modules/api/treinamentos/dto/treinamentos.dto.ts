import { IsOptional, IsString, IsNumber, IsBoolean, IsNotEmpty, IsObject } from 'class-validator';
import { Transform } from 'class-transformer';

export interface TreinamentoFormaPagamentoAvistaDto {
    habilitado: boolean;
    valor: number;
}

export interface TreinamentoFormaPagamentoPrazoDto {
    habilitado: boolean;
    valor: number;
    parcelasMin: number;
    parcelasSemLiberacao: number;
    parcelasMaximasComLiberacao?: number | null;
}

export interface TreinamentoConfiguracaoPagamentosDto {
    avista: {
        cartaoCredito: TreinamentoFormaPagamentoAvistaDto;
        cartaoDebito: TreinamentoFormaPagamentoAvistaDto;
        pixTransferencia: TreinamentoFormaPagamentoAvistaDto;
        especieDinheiro: TreinamentoFormaPagamentoAvistaDto;
        link: TreinamentoFormaPagamentoAvistaDto;
    };
    prazo: {
        cartaoCredito: TreinamentoFormaPagamentoPrazoDto;
        boleto: TreinamentoFormaPagamentoPrazoDto;
        link: TreinamentoFormaPagamentoPrazoDto;
    };
}

export class GetTreinamentosDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    treinamento?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => parseFloat(value))
    preco_treinamento?: number;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_treinamento?: boolean;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_palestra?: boolean;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_online?: boolean;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_mentoria?: boolean;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_presencial?: boolean;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value, 10))
    id_empresa?: number;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value, 10))
    page?: number = 1;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseInt(value, 10))
    limit?: number = 12;
}

export class TreinamentoEmpresaResumoDto {
    id: number;
    nome: string;
    sigla?: string | null;
}

export class TreinamentoResponseDto {
    id: number;
    treinamento: string;
    sigla_treinamento?: string;
    preco_treinamento: number;
    configuracao_pagamentos?: TreinamentoConfiguracaoPagamentosDto | null;
    url_logo_treinamento?: string;
    tipo_treinamento: boolean;
    tipo_palestra: boolean;
    tipo_mentoria: boolean;
    duracao_meses?: number | null;
    tipo_online: boolean;
    tipo_presencial: boolean;
    id_empresa?: number | null;
    empresa?: TreinamentoEmpresaResumoDto | null;
    total_turmas: number;
    total_alunos: number;
    capacidade_total: number;
    alunos_presentes: number;
    created_at: string;
    updated_at: string;
    atualizado_por_nome?: string | null;
}

export class TreinamentosListResponseDto {
    data: TreinamentoResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export class CreateTreinamentoDto {
    @IsNotEmpty()
    @IsString()
    @Transform(({ value }) => value?.trim())
    treinamento: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    sigla_treinamento?: string;

    @IsNotEmpty()
    @IsNumber()
    @Transform(({ value }) => parseFloat(value))
    preco_treinamento: number;

    @IsOptional()
    @IsObject()
    configuracao_pagamentos?: TreinamentoConfiguracaoPagamentosDto;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    url_logo_treinamento?: string;

    @IsNotEmpty()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_treinamento: boolean;

    @IsNotEmpty()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_palestra: boolean;

    @IsNotEmpty()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_online: boolean;

    @IsNotEmpty()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_mentoria: boolean;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === null || value === undefined || value === '') return null;
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : null;
    })
    duracao_meses?: number | null;

    @IsNotEmpty()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_presencial: boolean;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === null || value === undefined || value === '') return null;
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : null;
    })
    id_empresa?: number | null;

    @IsOptional()
    @IsNumber()
    criado_por?: number;
}

export class UpdateTreinamentoDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    treinamento?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    sigla_treinamento?: string;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => parseFloat(value))
    preco_treinamento?: number;

    @IsOptional()
    @IsObject()
    configuracao_pagamentos?: TreinamentoConfiguracaoPagamentosDto;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value?.trim())
    url_logo_treinamento?: string;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_treinamento?: boolean;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_palestra?: boolean;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_online?: boolean;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_mentoria?: boolean;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === null || value === undefined || value === '') return null;
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : null;
    })
    duracao_meses?: number | null;

    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    tipo_presencial?: boolean;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => {
        if (value === null || value === undefined || value === '') return null;
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : null;
    })
    id_empresa?: number | null;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;

    @IsOptional()
    @IsString()
    atualizado_em?: string;
}

export class SoftDeleteTreinamentoDto {
    @IsNotEmpty()
    @IsString()
    deletado_em: string;

    @IsOptional()
    @IsNumber()
    atualizado_por?: number;
}
