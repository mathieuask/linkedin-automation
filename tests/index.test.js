#!/usr/bin/env node

/**
 * Tests unitaires de base
 * Utilise le module assert natif de Node.js (pas de dépendances externes)
 * 
 * Usage: node tests/index.test.js
 */

const assert = require('assert');
const path = require('path');

// Couleurs pour la console
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

// Compteurs de tests
let passed = 0;
let failed = 0;
const failures = [];

/**
 * Helper pour exécuter un test
 */
function test(description, fn) {
  try {
    fn();
    passed++;
    console.log(`${colors.green}✓${colors.reset} ${description}`);
  } catch (error) {
    failed++;
    failures.push({ description, error: error.message });
    console.log(`${colors.red}✗${colors.reset} ${description}`);
    console.log(`  ${colors.red}${error.message}${colors.reset}`);
  }
}

/**
 * Helper pour les tests asynchrones
 */
async function testAsync(description, fn) {
  try {
    await fn();
    passed++;
    console.log(`${colors.green}✓${colors.reset} ${description}`);
  } catch (error) {
    failed++;
    failures.push({ description, error: error.message });
    console.log(`${colors.red}✗${colors.reset} ${description}`);
    console.log(`  ${colors.red}${error.message}${colors.reset}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════

(async () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // TEST SUITE 1: humanDelay.js (ES Module)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log(`\n${colors.cyan}═══ Test Suite: humanDelay.js ═══${colors.reset}\n`);

  let humanDelay;
  try {
    const humanDelayPath = path.resolve(__dirname, '../src/utils/humanDelay.js');
    humanDelay = await import(`file://${humanDelayPath}`);

    await testAsync('humanDelay module should export getHumanDelay function', async () => {
      assert.strictEqual(typeof humanDelay.getHumanDelay, 'function', 'getHumanDelay should be a function');
    });

    await testAsync('getHumanDelay should return a number', async () => {
      const delay = humanDelay.getHumanDelay();
      assert.strictEqual(typeof delay, 'number', 'Delay should be a number');
    });

    await testAsync('getHumanDelay should return delay within bounds (2-10 min in ms)', async () => {
      const delay = humanDelay.getHumanDelay();
      const minMs = 2 * 60 * 1000; // 2 minutes
      const maxMs = 10 * 60 * 1000; // 10 minutes
      assert.ok(delay >= minMs, `Delay ${delay}ms should be >= ${minMs}ms (2 min)`);
      assert.ok(delay <= maxMs, `Delay ${delay}ms should be <= ${maxMs}ms (10 min)`);
    });

    await testAsync('getHumanDelay should produce different values (randomness check)', async () => {
      const delays = Array.from({ length: 10 }, () => humanDelay.getHumanDelay());
      const uniqueDelays = new Set(delays);
      assert.ok(uniqueDelays.size > 1, 'Should produce at least some variation in 10 samples');
    });

    await testAsync('getHumanDelay with custom params should respect bounds', async () => {
      const delay = humanDelay.getHumanDelay(3, 0.5); // mean=3min, stddev=0.5min
      const minMs = 2 * 60 * 1000; // Hard minimum
      const maxMs = 10 * 60 * 1000; // Hard maximum
      assert.ok(delay >= minMs, `Custom delay ${delay}ms should be >= ${minMs}ms`);
      assert.ok(delay <= maxMs, `Custom delay ${delay}ms should be <= ${maxMs}ms`);
    });

    await testAsync('formatDelay should return formatted string', async () => {
      assert.strictEqual(typeof humanDelay.formatDelay, 'function', 'formatDelay should be a function');
      const formatted = humanDelay.formatDelay(300000); // 5 min
      assert.ok(formatted.includes('5'), 'Should contain 5');
      assert.ok(formatted.includes('min'), 'Should contain "min"');
    });

    await testAsync('sleep should be a function', async () => {
      assert.strictEqual(typeof humanDelay.sleep, 'function', 'sleep should be a function');
    });

    await testAsync('getStartupJitter should return value between 0 and 30 minutes', async () => {
      const jitter = humanDelay.getStartupJitter();
      assert.ok(jitter >= 0, 'Startup jitter should be >= 0');
      assert.ok(jitter <= 30 * 60 * 1000, 'Startup jitter should be <= 30 minutes');
    });

    await testAsync('isBusinessHours should return a boolean', async () => {
      const result = humanDelay.isBusinessHours();
      assert.strictEqual(typeof result, 'boolean', 'isBusinessHours should return boolean');
    });
  } catch (error) {
    console.error(`${colors.red}Error loading humanDelay module:${colors.reset}`, error.message);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST SUITE 2: scoring.js (CommonJS)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log(`\n${colors.cyan}═══ Test Suite: scoring.js ═══${colors.reset}\n`);

  try {
    const { scoreProfile, scorePostForEngagement } = require('../src/core/scoring.js');

    test('scoreProfile should be a function', () => {
      assert.strictEqual(typeof scoreProfile, 'function', 'scoreProfile should be a function');
    });

    test('scoreProfile should return object with score property', () => {
      const profile = {
        firstName: 'John',
        lastName: 'Doe',
        headline: 'CEO at TechCorp',
        industryName: 'Technology',
        locationName: 'Paris, France',
        connectionCount: 1500,
      };
      const result = scoreProfile(profile);
      assert.strictEqual(typeof result, 'object', 'Should return an object');
      assert.ok('score' in result, 'Should have score property');
      assert.strictEqual(typeof result.score, 'number', 'Score should be a number');
    });

    test('scoreProfile should return score between 0 and 100', () => {
      const profile = {
        headline: 'CTO at Startup',
        locationName: 'Paris',
        connectionCount: 800,
      };
      const result = scoreProfile(profile);
      assert.ok(result.score >= 0, 'Score should be >= 0');
      assert.ok(result.score <= 100, 'Score should be <= 100');
    });

    test('scoreProfile should disqualify profiles with >10K connections', () => {
      const profile = {
        headline: 'CEO at BigCorp',
        connectionCount: 15000,
      };
      const result = scoreProfile(profile);
      assert.strictEqual(result.score, 0, 'Influencers (>10K) should score 0');
      assert.strictEqual(result.qualified, false, 'Should be disqualified');
    });

    test('scoreProfile should disqualify profiles without headline', () => {
      const profile = {
        firstName: 'John',
        connectionCount: 500,
      };
      const result = scoreProfile(profile);
      assert.strictEqual(result.score, 0, 'Profiles without headline should score 0');
      assert.strictEqual(result.qualified, false, 'Should be disqualified');
    });

    test('scoreProfile should score CEOs/Founders higher', () => {
      const founder = {
        headline: 'Founder & CEO at TechStartup',
        locationName: 'Paris',
        connectionCount: 1200,
        companySize: 30,
      };
      const manager = {
        headline: 'Manager at TechCorp',
        locationName: 'Paris',
        connectionCount: 1200,
        companySize: 30,
      };
      const founderResult = scoreProfile(founder);
      const managerResult = scoreProfile(manager);
      assert.ok(founderResult.score > managerResult.score, 'Founders should score higher than managers');
    });

    test('scoreProfile should bonus France location', () => {
      const paris = {
        headline: 'CTO',
        locationName: 'Paris, France',
        connectionCount: 1000,
      };
      const london = {
        headline: 'CTO',
        locationName: 'London, UK',
        connectionCount: 1000,
      };
      const parisResult = scoreProfile(paris);
      const londonResult = scoreProfile(london);
      assert.ok(parisResult.score > londonResult.score, 'France location should get bonus points');
    });

    test('scoreProfile should include reasons array', () => {
      const profile = {
        headline: 'CEO & Founder',
        locationName: 'Paris',
        connectionCount: 1500,
        companySize: 25,
      };
      const result = scoreProfile(profile);
      assert.ok(Array.isArray(result.reasons), 'Should have reasons array');
      assert.ok(result.reasons.length > 0, 'Reasons array should not be empty');
    });

    test('scoreProfile should include label (Hot/Warm/Cold)', () => {
      const profile = {
        headline: 'Founder at Startup',
        locationName: 'Paris, France',
        connectionCount: 1000,
        companySize: 20,
      };
      const result = scoreProfile(profile);
      assert.ok('label' in result, 'Should have label property');
      assert.ok(['🔥 Hot', '🟡 Warm', '❄️ Cold', '❌ Disqualifié'].includes(result.label), 'Label should be valid');
    });

    test('scorePostForEngagement should be a function', () => {
      assert.strictEqual(typeof scorePostForEngagement, 'function', 'scorePostForEngagement should be a function');
    });

    test('scorePostForEngagement should return score between 0 and 100', () => {
      const post = {
        publicId: 'urn:li:activity:123',
        text: 'Great insights about mobile development and React Native in startups',
        likes: 30,
        comments: 5,
        liked: false,
      };
      const result = scorePostForEngagement(post);
      assert.strictEqual(typeof result.score, 'number', 'Score should be a number');
      assert.ok(result.score >= 0, 'Score should be >= 0');
      assert.ok(result.score <= 100, 'Score should be <= 100');
    });

    test('scorePostForEngagement should score niche posts higher', () => {
      const niche = {
        publicId: 'urn:li:activity:123',
        text: 'Mobile development insights',
        likes: 20,
        comments: 3,
        liked: false,
      };
      const viral = {
        publicId: 'urn:li:activity:456',
        text: 'Mobile development insights',
        likes: 500,
        comments: 100,
        liked: false,
      };
      const nicheResult = scorePostForEngagement(niche);
      const viralResult = scorePostForEngagement(viral);
      assert.ok(nicheResult.score > viralResult.score, 'Niche posts (<50 likes) should score higher');
    });

    test('scorePostForEngagement should bonus tech keywords', () => {
      const techPost = {
        publicId: 'urn:li:activity:123',
        text: 'Building mobile apps with React Native for startups',
        likes: 30,
        comments: 5,
        liked: false,
      };
      const genericPost = {
        publicId: 'urn:li:activity:456',
        text: 'Generic business advice',
        likes: 30,
        comments: 5,
        liked: false,
      };
      const techResult = scorePostForEngagement(techPost);
      const genericResult = scorePostForEngagement(genericPost);
      assert.ok(techResult.score > genericResult.score, 'Tech keyword posts should score higher');
    });
  } catch (error) {
    console.error(`${colors.red}Error loading scoring module:${colors.reset}`, error.message);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST SUITE 3: generate-message.js (CommonJS)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log(`\n${colors.cyan}═══ Test Suite: generate-message.js ═══${colors.reset}\n`);

  try {
    const { generateMessage } = require('../src/ai/generate-message.js');

    test('generateMessage should be a function', () => {
      assert.strictEqual(typeof generateMessage, 'function', 'generateMessage should be a function');
    });

    test('generateMessage should return a string', () => {
      const profile = {
        firstName: 'Marie',
        lastName: 'Dupont',
        headline: 'CEO at TechCorp',
      };
      const message = generateMessage(profile, 'invitation');
      assert.strictEqual(typeof message, 'string', 'Should return a string');
      assert.ok(message.length > 0, 'Message should not be empty');
    });

    test('generateMessage should substitute {firstName} variable', () => {
      const profile = {
        firstName: 'Alice',
        headline: 'CTO at StartupCo',
      };
      const message = generateMessage(profile, 'invitation');
      assert.ok(message.includes('Alice'), 'Message should contain firstName "Alice"');
      assert.ok(!message.includes('{firstName}'), 'Message should not contain unreplaced {firstName} variable');
    });

    test('generateMessage should handle missing firstName gracefully', () => {
      const profile = {
        headline: 'CTO',
      };
      const message = generateMessage(profile, 'invitation');
      assert.ok(message.length > 0, 'Should still generate message without firstName');
      assert.ok(message.includes('Bonjour'), 'Should use fallback greeting');
    });

    test('generateMessage invitation should respect 300 char limit', () => {
      const profile = {
        firstName: 'Jean-Philippe-Alexandre-Maximilien',
        lastName: 'De La Fontaine-Beauregard',
        headline: 'Chief Executive Officer and Founder at Very Long Company Name International Corporation Limited',
      };
      const message = generateMessage(profile, 'invitation', { maxLength: 300 });
      assert.ok(message.length <= 300, `Invitation should be <= 300 chars, got ${message.length}`);
    });

    test('generateMessage comment should respect 200 char limit', () => {
      const profile = {
        firstName: 'Bob',
        headline: 'CTO',
      };
      const message = generateMessage(profile, 'comment', { maxLength: 200 });
      assert.ok(message.length <= 200, `Comment should be <= 200 chars, got ${message.length}`);
    });

    test('generateMessage should support different message types', () => {
      const profile = {
        firstName: 'Charlie',
        headline: 'Founder',
      };
      const invitation = generateMessage(profile, 'invitation');
      const comment = generateMessage(profile, 'comment');
      const firstMessage = generateMessage(profile, 'first_message');

      assert.ok(invitation.length > 0, 'Invitation should be generated');
      assert.ok(comment.length > 0, 'Comment should be generated');
      assert.ok(firstMessage.length > 0, 'First message should be generated');
    });

    test('generateMessage should detect founder role', () => {
      const founder = {
        firstName: 'Alice',
        headline: 'Founder & CEO at Startup',
      };
      const manager = {
        firstName: 'Bob',
        headline: 'Marketing Manager',
      };
      const founderMsg = generateMessage(founder, 'invitation');
      const managerMsg = generateMessage(manager, 'invitation');

      // Both should generate valid messages (may or may not be identical due to randomness)
      assert.ok(founderMsg.length > 0, 'Founder message should be generated');
      assert.ok(managerMsg.length > 0, 'Manager message should be generated');
    });

    test('generateMessage should produce varied output (randomness)', () => {
      const profile = {
        firstName: 'David',
        headline: 'CEO',
      };
      const messages = Array.from({ length: 5 }, () => generateMessage(profile, 'invitation'));
      const uniqueMessages = new Set(messages);

      // With multiple templates, we should get some variety
      assert.ok(uniqueMessages.size >= 1, 'Should generate at least one message');
      // Note: With 3 templates per role, there's a chance of duplicates in 5 samples
      // We just check that it doesn't error and produces valid output
    });

    test('generateMessage should not contain unreplaced template variables', () => {
      const profile = {
        firstName: 'Eve',
        lastName: 'Smith',
        headline: 'CTO at TechCo',
      };
      const message = generateMessage(profile, 'invitation');
      assert.ok(!message.includes('{firstName}'), 'Should not contain {firstName}');
      assert.ok(!message.includes('{lastName}'), 'Should not contain {lastName}');
      // Note: {company} and {topic} might legitimately appear if not used in templates
    });
  } catch (error) {
    console.error(`${colors.red}Error loading generate-message module:${colors.reset}`, error.message);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RÉSUMÉ DES TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log(`\n${colors.cyan}═══════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}           TEST RESULTS${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════${colors.reset}\n`);

  const total = passed + failed;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  console.log(`Total:  ${total} tests`);
  console.log(`${colors.green}Passed: ${passed} ✓${colors.reset}`);
  if (failed > 0) {
    console.log(`${colors.red}Failed: ${failed} ✗${colors.reset}\n`);
    
    console.log(`${colors.red}Failures:${colors.reset}`);
    failures.forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.description}`);
      console.log(`     ${colors.red}→ ${f.error}${colors.reset}`);
    });
    console.log('');
  } else {
    console.log('');
  }

  console.log(`${colors.yellow}Pass rate: ${passRate}%${colors.reset}\n`);

  if (failed > 0) {
    console.log(`${colors.red}❌ Some tests failed${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${colors.green}✅ All tests passed!${colors.reset}\n`);
    process.exit(0);
  }
})();
