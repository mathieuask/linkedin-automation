/**
 * telegram-alerts.js — Wrapper point d'entrée pour les rapports Telegram
 * Redirige vers daily-report.js selon le mode passé en argument
 */
require('dotenv').config();

const mode = process.argv[2] || 'report';

if (mode === 'report') {
  require('../core/daily-report.js');
} else {
  console.log('Usage: node telegram-alerts.js report');
  process.exit(0);
}
