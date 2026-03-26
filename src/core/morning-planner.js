require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('@notionhq/client');

/**
 * Morning Planner — Génère les quotas quotidiens basés sur la phase warm-up
 * Exécuté chaque jour à 08h00
 */
class MorningPlanner {
  constructor(configPath = '../../config/warm-up.json') {
    const fullPath = path.resolve(__dirname, configPath);
    this.config = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    this.today = new Date().toISOString().split('T')[0];
    this.notion = new Client({ auth: process.env.NOTION_TOKEN });
    this.contenuDatabaseId = process.env.NOTION_CONTENT_DB_ID;
  }

  /**
   * Vérifie si un post "✅ Validé" existe dans Notion Contenu
   */
  async checkValidatedPost() {
    try {
      const response = await this.notion.databases.query({
        database_id: this.contenuDatabaseId,
        filter: {
          and: [
            {
              property: 'Statut',
              select: { equals: '✅ Validé' }
            },
            {
              property: 'Plateforme',
              select: { equals: 'LinkedIn' }
            }
          ]
        },
        sorts: [{ property: 'Date publication', direction: 'ascending' }],
        page_size: 1
      });

      // API a répondu avec succès
      if (response.results.length > 0) {
        const post = response.results[0];
        const titre = post.properties.Titre?.title[0]?.plain_text || 'Sans titre';
        const pilier = post.properties.Pilier?.select?.name || '';
        return { exists: true, titre, pilier, api_ok: true };
      }

      // API OK mais 0 posts validés (cas normal)
      return { exists: false, api_ok: true };
      
    } catch (error) {
      // VRAIE erreur API (network, auth, etc.)
      console.error('❌ ERREUR NOTION API:', error.message);
      console.error('   Code:', error.code || 'unknown');
      
      // Distinguer erreurs auth vs autres
      if (error.code === 'unauthorized' || error.status === 401) {
        console.error('   → Token Notion INVALIDE ou expiré !');
        return { exists: false, error: true, error_type: 'auth' };
      }
      
      return { exists: false, error: true, error_type: 'network' };
    }
  }

