// Payment, affiliate, pricing, and subscription routes — extracted from index.ts
import { Hono } from "hono";
import type { AppType } from "../types";
import { authMiddleware, adminMiddleware } from "../lib/middleware";
import { generateId } from "../lib/utils";
import { log } from "../lib/logger";

const payments = new Hono<AppType>();

// ─── Paystack Plan Pricing ──────────────────────────────────────────

const PAYSTACK_PLANS: Record<string, {
  monthly: number; yearly: number;
  studentMonthly: number; studentYearly: number;
  planCode: string;
}> = {
  professional: {
    monthly: 6000, yearly: 60000,         // GHS 60/mo or GHS 600/yr (2 months free)
    studentMonthly: 2500, studentYearly: 25000, // GHS 25/mo or GHS 250/yr
    planCode: "professional",
  },
  enterprise: {
    monthly: 10000, yearly: 100000,       // GHS 100/mo or GHS 1,000/yr (2 months free)
    studentMonthly: 4500, studentYearly: 45000, // GHS 45/mo or GHS 450/yr
    planCode: "enterprise",
  },
};

// ─── Document Credit Packs ──────────────────────────────────────────

const DOC_CREDIT_PACKS: Record<string, { credits: number; priceGHS: number; pricePesewas: number; label: string }> = {
  pack_5:  { credits: 5,  priceGHS: 10, pricePesewas: 1000, label: "5 Documents — GHS 10" },
  pack_10: { credits: 10, priceGHS: 18, pricePesewas: 1800, label: "10 Documents — GHS 18 (10% off)" },
  pack_25: { credits: 25, priceGHS: 40, pricePesewas: 4000, label: "25 Documents — GHS 40 (20% off)" },
};

// ─── Pricing Tiers (duplicated from index.ts — shared dependency) ───

const PRICING_TIERS: Record<string, {
  name: string;
  price: number;
  studentPrice: number;
  messagesPerDay: number;
  models: string;
  features: string[];
}> = {
  free: {
    name: "Free",
    price: 0,
    studentPrice: 0,
    messagesPerDay: 10,
    models: "basic",
    features: ["10 messages/day", "Basic models (3)", "Standard response speed"],
  },
  professional: {
    name: "Professional",
    price: 60,
    studentPrice: 25,
    messagesPerDay: 200,
    models: "pro",
    features: ["200 messages/day", "10 AI models", "Priority speed", "Unlimited history", "Template customisation"],
  },
  enterprise: {
    name: "Enterprise",
    price: 100,
    studentPrice: 45,
    messagesPerDay: -1, // unlimited
    models: "all",
    features: ["Unlimited messages", "All 14 AI models", "Fastest priority", "Unlimited history", "Custom templates", "Dedicated support"],
  },
};

// ─── Effective Tier (trial + subscription expiry + grace period + org sponsorship) ────

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

// ─── Usage Limit Check ──────────────────────────────────────────────

async function checkUsageLimit(db: D1Database, userId: string, tier: string): Promise<{ allowed: boolean; used: number; limit: number }> {
  const tierConfig = PRICING_TIERS[tier] || PRICING_TIERS.free;
  if (tierConfig.messagesPerDay === -1) return { allowed: true, used: 0, limit: -1 };

  const today = new Date().toISOString().split("T")[0];
  const result = await db.prepare(
    "SELECT COUNT(*) as count FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ?) AND role = 'user' AND date(created_at) = ?"
  )
    .bind(userId, today)
    .first<{ count: number }>();

  const used = result?.count || 0;
  return { allowed: used < tierConfig.messagesPerDay, used, limit: tierConfig.messagesPerDay };
}

// ─── Subscription Columns Lazy Migration ─────────────────────────────

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

// ─── Trial Column Lazy Migration ────────────────────────────────────

async function ensureTrialColumn(db: D1Database) {
  try {
    await db.prepare("SELECT trial_expires_at FROM users LIMIT 1").first();
  } catch {
    await db.prepare("ALTER TABLE users ADD COLUMN trial_expires_at TEXT DEFAULT NULL").run();
  }
}

// ─── Document Credits Tables Lazy Migration ─────────────────────────

let docCreditTablesExist = false;
async function ensureDocCreditTables(db: D1Database) {
  if (docCreditTablesExist) return;
  try {
    await db.prepare("SELECT user_id FROM document_credits LIMIT 1").first();
    docCreditTablesExist = true;
  } catch {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS document_credits (
        user_id TEXT PRIMARY KEY,
        balance INTEGER DEFAULT 0,
        total_purchased INTEGER DEFAULT 0,
        total_used INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS document_credit_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('purchase', 'use', 'bonus', 'refund')),
        amount INTEGER NOT NULL,
        description TEXT,
        payment_reference TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_doc_credit_tx_user ON document_credit_transactions(user_id, created_at DESC)"),
    ]);
    docCreditTablesExist = true;
  }
}

// ─── Affiliate Tables & Helpers ─────────────────────────────────────

let affiliateTablesCreated = false;

async function ensureAffiliateTables(db: D1Database): Promise<void> {
  if (affiliateTablesCreated) return;
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS affiliate_wallets (
      user_id TEXT PRIMARY KEY,
      balance REAL DEFAULT 0.0,
      total_earned REAL DEFAULT 0.0,
      total_withdrawn REAL DEFAULT 0.0,
      updated_at TEXT DEFAULT (datetime('now'))
    )`).run();

    await db.prepare(`CREATE TABLE IF NOT EXISTS affiliate_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('commission_l1', 'commission_l2', 'withdrawal', 'bonus', 'reward')),
      amount REAL NOT NULL,
      description TEXT,
      source_user_id TEXT,
      source_payment_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`).run();

    await db.batch([
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_aff_tx_user ON affiliate_transactions(user_id, created_at DESC)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount REAL NOT NULL,
        momo_number TEXT NOT NULL,
        momo_network TEXT DEFAULT 'mtn',
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'paid', 'rejected')),
        admin_note TEXT,
        processed_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_withdraw_status ON withdrawal_requests(status, created_at DESC)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_withdraw_user ON withdrawal_requests(user_id)`),
    ]);

    // Lazy migration: add payment_reference column if missing
    await db.prepare(`ALTER TABLE withdrawal_requests ADD COLUMN payment_reference TEXT`).run().catch(() => {});

    affiliateTablesCreated = true;
  } catch {
    // Tables likely already exist
    affiliateTablesCreated = true;
  }
}

// Ensure a wallet row exists for a user, return current balance info
async function ensureWallet(db: D1Database, userId: string): Promise<{ balance: number; total_earned: number; total_withdrawn: number }> {
  await ensureAffiliateTables(db);
  const existing = await db.prepare("SELECT balance, total_earned, total_withdrawn FROM affiliate_wallets WHERE user_id = ?")
    .bind(userId).first<{ balance: number; total_earned: number; total_withdrawn: number }>();
  if (existing) return existing;
  await db.prepare("INSERT OR IGNORE INTO affiliate_wallets (user_id) VALUES (?)").bind(userId).run();
  return { balance: 0, total_earned: 0, total_withdrawn: 0 };
}

