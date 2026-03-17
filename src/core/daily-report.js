require('dotenv').config();
const { getTodayStats, getWeekStats } = require('./action-logger.js');
const { getSelfHealStats } = require('./self-heal.js');
const https = require('https');
const path = require('path');
const fs = require('fs');

/**
 * Daily Report — Génère et envoie le bilan quotidien via Telegram
 * Config Telegram : token + chat_id
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * Envoie un message Telegram
 */
function sendTelegramMessage(text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'Markdown'
    });
    const byteLength = Buffer.byteLength(data, 'utf8');

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': byteLength
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Telegram API error: ${res.statusCode} ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Récupère les stats de la veille pour comparaison
 */
function getYesterdayStats() {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];
    const logFile = path.join(__dirname, '../../logs', `actions-${dateStr}.json`);
    
    if (!fs.existsSync(logFile)) {
      return null;
    }
    
    const actions = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    const success = actions.filter(a => a.success).length;
    const total = actions.length;
    
    return {
      total,
      success,
      fail: total - success,
      success_rate: total > 0 ? Math.round((success / total) * 100) : 0
    };
  } catch (error) {
    return null;
  }
}

/**
 * Génère des recommandations automatiques
 */
function generateRecommendations(todayStats, yesterdayStats, selfHealStats) {
  const recommendations = [];
  
  // Taux de succès faible
  if (todayStats.success_rate < 70) {
    recommendations.push('⚠️ Taux de succès faible — vérifier les sélecteurs LinkedIn');
  }
  
  // Régression vs hier
  if (yesterdayStats && todayStats.success_rate < yesterdayStats.success_rate - 10) {
    recommendations.push('📉 Régression vs hier — possible changement UI LinkedIn');
  }
  
  // Beaucoup d'échecs self-heal
  if (selfHealStats.stats) {
    const totalFails = Object.values(selfHealStats.stats).reduce((sum, s) => sum + (s.fail || 0), 0);
    if (totalFails > 10) {
      recommendations.push('🔧 Beaucoup d\'échecs sélecteurs — mettre à jour config/selectors.json');
    }
  }
  
  // Pas d'actions
  if (todayStats.total === 0) {
    recommendations.push('😴 Aucune action aujourd\'hui — vérifier les crons');
  }
  
  // Progression vs hier
  if (yesterdayStats && todayStats.success_rate > yesterdayStats.success_rate + 5) {
    recommendations.push('🚀 Progression vs hier — bon travail !');
  }
  
  // Self-heal qui apprend bien
  if (selfHealStats.learned_count > 5) {
    recommendations.push(`🧠 Self-heal apprend bien (${selfHealStats.learned_count} sélecteurs)`);
  }
  
  if (recommendations.length === 0) {
    recommendations.push('✅ Tout roule, continue comme ça !');
  }
  
  return recommendations;
}

/**
 * Formate le rapport quotidien
 */
function formatDailyReport(todayStats, yesterdayStats, weekStats, selfHealStats) {
  let report = '📊 *LINKEDIN AUTOMATION — BILAN QUOTIDIEN*\n\n';
  
  // Date
  report += `📅 *Date* : ${todayStats.date}\n\n`;
  
  // Stats du jour
  report += `*📈 STATS DU JOUR*\n`;
  report += `Actions : ${todayStats.total}\n`;
  report += `✅ Succès : ${todayStats.success} (${todayStats.success_rate}%)\n`;
  report += `❌ Échecs : ${todayStats.fail}\n\n`;
  
  // Détail par action
  if (Object.keys(todayStats.by_action).length > 0) {
    report += `*DÉTAIL PAR ACTION*\n`;
    Object.entries(todayStats.by_action).forEach(([action, stats]) => {
      const icon = action === 'like' ? '👍' : action === 'comment' ? '💬' : action === 'connect' ? '🤝' : '📤';
      const rate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0;
      report += `${icon} ${action} : ${stats.success}/${stats.total} (${rate}%)\n`;
    });
    report += '\n';
  }
  
  // Tendance vs veille
  if (yesterdayStats) {
    const diff = todayStats.success_rate - yesterdayStats.success_rate;
    const trend = diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️';
    const sign = diff > 0 ? '+' : '';
    report += `*TENDANCE VS VEILLE*\n`;
    report += `${trend} ${sign}${diff}% (hier : ${yesterdayStats.success_rate}%)\n\n`;
  }
  
  // Top erreurs
  const topErrors = Object.entries(todayStats.errors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  
  if (topErrors.length > 0) {
    report += `*❌ TOP ERREURS*\n`;
    topErrors.forEach(([error, count]) => {
      report += `• ${error.substring(0, 40)}... (${count}×)\n`;
    });
    report += '\n';
  }
  
  // Prospects contactés
  const connects = todayStats.by_action['connect'] || { success: 0 };
  if (connects.success > 0) {
    report += `*🎯 PROSPECTS CONTACTÉS*\n`;
    report += `${connects.success} nouvelles connexions envoyées\n\n`;
  }
  
  // Self-heal stats
  if (selfHealStats.learned_count > 0) {
    report += `*🔧 SELF-HEAL*\n`;
    report += `Sélecteurs appris : ${selfHealStats.learned_count}\n\n`;
  }
  
  // Recommandations
  const recommendations = generateRecommendations(todayStats, yesterdayStats, selfHealStats);
  report += `*💡 RECOMMANDATIONS*\n`;
  recommendations.forEach(r => {
    report += `${r}\n`;
  });
  
  return report;
}

/**
 * Génère et envoie le rapport quotidien
 */
async function run() {
  try {
    console.log('📊 Génération du rapport quotidien...\n');
    
    // Collecter les stats
    const todayStats = getTodayStats();
    const yesterdayStats = getYesterdayStats();
    const weekStats = getWeekStats();
    const selfHealStats = getSelfHealStats();
    
    // Formater le rapport
    const report = formatDailyReport(todayStats, yesterdayStats, weekStats, selfHealStats);
    
    console.log(report);
    console.log('\n📤 Envoi via Telegram...');
    
    // Envoyer via Telegram
    await sendTelegramMessage(report);
    
    console.log('✅ Rapport envoyé avec succès !');

    // ─── AUTORESEARCH ─────────────────────────────────────────────────────────
    // Après le rapport, lancer l'auto-amélioration du code
    try {
      console.log('\n🔬 Lancement autoresearch...');
      const { run: runAutoresearch } = require('./autoresearch.js');
      const arResult = await runAutoresearch();

      if (arResult.success) {
        const arMsg =
          `\n🔬 *AUTORESEARCH*\n` +
          `Métrique ciblée : ${arResult.metric_targeted}\n` +
          `Modification : ${arResult.description}\n` +
          `Mesure succès : ${arResult.expected_improvement}`;
        await sendTelegramMessage(arMsg);
        console.log('✅ Autoresearch terminé et notifié');
      } else {
        console.log(`⏭️  Autoresearch skipped (${arResult.reason})`);
      }
    } catch (arError) {
      console.error('⚠️  Autoresearch erreur (non bloquant):', arError.message);
    }
    // ──────────────────────────────────────────────────────────────────────────
    
    return { success: true, stats: todayStats };
  } catch (error) {
    console.error('❌ Erreur génération rapport:', error.message);
    throw error;
  }
}

// Si exécuté directement
if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(e => {
      console.error(e);
      process.exit(1);
    });
}

module.exports = { run, formatDailyReport };
