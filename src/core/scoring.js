/**
 * Scoring v2 — Note les profils et posts pour la prospection
 * Customizable ICP criteria (defined in MEMORY.md)
 * 
 * NOUVELLE LOGIQUE:
 * - Disqualification immédiate pour certains critères
 * - Scoring 0-100 pour les profils qualifiés
 * - Seuils: ≥60 = 🔥 Hot, 40-59 = 🟡 Warm, <40 = ❄️ Cold
 */

/**
 * Score un profil prospect (0-100)
 * @param {Object} profile — { firstName, lastName, headline, industryName, locationName, connectionCount, ... }
 * @returns {Object} { score, reasons, qualified, label }
 */
function scoreProfile(profile) {
  let score = 0;
  const reasons = [];
  const disqualified = [];
  
  const hl = (profile.headline || '').toLowerCase();
  const full = `${hl} ${(profile.industryName || '').toLowerCase()} ${(profile.summary || '').toLowerCase()}`;
  const loc = (profile.locationName || '').toLowerCase();
  const connections = profile.connectionCount || 0;

  // ────────────────────────────────────────────────────────────
  // DISQUALIFICATION (score = 0, skip immédiat)
  // ────────────────────────────────────────────────────────────

  // 1. Plus de 10 000 connexions → influenceur, pas un prospect
  if (connections > 10000) {
    disqualified.push('Influenceur (>10K connexions)');
    return {
      score: 0,
      reasons: disqualified,
      qualified: false,
      label: '❌ Disqualifié',
    };
  }

  // 2. Profil incomplet (pas de headline) → fake/inactif
  if (!profile.headline || profile.headline.trim().length === 0) {
    disqualified.push('Profil incomplet (pas de headline)');
    return {
      score: 0,
      reasons: disqualified,
      qualified: false,
      label: '❌ Disqualifié',
    };
  }

  // 3. Auto-entrepreneur / freelance → pas notre cible (et RGPD)
  if (/\b(auto.?entrepreneur|freelance|indépendant|consultant|independent)\b/i.test(hl)) {
    disqualified.push('Freelance/Auto-entrepreneur');
    return {
      score: 0,
      reasons: disqualified,
      qualified: false,
      label: '❌ Disqualifié',
    };
  }

  // 4. Déjà dans notre CRM Notion → doublon
  // NOTE: À implémenter via notion-crm.js (vérifier si publicId existe)
  // if (profile.inCRM) { ... }

  // ────────────────────────────────────────────────────────────
  // SCORING POSITIF (0-100)
  // ────────────────────────────────────────────────────────────

  // ── 1. TITRE (0-25 points) ──
  if (/\b(ceo|cto|coo|cfo|cpo|founder|fondateur|co-?founder|cofondateur|président|president|chief|directeur général)\b/i.test(hl)) {
    score += 25;
    reasons.push('Décideur C-level/Founder (+25)');
  } else if (/\b(vp|vice.?president|head of|directeur|directrice)\b/i.test(hl)) {
    score += 15;
    reasons.push('VP/Director (+15)');
  } else if (/\b(manager|lead|responsable|chef de projet)\b/i.test(hl)) {
    score += 10;
    reasons.push('Manager (+10)');
  }

  // ── 2. TAILLE ENTREPRISE (0-15 points) ──
  const companySize = profile.companySize || 0;
  if (companySize >= 1 && companySize <= 50) {
    score += 15;
    reasons.push('PME 1-50 employés (+15)');
  } else if (companySize >= 51 && companySize <= 200) {
    score += 10;
    reasons.push('PME 51-200 employés (+10)');
  }

  // ── 3. LOCALISATION FRANCE (0-10 points) ──
  if (/france|paris|lyon|marseille|toulouse|nantes|bordeaux|lille|montpellier|strasbourg|rennes|nice|french/i.test(loc + ' ' + full)) {
    score += 10;
    reasons.push('France (+10)');
  }

  // ── 4. MOTS-CLÉS HEADLINE (0-25 points) ──
  // Tech/mobile keywords
  if (/\b(app|mobile|react|ios|android|développement|development|saas|platform|plateforme|digital|application)\b/i.test(hl)) {
    score += 15;
    reasons.push('Mots-clés tech/mobile (+15)');
  }
  
  // Startup/scale-up keywords
  if (/\b(startup|start-up|scale-up|entrepreneur|fondateur|founder)\b/i.test(hl)) {
    score += 10;
    reasons.push('Startup/Scale-up (+10)');
  }

  // ── 5. PROFIL ACTIF (0-10 points) ──
  // NOTE: Nécessite de vérifier si le profil a posté récemment
  // À implémenter via une vérification du feed
  if (profile.recentActivity === true) {
    score += 10;
    reasons.push('Profil actif (+10)');
  }

  // ── 6. NOMBRE DE CONNEXIONS (sweet spot 500-3000) ──
  if (connections >= 500 && connections <= 3000) {
    score += 5;
    reasons.push('500-3000 connexions (sweet spot) (+5)');
  } else if (connections < 500) {
    reasons.push('Moins de 500 connexions (petit réseau)');
  } else if (connections > 5000) {
    score -= 10;
    reasons.push('Plus de 5000 connexions (moins accessible) (-10)');
  }

  // ── 7. INDUSTRIE PRIORITAIRE (bonus) ──
  if (/fintech|healthtech|e-?commerce|saas|foodtech|proptech|edtech|insurtech|legaltech/i.test(full)) {
    score += 5;
    reasons.push('Industrie prioritaire (+5)');
  }

  // ────────────────────────────────────────────────────────────
  // RÉSULTAT FINAL
  // ────────────────────────────────────────────────────────────

  let label = '❄️ Cold';
  let qualified = false;

  if (score >= 60) {
    label = '🔥 Hot';
    qualified = true;
  } else if (score >= 40) {
    label = '🟡 Warm';
    qualified = true;
  }

  // ────────────────────────────────────────────────────────────
  // APPRENTISSAGE ADAPTATIF
  // ────────────────────────────────────────────────────────────
  
  try {
    const { getScoringAdjustments } = require('./learning-engine.js');
    const adj = getScoringAdjustments();
    
    // Appliquer les bonus/malus appris par industrie
    if (adj.industry_bonus && profile.industryName) {
      const industryBonus = adj.industry_bonus[profile.industryName] || 0;
      if (industryBonus !== 0) {
        score += industryBonus;
        reasons.push(`Industrie ${profile.industryName} (appris: ${industryBonus > 0 ? '+' : ''}${industryBonus})`);
      }
    }
    
    // Appliquer les bonus/malus appris par titre
    if (adj.title_bonus && profile.headline) {
      for (const [title, bonus] of Object.entries(adj.title_bonus)) {
        if (new RegExp(`\\b${title}\\b`, 'i').test(profile.headline)) {
          score += bonus;
          reasons.push(`Titre ${title} (appris: ${bonus > 0 ? '+' : ''}${bonus})`);
          break;
        }
      }
    }
    
    // Appliquer les bonus/malus appris par nombre de connexions
    if (adj.connection_range_bonus) {
      let rangeBonus = 0;
      if (connections >= 500 && connections < 2000) {
        rangeBonus = adj.connection_range_bonus['500-2000'] || 0;
      } else if (connections >= 2000 && connections < 5000) {
        rangeBonus = adj.connection_range_bonus['2000-5000'] || 0;
      } else if (connections >= 5000) {
        rangeBonus = adj.connection_range_bonus['5000+'] || 0;
      }
      if (rangeBonus !== 0) {
        score += rangeBonus;
        reasons.push(`Connexions range (appris: ${rangeBonus > 0 ? '+' : ''}${rangeBonus})`);
      }
    }
  } catch (err) {
    // Pas d'erreur fatale si learning engine pas dispo
    console.warn('[scoring] Learning engine non disponible:', err.message);
  }

  return {
    score,
    reasons,
    qualified,
    label,
  };
}

