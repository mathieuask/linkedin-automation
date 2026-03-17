/**
 * Reply Messages — Check connexions acceptées + répondre aux messages
 * 
 * Flow : API GET conversations → check nouveaux messages → reply
 */
require('dotenv').config();
const { getPage, ensureLoggedIn, humanDelay } = require('../core/browser.js');
const { getConversations, getConnections } = require('../core/linkedin-api.js');
const { sendMessage } = require('../core/linkedin-actions.js');

async function run(options = {}) {
  console.log('\n💬 Reply Messages\n');
  
  const page = await getPage();
  await ensureLoggedIn(page);
  
  // 1. Checker les conversations
  console.log('📡 GET conversations...');
  const convos = await getConversations(page);
  console.log(`   ${convos.total} conversations\n`);
  
  // 2. Checker les connexions
  console.log('📡 GET connexions...');
  const connections = await getConnections(page, { count: 50 });
  console.log(`   ${connections.total} connexions\n`);
  
  // TODO: Comparer avec le CRM Notion pour identifier les nouvelles acceptations
  // TODO: Envoyer premier message aux nouvelles connexions
  // TODO: Répondre aux messages non lus avec IA
  
  console.log('✅ Check terminé');
  console.log('   ℹ️ Intégration Notion à implémenter pour le suivi automatique');
  
  return {
    conversations: convos.total,
    connections: connections.total,
  };
}

if (require.main === module) {
  run()
    .then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch(e => { console.error('❌', e.message); process.exit(1); });
}

module.exports = { run };
