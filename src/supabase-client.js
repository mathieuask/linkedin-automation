/**
 * Supabase Client for the Automation Daemon
 *
 * Uses service role key (no browser session).
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, USER_ID
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_ID = process.env.USER_ID;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !USER_ID) {
  console.error('❌ Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, USER_ID');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Get LinkedIn session config for the current user
 * Returns: { encrypted_credentials, cookies, proxy_ip, status, health_score, warm_up_phase, warm_up_start_date }
 */
async function getSessionConfig() {
  const { data, error } = await supabase
    .from('linkedin_sessions')
    .select('*')
    .eq('user_id', USER_ID)
    .single();

  if (error) {
    console.error('❌ getSessionConfig error:', error.message);
    return null;
  }
  return data;
}

/**
 * Get automation toggles for the current user
 * Returns: [{ id, type, active, config }]
 */
async function getAutomations() {
  const { data, error } = await supabase
    .from('automations')
    .select('id, type, active, config')
    .eq('user_id', USER_ID);

  if (error) {
    console.error('❌ getAutomations error:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Update automation config (last_run, next_run, status)
 */
async function updateAutomationConfig(automationType, config) {
  const { error } = await supabase
    .from('automations')
    .update({ config })
    .eq('user_id', USER_ID)
    .eq('type', automationType);

  if (error) console.error(`❌ updateAutomationConfig(${automationType}):`, error.message);
}

/**
 * Update LinkedIn session fields (health_score, status, last_action_at, warm_up_phase)
 */
async function updateSession(updates) {
  const { error } = await supabase
    .from('linkedin_sessions')
    .update(updates)
    .eq('user_id', USER_ID);

  if (error) console.error('❌ updateSession error:', error.message);
}

/**
 * Update health score
 */
async function updateHealth(healthScore) {
  return updateSession({ health_score: healthScore });
}

/**
 * Log an action to activity_log
 */
async function logAction(type, action, contactName, metadata = {}) {
  const { error } = await supabase
    .from('activity_log')
    .insert({
      user_id: USER_ID,
      type,
      action,
      contact_name: contactName,
      metadata,
    });

  if (error) console.error('❌ logAction error:', error.message);
}

/**
 * Increment analytics_daily counters for today
 * @param {object} increments - { invitations_sent, messages_sent, likes_given, comments_posted, ... }
 */
async function incrementAnalytics(increments) {
  const today = new Date().toISOString().split('T')[0];

  // Upsert: create row if missing, then increment
  const { data: existing } = await supabase
    .from('analytics_daily')
    .select('id, invitations_sent, invitations_accepted, messages_sent, replies_received, meetings_booked, likes_given, comments_posted')
    .eq('user_id', USER_ID)
    .eq('date', today)
    .single();

  if (existing) {
    const updated = {};
    for (const [key, val] of Object.entries(increments)) {
      updated[key] = (existing[key] || 0) + val;
    }
    await supabase.from('analytics_daily').update(updated).eq('id', existing.id);
  } else {
    await supabase.from('analytics_daily').insert({
      user_id: USER_ID,
      date: today,
      ...increments,
    });
  }
}

/**
 * Get pending jobs for the current user
 */
async function getPendingJobs() {
  const { data, error } = await supabase
    .from('automation_jobs')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ getPendingJobs error:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Update a job's status
 */
async function updateJob(jobId, updates) {
  const { error } = await supabase
    .from('automation_jobs')
    .update(updates)
    .eq('id', jobId);

  if (error) console.error(`❌ updateJob(${jobId}):`, error.message);
}

/**
 * Update campaign stats
 */
async function updateCampaignStats(campaignId, statsIncrement) {
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('stats')
    .eq('id', campaignId)
    .single();

  if (!campaign) return;

  const currentStats = campaign.stats || { sent: 0, accepted: 0, replies: 0 };
  const updated = { ...currentStats };
  for (const [key, val] of Object.entries(statsIncrement)) {
    updated[key] = (updated[key] || 0) + val;
  }

  await supabase.from('campaigns').update({ stats: updated }).eq('id', campaignId);
}

/**
 * Insert or update a message thread
 */
async function upsertMessage(threadId, contactData, newMessages) {
  const { data: existing } = await supabase
    .from('messages')
    .select('id, messages')
    .eq('user_id', USER_ID)
    .eq('thread_id', threadId)
    .single();

  if (existing) {
    const allMessages = [...(existing.messages || []), ...newMessages];
    await supabase.from('messages').update({
      messages: allMessages,
      last_message_at: new Date().toISOString(),
      unread: true,
    }).eq('id', existing.id);
  } else {
    await supabase.from('messages').insert({
      user_id: USER_ID,
      thread_id: threadId,
      contact_name: contactData.name,
      contact_title: contactData.title,
      contact_company: contactData.company,
      messages: newMessages,
      last_message_at: new Date().toISOString(),
    });
  }
}

/**
 * Get warm-up config from the session
 * Returns phase config computed from warm_up_phase + warm_up_start_date
 */
async function getWarmUpConfig() {
  const session = await getSessionConfig();
  if (!session) return null;

  const startDate = new Date(session.warm_up_start_date);
  const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));

  // Warm-up phase definitions (same as config/warm-up.json but in code)
  const phases = {
    observation:     { days: [1, 3],   sessions_per_day: 1, daily_quotas: { invitations: '0-1', likes: '2-3', comments: '0', profile_views: '5-10', post_creation: '0' } },
    activation:      { days: [4, 7],   sessions_per_day: 2, daily_quotas: { invitations: '1-3', likes: '4-6', comments: '1', profile_views: '10-15', post_creation: '0' } },
    montee:          { days: [8, 14],  sessions_per_day: 3, daily_quotas: { invitations: '3-6', likes: '6-10', comments: '2', profile_views: '15-20', post_creation: '0' } },
    croisiere:       { days: [15, 21], sessions_per_day: 5, daily_quotas: { invitations: '6-10', likes: '8-12', comments: '3', profile_views: '20-25', post_creation: '0-1' } },
    pleine_vitesse:  { days: [22, 999], sessions_per_day: 6, daily_quotas: { invitations: '10-15', likes: '10-15', comments: '3-5', profile_views: '25-30', post_creation: '0-1' } },
  };

  // Determine current phase from days since start
  let currentPhase = session.warm_up_phase;
  for (const [name, config] of Object.entries(phases)) {
    const [min, max] = config.days;
    if (daysSinceStart >= min && daysSinceStart <= max) {
      currentPhase = name;
      break;
    }
  }

  // Update phase in DB if it changed
  if (currentPhase !== session.warm_up_phase) {
    await updateSession({ warm_up_phase: currentPhase });
  }

  return {
    phase: currentPhase,
    daysSinceStart,
    ...phases[currentPhase],
    start_date: session.warm_up_start_date,
  };
}

module.exports = {
  supabase,
  USER_ID,
  getSessionConfig,
  getAutomations,
  updateAutomationConfig,
  updateSession,
  updateHealth,
  logAction,
  incrementAnalytics,
  getPendingJobs,
  updateJob,
  updateCampaignStats,
  upsertMessage,
  getWarmUpConfig,
};
