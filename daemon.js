#!/usr/bin/env node

/**
 * LinkedIn Daemon Production (CJS)
 * 
 * Garde Chrome + LinkedIn ouvert 24/7
 * Géré par PM2 (pas systemd)
 * 
 * Usage: pm2 start daemon.js --name linkedin-daemon
 */

const { chromium } = require('patchright');
const path = require('path');
const fs = require('fs');

// Load .env
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// Supabase bridge (optionnel — si USER_ID configuré)
let supabaseClient = null;
try {
  if (process.env.SUPABASE_URL && process.env.USER_ID) {
    supabaseClient = require('./src/supabase-client');
    console.log('✅ Supabase bridge chargé');
  }
} catch (e) {
  console.log('⚠️  Supabase bridge non disponible:', e.message);
}

class LinkedInDaemon {
  constructor() {
    this.browser = null;
    this.page = null;
    this.cdpEndpoint = null;
    this.lastHealthCheck = Date.now();
  }

  async start() {
    console.log('🚀 LinkedIn Daemon Production - Démarrage...\n');
    
    const profilePath = path.resolve(__dirname, 'linkedin-profile-mathieu');
    console.log(`📁 Profil: ${profilePath}`);
    
    try {
      console.log('🔧 Lancement Chrome (Patchright + session persistante)...');
      
      this.browser = await chromium.launchPersistentContext(profilePath, {
        headless: true,
        viewport: { width: 1920, height: 1080 },
        timezoneId: 'Europe/Paris',
        locale: 'fr-FR',
        colorScheme: 'light',
        proxy: {
          server: 'socks5://127.0.0.1:1080'
        },
        args: [
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-blink-features=AutomationControlled',
          '--disable-background-timer-throttling',
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--remote-debugging-port=9222',
          '--lang=fr-FR',
          '--window-size=1920,1080',
        ]
      });
      
      console.log('✅ Chrome lancé');
      this.cdpEndpoint = `http://localhost:9222`;
      console.log(`📡 CDP endpoint: ${this.cdpEndpoint}`);
      
      // Page LinkedIn
      this.page = this.browser.pages()[0] || await this.browser.newPage();
      
      // Inject cookies avant navigation
      console.log('🍪 Injection cookies LinkedIn...');
      await this.browser.addCookies([
        {
          name: 'li_at',
          value: process.env.LI_AT || '',
          domain: '.linkedin.com',
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'None',
        },
        {
          name: 'JSESSIONID',
          value: `"${process.env.JSESSIONID || ''}"`,
          domain: '.linkedin.com',
          path: '/',
          httpOnly: false,
          secure: true,
          sameSite: 'None',
        }
      ]);
      
      // Navigation LinkedIn
      console.log('\n🔗 Navigation LinkedIn...');
      const navStart = Date.now();
      
      await this.page.goto('https://www.linkedin.com/feed/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      }).catch(e => console.log('⚠️  Nav warning:', e.message.split('\n')[0]));
      
      const navTime = Date.now() - navStart;
      console.log(`⏱️  Navigation: ${(navTime / 1000).toFixed(1)}s`);
      
      await new Promise(r => setTimeout(r, 5000));
      
      const currentUrl = this.page.url();
      console.log(`📍 URL finale: ${currentUrl}`);
      
      if (currentUrl.includes('authwall') || currentUrl.includes('login') || currentUrl.includes('checkpoint') || currentUrl.includes('uas/') || currentUrl.includes('chromewebdata')) {
        console.log(`⚠️  Session expirée (${currentUrl}) — tentative login email/password...`);
        const loginOk = await this.loginWithCredentials();
        if (!loginOk) {
          console.error('❌ Login échoué — daemon en pause (pas de restart loop)');
          await new Promise(() => {});
          return;
        }
      }
      
      console.log('✅ Session LinkedIn active\n');
      console.log('═══════════════════════════════════════════════════');
      console.log('🎯 DAEMON ACTIF');
      console.log('   CDP: http://localhost:9222');
      console.log('   URL: https://www.linkedin.com/feed/');
      console.log('   Status: Ready for sessions');
      console.log('═══════════════════════════════════════════════════\n');

      // Supabase — marquer session active
      if (supabaseClient) {
        await supabaseClient.updateSession({ status: 'active', last_action_at: new Date().toISOString() }).catch(() => {});
        const { startRealtimeBridge } = require('./src/core/realtime-bridge');
        startRealtimeBridge({
          onToggle: (automation) => {
            console.log(`📡 Toggle: ${automation.type} → ${automation.active ? 'ON' : 'OFF'}`);
          },
          onJob: async (job) => {
            console.log(`📡 New job: ${job.type}`);
          }
        });
        console.log('📡 Realtime bridge démarré\n');
      }

      this.startHealthCheck();
      
      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());
      
    } catch (error) {
      console.error('❌ Erreur démarrage daemon:', error.message);
      // Exit 0 pour éviter restart loop infini (PM2 restart si exit non-zero)
      process.exit(0);
    }
  }

