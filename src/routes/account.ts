// User account routes: profile, dashboard, sessions, 2FA, productivity — extracted from index.ts
import { Hono } from "hono";
import type { AppType } from "../types";
import { authMiddleware, checkRateLimit } from "../lib/middleware";
import { generateId, hashPassword, generateAccessCode } from "../lib/utils";
import { log } from "../lib/logger";

const account = new Hono<AppType>();

// ─── Duplicated Helpers ──────────────────────────────────────────────

// TOTP verification helper
async function verifyTOTP(secret: string, code: string): Promise<boolean> {
  const timeStep = 30;
  const now = Math.floor(Date.now() / 1000);

  // Check current and adjacent time windows (±1 step for clock drift)
  for (const offset of [-1, 0, 1]) {
    const counter = Math.floor((now / timeStep) + offset);
    const expected = await generateTOTPCode(secret, counter);
    // Constant-time comparison to prevent timing attacks
    if (expected.length === code.length) {
      const enc = new TextEncoder();
      const a = enc.encode(expected);
      const b = enc.encode(code);
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
      if (diff === 0) return true;
    }
  }
  return false;
}

async function generateTOTPCode(secret: string, counter: number): Promise<string> {
  // Decode base32 secret
  const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.toUpperCase()) {
    const val = base32Chars.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const keyBytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < keyBytes.length; i++) {
    keyBytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }

  // Counter to 8-byte big-endian buffer
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  view.setUint32(4, counter);

  // HMAC-SHA1
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, counterBuf);
  const hmac = new Uint8Array(sig);

  // Dynamic truncation
  const offsetByte = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offsetByte] & 0x7f) << 24 |
                (hmac[offsetByte + 1] & 0xff) << 16 |
                (hmac[offsetByte + 2] & 0xff) << 8 |
                (hmac[offsetByte + 3] & 0xff)) % 1000000;

  return code.toString().padStart(6, "0");
}

// Ensure user_profiles table exists
let profileTableExists = false;
async function ensureUserProfilesTable(db: D1Database) {
  if (profileTableExists) return;
  try {
    await db.prepare("SELECT user_id FROM user_profiles LIMIT 1").first();
    profileTableExists = true;
  } catch {
    await db.prepare(`CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      writing_style TEXT DEFAULT 'formal',
      experience_level TEXT DEFAULT 'intermediate',
      preferred_language TEXT DEFAULT 'en',
      courses TEXT DEFAULT '[]',
      subjects_of_interest TEXT DEFAULT '[]',
      organization_context TEXT DEFAULT '',
      exam_target TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`).run();
    profileTableExists = true;
  }
}

// Audit logging
async function logUserAudit(c: any, actionType: string, queryPreview?: string, model?: string) {
  try {
    const userId = c.get("userId");
    const ip = c.req.header("cf-connecting-ip") || "unknown";
    const user = (await c.env.DB.prepare(
      "SELECT email, department FROM users WHERE id = ?"
    ).bind(userId).first()) as { email: string; department: string } | null;

    await c.env.DB.prepare(
      "INSERT INTO user_audit_log (user_id, user_email, department, action_type, query_preview, model_used, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      userId,
      user?.email || null,
      user?.department || null,
      actionType,
      queryPreview ? queryPreview.substring(0, 200) : null,
      model || null,
      ip
    ).run();
  } catch {
    // Audit logging must never break the main request
  }
}

// Productivity tracking
const PRODUCTIVITY_MULTIPLIERS: Record<string, { column: string; minutes: number }> = {
  chat: { column: "messages_sent", minutes: 2 },
  research: { column: "research_reports", minutes: 30 },
  analysis: { column: "analyses_run", minutes: 20 },
  vision: { column: "messages_sent", minutes: 2 },
  meeting: { column: "meetings_processed", minutes: 60 },
  workflow: { column: "workflows_completed", minutes: 45 },
  document: { column: "documents_generated", minutes: 15 },
  exam_attempt: { column: "messages_sent", minutes: 10 },
};

async function trackProductivity(c: any, statType: string) {
  try {
    const userId = c.get("userId");
    const today = new Date().toISOString().split("T")[0];
    const multiplier = PRODUCTIVITY_MULTIPLIERS[statType];
    if (!multiplier) return;

    await c.env.DB.prepare(
      `INSERT INTO productivity_stats (user_id, stat_date, ${multiplier.column}, estimated_minutes_saved)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id, stat_date) DO UPDATE SET
         ${multiplier.column} = ${multiplier.column} + 1,
         estimated_minutes_saved = estimated_minutes_saved + ?`
    ).bind(userId, today, multiplier.minutes, multiplier.minutes).run();
  } catch {
    // Productivity tracking must never break the main request
  }
}