/**
 * Score un post pour l'engagement (0-100)
 * Plus le score est haut, plus on devrait interagir
 */
function scorePostForEngagement(post) {
  let score = 0;
  const reasons = [];

  // Post d'un profil pertinent (pas une entreprise/page)
  if (post.publicId && post.publicId.length > 5) {
    score += 10;
  }

  // Post avec du texte substantiel
  const textLen = (post.text || '').length;
  if (textLen > 200) { score += 15; reasons.push('Texte riche'); }
  else if (textLen > 50) { score += 5; }

  // Post pas trop populaire (éviter les posts viraux = moins de visibilité)
  if (post.likes < 50) { score += 20; reasons.push('Niche (< 50 likes)'); }
  else if (post.likes < 200) { score += 10; reasons.push('Medium reach'); }

  // Post avec quelques commentaires (communauté active)
  if (post.comments > 0 && post.comments < 50) { score += 10; reasons.push('Discussion active'); }

  // Pas encore liké
  if (!post.liked) { score += 15; reasons.push('Pas encore liké'); }

  // Sujet pertinent (tech, startup, mobile, développement)
  const text = (post.text || '').toLowerCase();
  if (/\b(mobile|app|startup|react|développement|development|tech|innovation|mvp|saas)\b/i.test(text)) {
    score += 20;
    reasons.push('Sujet pertinent');
  }

  return { score, reasons };
}

module.exports = {
  scoreProfile,
  scorePostForEngagement,
};
