/**
 * Shadow Ban Detector — Détecte automatiquement si le compte LinkedIn est shadow ban
 * 
 * Méthodes :
 * - Détection passive après chaque action (message, like, comment, invitation, post)
 * - Vérification proactive quotidienne (message à soi-même, profil visible, notifications)
 * - Score de santé du compte 0-100
 * - Alertes Telegram si score < 50
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const HEALTH_FILE = path.resolve(__dirname, '../../config/account-health.json');

/**
 * Charger l'état de santé du compte
 */
function loadHealth() {
  try {
    if (fs.existsSync(HEALTH_FILE)) {
      return JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('⚠️ Erreur chargement account-health.json:', error.message);
  }

  // État par défaut
  return {
    lastCheck: new Date().toISOString(),
    healthScore: 100,
    actions: {
      messages: { status: 'unknown', lastVerified: null, failCount: 0 },
      invitations: { status: 'unknown', lastVerified: null, failCount: 0 },
      posts: { status: 'unknown', lastVerified: null, failCount: 0 },
      likes: { status: 'unknown', lastVerified: null, failCount: 0 },
      comments: { status: 'unknown', lastVerified: null, failCount: 0 },
    },
    warmup: { startDate: null, currentDay: 0, stage: 'normal' },
    dailyCounts: {},
    signals: [],
  };
}

/**
 * Sauvegarder l'état de santé
 */
function saveHealth(health) {
  try {
    const dir = path.dirname(HEALTH_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HEALTH_FILE, JSON.stringify(health, null, 2));
  } catch (error) {
    console.error('⚠️ Erreur sauvegarde account-health.json:', error.message);
  }
}

/**
 * Calculer le score de santé global (0-100)
 */
function calculateHealthScore(health) {
  let score = 100;
  const actions = health.actions;

  // Chaque action banned = -20 points
  for (const [key, data] of Object.entries(actions)) {
    if (data.status === 'banned') score -= 20;
    else if (data.status === 'unknown') score -= 5;
  }

  // Pénalité pour les signaux de danger
  const dangerSignals = health.signals.filter(s => 
    s.type === 'captcha' || 
    s.type === 'unusual_activity' || 
    s.type === 'verification_required'
  );
  score -= dangerSignals.length * 10;

  return Math.max(0, Math.min(100, score));
}

/**
 * Envoyer une alerte Telegram
 */
async function sendTelegramAlert(message) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
    });
    const data = await response.json();
    if (!data.ok) console.error('⚠️ Erreur Telegram:', data.description);
  } catch (error) {
    console.error('⚠️ Erreur envoi Telegram:', error.message);
  }
}

/**
 * Vérification rapide au début de chaque session
 * Vérifie les signaux basiques sans effectuer d'actions
 */
async function checkQuick() {
  const health = loadHealth();
  const score = calculateHealthScore(health);

  console.log(`🏥 Score de santé: ${score}/100`);

  if (score < 50) {
    const bannedActions = Object.entries(health.actions)
      .filter(([_, data]) => data.status === 'banned')
      .map(([key]) => key);

    const message = `⚠️ ALERTE LinkedIn Shadow Ban\n\nScore: ${score}/100\nActions bannies: ${bannedActions.join(', ') || 'aucune'}\n\nVérifiez le compte manuellement.`;
    
    console.error(message);
    await sendTelegramAlert(message);

    return { healthy: false, score, bannedActions };
  }

  return { healthy: true, score };
}

/**
 * Vérifier si un message a bien été envoyé (détection passive)
 * @param {object} page - page Playwright
 * @param {string} conversationId - ID de la conversation
 * @param {string} messageText - texte du message envoyé
 */