// Subscription columns lazy migration
async function ensureSubscriptionColumns(db: D1Database) {
  try {
    await db.prepare("SELECT subscription_expires_at FROM users LIMIT 1").first();
  } catch {
    await db.batch([
      db.prepare("ALTER TABLE users ADD COLUMN subscription_expires_at TEXT DEFAULT NULL"),
      db.prepare("ALTER TABLE users ADD COLUMN billing_cycle TEXT DEFAULT 'monthly'"),
    ]);
  }
}

// Tier helpers
const TIER_RANK: Record<string, number> = { free: 0, professional: 1, enterprise: 2 };

function maxTier(a: string, b: string): string {
  return (TIER_RANK[a] || 0) >= (TIER_RANK[b] || 0) ? a : b;
}

function getEffectiveTier(user: {
  tier: string;
  subscription_expires_at: string | null;
  trial_expires_at: string | null;
  org_sponsored_tier?: string | null;
}): string {
  const now = new Date();
  // Trial: free users with active trial get professional
  if (user.trial_expires_at && new Date(user.trial_expires_at + "Z") > now
      && (!user.tier || user.tier === "free")) {
    const baseTier = "professional";
    if (user.org_sponsored_tier) return maxTier(baseTier, user.org_sponsored_tier);
    return baseTier;
  }
  // Paid tier with expiry set: check grace period (7 days)
  if (user.tier && user.tier !== "free" && user.subscription_expires_at) {
    const expiresAt = new Date(user.subscription_expires_at + "Z");
    const graceEnd = new Date(expiresAt.getTime() + 7 * 86400000);
    const personalTier = now <= graceEnd ? user.tier : "free";
    if (user.org_sponsored_tier) return maxTier(personalTier, user.org_sponsored_tier);
    return personalTier;
  }
  // Legacy paid users (no subscription_expires_at) keep access indefinitely
  const personalTier = user.tier || "free";
  if (user.org_sponsored_tier) return maxTier(personalTier, user.org_sponsored_tier);
  return personalTier;
}

// ─── User Profile ───────────────────────────────────────────────────

account.get("/api/user/profile", authMiddleware, async (c) => {
  const userId = c.get("userId");

  const user = await c.env.DB.prepare(
    "SELECT id, email, full_name, department, tier, created_at FROM users WHERE id = ?"
  )
    .bind(userId)
    .first();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ user });
});

// ─── User Usage Dashboard ─────────────────────────────────────────────

