/**
 * Human-like delay generator using Gaussian distribution
 * 
 * Uses Box-Muller transform to generate normally distributed delays
 * that mimic human behavior patterns.
 */

// Default parameters (can be overridden via env)
const MEAN_MINUTES = parseFloat(process.env.DELAY_MEAN) || 5;
const STDDEV_MINUTES = parseFloat(process.env.DELAY_STDDEV) || 1.5;
const MIN_MINUTES = parseFloat(process.env.DELAY_MIN) || 2;
const MAX_MINUTES = parseFloat(process.env.DELAY_MAX) || 10;

/**
 * Generate a random number from standard normal distribution
 * using Box-Muller transform
 */
function gaussianRandom(mean = 0, stddev = 1) {
  let u = 0, v = 0;
  // Avoid log(0)
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * stddev + mean;
}

/**
 * Get a human-like delay in milliseconds
 * 
 * Distribution:
 * - 68% of delays: mean ± 1σ (3.5 - 6.5 min with defaults)
 * - 95% of delays: mean ± 2σ (2 - 8 min with defaults)
 * - Hard bounds: MIN_MINUTES - MAX_MINUTES
 * - Micro-jitter: ±15 seconds
 * 
 * @param {number} meanMin - Mean delay in minutes (default: 5)
 * @param {number} stddevMin - Standard deviation in minutes (default: 1.5)
 * @returns {number} Delay in milliseconds
 */
export function getHumanDelay(meanMin = MEAN_MINUTES, stddevMin = STDDEV_MINUTES) {
  // Generate gaussian-distributed delay
  let delay = gaussianRandom(meanMin, stddevMin);
  
  // Clamp to bounds
  delay = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, delay));
  
  // Add micro-jitter (±15 seconds)
  const jitterMs = (Math.random() - 0.5) * 30000;
  
  // Convert to milliseconds and return
  return Math.round(delay * 60 * 1000 + jitterMs);
}

/**
 * Format milliseconds to human-readable string
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted string (e.g., "5.2 min")
 */
export function formatDelay(ms) {
  const minutes = ms / 60000;
  return `${minutes.toFixed(1)} min`;
}

/**
 * Sleep for the specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get a random startup delay (0-30 minutes)
 * Used to avoid "exactly 9:00 every day" pattern
 * @returns {number} Delay in milliseconds
 */
export function getStartupJitter() {
  return Math.floor(Math.random() * 30 * 60 * 1000);
}

/**
 * Check if current time is within business hours (Paris time)
 * @returns {boolean}
 */
export function isBusinessHours() {
  const parisTime = new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' });
  const hour = new Date(parisTime).getHours();
  
  // Tous les jours, 9h-18h Paris
  return hour >= 9 && hour < 18;
}

export default {
  getHumanDelay,
  formatDelay,
  sleep,
  getStartupJitter,
  isBusinessHours
};
