#!/usr/bin/env node

/**
 * LinkedIn Daemon Production
 * 
 * Garde Chrome + LinkedIn ouvert 24/7
 * Géré par PM2 (pas systemd)
 * 
 * Usage: pm2 start daemon.js --name linkedin-daemon
 */

import { chromium } from 'patchright';
import applyFingerprintEvasion from './src/fingerprint-evasion.js';
import { setupResourceBlocking } from './src/utils/resource-blocker.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class LinkedInDaemon {
  constructor() {
    this.browser = null;
    this.page = null;
    this.cdpEndpoint = null;
    this.lastHealthCheck = Date.now();
  }

  async start() {
    console.log('🚀 LinkedIn Daemon Production - Démarrage...\n');
    
    const profilePath = path.resolve(__dirname, 'linkedin-profile');
    
    try {
      // Launch Chrome avec session persistante
      console.log('🔧 Lancement Chrome (Patchright + session persistante)...');
      // PROXY OBLIGATOIRE (IP résidentielle Pi)
      this.browser = await chromium.launchPersistentContext(profilePath, {
        channel: 'chrome',  // Chrome réel (pas Chromium)
        headless: false,    // LinkedIn détecte headless
        viewport: null,     // Résolution native
        timezoneId: 'Europe/Paris',
        locale: 'fr-FR',
        colorScheme: 'light',
        proxy: {
          server: 'socks5://127.0.0.1:1080'  // Proxy Pi TOUJOURS ACTIF
        },
        args: [
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-blink-features=AutomationControlled',
          '--disable-background-timer-throttling',
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--remote-debugging-port=9222'  // CDP endpoint
        ]
      });
      
      console.log('✅ Chrome lancé');
      
      // CDP endpoint
      this.cdpEndpoint = `http://localhost:9222`;
      console.log(`📡 CDP endpoint: ${this.cdpEndpoint}`);
      
      // Fingerprint evasion
      await applyFingerprintEvasion(this.browser, { spoofPlatform: false });
      console.log('🔒 Fingerprint evasion appliqué');
      
      // Page LinkedIn
      this.page = this.browser.pages()[0] || await this.browser.newPage();
      
      // Blocage ressources (images, fonts, analytics)
      await setupResourceBlocking(this.browser);
      
      // Navigation LinkedIn (1× seulement)
      console.log('\n🔗 Navigation LinkedIn...');
      const navStart = Date.now();
      
      await this.page.goto('https://www.linkedin.com/feed/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      
      const navTime = Date.now() - navStart;
      console.log(`✅ Feed LinkedIn chargé en ${(navTime / 1000).toFixed(1)}s`);
      
      // Attendre stabilisation (LinkedIn peut faire des redirections)
      await this.page.waitForTimeout(5000);
      
      // Vérifier login
      const currentUrl = this.page.url();
      console.log(`📍 URL finale: ${currentUrl}`);
      
      if (currentUrl.includes('authwall') || currentUrl.includes('login') || currentUrl.includes('checkpoint') || currentUrl.includes('uas/')) {
        console.error(`❌ Page de login détectée: ${currentUrl}`);
        console.error(`\n🔑 ACTION REQUISE:`);
        console.error(`   1. Arrêter PM2: pm2 stop linkedin-daemon`);
        console.error(`   2. Login manuel sur LinkedIn`);
        console.error(`   3. Extraire nouveaux cookies`);
        console.error(`   4. Relancer: pm2 start linkedin-daemon\n`);
        
        // NE PAS throw pour éviter restart loop
        // Juste attendre que l'utilisateur relance manuellement
        console.log('⏸️  Daemon en pause (attente login manuel)...');
        
        // Garder Chrome ouvert pour login manuel
        await new Promise(() => {}); // Infinite wait
        return;
      }
      
      console.log('✅ Session LinkedIn active\n');
      console.log('═══════════════════════════════════════════════════');
      console.log('🎯 DAEMON ACTIF');
      console.log('   CDP: http://localhost:9222');
      console.log('   URL: https://www.linkedin.com/feed/');
      console.log('   Status: Ready for sessions');
      console.log('═══════════════════════════════════════════════════\n');
      
      // Health check loop
      this.startHealthCheck();
      
      // Keep alive
      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());
      
    } catch (error) {
      console.error('❌ Erreur démarrage daemon:', error.message);
      console.error(error.stack);
      process.exit(1);
    }
  }

  startHealthCheck() {
    // Health check toutes les 30 minutes
    setInterval(async () => {
      try {
        console.log(`🏥 Health check (${new Date().toISOString()})...`);
        
        // Vérifier page active
        if (!this.page || this.page.isClosed()) {
          console.error('❌ Page fermée - Restart requis');
          process.exit(1);
        }
        
        // Vérifier URL LinkedIn
        const url = this.page.url();
        if (url.includes('authwall') || url.includes('login')) {
          console.error('❌ Session expirée - Restart requis');
          process.exit(1);
        }
        
        // Vérifier mémoire
        const memUsage = process.memoryUsage();
        const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        console.log(`   Mémoire: ${memMB} MB`);
        
        if (memMB > 1500) {
          console.warn('⚠️  Mémoire élevée (>1.5 GB) - Restart recommandé');
          process.exit(0);  // PM2 va restart
        }
        
        this.lastHealthCheck = Date.now();
        console.log('   ✅ Health check OK\n');
        
      } catch (error) {
        console.error('❌ Health check échoué:', error.message);
        process.exit(1);  // PM2 va restart
      }
    }, 30 * 60 * 1000);  // 30 minutes
  }

  async shutdown() {
    console.log('\n🛑 Shutdown daemon...');
    
    if (this.browser) {
      console.log('   Fermeture browser...');
      await this.browser.close().catch(() => {});
    }
    
    console.log('✅ Daemon arrêté');
    process.exit(0);
  }
}

// Démarrage
const daemon = new LinkedInDaemon();
daemon.start().catch(error => {
  console.error('❌ Erreur fatale:', error);
  process.exit(1);
});
