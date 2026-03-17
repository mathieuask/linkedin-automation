require('dotenv').config();

/**
 * Générateur de messages personnalisés pour LinkedIn
 * Templates intelligents par rôle et industrie (pas d'API externe pour l'instant)
 * 
 * Ton : pro, direct, orienté valeur, pas spammy
 * {{COMPANY_NAME}} = {{SERVICE}} provider, {{DELIVERY_TIME}} delivery, pricing from {{PRICE_FROM}}
 */

// Templates par rôle
const ROLE_TEMPLATES = {
  founder: {
    invitation: [
      "Bonjour {firstName}, je vois que vous êtes fondateur — j'aimerais échanger sur vos enjeux tech. We develop {{SERVICE}} solutions for startups, with {{DELIVERY_TIME}} delivery. Ouvert à un échange ?",
      "Salut {firstName}, votre parcours de founder m'intéresse. Chez {{COMPANY_NAME}}, on aide les fondateurs à lancer leur projet rapidement ({{SERVICE}}, {{DELIVERY_TIME}}, from {{PRICE_FROM}}). Partant pour un call rapide ?",
      "{firstName}, en tant que fondateur, vous savez qu'un bon MVP peut tout changer. On livre des solutions {{SERVICE}} en {{DELIVERY_TIME}} for startups. Ça vous dit d'en discuter ?"
    ],
    comment: [
      "Excellent point sur {topic} ! En tant que studio tech, on voit exactement ces enjeux chez nos clients startups.",
      "Merci pour ce partage {firstName}. C'est précisément pour ça qu'on privilégie {{SERVICE}} — time-to-market imbattable.",
      "100% d'accord. On aide justement les fondateurs à valider leur MVP rapidement ({{DELIVERY_TIME}}) avant d'investir gros."
    ],
    first_message: [
      "Merci d'avoir accepté {firstName} ! Curieux de savoir où vous en êtes sur votre roadmap produit — on pourrait peut-être vous faire gagner du temps.",
      "Super de connecter ! Je serais ravi d'en savoir plus sur vos projets tech. Chez {{COMPANY_NAME}}, on accompagne des fondateurs comme vous sur leurs projets.",
      "Content de faire partie de votre réseau {firstName}. Si jamais vous avez des besoins en dev ({{SERVICE}}), on livre des MVPs en {{DELIVERY_TIME}}."
    ]
  },
  ceo: {
    invitation: [
      "Bonjour {firstName}, votre parcours m'intéresse. Nous aidons les dirigeants à lancer leur projet rapidement ({{DELIVERY_TIME}}, {{SERVICE}}). Seriez-vous ouvert à un bref échange ?",
      "{firstName}, en tant que CEO, vous savez l'importance d'un bon time-to-market. {{COMPANY_NAME}} livre des solutions {{SERVICE}} en {{DELIVERY_TIME}} pour les entreprises. Partant pour un échange ?",
      "Bonjour {firstName}, je développe des solutions {{SERVICE}} pour les dirigeants qui veulent aller vite ({{DELIVERY_TIME}}, from {{PRICE_FROM}}). Ouvert à en discuter ?"
    ],
    comment: [
      "Vision claire ! C'est exactement le type de roadmap qu'on aide à exécuter chez nos clients.",
      "Merci pour ce partage {firstName}. La vélocité tech est souvent le vrai différenciateur.",
      "Pertinent. On voit beaucoup de CEOs qui gagnent 6 mois en démarrant avec un bon MVP."
    ],
    first_message: [
      "Merci {firstName} ! Curieux de savoir quels sont vos enjeux tech actuels — on accompagne pas mal de dirigeants sur leurs projets.",
      "Super de connecter ! Je serais ravi d'échanger sur vos projets digitaux. {{COMPANY_NAME}} livre des MVPs en {{DELIVERY_TIME}}.",
      "Content de faire partie de votre réseau {firstName}. Si besoin d'accélérer sur vos projets, on est là ({{SERVICE}}, {{DELIVERY_TIME}})."
    ]
  },
  cto: {
    invitation: [
      "Bonjour {firstName}, en tant que tech lead, vous connaissez les enjeux du développement. On livre des MVPs {{SERVICE}} en {{DELIVERY_TIME}} for startups. Intéressé par un échange technique ?",
      "{firstName}, votre stack m'intéresse. Chez {{COMPANY_NAME}}, on est spécialisés {{SERVICE}} / {{TECH_STACK}} pour du cross-platform. Partant pour un échange tech ?",
      "Salut {firstName}, entre techs : on aide les CTO à valider leurs MVPs en {{DELIVERY_TIME}} ({{SERVICE}}, {{TECH_STACK}}). Ouvert à discuter ?"
    ],
    comment: [
      "Excellente approche technique ! {{SERVICE}} + {{TECH_STACK}}, c'est exactement notre stack aussi.",
      "100% d'accord {firstName}. On voit trop de projets qui partent sur du natif alors qu'un bon MVP {{SERVICE}} suffit.",
      "Pertinent. La vélocité dev est critique — c'est pour ça qu'on pousse {{SERVICE}} chez nos clients."
    ],
    first_message: [
      "Merci {firstName} ! Curieux de savoir sur quelle stack vous êtes — chez nous c'est {{SERVICE}} / {{TECH_STACK}}.",
      "Super de connecter ! Si jamais tu cherches à accélérer sur tes projets, on livre des MVPs en {{DELIVERY_TIME}}.",
      "Content de faire partie de ton réseau {firstName}. Toujours partant pour échanger sur des enjeux tech."
    ]
  },
  manager: {
    invitation: [
      "Bonjour {firstName}, votre profil m'intéresse. On aide les managers à digitaliser leurs process ({{SERVICE}}, MVP en {{DELIVERY_TIME}}). Ouvert à un échange ?",
      "{firstName}, je développe des solutions {{SERVICE}} pour les entreprises qui veulent aller vite ({{DELIVERY_TIME}}, from {{PRICE_FROM}}). Seriez-vous intéressé par un bref call ?",
      "Bonjour {firstName}, {{COMPANY_NAME}} accompagne les managers sur leurs projets (MVP {{SERVICE}} livré en {{DELIVERY_TIME}}). Partant pour échanger ?"
    ],
    comment: [
      "Merci pour ce partage {firstName}. On voit exactement ces enjeux chez nos clients.",
      "Pertinent ! La transformation digitale passe souvent par une bonne solution tech.",
      "100% d'accord. Un bon MVP peut vraiment changer la donne."
    ],
    first_message: [
      "Merci {firstName} ! Curieux de savoir quels sont vos projets digitaux en cours.",
      "Super de connecter ! Si jamais vous avez des besoins en développement, {{COMPANY_NAME}} livre des MVPs en {{DELIVERY_TIME}}.",
      "Content de faire partie de votre réseau {firstName}. Toujours ravi d'échanger sur des enjeux de digitalisation."
    ]
  },
  default: {
    invitation: [
      "Bonjour {firstName}, je développe des solutions {{SERVICE}} pour les startups et PME ({{DELIVERY_TIME}}). Votre profil m'intéresse — ouvert à un échange ?",
      "{firstName}, {{COMPANY_NAME}} aide les entreprises à lancer leur projet rapidement ({{SERVICE}}, {{DELIVERY_TIME}}, from {{PRICE_FROM}}). Partant pour un bref échange ?",
      "Bonjour {firstName}, on livre des solutions {{SERVICE}} en {{DELIVERY_TIME}} for startups. Votre parcours m'intéresse — ouvert à discuter ?"
    ],
    comment: [
      "Merci pour ce partage {firstName} ! Très pertinent.",
      "Excellente réflexion. C'est exactement ce qu'on voit sur le terrain.",
      "100% d'accord avec cette vision."
    ],
    first_message: [
      "Merci {firstName} ! Ravi de connecter. Curieux de savoir où vous en êtes sur vos projets.",
      "Super de faire partie de votre réseau ! Si besoin en dev, {{COMPANY_NAME}} livre des MVPs en {{DELIVERY_TIME}}.",
      "Content de connecter {firstName}. Toujours partant pour échanger sur des projets tech."
    ]
  }
};

