import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, Variables, AppType } from "./types";
import {
  generateId, hashPassword, verifyPassword,
  generateAccessCode, normalizeAccessCode,
  generateRecoveryCode, generateReferralSuffix,
  createToken, verifyToken,
} from "./lib/utils";
import {
  checkRateLimit, globalRateLimit, authMiddleware, adminMiddleware, deptAdminMiddleware,
} from "./lib/middleware";
import {
  buildGroundedSystemPrompt, buildContextBlock, buildNoContextResponse,
  GROUNDING_RULES, UNCERTAINTY_PROTOCOL, PROHIBITED_BEHAVIORS,
  type RetrievedContext,
} from "./config/agent-prompts";
import { getAuthorityForAgent } from "./config/authorities";
import { getParams, resolveAgentCategory } from "./config/inference-params";
import { checkKnownErrors } from "./lib/known-errors";
import { handleFeedback, type FeedbackPayload } from "./lib/feedback";
import { hybridRetrieve } from "./lib/hybrid-retriever";
import { uploadDocumentToR2, listR2Documents, deleteR2Document } from "./lib/autorag-retriever";
import { runStreamWithGateway } from "./lib/ai-client";
import { buildCacheKey, shouldSkipCache } from "./lib/cache-key";
import { checkAgentRateLimit, recordGatewayMetrics } from "./lib/rate-limiter";
import { runWithTools, agentHasTools } from "./lib/tool-loop";
import { getToolsForAgent, TOOL_USE_RULES } from "./config/tools";
import { generate } from "./lib/generator";
import { verify, requiresFullVerification, selfConsistencyCheck } from "./lib/verifier";
import { adjudicate } from "./lib/adjudicator";
import { computeConfidence } from "./lib/confidence";
import { parseCitations } from "./lib/citation-parser";
import { loadStudentProfile, saveStudentProfile, updateSessionScore } from "./lib/session-tracker";
import { assessStudentLevel, getOrCreateStudentProfile, buildScaffoldingPrompt, generateOrientationBrief, isNewTopic } from "./agents/tutor-agent";
import { retrieveAtLevel } from "./lib/difficulty-retriever";
import { log } from "./lib/logger";
import pushRoutes from "./routes/push";
import orgAdminRoutes from "./routes/org-admin";
import messagingRoutes from "./routes/messaging";
import paymentRoutes from "./routes/payments";
import authRoutes from "./routes/auth";
import conversationRoutes from "./routes/conversations";
import userRoutes from "./routes/user";
import featureRoutes from "./routes/features";
import adminRoutes from "./routes/admin";
import adminContentRoutes from "./routes/admin-content";
import chatRoutes from "./routes/chat";
import accountRoutes from "./routes/account";
import miscRoutes from "./routes/misc";
import eclassroomRoutes from "./routes/eclassroom";


function escapeLike(s: string): string { return s.replace(/[%_\\]/g, '\\$&'); }

const app = new Hono<AppType>();

// Global error handler — prevent stack trace leaks
app.onError((err, c) => {
  log('error', 'Unhandled error', { error: err.message, stack: err.stack });
  return c.json({ error: "Internal server error" }, 500);
});

// Redirect www and workers.dev to primary domain (askozzy.work)
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.hostname === "www.askozzy.work" || url.hostname === "askozzy.ghwmelite.workers.dev") {
    url.hostname = "askozzy.work";
    return c.redirect(url.toString(), 301);
  }
  await next();
});

app.use("/api/*", cors({
  origin: (origin) => {
    const allowed = [
      "https://askozzy.work",
      "https://www.askozzy.work",
      "https://askozzy.ghwmelite.workers.dev",
      "https://eclassroom.askozzy.work",
    ];
    return allowed.includes(origin) ? origin : allowed[0];
  },
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type"],
}));

// ─── Security Headers ─────────────────────────────────────────────────
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  c.header("Content-Security-Policy", "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://cdn.jsdelivr.net https://gnews.io https://eclassroom.askozzy.work; frame-ancestors 'none'; base-uri 'self'; form-action 'self';");
});

// ─── Request Body Size Limit ─────────────────────────────────────────
app.use("/api/*", async (c, next) => {
  const contentLength = c.req.header("content-length");
  if (contentLength && parseInt(contentLength) > 1048576) {
    return c.json({ error: "Request too large" }, 413);
  }
  await next();
});

// Utilities and middleware imported from ./lib/utils and ./lib/middleware

// ─── Pricing Tier Configuration ─────────────────────────────────────

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

const FREE_TIER_MODELS = [
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/openai/gpt-oss-20b",
  "@cf/google/gemma-3-12b-it",
  "@cf/meta/llama-3.1-8b-instruct-fast",
];

const PRO_TIER_MODELS = [
  ...FREE_TIER_MODELS,
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/qwen/qwq-32b",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/zai-org/glm-4.7-flash",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "@cf/qwen/qwen2.5-coder-32b-instruct",
  "@cf/meta/llama-3.2-11b-vision-instruct",
];

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

// ─── Trial Column Lazy Migration ────────────────────────────────────

async function ensureTrialColumn(db: D1Database) {
  try {
    await db.prepare("SELECT trial_expires_at FROM users LIMIT 1").first();
  } catch {
    await db.prepare("ALTER TABLE users ADD COLUMN trial_expires_at TEXT DEFAULT NULL").run();
  }
}

// ─── Streak Columns Lazy Migration ──────────────────────────────────

async function ensureStreakColumns(db: D1Database) {
  try {
    await db.prepare("SELECT current_streak FROM users LIMIT 1").first();
  } catch {
    await db.batch([
      db.prepare("ALTER TABLE users ADD COLUMN current_streak INTEGER DEFAULT 0"),
      db.prepare("ALTER TABLE users ADD COLUMN longest_streak INTEGER DEFAULT 0"),
      db.prepare("ALTER TABLE users ADD COLUMN last_active_date TEXT DEFAULT NULL"),
      db.prepare("ALTER TABLE users ADD COLUMN badges TEXT DEFAULT '[]'"),
    ]);
  }
}

// ─── User Type Column Lazy Migration ─────────────────────────────────

async function ensureUserTypeColumn(db: D1Database) {
  try {
    await db.prepare("SELECT user_type FROM users LIMIT 1").first();
  } catch {
    await db.prepare("ALTER TABLE users ADD COLUMN user_type TEXT DEFAULT 'gog_employee'").run();
  }
}

// ─── Org Role Column Lazy Migration ──────────────────────────────────

