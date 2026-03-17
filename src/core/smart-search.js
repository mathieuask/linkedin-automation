/**
 * Smart Search — Recherche intelligente basée sur des signaux d'intent
 * Génère des requêtes LinkedIn ciblées pour trouver des prospects à VRAI BESOIN
 */

// Stratégies de recherche par signal d'intent
const STRATEGIES = {
  RECRUITMENT: {
    id: 'RECRUITMENT',
    name: 'Recrutement dev mobile',
    description: 'Entreprises qui cherchent un dev mobile = elles ont le besoin',
    weight: 1.0, // Pondération par défaut, sera ajustée par search-learner
    queries: [
      'recrute développeur mobile',
      'recherche dev react native',
      'hiring mobile developer',
      'cherche développeur iOS Android',
      'embauche développeur mobile France',
    ],
    filters: {
      geoUrn: '103644278', // France
      network: 'S', // 2nd degree
    },
    searchType: 'people', // ou 'content' pour chercher dans les posts
  },
  
  FUNDRAISING: {
    id: 'FUNDRAISING',
    name: 'Levées de fonds récentes',
    description: 'Startups qui viennent de lever = ont le budget',
    weight: 1.2,
    queries: [
      'vient de lever',
      'annonce levée de fonds',
      'seed round',
      'nous avons le plaisir d\'annoncer',
      'série A France startup',
    ],
    filters: {
      geoUrn: '103644278',
      network: 'S',
    },
    searchType: 'content', // Chercher dans les posts
    targetTitles: ['CEO', 'Founder', 'Co-founder', 'CTO'], // Cibler ensuite ces profils
  },
  
  TECH_PAIN: {
    id: 'TECH_PAIN',
    name: 'Problèmes tech exprimés',
    description: 'Gens qui verbalisent leur frustration technique',
    weight: 1.1,
    queries: [
      'galère avec notre app',
      'cherche freelance développeur',
      'besoin développeur mobile urgent',
      'refonte application mobile',
      'problème technique application',
    ],
    filters: {
      geoUrn: '103644278',
      network: 'O', // 3rd+ degree pour élargir
    },
    searchType: 'content',
    targetTitles: ['CEO', 'Founder', 'CTO', 'Head of Product'],
  },
  
  PRODUCT_LAUNCH: {
    id: 'PRODUCT_LAUNCH',
    name: 'Lancement produit sans mobile',
    description: 'Web app récentes sans app mobile',
    weight: 0.9,
    queries: [
      'lancement plateforme SaaS',
      'notre webapp disponible',
      'fiers de lancer',
      'nouvelle plateforme web',
      'beta publique SaaS',
    ],
    filters: {
      geoUrn: '103644278',
      network: 'S',
    },
    searchType: 'content',
    targetTitles: ['CEO', 'Founder', 'CPO', 'Head of Product'],
  },
  
  BAD_REVIEWS: {
    id: 'BAD_REVIEWS',
    name: 'Apps avec mauvaises reviews',
    description: 'Fondateurs dont l\'app a de mauvaises notes (recherche manuelle)',
    weight: 0.7,
    queries: [
      'founder mobile app France',
      'CEO application mobile startup',
      'CTO app mobile France',
    ],
    filters: {
      geoUrn: '103644278',
      network: 'S',
    },
    searchType: 'people',
    note: 'Vérifier ensuite manuellement les apps sur stores',
  },
  
  RAPID_GROWTH: {
    id: 'RAPID_GROWTH',
    name: 'Croissance rapide',
    description: 'Startups qui scalent = besoin tech',
    weight: 1.0,
    queries: [
      'on recrute startup France',
      'l\'équipe grandit',
      '10 recrutements cette année',
      'scaling startup France',
      'notre équipe double',
    ],
    filters: {
      geoUrn: '103644278',
      network: 'S',
    },
    searchType: 'content',
    targetTitles: ['CEO', 'Founder', 'CTO'],
  },
};

/**
 * Retourne toutes les stratégies avec leurs métadonnées
 * @returns {Object} Map de stratégies
 */