// Credit a user's affiliate wallet (commission or bonus)
async function creditWallet(db: D1Database, userId: string, amount: number, type: string, description: string, sourceUserId?: string, sourcePaymentId?: string): Promise<void> {
  await ensureWallet(db, userId);
  const txId = generateId();
  await db.batch([
    db.prepare("INSERT INTO affiliate_transactions (id, user_id, type, amount, description, source_user_id, source_payment_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(txId, userId, type, amount, description, sourceUserId || null, sourcePaymentId || null),
    db.prepare("UPDATE affiliate_wallets SET balance = balance + ?, total_earned = total_earned + ?, updated_at = datetime('now') WHERE user_id = ?")
      .bind(amount, amount, userId),
  ]);
  // Backward compat: also update users.affiliate_earnings
  await db.prepare("UPDATE users SET affiliate_earnings = affiliate_earnings + ? WHERE id = ?").bind(amount, userId).run();
}

// Process 2-level commissions for a payment
async function processAffiliateCommissions(db: D1Database, payingUserId: string, paymentAmountGHS: number, paymentReference: string): Promise<void> {
  await ensureAffiliateTables(db);

  // Deduplication: skip if commissions already credited for this payment
  if (paymentReference) {
    const existing = await db.prepare(
      "SELECT id FROM affiliate_transactions WHERE source_payment_id = ? LIMIT 1"
    ).bind(paymentReference).first();
    if (existing) return; // Already processed
  }

  // Level 1: Who referred the paying user?
  const payingUser = await db.prepare("SELECT referred_by FROM users WHERE id = ?")
    .bind(payingUserId).first<{ referred_by: string | null }>();

  if (!payingUser?.referred_by) return;

  const l1ReferrerId = payingUser.referred_by;
  const l1Commission = Math.round(paymentAmountGHS * 0.30 * 100) / 100; // 30%

  await creditWallet(
    db, l1ReferrerId, l1Commission, "commission_l1",
    `30% commission from payment by referred user (GHS ${paymentAmountGHS.toFixed(2)})`,
    payingUserId, paymentReference
  );

  // Level 2: Who referred the L1 referrer?
  const l1Referrer = await db.prepare("SELECT referred_by FROM users WHERE id = ?")
    .bind(l1ReferrerId).first<{ referred_by: string | null }>();

  if (!l1Referrer?.referred_by) return;

  const l2ReferrerId = l1Referrer.referred_by;
  const l2Commission = Math.round(paymentAmountGHS * 0.05 * 100) / 100; // 5%

  await creditWallet(
    db, l2ReferrerId, l2Commission, "commission_l2",
    `5% L2 commission from 2nd-level referral payment (GHS ${paymentAmountGHS.toFixed(2)})`,
    payingUserId, paymentReference
  );
}

// Check and award milestone bonuses
async function checkMilestones(db: D1Database, userId: string): Promise<void> {
  await ensureAffiliateTables(db);

  const user = await db.prepare("SELECT total_referrals FROM users WHERE id = ?")
    .bind(userId).first<{ total_referrals: number }>();
  if (!user) return;

  const milestones = [
    { threshold: 10, bonus: 30, label: "10 referrals — GHS 30 bonus" },
    { threshold: 25, bonus: 60, label: "25 referrals — 1 month Professional value" },
    { threshold: 50, bonus: 100, label: "50 referrals — Enterprise value + permanent discount" },
    { threshold: 100, bonus: 200, label: "100 referrals — Free Enterprise for life" },
  ];

  for (const m of milestones) {
    if (user.total_referrals < m.threshold) continue;

    // Check if already awarded (exact description match to avoid 10% matching 100)
    const milestoneDesc = `Milestone: ${m.threshold} referrals — GHS ${m.bonus} bonus`;
    const existing = await db.prepare(
      "SELECT COUNT(*) as cnt FROM affiliate_transactions WHERE user_id = ? AND type = 'bonus' AND description = ?"
    ).bind(userId, milestoneDesc).first<{ cnt: number }>();

    if (existing && existing.cnt > 0) continue;

    await creditWallet(db, userId, m.bonus, "bonus", milestoneDesc, undefined, undefined);
  }
}

// ─── Audit Log Helper (shared — duplicated from index.ts) ───────────

async function logAudit(db: D1Database, adminId: string, action: string, targetType: string, targetId?: string, details?: string) {
  await db.prepare(
    "INSERT INTO audit_log (id, admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(generateId(), adminId, action, targetType, targetId || null, details || null).run();
}

// ─── Affiliate Dashboard (Enhanced) ─────────────────────────────────

payments.get("/api/affiliate/dashboard", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureAffiliateTables(c.env.DB);

  const user = await c.env.DB.prepare(
    "SELECT referral_code, affiliate_tier, total_referrals, affiliate_earnings FROM users WHERE id = ?"
  )
    .bind(userId)
    .first<{ referral_code: string; affiliate_tier: string; total_referrals: number; affiliate_earnings: number }>();

  if (!user) return c.json({ error: "User not found" }, 404);

  // Wallet
  const wallet = await ensureWallet(c.env.DB, userId);

  // Direct referrals count
  const directCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM users WHERE referred_by = ?"
  ).bind(userId).first<{ cnt: number }>();

  // Active paying direct referrals (tier != 'free')
  const payingDirect = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM users WHERE referred_by = ? AND tier != 'free'"
  ).bind(userId).first<{ cnt: number }>();

  // Level 2 referrals: people referred by people YOU referred
  const l2Count = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM users u2
     WHERE u2.referred_by IN (SELECT id FROM users WHERE referred_by = ?)`
  ).bind(userId).first<{ cnt: number }>();

  // Level 2 paying
  const l2Paying = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM users u2
     WHERE u2.referred_by IN (SELECT id FROM users WHERE referred_by = ?)
     AND u2.tier != 'free'`
  ).bind(userId).first<{ cnt: number }>();

  // This month earnings
  const thisMonth = new Date();
  const thisMonthStart = `${thisMonth.getFullYear()}-${String(thisMonth.getMonth() + 1).padStart(2, "0")}-01`;
  const thisMonthEarnings = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM affiliate_transactions WHERE user_id = ? AND type IN ('commission_l1', 'commission_l2') AND created_at >= ?"
  ).bind(userId, thisMonthStart).first<{ total: number }>();

  // Last month earnings
  const lastMonth = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 1, 1);
  const lastMonthStart = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}-01`;
  const lastMonthEnd = thisMonthStart;
  const lastMonthEarnings = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM affiliate_transactions WHERE user_id = ? AND type IN ('commission_l1', 'commission_l2') AND created_at >= ? AND created_at < ?"
  ).bind(userId, lastMonthStart, lastMonthEnd).first<{ total: number }>();

  // Milestones
  const directRefs = directCount?.cnt || 0;
  const milestonesDef = [
    { key: "referrals_10", target: 10, reward: "GHS 30 bonus" },
    { key: "referrals_25", target: 25, reward: "1 month Professional free (GHS 60 bonus)" },
    { key: "referrals_50", target: 50, reward: "GHS 100 bonus + permanent 50% discount" },
    { key: "referrals_100", target: 100, reward: "GHS 200 bonus + Free Enterprise for life" },
  ];
  const milestones: Record<string, any> = {};
  for (const m of milestonesDef) {
    milestones[m.key] = {
      target: m.target,
      current: directRefs,
      achieved: directRefs >= m.target,
      reward: m.reward,
    };
  }

  // Recent transactions
  const { results: recentTx } = await c.env.DB.prepare(
    "SELECT id, type, amount, description, created_at FROM affiliate_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10"
  ).bind(userId).all();

  // Recent referrals
  const { results: recentRefs } = await c.env.DB.prepare(
    `SELECT u.full_name, u.tier, u.created_at
     FROM users u WHERE u.referred_by = ?
     ORDER BY u.created_at DESC LIMIT 10`
  ).bind(userId).all();

  const baseUrl = new URL(c.req.url).origin;

  // Last used MoMo details for auto-fill
  const lastMomo = await c.env.DB.prepare(
    "SELECT momo_number, momo_network FROM withdrawal_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(userId).first<{ momo_number: string; momo_network: string }>();

  return c.json({
    referralCode: user.referral_code,
    referralLink: `${baseUrl}?ref=${user.referral_code}`,
    wallet: {
      balance: wallet.balance,
      totalEarned: wallet.total_earned,
      totalWithdrawn: wallet.total_withdrawn,
    },
    stats: {
      directReferrals: directRefs,
      activePayingReferrals: payingDirect?.cnt || 0,
      level2Referrals: l2Count?.cnt || 0,
      level2PayingReferrals: l2Paying?.cnt || 0,
      thisMonthEarnings: thisMonthEarnings?.total || 0,
      lastMonthEarnings: lastMonthEarnings?.total || 0,
    },
    milestones,
    recentTransactions: recentTx || [],
    recentReferrals: recentRefs || [],
    lastMomo: lastMomo ? { number: lastMomo.momo_number, network: lastMomo.momo_network } : null,
    // Backward compat
    affiliateTier: user.affiliate_tier,
    totalReferrals: user.total_referrals,
    totalEarnings: user.affiliate_earnings,
  });
});

// ─── Affiliate Transactions (Paginated) ─────────────────────────────

payments.get("/api/affiliate/transactions", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureAffiliateTables(c.env.DB);

  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "20")));
  const offset = (page - 1) * limit;

  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM affiliate_transactions WHERE user_id = ?"
  ).bind(userId).first<{ cnt: number }>();

  const { results: transactions } = await c.env.DB.prepare(
    "SELECT id, type, amount, description, source_user_id, source_payment_id, created_at FROM affiliate_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
  ).bind(userId, limit, offset).all();

  return c.json({
    transactions: transactions || [],
    total: total?.cnt || 0,
    page,
    limit,
  });
});

// ─── Affiliate Withdrawal ───────────────────────────────────────────

payments.post("/api/affiliate/withdraw", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureAffiliateTables(c.env.DB);

  const { amount, momo_number, momo_network } = await c.req.json();

  if (!amount || !momo_number) {
    return c.json({ error: "Amount and MoMo number are required" }, 400);
  }

  const withdrawAmount = parseFloat(amount);
  if (isNaN(withdrawAmount) || withdrawAmount < 20) {
    return c.json({ error: "Minimum withdrawal is GHS 20" }, 400);
  }
  if (withdrawAmount > 5000) {
    return c.json({ error: "Maximum withdrawal is GHS 5,000 per transaction" }, 400);
  }

  await ensureWallet(c.env.DB, userId);

  // Validate MoMo number format (Ghana: 10 digits starting with 0)
  const cleanNumber = momo_number.replace(/\s/g, "");
  if (!/^0[2-9]\d{8}$/.test(cleanNumber)) {
    return c.json({ error: "Invalid MoMo number. Must be 10 digits starting with 0" }, 400);
  }

  const network = (momo_network || "mtn").toLowerCase();
  if (!["mtn", "vodafone", "airteltigo"].includes(network)) {
    return c.json({ error: "Invalid network. Use mtn, vodafone, or airteltigo" }, 400);
  }

  const requestId = generateId();
  const txId = generateId();

  // Atomic conditional deduction — prevents race condition where concurrent requests both pass balance check
  const deductResult = await c.env.DB.prepare(
    "UPDATE affiliate_wallets SET balance = balance - ?, total_withdrawn = total_withdrawn + ?, updated_at = datetime('now') WHERE user_id = ? AND balance >= ?"
  ).bind(withdrawAmount, withdrawAmount, userId, withdrawAmount).run();

  if (!deductResult.meta.changes || deductResult.meta.changes === 0) {
    return c.json({ error: "Insufficient balance" }, 400);
  }

  // Balance already deducted — now create the withdrawal request and transaction record
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO withdrawal_requests (id, user_id, amount, momo_number, momo_network, status) VALUES (?, ?, ?, ?, ?, 'pending')")
      .bind(requestId, userId, withdrawAmount, cleanNumber, network),
    c.env.DB.prepare("INSERT INTO affiliate_transactions (id, user_id, type, amount, description) VALUES (?, ?, 'withdrawal', ?, ?)")
      .bind(txId, userId, -withdrawAmount, `Withdrawal of GHS ${withdrawAmount.toFixed(2)} to ${network.toUpperCase()} ${cleanNumber}`),
  ]);

  return c.json({
    request_id: requestId,
    amount: withdrawAmount,
    momo_number: cleanNumber,
    momo_network: network,
    status: "pending",
    message: "Withdrawal request submitted. You will be paid within 24-48 hours.",
  });
});

// ─── Affiliate Leaderboard ──────────────────────────────────────────

payments.get("/api/affiliate/leaderboard", authMiddleware, async (c) => {
  await ensureAffiliateTables(c.env.DB);

  const { results } = await c.env.DB.prepare(
    `SELECT w.user_id, w.total_earned, u.full_name, u.total_referrals,
       (SELECT COUNT(*) FROM users u2 WHERE u2.referred_by IN (SELECT id FROM users WHERE referred_by = w.user_id)) as level2_referrals
     FROM affiliate_wallets w
     JOIN users u ON u.id = w.user_id
     WHERE w.total_earned > 0
     ORDER BY w.total_earned DESC
     LIMIT 20`
  ).all<{ user_id: string; total_earned: number; full_name: string; total_referrals: number; level2_referrals: number }>();

  const leaderboard = (results || []).map((r, idx) => {
    // Mask name for privacy: "Kofi Asante" -> "Kofi A."
    const parts = (r.full_name || "").split(" ");
    const maskedName = parts.length > 1
      ? `${parts[0]} ${parts[parts.length - 1][0]}.`
      : parts[0] || "Anonymous";

    return {
      rank: idx + 1,
      name: maskedName,
      referrals: r.total_referrals || 0,
      earnings: r.total_earned || 0,
      level2_referrals: r.level2_referrals || 0,
    };
  });

  return c.json({ leaderboard });
});

// ─── Admin: Affiliate Withdrawal Management ─────────────────────────

payments.get("/api/admin/affiliate/withdrawals", adminMiddleware, async (c) => {
  await ensureAffiliateTables(c.env.DB);
  const status = c.req.query("status");
  const showAll = !status || status === "all";
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "20")));
  const offset = (page - 1) * limit;

  const total = showAll
    ? await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM withdrawal_requests").first<{ cnt: number }>()
    : await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM withdrawal_requests WHERE status = ?").bind(status).first<{ cnt: number }>();

  const { results } = showAll
    ? await c.env.DB.prepare(
        `SELECT wr.*, u.full_name, u.email
         FROM withdrawal_requests wr
         JOIN users u ON u.id = wr.user_id
         ORDER BY wr.created_at DESC
         LIMIT ? OFFSET ?`
      ).bind(limit, offset).all()
    : await c.env.DB.prepare(
        `SELECT wr.*, u.full_name, u.email
         FROM withdrawal_requests wr
         JOIN users u ON u.id = wr.user_id
         WHERE wr.status = ?
         ORDER BY wr.created_at DESC
         LIMIT ? OFFSET ?`
      ).bind(status, limit, offset).all();

  const pendingCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM withdrawal_requests WHERE status = 'pending'"
  ).first<{ cnt: number }>();

  return c.json({
    withdrawals: results || [],
    total: total?.cnt || 0,
    pendingCount: pendingCount?.cnt || 0,
    page,
    limit,
  });
});

payments.post("/api/admin/affiliate/withdrawals/:id/approve", adminMiddleware, async (c) => {
  await ensureAffiliateTables(c.env.DB);
  const withdrawalId = c.req.param("id");

  const request = await c.env.DB.prepare(
    "SELECT id, user_id, amount, status FROM withdrawal_requests WHERE id = ?"
  ).bind(withdrawalId).first<{ id: string; user_id: string; amount: number; status: string }>();

  if (!request) return c.json({ error: "Withdrawal request not found" }, 404);
  if (request.status !== "pending") return c.json({ error: `Cannot approve — request is already ${request.status}` }, 400);

  await c.env.DB.prepare(
    "UPDATE withdrawal_requests SET status = 'approved', processed_at = datetime('now') WHERE id = ?"
  ).bind(withdrawalId).run();

  await logAudit(c.env.DB, c.get("userId"), "approve_withdrawal", "withdrawal", withdrawalId, `GHS ${request.amount} for user ${request.user_id}`);

  return c.json({ success: true, message: `Withdrawal of GHS ${request.amount.toFixed(2)} approved` });
});

payments.post("/api/admin/affiliate/withdrawals/:id/mark-paid", adminMiddleware, async (c) => {
  await ensureAffiliateTables(c.env.DB);
  const withdrawalId = c.req.param("id");
  const { payment_reference, admin_note } = await c.req.json().catch(() => ({ payment_reference: "", admin_note: "" }));

  const request = await c.env.DB.prepare(
    "SELECT id, user_id, amount, status FROM withdrawal_requests WHERE id = ?"
  ).bind(withdrawalId).first<{ id: string; user_id: string; amount: number; status: string }>();

  if (!request) return c.json({ error: "Withdrawal request not found" }, 404);
  if (request.status !== "approved" && request.status !== "pending") {
    return c.json({ error: `Cannot mark as paid — request is ${request.status}` }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE withdrawal_requests SET status = 'paid', payment_reference = ?, admin_note = COALESCE(?, admin_note), processed_at = datetime('now') WHERE id = ?"
  ).bind(payment_reference || null, admin_note || null, withdrawalId).run();

  await logAudit(c.env.DB, c.get("userId"), "mark_withdrawal_paid", "withdrawal", withdrawalId,
    `GHS ${request.amount} paid to user ${request.user_id}${payment_reference ? " — Ref: " + payment_reference : ""}`);

  return c.json({ success: true, message: `Withdrawal of GHS ${request.amount.toFixed(2)} marked as paid.` });
});

payments.post("/api/admin/affiliate/withdrawals/:id/reject", adminMiddleware, async (c) => {
  await ensureAffiliateTables(c.env.DB);
  const withdrawalId = c.req.param("id");
  const { reason } = await c.req.json().catch(() => ({ reason: "" }));

  const request = await c.env.DB.prepare(
    "SELECT id, user_id, amount, status FROM withdrawal_requests WHERE id = ?"
  ).bind(withdrawalId).first<{ id: string; user_id: string; amount: number; status: string }>();

  if (!request) return c.json({ error: "Withdrawal request not found" }, 404);
  if (request.status !== "pending") return c.json({ error: `Cannot reject — request is already ${request.status}` }, 400);

  // Refund balance back to user's wallet
  const refundTxId = generateId();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE withdrawal_requests SET status = 'rejected', admin_note = ?, processed_at = datetime('now') WHERE id = ?")
      .bind(reason || "Rejected by admin", withdrawalId),
    c.env.DB.prepare("UPDATE affiliate_wallets SET balance = balance + ?, total_withdrawn = total_withdrawn - ?, updated_at = datetime('now') WHERE user_id = ?")
      .bind(request.amount, request.amount, request.user_id),
    c.env.DB.prepare("INSERT INTO affiliate_transactions (id, user_id, type, amount, description) VALUES (?, ?, 'reward', ?, ?)")
      .bind(refundTxId, request.user_id, request.amount, `Refund: Withdrawal request rejected${reason ? " — " + reason : ""}`),
  ]);

  await logAudit(c.env.DB, c.get("userId"), "reject_withdrawal", "withdrawal", withdrawalId, `GHS ${request.amount} refunded to user ${request.user_id}`);

  return c.json({ success: true, message: `Withdrawal rejected. GHS ${request.amount.toFixed(2)} refunded to user's wallet.` });
});

