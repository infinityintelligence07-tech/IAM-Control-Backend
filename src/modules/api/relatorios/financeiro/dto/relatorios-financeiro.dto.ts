export class AlunoInadimplenteDto {
    id: number;
    nome: string;
    email: string;
    cpf?: string;
    telefone: string;
    polo?: {
        id: number;
        nome: string;
    };
    treinamentos: Array<{
        id: number;
        nome: string;
        valor_total: number;
        valor_pago: number;
        valor_pendente: number;
        data_inscricao: string;
        status: string;
    }>;
    total_pendente: number;
}

export class AlunosInadimplentesResponseDto {
    data: AlunoInadimplenteDto[];
    total: number;
}

