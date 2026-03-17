require('dotenv').config();
const fs = require('fs');
const path = require('path');

/**
 * Self-Heal — Système d'auto-réparation des sélecteurs LinkedIn
 * Maintient config/selectors-learned.json avec les sélecteurs qui marchent
 */

const SELECTORS_FILE = path.resolve(__dirname, '../../config/selectors-learned.json');

// Sélecteurs alternatifs connus par action
const FALLBACK_SELECTORS = {
  like: [
    { method: 'aria-label', selector: 'button[aria-label*="Like"]', lang: 'en' },
    { method: 'aria-label', selector: 'button[aria-label*="J\'aime"]', lang: 'fr' },
    { method: 'aria-label', selector: 'button[aria-label*="Liker"]', lang: 'fr' },
    { method: 'data-control', selector: 'button[data-control-name="like"]', lang: 'all' },
    { method: 'class', selector: 'button.react-button__trigger', lang: 'all' },
    { method: 'role+text', selector: 'button:has-text("Like")', lang: 'en' },
    { method: 'role+text', selector: 'button:has-text("J\'aime")', lang: 'fr' }
  ],
  comment: [
    { method: 'aria-label', selector: 'button[aria-label*="Comment"]', lang: 'en' },
    { method: 'aria-label', selector: 'button[aria-label*="Commenter"]', lang: 'fr' },
    { method: 'data-control', selector: 'button[data-control-name="comment"]', lang: 'all' },
    { method: 'role+text', selector: 'button:has-text("Comment")', lang: 'en' },
    { method: 'role+text', selector: 'button:has-text("Commenter")', lang: 'fr' }
  ],
  connect: [
    { method: 'aria-label', selector: 'button[aria-label*="Connect"]', lang: 'en' },
    { method: 'aria-label', selector: 'button[aria-label*="Se connecter"]', lang: 'fr' },
    { method: 'aria-label', selector: 'button[aria-label*="Invitation"]', lang: 'fr' },
    { method: 'data-control', selector: 'button[data-control-name="connect"]', lang: 'all' },
    { method: 'role+text', selector: 'button:has-text("Connect")', lang: 'en' },
    { method: 'role+text', selector: 'button:has-text("Se connecter")', lang: 'fr' }
  ],
  send_invitation: [
    { method: 'aria-label', selector: 'button[aria-label*="Send now"]', lang: 'en' },
    { method: 'aria-label', selector: 'button[aria-label*="Envoyer maintenant"]', lang: 'fr' },
    { method: 'aria-label', selector: 'button[aria-label*="Send"]', lang: 'en' },
    { method: 'data-control', selector: 'button[data-control-name="send_invite"]', lang: 'all' },
    { method: 'role+text', selector: 'button:has-text("Send now")', lang: 'en' },
    { method: 'role+text', selector: 'button:has-text("Envoyer")', lang: 'fr' }
  ],
  add_note: [
    { method: 'aria-label', selector: 'button[aria-label*="Add a note"]', lang: 'en' },
    { method: 'aria-label', selector: 'button[aria-label*="Ajouter une note"]', lang: 'fr' },
    { method: 'data-control', selector: 'button[data-control-name="add_note"]', lang: 'all' },
    { method: 'role+text', selector: 'button:has-text("Add a note")', lang: 'en' }
  ]
};

/**
 * Charge les sélecteurs appris depuis le fichier JSON
 */
function loadLearnedSelectors() {
  try {
    if (!fs.existsSync(SELECTORS_FILE)) {
      // Créer le fichier s'il n'existe pas
      const initial = { learned: {}, stats: {} };
      fs.writeFileSync(SELECTORS_FILE, JSON.stringify(initial, null, 2));
      return initial;
    }
    return JSON.parse(fs.readFileSync(SELECTORS_FILE, 'utf8'));
  } catch (error) {
    console.error('⚠️  Erreur lecture selectors-learned.json:', error.message);
    return { learned: {}, stats: {} };
  }
}

/**
 * Sauvegarde un sélecteur qui a marché
 */