// ─── Admin: Affiliate Stats Overview ────────────────────────────────

payments.get("/api/admin/affiliate/stats", adminMiddleware, async (c) => {
  await ensureAffiliateTables(c.env.DB);

  // Total commissions paid
  const totalCommissions = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM affiliate_transactions WHERE type IN ('commission_l1', 'commission_l2')"
  ).first<{ total: number }>();

  // L1 vs L2 breakdown
  const l1Total = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM affiliate_transactions WHERE type = 'commission_l1'"
  ).first<{ total: number }>();

  const l2Total = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM affiliate_transactions WHERE type = 'commission_l2'"
  ).first<{ total: number }>();

  // Total pending withdrawals
  const pendingWithdrawals = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total FROM withdrawal_requests WHERE status = 'pending'"
  ).first<{ cnt: number; total: number }>();

  // Total withdrawn (paid/approved)
  const totalWithdrawn = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM withdrawal_requests WHERE status IN ('approved', 'paid')"
  ).first<{ total: number }>();

  // Total bonuses awarded
  const totalBonuses = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM affiliate_transactions WHERE type = 'bonus'"
  ).first<{ total: number }>();

  // Count active affiliates (wallets with any earnings)
  const activeAffiliates = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM affiliate_wallets WHERE total_earned > 0"
  ).first<{ cnt: number }>();

  // Top affiliates by earnings
  const { results: topAffiliates } = await c.env.DB.prepare(
    `SELECT w.user_id, w.total_earned, w.balance, u.full_name, u.email, u.total_referrals
     FROM affiliate_wallets w
     JOIN users u ON u.id = w.user_id
     WHERE w.total_earned > 0
     ORDER BY w.total_earned DESC
     LIMIT 15`
  ).all();

  // Monthly trend (last 6 months)
  const monthlyTrend: Array<{ month: string; l1: number; l2: number; total: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const nextD = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const monthEnd = `${nextD.getFullYear()}-${String(nextD.getMonth() + 1).padStart(2, "0")}-01`;
    const monthLabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    const ml1 = await c.env.DB.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM affiliate_transactions WHERE type = 'commission_l1' AND created_at >= ? AND created_at < ?"
    ).bind(monthStart, monthEnd).first<{ total: number }>();

    const ml2 = await c.env.DB.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM affiliate_transactions WHERE type = 'commission_l2' AND created_at >= ? AND created_at < ?"
    ).bind(monthStart, monthEnd).first<{ total: number }>();

    monthlyTrend.push({
      month: monthLabel,
      l1: ml1?.total || 0,
      l2: ml2?.total || 0,
      total: (ml1?.total || 0) + (ml2?.total || 0),
    });
  }

  // Map topAffiliates to include wallet_balance alias for frontend
  const mappedTopAffiliates = (topAffiliates || []).map((a: any) => ({
    ...a,
    wallet_balance: a.balance,
  }));

  return c.json({
    totalCommissions: totalCommissions?.total || 0,
    commissionBreakdown: {
      level1: l1Total?.total || 0,
      level2: l2Total?.total || 0,
    },
    pendingWithdrawals: {
      count: pendingWithdrawals?.cnt || 0,
      amount: pendingWithdrawals?.total || 0,
    },
    totalWithdrawn: totalWithdrawn?.total || 0,
    totalBonuses: totalBonuses?.total || 0,
    // Frontend-expected aliases
    totalPending: pendingWithdrawals?.total || 0,
    totalPaidOut: totalWithdrawn?.total || 0,
    totalAffiliates: activeAffiliates?.cnt || 0,
    topAffiliates: mappedTopAffiliates,
    monthlyTrend,
  });
});

