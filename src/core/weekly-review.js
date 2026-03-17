/**
 * Weekly Review — Rapport d'apprentissage hebdomadaire
 * Script qui tourne 1x/semaine (dimanche 20h) pour analyser les apprentissages
 * et proposer des ajustements au système
 */

const {
  getWeeklyInsights,
  generateLearningReport,
  getConfidenceLevel,
  getBestSearchStrategy,
  getBestInvitationStyle,
  getBestPostPillar,
} = require('./learning-engine.js');

/**
 * Génère le rapport hebdomadaire complet
 * @returns {string} Rapport formaté pour Telegram
 */
function generateWeeklyReport() {
  const report = generateLearningReport();
  
  // Ajouter des recommandations spécifiques
  const recommendations = generateRecommendations();
  
  let fullReport = report;
  if (recommendations.length > 0) {
    fullReport += '\n\n🎯 ACTIONS RECOMMANDÉES:\n';
    fullReport += recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n');
  }
  
  return fullReport;
}

/**
 * Génère des recommandations actionnables basées sur les données
 * @returns {Array<string>} Liste de recommandations
 */
function generateRecommendations() {
  const recommendations = [];
  const confidence = getConfidenceLevel();
  
  // Pas de recommandations si confiance trop faible
  if (confidence.dataPoints < 50) {
    recommendations.push('Continuer la collecte de données avant d\'ajuster le système');
    return recommendations;
  }
  
  // Recommandations sur les stratégies de recherche
  try {
    const searchStrategy = getBestSearchStrategy();
    if (searchStrategy.best && searchStrategy.rates[searchStrategy.best]) {
      const bestRate = searchStrategy.rates[searchStrategy.best].rate;
      
      // Trouver la pire stratégie
      let worstStrategy = null;
      let worstRate = 1;
      for (const [name, data] of Object.entries(searchStrategy.rates)) {
        if (data.attempts >= 20 && data.rate < worstRate) {
          worstRate = data.rate;
          worstStrategy = name;
        }
      }
      
      if (worstStrategy && bestRate > worstRate * 1.5) {
        const improvement = ((bestRate - worstRate) / worstRate * 100).toFixed(0);
        recommendations.push(
          `Augmenter la fréquence de recherche "${searchStrategy.best}" (+${improvement}% vs ${worstStrategy})`
        );
      }
    }
  } catch (err) {
    console.warn('[weekly-review] Erreur analyse stratégies:', err.message);
  }
  
  // Recommandations sur les styles d'invitation
  try {
    const invitationStyle = getBestInvitationStyle();
    if (invitationStyle.best && invitationStyle.rate > 0.3) {
      recommendations.push(
        `Continuer avec le style d'invitation "${invitationStyle.best}" (${(invitationStyle.rate * 100).toFixed(0)}% acceptation)`
      );
    } else if (invitationStyle.best && invitationStyle.rate < 0.2) {
      recommendations.push(
        `Tester de nouveaux styles d'invitation (taux actuel: ${(invitationStyle.rate * 100).toFixed(0)}%)`
      );
    }
  } catch (err) {
    console.warn('[weekly-review] Erreur analyse invitations:', err.message);
  }
  
  // Recommandations sur le contenu
  try {
    const postPillar = getBestPostPillar();
    if (postPillar.best) {
      const bestStats = postPillar.pillars[postPillar.best];
      if (bestStats && bestStats.leads > 0) {
        recommendations.push(
          `Focus sur le pilier "${postPillar.best}" (${bestStats.leads} lead(s) générés)`
        );
      }
    }
  } catch (err) {
    console.warn('[weekly-review] Erreur analyse posts:', err.message);
  }
  
  return recommendations;
}

/**
 * Affiche le rapport dans la console
 * (Pour tests locaux)
 */
function displayReport() {
  const report = generateWeeklyReport();
  console.log('\n' + '='.repeat(60));
  console.log(report);
  console.log('='.repeat(60) + '\n');
}

/**
 * Envoie le rapport sur Telegram
 * (Nécessite openclaw message tool)
 * @param {string} channelId - ID du channel Telegram
 */
async function sendToTelegram(channelId) {
  const report = generateWeeklyReport();
  
  // TODO: Implémenter l'envoi via openclaw message tool
  console.log('[weekly-review] Envoi rapport sur Telegram:', channelId);
  console.log(report);
  
  // Exemple (à adapter selon l'API disponible):
  // await sendMessage(channelId, report);
}

/**
 * Main — Exécute la revue hebdomadaire
 */
async function main() {
  console.log('[weekly-review] Génération du rapport hebdomadaire...');
  
  const report = generateWeeklyReport();
  
  // Afficher dans la console
  displayReport();
  
  // Optionnel: Envoyer sur Telegram
  // const telegramChannel = process.env.TELEGRAM_CHANNEL_ID || '-1002381931352';
  // await sendToTelegram(telegramChannel);
  
  console.log('[weekly-review] Rapport généré avec succès ✓');
}

// Si lancé directement (pas en import)
if (require.main === module) {
  main().catch(err => {
    console.error('[weekly-review] Erreur:', err);
    process.exit(1);
  });
}

module.exports = {
  generateWeeklyReport,
  generateRecommendations,
  displayReport,
  sendToTelegram,
  main,
};
