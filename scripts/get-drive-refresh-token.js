/**
 * Script de uso ÚNICO para obter o refresh token do Google Drive (conta pessoal).
 * Use quando a conta de serviço retornar 403 "Service Accounts do not have storage quota".
 *
 * Como usar:
 * 1. No .env tenha: GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (credenciais OAuth do Console Google Cloud).
 * 2. No Console Google Cloud (APIs e Serviços > Credenciais), em "URIs de redirecionamento autorizados"
 *    do seu cliente OAuth 2.0, adicione: http://localhost:3333/oauth2callback
 * 3. Rode: node scripts/get-drive-refresh-token.js
 * 4. Abra a URL que aparecer no navegador, faça login com a CONTA DO GOOGLE que possui a pasta Alunos no Drive.
 * 5. Autorize o app; a página vai redirecionar e o refresh_token será exibido.
 * 6. Copie o valor e adicione no .env: GOOGLE_DRIVE_REFRESH_TOKEN="..."
 * 7. Reinicie o backend. O upload passará a usar a cota da sua conta.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const http = require('http');
const { google } = require('googleapis');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3333/oauth2callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env');
    process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'];

const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
});

const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith('/oauth2callback')) {
        const url = new URL(req.url, 'http://localhost:3333');
        const code = url.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (code) {
            try {
                const { credentials } = await oauth2Client.getToken(code);
                res.end(`
                    <h1>Sucesso</h1>
                    <p>Adicione no .env:</p>
                    <pre style="background:#eee;padding:12px;overflow:auto;">GOOGLE_DRIVE_REFRESH_TOKEN="${credentials.refresh_token || ''}"</pre>
                    <p>Depois reinicie o backend.</p>
                `);
                console.log('\n✅ Refresh token obtido. Adicione no .env:\n');
                console.log('GOOGLE_DRIVE_REFRESH_TOKEN="' + (credentials.refresh_token || '') + '"\n');
            } catch (e) {
                res.end('<h1>Erro</h1><pre>' + (e.message || e) + '</pre>');
            }
        } else {
            res.end('<h1>Nenhum código recebido</h1>');
        }
        server.close();
        return;
    }
    res.writeHead(404);
    res.end();
});

server.listen(3333, () => {
    console.log('Abra esta URL no navegador (faça login com a conta que possui a pasta do Drive):\n');
    console.log(authUrl);
    console.log('\nAguardando você abrir a URL e autorizar no navegador...');
});
