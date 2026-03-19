import { Hono } from "hono";
import type { AppType } from "../types";
import { authMiddleware } from "../lib/middleware";
import { generateId } from "../lib/utils";
import { log } from "../lib/logger";
import {
  GROUNDING_RULES, UNCERTAINTY_PROTOCOL, PROHIBITED_BEHAVIORS,
} from "../config/agent-prompts";

const features = new Hono<AppType>();

// ═══════════════════════════════════════════════════════════════════════
// Shared helpers (duplicated from index.ts — should be extracted to a
// shared module in a future refactoring pass)
// ═══════════════════════════════════════════════════════════════════════

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
  if (user.trial_expires_at && new Date(user.trial_expires_at + "Z") > now
      && (!user.tier || user.tier === "free")) {
    const baseTier = "professional";
    if (user.org_sponsored_tier) return maxTier(baseTier, user.org_sponsored_tier);
    return baseTier;
  }
  if (user.tier && user.tier !== "free" && user.subscription_expires_at) {
    const expiresAt = new Date(user.subscription_expires_at + "Z");
    const graceEnd = new Date(expiresAt.getTime() + 7 * 86400000);
    const personalTier = now <= graceEnd ? user.tier : "free";
    if (user.org_sponsored_tier) return maxTier(personalTier, user.org_sponsored_tier);
    return personalTier;
  }
  const personalTier = user.tier || "free";
  if (user.org_sponsored_tier) return maxTier(personalTier, user.org_sponsored_tier);
  return personalTier;
}

// ─── Subscription Columns Lazy Migration ─────────────────────────────

async function ensureSubscriptionColumns(db: D1Database) {
  try {
    await db.prepare("SELECT subscription_expires_at FROM users LIMIT 1").first();
  } catch {
    await db.batch([
      db.prepare("ALTER TABLE users ADD COLUMN subscription_expires_at TEXT DEFAULT NULL"),
      db.prepare("ALTER TABLE users ADD COLUMN subscription_plan TEXT DEFAULT NULL"),
    ]);
  }
}

// ─── User Profiles Table Lazy Migration ──────────────────────────────

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

// ─── Exam Prep Tables Lazy Migration ─────────────────────────────────

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

// ─── Pricing & Usage ────────────────────────────────────────────────

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
    messagesPerDay: -1,
    models: "all",
    features: ["Unlimited messages", "All 14 AI models", "Fastest priority", "Unlimited history", "Custom templates", "Dedicated support"],
  },
};

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

// ─── Audit & Productivity ────────────────────────────────────────────

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
  prompt_course_exercise: { column: "messages_sent", minutes: 5 },
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

// ─── GoG System Prompt (re-exported from index.ts) ──────────────────

const GOG_SYSTEM_PROMPT = `You are Ozzy, the AI assistant powering AskOzzy — a private productivity platform built exclusively for Government of Ghana (GoG) operations. You provide precise, professional, and actionable assistance to civil servants.

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

// ═══════════════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════════════

// ─── Available Models ───────────────────────────────────────────────

features.get("/api/models", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureSubscriptionColumns(c.env.DB);
  const user = await c.env.DB.prepare("SELECT tier, trial_expires_at, subscription_expires_at FROM users WHERE id = ?")
    .bind(userId)
    .first<{ tier: string; trial_expires_at: string | null; subscription_expires_at: string | null }>();
  let userTier = getEffectiveTier({ tier: user?.tier || "free", trial_expires_at: user?.trial_expires_at || null, subscription_expires_at: user?.subscription_expires_at || null });
  const isFree = userTier === "free";
  const isPro = userTier === "professional";
  const isEnterprise = userTier === "enterprise";

  return c.json({
    userTier,
    models: [
      // ── Enterprise-only (4 best models) ──────────────────────────
      {
        id: "@cf/openai/gpt-oss-120b",
        name: "GPT-OSS 120B (OpenAI)",
        description: "OpenAI's open-weight model — top-tier reasoning, agentic tasks, and general purpose",
        contextWindow: 131072,
        requiredTier: "enterprise",
        locked: !isEnterprise,
        recommended: true,
      },
      {
        id: "@cf/meta/llama-4-scout-17b-16e-instruct",
        name: "Llama 4 Scout 17B (Meta)",
        description: "Meta's latest — 16 experts, multimodal, excellent for complex drafting and analysis",
        contextWindow: 131000,
        requiredTier: "professional",
        locked: isFree,
        recommended: true,
      },
      {
        id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        name: "Llama 3.3 70B (Meta)",
        description: "70 billion parameters — the most powerful Llama for deep reasoning and long documents",
        contextWindow: 131072,
        requiredTier: "enterprise",
        locked: !isEnterprise,
        recommended: false,
      },
      {
        id: "@cf/qwen/qwen3-30b-a3b-fp8",
        name: "Qwen3 30B (Qwen)",
        description: "Latest Qwen3 — advanced reasoning, multilingual, agent capabilities",
        contextWindow: 32768,
        requiredTier: "enterprise",
        locked: !isEnterprise,
        recommended: false,
      },
      // ── Professional (3 pro-exclusive + 3 free = 6 total) ────────
      {
        id: "@cf/qwen/qwq-32b",
        name: "QwQ 32B (Qwen)",
        description: "Qwen reasoning model — exceptional at thinking through complex problems step-by-step",
        contextWindow: 24000,
        requiredTier: "professional",
        locked: isFree,
        recommended: false,
      },
      {
        id: "@cf/mistralai/mistral-small-3.1-24b-instruct",
        name: "Mistral Small 3.1 24B",
        description: "Excellent for long documents, vision understanding, and multilingual writing",
        contextWindow: 128000,
        requiredTier: "professional",
        locked: isFree,
        recommended: false,
      },
      {
        id: "@cf/zai-org/glm-4.7-flash",
        name: "GLM 4.7 Flash (Zhipu)",
        description: "Fast multilingual model — 131K context, tool calling, 100+ languages",
        contextWindow: 131072,
        requiredTier: "professional",
        locked: isFree,
        recommended: false,
      },
      {
        id: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
        name: "DeepSeek R1 Distill 32B",
        description: "DeepSeek reasoning model — outperforms o1-mini, strong at math and logic",
        contextWindow: 80000,
        requiredTier: "professional",
        locked: isFree,
        recommended: false,
      },
      {
        id: "@cf/qwen/qwen2.5-coder-32b-instruct",
        name: "Qwen 2.5 Coder 32B",
        description: "Code-specialised model — optimised for programming, debugging, and code generation",
        contextWindow: 32768,
        requiredTier: "professional",
        locked: isFree,
        recommended: false,
      },
      {
        id: "@cf/meta/llama-3.2-11b-vision-instruct",
        name: "Llama 3.2 Vision 11B (Meta)",
        description: "Vision model — analyse images, read screenshots, describe photos, and answer visual questions",
        contextWindow: 128000,
        requiredTier: "professional",
        locked: isFree,
        recommended: false,
      },
      {
        id: "@cf/ibm-granite/granite-4.0-h-micro",
        name: "Granite 4.0 Micro (IBM)",
        description: "IBM's enterprise model — small but accurate, great for structured tasks",
        contextWindow: 131072,
        requiredTier: "enterprise",
        locked: !isEnterprise,
        recommended: false,
      },
      // ── Free (3 models) ──────────────────────────────────────────
      {
        id: "@cf/openai/gpt-oss-20b",
        name: "GPT-OSS 20B (OpenAI)",
        description: "OpenAI's smaller open-weight model — fast with strong reasoning",
        contextWindow: 131072,
        requiredTier: "free",
        locked: false,
        recommended: false,
      },
      {
        id: "@cf/google/gemma-3-12b-it",
        name: "Gemma 3 12B (Google)",
        description: "Google's model — 80K context, 140+ languages, strong at summarisation",
        contextWindow: 80000,
        requiredTier: "free",
        locked: false,
        recommended: false,
      },
      {
        id: "@cf/meta/llama-3.1-8b-instruct-fast",
        name: "Llama 3.1 8B Fast (Meta)",
        description: "Optimised for speed — instant responses for quick questions and simple tasks",
        contextWindow: 7968,
        requiredTier: "free",
        locked: false,
        recommended: false,
      },
    ],
  });
});

// ─── Exam Prep (user-facing) ────────────────────────────────────────

features.get("/api/exam-prep/season", async (c) => {
  try {
    await ensureExamTables(c.env.DB);
    const now = new Date().toISOString().split("T")[0];
    const season = await c.env.DB.prepare(
      "SELECT * FROM exam_seasons WHERE active = 1 AND start_date <= ? AND end_date >= ? ORDER BY start_date DESC LIMIT 1"
    ).bind(now, now).first();
    return c.json({ season: season || null, active: !!season });
  } catch {
    return c.json({ season: null, active: false });
  }
});

features.get("/api/exam-prep/subjects", authMiddleware, async (c) => {
  await ensureExamTables(c.env.DB);
  const examType = c.req.query("examType") || "wassce";

  const { results } = await c.env.DB.prepare(
    `SELECT subject, COUNT(*) as question_count, MIN(year) as earliest_year, MAX(year) as latest_year
     FROM exam_questions WHERE exam_type = ?
     GROUP BY subject ORDER BY subject`
  ).bind(examType).all();

  return c.json({ subjects: results || [] });
});

features.get("/api/exam-prep/questions", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureExamTables(c.env.DB);

  // Check tier access
  const user = await c.env.DB.prepare(
    "SELECT tier, subscription_expires_at, trial_expires_at FROM users WHERE id = ?"
  ).bind(userId).first<{ tier: string; subscription_expires_at: string | null; trial_expires_at: string | null }>();
  if (!user) return c.json({ error: "User not found" }, 404);

  const effectiveTier = getEffectiveTier(user);
  if (effectiveTier === "free") {
    return c.json({ error: "Exam Prep requires a paid plan or exam prep subscription" }, 403);
  }

  const examType = c.req.query("examType") || "wassce";
  const subject = c.req.query("subject") || "";
  const year = c.req.query("year") || "";
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = 20;
  const offset = (page - 1) * limit;

  let whereClause = "WHERE exam_type = ?";
  const params: any[] = [examType];

  if (subject) { whereClause += " AND subject = ?"; params.push(subject); }
  if (year) { whereClause += " AND year = ?"; params.push(parseInt(year)); }

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM exam_questions ${whereClause}`
  ).bind(...params).first<{ total: number }>();

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM exam_questions ${whereClause} ORDER BY year DESC, question_number ASC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  return c.json({ questions: results || [], total: countResult?.total || 0, page, totalPages: Math.ceil((countResult?.total || 0) / limit) });
});

