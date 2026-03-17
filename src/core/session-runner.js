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

import { chromium } from 'patchright';
import { HumanMouseV3 } from './src/utils/human-mouse-v3.js';
import { analyzePost, getAnalysisStats } from './src/utils/post-analyzer.js';
import { execSync } from 'child_process';
import fs from 'fs';

const CDP_ENDPOINT = process.env.CDP_ENDPOINT || 'http://localhost:9222';

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
  return {
    target: idx('--target') >= 0 ? parseInt(args[idx('--target') + 1]) || 2 : 2,
    maxCycles: idx('--cycles') >= 0 ? parseInt(args[idx('--cycles') + 1]) || 8 : 8,
    verbose: args.includes('--verbose'),
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

async function waitForFeedReady(page, maxWait = 15000) {
  const start = Date.now();
  console.log('⏳ Attente feed LinkedIn...');

  while (Date.now() - start < maxWait) {
    const postCount = await page.evaluate(() =>
      document.querySelectorAll('.feed-shared-update-v2').length
    ).catch(() => 0);

    if (postCount >= 2) {
      console.log(`✅ Feed prêt (${postCount} posts en ${Math.round((Date.now() - start) / 1000)}s)`);
      return true;
    }

    if (postCount === 0) {
      await page.evaluate(() => window.scrollBy(0, 100)).catch(() => {});
      await new Promise(r => setTimeout(r, 500));
      await page.evaluate(() => window.scrollBy(0, -100)).catch(() => {});
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`⚠️  Feed toujours vide après ${maxWait / 1000}s`);
  return false;
}

// ─── ATOMIC Post Extraction ────────────────────────────────────

async function extractPostsWithButtons(page) {
  return await safeEvaluate(page, () => {
    const posts = Array.from(document.querySelectorAll('.feed-shared-update-v2'));
    
    return posts
      .filter(el => el.dataset.urn && el.dataset.urn.includes('activity'))
      .map((el, index) => {
        const text = el.querySelector('.update-components-text span')?.textContent?.trim() || '';
        const author = el.querySelector('.update-components-actor__name span')?.textContent?.trim() || '';
        const title = el.querySelector('.update-components-actor__description span')?.textContent?.trim() || '';
        const likeBtn = el.querySelector('button[aria-label*="aime"][aria-pressed="false"]');
        const isAlreadyLiked = !!el.querySelector('button[aria-label*="aime"][aria-pressed="true"]');
        const reactionsEl = el.querySelector('button[aria-label*="reaction"]');

        return {
          index,
          text: text.substring(0, 1500),
          textLength: text.length,
          author,
          title,
          hasLikeButton: !!likeBtn,
          isAlreadyLiked,
          reactions: reactionsEl ? reactionsEl.textContent.trim() : '0',
          postUrn: el.dataset.urn,
          buttonSelector: likeBtn
            ? `div[data-urn="${el.dataset.urn}"] button[aria-label*="aime"][aria-pressed="false"]`
            : null,
        };
      })
      .filter(p => p.text.length > 20);
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

// ─── CDP Connection ────────────────────────────────────────────

async function connectCDP() {
  const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const contexts = browser.contexts();
  if (contexts.length === 0) throw new Error('Aucun context browser');
  const pages = contexts[0].pages();
  if (pages.length === 0) throw new Error('Aucune page ouverte');
  return { browser, page: pages[0] };
}

// ─── Main Session ──────────────────────────────────────────────

async function runSession() {
  const { target, maxCycles, verbose } = parseArgs();
  
  console.log('🎯 Session Runner V5 — Unified (Race Condition Fix)\n');
  
  const startTime = Date.now();
  const startRAM = getChromeMemoryMB();
  console.log(`📊 RAM Chrome: ${startRAM} MB`);
  console.log(`🎯 Objectif: ${target} likes, max ${maxCycles} cycles\n`);
  
  let browser;
  let likesCount = 0;
  const likedPosts = [];
  let consecutiveFailures = 0;
  
  try {
    console.log(`📡 Connexion CDP: ${CDP_ENDPOINT}`);
    const conn = await connectCDP();
    browser = conn.browser;
    const page = conn.page;
    console.log(`✅ Connecté — URL: ${page.url()}\n`);
    
    if (!page.url().includes('linkedin.com/feed')) {
      console.error('❌ Page n\'est pas le feed LinkedIn');
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
      } else {
        console.log(`   ❌ Échoué: ${result.reason}`);
        consecutiveFailures++;
      }
      
      console.log('');
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
    }
    
    // Phase 3: Return top
    console.log('📍 PHASE 3: Retour haut\n');
    await page.evaluate(() => {
      const c = document.querySelector('.scaffold-layout__main');
      if (c) c.scrollTo(0, 0); else window.scrollTo(0, 0);
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    
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
    
    process.exit(likesCount >= target ? 0 : 1);
  }
}

export { runSession, connectCDP, extractPostsWithButtons, likePostAtomic, waitForFeedReady, safeEvaluate, injectTextRevealCSS };

runSession();
