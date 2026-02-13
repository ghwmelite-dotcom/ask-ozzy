# Setup & Development Guide

This guide walks you through setting up AskOzzy for local development and deploying it to Cloudflare Workers.

---

## Prerequisites

Ensure the following are installed and available on your system before proceeding:

- **Node.js 18+** — Runtime for build tooling and Wrangler CLI
- **npm or pnpm** — Package manager
- **Wrangler CLI** — Cloudflare's developer tool
  ```bash
  npm install -g wrangler
  ```
- **Cloudflare account** — Free tier works for development
- **Git** — Version control

---

## Clone & Install

```bash
git clone https://github.com/ghwmelite-dotcom/ask-ozzy.git
cd ask-ozzy/ghana-civil-ai
npm install
```

---

## Local Development

```bash
npx wrangler dev
```

- Opens at **http://localhost:8787**
- Hot reload on file changes
- Uses a local D1 database (separate from production)

---

## Database Setup

AskOzzy uses Cloudflare D1 (SQLite) with multiple schema files that must be applied in a specific order. Each file builds on the tables created by earlier files.

### Schema Migration Order

Run the following schema files **in this exact order**:

| Step | File                 | Description                                                                                                                                                    |
|------|----------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1    | `schema.sql`         | Core tables: users, conversations, messages, folders, referrals, webauthn_credentials, announcements, audit_log, moderation_flags, organizations, user_memories, agents, push_subscriptions, message_ratings, usage_log |
| 2    | `schema-kb.sql`      | Knowledge base tables: documents, document_chunks, knowledge_base                                                                                              |
| 3    | `schema-phase1.sql`  | AI memories and agents (may fail if columns already exist -- that is OK)                                                                                       |
| 4    | `schema-phase2.sql`  | Research reports                                                                                                                                               |
| 5    | `schema-phase4.sql`  | Workflows, meetings, spaces, citizen bot                                                                                                                       |
| 6    | `schema-phase5.sql`  | Audit trail and productivity stats                                                                                                                             |
| 7    | `schema-phase5b.sql` | WhatsApp/SMS messaging                                                                                                                                         |
| 8    | `schema-ussd.sql`    | USSD sessions                                                                                                                                                  |
| 9    | `schema-affiliate.sql` | Affiliate wallets, transactions, withdrawal requests                                                                                                         |

### Commands

#### Local (development)

```bash
npx wrangler d1 execute ghana-civil-ai-db --local --file=schema.sql
npx wrangler d1 execute ghana-civil-ai-db --local --file=schema-kb.sql
npx wrangler d1 execute ghana-civil-ai-db --local --file=schema-phase1.sql
npx wrangler d1 execute ghana-civil-ai-db --local --file=schema-phase2.sql
npx wrangler d1 execute ghana-civil-ai-db --local --file=schema-phase4.sql
npx wrangler d1 execute ghana-civil-ai-db --local --file=schema-phase5.sql
npx wrangler d1 execute ghana-civil-ai-db --local --file=schema-phase5b.sql
npx wrangler d1 execute ghana-civil-ai-db --local --file=schema-ussd.sql
npx wrangler d1 execute ghana-civil-ai-db --local --file=schema-affiliate.sql
```

#### Remote (production)

```bash
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-kb.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase1.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase2.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase4.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase5.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase5b.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-ussd.sql
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-affiliate.sql
```

---

## Environment Configuration

The `wrangler.jsonc` file defines all bindings and configuration for the Worker.

### Key Configuration Fields

| Field                    | Value                    | Purpose                          |
|--------------------------|--------------------------|----------------------------------|
| `name`                   | `"askozzy"`              | Worker name on Cloudflare        |
| `main`                   | `"src/index.ts"`         | Application entry point          |
| `compatibility_date`     | `"2025-12-01"`           | Workers runtime compatibility    |
| `assets.directory`       | `"./public"`             | Static file serving directory    |
| `ai.binding`             | `"AI"`                   | Workers AI binding               |
| `d1_databases`           | binding `"DB"`           | Database: `ghana-civil-ai-db`    |
| `kv_namespaces`          | binding `"SESSIONS"`     | KV namespace for session storage |
| `vectorize`              | binding `"VECTORIZE"`    | Index: `askozzy-knowledge`       |

### Secrets

Secrets are set via the Wrangler CLI and are never committed to version control:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put VAPID_PUBLIC_KEY
```

| Secret             | Purpose                        |
|--------------------|--------------------------------|
| `JWT_SECRET`       | Token signing for auth         |
| `VAPID_PUBLIC_KEY` | Web push notification identity |

---

## First Deployment Checklist

Follow these steps in order to deploy AskOzzy to production for the first time.

### 1. Authenticate with Cloudflare

```bash
npx wrangler login
```

### 2. Create the D1 Database

```bash
npx wrangler d1 create ghana-civil-ai-db
```

### 3. Create the KV Namespace

```bash
npx wrangler kv namespace create SESSIONS
```

### 4. Create the Vectorize Index

```bash
npx wrangler vectorize create askozzy-knowledge --dimensions=768 --metric=cosine
```

### 5. Update IDs in wrangler.jsonc

Copy the database ID, KV namespace ID, and Vectorize index name output from the previous commands into your `wrangler.jsonc` file.

### 6. Run All 9 Schema Migrations (Remote)

Execute every schema file against the remote database in the order listed in the [Database Setup](#database-setup) section above.

### 7. Set Secrets

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put VAPID_PUBLIC_KEY
```

### 8. Deploy

```bash
npx wrangler deploy
```

---

## Bootstrap Super Admin

After the first deployment, you must create the initial super admin user. This endpoint is only available when no super admin exists yet.

Send a `POST` request to `/api/admin/bootstrap`:

```bash
curl -X POST https://askozzy.ghwmelite.workers.dev/api/admin/bootstrap \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "fullName": "Admin Name",
    "bootstrapSecret": "<JWT_SECRET value>"
  }'
```

### Request Body

```json
{
  "email": "admin@example.com",
  "fullName": "Admin Name",
  "bootstrapSecret": "<JWT_SECRET value>"
}
```

| Field             | Type   | Description                                      |
|-------------------|--------|--------------------------------------------------|
| `email`           | string | Email address for the super admin account         |
| `fullName`        | string | Display name for the super admin                  |
| `bootstrapSecret` | string | Must match the `JWT_SECRET` value set in secrets  |

The response returns the newly created super admin user with an **auto-generated access code**. Save this access code -- it is required to log in to the admin portal.