features.post("/api/exam-prep/submit", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { questionId, studentAnswer, timeSpentSeconds } = await c.req.json();

  if (!studentAnswer || studentAnswer.trim().length < 10) {
    return c.json({ error: "Please provide a more detailed answer (at least 10 characters)" }, 400);
  }

  await ensureExamTables(c.env.DB);

  // Check tier access
  const user = await c.env.DB.prepare(
    "SELECT tier, subscription_expires_at, trial_expires_at FROM users WHERE id = ?"
  ).bind(userId).first<{ tier: string; subscription_expires_at: string | null; trial_expires_at: string | null }>();
  if (!user) return c.json({ error: "User not found" }, 404);
  const effectiveTier = getEffectiveTier(user);
  if (effectiveTier === "free") return c.json({ error: "Exam Prep requires a paid plan" }, 403);

  // Fetch question
  const question = await c.env.DB.prepare(
    "SELECT * FROM exam_questions WHERE id = ?"
  ).bind(questionId).first<{
    id: string; exam_type: string; subject: string; question_text: string;
    marking_scheme: string; marks: number; year: number;
  }>();

  if (!question) return c.json({ error: "Question not found" }, 404);

  // AI grading with WAEC examiner prompt
  const gradingPrompt = `You are an experienced WAEC ${question.exam_type.toUpperCase()} examiner for ${question.subject}. Grade this student's answer strictly but fairly.

QUESTION (${question.year} ${question.exam_type.toUpperCase()}, ${question.marks} marks):
${question.question_text}

${question.marking_scheme ? `MARKING SCHEME:\n${question.marking_scheme}\n` : ""}
STUDENT'S ANSWER:
${studentAnswer.substring(0, 3000)}

Score on these 4 axes (each out of 10):
1. Content (accuracy and completeness of subject matter)
2. Organization (logical structure and coherence)
3. Expression (clarity, grammar, vocabulary)
4. Accuracy (factual correctness, proper use of terminology)

Return ONLY a JSON object:
{"content": N, "organization": N, "expression": N, "accuracy": N, "feedback": "Detailed feedback with specific improvements...", "grade": "A1/B2/B3/C4/C5/C6/D7/E8/F9"}`;

  try {
    const aiResponse = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
      messages: [
        { role: "system", content: "You are a strict but fair WAEC examiner. Return ONLY valid JSON." },
        { role: "user", content: gradingPrompt },
      ],
      max_tokens: 600,
    });

    const raw = (aiResponse as any)?.response || "";
    let scores = { content: 5, organization: 5, expression: 5, accuracy: 5, feedback: "Grading completed.", grade: "C4" };

    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        scores.content = Math.min(10, Math.max(0, parseInt(parsed.content) || 5));
        scores.organization = Math.min(10, Math.max(0, parseInt(parsed.organization) || 5));
        scores.expression = Math.min(10, Math.max(0, parseInt(parsed.expression) || 5));
        scores.accuracy = Math.min(10, Math.max(0, parseInt(parsed.accuracy) || 5));
        scores.feedback = String(parsed.feedback || "").substring(0, 2000) || "Grading completed.";
        scores.grade = parsed.grade || "C4";
      }
    } catch {}

    const totalScore = scores.content + scores.organization + scores.expression + scores.accuracy;
    const attemptId = generateId();

    await c.env.DB.prepare(
      `INSERT INTO exam_attempts (id, user_id, question_id, exam_type, subject, question_text, student_answer, ai_feedback, score_content, score_organization, score_expression, score_accuracy, total_score, max_score, time_spent_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 40, ?)`
    ).bind(
      attemptId, userId, questionId, question.exam_type, question.subject,
      question.question_text.substring(0, 2000), studentAnswer.substring(0, 5000),
      scores.feedback, scores.content, scores.organization, scores.expression, scores.accuracy,
      totalScore, timeSpentSeconds || 0
    ).run();

    // Track productivity
    c.executionCtx.waitUntil(trackProductivity(c, "exam_attempt"));

    return c.json({
      attemptId,
      scores: { content: scores.content, organization: scores.organization, expression: scores.expression, accuracy: scores.accuracy },
      totalScore,
      maxScore: 40,
      grade: scores.grade,
      feedback: scores.feedback,
    });
  } catch (err: any) {
    log("error", "Exam grading error", { error: err?.message });
    return c.json({ error: "Grading failed. Please try again." }, 500);
  }
});

