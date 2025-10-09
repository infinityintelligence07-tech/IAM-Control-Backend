import { IsString, IsOptional, IsArray, ValidateNested, IsNotEmpty, IsEnum, IsNumberString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ETipoDocumento } from '@/modules/config/entities/enum';

export class CampoDocumentoDto {
    @IsString()
    @IsNotEmpty()
    campo: string;

    @IsString()
    @IsNotEmpty()
    tipo: string; // 'texto', 'numero', 'data', 'email', 'telefone', 'documento', 'cep', 'checkbox', 'select'

    @IsOptional()
    @IsString()
    descricao?: string;

    @IsOptional()
    @IsArray()
    opcoes?: string[]; // Para campos do tipo 'select' ou 'checkbox'

    @IsOptional()
    @IsString()
    placeholder?: string;

    @IsOptional()
    @IsString()
    valorPadrao?: string;
}

export class CreateDocumentoDto {
    @IsString()
    @IsNotEmpty()
    documento: string;

    @IsEnum(ETipoDocumento)
    @IsNotEmpty()
    tipo_documento: ETipoDocumento;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CampoDocumentoDto)
    campos: CampoDocumentoDto[];

    @IsString()
    @IsNotEmpty()
    clausulas: string;

    @IsOptional()
    @IsArray()
    @IsNumber({}, { each: true })
    treinamentos_relacionados?: number[];
}

export class UpdateDocumentoDto {
    @IsOptional()
    @IsString()
    documento?: string;

    @IsOptional()
    @IsEnum(ETipoDocumento)
    tipo_documento?: ETipoDocumento;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CampoDocumentoDto)
    campos?: CampoDocumentoDto[];

    @IsOptional()
    @IsString()
    clausulas?: string;

    @IsOptional()
    @IsArray()
    @IsNumber({}, { each: true })
    treinamentos_relacionados?: number[];
}

export class DocumentoResponseDto {
    id: number;
    documento: string;
    tipo_documento: ETipoDocumento;
    campos: CampoDocumentoDto[];
    clausulas: string;
    treinamentos_relacionados?: number[];
    created_at: Date;
    updated_at: Date;
    criado_por?: number;
    atualizado_por?: number;
    deletado_em?: Date;
}

export class DocumentosListResponseDto {
    data: DocumentoResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export class GerarContratoDto {
    @IsString()
    @IsNotEmpty()
    id_documento: string;

    @IsString()
    @IsNotEmpty()
    id_aluno: string;

    @IsOptional()
    @IsString()
    id_turma?: string;

    @IsArray()
    valoresCampos: { nome: string; valor: string }[];
}

export class DocumentosFilterDto {
    @IsOptional()
    @IsEnum(ETipoDocumento)
    tipo_documento?: ETipoDocumento;
}

// DTOs para integração com ZapSign
export class CriarContratoZapSignDto {
    @IsString()
    @IsNotEmpty()
    template_id: string;

    @IsString()
    @IsNotEmpty()
    id_aluno: string;

    @IsString()
    @IsNotEmpty()
    id_treinamento: string;

    @IsString()
    @IsNotEmpty()
    forma_pagamento: string; // 'A_VISTA' | 'PARCELADO' | 'AMBOS'

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => FormaPagamentoDto)
    formas_pagamento?: FormaPagamentoDto[];

    @IsOptional()
    @IsString()
    id_turma_bonus?: string; // Turma de IPR (Imersão Prosperar)

    @IsOptional()
    @IsArray()
    tipos_bonus?: string[]; // Array com os tipos de bônus selecionados

    @IsOptional()
    valores_bonus?: Record<string, boolean>; // Objeto com os valores dos bônus

    @IsOptional()
    campos_variaveis?: Record<string, string>; // Campos variáveis do contrato

    @IsOptional()
    valores_formas_pagamento?: Record<string, any>; // Valores das formas de pagamento

    @IsOptional()
    @IsString()
    testemunha_um_id?: string; // ID do aluno se for do banco

    @IsOptional()
    @IsString()
    testemunha_um_nome?: string; // Nome manual se não for do banco

    @IsOptional()
    @IsString()
    testemunha_um_cpf?: string; // CPF manual se não for do banco

    @IsOptional()
    @IsString()
    testemunha_dois_id?: string; // ID do aluno se for do banco

    @IsOptional()
    @IsString()
    testemunha_dois_nome?: string; // Nome manual se não for do banco

    @IsOptional()
    @IsString()
    testemunha_dois_cpf?: string; // CPF manual se não for do banco

    @IsOptional()
    @IsString()
    observacoes?: string;
}

export class FormaPagamentoDto {
    @IsString()
    @IsNotEmpty()
    forma: string; // 'PIX', 'BOLETO', 'CARTAO_CREDITO', etc.

    @IsNotEmpty()
    valor: number;

    @IsOptional()
    @IsString()
    descricao?: string;
}

export class RespostaContratoZapSignDto {
    id: string;
    nome_documento: string;
    status: string;
    url_assinatura?: string;
    signers: Array<{
        nome: string;
        email: string;
        status: string;
        tipo: 'sign' | 'witness';
    }>;
    created_at: string;
    file_url?: string;
}

export class AtualizarStatusContratoDto {
    @IsString()
    @IsNotEmpty()
    documento_id: string;

    @IsString()
    @IsNotEmpty()
    status: string;

    @IsOptional()
    @IsString()
    observacoes?: string;
}

export class FiltrosContratosDto {
    @IsOptional()
    @IsNumberString()
    page?: string;

    @IsOptional()
    @IsNumberString()
    limit?: string;

    @IsOptional()
    @IsString()
    id_aluno?: string;

    @IsOptional()
    @IsString()
    id_treinamento?: string;

    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    @IsString()
    data_inicio?: string;

    @IsOptional()
    @IsString()
    data_fim?: string;
}