// ─── Admin: Payable Affiliates Report ────────────────────────────────

payments.get("/api/admin/affiliate/payable", adminMiddleware, async (c) => {
  await ensureAffiliateTables(c.env.DB);
  const period = c.req.query("period") || "all";

  // Date filter for period earnings
  let dateFilter = "";
  const now = new Date();
  if (period === "today") {
    dateFilter = now.toISOString().split("T")[0];
  } else if (period === "week") {
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    dateFilter = weekAgo.toISOString().split("T")[0];
  } else if (period === "month") {
    dateFilter = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  }

  // Get all affiliates with balance > 0
  const { results: affiliates } = await c.env.DB.prepare(
    `SELECT w.user_id, w.balance, w.total_earned, w.total_withdrawn,
            u.full_name, u.email
     FROM affiliate_wallets w
     JOIN users u ON u.id = w.user_id
     WHERE w.balance > 0
     ORDER BY w.balance DESC`
  ).all();

  const payable: any[] = [];
  for (const a of (affiliates || [])) {
    const af = a as any;

    // Period earnings
    let periodEarnings = af.total_earned || 0;
    if (dateFilter) {
      const pe = await c.env.DB.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM affiliate_transactions WHERE user_id = ? AND type IN ('commission_l1', 'commission_l2') AND created_at >= ?"
      ).bind(af.user_id, dateFilter).first<{ total: number }>();
      periodEarnings = pe?.total || 0;
    }

    // Last commission date
    const lastComm = await c.env.DB.prepare(
      "SELECT created_at FROM affiliate_transactions WHERE user_id = ? AND type IN ('commission_l1', 'commission_l2') ORDER BY created_at DESC LIMIT 1"
    ).bind(af.user_id).first<{ created_at: string }>();

    // MoMo info from most recent withdrawal request
    const momoInfo = await c.env.DB.prepare(
      "SELECT momo_number, momo_network FROM withdrawal_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
    ).bind(af.user_id).first<{ momo_number: string; momo_network: string }>();

    payable.push({
      user_id: af.user_id,
      full_name: af.full_name,
      email: af.email,
      balance: af.balance,
      total_earned: af.total_earned,
      total_withdrawn: af.total_withdrawn,
      period_earnings: periodEarnings,
      last_commission: lastComm?.created_at || null,
      momo_number: momoInfo?.momo_number || null,
      momo_network: momoInfo?.momo_network || null,
    });
  }

  return c.json({ payable, period });
});

