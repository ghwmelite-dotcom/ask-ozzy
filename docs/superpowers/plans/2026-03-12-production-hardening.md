# AskOzzy Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden AskOzzy for production by disabling translation, wiring tool execution into streaming, splitting the 12,100-line monolith, adding timeouts, security headers, structured logging, monitoring, and automated tests.

**Architecture:** Three-tier phased approach — Tier 1 (Critical) fixes correctness and maintainability issues, Tier 2 (Hardening) adds security and observability, Tier 3 (Quality) adds tests, crons, and profile reassessment.

**Tech Stack:** Cloudflare Workers, Hono (route splitting via `app.route()`), D1, KV, Workers AI, Vitest (new)

---

## Chunk 1: Tier 1 — Critical Production Fixes

### Task 1: Disable Language Translation Feature

**Files:**
- Modify: `src/index.ts` — remove SUPPORTED_LANGUAGES, translateText(), /api/translate route, language prompt injection, post-response translation, meeting translation
- Modify: `src/agents/translation-agent.ts` — keep file but mark as disabled
- Modify: `src/config/translation-resources.ts` — keep file but mark as disabled
- Modify: `public/js/app.js` — remove language selector UI references
- Modify: `public/index.html` — remove language selector DOM elements if any

- [ ] **Step 1: Remove translation code from index.ts**

Remove these sections from `src/index.ts`:

1. **Lines 2864-2938**: `SUPPORTED_LANGUAGES` constant, `translateText()` function, and `/api/translate` route
2. **Lines 2063-2074**: Language prompt injection in chat endpoint (`if (language && language !== "en"...`)
3. **Lines 2269-2281**: Post-response translation in SSE stream (`// Phase 7: Post-response translation`)
4. **Lines 2129-2161**: Translation safeguard check in chat endpoint (`if (agentCategory === 'translation')`)
5. **Line 9345-9373**: Meeting translation endpoint (`/api/meetings/:id/translate`)
6. **Line 1857**: Remove `language` from destructured chat request body
7. **Line 34**: Remove `classifyTranslationRisk, CERTIFIED_TRANSLATOR_RESOURCES` import
8. **Line 38**: Remove `translateWithSafeguards` import

- [ ] **Step 2: Remove translation UI from frontend**

Search `public/js/app.js` and `public/index.html` for:
- Language selector dropdown/toggle
- `SUPPORTED_LANGUAGES` references
- `translateText` calls
- `language` parameter in chat fetch calls
- Translation event handler in SSE (`event: translation`)

Remove all found references.

- [ ] **Step 3: Verify build compiles**

Run: `npx wrangler deploy --dry-run`
Expected: No TypeScript errors, successful build

- [ ] **Step 4: Commit**

```bash
git add src/index.ts public/js/app.js public/index.html
git commit -m "feat: disable language translation feature entirely"
```

---

### Task 2: Wire runWithTools() into Streaming Chat

**Files:**
- Modify: `src/index.ts` — add non-streaming tool execution code path for tool-enabled agents
- Modify: `src/lib/tool-loop.ts` — ensure it works with streaming gateway

- [ ] **Step 1: Add tool execution branch in chat endpoint**

In the chat endpoint (after agent rate limit check, before streaming), add a branch:
- If `agentHasTools(agentCategory)`, call `runWithTools()` for the first pass (non-streaming)
- If tool calls were made, use the final response text instead of streaming
- If no tool calls, fall through to normal streaming path

```typescript
// Tool execution for tool-enabled agents (non-streaming first pass)
let toolResponse: string | null = null;
if (agentHasTools(agentCategory)) {
  try {
    const tools = getToolsForAgent(agentCategory);
    const toolResult = await runWithTools(
      selectedModel,
      messages as any,
      tools,
      c.env,
      { max_tokens: maxTokens, temperature: inferenceParams.temperature }
    );
    if (toolResult.toolsUsed && toolResult.toolsUsed.length > 0) {
      toolResponse = toolResult.response;
    }
  } catch (e: any) {
    console.error("Tool execution failed, falling back to streaming:", e?.message);
  }
}
```

- [ ] **Step 2: Handle tool response as non-streaming return**

If `toolResponse` is set, return it as a JSON response (like known-error-guard), save the message, and skip the streaming path:

