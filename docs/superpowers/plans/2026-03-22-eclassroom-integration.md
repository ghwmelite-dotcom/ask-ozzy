# eClassroom (OpenMAIC) Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate OpenMAIC as a companion interactive classroom service accessible from AskOzzy and OS Browser, with shared JWT auth, Workers AI proxy, and tiered access control.

**Architecture:** OpenMAIC runs in Docker on Hostinger VPS (Ubuntu 8GB), proxied by Nginx at `eclassroom.askozzy.work`. AskOzzy exposes Workers AI as an OpenAI-compatible proxy endpoint. Users authenticate via JWT tokens minted by AskOzzy. Access control enforces free-tier session limits (3/month) while paid tiers get unlimited access + custom classroom creation.

**Tech Stack:** Cloudflare Workers (Hono/TypeScript), Cloudflare D1, Workers AI, Docker, Nginx, Let's Encrypt, OpenMAIC (Next.js 16)

**Spec:** `docs/superpowers/specs/2026-03-22-eclassroom-openmaic-integration-design.md`

**Out of Scope (deferred to future plans):**
- OS Browser Matrix bot integration (`/classroom` command, sidebar shortcut)
- Enterprise tier features (bulk creation, custom branding, training module builder)
- Chat-to-Classroom button ("Turn this into a classroom" in chat)
- Rate limiting on AI proxy (100 req/min — implement after traffic baseline established)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/lib/jwt.ts` | JWT signing/verification using Web Crypto HMAC-SHA256 (for eClassroom cross-service auth) |
| `src/routes/eclassroom.ts` | eClassroom API routes: AI proxy, JWT minting, session tracking, classroom listing |
| `schema-eclassroom.sql` | D1 migration: `classroom_sessions` + `prebuilt_classrooms` tables |

### Modified Files
| File | Changes |
|------|---------|
| `src/types.ts` | Add `ECLASSROOM_API_KEY` to `Env` type |
| `src/index.ts:54` | Import + mount `eclassroomRoutes`, update CORS allowlist, update CSP |
| `public/index.html:120` | Add eClassroom nav button after Discover button (inside `header-zone-left` div) |
| `public/index.html:194` | Add eClassroom screen container between Discover screen and Welcome screen |
| `public/js/app.js` | Add eClassroom state, screen functions, classroom browser, agent suggestions; patch existing screen functions to hide eClassroom |
| `public/css/app.css` | Add eClassroom nav button, screen, card, and category styles |
| `public/sw.js` | Bump cache version to v13 |

---

## Phase 1: Foundation (AskOzzy Backend)

### Task 1: Add `ECLASSROOM_API_KEY` to Env type

**Files:**
- Modify: `src/types.ts:3-14`

- [ ] **Step 1: Add the new binding to Env type**

In `src/types.ts`, add `ECLASSROOM_API_KEY` after `GNEWS_API_KEY`:

```typescript
export type Env = {
  AI: Ai;
  DB: D1Database;
  SESSIONS: KVNamespace;
  VECTORIZE: VectorizeIndex;
  KNOWLEDGE_R2: R2Bucket;
  JWT_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  PAYSTACK_SECRET: string;
  BOOTSTRAP_SECRET?: string;
  GNEWS_API_KEY: string;
  ECLASSROOM_API_KEY: string;
};
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat(eclassroom): add ECLASSROOM_API_KEY to Env type"
```

---

### Task 2: Create JWT signing utility for cross-service auth

**Files:**
- Create: `src/lib/jwt.ts`

> **Why this is needed:** The existing `createToken()` in `src/lib/utils.ts:90` creates KV-backed session tokens (random ID stored in KV). eClassroom needs actual JWT tokens with custom claims (`sub`, `email`, `tier`, `role`) that the VPS can validate independently using the shared `JWT_SECRET`. This requires HMAC-SHA256 signing via Web Crypto API.

- [ ] **Step 1: Create the JWT utility**

Create `src/lib/jwt.ts`:

```typescript
// JWT signing/verification for cross-service auth (AskOzzy ↔ eClassroom)
// Uses Web Crypto HMAC-SHA256 — works on Cloudflare Workers runtime

function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeString(str: string): string {
  return base64UrlEncode(new TextEncoder().encode(str));
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function mintJWT(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncodeString(JSON.stringify(header));
  const encodedPayload = base64UrlEncodeString(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await getSigningKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput)
  );

  const encodedSignature = base64UrlEncode(new Uint8Array(signature));
  return `${signingInput}.${encodedSignature}`;
}