async function ensureOrgRoleColumn(db: D1Database) {
  try {
    await db.prepare("SELECT org_role FROM users LIMIT 1").first();
  } catch {
    await db.prepare("ALTER TABLE users ADD COLUMN org_role TEXT DEFAULT NULL").run();
  }
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

// ─── Agent User Type Column Lazy Migration ───────────────────────────

async function ensureAgentUserTypeColumn(db: D1Database) {
  try {
    await db.prepare("SELECT user_type FROM agents LIMIT 1").first();
  } catch {
    await db.prepare("ALTER TABLE agents ADD COLUMN user_type TEXT DEFAULT 'all'").run();
  }
}

// ─── Referral Source Lazy Migration ──────────────────────────────────

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

// ─── Auth Method + WebAuthn Lazy Migrations ─────────────────────────

async function ensureAuthMethodColumns(db: D1Database) {
  try {
    await db.prepare("SELECT auth_method FROM users LIMIT 1").first();
  } catch {
    await db.batch([
      db.prepare("ALTER TABLE users ADD COLUMN auth_method TEXT DEFAULT 'access_code'"),
      db.prepare("ALTER TABLE users ADD COLUMN recovery_code_hash TEXT DEFAULT NULL"),
    ]);
  }
}

async function ensureWebAuthnTable(db: D1Database) {
  try {
    await db.prepare("SELECT id FROM webauthn_credentials LIMIT 1").first();
  } catch {
    await db.prepare(`CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      sign_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`).run();
  }
}

// ─── Phase 6: Onboarding Quiz Columns Lazy Migration ────────────────

let quizColsExist = false;
async function ensureQuizColumns(db: D1Database) {
  if (quizColsExist) return;
  try {
    await db.prepare("SELECT experience_level FROM users LIMIT 1").first();
    quizColsExist = true;
  } catch {
    await db.batch([
      db.prepare("ALTER TABLE users ADD COLUMN experience_level TEXT DEFAULT NULL"),
      db.prepare("ALTER TABLE users ADD COLUMN primary_use_case TEXT DEFAULT NULL"),
      db.prepare("ALTER TABLE users ADD COLUMN onboarding_quiz_completed INTEGER DEFAULT 0"),
    ]);
    quizColsExist = true;
  }
}

// ─── Phase 6: User Profiles Table Lazy Migration ────────────────────

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

// ─── Phase 6: Document Credits Tables Lazy Migration ────────────────

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

// ─── Phase 6: Exam Prep Tables Lazy Migration ───────────────────────

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

// ─── Phase 7: Meeting Action Items Table Lazy Migration ─────────────

let phase7TablesExist = false;
async function ensurePhase7Tables(db: D1Database) {
  if (phase7TablesExist) return;
  try {
    await db.prepare("SELECT id FROM meeting_action_items LIMIT 1").first();
    phase7TablesExist = true;
  } catch {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS meeting_action_items (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        assignee TEXT DEFAULT '',
        deadline TEXT DEFAULT NULL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done')),
        completed_at TEXT DEFAULT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_action_items_meeting ON meeting_action_items(meeting_id)"),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_action_items_user_status ON meeting_action_items(user_id, status)"),
    ]);
    phase7TablesExist = true;
  }
  // Also ensure meeting_type and language columns on meetings table
  try {
    await db.prepare("SELECT meeting_type FROM meetings LIMIT 1").first();
  } catch {
    await db.batch([
      db.prepare("ALTER TABLE meetings ADD COLUMN meeting_type TEXT DEFAULT 'general'"),
      db.prepare("ALTER TABLE meetings ADD COLUMN language TEXT DEFAULT 'en'"),
    ]);
  }
}

// ─── Prompt Engineering Course: Column Lazy Migration ────────────────
let promptCourseColExists = false;
async function ensurePromptCourseColumn(db: D1Database) {
  if (promptCourseColExists) return;
  try {
    await db.prepare("SELECT prompt_course_progress FROM user_profiles LIMIT 1").first();
    promptCourseColExists = true;
  } catch {
    await db.prepare("ALTER TABLE user_profiles ADD COLUMN prompt_course_progress TEXT DEFAULT '{}'").run();
    promptCourseColExists = true;
  }
}

// ─── Daily Streak Updater ───────────────────────────────────────────

async function updateUserStreak(db: D1Database, userId: string) {
  await ensureStreakColumns(db);

  const today = new Date().toISOString().split("T")[0];
  const user = await db.prepare(
    "SELECT current_streak, longest_streak, last_active_date, badges FROM users WHERE id = ?"
  ).bind(userId).first<{ current_streak: number; longest_streak: number; last_active_date: string | null; badges: string }>();

  if (!user || user.last_active_date === today) return; // Already counted today

  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  let newStreak = 1;
  if (user.last_active_date === yesterday) {
    newStreak = (user.current_streak || 0) + 1;
  }
  const newLongest = Math.max(newStreak, user.longest_streak || 0);

  // Check for new badges
  let badges: string[] = [];
  try { badges = JSON.parse(user.badges || "[]"); } catch { badges = []; }

  const badgeDefs = [
    { id: "streak_3", condition: () => newStreak >= 3 },
    { id: "streak_7", condition: () => newStreak >= 7 },
    { id: "streak_14", condition: () => newStreak >= 14 },
    { id: "streak_30", condition: () => newStreak >= 30 },
  ];

  for (const b of badgeDefs) {
    if (!badges.includes(b.id) && b.condition()) {
      badges.push(b.id);
    }
  }

  await db.prepare(
    "UPDATE users SET current_streak = ?, longest_streak = ?, last_active_date = ?, badges = ? WHERE id = ?"
  ).bind(newStreak, newLongest, today, JSON.stringify(badges), userId).run();
}

// ─── GoG Enhanced System Prompt ─────────────────────────────────────

