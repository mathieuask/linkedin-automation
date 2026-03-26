#!/usr/bin/env node

/**
 * Session Runner V5 - UNIFIED (Fixes Race Condition)
 * 
 * KEY FIX: Atomic "Extract → Scroll-to → Click → Verify" pattern.
 * Button coordinates are obtained and clicked in rapid sequence,
 * with DOM .click() fallback if humanMouse click doesn't confirm.
 * No more storing DOM handles across async boundaries.
 * 
 * Replaces: session-runner.js, session-runner-v2.js, v3, v4
 * 
 * Usage: 
 *   node session-runner.js              # Default: 2 likes, 8 cycles
 *   node session-runner.js --target 3   # Custom target
 *   node session-runner.js --verbose    # Show post details
 */

// chromium géré via chrome-daemon.js
const { HumanMouseV3 } = require('../utils/human-mouse.js');
const { analyzePost, getAnalysisStats } = require('../utils/post-analyzer.js');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log, readState, updateState, purgeOldLogs } = require('./logger.js');
const { analyzeSession } = require('./health-monitor.js');

require('dotenv').config();


// ─── Helpers ───────────────────────────────────────────────────

function getChromeMemoryMB() {
  try {
    const output = execSync(
      "ps aux | grep -E 'chrom(e|ium)' | grep -v grep | awk '{sum += $6} END {print sum}'"
    ).toString().trim();
    return Math.round(parseInt(output || '0') / 1024);
  } catch {
    return 0;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const idx = (flag) => args.indexOf(flag);
  // Le premier argument positionnel = numéro de session (ex: node session-runner.js 1)
  const sessionNum = parseInt(args.find(a => /^\d+$/.test(a))) || 1;
  return {
    target: idx('--target') >= 0 ? parseInt(args[idx('--target') + 1]) || 2 : 2,
    maxCycles: idx('--cycles') >= 0 ? parseInt(args[idx('--cycles') + 1]) || 25 : 25,
    verbose: args.includes('--verbose'),
    sessionNum,
  };
}

// ─── Safe Evaluate (retry on context destroyed) ────────────────

async function safeEvaluate(page, fn, ...args) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await page.evaluate(fn, ...args);
    } catch (error) {
      if (error.message.includes('context') && error.message.includes('destroyed')) {
        console.log(`   ⚠️  Context destroyed (attempt ${attempt}/5), retry...`);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await new Promise(r => setTimeout(r, 300 * attempt));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Context destroyed après 5 tentatives');
}

// ─── CSS Injection ─────────────────────────────────────────────

async function injectTextRevealCSS(page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.addStyleTag({
        content: `
          div.feed-shared-inline-show-more-text {
            max-height: none !important;
            overflow: visible !important;
          }
          button.see-more { display: none !important; }
        `
      });
      console.log('✅ CSS injecté (texte complet révélé)');
      return;
    } catch (error) {
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
        continue;
      }
      console.log('⚠️  CSS injection échouée (non-bloquant)');
    }
  }
}

// ─── Wait for Feed Ready ───────────────────────────────────────

