#!/usr/bin/env node
/**
 * Auto-Évaluation Hebdomadaire
 * Wrapper pour weekly-review.js
 * Lancé automatiquement chaque dimanche 19h par cron
 */

const { main } = require('./weekly-review.js');

main().catch(err => {
  console.error('[auto-evaluation] Erreur:', err);
  process.exit(1);
});