async function verifyMessageSent(page, conversationId, messageText) {
  try {
    // Attendre 2 secondes
    await page.waitForTimeout(2000);

    // Reloader la conversation
    await page.goto(`https://www.linkedin.com/messaging/thread/${conversationId}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await page.waitForTimeout(3000);

    // Chercher le message dans le thread
    const messageFound = await page.evaluate((text) => {
      const messages = Array.from(document.querySelectorAll('.msg-s-message-list__event'));
      return messages.some(msg => msg.textContent.includes(text));
    }, messageText);

    const health = loadHealth();
    
    if (messageFound) {
      health.actions.messages.status = 'ok';
      health.actions.messages.lastVerified = new Date().toISOString();
      health.actions.messages.failCount = 0;
      console.log('✅ Message vérifié : présent dans le thread');
    } else {
      health.actions.messages.failCount++;
      if (health.actions.messages.failCount >= 3) {
        health.actions.messages.status = 'banned';
        await sendTelegramAlert('⚠️ SHADOW BAN MESSAGES détecté\n\n3 messages envoyés mais absents du thread.');
      }
      console.log('❌ Message vérifié : ABSENT du thread (possible shadow ban)');
    }

    health.healthScore = calculateHealthScore(health);
    saveHealth(health);

    return { verified: messageFound };
  } catch (error) {
    console.error('⚠️ Erreur vérification message:', error.message);
    return { verified: false, error: error.message };
  }
}

/**
 * Vérifier si un like a bien été enregistré
 */
async function verifyLike(page, activityId) {
  try {
    // Attendre plus longtemps — LinkedIn met à jour l'état avec un délai
    await page.waitForTimeout(4000);

    // Re-fetch le post
    await page.goto(`https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await page.waitForTimeout(3000);

    // Vérifier si le bouton like est actif (plusieurs sélecteurs FR/EN)
    const liked = await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        // Bouton liké : aria-label contient "unlike", "retirer", "annuler", ou "j'aime" déjà actif
        if (
          label.includes('unlike') ||
          label.includes('retirer') ||
          label.includes('annuler le j\'aime') ||
          label.includes('vous avez')
        ) return true;
        // Vérifier via classe CSS active
        if (b.classList.contains('react-button--active')) return true;
      }
      // Vérifier via attribut aria-pressed
      const pressed = document.querySelector('button[aria-pressed="true"][aria-label*="réaction"]');
      if (pressed) return true;
      return false;
    });

    const health = loadHealth();

    if (liked) {
      health.actions.likes.status = 'ok';
      health.actions.likes.lastVerified = new Date().toISOString();
      health.actions.likes.failCount = 0;
      console.log('✅ Like vérifié : enregistré');
    } else {
      health.actions.likes.failCount++;
      if (health.actions.likes.failCount >= 5) {
        health.actions.likes.status = 'banned';
        await sendTelegramAlert('⚠️ SHADOW BAN LIKES détecté\n\n5 likes effectués mais non enregistrés.');
      }
      console.log('❌ Like vérifié : NON enregistré (possible shadow ban)');
    }

    health.healthScore = calculateHealthScore(health);
    saveHealth(health);

    return { verified: liked };
  } catch (error) {
    console.error('⚠️ Erreur vérification like:', error.message);
    return { verified: false, error: error.message };
  }
}

/**
 * Vérifier si un commentaire a bien été posté
 */
