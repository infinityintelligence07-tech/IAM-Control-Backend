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

        // Obter a URL absoluta da logo
        const logoUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/images/logo/logo-escuro.png`;

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
            return `${process.env.FRONTEND_URL || 'http://localhost:3001'}${url}`;
        };

        // Função para converter URLs relativas em absolutas
        const getAbsoluteImageUrl = (url: string): string => {
            return convertGoogleDriveUrl(url);
        };

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
                
                <!-- Espaço entre assinatura do aluno e testemunhas -->
                <div style="margin-bottom: 15px;"></div>
                
                <!-- Testemunhas com linhas de assinatura individuais -->
                <div style="display: flex; justify-content: space-between; gap: 40px; line-height: 1;">
                  <!-- Testemunha 1 -->
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
                  
                  <!-- Testemunha 2 -->
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
                </div>
                
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
                  <div class="page">
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
                      <div class="page">
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
                          
                          <!-- Espaço entre assinatura do aluno e testemunhas -->
                          <div style="margin-bottom: 15px;"></div>
                          
                          <!-- Testemunhas com linhas de assinatura individuais -->
                          <div style="display: flex; justify-content: space-between; gap: 40px; line-height: 1;">
                            <!-- Testemunha 1 -->
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
                            
                            <!-- Testemunha 2 -->
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
                          </div>
                        </div>
                        ${generateFooter(true)}
                      </div>
                    `;
                            } else {
                                // Footer em página separada - apenas cláusulas na última página
                                return `
                      <div class="page">
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
                      <div class="page">
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
                height: 27.16cm; /* Altura A4 menos margens - altura fixa */
                min-height: 27.16cm;
                padding: 1.27cm;
                padding-bottom: 80px; /* Reduzido de 100px para 80px para dar mais espaço */
                box-sizing: border-box;
                position: relative;
                overflow: hidden; /* Evita que conteúdo transborde */
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
                margin-top: 20px;
                padding: 0;
                background: white;
                font-size: 11px;
                line-height: 1.0; /* Espaçamento simples */
              }
               
              .clause {
                margin-bottom: 8px; /* Reduzido de 12px para 8px */
                padding: 0;
                background: white;
              }
                
              .clause-title {
                font-weight: bold;
                color: #000;
                font-size: 11px;
                text-decoration: underline;
              }
                
              .clause-content {
                color: #000;
                line-height: 1.0; /* Espaçamento simples */
                text-align: justify;
                font-size: 11px;
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
                  line-height: 1.0; /* Espaçamento simples */
                  text-align: justify;
                  font-size: 11px;
                  display: inline;
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
                  line-height: 1.0 !important;
                }

                .clauses-section p {
                  margin-bottom: 6pt !important;
                  line-height: 1.0 !important;
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
                  height: 27.16cm; /* Altura A4 menos margens - altura fixa */
                  min-height: 27.16cm;
                  padding: 1.27cm;
                  padding-bottom: 80px; /* Reduzido para dar mais espaço ao conteúdo */
                  box-sizing: border-box;
                  position: relative;
                  overflow: hidden; /* Evita que conteúdo transborde */
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
              
              <!-- Treinamento e Bônus -->
              <table class="table">
                <tr class="table-row">
                  <td class="table-cell half-width" style="vertical-align: top;">
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
                  <td class="table-cell half-width" style="vertical-align: top;">
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
                  </td>
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
                                          parcelas: 0,
                                      };
                                  }
                                  formasParceladasAgrupadas[key].valor += fp.valor || 0;
                                  formasParceladasAgrupadas[key].parcelas += 1;
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
              
              <!-- Espaço entre assinatura do aluno e testemunhas -->
              <div style="margin-bottom: 15px;"></div>
              
              <!-- Testemunhas com linhas de assinatura individuais -->
              <div style="display: flex; justify-content: space-between; gap: 40px; line-height: 1;">
                <!-- Testemunha 1 -->
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
                
                <!-- Testemunha 2 -->
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
              </div>
              
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
                    formas_pagamento: data.formas_pagamento || data.pagamento?.formas_pagamento || [],
                },
                bonus: {
                    tipos_bonus: data.bonus_selecionados || [],
                    valores_bonus: data.valores_bonus || {},
                    turma_bonus_info: {
                        data_inicio: data.campos_variaveis?.['Data do Imersão Prosperar'] || '',
                        edicao_turma: '',
                    },
                },
                testemunhas: {
                    testemunha_um: {
                        nome: data.testemunhas?.testemunha_um?.nome || '',
                        cpf: data.testemunhas?.testemunha_um?.cpf || '',
                    },
                    testemunha_dois: {
                        nome: data.testemunhas?.testemunha_dois?.nome || '',
                        cpf: data.testemunhas?.testemunha_dois?.cpf || '',
                    },
                },
                campos_variaveis: {
                    'Cidade do Treinamento': data.campos_variaveis?.['Cidade do Treinamento'] || '',
                    'Data Prevista do Treinamento': data.campos_variaveis?.['Data Prevista do Treinamento'] || '',
                    'Data Final do Treinamento': data.campos_variaveis?.['Data Final do Treinamento'] || '',
                    'Local de Assinatura do Contrato': data.campos_variaveis?.['Local de Assinatura do Contrato'] || '',
                    'Data do Imersão Prosperar': data.campos_variaveis?.['Data do Imersão Prosperar'] || '',
                    'Quantidade de Inscrições': data.campos_variaveis?.['Quantidade de Inscrições'] || '0',
                    'Descrição do Outro Bônus': data.campos_variaveis?.['Descrição do Outro Bônus'] || '',
                    'Data do Primeiro Boleto': data.campos_variaveis?.['Data do Primeiro Boleto'] || '',
                    'Número de Parcelas do Boleto': data.campos_variaveis?.['Número de Parcelas do Boleto'] || '',
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
        try {
            // Se os dados vieram do prepareTemplateDataFromSavedContract, precisamos reestruturar
            const contrato = this.restructureDataForModernContract(data);

            // Gerar HTML baseado no ModernContractPDF.tsx
            const html = this.generateModernContractHTML(contrato);

            // Configurar o Puppeteer
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            });

            const page = await browser.newPage();

            // Definir o conteúdo HTML
            await page.setContent(html, { waitUntil: 'networkidle0' });

            // Gerar o PDF
            const pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: {
                    top: '20mm',
                    right: '20mm',
                    bottom: '20mm',
                    left: '20mm',
                },
            });

            await browser.close();

            return Buffer.from(pdfBuffer);
        } catch (error) {
            console.error('Erro ao gerar PDF do contrato:', error);
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
