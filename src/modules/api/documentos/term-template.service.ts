import { Injectable } from '@nestjs/common';
import * as puppeteer from 'puppeteer';

@Injectable()
export class TermTemplateService {
    /**
     * Gera HTML para o termo baseado no layout fornecido
     */
    private generateTermHTML(termoData: any): string {
        const aluno = termoData.aluno;
        const termo = termoData.termo;
        const testemunhas = termoData.testemunhas;
        const campos_variaveis = termoData.campos_variaveis || {};

        // Obter a URL absoluta da logo
        const logoUrl = `${process.env.FRONTEND_URL || 'https://iamcontrol.com.br'}/images/logo/logo-claro.png`;

        // Função para converter URLs
        const convertGoogleDriveUrl = (url: string): string => {
            if (!url) return '';
            if (url.startsWith('data:')) return url;
            if (url.includes('lh3.googleusercontent.com')) return url;

            const fileIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
            if (fileIdMatch) {
                const fileId = fileIdMatch[1];
                return `https://lh3.googleusercontent.com/d/${fileId}`;
            }

            if (url.startsWith('http')) return url;
            return `${process.env.FRONTEND_URL || 'https://iamcontrol.com.br'}${url}`;
        };

        // Preparar dados do aluno para o termo
        const nomeAluno = aluno.nome || campos_variaveis['Nome Completo do Aluno'] || '';
        const cpfAluno = aluno.cpf || campos_variaveis['CPF/CNPJ do Aluno'] || '';
        const enderecoCompleto = this.formatEndereco(aluno, campos_variaveis);
        const cidade = aluno.cidade || campos_variaveis['Cidade/Estado do Aluno']?.split('/')[0] || '';
        const estado = aluno.estado || campos_variaveis['Cidade/Estado do Aluno']?.split('/')[1] || '';
        const cidadeEstado = `${cidade}/${estado}`;
        const cep = aluno.cep || campos_variaveis['CEP do Aluno'] || '';

        // Data atual
        const dataAtual = new Date().toLocaleDateString('pt-BR');

        // Preparar cláusulas (vindas do banco de dados)
        let clausulas = termo.clausulas || '';

        // Detectar e remover duplicação nas cláusulas se houver
        if (clausulas) {
            // Detectar cláusulas duplicadas procurando por padrões repetidos
            const clausulasMaisculas = clausulas.match(/CLÁUSULA [A-ZÀ-Ú]+ -/g) || [];
            if (clausulasMaisculas.length > clausulasMaisculas.filter((c, i, arr) => arr.indexOf(c) === i).length) {
                // Há cláusulas duplicadas - usar apenas as primeiras ocorrências
                const clausulasUnicas = [];
                const clausulasJaVistas = new Set();
                const partes = clausulas.split(/(CLÁUSULA [A-ZÀ-Ú]+ -)/g);

                for (let i = 0; i < partes.length; i++) {
                    if (partes[i].match(/^CLÁUSULA [A-ZÀ-Ú]+ -/)) {
                        const tituloClausula = partes[i];
                        if (!clausulasJaVistas.has(tituloClausula)) {
                            clausulasJaVistas.add(tituloClausula);
                            clausulasUnicas.push(tituloClausula);
                            if (i + 1 < partes.length) {
                                clausulasUnicas.push(partes[i + 1]);
                            }
                        }
                    }
                }

                clausulas = clausulasUnicas.join('');
            }

            // Fazer replace dos campos variáveis nas cláusulas
            // Substituir campos variáveis padrão
            clausulas = clausulas
                .replace(/\{\{Nome Completo do Aluno\}\}/g, nomeAluno)
                .replace(/\{\{CPF\/CNPJ do Aluno\}\}/g, cpfAluno)
                .replace(/\{\{Endereço do Aluno\}\}/g, enderecoCompleto)
                .replace(/\{\{Cidade\/Estado do Aluno\}\}/g, cidadeEstado)
                .replace(/\{\{CEP do Aluno\}\}/g, cep);

            // Substituir outros campos variáveis que vierem nos campos_variaveis
            if (campos_variaveis) {
                Object.keys(campos_variaveis).forEach((key) => {
                    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                    clausulas = clausulas.replace(regex, campos_variaveis[key] || '');
                });
            }
        }

        const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Termo de Autorização</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: Arial, sans-serif;
            font-size: 11px;
            line-height: 1.5;
            color: #000;
            background-color: white;
        }
        
