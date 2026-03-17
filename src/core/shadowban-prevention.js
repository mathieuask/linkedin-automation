/**
 * Shadow Ban Prevention — Règles strictes pour éviter le shadow ban LinkedIn
 * 
 * IMPORTANT : Le warm-up est géré par config/warm-up.json (lié au planning Notion)
 * Ce module LIT warm-up.json, il ne définit PAS son propre système de warm-up.
 */

const fs = require('fs');
const path = require('path');

const HEALTH_FILE = path.resolve(__dirname, '../../config/account-health.json');
const WARMUP_FILE = path.resolve(__dirname, '../../config/warm-up.json');

// ═══════════════════════════════════════════
// RATE LIMITS MAX (sécurité absolue, jamais dépasser)
// ═══════════════════════════════════════════

const ABSOLUTE_LIMITS = {
  invitations: { daily: 15, weekly: 80 },
  messages: { daily: 50 },
  likes: { daily: 50 },
  comments: { daily: 15 },
  profile_views: { daily: 80 },
  posts: { daily: 2 },
  searches: { daily: 30 },
};

// ═══════════════════════════════════════════
// HORAIRES ET DÉLAIS
// ═══════════════════════════════════════════

const QUIET_HOURS = { start: 23, end: 7 };

const MIN_DELAYS = {
  same_action: 30000,     // 30s entre 2 actions identiques
  different_action: 5000,  // 5s entre 2 actions différentes
};

const SESSION_CONFIG = {
  min_duration: 15 * 60 * 1000,
  max_duration: 45 * 60 * 1000,
  pause_min: 30 * 60 * 1000,
  pause_max: 90 * 60 * 1000,
  max_sessions_per_day: 6,
};

const OFF_DAY = 0; // Dimanche

// ═══════════════════════════════════════════
// WARM-UP (lecture depuis config/warm-up.json)
// ═══════════════════════════════════════════

