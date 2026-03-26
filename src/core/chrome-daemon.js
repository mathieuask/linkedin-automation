/**
 * Chrome Daemon — Gère le cycle de vie de Chrome persistant
 * 
 * Chrome tourne en permanence avec le profil LinkedIn.
 * Les sessions se connectent via CDP sans tuer/relancer Chrome.
 * Login fait UNE FOIS au démarrage, puis cookies actifs toute la journée.
 */

require('dotenv').config();
const { chromium } = require('patchright');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const USER_DATA_DIR = process.env.CHROME_PROFILE_DIR
  || path.resolve(__dirname, '../../linkedin-profile-mathieu');

const CDP_ENDPOINT = process.env.CDP_ENDPOINT || 'http://localhost:9222';
const CHROME_LOG = path.resolve(__dirname, '../../logs/chrome-daemon.log');

/**
 * Vérifie si Chrome tourne déjà sur le port CDP
 */
async function isChromeRunning() {
  try {
    const { execSync } = require('child_process');
    execSync(`curl -s --max-time 2 ${CDP_ENDPOINT}/json/version > /dev/null 2>&1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Démarre Chrome en arrière-plan (sans Playwright)
 */
async function startChrome() {
  const chromeBin = execSync(
    `find /root/.cache/ms-playwright -name 'chrome' -type f 2>/dev/null | head -1`
  ).toString().trim();

  if (!chromeBin) throw new Error('Chrome binary introuvable');

  console.log(`🚀 Démarrage Chrome: ${chromeBin}`);

  const args = [
    `--remote-debugging-port=9222`,
    `--user-data-dir=${USER_DATA_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-gpu',
    '--headless=new',
    '--lang=fr-FR',
    '--window-size=1920,1080',
    `--proxy-server=socks5://127.0.0.1:1080`,
    '--noerrdialogs',
  ];

  const logStream = fs.openSync(CHROME_LOG, 'a');
  const child = spawn(chromeBin, args, {
    detached: true,
    stdio: ['ignore', logStream, logStream],
  });
  child.unref();

  console.log(`✅ Chrome lancé (PID ${child.pid})`);

  // Attendre que CDP soit dispo
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isChromeRunning()) {
      console.log('✅ CDP disponible');
      return true;
    }
  }
  throw new Error('Chrome démarré mais CDP non disponible après 10s');
}

/**
 * Connecte via CDP et retourne une page prête sur le feed LinkedIn
 * Crée toujours une nouvelle page (n'interfère pas avec les onglets existants)
 */
async function getLinkedInPage() {
  // Démarrer Chrome si nécessaire
  if (!(await isChromeRunning())) {
    console.log('⚠️  Chrome non détecté, démarrage...');
    await startChrome();
  }

  const browser = await chromium.connectOverCDP(CDP_ENDPOINT);

  // Trouver le contexte principal
  const contexts = browser.contexts();
  if (contexts.length === 0) throw new Error('Aucun contexte browser');
  const ctx = contexts[0];

  // Créer une nouvelle page (hérite des cookies du profil)
  const page = await ctx.newPage();

  // Mock visibilityState → LinkedIn ne rend les posts qu'en page "visible"
  await page.addInitScript(() => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hasFocus', { value: () => true, configurable: true });
  });

  // Naviguer vers le feed (cookies actifs → pas de login nécessaire)
  console.log('🔗 Navigation vers le feed...');
  await page.goto('https://www.linkedin.com/feed/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await new Promise(r => setTimeout(r, 1500));
  const url = page.url();
  console.log(`📍 URL: ${url}`);

  // Si redirigé vers login → faire le login
  if (url.includes('/login') || url.includes('/authwall') || url.includes('/signup')) {
    console.log('🔐 Session expirée — login nécessaire...');
    await doLogin(page);
  } else if (!url.includes('linkedin.com/feed')) {
    throw new Error(`Page inattendue: ${url}`);
  }

  console.log('✅ Page feed prête');
  return { browser, page };
}

/**
 * Login via email/mot de passe
 */
async function doLogin(page) {
  const email = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;
  if (!email || !password) throw new Error('LINKEDIN_EMAIL / LINKEDIN_PASSWORD manquants dans .env');

  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1000));

  // Déjà connecté ?
  if (page.url().includes('/feed')) {
    console.log('✅ Déjà connecté');
    return;
  }

  await new Promise(r => setTimeout(r, 800 + Math.random() * 600));

  // Formulaire complet ou reconnexion rapide
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
    console.log('✅ Login réussi');
  } catch {
    const screenshotPath = path.resolve(__dirname, '../../logs/login-debug.png');
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    throw new Error(`Login échoué — URL: ${page.url()}. Voir logs/login-debug.png`);
  }
}

/**
 * Ferme une page sans tuer Chrome
 */
async function closePage(page) {
  try { await page.close(); } catch {}
}

module.exports = { getLinkedInPage, closePage, startChrome, isChromeRunning, doLogin };