function saveLearnedSelector(actionType, selector, method) {
  try {
    const data = loadLearnedSelectors();
    
    if (!data.learned[actionType]) {
      data.learned[actionType] = [];
    }
    
    // Ajouter seulement si pas déjà présent
    const exists = data.learned[actionType].some(s => s.selector === selector && s.method === method);
    if (!exists) {
      data.learned[actionType].unshift({ selector, method, learned_at: new Date().toISOString() });
      
      // Limiter à 10 sélecteurs par action
      if (data.learned[actionType].length > 10) {
        data.learned[actionType] = data.learned[actionType].slice(0, 10);
      }
    }
    
    // Stats
    if (!data.stats[actionType]) {
      data.stats[actionType] = { success: 0, fail: 0 };
    }
    data.stats[actionType].success++;
    
    fs.writeFileSync(SELECTORS_FILE, JSON.stringify(data, null, 2));
    console.log(`✅ Sélecteur appris : ${actionType} → ${method} (${selector.substring(0, 50)})`);
  } catch (error) {
    console.error('⚠️  Erreur save selector:', error.message);
  }
}

/**
 * Trouve un bouton en essayant toutes les stratégies
 * @param {Page} page - Instance Playwright Page
 * @param {string} actionType - Type d'action (like, comment, connect, etc.)
 * @param {Object} hints - Indices optionnels { parentSelector, context }
 * @returns {Promise<Object>} { element, method, selector } ou null
 */
async function findButton(page, actionType, hints = {}) {
  const data = loadLearnedSelectors();
  const learned = data.learned[actionType] || [];
  const fallbacks = FALLBACK_SELECTORS[actionType] || [];
  
  // Stratégie 1 : Essayer les sélecteurs appris en premier
  console.log(`🔍 [Self-Heal] Recherche bouton "${actionType}" (${learned.length} appris, ${fallbacks.length} fallbacks)`);
  
  for (const sel of learned) {
    try {
      const element = await page.$(sel.selector);
      if (element && await element.isVisible()) {
        console.log(`✅ [Self-Heal] Trouvé via appris : ${sel.method}`);
        return { element, method: sel.method, selector: sel.selector };
      }
    } catch (e) {
      // Continue
    }
  }
  
  // Stratégie 2 : Essayer les fallbacks connus
  for (const fb of fallbacks) {
    try {
      let element = null;
      
      if (fb.method === 'role+text') {
        // Playwright getByRole + text
        const text = fb.selector.match(/:has-text\("(.+)"\)/)?.[1];
        if (text) {
          element = await page.getByRole('button', { name: new RegExp(text, 'i') }).first();
        }
      } else {
        element = await page.$(fb.selector);
      }
      
      if (element && await element.isVisible()) {
        console.log(`✅ [Self-Heal] Trouvé via fallback : ${fb.method} (${fb.lang})`);
        // Sauvegarder ce sélecteur qui marche
        saveLearnedSelector(actionType, fb.selector, fb.method);
        return { element, method: fb.method, selector: fb.selector };
      }
    } catch (e) {
      // Continue
    }
  }
  
  // Stratégie 3 : Recherche par position relative (si parent fourni)
  if (hints.parentSelector) {
    try {
      const parent = await page.$(hints.parentSelector);
      if (parent) {
        const buttons = await parent.$$('button');
        for (const btn of buttons) {
          const text = await btn.textContent();
          const ariaLabel = await btn.getAttribute('aria-label');
          
          // Heuristique basique
          if (actionType === 'like' && (text?.match(/like/i) || ariaLabel?.match(/like|j'aime/i))) {
            console.log(`✅ [Self-Heal] Trouvé via parent relatif`);
            const selector = `${hints.parentSelector} button`;
            saveLearnedSelector(actionType, selector, 'relative');
            return { element: btn, method: 'relative', selector };
          }
        }
      }
    } catch (e) {
      // Continue
    }
  }
  
  // Échec
  console.log(`❌ [Self-Heal] Aucun sélecteur trouvé pour "${actionType}"`);
  
  // Incrémenter stats fail
  if (!data.stats[actionType]) {
    data.stats[actionType] = { success: 0, fail: 0 };
  }
  data.stats[actionType].fail++;
  fs.writeFileSync(SELECTORS_FILE, JSON.stringify(data, null, 2));
  
  return null;
}

/**
 * Stats du self-healing
 */
function getSelfHealStats() {
  const data = loadLearnedSelectors();
  return {
    learned_count: Object.keys(data.learned).reduce((sum, key) => sum + data.learned[key].length, 0),
    stats: data.stats,
    actions: Object.keys(data.learned)
  };
}

module.exports = { findButton, saveLearnedSelector, getSelfHealStats };