// Templates par industrie (adaptations légères)
const INDUSTRY_VARIANTS = {
  'fintech': {
    hook: "financial apps need security and smooth UX",
    value: "We've delivered fintech MVPs in {{DELIVERY_TIME}} (KYC, secure payments)"
  },
  'healthtech': {
    hook: "digital health requires GDPR compliance and accessible UX",
    value: "We build e-health projects with sensitive data (GDPR-ready)"
  },
  'e-commerce': {
    hook: "a good mobile conversion funnel can double your revenue",
    value: "We deliver e-commerce apps with integrated payment in {{DELIVERY_TIME}}"
  },
  'saas': {
    hook: "your SaaS deserves a converting mobile app",
    value: "We transform web SaaS into mobile apps ({{SERVICE}}) in {{DELIVERY_TIME}}"
  },
  'marketplace': {
    hook: "successful marketplaces are mobile-first",
    value: "We deliver marketplace apps (dual buyer/seller interface) in {{DELIVERY_TIME}}"
  }
};

/**
 * Détermine le rôle du profil
 */
function detectRole(profile) {
  const title = (profile.headline || '').toLowerCase();
  
  if (/founder|fondateur|co-founder/i.test(title)) return 'founder';
  if (/\bceo\b|directeur général|dirigeant/i.test(title)) return 'ceo';
  if (/\bcto\b|chief technology|directeur technique|tech lead/i.test(title)) return 'cto';
  if (/manager|responsable|directeur(?! général)/i.test(title)) return 'manager';
  
  return 'default';
}