account.get("/api/user/dashboard", authMiddleware, async (c) => {
  const userId = c.get("userId");

  const totalConversations = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM conversations WHERE user_id = ?"
  ).bind(userId).first<{ count: number }>();

  const totalMessages = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.user_id = ? AND m.role = 'user'`
  ).bind(userId).first<{ count: number }>();

  const { results: messagesPerDay } = await c.env.DB.prepare(
    `SELECT date(m.created_at) as day, COUNT(*) as count
     FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.user_id = ? AND m.role = 'user' AND m.created_at >= datetime('now', '-7 days')
     GROUP BY date(m.created_at) ORDER BY day ASC`
  ).bind(userId).all<{ day: string; count: number }>();

  const { results: modelUsage } = await c.env.DB.prepare(
    `SELECT m.model, COUNT(*) as count
     FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE c.user_id = ? AND m.role = 'assistant' AND m.model IS NOT NULL
     GROUP BY m.model ORDER BY count DESC`
  ).bind(userId).all<{ model: string; count: number }>();

  const memberSince = await c.env.DB.prepare(
    "SELECT created_at FROM users WHERE id = ?"
  ).bind(userId).first<{ created_at: string }>();

  return c.json({
    totalConversations: totalConversations?.count || 0,
    totalMessages: totalMessages?.count || 0,
    messagesPerDay: messagesPerDay || [],
    modelUsage: modelUsage || [],
    memberSince: memberSince?.created_at || "",
  });
});

// ─── Session Management ───────────────────────────────────────────────

account.get("/api/user/sessions", authMiddleware, async (c) => {
  // KV doesn't support listing by prefix easily, so we return current session info
  const currentToken = c.req.header("Authorization")?.slice(7) || "";
  return c.json({
    sessions: [{
      current: true,
      created: "Active now",
      description: "Current session",
    }],
    note: "Sign out to invalidate your current session. For security, change your access code to invalidate all sessions.",
  });
});

account.post("/api/user/sessions/revoke-all", authMiddleware, async (c) => {
  const userId = c.get("userId");

  // Generate a new access code (invalidates old one, thus old sessions won't match)
  const newAccessCode = generateAccessCode();
  const newHash = await hashPassword(newAccessCode);
  await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .bind(newHash, userId).run();

  // Delete current session
  const currentToken = c.req.header("Authorization")?.slice(7) || "";
  if (currentToken) {
    await c.env.SESSIONS.delete(`session:${currentToken}`);
  }

  return c.json({ success: true, newAccessCode, message: "All sessions revoked. Save your new access code!" });
});

// ─── 2FA (TOTP) Setup ────────────────────────────────────────────────

account.post("/api/user/2fa/setup", authMiddleware, async (c) => {
  const userId = c.get("userId");

  // Generate a random secret (base32 encoded)
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let secret = "";
  for (let i = 0; i < bytes.length; i++) {
    secret += base32Chars[bytes[i] % 32];
  }

  // Store secret (not yet enabled)
  await c.env.DB.prepare("UPDATE users SET totp_secret = ? WHERE id = ?")
    .bind(secret, userId).run();

  const user = await c.env.DB.prepare("SELECT email FROM users WHERE id = ?")
    .bind(userId).first<{ email: string }>();

  // Return the secret and provisioning URI for QR code
  const uri = `otpauth://totp/AskOzzy:${user?.email}?secret=${secret}&issuer=AskOzzy&digits=6&period=30`;

  return c.json({ secret, uri });
});

account.post("/api/user/2fa/verify", authMiddleware, async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const rl = await checkRateLimit(c.env, `${ip}:2fa`, "auth");
  if (!rl.allowed) return c.json({ error: "Too many attempts. Try again later." }, 429);

  const userId = c.get("userId");
  const { code } = await c.req.json();

  const user = await c.env.DB.prepare("SELECT totp_secret FROM users WHERE id = ?")
    .bind(userId).first<{ totp_secret: string }>();

  if (!user?.totp_secret) return c.json({ error: "2FA not set up" }, 400);

  // Verify TOTP code
  const valid = await verifyTOTP(user.totp_secret, code);
  if (!valid) return c.json({ error: "Invalid code" }, 400);

  // Enable 2FA
  await c.env.DB.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?")
    .bind(userId).run();

  return c.json({ success: true, message: "2FA enabled successfully" });
});

account.post("/api/user/2fa/disable", authMiddleware, async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const rl = await checkRateLimit(c.env, `${ip}:2fa`, "auth");
  if (!rl.allowed) return c.json({ error: "Too many attempts. Try again later." }, 429);

  const userId = c.get("userId");
  const { code } = await c.req.json();

  const user = await c.env.DB.prepare("SELECT totp_secret, totp_enabled FROM users WHERE id = ?")
    .bind(userId).first<{ totp_secret: string; totp_enabled: number }>();

  if (!user?.totp_enabled) return c.json({ error: "2FA is not enabled" }, 400);

  const valid = await verifyTOTP(user.totp_secret, code);
  if (!valid) return c.json({ error: "Invalid code" }, 400);

  await c.env.DB.prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?")
    .bind(userId).run();

  return c.json({ success: true, message: "2FA disabled" });
});

// ─── Productivity Dashboard (User) ──────────────────────────────────

