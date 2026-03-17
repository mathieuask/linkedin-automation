/**
 * Engage Feed — Like + Comment les posts pertinents du feed
 * 
 * 2 MODES :
 * - getData()  → retourne les posts scorés (l'agent analyse et écrit les commentaires)
 * - executeLike(activityId)  → like un post
 * - executeComment(activityId, commentText)  → commente avec le texte généré par l'IA
 * - run()  → mode autonome (likes uniquement, PAS de commentaires auto)
 */
require('dotenv').config();
const { getPage, ensureLoggedIn, humanDelay } = require('../core/browser.js');
const { getFeed } = require('../core/linkedin-api.js');
const { likePost, commentPost } = require('../core/linkedin-actions.js');
const { scorePostForEngagement } = require('../core/scoring.js');

/**
 * Récupère et score les posts du feed — l'agent utilise ces données
 * pour décider quoi liker/commenter et génère LUI-MÊME les commentaires
 */
async function getData(options = {}) {
  const page = await getPage();
  await ensureLoggedIn(page);
  const posts = await getFeed(page, { count: options.count || 15 });
  return posts
    .map(p => ({ ...p, engagement: scorePostForEngagement(p) }))
    .filter(p => !p.liked)
    .sort((a, b) => b.engagement.score - a.engagement.score);
}

/** Like un post spécifique */
async function executeLike(activityId) {
  const page = await getPage();
  return likePost(page, activityId);
}

/** Commente un post avec un texte généré par l'agent IA (PAS un template) */
async function executeComment(activityId, commentText) {
  const page = await getPage();
  return commentPost(page, activityId, commentText);
}

/** Mode autonome : likes uniquement (les commentaires nécessitent l'IA) */
async function run(options = {}) {
  const maxLikes = options.maxLikes || parseInt(process.env.TARGET_LIKES) || 5;
  console.log(`\n📱 Engage Feed — ${maxLikes} likes\n`);

  const scored = await getData(options);
  console.log(`🎯 ${scored.length} posts scorés\n`);

  let likesGiven = 0;
  const results = [];
  const page = await getPage();

  for (const post of scored) {
    if (likesGiven >= maxLikes) break;
    console.log(`👍 Like: ${post.author} (${post.activityId})`);
    try {
      const result = await likePost(page, post.activityId);
      if (result.success) {
        likesGiven++;
        console.log(`   ✅ (${likesGiven}/${maxLikes})`);
        results.push({ action: 'like', activityId: post.activityId, author: post.author, success: true });
      } else {
        results.push({ action: 'like', activityId: post.activityId, error: result.error });
      }
    } catch (e) {
      console.log(`   ❌ ${e.message}`);
      results.push({ action: 'like', activityId: post.activityId, error: e.message });
    }
    await page.waitForTimeout(humanDelay(3000, 8000));
  }

  console.log(`\n✅ Likes: ${likesGiven}/${maxLikes}`);
  return { likes: likesGiven, results, posts: scored.slice(0, 5) };
}

if (require.main === module) {
  run()
    .then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch(e => { console.error('❌', e.message); process.exit(1); });
}

module.exports = { getData, executeLike, executeComment, run };
