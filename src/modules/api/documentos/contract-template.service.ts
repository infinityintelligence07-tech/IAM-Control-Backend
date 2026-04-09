import { Injectable } from '@nestjs/common';
import * as puppeteer from 'puppeteer';

@Injectable()
export class ContractTemplateService {
    /**
     * Gera HTML baseado no ModernContractPDF.tsx
     */
    private generateModernContractHTML(contrato: any): string {
        // Extrair dados do contrato para preencher o formulário
        const aluno = contrato.dados_contrato?.aluno;
        const treinamento = contrato.dados_contrato?.treinamento;
        const pagamento = contrato.dados_contrato?.pagamento;
        const testemunhas = contrato.dados_contrato?.testemunhas;
        const bonus = contrato.dados_contrato?.bonus;
        const campos_variaveis = contrato.dados_contrato?.campos_variaveis;
        const template = contrato.dados_contrato?.template;

        const normalizarTexto = (valor: unknown): string => (typeof valor === 'string' ? valor.toLowerCase() : '');

        const referencias = [
            normalizarTexto(template?.nome),
            normalizarTexto(template?.tipo_documento),
            normalizarTexto(treinamento?.nome),
            normalizarTexto(treinamento?.treinamento),
        ];

        const isIPRContract = referencias.some(
            (texto) => texto?.includes('contrato do ipr') || texto?.includes('imersão prosperar') || texto?.includes('imersao prosperar'),
        );

        const possuiTestemunhas =
            Boolean(testemunhas?.testemunha_um?.nome && testemunhas?.testemunha_um?.cpf) ||
            Boolean(testemunhas?.testemunha_dois?.nome && testemunhas?.testemunha_dois?.cpf);

        const mostrarTestemunhas = possuiTestemunhas && !isIPRContract;

        const possuiBonusRelevante =
            !isIPRContract &&
            ((Array.isArray(bonus?.tipos_bonus) && bonus.tipos_bonus.some((tipo: string) => tipo && tipo !== 'nao_aplica' && tipo !== 'nenhum')) ||
                Object.keys(bonus?.valores_bonus || {}).length > 0);
        const observacoesContrato = (campos_variaveis?.['Observações'] || campos_variaveis?.['Observacoes'] || campos_variaveis?.['OBSERVACOES'] || '')
            .toString()
            .trim();
        const observacoesContratoHtml = observacoesContrato ? observacoesContrato.replace(/\n/g, '<br>') : '';

        // Obter a URL absoluta da logo
        const logoUrl = `${process.env.FRONTEND_URL || 'http://iamcontrol.com.br'}/images/logo/logo-escuro.png`;

        // Função para converter URLs do Google Drive para formato de visualização
        const convertGoogleDriveUrl = (url: string): string => {
            if (!url) return '';

            // Se já é data URI, retorna como está
            if (url.startsWith('data:')) return url;

            // Se já é URL direta (lh3.googleusercontent.com), retorna como está
            if (url.includes('lh3.googleusercontent.com')) return url;

            // Converter URL do Google Drive para formato de visualização
            const fileIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
            if (fileIdMatch) {
                const fileId = fileIdMatch[1];
                // Usar formato que não tem problemas de CORS
                return `https://lh3.googleusercontent.com/d/${fileId}`;
            }

            // Se não é URL do Google Drive, verifica se é URL absoluta
            if (url.startsWith('http')) return url;

            // Caso contrário, adiciona a URL base do frontend
            return `${process.env.FRONTEND_URL || 'http://iamcontrol.com.br'}${url}`;
        };

        // Função para converter URLs relativas em absolutas
        const getAbsoluteImageUrl = (url: string): string => {
            return convertGoogleDriveUrl(url);
        };

        const useTsContractTemplate = process.env.CONTRACT_TEMPLATE_MODE !== 'legacy-embedded';

        if (useTsContractTemplate) {
            const templateHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Contrato de Treinamento</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Figtree', Arial, sans-serif;
            padding: 3cm 2cm 2cm 3cm;
            font-size: 11px;
            line-height: 1.55;
            color: #000;
            background-color: white;
        }

        .first-page {
            position: relative;
            min-height: auto;
            padding-bottom: 0;
        }
        
        .header {
            margin-bottom: 18px;
            text-align: center;
            page-break-inside: avoid;
        }

        .iam-brand {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 14px;
            margin: 0 auto 12px auto;
        }

        .iam-logo-image {
            max-height: 50px;
            max-width: 170px;
            object-fit: contain;
        }

        .logo-divider {
            width: 1.5px;
            height: 42px;
            background-color: #666;
        }

        .company-name {
            font-weight: bold;
            font-size: 19px;
            color: #1e3a8a;
            letter-spacing: 1px;
            text-transform: uppercase;
            text-align: left;
        }

        .training-logo-bottom {
            position: static;
            text-align: center;
            page-break-inside: avoid;
            margin-top: 4px;
        }

        .training-logo-bottom img {
            max-height: 54px;
            max-width: 260px;
            object-fit: contain;
        }
        
        .intro-text {
            margin-bottom: 10px;
            font-size: 11px;
            line-height: 1.5;
            text-align: justify;
            text-indent: 22px;
        }
        
        table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            margin-bottom: 10px;
            border: 1px solid #000;
            border-radius: 8px;
            overflow: hidden;
        }
        
        td {
            padding: 8px 10px;
            border-right: 1px solid #000;
            border-bottom: 1px solid #000;
            font-size: 11px;
            vertical-align: top;
        }
        
        td:last-child {
            border-right: none;
        }
        
        tr:last-child td {
            border-bottom: none;
        }
        
        td strong {
            font-weight: bold;
            text-transform: uppercase;
        }
        
        .full-width {
            width: 100%;
        }
        
        .half-width {
            width: 50%;
        }
        
        .checkbox-item {
            display: block;
            margin: 3px 0;
            font-size: 11px;
        }
        
        .checkbox {
            margin-right: 5px;
            transform: scale(1);
            accent-color: #000;
        }
         
        .checkbox:disabled {
            opacity: 0.8;
            cursor: not-allowed;
        }
        
        .signature-line {
            border-top: 1px solid #000;
            margin-bottom: 10px;
            height: 1px;
        }
        
        .declaration {
            margin: 18px 0;
            text-align: justify;
            font-size: 10px;
            line-height: 1.6;
            text-indent: 22px;
        }
        
        .signature-location {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            font-size: 10px;
            gap: 16px;
        }
        
        .signature-label {
            text-align: center;
            font-size: 10px;
            min-height: 28px;
        }
        
        .witnesses-section {
            display: flex;
            gap: 40px;
            margin-top: 14px;
            page-break-inside: avoid;
        }
        
        .witness {
            flex: 1;
        }
        
        .witness-line {
            border-top: 1.5px solid #000;
            margin-bottom: 8px;
            margin-top: 16px;
        }
        
        .witness-info {
            font-size: 10px;
            line-height: 1.8;
        }

        .signature-block {
            margin-top: 16px;
            page-break-inside: avoid;
        }

        .signature-main {
            margin: 12px auto 14px auto;
            width: 70%;
            text-align: center;
            min-height: 58px;
        }

        .signature-block-page1 {
            margin-top: 8px;
            page-break-inside: avoid;
        }
        
        .footer-brand {
            text-align: center;
            margin-top: 40px;
        }
        
        .page-break {
            page-break-before: always;
        }
        
        .clause {
            margin-bottom: 10px;
            text-align: justify;
            page-break-inside: avoid;
        }
        
        .clause-title {
            font-weight: 700;
            margin-bottom: 4px;
            page-break-after: avoid;
            text-transform: none;
            line-height: 1.35;
        }
        
        .clause-text {
            line-height: 1.38;
            font-weight: 500;
            text-indent: 0;
        }

        .clauses-page-content {
            margin-top: 18px;
            margin-bottom: 20px;
        }

        .clauses-wrapper {
            margin-top: 10px;
            margin-bottom: 16px;
            padding-top: 10px;
            padding-bottom: 12px;
        }

        .clauses-wrapper p,
        .clauses-wrapper div {
            line-height: 1.38;
            font-weight: 500;
        }

        .clauses-wrapper p {
            margin: 0 0 5px 0;
            text-align: justify;
            text-indent: 0;
        }

        .paragraph {
            margin-left: 0;
            margin-top: 6px;
            margin-bottom: 6px;
            text-indent: 0;
        }
        
        .center-text {
            text-align: center;
            font-style: italic;
            margin: 24px 0;
        }
        
        .bold {
            font-weight: bold;
        }
        
        .payment-header {
            text-align: center;
            background: #f0f0f0;
        }
        
        .payment-header strong {
            font-weight: bold;
            text-transform: uppercase;
        }

        .clause-page-break {
            page-break-before: always;
        }

        @media print {
            body {
                padding: 3cm 2cm 2cm 3cm;
            }

            .clause,
            .clause-title,
            .clause-text,
            .signature-block,
            .signature-block-page1,
            .witnesses-section {
                break-inside: avoid;
                page-break-inside: avoid;
            }

            .clause-page-break {
                break-before: page;
                page-break-before: always;
            }

            .first-page {
                min-height: auto;
            }
        }
    </style>
</head>
<body>
    <div class="first-page">
    <div class="header">
        <div class="iam-brand">
            <img src="{{IAM_LOGO_URL}}" alt="Logo IAM" class="iam-logo-image" onerror="this.style.display='none';">
            <div class="logo-divider"></div>
            <div class="company-name">INSTITUTO ACADEMY MIND</div>
        </div>
    </div>
    
    <div class="intro-text">
        O presente instrumento tem como objetivo realizar a inscrição da pessoa abaixo nominada no seguinte treinamento:
    </div>
    
    <table>
        <tr>
            <td class="full-width" colspan="2">
                <strong>Nome Completo:</strong> {{ALUNO_NOME}}
            </td>
        </tr>
        <tr>
            <td class="half-width">
                <strong>CPF/CNPJ:</strong> {{ALUNO_CPF}}
            </td>
            <td class="half-width">
                <strong>Data de Nascimento:</strong> {{ALUNO_DATA_NASCIMENTO}}
            </td>
        </tr>
        <tr>
            <td class="half-width">
                <strong>WhatsApp:</strong> {{ALUNO_WHATSAPP}}
            </td>
            <td class="half-width">
                <strong>E-mail:</strong> {{ALUNO_EMAIL}}
            </td>
        </tr>
        <tr>
            <td class="full-width" colspan="2">
                <strong>Endereço:</strong> {{ALUNO_ENDERECO_LOGRADOURO}}, {{ALUNO_ENDERECO_NUMERO}}, {{ALUNO_ENDERECO_COMPLEMENTO}}, {{ALUNO_ENDERECO_BAIRRO}}
            </td>
        </tr>
        <tr>
            <td class="half-width">
                <strong>Cidade/Estado:</strong> {{ALUNO_CIDADE_ESTADO}}
            </td>
            <td class="half-width">
                <strong>CEP:</strong> {{ALUNO_CEP}}
            </td>
        </tr>
    </table>
    
    <table>
        <tr>
            <td class="half-width" style="vertical-align: top;">
                <strong>Treinamento:</strong> {{TREINAMENTO_NOME}}<br><br>
                <strong>Cidade:</strong> {{TREINAMENTO_CIDADE}}<br><br>
                <strong>Data Prevista:</strong> {{TREINAMENTO_DATA_INICIO}} à {{TREINAMENTO_DATA_FIM}}<br><br>
                <strong>Preço do Contrato:</strong> {{TREINAMENTO_PRECO}}
            </td>
            <td class="half-width" style="vertical-align: top;">
                <strong>Bônus:</strong><br>
                {{BONUS_DETALHES_HTML}}
            </td>
        </tr>
    </table>
    
    <table>
        <tr>
            <td class="payment-header" colspan="2">
                <strong>FORMA DE PAGAMENTO</strong>
            </td>
        </tr>
        <tr>
            <td class="half-width" style="vertical-align: top;">
                <strong>À VISTA:</strong><br>
                {{PAGAMENTO_AVISTA_DETALHES_HTML}}
            </td>
            <td class="half-width" style="vertical-align: top;">
                <strong>PARCELADO:</strong><br>
                {{PAGAMENTO_PARCELADO_DETALHES_HTML}}
            </td>
        </tr>
    </table>
    