async function verifyComment(page, activityId, commentText) {
  try {
    await page.waitForTimeout(2000);

    // Reload le post
    await page.goto(`https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await page.waitForTimeout(3000);

    // Chercher le commentaire
    const commentFound = await page.evaluate((text) => {
      const comments = Array.from(document.querySelectorAll('.comments-comment-item'));
      return comments.some(c => c.textContent.includes(text));
    }, commentText);

    const health = loadHealth();

    if (commentFound) {
      health.actions.comments.status = 'ok';
      health.actions.comments.lastVerified = new Date().toISOString();
      health.actions.comments.failCount = 0;
      console.log('✅ Commentaire vérifié : visible');
    } else {
      health.actions.comments.failCount++;
      if (health.actions.comments.failCount >= 3) {
        health.actions.comments.status = 'banned';
        await sendTelegramAlert('⚠️ SHADOW BAN COMMENTS détecté\n\n3 commentaires postés mais invisibles.');
      }
      console.log('❌ Commentaire vérifié : INVISIBLE (possible shadow ban)');
    }

    health.healthScore = calculateHealthScore(health);
    saveHealth(health);

    return { verified: commentFound };
  } catch (error) {
    console.error('⚠️ Erreur vérification commentaire:', error.message);
    return { verified: false, error: error.message };
  }
}

/**
 * Vérifier si un post a bien été publié
 */
async function verifyPost(page, postText) {
  try {
    // Attendre 1 minute (LinkedIn peut prendre du temps)
    console.log('⏳ Attente 60s avant vérification du post...');
    await page.waitForTimeout(60000);

    // Aller sur son propre profil
    await page.goto('https://www.linkedin.com/feed/', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await page.waitForTimeout(5000);

    // Chercher le post dans le feed
    const postFound = await page.evaluate((text) => {
      const posts = Array.from(document.querySelectorAll('[data-id^="urn:li:activity"]'));
      return posts.some(p => p.textContent.includes(text.substring(0, 50))); // Premier 50 caractères
    }, postText);

    const health = loadHealth();

    if (postFound) {
      health.actions.posts.status = 'ok';
      health.actions.posts.lastVerified = new Date().toISOString();
      health.actions.posts.failCount = 0;
      console.log('✅ Post vérifié : visible dans le feed');
    } else {
      health.actions.posts.failCount++;
      if (health.actions.posts.failCount >= 2) {
        health.actions.posts.status = 'banned';
        await sendTelegramAlert('⚠️ SHADOW BAN POSTS détecté\n\n2 posts publiés mais invisibles dans le feed.');
      }
      console.log('❌ Post vérifié : INVISIBLE (possible shadow ban)');
    }

    health.healthScore = calculateHealthScore(health);
    saveHealth(health);

    return { verified: postFound };
  } catch (error) {
    console.error('⚠️ Erreur vérification post:', error.message);
    return { verified: false, error: error.message };
  }
}

/**
 * Vérification proactive quotidienne (1x/jour)
 * - Envoie un message à soi-même
 * - Vérifie la visibilité du profil
 * - Checke les notifications LinkedIn pour avertissements
 */
async function runDailyCheck(page) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🏥 Vérification quotidienne Shadow Ban');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const health = loadHealth();

  try {
    // 1. Message à soi-même
    console.log('1️⃣ Test message à soi-même...');
    const testMessage = `Test shadow ban ${new Date().toISOString()}`;
    
    // TODO: Implémenter l'envoi de message à soi-même via sendMessage()
    // Pour l'instant on skip cette partie car elle nécessite le profil ID
    console.log('⏭️ Skip (à implémenter avec le profil ID)');

    // 2. Vérification visibilité profil
    console.log('2️⃣ Vérification visibilité profil...');
    // TODO: Vérifier via Google "site:linkedin.com/in/username"
    console.log('⏭️ Skip (nécessite proxy externe)');

    // 3. Check notifications
    console.log('3️⃣ Check notifications LinkedIn...');
    await page.goto('https://www.linkedin.com/notifications/', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await page.waitForTimeout(3000);

    const warningFound = await page.evaluate(() => {
      const notifications = Array.from(document.querySelectorAll('.notification-item'));
      return notifications.some(n => {
        const text = n.textContent.toLowerCase();
        return text.includes('activité inhabituelle') || 
               text.includes('unusual activity') ||
               text.includes('vérification') ||
               text.includes('verification');
      });
    });

    if (warningFound) {
      health.signals.push({
        type: 'unusual_activity',
        detected: new Date().toISOString(),
      });
      await sendTelegramAlert('⚠️ ALERTE LinkedIn\n\nNotification "activité inhabituelle" détectée dans les notifications.');
      console.log('❌ Notification d\'avertissement détectée');
    } else {
      console.log('✅ Aucune notification d\'avertissement');
    }

    // Update health
    health.lastCheck = new Date().toISOString();
    health.healthScore = calculateHealthScore(health);
    saveHealth(health);

    console.log(`\n🏥 Score de santé final: ${health.healthScore}/100\n`);

    return { success: true, healthScore: health.healthScore };
  } catch (error) {
    console.error('❌ Erreur vérification quotidienne:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Enregistrer un signal de danger (CAPTCHA, etc.)
 */
function recordDangerSignal(type, details = {}) {
  const health = loadHealth();
  
  health.signals.push({
    type,
    detected: new Date().toISOString(),
    ...details,
  });

  // Alerte immédiate pour les signaux critiques
  if (type === 'captcha' || type === 'verification_required') {
    sendTelegramAlert(`🚨 SIGNAL CRITIQUE: ${type}\n\nRéduire immédiatement l'activité LinkedIn.`);
  }

  health.healthScore = calculateHealthScore(health);
  saveHealth(health);
}

module.exports = {
  checkQuick,
  verifyMessageSent,
  verifyLike,
  verifyComment,
  verifyPost,
  runDailyCheck,
  recordDangerSignal,
  loadHealth,
  saveHealth,
  calculateHealthScore,
};