async function waitForFeedReady(page, maxWait = 60000) {
  const start = Date.now();
  console.log('⏳ Attente feed LinkedIn...');

  // 1. Attendre que la page soit vraiment chargée (réseau calme)
  await page.waitForLoadState('networkidle').catch(() => {});
  await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));

  let attempt = 0;
  while (Date.now() - start < maxWait) {
    attempt++;

    // Sélecteurs stables : boutons réaction directs (LinkedIn 2025-2026)
    const postCount = await page.evaluate(() => {
      const likeButtons = Array.from(document.querySelectorAll(
        'button[aria-label*="État du bouton de réaction"], button[aria-label*="Réagir avec"], button[aria-label*="React with Like"]'
      )).filter(b => (b.getAttribute('aria-label') || '').includes('aucune') || (b.getAttribute('aria-label') || '').includes('Réagir')).length;
      const hasContent = document.body.scrollHeight > 1500;
      return likeButtons > 0 ? likeButtons : (hasContent ? 1 : 0);
    }).catch(() => 0);

    if (postCount >= 1) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`✅ Feed prêt (${postCount} boutons like en ${elapsed}s)`);
      log.feed({ action: 'feed_ready', buttons_found: postCount, elapsed_s: elapsed });
      return true;
    }

    // Scroll progressif façon humain pour déclencher le lazy loading
    const scrollAmount = 80 + Math.floor(Math.random() * 120);
    await page.evaluate((px) => window.scrollBy({ top: px, behavior: 'smooth' }), scrollAmount).catch(() => {});
    await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));

    // Toutes les 10s si toujours vide : recharge la page
    if (attempt % 10 === 0 && postCount === 0) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`🔄 Feed toujours vide (${elapsed}s) — rechargement... [URL: ${page.url()}]`);
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await new Promise(r => setTimeout(r, 4000 + Math.random() * 2000));
    }
  }

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`⚠️  Feed toujours vide après ${elapsed}s — URL finale: ${page.url()}`);
  return false;
}

// ─── ATOMIC Post Extraction ────────────────────────────────────

async function extractPostsWithButtons(page) {
  return await safeEvaluate(page, () => {
    // Bouton like direct : "État du bouton de réaction" (LinkedIn 2025-2026)
    const likeButtons = Array.from(document.querySelectorAll(
      'button[aria-label*="État du bouton de réaction"], button[aria-label*="Réagir avec"], button[aria-label*="React with Like"]'
    )).filter(b => (b.getAttribute('aria-label') || '').includes('aucune réaction') || (b.getAttribute('aria-label') || '').includes('Réagir'));

    return likeButtons.map((btn, index) => {
      // Remonter pour trouver le container du post (cherche un ancêtre avec du contenu significatif)
      let container = btn.parentElement;
      for (let i = 0; i < 15; i++) {
        if (!container) break;
        if (container.offsetHeight > 150 && container.querySelectorAll('button').length >= 2) break;
        container = container.parentElement;
      }

      // Extraire texte et auteur depuis le container
      const text = container?.innerText?.substring(0, 1500) || '';
      const authorEl = container?.querySelector('[aria-label*="profil"], a[href*="/in/"]');
      const author = authorEl?.innerText?.trim() || authorEl?.getAttribute('aria-label') || '';

      // Générer un ID unique basé sur la position dans le DOM
      const btnRect = btn.getBoundingClientRect();
      const postId = `post_${index}_${Math.round(btnRect.top)}`;

      return {
        index,
        text: text.substring(0, 1500),
        textLength: text.length,
        author,
        title: '',
        hasLikeButton: true,
        isAlreadyLiked: false,
        reactions: '0',
        postUrn: postId, // pas de data-urn disponible, on utilise un ID positionnel
        buttonSelector: null, // on utilisera un index-based click
        buttonIndex: index,
      };
    });
  });
}

// ─── ATOMIC Like (THE FIX) ─────────────────────────────────────

/**
 * Strategy: 
 *   1. Find button by data-urn selector, scroll into view, get coordinates (single evaluate)
 *   2. Human mouse move + click at coordinates
 *   3. Verify aria-pressed="true" (separate evaluate)
 *   4. If not confirmed: fallback DOM .click() inside evaluate
 *   5. Retry up to 5×
 */