  /**
   * Détermine la phase actuelle basée sur start_date
   */
  getCurrentPhase() {
    const startDate = new Date(this.config.start_date);
    const today = new Date();
    const daysSinceStart = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));

    // J0 = premier jour = observation
    if (daysSinceStart === 0) {
      return { name: 'observation', ...this.config.phases.observation, daysSinceStart: 1 };
    }

    for (const [phaseName, phase] of Object.entries(this.config.phases)) {
      const [min, max] = phase.days.replace('+', '').split('-').map(d => parseInt(d) || 999);
      
      if (daysSinceStart >= min && daysSinceStart <= max) {
        return { name: phaseName, ...phase, daysSinceStart };
      }
    }

    // Par défaut : pleine vitesse
    return { name: 'pleine_vitesse', ...this.config.phases.pleine_vitesse, daysSinceStart };
  }

  /**
   * Génère un nombre aléatoire dans une range "min-max"
   */
  randomInRange(range) {
    const [min, max] = range.split('-').map(n => parseInt(n));
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Génère un horaire aléatoire dans une plage (HH:MM-HH:MM)
   */
  randomTimeInRange(startHour, startMin, endHour, endMin) {
    const startTotalMin = startHour * 60 + startMin;
    const endTotalMin = endHour * 60 + endMin;
    const randomMin = Math.floor(Math.random() * (endTotalMin - startTotalMin + 1)) + startTotalMin;
    
    const hour = Math.floor(randomMin / 60);
    const min = randomMin % 60;
    
    return { hour, min, time: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}` };
  }

  /**
   * Génère le plan quotidien avec horaires aléatoires
   */
  generateDailyPlan() {
    const phase = this.getCurrentPhase();
    const dayOfWeek = new Date().getDay(); // 0=dimanche, 6=samedi

    // Weekend policy
    if (dayOfWeek === 0) { // Dimanche
      return {
        date: this.today,
        phase: phase.name,
        weekend: true,
        quotas: { invitations: 0, likes: 0, comments: 0, posts: 0 },
        sessions: []
      };
    }

    if (dayOfWeek === 6) { // Samedi
      const runSaturday = Math.random() > 0.5; // 50% chance
      if (!runSaturday) {
        return {
          date: this.today,
          phase: phase.name,
          weekend: true,
          quotas: { invitations: 0, likes: 0, comments: 0, posts: 0 },
          sessions: []
        };
      }
      // Si on run samedi, 1 seule session
      const session1Time = this.randomTimeInRange(9, 10, 9, 50);
      return {
        date: this.today,
        phase: phase.name,
        weekend: true,
        quotas: {
          invitations: this.randomInRange("1-3"),
          likes: this.randomInRange("5-10"),
          comments: 0,
          posts: 0
        },
        sessions: [{
          name: "session_1",
          time: session1Time.time,
          hour: session1Time.hour,
          min: session1Time.min,
          actions: ["scroll", "likes", "check_messages"],
          invitations_quota: 0
        }]
      };
    }

    // Jour normal (lundi-vendredi) — lire les quotas de la PHASE actuelle
    const phaseQuotas = phase.daily_quotas;
    const quotas = {
      invitations: this.randomInRange(phaseQuotas.invitations),
      likes: this.randomInRange(phaseQuotas.likes),
      comments: phaseQuotas.comments === "0" ? 0 : this.randomInRange(phaseQuotas.comments),
      profile_views: this.randomInRange(phaseQuotas.profile_views),
      posts: phaseQuotas.post_creation === "0" ? 0 : this.randomInRange(phaseQuotas.post_creation)
    };

    // Générer horaires aléatoires pour chaque session
    const sessionTimes = [
      { name: "session_1", ...this.randomTimeInRange(9, 10, 9, 50), actions: ["scroll", "likes", "check_messages"] },
      { name: "session_2", ...this.randomTimeInRange(10, 10, 10, 50), actions: ["scroll", "likes", "invitations_40%"] },
      { name: "session_3", ...this.randomTimeInRange(11, 10, 11, 50), actions: ["scroll", "likes", "comment", "check_messages"] },
      { name: "session_4", ...this.randomTimeInRange(15, 10, 15, 50), actions: ["scroll", "likes", "invitations_40%"] },
      { name: "session_5", ...this.randomTimeInRange(16, 10, 16, 50), actions: ["scroll", "likes", "invitations_20%", "check_messages"] },
      { name: "session_6", ...this.randomTimeInRange(17, 10, 18, 50), actions: ["scroll", "likes", "post", "comment"] }
    ];

    // Sélectionner les sessions actives selon phase
    const activeSessions = sessionTimes.slice(0, phase.sessions_per_day);

    // Répartir les invitations et les likes sur les sessions
    const invitationsPerSession = this.distributeInvitations(
      quotas.invitations, 
      activeSessions.length
    );
    const likesPerSession = this.distributeLikes(
      quotas.likes,
      activeSessions.length
    );

    return {
      date: this.today,
      phase: phase.name,
      daysSinceStart: phase.daysSinceStart,
      weekend: false,
      quotas,
      sessions: activeSessions.map((session, i) => ({
        ...session,
        invitations_quota: invitationsPerSession[i],
        likes_quota: likesPerSession[i]
      }))
    };
  }

  /**
   * Répartit les invitations sur les sessions (40% / 40% / 20%)
   */
  distributeInvitations(total, sessionCount) {
    if (sessionCount === 0) return [];
    if (sessionCount === 1) return [total];
    if (sessionCount === 2) return [Math.ceil(total * 0.6), Math.floor(total * 0.4)];
    
    // 3+ sessions : 40% / 40% / 20% sur les 3 premières sessions invitations
    const distribution = [
      Math.ceil(total * 0.4),
      Math.ceil(total * 0.4),
      Math.floor(total * 0.2)
    ];
    
    while (distribution.length < sessionCount) distribution.push(0);
    return distribution;
  }

  /**
   * Répartit les likes équitablement sur les sessions (arrondi au plus proche)
   * Ex: 5 likes sur 2 sessions → [3, 2]
   */
  distributeLikes(total, sessionCount) {
    if (sessionCount === 0) return [];
    const base = Math.floor(total / sessionCount);
    const remainder = total % sessionCount;
    return Array.from({ length: sessionCount }, (_, i) =>
      i < remainder ? base + 1 : base
    );
  }

  /**
   * Sauvegarde le plan du jour
   */
  saveDailyPlan(plan) {
    const planPath = path.resolve(__dirname, `../../logs/plan-${this.today}.json`);
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');
    return planPath;
  }

  /**
   * Supprime les anciens crons de sessions LinkedIn (du jour précédent)
   * Note: Cette fonction sera appelée depuis OpenClaw via l'outil cron
   */
  getOldSessionCronsToDelete() {
    // Retourne un message pour que l'agent OpenClaw supprime les anciens crons
    return {
      action: 'delete_old_session_crons',
      filter: {
        name_starts_with: 'LinkedIn Session',
        schedule_kind: 'at'
      }
    };
  }

  /**
   * Retourne les crons "at" à créer pour aujourd'hui
   */
  getDailySessionCronsToCreate(sessions) {
    const crons = [];
    
    for (const session of sessions) {
      // Construire timestamp ISO-8601 (Paris timezone → UTC)
      // session.hour est en heure de Paris, on doit convertir en UTC
      const parisOffset = 1; // Paris = UTC+1 en hiver, UTC+2 en été (à gérer selon date)
      const utcHour = session.hour - parisOffset;
      
      const today = new Date();
      const sessionDate = new Date(Date.UTC(
        today.getUTCFullYear(), 
        today.getUTCMonth(), 
        today.getUTCDate(), 
        utcHour, 
        session.min
      ));
      const isoTimestamp = sessionDate.toISOString();
      
      const sessionNum = parseInt(session.name.split('_')[1]);
      
      crons.push({
        name: `LinkedIn Session ${sessionNum} (${session.time})`,
        agentId: 'prospection',
        schedule: {
          kind: 'at',
          at: isoTimestamp
        },
        payload: {
          kind: 'agentTurn',
          message: `exec bash -c "cd /root/.openclaw/workspace-prospection/linkedin-automation && node src/core/session-runner.js ${sessionNum} >> logs/session-${sessionNum}.log 2>&1"`,
          timeoutSeconds: 300
        },
        sessionTarget: 'isolated',
        enabled: true,
        delivery: {
          mode: 'announce',
          channel: 'last'
        }
      });
    }
    
    return crons;
  }

  /**
   * Crée automatiquement un post "⏳ À valider"
   */
  async createDraftPost() {
    try {
      console.log('📝 Création post quotidien...');
      
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      const { stdout } = await execAsync(
        'node src/actions/create-post.js',
        { cwd: path.resolve(__dirname, '../..'), timeout: 60000 }
      );
      
      console.log('✅ Post créé : "⏳ À valider"');
      return true;
      
    } catch (error) {
      console.error('⚠️  Erreur création post:', error.message);
      return false;
    }
  }

  /**
   * Exécution principale
   */
  async run() {
    console.log('🌅 Morning Planner — Génération du plan quotidien\n');
    
    // 1. Générer plan de base
    const plan = this.generateDailyPlan();
    
    // 2. Créer un post "⏳ À valider" automatiquement
    if (!plan.weekend && plan.quotas.posts > 0) {
      await this.createDraftPost();
    }
    
    // 3. Checker si un post validé existe (pour publication aujourd'hui)
    console.log('\n📝 Vérification posts validés dans Notion...');
    console.log('🔑 Token Notion : ✅ VALIDE (testé 2026-03-10)');
    const postCheck = await this.checkValidatedPost();
    
    if (postCheck.exists) {
      console.log(`✅ NOTION API: Connexion réussie`);
      console.log(`✅ Post validé trouvé : "${postCheck.titre}" (${postCheck.pilier})`);
      console.log('📅 Publication planifiée : 19h00');
      plan.post_validated = true;
      plan.post_info = { titre: postCheck.titre, pilier: postCheck.pilier };
      plan.post_time = '19h00';
      plan.notion_api_status = 'ok';
    } else if (postCheck.error) {
      if (postCheck.error_type === 'auth') {
        console.log('❌ TOKEN NOTION INVALIDE — Régénérer le token !');
      } else {
        console.log('⚠️  Erreur réseau Notion API (temporaire)');
      }
      console.log('   → Posts = 0 par sécurité, quotas continuent');
      plan.quotas.posts = 0;
      plan.post_validated = false;
      plan.notion_api_status = postCheck.error_type === 'auth' ? 'invalid_token' : 'network_error';
    } else {
      console.log('✅ NOTION API: Connexion réussie (token valide)');
      console.log('📊 Résultats : 0 posts avec statut "✅ Validé"');
      console.log('   → Situation normale : aucun post prêt à publier');
      console.log('   → Pas de publication LinkedIn prévue aujourd\'hui');
      plan.quotas.posts = 0;
      plan.post_validated = false;
      plan.notion_api_status = 'ok';
    }
    
    // 3. Restart Chrome propre chaque matin (RAM à zéro avant les sessions)
    await this.restartChromeFresh(plan);

    // 4. Générer les crons à créer AVANT de sauvegarder le plan
    if (!plan.weekend && plan.sessions.length > 0) {
      plan.crons_to_create = this.getDailySessionCronsToCreate(plan.sessions);
    }
    
    // 4. Sauvegarder plan
    const planPath = this.saveDailyPlan(plan);
    
    console.log(`\n📅 Date : ${plan.date}`);
    console.log(`🔥 Phase : ${plan.phase} (J+${plan.daysSinceStart || '?'})`);
    
    if (plan.weekend) {
      console.log('🏖️  Weekend : Repos ou session unique');
    } else {
      console.log(`\n📊 Total du jour : 📤 ${plan.quotas.invitations} invitations | 👍 ${plan.quotas.likes} likes | 💬 ${plan.quotas.comments} commentaires | 📝 ${plan.quotas.posts} post${plan.post_validated ? ' (✅ 19h00)' : ''}`);
      
      console.log(`\n✅ ${plan.sessions.length} sessions programmées :`);
      plan.sessions.forEach((s, i) => {
        const utcH = String(parseInt(s.time.split(':')[0]) - 1).padStart(2, '0');
        const utcM = s.time.split(':')[1];
        console.log(`\n${i + 1}. Session ${i + 1} — ${s.time} (UTC ${utcH}:${utcM})`);
        console.log(`   • 👍 Likes : ${s.likes_quota || 0}`);
        console.log(`   • 📤 Invitations : ${s.invitations_quota || 0}`);
        console.log(`   • Actions : ${s.actions.join(', ')}`);
      });
      
      if (plan.crons_to_create && plan.crons_to_create.length > 0) {
        console.log(`\n⏰ Crons quotidiens à créer (${plan.crons_to_create.length}) :`);
        plan.crons_to_create.forEach(cron => {
          console.log(`  ${cron.name}`);
        });
      }
    }
    
    console.log(`\n💾 Plan sauvegardé : ${planPath}`);

    return plan;
  }

  /**
   * Redémarre Chrome proprement chaque matin pour repartir avec RAM à zéro.
   * Vérifie ensuite que LinkedIn est accessible (login si nécessaire).
   */
  async restartChromeFresh(plan) {
    const { execSync } = require('child_process');
    console.log('\n🔄 Restart Chrome matinal (RAM à zéro avant sessions)...');

    try {
      execSync('pm2 restart linkedin-daemon --update-env', { stdio: 'pipe' });
      // Attendre que Chrome soit prêt (15-20s)
      await new Promise(r => setTimeout(r, 18000));

      // Vérifier CDP
      const http = require('http');
      const cdpOk = await new Promise(resolve => {
        const req = http.get('http://localhost:9222/json/version', res => resolve(res.statusCode === 200));
        req.on('error', () => resolve(false));
        req.setTimeout(5000, () => { req.destroy(); resolve(false); });
      });

      if (!cdpOk) {
        console.log('❌ Chrome ne répond pas après restart');
        plan.chrome_health = 'down';
        return;
      }

      // Tester login LinkedIn
      const { getLinkedInPage, closePage } = require('./chrome-daemon.js');
      const { page } = await getLinkedInPage();
      const url = page.url();
      await closePage(page);

      if (url.includes('/feed')) {
        const ram = parseInt(execSync("ps aux | grep -E 'chrom(e|ium)' | grep -v grep | awk '{sum+=$6}END{print sum}'").toString()) / 1024;
        console.log(`✅ Chrome OK — session LinkedIn active — RAM: ${Math.round(ram)} MB`);
        plan.chrome_health = 'ok';
        plan.chrome_ram_start = Math.round(ram);
      } else {
        console.log(`⚠️ URL inattendue après login: ${url}`);
        plan.chrome_health = 'login_failed';
      }
    } catch (e) {
      console.error('❌ Restart Chrome échoué:', e.message);
      plan.chrome_health = 'error';
    }
  }

}

// Si exécuté directement
if (require.main === module) {
  const planner = new MorningPlanner();
  planner.run().catch(console.error);
}

module.exports = { MorningPlanner };