```typescript
if (toolResponse) {
  const assistantMsgId = generateId();
  await c.env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, model) VALUES (?, ?, 'assistant', ?, ?)"
  ).bind(assistantMsgId, conversationId, toolResponse, selectedModel).run();

  // Run verification in background
  c.executionCtx.waitUntil((async () => {
    try {
      const retrievedContexts: RetrievedContext[] = ragResults.map((r, i) => ({
        id: `rag_${i}`, text: r.content, score: r.score, source: r.source,
      }));
      if (requiresFullVerification(agentCategory)) {
        const vResult = await verify(toolResponse!, retrievedContexts, agentCategory, c.env);
        // Log if hallucination detected
      }
    } catch {}
  })());

  return c.json({ response: toolResponse, request_id: requestId, tools_used: true });
}
```

- [ ] **Step 3: Verify build compiles**

Run: `npx wrangler deploy --dry-run`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire runWithTools() into chat for tool-enabled agents"
```

---

### Task 3: Add Timeouts on Verification Calls

**Files:**
- Modify: `src/index.ts` — wrap verification and self-consistency calls in Promise.race with 10s timeout

- [ ] **Step 1: Find verification calls in post-stream block**

Locate the `waitUntil` block that runs verification after streaming completes. Wrap `verify()`, `selfConsistencyCheck()`, and `adjudicate()` calls in `Promise.race` with a 10-second timeout.

```typescript
const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
```

Apply to:
- `verify()` call: `await withTimeout(verify(...), 10000, 'verification')`
- `selfConsistencyCheck()` call: `await withTimeout(selfConsistencyCheck(...), 10000, 'self-consistency')`
- `adjudicate()` call: `await withTimeout(adjudicate(...), 10000, 'adjudication')`

- [ ] **Step 2: Verify build compiles**

Run: `npx wrangler deploy --dry-run`

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add 10s timeouts on verification pipeline calls"
```

---

### Task 4: Split index.ts Monolith into Route Modules

**Files:**
- Create: `src/routes/auth.ts` — auth, webauthn, recovery (lines 81-7531 auth-related)
- Create: `src/routes/chat.ts` — chat streaming, web-search, research, analyze, vision, image-chat
- Create: `src/routes/conversations.ts` — CRUD, folders, sharing, search, suggestions
- Create: `src/routes/user.ts` — profile, memories, onboarding, dashboard, sessions, 2FA, streaks, push
- Create: `src/routes/admin.ts` — admin dashboard, users, analytics, moderation, audit, export, announcements
- Create: `src/routes/admin-content.ts` — admin knowledge, documents, agents, exam-prep admin, metrics
- Create: `src/routes/org-admin.ts` — org admin routes
- Create: `src/routes/payments.ts` — payments, paystack webhook, pricing, usage, upgrade, trials, referrals, affiliate
- Create: `src/routes/features.ts` — exam-prep, workflows, meetings, spaces, prompt-course, discover
- Create: `src/routes/messaging.ts` — USSD, WhatsApp, SMS + admin messaging config
- Modify: `src/index.ts` — reduce to app setup, imports, middleware, helper functions, route mounting, scheduled handler

Each route file exports a `Hono` sub-app:

```typescript
import { Hono } from 'hono';
import type { AppType } from '../types';

const routes = new Hono<AppType>();

// Routes here...

export default routes;
```

Mounted in index.ts:

```typescript
import authRoutes from './routes/auth';
import chatRoutes from './routes/chat';
// ...
app.route('/', authRoutes);
app.route('/', chatRoutes);
// ...
```

**IMPORTANT:** Helper functions used across routes (searchKnowledge, buildAugmentedPrompt, checkUsageLimit, getEffectiveTier, ensureUserTypeColumn, etc.) stay in `src/index.ts` or move to `src/lib/helpers.ts` and get imported by route files.

- [ ] **Step 4.1: Create src/lib/helpers.ts with shared helper functions**

Extract from index.ts all non-route functions used by multiple route files:
- `searchKnowledge()`
- `buildAugmentedPrompt()`
- `checkUsageLimit()`
- `getEffectiveTier()`
- `ensureUserTypeColumn()`
- `ensureSubscriptionColumns()`
- `ensureUserProfilesTable()`
- `ensureExamTables()`
- `checkWebSearchLimit()`
- `incrementWebSearchCount()`
- `webSearch()`
- `checkModeration()`
- `logUserAudit()`
- `trackProductivity()`
- `updateUserStreak()`
- `PRICING_TIERS`
- `FREE_TIER_MODELS`
- `PRO_TIER_MODELS`
- `GOG_SYSTEM_PROMPT`
- `STUDENT_SYSTEM_PROMPT`

