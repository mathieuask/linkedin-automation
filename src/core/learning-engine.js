/**
 * Learning Engine — Cerveau central d'apprentissage adaptatif
 * Tous les composants du pipeline LinkedIn apprennent et s'améliorent avec le temps
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../../logs/learning-data.json');
const MIN_DATA_POINTS = 20; // Minimum avant d'ajuster un comportement
const DECAY_DAYS = 30; // Données > 30j comptent ×0.5
const MAX_ADJUSTMENT_PCT = 0.10; // Max ±10% d'ajustement par semaine
const EXPLORATION_RATE = 0.20; // 20% d'exploration même pour stratégies sous-performantes

// ────────────────────────────────────────────────────────────
// INITIALISATION & PERSISTENCE
// ────────────────────────────────────────────────────────────

function initData() {
  return {
    lastUpdated: new Date().toISOString(),
    search: {
      strategies: {},
      queries: {},
      bestConvertingProfiles: [],
    },
    scoring: {
      profileOutcomes: [],
      adjustments: {
        industry_bonus: {},
        title_bonus: {},
        connection_range_bonus: {},
      },
    },
    messages: {
      invitations: {
        styles: {},
        bestPerforming: null,
        avgAcceptanceRate: 0,
      },
      firstMessages: {
        sent: 0,
        replied: 0,
        meetings: 0,
      },
    },
    posts: {
      published: [],
      pillarPerformance: {},
      bestDay: null,
      bestTime: null,
    },
    comments: {
      posted: 0,
      profileViews: 0,
      connectionsReceived: 0,
      styles: {},
    },
    timing: {
      bestHours: {
        likes: [],
        invitations: [],
        posts: [],
      },
      hourlyResponseRates: {},
    },
  };
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const logsDir = path.dirname(DATA_FILE);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      const data = initData();
      saveData(data);
      return data;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[learning-engine] Erreur chargement données:', err.message);
    return initData();
  }
}

function saveData(data) {
  try {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[learning-engine] Erreur sauvegarde données:', err.message);
  }
}

// ────────────────────────────────────────────────────────────
// TRACKING FUNCTIONS (appelées après chaque action)
// ────────────────────────────────────────────────────────────

function trackSearch(strategy, query, nbResults, nbQualified) {
  const data = loadData();
  
  // Tracker par stratégie
  if (!data.search.strategies[strategy]) {
    data.search.strategies[strategy] = {
      attempts: 0,
      qualified: 0,
      accepted: 0,
      replied: 0,
      meetings: 0,
    };
  }
  data.search.strategies[strategy].attempts += 1;
  data.search.strategies[strategy].qualified += nbQualified;
  
  // Tracker par query
  if (!data.search.queries[query]) {
    data.search.queries[query] = { attempts: 0, qualified: 0 };
  }
  data.search.queries[query].attempts += 1;
  data.search.queries[query].qualified += nbQualified;
  
  saveData(data);
  console.log(`[learning] Recherche trackée: ${strategy} → ${nbQualified}/${nbResults} qualifiés`);
}

function trackInvitation(profileData, noteStyle, sent) {
  const data = loadData();
  
  if (!data.messages.invitations.styles[noteStyle]) {
    data.messages.invitations.styles[noteStyle] = {
      sent: 0,
      accepted: 0,
      rate: 0,
    };
  }
  
  if (sent) {
    data.messages.invitations.styles[noteStyle].sent += 1;
  }
  
  saveData(data);
  console.log(`[learning] Invitation trackée: style=${noteStyle}`);
}

function trackInvitationOutcome(profileId, accepted, replied, meeting) {
  const data = loadData();
  
  // Mettre à jour les taux d'acceptation par style
  // NOTE: Nécessite de stocker profileId → style mapping (à implémenter)
  
  // Pour l'instant, tracker globalement
  if (accepted) {
    console.log(`[learning] Invitation acceptée: ${profileId}`);
  }
  if (replied) {
    console.log(`[learning] Réponse reçue: ${profileId}`);
  }
  if (meeting) {
    console.log(`[learning] Meeting programmé: ${profileId}`);
  }
  
  saveData(data);
}

function trackMessage(profileId, type, sent) {
  const data = loadData();
  
  if (type === 'first_message') {
    data.messages.firstMessages.sent += 1;
  }
  
  saveData(data);
  console.log(`[learning] Message tracké: type=${type}, profileId=${profileId}`);
}

function trackMessageOutcome(profileId, replied, meeting) {
  const data = loadData();
  
  if (replied) {
    data.messages.firstMessages.replied += 1;
  }
  if (meeting) {
    data.messages.firstMessages.meetings += 1;
  }
  
  saveData(data);
  console.log(`[learning] Outcome message: replied=${replied}, meeting=${meeting}`);
}

function trackPost(pillar, topic, date) {
  const data = loadData();
  
  data.posts.published.push({
    date: date || new Date().toISOString().split('T')[0],
    pillar,
    topic,
    impressions: 0,
    likes: 0,
    comments: 0,
    leads: 0,
  });
  
  saveData(data);
  console.log(`[learning] Post publié: pillar=${pillar}, topic=${topic}`);
}

function trackPostPerformance(postId, impressions, likes, comments, leads) {
  const data = loadData();
  
  // Trouver le post par ID (on va utiliser l'index pour simplifier)
  const idx = parseInt(postId);
  if (data.posts.published[idx]) {
    data.posts.published[idx].impressions = impressions;
    data.posts.published[idx].likes = likes;
    data.posts.published[idx].comments = comments;
    data.posts.published[idx].leads = leads;
    
    // Mettre à jour les perfs par pillar
    const pillar = data.posts.published[idx].pillar;
    if (!data.posts.pillarPerformance[pillar]) {
      data.posts.pillarPerformance[pillar] = {
        avgImpressions: 0,
        avgEngagement: 0,
        leads: 0,
      };
    }
    
    // Recalculer les moyennes
    const pillarPosts = data.posts.published.filter(p => p.pillar === pillar);
    const totalImpressions = pillarPosts.reduce((sum, p) => sum + p.impressions, 0);
    const totalEngagement = pillarPosts.reduce((sum, p) => sum + (p.likes + p.comments), 0);
    const totalLeads = pillarPosts.reduce((sum, p) => sum + p.leads, 0);
    
    data.posts.pillarPerformance[pillar].avgImpressions = totalImpressions / pillarPosts.length;
    data.posts.pillarPerformance[pillar].avgEngagement = totalEngagement / pillarPosts.length;
    data.posts.pillarPerformance[pillar].leads = totalLeads;
  }
  
  saveData(data);
  console.log(`[learning] Performance post mise à jour: ${impressions} impressions, ${likes} likes`);
}

function trackComment(style, activityId) {
  const data = loadData();
  
  data.comments.posted += 1;
  
  if (!data.comments.styles[style]) {
    data.comments.styles[style] = {
      count: 0,
      profileViews: 0,
    };
  }
  data.comments.styles[style].count += 1;
  
  saveData(data);
  console.log(`[learning] Commentaire tracké: style=${style}`);
}

function trackCommentOutcome(activityId, profileViews, connectionsReceived) {
  const data = loadData();
  
  data.comments.profileViews += profileViews;
  data.comments.connectionsReceived += connectionsReceived;
  
  saveData(data);
  console.log(`[learning] Outcome commentaire: ${profileViews} vues, ${connectionsReceived} connexions`);
}

function trackAction(actionType, hour, success) {
  const data = loadData();
  
  if (!data.timing.hourlyResponseRates[actionType]) {
    data.timing.hourlyResponseRates[actionType] = {};
  }
  
  if (!data.timing.hourlyResponseRates[actionType][hour]) {
    data.timing.hourlyResponseRates[actionType][hour] = {
      total: 0,
      success: 0,
    };
  }
  
  data.timing.hourlyResponseRates[actionType][hour].total += 1;
  if (success) {
    data.timing.hourlyResponseRates[actionType][hour].success += 1;
  }
  
  saveData(data);
}

// ────────────────────────────────────────────────────────────
// INTELLIGENCE FUNCTIONS (appelées pour prendre des décisions)
// ────────────────────────────────────────────────────────────

function getBestSearchStrategy() {
  const data = loadData();
  const strategies = data.search.strategies;
  
  // Calculer le taux de conversion pour chaque stratégie
  const rates = {};
  let bestStrategy = null;
  let bestRate = 0;
  
  for (const [name, stats] of Object.entries(strategies)) {
    if (stats.attempts < MIN_DATA_POINTS) {
      // Pas assez de données, garder pondération neutre
      rates[name] = { rate: 0.5, confidence: 'low', attempts: stats.attempts };
      continue;
    }
    
    // Taux de conversion = (qualified / attempts)
    const rate = stats.attempts > 0 ? stats.qualified / stats.attempts : 0;
    rates[name] = { rate, confidence: 'medium', attempts: stats.attempts };
    
    if (rate > bestRate) {
      bestRate = rate;
      bestStrategy = name;
    }
  }
  
  return {
    best: bestStrategy,
    rates,
    recommendation: bestStrategy
      ? `Privilégier ${bestStrategy} (${(bestRate * 100).toFixed(1)}% qualified)`
      : 'Pas assez de données, continuer exploration',
  };
}

function getScoringAdjustments() {
  const data = loadData();
  
  // Si moins de MIN_DATA_POINTS outcomes, retourner ajustements par défaut
  if (data.scoring.profileOutcomes.length < MIN_DATA_POINTS) {
    return data.scoring.adjustments;
  }
  
  // Sinon, calculer les ajustements basés sur les résultats
  // (logique simplifiée, à affiner selon les besoins)
  
  return data.scoring.adjustments;
}

function getBestInvitationStyle() {
  const data = loadData();
  const styles = data.messages.invitations.styles;
  
  let bestStyle = null;
  let bestRate = 0;
  
  for (const [name, stats] of Object.entries(styles)) {
    if (stats.sent < MIN_DATA_POINTS) continue;
    
    const rate = stats.sent > 0 ? stats.accepted / stats.sent : 0;
    if (rate > bestRate) {
      bestRate = rate;
      bestStyle = name;
    }
  }
  
  return {
    best: bestStyle,
    rate: bestRate,
    confidence: bestStyle ? 'medium' : 'low',
  };
}

function getBestPostPillar() {
  const data = loadData();
  const pillars = data.posts.pillarPerformance;
  
  let bestPillar = null;
  let bestScore = 0;
  
  for (const [name, stats] of Object.entries(pillars)) {
    // Score = engagement moyen + (leads × 100)
    const score = stats.avgEngagement + (stats.leads * 100);
    if (score > bestScore) {
      bestScore = score;
      bestPillar = name;
    }
  }
  
  return {
    best: bestPillar,
    pillars,
    confidence: bestPillar ? 'medium' : 'low',
  };
}

function getBestCommentStyle() {
  const data = loadData();
  const styles = data.comments.styles;
  
  let bestStyle = null;
  let bestRate = 0;
  
  for (const [name, stats] of Object.entries(styles)) {
    if (stats.count < MIN_DATA_POINTS) continue;
    
    const rate = stats.count > 0 ? stats.profileViews / stats.count : 0;
    if (rate > bestRate) {
      bestRate = rate;
      bestStyle = name;
    }
  }
  
  return {
    best: bestStyle,
    avgViews: bestRate,
    confidence: bestStyle ? 'medium' : 'low',
  };
}

function getBestHours(actionType) {
  const data = loadData();
  
  // Retourner les best hours pré-calculés
  if (data.timing.bestHours[actionType]) {
    return data.timing.bestHours[actionType];
  }
  
  // Sinon, calculer à partir des hourlyResponseRates
  const rates = data.timing.hourlyResponseRates[actionType];
  if (!rates) return [];
  
  const hourStats = [];
  for (const [hour, stats] of Object.entries(rates)) {
    if (stats.total < 5) continue; // Pas assez de données
    const successRate = stats.success / stats.total;
    hourStats.push({ hour: parseInt(hour), rate: successRate, total: stats.total });
  }
  
  // Trier par taux de succès décroissant
  hourStats.sort((a, b) => b.rate - a.rate);
  
  // Retourner top 3
  return hourStats.slice(0, 3).map(h => h.hour);
}

function getWeeklyInsights() {
  const data = loadData();
  const insights = [];
  
  // 1. Top stratégies de recherche
  const searchStrategy = getBestSearchStrategy();
  if (searchStrategy.best) {
    insights.push(`🎯 Meilleure stratégie: ${searchStrategy.best} (${(searchStrategy.rates[searchStrategy.best].rate * 100).toFixed(1)}% qualified)`);
  }
  
  // 2. Top style d'invitation
  const invitationStyle = getBestInvitationStyle();
  if (invitationStyle.best) {
    insights.push(`💬 Meilleur style invitation: ${invitationStyle.best} (${(invitationStyle.rate * 100).toFixed(1)}% acceptation)`);
  }
  
  // 3. Meilleur pilier de contenu
  const postPillar = getBestPostPillar();
  if (postPillar.best) {
    insights.push(`📝 Meilleur pilier: ${postPillar.best}`);
  }
  
  // 4. Stats globales
  const totalSearches = Object.values(data.search.strategies).reduce((sum, s) => sum + s.attempts, 0);
  const totalQualified = Object.values(data.search.strategies).reduce((sum, s) => sum + s.qualified, 0);
  insights.push(`📊 ${totalSearches} recherches → ${totalQualified} prospects qualifiés`);
  
  // 5. Taux de réponse messages
  if (data.messages.firstMessages.sent > 0) {
    const replyRate = (data.messages.firstMessages.replied / data.messages.firstMessages.sent * 100).toFixed(1);
    insights.push(`📬 Taux réponse messages: ${replyRate}%`);
  }
  
  return insights;
}

// ────────────────────────────────────────────────────────────
// RAPPORTS
// ────────────────────────────────────────────────────────────

function generateLearningReport() {
  const insights = getWeeklyInsights();
  const confidence = getConfidenceLevel();
  
  let report = '📈 RAPPORT D\'APPRENTISSAGE HEBDOMADAIRE\n\n';
  report += insights.map(i => `• ${i}`).join('\n');
  report += `\n\n🎲 Confiance des données: ${confidence.level} (${confidence.dataPoints} data points)`;
  
  if (confidence.recommendations.length > 0) {
    report += '\n\n💡 Recommandations:\n';
    report += confidence.recommendations.map(r => `• ${r}`).join('\n');
  }
  
  return report;
}

function getConfidenceLevel() {
  const data = loadData();
  
  // Compter le nombre total de data points
  let totalDataPoints = 0;
  
  // Recherches
  totalDataPoints += Object.values(data.search.strategies).reduce((sum, s) => sum + s.attempts, 0);
  
  // Invitations
  totalDataPoints += Object.values(data.messages.invitations.styles).reduce((sum, s) => sum + s.sent, 0);
  
  // Posts
  totalDataPoints += data.posts.published.length;
  
  // Commentaires
  totalDataPoints += data.comments.posted;
  
  let level = 'très faible';
  const recommendations = [];
  
  if (totalDataPoints < 50) {
    level = 'très faible';
    recommendations.push('Continuer la collecte de données (moins de 50 actions)');
  } else if (totalDataPoints < 200) {
    level = 'faible';
    recommendations.push('Encore trop tôt pour des conclusions solides');
  } else if (totalDataPoints < 500) {
    level = 'moyen';
    recommendations.push('Les tendances commencent à émerger');
  } else if (totalDataPoints < 1000) {
    level = 'bon';
  } else {
    level = 'excellent';
  }
  
  return {
    level,
    dataPoints: totalDataPoints,
    recommendations,
  };
}

// ────────────────────────────────────────────────────────────
// EXPORTS
// ────────────────────────────────────────────────────────────

module.exports = {
  // Tracking
  trackSearch,
  trackInvitation,
  trackInvitationOutcome,
  trackMessage,
  trackMessageOutcome,
  trackPost,
  trackPostPerformance,
  trackComment,
  trackCommentOutcome,
  trackAction,
  
  // Intelligence
  getBestSearchStrategy,
  getScoringAdjustments,
  getBestInvitationStyle,
  getBestPostPillar,
  getBestCommentStyle,
  getBestHours,
  getWeeklyInsights,
  
  // Rapports
  generateLearningReport,
  getConfidenceLevel,
};
