# Project Overview

## Mission

AskOzzy is a private, AI-powered productivity platform built exclusively for Government of Ghana (GoG) operations. It provides civil servants and students with intelligent document drafting, research, analysis, and communication tools — all running on Cloudflare's global edge network for speed, security, and data sovereignty.

## Key Statistics

| Metric | Value |
|--------|-------|
| Total lines of code | ~23,691 |
| API endpoints | 139+ |
| Database tables | 32 |
| Prompt templates | 45 (GoG + Student) |
| AI models available | 10 |
| Supported languages | 7 (voice input) |
| Schema migration files | 9 |
| Service worker version | v2 |

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Runtime | Cloudflare Workers | Serverless edge compute |
| Framework | Hono (TypeScript) | Lightweight web framework |
| Database | Cloudflare D1 (SQLite) | Persistent relational storage |
| Sessions | Cloudflare KV | Key-value session store (7-day TTL) |
| Vector DB | Cloudflare Vectorize | RAG knowledge embeddings |
| AI Inference | Cloudflare Workers AI | 10 LLM models + embedding + transcription + translation |
| Frontend | Vanilla JavaScript | PWA with offline-first architecture |
| Payments | Paystack | MoMo + card payments (GHS) |
| Static Assets | Cloudflare Workers (assets) | Served from same Worker |

## Project Structure

```
ghana-civil-ai/
├── src/
│   └── index.ts              # Backend API (8,600+ lines, Hono)
├── public/
│   ├── index.html             # Main app HTML
│   ├── admin.html             # Admin portal HTML
│   ├── manifest.json          # PWA manifest
│   ├── sw.js                  # Service worker v2
│   ├── css/
│   │   ├── app.css            # Main styles (8,500+ lines)
│   │   └── admin.css          # Admin styles
│   ├── js/
│   │   ├── app.js             # Frontend logic (8,200+ lines)
│   │   ├── admin.js           # Admin portal logic (1,900+ lines)
│   │   └── templates.js       # 45 prompt templates (1,300+ lines)
│   └── icons/                 # PWA icons (SVG, PNG, maskable)
├── schema.sql                 # Core tables (users, conversations, messages, etc.)
├── schema-kb.sql              # Knowledge base tables
├── schema-phase1.sql          # Memories + agents
├── schema-phase2.sql          # Research reports
├── schema-phase4.sql          # Workflows, meetings, spaces, citizen bot
├── schema-phase5.sql          # Audit trail + productivity stats
├── schema-phase5b.sql         # WhatsApp/SMS messaging
├── schema-ussd.sql            # USSD sessions
├── schema-affiliate.sql       # Affiliate commission engine
├── wrangler.jsonc             # Cloudflare Worker configuration
├── package.json               # Dependencies
├── tsconfig.json              # TypeScript configuration
└── docs/                      # This documentation suite
```

## Feature Highlights

### Core AI Features
- **Multi-model chat** with SSE streaming (10 models from OpenAI, Meta, Google, Qwen, Mistral, IBM)
- **Deep research mode** — 5-step AI research pipeline with web search
- **Data analysis** — CSV/Excel processing with Chart.js visualizations
- **Vision AI** — 4 modes: describe, OCR, form extraction, receipt scanning
- **Translation** — m2m100 model for multilingual translation
- **Transcription** — Whisper model for audio-to-text
- **Web search** — DuckDuckGo integration for real-time information
- **AI memory** — Auto-extracts user preferences for personalized responses

### Productivity Tools
- **45 prompt templates** — GoG memos, cabinet briefs, reports, letters, IT specs, student essays
- **Custom AI agents** — 25 pre-seeded + admin-managed agents
- **Workflow automation** — Multi-step document generation pipelines
- **Meeting assistant** — Upload recordings, get AI-generated minutes + action items
- **Collaborative spaces** — Team workspaces with shared conversations
- **Artifact canvas** — Detects and renders code, tables, documents in separate panel

### Platform Features
- **Offline-first PWA** — Works without internet, queues messages for sync
- **Voice input** — 7 languages including Twi, Ga, Ewe, Hausa
- **Citizen bot** — Public-facing AI (no login required)
- **USSD fallback** — Feature phone access via `*713*OZZY#`
- **WhatsApp/SMS bot** — Chat with AskOzzy via messaging
- **Push notifications** — VAPID-based web push
- **Affiliate program** — 2-level commission (30% L1, 5% L2)
- **Gamification** — Streaks, badges, milestones
- **Student mode** — Discounted pricing, academic templates

### Admin & Governance
- **Super admin portal** — 16 management tabs
- **Department admin** — Scoped access for department heads
- **Audit trail** — Full logging of all AI operations
- **Content moderation** — Flag and review system
- **Bulk user import** — CSV upload for department onboarding
- **Knowledge base** — RAG document management + FAQ entries
- **Productivity dashboard** — Hours saved, docs generated per user/department
- **Export capabilities** — CSV export for users, analytics, audit logs

### Security
- **Access code authentication** — No passwords, 8-character codes
- **WebAuthn passkeys** — Biometric/hardware key login
- **TOTP 2FA** — Time-based one-time passwords
- **Rate limiting** — Per-category (auth: 10/5min, chat: 30/min, API: 100/min)
- **HMAC webhook verification** — Paystack signature validation
- **Role-based access** — user, dept_admin, super_admin

---

*Next: [System Architecture](02-architecture.md)*