    <table>
        <tr>
            <td>
                <strong>OBSERVAÇÕES:</strong><br><br>
                {{OBSERVACOES}}
            </td>
        </tr>
    </table>

    <div class="signature-block-page1">
        <div class="signature-location">
            <div><strong>Local:</strong> {{CONTRATO_LOCAL}}</div>
            <div><strong>Data:</strong> {{CONTRATO_DATA}}</div>
        </div>

        <div class="declaration" style="margin-top: 0;">
            Declaro que li e concordo com todas as cláusulas deste contrato, redigidas em 2 laudas, estando ciente de todas elas, por meio da assinatura abaixo e na presença de 2 testemunhas.
        </div>

        <div class="signature-main">
            <div class="signature-line"></div>
            <div class="signature-label">Assinatura do ALUNO/Contratante.</div>
        </div>

        <div class="witnesses-section" style="margin-top: 20px;">
            <div class="witness">
                <div class="witness-line"></div>
                <div class="witness-info">
                    <div><span class="bold">Testemunha 1</span></div>
                    <div>Nome: {{TESTEMUNHA_1_NOME}}</div>
                    <div>CPF: {{TESTEMUNHA_1_CPF}}</div>
                </div>
            </div>
            
            <div class="witness">
                <div class="witness-line"></div>
                <div class="witness-info">
                    <div><span class="bold">Testemunha 2</span></div>
                    <div>Nome: {{TESTEMUNHA_2_NOME}}</div>
                    <div>CPF: {{TESTEMUNHA_2_CPF}}</div>
                </div>
            </div>
        </div>
    </div>

    <div class="training-logo-bottom">
        <img src="{{TREINAMENTO_LOGO_URL}}" alt="Logo do Treinamento" onerror="this.style.display='none';">
    </div>
    </div>
    
    <div class="page-break"></div>
    
    <div class="clauses-page-content">
        <div class="clauses-wrapper">
            {{CLAUSULAS_HTML}}
        </div>
        
        <div class="declaration">
            Declaro que li e concordo com todas as cláusulas deste contrato, redigidas em 2 laudas, estando ciente de todas elas, por meio da assinatura abaixo e na presença de 2 testemunhas.
        </div>
        
        <div class="center-text">
            E, por estarem de acordo, firmam o presente contrato em duas vias de igual teor e forma, na presença das testemunhas abaixo.
        </div>

        <div class="signature-block">
            <div class="signature-location">
                <div><strong>Local:</strong> {{CONTRATO_LOCAL}}</div>
                <div><strong>Data:</strong> {{CONTRATO_DATA}}</div>
            </div>
            
            <div class="signature-main">
                <div class="signature-line"></div>
                <div class="signature-label">Assinatura do ALUNO/Contratante.</div>
            </div>
            
            <div class="witnesses-section">
                <div class="witness">
                    <div class="witness-line"></div>
                    <div class="witness-info">
                        <div><span class="bold">Testemunha 1</span></div>
                        <div>Nome: {{TESTEMUNHA_1_NOME}}</div>
                        <div>CPF: {{TESTEMUNHA_1_CPF}}</div>
                    </div>
                </div>
                
