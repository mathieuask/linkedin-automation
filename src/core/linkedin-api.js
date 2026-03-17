/**
 * LinkedIn API — Toutes les lectures via Voyager API
 * Méthodes validées le 13/03/2026
 * 
 * Principe : page.evaluate(fetch(...)) depuis le contexte browser
 * → utilise les cookies de session automatiquement
 */

/**
 * GET feed — retourne les posts du feed
 * @returns {Array} posts avec activityId, author, publicId, text, likes, comments
 */
async function getFeed(page, { count = 10, start = 0 } = {}) {
  return page.evaluate(async ({ count, start }) => {
    const csrf = document.cookie.match(/JSESSIONID="?([^;"]*)"?/)?.[1] || '';
    const r = await fetch(`/voyager/api/feed/updatesV2?q=feed&count=${count}&start=${start}`, {
      headers: { 'csrf-token': csrf, 'x-restli-protocol-version': '2.0.0' },
      credentials: 'include',
    });
    if (r.status !== 200) throw new Error('Feed API error: ' + r.status);
    const j = await r.json();

    return (j.elements || []).map(e => {
      const mini = e.actor?.image?.attributes?.[0]?.miniProfile;
      return {
        activityId: e.updateMetadata?.urn?.split(':').pop(),
        urn: e.updateMetadata?.urn,
        shareUrn: e.updateMetadata?.shareUrn,
        author: e.actor?.name?.text || '',
        publicId: mini?.publicIdentifier || '',
        firstName: mini?.firstName || '',
        lastName: mini?.lastName || '',
        occupation: mini?.occupation || '',
        text: e.commentary?.text?.text || '',
        likes: e.socialDetail?.totalSocialActivityCounts?.numLikes || 0,
        comments: e.socialDetail?.totalSocialActivityCounts?.numComments || 0,
        liked: e.socialDetail?.liked || false,
        postUrl: e.updateMetadata?.urn
          ? `/feed/update/${e.updateMetadata.urn}/`
          : null,
        profileUrl: mini?.publicIdentifier
          ? `/in/${mini.publicIdentifier}/`
          : null,
      };
    });
  }, { count, start });
}

/**
 * GET profil — retourne les données d'un profil
 * @param {string} publicId — ex: "john-doe-123456789"
 */
async function getProfile(page, publicId) {
  return page.evaluate(async (id) => {
    const csrf = document.cookie.match(/JSESSIONID="?([^;"]*)"?/)?.[1] || '';
    const r = await fetch(`/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${id}`, {
      headers: { 'csrf-token': csrf, 'x-restli-protocol-version': '2.0.0' },
      credentials: 'include',
    });
    if (r.status !== 200) return null;
    const j = await r.json();
    const p = j.elements?.[0];
    if (!p) return null;

    return {
      publicId: id,
      firstName: p.firstName,
      lastName: p.lastName,
      headline: p.headline || '',
      industryName: p.industryName || '',
      locationName: p.geoLocationName || p.locationName || '',
      summary: p.summary || '',
      entityUrn: p.entityUrn || '',
    };
  }, publicId);
}

/**
 * GET mon profil
 */
async function getMe(page) {
  return page.evaluate(async () => {
    const csrf = document.cookie.match(/JSESSIONID="?([^;"]*)"?/)?.[1] || '';
    const r = await fetch('/voyager/api/me', {
      headers: { 'csrf-token': csrf, 'x-restli-protocol-version': '2.0.0' },
      credentials: 'include',
    });
    if (r.status !== 200) return null;
    return r.json();
  });
}

/**
 * GET connexions
 */
async function getConnections(page, { start = 0, count = 10 } = {}) {
  return page.evaluate(async ({ start, count }) => {
    const csrf = document.cookie.match(/JSESSIONID="?([^;"]*)"?/)?.[1] || '';
    const r = await fetch(`/voyager/api/relationships/dash/connections?q=search&start=${start}&count=${count}`, {
      headers: { 'csrf-token': csrf, 'x-restli-protocol-version': '2.0.0' },
      credentials: 'include',
    });
    if (r.status !== 200) return { elements: [], total: 0 };
    const j = await r.json();
    return {
      elements: j.elements || [],
      total: j.paging?.total || 0,
    };
  }, { start, count });
}

/**
 * GET conversations messaging
 */
async function getConversations(page) {
  return page.evaluate(async () => {
    const csrf = document.cookie.match(/JSESSIONID="?([^;"]*)"?/)?.[1] || '';
    const r = await fetch('/voyager/api/messaging/conversations?keyVersion=LEGACY_INBOX', {
      headers: { 'csrf-token': csrf, 'x-restli-protocol-version': '2.0.0' },
      credentials: 'include',
    });
    if (r.status !== 200) return { elements: [], total: 0 };
    const j = await r.json();
    return {
      elements: j.elements || [],
      total: j.paging?.total || 0,
    };
  });
}

/**
 * Recherche de profils via navigation browser
 * (L'API search retourne 500, on passe par l'URL)
 * @param {string} keywords — ex: "CEO startup France"
 * @returns {Array} publicIds trouvés
 */
async function searchPeople(page, keywords) {
  const encoded = encodeURIComponent(keywords);
  await page.goto(
    `https://www.linkedin.com/search/results/people/?keywords=${encoded}&origin=GLOBAL_SEARCH_HEADER`,
    { waitUntil: 'domcontentloaded', timeout: 15000 }
  );
  await page.waitForTimeout(8000);

  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/in/"]'));
    const seen = new Set();
    const results = [];
    for (const l of links) {
      const m = l.href.match(/\/in\/([a-z0-9-]+)/i);
      if (m && !seen.has(m[1]) && m[1].length > 3 && !m[1].startsWith('ACoA')) {
        seen.add(m[1]);
        results.push(m[1]);
      }
    }
    return results.slice(0, 10);
  });
}

module.exports = {
  getFeed,
  getProfile,
  getMe,
  getConnections,
  getConversations,
  searchPeople,
};