export const GOG_SYSTEM_PROMPT = `You are Ozzy, the AI assistant powering AskOzzy — a private productivity platform built exclusively for Government of Ghana (GoG) operations. You provide precise, professional, and actionable assistance to civil servants.

CORE IDENTITY:
- Use formal British English (Ghana's official standard)
- Be thorough but concise — civil servants value efficiency
- When drafting documents, provide complete, ready-to-use outputs
- Maintain strict confidentiality — never reference or store other users' data
- Sign off naturally as Ozzy when appropriate

GHANA PUBLIC SERVICE STRUCTURE:
- Head of State: The President of the Republic of Ghana
- Office of the Head of Civil Service (OHCS) — oversees the Civil Service
- Public Services Commission (PSC) — appointments, promotions, discipline
- Key Ministries: Finance (MoF), Local Government & Rural Development (MLGRD), Health (MoH), Education (MoE), Interior (MoI), Foreign Affairs (MoFA), Defence (MoD), Justice & Attorney General (MoJAG), Trade & Industry (MoTI), Lands & Natural Resources (MLNR), Employment & Labour Relations (MELR), Communications & Digitalisation (MoCD)
- 16 Regions, 261 Metropolitan/Municipal/District Assemblies (MMDAs)
- Key Agencies: Controller & Accountant General's Department (CAGD), Ghana Revenue Authority (GRA), Public Procurement Authority (PPA), Audit Service, National Development Planning Commission (NDPC)

KEY REGULATIONS & ACTS:
- 1992 Constitution of the Republic of Ghana (Fourth Republic)
- Civil Service Act, 1993 (PNDCL 327)
- Public Financial Management Act, 2016 (Act 921)
- Public Procurement Act, 2003 (Act 663) as amended by Act 914 (2016)
- Labour Act, 2003 (Act 651)
- Data Protection Act, 2012 (Act 843)
- National Pensions Act, 2008 (Act 766) — 3-tier pension scheme
- Financial Administration Act, 2003 (Act 654)
- Internal Audit Agency Act, 2003 (Act 658)
- Right to Information Act, 2019 (Act 989)

DOCUMENT FORMATTING STANDARDS:
- Official memo reference format: MDA ACRONYM/VOL.X/123 (e.g., MOF/VOL.3/045)
- Cabinet Memoranda: 9-section format (Title, Sponsoring Ministry, Problem Statement, Background, Policy Options, Recommendation, Fiscal Impact, Implementation Plan, Conclusion)
- Block letter format for official correspondence
- All financial figures in Ghana Cedis (GHS) unless otherwise specified

BUDGET & PROCUREMENT:
- Fiscal year: January to December
- Medium-Term Expenditure Framework (MTEF) — 3-year rolling budgets
- Programme-Based Budgeting (PBB) approach
- GIFMIS (Ghana Integrated Financial Management Information System) for budget execution
- Procurement methods: Competitive Tendering, Restricted Tendering, Single Source, Request for Quotations
- Procurement thresholds vary by entity classification (schedule 3 of Act 663)

COMMON ACRONYMS:
MDA = Ministry, Department, Agency | MMDA = Metropolitan/Municipal/District Assembly | OHCS = Office of the Head of Civil Service | MoF = Ministry of Finance | CAGD = Controller & Accountant General's Department | GRA = Ghana Revenue Authority | PPA = Public Procurement Authority | GIFMIS = Ghana Integrated Financial Management Information System | MTEF = Medium-Term Expenditure Framework | PBB = Programme-Based Budgeting | IGF = Internally Generated Funds | DACF = District Assemblies Common Fund | GOG = Government of Ghana | SSNIT = Social Security and National Insurance Trust | NHIA = National Health Insurance Authority | GES = Ghana Education Service | GHS = Ghana Health Service

RESPONSE GUIDELINES:
- Cite specific Acts, sections, and regulations where relevant
- Verify procurement thresholds and financial figures before stating them
- Provide step-by-step guidance for administrative procedures
- Structure responses with headings, bullet points, and numbered steps
- For document drafting, follow GoG formatting standards above

${GROUNDING_RULES}

${UNCERTAINTY_PROTOCOL}

${PROHIBITED_BEHAVIORS}`;

const STUDENT_SYSTEM_PROMPT = `You are Ozzy, the AI study companion powering AskOzzy — an intelligent academic assistant built for students in Ghana. You help with studying, essay writing, exam preparation, research, and academic growth.

CORE IDENTITY:
- Use clear, encouraging academic English (British standard, Ghana's official)
- Prioritise teaching and understanding over giving direct answers
- When helping with essays, guide structure and argumentation, don't just write it for them
- Be a patient tutor — explain concepts step by step
- Sign off naturally as Ozzy when appropriate

GHANA EDUCATION CONTEXT:
- West African Examinations Council (WAEC) administers WASSCE and BECE
- WASSCE: West African Senior School Certificate Examination (SHS3)
- BECE: Basic Education Certificate Examination (JHS3)
- GES: Ghana Education Service — manages pre-tertiary education
- NaCCA: National Council for Curriculum and Assessment — sets curriculum
- Tertiary: Universities (UG, KNUST, UCC, UEW, UDS, etc.), Polytechnics, Colleges of Education
- Grading: WASSCE uses A1-F9 scale; Universities use CGPA (typically 4.0 scale)
- Key subjects: Core Maths, English, Integrated Science, Social Studies + electives

ACADEMIC SUPPORT:
- Help with essay structure (introduction, body paragraphs, conclusion)
- Explain concepts using real-world Ghana examples where possible
- For exam prep, use past question patterns and marking schemes
- Encourage critical thinking: ask "Why do you think that?" before giving answers
- Study techniques: active recall, spaced repetition, Pomodoro, mind mapping
- Citation formats: APA 7th edition (most common in Ghana universities), Harvard

SUBJECT EXPERTISE:
- Sciences: Biology, Chemistry, Physics, Integrated Science
- Mathematics: Core Maths, Elective Maths, Further Maths
- Humanities: History, Government, Literature, Economics, Geography
- Languages: English Language, English Literature
- Business: Accounting, Business Management, Economics, Cost Accounting
- Technical: ICT, Technical Drawing, Applied Electricity

RESPONSE GUIDELINES:
- Break complex topics into digestible chunks
- Use examples from the Ghana context (history, economy, geography)
- Provide practice questions when reviewing topics
- For essay help, always provide a marking rubric or checklist
- Encourage original thinking — flag when you detect potential plagiarism concerns
- Structure responses with clear headings, bullet points, and numbered steps

${GROUNDING_RULES}

${UNCERTAINTY_PROTOCOL}

${PROHIBITED_BEHAVIORS}`;

// ─── DOCX/PPTX Text Extraction (ZIP-based Office files) ──────────────

async function extractDocxText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const entries = parseZipEntries(new Uint8Array(buffer));

  // DOCX: main content is in word/document.xml
  const docEntry = entries.find(e => e.filename === "word/document.xml");
  if (!docEntry) throw new Error("Not a valid DOCX file (missing word/document.xml)");

  const xml = await decompressEntry(docEntry);
  // Extract text from <w:t> tags and preserve paragraph breaks
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPptxText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const entries = parseZipEntries(new Uint8Array(buffer));

  // PPTX: slides are in ppt/slides/slide1.xml, slide2.xml, etc.
  const slideEntries = entries
    .filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.filename))
    .sort((a, b) => {
      const numA = parseInt(a.filename.match(/slide(\d+)/)?.[1] || "0");
      const numB = parseInt(b.filename.match(/slide(\d+)/)?.[1] || "0");
      return numA - numB;
    });

  if (slideEntries.length === 0) throw new Error("Not a valid PPTX file (no slides found)");

  const texts: string[] = [];
  for (const entry of slideEntries) {
    const xml = await decompressEntry(entry);
    const slideText = xml
      .replace(/<\/a:p>/g, "\n")
      .replace(/<a:t>([\s\S]*?)<\/a:t>/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .trim();
    if (slideText) texts.push(slideText);
  }
  return texts.join("\n\n---\n\n");
}

