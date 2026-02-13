# AskOzzy -- System Architecture

Version 1.0 | February 2026

---

## 1. High-Level Architecture

AskOzzy runs as a single Cloudflare Worker deployed to 300+ edge locations worldwide.
Every request -- whether from a browser, WhatsApp, SMS, or USSD -- enters the same
Worker runtime and hits the same Hono router.

```
+---------------------------------------------------------------------+
|                         CLIENT LAYER                                |
+---------------------------------------------------------------------+
|                                                                     |
|   +------------------+   +-------------+   +--------------------+   |
|   |  Browser / PWA   |   | WhatsApp /  |   |  USSD / Feature    |   |
|   |  (index.html)    |   | SMS Bot     |   |  Phones            |   |
|   +--------+---------+   +------+------+   +---------+----------+   |
|            |                    |                     |              |
+------------|--------------------|-----------+---------|---+----------+
             |                    |           |         |   |
             v                    v           v         v   v
+---------------------------------------------------------------------+
|                    CLOUDFLARE EDGE NETWORK                          |
+---------------------------------------------------------------------+
|                                                                     |
|   +-------------------------------+                                 |
|   |     Workers Runtime (Hono)    |                                 |
|   |     src/index.ts  (8620 LOC)  |                                 |
|   |     161 route handlers        |                                 |
|   +------+------+------+---------+                                  |
|          |      |      |       |                                    |
|          v      v      v       v                                    |
|   +------+ +----+ +--------+ +----------+                          |
|   |  D1  | | KV | |Vectorize| |Workers AI|                         |
|   +------+ +----+ +--------+ +----------+                          |
|   34 tables  Sessions  RAG index  LLM inference                    |
|              7-day TTL  bge-base   Embeddings                      |
|                         -en-v1.5   Transcription                   |
|                                    Translation                     |
+---------------------------------------------------------------------+
```

### Component Summary

| Layer           | Technology                     | Role                                |
|-----------------|--------------------------------|-------------------------------------|
| Frontend        | Vanilla JS PWA, Service Worker | UI, offline caching, push notifs    |
| API Gateway     | Hono on Cloudflare Workers     | Routing, auth, rate limiting        |
| Database        | Cloudflare D1 (SQLite)         | 34 tables across 9 schema files     |
| Session Store   | Cloudflare KV                  | Bearer tokens, rate-limit counters  |
| Vector Search   | Cloudflare Vectorize           | RAG embeddings (768-dim)            |
| AI Inference    | Cloudflare Workers AI          | Chat, embeddings, audio, translate  |
| Static Assets   | Workers Assets (./public)      | HTML, CSS, JS, icons, manifests     |

---

## 2. Cloudflare Bindings

All bindings are declared in `wrangler.jsonc` and injected into the Worker at runtime.

| Binding    | Type       | Name / ID                              | Purpose                                         |
|------------|------------|----------------------------------------|-------------------------------------------------|
| AI         | Workers AI | --                                     | LLM inference, embeddings, transcription, translation |
| DB         | D1         | ghana-civil-ai-db (87f5e159-...)       | 34 tables of application data                   |
| SESSIONS   | KV         | ab4c606dc306424499681ecdcd99dbdc       | Session tokens (7-day TTL), rate-limit counters  |
| VECTORIZE  | Vectorize  | askozzy-knowledge                      | RAG embeddings index (bge-base-en-v1.5, 768-dim)|

### Environment Variables

| Variable         | Purpose                              |
|------------------|--------------------------------------|
| JWT_SECRET       | Signing key for token operations     |
| VAPID_PUBLIC_KEY | Web Push notification VAPID key      |

### TypeScript Binding Interface

```typescript
type Env = {
  AI: Ai;
  DB: D1Database;
  SESSIONS: KVNamespace;
  VECTORIZE: VectorizeIndex;
  JWT_SECRET: string;
  VAPID_PUBLIC_KEY: string;
};
```

---

## 3. Request Flow

Every API request passes through a consistent middleware pipeline before reaching its
route handler. The general flow is shown below.

