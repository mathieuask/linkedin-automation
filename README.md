# 🤖 LinkedIn Automation — Smart Prospecting Agent

> Automated LinkedIn outreach with warm-up sequences, Notion CRM sync, self-healing selectors, and AI-powered personalization.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/playwright-patchright-blue.svg)](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)

## ✨ Features

### 🎯 Smart Prospecting
- **Intelligent Profile Scoring (0-100)**: Evaluates prospects based on role, company size, location, industry, and activity level
- **ICP Matching**: Automatically filters profiles against your Ideal Customer Profile
- **Adaptive Learning Engine**: Improves scoring weights based on acceptance and reply rates
- **Multi-language Support**: Detects profile language and adapts messages accordingly

### 🔄 Progressive Warm-up
- **Gradual Activity Ramp-up**: Starts with 2-3 actions/day, progressively increases to avoid LinkedIn detection
- **Gaussian-distributed Delays**: Human-like timing with configurable mean (5 min) and standard deviation (1.5 min)
- **Business Hours Detection**: Operates only during realistic working hours (9 AM - 6 PM local time)
- **Shadow-ban Prevention**: Monitors account health and automatically throttles if warning signs detected

### 🧠 AI-Powered Messaging
- **Role-based Templates**: Different message styles for Founders, CTOs, CEOs, and Managers
- **Industry Adaptations**: Specialized variants for FinTech, HealthTech, E-commerce, SaaS, etc.
- **Variable Substitution**: `{firstName}`, `{lastName}`, `{company}` automatically filled
- **Claude AI Integration**: Optional AI-powered message generation for maximum personalization
- **Auto-research**: AI autonomously improves templates based on acceptance/reply metrics

### 🛡️ Self-Healing Architecture
- **Selector Auto-repair**: Learns working CSS selectors when LinkedIn updates its DOM
- **Multi-strategy Fallbacks**: Tries aria-label, data-control, role+text, and relative positioning
- **Success Tracking**: Saves proven selectors to `config/selectors-learned.json`
- **Multilingual Fallbacks**: Supports both English and French LinkedIn interfaces

### 📊 Notion CRM Integration
- **Two-way Sync**: Reads prospects from Notion, updates status in real-time
- **Automatic Status Tracking**: `🎯 Lead In` → `📤 Invitation envoyée` → `✅ Invitation acceptée` → `💬 En conversation`
- **Action Logging**: Every connection request, message, and engagement logged with timestamp
- **Score Persistence**: Keeps prospect scoring history for follow-up prioritization

### 📈 Analytics & Reporting
- **Daily Reports**: Actions summary, acceptance rate, top prospects contacted
- **Weekly Reviews**: Trend analysis, A/B test results, optimization recommendations
- **Metrics History**: 60-day rolling window in `.learnings/metrics-history.json`
- **Telegram Alerts**: Real-time notifications for critical events (invitation accepted, message received, shadow-ban warning)

### 🔍 Advanced Post Engagement
- **Content Quality Scoring**: Analyzes posts for relevance, engagement potential, and author authority
- **Niche Focus**: Prioritizes posts with <50 likes for better visibility
- **Keyword Matching**: Filters for tech/mobile/startup-related content
- **Anti-spam Logic**: Avoids engaging with viral posts or influencer accounts (>10K connections)

## 🏗️ Architecture

```
linkedin-automation/
├── src/
│   ├── core/                      # Core automation engine
│   │   ├── session-runner.js      # Main action orchestrator
│   │   ├── browser.js             # Playwright browser manager
│   │   ├── self-heal.js           # Selector auto-repair system
│   │   ├── scoring.js             # Profile & post scoring engine
│   │   ├── notion-crm.js          # Notion API client
│   │   ├── autoresearch.js        # AI-powered code improvement
│   │   ├── learning-engine.js     # Adaptive scoring weights
│   │   ├── morning-planner.js     # Daily action scheduling
│   │   ├── shadowban-detector.js  # Account health monitoring
│   │   ├── daily-report.js        # Metrics aggregation
│   │   └── weekly-review.js       # Trend analysis
│   ├── actions/                   # LinkedIn actions
│   │   ├── prospect-connect.js    # Send connection requests
│   │   ├── reply-messages.js      # Reply to conversations
│   │   ├── engage-feed.js         # Like/comment on feed
│   │   └── publish-post.js        # Publish LinkedIn posts
│   ├── ai/                        # AI message generation
│   │   ├── generate-message.js    # Template-based generation
│   │   └── ai-writer.js           # Claude API integration
│   └── utils/
│       ├── humanDelay.js          # Gaussian delay generator
│       └── telegram-alerts.js     # Notification system
├── config/
│   ├── warm-up.json               # Progressive limits per day
│   └── selectors-learned.json     # Self-healed selectors
├── .learnings/                    # ML persistence
│   ├── CHANGES.md                 # Autoresearch changelog
│   └── metrics-history.json       # Performance over time
└── daemon.js                      # PM2-compatible runner
```