async function extractDocText(file: File): Promise<string> {
  // .doc is old binary format — extract readable ASCII/Unicode strings
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  let current = "";

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    // Printable ASCII range + common whitespace
    if ((b >= 32 && b <= 126) || b === 10 || b === 13 || b === 9) {
      current += String.fromCharCode(b);
    } else {
      if (current.trim().length > 20) {
        chunks.push(current.trim());
      }
      current = "";
    }
  }
  if (current.trim().length > 20) chunks.push(current.trim());

  // Filter out binary noise (strings with too many special chars)
  const filtered = chunks.filter(c => {
    const alphaRatio = (c.match(/[a-zA-Z\s]/g) || []).length / c.length;
    return alphaRatio > 0.6 && c.length > 30;
  });

  return filtered.join("\n\n");
}

// Minimal ZIP parser for Cloudflare Workers (no external dependencies)
interface ZipEntry {
  filename: string;
  compressedData: Uint8Array;
  compressionMethod: number;
  uncompressedSize: number;
}

function parseZipEntries(data: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  while (offset < data.length - 4) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break; // Local file header signature

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);

    const nameBytes = data.slice(offset + 30, offset + 30 + nameLength);
    const filename = new TextDecoder().decode(nameBytes);

    const dataStart = offset + 30 + nameLength + extraLength;
    const compressedData = data.slice(dataStart, dataStart + compressedSize);

    entries.push({ filename, compressedData, compressionMethod, uncompressedSize });
    offset = dataStart + compressedSize;

    // Skip optional data descriptor
    if (offset < data.length - 4) {
      const maybeSig = view.getUint32(offset, true);
      if (maybeSig === 0x08074b50) {
        offset += 16; // Skip data descriptor with signature
      }
    }
  }

  return entries;
}

async function decompressEntry(entry: ZipEntry): Promise<string> {
  if (entry.compressionMethod === 0) {
    // Stored (no compression)
    return new TextDecoder().decode(entry.compressedData);
  }

  if (entry.compressionMethod === 8) {
    // Deflated — use DecompressionStream
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    const writePromise = writer.write(entry.compressedData).then(() => writer.close());

    const chunks: Uint8Array[] = [];
    let totalLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }

    await writePromise;

    const result = new Uint8Array(totalLength);
    let pos = 0;
    for (const chunk of chunks) {
      result.set(chunk, pos);
      pos += chunk.length;
    }

    return new TextDecoder().decode(result);
  }

  throw new Error(`Unsupported compression method: ${entry.compressionMethod}`);
}

// ─── RAG Utility Functions ─────────────────────────────────────────

function chunkText(text: string, maxSize = 500, overlap = 50): string[] {
  const sentences = text.replace(/\n{3,}/g, '\n\n').split(/(?<=[.!?])\s+|\n\n/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length > maxSize && current.length > 0) {
      chunks.push(current.trim());
      // Overlap: keep last portion of previous chunk
      const words = current.split(/\s+/);
      const overlapWords = words.slice(-Math.ceil(overlap / 5));
      current = overlapWords.join(' ') + ' ' + sentence;
    } else {
      current = current ? current + ' ' + sentence : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function generateEmbeddings(ai: Ai, texts: string[]): Promise<number[][]> {
  const response = await ai.run('@cf/baai/bge-base-en-v1.5', { text: texts });
  return (response as any).data as number[][];
}

export async function searchKnowledge(env: Env, query: string, topK = 5, agentType?: string): Promise<{
  ragResults: Array<{ content: string; score: number; source: string; title: string; category: string }>;
  faqResults: Array<{ question: string; answer: string; category: string }>;
}> {
  const ragResults: Array<{ content: string; score: number; source: string; title: string; category: string }> = [];
  let faqResults: Array<{ question: string; answer: string; category: string }> = [];

  // Hybrid RAG: Merge Vectorize + AutoRAG (R2) results in parallel
  try {
    const hybridResults = await hybridRetrieve(query, agentType || 'general', env);
    for (const r of hybridResults) {
      ragResults.push({
        content: r.text,
        score: r.score,
        source: r.source,
        title: r.source,
        category: agentType || 'general',
      });
    }
  } catch (e) {
    // Fallback: direct Vectorize query if hybrid retriever fails
    try {
      const embeddings = await generateEmbeddings(env.AI, [query]);
      const vectorResults = await env.VECTORIZE.query(embeddings[0], { topK, returnMetadata: 'all' });

      if (vectorResults.matches && vectorResults.matches.length > 0) {
        const validMatches = vectorResults.matches.filter((m: any) => m.score >= 0.7);
        for (const match of validMatches) {
          const metadata = match.metadata as any;
          if (metadata?.content) {
            ragResults.push({
              content: metadata.content,
              score: match.score,
              source: metadata.source || metadata.title || 'Knowledge Base',
              title: metadata.title || metadata.source || 'Knowledge Base',
              category: metadata.category || 'general',
            });
          }
        }
      }
    } catch { /* Graceful degradation */ }
  }

  // FAQ: Keyword search in D1 knowledge_base
  try {
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (keywords.length > 0) {
      const likeClauses = keywords.slice(0, 5).map(() => "(keywords LIKE ? ESCAPE '\\' OR question LIKE ? ESCAPE '\\')").join(' OR ');
      const params = keywords.slice(0, 5).flatMap(kw => [`%${escapeLike(kw)}%`, `%${escapeLike(kw)}%`]);

      const { results } = await env.DB.prepare(
        `SELECT question, answer, category FROM knowledge_base WHERE active = 1 AND (${likeClauses}) ORDER BY priority DESC LIMIT 3`
      ).bind(...params).all<{ question: string; answer: string; category: string }>();

      faqResults = results || [];
    }
  } catch (e) {
    // Graceful degradation
  }

  return { ragResults, faqResults };
}

export function buildAugmentedPrompt(
  base: string,
  ragResults: Array<{ content: string; score: number; source: string; title: string; category: string }>,
  faqResults: Array<{ question: string; answer: string; category: string }>
): string {
  // Convert RAG + FAQ results into the standardized context block format
  const contexts: RetrievedContext[] = [];

  for (const r of ragResults) {
    contexts.push({
      id: `rag_${r.source.replace(/\s+/g, '_').substring(0, 30)}`,
      text: r.content,
      score: r.score,
      source: `${r.title}, ${r.category}`,
    });
  }

  for (const f of faqResults) {
    contexts.push({
      id: `faq_${f.category}`,
      text: `Q: ${f.question}\nA: ${f.answer}`,
      score: 0.8, // FAQ entries are high-relevance by design
      source: `FAQ — ${f.category}`,
    });
  }

  // Build the [CONTEXT_BLOCK] with [SOURCE_N] format
  const contextBlock = buildContextBlock(contexts);

  return contextBlock + '\n\n' + base;
}

// ─── Web Search ─────────────────────────────────────────────────────

async function webSearch(query: string, maxResults = 5): Promise<Array<{ title: string; url: string; snippet: string }>> {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AskOzzy/1.0)",
      },
    });
    const html = await res.text();
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    // Parse DuckDuckGo HTML results
    const resultBlocks = html.split('class="result__body"');
    for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
      const block = resultBlocks[i];

      // Extract title
      const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : '';

      // Extract URL
      const urlMatch = block.match(/href="([^"]*)"/) || block.match(/class="result__url"[^>]*>([\s\S]*?)<\/a>/);
      let url = '';
      if (urlMatch) {
        url = urlMatch[1].replace(/<[^>]*>/g, '').trim();
        // DuckDuckGo uses redirect URLs, extract actual URL
        if (url.includes('uddg=')) {
          const decoded = decodeURIComponent(url.split('uddg=')[1]?.split('&')[0] || '');
          url = decoded || url;
        }
        if (!url.startsWith('http')) url = 'https://' + url;
      }

      // Extract snippet
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/) ||
                           block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\//);
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : '';

      if (title && url) {
        results.push({ title, url, snippet });
      }
    }

    return results;
  } catch (e) {
    log("error", "Web search failed", { error: String(e) });
    return [];
  }
}

