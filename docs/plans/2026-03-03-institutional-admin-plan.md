# Institutional Admin & Multi-Tenancy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add multi-tenancy so any organisation can onboard with their own admin portal, manage members, and get org-scoped analytics — with a separate org admin app connecting to the super admin portal.

**Architecture:** Separate `/org-admin.html` frontend with `/api/org-admin/*` API routes, shared D1 database. New `orgAdminMiddleware` for auth. Hybrid billing where org sponsors seats but users can self-upgrade. Split registration into Individual vs Organisation paths.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), Hono, vanilla JS frontend, KV sessions

**Design Doc:** `docs/plans/2026-03-03-institutional-admin-design.md`

---

## Phase 1: Schema Migration

### Task 1: Create schema migration file

**Files:**
- Create: `schema-institutional.sql`

**Step 1: Write the migration SQL**

```sql
-- Institutional Admin & Multi-Tenancy Schema Migration
-- Run after existing schema.sql

-- 1. Expand organizations table (drop and recreate with new fields)
-- Note: existing table has minimal data, safe to recreate
DROP TABLE IF EXISTS organizations;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_id TEXT NOT NULL,
  tier TEXT DEFAULT 'free',
  max_seats INTEGER DEFAULT 10,
  used_seats INTEGER DEFAULT 0,
  sector TEXT DEFAULT NULL,
  logo_url TEXT DEFAULT NULL,
  domain TEXT DEFAULT NULL,
  settings TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- 2. Org invites table
CREATE TABLE IF NOT EXISTS org_invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  tier TEXT DEFAULT NULL,
  invited_by TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (invited_by) REFERENCES users(id)
);

-- 3. Org pricing table
CREATE TABLE IF NOT EXISTS org_pricing (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'starter',
  seats_purchased INTEGER NOT NULL DEFAULT 10,
  price_per_seat REAL NOT NULL DEFAULT 50.0,
  billing_cycle TEXT DEFAULT 'monthly',
  billing_started_at TEXT DEFAULT (datetime('now')),
  billing_expires_at TEXT DEFAULT NULL,
  custom_terms TEXT DEFAULT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id)
);

-- 4. Add org_role to users (lazy migration pattern used elsewhere)
-- Will be handled via ALTER TABLE in code if column doesn't exist

-- 5. Org-scoped announcements
ALTER TABLE announcements ADD COLUMN org_id TEXT DEFAULT NULL;

-- 6. Org-scoped agents
ALTER TABLE agents ADD COLUMN org_id TEXT DEFAULT NULL;

-- 7. Org-scoped knowledge base documents
-- Check if kb_documents table exists and add org_id
```

**Step 2: Run migration against D1**

```bash
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-institutional.sql
```

**Step 3: Commit**

```bash
git add schema-institutional.sql
git commit -m "feat: add institutional multi-tenancy schema migration"
```

---

### Task 2: Add lazy migration for org_role column on users

**Files:**
- Modify: `src/index.ts` (near line 620, after existing lazy migrations)

**Step 1: Add ensureOrgRoleColumn function**

Add after the `ensureStreakColumns` function (~line 640):

```typescript
async function ensureOrgRoleColumn(db: D1Database) {
  try {
    await db.prepare("SELECT org_role FROM users LIMIT 1").first();
  } catch {
    await db.prepare("ALTER TABLE users ADD COLUMN org_role TEXT DEFAULT NULL").run();
  }
}
```

**Step 2: Call it in the app initialization**

Find where other `ensure*` functions are called and add `ensureOrgRoleColumn` alongside them.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add lazy migration for org_role column on users"
```

---

## Phase 2: Org Admin Middleware

### Task 3: Add orgAdminMiddleware

**Files:**
- Modify: `src/lib/middleware.ts`

**Step 1: Add orgAdminMiddleware after deptAdminMiddleware**

```typescript
// ─── Org Admin Middleware ────────────────────────────────────────────

export async function orgAdminMiddleware(c: any, next: () => Promise<void>): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice(7);
  const userId = await verifyToken(token, c.env);
  if (!userId) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }
  const user = (await c.env.DB.prepare(
    "SELECT role, org_id, org_role FROM users WHERE id = ?"
  ).bind(userId).first()) as { role: string; org_id: string | null; org_role: string | null } | null;

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }
  // Super admins can access any org admin route (with org_id from query/param)
  if (user.role === "super_admin") {
    c.set("userId", userId);
    c.set("orgId", c.req.query("org_id") || user.org_id);
    c.set("isSuperAdmin", true);
    await next();
    return;
  }
  if (!user.org_id || user.org_role !== "org_admin") {
    return c.json({ error: "Forbidden: organisation admin access required" }, 403);
  }
  c.set("userId", userId);
  c.set("orgId", user.org_id);
  c.set("isSuperAdmin", false);
  await next();
}
```

**Step 2: Update import in src/index.ts**

At line 10-12, add `orgAdminMiddleware` to the import:

```typescript
import {
  checkRateLimit, authMiddleware, adminMiddleware, deptAdminMiddleware, orgAdminMiddleware,
} from "./lib/middleware";
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/lib/middleware.ts src/index.ts
git commit -m "feat: add orgAdminMiddleware for institutional admin auth"
```

---

## Phase 3: Organisation Pricing Constants

### Task 4: Add org pricing tiers and volume discount logic

**Files:**
- Modify: `src/index.ts` (after PRICING_TIERS ~line 567)

**Step 1: Add org pricing constants and helper**

```typescript
// ─── Organisation Pricing ────────────────────────────────────────────