// ─── Admin: Per-Affiliate Transaction Ledger ─────────────────────────

payments.get("/api/admin/affiliate/transactions/:userId", adminMiddleware, async (c) => {
  await ensureAffiliateTables(c.env.DB);
  const userId = c.req.param("userId");
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "20")));
  const offset = (page - 1) * limit;

  // User info
  const user = await c.env.DB.prepare(
    "SELECT id, full_name, email FROM users WHERE id = ?"
  ).bind(userId).first<{ id: string; full_name: string; email: string }>();

  if (!user) return c.json({ error: "User not found" }, 404);

  // Wallet summary
  const wallet = await c.env.DB.prepare(
    "SELECT balance, total_earned, total_withdrawn FROM affiliate_wallets WHERE user_id = ?"
  ).bind(userId).first<{ balance: number; total_earned: number; total_withdrawn: number }>();

  // L1/L2/bonus breakdowns
  const l1 = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM affiliate_transactions WHERE user_id = ? AND type = 'commission_l1'"
  ).bind(userId).first<{ total: number }>();

  const l2 = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM affiliate_transactions WHERE user_id = ? AND type = 'commission_l2'"
  ).bind(userId).first<{ total: number }>();

  const bonus = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM affiliate_transactions WHERE user_id = ? AND type = 'bonus'"
  ).bind(userId).first<{ total: number }>();

  // Total transactions count
  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM affiliate_transactions WHERE user_id = ?"
  ).bind(userId).first<{ cnt: number }>();

  // Paginated transactions with source user name
  const { results: transactions } = await c.env.DB.prepare(
    `SELECT t.id, t.type, t.amount, t.description, t.source_user_id, t.created_at,
            su.full_name as source_user_name
     FROM affiliate_transactions t
     LEFT JOIN users su ON su.id = t.source_user_id
     WHERE t.user_id = ?
     ORDER BY t.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(userId, limit, offset).all();

  return c.json({
    user: { id: user.id, full_name: user.full_name, email: user.email },
    wallet: {
      balance: wallet?.balance || 0,
      total_earned: wallet?.total_earned || 0,
      total_withdrawn: wallet?.total_withdrawn || 0,
      l1_total: l1?.total || 0,
      l2_total: l2?.total || 0,
      bonus_total: bonus?.total || 0,
    },
    transactions: transactions || [],
    total: total?.cnt || 0,
    page,
    limit,
  });
});

// ─── Pricing & Plans ─────────────────────────────────────────────────

payments.get("/api/pricing", async (c) => {
  // Check if the user is a student to return discounted pricing
  let isStudent = false;
  const authHeader = c.req.header("Authorization");
  if (authHeader) {
    const token = authHeader.replace("Bearer ", "");
    const userId = await c.env.SESSIONS.get(`session:${token}`);
    if (userId) {
      const user = await c.env.DB.prepare("SELECT user_type FROM users WHERE id = ?")
        .bind(userId).first<{ user_type: string }>();
      if (user?.user_type === "student") isStudent = true;
    }
  }

  const plans = Object.entries(PRICING_TIERS).map(([id, tier]) => {
    // Yearly = 10 months (2 months free discount)
    const yearlyPrice = tier.price * 10;
    const studentYearlyPrice = tier.studentPrice * 10;
    return {
      id,
      name: tier.name,
      price: isStudent ? tier.studentPrice : tier.price,
      standardPrice: tier.price,
      studentPrice: tier.studentPrice,
      yearlyPrice: isStudent ? studentYearlyPrice : yearlyPrice,
      standardYearlyPrice: yearlyPrice,
      studentYearlyPrice,
      isStudentPricing: isStudent,
      messagesPerDay: tier.messagesPerDay,
      features: tier.features,
      popular: id === "professional",
    };
  });
  return c.json({ plans, isStudentPricing: isStudent });
});

payments.get("/api/usage/status", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureSubscriptionColumns(c.env.DB);
  const user = await c.env.DB.prepare("SELECT tier, trial_expires_at, subscription_expires_at, billing_cycle FROM users WHERE id = ?")
    .bind(userId)
    .first<{ tier: string; trial_expires_at: string | null; subscription_expires_at: string | null; billing_cycle: string | null }>();

  const userTier = getEffectiveTier({ tier: user?.tier || "free", trial_expires_at: user?.trial_expires_at || null, subscription_expires_at: user?.subscription_expires_at || null });
  const trialActive = !!(user?.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date() && (user.tier || "free") === "free");

  // Grace period detection
  let inGracePeriod = false;
  if (user?.tier && user.tier !== "free" && user.subscription_expires_at) {
    const expiresAt = new Date(user.subscription_expires_at + "Z");
    inGracePeriod = new Date() > expiresAt && userTier !== "free";
  }

  const usage = await checkUsageLimit(c.env.DB, userId, userTier);
  const tierConfig = PRICING_TIERS[userTier] || PRICING_TIERS.free;

  return c.json({
    tier: userTier,
    tierName: tierConfig.name,
    price: tierConfig.price,
    used: usage.used,
    limit: usage.limit,
    remaining: usage.limit === -1 ? -1 : Math.max(0, usage.limit - usage.used),
    models: tierConfig.models,
    trialActive,
    trialExpiresAt: user?.trial_expires_at || null,
    subscriptionExpiresAt: user?.subscription_expires_at || null,
    billingCycle: user?.billing_cycle || "monthly",
    inGracePeriod,
  });
});

// Admin-only manual tier upgrade (payment upgrades go through Paystack webhooks)
payments.post("/api/upgrade", adminMiddleware, async (c) => {
  const { userId, tier, billingCycle: rawCycle } = await c.req.json();
  const billingCycle = rawCycle === "yearly" ? "yearly" : "monthly";

  if (!userId || !PRICING_TIERS[tier] || tier === "free") {
    return c.json({ error: "Valid userId and tier required" }, 400);
  }

  const daysToAdd = billingCycle === "yearly" ? 365 : 30;
  const expiresAt = new Date(Date.now() + daysToAdd * 86400000)
    .toISOString().replace("T", " ").split(".")[0];

  await ensureSubscriptionColumns(c.env.DB);
  await c.env.DB.prepare("UPDATE users SET tier = ?, subscription_expires_at = ?, billing_cycle = ? WHERE id = ?")
    .bind(tier, expiresAt, billingCycle, userId)
    .run();

  const tierConfig = PRICING_TIERS[tier];
  return c.json({
    success: true,
    tier,
    name: tierConfig.name,
    billingCycle,
    subscriptionExpiresAt: expiresAt,
    message: `Admin upgraded user to ${tierConfig.name} plan (${billingCycle})`,
  });
});

// ─── Document Credits ───────────────────────────────────────────────

payments.get("/api/documents/credits", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureDocCreditTables(c.env.DB);

  let credits = await c.env.DB.prepare(
    "SELECT balance, total_purchased, total_used FROM document_credits WHERE user_id = ?"
  ).bind(userId).first<{ balance: number; total_purchased: number; total_used: number }>();

  if (!credits) {
    credits = { balance: 0, total_purchased: 0, total_used: 0 };
  }

  return c.json(credits);
});

payments.post("/api/documents/credits/initialize", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { packId } = await c.req.json();

  const pack = DOC_CREDIT_PACKS[packId];
  if (!pack) return c.json({ error: "Invalid credit pack" }, 400);

  const user = await c.env.DB.prepare("SELECT email FROM users WHERE id = ?")
    .bind(userId).first<{ email: string }>();
  if (!user) return c.json({ error: "User not found" }, 404);

  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const reference = `askozzy_doccredit_${userId}_${packId}_${yearMonth}`;

  const paystackSecret = c.env.PAYSTACK_SECRET;
  if (!paystackSecret) return c.json({ error: "Payment system not configured. Contact administrator." }, 503);

  try {
    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        amount: pack.pricePesewas,
        currency: "GHS",
        reference,
        callback_url: `${c.req.url.split("/api")[0]}/?payment=doc_credits`,
        metadata: { userId, packId, type: "doc_credits", custom_fields: [{ display_name: "Pack", variable_name: "pack", value: pack.label }] },
      }),
    });
    const data: any = await res.json();
    if (data.status) {
      return c.json({ authorization_url: data.data.authorization_url, reference: data.data.reference });
    }
    return c.json({ error: "Payment initialization failed" }, 500);
  } catch {
    return c.json({ error: "Payment service unavailable" }, 503);
  }
});

payments.post("/api/documents/use-credit", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { messageId } = await c.req.json();
  await ensureDocCreditTables(c.env.DB);

  // Check user tier — paid tiers get unlimited docs
  const user = await c.env.DB.prepare(
    "SELECT tier, subscription_expires_at, trial_expires_at FROM users WHERE id = ?"
  ).bind(userId).first<{ tier: string; subscription_expires_at: string | null; trial_expires_at: string | null }>();

  if (!user) return c.json({ error: "User not found" }, 404);

  const effectiveTier = getEffectiveTier(user);
  if (effectiveTier === "professional" || effectiveTier === "enterprise") {
    return c.json({ allowed: true, creditUsed: false, remainingCredits: -1 });
  }

  // Free/starter tier: check credit balance
  let credits = await c.env.DB.prepare(
    "SELECT balance FROM document_credits WHERE user_id = ?"
  ).bind(userId).first<{ balance: number }>();

  if (!credits || credits.balance < 1) {
    return c.json({ allowed: false, creditUsed: false, remainingCredits: credits?.balance || 0 });
  }

  // Deduct 1 credit
  await c.env.DB.prepare(
    "UPDATE document_credits SET balance = balance - 1, total_used = total_used + 1, updated_at = datetime('now') WHERE user_id = ?"
  ).bind(userId).run();

  // Log transaction
  const txId = generateId();
  await c.env.DB.prepare(
    "INSERT INTO document_credit_transactions (id, user_id, type, amount, description) VALUES (?, ?, 'use', -1, ?)"
  ).bind(txId, userId, `Document download${messageId ? ` (msg: ${String(messageId).substring(0, 20)})` : ""}`).run();

  const updated = await c.env.DB.prepare(
    "SELECT balance FROM document_credits WHERE user_id = ?"
  ).bind(userId).first<{ balance: number }>();

  return c.json({ allowed: true, creditUsed: true, remainingCredits: updated?.balance || 0 });
});

// ─── Paystack Payment Integration ─────────────────────────────────────

payments.post("/api/payments/initialize", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { tier, billingCycle: rawCycle } = await c.req.json();
  const billingCycle = rawCycle === "yearly" ? "yearly" : "monthly";

  if (!PAYSTACK_PLANS[tier]) {
    return c.json({ error: "Invalid plan" }, 400);
  }

  const user = await c.env.DB.prepare("SELECT email, tier, user_type FROM users WHERE id = ?")
    .bind(userId).first<{ email: string; tier: string; user_type: string }>();

  if (!user) return c.json({ error: "User not found" }, 404);
  if (user.tier === tier) return c.json({ error: "Already on this plan" }, 400);

  const plan = PAYSTACK_PLANS[tier];
  const isStudent = user.user_type === "student";
  const chargeAmount = billingCycle === "yearly"
    ? (isStudent ? plan.studentYearly : plan.yearly)
    : (isStudent ? plan.studentMonthly : plan.monthly);
  // Deterministic reference prevents duplicate transactions within same billing period
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const reference = `askozzy_${userId}_${tier}_${billingCycle}_${yearMonth}`;

  // If PAYSTACK_SECRET is configured, use real Paystack
  const paystackSecret = c.env.PAYSTACK_SECRET;
  if (paystackSecret) {
    try {
      const res = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: user.email,
          amount: chargeAmount,
          currency: "GHS",
          reference,
          callback_url: `${c.req.url.split("/api")[0]}/?payment=success`,
          metadata: { userId, tier, billingCycle, custom_fields: [{ display_name: "Plan", variable_name: "plan", value: `${tier} (${billingCycle})` }] },
        }),
      });
      const data: any = await res.json();
      if (data.status) {
        return c.json({ authorization_url: data.data.authorization_url, reference: data.data.reference });
      }
      return c.json({ error: "Payment initialization failed" }, 500);
    } catch (err) {
      return c.json({ error: "Payment service unavailable" }, 503);
    }
  }

  // No dev fallback — Paystack secret must be configured for payments
  return c.json({ error: "Payment system not configured. Contact administrator." }, 503);
});

// Paystack webhook
payments.post("/api/webhooks/paystack", async (c) => {
  const paystackSecret = c.env.PAYSTACK_SECRET;
  if (!paystackSecret) return c.json({ error: "Not configured" }, 500);

  // Verify webhook signature
  const signature = c.req.header("x-paystack-signature") || "";
  const body = await c.req.text();

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(paystackSecret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expectedSig = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

  // Constant-time comparison to prevent timing attacks
  if (expectedSig.length !== signature.length) {
    return c.json({ error: "Invalid signature" }, 401);
  }
  const a = encoder.encode(expectedSig);
  const b2 = encoder.encode(signature);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b2[i];
  if (diff !== 0) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  // Ensure processed_payments table exists
  try {
    await c.env.DB.prepare("SELECT 1 FROM processed_payments LIMIT 0").first();
  } catch {
    await c.env.DB.exec(`CREATE TABLE IF NOT EXISTS processed_payments (
      reference TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount_pesewas INTEGER NOT NULL,
      processed_at TEXT NOT NULL DEFAULT (datetime('now')),
      metadata TEXT
    )`);
  }

  if (event.event === "charge.success") {
    const { metadata, reference, amount: amountPesewas, customer } = event.data;

    // Idempotency: atomically claim this reference before processing
    if (reference) {
      const claim = await c.env.DB.prepare(
        "INSERT OR IGNORE INTO processed_payments (reference, event_type, user_id, amount_pesewas, metadata) VALUES (?, ?, ?, ?, ?)"
      ).bind(reference, metadata?.type || "charge", metadata?.userId || "", Number(amountPesewas) || 0, JSON.stringify(metadata || {})).run();
      if (claim.meta.changes === 0) {
        // Reference already claimed by a prior delivery
        return c.json({ received: true, duplicate: true });
      }
    }

    // Handle document credit purchases
    if (metadata?.type === "doc_credits" && metadata?.userId && metadata?.packId) {
      const pack = DOC_CREDIT_PACKS[metadata.packId];
      if (!pack) {
        log("error", "Webhook: unknown doc credit pack", { packId: metadata.packId });
        return c.json({ received: true, flagged: "unknown_pack" }, 200);
      }

      const paidAmount = Number(amountPesewas) || 0;
      if (paidAmount < pack.pricePesewas) {
        log("error", "Webhook: doc credit amount mismatch", { expected: pack.pricePesewas, received: paidAmount, reference });
        return c.json({ received: true, flagged: "amount_mismatch" }, 200);
      }

      await ensureDocCreditTables(c.env.DB);

      // Upsert credits
      await c.env.DB.prepare(
        `INSERT INTO document_credits (user_id, balance, total_purchased)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?, total_purchased = total_purchased + ?, updated_at = datetime('now')`
      ).bind(metadata.userId, pack.credits, pack.credits, pack.credits, pack.credits).run();

      // Log transaction
      const txId = generateId();
      await c.env.DB.prepare(
        "INSERT INTO document_credit_transactions (id, user_id, type, amount, description, payment_reference) VALUES (?, ?, 'purchase', ?, ?, ?)"
      ).bind(txId, metadata.userId, pack.credits, pack.label, reference || "").run();

      // Process affiliate commissions on doc credit purchase
      const paymentAmountGHS = paidAmount / 100;
      if (paymentAmountGHS > 0) {
        c.executionCtx.waitUntil((async () => {
          try {
            await processAffiliateCommissions(c.env.DB, metadata.userId, paymentAmountGHS, reference || "");
          } catch (err) {
            log("error", "Affiliate commission error", { error: String(err) });
          }
        })());
      }

      return c.json({ received: true });
    }

    if (metadata?.userId && metadata?.tier) {
      // Validate tier exists in our plans
      const plan = PAYSTACK_PLANS[metadata.tier];
      if (!plan) {
        log("error", "Webhook: unknown tier", { tier: metadata.tier });
        return c.json({ error: "Unknown tier" }, 400);
      }

      // Determine billing cycle and minimum expected amount
      const cycle: string = metadata.billingCycle === "yearly" ? "yearly" : "monthly";
      const minAmount = cycle === "yearly" ? plan.studentYearly : plan.studentMonthly;

      // Validate payment amount matches expected price (allow student pricing as minimum)
      const paidAmount = Number(amountPesewas) || 0;
      if (paidAmount < minAmount) {
        log("error", "Webhook: amount mismatch", { expected: minAmount, received: paidAmount, tier: metadata.tier, cycle, reference });
        // Return 200 to prevent Paystack retry loops; log for admin review
        return c.json({ received: true, flagged: "amount_mismatch" }, 200);
      }

      // Calculate subscription expiry
      const now = new Date();
      const daysToAdd = cycle === "yearly" ? 365 : 30;
      const expiresAt = new Date(now.getTime() + daysToAdd * 86400000)
        .toISOString().replace("T", " ").split(".")[0];

      // Upgrade user's tier with subscription expiry
      await ensureSubscriptionColumns(c.env.DB);
      await c.env.DB.prepare(
        "UPDATE users SET tier = ?, subscription_expires_at = ?, billing_cycle = ? WHERE id = ?"
      ).bind(metadata.tier, expiresAt, cycle, metadata.userId).run();

      // Process affiliate commissions (non-blocking)
      // Paystack amounts are in pesewas (1 GHS = 100 pesewas)
      const paymentAmountGHS = paidAmount / 100;

      if (paymentAmountGHS > 0) {
        c.executionCtx.waitUntil((async () => {
          try {
            await processAffiliateCommissions(c.env.DB, metadata.userId, paymentAmountGHS, reference || "");
          } catch (err) {
            log("error", "Affiliate commission error", { error: String(err) });
          }
        })());
      }

    }
  }

  return c.json({ received: true });
});

// ─── Referral Landing Info ──────────────────────────────────────────

payments.get("/api/referral/info", async (c) => {
  const code = c.req.query("code") || "";
  if (!code) return c.json({ valid: false });

  const referrer = await c.env.DB.prepare(
    "SELECT full_name, department FROM users WHERE referral_code = ?"
  ).bind(code.trim().toUpperCase()).first<{ full_name: string; department: string }>();

  if (!referrer) return c.json({ valid: false });

  return c.json({
    valid: true,
    referrerName: referrer.full_name,
    referrerDepartment: referrer.department || "",
    code: code.trim().toUpperCase(),
  });
});

// ─── Free Pro Trial (3 days) ────────────────────────────────────────

payments.post("/api/trial/activate", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureTrialColumn(c.env.DB);

  const user = await c.env.DB.prepare(
    "SELECT tier, trial_expires_at FROM users WHERE id = ?"
  ).bind(userId).first<{ tier: string; trial_expires_at: string | null }>();

  if (!user) return c.json({ error: "User not found" }, 404);
  if (user.tier !== "free") return c.json({ error: "Already on a paid plan" }, 400);
  if (user.trial_expires_at) return c.json({ error: "Trial already used" }, 400);

  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().replace("T", " ").split(".")[0];

  await c.env.DB.prepare(
    "UPDATE users SET trial_expires_at = ? WHERE id = ?"
  ).bind(expiresAt, userId).run();

  return c.json({ success: true, expiresAt });
});

payments.get("/api/trial/status", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureTrialColumn(c.env.DB);
  await ensureSubscriptionColumns(c.env.DB);

  const user = await c.env.DB.prepare(
    "SELECT tier, trial_expires_at, subscription_expires_at, billing_cycle FROM users WHERE id = ?"
  ).bind(userId).first<{ tier: string; trial_expires_at: string | null; subscription_expires_at: string | null; billing_cycle: string | null }>();

  if (!user) return c.json({ error: "User not found" }, 404);

  const effectiveTier = getEffectiveTier(user);
  const trialActive = !!(user.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date() && user.tier === "free");

  return c.json({
    tier: user.tier,
    effectiveTier,
    trialExpiresAt: user.trial_expires_at || null,
    trialActive,
    trialUsed: !!user.trial_expires_at,
    subscriptionExpiresAt: user.subscription_expires_at || null,
    billingCycle: user.billing_cycle || "monthly",
  });
});

// ─── Organisation Pricing (shared — used by org-admin routes too) ───

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

export default payments;

// Export helpers that are also needed by index.ts (shared dependencies)
export {
  PRICING_TIERS,
  PAYSTACK_PLANS,
  DOC_CREDIT_PACKS,
  ORG_PRICING_TIERS,
  VOLUME_DISCOUNTS,
  getVolumeDiscount,
  getEffectiveOrgSeatPrice,
  getEffectiveTier,
  checkUsageLimit,
  ensureSubscriptionColumns,
  ensureTrialColumn,
  ensureDocCreditTables,
  ensureAffiliateTables,
  ensureWallet,
  creditWallet,
  processAffiliateCommissions,
  checkMilestones,
  logAudit,
};