                <div class="witness">
                    <div class="witness-line"></div>
                    <div class="witness-info">
                        <div><span class="bold">Testemunha 2</span></div>
                        <div>Nome: {{TESTEMUNHA_2_NOME}}</div>
                        <div>CPF: {{TESTEMUNHA_2_CPF}}</div>
                    </div>
                </div>
            </div>
        </div>
    </div>

</body>
</html>`;
            const formasPagamento = Array.isArray(pagamento?.formas_pagamento) ? pagamento.formas_pagamento : [];
            const bonusTipos = Array.isArray(bonus?.tipos_bonus) ? bonus.tipos_bonus : [];
            const clausulasOriginais = typeof template?.clausulas === 'string' ? template.clausulas : '';

            const escapeHtml = (text: string): string =>
                text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

            const formatarClausulasHtml = (clausulas: string): string => {
                const texto = clausulas?.trim();
                if (!texto) {
                    return `
                      <div class="clause">
                        <div class="clause-text"><strong>ATENÇÃO:</strong> Cláusulas não encontradas para o documento vinculado ao treinamento.</div>
                      </div>
                    `;
                }

                const inserirQuebrasPaginaPorClausula = (html: string): string => {
                    let clauseIndex = 0;
                    const cabecalhoRegex = /(<(?:p|div|h[1-6])[^>]*>\s*(?:<[^>]+>\s*)*(?:cl[aá]usula)\b[\s\S]*?<\/(?:p|div|h[1-6])>)/gi;

                    const comQuebras = html.replace(cabecalhoRegex, (match: string) => {
                        const precisaQuebra = clauseIndex > 0 && clauseIndex % 3 === 0;
                        clauseIndex += 1;
                        return `${precisaQuebra ? '<div class="clause-page-break"></div>' : ''}${match}`;
                    });

                    if (clauseIndex > 0) return comQuebras;

                    let fallbackClauseIndex = 0;
                    return html.replace(/(<strong[^>]*>\s*cl[aá]usula\b[\s\S]*?<\/strong>)/gi, (match: string) => {
                        const precisaQuebra = fallbackClauseIndex > 0 && fallbackClauseIndex % 3 === 0;
                        fallbackClauseIndex += 1;
                        return `${precisaQuebra ? '<div class="clause-page-break"></div>' : ''}${match}`;
                    });
                };

                const possuiTagsHtml = /<\/?[a-z][\s\S]*>/i.test(texto);
                if (possuiTagsHtml) {
                    // Mantém a formatação original e inclui quebras de página entre blocos de cláusulas.
                    return inserirQuebrasPaginaPorClausula(texto);
                }

                // Fallback para texto puro: preserva parágrafos e quebras de linha.
                const blocos = texto
                    .split(/\n{2,}/)
                    .map((bloco) => bloco.trim())
                    .filter(Boolean);

                let indiceClausula = 0;
                return blocos
                    .map((bloco) => {
                        const blocoEscapado = escapeHtml(bloco).replace(/\n/g, '<br>');
                        const ehTituloClausula = /^cl[aá]usula\s+/i.test(bloco);

                        if (ehTituloClausula) {
                            const quebraPagina = indiceClausula > 0 && indiceClausula % 3 === 0 ? '<div class="clause-page-break"></div>' : '';
                            indiceClausula += 1;
                            return `
                              ${quebraPagina}
                              <div class="clause">
                                <div class="clause-title">${blocoEscapado}</div>
                              </div>
                            `;
                        }

                        return `
                          <div class="clause">
                            <div class="clause-text">${blocoEscapado}</div>
                          </div>
                        `;
                    })
                    .join('');
            };

            const normalizeString = (value: unknown): string => {
                if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
                    return '';
                }

                return String(value)
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .toUpperCase()
                    .trim();
            };

            const parsePaymentValue = (value: unknown): number => {
                if (typeof value === 'number') return value;
                if (typeof value !== 'string') return 0;

                const normalized = value
                    .replace(/[R$\s]/g, '')
                    .replace(/\./g, '')
                    .replace(',', '.');

                return Number(normalized) || 0;
            };

            const formatCurrencyBRL = (value: number): string =>
                new Intl.NumberFormat('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                }).format(Number(value) || 0);

            const formatDatePtBr = (value: unknown, fallback: string = '___/___/___'): string => {
                if (!value) return fallback;
                if (typeof value !== 'string' && typeof value !== 'number') return fallback;
                const raw = String(value).trim();
                if (!raw) return fallback;

                if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
                    const [ano, mes, dia] = raw.split('-');
                    return `${dia}/${mes}/${ano}`;
                }
                if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;

                const parsed = new Date(raw);
                if (!Number.isNaN(parsed.getTime())) {
                    return parsed.toLocaleDateString('pt-BR');
                }
                return fallback;
            };

            const getNormalizedPaymentType = (fp: any): string => {
                const explicitType = normalizeString(fp?.tipo);
                if (explicitType.includes('PARCELADO')) return 'PARCELADO';
                if (explicitType.includes('A_VISTA') || explicitType.includes('AVISTA') || explicitType.includes('A VISTA')) return 'A_VISTA';

                const textType = normalizeString(fp?.forma_pagamento || fp?.forma || fp?.descricao);
                if (textType.includes('PARCELADO')) return 'PARCELADO';
                if (textType.includes('A VISTA') || textType.includes('AVISTA')) return 'A_VISTA';

                return '';
            };

            const getNormalizedPaymentMethod = (fp: any): string => {
                const explicitMethod = normalizeString(fp?.forma);
                if (explicitMethod.includes('CARTAO_CREDITO') || explicitMethod.includes('CARTAO DE CREDITO')) return 'CARTAO_CREDITO';
                if (explicitMethod.includes('CARTAO_DEBITO') || explicitMethod.includes('CARTAO DE DEBITO')) return 'CARTAO_DEBITO';
                if (explicitMethod.includes('PIX')) return 'PIX';
                if (explicitMethod.includes('DINHEIRO') || explicitMethod.includes('ESPECIE')) return 'DINHEIRO';
                if (explicitMethod.includes('BOLETO')) return 'BOLETO';

                const textMethod = normalizeString(fp?.forma_pagamento || fp?.descricao);
                if (textMethod.includes('CARTAO DE CREDITO')) return 'CARTAO_CREDITO';
                if (textMethod.includes('CARTAO DE DEBITO')) return 'CARTAO_DEBITO';
                if (textMethod.includes('PIX') || textMethod.includes('TRANSFERENCIA')) return 'PIX';
                if (textMethod.includes('DINHEIRO') || textMethod.includes('ESPECIE')) return 'DINHEIRO';
                if (textMethod.includes('BOLETO')) return 'BOLETO';

                return '';
            };

            const hasPayment = (forma: string, tipo: string): boolean =>
                formasPagamento.some((fp: any) => {
                    const method = getNormalizedPaymentMethod(fp);
                    const paymentType = getNormalizedPaymentType(fp);
                    const hasValue = parsePaymentValue(fp?.valor) > 0;
                    return method === forma && paymentType === tipo && hasValue;
                });

            const normalizedPaymentEntries = formasPagamento
                .map((fp: any) => {
                    const tipo = getNormalizedPaymentType(fp);
                    const forma = getNormalizedPaymentMethod(fp);
                    const valor = parsePaymentValue(fp?.valor);
                    const parcelas = Number(fp?.parcelas || 0);
                    const descricao = typeof fp?.descricao === 'string' ? fp.descricao.trim() : '';
                    const tituloOriginal = typeof fp?.forma === 'string' ? fp.forma.trim() : '';
                    return {
                        ...fp,
                        tipo,
                        forma,
                        valor,
                        parcelas,
                        descricao,
                        tituloOriginal,
                    };
                })
                .filter((fp: any) => fp.valor > 0);

            const getGroupedPayment = (forma: string, tipo: string) => {
                const itens = normalizedPaymentEntries.filter((fp: any) => fp.forma === forma && fp.tipo === tipo);
                return {
                    checked: itens.length > 0,
                    valorTotal: itens.reduce((sum: number, fp: any) => sum + fp.valor, 0),
                    parcelas: itens.reduce((max: number, fp: any) => Math.max(max, Number(fp.parcelas || 0)), 0),
                    descricoes: itens.map((fp: any) => fp.descricao).filter(Boolean),
                };
            };

            const escapeAndFallback = (value: unknown, fallback: string = '_________________'): string => {
                if (typeof value !== 'string' && typeof value !== 'number') return fallback;
                const normalized = String(value).trim();
                return normalized ? escapeHtml(normalized) : fallback;
            };

            const totalContrato = formasPagamento.reduce((total: number, fp: any) => total + Number(fp?.valor || 0), 0);
            const enderecoFormatado = [aluno?.endereco?.logradouro, aluno?.endereco?.numero, aluno?.endereco?.complemento, aluno?.endereco?.bairro]
                .filter(Boolean)
                .join(', ');

            const dataNascimentoFormatada = (() => {
                if (!aluno?.data_nascimento) return '___/___/___';
                const dataISO = String(aluno.data_nascimento);
                if (dataISO.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    const [ano, mes, dia] = dataISO.split('-');
                    return `${dia}/${mes}/${ano}`;
                }
                return new Date(dataISO).toLocaleDateString('pt-BR');
            })();

            const dataPrevistaRaw = campos_variaveis?.['Data Prevista do Treinamento'] || '';
            const dataFinalRaw = campos_variaveis?.['Data Final do Treinamento'] || '';
            let dataInicio = dataPrevistaRaw || '___/___/___';
            let dataFim = dataFinalRaw || '';

            // A tela de vendas envia frequentemente o intervalo completo em "Data Prevista do Treinamento".
            if (!dataFim && typeof dataPrevistaRaw === 'string' && dataPrevistaRaw.includes('à')) {
                const [inicioIntervalo, fimIntervalo] = dataPrevistaRaw
                    .split(/\s+à\s+/i)
                    .map((part: string) => part.trim())
                    .filter(Boolean);
                if (inicioIntervalo && fimIntervalo) {
                    dataInicio = inicioIntervalo;
                    dataFim = fimIntervalo;
                }
            }

            dataFim = dataFim || '___/___/___';
            const localAssinatura = campos_variaveis?.['Local de Assinatura do Contrato'] || '________________________________';

            const dataImersao = campos_variaveis?.['Data do Imersão Prosperar'] || '___/___/___';
            const bonusOutrosDescricao = campos_variaveis?.['Descrição do Outro Bônus'] || '_________________';
            const nomeTreinamento = treinamento?.nome || treinamento?.treinamento || campos_variaveis?.['Nome do Treinamento Contratado'] || '_________________';
            const quantidadeInscricoesBonus = campos_variaveis?.['Quantidade de Inscrições'] || '1';

            const bonusDetalhesHtml = (() => {
                const tipoBonus = new Set((bonusTipos || []).map((tipo: string) => normalizeString(tipo).toLowerCase()));
                const temOutrosPorValores = Object.keys(bonus?.valores_bonus || {}).some((key) => normalizeString(key).includes('BONUS-OUTROS'));

                const tem100Dias = tipoBonus.has('100_dias') || tipoBonus.has('100dias');
                const temIPR = tipoBonus.has('ipr');
                const temOutros = tipoBonus.has('outros') || temOutrosPorValores;
                const naoSeAplica = !tem100Dias && !temIPR && !temOutros;

                const descricaoOutros = (() => {
                    if (campos_variaveis?.['Descrição do Outro Bônus']) return campos_variaveis['Descrição do Outro Bônus'];
                    const chaveOutros = Object.keys(bonus?.valores_bonus || {}).find((key) => normalizeString(key).includes('BONUS-OUTROS'));
                    if (chaveOutros) return chaveOutros.replace(/B[oô]nus-Outros:\s*/i, '');
                    return bonusOutrosDescricao;
                })();

                const dataIPR = temIPR ? formatDatePtBr(campos_variaveis?.['Data do Imersão Prosperar'] || bonus?.turma_bonus_info?.data_inicio) : '___/___/___';

                const linhas = [
                    {
                        checked: naoSeAplica,
                        text: 'NÃO SE APLICA',
                    },
                    {
                        checked: tem100Dias,
                        text: '100 DIAS',
                    },
                    {
                        checked: temIPR,
                        text: `${escapeAndFallback(quantidadeInscricoesBonus, '1')} inscrição(ões) do Imersão Prosperar<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Data: ${escapeAndFallback(dataIPR, '___/___/___')}`,
                    },
                    {
                        checked: temOutros,
                        text: `OUTROS: ${escapeAndFallback(descricaoOutros)}`,
                    },
                ];

                return linhas
                    .map(
                        (linha) => `
                <label class="checkbox-item">
                    <input type="checkbox" class="checkbox" ${linha.checked ? 'checked' : ''} disabled>
                    ${linha.text}
                </label>`,
                    )
                    .join('');
            })();

            const pagamentoDetalhesHtml = (() => {
                const cartaoCreditoAVista = getGroupedPayment('CARTAO_CREDITO', 'A_VISTA');
                const cartaoDebitoAVista = getGroupedPayment('CARTAO_DEBITO', 'A_VISTA');
                const pixAVista = getGroupedPayment('PIX', 'A_VISTA');
                const dinheiroAVista = getGroupedPayment('DINHEIRO', 'A_VISTA');

                const cartaoCreditoParcelado = getGroupedPayment('CARTAO_CREDITO', 'PARCELADO');
                const boletoParcelado = getGroupedPayment('BOLETO', 'PARCELADO');

                const dataPrimeiroBoleto = formatDatePtBr(campos_variaveis?.['Data do Primeiro Boleto']);
                const melhorDiaBoletoCampo = String(campos_variaveis?.['Melhor Dia para Boleto'] || '').trim();
                const melhorDiaBoleto = melhorDiaBoletoCampo || (dataPrimeiroBoleto !== '___/___/___' ? dataPrimeiroBoleto.split('/')[0] : '___');

                const outrosPagamentos = normalizedPaymentEntries.filter(
                    (fp: any) => !['CARTAO_CREDITO', 'CARTAO_DEBITO', 'PIX', 'DINHEIRO', 'BOLETO'].includes(fp.forma),
                );

                const outrosPorTipo = {
                    A_VISTA: outrosPagamentos.filter((fp: any) => fp.tipo === 'A_VISTA'),
                    PARCELADO: outrosPagamentos.filter((fp: any) => fp.tipo === 'PARCELADO'),
                };

                const montarLinhaAVista = (label: string, data: { checked: boolean; valorTotal: number }) => `
                <label class="checkbox-item">
                    <input type="checkbox" class="checkbox" ${data.checked ? 'checked' : ''} disabled>
                    ${label} - ${formatCurrencyBRL(data.valorTotal)}
                </label>`;

                const valorParcelaCartao = cartaoCreditoParcelado.parcelas > 0 ? cartaoCreditoParcelado.valorTotal / cartaoCreditoParcelado.parcelas : 0;
                const valorParcelaBoleto = boletoParcelado.parcelas > 0 ? boletoParcelado.valorTotal / boletoParcelado.parcelas : 0;

                const avistaHtml = [
                    montarLinhaAVista('CARTÃO DE CRÉDITO', cartaoCreditoAVista),
                    montarLinhaAVista('CARTÃO DE DÉBITO', cartaoDebitoAVista),
                    montarLinhaAVista('PIX / TRANSFERÊNCIA', pixAVista),
                    montarLinhaAVista('ESPÉCIE (DINHEIRO)', dinheiroAVista),
                    `
                <label class="checkbox-item">
                    <input type="checkbox" class="checkbox" ${outrosPorTipo.A_VISTA.length > 0 ? 'checked' : ''} disabled>
                    OUTROS: ${
                        outrosPorTipo.A_VISTA.length > 0
                            ? outrosPorTipo.A_VISTA.map(
                                  (item: any) => `${escapeAndFallback(item.tituloOriginal || item.descricao, 'Não informado')} - ${formatCurrencyBRL(item.valor)}`,
                              ).join(' | ')
                            : 'Não informado'
                    }
                </label>`,
                ].join('');

                const parceladoHtml = `
                <label class="checkbox-item">
                    <input type="checkbox" class="checkbox" ${cartaoCreditoParcelado.checked ? 'checked' : ''} disabled>
                    CARTÃO DE CRÉDITO - ${formatCurrencyBRL(cartaoCreditoParcelado.valorTotal)}<br>
                    ${cartaoCreditoParcelado.parcelas || 0} parcela(s) de ${formatCurrencyBRL(valorParcelaCartao)}
                </label>
                <label class="checkbox-item">
                    <input type="checkbox" class="checkbox" ${boletoParcelado.checked ? 'checked' : ''} disabled>
                    BOLETO - ${formatCurrencyBRL(boletoParcelado.valorTotal)}<br>
                    ${boletoParcelado.parcelas || 0} parcela(s) de ${formatCurrencyBRL(valorParcelaBoleto)}<br>
                    Melhor dia de vencimento: ${escapeAndFallback(melhorDiaBoleto, '___')}<br>
                    1º boleto para: ${escapeAndFallback(dataPrimeiroBoleto, '___/___/___')}
                </label>
                <label class="checkbox-item">
                    <input type="checkbox" class="checkbox" ${outrosPorTipo.PARCELADO.length > 0 ? 'checked' : ''} disabled>
                    OUTROS: ${
                        outrosPorTipo.PARCELADO.length > 0
                            ? outrosPorTipo.PARCELADO.map((item: any) => {
                                  const parcelas = Number(item.parcelas || 0);
                                  const valorParcela = parcelas > 0 ? item.valor / parcelas : 0;
                                  return `${escapeAndFallback(item.tituloOriginal || item.descricao, 'Não informado')} - ${formatCurrencyBRL(item.valor)}${
                                      parcelas > 0 ? ` (${parcelas}x de ${formatCurrencyBRL(valorParcela)})` : ''
                                  }`;
                              }).join(' | ')
                            : 'Não informado'
                    }
                </label>`;

                return {
                    avistaHtml,
                    parceladoHtml,
                };
            })();

            const naoSeAplicaBonus =
                !bonusTipos.includes('100_dias') &&
                !bonusTipos.includes('ipr') &&
                !bonusTipos.includes('outros') &&
                !Object.keys(bonus?.valores_bonus || {}).some((key) => key.includes('Bônus-Outros'));

            const values: Record<string, string> = {
                ALUNO_NOME: aluno?.nome || '_________________',
                ALUNO_CPF: aluno?.cpf || '_________________',
                ALUNO_DATA_NASCIMENTO: dataNascimentoFormatada,
                ALUNO_WHATSAPP: aluno?.telefone_um || '_________________',
                ALUNO_EMAIL: aluno?.email || '_________________',
                ALUNO_ENDERECO_LOGRADOURO: aluno?.endereco?.logradouro || '',
                ALUNO_ENDERECO_NUMERO: aluno?.endereco?.numero || '',
                ALUNO_ENDERECO_COMPLEMENTO: aluno?.endereco?.complemento || '',
                ALUNO_ENDERECO_BAIRRO: aluno?.endereco?.bairro || '',
                ALUNO_CIDADE_ESTADO: `${aluno?.endereco?.cidade || '_______________'} / ${aluno?.endereco?.estado || '________'}`,
                ALUNO_CEP: aluno?.endereco?.cep || '____________',
                TREINAMENTO_NOME: nomeTreinamento,
                TREINAMENTO_CIDADE: campos_variaveis?.['Cidade do Treinamento'] || 'Local a definir',
                TREINAMENTO_DATA_INICIO: dataInicio,
                TREINAMENTO_DATA_FIM: dataFim,
                TREINAMENTO_PRECO: totalContrato > 0 ? this.formatCurrency(totalContrato) : 'R$ _________________',
                BONUS_NAO_APLICA: naoSeAplicaBonus ? 'checked' : '',
                BONUS_100_DIAS: bonusTipos.includes('100_dias') ? 'checked' : '',
                BONUS_IPR: bonusTipos.includes('ipr') ? 'checked' : '',
                BONUS_IPR_DATA: dataImersao,
                BONUS_OUTROS: bonusTipos.includes('outros') ? 'checked' : '',
                BONUS_OUTROS_DESCRICAO: bonusOutrosDescricao,
                BONUS_DETALHES_HTML: bonusDetalhesHtml,
                PAGAMENTO_CARTAO_CREDITO_AVISTA: hasPayment('CARTAO_CREDITO', 'A_VISTA') ? 'checked' : '',
                PAGAMENTO_CARTAO_DEBITO_AVISTA: hasPayment('CARTAO_DEBITO', 'A_VISTA') ? 'checked' : '',
                PAGAMENTO_PIX_AVISTA: hasPayment('PIX', 'A_VISTA') ? 'checked' : '',
                PAGAMENTO_ESPECIE_AVISTA: hasPayment('DINHEIRO', 'A_VISTA') ? 'checked' : '',
                PAGAMENTO_CARTAO_CREDITO_PARCELADO: hasPayment('CARTAO_CREDITO', 'PARCELADO') ? 'checked' : '',
                PAGAMENTO_BOLETO_PARCELADO: hasPayment('BOLETO', 'PARCELADO') ? 'checked' : '',
                PAGAMENTO_OUTROS_DESCRICAO: '',
                PAGAMENTO_AVISTA_DETALHES_HTML: pagamentoDetalhesHtml.avistaHtml,
                PAGAMENTO_PARCELADO_DETALHES_HTML: pagamentoDetalhesHtml.parceladoHtml,
                OBSERVACOES: observacoesContratoHtml || '_________________',
                CONTRATO_LOCAL: localAssinatura,
                CONTRATO_DATA: new Date().toLocaleDateString('pt-BR'),
                TESTEMUNHA_1_NOME: testemunhas?.testemunha_um?.nome || '_________________',
                TESTEMUNHA_1_CPF: testemunhas?.testemunha_um?.cpf || '_________________',
                TESTEMUNHA_2_NOME: testemunhas?.testemunha_dois?.nome || '_________________',
                TESTEMUNHA_2_CPF: testemunhas?.testemunha_dois?.cpf || '_________________',
                IAM_LOGO_URL: logoUrl,
                TREINAMENTO_LOGO_URL: treinamento?.url_logo_treinamento ? getAbsoluteImageUrl(treinamento.url_logo_treinamento) : logoUrl,
                CLAUSULAS_HTML: formatarClausulasHtml(clausulasOriginais),
            };

            let renderedTemplate = templateHtml;
            Object.entries(values).forEach(([key, value]) => {
                const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                renderedTemplate = renderedTemplate.replace(regex, value ?? '');
            });

            // Corrige possíveis vírgulas sobrando quando o template monta endereço com campos vazios
            renderedTemplate = renderedTemplate.replace(/,\s*,/g, ', ').replace(/,\s*,/g, ', ');
            if (!enderecoFormatado) {
                renderedTemplate = renderedTemplate.replace(/<strong>Endereço:<\/strong>[^<]*/g, '<strong>Endereço:</strong> _________________');
            }

            return renderedTemplate;
        }

        // Função para gerar footer com logo
        const generateFooter = (showLogo: boolean = true) => {
            return `
              <div class="footer">
                ${
                    showLogo && treinamento?.url_logo_treinamento
                        ? `<img src="${getAbsoluteImageUrl(treinamento.url_logo_treinamento)}" alt="Logo do Treinamento" style="max-height: 40px; max-width: 200px; object-fit: contain; margin-top: 5px;" onerror="this.style.display='none';">`
                        : showLogo
                          ? `<div class="footer-text-fallback"><div class="footer-logo">IMERSÃO PROSPERAR</div><div class="footer-subtitle">ACORDE SUA MENTE</div></div>`
                          : '<div style="height: 40px;"></div>'
                }
              </div>
            `;
        };

        const dadosPessoaisHTML = isIPRContract
            ? `
              <table class="table">
                <tr class="table-row">
                  <td class="table-cell full-width" colspan="2"><strong>Nome Completo:</strong> ${aluno?.nome || '_________________'}</td>
                </tr>
                <tr class="table-row">
                  <td class="table-cell half-width"><strong>Telefone:</strong> ${aluno?.telefone_um || '_________________'}</td>
                  <td class="table-cell half-width"><strong>E-mail:</strong> ${aluno?.email || '_________________'}</td>
                </tr>
              </table>
            `
            : `
              <table class="table">
                <tr class="table-row">
                  <td class="table-cell full-width" colspan="2"><strong>Nome Completo:</strong> ${aluno?.nome || '_________________'}</td>
                </tr>
                <tr class="table-row">
                  <td class="table-cell half-width"><strong>CPF/CNPJ:</strong> ${aluno?.cpf || '_________________'}</td>
                  <td class="table-cell half-width"><strong>Data de Nascimento:</strong> ${(() => {
                      if (!aluno?.data_nascimento) return '___/___/___';
                      const dataISO = aluno.data_nascimento;
                      if (dataISO.match(/^\d{4}-\d{2}-\d{2}$/)) {
                          const [ano, mes, dia] = dataISO.split('-');
                          return `${dia}/${mes}/${ano}`;
                      }
                      return new Date(dataISO).toLocaleDateString('pt-BR');
                  })()}</td>
                </tr>
                <tr class="table-row">
                  <td class="table-cell half-width"><strong>WhatsApp:</strong> ${aluno?.telefone_um || '_________________'}</td>
                  <td class="table-cell half-width"><strong>E-mail:</strong> ${aluno?.email || '_________________'}</td>
                </tr>
                <tr class="table-row">
                  <td class="table-cell full-width" colspan="2"><strong>Endereço:</strong> ${(() => {
                      const endereco = aluno?.endereco;
                      if (!endereco) return '_________________';

                      const partes = [];
                      if (endereco.logradouro) partes.push(endereco.logradouro);
                      if (endereco.numero) partes.push(endereco.numero);
                      if (endereco.complemento) partes.push(endereco.complemento);
                      if (endereco.bairro) partes.push(endereco.bairro);

                      return partes.length > 0 ? partes.join(', ') : '_________________';
                  })()}</td>
                </tr>
                <tr class="table-row">
                  <td class="table-cell half-width"><strong>Cidade/Estado:</strong> ${
                      aluno?.endereco?.cidade || '_______________'
                  } / ${aluno?.endereco?.estado || '________'}</td>
                  <td class="table-cell half-width"><strong>CEP:</strong> ${aluno?.endereco?.cep || '____________'}</td>
                </tr>
              </table>
            `;

        // Função para gerar página de assinaturas
        const generateSignaturePage = (showLogo: boolean = true) => {
            return `
              <div class="page">
                <!-- Local e Data -->
                <table style="border: none; margin-bottom: 0px!important;">
                  <tr>
                    <td class="table-cell half-width" style="text-align: center; border: none;">
                      Local: ${campos_variaveis?.['Local de Assinatura do Contrato'] || '________________________________'}
                    </td>
                    <td class="table-cell half-width" style="text-align: center; border: none;">
                      Data: ${new Date().toLocaleDateString('pt-BR')}
                    </td>
                  </tr>
                </table>
              