export async function verifyJWT(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const key = await getSigningKey(secret);
    const signatureBytes = Uint8Array.from(
      atob(encodedSignature.replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0)
    );

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      new TextEncoder().encode(signingInput)
    );

    if (!valid) return null;

    const payload = JSON.parse(
      atob(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'))
    );

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/jwt.ts
git commit -m "feat(eclassroom): add JWT signing/verification utility for cross-service auth"
```

---

### Task 3: Create D1 migration for classroom tables

**Files:**
- Create: `schema-eclassroom.sql`

- [ ] **Step 1: Write the migration SQL**

Create `schema-eclassroom.sql` in project root (same pattern as `schema-anti-hallucination.sql` and `schema-discover.sql`):

```sql
-- eClassroom: session tracking + prebuilt classroom registry
-- Run: npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-eclassroom.sql

CREATE TABLE IF NOT EXISTS classroom_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  classroom_id TEXT NOT NULL,
  classroom_title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_classroom_sessions_user ON classroom_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_classroom_sessions_month ON classroom_sessions(user_id, created_at);

CREATE TABLE IF NOT EXISTS prebuilt_classrooms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  topic TEXT NOT NULL,
  description TEXT,
  difficulty TEXT NOT NULL DEFAULT 'intermediate',
  target_audience TEXT NOT NULL DEFAULT 'student',
  exam_type TEXT,
  openmaic_classroom_id TEXT,
  thumbnail_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prebuilt_subject ON prebuilt_classrooms(subject);
CREATE INDEX IF NOT EXISTS idx_prebuilt_audience ON prebuilt_classrooms(target_audience);
CREATE INDEX IF NOT EXISTS idx_prebuilt_active ON prebuilt_classrooms(is_active);
```

- [ ] **Step 2: Run the migration**

```bash
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-eclassroom.sql
```

- [ ] **Step 3: Commit**

```bash
git add schema-eclassroom.sql
git commit -m "feat(eclassroom): add D1 migration for classroom sessions and prebuilt classrooms"
```

---

### Task 4: Create the eClassroom route module

**Files:**
- Create: `src/routes/eclassroom.ts`

This is the largest task. The route module contains 4 endpoints:
1. `POST /api/ai-proxy/chat/completions` — OpenAI-compatible proxy to Workers AI
2. `GET /api/eclassroom/token` — Mint JWT for classroom redirect
3. `GET /api/eclassroom/classrooms` — List prebuilt classrooms (intentionally public — lets unauthenticated users browse before signing up)
4. `POST /api/eclassroom/sessions` — Track session usage

- [ ] **Step 1: Create the route file with imports and helpers**

Create `src/routes/eclassroom.ts`:

```typescript
import { Hono } from "hono";
import type { AppType } from "../types";
import { authMiddleware } from "../lib/middleware";
import { generateId } from "../lib/utils";
import { mintJWT } from "../lib/jwt";
import { log } from "../lib/logger";

const eclassroom = new Hono<AppType>();

// ═══════════════════════════════════════════════════════════════════════
// Tier helpers (same pattern as features.ts)
// ═══════════════════════════════════════════════════════════════════════

const TIER_RANK: Record<string, number> = { free: 0, professional: 1, enterprise: 2 };

function getEffectiveTier(user: {
  tier: string;
  subscription_expires_at: string | null;
  trial_expires_at: string | null;
  org_sponsored_tier?: string | null;
}): string {
  const now = new Date();
  if (user.trial_expires_at && new Date(user.trial_expires_at + "Z") > now) {
    return "professional";
  }
  let base = user.tier || "free";
  if (user.subscription_expires_at && new Date(user.subscription_expires_at + "Z") < now) {
    base = "free";
  }
  if (user.org_sponsored_tier) {
    const orgRank = TIER_RANK[user.org_sponsored_tier] || 0;
    const baseRank = TIER_RANK[base] || 0;
    return orgRank > baseRank ? user.org_sponsored_tier : base;
  }
  return base;
}

// Free tier: 3 classroom sessions per calendar month
const FREE_MONTHLY_LIMIT = 3;
```

- [ ] **Step 2: Add the Workers AI proxy endpoint**

Append to `src/routes/eclassroom.ts`:

```typescript
// ═══════════════════════════════════════════════════════════════════════
// POST /api/ai-proxy/chat/completions
// OpenAI-compatible proxy → Workers AI
// Called by eClassroom (OpenMAIC) running on VPS
// ═══════════════════════════════════════════════════════════════════════

const MODEL_MAP: Record<string, string> = {
  "gpt-4":            "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "gpt-4o":           "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "gpt-4-turbo":      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "gpt-3.5-turbo":    "@cf/meta/llama-3.1-8b-instruct",
  "gpt-3.5":          "@cf/meta/llama-3.1-8b-instruct",
};

const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

eclassroom.post("/api/ai-proxy/chat/completions", async (c) => {
  // EXCEPTION to CLAUDE.md rules #1 and #2:
  // This is a proxy endpoint — eClassroom (OpenMAIC) controls its own prompts
  // and temperature. We intentionally bypass the grounding pipeline and accept
  // caller-provided temperature because this serves an external application.

  // Validate API key
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing authorization" }, 401);
  }
  const apiKey = authHeader.slice(7);
  if (apiKey !== c.env.ECLASSROOM_API_KEY) {
    return c.json({ error: "Invalid API key" }, 403);
  }

  try {
    const body = await c.req.json();
    const requestedModel = body.model || "gpt-4";
    const messages = body.messages || [];
    const temperature = body.temperature ?? 0.3;
    const maxTokens = body.max_tokens ?? 2048;
    const stream = body.stream ?? false;

    const workersModel = MODEL_MAP[requestedModel] || DEFAULT_MODEL;

    if (stream) {
      // SSE streaming response
      const aiStream = await c.env.AI.run(workersModel as any, {
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      });

      return new Response(aiStream as ReadableStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // Non-streaming response
    const result: any = await c.env.AI.run(workersModel as any, {
      messages,
      temperature,
      max_tokens: maxTokens,
    });

    const responseText = typeof result === "string"
      ? result
      : result?.response || result?.result || JSON.stringify(result);

    // Return in OpenAI chat completion format
    return c.json({
      id: `chatcmpl-${generateId()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: responseText,
        },
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    });
  } catch (err: any) {
    log("error", "AI proxy error", { error: err?.message });
    return c.json({ error: "AI proxy request failed" }, 500);
  }
});
```

- [ ] **Step 3: Add the JWT token minting endpoint**

Append to `src/routes/eclassroom.ts`:

```typescript
// ═══════════════════════════════════════════════════════════════════════
// GET /api/eclassroom/token
// Mints a short-lived JWT for authenticated users to access eClassroom
// ═══════════════════════════════════════════════════════════════════════

eclassroom.get("/api/eclassroom/token", authMiddleware, async (c) => {
  const userId = c.get("userId");

  try {
    // Fetch user details for JWT claims
    const user: any = await c.env.DB.prepare(
      "SELECT id, email, display_name, tier, user_type, subscription_expires_at, trial_expires_at, org_sponsored_tier FROM users WHERE id = ?"
    ).bind(userId).first();

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const effectiveTier = getEffectiveTier(user);

    // Check free-tier session limit
    if (effectiveTier === "free") {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthStartStr = monthStart.toISOString().replace("T", " ").split(".")[0];

      const countResult: any = await c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM classroom_sessions WHERE user_id = ? AND created_at >= ?"
      ).bind(userId, monthStartStr).first();

      const sessionsUsed = countResult?.count || 0;
      if (sessionsUsed >= FREE_MONTHLY_LIMIT) {
        return c.json({
          error: "Monthly classroom limit reached",
          limit: FREE_MONTHLY_LIMIT,
          used: sessionsUsed,
          upgrade: true,
        }, 429);
      }
    }

    // Mint short-lived JWT (1 hour)
    const payload = {
      sub: user.id,
      email: user.email || "",
      name: user.display_name || "",
      tier: effectiveTier,
      role: user.user_type || "gog_employee",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    };

    const token = await mintJWT(payload, c.env.JWT_SECRET);

    return c.json({ token, tier: effectiveTier });
  } catch (err: any) {
    log("error", "eClassroom token error", { error: err?.message, userId });
    return c.json({ error: "Failed to generate classroom token" }, 500);
  }
});
```

- [ ] **Step 4: Add the classroom listing endpoint**

Append to `src/routes/eclassroom.ts`:

```typescript
// ═══════════════════════════════════════════════════════════════════════
// GET /api/eclassroom/classrooms
// List prebuilt classrooms (filterable by subject, audience)
// ═══════════════════════════════════════════════════════════════════════

eclassroom.get("/api/eclassroom/classrooms", async (c) => {
  const subject = c.req.query("subject") || "";
  const audience = c.req.query("audience") || "";

  try {
    let sql = "SELECT * FROM prebuilt_classrooms WHERE is_active = 1";
    const binds: string[] = [];

    if (subject) {
      sql += " AND subject = ?";
      binds.push(subject);
    }
    if (audience) {
      sql += " AND target_audience = ?";
      binds.push(audience);
    }

    sql += " ORDER BY sort_order ASC, created_at DESC";

    const stmt = binds.length > 0
      ? c.env.DB.prepare(sql).bind(...binds)
      : c.env.DB.prepare(sql);

    const { results } = await stmt.all();

    return c.json({ classrooms: results || [] });
  } catch (err: any) {
    log("error", "Classroom list error", { error: err?.message });
    return c.json({ classrooms: [] });
  }
});
```

- [ ] **Step 5: Add the session tracking endpoint**

Append to `src/routes/eclassroom.ts`:

```typescript
// ═══════════════════════════════════════════════════════════════════════
// POST /api/eclassroom/sessions
// Track when a user launches a classroom (for free-tier counting)
// ═══════════════════════════════════════════════════════════════════════

eclassroom.post("/api/eclassroom/sessions", authMiddleware, async (c) => {
  const userId = c.get("userId");

  try {
    const { classroomId, classroomTitle } = await c.req.json();

    if (!classroomId) {
      return c.json({ error: "classroomId required" }, 400);
    }

    const sessionId = generateId();
    await c.env.DB.prepare(
      "INSERT INTO classroom_sessions (id, user_id, classroom_id, classroom_title) VALUES (?, ?, ?, ?)"
    ).bind(sessionId, userId, classroomId, classroomTitle || "").run();

    // Return updated count for this month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartStr = monthStart.toISOString().replace("T", " ").split(".")[0];

    const countResult: any = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM classroom_sessions WHERE user_id = ? AND created_at >= ?"
    ).bind(userId, monthStartStr).first();

    return c.json({
      sessionId,
      sessionsUsed: countResult?.count || 0,
      limit: FREE_MONTHLY_LIMIT,
    });
  } catch (err: any) {
    log("error", "Session tracking error", { error: err?.message, userId });
    return c.json({ error: "Failed to track session" }, 500);
  }
});

export default eclassroom;
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/eclassroom.ts
git commit -m "feat(eclassroom): add route module with AI proxy, JWT minting, classroom listing, session tracking"
```

---

### Task 5: Mount the eClassroom routes and update CORS/CSP

**Files:**
- Modify: `src/index.ts:50` (import)
- Modify: `src/index.ts:74-78` (CORS allowlist)
- Modify: `src/index.ts:93` (CSP header)
- Modify: `src/index.ts:1805` (route mounting)

- [ ] **Step 1: Add import**

In `src/index.ts`, after line 50 (`import miscRoutes from "./routes/misc";`), add:

```typescript
import eclassroomRoutes from "./routes/eclassroom";
```

- [ ] **Step 2: Update CORS allowlist**

In `src/index.ts:74-78`, add the eClassroom origin to the allowed array:

```typescript
    const allowed = [
      "https://askozzy.work",
      "https://www.askozzy.work",
      "https://askozzy.ghwmelite.workers.dev",
      "https://eclassroom.askozzy.work",
    ];
```

- [ ] **Step 3: Update CSP connect-src**

In `src/index.ts:93`, add `https://eclassroom.askozzy.work` to `connect-src`:

```typescript
  c.header("Content-Security-Policy", "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://cdn.jsdelivr.net https://gnews.io https://eclassroom.askozzy.work; frame-ancestors 'none'; base-uri 'self'; form-action 'self';");
```

- [ ] **Step 4: Mount the route**

In `src/index.ts`, after line 1805 (`app.route("/", miscRoutes);`), add:

```typescript
app.route("/", eclassroomRoutes);
```

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(eclassroom): mount routes, update CORS and CSP for eclassroom.askozzy.work"
```

---

### Task 6: Set the Cloudflare secret

**Files:** None (Cloudflare CLI only)

- [ ] **Step 1: Generate and set the API key**

```bash
# Generate a strong random key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Set it as a Cloudflare secret
npx wrangler secret put ECLASSROOM_API_KEY
# Paste the generated key when prompted
```

**Important:** Save this key — you'll need the same value in the VPS `.env.local` file later.

- [ ] **Step 2: Deploy to Cloudflare**

```bash
npx wrangler deploy
```

- [ ] **Step 3: Test the AI proxy from your terminal**

```bash
curl -X POST https://askozzy.work/api/ai-proxy/chat/completions \
  -H "Authorization: Bearer <YOUR_ECLASSROOM_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Say hello in 5 words"}]}'
```

Expected: JSON response with `choices[0].message.content` containing the AI's reply.

- [ ] **Step 4: Commit any remaining changes and push**

```bash
git add -A
git commit -m "feat(eclassroom): Phase 1 backend complete"
git push origin main
```

---

## Phase 1B: VPS Setup (Manual Steps)

### Task 7: VPS infrastructure setup

> These are manual steps on the Hostinger VPS. Follow the detailed guide in the spec document section 8.1-8.12.

- [ ] **Step 1: Add DNS record in Cloudflare**

Go to Cloudflare dashboard → DNS → Add Record:
- Type: `A`
- Name: `eclassroom`
- IPv4: `<YOUR_HOSTINGER_VPS_IP>`
- Proxy: **DNS only (grey cloud)**

- [ ] **Step 2: SSH into VPS and install Docker**

Follow spec section 8.1–8.3 exactly. Summary:

```bash
ssh root@<YOUR_VPS_IP>
apt update && apt upgrade -y
# Then install Docker (see spec for full commands)
```

- [ ] **Step 3: Install Nginx**

Follow spec section 8.4:

```bash
apt install -y nginx
systemctl status nginx
```

- [ ] **Step 4: Clone OpenMAIC and configure**

Follow spec section 8.5:

```bash
mkdir -p /opt/eclassroom
cd /opt/eclassroom
git clone https://github.com/THU-MAIC/OpenMAIC.git .
nano .env.local
# Paste config from spec — use the ECLASSROOM_API_KEY you generated in Task 6
```

- [ ] **Step 5: Create docker-compose.yml and build**

Follow spec section 8.6-8.7:

```bash
nano docker-compose.yml
# Paste config from spec
docker compose build
docker compose up -d
docker compose ps   # Should show "Up"
curl http://localhost:3100  # Should return HTML
```

- [ ] **Step 6: Configure Nginx reverse proxy**

Follow spec section 8.8:

```bash
nano /etc/nginx/sites-available/eclassroom
# Paste full Nginx config from spec
ln -s /etc/nginx/sites-available/eclassroom /etc/nginx/sites-enabled/
nginx -t
```

- [ ] **Step 7: Set up SSL with Let's Encrypt**

Follow spec section 8.9:

```bash
apt install -y certbot python3-certbot-nginx
# Temporarily comment HTTPS block, restart nginx
certbot --nginx -d eclassroom.askozzy.work
# Uncomment HTTPS block, reload nginx
nginx -t && systemctl reload nginx
certbot renew --dry-run
```

- [ ] **Step 8: Configure firewall**

Follow spec section 8.11:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
# Allow Matrix ports if needed
ufw enable
```

- [ ] **Step 9: Enable auto-start**

```bash
systemctl enable docker
systemctl enable nginx
```

- [ ] **Step 10: Smoke test end-to-end**

Open `https://eclassroom.askozzy.work` in your browser. You should see the OpenMAIC interface. Try generating a classroom — it should use AskOzzy's Workers AI via the proxy.

---

## Phase 2: AskOzzy Frontend Integration

### Task 8: Add eClassroom nav button to header

**Files:**
- Modify: `public/index.html:120` (after Discover button)

- [ ] **Step 1: Add the eClassroom nav button**

In `public/index.html`, after the Discover button (line 120, after `</button>`), add:

```html
          <button class="btn-eclassroom-nav" id="btn-eclassroom-nav" onclick="showEclassroomScreen()" title="eClassroom — Interactive AI Lessons">
            <span class="eclassroom-nav-dot"></span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            <span class="eclassroom-nav-label">eClassroom</span>
          </button>
```

- [ ] **Step 2: Add the eClassroom screen container**

In `public/index.html`, after the Discover screen closing `</div>` (line 194), add:

```html
      <!-- eClassroom Screen -->
      <div id="eclassroom-screen" class="eclassroom-screen hidden" style="display:none;">
        <div class="eclassroom-header">
          <div class="eclassroom-title-row">
            <button class="eclassroom-back-btn" onclick="eclassroomGoBack()" title="Back to Home" aria-label="Back to Home">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            </button>
            <div>
              <h2>eClassroom</h2>
              <p class="eclassroom-subtitle">Interactive AI lessons with virtual teachers</p>
            </div>
          </div>
        </div>
        <div class="eclassroom-categories-wrap" id="eclassroom-categories-wrap">
          <div class="eclassroom-categories" id="eclassroom-categories"></div>
        </div>
        <div class="eclassroom-grid" id="eclassroom-grid"></div>
        <div class="eclassroom-empty" id="eclassroom-empty" style="display:none;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          <p>No classrooms available yet. Check back soon.</p>
        </div>
      </div>
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(eclassroom): add nav button and screen container to index.html"
```

---

### Task 9: Add eClassroom CSS styles

**Files:**
- Modify: `public/css/app.css` (append after Discover styles, ~line 10675)

- [ ] **Step 1: Add eClassroom styles**

Append to the end of `public/css/app.css` (modeled after the Discover styles at lines 10464-10702):

```css
/* ═══════════════════════════════════════════════════════════════════════
   eClassroom — Interactive AI Lessons
   ═══════════════════════════════════════════════════════════════════════ */

/* Nav button (mirrors .btn-discover-nav) */
.btn-eclassroom-nav {
  display: flex; align-items: center; gap: 6px;
  background: none; border: none; color: var(--text-secondary);
  cursor: pointer; padding: 6px 10px; border-radius: 8px;
  font-size: 12px; transition: all 0.2s cubic-bezier(0.4,0,0.2,1);
  position: relative;
}
.btn-eclassroom-nav:hover { color: var(--text-primary); background: var(--bg-tertiary); }
.btn-eclassroom-nav.active { color: var(--accent); }
.eclassroom-nav-dot {
  position: absolute; top: 4px; right: 4px;
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent); opacity: 0; transition: opacity 0.3s ease;
}
.btn-eclassroom-nav.active .eclassroom-nav-dot {
  opacity: 1;
  animation: eclassroom-pulse 2s ease-in-out infinite;
}
.eclassroom-nav-label { font-weight: 500; }
@keyframes eclassroom-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.6; }
}

/* Screen layout (mirrors .discover-screen) */
.eclassroom-screen {
  flex: 1; overflow-y: auto; padding: 24px;
  max-width: 1200px; margin: 0 auto; width: 100%;
}
.eclassroom-header { margin-bottom: 24px; }
.eclassroom-title-row { display: flex; align-items: center; gap: 14px; }
.eclassroom-title-row h2 { font-size: 22px; font-weight: 700; margin: 0; color: var(--text-primary); }
.eclassroom-subtitle { font-size: 13px; color: var(--text-muted); margin: 2px 0 0; }

/* Back button (mirrors .discover-back-btn) */
.eclassroom-back-btn {
  width: 40px; height: 40px; border-radius: 12px; border: 1px solid var(--border-color);
  background: var(--bg-secondary); color: var(--text-secondary); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s cubic-bezier(0.4,0,0.2,1);
}
.eclassroom-back-btn:hover { border-color: var(--accent); color: var(--accent); transform: translateX(-2px); }
.eclassroom-back-btn:active { transform: scale(0.92); }

/* Category tabs (mirrors .discover-categories) */
.eclassroom-categories-wrap { position: relative; margin-bottom: 20px; }
.eclassroom-categories-wrap::before,
.eclassroom-categories-wrap::after {
  content: ''; position: absolute; top: 0; bottom: 0; width: 32px;
  pointer-events: none; z-index: 1;
}
.eclassroom-categories-wrap::before { left: 0; background: linear-gradient(to right, var(--bg-primary), transparent); }
.eclassroom-categories-wrap::after { right: 0; background: linear-gradient(to left, var(--bg-primary), transparent); }
.eclassroom-categories {
  display: flex; gap: 8px; overflow-x: auto; padding: 4px 0;
  scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.eclassroom-categories::-webkit-scrollbar { display: none; }
.eclassroom-cat-btn {
  flex-shrink: 0; padding: 8px 16px; border-radius: 999px;
  border: 1px solid var(--border-color); background: var(--bg-secondary);
  color: var(--text-secondary); font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.2s ease; scroll-snap-align: start;
  white-space: nowrap;
}
.eclassroom-cat-btn:hover { border-color: var(--text-muted); color: var(--text-primary); }
.eclassroom-cat-btn.active {
  background: var(--accent); color: #000; border-color: var(--accent); font-weight: 600;
}

/* Classroom grid (mirrors .discover-grid) */
.eclassroom-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
@media (max-width: 900px) { .eclassroom-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 540px) { .eclassroom-grid { grid-template-columns: 1fr; } }

/* Classroom card */
.eclassroom-card {
  background: var(--bg-secondary); border: 1px solid var(--border-color);
  border-radius: 14px; overflow: hidden; cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4,0,0.2,1);
  animation: eclassroom-fadeIn 0.4s ease both;
}
.eclassroom-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  border-color: var(--accent);
}
.eclassroom-card:active { transform: scale(0.97); }

.eclassroom-card-thumb {
  width: 100%; height: 140px; object-fit: cover;
  background: linear-gradient(135deg, var(--bg-tertiary), var(--bg-secondary));
  display: flex; align-items: center; justify-content: center;
  font-size: 48px; color: var(--text-muted);
}
.eclassroom-card-body { padding: 14px 16px; }
.eclassroom-card-subject {
  font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--accent); margin-bottom: 6px;
}
.eclassroom-card-title {
  font-size: 15px; font-weight: 600; color: var(--text-primary);
  margin-bottom: 6px; line-height: 1.3;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.eclassroom-card-desc {
  font-size: 12px; color: var(--text-muted); line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  margin-bottom: 12px;
}
.eclassroom-card-meta {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 11px; color: var(--text-muted);
}
.eclassroom-card-difficulty {
  padding: 3px 8px; border-radius: 999px; font-weight: 500;
  background: rgba(252,209,22,0.1); color: var(--accent);
}
.eclassroom-card-launch {
  padding: 6px 14px; border-radius: 8px; border: none;
  background: var(--accent); color: #000; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.15s ease;
}
.eclassroom-card-launch:hover { filter: brightness(1.1); transform: scale(1.03); }

/* Empty state */
.eclassroom-empty {
  text-align: center; padding: 60px 20px; color: var(--text-muted);
}
.eclassroom-empty svg { margin-bottom: 16px; }

/* Skeleton loader */
.eclassroom-skeleton {
  background: var(--bg-secondary); border: 1px solid var(--border-color);
  border-radius: 14px; overflow: hidden;
}
.eclassroom-skeleton-thumb {
  width: 100%; height: 140px;
  background: linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-secondary) 50%, var(--bg-tertiary) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
}
.eclassroom-skeleton-body { padding: 14px 16px; }
.eclassroom-skeleton-line {
  height: 12px; border-radius: 6px; margin-bottom: 8px;
  background: linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-secondary) 50%, var(--bg-tertiary) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
}
.eclassroom-skeleton-line:nth-child(1) { width: 40%; }
.eclassroom-skeleton-line:nth-child(2) { width: 80%; }
.eclassroom-skeleton-line:nth-child(3) { width: 60%; }

@keyframes eclassroom-fadeIn {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Staggered animation */
.eclassroom-card:nth-child(1) { animation-delay: 0ms; }
.eclassroom-card:nth-child(2) { animation-delay: 60ms; }
.eclassroom-card:nth-child(3) { animation-delay: 120ms; }
.eclassroom-card:nth-child(4) { animation-delay: 180ms; }
.eclassroom-card:nth-child(5) { animation-delay: 240ms; }
.eclassroom-card:nth-child(6) { animation-delay: 300ms; }
.eclassroom-card:nth-child(7) { animation-delay: 360ms; }
.eclassroom-card:nth-child(8) { animation-delay: 420ms; }
.eclassroom-card:nth-child(9) { animation-delay: 480ms; }

/* Session limit banner */
.eclassroom-limit-banner {
  background: linear-gradient(135deg, rgba(252,209,22,0.1), rgba(252,209,22,0.05));
  border: 1px solid rgba(252,209,22,0.3); border-radius: 12px;
  padding: 14px 18px; margin-bottom: 20px;
  display: flex; align-items: center; gap: 12px;
  font-size: 13px; color: var(--text-secondary);
}
.eclassroom-limit-banner strong { color: var(--accent); }
.eclassroom-limit-upgrade {
  margin-left: auto; padding: 6px 14px; border-radius: 8px; border: none;
  background: var(--accent); color: #000; font-size: 12px; font-weight: 600;
  cursor: pointer; text-decoration: none;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/css/app.css
git commit -m "feat(eclassroom): add CSS styles for nav, screen, cards, categories, skeletons"
```

---

### Task 10: Add eClassroom JavaScript logic

**Files:**
- Modify: `public/js/app.js` (add after Discover logic, ~line 5010)

- [ ] **Step 1: Add eClassroom state and constants**

Add after the Discover section (after `initTipBar` area, around line 280 or after the discover state block ~line 4822). Find a clean insertion point after the Discover JS section:

```javascript
// ─── eClassroom: Interactive AI Lessons ─────────────────────────────
const ECLASSROOM_URL = 'https://eclassroom.askozzy.work';

const eclassroomState = {
  classrooms: [],
  subject: 'all',
  loading: false,
  loaded: false,
};

const ECLASSROOM_SUBJECTS = [
  { id: 'all', label: 'All Subjects' },
  { id: 'mathematics', label: 'Mathematics' },
  { id: 'english', label: 'English' },
  { id: 'science', label: 'Science' },
  { id: 'social_studies', label: 'Social Studies' },
  { id: 'ict', label: 'ICT' },
  { id: 'procurement', label: 'Procurement' },
  { id: 'policy', label: 'Policy & Governance' },
];
```

- [ ] **Step 2: Add screen show/hide functions**

```javascript
function showEclassroomScreen() {
  // Hide other screens
  const welcome = document.getElementById('welcome-screen');
  const chat = document.getElementById('chat-screen');
  const discover = document.getElementById('discover-screen');
  const eclassroom = document.getElementById('eclassroom-screen');
  if (welcome) { welcome.classList.add('hidden'); welcome.style.display = 'none'; }
  if (chat) { chat.classList.add('hidden'); chat.style.display = 'none'; }
  if (discover) { discover.classList.add('hidden'); discover.style.display = 'none'; }
  if (eclassroom) { eclassroom.classList.remove('hidden'); eclassroom.style.display = ''; }

  // Update nav button states
  const discoverBtn = document.getElementById('btn-discover-nav');
  const eclassroomBtn = document.getElementById('btn-eclassroom-nav');
  if (discoverBtn) discoverBtn.classList.remove('active');
  if (eclassroomBtn) eclassroomBtn.classList.add('active');

  // Hide tip bars
  const welcomeTip = document.getElementById('welcome-tip-bar');
  if (welcomeTip) welcomeTip.style.display = 'none';

  if (!eclassroomState.loaded) {
    renderEclassroomSkeletons();
    renderEclassroomCategories();
    loadEclassrooms();
  }
}

function hideEclassroomScreen() {
  const eclassroom = document.getElementById('eclassroom-screen');
  if (eclassroom) { eclassroom.classList.add('hidden'); eclassroom.style.display = 'none'; }
  const btn = document.getElementById('btn-eclassroom-nav');
  if (btn) btn.classList.remove('active');
}

function eclassroomGoBack() {
  hideEclassroomScreen();
  showWelcomeScreen();
}
```

- [ ] **Step 3: Add category rendering**

```javascript
function renderEclassroomCategories() {
  const container = document.getElementById('eclassroom-categories');
  if (!container) return;

  const audience = isStudent() ? 'student' : 'employee';
  const subjects = isStudent()
    ? ECLASSROOM_SUBJECTS.filter(s => !['procurement', 'policy'].includes(s.id))
    : ECLASSROOM_SUBJECTS;

  container.innerHTML = subjects.map(s =>
    `<button class="eclassroom-cat-btn ${eclassroomState.subject === s.id ? 'active' : ''}"
      onclick="selectEclassroomSubject('${s.id}')">${escapeHtml(s.label)}</button>`
  ).join('');
}

function selectEclassroomSubject(subject) {
  eclassroomState.subject = subject;
  renderEclassroomCategories();
  renderEclassroomSkeletons();
  loadEclassrooms();
}
```

- [ ] **Step 4: Add classroom loading and rendering**

```javascript
async function loadEclassrooms() {
  if (eclassroomState.loading) return;
  eclassroomState.loading = true;

  try {
    const params = new URLSearchParams();
    if (eclassroomState.subject !== 'all') params.set('subject', eclassroomState.subject);
    params.set('audience', isStudent() ? 'student' : 'employee');

    const res = await fetch(`${API}/api/eclassroom/classrooms?${params}`, {
      headers: state.token ? { 'Authorization': `Bearer ${state.token}` } : {},
    });

    if (!res.ok) throw new Error('Failed to load classrooms');
    const data = await res.json();

    eclassroomState.classrooms = data.classrooms || [];
    eclassroomState.loaded = true;
    renderEclassrooms();
  } catch (err) {
    console.error('eClassroom load error:', err);
    const grid = document.getElementById('eclassroom-grid');
    if (grid) grid.innerHTML = '';
    const empty = document.getElementById('eclassroom-empty');
    if (empty) empty.style.display = '';
  } finally {
    eclassroomState.loading = false;
  }
}

function renderEclassrooms() {
  const grid = document.getElementById('eclassroom-grid');
  const empty = document.getElementById('eclassroom-empty');
  if (!grid) return;

  if (eclassroomState.classrooms.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  const subjectIcons = {
    mathematics: '\uD83D\uDCCA', english: '\uD83D\uDCDD', science: '\u2697\uFE0F',
    social_studies: '\uD83C\uDF0D', ict: '\uD83D\uDCBB',
    procurement: '\uD83D\uDCC4', policy: '\uD83C\uDFDB\uFE0F',
  };

  grid.innerHTML = eclassroomState.classrooms.map(c => `
    <div class="eclassroom-card" onclick="launchClassroom('${escapeHtml(c.id)}', '${escapeHtml(c.title)}')">
      <div class="eclassroom-card-thumb">${subjectIcons[c.subject] || '\uD83D\uDCDA'}</div>
      <div class="eclassroom-card-body">
        <div class="eclassroom-card-subject">${escapeHtml(c.subject.replace(/_/g, ' '))}</div>
        <div class="eclassroom-card-title">${escapeHtml(c.title)}</div>
        <div class="eclassroom-card-desc">${escapeHtml(c.description || '')}</div>
        <div class="eclassroom-card-meta">
          <span class="eclassroom-card-difficulty">${escapeHtml(c.difficulty || 'intermediate')}</span>
          ${c.exam_type ? `<span>${escapeHtml(c.exam_type)}</span>` : ''}
          <button class="eclassroom-card-launch" onclick="event.stopPropagation();launchClassroom('${escapeHtml(c.id)}', '${escapeHtml(c.title)}')">Launch</button>
        </div>
      </div>
    </div>
  `).join('');
}

function renderEclassroomSkeletons() {
  const grid = document.getElementById('eclassroom-grid');
  if (!grid) return;
  grid.innerHTML = Array(6).fill(0).map(() => `
    <div class="eclassroom-skeleton">
      <div class="eclassroom-skeleton-thumb"></div>
      <div class="eclassroom-skeleton-body">
        <div class="eclassroom-skeleton-line"></div>
        <div class="eclassroom-skeleton-line"></div>
        <div class="eclassroom-skeleton-line"></div>
      </div>
    </div>
  `).join('');
}
```

- [ ] **Step 5: Add classroom launch logic**

```javascript
async function launchClassroom(classroomId, classroomTitle) {
  if (!state.token) {
    showToast('Please log in to access eClassroom', 'warning');
    return;
  }

  try {
    // Get JWT token for eClassroom
    const res = await fetch(`${API}/api/eclassroom/token`, {
      headers: { 'Authorization': `Bearer ${state.token}` },
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.upgrade) {
        showToast(`Free limit reached (${data.used}/${data.limit} this month). Upgrade for unlimited access.`, 'warning');
        openPricingModal();
        return;
      }
      throw new Error(data.error || 'Failed to get classroom token');
    }

    // Track the session
    await fetch(`${API}/api/eclassroom/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ classroomId, classroomTitle }),
    });

    // Open eClassroom in new tab
    const url = `${ECLASSROOM_URL}/join?token=${encodeURIComponent(data.token)}&classroom=${encodeURIComponent(classroomId)}`;
    window.open(url, '_blank', 'noopener,noreferrer');

  } catch (err) {
    console.error('Classroom launch error:', err);
    showToast('Failed to launch classroom. Please try again.', 'error');
  }
}
```

- [ ] **Step 6: Patch existing screen functions to hide eClassroom**

Find `showChatScreen()` (~line 1643) and `showWelcomeScreen()` (~line 1654) and `showDiscoverScreen()` (~line 4824) in `public/js/app.js`. Add a call to `hideEclassroomScreen()` in each, at the same location where they call `hideDiscoverScreen()` or equivalent:

In `showChatScreen()`, add:
```javascript
hideEclassroomScreen();
```

In `showWelcomeScreen()`, add:
```javascript
hideEclassroomScreen();
```

In `showDiscoverScreen()`, add:
```javascript
hideEclassroomScreen();
```

This prevents the eClassroom screen from remaining visible when users navigate to other screens.

- [ ] **Step 7: Commit**

```bash
git add public/js/app.js
git commit -m "feat(eclassroom): add JS logic for screen, categories, loading, card rendering, classroom launch"
```

---

### Task 11: Bump service worker cache and deploy

**Files:**
- Modify: `public/sw.js:8`

- [ ] **Step 1: Bump cache version**

In `public/sw.js`, change:
```javascript
const CACHE_NAME = "askozzy-v12";
```
to:
```javascript
const CACHE_NAME = "askozzy-v13";
```

- [ ] **Step 2: Commit all Phase 2 changes**

```bash
git add public/sw.js
git commit -m "fix: bump service worker cache to v13 for eClassroom frontend"
```

- [ ] **Step 3: Push and deploy**

```bash
git push origin main
npx wrangler deploy
```

- [ ] **Step 4: Verify**

1. Hard-refresh `https://askozzy.work`
2. You should see the eClassroom button in the header nav (next to Discover)
3. Click it — should show the eClassroom screen with skeleton loaders → empty state (no pre-built classrooms yet)