## ⚡ Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/linkedin-automation.git
cd linkedin-automation
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
nano .env
```

Fill in the required variables:
- `LI_AT`: LinkedIn auth cookie (from Chrome DevTools → Application → Cookies)
- `JSESSIONID`: LinkedIn CSRF token (same location, without quotes)
- `NOTION_TOKEN`: Notion integration token (from notion.so/my-integrations)
- `NOTION_DEALS_DB_ID`: Your prospects database ID
- `TELEGRAM_BOT_TOKEN`: Bot token from @BotFather
- `TELEGRAM_CHAT_ID`: Your user chat ID

### 3. Set up Notion Databases

Create two databases in Notion:

**Prospects/Deals Database:**
- Properties: `Nom` (title), `Statut` (select), `Score` (number), `LinkedIn` (URL), `Entreprise` (text), `Poste` (text), `Notes` (text), `Dernière action` (date)
- Statuses: `🎯 Lead In`, `📤 Invitation envoyée`, `✅ Invitation acceptée`, `📧 Contacté`, `💬 Répondu`, `📅 RDV booké`, `🔍 Qualifié`, `📝 Devis envoyé`, `✅ Gagné`

**Content Database (optional):**
- Properties: `Titre` (title), `Contenu` (text), `Statut` (select), `Publié le` (date)

### 4. Login to LinkedIn Manually

```bash
npm run start
# Navigate to linkedin.com/feed and login
# Keep the browser window open
```

### 5. Run the Automation

```bash
# One-time run
node daemon.js

# Or with PM2 for 24/7 operation
pm2 start ecosystem.config.js
pm2 logs linkedin-automation
```

## 📋 Prerequisites

- **Node.js 18+** (tested with v20+)
- **Chrome/Chromium** browser installed
- **Playwright/Patchright** (installed automatically via npm)
- **Xvfb** for headless Linux environments:
  ```bash
  sudo apt-get install xvfb
  # Run: xvfb-run -a node daemon.js
  ```
- **Notion account** + integration token ([setup guide](https://developers.notion.com/docs/getting-started))
- **Telegram bot** for alerts ([create via @BotFather](https://core.telegram.org/bots#6-botfather))

## 🔧 Configuration

### Warm-up Phases (`config/warm-up.json`)

```json
{
  "day_1": { "invites": 2, "likes": 10, "comments": 2 },
  "day_7": { "invites": 5, "likes": 20, "comments": 5 },
  "day_14": { "invites": 10, "likes": 30, "comments": 8 },
  "day_21": { "invites": 15, "likes": 40, "comments": 10 }
}
```

**Important Variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `DAILY_MAX` | Max connection requests per day | 15 |
| `WEEKLY_MAX` | Max connection requests per week | 80 |
| `DELAY_MEAN` | Average delay between actions (min) | 5 |
| `DELAY_STDDEV` | Delay standard deviation (min) | 1.5 |
| `DELAY_MIN` | Minimum delay (min) | 2 |
| `DELAY_MAX` | Maximum delay (min) | 10 |
| `ANTHROPIC_API_KEY` | Claude AI key (optional) | - |

## 🚀 Usage

### Run Modes

```bash
# Standard mode (browser visible)
npm run start

# API mode (LinkedIn official API - experimental)
npm run start:api

# Development mode (auto-reload)
npm run dev

# Test cookie validity
npm run test:cookie

# Check browser fingerprint
npm run test:fingerprint
```

### Manual Actions

```javascript
const { NotionCRM } = require('./src/core/notion-crm');
const crm = new NotionCRM();

// Get prospects to contact
const prospects = await crm.getProspectsToContact();

// Update status
await crm.updateProspectStatus(pageId, '✅ Invitation acceptée', 'Accepted in 2 hours!');