```
+----------+     +-----------+     +----------------+     +----------+     +----------+
| Incoming |---->|   CORS    |---->| Auth Middleware |---->|  Route   |---->| Response |
| Request  |     | Middleware |     | (Bearer + KV)  |     | Handler  |     |  (JSON)  |
+----------+     +-----------+     +----------------+     +----------+     +----------+
                                          |
                                          v
                                   +-------------+
                                   | KV: Session |
                                   | Lookup      |
                                   +-------------+
```

### Detailed Steps

1. **Request arrives** at the Cloudflare edge closest to the user.
2. **CORS middleware** (`app.use("/api/*", cors())`) adds Access-Control headers.
3. **Auth middleware** extracts the `Authorization: Bearer <token>` header.
4. **KV session lookup** validates the token via `SESSIONS.get("session:<token>")`.
   - Returns the `userId` if valid; returns 401 if missing or expired.
5. **Route handler** executes business logic (D1 queries, AI calls, etc.).
6. **Response** is returned as JSON (or SSE stream for chat).

### Rate Limiting

Rate limits are enforced per-category using KV counters with TTL-based windows.

| Category | Max Requests | Window     | KV Key Pattern                   |
|----------|-------------|------------|----------------------------------|
| auth     | 10          | 5 minutes  | `ratelimit:auth:<userId>`        |
| chat     | 30          | 1 minute   | `ratelimit:chat:<userId>`        |
| api      | 100         | 1 minute   | `ratelimit:api:<userId>`         |

The rate limiter fails open: if the KV read errors, the request is allowed through
to avoid blocking users due to transient infrastructure issues.

---

## 4. Middleware Stack

AskOzzy uses three middleware functions that protect different route groups.

### 4.1 CORS Middleware

```
Scope:   /api/*
Action:  Adds Access-Control-Allow-Origin, Methods, Headers
Source:  hono/cors (built-in)
```

### 4.2 authMiddleware

```
Scope:     All authenticated /api/* routes
Action:    Verifies Bearer token via KV session lookup
Sets:      c.variables.userId
Rejects:   401 Unauthorized if token missing or expired
```

Flow:

```
Request --> Extract "Authorization: Bearer <token>"
        --> SESSIONS.get("session:<token>")
        --> If null: return 401
        --> Set userId on context --> next()
```

### 4.3 adminMiddleware

```
Scope:     /api/admin/* routes
Action:    Verifies super_admin role from D1
Sets:      c.variables.userId
Rejects:   401 if no token, 403 if role != super_admin
```

Flow:

```
Request --> Extract Bearer token
        --> KV session lookup (get userId)
        --> D1 query: SELECT role FROM users WHERE id = ?
        --> If role != 'super_admin': return 403
        --> Set userId on context --> next()
```

### 4.4 deptAdminMiddleware

```
Scope:     Department-scoped admin routes
Action:    Allows super_admin or dept_admin; scopes queries for dept_admin
Sets:      c.variables.userId, c.variables.deptFilter (for dept_admin only)
Rejects:   401 if no token, 403 if role not in {super_admin, dept_admin}
```

Flow:

```
Request --> Extract Bearer token
        --> KV session lookup (get userId)
        --> D1 query: SELECT role, department FROM users WHERE id = ?
        --> If role == 'super_admin': full access, no filter
        --> If role == 'dept_admin': set deptFilter = user.department
        --> Otherwise: return 403
```

---

## 5. Data Flow for Chat (SSE Streaming)

The chat endpoint is the core user-facing feature. It streams AI responses using
Server-Sent Events (SSE) so the user sees tokens as they are generated.

