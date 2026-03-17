#!/usr/bin/env node
/**
 * Smart CLI — Commandes pour gérer le système de prospection
 * 
 * Usage:
 *   node scripts/smart-cli.js report
 *   node scripts/smart-cli.js strategies
 *   node scripts/smart-cli.js test-search
 *   node scripts/smart-cli.js unpause RECRUITMENT
 */

const { generateReport, getBestStrategies, unpauseStrategy } = require('../src/core/search-learner.js');
const { getAllStrategies, generateSmartSearch } = require('../src/core/smart-search.js');
const { scoreProfile } = require('../src/core/scoring.js');

const command = process.argv[2];
const args = process.argv.slice(3);

// ────────────────────────────────────────────────────────────
// COMMANDE: report
// ────────────────────────────────────────────────────────────

function cmdReport() {
  console.log('\n📊 RAPPORT DE PERFORMANCE\n');
  
  const report = generateReport();
  
  console.log('📈 Statistiques globales:');
  console.log(`   Total recherches: ${report.totalSearches}`);
  console.log(`   Total invitations: ${report.totalInvitations}`);
  console.log(`   Acceptées: ${report.totalAccepted} (${(report.totalAccepted/report.totalInvitations*100).toFixed(1)}%)`);
  console.log(`   Réponses: ${report.totalReplied} (${(report.totalReplied/report.totalInvitations*100).toFixed(1)}%)`);
  console.log();
  
  console.log('📊 Performance par stratégie:\n');
  
  Object.entries(report.strategies).forEach(([strategyId, stats]) => {
    const icon = stats.paused ? '⏸️ ' : stats.weight > 1.0 ? '🚀' : '📊';
    console.log(`${icon} ${strategyId}`);
    console.log(`   Recherches: ${stats.totalSearches}`);
    console.log(`   Invitations: ${stats.totalSent}`);
    console.log(`   Acceptées: ${stats.totalAccepted} (${stats.acceptRate})`);
    console.log(`   Réponses: ${stats.totalReplied} (${stats.replyRate})`);
    console.log(`   Taux qualification: ${stats.qualifiedRate}`);
    console.log(`   Poids actuel: ${stats.weight.toFixed(2)}`);
    if (stats.paused) console.log(`   ⚠️  EN PAUSE`);
    console.log();
  });
  
  // Meilleures stratégies
  const best = getBestStrategies(3);
  if (best.length > 0) {
    console.log('🏆 Top 3 stratégies:\n');
    best.forEach((s, i) => {
      console.log(`   ${i+1}. ${s.strategyId}`);
      console.log(`      Score: ${s.score.toFixed(3)}`);
      console.log(`      Reply rate: ${(s.replyRate*100).toFixed(1)}%`);
      console.log(`      Accept rate: ${(s.acceptRate*100).toFixed(1)}%`);
      console.log();
    });
  }
}

// ────────────────────────────────────────────────────────────
// COMMANDE: strategies
// ────────────────────────────────────────────────────────────

function cmdStrategies() {
  console.log('\n🎯 STRATÉGIES DISPONIBLES\n');
  
  const strategies = getAllStrategies();
  
  Object.entries(strategies).forEach(([id, strategy]) => {
    console.log(`📌 ${id}`);
    console.log(`   Nom: ${strategy.name}`);
    console.log(`   Description: ${strategy.description}`);
    console.log(`   Type: ${strategy.searchType}`);
    console.log(`   Poids par défaut: ${strategy.weight}`);
    console.log(`   Requêtes (${strategy.queries.length}):`);
    strategy.queries.forEach(q => console.log(`     - "${q}"`));
    if (strategy.note) console.log(`   Note: ${strategy.note}`);
    console.log();
  });
}

// ────────────────────────────────────────────────────────────
// COMMANDE: test-search
// ────────────────────────────────────────────────────────────