        .page {
            width: 21cm;
            min-height: 29.7cm;
            padding: 1.5cm 2cm;
            margin: 0 auto;
            position: relative;
            background: white;
        }
        
        .header {
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 20px;
        }
        
        .logo-container {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .title {
            font-size: 14px;
            font-weight: bold;
            text-align: center;
            margin-bottom: 20px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .intro-text {
          font-size: 11px;
          text-align: justify;
          margin-bottom: 20px;
          line-height: 1.6;
        }
        
        .clauses-section {
          margin-top: 20px;
          text-align: justify;
        }
        
        .clauses-section * {
          text-align: justify;
        }
        
        .clause {
          margin-bottom: 15px;
          text-align: justify;
        }
        
        .clause-title {
          font-weight: bold;
          margin-bottom: 8px;
          font-size: 11px;
        }
        
        .clause-text {
          font-size: 11px;
          line-height: 1.6;
          margin-bottom: 10px;
        }
        
        ul {
            margin-left: 20px;
            margin-top: 8px;
        }
        
        li {
            margin-bottom: 5px;
            font-size: 11px;
            line-height: 1.5;
        }
        
        .signature-section {
            margin-top: 30px;
            page-break-inside: avoid;
        }
        
        .signature-line {
            border-bottom: 1px solid #000;
            margin-bottom: 10px;
            width: 60%;
            margin-left: auto;
            margin-right: auto;
        }
        
        .signature-label {
            text-align: center;
            font-size: 10px;
            font-weight: bold;
            margin-top: 5px;
        }
        
        .witnesses-section {
            display: flex;
            justify-content: space-between;
            gap: 40px;
            margin-top: 30px;
        }
        
        .witness {
            flex: 1;
        }
        
        .witness-line {
            border-bottom: 1px solid #000;
            margin-bottom: 10px;
        }
        
        .witness-info {
            font-size: 10px;
            line-height: 1.6;
        }
        
        .footer-location {
            display: flex;
            justify-content: space-between;
            margin-bottom: 30px;
            margin-top: 20px;
            font-size: 11px;
        }
        
        .page-number {
            position: absolute;
            bottom: 10px;
            right: 2cm;
            font-size: 10px;
            color: #666;
        }
        
        @media print {
            body {
                background: white;
            }
            
            .page {
                page-break-after: always;
                page-break-inside: avoid;
            }
            
            .signature-section {
                page-break-inside: avoid;
            }
        }
    </style>
</head>
<body>
    <div class="page">
        <!-- Header -->
        <div class="header">
            <img src="${logoUrl}" alt="Instituto Academy Mind" style="max-width: 180px; max-height: 40px; object-fit: contain;" onerror="this.style.display='none';">
        </div>
        
        <!-- Título -->
        <div class="title">
            ${termo.titulo || 'TERMO DE AUTORIZAÇÃO DE USO DE IMAGEM, VOZ E NOME'}
        </div>
        
        <!-- Cláusulas -->
        <div class="clauses-section">
            ${clausulas}
        </div>
        
        <!-- Seção de Assinatura -->
        <div class="signature-section">
            <div style="text-align: center; margin-bottom: 30px; font-size: 11px;">
                <p><strong>E por estarem justos e acordados, firmam o presente termo em duas vias de igual teor e forma, para que produza seus efeitos legais.</strong></p>
            </div>
            
            <div class="footer-location">
                <div>Local: ${campos_variaveis['Local de Assinatura do Termo'] || termo.local_assinatura || 'Americana/SP'}</div>
                <div>Data: ${dataAtual}</div>
            </div>
            
            ${
                termo.possui_testemunhas
                    ? `
            <!-- Assinatura do Participante/Titular -->
            <div style="text-align: center; margin-bottom: 30px;">
                <div style="height: 60px; display: flex; align-items: center; justify-content: center;">
                    ${termo.assinatura_participante ? `<img src="${convertGoogleDriveUrl(termo.assinatura_participante)}" alt="Assinatura" style="max-height: 60px; object-fit: contain;">` : ''}
                </div>
                <div class="signature-line"></div>
                <div class="signature-label">Assinatura do PARTICIPANTE/Titular dos Dados.</div>
            </div>
            
            <!-- Testemunhas -->
            <div class="witnesses-section">
                <div class="witness">
                    <div style="height: 60px; display: flex; align-items: center; justify-content: center;">
                        ${testemunhas.testemunha_um?.assinatura ? `<img src="${convertGoogleDriveUrl(testemunhas.testemunha_um.assinatura)}" alt="Assinatura Testemunha 1" style="max-height: 60px; object-fit: contain;">` : ''}
                    </div>
                    <div class="witness-line"></div>
                    <div class="witness-info">
                        <div><strong>Testemunha 1</strong></div>
                        <div>Nome: ${testemunhas.testemunha_um?.nome || '_________________'}</div>
                        <div>CPF: ${testemunhas.testemunha_um?.cpf || '_________________'}</div>
                    </div>
                </div>
                
                <div class="witness">
                    <div style="height: 60px; display: flex; align-items: center; justify-content: center;">
                        ${testemunhas.testemunha_dois?.assinatura ? `<img src="${convertGoogleDriveUrl(testemunhas.testemunha_dois.assinatura)}" alt="Assinatura Testemunha 2" style="max-height: 60px; object-fit: contain;">` : ''}
                    </div>
                    <div class="witness-line"></div>
                    <div class="witness-info">
                        <div><strong>Testemunha 2</strong></div>
                        <div>Nome: ${testemunhas.testemunha_dois?.nome || '_________________'}</div>
                        <div>CPF: ${testemunhas.testemunha_dois?.cpf || '_________________'}</div>
                    </div>
                </div>
            </div>
            `
                    : `
            <!-- Assinatura única sem testemunhas -->
            <div style="text-align: center; margin-bottom: 30px;">
                <div style="height: 60px; display: flex; align-items: center; justify-content: center;">
                    ${termo.assinatura_participante ? `<img src="${convertGoogleDriveUrl(termo.assinatura_participante)}" alt="Assinatura" style="max-height: 60px; object-fit: contain;">` : ''}
                </div>
                <div class="signature-line"></div>
                <div class="signature-label">Assinatura</div>
            </div>
            `
            }
        </div>
        
        <!-- Page Number -->
        <div class="page-number">
            1
        </div>
    </div>
</body>
</html>
`;

        return htmlContent;
    }

    /**
     * Formata o endereço completo do aluno
     */
    private formatEndereco(aluno: any, campos_variaveis: any): string {
        const endereco = campos_variaveis['Endereço do Aluno'] || '';

        if (endereco) return endereco;

        // Construir endereço dos dados do aluno
        const partes = [];
        if (aluno.logradouro && aluno.numero) {
            partes.push(`${aluno.logradouro}, nº ${aluno.numero}`);
        } else if (aluno.logradouro) {
            partes.push(aluno.logradouro);
        }
        if (aluno.bairro) {
            partes.push(aluno.bairro);
        }

        return partes.length > 0 ? partes.join(', ') : '';
    }

    /**
     * Gera um PDF do termo com os dados fornecidos
     */
    async generateTermPDF(termoData: any): Promise<Buffer> {
        try {
            // Gerar HTML baseado nos dados do termo
            const html = this.generateTermHTML(termoData);

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
                    top: '15mm',
                    right: '20mm',
                    bottom: '15mm',
                    left: '20mm',
                },
            });

            await browser.close();

            return Buffer.from(pdfBuffer);
        } catch (error) {
            console.error('Erro ao gerar PDF do termo:', error);
            throw new Error('Erro ao gerar PDF do termo');
        }
    }
}