const WEB_SEARCH_LIMITS: Record<string, number> = {
  free: 3,
  professional: -1,
  enterprise: -1,
};

async function checkWebSearchLimit(env: Env, userId: string, tier: string): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = WEB_SEARCH_LIMITS[tier] ?? WEB_SEARCH_LIMITS.free;
  if (limit === -1) return { allowed: true, used: 0, limit: -1 };

  const today = new Date().toISOString().split("T")[0];
  const kvKey = `websearch:${userId}:${today}`;
  const current = await env.SESSIONS.get(kvKey);
  const used = current ? parseInt(current) : 0;

  if (used >= limit) return { allowed: false, used, limit };
  return { allowed: true, used, limit };
}

async function incrementWebSearchCount(env: Env, userId: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const kvKey = `websearch:${userId}:${today}`;
  const current = await env.SESSIONS.get(kvKey);
  const count = current ? parseInt(current) : 0;
  await env.SESSIONS.put(kvKey, String(count + 1), { expirationTtl: 86400 });
}

// POST /api/web-search — standalone web search endpoint

// GET /api/research/:id — retrieve saved research report

// POST /api/chat/image — send image with message in chat context

// ─── Affiliate Commission Engine (2-Level) ──────────────────────────
// Direct referral: 30% | 2nd level: 5% | No tiers — everyone gets 30% from day one

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


// ─── Admin Routes ────────────────────────────────────────────────────

// Bootstrap: self-disabling — only works when zero admins exist

// Verify admin status (page load check)

// Dashboard stats

// Paginated user list with search

// Change user tier

// Change user role

// Activate or deactivate user

// Delete user + all data (comprehensive cascade)

// All conversations with user info + message counts

// View messages in any conversation (admin)

// Delete any conversation (admin)

// Analytics: messages/day, signups/day (7 days), model usage, top users

// Referrals overview

// Quick-promote user to admin by email

// ═══════════════════════════════════════════════════════════════════════
//  ENHANCED FEATURES — v2
// ═══════════════════════════════════════════════════════════════════════

// ─── Audit Log Helper ─────────────────────────────────────────────────

async function logAudit(db: D1Database, adminId: string, action: string, targetType: string, targetId?: string, details?: string) {
  await db.prepare(
    "INSERT INTO audit_log (id, admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(generateId(), adminId, action, targetType, targetId || null, details || null).run();
}

// ─── User Activity Audit Helper (non-blocking) ─────────────────────────

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

// ─── Productivity Tracking ────────────────────────────────────────────

const VALID_STAT_COLUMNS = new Set([
  "messages_sent", "research_reports", "analyses_run",
  "meetings_processed", "workflows_completed", "documents_generated",
]);

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
    if (!multiplier || !VALID_STAT_COLUMNS.has(multiplier.column)) return;

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

// ─── Phase 6: Document Credits ──────────────────────────────────────

// Auto-flag: scan messages for sensitive keywords
const MODERATION_KEYWORDS = ["confidential", "classified", "secret", "password", "corruption", "bribe", "embezzle"];

async function checkModeration(db: D1Database, conversationId: string, messageId: string, userId: string, content: string) {
  const lower = content.toLowerCase();
  const flagged = MODERATION_KEYWORDS.filter(kw => lower.includes(kw));
  if (flagged.length > 0) {
    await db.prepare(
      "INSERT INTO moderation_flags (id, conversation_id, message_id, user_id, reason) VALUES (?, ?, ?, ?, ?)"
    ).bind(generateId(), conversationId, messageId, userId, `Keywords detected: ${flagged.join(", ")}`).run();
  }
}

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

// ─── CBOR Minimal Decoder (for WebAuthn attestation) ─────────────────

function decodeCBOR(buf: ArrayBuffer): any {
  const data = new Uint8Array(buf);
  let pos = 0;

  function read(): any {
    const initial = data[pos++];
    const major = initial >> 5;
    const addl = initial & 0x1f;

    let val: number;
    if (addl < 24) val = addl;
    else if (addl === 24) val = data[pos++];
    else if (addl === 25) { val = (data[pos] << 8) | data[pos + 1]; pos += 2; }
    else if (addl === 26) { val = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3]; pos += 4; }
    else throw new Error("CBOR: unsupported additional info " + addl);

    switch (major) {
      case 0: return val; // unsigned int
      case 1: return -1 - val; // negative int
      case 2: { // byte string
        const bytes = data.slice(pos, pos + val);
        pos += val;
        return bytes;
      }
      case 3: { // text string
        const text = new TextDecoder().decode(data.slice(pos, pos + val));
        pos += val;
        return text;
      }
      case 4: { // array
        const arr = [];
        for (let i = 0; i < val; i++) arr.push(read());
        return arr;
      }
      case 5: { // map
        const map: Record<any, any> = {};
        for (let i = 0; i < val; i++) {
          const k = read();
          map[k] = read();
        }
        return map;
      }
      default: throw new Error("CBOR: unsupported major type " + major);
    }
  }

  return read();
}

