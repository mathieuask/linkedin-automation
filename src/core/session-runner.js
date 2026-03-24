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
    const postCount = await page.evaluate(() =>
      document.querySelectorAll('.occludable-update, [data-urn], .feed-shared-update-v2').length
    ).catch(() => 0);

    if (postCount >= 2) {
      console.log(`✅ Feed prêt (${postCount} posts en ${Math.round((Date.now() - start) / 1000)}s)`);
      return true;
    }

    // Scroll progressif façon humain pour déclencher le lazy loading
    const scrollAmount = 80 + Math.floor(Math.random() * 120); // 80-200px
    await page.evaluate((px) => window.scrollBy({ top: px, behavior: 'smooth' }), scrollAmount).catch(() => {});
    await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));

    // Toutes les 10s si toujours vide : recharge la page doucement
    if (attempt % 10 === 0 && postCount === 0) {
      console.log(`🔄 Feed toujours vide (${Math.round((Date.now() - start) / 1000)}s) — rechargement...`);
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await new Promise(r => setTimeout(r, 4000 + Math.random() * 2000));
    }
  }

  console.log(`⚠️  Feed toujours vide après ${maxWait / 1000}s`);
  return false;
}

// ─── ATOMIC Post Extraction ────────────────────────────────────

async function extractPostsWithButtons(page) {
  return await safeEvaluate(page, () => {
    const posts = Array.from(document.querySelectorAll('.occludable-update'));
    
    return posts
      .map((el, index) => {
        // data-urn est sur un div enfant
        const urnEl = el.querySelector('[data-urn]');
        const postUrn = urnEl ? urnEl.dataset.urn : null;

        const text = el.querySelector('.update-components-text span')?.textContent?.trim() || '';
        const author = el.querySelector('.update-components-actor__name span')?.textContent?.trim() || '';
        const title = el.querySelector('.update-components-actor__description span')?.textContent?.trim() || '';

        // Bouton like : "Réagir avec \"J'aime\"" = pas encore liké
        const likeBtn = el.querySelector('button[aria-label*="Réagir avec"]');
        const isAlreadyLiked = !likeBtn; // Si le bouton "Réagir" n'est pas là, c'est déjà liké

        return {
          index,
          text: text.substring(0, 1500),
          textLength: text.length,
          author,
          title,
          hasLikeButton: !!likeBtn,
          isAlreadyLiked,
          reactions: '0',
          postUrn,
          buttonSelector: (likeBtn && postUrn)
            ? `[data-urn="${postUrn}"] button[aria-label*="Réagir avec"]`
            : null,
        };
      })
      .filter(p => p.hasLikeButton && p.postUrn);
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
  if (!post.buttonSelector || !post.postUrn) {
    return { success: false, reason: 'no_selector' };
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      // STEP 1: Find button, scroll into view, get coords
      const btnInfo = await safeEvaluate(page, (selector) => {
        const btn = document.querySelector(selector);
        if (!btn) return { found: false };
        btn.scrollIntoView({ behavior: 'instant', block: 'center' });
        const rect = btn.getBoundingClientRect();
        return {
          found: true,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          w: rect.width,
          h: rect.height,
        };
      }, post.buttonSelector);

      if (!btnInfo.found) {
        if (attempt < 5) {
          console.log(`   🔄 Bouton introuvable (${attempt}/5), retry ${300 * attempt}ms...`);
          await new Promise(r => setTimeout(r, 300 * attempt));
          continue;
        }
        return { success: false, reason: 'button_not_found' };
      }

      // STEP 2: Wait for scroll settle + human click
      await new Promise(r => setTimeout(r, 300));
      const jitterX = (Math.random() - 0.5) * 4;
      const jitterY = (Math.random() - 0.5) * 4;
      await humanMouse.moveTo(btnInfo.x + jitterX, btnInfo.y + jitterY);
      await page.mouse.click(btnInfo.x + jitterX, btnInfo.y + jitterY);

      // STEP 3: Wait for LinkedIn processing
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));

      // STEP 4: Verify
      const verified = await safeEvaluate(page, (urn) => {
        const el = document.querySelector(`div[data-urn="${urn}"]`);
        if (!el) return false;
        return !!el.querySelector('button[aria-label*="aime"][aria-pressed="true"]');
      }, post.postUrn);

      if (verified) {
        return {
          success: true,
          reason: 'liked_and_verified',
          attempts: attempt,
          post: { author: post.author, text: post.text.substring(0, 100), score: post.analysis?.score || 0 },
        };
      }

      // STEP 5: Fallback — direct DOM .click()
      if (attempt <= 3) {
        console.log(`   🔄 Mouse click non confirmé, fallback DOM .click() (${attempt}/5)...`);
        const domClicked = await safeEvaluate(page, (selector) => {
          const btn = document.querySelector(selector);
          if (!btn) return false;
          btn.click();
          return true;
        }, post.buttonSelector);

        if (domClicked) {
          await new Promise(r => setTimeout(r, 2000));
          const verified2 = await safeEvaluate(page, (urn) => {
            const el = document.querySelector(`div[data-urn="${urn}"]`);
            return !!el?.querySelector('button[aria-label*="aime"][aria-pressed="true"]');
          }, post.postUrn);

          if (verified2) {
            return {
              success: true,
              reason: 'liked_via_dom_fallback',
              attempts: attempt,
              post: { author: post.author, text: post.text.substring(0, 100), score: post.analysis?.score || 0 },
            };
          }
        }
      }

      if (attempt < 5) {
        console.log(`   🔄 Non confirmé, retry (${attempt}/5)...`);
        await new Promise(r => setTimeout(r, 500 * attempt));
      }

    } catch (error) {
      if (error.message.includes('context') && error.message.includes('destroyed') && attempt < 5) {
        console.log(`   ⚠️  Context destroyed (${attempt}/5), retry...`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      return { success: false, reason: error.message };
    }
  }

  return { success: false, reason: 'max_retries_exhausted' };
}

// ─── CDP via Chrome Daemon ──────────────────────────────────────

const { getLinkedInPage, closePage } = require('./chrome-daemon.js');
const { logAction } = require('./action-logger.js');

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
  
  const startTime = Date.now();
  const startRAM = getChromeMemoryMB();
  console.log(`📊 RAM Chrome: ${startRAM} MB`);

  // Si RAM > 4 GB : redémarre Chrome avant la session (évite le feed vide lié à la surcharge)
  if (startRAM > 4000) {
    console.log(`⚠️  RAM élevée (${startRAM} MB > 4 GB) — redémarrage Chrome propre...`);
    try {
      execSync('pm2 restart linkedin-daemon --update-env', { stdio: 'inherit' });
      await new Promise(r => setTimeout(r, 15000 + Math.random() * 5000)); // Attente réel démarrage
      console.log(`✅ Chrome redémarré — RAM: ${getChromeMemoryMB()} MB`);
    } catch (e) {
      console.warn(`⚠️  Restart Chrome échoué: ${e.message} — on continue quand même`);
    }
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
    
    const feedReady = await waitForFeedReady(page);
    if (!feedReady) {
      console.log('❌ Feed vide, abandon');
      process.exit(1);
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
        .filter(p => p.analysis.shouldLike && p.hasLikeButton && !p.isAlreadyLiked && p.buttonSelector)
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
        console.log(`   ✅ CONFIRMÉ (${result.reason}, ${result.attempts}x) — ${likesCount}/${target}`);
        logAction({ action: 'like', target: top.author || top.postUrn, success: true, method_used: result.reason });
      } else {
        console.log(`   ❌ Échoué: ${result.reason}`);
        consecutiveFailures++;
        logAction({ action: 'like', target: top.postUrn, success: false, error: result.reason });
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
          logAction({ action: 'invitation', target: result.results[i]?.name || 'prospect', success: true });
        }
      } catch (e) {
        console.log(`⚠️  Invitations: ${e.message}\n`);
        logAction({ action: 'invitation', target: 'batch', success: false, error: e.message });
      }
    }

    // Phase 5: Commentaires (à venir)
    // const commentsQuota = sessionPlan?.comments_quota || 0;
    // if (commentsQuota > 0) { ... }
    
  } catch (error) {
    console.error(`\n❌ Erreur: ${error.message}`);
    if (verbose) console.error(error.stack);
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

module.exports = { runSession, connectCDP, extractPostsWithButtons, likePostAtomic, waitForFeedReady, safeEvaluate, injectTextRevealCSS };

runSession();
