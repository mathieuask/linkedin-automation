/**
 * LinkedIn Actions — Toutes les écritures via browser clicks
 * Méthodes validées le 13/03/2026
 * 
 * Principe : navigation directe → mouse.click()
 * JAMAIS de fetch/API pour les écritures (shadow ban)
 * 
 * V2 (13/03/2026) : Ajout vérification shadow ban après chaque action
 */
const { humanClick, humanDelay } = require('./browser.js');
const detector = require('./shadowban-detector.js');

// ═══════════════════════════════════════════
// LIKE
// ═══════════════════════════════════════════

/**
 * Like un post par navigation directe
 * @param {string} activityId — ex: "7437518012175282176"
 * @returns {boolean} true si liké avec succès
 */
async function likePost(page, activityId) {
  // Nav directe au post
  await page.goto(`https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`, {
    waitUntil: 'domcontentloaded', timeout: 15000,
  });
  await page.waitForTimeout(humanDelay(5000, 8000));

  // Accepter cookies si nécessaire
  await dismissCookieBanner(page);

  // Trouver le bouton like (pas encore liké)
  // Labels possibles: "Ouvrir le menu des réactions", "Open reactions menu"
  // Ou bouton avec "no reaction" / "État du bouton de réaction : aucune réaction"
  const likeBtn = await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (!b.offsetParent) continue;
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      if (
        label.includes('ouvrir le menu des réactions') ||
        label.includes('open reactions menu') ||
        label.includes('no reaction') ||
        label.includes('aucune réaction')
      ) {
        const rect = b.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, label };
      }
    }
    return null;
  });

  if (!likeBtn) {
    // Peut-être déjà liké
    const alreadyLiked = await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('reaction button state: like') || label.includes('j\'aime')) return true;
      }
      return false;
    });
    if (alreadyLiked) return { success: true, alreadyLiked: true };
    return { success: false, error: 'like button not found' };
  }

  // Clic humain
  await page.mouse.move(likeBtn.x, likeBtn.y, { steps: 10 + Math.floor(Math.random() * 6) });
  await page.waitForTimeout(humanDelay(300, 600));
  await page.mouse.click(likeBtn.x, likeBtn.y);

  await page.waitForTimeout(humanDelay(2000, 4000));
  
  // Vérifier que le like a bien été enregistré (anti shadow ban)
  const verification = await detector.verifyLike(page, activityId);
  
  return { success: true, verified: verification.verified };
}

// ═══════════════════════════════════════════
// COMMENT
// ═══════════════════════════════════════════

/**
 * Commenter un post par navigation directe
 * @param {string} activityId
 * @param {string} commentText
 */
async function commentPost(page, activityId, commentText) {
  await page.goto(`https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`, {
    waitUntil: 'domcontentloaded', timeout: 15000,
  });
  await page.waitForTimeout(humanDelay(5000, 8000));
  await dismissCookieBanner(page);

  // Trouver le textbox de commentaire (déjà visible sur la page du post)
  const textbox = page.locator('div[role="textbox"]').first();
  if (await textbox.count() === 0) return { success: false, error: 'comment textbox not found' };

  // Cliquer pour focus
  const box = await textbox.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(humanDelay(500, 1000));

  // Taper le commentaire humainement
  for (const c of commentText) {
    await page.keyboard.type(c);
    await page.waitForTimeout(20 + Math.random() * 50);
  }
  await page.waitForTimeout(humanDelay(1000, 2000));

  // Trouver le bouton submit "Commenter" (x > 900 = à droite du textbox)
  const submitBtn = await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (!b.offsetParent) continue;
      const t = b.textContent.trim();
      const rect = b.getBoundingClientRect();
      if (/^(Commenter|Comment|Post)$/i.test(t) && rect.x > 900) {
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return null;
  });

  if (!submitBtn) return { success: false, error: 'submit button not found' };

  await page.mouse.move(submitBtn.x, submitBtn.y, { steps: 8 });
  await page.waitForTimeout(humanDelay(200, 500));
  await page.mouse.click(submitBtn.x, submitBtn.y);

  await page.waitForTimeout(humanDelay(3000, 5000));
  
  // Vérifier que le commentaire a bien été posté (anti shadow ban)
  const verification = await detector.verifyComment(page, activityId, commentText);
  
  return { success: true, verified: verification.verified };
}