features.post("/api/exam-prep/practice", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { subject, topic, difficulty, examType } = await c.req.json();

  if (!subject) return c.json({ error: "Subject is required" }, 400);

  // Check tier
  const user = await c.env.DB.prepare(
    "SELECT tier, subscription_expires_at, trial_expires_at FROM users WHERE id = ?"
  ).bind(userId).first<{ tier: string; subscription_expires_at: string | null; trial_expires_at: string | null }>();
  if (!user) return c.json({ error: "User not found" }, 404);
  const effectiveTier = getEffectiveTier(user);
  if (effectiveTier === "free") return c.json({ error: "Exam Prep requires a paid plan" }, 403);

  const et = examType === "bece" ? "BECE" : "WASSCE";
  const diff = difficulty === "easy" ? "easy" : difficulty === "hard" ? "hard" : "medium";

  // Check KV cache
  const cacheKey = `exam_practice:${subject}:${topic || "general"}:${diff}:${Date.now() % 86400000}`;
  const cached = await c.env.SESSIONS.get(cacheKey);
  if (cached) {
    try { return c.json(JSON.parse(cached)); } catch {}
  }

  try {
    const aiResponse = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
      messages: [
        { role: "system", content: `You are a ${et} question setter for Ghana. Generate exam-style questions.` },
        { role: "user", content: `Generate a ${diff} difficulty ${et} ${subject}${topic ? ` (topic: ${topic})` : ""} exam question. Return JSON: {"question": "...", "marks": N, "marking_scheme": "...", "topic": "..."}` },
      ],
      max_tokens: 500,
    });

    const raw = (aiResponse as any)?.response || "";
    let result = { question: `Practice ${subject} question`, marks: 10, marking_scheme: "", topic: topic || subject };

    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        result.question = String(parsed.question || "").substring(0, 2000) || result.question;
        result.marks = Math.min(50, Math.max(1, parseInt(parsed.marks) || 10));
        result.marking_scheme = String(parsed.marking_scheme || "").substring(0, 2000);
        result.topic = String(parsed.topic || topic || subject).substring(0, 200);
      }
    } catch {}

    const response = { ...result, examType: et, subject, difficulty: diff };
    c.executionCtx.waitUntil(c.env.SESSIONS.put(cacheKey, JSON.stringify(response), { expirationTtl: 86400 }));
    return c.json(response);
  } catch {
    return c.json({ error: "Failed to generate practice question" }, 500);
  }
});

features.get("/api/exam-prep/progress", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureExamTables(c.env.DB);

  const { results } = await c.env.DB.prepare(
    `SELECT subject,
       COUNT(*) as total_attempts,
       AVG(total_score) as avg_score,
       MAX(total_score) as best_score,
       SUM(time_spent_seconds) as total_time
     FROM exam_attempts WHERE user_id = ?
     GROUP BY subject ORDER BY total_attempts DESC`
  ).bind(userId).all();

  // Recent attempts
  const { results: recent } = await c.env.DB.prepare(
    "SELECT id, subject, total_score, max_score, ai_feedback, created_at FROM exam_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 5"
  ).bind(userId).all();

  return c.json({ subjectProgress: results || [], recentAttempts: recent || [] });
});

// ═══════════════════════════════════════════════════════════════════
// Feature 9: Workflow Automation
// ═══════════════════════════════════════════════════════════════════

const WORKFLOW_TEMPLATES: Record<string, { name: string; type: string; description: string; steps: string[] }> = {
  memo: {
    name: "Official Memorandum",
    type: "memo",
    description: "Draft a formal GoG memorandum",
    steps: ["Reference & Date", "To / From / Subject", "Body Content", "Closing & Action Required", "Review & Generate"],
  },
  procurement: {
    name: "Procurement Request",
    type: "procurement",
    description: "Prepare a procurement request (Act 663)",
    steps: ["Item Description", "Justification", "Estimated Cost", "Procurement Method", "Review & Generate"],
  },
  leave: {
    name: "Leave Request",
    type: "leave_request",
    description: "Submit a formal leave request",
    steps: ["Leave Type & Dates", "Reason", "Handover Notes", "Review & Generate"],
  },
  budget: {
    name: "Budget Submission",
    type: "budget",
    description: "Prepare a departmental budget submission",
    steps: ["Department & Period", "Revenue Projections", "Expenditure Items", "Justification", "Review & Generate"],
  },
  report: {
    name: "Progress Report",
    type: "report",
    description: "Write a structured progress report",
    steps: ["Reporting Period", "Objectives", "Activities & Achievements", "Challenges", "Recommendations", "Review & Generate"],
  },
  cabinet_memo: {
    name: "Cabinet Memorandum",
    type: "cabinet_memo",
    description: "Draft a Cabinet Memorandum (9-section format)",
    steps: ["Title & Ministry", "Problem Statement", "Background", "Policy Options", "Recommendation", "Fiscal Impact", "Implementation Plan", "Conclusion", "Review & Generate"],
  },
};

features.get("/api/workflows/templates", async (c) => {
  return c.json({ templates: Object.entries(WORKFLOW_TEMPLATES).map(([id, t]) => ({ id, ...t })) });
});

features.post("/api/workflows", authMiddleware, async (c) => {
  const userId = c.get("userId");

  // Tier gating: Starter+ only
  const wfUser = await c.env.DB.prepare("SELECT tier FROM users WHERE id = ?").bind(userId).first<{ tier: string }>();
  if (wfUser?.tier === "free") {
    return c.json({ error: "Workflows require a paid plan. Upgrade to Starter or above.", code: "TIER_REQUIRED" }, 403);
  }

  const { templateId, name } = await c.req.json();

  const template = WORKFLOW_TEMPLATES[templateId];
  if (!template) return c.json({ error: "Unknown workflow template" }, 400);

  const id = generateId();
  const steps = template.steps.map((s, i) => ({ index: i, name: s, status: "pending", input: "", output: "" }));

  await c.env.DB.prepare(
    "INSERT INTO workflows (id, user_id, name, type, steps) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, userId, name || template.name, template.type, JSON.stringify(steps)).run();

  return c.json({ id, name: name || template.name, type: template.type, steps });
});

features.get("/api/workflows", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, type, status, current_step, created_at, completed_at FROM workflows WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
  ).bind(userId).all();
  return c.json({ workflows: results || [] });
});

