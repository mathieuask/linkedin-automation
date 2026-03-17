/**
 * Browser Core — Connexion CDP au Chrome daemon
 * Méthode validée le 13/03/2026
 */
const { chromium } = require('patchright');

const CDP_ENDPOINT = process.env.CDP_ENDPOINT || 'http://localhost:9222';

let _browser = null;
let _page = null;

/**
 * Connecte au Chrome daemon via CDP et retourne la page active
 */
async function getPage() {
  if (_page && !_page.isClosed()) return _page;
  
  _browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const contexts = _browser.contexts();
  if (contexts.length === 0) throw new Error('No browser context found');
  
  const pages = contexts[0].pages();
  if (pages.length === 0) throw new Error('No page found');
  
  _page = pages[0];
  return _page;
}

/**
 * Login natif si nécessaire (email/password sur /login)
 */
async function ensureLoggedIn(page) {
  const url = page.url();
  
  // Vérifier si on est déjà loggé
  const isLogged = await page.evaluate(() => {
    return document.cookie.includes('li_at');
  });
  
  if (isLogged && url.includes('linkedin.com/feed')) return true;
  
  // Naviguer vers le feed pour tester
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);
  
  // Si redirigé vers login
  if (page.url().includes('/login') || page.url().includes('/signup') || page.url().includes('/authwall')) {
    console.log('🔐 Login nécessaire...');
    
    const email = process.env.LINKEDIN_EMAIL;
    const password = process.env.LINKEDIN_PASSWORD;
    if (!email || !password) throw new Error('LINKEDIN_EMAIL et LINKEDIN_PASSWORD requis dans .env');
    
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);
    
    // Remplir email
    await page.locator('#username').fill(email);
    await page.waitForTimeout(500);
    
    // Remplir password
    await page.locator('#password').fill(password);
    await page.waitForTimeout(500);
    
    // Cliquer Sign in
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(8000);
    
    if (page.url().includes('/feed')) {
      console.log('✅ Login réussi');
      return true;
    } else {
      throw new Error('Login échoué — URL: ' + page.url());
    }
  }
  
  return true;
}

/**
 * Obtient le CSRF token depuis les cookies
 */
async function getCsrfToken(page) {
  return page.evaluate(() => {
    const match = document.cookie.match(/JSESSIONID="?([^;"]*)"?/);
    return match ? match[1] : '';
  });
}

/**
 * Headers standard pour les requêtes API Voyager
 */
async function getApiHeaders(page) {
  const csrf = await getCsrfToken(page);
  return {
    'csrf-token': csrf,
    'x-restli-protocol-version': '2.0.0',
    'x-li-lang': 'fr_FR',
  };
}

/**
 * Délai humain aléatoire (distribution gaussienne)
 */
function humanDelay(minMs = 1000, maxMs = 3000) {
  const mean = (minMs + maxMs) / 2;
  const stddev = (maxMs - minMs) / 4;
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const delay = Math.max(minMs, Math.min(maxMs, mean + z * stddev));
  return Math.round(delay);
}

/**
 * Clic humain : hover + pause + click
 */
async function humanClick(page, element) {
  const box = await element.boundingBox();
  if (!box) throw new Error('Element not visible');
  
  const x = box.x + box.width / 2 + (Math.random() - 0.5) * 4;
  const y = box.y + box.height / 2 + (Math.random() - 0.5) * 4;
  
  await page.mouse.move(x, y, { steps: 8 + Math.floor(Math.random() * 8) });
  await page.waitForTimeout(humanDelay(300, 700));
  await page.mouse.click(x, y);
}

/**
 * Navigate to company admin dashboard
 * All actions (posts, likes, comments) from this page
 * are done ON BEHALF OF the company page, not the personal account
 */
const COMPANY_ID = process.env.LINKEDIN_COMPANY_ID || 'YOUR_COMPANY_ID';
const COMPANY_ADMIN_URL = `https://www.linkedin.com/company/${COMPANY_ID}/admin/dashboard/`;

async function switchToCompanyPage(page) {
  await page.goto(COMPANY_ADMIN_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);

  const url = page.url();
  if (!url.includes('/admin/')) {
    throw new Error('Unable to access company dashboard — URL: ' + url);
  }

  console.log('🏢 Switched to company page');
  return true;
}

/**
 * Ferme proprement la connexion
 */
async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
    _page = null;
  }
}

module.exports = {
  getPage,
  ensureLoggedIn,
  switchToCompanyPage,
  getCsrfToken,
  getApiHeaders,
  humanDelay,
  humanClick,
  closeBrowser,
  COMPANY_ID,
  COMPANY_ADMIN_URL,
};