const ORG_PRICING_TIERS: Record<string, {
  name: string;
  pricePerSeat: number;
  memberTier: string;
  features: string[];
}> = {
  starter: {
    name: "Org Starter",
    pricePerSeat: 50,
    memberTier: "professional",
    features: ["10 AI models per member", "200 messages/day per member", "Org admin portal", "Org analytics"],
  },
  business: {
    name: "Org Business",
    pricePerSeat: 85,
    memberTier: "enterprise",
    features: ["All 14 AI models per member", "Unlimited messages", "Org knowledge base", "Org admin portal", "Priority support"],
  },
  custom: {
    name: "Org Custom",
    pricePerSeat: 0,
    memberTier: "enterprise",
    features: ["Custom configuration", "SLA", "Dedicated support"],
  },
};

const VOLUME_DISCOUNTS = [
  { minSeats: 200, discount: 0.35 },
  { minSeats: 51, discount: 0.25 },
  { minSeats: 11, discount: 0.15 },
  { minSeats: 1, discount: 0 },
];

function getVolumeDiscount(seats: number): number {
  for (const tier of VOLUME_DISCOUNTS) {
    if (seats >= tier.minSeats) return tier.discount;
  }
  return 0;
}

function getEffectiveOrgSeatPrice(plan: string, seats: number): number {
  const tier = ORG_PRICING_TIERS[plan];
  if (!tier || plan === "custom") return 0;
  const discount = getVolumeDiscount(seats);
  return Math.round(tier.pricePerSeat * (1 - discount) * 100) / 100;
}
```

**Step 2: Update getEffectiveTier to handle hybrid billing**

Find the existing `getEffectiveTier` function (~line 599) and update it:

```typescript
function getEffectiveTier(user: {
  tier: string;
  subscription_expires_at: string | null;
  trial_expires_at: string | null;
  org_id?: string | null;
  org_sponsored_tier?: string | null;
}): string {
  const now = new Date();
  // Trial: free users with active trial get professional
  if (user.trial_expires_at && new Date(user.trial_expires_at + "Z") > now
      && (!user.tier || user.tier === "free")) {
    const baseTier = "professional";
    // Hybrid: if org sponsors a higher tier, use that
    if (user.org_sponsored_tier) return maxTier(baseTier, user.org_sponsored_tier);
    return baseTier;
  }
  // Paid tier with expiry set: check grace period (7 days)
  if (user.tier && user.tier !== "free" && user.subscription_expires_at) {
    const expiresAt = new Date(user.subscription_expires_at + "Z");
    const graceEnd = new Date(expiresAt.getTime() + 7 * 86400000);
    const personalTier = now <= graceEnd ? user.tier : "free";
    // Hybrid: MAX(personal, org-sponsored)
    if (user.org_sponsored_tier) return maxTier(personalTier, user.org_sponsored_tier);
    return personalTier;
  }
  const personalTier = user.tier || "free";
  if (user.org_sponsored_tier) return maxTier(personalTier, user.org_sponsored_tier);
  return personalTier;
}

const TIER_RANK: Record<string, number> = { free: 0, professional: 1, enterprise: 2 };