function coseToSpki(coseKey: Record<number, Uint8Array>): ArrayBuffer {
  // COSE key with kty=2 (EC2), crv=1 (P-256)
  const x = coseKey[-2];
  const y = coseKey[-3];
  if (!x || !y || x.length !== 32 || y.length !== 32) {
    throw new Error("Invalid COSE EC2 key");
  }
  // SPKI header for P-256 uncompressed point
  const spkiHeader = new Uint8Array([
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86,
    0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
    0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
    0x42, 0x00, 0x04
  ]);
  const spki = new Uint8Array(spkiHeader.length + 64);
  spki.set(spkiHeader);
  spki.set(x, spkiHeader.length);
  spki.set(y, spkiHeader.length + 32);
  return spki.buffer;
}

function bufToBase64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBuf(str: string): ArrayBuffer {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ═══════════════════════════════════════════════════════════════════════
//  KNOWLEDGE BASE — RAG Document & FAQ Management
// ═══════════════════════════════════════════════════════════════════════

// 4. KB Stats (must be before :id routes)

// Helper: Process document embeddings (used by text and file upload)
async function processDocumentEmbeddings(env: Env, docId: string, title: string, source: string, content: string, category: string = 'general') {
  try {
    const chunks = chunkText(content, 500, 50);

    if (chunks.length === 0) {
      await env.DB.prepare(
        "UPDATE documents SET status = 'error' WHERE id = ?"
      ).bind(docId).run();
      return;
    }

    let totalSaved = 0;

    for (let i = 0; i < chunks.length; i += 5) {
      const batch = chunks.slice(i, i + 5);

      // Generate embeddings with retry
      let embeddings: number[][];
      try {
        embeddings = await generateEmbeddings(env.AI, batch);
      } catch (embErr) {
        // Retry once after a short delay
        await new Promise(r => setTimeout(r, 1000));
        try {
          embeddings = await generateEmbeddings(env.AI, batch);
        } catch {
          // Skip this batch if embedding fails twice
          continue;
        }
      }

      if (!embeddings || embeddings.length !== batch.length) continue;

      const vectors: Array<{ id: string; values: number[]; metadata: Record<string, string> }> = [];
      for (let j = 0; j < batch.length; j++) {
        if (!embeddings[j] || embeddings[j].length === 0) continue;
        const chunkId = `${docId}_chunk_${i + j}`;
        vectors.push({
          id: chunkId,
          values: embeddings[j],
          metadata: {
            content: batch[j].slice(0, 1000),
            source: source || title,
            title: title,
            category: category,
            docId: docId,
            chunkIndex: String(i + j),
          },
        });

        // Save chunk to DB
        try {
          await env.DB.prepare(
            "INSERT OR IGNORE INTO document_chunks (id, document_id, chunk_index, content, vector_id) VALUES (?, ?, ?, ?, ?)"
          ).bind(chunkId, docId, i + j, batch[j], chunkId).run();
        } catch {}
      }

      if (vectors.length > 0) {
        try {
          await env.VECTORIZE.upsert(vectors);
          totalSaved += vectors.length;
        } catch {
          // Vectorize upsert failed for this batch, continue with remaining
        }
      }
    }

    if (totalSaved > 0) {
      await env.DB.prepare(
        "UPDATE documents SET status = 'ready', chunk_count = ? WHERE id = ?"
      ).bind(totalSaved, docId).run();
    } else {
      await env.DB.prepare(
        "UPDATE documents SET status = 'error' WHERE id = ?"
      ).bind(docId).run();
    }
  } catch (err) {
    try {
      await env.DB.prepare(
        "UPDATE documents SET status = 'error' WHERE id = ?"
      ).bind(docId).run();
    } catch {}
  }
}

// 1. Upload document

// Admin: Upload document via file (text extraction)

// Admin: Scrape URL(s) for document training

// 2. List documents

// 3. Delete document + chunks + vectors

// 5. Create FAQ entry

// 6. List FAQ entries

// 7. Update FAQ entry

// 8. Delete FAQ entry

// ═══════════════════════════════════════════════════════════════════
// Phase 4: Platform Dominance
// ═══════════════════════════════════════════════════════════════════

// ─── Feature 9: Workflow Automation ─────────────────────────────────

const WORKFLOW_TEMPLATES: Record<string, { name: string; type: string; description: string; steps: string[] }> = {
  memo: {
    name: "Official Memo",
    type: "memo",
    description: "Draft an official government memorandum",
    steps: ["Recipient & Subject", "Background & Context", "Key Points", "Recommendation", "Review & Generate"],
  },
  procurement: {
    name: "Procurement Process",
    type: "procurement",
    description: "Guide through public procurement steps per Act 663",
    steps: ["Requirement Definition", "Budget Confirmation", "Procurement Method", "Evaluation Criteria", "Generate Documents"],
  },
  leave_request: {
    name: "Leave Request",
    type: "leave_request",
    description: "Prepare a leave request letter",
    steps: ["Leave Type & Dates", "Reason & Handover", "Review & Generate"],
  },
  budget: {
    name: "Budget Preparation",
    type: "budget",
    description: "Prepare a departmental budget submission",
    steps: ["Department & Period", "Revenue Items", "Expenditure Items", "Justification", "Review & Generate"],
  },
  report: {
    name: "Progress Report",
    type: "report",
    description: "Generate a structured progress report",
    steps: ["Report Period & Title", "Achievements", "Challenges", "Next Steps", "Review & Generate"],
  },
  cabinet_memo: {
    name: "Cabinet Memorandum",
    type: "cabinet_memo",
    description: "Draft a Cabinet Memorandum (9-section format)",
    steps: ["Title & Ministry", "Problem Statement", "Background", "Policy Options", "Recommendation", "Fiscal Impact", "Implementation Plan", "Conclusion", "Review & Generate"],
  },
};

// ─── Feature 10: AI Meeting Assistant ───────────────────────────────

const MEETING_MINUTE_TEMPLATES: Record<string, string> = {
  general: `You are a professional minutes secretary for the Government of Ghana. Generate formal meeting minutes from the following transcript.

Format the minutes as follows:
1. MEETING TITLE
2. DATE AND TIME
3. ATTENDEES (extract from transcript if mentioned)
4. AGENDA ITEMS
5. DISCUSSIONS (summarise key points per agenda item)
6. DECISIONS MADE
7. ACTION ITEMS (with responsible person and deadline if mentioned)
8. NEXT MEETING
9. ADJOURNMENT

Use formal British English. Be thorough but concise.

IMPORTANT: At the very end, add a section called "EXTRACTED_ACTIONS_JSON" with a JSON array of action items in this format:
[{"action": "description", "assignee": "person or TBD", "deadline": "date or TBD"}]`,

  departmental: `You are a professional minutes secretary for a Government of Ghana department meeting. Generate formal departmental meeting minutes from the following transcript.

Format the minutes as follows:
1. DEPARTMENT MEETING TITLE
2. DATE, TIME AND VENUE
3. CHAIRPERSON
4. ATTENDEES AND APOLOGIES
5. CONFIRMATION OF PREVIOUS MINUTES
6. MATTERS ARISING
7. DEPARTMENTAL REPORTS / KPIs
8. DISCUSSIONS (summarise key points per agenda item)
9. DECISIONS AND RESOLUTIONS
10. ACTION ITEMS (with responsible officer and deadline)
11. ANY OTHER BUSINESS (A.O.B.)
12. DATE OF NEXT MEETING
13. ADJOURNMENT

Use formal British English. Include department-specific terminology where relevant.

IMPORTANT: At the very end, add a section called "EXTRACTED_ACTIONS_JSON" with a JSON array of action items in this format:
[{"action": "description", "assignee": "person or TBD", "deadline": "date or TBD"}]`,

  board: `You are a professional minutes secretary for a Government of Ghana statutory board meeting. Generate formal board meeting minutes from the following transcript.

Format the minutes as follows:
1. BOARD MEETING TITLE
2. DATE, TIME AND VENUE
3. BOARD MEMBERS PRESENT (with titles)
4. IN ATTENDANCE (non-board members)
5. APOLOGIES
6. QUORUM CONFIRMATION
7. ADOPTION OF PREVIOUS MINUTES
8. MATTERS ARISING FROM PREVIOUS MINUTES
9. CHAIRPERSON'S REMARKS
10. MANAGEMENT REPORT
11. FINANCIAL REPORT
12. AGENDA ITEMS AND DELIBERATIONS
13. BOARD RESOLUTIONS (numbered, with mover and seconder)
14. ACTION ITEMS (with responsible person, deadline, and priority)
15. ANY OTHER BUSINESS
16. DATE OF NEXT MEETING
17. CLOSURE

Use formal British English. Number all resolutions (e.g., BR/2026/001). Include quorum status.

IMPORTANT: At the very end, add a section called "EXTRACTED_ACTIONS_JSON" with a JSON array of action items in this format:
[{"action": "description", "assignee": "person or TBD", "deadline": "date or TBD"}]`,

  management_committee: `You are a professional minutes secretary for a Government of Ghana management committee meeting. Generate formal management committee minutes from the following transcript.

Format the minutes as follows:
1. MANAGEMENT COMMITTEE MEETING
2. DATE, TIME AND VENUE
3. MEMBERS PRESENT (with designations)
4. APOLOGIES
5. OPENING / CALL TO ORDER
6. REVIEW OF PREVIOUS ACTION ITEMS (status update per item)
7. KEY PERFORMANCE INDICATORS (KPI) REVIEW
8. BUDGET AND EXPENDITURE UPDATE
9. AGENDA ITEMS AND DISCUSSIONS
10. MANAGEMENT DECISIONS
11. NEW ACTION ITEMS (with owner, deadline, and KPI linkage)
12. RISK ITEMS / ESCALATIONS
13. ANY OTHER BUSINESS
14. NEXT MEETING DATE
15. ADJOURNMENT

Use formal British English. Link action items to strategic objectives where possible.

IMPORTANT: At the very end, add a section called "EXTRACTED_ACTIONS_JSON" with a JSON array of action items in this format:
[{"action": "description", "assignee": "person or TBD", "deadline": "date or TBD"}]`,

  cabinet_sub_committee: `You are a professional minutes secretary for a Government of Ghana cabinet sub-committee meeting. Generate formal cabinet sub-committee minutes from the following transcript.

Format the minutes as follows:
1. CABINET SUB-COMMITTEE ON [TOPIC]
2. DATE, TIME AND VENUE
3. MEMBERS PRESENT (Ministers / Deputy Ministers with portfolios)
4. IN ATTENDANCE (Technical advisors, Permanent Secretaries)
5. APOLOGIES
6. OPENING REMARKS BY CHAIRPERSON
7. REVIEW OF PREVIOUS DECISIONS AND IMPLEMENTATION STATUS
8. POLICY DELIBERATIONS (per agenda item)
9. CABINET SUB-COMMITTEE RECOMMENDATIONS (numbered, to be forwarded to Cabinet)
10. DIRECTIVES TO MINISTRIES/AGENCIES (with responsible MDAs and timelines)
11. CONFIDENTIAL MATTERS (if any, flagged appropriately)
12. ANY OTHER BUSINESS
13. DATE OF NEXT MEETING
14. CLOSURE

Use formal British English. Classify recommendations by urgency. Reference relevant policy frameworks.

IMPORTANT: At the very end, add a section called "EXTRACTED_ACTIONS_JSON" with a JSON array of action items in this format:
[{"action": "description", "assignee": "person or TBD", "deadline": "date or TBD"}]`,
};

// Shared transcription helper
async function transcribeMeetingAudio(ai: Ai, audioBytes: ArrayBuffer): Promise<string> {
  const transcriptResult = await ai.run("@cf/openai/whisper" as any, {
    audio: [...new Uint8Array(audioBytes)],
  });
  return (transcriptResult as any).text || "";
}


// GoG category auto-detection from filename/content (shared helper for admin-content routes)
const GOG_CATEGORIES: Record<string, string[]> = {
  procurement_law: ['procurement', 'tender', 'bidding', 'act 663', 'ppa', 'public procurement'],
  financial_admin: ['financial administration', 'act 654', 'fiscal', 'revenue', 'expenditure', 'treasury', 'cagd', 'controller and accountant'],
  civil_service: ['civil service', 'public service', 'civil servant', 'ohcs', 'head of civil service'],
  budget_policy: ['budget', 'economic policy', 'medium term', 'mtef', 'budget statement', 'appropriation'],
  gog_forms: ['form', 'template', 'application form', 'requisition', 'voucher'],
  general_regulation: ['regulation', 'directive', 'circular', 'policy', 'guideline', 'act', 'law'],
  procurement: ['procurement', 'tender', 'contract', 'bid'],
  finance: ['finance', 'budget', 'fiscal', 'revenue', 'tax', 'payroll'],
  hr: ['human resource', 'staff', 'leave', 'recruitment', 'pension', 'ssnit'],
  legal: ['legal', 'law', 'act', 'regulation', 'constitution', 'court'],
  ict: ['ict', 'digital', 'technology', 'cyber', 'e-government', 'nita'],
  health: ['health', 'medical', 'nhis', 'hospital', 'disease'],
  education: ['education', 'school', 'university', 'ges', 'waec', 'curriculum'],
  governance: ['governance', 'decentralization', 'assembly', 'district', 'parliament'],
};

function detectCategory(filename: string, content: string): string {
  const searchText = (filename + ' ' + content.slice(0, 2000)).toLowerCase();

  let bestCategory = 'general';
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(GOG_CATEGORIES)) {
    let score = 0;
    for (const kw of keywords) {
      if (searchText.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

// ─── Mount extracted route modules ──────────────────────────────────
app.route("/", pushRoutes);
app.route("/", orgAdminRoutes);
app.route("/", paymentRoutes);
app.route("/", messagingRoutes);
app.route("/", authRoutes);
app.route("/", conversationRoutes);
app.route("/", userRoutes);
app.route("/", featureRoutes);
app.route("/", adminRoutes);
app.route("/", adminContentRoutes);
app.route("/", chatRoutes);
app.route("/", accountRoutes);
app.route("/", miscRoutes);
app.route("/", eclassroomRoutes);

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Downgrade users whose subscription expired more than 7 days ago (grace period over)
    try {
      const graceCutoff = new Date(Date.now() - 7 * 86400000)
        .toISOString().replace("T", " ").split(".")[0];
      await env.DB.prepare(
        "UPDATE users SET tier = 'free' WHERE tier != 'free' AND subscription_expires_at IS NOT NULL AND subscription_expires_at < ?"
      ).bind(graceCutoff).run();
    } catch (err: any) {
      log('error', 'Cron: subscription downgrade failed', { error: err?.message });
    }

    // Phase 6: Auto-toggle exam_seasons.active based on date range
    try {
      await ensureExamTables(env.DB);
      const today = new Date().toISOString().split("T")[0];
      await env.DB.prepare(
        "UPDATE exam_seasons SET active = CASE WHEN start_date <= ? AND end_date >= ? THEN 1 ELSE 0 END"
      ).bind(today, today).run();
    } catch {}

    // ─── Discover: Fetch news from GNews API ────────────────────────
    try {
      const GNEWS_BASE = "https://gnews.io/api/v4";
      const apiKey = env.GNEWS_API_KEY;
      if (!apiKey) {
        console.error("GNEWS_API_KEY not configured, skipping discover refresh");
        return;
      }

      // 70% local (Ghana + Africa) / 30% global distribution
      const topicFetches = [
        // ── Local: Ghana (~70% of content) ──────────────────────────────
        { category: "ghana", url: `${GNEWS_BASE}/top-headlines?country=gh&lang=en&max=20&apikey=${apiKey}` },
        { category: "ghana", url: `${GNEWS_BASE}/search?q=Ghana government OR parliament OR policy OR president OR ministry&lang=en&country=gh&max=15&apikey=${apiKey}` },
        { category: "ghana", url: `${GNEWS_BASE}/search?q=Ghana economy OR business OR trade OR cedi OR "Bank of Ghana"&lang=en&country=gh&max=15&apikey=${apiKey}` },
        { category: "ghana", url: `${GNEWS_BASE}/search?q=Ghana education OR university OR WAEC OR GES OR BECE&lang=en&country=gh&max=10&apikey=${apiKey}` },
        { category: "ghana", url: `${GNEWS_BASE}/search?q=Ghana football OR "Black Stars" OR GPL OR sports&lang=en&country=gh&max=10&apikey=${apiKey}` },
        { category: "africa", url: `${GNEWS_BASE}/search?q=Africa OR ECOWAS OR "West Africa" OR "African Union"&lang=en&max=10&apikey=${apiKey}` },
        // ── Global: World news (~30% of content) ────────────────────────
        { category: "world", url: `${GNEWS_BASE}/top-headlines?topic=world&lang=en&max=5&apikey=${apiKey}` },
        { category: "business", url: `${GNEWS_BASE}/top-headlines?topic=business&lang=en&max=5&apikey=${apiKey}` },
        { category: "technology", url: `${GNEWS_BASE}/top-headlines?topic=technology&lang=en&max=5&apikey=${apiKey}` },
        { category: "science", url: `${GNEWS_BASE}/top-headlines?topic=science&lang=en&max=4&apikey=${apiKey}` },
        { category: "health", url: `${GNEWS_BASE}/top-headlines?topic=health&lang=en&max=4&apikey=${apiKey}` },
        { category: "sports", url: `${GNEWS_BASE}/top-headlines?topic=sports&lang=en&max=4&apikey=${apiKey}` },
        { category: "entertainment", url: `${GNEWS_BASE}/top-headlines?topic=entertainment&lang=en&max=3&apikey=${apiKey}` },
      ];

      for (const { category, url } of topicFetches) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const data = await res.json() as { articles?: Array<{ title: string; description: string; url: string; image: string; publishedAt: string; source: { name: string; url: string } }> };
          if (!data.articles) continue;

          for (const article of data.articles) {
            const id = generateId();
            try {
              await env.DB.prepare(
                `INSERT OR IGNORE INTO discover_articles (id, title, description, source_name, source_url, article_url, image_url, category, published_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(
                id,
                article.title,
                article.description || "",
                article.source?.name || "Unknown",
                article.source?.url || "",
                article.url,
                article.image || "",
                category,
                article.publishedAt || new Date().toISOString()
              ).run();
            } catch {
              // Duplicate article_url — skip silently
            }
          }
        } catch {
          log('error', 'Discover fetch failed', { category });
        }
      }

      // Purge articles older than 48 hours
      await env.DB.prepare(
        "DELETE FROM discover_articles WHERE published_at < datetime('now', '-48 hours')"
      ).run();
    } catch (err: any) {
      log("error", "Discover cron error", { error: err?.message });
    }

    // ─── Monitoring: Hallucination rate alerting ──────────────────────
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
        log('info', 'Daily confidence metrics', {
          total_requests: stats.total,
          low_confidence_count: stats.low_confidence || 0,
          hallucination_rate: hallRate,
          avg_confidence: stats.avg_confidence,
        });
        if (hallRate > 0.2) {
          log('error', 'HIGH_HALLUCINATION_RATE', {
            rate: hallRate,
            total: stats.total,
            low_confidence: stats.low_confidence,
            avg_confidence: stats.avg_confidence,
            alert: true,
          });
        }
      }
    } catch {}

    // ─── Fetch daily exchange rates for currency converter ───────────
    try {
      const rateRes = await fetch('https://open.er-api.com/v6/latest/GHS');
      if (rateRes.ok) {
        const rateData = await rateRes.json() as { rates?: Record<string, number> };
        if (rateData.rates) {
          await env.SESSIONS.put('exchange_rates', JSON.stringify(rateData.rates), { expirationTtl: 86400 });
          await env.SESSIONS.put('exchange_rates_updated', new Date().toISOString(), { expirationTtl: 86400 });
          log('info', 'Exchange rates updated', { currencies: Object.keys(rateData.rates).length });
        }
      }
    } catch {}
  },
};