async function likePostAtomic(page, humanMouse, post) {
  // buttonSelector OU buttonIndex requis (nouveau format aria-label)
  if (post.buttonSelector === undefined && post.buttonIndex === undefined) {
    return { success: false, reason: 'no_selector' };
  }

  // Sélecteur Playwright pour les boutons "aucune réaction"
  const LIKE_BTN_SELECTOR = 'button[aria-label*="État du bouton de réaction"][aria-label*="aucune réaction"], button[aria-label*="Réagir avec"]';
  const btnIndex = post.buttonIndex ?? 0;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Re-trouver le bouton à chaque tentative (index peut avoir changé après scroll)
      const allButtons = await page.locator(LIKE_BTN_SELECTOR).all();

      if (allButtons.length === 0) {
        console.log(`   ⚠️  Aucun bouton like trouvé (tentative ${attempt})`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      // Prendre le premier bouton disponible (le plus haut dans le feed visible)
      const btn = allButtons[Math.min(btnIndex, allButtons.length - 1)];

      // Scroll into view + click via Playwright (gère automatiquement les coords)
      await btn.scrollIntoViewIfNeeded();
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      await btn.click({ timeout: 5000 });

      // Attendre la réponse LinkedIn
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));

      // Vérifier : le bouton cliqué doit avoir changé de label (plus "aucune réaction")
      const verified = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('button[aria-label*="État du bouton de réaction"]'));
        return all.some(b => {
          const label = b.getAttribute('aria-label') || '';
          // Après J'aime : "État du bouton de réaction : J'aime"
          return label.includes("J'aime") || label.includes('Bravo') || label.includes('Soutenir') || label.includes('Intéressant') || label.includes('Drôle');
        });
      }).catch(() => false);

      if (verified) {
        return {
          success: true,
          reason: 'liked_and_verified',
          attempts: attempt,
          post: { author: post.author, text: post.text.substring(0, 100), score: post.analysis?.score || 0 },
        };
      }

      // Pas confirmé → peut-être le like est passé quand même, on vérifie différemment
      const countAfter = await page.locator(LIKE_BTN_SELECTOR).count().catch(() => -1);
      if (countAfter < allButtons.length) {
        // Un bouton "aucune réaction" en moins → like réussi !
        return {
          success: true,
          reason: 'liked_count_decreased',
          attempts: attempt,
          post: { author: post.author, text: post.text.substring(0, 100), score: post.analysis?.score || 0 },
        };
      }

      if (attempt < 3) {
        console.log(`   🔄 Non confirmé, retry (${attempt}/3)...`);
        await new Promise(r => setTimeout(r, 800 * attempt));
      }

    } catch (error) {
      if (attempt < 3) {
        console.log(`   ⚠️  Erreur (${attempt}/3): ${error.message.substring(0, 60)}`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      return { success: false, reason: error.message.substring(0, 80) };
    }
  }

  return { success: false, reason: 'max_retries_exhausted' };
}

// ─── Feed Error Diagnostics ────────────────────────────────────

/**
 * Capture un snapshot détaillé quand le feed ne charge pas.
 * Sauvegarde dans logs/feed-errors/YYYY-MM-DD_HH-MM-SS.json
 * 100% passif — aucune action LinkedIn, aucun risque de shadow ban.
 */