```
+--------+                +--------+              +------+  +----+  +----------+
| Client |                | Worker |              |  D1  |  | KV |  |Workers AI|
+---+----+                +---+----+              +--+---+  +-+--+  +----+-----+
    |                         |                      |        |          |
    | POST /api/chat          |                      |        |          |
    |------------------------>|                      |        |          |
    |                         | Auth: verify token   |        |          |
    |                         |------------------------------>|          |
    |                         |<------------------------------|          |
    |                         |                      |        |          |
    |                         | Check usage limits   |        |          |
    |                         |--------------------->|        |          |
    |                         |<---------------------|        |          |
    |                         |                      |        |          |
    |                         | Lookup/create conv   |        |          |
    |                         |--------------------->|        |          |
    |                         |<---------------------|        |          |
    |                         |                      |        |          |
    |                         | Build prompt:        |        |          |
    |                         |  - System prompt     |        |          |
    |                         |  - User memories     |        |          |
    |                         |  - RAG context       |        |          |
    |                         |  - Message history   |        |          |
    |                         |--------------------->|        |          |
    |                         |<---------------------|        |          |
    |                         |                      |        |          |
    |                         | Stream AI response   |        |          |
    |                         |---------------------------------------->|
    |    SSE: data chunks     |<----------------------------------------|
    |<- - - - - - - - - - - - |                      |        |          |
    |<- - - - - - - - - - - - |                      |        |          |
    |<- - - - - - - - - - - - |                      |        |          |
    |                         |                      |        |          |
    |                         | Save assistant msg   |        |          |
    |                         |--------------------->|        |          |
    |                         |<---------------------|        |          |
    |                         |                      |        |          |
    |    SSE: [DONE]          |                      |        |          |
    |<------------------------|                      |        |          |
    |                         |                      |        |          |
```

### Prompt Construction Order

The system prompt sent to Workers AI is assembled from multiple sources:

1. **Base system prompt** -- AskOzzy identity, GoG context, formatting rules
2. **User memories** -- Stored preferences and facts from `user_memories` table
3. **RAG context** -- Relevant document chunks from Vectorize similarity search
4. **Agent system prompt** -- If an agent is active, its custom instructions are prepended
5. **Conversation history** -- Recent messages from the current conversation

---

## 6. RAG Pipeline

The Retrieval-Augmented Generation (RAG) pipeline enriches AI responses with
knowledge from uploaded documents and structured FAQ entries.

### 6.1 Document Ingestion (Upload Flow)

```
+-----------+     +----------+     +---------+     +----------+     +-----------+
| Admin     |---->| Upload   |---->| Chunk   |---->| Embed    |---->| Store     |
| uploads   |     | endpoint |     | (500c,  |     | (bge-    |     | Vectorize |
| document  |     |          |     |  50     |     |  base-en |     | + D1      |
|           |     |          |     |  overlap)|    |  -v1.5,  |     |           |
|           |     |          |     |          |     |  batch 5)|     |           |
+-----------+     +----------+     +---------+     +----------+     +-----------+
```

#### Step-by-Step

1. **Upload**: Admin uploads a document via `/api/admin/knowledge/documents`.
2. **Parse**: Text is extracted from the document body (plain text, or XML extraction for DOCX/PPTX ZIP archives).
3. **Chunk**: Text is split into 500-character chunks with 50-character overlap to preserve sentence boundaries.
4. **Embed**: Each chunk is sent to Workers AI `bge-base-en-v1.5` in batches of 5 (larger batches are unreliable on Workers AI).
5. **Store (Vectorize)**: The 768-dimensional embedding vector is inserted into the `askozzy-knowledge` Vectorize index.
6. **Store (D1)**: Chunk text and metadata are saved to the `document_chunks` table. Document metadata goes to `documents`. Uses `INSERT OR IGNORE` to prevent duplicate key errors.
7. **Metadata limit**: Vectorize metadata content is truncated to 1000 characters maximum.

### 6.2 Query Flow (Retrieval)

```
+--------+     +---------+     +----------+     +-----------+     +---------+
| User   |---->| Embed   |---->| Vectorize|---->| Top-K     |---->| Inject  |
| query  |     | query   |     | search   |     | chunks    |     | into    |
|        |     | (bge-   |     | (cosine  |     | retrieved |     | system  |
|        |     |  base)  |     |  sim)    |     |           |     | prompt  |
+--------+     +---------+     +----------+     +-----------+     +---------+
```

#### Step-by-Step

1. **Embed**: The user's message is converted to a 768-dim vector using `bge-base-en-v1.5`.
2. **Search**: The vector is sent to Vectorize for cosine similarity search.
3. **Retrieve**: The top-K most similar chunks are returned with their text content.
4. **Inject**: Retrieved chunks are formatted and injected into the system prompt as contextual knowledge, before the conversation history.

