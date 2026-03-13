# AskOzzy Systematic Debugging Fixes

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all bugs found during systematic debugging audit — 3 compilation errors, silent error swallowing, SQL safety, and grounding rule violations.

**Architecture:** Targeted fixes to existing files only. No new modules. The streaming code path (chat.ts:1520-1575) is the reference implementation for the broken tool-use path (chat.ts:1258-1275).

**Tech Stack:** TypeScript, Cloudflare Workers, D1, Workers AI

---

## Chunk 1: Critical — Fix 3 TypeScript Compilation Errors

### Task 1: Fix `verify()` call signature in tool-use path

**Files:**
- Modify: `src/routes/chat.ts:1258-1272`

**Root cause:** The tool-use verification block passes `toolResult.response` (string) directly to `verify()`, which expects a `GeneratedResponse` object. Also passes `agentCategory` as an extra argument. The streaming path at line 1526-1533 has the correct pattern.

- [ ] **Step 1: Fix the verify() call**

Replace lines 1258-1272 with the corrected verification block that:
1. Wraps `toolResult.response` in a `GeneratedResponse`-shaped object (matching lines 1526-1531)
2. Uses `parseCitations()` to extract claims (matching line 1522)
3. Removes the extra `agentCategory` argument
4. Checks `vResult.overall === 'FAIL'` instead of `!vResult.is_supported`
5. Calls `adjudicate()` on failure (matching lines 1540-1542)

- [ ] **Step 2: Run `npx tsc --noEmit` to verify the first two errors are resolved**

Expected: Only the `recordGatewayMetrics` error on line 1275 remains.

### Task 2: Fix `recordGatewayMetrics()` call in tool-use path

**Files:**
- Modify: `src/routes/chat.ts:1274-1275`

**Root cause:** Arguments are in wrong order and missing 2 required params. Correct signature is `(env, agentType, cacheHit, hallucinationFlagged, responseMs, confidenceScore)`.

- [ ] **Step 1: Fix the recordGatewayMetrics() call**

Replace with correct argument order matching lines 1552/1575, using `0` for responseMs and `0` for confidenceScore since this is the quick tool-use path with no timing data.

- [ ] **Step 2: Run `npx tsc --noEmit`**

Expected: 0 errors.

- [ ] **Step 3: Run `npx vitest run`**

Expected: 29/29 pass (no regressions).

---

## Chunk 2: Medium — Add logging to empty catch blocks in tool-use verification

### Task 3: Replace empty `catch {}` with minimal error logging

**Files:**
- Modify: `src/routes/chat.ts:1271` (verification catch)
- Modify: `src/routes/chat.ts:1283` (student profile catch)

- [ ] **Step 1: Add error logging to catch blocks**

Replace `catch {}` with `catch (e: any) { log("error", "...", { error: e?.message }); }` — matching the pattern used elsewhere (e.g., line 1578-1579).

- [ ] **Step 2: Run `npx tsc --noEmit` — 0 errors**

---

## Chunk 3: Medium — Add SQL column allowlist validation for PRODUCTIVITY_MULTIPLIERS

### Task 4: Add defense-in-depth column name validation

**Files:**
- Modify: `src/routes/chat.ts:397-411` (trackProductivity function)

The column names come from a hardcoded object and are safe today, but adding a runtime allowlist check prevents future regressions if the pattern is ever refactored.

- [ ] **Step 1: Add allowlist constant and guard**

Add a `VALID_STAT_COLUMNS` set and validate `multiplier.column` against it before SQL execution.

- [ ] **Step 2: Run tests — 29/29 pass**

---

## Chunk 4: Low — Add GNEWS_API_KEY early-return guard

### Task 5: Guard against missing GNEWS_API_KEY

**Files:**
- Modify: `src/index.ts` (cron discover refresh)
- Modify: `src/routes/admin-content.ts` (manual discover refresh)

- [ ] **Step 1: Add early return if apiKey is falsy**

After `const apiKey = env.GNEWS_API_KEY;`, add:
```typescript
if (!apiKey) {
  console.error("GNEWS_API_KEY not configured, skipping discover refresh");
  return;
}
```

- [ ] **Step 2: Run tests — 29/29 pass**

---

## Not fixing (documented decisions)

1. **Hardcoded `max_tokens` in utility AI calls** (title gen, suggestions, content classification): These are not agent responses — they're short utility calls outside the grounding pipeline. Using `getParams()` would force creating fake agent categories. The current hardcoded values are appropriate.

2. **`tutor-agent.ts` direct `env.AI.run()` calls**: These are assessment/orientation utilities (level detection, topic briefs) — not grounded responses to users. They return structured JSON for internal use, not user-facing content. The grounding pipeline doesn't apply here.

3. **Dynamic SQL columns in `trackProductivity`**: Safe by construction (hardcoded allowlist). Task 4 adds defense-in-depth validation as a guard, not a fix.
