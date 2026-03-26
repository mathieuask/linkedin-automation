/**
 * logger.js — Logging exhaustif JSON (sessions, Chrome, feed, erreurs)
 * Rétention : 7 jours automatique
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const LOGS_ROOT = path.resolve(__dirname, '../../logs');
const STATE_FILE = path.join(LOGS_ROOT, 'state.json');
const RETENTION_DAYS = 7;

// ─── Helpers ──────────────────────────────────────────────────

function todayDir() {
  const d = new Date().toISOString().split('T')[0];
  const dir = path.join(LOGS_ROOT, d);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function appendLog(category, event) {
  const file = path.join(todayDir(), `${category}.json`);
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, ...event }) + '\n';
  fs.appendFileSync(file, line, 'utf8');
}

// ─── Catégories de logs ────────────────────────────────────────

const log = {
  // Session lifecycle
  session(event) { appendLog('session', { cat: 'session', ...event }); },

  // Actions LinkedIn (like, invite, message, scroll)
  action(event) { appendLog('session', { cat: 'action', ...event }); },

  // Chrome : RAM, restart, CDP
  chrome(event) { appendLog('chrome', { cat: 'chrome', ...event }); },

  // Feed : temps chargement, posts, sélecteurs
  feed(event) { appendLog('feed', { cat: 'feed', ...event }); },

  // Sélecteurs : lesquels essayés, combien matchent
  selector(event) { appendLog('feed', { cat: 'selector', ...event }); },

  // Erreurs : stack, screenshot, contexte
  error(event) { appendLog('errors', { cat: 'error', ...event }); },

  // Réseau : Voyager API, proxy
  network(event) { appendLog('session', { cat: 'network', ...event }); },
};

// ─── State file ────────────────────────────────────────────────

function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return defaultState();
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch { return defaultState(); }
}

function defaultState() {
  return {
    lastUpdated: null,
    lastSession: { date: null, status: null, likesOk: 0, likesFail: 0, error: null },
    lastLikeOk: null,
    consecutiveErrors: 0,
    consecutiveFeedEmpty: 0,
    selectors: {
      likeButton: 'button[aria-label*="État du bouton de réaction"][aria-label*="aucune réaction"]',
      feedReady: 'button[aria-label*="État du bouton de réaction"]',
    },
    chromeRestarts: 0,
    lastChromeRestart: null,
    shadowBanRisk: 'low', // low / medium / high
  };
}

function writeState(patch) {
  const current = readState();
  const next = { ...current, ...patch, lastUpdated: new Date().toISOString() };
  if (!fs.existsSync(LOGS_ROOT)) fs.mkdirSync(LOGS_ROOT, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function updateState(patch) {
  return writeState(patch);
}

// ─── Rétention 7 jours ────────────────────────────────────────

function purgeOldLogs() {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const entries = fs.readdirSync(LOGS_ROOT, { withFileTypes: true });
    let deleted = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Format attendu : YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
      const dirDate = new Date(entry.name).getTime();
      if (dirDate < cutoff) {
        fs.rmSync(path.join(LOGS_ROOT, entry.name), { recursive: true, force: true });
        deleted++;
      }
    }
    if (deleted > 0) {
      log.session({ action: 'purge_logs', deleted, retention_days: RETENTION_DAYS });
    }
    return deleted;
  } catch (e) {
    console.error('[logger] Purge error:', e.message);
    return 0;
  }
}

// ─── Exports ───────────────────────────────────────────────────

module.exports = { log, readState, updateState, purgeOldLogs };