function maxTier(a: string, b: string): string {
  return (TIER_RANK[a] || 0) >= (TIER_RANK[b] || 0) ? a : b;
}
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add org pricing tiers, volume discounts, hybrid billing logic"
```

---

## Phase 4: Organisation Registration Backend

### Task 5: Add organisation registration endpoint

**Files:**
- Modify: `src/index.ts` (near the existing register endpoint ~line 55)

**Step 1: Add POST /api/auth/register/organisation endpoint**

Add after the existing registration endpoint:

```typescript
app.post("/api/auth/register/organisation", async (c) => {
  const rateCheck = await checkRateLimit(c.env, c.req.header("CF-Connecting-IP") || "unknown", "auth");
  if (!rateCheck.allowed) return c.json({ error: "Too many attempts. Try again later." }, 429);

  const { orgName, orgSlug, orgSector, orgDomain, adminName, adminEmail, plan, seats, referralCode } = await c.req.json();

  if (!orgName || !orgSlug || !adminName || !adminEmail || !plan || !seats) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  // Validate slug format
  const slugRegex = /^[a-z0-9-]+$/;
  if (!slugRegex.test(orgSlug)) {
    return c.json({ error: "Slug must be lowercase alphanumeric with hyphens only" }, 400);
  }

  // Check slug uniqueness
  const existingOrg = await c.env.DB.prepare("SELECT id FROM organizations WHERE slug = ?").bind(orgSlug).first();
  if (existingOrg) return c.json({ error: "Organisation slug already taken" }, 409);

  // Check email uniqueness
  const existingUser = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(adminEmail.toLowerCase()).first();
  if (existingUser) return c.json({ error: "Email already registered" }, 409);

  // Generate IDs and credentials
  const orgId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const accessCode = generateAccessCode();
  const passwordHash = await hashPassword(accessCode);
  const referralCodeGen = `OZZY-${adminName.split(" ")[0].toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;

  // Calculate pricing
  const effectivePrice = getEffectiveOrgSeatPrice(plan, seats);
  const orgTier = ORG_PRICING_TIERS[plan]?.memberTier || "professional";

  // Handle referral
  let referredBy: string | null = null;
  if (referralCode) {
    const referrer = await c.env.DB.prepare("SELECT id FROM users WHERE referral_code = ?").bind(referralCode).first<{ id: string }>();
    if (referrer) referredBy = referrer.id;
  }

  // Create org + admin user + pricing in a batch
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO organizations (id, name, slug, owner_id, tier, max_seats, used_seats, sector, domain, settings)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, '{}')`
    ).bind(orgId, orgName, orgSlug, userId, orgTier, seats, orgSector || null, orgDomain || null),

    c.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, full_name, department, role, tier, referral_code, referred_by, org_id, org_role, referral_source, submitted_referral_code)
       VALUES (?, ?, ?, ?, ?, 'civil_servant', ?, ?, ?, ?, 'org_admin', ?, ?)`
    ).bind(userId, adminEmail.toLowerCase(), passwordHash, adminName, orgName, orgTier, referralCodeGen, referredBy, orgId, "org_admin",
      referralCode ? "referral" : "organic", referralCode || null),

    c.env.DB.prepare(
      `INSERT INTO org_pricing (id, org_id, plan, seats_purchased, price_per_seat, billing_cycle)
       VALUES (?, ?, ?, ?, ?, 'monthly')`
    ).bind(crypto.randomUUID(), orgId, plan, seats, effectivePrice),
  ]);

  // Update referrer stats if applicable
  if (referredBy) {
    await c.env.DB.prepare("UPDATE users SET total_referrals = total_referrals + 1 WHERE id = ?").bind(referredBy).run();
  }

  return c.json({
    success: true,
    accessCode,
    orgId,
    orgSlug,
    userId,
    plan,
    seats,
    pricePerSeat: effectivePrice,
    monthlyTotal: Math.round(effectivePrice * seats * 100) / 100,
  });
});
```

**Step 2: Add domain check endpoint**

```typescript
app.get("/api/auth/domain-check/:email", async (c) => {
  const email = c.req.param("email");
  const domain = email.split("@")[1];
  if (!domain) return c.json({ match: false });

  const org = await c.env.DB.prepare(
    "SELECT id, name, slug FROM organizations WHERE domain = ?"
  ).bind(domain).first();

  return c.json({ match: !!org, org: org || null });
});
```

**Step 3: Add invite acceptance endpoint**

```typescript
app.post("/api/auth/invite/accept/:id", async (c) => {
  const inviteId = c.req.param("id");
  const { fullName, department } = await c.req.json();

  const invite = await c.env.DB.prepare(
    "SELECT * FROM org_invites WHERE id = ? AND status = 'pending'"
  ).bind(inviteId).first<any>();

  if (!invite) return c.json({ error: "Invite not found or expired" }, 404);

  // Check if email already registered
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(invite.email).first();
  if (existing) return c.json({ error: "Email already registered" }, 409);

  // Get org details for tier
  const org = await c.env.DB.prepare("SELECT tier, used_seats, max_seats FROM organizations WHERE id = ?").bind(invite.org_id).first<any>();
  if (!org) return c.json({ error: "Organisation not found" }, 404);
  if (org.used_seats >= org.max_seats) return c.json({ error: "Organisation has reached seat limit" }, 403);

  const userId = crypto.randomUUID();
  const accessCode = generateAccessCode();
  const passwordHash = await hashPassword(accessCode);
  const referralCode = `OZZY-${fullName.split(" ")[0].toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, full_name, department, role, tier, referral_code, org_id, org_role, referral_source)
       VALUES (?, ?, ?, ?, ?, 'civil_servant', ?, ?, ?, ?, 'invite')`
    ).bind(userId, invite.email, passwordHash, fullName, department || "", invite.tier || org.tier, referralCode, invite.org_id, invite.role),

    c.env.DB.prepare("UPDATE org_invites SET status = 'accepted' WHERE id = ?").bind(inviteId),

    c.env.DB.prepare("UPDATE organizations SET used_seats = used_seats + 1 WHERE id = ?").bind(invite.org_id),
  ]);

  return c.json({ success: true, accessCode, userId });
});
```

**Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: add organisation registration, invite acceptance, domain check endpoints"
```

---

## Phase 5: Org Admin API Routes

### Task 6: Add org admin verify and dashboard endpoints

**Files:**
- Modify: `src/index.ts` (add new route section before the admin routes ~line 3523)

**Step 1: Add org admin route section header and core endpoints**

Insert before the `// ─── Admin Routes` comment:

```typescript
// ─── Org Admin Routes ────────────────────────────────────────────────

app.get("/api/org-admin/verify", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const org = await c.env.DB.prepare(
    "SELECT id, name, slug, tier, max_seats, used_seats, sector, logo_url, domain, settings, created_at FROM organizations WHERE id = ?"
  ).bind(orgId).first();
  if (!org) return c.json({ error: "Organisation not found" }, 404);
  return c.json({ verified: true, org });
});

app.get("/api/org-admin/dashboard", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const today = new Date().toISOString().split("T")[0];

  const [members, activeToday, messagestoday, totalConversations] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE org_id = ?").bind(orgId).first<{ count: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM users WHERE org_id = ? AND date(last_login) = ?"
    ).bind(orgId, today).first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM messages WHERE conversation_id IN
       (SELECT id FROM conversations WHERE user_id IN (SELECT id FROM users WHERE org_id = ?))
       AND role = 'user' AND date(created_at) = ?`
    ).bind(orgId, today).first<{ count: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM conversations WHERE user_id IN (SELECT id FROM users WHERE org_id = ?)"
    ).bind(orgId).first<{ count: number }>(),
  ]);

  const org = await c.env.DB.prepare("SELECT tier, max_seats, used_seats FROM organizations WHERE id = ?").bind(orgId).first();

  return c.json({
    totalMembers: members?.count || 0,
    activeToday: activeToday?.count || 0,
    messagesToday: messagestoday?.count || 0,
    totalConversations: totalConversations?.count || 0,
    seats: { used: (org as any)?.used_seats || 0, max: (org as any)?.max_seats || 0 },
    tier: (org as any)?.tier || "free",
  });
});
```

**Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: add org admin verify and dashboard API endpoints"
```

---

### Task 7: Add org admin user management endpoints

**Files:**
- Modify: `src/index.ts` (continue in org admin routes section)

**Step 1: Add member listing, invite, remove, role change endpoints**

```typescript
app.get("/api/org-admin/users", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "25");
  const search = c.req.query("search") || "";
  const offset = (page - 1) * limit;

  let query = "SELECT id, email, full_name, department, tier, org_role, last_login, created_at FROM users WHERE org_id = ?";
  const params: any[] = [orgId];

  if (search) {
    query += " AND (full_name LIKE ? OR email LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }
  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  const total = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE org_id = ?").bind(orgId).first<{ count: number }>();

  return c.json({ users: results, total: total?.count || 0, page, limit });
});

app.post("/api/org-admin/users/invite", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const userId = c.get("userId");
  const { email, role, tier } = await c.req.json();

  if (!email) return c.json({ error: "Email is required" }, 400);

  // Check org seat limit
  const org = await c.env.DB.prepare("SELECT used_seats, max_seats FROM organizations WHERE id = ?").bind(orgId).first<any>();
  if (org && org.used_seats >= org.max_seats) {
    return c.json({ error: "Organisation seat limit reached" }, 403);
  }

  // Check for existing invite
  const existing = await c.env.DB.prepare(
    "SELECT id FROM org_invites WHERE org_id = ? AND email = ? AND status = 'pending'"
  ).bind(orgId, email.toLowerCase()).first();
  if (existing) return c.json({ error: "Invite already pending for this email" }, 409);

  const inviteId = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO org_invites (id, org_id, email, role, tier, invited_by) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(inviteId, orgId, email.toLowerCase(), role || "member", tier || null, userId).run();

  return c.json({ success: true, inviteId });
});

app.delete("/api/org-admin/users/:id", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const memberId = c.req.param("id");

  // Verify user belongs to this org
  const member = await c.env.DB.prepare("SELECT id, org_role FROM users WHERE id = ? AND org_id = ?").bind(memberId, orgId).first<any>();
  if (!member) return c.json({ error: "Member not found in this organisation" }, 404);

  // Cannot remove the org owner
  const org = await c.env.DB.prepare("SELECT owner_id FROM organizations WHERE id = ?").bind(orgId).first<any>();
  if (org?.owner_id === memberId) return c.json({ error: "Cannot remove the organisation owner" }, 403);

  // Remove from org (don't delete user account)
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET org_id = NULL, org_role = NULL WHERE id = ?").bind(memberId),
    c.env.DB.prepare("UPDATE organizations SET used_seats = MAX(0, used_seats - 1) WHERE id = ?").bind(orgId),
  ]);

  return c.json({ success: true });
});

app.patch("/api/org-admin/users/:id/role", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const memberId = c.req.param("id");
  const { role } = await c.req.json();

  if (!["member", "org_admin"].includes(role)) {
    return c.json({ error: "Invalid role. Must be 'member' or 'org_admin'" }, 400);
  }

  const member = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND org_id = ?").bind(memberId, orgId).first();
  if (!member) return c.json({ error: "Member not found in this organisation" }, 404);

  await c.env.DB.prepare("UPDATE users SET org_role = ? WHERE id = ?").bind(role, memberId).run();
  return c.json({ success: true });
});
```

**Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: add org admin user management endpoints (list, invite, remove, role)"
```

---

### Task 8: Add org admin analytics and export endpoints

**Files:**
- Modify: `src/index.ts` (continue in org admin routes section)

**Step 1: Add analytics and CSV export**

```typescript
app.get("/api/org-admin/analytics", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");

  // Messages per day (last 30 days)
  const { results: messagesPerDay } = await c.env.DB.prepare(
    `SELECT date(m.created_at) as day, COUNT(*) as count
     FROM messages m JOIN conversations c ON m.conversation_id = c.id
     JOIN users u ON c.user_id = u.id
     WHERE u.org_id = ? AND m.role = 'user' AND m.created_at >= datetime('now', '-30 days')
     GROUP BY day ORDER BY day`
  ).bind(orgId).all();

  // Active users per day (last 30 days)
  const { results: activePerDay } = await c.env.DB.prepare(
    `SELECT date(m.created_at) as day, COUNT(DISTINCT c.user_id) as count
     FROM messages m JOIN conversations c ON m.conversation_id = c.id
     JOIN users u ON c.user_id = u.id
     WHERE u.org_id = ? AND m.role = 'user' AND m.created_at >= datetime('now', '-30 days')
     GROUP BY day ORDER BY day`
  ).bind(orgId).all();

  // Popular models
  const { results: popularModels } = await c.env.DB.prepare(
    `SELECT m.model, COUNT(*) as count
     FROM messages m JOIN conversations c ON m.conversation_id = c.id
     JOIN users u ON c.user_id = u.id
     WHERE u.org_id = ? AND m.model IS NOT NULL
     GROUP BY m.model ORDER BY count DESC LIMIT 10`
  ).bind(orgId).all();

  // Top users
  const { results: topUsers } = await c.env.DB.prepare(
    `SELECT u.full_name, u.email, COUNT(*) as message_count
     FROM messages m JOIN conversations c ON m.conversation_id = c.id
     JOIN users u ON c.user_id = u.id
     WHERE u.org_id = ? AND m.role = 'user'
     GROUP BY u.id ORDER BY message_count DESC LIMIT 10`
  ).bind(orgId).all();

  // Tier breakdown
  const { results: tierBreakdown } = await c.env.DB.prepare(
    "SELECT tier, COUNT(*) as count FROM users WHERE org_id = ? GROUP BY tier"
  ).bind(orgId).all();

  return c.json({ messagesPerDay, activePerDay, popularModels, topUsers, tierBreakdown });
});

app.get("/api/org-admin/export/users", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const { results } = await c.env.DB.prepare(
    "SELECT email, full_name, department, tier, org_role, last_login, created_at FROM users WHERE org_id = ? ORDER BY created_at"
  ).bind(orgId).all();

  const csv = [
    "Email,Full Name,Department,Tier,Org Role,Last Login,Created At",
    ...results.map((u: any) => `${u.email},${u.full_name},${u.department},${u.tier},${u.org_role},${u.last_login},${u.created_at}`)
  ].join("\n");

  return new Response(csv, {
    headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=org-members.csv" },
  });
});
```

**Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: add org admin analytics and CSV export endpoints"
```

---

### Task 9: Add org admin announcements, agents, KB, billing, settings endpoints

**Files:**
- Modify: `src/index.ts` (continue in org admin routes section)

**Step 1: Add remaining org admin CRUD endpoints**

