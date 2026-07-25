const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const cache = path.join(process.cwd(), '.cache', 'puppeteer');

function findChrome(root, name, bins) {
  const base = path.join(root, name);
  if (!fs.existsSync(base)) return null;
  const versions = fs.readdirSync(base).sort().reverse();
  for (const v of versions) {
    for (const b of bins) {
      const p = path.join(base, v, b);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

(async () => {
  const exe =
    findChrome(cache, 'chrome', ['chrome-linux64/chrome', 'chrome-linux/chrome']) ||
    findChrome(cache, 'chrome-headless-shell', [
      'chrome-headless-shell-linux64/chrome-headless-shell',
      'chrome-headless-shell-linux/chrome-headless-shell',
    ]);
  console.log('[PDF_SMOKE] executable=', exe || '(default)');
  const browser = await puppeteer.launch({
    headless: true,
    pipe: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
    ],
    ...(exe ? { executablePath: exe } : {}),
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<h1>ok</h1>', { waitUntil: 'domcontentloaded' });
    const pdf = await page.pdf({ format: 'A4' });
    console.log('[PDF_SMOKE] OK bytes=', pdf.length);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error('[PDF_SMOKE] FAIL:', err && err.message ? err.message : err);
  process.exit(1);
});
