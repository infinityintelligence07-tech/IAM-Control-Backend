import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { ContractTemplateService } from '@/modules/api/documentos/contract-template.service';
import { PdfBrowserService } from '@/modules/api/documentos/pdf-browser.service';

type Scenario = {
    fileSlug: string;
    treinamentoNome: string;
    usarAssinaturaImagem: boolean;
    incluirBonus: boolean;
    incluirBoleto: boolean;
    libertyCadeiraAdicional?: boolean;
    cadeiraAdicionalOcupante?: {
        nome: string;
        email: string;
        telefone: string;
    };
    clauseProfile?: 'long' | 'medium';
    clauseCount?: number;
};

const ONE_PIXEL_SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAFCAYAAABnoN0yAAAADUlEQVR4nGNgYGD4DwABBAEAff2x6wAAAABJRU5ErkJggg==';
const normalize = (value: string) =>
    String(value || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim();

const buildLongClauses = (titlePrefix: string, profile: 'long' | 'medium' = 'long', clauseCount: number = 24): string => {
    const clauses: string[] = [];
    for (let i = 1; i <= clauseCount; i += 1) {
        const clauseBody =
            profile === 'medium'
                ? `${titlePrefix} - cláusula ${i} com texto médio para simular contratos reais e validar densidade de conteúdo por página sem comprometer margens e legibilidade.`
                : `${titlePrefix} - conteúdo de regressão da cláusula ${i}, utilizado para forçar quebra de página e validar margens superior/inferior em páginas longas.
                Este texto é intencionalmente maior para ocupar espaço e reproduzir contrato com 3+ páginas, garantindo validação de assinatura, footer e espaçamento da página.`;

        clauses.push(`
            <div class="clause">
                <strong>Cláusula ${i}ª.</strong> ${clauseBody}
            </div>
        `);
    }
    return clauses.join('\n');
};

const buildBaseData = (scenario: Scenario) => {
    const isLiberty = normalize(scenario.treinamentoNome).includes('liberty');
    const valorBase = 90000;
    const acrescimoCadeira = isLiberty && scenario.libertyCadeiraAdicional ? valorBase * 0.5 : 0;
    const totalContrato = valorBase + acrescimoCadeira;

    const formasPagamento = scenario.incluirBoleto
        ? [
              {
                  tipo: 'A_VISTA',
                  forma: 'PIX',
                  valor: Number((totalContrato * 0.5).toFixed(2)),
                  descricao: isLiberty ? 'Entrada mentorado' : 'PIX à vista',
              },
              {
                  tipo: 'PARCELADO',
                  forma: 'BOLETO',
                  valor: Number((totalContrato * 0.5).toFixed(2)),
                  parcelas: 10,
                  descricao: isLiberty ? 'Parcelamento contrato' : 'Boleto 10x',
              },
          ]
        : [
              {
                  tipo: 'A_VISTA',
                  forma: 'PIX',
                  valor: totalContrato,
                  descricao: isLiberty ? 'Pagamento mentorado' : 'PIX à vista',
              },
          ];

    const camposVariaveis: Record<string, string> = {
        'Cidade do Treinamento': 'Americana/SP',
        'Data Prevista do Treinamento': '12/07/2026',
        'Data Final do Treinamento': '14/07/2026',
        'Data da Realização': '15/07/2026',
        'Local de Assinatura do Contrato': 'Americana/SP',
        'Data do Imersão Prosperar': '20/07/2026',
        'Descrição do Outro Bônus': scenario.incluirBonus ? 'Bônus validado no cenário de regressão' : '',
        'Data do Primeiro Boleto': '10/08/2026',
        'Melhor Dia para Boleto': '10',
        Observações: isLiberty
            ? [
                  'Observação do vendedor:\nCliente solicitou confirmação dos dados da cadeira adicional.',
                  `Vagas da mentoria: ${scenario.libertyCadeiraAdicional ? '1 mentorado + 1 cadeira adicional' : '1 mentorado'}.`,
                  `Cadeira adicional: ${scenario.libertyCadeiraAdicional ? 'Sim' : 'Não'}.`,
                  ...(scenario.libertyCadeiraAdicional
                      ? [
                            `Ocupante da cadeira adicional - Nome: ${scenario.cadeiraAdicionalOcupante?.nome || 'Não informado'} | E-mail: ${scenario.cadeiraAdicionalOcupante?.email || 'Não informado'} | Telefone: ${scenario.cadeiraAdicionalOcupante?.telefone || 'Não informado'}.`,
                        ]
                      : []),
              ].join(' ')
            : 'Observação do vendedor:\nCenário de regressão padrão.',
    };

    if (!isLiberty) {
        camposVariaveis['Quantidade de Inscrições'] = '3';
    } else {
        camposVariaveis['Vaga do Mentorado'] = '1';
        camposVariaveis['Cadeira Adicional Liberty'] = scenario.libertyCadeiraAdicional ? 'SIM' : 'NÃO';
        if (scenario.libertyCadeiraAdicional) {
            camposVariaveis['Cadeira Adicional - Nome'] = scenario.cadeiraAdicionalOcupante?.nome || 'Não informado';
            camposVariaveis['Cadeira Adicional - E-mail'] = scenario.cadeiraAdicionalOcupante?.email || 'Não informado';
            camposVariaveis['Cadeira Adicional - Telefone'] = scenario.cadeiraAdicionalOcupante?.telefone || 'Não informado';
        }
    }

    return {
        aluno: {
            nome: 'Aluno Teste Regressão',
            cpf: '12345678901',
            data_nascimento: '1990-01-01',
            telefone_um: '19999999999',
            email: 'aluno.regressao@example.com',
            logradouro: 'Rua Teste',
            numero: '123',
            complemento: 'Sala 1',
            bairro: 'Centro',
            cidade: 'Americana',
            estado: 'SP',
            cep: '13465000',
        },
        treinamento: {
            treinamento: scenario.treinamentoNome,
        },
        pagamento: {
            forma_pagamento: scenario.incluirBoleto ? 'AMBOS' : 'A_VISTA',
            formas_pagamento: formasPagamento,
            valores_formas_pagamento: {
                total_contrato: totalContrato,
            },
        },
        bonus: {
            tipos_bonus: scenario.incluirBonus ? ['outros'] : [],
            valores_bonus: scenario.incluirBonus
                ? {
                      'Bônus-Outros: Bônus de acompanhamento': true,
                  }
                : {},
        },
        testemunhas: {
            testemunha_um: {
                nome: 'Testemunha Um',
                cpf: '11122233344',
                email: 'testemunha1@example.com',
                telefone: '19911111111',
            },
            testemunha_dois: {
                nome: 'Testemunha Dois',
                cpf: '55566677788',
                email: 'testemunha2@example.com',
                telefone: '19922222222',
            },
        },
        campos_variaveis: camposVariaveis,
        clausulas: buildLongClauses(scenario.treinamentoNome, scenario.clauseProfile || 'long', scenario.clauseCount || 24),
        assinatura_aluno_base64: scenario.usarAssinaturaImagem ? ONE_PIXEL_SIGNATURE : '',
        assinatura_testemunha_um_base64: scenario.usarAssinaturaImagem ? ONE_PIXEL_SIGNATURE : '',
        assinatura_testemunha_dois_base64: scenario.usarAssinaturaImagem ? ONE_PIXEL_SIGNATURE : '',
    };
};

async function run(): Promise<void> {
    const scenarios: Scenario[] = [
        {
            fileSlug: 'iam-confronto',
            treinamentoNome: 'CONFRONTO',
            usarAssinaturaImagem: true,
            incluirBonus: true,
            incluirBoleto: true,
            clauseProfile: 'long',
            clauseCount: 24,
        },
        {
            fileSlug: 'liberty-mentoria-sem-cadeira',
            treinamentoNome: 'Mentoria Liberty',
            usarAssinaturaImagem: true,
            incluirBonus: false,
            incluirBoleto: true,
            libertyCadeiraAdicional: false,
            clauseProfile: 'long',
            clauseCount: 24,
        },
        {
            fileSlug: 'mesa-destino',
            treinamentoNome: 'Mesa de Destino',
            usarAssinaturaImagem: false,
            incluirBonus: false,
            incluirBoleto: true,
            clauseProfile: 'long',
            clauseCount: 24,
        },
        {
            fileSlug: 'mentoria-porsche',
            treinamentoNome: 'Mentoria de 30 minutos (porsche)',
            usarAssinaturaImagem: false,
            incluirBonus: false,
            incluirBoleto: false,
            clauseProfile: 'long',
            clauseCount: 24,
        },
        {
            fileSlug: 'iam-confronto-denso',
            treinamentoNome: 'CONFRONTO',
            usarAssinaturaImagem: true,
            incluirBonus: true,
            incluirBoleto: true,
            clauseProfile: 'medium',
            clauseCount: 36,
        },
        {
            fileSlug: 'liberty-mentoria-com-cadeira',
            treinamentoNome: 'Mentoria Liberty',
            usarAssinaturaImagem: true,
            incluirBonus: false,
            incluirBoleto: true,
            libertyCadeiraAdicional: true,
            cadeiraAdicionalOcupante: {
                nome: 'Pessoa Cadeira Extra',
                email: 'cadeira.extra@example.com',
                telefone: '19988887777',
            },
            clauseProfile: 'medium',
            clauseCount: 36,
        },
    ];

    const pdfBrowserService = new PdfBrowserService();
    const service = new ContractTemplateService(pdfBrowserService);
    const outputDir = path.resolve(process.cwd(), 'tmp', 'contract-regression');
    await mkdir(outputDir, { recursive: true });

    for (const scenario of scenarios) {
        const payload = buildBaseData(scenario);
        const pdf = await service.generateContractPDF(payload);
        const targetFile = path.join(outputDir, `${scenario.fileSlug}.pdf`);
        await writeFile(targetFile, pdf);
        console.log(`✅ PDF gerado: ${targetFile}`);
    }

    console.log('\nConcluído. Abra os PDFs gerados e valide:');
    console.log('- margens superiores a partir da 3ª página');
    console.log('- assinatura em imagem vs fallback "Contrato assinado digitalmente"');
    console.log('- logo IAM vs Liberty por treinamento de destino');

    // Fecha o Chromium compartilhado para o script encerrar imediatamente.
    await pdfBrowserService.onModuleDestroy();
}

run().catch((error) => {
    console.error('❌ Falha no teste de regressão de contratos:', error);
    process.exit(1);
});
