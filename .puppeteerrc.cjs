const { join } = require('path');

/**
 * Cache do Chrome do Puppeteer DENTRO do projeto.
 * Evita o binário sumir do ~/.cache após deploy/npm install
 * (causa clássica de "Could not find Chrome" em produção).
 *
 * @type {import('puppeteer').Configuration}
 */
module.exports = {
    cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
