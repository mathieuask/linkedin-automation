/**
 * Prospect Connect v2 — Search → Score → Connect
 * 
 * NOUVELLE VERSION avec smart-search.js et search-learner.js
 * 
 * 2 MODES :
 * - getData(searchQuery)  → retourne les profils scorés (l'agent écrit les notes)
 * - executeConnect(publicId, note)  → envoie l'invitation avec la note générée par l'IA
 * - run()  → mode autonome avec recherche intelligente
 */
require('dotenv').config();
const { getPage, ensureLoggedIn, humanDelay } = require('../core/browser.js');
const { searchPeople, getProfile } = require('../core/linkedin-api.js');
const { sendConnect } = require('../core/linkedin-actions.js');
const { scoreProfile } = require('../core/scoring.js');
const { generateSmartSearch, getRandomStrategy } = require('../core/smart-search.js');
const { getStrategyWeights } = require('../core/search-learner.js');
const { logSearchResult, logInvitationOutcome } = require('../core/search-learner.js');

/**
 * Recherche et score des prospects avec recherche intelligente
 * @param {string|null} searchQuery - Requête manuelle (optionnel)
 * @param {string|null} strategyId - ID stratégie spécifique (optionnel)
 * @returns {Array} Profils scorés
 */
async function getData(searchQuery = null, strategyId = null) {
  const page = await getPage();
  await ensureLoggedIn(page);

  let query, strategy, url;

  if (searchQuery) {
    // Recherche manuelle
    query = searchQuery;
    strategy = 'MANUAL';
    url = null;
    console.log(`🔍 Recherche manuelle: "${query}"`);
  } else {
    // Recherche intelligente
    const weights = getStrategyWeights();
    const selectedStrategy = strategyId 
      ? { id: strategyId }
      : getRandomStrategy(Object.values(weights));
    
    const smartSearch = generateSmartSearch();
    query = smartSearch.query;
    strategy = smartSearch.strategy;
    url = smartSearch.url;
    
    console.log(`🎯 Stratégie: ${smartSearch.strategyName}`);
    console.log(`🔍 Recherche: "${query}"`);
  }

  // Recherche LinkedIn
  const publicIds = await searchPeople(page, query);
  console.log(`   ${publicIds.length} profils trouvés`);

  // Récupération et scoring des profils
  const profiles = [];
  let qualifiedCount = 0;

  for (const id of publicIds.slice(0, 10)) { // Max 10 profils par recherche
    const profile = await getProfile(page, id);
    if (!profile) continue;
    
    const scoring = scoreProfile(profile);
    profiles.push({ ...profile, scoring, strategy });
    
    if (scoring.qualified) qualifiedCount++;
    
    await page.waitForTimeout(humanDelay(400, 800));
  }

  // Logger le résultat de recherche
  logSearchResult(strategy, query, {
    total: publicIds.length,
    qualified: qualifiedCount,
    sent: 0, // Sera mis à jour après envoi
  });

  return profiles
    .sort((a, b) => b.scoring.score - a.scoring.score);
}

/**
 * Envoie une invitation avec une note écrite par l'IA
 * @param {string} publicId — vanityName du profil
 * @param {string|null} note — message PERSONNALISÉ généré par l'agent
 * @param {string|null} strategy — stratégie source (pour tracking)
 * @returns {Object} Résultat de l'envoi
 */
async function executeConnect(publicId, note = null, strategy = null) {
  const page = await getPage();
  const result = await sendConnect(page, publicId, note);
  
  // Logger l'invitation (accepted/replied seront mis à jour plus tard)
  if (result.success && strategy) {
    logInvitationOutcome(publicId, strategy, false, false);
  }
  
  return result;
}

/**
 * Mode autonome : recherche intelligente + connect
 * RECOMMANDATION: Utiliser getData() + executeConnect() avec notes personnalisées
 */
async function run(options = {}) {
  const maxInvitations = options.maxInvitations || parseInt(process.env.DAILY_MAX_INVITATIONS) || 5;
  console.log(`\n🔍 Prospect Connect v2 — max ${maxInvitations}\n`);

  // Recherche intelligente
  const profiles = await getData(options.searchQuery, options.strategyId);
  const qualified = profiles.filter(p => p.scoring.qualified).slice(0, maxInvitations);
  
  console.log(`\n📊 Résultats:`);
  console.log(`   Total: ${profiles.length}`);
  console.log(`   Qualifiés: ${qualified.length}`);
  console.log(`   Hot (≥60): ${qualified.filter(p => p.scoring.score >= 60).length}`);
  console.log(`   Warm (40-59): ${qualified.filter(p => p.scoring.score >= 40 && p.scoring.score < 60).length}`);
  console.log();

  let sent = 0;
  const results = [];
  const page = await getPage();

  for (const profile of qualified) {
    const strategy = profile.strategy || 'UNKNOWN';
    console.log(`\n📤 Connect: ${profile.firstName} ${profile.lastName}`);
    console.log(`   Score: ${profile.scoring.score} — ${profile.scoring.label}`);
    console.log(`   Stratégie: ${strategy}`);
    console.log(`   Raisons: ${profile.scoring.reasons.join(', ')}`);
    
    try {
      // Envoi sans note (l'agent devrait écrire une note personnalisée)
      const result = await sendConnect(page, profile.publicId, null);
      
      if (result.success) {
        sent++;
        console.log(`   ✅ Invitation envoyée (${sent}/${maxInvitations})`);
        
        // Logger l'invitation
        logInvitationOutcome(profile.publicId, strategy, false, false);
        
        results.push({ 
          publicId: profile.publicId, 
          name: `${profile.firstName} ${profile.lastName}`,
          score: profile.scoring.score,
          strategy,
          success: true 
        });
      }
    } catch (e) {
      console.log(`   ❌ ${e.message}`);
      results.push({ 
        publicId: profile.publicId,
        name: `${profile.firstName} ${profile.lastName}`,
        error: e.message 
      });
    }
    
    // Délai entre invitations
    if (sent < qualified.length) {
      const delay = humanDelay(45000, 120000);
      console.log(`   ⏳ Pause ${Math.round(delay/1000)}s...`);
      await page.waitForTimeout(delay);
    }
  }

  console.log(`\n✅ Terminé: ${sent} invitations envoyées\n`);

  return { 
    sent, 
    results, 
    profiles: qualified.map(p => ({
      name: `${p.firstName} ${p.lastName}`,
      headline: p.headline,
      score: p.scoring.score,
      label: p.scoring.label,
      strategy: p.strategy,
    }))
  };
}

/**
 * Met à jour le statut d'une invitation (acceptée/réponse)
 * À appeler quand on vérifie les invitations acceptées
 * @param {string} publicId - ID du prospect
 * @param {string} strategy - Stratégie source
 * @param {boolean} accepted - Acceptée ?
 * @param {boolean} replied - A répondu ?
 */
function updateInvitationStatus(publicId, strategy, accepted, replied) {
  logInvitationOutcome(publicId, strategy, accepted, replied);
  console.log(`📊 Statut mis à jour: ${publicId} → accepted:${accepted}, replied:${replied}`);
}

if (require.main === module) {
  run()
    .then(r => { 
      console.log(JSON.stringify(r, null, 2)); 
      process.exit(0); 
    })
    .catch(e => { 
      console.error('❌', e.message); 
      process.exit(1); 
    });
}

module.exports = { 
  getData, 
  executeConnect, 
  run,
  updateInvitationStatus,
};
