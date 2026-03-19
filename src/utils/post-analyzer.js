/**
 * Post Analyzer V3 - LinkedIn post scoring for SparkLab
 * 
 * FIXES from V2.5:
 *   1. analyzePost() accepts OBJECT {author, title, text, textLength} (v4 was calling with 3 separate args)
 *   2. Threshold lowered to 4/10 (was 6 — too strict, all posts scored 0-1)
 *   3. Base score of 1 for non-trivial posts (prevents all-zero)
 *   4. Broader keywords + story/REX pattern
 *   5. Backwards-compatible with old calling convention
 */

const KEYWORDS = {
  mobile: ['mobile', 'app', 'application', 'ios', 'android', 'app store', 'play store', 'react native', 'expo', 'flutter'],
  tech: ['react', 'typescript', 'javascript', 'node', 'next.js', 'vue', 'angular', 'tailwind', 'api', 'frontend', 'backend', 'fullstack'],
  startup: ['startup', 'founder', 'co-founder', 'entrepreneur', 'saas', 'b2b', 'b2c', 'scale-up', 'scaleup', 'bootstrapped'],
  dev: ['dev', 'developer', 'développeur', 'développeuse', 'cto', 'tech lead', 'engineering', 'code', 'coding', 'freelance', 'indépendant'],
  product: ['mvp', 'product', 'produit', 'launch', 'lancement', 'beta', 'prototype', 'side project', 'projet', 'no-code', 'low-code'],
  funding: ['levée', 'funding', 'seed', 'series a', 'investissement', 'vc', 'venture', 'business angel', 'incubateur', 'accélérateur'],
  hiring: ['recrute', 'hiring', 'recherche', 'join', 'rejoindre', 'team', 'équipe', 'talent', 'recrutement', 'on recrute'],
  innovation: ['innovation', 'innovant', 'ia', 'intelligence artificielle', 'ai', 'machine learning', 'digital', 'automatisation', 'automation', 'data', 'cloud'],
};

const CATEGORY_WEIGHTS = { mobile: 3, product: 3, tech: 2, startup: 2, dev: 2, funding: 2, hiring: 2, innovation: 1 };

const PATTERNS = {
  announcement: /\b(annonce|announcing|excited to|proud to|thrilled to|ravi|heureux|lancement|je lance|on lance|we.re launching)\b/i,
  success: /\b(success|réussi|achieved|million|customers|users|clients|revenue|chiffre d'affaires|croissance|growth)\b/i,
  story: /\b(il y a \d|j'ai commencé|mon parcours|my journey|story|histoire|témoignage|retour d'expérience|rex)\b/i,
  question: /\b(help|aide|comment|how to|pourquoi|question)\s*\?/i,
  spam: /\b(check out|découvrez|cliquez|link in bio|webinar|formation|gratuit|offre|promo|soldes)\b/i,
};

/**
 * @param {Object|string} post - { author, title, text, textLength } or just text string
 * @returns {{ score: number, reason: string, shouldLike: boolean, keywords: object, analysisVersion: string }}
 */
function analyzePost(post) {
  let author, title, text, textLength;
  
  if (typeof post === 'object' && post !== null) {
    ({ author = '', title = '', text = '', textLength = 0 } = post);
    if (!textLength) textLength = text.length;
  } else {
    // Backwards compat: analyzePost(text, author, title)
    text = typeof post === 'string' ? post : '';
    author = typeof arguments[1] === 'string' ? arguments[1] : '';
    title = typeof arguments[2] === 'string' ? arguments[2] : '';
    textLength = text.length;
  }
  
  const fullText = `${author} ${title} ${text}`.toLowerCase();
  const reasons = [];
  let score = text.length > 50 ? 1 : 0; // Base score for non-trivial posts
  
  // 1. Keywords (max 6 pts)
  let kwScore = 0;
  const foundKeywords = {};
  for (const [cat, terms] of Object.entries(KEYWORDS)) {
    const found = terms.filter(t => fullText.includes(t.toLowerCase()));
    if (found.length > 0) {
      foundKeywords[cat] = found;
      kwScore += CATEGORY_WEIGHTS[cat] || 1;
    }
  }
  score += Math.min(kwScore, 6);
  if (Object.keys(foundKeywords).length > 0) reasons.push(`Keywords: ${Object.keys(foundKeywords).join(', ')}`);
  
  // 2. Patterns (+3 max, -2 min)
  if (PATTERNS.announcement.test(fullText)) { score += 1; reasons.push('Annonce'); }
  if (PATTERNS.success.test(fullText)) { score += 1; reasons.push('Success'); }
  if (PATTERNS.story.test(fullText)) { score += 1; reasons.push('Story/REX'); }
  if (PATTERNS.question.test(fullText)) { score -= 1; reasons.push('Question (-)'); }
  if (PATTERNS.spam.test(fullText)) { score -= 1; reasons.push('Promo (-)'); }
  
  // 3. Author analysis (+2 max)
  const authorLower = `${author} ${title}`.toLowerCase();
  if (/\b(founder|co-founder|cto|ceo|head of|lead|directeur|directrice)\b/.test(authorLower)) { score += 1; reasons.push('Décisionnaire'); }
  if (/\b(startup|saas|tech|digital|développ|freelance)\b/.test(authorLower)) { score += 1; reasons.push('Profil tech'); }
  
  // 4. Length bonus
  if (textLength > 500) { score += 1; reasons.push('Contenu long'); }
  
  // 5. Cap
  score = Math.max(0, Math.min(10, score));
  
  return {
    score,
    reason: reasons.join(' | ') || 'Pas de signal fort',
    shouldLike: score >= 4, // Lowered from 6
    keywords: foundKeywords,
    analysisVersion: '3.0',
  };
}

function rankPosts(posts) {
  return posts
    .map(p => ({ ...p, analysis: p.analysis || analyzePost(p) }))
    .sort((a, b) => b.analysis.score - a.analysis.score);
}

function getAnalysisStats(posts) {
  const analyzed = posts.map(p => p.analysis || analyzePost(p));
  const scores = analyzed.map(a => a.score);
  const avg = scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
  return {
    total: posts.length,
    average: avg.toFixed(1),
    high: analyzed.filter(a => a.score >= 7).length,
    medium: analyzed.filter(a => a.score >= 4 && a.score < 7).length,
    low: analyzed.filter(a => a.score < 4).length,
    shouldLike: analyzed.filter(a => a.shouldLike).length,
  };
}

module.exports = { analyzePost, rankPosts, getAnalysisStats };