function loadWarmupConfig() {
  try {
    if (fs.existsSync(WARMUP_FILE)) {
      return JSON.parse(fs.readFileSync(WARMUP_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('⚠️ Erreur lecture warm-up.json:', e.message);
  }
  return null;
}

/**
 * Obtenir le stage de warm-up actuel depuis config/warm-up.json
 */
function getWarmupStage() {
  const config = loadWarmupConfig();
  if (!config) return { active: false, stage: 'normal', limits: getDailyLimits() };

  const startDate = new Date(config.start_date);
  const now = new Date();
  const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24)) + 1;

  // Trouver la phase actuelle
  const phases = config.phases;
  let currentPhase = 'pleine_vitesse';
  for (const [name, phase] of Object.entries(phases)) {
    const [start, end] = phase.days.includes('+')
      ? [parseInt(phase.days), Infinity]
      : phase.days.split('-').map(Number);
    if (daysSinceStart >= start && daysSinceStart <= end) {
      currentPhase = name;
      break;
    }
  }

  return {
    active: currentPhase !== 'pleine_vitesse',
    stage: currentPhase,
    day: daysSinceStart,
    phase: phases[currentPhase],
    quotas: config.daily_quotas,
    sessionsPerDay: phases[currentPhase]?.sessions_per_day || 6,
  };
}

// ═══════════════════════════════════════════
// FONCTIONS PRINCIPALES
// ═══════════════════════════════════════════

/**
 * Obtenir les limites journalières (warm-up.json + limites de sécurité)
 */
function getDailyLimits() {
  const warmup = getWarmupStage();
  const config = loadWarmupConfig();

  if (config && warmup.active && warmup.phase) {
    // En warm-up : utiliser les limites de la phase
    const inv = warmup.phase.invitations_per_day || '0';
    const maxInv = typeof inv === 'string' ? parseInt(inv.split('-').pop()) : inv;
    return {
      invitations: Math.min(maxInv, ABSOLUTE_LIMITS.invitations.daily),
      likes: config.daily_quotas?.likes ? parseInt(String(config.daily_quotas.likes).split('-').pop()) : 5,
      comments: config.daily_quotas?.comments ? parseInt(String(config.daily_quotas.comments).split('-').pop()) : 2,
      messages: 10,
      posts: config.daily_quotas?.post_creation ? parseInt(String(config.daily_quotas.post_creation).split('-').pop()) : 0,
      profile_views: config.daily_quotas?.profile_views ? parseInt(String(config.daily_quotas.profile_views).split('-').pop()) : 20,
      searches: 15,
    };
  }

  // Pleine vitesse : utiliser les quotas du warm-up.json ou les limites absolues
  if (config?.daily_quotas) {
    const q = config.daily_quotas;
    return {
      invitations: Math.min(parseInt(String(q.invitations || '15').split('-').pop()), ABSOLUTE_LIMITS.invitations.daily),
      likes: Math.min(parseInt(String(q.likes || '50').split('-').pop()), ABSOLUTE_LIMITS.likes.daily),
      comments: Math.min(parseInt(String(q.comments || '15').split('-').pop()), ABSOLUTE_LIMITS.comments.daily),
      messages: ABSOLUTE_LIMITS.messages.daily,
      posts: Math.min(parseInt(String(q.post_creation || '2').split('-').pop()), ABSOLUTE_LIMITS.posts.daily),
      profile_views: ABSOLUTE_LIMITS.profile_views.daily,
      searches: ABSOLUTE_LIMITS.searches.daily,
    };
  }

  // Fallback
  return {
    invitations: ABSOLUTE_LIMITS.invitations.daily,
    likes: ABSOLUTE_LIMITS.likes.daily,
    comments: ABSOLUTE_LIMITS.comments.daily,
    messages: ABSOLUTE_LIMITS.messages.daily,
    posts: ABSOLUTE_LIMITS.posts.daily,
    profile_views: ABSOLUTE_LIMITS.profile_views.daily,
    searches: ABSOLUTE_LIMITS.searches.daily,
  };
}

/**
 * Vérifier si une action peut être effectuée
 */
function canPerformAction(actionType, todayCount) {
  const limits = getDailyLimits();
  const limit = limits[actionType];
  if (limit === undefined) {
    console.warn(`⚠️ Action type inconnue: ${actionType}`);
    return false;
  }
  return todayCount < limit;
}

/**
 * Signaux de danger → pause ou réduction
 */
function shouldPauseActivity(signals) {
  if (!signals || signals.length === 0) return { pause: false };

  const captcha = signals.find(s => s.type === 'captcha');
  if (captcha) return { pause: true, reason: 'CAPTCHA détecté', duration: '48h', severity: 'critical' };

  const unusual = signals.find(s => s.type === 'unusual_activity');
  if (unusual) return { pause: true, reason: 'Activité inhabituelle', duration: '24h', severity: 'high' };

  const verification = signals.find(s => s.type === 'verification_required');
  if (verification) return { pause: true, reason: 'Vérification requise', duration: '72h', severity: 'critical' };

  const lowAcceptance = signals.find(s => s.type === 'low_invitation_acceptance' && s.rate < 0.2);
  if (lowAcceptance) return { pause: false, reduce: 0.5, reason: `Taux acceptation faible (${Math.round(lowAcceptance.rate * 100)}%)`, severity: 'medium' };

  return { pause: false };
}

/**
 * Délai recommandé avant la prochaine action
 */
function getRecommendedDelay(actionType, lastActionTime, lastActionType = null) {
  const now = Date.now();
  const timeSinceLast = now - lastActionTime;
  const baseDelay = (lastActionType === actionType) ? MIN_DELAYS.same_action : MIN_DELAYS.different_action;

  if (timeSinceLast < baseDelay) return baseDelay - timeSinceLast;

  // Variation gaussienne ±30%
  const u1 = Math.random(), u2 = Math.random();
  const gaussian = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  const variation = gaussian * 0.3;
  return Math.max(0, Math.round(baseDelay * (1 + variation)));
}

function isQuietHours() {
  const hour = new Date().getHours();
  return hour >= QUIET_HOURS.start || hour < QUIET_HOURS.end;
}

function isOffDay() {
  return new Date().getDay() === OFF_DAY;
}

function canStartSession(todaySessions = []) {
  if (isQuietHours()) return { can: false, reason: 'Heures silencieuses (23h-7h)' };
  if (isOffDay()) return { can: false, reason: 'Jour OFF (dimanche)' };

  const warmup = getWarmupStage();
  const maxSessions = warmup.sessionsPerDay || SESSION_CONFIG.max_sessions_per_day;

  if (todaySessions.length >= maxSessions) {
    return { can: false, reason: `Max ${maxSessions} sessions/jour atteint` };
  }

  if (todaySessions.length > 0) {
    const lastEnd = new Date(todaySessions[todaySessions.length - 1].endTime).getTime();
    const elapsed = Date.now() - lastEnd;
    if (elapsed < SESSION_CONFIG.pause_min) {
      return { can: false, reason: `Pause ${Math.ceil((SESSION_CONFIG.pause_min - elapsed) / 60000)} min restantes` };
    }
  }

  return { can: true };
}

function getSessionDuration() {
  const range = SESSION_CONFIG.max_duration - SESSION_CONFIG.min_duration;
  return Math.round(SESSION_CONFIG.min_duration + Math.random() * range);
}

function loadHealth() {
  try {
    if (fs.existsSync(HEALTH_FILE)) return JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
  } catch (e) { /* ignore */ }
  return { warmup: { startDate: null, currentDay: 0 }, signals: [] };
}

module.exports = {
  getDailyLimits,
  canPerformAction,
  getWarmupStage,
  shouldPauseActivity,
  getRecommendedDelay,
  isQuietHours,
  isOffDay,
  canStartSession,
  getSessionDuration,
  ABSOLUTE_LIMITS,
  SESSION_CONFIG,
};
