import { IsString, IsOptional, IsArray, ValidateNested, IsNotEmpty, IsEnum, IsNumberString, IsNumber, IsBoolean, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ECategoriaExclusaoContrato, ETipoDocumento } from '@/modules/config/entities/enum';

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
export class EmpresaContratanteDto {
    @IsOptional()
    @IsString()
    cnpj?: string;

    @IsOptional()
    @IsString()
    razao_social?: string;

    @IsOptional()
    @IsString()
    nome_fantasia?: string;

    @IsOptional()
    @IsString()
    email?: string;

    @IsOptional()
    @IsString()
    telefone?: string;

    @IsOptional()
    @IsString()
    cep?: string;

    @IsOptional()
    @IsString()
    logradouro?: string;

    @IsOptional()
    @IsString()
    numero?: string;

    @IsOptional()
    @IsString()
    complemento?: string;

    @IsOptional()
    @IsString()
    bairro?: string;

    @IsOptional()
    @IsString()
    cidade?: string;

    @IsOptional()
    @IsString()
    estado?: string;
}

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

    @IsOptional()
    @IsString()
    id_turma?: string;

    /**
     * Turma DESTINO do treinamento contratado (ex.: turma 87 = Confronto 54).
     * Opcional durante o período de transição; passar a obrigatório após o
     * frontend ser atualizado para sempre enviar este campo.
     */
    @IsOptional()
    @IsString()
    id_turma_destino?: string;

    @IsOptional()
    @IsString()
    cidade_treinamento?: string;

    /**
     * Comprovante(s) de pagamento anexado(s) na etapa da venda. Quando vários,
     * o frontend envia um JSON.stringify de um array de data URLs base64.
     * É salvo VINCULADO AO CONTRATO (coluna comprovantes_pagamento + snapshot em
     * dados_contrato.turma_aluno), e não no turma_aluno compartilhado, para que
     * vendas distintas do mesmo aluno na mesma turma de origem não sobrescrevam o
     * comprovante uma da outra no histórico de vendas.
     */
    @IsOptional()
    @IsString()
    comprovante_pagamento_base64?: string;

    @IsOptional()
    @IsString()
    data_inicio_treinamento?: string;

    @IsOptional()
    @IsString()
    data_final_treinamento?: string;

    /**
     * Adiantamento de mentoria: período do contrato (início/término) definido
     * manualmente pelo usuário na venda. Quando informados, têm prioridade sobre
     * o cálculo automático (`calcularPeriodoMentoria`). Formato AAAA-MM-DD.
     */
    @IsOptional()
    @IsString()
    data_inicio_mentoria?: string;

    @IsOptional()
    @IsString()
    data_fim_mentoria?: string;

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
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CompradorAdicionalDto)
    compradores_adicionais?: CompradorAdicionalDto[];

    @IsOptional()
    @IsBoolean()
    pendencia_pagamento?: boolean; // Pendência de pagamento marcada no ato da venda

    @IsOptional()
    quantidade_inscricoes?: number; // Quantidade de inscrições da venda

    @IsOptional()
    campos_variaveis?: Record<string, string>; // Campos variáveis do contrato

    @IsOptional()
    valores_formas_pagamento?: Record<string, any>; // Valores das formas de pagamento

    @IsOptional()
    @IsString()
    texto_bonus_simples?: string;

    @IsOptional()
    possui_bonus_simples?: boolean;

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
    testemunha_um_email?: string;

    @IsOptional()
    @IsString()
    testemunha_um_telefone?: string;

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
    testemunha_dois_email?: string;

    @IsOptional()
    @IsString()
    testemunha_dois_telefone?: string;

    @IsOptional()
    @IsString()
    observacoes?: string;

    /**
     * Contrato escrito à mão: quando `true`, o documento físico já foi anexado
     * pelo usuário na venda, então NÃO geramos PDF nem criamos documento na
     * ZapSign. Apenas registramos a venda; as fotos/PDF do contrato são
     * anexadas em seguida via `salvarAssinatura` (foto_documento_aluno_base64).
     */
    @IsOptional()
    @IsBoolean()
    contrato_manual?: boolean;

    /**
     * Tipo de pessoa do CONTRATANTE do contrato/venda:
     * 'PF' (padrão) = o aluno (CPF); 'PJ' = uma empresa do aluno (CNPJ).
     * Quando 'PJ', os dados da empresa vêm em `empresa_contratante` e passam a
     * qualificar o contratante no contrato (o signatário continua sendo a pessoa
     * física do `id_aluno`).
     */
    @IsOptional()
    @IsString()
    tipo_pessoa?: string; // 'PF' | 'PJ'

    @IsOptional()
    @ValidateNested()
    @Type(() => EmpresaContratanteDto)
    empresa_contratante?: EmpresaContratanteDto;
}

export class FormaPagamentoDto {
    @IsString()
    @IsNotEmpty()
    forma: string; // 'PIX', 'BOLETO', 'CARTAO_CREDITO', 'À Vista - Cartão de Crédito', etc.

    @IsNumber()
    valor: number;

    @IsOptional()
    @IsString()
    descricao?: string;

    @IsOptional()
    @IsString()
    tipo?: string; // 'A_VISTA' | 'PARCELADO'

    @IsOptional()
    @IsNumber()
    parcelas?: number;
}

export class CompradorAdicionalDto {
    @IsOptional()
    @IsString()
    nome?: string;

    @IsOptional()
    @IsString()
    email?: string;

    @IsOptional()
    @IsString()
    telefone?: string;
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

// DTOs para criação de Termos
export class CriarTermoZapSignDto {
    @IsString()
    @IsNotEmpty()
    template_id: string;

    @IsString()
    @IsNotEmpty()
    id_aluno: string;

    @IsString()
    @IsNotEmpty()
    termo_titulo: string; // Título do termo

    @IsOptional()
    @IsString()
    texto_introducao?: string;

    @IsOptional()
    @IsString()
    clausulas?: string;

    @IsOptional()
    @IsBoolean()
    possui_testemunhas?: boolean;

    @IsOptional()
    @IsString()
    testemunha_um_nome?: string;

    @IsOptional()
    @IsString()
    testemunha_um_cpf?: string;

    @IsOptional()
    @IsString()
    testemunha_um_email?: string;

    @IsOptional()
    @IsString()
    testemunha_dois_nome?: string;

    @IsOptional()
    @IsString()
    testemunha_dois_cpf?: string;

    @IsOptional()
    @IsString()
    testemunha_dois_email?: string;

    @IsOptional()
    campos_variaveis?: Record<string, string>;

    @IsOptional()
    @IsString()
    local_assinatura?: string;

    @IsOptional()
    @IsString()
    observacoes?: string;
}

export class RespostaTermoZapSignDto {
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

/** Body obrigatório ao excluir venda/contrato no Histórico de Vendas. */
export class ExcluirContratoDto {
    @IsEnum(ECategoriaExclusaoContrato)
    @IsNotEmpty()
    categoria_exclusao: ECategoriaExclusaoContrato;

    @IsString()
    @IsNotEmpty({ message: 'Informe a observação da exclusão.' })
    @MinLength(5, { message: 'A observação deve ter pelo menos 5 caracteres.' })
    @MaxLength(150, { message: 'A observação deve ter no máximo 150 caracteres.' })
    observacao_exclusao: string;
}