features.get("/api/workflows/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const workflow = await c.env.DB.prepare(
    "SELECT * FROM workflows WHERE id = ? AND user_id = ?"
  ).bind(id, userId).first();
  if (!workflow) return c.json({ error: "Workflow not found" }, 404);
  return c.json({ workflow });
});

features.post("/api/workflows/:id/step", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const { stepIndex, input } = await c.req.json();

  const workflow = await c.env.DB.prepare(
    "SELECT * FROM workflows WHERE id = ? AND user_id = ?"
  ).bind(id, userId).first<{ steps: string; type: string; name: string; current_step: number }>();
  if (!workflow) return c.json({ error: "Workflow not found" }, 404);

  // Audit trail: log workflow step advance (non-blocking)
  c.executionCtx.waitUntil(logUserAudit(c, "workflow_step", workflow.name + " (step " + (stepIndex + 1) + ")"));

  const steps = JSON.parse(workflow.steps);
  if (stepIndex < 0 || stepIndex >= steps.length) return c.json({ error: "Invalid step" }, 400);

  steps[stepIndex].input = input;
  steps[stepIndex].status = "completed";

  const isLastStep = stepIndex === steps.length - 1;

  if (isLastStep) {
    // Generate final output using AI
    const context = steps.map((s: any) => `## ${s.name}\n${s.input}`).join("\n\n");
    const typePrompts: Record<string, string> = {
      memo: "Generate a complete official Government of Ghana memorandum based on the following inputs. Use proper memo format with reference number, date, TO, FROM, SUBJECT, and body sections.",
      procurement: "Generate the required procurement documentation based on these inputs, following the Public Procurement Act 663 requirements.",
      leave_request: "Generate a formal leave request letter for a Ghana Civil Service employee based on these inputs.",
      budget: "Generate a structured departmental budget submission based on these inputs. Include tables where appropriate.",
      report: "Generate a structured progress report based on these inputs, following GoG reporting standards.",
      cabinet_memo: "Generate a complete Cabinet Memorandum in the standard 9-section format based on these inputs.",
    };

    try {
      const aiResult = await c.env.AI.run("@cf/openai/gpt-oss-20b" as any, {
        messages: [
          { role: "system", content: `${GOG_SYSTEM_PROMPT}\n\n${typePrompts[workflow.type] || "Generate a professional document based on the following inputs."}` },
          { role: "user", content: context },
        ],
        max_tokens: 4096,
      });

      const output = (aiResult as any).response || "";

      await c.env.DB.prepare(
        "UPDATE workflows SET steps = ?, current_step = ?, output = ?, status = 'completed', completed_at = datetime('now') WHERE id = ?"
      ).bind(JSON.stringify(steps), stepIndex + 1, output, id).run();

      // Track productivity: workflow completed + document generated (non-blocking)
      c.executionCtx.waitUntil(trackProductivity(c, "workflow"));
      c.executionCtx.waitUntil(trackProductivity(c, "document"));

      return c.json({ step: steps[stepIndex], output, completed: true });
    } catch {
      return c.json({ error: "Document generation failed" }, 500);
    }
  } else {
    // AI assistance for current step
    let aiHint = "";
    try {
      const prevContext = steps.slice(0, stepIndex).filter((s: any) => s.input).map((s: any) => `${s.name}: ${s.input}`).join("; ");
      const aiResult = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
        messages: [
          { role: "system", content: "You are helping a Ghana civil servant complete a workflow. Provide a brief, helpful suggestion for the next step. Keep it under 100 words." },
          { role: "user", content: `Workflow: ${workflow.name}\nCompleted so far: ${prevContext}\nNext step: ${steps[stepIndex + 1]?.name || "Final review"}\nProvide guidance.` },
        ],
        max_tokens: 256,
      });
      aiHint = (aiResult as any).response || "";
    } catch {}

    await c.env.DB.prepare(
      "UPDATE workflows SET steps = ?, current_step = ?, status = 'in_progress' WHERE id = ?"
    ).bind(JSON.stringify(steps), stepIndex + 1, id).run();

    return c.json({ step: steps[stepIndex], nextHint: aiHint, completed: false });
  }
});

