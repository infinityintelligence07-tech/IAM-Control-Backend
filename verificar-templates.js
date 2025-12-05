/**
 * Script para verificar templates disponíveis na Gupshup
 * Execute: node verificar-templates.js
 */

const https = require('https');

// Credenciais da Gupshup (pegue do seu .env)
const GUPSHUP_API_KEY = process.env.GUPSHUP_API_KEY;
const GUPSHUP_APP_ID = process.env.GUPSHUP_APP_ID || 'cba2a686-86a0-47ef-8373-6f38a955a10d';

if (!GUPSHUP_API_KEY) {
    console.error('❌ ERRO: GUPSHUP_API_KEY não está definida!');
    console.log('Execute assim: GUPSHUP_API_KEY=sua_api_key node verificar-templates.js');
    process.exit(1);
}

console.log('\n' + '='.repeat(80));
console.log('🔍 VERIFICANDO TEMPLATES DISPONÍVEIS NA GUPSHUP');
console.log('='.repeat(80));
console.log(`📱 App ID: ${GUPSHUP_APP_ID}`);
console.log(`🔑 API Key: ${GUPSHUP_API_KEY.substring(0, 15)}...`);
console.log('='.repeat(80) + '\n');

const options = {
    hostname: 'api.gupshup.io',
    port: 443,
    path: `/wa/app/${GUPSHUP_APP_ID}/template`,
    method: 'GET',
    headers: {
        'apikey': GUPSHUP_API_KEY,
        'Content-Type': 'application/json'
    }
};

const req = https.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        try {
            const response = JSON.parse(data);
            
            if (response.templates && Array.isArray(response.templates)) {
                console.log(`✅ Encontrados ${response.templates.length} templates:\n`);
                
                response.templates.forEach((template, index) => {
                    const status = template.status || 'N/A';
                    const statusEmoji = status === 'APPROVED' ? '✅' : status === 'PENDING' ? '⏳' : '❌';
                    
                    console.log(`${index + 1}. ${statusEmoji} ${template.elementName || template.name}`);
                    console.log(`   📋 ID: ${template.id || 'N/A'}`);
                    console.log(`   📊 Status: ${status}`);
                    console.log(`   🏷️ Categoria: ${template.category || 'N/A'}`);
                    console.log(`   🌐 Idioma: ${template.languageCode || 'N/A'}`);
                    
                    // Mostrar variáveis do template
                    if (template.data) {
                        console.log(`   📝 Conteúdo: ${template.data.substring(0, 100)}...`);
                    }
                    console.log('');
                });
                
                // Verificar se o template atual existe
                const templateAtual = 'template_iamcontrol_checkin_aluno';
                const encontrado = response.templates.find(t => 
                    t.elementName === templateAtual || t.name === templateAtual
                );
                
                console.log('='.repeat(80));
                if (encontrado) {
                    console.log(`✅ Template "${templateAtual}" ENCONTRADO!`);
                    console.log(`   Status: ${encontrado.status}`);
                    if (encontrado.status !== 'APPROVED') {
                        console.log(`   ⚠️ ATENÇÃO: O template NÃO está aprovado!`);
                    }
                } else {
                    console.log(`❌ Template "${templateAtual}" NÃO ENCONTRADO!`);
                    console.log(`\n🔧 SOLUÇÃO:`);
                    console.log(`   1. Use um dos templates aprovados listados acima`);
                    console.log(`   2. Configure no .env: GUPSHUP_TEMPLATE_NAME=nome_do_template_aprovado`);
                    console.log(`   3. Reinicie a API`);
                }
                console.log('='.repeat(80) + '\n');
                
            } else if (response.status === 'error') {
                console.log('❌ Erro ao buscar templates:', response.message || JSON.stringify(response));
            } else {
                console.log('📄 Resposta da API:', JSON.stringify(response, null, 2));
            }
        } catch (e) {
            console.log('❌ Erro ao processar resposta:', e.message);
            console.log('📄 Resposta bruta:', data);
        }
    });
});

req.on('error', (e) => {
    console.error('❌ Erro na requisição:', e.message);
});

req.end();