---

## 7. Service Worker Architecture

AskOzzy ships a Service Worker (`public/sw.js`) that enables offline capability,
intelligent caching, and push notifications.

### 7.1 Caching Strategies

| Resource Type      | Strategy                  | Details                               |
|--------------------|---------------------------|---------------------------------------|
| Static assets      | Cache-first               | CSS, JS, icons; versioned cache name  |
| API responses      | Network-first             | Falls back to cache if offline        |
| HTML pages         | Stale-while-revalidate    | Serve cached, update in background    |
| Offline queue      | Cache API                 | Queued messages stored until online   |

### 7.2 Offline Message Queue

When the user sends a chat message while offline:

```
+--------+     +----------+     +---------+     +---------+     +--------+
| User   |---->| SW       |---->| Cache   |---->| Network |---->| Server |
| sends  |     | intercept|     | API     |     | restore |     |        |
| message|     |          |     | (queue) |     | (sync)  |     |        |
+--------+     +----------+     +---------+     +---------+     +--------+
                                     |                ^
                                     |   On reconnect |
                                     +----------------+
```

1. The Service Worker intercepts the failed `POST /api/chat` request.
2. The message payload is stored in the Cache API offline queue.
3. When connectivity is restored, a Background Sync event fires.
4. Queued messages are replayed to the server in order.
5. The user receives a push notification confirming sync completion.

### 7.3 IndexedDB Caching

The frontend uses IndexedDB for client-side persistence of:

- **Templates** -- GoG prompt templates for instant offline access
- **Responses** -- Cached AI responses for previously-used templates
- **Conversations** -- Recent conversation metadata
- **Messages** -- Message content for offline viewing

### 7.4 Push Notifications

Push notifications use the VAPID protocol via the `VAPID_PUBLIC_KEY` environment variable.

```
+--------+     +-----------+     +----------+     +--------+
| Server |---->| Push      |---->| Browser  |---->| User   |
| event  |     | Service   |     | Push API |     | notif  |
|        |     | (VAPID)   |     |          |     |        |
+--------+     +-----------+     +----------+     +--------+
```

Subscription data is stored in the `push_subscriptions` D1 table with per-user
notification preferences for:

- Broadcast announcements
- Offline queue sync confirmations
- Shared chat notifications

---

## 8. Database Schema

AskOzzy uses a single Cloudflare D1 database containing 34 tables distributed across
9 schema migration files. Tables are grouped by functional domain below.

### 8.1 Schema Files

| File                | Tables | Domain                                    |
|---------------------|--------|-------------------------------------------|
| schema.sql          | 15     | Core: users, conversations, messages, auth, orgs |
| schema-kb.sql       | 3      | Knowledge base: documents, chunks, FAQ    |
| schema-phase1.sql   | 2*     | AI memory, custom agents (overlaps core)  |
| schema-phase2.sql   | 1      | Deep research reports                     |
| schema-phase4.sql   | 6      | Workflows, meetings, spaces, citizen bot  |
| schema-phase5.sql   | 2      | Audit trail, productivity stats           |
| schema-phase5b.sql  | 2      | WhatsApp/SMS messaging                    |
| schema-ussd.sql     | 1      | USSD fallback sessions                    |
| schema-affiliate.sql| 3      | Affiliate wallets, commissions, withdrawals|

*Phase 1 tables (user_memories, agents) also exist in schema.sql for consolidated deployment.

### 8.2 Table Inventory