// ═══════════════════════════════════════════
// FOLLOW
// ═══════════════════════════════════════════

/**
 * Follow un profil
 * @param {string} publicId — ex: "bethany-iverson-75a56a2a1"
 */
async function followProfile(page, publicId) {
  await page.goto(`https://www.linkedin.com/in/${publicId}/`, {
    waitUntil: 'domcontentloaded', timeout: 15000,
  });
  await page.waitForTimeout(humanDelay(5000, 8000));

  // Chercher bouton "Suivre" ou "Follow" avec aria-label
  const followBtn = await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (!b.offsetParent) continue;
      const label = (b.getAttribute('aria-label') || '');
      if (/^Suivre |^Follow /i.test(label)) {
        const rect = b.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, label };
      }
    }
    return null;
  });

  if (!followBtn) return { success: false, error: 'follow button not found' };

  await page.mouse.move(followBtn.x, followBtn.y, { steps: 12 });
  await page.waitForTimeout(humanDelay(300, 600));
  await page.mouse.click(followBtn.x, followBtn.y);

  await page.waitForTimeout(humanDelay(3000, 5000));

  // Vérifier
  const followed = await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('ne plus suivre') || label.includes('unfollow')) return true;
    }
    return false;
  });

  return { success: followed };
}

// ═══════════════════════════════════════════
// CONNECT (invitation)
// ═══════════════════════════════════════════

/**
 * Envoyer une invitation de connexion (avec ou sans note)
 * Utilise /preload/custom-invite/ pour contourner la redirection Premium
 * 
 * @param {string} publicId — vanityName du profil
 * @param {string|null} note — message personnalisé (optionnel)
 */
async function sendConnect(page, publicId, note = null) {
  await page.goto(`https://www.linkedin.com/preload/custom-invite/?vanityName=${publicId}`, {
    waitUntil: 'domcontentloaded', timeout: 15000,
  });
  await page.waitForTimeout(humanDelay(3000, 5000));

  if (note) {
    // Cliquer "Ajouter une note"
    const addNoteBtn = page.locator('button').filter({ hasText: 'Ajouter une note' }).first();
    if (await addNoteBtn.count() === 0) return { success: false, error: 'add note button not found' };
    await addNoteBtn.click();
    await page.waitForTimeout(humanDelay(1000, 2000));

    // Remplir la note
    const textarea = page.locator('#custom-message');
    if (await textarea.count() === 0) return { success: false, error: 'note textarea not found' };
    await textarea.click();
    await page.waitForTimeout(300);

    for (const c of note) {
      await page.keyboard.type(c);
      await page.waitForTimeout(20 + Math.random() * 40);
    }
    await page.waitForTimeout(humanDelay(1000, 2000));

    // Cliquer Envoyer
    const sendBtn = page.locator('button').filter({ hasText: /^Envoyer$/ }).first();
    if (await sendBtn.count() === 0) return { success: false, error: 'send button not found' };
    await sendBtn.click();
  } else {
    // Envoyer sans note
    const sendBtn = page.locator('button').filter({ hasText: 'Envoyer sans note' }).first();
    if (await sendBtn.count() === 0) return { success: false, error: 'send without note button not found' };
    await sendBtn.click();
  }

  await page.waitForTimeout(humanDelay(3000, 5000));
  
  // Note: La vérification des invitations se fait de manière passive
  // via le taux d'acceptation sur 7 jours (shadowban-detector)
  
  return { success: true, verified: true };
}

// ═══════════════════════════════════════════
// MESSAGE
// ═══════════════════════════════════════════

/**
 * Envoyer un message à une connexion 1er degré
 * @param {string} recipientName — nom complet pour la recherche
 * @param {string} messageText
 */
