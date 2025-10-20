import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';

@Injectable()
export class ContractTemplateService {
    private readonly templatePath: string;

    constructor() {
        this.templatePath = path.join(__dirname, 'templates', 'contrato-template.html');
    }

    /**
     * Substitui os placeholders no template HTML com os dados reais
     */
    private replaceTemplatePlaceholders(template: string, data: any): string {
        let html = template;

        // Dados do aluno
        html = html.replace(/\{\{ALUNO_NOME\}\}/g, data.aluno?.nome || '');
        html = html.replace(/\{\{ALUNO_CPF\}\}/g, data.aluno?.cpf || '');
        html = html.replace(/\{\{ALUNO_DATA_NASCIMENTO\}\}/g, data.aluno?.data_nascimento || '');
        html = html.replace(/\{\{ALUNO_WHATSAPP\}\}/g, data.aluno?.telefone_um || '');
        html = html.replace(/\{\{ALUNO_EMAIL\}\}/g, data.aluno?.email || '');
        html = html.replace(/\{\{ALUNO_ENDERECO\}\}/g, data.aluno?.endereco || '');
        html = html.replace(/\{\{ALUNO_CIDADE_ESTADO\}\}/g, data.aluno?.cidade_estado || '');
        html = html.replace(/\{\{ALUNO_CEP\}\}/g, data.aluno?.cep || '');

        // Dados do treinamento
        html = html.replace(/\{\{TREINAMENTO_NOME\}\}/g, data.treinamento?.nome || '');
        html = html.replace(/\{\{TREINAMENTO_CIDADE\}\}/g, data.treinamento?.cidade || '');
        html = html.replace(/\{\{TREINAMENTO_DATA_INICIO\}\}/g, data.treinamento?.data_inicio || '');
        html = html.replace(/\{\{TREINAMENTO_DATA_FIM\}\}/g, data.treinamento?.data_fim || '');
        html = html.replace(/\{\{TREINAMENTO_PRECO\}\}/g, data.treinamento?.preco_formatado || '');

        // Bônus
        html = html.replace(/\{\{BONUS_NAO_APLICA\}\}/g, data.bonus?.nao_aplica ? 'checked' : '');
        html = html.replace(/\{\{BONUS_100_DIAS\}\}/g, data.bonus?.cem_dias ? 'checked' : '');
        html = html.replace(/\{\{BONUS_IPR\}\}/g, data.bonus?.ipr ? 'checked' : '');
        html = html.replace(/\{\{BONUS_IPR_DATA\}\}/g, data.bonus?.ipr_data || '');
        html = html.replace(/\{\{BONUS_OUTROS\}\}/g, data.bonus?.outros ? 'checked' : '');
        html = html.replace(/\{\{BONUS_OUTROS_DESCRICAO\}\}/g, data.bonus?.outros_descricao || '');

        // Formas de pagamento
        html = html.replace(/\{\{PAGAMENTO_CARTAO_CREDITO_AVISTA\}\}/g, data.pagamento?.cartao_credito_avista ? 'checked' : '');
        html = html.replace(/\{\{PAGAMENTO_CARTAO_DEBITO_AVISTA\}\}/g, data.pagamento?.cartao_debito_avista ? 'checked' : '');
        html = html.replace(/\{\{PAGAMENTO_PIX_AVISTA\}\}/g, data.pagamento?.pix_avista ? 'checked' : '');
        html = html.replace(/\{\{PAGAMENTO_ESPECIE_AVISTA\}\}/g, data.pagamento?.especie_avista ? 'checked' : '');
        html = html.replace(/\{\{PAGAMENTO_CARTAO_CREDITO_PARCELADO\}\}/g, data.pagamento?.cartao_credito_parcelado ? 'checked' : '');
        html = html.replace(/\{\{PAGAMENTO_BOLETO_PARCELADO\}\}/g, data.pagamento?.boleto_parcelado ? 'checked' : '');

        // Observações
        html = html.replace(/\{\{OBSERVACOES\}\}/g, data.observacoes || '');

        // Dados do contrato
        html = html.replace(/\{\{CONTRATO_LOCAL\}\}/g, data.contrato?.local || '');
        html = html.replace(/\{\{CONTRATO_DATA\}\}/g, data.contrato?.data || '');

        // Valores e formas de pagamento
        html = html.replace(/\{\{VALOR_REAL_PAGO\}\}/g, data.valor_real_pago || 'R$ 0,00');
        html = html.replace(/\{\{FORMA_PAGAMENTO_SELECIONADA\}\}/g, data.forma_pagamento_selecionada || 'Não informado');
        html = html.replace(/\{\{DETALHES_FORMAS_PAGAMENTO\}\}/g, data.detalhes_formas_pagamento || '• Não informado');

        // Testemunhas
        html = html.replace(/\{\{TESTEMUNHA_1_NOME\}\}/g, data.testemunhas?.testemunha_1?.nome || '');
        html = html.replace(/\{\{TESTEMUNHA_1_CPF\}\}/g, data.testemunhas?.testemunha_1?.cpf || '');
        html = html.replace(/\{\{TESTEMUNHA_2_NOME\}\}/g, data.testemunhas?.testemunha_2?.nome || '');
        html = html.replace(/\{\{TESTEMUNHA_2_CPF\}\}/g, data.testemunhas?.testemunha_2?.cpf || '');

        return html;
    }

    /**
     * Gera um PDF a partir do template HTML com os dados fornecidos
     */
    async generateContractPDF(data: any): Promise<Buffer> {
        try {
            // Ler o template HTML
            const template = fs.readFileSync(this.templatePath, 'utf8');

            // Substituir os placeholders
            const html = this.replaceTemplatePlaceholders(template, data);

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