| #  | Table                  | Schema File         | Purpose                             |
|----|------------------------|---------------------|-------------------------------------|
| 1  | users                  | schema.sql          | User accounts, tiers, auth method   |
| 2  | webauthn_credentials   | schema.sql          | Passkey/WebAuthn public keys        |
| 3  | referrals              | schema.sql          | Referral tracking and bonuses       |
| 4  | folders                | schema.sql          | Conversation folder organization    |
| 5  | conversations          | schema.sql          | Chat conversations with metadata    |
| 6  | messages               | schema.sql          | Individual chat messages             |
| 7  | message_ratings        | schema.sql          | Thumbs up/down feedback             |
| 8  | usage_log              | schema.sql          | Per-user, per-model token usage     |
| 9  | announcements          | schema.sql          | Admin broadcast announcements       |
| 10 | audit_log              | schema.sql          | Admin action audit trail            |
| 11 | moderation_flags       | schema.sql          | Content moderation flags            |
| 12 | organizations          | schema.sql          | Team/org billing entities           |
| 13 | user_memories          | schema.sql          | AI personalization memory           |
| 14 | agents                 | schema.sql          | Custom AI agent definitions         |
| 15 | push_subscriptions     | schema.sql          | Web Push VAPID subscriptions        |
| 16 | documents              | schema-kb.sql       | Uploaded document metadata          |
| 17 | document_chunks        | schema-kb.sql       | RAG text chunks with vector IDs     |
| 18 | knowledge_base         | schema-kb.sql       | Structured FAQ entries              |
| 19 | research_reports       | schema-phase2.sql   | Deep research mode output           |
| 20 | workflows              | schema-phase4.sql   | Multi-step workflow automation      |
| 21 | meetings               | schema-phase4.sql   | AI meeting transcription/minutes    |
| 22 | spaces                 | schema-phase4.sql   | Collaborative team spaces           |
| 23 | space_members          | schema-phase4.sql   | Space membership and roles          |
| 24 | space_conversations    | schema-phase4.sql   | Conversations shared to spaces      |
| 25 | citizen_sessions       | schema-phase4.sql   | Public citizen bot sessions         |
| 26 | citizen_messages       | schema-phase4.sql   | Citizen bot message log             |
| 27 | user_audit_log         | schema-phase5.sql   | User-level activity audit trail     |
| 28 | productivity_stats     | schema-phase5.sql   | Per-user daily productivity metrics |
| 29 | whatsapp_sessions      | schema-phase5b.sql  | WhatsApp/SMS phone sessions         |
| 30 | whatsapp_messages      | schema-phase5b.sql  | WhatsApp/SMS message log            |
| 31 | ussd_sessions          | schema-ussd.sql     | USSD menu navigation sessions       |
| 32 | affiliate_wallets      | schema-affiliate.sql| Affiliate balance tracking          |
| 33 | affiliate_transactions | schema-affiliate.sql| Commission credits and withdrawals  |
| 34 | withdrawal_requests    | schema-affiliate.sql| MoMo withdrawal request queue       |

---

## 9. Multi-Channel Access

AskOzzy is designed to serve users across multiple access channels, all routing to
the same Worker backend.

```
+-------------------+         +------------------------------------------+
|                   |         |          Workers Runtime (Hono)           |
|  Browser / PWA    |-------->|                                          |
|  (HTTPS)          |         |   /api/chat         -- SSE streaming     |
|                   |         |   /api/auth/*        -- login/register   |
+-------------------+         |   /api/admin/*       -- admin portal     |
                              |   /api/conversations -- CRUD             |
+-------------------+         |   /api/knowledge/*   -- RAG management   |
|  WhatsApp Bot     |-------->|   /api/whatsapp      -- webhook          |
|  (Webhook)        |         |   /api/sms           -- webhook          |
+-------------------+         |   /api/ussd          -- callback         |
                              |   /api/citizen/*     -- public bot       |
+-------------------+         |   /api/spaces/*      -- collaboration    |
|  SMS Gateway      |-------->|   /api/workflows/*   -- automation       |
|  (Webhook)        |         |   /api/meetings/*    -- transcription    |
+-------------------+         |   /api/agents/*      -- custom agents    |
                              |   /api/research/*    -- deep research    |
+-------------------+         |   /api/affiliate/*   -- referral system  |
|  USSD Gateway     |-------->|   /api/push/*        -- notifications    |
|  (Callback)       |         |                                          |
+-------------------+         +------------------------------------------+
```

### Channel Comparison

| Channel       | Protocol     | Auth Method        | Response Format        |
|---------------|--------------|--------------------|------------------------|
| Browser / PWA | HTTPS + SSE  | Bearer token (KV)  | JSON / SSE stream      |
| WhatsApp      | Webhook POST | Phone number match | Plain text (160-1600c) |
| SMS           | Webhook POST | Phone number match | Plain text (< 160c)   |
| USSD          | Callback     | Session ID         | Menu text (182c max)   |
| Citizen Bot   | HTTPS        | Session-based      | JSON                   |