async function captureFeedDiagnostics(page, context = {}) {
  const logsDir = path.join(__dirname, '../../logs/feed-errors');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filePath = path.join(logsDir, `${ts}.json`);

  let diag = {
    timestamp: new Date().toISOString(),
    context,
    ram_mb: getChromeMemoryMB(),
    url: null,
    page_title: null,
    dom: {
      occludable_updates: 0,
      data_urn_elements: 0,
      feed_shared_updates: 0,
      main_feed_present: false,
      scaffold_present: false,
    },
    cookies: {
      has_jsessionid: false,
      has_li_at: false,
    },
    network: {
      voyager_feed_status: null,
      voyager_feed_error: null,
    },
    html_preview: null,
    error: null,
  };

  try {
    diag.url = page.url();
    diag.page_title = await page.title().catch(() => null);

    // DOM snapshot
    diag.dom = await page.evaluate(() => ({
      occludable_updates: document.querySelectorAll('.occludable-update').length,
      data_urn_elements: document.querySelectorAll('[data-urn]').length,
      feed_shared_updates: document.querySelectorAll('.feed-shared-update-v2').length,
      main_feed_present: !!document.querySelector('.scaffold-layout__main'),
      scaffold_present: !!document.querySelector('.scaffold-layout'),
      body_classes: document.body?.className?.substring(0, 200) || '',
      visible_error: document.querySelector('.error-container, .not-found, [data-test-id="error"]')?.textContent?.trim()?.substring(0, 200) || null,
    })).catch(e => ({ error: e.message }));

    // Cookies (présence seulement, pas les valeurs)
    diag.cookies = await page.evaluate(() => ({
      has_jsessionid: document.cookie.includes('JSESSIONID'),
      has_li_at: document.cookie.includes('li_at'),
      cookie_count: document.cookie.split(';').length,
    })).catch(() => ({ error: 'evaluate_failed' }));

    // Test Voyager API — read-only, même requête que getFeed
    diag.network = await page.evaluate(async () => {
      try {
        const csrf = document.cookie.match(/JSESSIONID="?([^;"]*)"?/)?.[1] || '';
        const r = await fetch('/voyager/api/feed/updatesV2?q=feed&count=3&start=0', {
          headers: { 'csrf-token': csrf, 'x-restli-protocol-version': '2.0.0' },
          credentials: 'include',
        });
        const text = await r.text();
        return {
          voyager_feed_status: r.status,
          voyager_feed_ok: r.ok,
          response_length: text.length,
          elements_count: (() => { try { return JSON.parse(text).elements?.length ?? -1; } catch { return -1; } })(),
          response_preview: text.substring(0, 300),
        };
      } catch (e) {
        return { voyager_feed_error: e.message };
      }
    }).catch(e => ({ evaluate_error: e.message }));

    // HTML preview de la zone feed (100 chars maxi)
    diag.html_preview = await page.evaluate(() => {
      const feed = document.querySelector('.scaffold-layout__main, #main, main');
      return feed?.innerHTML?.substring(0, 500) || document.body?.innerHTML?.substring(0, 500) || null;
    }).catch(() => null);

  } catch (e) {
    diag.error = e.message;
  }

  fs.writeFileSync(filePath, JSON.stringify(diag, null, 2));
  console.log(`🔍 Diagnostic sauvegardé: logs/feed-errors/${ts}.json`);
  console.log(`   URL: ${diag.url} | DOM updates: ${diag.dom?.occludable_updates ?? '?'} | Voyager: ${diag.network?.voyager_feed_status ?? '?'} | Cookies: li_at=${diag.cookies?.has_li_at ?? '?'}`);
  return diag;
}

// ─── CDP via Chrome Daemon ──────────────────────────────────────

const { getLinkedInPage, closePage } = require('./chrome-daemon.js');
// action-logger.js remplacé par logger.js — ne plus utiliser logAction

async function connectCDP() {
  const { browser, page } = await getLinkedInPage();
  return { browser, page };
}

// ─── Main Session ──────────────────────────────────────────────

/**
 * Lit le plan du jour et retourne les quotas pour ce numéro de session
 */
function getSessionPlan(sessionNum) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const planFile = path.join(__dirname, `../../logs/plan-${today}.json`);
    if (!fs.existsSync(planFile)) return null;
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    const session = plan.sessions.find(s => s.name === `session_${sessionNum}`);
    return session || null;
  } catch { return null; }
}