---

## Phase 2B: Seed Pre-Built Classrooms

### Task 12: Insert pre-built BECE/WASSCE classrooms

**Files:** None (D1 SQL only)

- [ ] **Step 1: Insert seed data**

```bash
npx wrangler d1 execute ghana-civil-ai-db --remote --command "
INSERT INTO prebuilt_classrooms (id, title, subject, topic, description, difficulty, target_audience, exam_type, sort_order) VALUES
('cls_bece_math_1', 'BECE Mathematics: Algebra Basics', 'mathematics', 'algebra', 'Learn algebraic expressions, equations, and problem-solving with AI teachers', 'beginner', 'student', 'BECE', 1),
('cls_bece_math_2', 'BECE Mathematics: Geometry & Mensuration', 'mathematics', 'geometry', 'Shapes, areas, volumes, and geometric proofs explained interactively', 'intermediate', 'student', 'BECE', 2),
('cls_bece_eng_1', 'BECE English: Comprehension & Summary', 'english', 'comprehension', 'Master reading comprehension, summary writing, and inference skills', 'beginner', 'student', 'BECE', 3),
('cls_bece_sci_1', 'BECE Integrated Science: Living Things', 'science', 'biology', 'Cells, photosynthesis, ecosystems, and human body systems', 'beginner', 'student', 'BECE', 4),
('cls_bece_social_1', 'BECE Social Studies: Government & Citizenship', 'social_studies', 'governance', 'Ghana constitution, arms of government, rights and responsibilities', 'beginner', 'student', 'BECE', 5),
('cls_wassce_math_1', 'WASSCE Core Maths: Trigonometry', 'mathematics', 'trigonometry', 'Sine, cosine, tangent rules and applications in real-world problems', 'advanced', 'student', 'WASSCE', 6),
('cls_wassce_math_2', 'WASSCE Core Maths: Statistics & Probability', 'mathematics', 'statistics', 'Data analysis, probability distributions, and statistical inference', 'intermediate', 'student', 'WASSCE', 7),
('cls_wassce_eng_1', 'WASSCE English: Essay Writing Masterclass', 'english', 'essay_writing', 'Argumentative, descriptive, and narrative essay techniques with AI feedback', 'intermediate', 'student', 'WASSCE', 8),
('cls_wassce_sci_1', 'WASSCE Physics: Mechanics & Motion', 'science', 'physics', 'Newton laws, projectile motion, and energy conservation', 'advanced', 'student', 'WASSCE', 9),
('cls_wassce_ict_1', 'WASSCE ICT: Networking & Internet', 'ict', 'networking', 'Network types, protocols, IP addressing, and internet security', 'intermediate', 'student', 'WASSCE', 10);
"
```