                <div style="text-align: center; margin: 30px 0;">
                  <div style="height: 35px; display: flex; align-items: center; justify-content: center;">
                    ${
                        contrato.assinatura_aluno_base64
                            ? `
                      <img src="${getAbsoluteImageUrl(contrato.assinatura_aluno_base64)}" alt="Assinatura do Aluno" style="max-height: 60px; max-width: 300px; object-fit: contain;">
                    `
                            : ''
                    }
                  </div>
                  <div class="signature-line" style="width: 60%; margin: 0 auto;"></div>
                  <strong style="font-size: 11px;">Assinatura do ALUNO/Contratante.</strong>
                </div>
                
                ${
                    mostrarTestemunhas
                        ? `
                <div style="margin-bottom: 15px;"></div>
                <div style="display: flex; justify-content: space-between; gap: 40px; line-height: 1;">
                  <div style="flex: 1; line-height: 1;">
                    <div style="height: 50px; display: flex; align-items: center; justify-content: center;">
                      ${
                          contrato.assinatura_testemunha_um_base64
                              ? `
                        <img src="${getAbsoluteImageUrl(contrato.assinatura_testemunha_um_base64)}" alt="Assinatura Testemunha 1" style="max-height: 60px; max-width: 300px; object-fit: contain;">
                      `
                              : ''
                      }
                    </div>
                    <div class="signature-line"></div>
                    <strong>Testemunha 1</strong><br>
                    Nome: ${testemunhas?.testemunha_um?.nome || '_________________'}<br>
                    CPF: ${testemunhas?.testemunha_um?.cpf || '_________________'}
                  </div>
                  <div style="flex: 1; line-height: 1;">
                    <div style="height: 50px; display: flex; align-items: center; justify-content: center;">
                      ${
                          contrato.assinatura_testemunha_dois_base64
                              ? `
                        <img src="${getAbsoluteImageUrl(contrato.assinatura_testemunha_dois_base64)}" alt="Assinatura Testemunha 2" style="max-height: 60px; max-width: 300px; object-fit: contain;">
                      `
                              : ''
                      }
                    </div>
                    <div class="signature-line"></div>
                    <strong>Testemunha 2</strong><br>
                    Nome: ${testemunhas?.testemunha_dois?.nome || '_________________'}<br>
                    CPF: ${testemunhas?.testemunha_dois?.cpf || '_________________'}
                  </div>
                </div>`
                        : ''
                }
                
                <!-- Footer da Página com Logo -->
                ${generateFooter(showLogo)}
              </div>
            `;
        };

        // Função para dividir cláusulas em páginas
        const generateClausePages = () => {
            const clausulas = template?.clausulas;

            if (!clausulas || clausulas.trim() === '') {
                return `
                  <div class="page clauses-page">
                    <div class="clauses-section">
                      <div style="text-align: center; padding: 40px; color: #ff0000;">
                        <strong>⚠️ ATENÇÃO: Cláusulas não encontradas no documento!</strong><br><br>
                        Por favor, configure as cláusulas deste documento no sistema.
                      </div>
                    </div>
                    ${generateFooter(false)}
                  </div>
                  ${generateSignaturePage(true)}
                `;
            }

            // Função para dividir cláusulas em páginas baseado no tamanho real do conteúdo
            const divideClausesIntoPages = (clausulasText: string) => {
                // Dividir por cláusulas usando regex para encontrar "Cláusula"
                const clauses = clausulasText.split(/(?=<strong>.*Cláusula)/g);

                // Se não conseguiu dividir por cláusulas, dividir por parágrafos
                if (clauses.length <= 1) {
                    const paragraphs = clausulasText.split(/(?=<p>|<div|<strong>)/g);
                    return paragraphs;
                }

                return clauses.filter((clause) => clause.trim() !== '');
            };

            // Dividir o conteúdo em páginas menores
            const clausePages = divideClausesIntoPages(clausulas);

            // Configurações para página A4
            // A4: 29,7cm x 21cm com margens de 1,27cm = área útil de 27,16cm x 18,46cm
            // Considerando fonte de 11px e line-height de 1.0, aproximadamente 45-50 linhas por página
            const maxCharactersPerPage = 6200; // Caracteres máximos por página (estimativa baseada em A4)
            const footerThreshold = 5000; // Limite para decidir se o footer fica na mesma página

            // Função para estimar o tamanho do conteúdo
            const estimateContentSize = (content: string) => {
                // Remover tags HTML para contar apenas o texto
                const textContent = content.replace(/<[^>]*>/g, '');
                return textContent.length;
            };

            // Calcular o tamanho total das cláusulas
            const totalClausesSize = clausePages.reduce((total, clause) => {
                return total + estimateContentSize(clause);
            }, 0);

            // Dividir cláusulas em páginas baseado no tamanho real do conteúdo
            const finalPages = [];
            let currentPage = '';
            let currentPageSize = 0;

            for (const clause of clausePages) {
                const clauseSize = estimateContentSize(clause);

                // Se adicionar esta cláusula exceder o limite da página, criar nova página
                if (currentPageSize + clauseSize > maxCharactersPerPage && currentPage !== '') {
                    finalPages.push(currentPage);
                    currentPage = clause;
                    currentPageSize = clauseSize;
                } else {
                    currentPage += clause;
                    currentPageSize += clauseSize;
                }
            }

            // Adicionar a última página se houver conteúdo
            if (currentPage !== '') {
                finalPages.push(currentPage);
            }

            // Determinar se o footer deve ficar na mesma página ou em página separada
            const shouldFooterBeOnSamePage = totalClausesSize < footerThreshold;

            return (
                finalPages
                    .map((pageContent, index) => {
                        const isLastClausePage = index === finalPages.length - 1;

                        if (isLastClausePage) {
                            if (shouldFooterBeOnSamePage) {
                                // Footer na mesma página - incluir assinaturas e footer na última página de cláusulas
                                return `
                      <div class="page clauses-page">
                        <div class="clauses-section">
                          ${pageContent}
                          <p style="text-align: center; margin-top: 20px; margin-bottom: 20px; font-size: 12px;"><strong>E, por estarem de acordo, firmam o presente contrato em duas vias de igual teor e forma, na presença das testemunhas abaixo.</strong></p>
                          
                          <!-- Local e Data -->
                          <table style="border: none; margin-top: 30px; margin-bottom: 20px;">
                            <tr>
                              <td class="table-cell half-width" style="text-align: center; border: none;">
                                Local: ${campos_variaveis?.['Local de Assinatura do Contrato'] || '________________________________'}
                              </td>
                              <td class="table-cell half-width" style="text-align: center; border: none;">
                                Data: ${new Date().toLocaleDateString('pt-BR')}
                              </td>
                            </tr>
                          </table>
                        