features.delete("/api/workflows/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM workflows WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════
// Feature 10: AI Meeting Assistant
// ═══════════════════════════════════════════════════════════════════

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

features.post("/api/meetings/upload", authMiddleware, async (c) => {
  const userId = c.get("userId");

  // Tier gate: Professional+ (honors trial)
  const user = await c.env.DB.prepare("SELECT tier, trial_expires_at FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string; trial_expires_at: string | null }>();
  let meetingTier = user?.tier || "free";
  if (meetingTier === "free" && user?.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date()) {
    meetingTier = "professional";
  }
  if (meetingTier === "free") {
    return c.json({ error: "Meeting Assistant requires a Professional plan or above.", code: "TIER_REQUIRED" }, 403);
  }

  const formData = await c.req.formData();
  const audio = formData.get("audio") as File | null;
  const title = (formData.get("title") as string) || "Meeting " + new Date().toISOString().split("T")[0];

  if (!audio) return c.json({ error: "Audio file is required" }, 400);
  if (audio.size > 25 * 1024 * 1024) return c.json({ error: "Audio must be under 25MB" }, 400);

  const meetingType = (formData.get("meetingType") as string) || "general";

  await ensurePhase7Tables(c.env.DB);
  const meetingId = generateId();
  await c.env.DB.prepare(
    "INSERT INTO meetings (id, user_id, title, meeting_type) VALUES (?, ?, ?, ?)"
  ).bind(meetingId, userId, title, meetingType).run();

  // Audit trail: log meeting transcription (non-blocking)
  c.executionCtx.waitUntil(logUserAudit(c, "meeting_transcribe", title, "@cf/openai/whisper"));

  // Transcribe with Whisper
  try {
    const audioBytes = await audio.arrayBuffer();
    const transcript = await transcribeMeetingAudio(c.env.AI, audioBytes);

    await c.env.DB.prepare(
      "UPDATE meetings SET transcript = ?, status = 'transcribed' WHERE id = ?"
    ).bind(transcript, meetingId).run();

    // Track productivity (non-blocking)
    c.executionCtx.waitUntil(trackProductivity(c, "meeting"));

    return c.json({ meetingId, transcript, status: "transcribed" });
  } catch (e) {
    await c.env.DB.prepare("UPDATE meetings SET status = 'failed' WHERE id = ?").bind(meetingId).run();
    return c.json({ error: "Transcription failed. Please try a different audio format." }, 500);
  }
});

features.post("/api/meetings/:id/minutes", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const meetingId = c.req.param("id");

  const meeting = await c.env.DB.prepare(
    "SELECT * FROM meetings WHERE id = ? AND user_id = ?"
  ).bind(meetingId, userId).first<{ transcript: string; title: string; meeting_type: string }>();
  if (!meeting) return c.json({ error: "Meeting not found" }, 404);
  if (!meeting.transcript) return c.json({ error: "No transcript available" }, 400);

  let body: { meetingType?: string } = {};
  try { body = await c.req.json(); } catch {}
  const meetingType = body.meetingType || meeting.meeting_type || "general";
  const systemPrompt = MEETING_MINUTE_TEMPLATES[meetingType] || MEETING_MINUTE_TEMPLATES.general;

  try {
    const minutesResult = await c.env.AI.run("@cf/openai/gpt-oss-20b" as any, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Meeting: ${meeting.title}\n\nTranscript:\n${meeting.transcript.substring(0, 12000)}` },
      ],
      max_tokens: 4096,
    });
    let minutesRaw = (minutesResult as any).response || "";

    // Extract action items from embedded JSON section
    let actionItems: any[] = [];
    const jsonSectionMatch = minutesRaw.match(/EXTRACTED_ACTIONS_JSON[\s\S]*?(\[[\s\S]*?\])/);
    if (jsonSectionMatch) {
      try { actionItems = JSON.parse(jsonSectionMatch[1]); } catch {}
      // Remove the JSON section from the displayed minutes
      minutesRaw = minutesRaw.replace(/\n*EXTRACTED_ACTIONS_JSON[\s\S]*$/, "").trim();
    }

    // Fallback: separate AI call to extract action items if none found
    if (actionItems.length === 0) {
      try {
        const actionsResult = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
          messages: [
            { role: "system", content: 'Extract all action items from these meeting minutes. Return a JSON array: [{"action": "description", "assignee": "person", "deadline": "date or TBD"}]. Return ONLY the JSON array.' },
            { role: "user", content: minutesRaw },
          ],
          max_tokens: 1024,
        });
        const aiText = (actionsResult as any).response || "[]";
        const match = aiText.match(/\[[\s\S]*\]/);
        actionItems = match ? JSON.parse(match[0]) : [];
      } catch {}
    }

    // Insert action items into meeting_action_items table
    await ensurePhase7Tables(c.env.DB);
    for (const item of actionItems) {
      if (!item.action) continue;
      const itemId = generateId();
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO meeting_action_items (id, meeting_id, user_id, action, assignee, deadline) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(itemId, meetingId, userId, item.action, item.assignee || "", item.deadline || null).run();
    }

    await c.env.DB.prepare(
      "UPDATE meetings SET minutes = ?, action_items = ?, meeting_type = ?, status = 'completed' WHERE id = ?"
    ).bind(minutesRaw, JSON.stringify(actionItems), meetingType, meetingId).run();

    return c.json({ minutes: minutesRaw, actionItems, status: "completed" });
  } catch {
    return c.json({ error: "Minutes generation failed" }, 500);
  }
});

features.get("/api/meetings", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    "SELECT id, title, status, created_at FROM meetings WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
  ).bind(userId).all();
  return c.json({ meetings: results || [] });
});

features.get("/api/meetings/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const meeting = await c.env.DB.prepare(
    "SELECT * FROM meetings WHERE id = ? AND user_id = ?"
  ).bind(id, userId).first();
  if (!meeting) return c.json({ error: "Meeting not found" }, 404);
  return c.json({ meeting });
});

features.delete("/api/meetings/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM meetings WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return c.json({ success: true });
});

// ─── Meeting Recording (in-browser) ────────────────────────────────

features.post("/api/meetings/record", authMiddleware, async (c) => {
  const userId = c.get("userId");

  // Tier gate: Professional+ (honors trial)
  const user = await c.env.DB.prepare("SELECT tier, trial_expires_at FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string; trial_expires_at: string | null }>();
  let meetingTier = user?.tier || "free";
  if (meetingTier === "free" && user?.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date()) {
    meetingTier = "professional";
  }
  if (meetingTier === "free") {
    return c.json({ error: "Meeting Assistant requires a Professional plan or above.", code: "TIER_REQUIRED" }, 403);
  }

  const formData = await c.req.formData();
  const audio = formData.get("audio") as File | null;
  const title = (formData.get("title") as string) || "Recording " + new Date().toISOString().split("T")[0];
  const meetingType = (formData.get("meetingType") as string) || "general";

  if (!audio) return c.json({ error: "Audio recording is required" }, 400);
  if (audio.size > 25 * 1024 * 1024) return c.json({ error: "Recording must be under 25MB" }, 400);

  await ensurePhase7Tables(c.env.DB);
  const meetingId = generateId();
  await c.env.DB.prepare(
    "INSERT INTO meetings (id, user_id, title, meeting_type) VALUES (?, ?, ?, ?)"
  ).bind(meetingId, userId, title, meetingType).run();

  c.executionCtx.waitUntil(logUserAudit(c, "meeting_record", title, "@cf/openai/whisper"));

  try {
    const audioBytes = await audio.arrayBuffer();
    const transcript = await transcribeMeetingAudio(c.env.AI, audioBytes);

    await c.env.DB.prepare(
      "UPDATE meetings SET transcript = ?, status = 'transcribed' WHERE id = ?"
    ).bind(transcript, meetingId).run();

    c.executionCtx.waitUntil(trackProductivity(c, "meeting"));
    return c.json({ meetingId, transcript, status: "transcribed" });
  } catch {
    await c.env.DB.prepare("UPDATE meetings SET status = 'failed' WHERE id = ?").bind(meetingId).run();
    return c.json({ error: "Transcription failed. Please try a different recording." }, 500);
  }
});

// ─── Meeting Action Items ──────────────────────────────────────────

features.get("/api/meetings/action-items", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const statusFilter = c.req.query("status");

  await ensurePhase7Tables(c.env.DB);

  let sql = `SELECT ai.*, m.title as meeting_title FROM meeting_action_items ai
    JOIN meetings m ON m.id = ai.meeting_id
    WHERE ai.user_id = ?`;
  const params: string[] = [userId];

  if (statusFilter && ["pending", "in_progress", "done"].includes(statusFilter)) {
    sql += " AND ai.status = ?";
    params.push(statusFilter);
  }

  sql += " ORDER BY ai.created_at DESC LIMIT 100";

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ actionItems: results || [] });
});

features.put("/api/meetings/:id/action-items/:itemId", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const meetingId = c.req.param("id");
  const itemId = c.req.param("itemId");
  const { status } = await c.req.json();

  if (!status || !["pending", "in_progress", "done"].includes(status)) {
    return c.json({ error: "Invalid status. Must be pending, in_progress, or done" }, 400);
  }

  await ensurePhase7Tables(c.env.DB);

  const item = await c.env.DB.prepare(
    "SELECT id FROM meeting_action_items WHERE id = ? AND meeting_id = ? AND user_id = ?"
  ).bind(itemId, meetingId, userId).first();
  if (!item) return c.json({ error: "Action item not found" }, 404);

  const completedAt = status === "done" ? new Date().toISOString().replace("T", " ").split(".")[0] : null;
  await c.env.DB.prepare(
    "UPDATE meeting_action_items SET status = ?, completed_at = ? WHERE id = ?"
  ).bind(status, completedAt, itemId).run();

  return c.json({ success: true });
});

// ─── Meeting Search ────────────────────────────────────────────────

features.get("/api/meetings/search", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const q = (c.req.query("q") || "").trim();

  if (q.length < 2) return c.json({ error: "Search query must be at least 2 characters" }, 400);

  const pattern = `%${q}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, status, meeting_type, created_at,
     CASE WHEN title LIKE ? THEN 'title' WHEN transcript LIKE ? THEN 'transcript' ELSE 'minutes' END as match_field
     FROM meetings WHERE user_id = ? AND (title LIKE ? OR transcript LIKE ? OR minutes LIKE ?)
     ORDER BY created_at DESC LIMIT 20`
  ).bind(pattern, pattern, userId, pattern, pattern, pattern).all();

  return c.json({ results: results || [] });
});

// ═══════════════════════════════════════════════════════════════════
// Feature 11: Collaborative Spaces
// ═══════════════════════════════════════════════════════════════════

features.post("/api/spaces", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { name, description } = await c.req.json();
  if (!name) return c.json({ error: "name is required" }, 400);

  // Tier gate: Professional+ (honors trial)
  const user = await c.env.DB.prepare("SELECT tier, trial_expires_at FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string; trial_expires_at: string | null }>();
  let spaceTier = user?.tier || "free";
  if (spaceTier === "free" && user?.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date()) {
    spaceTier = "professional";
  }
  if (spaceTier === "free") {
    return c.json({ error: "Collaborative Spaces requires a Professional plan or above.", code: "TIER_REQUIRED" }, 403);
  }

  const id = generateId();
  await c.env.DB.prepare(
    "INSERT INTO spaces (id, name, description, owner_id) VALUES (?, ?, ?, ?)"
  ).bind(id, name, description || "", userId).run();

  // Add owner as admin member
  await c.env.DB.prepare(
    "INSERT INTO space_members (space_id, user_id, role) VALUES (?, ?, 'admin')"
  ).bind(id, userId).run();

  return c.json({ id, name, description });
});

features.get("/api/spaces", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.description, s.owner_id, s.created_at, sm.role,
     (SELECT COUNT(*) FROM space_members WHERE space_id = s.id) as member_count,
     (SELECT COUNT(*) FROM space_conversations WHERE space_id = s.id) as conversation_count
     FROM spaces s
     JOIN space_members sm ON sm.space_id = s.id AND sm.user_id = ?
     ORDER BY s.created_at DESC`
  ).bind(userId).all();
  return c.json({ spaces: results || [] });
});

features.get("/api/spaces/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const spaceId = c.req.param("id");

  // Verify membership
  const membership = await c.env.DB.prepare(
    "SELECT role FROM space_members WHERE space_id = ? AND user_id = ?"
  ).bind(spaceId, userId).first<{ role: string }>();
  if (!membership) return c.json({ error: "Not a member of this space" }, 403);

  const space = await c.env.DB.prepare("SELECT * FROM spaces WHERE id = ?").bind(spaceId).first();
  const { results: members } = await c.env.DB.prepare(
    "SELECT sm.user_id, sm.role, sm.joined_at, u.full_name, u.email, u.department FROM space_members sm JOIN users u ON u.id = sm.user_id WHERE sm.space_id = ?"
  ).bind(spaceId).all();
  const { results: conversations } = await c.env.DB.prepare(
    "SELECT sc.conversation_id, sc.shared_at, sc.shared_by, c.title, u.full_name as shared_by_name FROM space_conversations sc JOIN conversations c ON c.id = sc.conversation_id JOIN users u ON u.id = sc.shared_by WHERE sc.space_id = ? ORDER BY sc.shared_at DESC"
  ).bind(spaceId).all();

  return c.json({ space, members: members || [], conversations: conversations || [], userRole: membership.role });
});

features.post("/api/spaces/:id/invite", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const spaceId = c.req.param("id");
  const { email, role } = await c.req.json();

  // Verify admin
  const membership = await c.env.DB.prepare(
    "SELECT role FROM space_members WHERE space_id = ? AND user_id = ?"
  ).bind(spaceId, userId).first<{ role: string }>();
  if (!membership || membership.role !== "admin") return c.json({ error: "Only admins can invite members" }, 403);

  const invitee = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email.toLowerCase().trim()).first<{ id: string }>();
  if (!invitee) return c.json({ error: "User not found. They must have an AskOzzy account." }, 404);

  const existing = await c.env.DB.prepare(
    "SELECT user_id FROM space_members WHERE space_id = ? AND user_id = ?"
  ).bind(spaceId, invitee.id).first();
  if (existing) return c.json({ error: "User is already a member" }, 400);

  // Limit space members (Professional: 20, Enterprise: 100)
  const memberCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM space_members WHERE space_id = ?"
  ).bind(spaceId).first<{ cnt: number }>();
  const inviter = await c.env.DB.prepare("SELECT tier FROM users WHERE id = ?").bind(userId).first<{ tier: string }>();
  const maxMembers = inviter?.tier === "enterprise" ? 100 : 20;
  if (memberCount && memberCount.cnt >= maxMembers) {
    return c.json({ error: `Space member limit reached (${maxMembers}). Upgrade for more.` }, 400);
  }

  await c.env.DB.prepare(
    "INSERT INTO space_members (space_id, user_id, role) VALUES (?, ?, ?)"
  ).bind(spaceId, invitee.id, role || "member").run();

  return c.json({ success: true });
});