---

## 10. Security Architecture

### 10.1 Authentication Flow

```
+--------+     +---------+     +------+     +------+     +--------+
| User   |---->| Access  |---->|  D1  |---->|  KV  |---->| Token  |
| enters |     | Code    |     | user |     | put  |     | issued |
| code   |     | verify  |     | lookup|    | session|   | (7-day)|
+--------+     +---------+     +------+     +------+     +--------+
```

- **Access codes** are the primary auth method (no passwords by default).
- Codes follow format `XXXX-XXXX` using charset `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no ambiguous characters: 0/O, 1/I/L).
- Optional **TOTP** two-factor authentication via `totp_secret` / `totp_enabled` fields.
- Optional **WebAuthn/Passkey** support via `webauthn_credentials` table.
- **Recovery codes** stored as hashed values in `recovery_code_hash`.
- Session tokens are UUIDs stored in KV with a **7-day TTL**.

### 10.2 Authorization Model

| Role         | Access Level                                        |
|--------------|-----------------------------------------------------|
| civil_servant| Standard user: chat, conversations, templates       |
| dept_admin   | Department-scoped admin: filtered by own department |
| super_admin  | Full admin portal: all users, all data, all config  |

### 10.3 Rate Limiting

See Section 3 for rate-limit categories and windows. The rate limiter uses KV
counters with TTL expiration, failing open on KV errors to avoid blocking
legitimate users during transient failures.

---

## 11. Subscription Tiers

| Tier         | Price (GHS/mo) | Key Limits                          |
|--------------|----------------|-------------------------------------|
| free         | 0              | Basic chat, limited models          |
| starter      | 30             | More messages, standard models      |
| professional | 60             | High limits, premium models         |
| enterprise   | 100            | Unlimited, priority, all features   |

Payments are processed through **Paystack** supporting:

- Mobile Money (MTN, Vodafone, AirtelTigo)
- Card payments (Visa, Mastercard)

---

## 12. Deployment Architecture

```
+------------------+     +-------------------+     +-------------------+
| Source Code      |     | Wrangler CLI      |     | Cloudflare Edge   |
| (GitHub repo)    |---->| wrangler deploy   |---->| 300+ locations    |
|                  |     |                   |     | worldwide         |
+------------------+     +-------------------+     +-------------------+
                                |
                                v
                         +-------------------+
                         | Assets uploaded   |
                         | to Workers Assets |
                         | (./public dir)    |
                         +-------------------+
```

### Key Configuration (wrangler.jsonc)

| Field              | Value                                    |
|--------------------|------------------------------------------|
| name               | askozzy                                  |
| main               | src/index.ts                             |
| compatibility_date | 2025-12-01                               |
| assets.directory   | ./public                                 |

### Production URL

- **Primary**: https://askozzy.ghwmelite.workers.dev

---

## Appendix A: Technology Stack Summary

| Layer          | Technology                 | Version / Notes                |
|----------------|----------------------------|--------------------------------|
| Runtime        | Cloudflare Workers         | V8 isolates, 0ms cold start   |
| Framework      | Hono                       | Lightweight, edge-native       |
| Language       | TypeScript                 | Compiled by Wrangler           |
| Database       | Cloudflare D1              | SQLite at the edge             |
| Key-Value      | Cloudflare KV              | Global, eventually consistent  |
| Vector DB      | Cloudflare Vectorize       | HNSW index, cosine similarity  |
| AI Inference   | Cloudflare Workers AI      | Llama, Mistral, bge-base, Whisper |
| Payments       | Paystack                   | MoMo + cards (Ghana)          |
| Push           | Web Push (VAPID)           | Browser notifications          |
| Static Assets  | Workers Assets             | Served from ./public           |

## Appendix B: Default AI Model

The default chat model is configured in the conversations table schema:

```
model TEXT DEFAULT '@cf/meta/llama-4-scout-17b-16e-instruct'
```

Other models are available to higher-tier subscribers and can be selected per conversation.
