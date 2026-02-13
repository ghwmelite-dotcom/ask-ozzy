# AskOzzy Documentation

**AskOzzy** | v1.0.0 | Cloudflare Workers + Hono + D1 + KV + Vectorize + Workers AI

> AI-powered productivity platform built exclusively for Government of Ghana operations.

---

## Table of Contents

| # | Document | Description |
|---|----------|-------------|
| 1 | [Project Overview](01-overview.md) | Mission, stats, tech stack, project structure |
| 2 | [System Architecture](02-architecture.md) | Architecture diagrams, request flow, data pipelines |
| 3 | [Getting Started](03-getting-started.md) | Prerequisites, setup, local dev, first deployment |
| 4 | [API Reference](04-api-reference.md) | All 139+ endpoints with request/response examples |
| 5 | [Database Schema](05-database-schema.md) | All 32 tables, relationships, migration order |
| 6 | [Frontend Guide](06-frontend-guide.md) | app.js architecture, state management, UI components |
| 7 | [Admin Portal](07-admin-portal.md) | All 16 admin tabs documented |
| 8 | [AI Features](08-ai-features.md) | 10 models, RAG, research, vision, agents, memory |
| 9 | [Payments & Affiliate](09-payments-affiliate.md) | Pricing tiers, Paystack, 2-level commissions |
| 10 | [Security & Auth](10-security-auth.md) | Auth methods, rate limiting, RBAC, 2FA, WebAuthn |
| 11 | [PWA & Offline](11-pwa-offline.md) | Service worker, caching, IndexedDB, push notifications |
| 12 | [User Guide](12-user-guide.md) | Comprehensive end-user walkthrough (16 chapters) |
| 13 | [Deployment Guide](13-deployment.md) | Production deployment, CI/CD, monitoring, rollback |
| 14 | [Changelog](14-changelog.md) | Version history, phase timeline, known issues |

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/ghwmelite-dotcom/ask-ozzy.git
cd ask-ozzy/ghana-civil-ai
npm install

# 2. Set up database
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-kb.sql

# 3. Deploy
npx wrangler deploy
```

## Architecture at a Glance

AskOzzy is a serverless AI platform running on Cloudflare's edge network. The backend is a single Hono/TypeScript Worker handling 139+ API endpoints. It uses D1 (SQLite) for persistent storage across 32 tables, KV for session management, Vectorize for RAG knowledge retrieval, and Workers AI for inference across 10 models. The frontend is a vanilla JavaScript PWA with offline-first capabilities, served as static assets from the same Worker.

## Links

- **Live**: [https://askozzy.ghwmelite.workers.dev](https://askozzy.ghwmelite.workers.dev)
- **Repository**: [https://github.com/ghwmelite-dotcom/ask-ozzy](https://github.com/ghwmelite-dotcom/ask-ozzy)
- **Admin Portal**: [https://askozzy.ghwmelite.workers.dev/admin](https://askozzy.ghwmelite.workers.dev/admin)

---

*Built for the Government of Ghana by Osborn Hodges.*