                          <div style="text-align: center; margin: 30px 0;">
                            <div style="height: 35px; display: flex; align-items: center; justify-content: center;">
                              ${
                                  contrato.assinatura_aluno_base64
                                      ? `
                                <img src="${getAbsoluteImageUrl(contrato.assinatura_aluno_base64)}" alt="Assinatura do Aluno" style="max-height: 60px; max-width: 300px; object-fit: contain;">
                              `
                                      : ''
                              }
                            </div>
                            <div class="signature-line" style="width: 60%; margin: 0 auto;"></div>
                            <strong style="font-size: 11px;">Assinatura do ALUNO/Contratante.</strong>
                          </div>
                          
                ${
                    mostrarTestemunhas
                        ? `
                <div style="margin-bottom: 15px;"></div>
                <div style="display: flex; justify-content: space-between; gap: 40px; line-height: 1;">
                  <div style="flex: 1; line-height: 1;">
                    <div style="height: 50px; display: flex; align-items: center; justify-content: center;">
                      ${
                          contrato.assinatura_testemunha_um_base64
                              ? `
                        <img src="${getAbsoluteImageUrl(contrato.assinatura_testemunha_um_base64)}" alt="Assinatura Testemunha 1" style="max-height: 60px; max-width: 300px; object-fit: contain;">
                      `
                              : ''
                      }
                    </div>
                    <div class="signature-line"></div>
                    <strong>Testemunha 1</strong><br>
                    Nome: ${testemunhas?.testemunha_um?.nome || '_________________'}<br>
                    CPF: ${testemunhas?.testemunha_um?.cpf || '_________________'}
                  </div>
                  <div style="flex: 1; line-height: 1;">
                    <div style="height: 50px; display: flex; align-items: center; justify-content: center;">
                      ${
                          contrato.assinatura_testemunha_dois_base64
                              ? `
                        <img src="${getAbsoluteImageUrl(contrato.assinatura_testemunha_dois_base64)}" alt="Assinatura Testemunha 2" style="max-height: 60px; max-width: 300px; object-fit: contain;">
                      `
                              : ''
                      }
                    </div>
                    <div class="signature-line"></div>
                    <strong>Testemunha 2</strong><br>
                    Nome: ${testemunhas?.testemunha_dois?.nome || '_________________'}<br>
                    CPF: ${testemunhas?.testemunha_dois?.cpf || '_________________'}
                  </div>
                </div>`
                        : ''
                }
                        </div>
                        ${generateFooter(true)}
                      </div>
                    `;
                            } else {
                                // Footer em página separada - apenas cláusulas na última página
                                return `
                      <div class="page clauses-page">
                        <div class="clauses-section">
                          ${pageContent}
                        </div>
                        ${generateFooter(false)}
                      </div>
                    `;
                            }
                        } else {
                            // Páginas intermediárias de cláusulas
                            return `
                      <div class="page clauses-page">
                        <div class="clauses-section">
                          ${pageContent}
                        </div>
                        ${generateFooter(false)}
                      </div>
                    `;
                        }
                    })
                    .join('') + (shouldFooterBeOnSamePage ? '' : generateSignaturePage(true))
            );
        };

        // Criar um documento HTML profissional com layout moderno
        const htmlContent = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <title>Contrato - ${contrato.aluno_nome}</title>
            <style>
              @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600&display=swap');
              
              * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
              }
              
              body {
                font-family: 'Figtree', Arial, sans-serif;
                font-size: 12px;
                line-height: 1.2;
                color: #000;
                background: #f5f5f5;
                padding: 20px;
                min-height: 100vh;
                margin: 0;
                display: flex;
                justify-content: center;
                align-items: flex-start;
              }
              
              /* Configuração para formato A4 com margens corretas */
              @page {
                size: A4;
                margin: 1.27cm;
              }
              
              .contract-container {
                width: 18.46cm; /* 21cm - 2.54cm (margens) */
                max-width: 18.46cm;
                margin: 0 auto;
                background: white;
                padding: 0;
                box-sizing: border-box;
                box-shadow: 0 4px 20px rgba(0,0,0,0.1);
                border-radius: 8px;
                overflow: visible;
                display: block;
                min-height: auto;
                position: relative;
              }
              
              /* Quebras de página naturais - estilo Microsoft Word */
              .page-break {
                page-break-before: always;
                break-before: page;
                margin-top: 0;
                padding-top: 0;
                position: relative;
              }
              
              /* Páginas individuais */
              .page {
                height: auto; /* Evita corte de conteúdo no fim da página */
                min-height: 27.16cm;
                padding: 1.27cm;
                padding-bottom: 80px; /* Reduzido de 100px para 80px para dar mais espaço */
                box-sizing: border-box;
                position: relative;
                overflow: visible; /* Não recorta conteúdo em páginas longas */
                page-break-after: always; /* Força quebra de página após cada página */
                break-after: page; /* Suporte moderno para quebra de página */
              }
              
              /* Última página não deve ter quebra */
              .page:last-child {
                page-break-after: auto;
                break-after: auto;
              }
              
              .header {
                text-align: center;
                padding-bottom: 15px;
              }
              
              .logo-container {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 15px;
              }
       
              .logo-divider {
                width: 2px;
                height: 40px;
                background: #002279;
                margin: 0 10px;
              }
                 
              .logo-image {
                width: 80px;
                height: auto;
                object-fit: contain;
              }
               
              .logo-text {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                text-align: left;
              }
              
              .logo {
                font-family: 'Montserrat', sans-serif;
                font-style: normal;
                font-size: 24px;
                font-weight: 600;
                color: #002279;
                margin: 0;
                line-height: 1;
                text-transform: uppercase;
                letter-spacing: 0.04em;
              }
              
              .intro-text {
                font-size: 12px;
                text-align: left;
                margin-bottom: 15px;
                color: #000;
                font-weight: normal;
              }
              
              table {
                width: 100%;
                border-collapse: separate;
                border-spacing: 0;
                margin-bottom: 15px;
                border: 1px solid #000;
                border-radius: 8px;
                overflow: hidden;
              }
              
              td {
                padding: 8px 10px;
                border-right: 1px solid #000;
                border-bottom: 1px solid #000;
                font-size: 12px;
                vertical-align: top;
              }
              
              td:last-child {
                border-right: none;
              }
              
              tr:last-child td {
                border-bottom: none;
              }
              
              td strong {
                font-weight: bold;
                text-transform: uppercase;
              }
              
              .full-width {
                width: 100%;
              }
              
              .half-width {
                width: 50%;
              }
              
              .checkbox-item {
                display: block;
                margin: 3px 0;
                font-size: 12px;
              }
              
              .checkbox {
                margin-right: 5px;
                transform: scale(1);
                accent-color: #000;
              }
               
              .checkbox:disabled {
                opacity: 0.8;
                cursor: not-allowed;
              }
              
              .signature-line {
                border-bottom: 1px solid #000;
                margin-bottom: 10px;
              }
              
              .clauses-section {
                margin-top: 26px;
                margin-bottom: 22px;
                padding: 0;
                background: white;
                font-size: 11px;
                line-height: 1.38;
                font-weight: 500;
              }
               
              .clause {
                margin-bottom: 8px; /* Espaço controlado entre cláusulas */
                padding: 0;
                background: white;
              }
                
              .clause-title {
                font-weight: 700;
                color: #000;
                font-size: 11px;
                text-decoration: none;
                margin-bottom: 4px;
                line-height: 1.35;
              }
                
              .clause-content {
                color: #000;
                line-height: 1.38;
                text-align: justify;
                font-size: 11px;
                font-weight: 500;
              }
                
              .clause-paragraph {
                margin-left: 0;
                display: block;
                margin-bottom: 6pt; /* 6pt de espaço após parágrafo */
              }
                
              .clause-paragraph-title {
                font-weight: bold;
                color: #000;
                margin-right: 5px;
                font-size: 11px;
                display: inline;
              }
                
                .clause-paragraph-text {
                  line-height: 1.38;
                  text-align: justify;
                  font-size: 11px;
                  display: inline;
                  font-weight: 500;
                }
                
                /* Garantir que tags strong dentro das cláusulas mantenham o negrito na impressão */
                .clauses-section strong {
                  font-weight: bold !important;
                  color: #000 !important;
                  font-size: 11px !important;
                }
                
                .clause strong {
                  font-weight: bold !important;
                  color: #000 !important;
                  font-size: 11px !important;
                }
                
                /* Regras mais específicas para garantir negrito na impressão */
                .clauses-section * strong {
                  font-weight: bold !important;
                  color: #000 !important;
                  font-size: 11px !important;
                }
                
                .clauses-section strong,
                .clauses-section b {
                  font-weight: bold !important;
                  color: #000 !important;
                  font-size: 11px !important;
                }

                /* Garantir que todos os elementos dentro das cláusulas usem fonte 11px */
                .clauses-section * {
                  font-size: 11px !important;
                  line-height: 1.38 !important;
                }

                .clauses-section p {
                  margin-bottom: 6pt !important;
                  line-height: 1.38 !important;
                  font-size: 11px !important;
                }
              
              /* Footer único - aparece no final de cada página */
              .footer {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                text-align: center;
                font-size: 12px;
                color: #000;
                border-top: none;
                padding: 20px 1.27cm;
                align-items: center;
                min-height: 80px;
                display: block;
                page-break-inside: avoid;
                -webkit-print-color-adjust: exact;
                color-adjust: exact;
                print-color-adjust: exact;
                z-index: 10;
                background: transparent;
                margin-top: 0;
              }
               
              .footer-logo {
                font-size: 18px;
                font-weight: bold;
                color: #000;
                margin-bottom: 5px;
                letter-spacing: 1px;
              }
               
              .footer-subtitle {
                font-size: 10px;
                color: #000;
                margin-bottom: 10px;
              }
               
              .footer img {
                max-height: 40px;
                max-width: 200px;
                object-fit: contain;
                margin: 0 auto;
                display: block;
                -webkit-print-color-adjust: exact;
                color-adjust: exact;
                print-color-adjust: exact;
              }
               
              .footer-text-fallback {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 60px;
              }
              
              @media print {
                body { 
                  background: white; 
                  padding: 0;
                  display: block;
                }
                img {
                  -webkit-print-color-adjust: exact;
                  color-adjust: exact;
                  print-color-adjust: exact;
                }
                .contract-container {
                  box-shadow: none;
                  border-radius: 0;
                  width: 18.46cm; /* 21cm - 2.54cm (margens) */
                  height: auto;
                  max-width: 18.46cm;
                  max-height: none;
                  margin: 0;
                  padding: 0;
                  overflow: visible;
                  display: block;
                  min-height: auto;
                  position: relative;
                }
                
                /* Força quebra de página entre páginas */
                .page + .page {
                  page-break-before: always;
                  break-before: page;
                }
                
                /* Garante que cada página seja uma página separada */
                .page {
                  page-break-after: always;
                  break-after: page;
                }
                
                .page:last-child {
                  page-break-after: auto;
                  break-after: auto;
                }
                
                .page {
                  height: auto; /* Evita corte de conteúdo no fim da página */
                  min-height: 27.16cm;
                  padding: 1.27cm;
                  padding-bottom: 80px; /* Reduzido para dar mais espaço ao conteúdo */
                  box-sizing: border-box;
                  position: relative;
                  overflow: visible; /* Não recorta conteúdo em páginas longas */
                }
                .page.clauses-page {
                  padding-top: 1.8cm;
                  padding-bottom: 2.3cm;
                }
                .page-break {
                  page-break-before: always;
                  break-before: page;
                  margin-top: 0;
                  padding-top: 0;
                }
                .footer {
                  position: absolute;
                  bottom: 0;
                  left: 0;
                  right: 0;
                  text-align: center;
                  font-size: 12px;
                  color: #000;
                  border-top: none;
                  padding: 20px 1.27cm;
                  align-items: center;
                  min-height: 80px;
                  display: block;
                  page-break-inside: avoid;
                  -webkit-print-color-adjust: exact;
                  color-adjust: exact;
                  print-color-adjust: exact;
                  z-index: 10;
                  background: transparent;
                  margin-top: 0;
                }
                .footer img {
                  max-height: 40px;
                  max-width: 200px;
                  object-fit: contain;
                  margin: 0 auto;
                  display: block;
                  -webkit-print-color-adjust: exact;
                  color-adjust: exact;
                  print-color-adjust: exact;
                }
                .footer-text-fallback {
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  min-height: 60px;
                  -webkit-print-color-adjust: exact;
                  color-adjust: exact;
                  print-color-adjust: exact;
                }
              }
            </style>
          </head>
          <body>
            <div class="contract-container">
              <!-- Primeira Página -->
              <div class="page">
              <div class="header">
                <div class="logo-container">
                  <img src="${logoUrl}" alt="Instituto Academy Mind" class="logo-image" onerror="this.style.display='none';">
                  <hr class="logo-divider">
                  <div class="logo-text">
                    <div class="logo">INSTITUTO ACADEMY MIND</div>
                  </div>
                </div>
              </div>
              
              <p class="intro-text">
                O presente instrumento tem como objetivo realizar a inscrição da pessoa abaixo nominada no seguinte treinamento:
              </p>
              
              <!-- Dados Pessoais -->
              ${dadosPessoaisHTML}
              
              <!-- Treinamento e Bônus -->
              <table class="table">
                <tr class="table-row">
                  <td class="table-cell ${possuiBonusRelevante ? 'half-width' : ''}" ${possuiBonusRelevante ? '' : 'colspan="2"'} style="vertical-align: top;">
                    <strong>Treinamento:</strong> ${treinamento?.nome || '_________________'}<br><br>
                    <strong>Cidade:</strong> ${campos_variaveis?.['Cidade do Treinamento'] || 'Local a definir'}<br><br>
                    <strong>Data Prevista:</strong> ${(() => {
                        const dataInicio = campos_variaveis?.['Data Prevista do Treinamento'];
                        const dataFinal = campos_variaveis?.['Data Final do Treinamento'];

                        if (dataInicio && dataFinal) {
                            return `${dataInicio} à ${dataFinal}`;
                        } else if (dataInicio) {
                            return dataInicio;
                        } else {
                            return '___/___/___';
                        }
                    })()}<br><br>
                    <strong>Preço do Contrato:</strong> ${(() => {
                        // Calcular o somatório de todos os valores pagos agrupando por forma e tipo
                        if (pagamento?.formas_pagamento && pagamento.formas_pagamento.length > 0) {
                            // Agrupar por forma e tipo para evitar duplicação
                            const groupedPayments: { [key: string]: number } = {};

                            pagamento.formas_pagamento.forEach((forma: any) => {
                                if (forma.valor && typeof forma.valor === 'number') {
                                    const key = `${forma.forma}_${forma.tipo}`;
                                    if (!groupedPayments[key]) {
                                        groupedPayments[key] = 0;
                                    }
                                    groupedPayments[key] += forma.valor;
                                }
                            });

                            // Somar todos os grupos únicos
                            const totalPago = Object.values(groupedPayments).reduce((sum, valorGrupo) => {
                                return sum + valorGrupo;
                            }, 0);

                            return new Intl.NumberFormat('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                            }).format(totalPago);
                        }
                        return 'R$ _________________';
                    })()}
                  </td>
                  ${
                      possuiBonusRelevante
                          ? `<td class="table-cell half-width" style="vertical-align: top;">
                    <strong>Bônus:</strong><br>
                          ${(() => {
                              const bonusItems = [];

                              // Não se aplica Bônus
                              const naoSeAplica =
                                  !bonus?.tipos_bonus?.includes('100_dias') &&
                                  !bonus?.tipos_bonus?.includes('ipr') &&
                                  !bonus?.tipos_bonus?.includes('outros') &&
                                  !Object.keys(bonus?.valores_bonus || {}).some((key) => key.includes('Bônus-Outros'));

                              bonusItems.push(`
                              <label class="checkbox-item">
                                <input type="checkbox" class="checkbox" ${naoSeAplica ? 'checked' : ''} disabled>
                                NÃO SE APLICA
                              </label>
                            `);

                              // 100 Dias
                              bonusItems.push(`
                              <label class="checkbox-item">
                                <input type="checkbox" class="checkbox" ${bonus?.tipos_bonus?.includes('100_dias') ? 'checked' : ''} disabled>
                                100 DIAS
                              </label>
                            `);

                              // IPR
                              const temIPR = bonus?.tipos_bonus?.includes('ipr');
                              const dataImersao = temIPR
                                  ? campos_variaveis?.['Data do Imersão Prosperar'] ||
                                    (bonus?.turma_bonus_info?.data_inicio ? new Date(bonus.turma_bonus_info.data_inicio).toLocaleDateString('pt-BR') : '___/___/___')
                                  : '';

                              // Obter quantidade de inscrições dos campos variáveis
                              const quantidadeInscricoes = temIPR ? campos_variaveis?.['Quantidade de Inscrições'] || '1' : '0';

                              // Obter sigla do evento (IPR + edição)
                              const siglaEvento = temIPR && bonus?.turma_bonus_info?.edicao_turma ? `IPR - ${bonus.turma_bonus_info.edicao_turma}` : '';

                              bonusItems.push(`
                              <label class="checkbox-item">
                                <input type="checkbox" class="checkbox" ${temIPR ? 'checked' : ''} disabled>
                                ${quantidadeInscricoes} Inscrições do Imersão Prosperar${
                                    temIPR && dataImersao
                                        ? `<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Data: ${dataImersao}${siglaEvento ? ` | ${siglaEvento}` : ''}`
                                        : ''
                                }
                              </label>
                            `);

                              // Outros
                              const temOutros =
                                  bonus?.tipos_bonus?.includes('outros') || Object.keys(bonus?.valores_bonus || {}).some((key) => key.includes('Bônus-Outros'));

                              let descricaoOutros = '_________________';
                              if (temOutros) {
                                  // Primeiro tentar pegar dos campos variáveis
                                  if (campos_variaveis?.['Descrição do Outro Bônus']) {
                                      descricaoOutros = campos_variaveis['Descrição do Outro Bônus'];
                                  } else {
                                      // Se não encontrar nos campos variáveis, tentar extrair dos valores_bonus
                                      const chaveOutros = Object.keys(bonus?.valores_bonus || {}).find((key) => key.includes('Bônus-Outros'));
                                      if (chaveOutros) {
                                          descricaoOutros = chaveOutros.replace('Bônus-Outros: ', '');
                                      }
                                  }
                              }

                              bonusItems.push(`
                              <label class="checkbox-item">
                                <input type="checkbox" class="checkbox" ${temOutros ? 'checked' : ''} disabled>
                                OUTROS: ${descricaoOutros}
                              </label>
                            `);

                              return bonusItems.join('');
                          })()}
                  </td>`
                          : ''
                  }
                </tr>
              </table>
              
              <!-- Formas de Pagamento -->
              <table class="table">
                <tr class="table-row">
                  <td class="table-cell" colspan="2" style="text-align: center; background: #f0f0f0;"><strong>FORMA DE PAGAMENTO</strong></td>
                </tr>
                <tr class="table-row">
                  <td class="table-cell half-width" style="vertical-align: top;">
                    <strong>À VISTA:</strong><br>
                      ${(() => {
                          const formasAVista = [];

                          // Agrupar formas de pagamento à vista por tipo e forma
                          const formasAgrupadas: { [key: string]: { valor: number; forma: string; tipo: string } } = {};

                          pagamento?.formas_pagamento?.forEach((fp: any) => {
                              if (fp.tipo === 'A_VISTA') {
                                  const key = `${fp.forma}_${fp.tipo}`;
                                  if (!formasAgrupadas[key]) {
                                      formasAgrupadas[key] = {
                                          valor: 0,
                                          forma: fp.forma,
                                          tipo: fp.tipo,
                                      };
                                  }
                                  formasAgrupadas[key].valor += fp.valor || 0;
                              }
                          });

                          // Cartão de Crédito à vista
                          const cartaoCreditoKey = 'CARTAO_CREDITO_A_VISTA';
                          const temCartaoCreditoAVista = formasAgrupadas[cartaoCreditoKey];
                          const valorFormatadoCartaoCredito = temCartaoCreditoAVista
                              ? temCartaoCreditoAVista.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                              : 'R$ 0,00';

                          formasAVista.push(`
                          <label class="checkbox-item">
                            <input type="checkbox" class="checkbox" ${temCartaoCreditoAVista ? 'checked' : ''} disabled>
                            CARTÃO DE CRÉDITO - ${valorFormatadoCartaoCredito}
                          </label>
                        `);

                          // Cartão de Débito à vista
                          const cartaoDebitoKey = 'CARTAO_DEBITO_A_VISTA';
                          const temCartaoDebitoAVista = formasAgrupadas[cartaoDebitoKey];
                          const valorFormatadoCartaoDebito = temCartaoDebitoAVista
                              ? temCartaoDebitoAVista.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                              : 'R$ 0,00';

                          formasAVista.push(`
                          <label class="checkbox-item">
                            <input type="checkbox" class="checkbox" ${temCartaoDebitoAVista ? 'checked' : ''} disabled>
                            CARTÃO DE DÉBITO - ${valorFormatadoCartaoDebito}
                          </label>
                        `);

                          // PIX/Transferência à vista
                          const pixKey = 'PIX_A_VISTA';
                          const temPixAVista = formasAgrupadas[pixKey];
                          const valorFormatadoPix = temPixAVista ? temPixAVista.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00';

                          formasAVista.push(`
                          <label class="checkbox-item">
                            <input type="checkbox" class="checkbox" ${temPixAVista ? 'checked' : ''} disabled>
                            PIX/TRANSFERÊNCIA - ${valorFormatadoPix}
                          </label>
                        `);

                          // Espécie à vista
                          const especieKey = 'DINHEIRO_A_VISTA';
                          const temEspecieAVista = formasAgrupadas[especieKey];
                          const valorFormatadoEspecie = temEspecieAVista
                              ? temEspecieAVista.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                              : 'R$ 0,00';

                          formasAVista.push(`
                          <label class="checkbox-item">
                            <input type="checkbox" class="checkbox" ${temEspecieAVista ? 'checked' : ''} disabled>
                            ESPÉCIE - ${valorFormatadoEspecie}
                          </label>
                        `);

                          return formasAVista.join('');
                      })()}
                  </td>
                  <td class="table-cell half-width" style="vertical-align: top;">
                    <strong>PARCELADO:</strong><br>
                      ${(() => {
                          const formasParceladas = [];
                          const nomeTreinamento = (treinamento?.nome || '').toLowerCase();

                          // Função auxiliar para determinar configuração de pagamento
                          const getConfigPagamento = (tipo: string) => {
                              // Verificar configuração específica do treinamento
                              const treinamentoObj = treinamento as Record<string, unknown>;
                              const configDireta = treinamentoObj?.[`permite_${tipo}_parcelado`];
                              const configPagamento = treinamentoObj?.config_pagamento as Record<string, unknown>;
                              const configIndireta = configPagamento?.[tipo === 'cartao_credito' ? 'cartao_credito' : 'boleto'];

                              return configDireta ?? configIndireta;
                          };

                          // Determinar quais formas de pagamento parcelado mostrar baseado na configuração do treinamento
                          // Prioridade: 1) Configuração específica do treinamento, 2) Lógica padrão baseada no nome

                          const configCartaoCredito = getConfigPagamento('cartao_credito');
                          const configBoleto = getConfigPagamento('boleto');

                          // Aplicar configuração ou usar lógica padrão
                          const mostrarCartaoCredito = configCartaoCredito !== undefined ? configCartaoCredito : true; // Padrão: sempre permitir cartão de crédito

                          const mostrarBoleto =
                              configBoleto !== undefined ? configBoleto : !nomeTreinamento.includes('ipr') && !nomeTreinamento.includes('imersão prosperar'); // Padrão: não permitir boleto para IPR

                          // Agrupar formas de pagamento parceladas por tipo e forma
                          const formasParceladasAgrupadas: { [key: string]: { valor: number; forma: string; tipo: string; parcelas: number } } = {};

                          pagamento?.formas_pagamento?.forEach((fp: any) => {
                              if (fp.tipo === 'PARCELADO') {
                                  const key = `${fp.forma}_${fp.tipo}`;
                                  if (!formasParceladasAgrupadas[key]) {
                                      formasParceladasAgrupadas[key] = {
                                          valor: 0,
                                          forma: fp.forma,
                                          tipo: fp.tipo,
                                          parcelas: fp.parcelas || 0,
                                      };
                                  }
                                  formasParceladasAgrupadas[key].valor += fp.valor || 0;
                                  // Usar o número de parcelas do objeto, não contar itens
                                  if (fp.parcelas && fp.parcelas > formasParceladasAgrupadas[key].parcelas) {
                                      formasParceladasAgrupadas[key].parcelas = fp.parcelas;
                                  } else if (!formasParceladasAgrupadas[key].parcelas) {
                                      // Se não tiver parcelas no objeto, incrementar (fallback)
                                      formasParceladasAgrupadas[key].parcelas += 1;
                                  }
                              }
                          });

                          // Cartão de Crédito parcelado
                          const cartaoCreditoKey = 'CARTAO_CREDITO_PARCELADO';
                          const temCartaoCreditoParcelado = formasParceladasAgrupadas[cartaoCreditoKey];

                          if (mostrarCartaoCredito) {
                              const totalCartaoCredito = temCartaoCreditoParcelado?.valor || 0;
                              const numeroParcelas = temCartaoCreditoParcelado?.parcelas || 0;
                              const valorParcela = numeroParcelas > 0 ? totalCartaoCredito / numeroParcelas : 0;

                              const totalFormatado = totalCartaoCredito.toLocaleString('pt-BR', {
                                  style: 'currency',
                                  currency: 'BRL',
                              });

                              const valorParcelaFormatado = valorParcela.toLocaleString('pt-BR', {
                                  style: 'currency',
                                  currency: 'BRL',
                              });

                              if (temCartaoCreditoParcelado) {
                                  formasParceladas.push(`
                              <label class="checkbox-item">
                                <input type="checkbox" class="checkbox" checked disabled>
                                CARTÃO DE CRÉDITO - Valor: ${totalFormatado}<br>
                                ${numeroParcelas} parcelas de: ${valorParcelaFormatado}
                              </label>
                            `);
                              } else {
                                  formasParceladas.push(`
                              <label class="checkbox-item">
                                <input type="checkbox" class="checkbox" disabled>
                                CARTÃO DE CRÉDITO - Valor: R$ 0,00<br>
                                0 parcelas de: R$ 0,00
                              </label>
                            `);
                              }
                          }

                          // Boleto parcelado - disponível para todos exceto IPR
                          const boletoKey = 'BOLETO_PARCELADO';
                          const temBoletoParcelado = formasParceladasAgrupadas[boletoKey];

                          if (mostrarBoleto) {
                              const totalBoleto = temBoletoParcelado?.valor || 0;
                              const numeroParcelas = temBoletoParcelado?.parcelas || 0;
                              const valorParcela = numeroParcelas > 0 ? totalBoleto / numeroParcelas : 0;

                              const totalFormatado = totalBoleto.toLocaleString('pt-BR', {
                                  style: 'currency',
                                  currency: 'BRL',
                              });

                              const valorParcelaFormatado = valorParcela.toLocaleString('pt-BR', {
                                  style: 'currency',
                                  currency: 'BRL',
                              });

                              // Obter dados do boleto dos campos variáveis
                              const dataPrimeiroBoleto = campos_variaveis?.['Data do Primeiro Boleto'] || '___/___/___';
                              const melhorDiaVencimento = dataPrimeiroBoleto !== '___/___/___' ? dataPrimeiroBoleto.split('/')[0] : '___';

                              if (temBoletoParcelado) {
                                  formasParceladas.push(`
                             <label class="checkbox-item">
                               <input type="checkbox" class="checkbox" checked disabled>
                               BOLETO - Valor: ${totalFormatado}<br>
                               ${numeroParcelas} Parcelas de: ${valorParcelaFormatado}<br>
                               Melhor dia de Vencimento: ${melhorDiaVencimento}<br> 
                               1º Boleto para: ${dataPrimeiroBoleto}
                             </label>
                           `);
                              } else {
                                  formasParceladas.push(`
                             <label class="checkbox-item">
                               <input type="checkbox" class="checkbox" disabled>
                               BOLETO - Valor: R$ 0,00<br>
                               0 Parcelas de: R$ 0,00<br>
                               Melhor dia de Vencimento: ___<br> 
                               1º Boleto para: ___/___/___
                             </label>
                           `);
                              }
                          }

                          // As opções já foram adicionadas acima baseadas na configuração do treinamento

                          return formasParceladas.join('');
                      })()}
                  </td>
                </tr>
              </table>
              
              <!-- Observações -->
              <table class="table">
                <tr class="table-row">
                  <td class="table-cell">
                    <strong>OBSERVAÇÕES:</strong><br><br>
                    ${observacoesContratoHtml || '_________________'}
                  </td>
                </tr>
              </table>
              
              <!-- Assinaturas -->
              <p style="margin-bottom: 5px; margin-top: 5px; font-size: 12px; text-align: justify; line-height: 1;">
                Declaro que li e concordo com todas as cláusulas deste contrato, redigidas em 2 laudas, estando ciente de todas elas, por meio da assinatura abaixo e na presença de 2 testemunhas.
              </p>
              
              <table class="table" style="border: none; margin-bottom: 0px!important;">
                <tr class="table-row">
                  <td class="table-cell half-width" style="text-align: center; border: none;">
                    Local: ${campos_variaveis?.['Local de Assinatura do Contrato'] || '________________________________'}
                  </td>
                  <td class="table-cell half-width" style="text-align: center; border: none;">
                    Data: ${new Date().toLocaleDateString('pt-BR')}
                  </td>
                </tr>
              </table>
              
              <div style="text-align: center; margin: 30px 0;">
                <div style="height: 35px; display: flex; align-items: center; justify-content: center;">
                  ${
                      contrato.assinatura_aluno_base64
                          ? `
                    <img src="${getAbsoluteImageUrl(contrato.assinatura_aluno_base64)}" alt="Assinatura do Aluno" style="max-height: 60px; max-width: 300px; object-fit: contain;">
                  `
                          : ''
                  }
                </div>
                <div class="signature-line" style="width: 60%; margin: 0 auto;"></div>
                <strong style="font-size: 11px;">Assinatura do ALUNO/Contratante.</strong>
              </div>
              
              ${
                  mostrarTestemunhas
                      ? `
              <div style="margin-bottom: 15px;"></div>
              <div style="display: flex; justify-content: space-between; gap: 40px; line-height: 1;">
                <div style="flex: 1; line-height: 1;">
                  <div style="height: 50px; display: flex; align-items: center; justify-content: center;">
                    ${
                        contrato.assinatura_testemunha_um_base64
                            ? `
                      <img src="${getAbsoluteImageUrl(contrato.assinatura_testemunha_um_base64)}" alt="Assinatura Testemunha 1" style="max-height: 60px; max-width: 300px; object-fit: contain;">
                    `
                            : ''
                    }
                  </div>
                  <div class="signature-line"></div>
                  <strong>Testemunha 1</strong><br>
                  Nome: ${testemunhas?.testemunha_um?.nome || '_________________'}<br>
                  CPF: ${testemunhas?.testemunha_um?.cpf || '_________________'}
                </div>
                <div style="flex: 1; line-height: 1;">
                  <div style="height: 50px; display: flex; align-items: center; justify-content: center;">
                    ${
                        contrato.assinatura_testemunha_dois_base64
                            ? `
                      <img src="${getAbsoluteImageUrl(contrato.assinatura_testemunha_dois_base64)}" alt="Assinatura Testemunha 2" style="max-height: 60px; max-width: 300px; object-fit: contain;">
                    `
                            : ''
                    }
                  </div>
                  <div class="signature-line"></div>
                  <strong>Testemunha 2</strong><br>
                  Nome: ${testemunhas?.testemunha_dois?.nome || '_________________'}<br>
                  CPF: ${testemunhas?.testemunha_dois?.cpf || '_________________'}
                </div>
              </div>`
                      : ''
              }
              
              <!-- Footer da Primeira Página com Logo -->
              <div class="footer">
                ${
                    treinamento?.url_logo_treinamento
                        ? `<img src="${getAbsoluteImageUrl(treinamento.url_logo_treinamento)}" alt="Logo do Treinamento" style="max-height: 40px; max-width: 200px; object-fit: contain; margin-top: 10px;" onerror="this.style.display='none';">`
                        : ``
                }
              </div>
              </div>
              
              <!-- Páginas de Cláusulas e Assinaturas (Dinâmicas) -->
              ${generateClausePages()}
              
            </div>
          </body>
          </html>
        `;