- [ ] **Step 2: Verify data was inserted**

```bash
npx wrangler d1 execute ghana-civil-ai-db --remote --command "SELECT id, title, subject, exam_type FROM prebuilt_classrooms ORDER BY sort_order;"
```

- [ ] **Step 3: Test in browser**

Hard-refresh `https://askozzy.work`, open eClassroom screen. You should now see 10 classroom cards with subjects, titles, and Launch buttons.

---

## Phase 3: Agent Classroom Suggestions (Future)

### Task 13: Add classroom suggestion to student agent responses

> This task should be implemented after Phase 1 + 2 are stable and tested.

**Files:**
- Modify: `public/js/app.js` (in message rendering logic, ~line 1664)

- [ ] **Step 1: Add suggestion detection**

After a student agent's response is rendered, check if the topic matches a prebuilt classroom and append a suggestion card:

```javascript
function maybeAppendClassroomSuggestion(messageContent, containerEl) {
  if (!isStudent()) return;
  if (!eclassroomState.loaded || eclassroomState.classrooms.length === 0) return;

  const text = messageContent.toLowerCase();
  const match = eclassroomState.classrooms.find(c => {
    const keywords = [c.subject, c.topic, ...(c.title || '').toLowerCase().split(' ')];
    return keywords.some(kw => kw && text.includes(kw));
  });

  if (!match) return;

  const suggestion = document.createElement('div');
  suggestion.className = 'eclassroom-suggestion';
  suggestion.innerHTML = `
    <div class="eclassroom-suggestion-icon">\uD83C\uDFEB</div>
    <div class="eclassroom-suggestion-text">
      <strong>Learn this interactively!</strong>
      <span>${escapeHtml(match.title)} is available in eClassroom with AI teachers.</span>
    </div>
    <button class="eclassroom-suggestion-btn" onclick="launchClassroom('${escapeHtml(match.id)}', '${escapeHtml(match.title)}')">Launch</button>
  `;
  containerEl.appendChild(suggestion);
}
```