features.post("/api/spaces/:id/share-conversation", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const spaceId = c.req.param("id");
  const { conversationId } = await c.req.json();

  // Verify membership
  const membership = await c.env.DB.prepare(
    "SELECT role FROM space_members WHERE space_id = ? AND user_id = ?"
  ).bind(spaceId, userId).first();
  if (!membership) return c.json({ error: "Not a member of this space" }, 403);

  // Verify conversation ownership
  const convo = await c.env.DB.prepare(
    "SELECT id FROM conversations WHERE id = ? AND user_id = ?"
  ).bind(conversationId, userId).first();
  if (!convo) return c.json({ error: "Conversation not found" }, 404);

  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO space_conversations (space_id, conversation_id, shared_by) VALUES (?, ?, ?)"
  ).bind(spaceId, conversationId, userId).run();

  return c.json({ success: true });
});

features.delete("/api/spaces/:id/members/:memberId", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const spaceId = c.req.param("id");
  const memberId = c.req.param("memberId");

  const membership = await c.env.DB.prepare(
    "SELECT role FROM space_members WHERE space_id = ? AND user_id = ?"
  ).bind(spaceId, userId).first<{ role: string }>();
  if (!membership || membership.role !== "admin") return c.json({ error: "Only admins can remove members" }, 403);

  await c.env.DB.prepare(
    "DELETE FROM space_members WHERE space_id = ? AND user_id = ?"
  ).bind(spaceId, memberId).run();
  return c.json({ success: true });
});