```typescript
// ── Org Announcements ──
app.get("/api/org-admin/announcements", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM announcements WHERE org_id = ? ORDER BY created_at DESC"
  ).bind(orgId).all();
  return c.json({ announcements: results });
});

app.post("/api/org-admin/announcements", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const { title, content, type, dismissible, expires_at } = await c.req.json();
  if (!title || !content) return c.json({ error: "Title and content required" }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO announcements (id, title, content, type, dismissible, expires_at, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, title, content, type || "info", dismissible ? 1 : 0, expires_at || null, orgId).run();
  return c.json({ success: true, id });
});

app.patch("/api/org-admin/announcements/:id", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const id = c.req.param("id");
  const { title, content, type, dismissible, expires_at } = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE announcements SET title = COALESCE(?, title), content = COALESCE(?, content), type = COALESCE(?, type), dismissible = COALESCE(?, dismissible), expires_at = COALESCE(?, expires_at) WHERE id = ? AND org_id = ?"
  ).bind(title, content, type, dismissible !== undefined ? (dismissible ? 1 : 0) : null, expires_at, id, orgId).run();
  return c.json({ success: true });
});

app.delete("/api/org-admin/announcements/:id", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  await c.env.DB.prepare("DELETE FROM announcements WHERE id = ? AND org_id = ?").bind(c.req.param("id"), orgId).run();
  return c.json({ success: true });
});

// ── Org Agents ──
app.get("/api/org-admin/agents", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const { results } = await c.env.DB.prepare("SELECT * FROM agents WHERE org_id = ? ORDER BY name").bind(orgId).all();
  return c.json({ agents: results });
});

app.post("/api/org-admin/agents", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const { name, description, system_prompt, model, icon } = await c.req.json();
  if (!name || !system_prompt) return c.json({ error: "Name and system prompt required" }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO agents (id, name, description, system_prompt, model, icon, org_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, name, description || "", system_prompt, model || null, icon || "🤖", orgId).run();
  return c.json({ success: true, id });
});

app.patch("/api/org-admin/agents/:id", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const id = c.req.param("id");
  const { name, description, system_prompt, model, icon, active } = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE agents SET name = COALESCE(?, name), description = COALESCE(?, description), system_prompt = COALESCE(?, system_prompt), model = COALESCE(?, model), icon = COALESCE(?, icon), active = COALESCE(?, active) WHERE id = ? AND org_id = ?"
  ).bind(name, description, system_prompt, model, icon, active !== undefined ? (active ? 1 : 0) : null, id, orgId).run();
  return c.json({ success: true });
});

app.delete("/api/org-admin/agents/:id", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  await c.env.DB.prepare("DELETE FROM agents WHERE id = ? AND org_id = ?").bind(c.req.param("id"), orgId).run();
  return c.json({ success: true });
});

// ── Org KB ──
app.get("/api/org-admin/kb/stats", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const docs = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM kb_documents WHERE org_id = ?"
  ).bind(orgId).first<{ count: number }>();
  return c.json({ documents: docs?.count || 0 });
});

// ── Org Billing ──
app.get("/api/org-admin/billing", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const [org, pricing] = await Promise.all([
    c.env.DB.prepare("SELECT tier, max_seats, used_seats FROM organizations WHERE id = ?").bind(orgId).first(),
    c.env.DB.prepare("SELECT * FROM org_pricing WHERE org_id = ?").bind(orgId).first(),
  ]);
  const p = pricing as any;
  const discount = p ? getVolumeDiscount(p.seats_purchased) : 0;
  return c.json({
    org,
    pricing: p,
    discount: Math.round(discount * 100),
    monthlyTotal: p ? Math.round(p.price_per_seat * p.seats_purchased * 100) / 100 : 0,
  });
});

// ── Org Settings ──
app.patch("/api/org-admin/settings", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const { name, logo_url, domain, sector } = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE organizations SET name = COALESCE(?, name), logo_url = COALESCE(?, logo_url), domain = COALESCE(?, domain), sector = COALESCE(?, sector) WHERE id = ?"
  ).bind(name, logo_url, domain, sector, orgId).run();
  return c.json({ success: true });
});
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add org admin announcements, agents, KB, billing, settings endpoints"
```

---

## Phase 6: Enhanced Super Admin Org Management

### Task 10: Expand super admin organisation endpoints

**Files:**
- Modify: `src/index.ts` (replace existing GET /api/admin/organizations ~line 6770)

**Step 1: Replace and expand org management endpoints**

Replace the existing minimal organizations endpoint with full CRUD:

