/**
 * health-monitor.js — Analyse post-session, détection d'erreurs, auto-fix sélecteurs
 *
 * RÈGLE : peut corriger seul → sélecteurs, timeouts, scoring
 *         doit escalader → Chrome, fréquences, auth, nouvelles actions
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { log, readState, updateState, getTodayStats } = require('./logger.js');
const { sendTelegram } = require('../utils/notify.js');

// ─── Types d'erreurs ───────────────────────────────────────────

const ERROR_TYPES = {
  SELECTOR_DEAD:  'selector_dead',   // sélecteur CSS/aria-label mort → auto-fix
  FEED_EMPTY:     'feed_empty',      // feed ne charge pas → screenshot + analyse
  AUTH_FAILED:    'auth_failed',     // session LinkedIn expirée → escalade
  CHROME_SLOW:    'chrome_slow',     // RAM > seuil → escalade
  RATE_LIMITED:   'rate_limited',    // LinkedIn ralentit → escalade
  UNKNOWN:        'unknown',
};

// ─── Analyse post-session ─────────────────────────────────────

async function analyzeSession(sessionResult) {
  const state = readState();
  const { status, likesOk, likesFail, errors = [], feedEmpty, chromeRam } = sessionResult;

  // Générer un ID unique pour tracer erreur → résolution
  const errorId = `err_${Date.now()}`;
  log.session({ action: 'health_check_start', errorId, sessionResult });

  const diagnosis = {
    errorTypes: [],
    canAutoFix: [],
    needsEscalation: [],
    recommendation: null,
  };

  // Détecter les patterns d'erreur
  if (feedEmpty) {
    diagnosis.errorTypes.push(ERROR_TYPES.FEED_EMPTY);
    const feedEmptyCount = (state.consecutiveFeedEmpty || 0) + 1;
    updateState({ consecutiveFeedEmpty: feedEmptyCount });

    if (feedEmptyCount >= 2) {
      // 2 sessions de suite feed vide → analyser les sélecteurs
      diagnosis.canAutoFix.push('check_selectors');
      diagnosis.recommendation = 'run_selector_probe';
    }
  } else {
    updateState({ consecutiveFeedEmpty: 0 });
  }

  if (likesFail > 0 && likesOk === 0) {
    // Tous les likes échouent → sélecteur like probablement mort
    diagnosis.errorTypes.push(ERROR_TYPES.SELECTOR_DEAD);
    diagnosis.canAutoFix.push('fix_like_selector');
    diagnosis.recommendation = 'probe_and_fix_selectors';
  }

  if (chromeRam && chromeRam > 5000) {
    diagnosis.errorTypes.push(ERROR_TYPES.CHROME_SLOW);
    diagnosis.needsEscalation.push(`Chrome RAM ${chromeRam} MB — restart requis (validation Mathieu)`);
  }

  // Mettre à jour le state
  const consecutiveErrors = status === 'ok' ? 0 : (state.consecutiveErrors || 0) + 1;
  updateState({
    lastSession: {
      date: new Date().toISOString(),
      status,
      likesOk,
      likesFail,
      error: errors[0] || null,
    },
    consecutiveErrors,
    lastLikeOk: likesOk > 0 ? new Date().toISOString() : state.lastLikeOk,
  });

  log.session({ action: 'health_check_result', diagnosis, consecutiveErrors });

  // Exécuter les auto-fixes si nécessaire
  if (diagnosis.recommendation === 'probe_and_fix_selectors' || diagnosis.recommendation === 'run_selector_probe') {
    log.error({ action: 'error_detected', errorId, types: diagnosis.errorTypes, resolved: false });
    const fixed = await probeAndFixSelectors();
    log.error({ action: fixed ? 'error_resolved' : 'error_unresolved', errorId, resolved: fixed });
    if (fixed) console.log(`✅ Erreur ${errorId} résolue automatiquement`);
    else console.log(`⚠️  Erreur ${errorId} non résolue — escalade en cours`);
  }

  // Escalader si nécessaire
  if (diagnosis.needsEscalation.length > 0) {
    log.error({ action: 'error_escalated', errorId, escalations: diagnosis.needsEscalation, resolved: false });
    await escalate(diagnosis);
  }

  return diagnosis;
}

// ─── Probe sélecteurs et auto-fix ─────────────────────────────

async function probeAndFixSelectors() {
  log.selector({ action: 'probe_start' });

  try {
    const { chromium } = require('patchright');
    const b = await chromium.connectOverCDP('http://localhost:9222');
    const ctx = b.contexts()[0];
    const p = await ctx.newPage();

    await p.addInitScript(() => {
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    });

    await p.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 6000));

    // Dump tous les aria-labels de boutons
    const ariaLabels = await p.evaluate(() =>
      Array.from(document.querySelectorAll('button[aria-label]'))
        .map(b => b.getAttribute('aria-label'))
        .filter(l => l && l.length < 120)
    );

    // Screenshot
    const screenshotPath = path.join(__dirname, `../../logs/${new Date().toISOString().split('T')[0]}/probe-${Date.now()}.png`);
    await p.screenshot({ path: screenshotPath, fullPage: false });

    log.selector({ action: 'probe_aria_labels', count: ariaLabels.length, labels: ariaLabels.slice(0, 30), screenshot: screenshotPath });

    // Détecter le bouton like
    const likeLabel = ariaLabels.find(l =>
      l.includes('réaction') || l.includes('Réagir') || l.includes('React with Like') || l.includes('Like')
    );

    await p.close();

    if (likeLabel) {
      let newSelector;
      if (likeLabel.includes('aucune réaction')) {
        newSelector = 'button[aria-label*="État du bouton de réaction"][aria-label*="aucune réaction"]';
      } else if (likeLabel.includes('Réagir avec')) {
        newSelector = 'button[aria-label*="Réagir avec"]';
      } else {
        newSelector = `button[aria-label*="${likeLabel.split(':')[0].trim()}"]`;
      }

      const state = readState();
      const oldSelector = state.selectors?.likeButton;

      if (newSelector !== oldSelector) {
        updateState({ selectors: { ...state.selectors, likeButton: newSelector } });
        log.selector({ action: 'selector_updated', old: oldSelector, new: newSelector });
        await patchSessionRunnerSelector(oldSelector, newSelector);
        await sendTelegram(
          `🔧 Auto-fix sélecteur LinkedIn\nAncien: \`${oldSelector}\`\nNouveau: \`${newSelector}\``
        ).catch(() => {});
        return true; // ✅ Erreur résolue
      } else {
        log.selector({ action: 'selector_unchanged', selector: newSelector });
        return true; // Sélecteur déjà à jour — pas besoin de fix
      }
    } else {
      log.selector({ action: 'probe_no_like_button_found', labels: ariaLabels });
      await sendTelegram(
        `⚠️ LinkedIn: aucun bouton like trouvé.\nLabels: ${ariaLabels.slice(0, 8).join(', ')}\nAction requise.`
      ).catch(() => {});
      return false; // ❌ Non résolu
    }

  } catch (e) {
    log.error({ action: 'probe_failed', error: e.message });
    return false;
  }
}

// ─── Patch automatique de session-runner.js ───────────────────

async function patchSessionRunnerSelector(oldSelector, newSelector) {
  try {
    const runnerPath = path.join(__dirname, './session-runner.js');
    let content = fs.readFileSync(runnerPath, 'utf8');

    // Remplacer toutes les occurrences du vieux sélecteur
    const escaped = oldSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const updated = content.replace(new RegExp(escaped, 'g'), newSelector);

    if (updated !== content) {
      fs.writeFileSync(runnerPath, updated, 'utf8');
      log.selector({ action: 'session_runner_patched', occurrences: (content.match(new RegExp(escaped, 'g')) || []).length });

      // Commit git
      const { execSync } = require('child_process');
      const cwd = path.join(__dirname, '../..');
      execSync(`git add src/core/session-runner.js && git commit -m "auto-fix: sélecteur LinkedIn mis à jour (${new Date().toISOString().split('T')[0]})" && git push`, { cwd, stdio: 'pipe' });
      log.selector({ action: 'git_commit_ok' });
    }
  } catch (e) {
    log.error({ action: 'patch_failed', error: e.message });
  }
}

// ─── Escalade vers Mathieu ────────────────────────────────────

async function escalate(diagnosis) {
  const state = readState();
  const msg =
    `⚠️ LinkedIn — Action requise\n\n` +
    `Erreurs: ${diagnosis.errorTypes.join(', ')}\n` +
    `Sessions consécutives en erreur: ${state.consecutiveErrors}\n\n` +
    diagnosis.needsEscalation.map(e => `• ${e}`).join('\n') + '\n\n' +
    `Logs: logs/state.json`;

  await sendTelegram(msg).catch(() => {});
  log.session({ action: 'escalated', diagnosis });
}

module.exports = { analyzeSession, probeAndFixSelectors, ERROR_TYPES };