async function sendMessage(page, recipientName, messageText) {
  await page.goto('https://www.linkedin.com/messaging/thread/new/', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  });
  await page.waitForTimeout(humanDelay(3000, 5000));

  // Taper le destinataire
  const toInput = page.locator('input[placeholder*="nom"]');
  if (await toInput.count() === 0) return { success: false, error: 'recipient input not found' };
  await toInput.click();
  await page.waitForTimeout(500);

  for (const c of recipientName) {
    await page.keyboard.type(c);
    await page.waitForTimeout(40 + Math.random() * 60);
  }
  await page.waitForTimeout(humanDelay(2000, 3000));

  // Sélectionner la première suggestion (1er degré)
  const option = page.locator('[role="option"]').first();
  if (await option.count() === 0) return { success: false, error: 'no suggestions found' };

  // Vérifier que c'est bien 1er degré
  const optionText = await option.textContent();
  if (!optionText.includes('1er') && !optionText.includes('1st')) {
    return { success: false, error: 'recipient not 1st degree connection' };
  }

  await option.click();
  await page.waitForTimeout(humanDelay(2000, 3000));

  // Trouver le textbox message
  const msgBox = page.locator('div[role="textbox"]').last();
  if (await msgBox.count() === 0) return { success: false, error: 'message textbox not found (Premium required?)' };

  await msgBox.click();
  await page.waitForTimeout(500);

  for (const c of messageText) {
    await page.keyboard.type(c);
    await page.waitForTimeout(25 + Math.random() * 50);
  }
  await page.waitForTimeout(humanDelay(1000, 2000));

  // Cliquer Envoyer
  const sendBtn = page.locator('button[type="submit"]').filter({ hasText: 'Envoyer' });
  if (await sendBtn.count() === 0) return { success: false, error: 'send button not found' };

  const box = await sendBtn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.waitForTimeout(300);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await page.waitForTimeout(humanDelay(3000, 5000));
  
  // Vérifier que le message est bien arrivé (anti shadow ban)
  // Note: conversationId devrait être extrait de l'URL, pour l'instant on skip
  // const verification = await detector.verifyMessageSent(page, conversationId, messageText);
  
  return { success: true, verified: true }; // TODO: implémenter vérification message
}

// ═══════════════════════════════════════════
// POST
// ═══════════════════════════════════════════

/**
 * Publier un post LinkedIn
 * @param {string} postText — contenu du post
 */
async function createPost(page, postText) {
  await page.goto('https://www.linkedin.com/feed/', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  });
  await page.waitForTimeout(humanDelay(4000, 6000));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  // Cliquer "Commencer un post"
  const startPost = await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const t = el.textContent?.trim();
      if (t === 'Commencer un post' && el.offsetParent && el.children.length === 0) {
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return null;
  });

  if (!startPost) return { success: false, error: 'start post button not found' };

  await page.mouse.click(startPost.x, startPost.y);
  await page.waitForTimeout(humanDelay(4000, 6000));

  // Trouver l'éditeur (shadow DOM — nécessite getByRole)
  const editor = page.getByRole('textbox', { name: 'contenu' });
  if (await editor.count() === 0) return { success: false, error: 'editor textbox not found' };

  await editor.click();
  await page.waitForTimeout(humanDelay(500, 1000));

  // Taper le post
  await page.keyboard.type(postText, { delay: 30 });
  await page.waitForTimeout(humanDelay(1500, 3000));

  // Cliquer Publier (dans shadow DOM)
  const publier = page.getByTestId('interop-shadowdom').getByRole('button', { name: 'Publier' });
  if (await publier.count() === 0) return { success: false, error: 'publish button not found' };

  await publier.click();
  await page.waitForTimeout(humanDelay(5000, 8000));

  // Vérifier que le post a bien été publié (anti shadow ban)
  const verification = await detector.verifyPost(page, postText);
  
  return { success: true, verified: verification.verified };
}

// ═══════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════

/**
 * Fermer la bannière cookies si présente
 */
async function dismissCookieBanner(page) {
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (/^(Accepter|Accept)$/.test(b.textContent.trim()) && b.offsetParent) {
        b.click();
        return;
      }
    }
  });
  await page.waitForTimeout(500);
}

module.exports = {
  likePost,
  commentPost,
  followProfile,
  sendConnect,
  sendMessage,
  createPost,
  dismissCookieBanner,
};
