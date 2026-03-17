/**
 * Autoresearch — Auto-amélioration du code de prospection
 * Inspiré du projet Karpathy : mesure → modifie → teste → garde ou annule
 * 
 * Fonctionne à la fin du bilan quotidien.
 * Métriques cibles :
 *   1. Taux d'acceptation invitations (principal)
 *   2. Taux de réponse premier message
 *   3. Taux de succès des actions (proxy qualité code)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('@notionhq/client');
const Anthropic = require('@anthropic-ai/sdk');

const CHANGES_LOG = path.resolve(__dirname, '../../.learnings/CHANGES.md');
const METRICS_LOG = path.resolve(__dirname, '../../.learnings/metrics-history.json');
const GENERATE_MSG_FILE = path.resolve(__dirname, '../ai/generate-message.js');
const WARMUP_CONFIG = path.resolve(__dirname, '../../config/warm-up.json');
const SCORING_FILE = path.resolve(__dirname, '../core/scoring.js');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DEALS_DB_ID = process.env.NOTION_DEALS_DB_ID;

/**
 * Récupère les métriques CRM des 7 derniers jours depuis Notion
 */
async function getCRMMetrics() {
  if (!NOTION_TOKEN) {
    console.log('⚠️  NOTION_TOKEN manquant — métriques CRM indisponibles');
    return null;
  }

  const notion = new Client({ auth: NOTION_TOKEN });

  try {
    // Récupérer tous les prospects
    const response = await notion.databases.query({
      database_id: DEALS_DB_ID,
      page_size: 100
    });

    const prospects = response.results;
    const total = prospects.length;

    const invited = prospects.filter(p =>
      ['📤 Invitation envoyée', '✅ Invitation acceptée', '📧 Contacté', '💬 Répondu', '📅 RDV booké', '🔍 Qualifié', '📝 Devis envoyé', '✅ Gagné'].includes(
        p.properties?.Statut?.select?.name || ''
      )
    ).length;

    const accepted = prospects.filter(p =>
      ['✅ Invitation acceptée', '📧 Contacté', '💬 Répondu', '📅 RDV booké', '🔍 Qualifié', '📝 Devis envoyé', '✅ Gagné'].includes(
        p.properties?.Statut?.select?.name || ''
      )
    ).length;

    const replied = prospects.filter(p =>
      ['💬 Répondu', '📅 RDV booké', '🔍 Qualifié', '📝 Devis envoyé', '✅ Gagné'].includes(
        p.properties?.Statut?.select?.name || ''
      )
    ).length;

    const meetings = prospects.filter(p =>
      ['📅 RDV booké', '🔍 Qualifié', '📝 Devis envoyé', '✅ Gagné'].includes(
        p.properties?.Statut?.select?.name || ''
      )
    ).length;

    return {
      total,
      invited,
      accepted,
      replied,
      meetings,
      acceptance_rate: invited > 0 ? Math.round((accepted / invited) * 100) : 0,
      reply_rate: accepted > 0 ? Math.round((replied / accepted) * 100) : 0,
      meeting_rate: replied > 0 ? Math.round((meetings / replied) * 100) : 0
    };
  } catch (error) {
    console.error('❌ Erreur CRM metrics:', error.message);
    return null;
  }
}

/**
 * Charge l'historique des métriques
 */