account.get("/api/productivity/me", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const today = new Date().toISOString().split("T")[0];

  // This week totals (Monday to today)
  const dayOfWeek = new Date().getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date();
  monday.setDate(monday.getDate() - daysToMonday);
  const mondayStr = monday.toISOString().split("T")[0];

  const weekTotals = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(messages_sent), 0) as messages_sent,
       COALESCE(SUM(documents_generated), 0) as documents_generated,
       COALESCE(SUM(research_reports), 0) as research_reports,
       COALESCE(SUM(analyses_run), 0) as analyses_run,
       COALESCE(SUM(meetings_processed), 0) as meetings_processed,
       COALESCE(SUM(workflows_completed), 0) as workflows_completed,
       COALESCE(SUM(estimated_minutes_saved), 0) as estimated_minutes_saved
     FROM productivity_stats WHERE user_id = ? AND stat_date >= ?`
  ).bind(userId, mondayStr).first<any>();

  // This month totals
  const monthStart = today.slice(0, 7) + "-01";
  const monthTotals = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(messages_sent), 0) as messages_sent,
       COALESCE(SUM(documents_generated), 0) as documents_generated,
       COALESCE(SUM(research_reports), 0) as research_reports,
       COALESCE(SUM(analyses_run), 0) as analyses_run,
       COALESCE(SUM(meetings_processed), 0) as meetings_processed,
       COALESCE(SUM(workflows_completed), 0) as workflows_completed,
       COALESCE(SUM(estimated_minutes_saved), 0) as estimated_minutes_saved
     FROM productivity_stats WHERE user_id = ? AND stat_date >= ?`
  ).bind(userId, monthStart).first<any>();

  // All-time totals
  const allTimeTotals = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(messages_sent), 0) as messages_sent,
       COALESCE(SUM(documents_generated), 0) as documents_generated,
       COALESCE(SUM(research_reports), 0) as research_reports,
       COALESCE(SUM(analyses_run), 0) as analyses_run,
       COALESCE(SUM(meetings_processed), 0) as meetings_processed,
       COALESCE(SUM(workflows_completed), 0) as workflows_completed,
       COALESCE(SUM(estimated_minutes_saved), 0) as estimated_minutes_saved
     FROM productivity_stats WHERE user_id = ?`
  ).bind(userId).first<any>();

  // Streak: consecutive days with activity working backwards from today
  const { results: activityDays } = await c.env.DB.prepare(
    `SELECT stat_date FROM productivity_stats
     WHERE user_id = ? AND (messages_sent > 0 OR documents_generated > 0 OR research_reports > 0 OR analyses_run > 0 OR meetings_processed > 0 OR workflows_completed > 0)
     ORDER BY stat_date DESC LIMIT 90`
  ).bind(userId).all<{ stat_date: string }>();

  let streak = 0;
  if (activityDays && activityDays.length > 0) {
    const dateSet = new Set(activityDays.map(d => d.stat_date));
    // Start from today or yesterday (allow for not-yet-active today)
    let cur = new Date(today);
    if (!dateSet.has(today)) {
      cur.setDate(cur.getDate() - 1);
      if (!dateSet.has(cur.toISOString().split("T")[0])) {
        cur = new Date(today); // reset so streak stays 0
      }
    }
    while (dateSet.has(cur.toISOString().split("T")[0])) {
      streak++;
      cur.setDate(cur.getDate() - 1);
    }
  }

  // Top feature
  const featureMap: Record<string, number> = {
    "Chat": allTimeTotals?.messages_sent || 0,
    "Documents": allTimeTotals?.documents_generated || 0,
    "Research": allTimeTotals?.research_reports || 0,
    "Analysis": allTimeTotals?.analyses_run || 0,
    "Meetings": allTimeTotals?.meetings_processed || 0,
    "Workflows": allTimeTotals?.workflows_completed || 0,
  };
  let topFeature = "Chat";
  let topCount = 0;
  for (const [feature, count] of Object.entries(featureMap)) {
    if (count > topCount) { topFeature = feature; topCount = count; }
  }

  // Daily usage for last 7 days (for chart)
  const { results: dailyUsage } = await c.env.DB.prepare(
    `SELECT stat_date,
       COALESCE(messages_sent, 0) as messages_sent,
       COALESCE(documents_generated, 0) as documents_generated,
       COALESCE(research_reports, 0) as research_reports,
       COALESCE(analyses_run, 0) as analyses_run,
       COALESCE(meetings_processed, 0) as meetings_processed,
       COALESCE(workflows_completed, 0) as workflows_completed,
       COALESCE(estimated_minutes_saved, 0) as estimated_minutes_saved
     FROM productivity_stats WHERE user_id = ? AND stat_date >= date('now', '-7 days')
     ORDER BY stat_date ASC`
  ).bind(userId).all<any>();

  return c.json({
    week: weekTotals || {},
    month: monthTotals || {},
    allTime: allTimeTotals || {},
    streak,
    topFeature,
    topFeatureCount: topCount,
    dailyUsage: dailyUsage || [],
  });
});

export default account;