```typescript
// Enhanced org management (replaces minimal existing endpoint)
app.get("/api/admin/organizations", adminMiddleware, async (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "25");
  const search = c.req.query("search") || "";
  const offset = (page - 1) * limit;

  let query = `SELECT o.*, op.plan, op.seats_purchased, op.price_per_seat, op.billing_cycle, op.billing_expires_at,
    (SELECT full_name FROM users WHERE id = o.owner_id) as owner_name,
    (SELECT email FROM users WHERE id = o.owner_id) as owner_email
    FROM organizations o LEFT JOIN org_pricing op ON o.id = op.org_id`;
  const params: any[] = [];

  if (search) {
    query += " WHERE o.name LIKE ? OR o.slug LIKE ?";
    params.push(`%${search}%`, `%${search}%`);
  }
  query += " ORDER BY o.created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  const total = await c.env.DB.prepare("SELECT COUNT(*) as count FROM organizations").first<{ count: number }>();

  return c.json({ organizations: results, total: total?.count || 0, page, limit });
});

app.post("/api/admin/organizations", adminMiddleware, async (c) => {
  const { name, slug, ownerEmail, tier, maxSeats, sector, domain, plan } = await c.req.json();
  if (!name || !slug || !ownerEmail) return c.json({ error: "Name, slug, and owner email required" }, 400);

  const owner = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(ownerEmail.toLowerCase()).first<{ id: string }>();
  if (!owner) return c.json({ error: "Owner email not found" }, 404);

  const orgId = crypto.randomUUID();
  const effectivePrice = getEffectiveOrgSeatPrice(plan || "starter", maxSeats || 10);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO organizations (id, name, slug, owner_id, tier, max_seats, used_seats, sector, domain)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).bind(orgId, name, slug, owner.id, tier || "professional", maxSeats || 10, sector || null, domain || null),

    c.env.DB.prepare("UPDATE users SET org_id = ?, org_role = 'org_admin' WHERE id = ?").bind(orgId, owner.id),

    c.env.DB.prepare(
      "INSERT INTO org_pricing (id, org_id, plan, seats_purchased, price_per_seat) VALUES (?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), orgId, plan || "starter", maxSeats || 10, effectivePrice),
  ]);

  return c.json({ success: true, orgId });
});

app.patch("/api/admin/organizations/:id", adminMiddleware, async (c) => {
  const orgId = c.req.param("id");
  const { name, tier, maxSeats, sector, domain, plan } = await c.req.json();

  await c.env.DB.prepare(
    "UPDATE organizations SET name = COALESCE(?, name), tier = COALESCE(?, tier), max_seats = COALESCE(?, max_seats), sector = COALESCE(?, sector), domain = COALESCE(?, domain) WHERE id = ?"
  ).bind(name, tier, maxSeats, sector, domain, orgId).run();

  if (plan || maxSeats) {
    const seats = maxSeats || 10;
    const effectivePrice = getEffectiveOrgSeatPrice(plan || "starter", seats);
    await c.env.DB.prepare(
      "UPDATE org_pricing SET plan = COALESCE(?, plan), seats_purchased = COALESCE(?, seats_purchased), price_per_seat = ? WHERE org_id = ?"
    ).bind(plan, maxSeats, effectivePrice, orgId).run();
  }

  return c.json({ success: true });
});

app.delete("/api/admin/organizations/:id", adminMiddleware, async (c) => {
  const orgId = c.req.param("id");

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET org_id = NULL, org_role = NULL WHERE org_id = ?").bind(orgId),
    c.env.DB.prepare("DELETE FROM org_invites WHERE org_id = ?").bind(orgId),
    c.env.DB.prepare("DELETE FROM org_pricing WHERE org_id = ?").bind(orgId),
    c.env.DB.prepare("DELETE FROM organizations WHERE id = ?").bind(orgId),
  ]);

  return c.json({ success: true });
});

app.get("/api/admin/organizations/:id/users", adminMiddleware, async (c) => {
  const orgId = c.req.param("id");
  const { results } = await c.env.DB.prepare(
    "SELECT id, email, full_name, department, tier, org_role, last_login, created_at FROM users WHERE org_id = ? ORDER BY created_at"
  ).bind(orgId).all();
  return c.json({ users: results });
});
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: expand super admin organisation management endpoints"
```

---

## Phase 7: Org Admin Frontend

### Task 11: Create org admin HTML page

**Files:**
- Create: `public/org-admin.html`

**Step 1: Create the org admin HTML shell**

Create `public/org-admin.html` with the same structure as `admin.html` but with 8 org admin tabs: Dashboard, Members, Analytics, Knowledge Base, AI Agents, Announcements, Billing, Settings.

Include the same meta tags, CSS references, and script loading pattern as `admin.html`. Reference `css/org-admin.css` and `js/org-admin.js`.

**Step 2: Commit**

```bash
git add public/org-admin.html
git commit -m "feat: create org admin portal HTML shell"
```

---

### Task 12: Create org admin CSS

**Files:**
- Create: `public/css/org-admin.css`

**Step 1: Create org admin styles**

Base on `public/css/admin.css` with the same design system (dark theme, CSS variables, card layouts). Same tab navigation, table styles, modal styles, chart containers.

**Step 2: Commit**

```bash
git add public/css/org-admin.css
git commit -m "feat: create org admin portal CSS styles"
```

---

### Task 13: Create org admin JavaScript

**Files:**
- Create: `public/js/org-admin.js`

**Step 1: Build the org admin JS application**

Structure following the same patterns as `admin.js`:
- Auth check on load (call `/api/org-admin/verify`)
- Tab navigation with dynamic content loading
- Dashboard: stats cards + seat usage bar
- Members: paginated table with search, invite modal, remove/role-change actions
- Analytics: Chart.js charts (messages/day, active users, popular models, top users)
- Knowledge Base: document list with upload
- AI Agents: agent CRUD with system prompt editing
- Announcements: announcement CRUD
- Billing: seat usage display, plan info, discount tier, monthly total
- Settings: org name, logo URL, domain, sector form