features.delete("/api/spaces/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const spaceId = c.req.param("id");

  const space = await c.env.DB.prepare(
    "SELECT owner_id FROM spaces WHERE id = ?"
  ).bind(spaceId).first<{ owner_id: string }>();
  if (!space || space.owner_id !== userId) return c.json({ error: "Only the owner can delete a space" }, 403);

  await c.env.DB.prepare("DELETE FROM space_conversations WHERE space_id = ?").bind(spaceId).run();
  await c.env.DB.prepare("DELETE FROM space_members WHERE space_id = ?").bind(spaceId).run();
  await c.env.DB.prepare("DELETE FROM spaces WHERE id = ?").bind(spaceId).run();
  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════
// Smart Upgrade Nudges
// ═══════════════════════════════════════════════════════════════════

features.get("/api/usage/nudge", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureSubscriptionColumns(c.env.DB);
  const user = await c.env.DB.prepare("SELECT tier, trial_expires_at, subscription_expires_at FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string; trial_expires_at: string | null; subscription_expires_at: string | null }>();

  const effectiveTier = getEffectiveTier({ tier: user?.tier || "free", trial_expires_at: user?.trial_expires_at || null, subscription_expires_at: user?.subscription_expires_at || null });

  if (effectiveTier !== "free") return c.json({ nudge: null, effectiveTier });

  const usage = await checkUsageLimit(c.env.DB, userId, effectiveTier);
  if (usage.limit <= 0) return c.json({ nudge: null, effectiveTier });

  const remaining = usage.limit - usage.used;
  const pct = usage.used / usage.limit;

  let nudge = null;
  if (remaining <= 0) {
    nudge = { type: "limit_reached", used: usage.used, limit: usage.limit, remaining: 0, message: "You've reached your daily limit. Upgrade to Professional for 200 messages/day." };
  } else if (pct >= 0.8) {
    nudge = { type: "almost_there", used: usage.used, limit: usage.limit, remaining, message: `Only ${remaining} message${remaining === 1 ? '' : 's'} left today. Upgrade to Professional for 200/day.` };
  } else if (pct >= 0.5) {
    nudge = { type: "halfway", used: usage.used, limit: usage.limit, remaining, message: `${remaining} messages remaining today. Professional plan gives you 200/day.` };
  }

  return c.json({ nudge, effectiveTier });
});

// ═══════════════════════════════════════════════════════════════════
// Daily Streaks & Badges
// ═══════════════════════════════════════════════════════════════════

features.get("/api/streaks", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureStreakColumns(c.env.DB);

  const user = await c.env.DB.prepare(
    "SELECT current_streak, longest_streak, last_active_date, badges, total_referrals FROM users WHERE id = ?"
  ).bind(userId).first<{ current_streak: number; longest_streak: number; last_active_date: string | null; badges: string; total_referrals: number }>();

  if (!user) return c.json({ error: "User not found" }, 404);

  let badges: string[] = [];
  try { badges = JSON.parse(user.badges || "[]"); } catch { badges = []; }

  // Count total messages for message-based badges
  const msgCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM conversations WHERE user_id = ?"
  ).bind(userId).first<{ cnt: number }>();

  // Check message badges
  const msgBadges = [
    { id: "messages_10", threshold: 10 },
    { id: "messages_50", threshold: 50 },
    { id: "messages_100", threshold: 100 },
    { id: "messages_500", threshold: 500 },
  ];

  let updated = false;
  for (const b of msgBadges) {
    if (!badges.includes(b.id) && (msgCount?.cnt || 0) >= b.threshold) {
      badges.push(b.id);
      updated = true;
    }
  }

  // Referral badges
  const refBadges = [
    { id: "referral_1", threshold: 1 },
    { id: "referral_5", threshold: 5 },
    { id: "referral_10", threshold: 10 },
  ];
  for (const b of refBadges) {
    if (!badges.includes(b.id) && (user.total_referrals || 0) >= b.threshold) {
      badges.push(b.id);
      updated = true;
    }
  }

  if (updated) {
    await c.env.DB.prepare("UPDATE users SET badges = ? WHERE id = ?")
      .bind(JSON.stringify(badges), userId).run();
  }

  // Calculate today check
  const today = new Date().toISOString().split("T")[0];
  const activeToday = user.last_active_date === today;

  return c.json({
    currentStreak: user.current_streak || 0,
    longestStreak: user.longest_streak || 0,
    lastActiveDate: user.last_active_date,
    activeToday,
    badges,
    totalConversations: msgCount?.cnt || 0,
  });
});

// ═══════════════════════════════════════════════════════════════════
// Prompt Engineering 101 Course
// ═══════════════════════════════════════════════════════════════════

features.get("/api/prompt-course/progress", authMiddleware, async (c) => {
  const userId = c.get("userId");
  try {
    await ensureUserProfilesTable(c.env.DB);
    await ensurePromptCourseColumn(c.env.DB);
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)"
    ).bind(userId).run();
    const row = await c.env.DB.prepare(
      "SELECT prompt_course_progress FROM user_profiles WHERE user_id = ?"
    ).bind(userId).first<{ prompt_course_progress: string | null }>();
    const progress = row?.prompt_course_progress ? JSON.parse(row.prompt_course_progress) : {};
    return c.json({ progress });
  } catch (err: any) {
    log("error", "Prompt course progress error", { error: err.message });
    return c.json({ error: "Failed to load progress" }, 500);
  }
});

