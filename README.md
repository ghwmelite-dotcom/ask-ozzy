<p align="center">
  <img src="public/icons/icon-192.png" alt="AskOzzy Logo" width="100" />
</p>

<h1 align="center">AskOzzy</h1>

<p align="center">
  <strong>AI-Powered Productivity Platform for Government of Ghana Operations</strong>
</p>

<p align="center">
  <a href="https://askozzy.ghwmelite.workers.dev">Live App</a> &middot;
  <a href="https://askozzy.ghwmelite.workers.dev/admin">Admin Portal</a> &middot;
  <a href="docs/README.md">Documentation</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/runtime-Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/framework-Hono%204.6-E36002?logo=hono&logoColor=white" alt="Hono" />
  <img src="https://img.shields.io/badge/language-TypeScript%205.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/database-Cloudflare%20D1-F38020?logo=cloudflare&logoColor=white" alt="D1" />
  <img src="https://img.shields.io/badge/AI-Workers%20AI-F38020?logo=cloudflare&logoColor=white" alt="Workers AI" />
  <img src="https://img.shields.io/badge/version-1.0.0-green" alt="Version" />
</p>

---

**AskOzzy** is a full-stack AI assistant built exclusively for Ghana's civil service. It gives civil servants, students, and the general public access to intelligent document drafting, deep research, data analysis, and multilingual communication — all running on Cloudflare's global edge network for speed, security, and data sovereignty.

## Highlights

- **10 AI Models** — GPT-OSS 120B, Llama 4 Scout, Llama 3.3 70B, QwQ 32B, Qwen3 30B, Mistral Small, Gemma 3, Granite 4.0, and more
- **139+ API Endpoints** — Single Hono/TypeScript Worker powering the entire backend
- **32 Database Tables** — Comprehensive relational schema across 9 migration files
- **45 Prompt Templates** — GoG memos, cabinet briefs, policy drafts, student essays, IT specs
- **Offline-First PWA** — Works without internet; queues and syncs automatically
- **Multi-Channel Access** — Browser, WhatsApp, SMS, and USSD (`*713*OZZY#`)

## Features

### Core AI
| Feature | Description |
|---------|-------------|
| Multi-Model Chat | Real-time SSE streaming across 10 LLMs |
| Deep Research | 5-step pipeline with DuckDuckGo web search |
| Data Analysis | CSV/Excel processing with Chart.js visualizations |
| Vision AI | Image description, OCR, form extraction, receipt scanning |
| RAG Knowledge Base | Document ingestion, vector embeddings, semantic retrieval |
| AI Memory | Auto-extracts preferences for personalized responses |
| Translation | m2m100 multilingual translation |
| Transcription | Whisper audio-to-text |

### Productivity
| Feature | Description |
|---------|-------------|
| 45 Templates | GoG-specific and student-specific prompt templates |
| Custom Agents | 25 pre-seeded + admin-managed AI agents |
| Workflow Automation | Multi-step document generation pipelines |
| Meeting Assistant | Upload recordings, get AI-generated minutes |
| Collaborative Spaces | Team workspaces with shared conversations |
| Voice I/O | 7 languages — English, Twi, Ga, Ewe, Hausa, Dagbani, French |

### Platform
| Feature | Description |
|---------|-------------|
| Admin Portal | 16 management tabs for users, analytics, content, settings |
| Affiliate Program | 2-level commissions (30% L1, 5% L2) with milestone bonuses |
| Payments | Paystack — MTN MoMo, Vodafone, AirtelTigo, Visa, Mastercard |
| Student Mode | Discounted pricing with 16 academic templates |
| Citizen Bot | Public-facing AI chat — no login required |
| Push Notifications | VAPID-based web push |
| Gamification | Streaks, badges, and milestones |

## Tech Stack

```
Runtime          Cloudflare Workers (0ms cold start)
Framework        Hono 4.6 (TypeScript)
Database         Cloudflare D1 (SQLite) — 32 tables
Session Store    Cloudflare KV (7-day TTL)
Vector DB        Cloudflare Vectorize (768-dim, cosine)
AI Inference     Cloudflare Workers AI (10 models)
Payments         Paystack (GHS)
Frontend         Vanilla JS PWA with Service Worker v2
```