async function runSession() {
  const { target: targetArg, maxCycles, verbose } = parseArgs();
  const { sessionNum } = parseArgs();

  // Lire le likes_quota depuis le plan du jour (priorité sur --target)
  let target = targetArg;
  try {
    const planFile = path.join(__dirname, '../../logs', `plan-${new Date().toISOString().split('T')[0]}.json`);
    if (fs.existsSync(planFile)) {
      const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
      const session = plan.sessions?.find(s => s.name === `session_${sessionNum}`);
      if (session?.likes_quota !== undefined) {
        target = session.likes_quota;
      }
    }
  } catch { /* garde la valeur par défaut */ }

  console.log('🎯 Session Runner V5 — Unified (Race Condition Fix)\n');

  // Purge logs > 7 jours au démarrage
  purgeOldLogs();

  const startTime = Date.now();
  const startRAM = getChromeMemoryMB();
  console.log(`📊 RAM Chrome: ${startRAM} MB`);

  log.chrome({ action: 'session_start', ram_mb: startRAM, session_num: sessionNum, target });
  log.session({ action: 'start', session_num: sessionNum, target, max_cycles: maxCycles });

  if (startRAM > 4000) {
    console.log(`⚠️  RAM élevée (${startRAM} MB) — on continue, le daemon gérera le restart en fin de session`);
    log.chrome({ action: 'high_ram_warning', ram_mb: startRAM, threshold: 4000 });
  }

  console.log(`🎯 Objectif: ${target} likes, max ${maxCycles} cycles\n`);
  
  let browser;
  let sessionPage = null;
  let likesCount = 0;
  const likedPosts = [];
  let consecutiveFailures = 0;
  
  try {
    console.log(`📡 Connexion via Chrome Daemon...`);
    const conn = await connectCDP();
    browser = conn.browser;
    const page = conn.page;
    sessionPage = page;
    console.log(`✅ Connecté — URL: ${page.url()}\n`);
    
    // Vérification qu'on est bien sur le feed
    const currentUrl = page.url();
    console.log(`🔍 URL actuelle: ${currentUrl}`);
    if (!currentUrl.includes('linkedin.com/feed')) {
      console.error('❌ Pas sur le feed LinkedIn après connexion');
      process.exit(1);
    }
    
    console.log('═'.repeat(55));
    console.log('🎬 DÉBUT SESSION V5\n');
    
    const humanMouse = new HumanMouseV3(page);
    
    // Prepare
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    await injectTextRevealCSS(page);
    
    let feedReady = await waitForFeedReady(page);
    if (!feedReady) {
      log.feed({ action: 'feed_empty', session_num: sessionNum, attempt: 1 });
      console.log('⚠️  Feed vide — health monitor immédiat...');
      await captureFeedDiagnostics(page, { phase: 'initial_feed_wait', ram: getChromeMemoryMB() });

      // Health monitor MAINTENANT : probe sélecteurs + auto-fix
      await analyzeSession({ status: 'error', likesOk: 0, likesFail: target, feedEmpty: true, chromeRam: getChromeMemoryMB() }).catch(() => {});

      // Retry après le fix éventuel
      console.log('🔄 Retry feed après analyse...');
      await new Promise(r => setTimeout(r, 4000));
      feedReady = await waitForFeedReady(page, 30000);

      if (!feedReady) {
        log.feed({ action: 'feed_empty_abort', session_num: sessionNum, attempt: 2 });
        console.log('❌ Feed toujours vide après fix — session abandonnée');
        process.exit(1);
      }
      console.log('✅ Feed récupéré après fix');
    }
    
    // Phase 1: Observation
    console.log('\n📍 PHASE 1: Observation (8s)\n');
    await new Promise(r => setTimeout(r, 3000));
    await humanMouse.moveTo(200 + Math.random() * 200, 300 + Math.random() * 200);
    await new Promise(r => setTimeout(r, 2000));
    await humanMouse.ambientMovements(3000);
    
    let posts = await extractPostsWithButtons(page);
    console.log(`📄 Posts extraits: ${posts.length}`);
    
    if (posts.length > 0) {
      const analyzed = posts.map(p => ({
        ...p,
        analysis: analyzePost({ author: p.author, title: p.title, text: p.text, textLength: p.textLength }),
      }));
      const stats = getAnalysisStats(analyzed);
      console.log(`🎯 Qualité: ${stats.high}h ${stats.medium}m ${stats.low}b | moy ${stats.average}/10`);
      console.log(`👍 À liker: ${stats.shouldLike}`);
      
      if (verbose) {
        analyzed.slice(0, 5).forEach((p, i) => {
          console.log(`   ${i+1}. "${p.author}" — ${p.analysis.score}/10 ${p.analysis.shouldLike ? '✅' : '⏭️'}`);
          if (p.analysis.reason) console.log(`      ${p.analysis.reason}`);
        });
      }
    }
    
    // Phase 2: Scroll + Like
    console.log('\n📍 PHASE 2: Scroll + Like\n');
    
    for (let cycle = 1; cycle <= maxCycles && likesCount < target; cycle++) {
      console.log(`🔄 Cycle ${cycle}/${maxCycles}:`);
      
      const scrollAmount = 300 + Math.floor(Math.random() * 300);
      await page.evaluate((a) => window.scrollBy(0, a), scrollAmount);
      console.log(`   📜 Scroll ${scrollAmount}px`);
      
      const readTime = 3000 + Math.random() * 3000;
      console.log(`   👀 Lecture (${(readTime/1000).toFixed(1)}s)...`);
      await humanMouse.ambientMovements(Math.min(readTime, 4000));
      if (readTime > 4000) await new Promise(r => setTimeout(r, readTime - 4000));
      
      // ATOMIC extraction
      posts = await extractPostsWithButtons(page);
      
      if (posts.length === 0) {
        console.log(`   ⚠️  0 posts, skip\n`);
        consecutiveFailures++;
        continue;
      }
      
      console.log(`   📄 Posts: ${posts.length}`);
      
      const analyzed = posts.map(p => ({
        ...p,
        analysis: analyzePost({ author: p.author, title: p.title, text: p.text, textLength: p.textLength }),
      }));
      
      const stats = getAnalysisStats(analyzed);
      console.log(`   🎯 ${stats.high}h ${stats.medium}m ${stats.low}b | moy ${stats.average}/10`);
      
      // Find best likeable candidate
      const candidates = analyzed
        .filter(p => p.analysis.shouldLike && p.hasLikeButton && !p.isAlreadyLiked && (p.buttonSelector !== undefined))
        .sort((a, b) => b.analysis.score - a.analysis.score);
      
      if (candidates.length === 0) {
        console.log(`   ⏭️  Aucun candidat\n`);
        consecutiveFailures++;
        continue;
      }
      
      const top = candidates[0];
      console.log(`   ⭐ "${top.author}" (${top.analysis.score}/10)`);
      console.log(`   👍 LIKE...`);
      
      const result = await likePostAtomic(page, humanMouse, top);
      
      if (result.success) {
        likesCount++;
        consecutiveFailures = 0;
        likedPosts.push(result.post);
        log.action({ action: 'like_ok', reason: result.reason, attempts: result.attempts, count: likesCount, target, post: result.post });
        console.log(`   ✅ CONFIRMÉ (${result.reason}, ${result.attempts}x) — ${likesCount}/${target}`);
      } else {
        log.action({ action: 'like_fail', reason: result.reason, count: likesCount, target });
        console.log(`   ❌ Échoué: ${result.reason}`);
        consecutiveFailures++;

        // 3 échecs de suite → health monitor immédiat, pas à la fin
        if (consecutiveFailures >= 3) {
          console.log('⚠️  3 échecs consécutifs — health monitor immédiat...');
          log.action({ action: 'consecutive_fails_trigger', count: consecutiveFailures });
          await analyzeSession({ status: 'partial', likesOk: likesCount, likesFail: consecutiveFailures, feedEmpty: false, chromeRam: getChromeMemoryMB() }).catch(() => {});
          consecutiveFailures = 0; // Reset — le fix est peut-être appliqué, on continue
        }
      }
      
      console.log('');
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
    }
    
    // Phase 3: Retour haut
    console.log('📍 PHASE 3: Retour haut\n');
    await page.evaluate(() => {
      const c = document.querySelector('.scaffold-layout__main');
      if (c) c.scrollTo(0, 0); else window.scrollTo(0, 0);
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));

    // Phase 4: Invitations (si quota > 0 dans le plan)
    const { sessionNum } = parseArgs();
    const sessionPlan = getSessionPlan(sessionNum || 1);
    const invitationsQuota = sessionPlan?.invitations_quota || 0;

    let invitationsSent = 0;
    if (invitationsQuota > 0) {
      console.log(`📍 PHASE 4: Invitations (quota: ${invitationsQuota})\n`);
      try {
        const { run: runConnect } = require('../actions/prospect-connect.js');
        const result = await runConnect({ maxInvitations: invitationsQuota });
        invitationsSent = result.sent || 0;
        console.log(`✅ ${invitationsSent} invitations envoyées\n`);
        for (let i = 0; i < invitationsSent; i++) {
        }
      } catch (e) {
        console.log(`⚠️  Invitations: ${e.message}\n`);
      }
    }

    // Phase 5: Commentaires (à venir)
    // const commentsQuota = sessionPlan?.comments_quota || 0;
    // if (commentsQuota > 0) { ... }
    
  } catch (error) {
    console.error(`\n❌ Erreur: ${error.message}`);
    if (verbose) console.error(error.stack);
    log.error({ action: 'session_crash', error: error.message, stack: error.stack?.substring(0, 500) });
    await analyzeSession({ status: 'error', likesOk: likesCount, likesFail: target - likesCount, feedEmpty: true, chromeRam: getChromeMemoryMB(), errors: [error.message] }).catch(() => {});
  } finally {
    const endRAM = getChromeMemoryMB();
    const duration = ((Date.now() - startTime) / 60000).toFixed(1);
    
    console.log('═'.repeat(55));
    console.log('✅ SESSION V5 TERMINÉE\n');
    console.log(`📊 Durée: ${duration}min | Likes: ${likesCount}/${target} | RAM: ${startRAM}→${endRAM}MB\n`);
    
    if (likedPosts.length > 0) {
      console.log('📋 Posts likés:');
      likedPosts.forEach((p, i) => {
        console.log(`   ${i+1}. "${p.author}" (${p.score}/10) — "${p.text}..."`);
      });
      console.log('');
    }
    
    const successRate = Math.round((likesCount / target) * 100);
    console.log(`📈 Score: ${successRate}% ${likesCount >= target ? '✅' : '⚠️'}`);
    console.log('═'.repeat(55));
    
    // Write result for test scripts
    const result = { success: likesCount >= target, likes: likesCount, target, likedPosts, duration: parseFloat(duration), ram: { start: startRAM, end: endRAM } };
    try { fs.writeFileSync('/tmp/session-result.json', JSON.stringify(result, null, 2)); } catch {}

    // Log session end + health monitor
    log.session({ action: 'end', status: likesCount >= target ? 'ok' : 'partial', likesOk: likesCount, likesFail: target - likesCount, duration_min: parseFloat(duration), ram_end: endRAM });
    log.chrome({ action: 'session_end', ram_start: startRAM, ram_end: endRAM });
    await analyzeSession({ status: likesCount >= target ? 'ok' : 'partial', likesOk: likesCount, likesFail: target - likesCount, feedEmpty: false, chromeRam: endRAM }).catch(() => {});

    // Notif Telegram
    try {
      const { sendTelegram } = require('../utils/notify.js');
      const emoji = likesCount >= target ? '✅' : '⚠️';
      await sendTelegram(`${emoji} *Session LinkedIn terminée*\nLikes: ${likesCount}/${target} | Durée: ${duration}min | Score: ${successRate}%`);
    } catch {}

    // Ferme la page mais PAS Chrome (session persistante)
    if (sessionPage) await closePage(sessionPage).catch(() => {});

    process.exit(likesCount >= target ? 0 : 1);
  }
}

module.exports = { runSession, connectCDP, extractPostsWithButtons, likePostAtomic, waitForFeedReady, safeEvaluate, injectTextRevealCSS, captureFeedDiagnostics };

runSession();
