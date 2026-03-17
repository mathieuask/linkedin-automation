/**
 * Search Learner — Apprentissage automatique des stratégies efficaces
 * Tracker les résultats de recherche et optimiser les stratégies au fil du temps
 */
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../logs/search-performance.json');
const MIN_SAMPLES = 20; // Minimum d'invitations avant de tirer des conclusions
const LEARNING_PERIOD_DAYS = 14; // Période d'apprentissage (2 semaines)

/**
 * Initialise le fichier de log s'il n'existe pas
 */
function initLogFile() {
  if (!fs.existsSync(LOG_FILE)) {
    const initialData = {
      searches: [],
      invitations: [],
      strategyStats: {},
      lastUpdated: new Date().toISOString(),
    };
    fs.writeFileSync(LOG_FILE, JSON.stringify(initialData, null, 2));
  }
}

/**
 * Lit les données de performance
 * @returns {Object} Données de log
 */
function readLog() {
  initLogFile();
  try {
    const data = fs.readFileSync(LOG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    console.error('❌ Erreur lecture log:', e.message);
    return { searches: [], invitations: [], strategyStats: {} };
  }
}

/**
 * Écrit les données de performance
 * @param {Object} data - Données à écrire
 */
function writeLog(data) {
  try {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(LOG_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('❌ Erreur écriture log:', e.message);
  }
}

/**
 * Logger un résultat de recherche
 * @param {string} strategy - ID de la stratégie
 * @param {string} query - Requête de recherche
 * @param {Object} results - { total, qualified, sent }
 */
function logSearchResult(strategy, query, results) {
  const log = readLog();
  
  const searchEntry = {
    timestamp: new Date().toISOString(),
    strategy,
    query,
    totalResults: results.total || 0,
    qualifiedResults: results.qualified || 0,
    invitationsSent: results.sent || 0,
  };
  
  log.searches.push(searchEntry);
  
  // Mettre à jour les stats par stratégie
  if (!log.strategyStats[strategy]) {
    log.strategyStats[strategy] = {
      totalSearches: 0,
      totalResults: 0,
      totalQualified: 0,
      totalSent: 0,
      totalAccepted: 0,
      totalReplied: 0,
      paused: false,
    };
  }
  
  const stats = log.strategyStats[strategy];
  stats.totalSearches++;
  stats.totalResults += searchEntry.totalResults;
  stats.totalQualified += searchEntry.qualifiedResults;
  stats.totalSent += searchEntry.invitationsSent;
  
  writeLog(log);
  
  console.log(`📊 Search logged: ${strategy} → ${results.qualified}/${results.total} qualified`);
}

/**
 * Logger le résultat d'une invitation
 * @param {string} prospectId - ID du prospect
 * @param {string} strategy - Stratégie source
 * @param {boolean} accepted - Invitation acceptée ?
 * @param {boolean} replied - A répondu ?
 */
function logInvitationOutcome(prospectId, strategy, accepted = false, replied = false) {
  const log = readLog();
  
  // Chercher l'invitation existante ou créer une nouvelle entrée
  const existingIndex = log.invitations.findIndex(inv => inv.prospectId === prospectId);
  
  if (existingIndex >= 0) {
    // Mettre à jour
    log.invitations[existingIndex].accepted = accepted;
    log.invitations[existingIndex].replied = replied;
    log.invitations[existingIndex].lastUpdated = new Date().toISOString();
  } else {
    // Créer nouvelle entrée
    log.invitations.push({
      prospectId,
      strategy,
      sentAt: new Date().toISOString(),
      accepted,
      replied,
      lastUpdated: new Date().toISOString(),
    });
  }
  
  // Mettre à jour les stats de stratégie
  if (log.strategyStats[strategy]) {
    if (accepted) log.strategyStats[strategy].totalAccepted++;
    if (replied) log.strategyStats[strategy].totalReplied++;
  }
  
  writeLog(log);
  
  console.log(`📊 Invitation outcome: ${prospectId} (${strategy}) → accepted:${accepted}, replied:${replied}`);
}

/**
 * Calculer les poids des stratégies basés sur les performances
 * @returns {Object} Map strategyId → poids (0.0 - 2.0)
 */
function getStrategyWeights() {
  const log = readLog();
  const weights = {};
  
  Object.entries(log.strategyStats).forEach(([strategyId, stats]) => {
    // Par défaut, poids = 1.0
    let weight = 1.0;
    
    // Si en pause, poids = 0
    if (stats.paused) {
      weight = 0.0;
    }
    // Si assez de données
    else if (stats.totalSent >= MIN_SAMPLES) {
      const acceptRate = stats.totalAccepted / stats.totalSent;
      const replyRate = stats.totalReplied / stats.totalSent;
      const qualifiedRate = stats.totalSent > 0 ? stats.totalQualified / stats.totalResults : 0;
      
      // Formule de scoring:
      // - Reply rate est le plus important (×3)
      // - Accept rate est important (×2)
      // - Qualified rate indique la qualité de la recherche (×1)
      const performanceScore = (replyRate * 3) + (acceptRate * 2) + (qualifiedRate * 1);
      
      // Normaliser entre 0.1 et 2.0
      weight = Math.max(0.1, Math.min(2.0, performanceScore * 3));
      
      // Si 0% de réponse après MIN_SAMPLES, mettre en pause
      if (replyRate === 0 && stats.totalSent >= MIN_SAMPLES) {
        stats.paused = true;
        weight = 0.0;
        console.log(`⏸️  Stratégie ${strategyId} mise en pause (0% réponse sur ${stats.totalSent} invitations)`);
      }
    }
    
    weights[strategyId] = weight;
  });
  
  // Sauvegarder les changements (pause)
  writeLog(log);
  
  return weights;
}

/**
 * Retourne les meilleures stratégies par performance
 * @param {number} n - Nombre de stratégies à retourner
 * @returns {Array} Liste des n meilleures stratégies avec stats
 */
function getBestStrategies(n = 3) {
  const log = readLog();
  
  const strategies = Object.entries(log.strategyStats)
    .filter(([_, stats]) => stats.totalSent >= MIN_SAMPLES && !stats.paused)
    .map(([strategyId, stats]) => {
      const acceptRate = stats.totalAccepted / stats.totalSent;
      const replyRate = stats.totalReplied / stats.totalSent;
      const qualifiedRate = stats.totalQualified / stats.totalResults;
      
      return {
        strategyId,
        stats,
        acceptRate,
        replyRate,
        qualifiedRate,
        score: (replyRate * 3) + (acceptRate * 2) + (qualifiedRate * 1),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
  
  return strategies;
}

/**
 * Réinitialise une stratégie en pause (pour retester)
 * @param {string} strategyId - ID de la stratégie
 */
function unpauseStrategy(strategyId) {
  const log = readLog();
  if (log.strategyStats[strategyId]) {
    log.strategyStats[strategyId].paused = false;
    writeLog(log);
    console.log(`▶️  Stratégie ${strategyId} réactivée`);
  }
}

/**
 * Génère un rapport de performance
 * @returns {Object} Rapport détaillé
 */
function generateReport() {
  const log = readLog();
  const weights = getStrategyWeights();
  
  const report = {
    totalSearches: log.searches.length,
    totalInvitations: log.invitations.length,
    totalAccepted: log.invitations.filter(inv => inv.accepted).length,
    totalReplied: log.invitations.filter(inv => inv.replied).length,
    strategies: {},
  };
  
  Object.entries(log.strategyStats).forEach(([strategyId, stats]) => {
    report.strategies[strategyId] = {
      ...stats,
      weight: weights[strategyId] || 1.0,
      acceptRate: stats.totalSent > 0 ? (stats.totalAccepted / stats.totalSent * 100).toFixed(1) + '%' : 'N/A',
      replyRate: stats.totalSent > 0 ? (stats.totalReplied / stats.totalSent * 100).toFixed(1) + '%' : 'N/A',
      qualifiedRate: stats.totalResults > 0 ? (stats.totalQualified / stats.totalResults * 100).toFixed(1) + '%' : 'N/A',
    };
  });
  
  return report;
}

module.exports = {
  logSearchResult,
  logInvitationOutcome,
  getStrategyWeights,
  getBestStrategies,
  unpauseStrategy,
  generateReport,
};