- [ ] **Step 4.2: Create route files one at a time**

Create each route file, moving the route handlers from index.ts. Start with the simplest (fewest dependencies) and work up:

1. `src/routes/org-admin.ts` — 15 routes, isolated behind orgAdminMiddleware
2. `src/routes/messaging.ts` — USSD/WhatsApp/SMS, self-contained
3. `src/routes/features.ts` — exam-prep, workflows, meetings, spaces, discover, prompt-course
4. `src/routes/payments.ts` — payments, pricing, usage, trials, referrals, affiliate
5. `src/routes/admin.ts` — admin core routes
6. `src/routes/admin-content.ts` — admin knowledge, documents, agents, metrics
7. `src/routes/user.ts` — user profile, memories, sessions, 2FA, push, streaks
8. `src/routes/conversations.ts` — conversations CRUD, folders, sharing
9. `src/routes/auth.ts` — auth routes (largest auth block)
10. `src/routes/chat.ts` — chat streaming (most complex, do last)

- [ ] **Step 4.3: Update index.ts to mount route modules**

Replace removed route handlers with:

```typescript
import orgAdminRoutes from './routes/org-admin';
import messagingRoutes from './routes/messaging';
// ... etc
app.route('/', orgAdminRoutes);
app.route('/', messagingRoutes);
// ... etc
```

- [ ] **Step 4.4: Verify build compiles**

Run: `npx wrangler deploy --dry-run`
Expected: Clean build, all routes still accessible

- [ ] **Step 4.5: Commit**

```bash
git add src/routes/ src/lib/helpers.ts src/index.ts
git commit -m "refactor: split index.ts monolith into route modules using Hono app.route()"
```

---

## Chunk 2: Tier 2 — Hardening

### Task 5: Add Security Headers

**Files:**
- Modify: `src/index.ts` — add global middleware for security headers

- [ ] **Step 1: Add security headers middleware**

```typescript
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  c.res.headers.set("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  c.res.headers.set("Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://gnews.io;"
  );
});
```

Place this BEFORE the CORS middleware so it applies to all responses.

- [ ] **Step 2: Verify build and test headers**

Run: `npx wrangler deploy --dry-run`

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add security headers (CSP, HSTS, X-Frame-Options, etc.)"
```

---

### Task 6: Add Global Per-User Rate Limit

**Files:**
- Modify: `src/lib/middleware.ts` — add global user rate limit (100/hr)

- [ ] **Step 1: Add globalRateLimit middleware**

In `src/lib/middleware.ts`, add a new middleware that checks KV for a per-user counter with 1-hour TTL:

```typescript
export async function globalRateLimit(env: Env, userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const key = `global_rate:${userId}`;
  const current = parseInt(await env.SESSIONS.get(key) || '0');
  if (current >= 100) {
    return { allowed: false, remaining: 0 };
  }
  await env.SESSIONS.put(key, String(current + 1), { expirationTtl: 3600 });
  return { allowed: true, remaining: 100 - current - 1 };
}
```

- [ ] **Step 2: Apply to chat endpoint**

In the chat endpoint, call `globalRateLimit()` after auth but before any expensive operations.

- [ ] **Step 3: Commit**

```bash
git add src/lib/middleware.ts src/index.ts
git commit -m "feat: add global per-user rate limit (100 requests/hr)"
```

---

### Task 7: Add Structured Logging

**Files:**
- Create: `src/lib/logger.ts` — structured JSON logger
- Modify: `src/index.ts` — replace console.error/log calls with structured logger

- [ ] **Step 1: Create logger utility**

```typescript
type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

export function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}
```

- [ ] **Step 2: Replace console.error/log calls in index.ts**

Find all ~53 `console.error` and `console.log` calls in index.ts and replace with `log('error', ...)` or `log('info', ...)`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/logger.ts src/index.ts
git commit -m "feat: add structured JSON logging, replace console.error/log"
```

---

### Task 8: Add Monitoring Cron

**Files:**
- Modify: `src/index.ts` (scheduled handler) — add hallucination rate monitoring

- [ ] **Step 1: Add monitoring logic to scheduled handler**

In the `scheduled()` export, after the Discover cron, add:

```typescript
// Monitor hallucination rate from gateway_metrics
try {
  const stats = await env.DB.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN confidence_score < 0.5 THEN 1 ELSE 0 END) as low_confidence,
      AVG(confidence_score) as avg_confidence
    FROM gateway_metrics
    WHERE date >= date('now', '-1 day')
  `).first<{ total: number; low_confidence: number; avg_confidence: number }>();

  if (stats && stats.total > 0) {
    const hallRate = (stats.low_confidence || 0) / stats.total;
    if (hallRate > 0.2) {
      // Log alert for high hallucination rate
      console.error(JSON.stringify({
        level: 'error',
        message: 'HIGH_HALLUCINATION_RATE',
        rate: hallRate,
        total: stats.total,
        low_confidence: stats.low_confidence,
        avg_confidence: stats.avg_confidence,
      }));
    }
  }
} catch {}
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: add hallucination rate monitoring in scheduled cron"
```

---

## Chunk 3: Tier 3 — Quality

### Task 9: Set Up Vitest and Add Core Tests

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/math-evaluator.test.ts` — test the recursive-descent math parser
- Create: `tests/cache-key.test.ts` — test cache key generation and skip logic
- Create: `tests/translation-risk.test.ts` — test translation risk classification
- Modify: `package.json` — add vitest dependency and test script

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`

- [ ] **Step 2: Create vitest config**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Add test script to package.json**

Add `"test": "vitest run"` to scripts.

- [ ] **Step 4: Write math evaluator tests**

Test the recursive-descent parser in `src/lib/tool-executor.ts`:
- Basic arithmetic: `2 + 3`, `10 - 4`, `3 * 7`, `20 / 5`
- Operator precedence: `2 + 3 * 4` = 14
- Parentheses: `(2 + 3) * 4` = 20
- Power: `2 ^ 3` = 8
- Unary minus: `-5 + 3` = -2
- Division by zero: should throw or return Infinity
- Invalid input: `abc` should throw

- [ ] **Step 5: Write cache key tests**

Test `buildCacheKey()` and `shouldSkipCache()`:
- Same input produces same hash
- Different inputs produce different hashes
- `shouldSkipCache` returns true for personal/time-sensitive queries
- Agent-specific TTLs are correct

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts tests/ package.json package-lock.json
git commit -m "feat: add vitest test infrastructure with math evaluator and cache key tests"
```

---

### Task 10: Add Daily Exchange Rate Cron

**Files:**
- Modify: `src/index.ts` (scheduled handler) — add exchange rate fetch
- Modify: `src/lib/tool-executor.ts` — use KV-cached rates in convert_currency tool

- [ ] **Step 1: Add exchange rate fetch to scheduled handler**

```typescript
// Fetch daily exchange rates for currency converter tool
try {
  const rateRes = await fetch('https://open.er-api.com/v6/latest/GHS');
  if (rateRes.ok) {
    const rateData = await rateRes.json() as { rates?: Record<string, number> };
    if (rateData.rates) {
      await env.SESSIONS.put('exchange_rates', JSON.stringify(rateData.rates), { expirationTtl: 86400 });
      await env.SESSIONS.put('exchange_rates_updated', new Date().toISOString(), { expirationTtl: 86400 });
    }
  }
} catch {}
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: add daily exchange rate cron for currency converter"
```

---

### Task 11: Re-assess Student Level After 10+ Interactions

**Files:**
- Modify: `src/agents/tutor-agent.ts` — add interaction counter and reassessment logic

- [ ] **Step 1: Add reassessment logic**

In `getOrCreateStudentProfile()`, track interaction count in the profile. After 10 interactions, re-run `assessStudentLevel()` and update if the new assessment differs.

```typescript
// In the chat endpoint tutor block, after updating session score:
if (isTutorAgent && studentProfile) {
  const interactionCount = (studentProfile as any).interaction_count || 0;
  if (interactionCount > 0 && interactionCount % 10 === 0) {
    // Re-assess level
    const reassessment = await assessStudentLevel(message, c.env);
    if (reassessment.level !== studentProfile.level) {
      studentProfile.level = reassessment.level;
      studentProfile.confidence = reassessment.confidence;
    }
  }
  (studentProfile as any).interaction_count = interactionCount + 1;
  await saveStudentProfile(conversationId, studentProfile, c.env);
}
```

- [ ] **Step 2: Update StudentProfile type**

Add `interaction_count?: number` to the StudentProfile interface in `src/types/student-profile.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/agents/tutor-agent.ts src/types/student-profile.ts src/index.ts
git commit -m "feat: re-assess student level every 10 interactions"
```
