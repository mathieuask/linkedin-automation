/**
 * Publish Post — Créer un post LinkedIn
 * Utilise getByRole pour le shadow DOM de l'éditeur
 */
require('dotenv').config();
const { getPage, ensureLoggedIn, humanDelay } = require('../core/browser.js');
const { createPost } = require('../core/linkedin-actions.js');

async function run(options = {}) {
  const postText = options.postText || process.env.POST_TEXT;
  
  if (!postText) {
    console.log('⚠️ Pas de texte de post (POST_TEXT ou options.postText)');
    return { success: false, error: 'no post text' };
  }
  
  console.log(`\n📝 Publish Post — ${postText.length} chars\n`);
  
  const page = await getPage();
  await ensureLoggedIn(page);
  
  const result = await createPost(page, postText);
  
  if (result.success) {
    console.log('✅ Post publié !');
  } else {
    console.log('❌ ' + result.error);
  }
  
  return result;
}

if (require.main === module) {
  run()
    .then(r => { console.log(JSON.stringify(r)); process.exit(r.success ? 0 : 1); })
    .catch(e => { console.error('❌', e.message); process.exit(1); });
}

module.exports = { run };