features.post("/api/prompt-course/grade", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { moduleId, exerciseId, userPrompt, exerciseBrief, exerciseContext } = await c.req.json();

  if (!userPrompt || userPrompt.trim().length < 15) {
    return c.json({ error: "Please write a more detailed prompt (at least 15 characters)" }, 400);
  }
  if (!moduleId || !exerciseId) {
    return c.json({ error: "Missing module or exercise ID" }, 400);
  }

  const gradingPrompt = `You are an expert prompt engineering instructor. Grade this student's prompt attempt.

EXERCISE: ${String(exerciseBrief || "").substring(0, 500)}
CONTEXT: ${String(exerciseContext || "").substring(0, 500)}

STUDENT'S PROMPT:
${userPrompt.substring(0, 2000)}

Score on these 4 axes (each 1-10):
1. Clarity — Is the intent obvious and unambiguous?
2. Specificity — Does it include concrete details, constraints, and scope?
3. Structure — Is it well-organized with role, task, context, and format?
4. Effectiveness — Would this prompt produce a high-quality AI response?

Also provide:
- feedback: 2-3 sentences of constructive feedback
- grade: letter grade (A/B/C/D/F)
- improvedVersion: rewrite their prompt to demonstrate best practices

Return ONLY a JSON object:
{"clarity": N, "specificity": N, "structure": N, "effectiveness": N, "feedback": "...", "grade": "X", "improvedVersion": "..."}`;

  try {
    const aiResponse = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
      messages: [
        { role: "system", content: "You are a prompt engineering instructor. Return ONLY valid JSON, no markdown." },
        { role: "user", content: gradingPrompt },
      ],
      max_tokens: 800,
    });

    const raw = (aiResponse as any)?.response || "";
    let scores = { clarity: 5, specificity: 5, structure: 5, effectiveness: 5, feedback: "Grading completed.", grade: "C", improvedVersion: "" };

    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        scores.clarity = Math.min(10, Math.max(1, parseInt(parsed.clarity) || 5));
        scores.specificity = Math.min(10, Math.max(1, parseInt(parsed.specificity) || 5));
        scores.structure = Math.min(10, Math.max(1, parseInt(parsed.structure) || 5));
        scores.effectiveness = Math.min(10, Math.max(1, parseInt(parsed.effectiveness) || 5));
        scores.feedback = String(parsed.feedback || "").substring(0, 2000) || "Grading completed.";
        scores.grade = ["A", "B", "C", "D", "F"].includes(parsed.grade) ? parsed.grade : "C";
        scores.improvedVersion = String(parsed.improvedVersion || "").substring(0, 3000);
      }
    } catch {}

    const totalScore = scores.clarity + scores.specificity + scores.structure + scores.effectiveness;

    // Save progress
    try {
      await ensureUserProfilesTable(c.env.DB);
      await ensurePromptCourseColumn(c.env.DB);
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)"
      ).bind(userId).run();
      const row = await c.env.DB.prepare(
        "SELECT prompt_course_progress FROM user_profiles WHERE user_id = ?"
      ).bind(userId).first<{ prompt_course_progress: string | null }>();
      const progress = row?.prompt_course_progress ? JSON.parse(row.prompt_course_progress) : {};
      if (!progress[moduleId] || (progress[moduleId].totalScore || 0) < totalScore) {
        progress[moduleId] = { exerciseId, totalScore, maxScore: 40, grade: scores.grade, completedAt: new Date().toISOString() };
      }
      await c.env.DB.prepare(
        "UPDATE user_profiles SET prompt_course_progress = ?, updated_at = datetime('now') WHERE user_id = ?"
      ).bind(JSON.stringify(progress), userId).run();
    } catch (saveErr: any) {
      log("error", "Progress save error", { error: saveErr.message });
    }

    c.executionCtx.waitUntil(trackProductivity(c, "prompt_course_exercise"));

    return c.json({
      scores: { clarity: scores.clarity, specificity: scores.specificity, structure: scores.structure, effectiveness: scores.effectiveness },
      totalScore,
      maxScore: 40,
      grade: scores.grade,
      feedback: scores.feedback,
      improvedVersion: scores.improvedVersion,
    });
  } catch (err: any) {
    log("error", "Prompt course grading error", { error: err?.message });
    return c.json({ error: "Grading failed. Please try again." }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════
// Discover News Feed
// ═══════════════════════════════════════════════════════════════════

features.get("/api/discover", async (c) => {
  const category = c.req.query("category");
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "20")));
  const offset = (page - 1) * limit;

  // When showing "all", enforce 70% local (ghana/africa) + 30% global ratio
  if (!category || category === "all") {
    const localLimit = Math.ceil(limit * 0.7);
    const globalLimit = limit - localLimit;
    const localOffset = Math.ceil(offset * 0.7);
    const globalOffset = offset - localOffset;

    const [localArticles, globalArticles, countResult] = await Promise.all([
      c.env.DB.prepare(
        `SELECT * FROM discover_articles WHERE category IN ('ghana', 'africa')
         ORDER BY published_at DESC LIMIT ? OFFSET ?`
      ).bind(localLimit, localOffset).all(),
      c.env.DB.prepare(
        `SELECT * FROM discover_articles WHERE category NOT IN ('ghana', 'africa')
         ORDER BY published_at DESC LIMIT ? OFFSET ?`
      ).bind(globalLimit, globalOffset).all(),
      c.env.DB.prepare(
        "SELECT COUNT(*) as total FROM discover_articles"
      ).first<{ total: number }>(),
    ]);

    // Interleave: 2-3 local articles, then 1 global, repeat
    const merged: unknown[] = [];
    let li = 0, gi = 0;
    const localResults = localArticles.results || [];
    const globalResults = globalArticles.results || [];
    while (li < localResults.length || gi < globalResults.length) {
      // Add 2 local
      if (li < localResults.length) merged.push(localResults[li++]);
      if (li < localResults.length) merged.push(localResults[li++]);
      // Add 1 global
      if (gi < globalResults.length) merged.push(globalResults[gi++]);
    }

    const total = countResult?.total || 0;
    return c.json({
      articles: merged,
      total,
      page,
      hasMore: offset + limit < total,
    });
  }

  // Specific category — return as-is
  const query = "SELECT * FROM discover_articles WHERE category = ? ORDER BY published_at DESC LIMIT ? OFFSET ?";
  const countQuery = "SELECT COUNT(*) as total FROM discover_articles WHERE category = ?";

  const [articles, countResult] = await Promise.all([
    c.env.DB.prepare(query).bind(category, limit, offset).all(),
    c.env.DB.prepare(countQuery).bind(category).first<{ total: number }>(),
  ]);

  const total = countResult?.total || 0;

  return c.json({
    articles: articles.results,
    total,
    page,
    hasMore: offset + limit < total,
  });
});

features.post("/api/discover/discuss", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { articleId } = await c.req.json();

  if (!articleId) {
    return c.json({ error: "articleId is required" }, 400);
  }

  const article = await c.env.DB.prepare(
    "SELECT * FROM discover_articles WHERE id = ?"
  ).bind(articleId).first();

  if (!article) {
    return c.json({ error: "Article not found" }, 404);
  }

  const convoId = generateId();
  const title = `Discussing: ${(article.title as string).substring(0, 80)}`;

  await c.env.DB.prepare(
    "INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)"
  ).bind(convoId, userId, title).run();

  // Insert article context as the first assistant message
  const contextMessage = `\u{1F4F0} **${article.title}**\n*Source: ${article.source_name} \u00B7 ${article.published_at}*\n\n${article.description || ""}\n\n\u{1F517} [Read full article](${article.article_url})\n\nI've read this article summary. What would you like to know or discuss about it?`;

  const msgId = generateId();
  await c.env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'assistant', ?)"
  ).bind(msgId, convoId, contextMessage).run();

  return c.json({ conversationId: convoId, title });
});

export default features;
