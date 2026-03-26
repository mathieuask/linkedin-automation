/**
 * Realtime Bridge — Listens to Supabase Realtime for automation toggles and new jobs
 *
 * The daemon starts this bridge at boot. It reacts to:
 * 1. automations table UPDATE → toggle automations on/off
 * 2. automation_jobs table INSERT → execute new jobs
 */

const { supabase, USER_ID, updateAutomationConfig, updateJob } = require('../supabase-client');

let onToggleCallback = null;
let onJobCallback = null;

/**
 * Start Realtime listeners
 * @param {object} callbacks
 * @param {function} callbacks.onToggle - Called when an automation is toggled: (automation) => void
 * @param {function} callbacks.onJob - Called when a new job arrives: (job) => void
 */
function startRealtimeBridge({ onToggle, onJob }) {
  onToggleCallback = onToggle;
  onJobCallback = onJob;

  console.log('📡 Starting Realtime bridge...');

  // Listen for automation toggle changes
  supabase
    .channel('automations-changes')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'automations',
      filter: `user_id=eq.${USER_ID}`,
    }, (payload) => {
      const automation = payload.new;
      console.log(`📡 Automation ${automation.type}: ${automation.active ? 'ON' : 'OFF'}`);

      if (onToggleCallback) {
        onToggleCallback(automation);
      }
    })
    .subscribe((status) => {
      console.log(`📡 Automations channel: ${status}`);
    });

  // Listen for new jobs
  supabase
    .channel('jobs-queue')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'automation_jobs',
      filter: `user_id=eq.${USER_ID}`,
    }, async (payload) => {
      const job = payload.new;
      console.log(`📡 New job: ${job.type} (${job.id})`);

      // Mark job as running
      await updateJob(job.id, {
        status: 'running',
        started_at: new Date().toISOString(),
      });

      if (onJobCallback) {
        try {
          const result = await onJobCallback(job);
          await updateJob(job.id, {
            status: 'completed',
            result: result || {},
            completed_at: new Date().toISOString(),
          });
        } catch (error) {
          await updateJob(job.id, {
            status: 'failed',
            error: error.message,
            completed_at: new Date().toISOString(),
          });
        }
      }
    })
    .subscribe((status) => {
      console.log(`📡 Jobs channel: ${status}`);
    });

  console.log('✅ Realtime bridge active');
}

/**
 * Stop all Realtime subscriptions
 */
async function stopRealtimeBridge() {
  await supabase.removeAllChannels();
  console.log('📡 Realtime bridge stopped');
}

module.exports = { startRealtimeBridge, stopRealtimeBridge };