function cmdTestSearch() {
  console.log('\n🧪 TEST RECHERCHE INTELLIGENTE\n');
  
  for (let i = 0; i < 5; i++) {
    const search = generateSmartSearch();
    console.log(`${i+1}. ${search.strategyName}`);
    console.log(`   Requête: "${search.query}"`);
    console.log(`   URL: ${search.url.substring(0, 80)}...`);
    console.log();
  }
}

// ────────────────────────────────────────────────────────────
// COMMANDE: test-scoring
// ────────────────────────────────────────────────────────────

function cmdTestScoring() {
  console.log('\n🧪 TEST SCORING\n');
  
  const testProfiles = [
    {
      name: 'CEO Startup Mobile',
      firstName: 'Jean',
      lastName: 'Dupont',
      headline: 'CEO & Founder @ TechStartup | Mobile Apps | SaaS',
      industryName: 'Technology',
      locationName: 'Paris, France',
      connectionCount: 1500,
      companySize: 25,
    },
    {
      name: 'Influencer',
      firstName: 'Marie',
      lastName: 'Martin',
      headline: 'Influencer | Speaker | 50K followers',
      industryName: 'Marketing',
      locationName: 'Paris, France',
      connectionCount: 15000,
    },
    {
      name: 'Freelance Dev',
      firstName: 'Pierre',
      lastName: 'Durand',
      headline: 'Freelance Developer | React Native',
      industryName: 'IT Services',
      locationName: 'Lyon, France',
      connectionCount: 800,
    },
    {
      name: 'CTO PME',
      firstName: 'Sophie',
      lastName: 'Bernard',
      headline: 'CTO @ FoodTech Startup | Scaling our platform',
      industryName: 'Food & Beverages',
      locationName: 'Paris, France',
      connectionCount: 2000,
      companySize: 75,
    },
  ];
  
  testProfiles.forEach(profile => {
    const score = scoreProfile(profile);
    console.log(`${score.label} ${profile.name} [${score.score}]`);
    console.log(`   Headline: ${profile.headline}`);
    console.log(`   Raisons: ${score.reasons.join(', ')}`);
    console.log();
  });
}

// ────────────────────────────────────────────────────────────
// COMMANDE: unpause
// ────────────────────────────────────────────────────────────

function cmdUnpause(strategyId) {
  if (!strategyId) {
    console.error('❌ Usage: node scripts/smart-cli.js unpause <STRATEGY_ID>');
    process.exit(1);
  }
  
  console.log(`\n▶️  Réactivation de ${strategyId}...\n`);
  unpauseStrategy(strategyId);
}

// ────────────────────────────────────────────────────────────
// COMMANDE: help
// ────────────────────────────────────────────────────────────

function cmdHelp() {
  console.log(`
🤖 Smart CLI — Commandes disponibles

📊 REPORTING:
  report              Afficher le rapport de performance complet
  
🎯 STRATÉGIES:
  strategies          Lister toutes les stratégies disponibles
  test-search         Générer 5 recherches intelligentes aléatoires
  test-scoring        Tester le scoring sur des profils exemple
  
⚙️  GESTION:
  unpause <ID>        Réactiver une stratégie en pause
  
📖 AIDE:
  help                Afficher cette aide

EXEMPLES:
  node scripts/smart-cli.js report
  node scripts/smart-cli.js strategies
  node scripts/smart-cli.js test-search
  node scripts/smart-cli.js unpause RECRUITMENT
  `);
}

// ────────────────────────────────────────────────────────────
// ROUTER
// ────────────────────────────────────────────────────────────

switch (command) {
  case 'report':
    cmdReport();
    break;
  
  case 'strategies':
    cmdStrategies();
    break;
  
  case 'test-search':
    cmdTestSearch();
    break;
  
  case 'test-scoring':
    cmdTestScoring();
    break;
  
  case 'unpause':
    cmdUnpause(args[0]);
    break;
  
  case 'help':
  case undefined:
    cmdHelp();
    break;
  
  default:
    console.error(`❌ Commande inconnue: ${command}`);
    console.log('Utiliser "help" pour voir les commandes disponibles.');
    process.exit(1);
}