// Add new prospect
await crm.addProspect({
  name: 'John Doe',
  company: 'Acme Corp',
  title: 'CTO',
  linkedin: 'https://linkedin.com/in/johndoe',
  score: 85
});
```

## 🧠 How It Works

### 1. Warm-up Sequence

LinkedIn detects and bans accounts that suddenly become very active. The warm-up system:
- Starts with minimal activity (2 invites/day, 10 likes)
- Gradually increases quotas over 21 days
- Uses Gaussian-distributed delays (not fixed intervals)
- Mimics human behavior patterns (pauses, random navigation)

**Why it works:** LinkedIn's algorithm looks for sudden spikes. Gradual increase appears as organic user engagement growth.

### 2. Session Runner

The core action loop:
1. **Morning Planner** decides today's actions based on warm-up phase
2. **Browser Manager** launches Playwright with anti-detection patches (Patchright)
3. **Prospect Fetcher** queries Notion for `🎯 Lead In` profiles
4. **Scorer** ranks prospects (0-100) based on ICP criteria
5. **Action Executor** sends invites/messages with human-like delays
6. **Self-Healer** retries with alternative selectors if buttons not found
7. **Logger** updates Notion with timestamps and status changes
8. **Daily Reporter** aggregates metrics and sends Telegram summary

### 3. Self-Healing Selectors

LinkedIn frequently updates its HTML structure. When a selector breaks:
1. System tries learned selectors from `selectors-learned.json`
2. Falls back to multi-strategy discovery:
   - Aria-label matching (`button[aria-label*="Like"]`)
   - Data attributes (`button[data-control-name="like"]`)
   - Role + text (`button:has-text("Like")`)
   - Relative positioning (parent element + button search)
3. Successful selector is saved for future use
4. System continues working without manual intervention

### 4. Auto-research (AI Code Improvement)

Every week, the system:
1. Analyzes metrics: acceptance rate, reply rate, meeting conversion
2. Identifies the weakest metric (furthest from target)
3. Asks Claude AI to propose ONE targeted improvement
4. Applies the code change automatically (with backup)
5. Logs the modification in `.learnings/CHANGES.md`
6. Monitors results over the next 7 days

**Example:** If acceptance rate is 20% (target: 35%), Claude might suggest improving the value proposition in invitation templates.

## 📊 Notion CRM Schema

### Required Properties

**Deals Database:**

| Property | Type | Values | Description |
|----------|------|--------|-------------|
| Nom | Title | Text | Prospect full name |
| Statut | Select | `🎯 Lead In`, `📤 Invitation envoyée`, etc. | Pipeline stage |
| Score | Number | 0-100 | ICP match score |
| LinkedIn | URL | Profile URL | For deduplication |
| Entreprise | Text | Company name | Enrichment data |
| Poste | Text | Job title | Used for role detection |
| Notes | Text | Free text | Action log |
| Dernière action | Date | YYYY-MM-DD | For follow-up timing |

### Status Flow

```
🎯 Lead In
    ↓ (invitation sent)
📤 Invitation envoyée
    ↓ (accepted)
✅ Invitation acceptée
    ↓ (first message sent)
📧 Contacté
    ↓ (prospect replied)
💬 Répondu
    ↓ (meeting scheduled)
📅 RDV booké
    ↓ (qualified as good fit)
🔍 Qualifié
    ↓ (proposal sent)
📝 Devis envoyé
    ↓ (deal won)
✅ Gagné
```

## ⚠️ Disclaimer

**Important Legal & Ethical Considerations:**

1. **LinkedIn Terms of Service**: This tool automates interactions with LinkedIn, which may violate their Terms of Service. Use at your own risk. LinkedIn can and will ban accounts that use automation tools.

2. **Rate Limiting**: Even with warm-up sequences and human-like delays, aggressive automation can trigger LinkedIn's anti-spam systems. Always start conservatively.

3. **GDPR Compliance**: If you're in the EU, ensure you have a legal basis for processing prospect data (legitimate interest, consent, etc.). Do not scrape or store data you don't need.

4. **Responsible Use**: 
   - Do not send unsolicited messages to people outside your target audience
   - Respect "No thanks" responses immediately
   - Maintain professional, non-spammy communication
   - Do not use this for mass spam or unrelated offers

5. **Account Security**: 
   - Use a dedicated LinkedIn account (not your main one)
   - Enable 2FA on your LinkedIn account
   - Rotate cookies regularly (every 30 days)
   - Monitor for shadow-ban signs (drop in profile views, connection acceptance rate)

6. **No Warranty**: This software is provided "as is" without warranty of any kind. The authors are not responsible for account bans, data loss, or any other damages.

**Recommended Best Practices:**
- Start with the lowest warm-up phase and monitor for 2 weeks
- Keep daily invites below 10 for the first month
- Personalize at least 30% of messages manually
- Use Notion to track negative responses and avoid re-contacting
- Set up alerts for sudden drops in acceptance rate (shadow-ban indicator)

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Built with** ❤️ **for ethical B2B prospecting**

*This project is not affiliated with, endorsed, or sponsored by LinkedIn Corporation.*
