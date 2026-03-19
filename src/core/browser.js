/**
 * Browser Core — launchPersistentContext (Patchright + proxy Pi)
 * Méthode validée le 18/03/2026
 * RÈGLE : jamais de curl/axios/fetch direct vers LinkedIn — uniquement via ce browser
 */
require('dotenv').config();
const { chromium } = require('patchright');
const path = require('path');

const USER_DATA_DIR = process.env.CHROME_PROFILE_DIR
  || path.resolve(__dirname, '../../linkedin-profile-mathieu');

let _browser = null;
let _page = null;

/**
 * Connecte au Chrome daemon via CDP et retourne la page active
 */
async function getPage() {
  if (_page && !_page.isClosed()) return _page;
  // Utilise le Chrome daemon persistant (même instance que session-runner)
  const { getLinkedInPage } = require('./chrome-daemon.js');
  const conn = await getLinkedInPage();
  _browser = conn.browser;
  _page = conn.page;
  return _page;
}

/**
 * Login natif si nécessaire (email/password sur /login)
 */
async function ensureLoggedIn(page) {
  // Tester si on est sur le feed (session active via cookies du profil)
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1000));

  const urlAfterNav = page.url();

  // Déjà connecté → LinkedIn redirige vers /feed
  if (urlAfterNav.includes('/feed')) {
    console.log('✅ Session active via cookies du profil');
    return true;
  }

  // Login nécessaire via email/mot de passe
  console.log('🔐 Login via email/mot de passe...');
  const email = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;
  if (!email || !password) throw new Error('LINKEDIN_EMAIL et LINKEDIN_PASSWORD requis dans .env');

  await new Promise(r => setTimeout(r, 800 + Math.random() * 600));

  // Formulaire reconnexion rapide (juste password) ou formulaire complet
  const hasUsername = await page.locator('#username').isVisible({ timeout: 3000 }).catch(() => false);
  if (hasUsername) {
    await page.fill('#username', email);
    await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
  }

  await page.waitForSelector('#password', { timeout: 10000 });
  await page.fill('#password', password);
  await new Promise(r => setTimeout(r, 600 + Math.random() * 500));
  await page.click('button[type="submit"]');

  try {
    await page.waitForURL('**/feed/**', { timeout: 30000 });
    console.log('✅ Connecté — feed chargé');
    return true;
  } catch {
    const path = require('path');
    const screenshotPath = path.resolve(__dirname, '../../logs/login-debug.png');
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    throw new Error(`Login échoué — URL: ${page.url()}. Voir logs/login-debug.png`);
  }
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

// Alias pour compatibilité (launchPersistentContext retourne un BrowserContext)
async function closeContext() { return closeBrowser(); }

module.exports = {
  getPage,
  ensureLoggedIn,
  switchToCompanyPage,
  getCsrfToken,
  getApiHeaders,
  humanDelay,
  humanClick,
  closeBrowser,
  closeContext,
  COMPANY_ID,
  COMPANY_ADMIN_URL,
};