## Architecture

```
Client ──► Cloudflare Edge
              │
              ├── CORS & Auth Middleware
              ├── Rate Limiting (KV-backed)
              ├── Route Handler (Hono)
              │     ├── D1 queries
              │     ├── Workers AI inference (SSE stream)
              │     ├── Vectorize similarity search
              │     └── KV session ops
              └── Response (JSON / SSE stream)
```

**RAG Pipeline:** Upload → Parse → Chunk (500 chars, 50 overlap) → Embed (bge-base-en-v1.5) → Store in Vectorize → Query via cosine similarity → Inject context → AI response

## Quick Start

```bash
# Clone
git clone https://github.com/ghwmelite-dotcom/ask-ozzy.git
cd ask-ozzy

# Install
npm install

# Local dev
npx wrangler dev
# → http://localhost:8787
```

### First Deployment

```bash
# 1. Create infrastructure
npx wrangler d1 create ghana-civil-ai-db
npx wrangler kv namespace create SESSIONS
npx wrangler vectorize create askozzy-knowledge --dimensions=768 --metric=cosine

# 2. Run migrations (in order)
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-kb.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase1.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase2.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase4.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase5.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase5b.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-ussd.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-affiliate.sql

# 3. Set secrets
npx wrangler secret put JWT_SECRET
npx wrangler secret put VAPID_PUBLIC_KEY

# 4. Deploy
npx wrangler deploy

# 5. Bootstrap admin
curl -X POST https://askozzy.ghwmelite.workers.dev/api/admin/bootstrap
```

## Subscription Tiers

| Tier | Price (GHS/mo) | Student | Messages/day | Models |
|------|:--------------:|:-------:|:------------:|:------:|
| Free | 0 | 0 | 10 | 3 |
| Professional | 60 | 25 | 200 | All 10 |
| Enterprise | 100 | 45 | Unlimited | All 10 |

## Security

- **Authentication** — Access codes, WebAuthn passkeys, TOTP 2FA, recovery codes
- **Authorization** — Role-based access control (user, dept_admin, super_admin)
- **Rate Limiting** — KV-backed per-category limits (auth: 10/5min, chat: 30/min, API: 100/min)
- **Webhook Verification** — HMAC-SHA512 signature validation (Paystack)
- **Content Security Policy** — Strict CSP headers
- **Audit Trail** — Full logging of all AI operations and admin actions
- **Content Moderation** — Flag and review system

## Project Structure

```
ask-ozzy/
├── src/
│   ├── index.ts              # Backend — 161 route handlers
│   └── lib/
│       ├── middleware.ts      # Auth, rate limiting, RBAC
│       ├── utils.ts           # Crypto, tokens, ID generation
│       └── types.ts           # TypeScript interfaces
├── public/
│   ├── index.html             # Main app UI
│   ├── admin.html             # Admin portal
│   ├── sw.js                  # Service Worker v2
│   ├── manifest.json          # PWA manifest
│   ├── css/                   # Stylesheets
│   ├── js/
│   │   ├── app.js             # Frontend logic
│   │   ├── admin.js           # Admin logic
│   │   └── templates.js       # 45 prompt templates
│   └── icons/                 # PWA icons
├── schema*.sql                # 9 database migration files
├── docs/                      # 14 documentation guides
├── wrangler.jsonc             # Cloudflare Worker config
├── package.json
└── tsconfig.json
```

## Documentation

Full documentation lives in [`docs/`](docs/README.md) — 14 comprehensive guides covering architecture, API reference (139+ endpoints), database schema, frontend, admin portal, AI features, payments, security, PWA/offline, deployment, and a complete user guide.

## License

Proprietary. All rights reserved.

---

<p align="center">
  Built for the Government of Ghana by <strong>Osborn Hodges</strong>
</p>