- [ ] **Step 2: Add suggestion CSS**

Append to `public/css/app.css`:

```css
.eclassroom-suggestion {
  display: flex; align-items: center; gap: 12px;
  background: linear-gradient(135deg, rgba(252,209,22,0.08), rgba(252,209,22,0.03));
  border: 1px solid rgba(252,209,22,0.2); border-radius: 12px;
  padding: 12px 16px; margin-top: 12px;
}
.eclassroom-suggestion-icon { font-size: 24px; }
.eclassroom-suggestion-text { flex: 1; font-size: 13px; color: var(--text-secondary); }
.eclassroom-suggestion-text strong { display: block; color: var(--text-primary); margin-bottom: 2px; }
.eclassroom-suggestion-btn {
  padding: 6px 14px; border-radius: 8px; border: none;
  background: var(--accent); color: #000; font-size: 12px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
}
```

- [ ] **Step 3: Commit**

```bash
git add public/js/app.js public/css/app.css
git commit -m "feat(eclassroom): add agent classroom suggestions in student chat"
```

---

## Verification Checklist

Before marking Phase 1+2 complete, verify:

- [ ] `https://askozzy.work/api/ai-proxy/chat/completions` responds with 401 (no auth) or 200 (valid auth)
- [ ] `https://askozzy.work/api/eclassroom/token` returns JWT for authenticated users
- [ ] `https://askozzy.work/api/eclassroom/classrooms` returns list of pre-built classrooms
- [ ] `https://eclassroom.askozzy.work` loads the OpenMAIC interface
- [ ] eClassroom button visible in AskOzzy header nav
- [ ] Classroom cards render with correct subjects and titles
- [ ] "Launch" button opens eClassroom in new tab with JWT
- [ ] Free users see limit enforcement after 3 sessions/month
- [ ] Service worker cache v13 serves all new assets
