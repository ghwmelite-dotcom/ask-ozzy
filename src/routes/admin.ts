import { Hono } from "hono";
import type { AppType } from "../types";
import { adminMiddleware, deptAdminMiddleware } from "../lib/middleware";
import { generateId } from "../lib/utils";
import { log } from "../lib/logger";
import {
  GROUNDING_RULES, UNCERTAINTY_PROTOCOL, PROHIBITED_BEHAVIORS,
} from "../config/agent-prompts";

const admin = new Hono<AppType>();

// ═══════════════════════════════════════════════════════════════════════
// Shared helpers (duplicated from index.ts — should be extracted to a
// shared module in a future refactoring pass)
// ═══════════════════════════════════════════════════════════════════════

async function logAudit(db: D1Database, adminId: string, action: string, targetType: string, targetId?: string, details?: string) {
  await db.prepare(
    "INSERT INTO audit_log (id, admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(generateId(), adminId, action, targetType, targetId || null, details || null).run();
}

let referralSourceColExists = false;
async function ensureReferralSourceColumn(db: D1Database) {
  if (referralSourceColExists) return;
  try {
    await db.prepare("SELECT referral_source FROM users LIMIT 1").first();
    referralSourceColExists = true;
  } catch {
    await db.batch([
      db.prepare("ALTER TABLE users ADD COLUMN referral_source TEXT DEFAULT 'organic'"),
      db.prepare("ALTER TABLE users ADD COLUMN submitted_referral_code TEXT DEFAULT NULL"),
    ]);
    referralSourceColExists = true;
  }
}

let examTablesExist = false;
async function ensureExamTables(db: D1Database) {
  if (examTablesExist) return;
  try {
    await db.prepare("SELECT id FROM exam_questions LIMIT 1").first();
    examTablesExist = true;
  } catch {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS exam_questions (
        id TEXT PRIMARY KEY,
        exam_type TEXT NOT NULL CHECK(exam_type IN ('wassce', 'bece')),
        subject TEXT NOT NULL,
        year INTEGER NOT NULL,
        paper TEXT DEFAULT '1',
        question_number INTEGER NOT NULL,
        question_text TEXT NOT NULL,
        marking_scheme TEXT DEFAULT '',
        marks INTEGER DEFAULT 0,
        difficulty TEXT DEFAULT 'medium' CHECK(difficulty IN ('easy', 'medium', 'hard')),
        topic TEXT DEFAULT '',
        vector_id TEXT DEFAULT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(exam_type, subject, year, paper, question_number)
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_exam_q_subject ON exam_questions(exam_type, subject, year)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS exam_attempts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        question_id TEXT,
        exam_type TEXT NOT NULL,
        subject TEXT NOT NULL,
        question_text TEXT NOT NULL,
        student_answer TEXT NOT NULL,
        ai_feedback TEXT DEFAULT '',
        score_content INTEGER DEFAULT 0,
        score_organization INTEGER DEFAULT 0,
        score_expression INTEGER DEFAULT 0,
        score_accuracy INTEGER DEFAULT 0,
        total_score INTEGER DEFAULT 0,
        max_score INTEGER DEFAULT 0,
        time_spent_seconds INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_exam_attempts_user ON exam_attempts(user_id, subject, created_at DESC)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS exam_seasons (
        id TEXT PRIMARY KEY,
        exam_type TEXT NOT NULL,
        year INTEGER NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(exam_type, year)
      )`),
    ]);
    examTablesExist = true;
  }
}

async function ensureAgentUserTypeColumn(db: D1Database) {
  try {
    await db.prepare("SELECT user_type FROM agents LIMIT 1").first();
  } catch {
    await db.prepare("ALTER TABLE agents ADD COLUMN user_type TEXT DEFAULT 'all'").run();
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES — Lines 3294-3503 from index.ts
//  Bootstrap, verify, dashboard, users (CRUD, tier, role, status, delete)
// ═══════════════════════════════════════════════════════════════════════

admin.post("/api/admin/bootstrap", async (c) => {
  const { email, secret } = await c.req.json();
  if (!email) return c.json({ error: "Email is required" }, 400);

  if (!c.env.BOOTSTRAP_SECRET) {
    return c.json({ error: "BOOTSTRAP_SECRET not configured" }, 500);
  }
  if (secret !== c.env.BOOTSTRAP_SECRET) {
    return c.json({ error: "Invalid bootstrap secret" }, 403);
  }

  const existing = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM users WHERE role = 'super_admin'"
  ).first<{ count: number }>();

  if (existing && existing.count > 0) {
    return c.json({ error: "Bootstrap disabled: admin(s) already exist" }, 403);
  }

  const user = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email.toLowerCase().trim())
    .first<{ id: string }>();

  if (!user) return c.json({ error: "User not found" }, 404);

  await c.env.DB.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?")
    .bind(user.id)
    .run();

  return c.json({ success: true, message: `${email} is now a super admin` });
});

// Verify admin status (page load check)
admin.get("/api/admin/verify", adminMiddleware, async (c) => {
  const userId = c.get("userId");
  const user = await c.env.DB.prepare(
    "SELECT id, email, full_name, role FROM users WHERE id = ?"
  )
    .bind(userId)
    .first();
  return c.json({ admin: true, user });
});

// Dashboard stats
admin.get("/api/admin/dashboard", adminMiddleware, async (c) => {
  const totalUsers = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM users"
  ).first<{ count: number }>();

  const today = new Date().toISOString().split("T")[0];
  const usersToday = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM users WHERE date(created_at) = ?"
  ).bind(today).first<{ count: number }>();

  const totalConversations = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM conversations"
  ).first<{ count: number }>();

  const messagesToday = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM messages WHERE date(created_at) = ?"
  ).bind(today).first<{ count: number }>();

  const active24h = await c.env.DB.prepare(
    "SELECT COUNT(DISTINCT user_id) as count FROM conversations WHERE updated_at >= datetime('now', '-1 day')"
  ).first<{ count: number }>();

  const { results: tierDist } = await c.env.DB.prepare(
    "SELECT tier, COUNT(*) as count FROM users GROUP BY tier"
  ).all<{ tier: string; count: number }>();

  const { results: recentSignups } = await c.env.DB.prepare(
    "SELECT id, email, full_name, department, tier, role, created_at FROM users ORDER BY created_at DESC LIMIT 10"
  ).all();

  return c.json({
    totalUsers: totalUsers?.count || 0,
    usersToday: usersToday?.count || 0,
    totalConversations: totalConversations?.count || 0,
    messagesToday: messagesToday?.count || 0,
    active24h: active24h?.count || 0,
    tierDistribution: tierDist || [],
    recentSignups: recentSignups || [],
  });
});

// Paginated user list with search
admin.get("/api/admin/users", adminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const search = c.req.query("search") || "";
  const offset = (page - 1) * limit;

  const countQuery = "SELECT COUNT(*) as count FROM users";
  const dataQuery = "SELECT id, email, full_name, department, role, tier, status, affiliate_tier, total_referrals, affiliate_earnings, created_at, last_login FROM users";

  if (search) {
    const where = " WHERE email LIKE ? OR full_name LIKE ?";
    const searchParam = `%${search}%`;
    const total = await c.env.DB.prepare(countQuery + where)
      .bind(searchParam, searchParam)
      .first<{ count: number }>();
    const { results } = await c.env.DB.prepare(dataQuery + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .bind(searchParam, searchParam, limit, offset)
      .all();
    return c.json({ users: results || [], total: total?.count || 0, page, limit });
  }

  const total = await c.env.DB.prepare(countQuery).first<{ count: number }>();
  const { results } = await c.env.DB.prepare(dataQuery + " ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .bind(limit, offset)
    .all();
  return c.json({ users: results || [], total: total?.count || 0, page, limit });
});

// Change user tier
admin.patch("/api/admin/users/:id/tier", adminMiddleware, async (c) => {
  const id = c.req.param("id");
  const { tier } = await c.req.json();
  const validTiers = ["free", "professional", "enterprise"];
  if (!validTiers.includes(tier)) {
    return c.json({ error: "Invalid tier. Must be: " + validTiers.join(", ") }, 400);
  }
  await c.env.DB.prepare("UPDATE users SET tier = ? WHERE id = ?").bind(tier, id).run();
  return c.json({ success: true });
});

// Change user role
admin.patch("/api/admin/users/:id/role", adminMiddleware, async (c) => {
  const id = c.req.param("id");
  const adminId = c.get("userId");
  if (id === adminId) {
    return c.json({ error: "Cannot change your own role" }, 400);
  }
  const { role } = await c.req.json();
  const validRoles = ["civil_servant", "dept_admin", "super_admin"];
  if (!validRoles.includes(role)) {
    return c.json({ error: "Invalid role. Must be: " + validRoles.join(", ") }, 400);
  }
  await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return c.json({ success: true });
});

// Activate or deactivate user
admin.patch("/api/admin/users/:id/status", adminMiddleware, async (c) => {
  const id = c.req.param("id");
  const adminId = c.get("userId");
  if (id === adminId) {
    return c.json({ error: "Cannot change your own status" }, 400);
  }
  const { status } = await c.req.json();
  const validStatuses = ["active", "deactivated"];
  if (!validStatuses.includes(status)) {
    return c.json({ error: "Invalid status. Must be: active or deactivated" }, 400);
  }
  await c.env.DB.prepare("UPDATE users SET status = ? WHERE id = ?").bind(status, id).run();
  // Log to audit trail
  const user = await c.env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(id).first();
  try {
    await c.env.DB.prepare(
      "INSERT INTO user_audit_log (id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
    ).bind(crypto.randomUUID(), id, status === "active" ? "account_activated" : "account_deactivated", `Admin action on ${user?.email || id}`).run();
  } catch {}
  return c.json({ success: true, status });
});

// Delete user + all data (comprehensive cascade)
admin.delete("/api/admin/users/:id", adminMiddleware, async (c) => {
  const id = c.req.param("id");
  const adminId = c.get("userId");
  if (id === adminId) {
    return c.json({ error: "Cannot delete your own account" }, 400);
  }
  const db = c.env.DB;
  // Cascade delete all user data — each wrapped in try/catch in case table doesn't exist
  const deletes: Array<{ sql: string; binds: string[] }> = [
    { sql: "DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)", binds: [id] },
    { sql: "DELETE FROM message_ratings WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM conversations WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM folders WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM user_memories WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM usage_log WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM referrals WHERE referrer_id = ? OR referred_id = ?", binds: [id, id] },
    { sql: "DELETE FROM push_subscriptions WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM webauthn_credentials WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM moderation_flags WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM research_reports WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM workflows WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM meetings WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM space_members WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM affiliate_transactions WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM withdrawal_requests WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM affiliate_wallets WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM productivity_stats WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM user_audit_log WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM ussd_sessions WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM user_profiles WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM document_credits WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM document_credit_transactions WHERE user_id = ?", binds: [id] },
    { sql: "DELETE FROM exam_attempts WHERE user_id = ?", binds: [id] },
  ];
  for (const del of deletes) {
    try { await db.prepare(del.sql).bind(...del.binds).run(); } catch {}
  }
  // Delete user record
  await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES — Lines 3503-3582 from index.ts
//  Conversations (list, messages, delete), analytics
// ═══════════════════════════════════════════════════════════════════════

// All conversations with user info + message counts
admin.get("/api/admin/conversations", adminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = (page - 1) * limit;

  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM conversations"
  ).first<{ count: number }>();

  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.title, c.model, c.created_at, c.updated_at,
            u.email as user_email, u.full_name as user_name,
            (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
     FROM conversations c
     JOIN users u ON u.id = c.user_id
     ORDER BY c.updated_at DESC
     LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  return c.json({ conversations: results || [], total: total?.count || 0, page, limit });
});

// View messages in any conversation (admin)
admin.get("/api/admin/conversations/:id/messages", adminMiddleware, async (c) => {
  const convoId = c.req.param("id");
  const convo = await c.env.DB.prepare(
    "SELECT c.title, u.full_name as user_name, u.email as user_email FROM conversations c JOIN users u ON u.id = c.user_id WHERE c.id = ?"
  ).bind(convoId).first();

  if (!convo) return c.json({ error: "Conversation not found" }, 404);

  const { results } = await c.env.DB.prepare(
    "SELECT id, role, content, model, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
  ).bind(convoId).all();

  return c.json({ conversation: convo, messages: results || [] });
});

// Delete any conversation (admin)
admin.delete("/api/admin/conversations/:id", adminMiddleware, async (c) => {
  const convoId = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM messages WHERE conversation_id = ?").bind(convoId).run();
  await c.env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(convoId).run();
  return c.json({ success: true });
});

// Analytics: messages/day, signups/day (7 days), model usage, top users
admin.get("/api/admin/analytics", adminMiddleware, async (c) => {
  const { results: messagesPerDay } = await c.env.DB.prepare(
    "SELECT date(created_at) as day, COUNT(*) as count FROM messages WHERE created_at >= datetime('now', '-7 days') GROUP BY date(created_at) ORDER BY day ASC"
  ).all<{ day: string; count: number }>();

  const { results: signupsPerDay } = await c.env.DB.prepare(
    "SELECT date(created_at) as day, COUNT(*) as count FROM users WHERE created_at >= datetime('now', '-7 days') GROUP BY date(created_at) ORDER BY day ASC"
  ).all<{ day: string; count: number }>();

  const { results: modelUsage } = await c.env.DB.prepare(
    "SELECT model, COUNT(*) as count FROM messages WHERE role = 'assistant' AND model IS NOT NULL GROUP BY model ORDER BY count DESC"
  ).all<{ model: string; count: number }>();

  const { results: topUsers } = await c.env.DB.prepare(
    `SELECT u.full_name, u.email, COUNT(m.id) as message_count
     FROM users u
     JOIN conversations c ON c.user_id = u.id
     JOIN messages m ON m.conversation_id = c.id AND m.role = 'user'
     GROUP BY u.id
     ORDER BY message_count DESC
     LIMIT 10`
  ).all<{ full_name: string; email: string; message_count: number }>();

  return c.json({
    messagesPerDay: messagesPerDay || [],
    signupsPerDay: signupsPerDay || [],
    modelUsage: modelUsage || [],
    topUsers: topUsers || [],
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES — Lines 3582-3849 from index.ts
//  Referrals, promote
// ═══════════════════════════════════════════════════════════════════════

// Referrals overview
admin.get("/api/admin/referrals", adminMiddleware, async (c) => {
  await ensureReferralSourceColumn(c.env.DB);

  const totalReferrals = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM referrals"
  ).first<{ count: number }>();

  const totalEarnings = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(bonus_amount), 0) as total FROM referrals"
  ).first<{ total: number }>();

  // Breakdown by referral source
  const affiliateSignups = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM users WHERE referral_source = 'affiliate'"
  ).first<{ count: number }>();

  const systemSignups = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM users WHERE referral_source = 'system'"
  ).first<{ count: number }>();

  const organicSignups = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM users WHERE referral_source = 'organic' OR referral_source IS NULL"
  ).first<{ count: number }>();

  const { results: topReferrers } = await c.env.DB.prepare(
    `SELECT u.full_name, u.email, u.total_referrals, u.affiliate_earnings, u.affiliate_tier
     FROM users u
     WHERE u.total_referrals > 0
     ORDER BY u.total_referrals DESC
     LIMIT 15`
  ).all();

  const { results: recentReferrals } = await c.env.DB.prepare(
    `SELECT r.created_at, r.bonus_amount, r.status,
            referrer.full_name as referrer_name, referrer.email as referrer_email,
            referred.full_name as referred_name, referred.email as referred_email,
            referred.referral_source as source
     FROM referrals r
     JOIN users referrer ON referrer.id = r.referrer_id
     JOIN users referred ON referred.id = r.referred_id
     ORDER BY r.created_at DESC
     LIMIT 20`
  ).all();

  return c.json({
    totalReferrals: totalReferrals?.count || 0,
    totalEarnings: totalEarnings?.total || 0,
    topReferrers: topReferrers || [],
    recentReferrals: recentReferrals || [],
    sourceBreakdown: {
      affiliate: affiliateSignups?.count || 0,
      system: systemSignups?.count || 0,
      organic: organicSignups?.count || 0,
    },
  });
});

// Quick-promote user to admin by email
admin.post("/api/admin/promote", adminMiddleware, async (c) => {
  const { email } = await c.req.json();
  if (!email) return c.json({ error: "Email is required" }, 400);

  const user = await c.env.DB.prepare(
    "SELECT id, role FROM users WHERE email = ?"
  ).bind(email.toLowerCase().trim()).first<{ id: string; role: string }>();

  if (!user) return c.json({ error: "User not found" }, 404);
  if (user.role === "super_admin") {
    return c.json({ error: "User is already a super admin" }, 400);
  }

  await c.env.DB.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?")
    .bind(user.id)
    .run();

  await logAudit(c.env.DB, c.get("userId"), "promote_admin", "user", user.id, email);
  return c.json({ success: true, message: `${email} promoted to super admin` });
});

// ═══════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES — Lines 3849-3914 from index.ts
//  Productivity dashboard (admin)
// ═══════════════════════════════════════════════════════════════════════

admin.get("/api/admin/productivity", adminMiddleware, async (c) => {
  // Per-department aggregates
  const { results: deptStats } = await c.env.DB.prepare(
    `SELECT u.department,
       COUNT(DISTINCT p.user_id) as user_count,
       COALESCE(SUM(p.messages_sent), 0) as messages_sent,
       COALESCE(SUM(p.documents_generated), 0) as documents_generated,
       COALESCE(SUM(p.research_reports), 0) as research_reports,
       COALESCE(SUM(p.analyses_run), 0) as analyses_run,
       COALESCE(SUM(p.meetings_processed), 0) as meetings_processed,
       COALESCE(SUM(p.workflows_completed), 0) as workflows_completed,
       COALESCE(SUM(p.estimated_minutes_saved), 0) as estimated_minutes_saved
     FROM productivity_stats p
     JOIN users u ON u.id = p.user_id
     GROUP BY u.department
     ORDER BY estimated_minutes_saved DESC`
  ).all<any>();

  // Top 10 users by time saved
  const { results: topUsers } = await c.env.DB.prepare(
    `SELECT u.full_name, u.department, u.email,
       COALESCE(SUM(p.messages_sent), 0) as messages_sent,
       COALESCE(SUM(p.estimated_minutes_saved), 0) as estimated_minutes_saved
     FROM productivity_stats p
     JOIN users u ON u.id = p.user_id
     GROUP BY p.user_id
     ORDER BY estimated_minutes_saved DESC
     LIMIT 10`
  ).all<any>();

  // Daily totals for last 30 days
  const { results: dailyTotals } = await c.env.DB.prepare(
    `SELECT stat_date,
       COALESCE(SUM(messages_sent), 0) as messages_sent,
       COALESCE(SUM(documents_generated), 0) as documents_generated,
       COALESCE(SUM(research_reports), 0) as research_reports,
       COALESCE(SUM(analyses_run), 0) as analyses_run,
       COALESCE(SUM(meetings_processed), 0) as meetings_processed,
       COALESCE(SUM(workflows_completed), 0) as workflows_completed,
       COALESCE(SUM(estimated_minutes_saved), 0) as estimated_minutes_saved
     FROM productivity_stats
     WHERE stat_date >= date('now', '-30 days')
     GROUP BY stat_date
     ORDER BY stat_date ASC`
  ).all<any>();

  // Overall totals
  const overallTotals = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(messages_sent), 0) as messages_sent,
       COALESCE(SUM(documents_generated), 0) as documents_generated,
       COALESCE(SUM(research_reports), 0) as research_reports,
       COALESCE(SUM(analyses_run), 0) as analyses_run,
       COALESCE(SUM(meetings_processed), 0) as meetings_processed,
       COALESCE(SUM(workflows_completed), 0) as workflows_completed,
       COALESCE(SUM(estimated_minutes_saved), 0) as estimated_minutes_saved
     FROM productivity_stats`
  ).first<any>();

  return c.json({
    departments: deptStats || [],
    topUsers: topUsers || [],
    dailyTotals: dailyTotals || [],
    overall: overallTotals || {},
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES — Lines 4154-4160 from index.ts
//  User memories
// ═══════════════════════════════════════════════════════════════════════

admin.get("/api/admin/users/:id/memories", adminMiddleware, async (c) => {
  const targetUserId = c.req.param("id");
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM user_memories WHERE user_id = ? ORDER BY updated_at DESC"
  ).bind(targetUserId).all();
  return c.json({ memories: results || [] });
});

// ═══════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES — Lines 4585-4720 from index.ts
//  Exam prep (questions, stats, season)
// ═══════════════════════════════════════════════════════════════════════

admin.post("/api/admin/exam-prep/questions", adminMiddleware, async (c) => {
  await ensureExamTables(c.env.DB);
  const { questions } = await c.req.json();

  if (!Array.isArray(questions) || questions.length === 0) {
    return c.json({ error: "Questions array is required" }, 400);
  }

  let imported = 0;
  let skipped = 0;

  for (const q of questions.slice(0, 500)) {
    if (!q.examType || !q.subject || !q.year || !q.questionNumber || !q.questionText) {
      skipped++;
      continue;
    }
    try {
      const id = generateId();
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO exam_questions (id, exam_type, subject, year, paper, question_number, question_text, marking_scheme, marks, difficulty, topic)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        q.examType === "bece" ? "bece" : "wassce",
        String(q.subject).substring(0, 200),
        parseInt(q.year),
        String(q.paper || "1").substring(0, 10),
        parseInt(q.questionNumber),
        String(q.questionText).substring(0, 5000),
        String(q.markingScheme || "").substring(0, 5000),
        parseInt(q.marks) || 0,
        ["easy", "medium", "hard"].includes(q.difficulty) ? q.difficulty : "medium",
        String(q.topic || "").substring(0, 200),
      ).run();
      imported++;
    } catch {
      skipped++;
    }
  }

  return c.json({ success: true, imported, skipped });
});

admin.get("/api/admin/exam-prep/stats", adminMiddleware, async (c) => {
  await ensureExamTables(c.env.DB);

  const totalQuestions = await c.env.DB.prepare("SELECT COUNT(*) as count FROM exam_questions").first<{ count: number }>();
  const totalAttempts = await c.env.DB.prepare("SELECT COUNT(*) as count FROM exam_attempts").first<{ count: number }>();
  const avgScore = await c.env.DB.prepare("SELECT AVG(total_score) as avg FROM exam_attempts").first<{ avg: number }>();

  const { results: popular } = await c.env.DB.prepare(
    "SELECT subject, COUNT(*) as attempts FROM exam_attempts GROUP BY subject ORDER BY attempts DESC LIMIT 10"
  ).all();

  const { results: seasons } = await c.env.DB.prepare(
    "SELECT * FROM exam_seasons ORDER BY year DESC LIMIT 5"
  ).all();

  return c.json({
    totalQuestions: totalQuestions?.count || 0,
    totalAttempts: totalAttempts?.count || 0,
    avgScore: Math.round((avgScore?.avg || 0) * 10) / 10,
    popularSubjects: popular || [],
    seasons: seasons || [],
  });
});

admin.post("/api/admin/exam-prep/season", adminMiddleware, async (c) => {
  await ensureExamTables(c.env.DB);
  const { examType, year, startDate, endDate, active } = await c.req.json();

  if (!examType || !year || !startDate || !endDate) {
    return c.json({ error: "All fields are required" }, 400);
  }

  const id = generateId();
  await c.env.DB.prepare(
    `INSERT INTO exam_seasons (id, exam_type, year, start_date, end_date, active)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(exam_type, year) DO UPDATE SET start_date = ?, end_date = ?, active = ?`
  ).bind(id, examType, parseInt(year), startDate, endDate, active ? 1 : 0, startDate, endDate, active ? 1 : 0).run();

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES — Lines 4721-4971 from index.ts
//  Agents (create, update, delete, list, seed)
// ═══════════════════════════════════════════════════════════════════════

admin.post("/api/admin/agents", adminMiddleware, async (c) => {
  const adminId = c.get("userId");
  const { name, description, system_prompt, department, knowledge_category, icon, user_type, requires_paid } = await c.req.json();

  if (!name || !system_prompt) {
    return c.json({ error: "Name and system_prompt are required" }, 400);
  }

  const validUserTypes = ["gog_employee", "student", "all"];
  const agentUserType = validUserTypes.includes(user_type) ? user_type : "all";
  const agentRequiresPaid = requires_paid ? 1 : 0;

  const id = generateId();
  await c.env.DB.prepare(
    "INSERT INTO agents (id, name, description, system_prompt, department, knowledge_category, icon, created_by, user_type, requires_paid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, name, description || "", system_prompt, department || "", knowledge_category || "", icon || "\u{1F916}", adminId, agentUserType, agentRequiresPaid).run();

  const agent = await c.env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(id).first();
  await logAudit(c.env.DB, adminId, "create_agent", "agent", id, name);

  return c.json({ agent });
});

admin.patch("/api/admin/agents/:id", adminMiddleware, async (c) => {
  const adminId = c.get("userId");
  const agentId = c.req.param("id");
  const body = await c.req.json();

  const updates: string[] = [];
  const params: any[] = [];

  if (body.name !== undefined) { updates.push("name = ?"); params.push(body.name); }
  if (body.description !== undefined) { updates.push("description = ?"); params.push(body.description); }
  if (body.system_prompt !== undefined) { updates.push("system_prompt = ?"); params.push(body.system_prompt); }
  if (body.department !== undefined) { updates.push("department = ?"); params.push(body.department); }
  if (body.knowledge_category !== undefined) { updates.push("knowledge_category = ?"); params.push(body.knowledge_category); }
  if (body.icon !== undefined) { updates.push("icon = ?"); params.push(body.icon); }
  if (body.active !== undefined) { updates.push("active = ?"); params.push(body.active ? 1 : 0); }
  if (body.user_type !== undefined) { updates.push("user_type = ?"); params.push(body.user_type); }
  if (body.requires_paid !== undefined) { updates.push("requires_paid = ?"); params.push(body.requires_paid ? 1 : 0); }

  if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

  updates.push("updated_at = datetime('now')");
  params.push(agentId);

  await c.env.DB.prepare(
    `UPDATE agents SET ${updates.join(", ")} WHERE id = ?`
  ).bind(...params).run();

  const agent = await c.env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(agentId).first();
  await logAudit(c.env.DB, adminId, "update_agent", "agent", agentId, body.name || "");

  return c.json({ agent });
});

admin.delete("/api/admin/agents/:id", adminMiddleware, async (c) => {
  const adminId = c.get("userId");
  const agentId = c.req.param("id");

  const agent = await c.env.DB.prepare("SELECT name FROM agents WHERE id = ?")
    .bind(agentId).first<{ name: string }>();

  await c.env.DB.prepare("DELETE FROM agents WHERE id = ?").bind(agentId).run();
  await logAudit(c.env.DB, adminId, "delete_agent", "agent", agentId, agent?.name || "");

  return c.json({ success: true });
});

admin.get("/api/admin/agents", adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM agents ORDER BY created_at DESC"
  ).all();
  return c.json({ agents: results || [] });
});

// ─── Seed Default Agents ─────────────────────────────────────────────

admin.post("/api/admin/seed-agents", adminMiddleware, async (c) => {
  await ensureAgentUserTypeColumn(c.env.DB);
  const adminId = c.get("userId");

  const defaultAgents = [
    {
      name: "Procurement Specialist",
      description: "Expert guidance on Ghana Public Procurement Act (Act 663), tendering, and compliance",
      system_prompt: `You are the AskOzzy Procurement Specialist, serving Ghana's civil servants and public institutions under the framework of the Public Procurement Act (Act 663) as amended by Act 914. You help procurement officers understand thresholds, tender procedures, sole-source justifications, evaluation criteria, and compliance requirements. When questions require formal legal interpretation or binding decisions, recommend consulting the Public Procurement Authority (ppaghana.org) or a legal officer.\n\n${GROUNDING_RULES}\n\n${UNCERTAINTY_PROTOCOL}\n\n${PROHIBITED_BEHAVIORS}`,
      department: "Procurement",
      icon: "\u{1F4DC}",
      user_type: "gog_employee",
      knowledge_category: "procurement",
      requires_paid: 0
    },
    {
      name: "IT Helpdesk",
      description: "Technical support for GIFMIS, email, network, and government IT systems",
      system_prompt: `You are AskOzzy's IT Helpdesk specialist for Government of Ghana operations. You help civil servants troubleshoot GIFMIS, government email systems, network connectivity, VPN access, printers, Microsoft Office, and general IT support. You provide clear step-by-step troubleshooting. For complex infrastructure issues, recommend contacting NITA or the department IT officer.\n\n${GROUNDING_RULES}\n\n${UNCERTAINTY_PROTOCOL}\n\n${PROHIBITED_BEHAVIORS}`,
      department: "IT",
      icon: "\u{1F527}",
      user_type: "gog_employee",
      knowledge_category: "it",
      requires_paid: 0
    },
    {
      name: "HR & Admin Officer",
      description: "Civil Service regulations, promotions, leave, pensions, and HR procedures",
      system_prompt: `You are AskOzzy's HR & Administrative Officer for the Ghana Civil Service. You are expert in the Civil Service Act (PNDCL 327), Labour Act 2003 (Act 651), National Pensions Act 2008 (Act 766), and OHCS regulations. You help with promotions, leave, disciplinary procedures, pension calculations (3-tier scheme), appraisals, transfers, and general HR administration. For binding HR decisions, always recommend consulting the Office of the Head of Civil Service (ohcs.gov.gh).\n\n${GROUNDING_RULES}\n\n${UNCERTAINTY_PROTOCOL}\n\n${PROHIBITED_BEHAVIORS}`,
      department: "HR & Admin",
      icon: "\u{1F465}",
      user_type: "gog_employee",
      knowledge_category: "hr",
      requires_paid: 0
    },
    {
      name: "Study Coach",
      description: "Personalised study plans, motivation, and effective learning strategies",
      system_prompt: `You are AskOzzy's Study Coach for Ghanaian students. You help create personalised study timetables, recommend effective study techniques (active recall, spaced repetition, Pomodoro, mind mapping), provide motivation and accountability, and help manage exam stress. You understand the Ghana academic calendar, WASSCE/BECE schedules, and university semester systems. Be encouraging, practical, and culturally aware.\n\n${GROUNDING_RULES}\n\n${UNCERTAINTY_PROTOCOL}\n\n${PROHIBITED_BEHAVIORS}`,
      department: "Academic Support",
      icon: "\u{1F4DA}",
      user_type: "student",
      knowledge_category: "",
      requires_paid: 0
    },
    {
      name: "Essay Writing Tutor",
      description: "Structure, argumentation, and grammar coaching for academic essays",
      system_prompt: `You are AskOzzy's Essay Writing Tutor for Ghanaian students. You help with essay planning, thesis statements, paragraph structure, argumentation, transitions, conclusions, and grammar. You teach the difference between argumentative, expository, narrative, and descriptive essays. For WASSCE English essays, focus on WAEC marking criteria: content, organisation, expression, and mechanical accuracy. Encourage original thinking and proper citation (APA 7th edition).\n\n${GROUNDING_RULES}\n\n${UNCERTAINTY_PROTOCOL}\n\n${PROHIBITED_BEHAVIORS}`,
      department: "Academic Support",
      icon: "\u{270D}\u{FE0F}",
      user_type: "student",
      knowledge_category: "",
      requires_paid: 0
    },
    {
      name: "WASSCE Prep",
      description: "Subject revision, past questions, and exam strategies for WASSCE/BECE",
      system_prompt: `You are AskOzzy's WASSCE Preparation Tutor, specializing in SHS-level subjects including Core Mathematics, English Language, Integrated Science, and elective subjects. Your responses are grounded in WAEC Ghana's official syllabuses, past paper questions, and published marking schemes. When explaining concepts, use the Socratic approach: concept \u2192 worked example \u2192 student practice. For marking standards, always reference the specific marking scheme year to avoid outdating.\n\n${GROUNDING_RULES}\n\n${UNCERTAINTY_PROTOCOL}\n\n${PROHIBITED_BEHAVIORS}`,
      department: "Exam Preparation",
      icon: "\u{1F393}",
      user_type: "student",
      knowledge_category: "",
      requires_paid: 0
    },
    {
      name: "Research Assistant",
      description: "Literature review, citations, methodology guidance, and thesis support",
      system_prompt: `You are AskOzzy's Research Assistant for Ghanaian university students. You help with research proposals, literature reviews, methodology design (qualitative, quantitative, mixed methods), data analysis approaches, APA 7th edition citations, and thesis writing. You understand Ghana university thesis formats and guide students through research ethics, sampling techniques, questionnaire design, and academic writing conventions.\n\n${GROUNDING_RULES}\n\n${UNCERTAINTY_PROTOCOL}\n\n${PROHIBITED_BEHAVIORS}`,
      department: "Research",
      icon: "\u{1F52C}",
      user_type: "student",
      knowledge_category: "",
      requires_paid: 0
    },
    {
      name: "Memo & Correspondence Officer",
      description: "Draft official memos, letters, circulars, and inter-departmental correspondence following GoG standards",
      system_prompt: `You are AskOzzy's Memo & Correspondence Officer for the Government of Ghana. You draft official memos, letters, circulars, directives, and inter-departmental correspondence following the Ghana Civil Service house style. You know the hierarchy of government communications, proper reference numbering (MDA ACRONYM/VOL.X/123), salutations, subject lines, and sign-off protocols. You ensure correspondence adheres to the Official Secrets Act and proper classification markings.\n\n${GROUNDING_RULES}\n\n${UNCERTAINTY_PROTOCOL}\n\n${PROHIBITED_BEHAVIORS}`,
      department: "Administration",
      icon: "\u2709\uFE0F",
      user_type: "gog_employee",
      knowledge_category: "governance",
      requires_paid: 1
    },
    {
      name: "Budget & Finance Analyst",
      description: "Budget preparation, expenditure tracking, GIFMIS support, and financial compliance guidance",
      system_prompt: `You are AskOzzy's Budget & Finance Analyst for the Government of Ghana. You are deeply knowledgeable about the Public Financial Management Act 2016 (Act 921), Financial Administration Act 2003 (Act 654), and Internal Audit Agency Act 2003 (Act 658). You help with budget preparation using programme-based budgeting (PBB), expenditure tracking, GIFMIS operations, financial reporting, and CAGD compliance. For binding financial decisions, recommend consulting the Ministry of Finance (mofep.gov.gh).\n\n${GROUNDING_RULES}\n\n${UNCERTAINTY_PROTOCOL}\n\n${PROHIBITED_BEHAVIORS}`,
      department: "Finance",
      icon: "\u{1F4B0}",
      user_type: "gog_employee",
      knowledge_category: "finance",
      requires_paid: 1
    },
    {
      name: "Legal Compliance Advisor",
      description: "Legal opinions, regulatory compliance, contract review, and interpretation of Ghana statutes",
      system_prompt: `You are AskOzzy's Legal Compliance Advisor, helping civil servants understand Ghana's constitutional provisions, statutory requirements, and regulatory obligations. Your knowledge covers the 1992 Constitution, Civil Service Act (PNDCL 327), Data Protection Act 843, Contracts Act (Act 25), Interpretation Act (Act 792), and related legislation. You provide regulatory information \u2014 not legal advice. For binding legal decisions, always recommend a licensed Ghanaian solicitor or the Attorney-General's Department.\n\n${GROUNDING_RULES}\n\n${UNCERTAINTY_PROTOCOL}\n\n${PROHIBITED_BEHAVIORS}`,
      department: "Legal",
      icon: "\u2696\uFE0F",
      user_type: "gog_employee",
      knowledge_category: "legal",
      requires_paid: 1
    },
    {
      name: "Meeting Minutes Secretary",
      description: "Record, format, and distribute professional meeting minutes with action items and follow-ups",
      system_prompt: `You are AskOzzy's Meeting Minutes Secretary for the Government of Ghana. You record, format, and produce professional minutes for departmental meetings, management committee meetings, board meetings, and inter-agency meetings. You structure minutes with: attendance/apologies, confirmation of previous minutes, matters arising, agenda items, decisions taken, action items with responsible persons and deadlines, and date of next meeting. You follow GoG Civil Service house style.\n\n${GROUNDING_RULES}\n\n${UNCERTAINTY_PROTOCOL}\n\n${PROHIBITED_BEHAVIORS}`,
      department: "Administration",
      icon: "\u{1F4CB}",
      user_type: "gog_employee",
      knowledge_category: "governance",
      requires_paid: 1
    },
    {
      name: "Report Writer",
      description: "Structure and draft professional reports, policy briefs, and analytical documents for government use",
      system_prompt: `You are AskOzzy's Report Writer for the Government of Ghana. You structure and draft professional reports including annual reports, quarterly performance reports, policy briefs, cabinet memoranda, SITREPs, and project completion reports. You follow GoG report formatting standards with executive summaries, methodology, findings, analysis, recommendations, and appendices. You reference the CPESDP and sector medium-term development plans.\n\n${GROUNDING_RULES}\n\n${UNCERTAINTY_PROTOCOL}\n\n${PROHIBITED_BEHAVIORS}`,
      department: "Planning",
      icon: "\u{1F4CA}",
      user_type: "gog_employee",
      knowledge_category: "general",
      requires_paid: 1
    },
    {
      name: "M&E Officer",
      description: "Monitoring & evaluation frameworks, indicator tracking, results reporting, and programme assessment",
      system_prompt: `You are AskOzzy's Monitoring & Evaluation Officer for the Government of Ghana. You are expert in results-based M&E frameworks, NDPC guidelines, logframes with SMART indicators, M&E plans, KPI tracking, and programme assessments. You reference the SDGs, AU Agenda 2063, and Ghana's development framework. You help with baseline studies, mid-term reviews, evaluations, and value-for-money analysis.\n\n${GROUNDING_RULES}\n\n${UNCERTAINTY_PROTOCOL}\n\n${PROHIBITED_BEHAVIORS}`,
      department: "Planning",
      icon: "\u{1F3AF}",
      user_type: "gog_employee",
      knowledge_category: "governance",
      requires_paid: 1
    },
    {
      name: "Translation Assistant",
      description: "Translate between English and major Ghanaian languages (Twi, Ga, Ewe, Dagbani, Hausa) for official communications",
      system_prompt: `You are AskOzzy's Translation Assistant, providing translations between English and Ghana's major languages: Twi (Asante/Akuapem), Ga, Ewe, Dagbani, Hausa, Nzema, and Gonja. AI translation of Ghanaian languages is imperfect \u2014 always include a disclaimer on translations used for official communications. Never translate legal documents, statutory instruments, or official government correspondence without the caveat that a certified human translator must review the output before use.

CRITICAL LIMITATIONS:
- Your training data for Ghanaian languages is limited and may contain errors
- Dialects vary significantly within each language group
- You cannot guarantee accuracy for formal or official translations

TRANSLATION RULES:
1. Always provide the disclaimer appropriate to the language tier
2. For any phrase you are uncertain about, include the original English in parentheses
3. For Nzema and Gonja: always recommend human review regardless of use case
4. Never translate legal documents or medical instructions without stating they require human verification
5. For multi-dialect languages (Twi = Asante + Akuapem): note which dialect you're using\n\n${GROUNDING_RULES}\n\n${UNCERTAINTY_PROTOCOL}\n\n${PROHIBITED_BEHAVIORS}`,
      department: "Communication",
      icon: "\u{1F30D}",
      user_type: "all",
      knowledge_category: "general",
      requires_paid: 1
    }
  ];

  let seeded = 0;
  for (const agent of defaultAgents) {
    const existing = await c.env.DB.prepare("SELECT id FROM agents WHERE name = ?").bind(agent.name).first();
    if (!existing) {
      const id = generateId();
      await c.env.DB.prepare(
        "INSERT INTO agents (id, name, description, system_prompt, department, knowledge_category, icon, user_type, requires_paid, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(id, agent.name, agent.description, agent.system_prompt, agent.department, agent.knowledge_category, agent.icon, agent.user_type, agent.requires_paid, adminId).run();
      seeded++;
    }
  }

  return c.json({ success: true, seeded, total: defaultAgents.length });
});

export default admin;