function getAllStrategies() {
  return STRATEGIES;
}

/**
 * Retourne les requêtes de recherche pour une stratégie donnée
 * @param {string} strategyId - ID de la stratégie (ex: 'RECRUITMENT')
 * @returns {Array<string>} Liste de 3-5 requêtes
 */
function getSearchQueries(strategyId) {
  const strategy = STRATEGIES[strategyId];
  if (!strategy) {
    throw new Error(`Stratégie inconnue: ${strategyId}`);
  }
  return strategy.queries;
}

/**
 * Choisit une stratégie aléatoire pondérée par efficacité
 * Les poids sont mis à jour par le learning engine (80% meilleure + 20% exploration)
 * @param {Object} customWeights - Poids personnalisés (optionnel)
 * @returns {Object} Stratégie choisie
 */
function getRandomStrategy(customWeights = null) {
  const strategies = Object.values(STRATEGIES);
  let weights;
  
  // Tenter d'utiliser le learning engine pour pondérer intelligemment
  try {
    const { getBestSearchStrategy } = require('./learning-engine.js');
    const bestStrategy = getBestSearchStrategy();
    
    if (bestStrategy.best && Math.random() > 0.20) {
      // 80% du temps, utiliser la meilleure stratégie
      const best = strategies.find(s => s.id === bestStrategy.best);
      if (best) {
        console.log(`[smart-search] Utilisation stratégie apprise: ${bestStrategy.best}`);
        return best;
      }
    }
    
    // 20% du temps (exploration) ou si pas de meilleure stratégie, utiliser pondération classique
    console.log('[smart-search] Mode exploration (20%)');
  } catch (err) {
    console.warn('[smart-search] Learning engine non dispo, pondération classique');
  }
  
  // Si des poids personnalisés sont fournis, les utiliser
  weights = customWeights || strategies.map(s => s.weight);
  
  // Sélection pondérée
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;
  
  for (let i = 0; i < strategies.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return strategies[i];
    }
  }
  
  // Fallback
  return strategies[0];
}

/**
 * Construit l'URL de recherche LinkedIn avec filtres
 * @param {string} query - Requête de recherche
 * @param {Object} filters - Filtres (geoUrn, network, etc.)
 * @returns {string} URL LinkedIn complète
 */
function buildSearchUrl(query, filters = {}) {
  const baseUrl = 'https://www.linkedin.com/search/results';
  const searchType = filters.searchType || 'people'; // 'people' ou 'content'
  
  const params = new URLSearchParams();
  
  // Requête de base
  params.append('keywords', query);
  params.append('origin', 'GLOBAL_SEARCH_HEADER');
  
  // Filtre géographique (France par défaut)
  if (filters.geoUrn) {
    params.append('geoUrn', `["${filters.geoUrn}"]`);
  }
  
  // Filtre réseau (2nd, 3rd+)
  if (filters.network) {
    params.append('network', filters.network);
  }
  
  // Taille d'entreprise (optionnel)
  if (filters.companySize) {
    params.append('companySize', filters.companySize);
  }
  
  // Industrie (optionnel)
  if (filters.industry) {
    params.append('industry', filters.industry);
  }
  
  return `${baseUrl}/${searchType}/?${params.toString()}`;
}

/**
 * Génère une requête de recherche intelligente complète
 * @returns {Object} { strategy, query, url }
 */
function generateSmartSearch() {
  const strategy = getRandomStrategy();
  const queries = strategy.queries;
  const query = queries[Math.floor(Math.random() * queries.length)];
  const url = buildSearchUrl(query, {
    ...strategy.filters,
    searchType: strategy.searchType,
  });
  
  return {
    strategy: strategy.id,
    strategyName: strategy.name,
    query,
    url,
    searchType: strategy.searchType,
    targetTitles: strategy.targetTitles,
  };
}

module.exports = {
  getAllStrategies,
  getSearchQueries,
  getRandomStrategy,
  buildSearchUrl,
  generateSmartSearch,
};