**Step 2: Commit**

```bash
git add public/js/org-admin.js
git commit -m "feat: create org admin portal JavaScript application"
```

---

## Phase 8: Registration UI Update

### Task 14: Update registration form with individual/organisation toggle

**Files:**
- Modify: `public/index.html` (~lines 305-340, the registration form)
- Modify: `public/js/app.js` (registration logic)

**Step 1: Add registration type selector to HTML**

Before the existing form fields, add an individual/organisation toggle. When "Organisation" is selected, show additional fields: org name, org slug (auto-generated from name), sector dropdown, email domain, plan selector, seat count.

**Step 2: Update app.js registration handler**

Modify the registration submit handler to detect which path (individual vs org) and call the appropriate endpoint (`/api/auth/register` or `/api/auth/register/organisation`). For org registration, show the access code and org details on success.

**Step 3: Add org pricing display**

Show a pricing summary when the user selects a plan and seat count during org registration, including the volume discount.

**Step 4: Commit**

```bash
git add public/index.html public/js/app.js
git commit -m "feat: add organisation registration path to signup flow"
```

---

## Phase 9: Super Admin Portal Enhancement

### Task 15: Add Organisations tab to super admin portal

**Files:**
- Modify: `public/admin.html` (add Organisations tab)
- Modify: `public/js/admin.js` (add org management functionality)

**Step 1: Add Organisations tab to admin.html**

Add a new tab in the admin navigation for "Organisations" with a table listing all orgs, create/edit/delete modals, and drill-down to view org members.

**Step 2: Add org management JS to admin.js**

Add functions for: loadOrganizations, createOrganization, editOrganization, deleteOrganization, viewOrgMembers. Use the new `/api/admin/organizations` CRUD endpoints.

**Step 3: Commit**

```bash
git add public/admin.html public/js/admin.js
git commit -m "feat: add Organisations management tab to super admin portal"
```

---

## Phase 10: Data Isolation & Integration

### Task 16: Scope announcements and agents queries by org_id

**Files:**
- Modify: `src/index.ts` (user-facing announcement and agent queries)

**Step 1: Update user-facing announcement fetching**

Find where announcements are fetched for regular users and add org_id filtering: show global announcements (org_id IS NULL) plus the user's org announcements.

**Step 2: Update agent listing for users**

When listing available agents for a user, include global agents (org_id IS NULL) plus their org's agents.

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: scope announcements and agents by org_id for data isolation"
```

---

### Task 17: Update effective tier resolution to include org sponsorship

**Files:**
- Modify: `src/index.ts` (where getEffectiveTier is called)

**Step 1: Update tier resolution calls**

Find all places where `getEffectiveTier` is called and ensure the org_sponsored_tier is passed. This requires joining the organizations table when fetching user data for tier checks.

Update the user query in the chat endpoint and other tier-checking locations to include:
```sql
SELECT u.*, o.tier as org_sponsored_tier
FROM users u LEFT JOIN organizations o ON u.org_id = o.id
WHERE u.id = ?
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: integrate org-sponsored tier into effective tier resolution"
```

---

## Phase 11: Deploy & Verify

### Task 18: Run schema migration on production D1

**Step 1: Run migration**

```bash
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-institutional.sql
```

**Step 2: Verify tables exist**

```bash
npx wrangler d1 execute ghana-civil-ai-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('org_invites', 'org_pricing')"
```

---

### Task 19: Deploy to Cloudflare Workers

**Step 1: Type check**

```bash
npx tsc --noEmit
```

**Step 2: Deploy**

```bash
npx wrangler deploy
```

**Step 3: Verify key endpoints**

```bash
curl -s https://askozzy.ghwmelite.workers.dev/api/org-admin/verify | head -1
# Expected: {"error":"Unauthorized"}

curl -s https://askozzy.ghwmelite.workers.dev/org-admin.html | head -5
# Expected: HTML content
```

---

### Task 20: Commit all and push

```bash
git add -A
git commit -m "feat: complete institutional admin & multi-tenancy implementation"
git push origin main
```

---

## Summary

| Phase | Tasks | What it builds |
|-------|-------|----------------|
| 1 | 1-2 | Schema migration + lazy migration |
| 2 | 3 | orgAdminMiddleware |
| 3 | 4 | Org pricing constants + hybrid billing |
| 4 | 5 | Org registration + invite + domain check |
| 5 | 6-9 | Org admin API (all endpoints) |
| 6 | 10 | Enhanced super admin org management |
| 7 | 11-13 | Org admin frontend (HTML/CSS/JS) |
| 8 | 14 | Registration UI individual/org toggle |
| 9 | 15 | Super admin Organisations tab |
| 10 | 16-17 | Data isolation + tier integration |
| 11 | 18-20 | Deploy + verify |