function loadMetricsHistory() {
  if (!fs.existsSync(METRICS_LOG)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(METRICS_LOG, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Sauvegarde les métriques du jour
 */
function saveMetrics(metrics) {
  const history = loadMetricsHistory();
  const today = new Date().toISOString().split('T')[0];

  // Remplace ou ajoute l'entrée du jour
  const idx = history.findIndex(h => h.date === today);
  const entry = { date: today, ...metrics };
  if (idx >= 0) {
    history[idx] = entry;
  } else {
    history.push(entry);
  }

  // Garde max 60 jours
  const trimmed = history.slice(-60);
  fs.writeFileSync(METRICS_LOG, JSON.stringify(trimmed, null, 2));
}

/**
 * Identifie la métrique la plus faible à améliorer
 */
function identifyWeakMetric(current, history) {
  // Benchmarks cibles
  const targets = {
    acceptance_rate: 35,  // %
    reply_rate: 15,        // %
    meeting_rate: 20       // %
  };

  // Calcule les gaps
  const gaps = {
    acceptance_rate: targets.acceptance_rate - (current.acceptance_rate || 0),
    reply_rate: targets.reply_rate - (current.reply_rate || 0),
    meeting_rate: targets.meeting_rate - (current.meeting_rate || 0)
  };

  // Retourne la métrique avec le plus grand gap (la plus loin de l'objectif)
  const weakest = Object.entries(gaps)
    .filter(([, gap]) => gap > 0)
    .sort(([, a], [, b]) => b - a)[0];

  if (!weakest) {
    return { metric: 'acceptance_rate', gap: 0, note: 'Tous les objectifs atteints — optimisation continue' };
  }

  return { metric: weakest[0], gap: weakest[1] };
}

/**
 * Lit les fichiers de code pertinents pour le contexte
 */
function readCodeFiles() {
  const files = {};

  if (fs.existsSync(GENERATE_MSG_FILE)) {
    files.generate_message = fs.readFileSync(GENERATE_MSG_FILE, 'utf8');
  }
  if (fs.existsSync(WARMUP_CONFIG)) {
    files.warmup_config = fs.readFileSync(WARMUP_CONFIG, 'utf8');
  }
  if (fs.existsSync(SCORING_FILE)) {
    files.scoring = fs.readFileSync(SCORING_FILE, 'utf8');
  }

  return files;
}

/**
 * Applique une modification de code via Claude
 */
async function applyCodeImprovement(weakMetric, currentMetrics, history) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('⚠️  ANTHROPIC_API_KEY manquant — autoresearch skipped');
    return null;
  }

  const client = new Anthropic({ apiKey });
  const codeFiles = readCodeFiles();

  // Contexte historique (7 derniers jours)
  const recentHistory = history.slice(-7);
  const historyText = recentHistory.length > 0
    ? recentHistory.map(h =>
        `${h.date}: acceptance=${h.acceptance_rate}% reply=${h.reply_rate}% meetings=${h.meetings}`
      ).join('\n')
    : 'Pas encore d\'historique suffisant';

  // Changelog des modifications précédentes
  let previousChanges = '';
  if (fs.existsSync(CHANGES_LOG)) {
    previousChanges = fs.readFileSync(CHANGES_LOG, 'utf8');
  }

  const prompt = `You are the autoresearch agent for {{COMPANY_NAME}} — your job is to autonomously improve the LinkedIn prospecting code.

## Company Context
- {{SERVICE}} development using {{TECH_STACK}}
- {{DELIVERY_TIME}} delivery, from {{PRICE_FROM}}
- Cible : startups early-stage FR (CEO/CTO/Founder)
- LinkedIn automation : warm-up progressif (J+${recentHistory.length})

## Métriques actuelles
- Invitations envoyées : ${currentMetrics.invited}
- Taux acceptation : ${currentMetrics.acceptance_rate}% (objectif : 35%)
- Taux réponse : ${currentMetrics.reply_rate}% (objectif : 15%)
- Meetings bookés : ${currentMetrics.meetings} (objectif : 2-4/semaine)

## Historique 7 jours
${historyText}

## Métrique à améliorer aujourd'hui
**${weakMetric.metric}** — écart de ${weakMetric.gap}% vs objectif
${weakMetric.note || ''}

## Modifications précédentes (éviter de répéter)
${previousChanges.slice(-2000)}

## Code actuel

### generate-message.js (templates invitation/message)
\`\`\`javascript
${(codeFiles.generate_message || '').slice(0, 4000)}
\`\`\`

### warm-up.json (quotas et phases)
\`\`\`json
${codeFiles.warmup_config || ''}
\`\`\`

## Ta mission
Propose ET applique UNE seule modification ciblée pour améliorer **${weakMetric.metric}**.

Règles :
1. UNE seule modification (pas 5 changements)
2. Mesurable : explique comment on saura si ça a marché
3. Réversible : pas de changements destructifs
4. Adapté à la phase de warm-up actuelle (ne pas dépasser les quotas)
5. Pour les templates : améliore la personnalisation, l'accroche, la proposition de valeur

Réponds en JSON valide uniquement :
{
  "modification_type": "template|config|scoring",
  "file_path": "chemin/relatif/depuis/linkedin-automation/",
  "description": "Ce que tu as changé et pourquoi (2-3 phrases)",
  "metric_targeted": "${weakMetric.metric}",
  "expected_improvement": "Comment mesurer le succès dans 7 jours",
  "old_snippet": "extrait exact du code AVANT (pour trouver et remplacer)",
  "new_snippet": "extrait exact du code APRÈS"
}`;

  try {
    console.log(`\n🧠 Claude analyse les métriques et propose une amélioration...`);

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = response.content[0].text.trim();

    // Extraire le JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('❌ Réponse Claude non-JSON:', raw.slice(0, 200));
      return null;
    }

    const improvement = JSON.parse(jsonMatch[0]);
    return improvement;

  } catch (error) {
    console.error('❌ Erreur Claude autoresearch:', error.message);
    return null;
  }
}

