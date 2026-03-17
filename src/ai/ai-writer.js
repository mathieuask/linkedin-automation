/**
 * AI Writer — Génération de messages via l'agent OpenClaw
 * 
 * PRINCIPE : Ce module est appelé PAR l'agent OpenClaw (via cron agentTurn).
 * L'agent LUI-MÊME est l'IA qui écrit les messages.
 * 
 * Ce fichier fournit les PROMPTS et le CONTEXTE à passer à l'agent.
 * L'agent génère le texte directement dans sa session.
 * 
 * PAS DE TEMPLATES. Chaque message est unique, basé sur l'analyse du profil.
 */

require('dotenv').config();

const USER_NAME = process.env.USER_NAME || 'YourName';
const USER_AGE = process.env.USER_AGE || 'XX';
const COMPANY_NAME = process.env.COMPANY_NAME || '{{COMPANY_NAME}}';

/**
 * Construit le prompt pour générer une invitation LinkedIn
 * L'agent utilisera ce contexte pour écrire un message unique
 */
function buildInvitationPrompt(profile, guideNotes = '') {
  return `Écris une note d'invitation LinkedIn (MAX 300 caractères) pour ce prospect.

PROFIL :
- Nom : ${profile.firstName} ${profile.lastName}
- Titre : ${profile.headline || 'Non renseigné'}
- Industrie : ${profile.industryName || 'Non renseignée'}
- Localisation : ${profile.locationName || 'Non renseignée'}
- Résumé : ${(profile.summary || '').substring(0, 200)}

RÈGLES ${COMPANY_NAME} :
- Tu es ${USER_NAME}, ${USER_AGE} ans, co-fondateur de ${COMPANY_NAME} ({{SERVICE}} development)
- Ton : pro, direct, humain — PAS de blabla commercial
- Tutoie JAMAIS dans les invitations (vouvoie toujours)
- Pose une VRAIE question liée à leur activité
- PAS de pitch, PAS de "je me permets", PAS de "ce serait un plaisir"
- Mots INTERDITS : "en gros", "genre", "mec", "ouf", "stylé"
- Référence quelque chose de SPÉCIFIQUE à leur profil
- MAX 300 caractères

${guideNotes ? 'NOTES SUPPLÉMENTAIRES :\n' + guideNotes : ''}

Réponds UNIQUEMENT avec le texte du message, rien d'autre.`;
}

/**
 * Construit le prompt pour générer un commentaire sous un post
 */
function buildCommentPrompt(post, authorProfile = null) {
  return `Écris un commentaire LinkedIn (MAX 200 caractères) sous ce post.

POST DE : ${post.author || 'Inconnu'}
${authorProfile ? `TITRE : ${authorProfile.headline || ''}` : ''}

CONTENU DU POST :
"${(post.text || '').substring(0, 500)}"

STATS : ${post.likes || 0} likes, ${post.comments || 0} commentaires

RULES:
- You are ${USER_NAME}, developer at ${COMPANY_NAME} ({{SERVICE}} development)
- Commentaire authentique, PAS générique ("Super post !" = INTERDIT)
- Ajoute de la VALEUR : ton expérience, une nuance, une question pertinente
- Ton naturel, comme un vrai commentaire
- Si le post parle de tech/mobile/startup → tu peux mentionner ton expertise
- Si non tech → commente en tant qu'humain, pas en tant que vendeur
- PAS de emoji excessif (1 max)
- MAX 200 caractères

Réponds UNIQUEMENT avec le texte du commentaire, rien d'autre.`;
}

/**
 * Construit le prompt pour générer un premier message après acceptation
 */
function buildFirstMessagePrompt(profile, invitationNote = '') {
  return `Écris un premier message LinkedIn à envoyer à ce prospect qui vient d'accepter notre invitation.

PROFIL :
- Nom : ${profile.firstName} ${profile.lastName}
- Titre : ${profile.headline || 'Non renseigné'}
- Industrie : ${profile.industryName || 'Non renseignée'}
- Localisation : ${profile.locationName || 'Non renseignée'}

${invitationNote ? `NOTE D'INVITATION QU'ON AVAIT ENVOYÉE :\n"${invitationNote}"\n` : ''}

RULES:
- You are ${USER_NAME}, co-founder at ${COMPANY_NAME}
- Thank for acceptance NATURALLY (not "Thank you for accepting my request")
- Enchaîne sur une question liée à leur activité
- PAS de pitch commercial
- L'objectif : démarrer une CONVERSATION, pas vendre
- Si on avait posé une question dans l'invitation → y faire référence
- Ton : humain, curieux, direct
- MAX 500 caractères

Réponds UNIQUEMENT avec le texte du message, rien d'autre.`;
}

/**
 * Construit le prompt pour générer un post LinkedIn
 */
function buildPostPrompt(topic, pillar = 'tips_tech', context = '') {
  const pillarGuide = {
    tips_tech: 'Tech tips — share a concrete dev tip',
    case_study: 'Client case study — tell a project with process + results',
    build_in_public: `Build in public — ${COMPANY_NAME} behind the scenes, transparency`,
    conseil_startup: 'Startup/SME advice — accessible non-tech advice',
    personal_brand: 'Personal brand — opinion, personal feedback',
  };

  return `Écris un post LinkedIn sur ce sujet.

SUJET : ${topic}
PILIER : ${pillarGuide[pillar] || pillar}
${context ? `CONTEXTE : ${context}` : ''}

RULES:
- You are ${USER_NAME}, ${USER_AGE} years old, co-founder at ${COMPANY_NAME}
- 150-450 words depending on content quality
- Structure : accroche → développement → conclusion avec ouverture
- Ton : décontracté mais articulé, éducatif et positif
- Tutoie le lecteur dans les posts
- Tournures orales dosées : "Le truc c'est", "Honnêtement ?", "C'est tout."
- PAS de buzzwords creux ("synergie", "disruption", "game-changer")
- PAS de emojis dans chaque ligne (2-3 max dans tout le post)
- PAS de hashtags à rallonge (3 max en fin de post)
- Ajoute de la VRAIE valeur : expérience concrète, chiffres, anecdotes
- Si tips tech : code snippet ou conseil actionnable
- Si case study : timeline + résultats concrets

Réponds UNIQUEMENT avec le texte du post, rien d'autre.`;
}

/**
 * Construit le prompt pour répondre à un message DM
 */
function buildReplyPrompt(conversation, lastMessage, profile) {
  return `Écris une réponse à ce message LinkedIn.

PROSPECT :
- Nom : ${profile.firstName || ''} ${profile.lastName || ''}
- Titre : ${profile.headline || ''}

HISTORIQUE CONVERSATION :
${conversation || '(Pas d\'historique)'}

DERNIER MESSAGE REÇU :
"${lastMessage}"

RULES:
- You are ${USER_NAME}, co-founder at ${COMPANY_NAME}
- Answer NATURALLY to the message
- If question about pricing → "It depends on the project, we start from {{PRICE_FROM}} for an MVP. Shall we discuss it on a call?"
- Si intéressé → propose un call "Cette semaine ça te dit qu'on en parle 15-20 min ?"
- Si pas intéressé → remercie poliment, pas insistant
- Ton humain, direct, pas commercial
- MAX 300 caractères

Réponds UNIQUEMENT avec le texte de la réponse, rien d'autre.`;
}

module.exports = {
  buildInvitationPrompt,
  buildCommentPrompt,
  buildFirstMessagePrompt,
  buildPostPrompt,
  buildReplyPrompt,
};