/**
 * Détermine l'industrie du profil
 */
function detectIndustry(profile) {
  const text = `${profile.headline || ''} ${profile.industryName || ''}`.toLowerCase();
  
  if (/fintech|banque|finance|payment/i.test(text)) return 'fintech';
  if (/health|santé|médical|e-santé/i.test(text)) return 'healthtech';
  if (/e-commerce|retail|vente en ligne/i.test(text)) return 'e-commerce';
  if (/saas|software|logiciel/i.test(text)) return 'saas';
  if (/marketplace|plateforme/i.test(text)) return 'marketplace';
  
  return null;
}

/**
 * Remplace les variables dans un template
 */
function fillTemplate(template, profile) {
  return template
    .replace(/{firstName}/g, profile.firstName || 'Bonjour')
    .replace(/{lastName}/g, profile.lastName || '')
    .replace(/{topic}/g, 'ce sujet') // Placeholder pour commentaires
    .trim();
}

/**
 * Génère un message personnalisé
 * @param {Object} profile - { firstName, lastName, headline, industryName }
 * @param {string} type - 'invitation' | 'comment' | 'first_message'
 * @param {Object} options - { maxLength, topic (pour commentaires) }
 * @returns {string}
 */
function generateMessage(profile, type = 'invitation', options = {}) {
  const role = detectRole(profile);
  const industry = detectIndustry(profile);
  
  // Limites de caractères par type
  const maxLength = options.maxLength || (type === 'invitation' ? 300 : type === 'comment' ? 200 : 500);
  
  // Sélectionner templates du rôle
  const templates = ROLE_TEMPLATES[role] || ROLE_TEMPLATES.default;
  const typeTemplates = templates[type] || templates.invitation;
  
  // Choisir un template au hasard
  const template = typeTemplates[Math.floor(Math.random() * typeTemplates.length)];
  
  // Remplir les variables
  let message = fillTemplate(template, profile);
  
  // Adapter selon l'industrie (pour invitations seulement)
  if (type === 'invitation' && industry && INDUSTRY_VARIANTS[industry]) {
    const variant = INDUSTRY_VARIANTS[industry];
    // Remplacer la value prop générique par la spécifique (10% du temps pour variété)
    if (Math.random() < 0.1) {
      message = message.replace(/MVP en 3-5 semaines[^.]+/, variant.value);
    }
  }
  
  // Tronquer si trop long
  if (message.length > maxLength) {
    message = message.substring(0, maxLength - 3) + '...';
  }
  
  return message;
}

module.exports = { generateMessage };