        return htmlContent;
    }

    /**
     * Reestrutura os dados preparados pelo prepareTemplateDataFromSavedContract para o formato esperado pelo ModernContractPDF
     */
    private restructureDataForModernContract(data: any): any {
        console.log('=== RESTRUCTURE DATA FOR MODERN CONTRACT ===');
        console.log('Data recebida:', JSON.stringify(data, null, 2));
        console.log('Formas pagamento:', JSON.stringify(data.pagamento?.formas_pagamento || data.formas_pagamento, null, 2));
        console.log('Testemunhas:', JSON.stringify(data.testemunhas, null, 2));
        const tiposBonus = Array.isArray(data.bonus?.tipos_bonus)
            ? data.bonus.tipos_bonus
            : Array.isArray(data.tipos_bonus)
              ? data.tipos_bonus
              : Array.isArray(data.bonus_selecionados)
                ? data.bonus_selecionados
                : [];
        const formasPagamentoNormalizadas = this.normalizeFormasPagamento(data.pagamento?.formas_pagamento || data.formas_pagamento || []);
        const observacoes = data.campos_variaveis?.['Observações'] || data.campos_variaveis?.['Observacoes'] || data.campos_variaveis?.['OBSERVACOES'] || '';

        return {
            aluno_nome: data.aluno?.nome || '',
            dados_contrato: {
                aluno: {
                    nome: data.aluno?.nome || '',
                    cpf: data.aluno?.cpf || '',
                    data_nascimento: data.aluno?.data_nascimento || '',
                    telefone_um: data.aluno?.telefone_um || '',
                    email: data.aluno?.email || '',
                    endereco: {
                        logradouro: data.aluno?.logradouro || '',
                        numero: data.aluno?.numero || '',
                        complemento: data.aluno?.complemento || '',
                        bairro: data.aluno?.bairro || '',
                        cidade: data.aluno?.cidade || '',
                        estado: data.aluno?.estado || '',
                        cep: data.aluno?.cep || '',
                    },
                },
                treinamento: {
                    nome: data.treinamento?.treinamento || '',
                    url_logo_treinamento: data.treinamento?.url_logo_treinamento || '',
                },
                pagamento: {
                    forma_pagamento: data.pagamento?.forma_pagamento || '',
                    formas_pagamento: formasPagamentoNormalizadas,
                    valores_formas_pagamento: data.pagamento?.valores_formas_pagamento || data.valores_formas_pagamento || {},
                },
                bonus: {
                    tipos_bonus: tiposBonus,
                    valores_bonus: data.bonus?.valores_bonus || data.valores_bonus || {},
                    turma_bonus_info: {
                        data_inicio: data.campos_variaveis?.['Data do Imersão Prosperar'] || '',
                        edicao_turma: '',
                    },
                },
                testemunhas: data.testemunhas
                    ? {
                          testemunha_um: {
                              nome: data.testemunhas.testemunha_um?.nome || '',
                              cpf: data.testemunhas.testemunha_um?.cpf || '',
                              email: data.testemunhas.testemunha_um?.email || '',
                              telefone: data.testemunhas.testemunha_um?.telefone || '',
                          },
                          testemunha_dois: {
                              nome: data.testemunhas.testemunha_dois?.nome || '',
                              cpf: data.testemunhas.testemunha_dois?.cpf || '',
                              email: data.testemunhas.testemunha_dois?.email || '',
                              telefone: data.testemunhas.testemunha_dois?.telefone || '',
                          },
                      }
                    : undefined,
                campos_variaveis: {
                    'Cidade do Treinamento': data.campos_variaveis?.['Cidade do Treinamento'] || '',
                    'Data Prevista do Treinamento': data.campos_variaveis?.['Data Prevista do Treinamento'] || '',
                    'Data Final do Treinamento': data.campos_variaveis?.['Data Final do Treinamento'] || '',
                    'Local de Assinatura do Contrato': data.campos_variaveis?.['Local de Assinatura do Contrato'] || '',
                    'Data do Imersão Prosperar': data.campos_variaveis?.['Data do Imersão Prosperar'] || '',
                    'Quantidade de Inscrições': data.campos_variaveis?.['Quantidade de Inscrições'] || '0',
                    'Descrição do Outro Bônus': data.campos_variaveis?.['Descrição do Outro Bônus'] || '',
                    'Data do Primeiro Boleto': data.campos_variaveis?.['Data do Primeiro Boleto'] || '',
                    'Melhor Dia para Boleto': data.campos_variaveis?.['Melhor Dia para Boleto'] || '',
                    'Número de Parcelas do Boleto': data.campos_variaveis?.['Número de Parcelas do Boleto'] || '',
                    Observações: observacoes,
                },
                template: {
                    clausulas: data.clausulas || '',
                },
            },
            assinatura_aluno_base64: data.assinatura_aluno_base64 || '',
            assinatura_testemunha_um_base64: data.assinatura_testemunha_um_base64 || '',
            assinatura_testemunha_dois_base64: data.assinatura_testemunha_dois_base64 || '',
        };
    }

    private normalizeFormasPagamento(formasPagamento: any[]): any[] {
        if (!Array.isArray(formasPagamento)) return [];

        const normalizeText = (value: unknown): string => {
            if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return '';
            return String(value)
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toUpperCase()
                .trim();
        };

        const parseValue = (value: unknown): number => {
            if (typeof value === 'number') return value;
            if (typeof value !== 'string') return 0;
            return (
                Number(
                    value
                        .replace(/[R$\s]/g, '')
                        .replace(/\./g, '')
                        .replace(',', '.'),
                ) || 0
            );
        };

        const inferTipo = (fp: any): string => {
            const tipoRaw = normalizeText(fp?.tipo);
            if (tipoRaw.includes('PARCELADO')) return 'PARCELADO';
            if (tipoRaw.includes('A_VISTA') || tipoRaw.includes('A VISTA') || tipoRaw.includes('AVISTA')) return 'A_VISTA';

            const texto = normalizeText(`${fp?.forma || ''} ${fp?.forma_pagamento || ''} ${fp?.descricao || ''}`);
            if (texto.includes('PARCELADO')) return 'PARCELADO';
            if (texto.includes('A VISTA') || texto.includes('AVISTA')) return 'A_VISTA';
            return '';
        };

        const inferForma = (fp: any): string => {
            const formaRaw = normalizeText(fp?.forma);
            const texto = normalizeText(`${fp?.forma || ''} ${fp?.forma_pagamento || ''} ${fp?.descricao || ''}`);
            const base = `${formaRaw} ${texto}`;

            if (base.includes('CARTAO_CREDITO') || base.includes('CARTAO DE CREDITO')) return 'CARTAO_CREDITO';
            if (base.includes('CARTAO_DEBITO') || base.includes('CARTAO DE DEBITO')) return 'CARTAO_DEBITO';
            if (base.includes('PIX') || base.includes('TRANSFERENCIA')) return 'PIX';
            if (base.includes('DINHEIRO') || base.includes('ESPECIE')) return 'DINHEIRO';
            if (base.includes('BOLETO')) return 'BOLETO';
            return '';
        };

        return formasPagamento
            .map((fp: any) => {
                const tipo = inferTipo(fp);
                const forma = inferForma(fp);
                return {
                    ...fp,
                    tipo: tipo || fp?.tipo || '',
                    forma: forma || fp?.forma || '',
                    valor: parseValue(fp?.valor),
                    parcelas: Number(fp?.parcelas || 0),
                };
            })
            .filter((fp: any) => fp?.tipo && fp?.forma && Number(fp?.valor || 0) > 0);
    }

    /**
     * Converte os métodos de pagamento para o formato esperado
     */
    private convertPaymentMethodsToFormasPagamento(pagamento: any, valorTotal: string): any[] {
        const formasPagamento = [];

        // Se já temos formas_pagamento estruturadas, usar diretamente
        if (pagamento?.formas_pagamento && Array.isArray(pagamento.formas_pagamento)) {
            return pagamento.formas_pagamento;
        }

        // Fallback para formato antigo - usar valores específicos se disponíveis
        if (pagamento?.cartao_credito_avista && pagamento?.valor_cartao_credito_avista) {
            formasPagamento.push({
                tipo: 'A_VISTA',
                forma: 'CARTAO_CREDITO',
                valor: this.parseCurrencyValue(pagamento.valor_cartao_credito_avista),
            });
        }
        if (pagamento?.cartao_debito_avista && pagamento?.valor_cartao_debito_avista) {
            formasPagamento.push({
                tipo: 'A_VISTA',
                forma: 'CARTAO_DEBITO',
                valor: this.parseCurrencyValue(pagamento.valor_cartao_debito_avista),
            });
        }
        if (pagamento?.pix_avista && pagamento?.valor_pix_avista) {
            formasPagamento.push({
                tipo: 'A_VISTA',
                forma: 'PIX',
                valor: this.parseCurrencyValue(pagamento.valor_pix_avista),
            });
        }
        if (pagamento?.especie_avista && pagamento?.valor_especie_avista) {
            formasPagamento.push({
                tipo: 'A_VISTA',
                forma: 'DINHEIRO',
                valor: this.parseCurrencyValue(pagamento.valor_especie_avista),
            });
        }
        if (pagamento?.cartao_credito_parcelado && pagamento?.valor_cartao_credito_parcelado) {
            formasPagamento.push({
                tipo: 'PARCELADO',
                forma: 'CARTAO_CREDITO',
                valor: this.parseCurrencyValue(pagamento.valor_cartao_credito_parcelado),
            });
        }
        if (pagamento?.boleto_parcelado && pagamento?.valor_boleto_parcelado) {
            formasPagamento.push({
                tipo: 'PARCELADO',
                forma: 'BOLETO',
                valor: this.parseCurrencyValue(pagamento.valor_boleto_parcelado),
            });
        }

        return formasPagamento;
    }

    /**
     * Converte os bônus para o formato esperado
     */
    private convertBonusToTiposBonus(bonus: any): string[] {
        const tiposBonus = [];

        if (bonus?.cem_dias) {
            tiposBonus.push('100_dias');
        }
        if (bonus?.ipr) {
            tiposBonus.push('ipr');
        }
        if (bonus?.outros) {
            tiposBonus.push('outros');
        }

        return tiposBonus;
    }

    /**
     * Converte valor de string para número
     */
    private parseCurrencyValue(value: string): number {
        if (!value) return 0;
        // Remove "R$" e espaços, depois converte vírgula para ponto
        const cleanValue = value
            .replace(/[R$\s]/g, '')
            .replace('.', '')
            .replace(',', '.');
        return parseFloat(cleanValue) || 0;
    }

    /**
     * Formata valor para moeda brasileira
     */
    private formatCurrency(value: number): string {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        }).format(value);
    }

    /**
     * Gera um PDF a partir do ModernContractPDF.tsx com os dados fornecidos
     */
    async generateContractPDF(data: any): Promise<Buffer> {
        const isErroTransientePuppeteer = (error: any) => {
            const message = String(error?.message || '').toLowerCase();
            return (
                message.includes('econnreset') ||
                message.includes('target closed') ||
                message.includes('session closed') ||
                message.includes('protocol error') ||
                message.includes('browser has disconnected') ||
                message.includes('navigation failed because browser has disconnected')
            );
        };

        const gerarPdfTentativa = async (html: string): Promise<Buffer> => {
            let browser: puppeteer.Browser | null = null;
            let page: puppeteer.Page | null = null;

            try {
                const isWindows = process.platform === 'win32';
                const chromiumArgs = isWindows
                    ? ['--disable-gpu', '--disable-software-rasterizer']
                    : [
                          '--no-sandbox',
                          '--disable-setuid-sandbox',
                          '--disable-dev-shm-usage',
                          '--disable-accelerated-2d-canvas',
                          '--no-first-run',
                          '--disable-gpu',
                          '--disable-software-rasterizer',
                      ];

                // Configurar o Puppeteer com transporte pipe (mais estável que websocket)
                browser = await puppeteer.launch({
                    headless: true,
                    pipe: true,
                    args: chromiumArgs,
                    ignoreDefaultArgs: ['--disable-extensions'],
                    protocolTimeout: 120000,
                });

                page = await browser.newPage();
                page.setDefaultNavigationTimeout(45000);

                // Definir o conteúdo HTML
                await page.setContent(html, { waitUntil: 'networkidle0' });

                // Aguarda o carregamento de fontes para manter o layout fiel ao HTML/CSS
                await page.evaluate(async () => {
                    await document.fonts.ready;
                });

                // Gerar o PDF
                const pdfBuffer = await page.pdf({
                    format: 'A4',
                    preferCSSPageSize: true,
                    printBackground: true,
                    margin: {
                        top: '0',
                        right: '0',
                        bottom: '0',
                        left: '0',
                    },
                });

                return Buffer.from(pdfBuffer);
            } finally {
                try {
                    if (page && !page.isClosed()) {
                        await page.close();
                    }
                } catch (closePageError) {
                    console.warn('Aviso ao fechar página do Puppeteer:', closePageError);
                }

                try {
                    if (browser) {
                        await browser.close();
                    }
                } catch (closeBrowserError) {
                    console.warn('Aviso ao fechar browser do Puppeteer:', closeBrowserError);
                }
            }
        };

        try {
            // Se os dados vieram do prepareTemplateDataFromSavedContract, precisamos reestruturar
            const contrato = this.restructureDataForModernContract(data);

            // Gerar HTML baseado no ModernContractPDF.tsx
            const html = this.generateModernContractHTML(contrato);
            const maxTentativas = 3;
            let ultimaFalha: any;

            for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
                try {
                    return await gerarPdfTentativa(html);
                } catch (error: any) {
                    ultimaFalha = error;
                    const transiente = isErroTransientePuppeteer(error);

                    console.error(`[PDF] Falha na tentativa ${tentativa}/${maxTentativas}:`, error?.message || error);

                    if (!transiente || tentativa === maxTentativas) {
                        throw error;
                    }

                    // Pequeno backoff para dar tempo do Chromium estabilizar.
                    await new Promise((resolve) => setTimeout(resolve, 300 * tentativa));
                }
            }

            throw ultimaFalha;
        } catch (error: any) {
            console.error('Erro ao gerar PDF do contrato:', error);

            // Verificar se é erro de dependências do sistema
            if (error?.message?.includes('cannot open shared object file') || error?.message?.includes('Failed to launch the browser process')) {
                const errorMessage =
                    'Erro ao iniciar o navegador. Dependências do sistema podem estar faltando. ' +
                    'Execute: apt-get update && apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2';
                console.error(errorMessage);
                throw new Error('Erro ao gerar PDF do contrato: Dependências do sistema faltando. Verifique os logs do servidor.');
            }

            throw new Error('Erro ao gerar PDF do contrato');
        }
    }

    /**
     * Formata o preço para exibição
     */
    formatPrice(price: number): string {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        }).format(price);
    }

    /**
     * Formata a data para exibição
     */
    formatDate(date: string | Date): string {
        if (!date) return '';

        const dateObj = typeof date === 'string' ? new Date(date) : date;
        return dateObj.toLocaleDateString('pt-BR');
    }

    /**
     * Formata o CPF para exibição
     */
    formatCPF(cpf: string): string {
        if (!cpf) return '';

        // Remove caracteres não numéricos
        const numbers = cpf.replace(/\D/g, '');

        // Aplica a máscara
        return numbers.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }

    /**
     * Formata o CEP para exibição
     */
    formatCEP(cep: string): string {
        if (!cep) return '';

        // Remove caracteres não numéricos
        const numbers = cep.replace(/\D/g, '');

        // Aplica a máscara
        return numbers.replace(/(\d{5})(\d{3})/, '$1-$2');
    }
}