/**
 * Applique la modification dans le fichier cible
 */
function applyFileChange(improvement) {
  const baseDir = path.resolve(__dirname, '../..');
  const filePath = path.join(baseDir, improvement.file_path);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Fichier introuvable : ${filePath}`);
    return false;
  }

  const content = fs.readFileSync(filePath, 'utf8');

  if (!content.includes(improvement.old_snippet)) {
    console.error('❌ Snippet "old" introuvable dans le fichier — modification annulée');
    console.log('Cherché :', improvement.old_snippet.slice(0, 100));
    return false;
  }

  // Backup avant modification
  const backupPath = filePath + `.backup-${new Date().toISOString().split('T')[0]}`;
  fs.writeFileSync(backupPath, content);
  console.log(`💾 Backup : ${path.basename(backupPath)}`);

  // Appliquer
  const newContent = content.replace(improvement.old_snippet, improvement.new_snippet);
  fs.writeFileSync(filePath, newContent);
  console.log(`✅ Modification appliquée : ${improvement.file_path}`);

  return true;
}

/**
 * Log la modification dans CHANGES.md
 */
function logChange(improvement, metrics) {
  const today = new Date().toISOString().split('T')[0];
  const entry = `
---
## ${today} — ${improvement.metric_targeted}

**Fichier modifié :** \`${improvement.file_path}\`
**Type :** ${improvement.modification_type}

**Changement :** ${improvement.description}

**Métriques avant :**
- Acceptance rate : ${metrics.acceptance_rate}%
- Reply rate : ${metrics.reply_rate}%
- Meetings : ${metrics.meetings}

**Comment mesurer le succès :** ${improvement.expected_improvement}
`;

  fs.appendFileSync(CHANGES_LOG, entry);
}

/**
 * Point d'entrée principal
 */
async function run() {
  console.log('\n🔬 === AUTORESEARCH — Auto-amélioration du code ===\n');

  // 1. Récupérer les métriques actuelles
  console.log('📊 Récupération métriques CRM...');
  const currentMetrics = await getCRMMetrics();

  if (!currentMetrics) {
    console.log('⚠️  Pas de métriques disponibles — autoresearch skipped');
    return { skipped: true, reason: 'no_metrics' };
  }

  console.log(`  Invitations : ${currentMetrics.invited} envoyées, ${currentMetrics.accepted} acceptées`);
  console.log(`  Acceptance rate : ${currentMetrics.acceptance_rate}%`);
  console.log(`  Reply rate : ${currentMetrics.reply_rate}%`);
  console.log(`  Meetings : ${currentMetrics.meetings}`);

  // 2. Sauvegarder les métriques du jour
  saveMetrics(currentMetrics);
  const history = loadMetricsHistory();

  // 3. Identifier la métrique la plus faible
  const weakMetric = identifyWeakMetric(currentMetrics, history);
  console.log(`\n🎯 Métrique cible : ${weakMetric.metric} (gap: ${weakMetric.gap}%)`);

  // 4. Demander une amélioration à Claude
  const improvement = await applyCodeImprovement(weakMetric, currentMetrics, history);

  if (!improvement) {
    console.log('⚠️  Pas d\'amélioration générée');
    return { skipped: true, reason: 'no_improvement' };
  }

  console.log(`\n📝 Modification proposée : ${improvement.description}`);

  // 5. Appliquer la modification
  const applied = applyFileChange(improvement);

  if (!applied) {
    return { skipped: true, reason: 'apply_failed' };
  }

  // 6. Logger le changement
  logChange(improvement, currentMetrics);

  console.log('\n✅ Autoresearch terminé — modification appliquée et loggée');
  console.log(`📋 Log : .learnings/CHANGES.md`);

  return {
    success: true,
    metric_targeted: improvement.metric_targeted,
    description: improvement.description,
    expected_improvement: improvement.expected_improvement
  };
}

if (require.main === module) {
  run()
    .then(result => {
      if (result.success) {
        console.log('\n🚀 Résultat:', JSON.stringify(result, null, 2));
      }
      process.exit(0);
    })
    .catch(e => {
      console.error('❌ Erreur fatale autoresearch:', e.message);
      process.exit(1);
    });
}

module.exports = { run };