  async loginWithCredentials() {
    try {
      const email = process.env.LINKEDIN_EMAIL;
      const password = process.env.LINKEDIN_PASSWORD;
      if (!email || !password) {
        console.error('❌ LINKEDIN_EMAIL ou LINKEDIN_PASSWORD manquant dans .env');
        return false;
      }

      console.log('🔑 Navigation vers /login...');
      await this.page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      // Détecte le formulaire (reconnect-rapide ou full login)
      const emailField = await this.page.$('#username') || await this.page.$('input[name="session_key"]') || await this.page.$('input[type="email"]');
      if (emailField) {
        await emailField.fill(email);
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      }

      const passField = await this.page.$('#password') || await this.page.$('input[name="session_password"]') || await this.page.$('input[type="password"]');
      if (!passField) {
        console.error('❌ Champ mot de passe introuvable');
        return false;
      }
      await passField.fill(password);
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      await passField.press('Enter');
      await new Promise(r => setTimeout(r, 5000));

      const url = this.page.url();
      console.log(`📍 URL après login: ${url}`);

      if (url.includes('feed') || url.includes('mynetwork') || url.includes('in/')) {
        console.log('✅ Login réussi !');
        return true;
      }
      if (url.includes('checkpoint')) {
        console.error('⚠️  Checkpoint LinkedIn — vérification manuelle requise');
        return false;
      }
      console.error(`❌ URL inattendue après login: ${url}`);
      return false;
    } catch (e) {
      console.error('❌ Erreur login:', e.message);
      return false;
    }
  }

  getChromeRAMmb() {
    try {
      const { execSync } = require('child_process');
      const out = execSync("ps aux | grep -E 'chrom(e|ium)' | grep -v grep | awk '{sum += $6} END {print sum}'").toString().trim();
      return Math.round(parseInt(out || '0') / 1024);
    } catch { return 0; }
  }

  startHealthCheck() {
    setInterval(async () => {
      try {
        console.log(`🏥 Health check (${new Date().toISOString()})...`);
        
        if (!this.page || this.page.isClosed()) {
          console.error('❌ Page fermée - Restart requis');
          process.exit(1);
        }
        
        const url = this.page.url();

        // Session expirée → tenter le login avant de paniquer
        if (url.includes('authwall') || url.includes('login') || url.includes('checkpoint')) {
          console.log('⚠️  Session expirée détectée — tentative re-login...');
          const ok = await this.loginWithCredentials();
          if (!ok) {
            console.error('❌ Re-login échoué — pause daemon');
            await new Promise(() => {});
          }
          return;
        }
        
        // RAM Chrome (pas Node) — si > 3.5 GB on redémarre proprement
        const chromeMB = this.getChromeRAMmb();
        console.log(`   RAM Chrome: ${chromeMB} MB | URL: ${url.substring(0, 60)}`);
        
        if (chromeMB > 3500) {
          console.warn(`⚠️  RAM Chrome élevée (${chromeMB} MB > 3.5 GB) — restart propre avec re-login`);
          // Exit 1 → PM2 redémarre → start() est appelé → loginWithCredentials()
          process.exit(1);
        }
        
        this.lastHealthCheck = Date.now();
        console.log('   ✅ Health check OK\n');
        
      } catch (error) {
        console.error('❌ Health check échoué:', error.message);
        process.exit(1);
      }
    }, 30 * 60 * 1000); // 30 min
  }

  async shutdown() {
    console.log('\n🛑 Shutdown daemon...');
    if (this.browser) await this.browser.close().catch(() => {});
    console.log('✅ Daemon arrêté');
    process.exit(0);
  }
}

const daemon = new LinkedInDaemon();
daemon.start().catch(error => {
  console.error('❌ Erreur fatale:', error);
  process.exit(0); // exit 0 = pas de restart loop PM2
});
