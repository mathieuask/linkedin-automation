require('dotenv').config();
const fs = require('fs');
const path = require('path');

/**
 * Action Logger — Log toutes les actions LinkedIn pour apprentissage
 * Format : logs/actions-YYYY-MM-DD.json
 */

const LOGS_DIR = path.resolve(__dirname, '../../logs');

/**
 * Retourne le chemin du fichier de log du jour
 */
function getTodayLogFile() {
  const today = new Date().toISOString().split('T')[0];
  return path.join(LOGS_DIR, `actions-${today}.json`);
}

/**
 * Charge les actions du jour
 */
function loadTodayActions() {
  try {
    const logFile = getTodayLogFile();
    if (!fs.existsSync(logFile)) {
      return [];
    }
    const content = fs.readFileSync(logFile, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('⚠️  Erreur lecture log:', error.message);
    return [];
  }
}

/**
 * Sauvegarde les actions du jour
 */
function saveTodayActions(actions) {
  try {
    const logFile = getTodayLogFile();
    fs.writeFileSync(logFile, JSON.stringify(actions, null, 2), 'utf8');
  } catch (error) {
    console.error('⚠️  Erreur sauvegarde log:', error.message);
  }
}

/**
 * Log une action
 * @param {Object} data - { action, target, success, error, duration_ms, method_used, selector_used }
 */
function logAction(data) {
  try {
    const actions = loadTodayActions();
    
    const entry = {
      timestamp: new Date().toISOString(),
      action: data.action,
      target: data.target || null,
      success: data.success || false,
      error: data.error || null,
      duration_ms: data.duration_ms || 0,
      method_used: data.method_used || null,
      selector_used: data.selector_used || null
    };
    
    actions.push(entry);
    saveTodayActions(actions);
    
    // Log console (optionnel, pour debug)
    if (!data.success) {
      console.log(`📊 [Logger] ${data.action} FAIL : ${data.error}`);
    }
  } catch (error) {
    console.error('⚠️  Erreur logAction:', error.message);
  }
}

/**
 * Stats du jour
 * @returns {Object}
 */
function getTodayStats() {
  const actions = loadTodayActions();
  
  const stats = {
    date: new Date().toISOString().split('T')[0],
    total: actions.length,
    success: actions.filter(a => a.success).length,
    fail: actions.filter(a => !a.success).length,
    success_rate: 0,
    by_action: {},
    errors: {}
  };
  
  stats.success_rate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0;
  
  // Par action
  actions.forEach(a => {
    if (!stats.by_action[a.action]) {
      stats.by_action[a.action] = { total: 0, success: 0, fail: 0 };
    }
    stats.by_action[a.action].total++;
    if (a.success) {
      stats.by_action[a.action].success++;
    } else {
      stats.by_action[a.action].fail++;
    }
  });
  
  // Erreurs par type
  actions.filter(a => !a.success && a.error).forEach(a => {
    const errorType = a.error.substring(0, 50); // Tronquer
    stats.errors[errorType] = (stats.errors[errorType] || 0) + 1;
  });
  
  return stats;
}

/**
 * Stats de la semaine (7 derniers jours)
 * @returns {Object}
 */
function getWeekStats() {
  const weekStats = {
    days: [],
    total_actions: 0,
    avg_success_rate: 0,
    top_errors: {}
  };
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const logFile = path.join(LOGS_DIR, `actions-${dateStr}.json`);
    
    try {
      if (fs.existsSync(logFile)) {
        const actions = JSON.parse(fs.readFileSync(logFile, 'utf8'));
        const success = actions.filter(a => a.success).length;
        const total = actions.length;
        const success_rate = total > 0 ? Math.round((success / total) * 100) : 0;
        
        weekStats.days.push({
          date: dateStr,
          total,
          success,
          success_rate
        });
        
        weekStats.total_actions += total;
        
        // Agréger erreurs
        actions.filter(a => !a.success && a.error).forEach(a => {
          const errorType = a.error.substring(0, 50);
          weekStats.top_errors[errorType] = (weekStats.top_errors[errorType] || 0) + 1;
        });
      } else {
        weekStats.days.push({ date: dateStr, total: 0, success: 0, success_rate: 0 });
      }
    } catch (error) {
      weekStats.days.push({ date: dateStr, total: 0, success: 0, success_rate: 0 });
    }
  }
  
  // Moyenne du taux de succès
  const validDays = weekStats.days.filter(d => d.total > 0);
  if (validDays.length > 0) {
    weekStats.avg_success_rate = Math.round(
      validDays.reduce((sum, d) => sum + d.success_rate, 0) / validDays.length
    );
  }
  
  return weekStats;
}

/**
 * Raccourci pour logger un message envoyé
 */
function logMessage(to, success, error = null) {
  logAction({ action: 'message', target: to, success, error });
}

/**
 * Raccourci pour logger une invitation envoyée
 */
function logInvitation(to, success, error = null) {
  logAction({ action: 'invitation', target: to, success, error });
}

module.exports = { logAction, logMessage, logInvitation, getTodayStats, getWeekStats };
