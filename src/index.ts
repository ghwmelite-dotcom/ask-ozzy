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
  checkRateLimit, authMiddleware, adminMiddleware, deptAdminMiddleware,
} from "./lib/middleware";

const app = new Hono<AppType>();

app.use("/api/*", cors({
  origin: (origin) => {
    const allowed = ["https://askozzy.ghwmelite.workers.dev"];
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
  c.header("Content-Security-Policy", "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://cdn.jsdelivr.net; frame-ancestors 'none'; base-uri 'self'; form-action 'self';");
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

// ─── Auth Routes ────────────────────────────────────────────────────

app.post("/api/auth/register", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const rl = await checkRateLimit(c.env, ip, "auth");
  if (!rl.allowed) return c.json({ error: "Too many registration attempts. Try again later." }, 429);

  const { email, fullName, department, referralCode, userType } = await c.req.json();

  if (!email || !fullName) {
    return c.json({ error: "Email and full name are required" }, 400);
  }

  if (!referralCode || !referralCode.trim()) {
    return c.json({ error: "Referral code is required" }, 400);
  }

  const existing = await c.env.DB.prepare(
    "SELECT id FROM users WHERE email = ?"
  )
    .bind(email.toLowerCase().trim())
    .first();

  if (existing) {
    return c.json({ error: "An account with this email already exists" }, 409);
  }

  const userId = generateId();
  const accessCode = generateAccessCode();
  const passwordHash = await hashPassword(accessCode);

  // Generate unique referral code for this user: OZZY-FIRSTNAME-XXXX
  const firstName = fullName.split(" ")[0].toUpperCase();
  const suffix = generateReferralSuffix();
  const userReferralCode = `OZZY-${firstName}-${suffix}`;

  // Determine referral source: 'affiliate' (real user code) or 'system' (auto-generated)
  let referredBy: string | null = null;
  const isSystemReferral = referralCode.trim().toUpperCase().startsWith("OZZY-SYSTEM-");
  const referralSource = isSystemReferral ? "system" : "affiliate";

  if (!isSystemReferral && referralCode.trim()) {
    const referrer = await c.env.DB.prepare(
      "SELECT id FROM users WHERE referral_code = ?"
    )
      .bind(referralCode.trim().toUpperCase())
      .first<{ id: string }>();

    if (referrer) {
      referredBy = referrer.id;
    }
  }

  // Auto-generate TOTP secret
  const secretBytes = new Uint8Array(20);
  crypto.getRandomValues(secretBytes);
  const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let totpSecret = "";
  for (let i = 0; i < secretBytes.length; i++) {
    totpSecret += base32Chars[secretBytes[i] % 32];
  }

  // Generate one-time recovery code
  const recoveryCode = generateRecoveryCode();
  const recoveryCodeHash = await hashPassword(recoveryCode);

  await ensureUserTypeColumn(c.env.DB);
  await ensureAuthMethodColumns(c.env.DB);
  await ensureReferralSourceColumn(c.env.DB);
  await c.env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, full_name, department, referral_code, referred_by, user_type, totp_secret, auth_method, recovery_code_hash, referral_source, submitted_referral_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'totp', ?, ?, ?)"
  )
    .bind(userId, email.toLowerCase().trim(), passwordHash, fullName, department || "", userReferralCode, referredBy, userType || "gog_employee", totpSecret, recoveryCodeHash, referralSource, referralCode.trim().toUpperCase())
    .run();

  // If referred, record the referral, credit welcome bonus, and check milestones
  if (referredBy) {
    await c.env.DB.prepare(
      "INSERT INTO referrals (id, referrer_id, referred_id, status, bonus_amount) VALUES (?, ?, ?, 'completed', 0.00)"
    )
      .bind(generateId(), referredBy, userId)
      .run();

    await c.env.DB.prepare(
      "UPDATE users SET total_referrals = total_referrals + 1 WHERE id = ?"
    )
      .bind(referredBy)
      .run();

    c.executionCtx.waitUntil((async () => {
      try {
        await ensureAffiliateTables(c.env.DB);
        await creditWallet(
          c.env.DB, userId, 5.00, "bonus",
          "Welcome bonus — signed up with referral code", referredBy, undefined
        );
        await checkMilestones(c.env.DB, referredBy);
      } catch (err) {
        console.error("Referral bonus error:", err);
      }
    })());
  }

  const totpUri = `otpauth://totp/AskOzzy:${email.toLowerCase().trim()}?secret=${totpSecret}&issuer=AskOzzy&digits=6&period=30`;

  // Don't create token yet — user must verify TOTP first
  // Note: totpSecret removed from response (totpUri contains it for QR scanning)
  // Recovery code shown after TOTP verification succeeds for security
  return c.json({
    totpUri,
    email: email.toLowerCase().trim(),
    fullName,
    department: department || "",
    referralCode: userReferralCode,
    userType: userType || "gog_employee",
  });
});

// ─── Verify TOTP After Registration ──────────────────────────────────

app.post("/api/auth/register/verify-totp", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const rl = await checkRateLimit(c.env, `${ip}:totp`, "auth");
  if (!rl.allowed) return c.json({ error: "Too many verification attempts. Try again later." }, 429);

  const { email, code } = await c.req.json();

  if (!email || !code) {
    return c.json({ error: "Email and verification code are required" }, 400);
  }

  const user = await c.env.DB.prepare(
    "SELECT id, email, full_name, department, role, tier, referral_code, totp_secret, totp_enabled, user_type FROM users WHERE email = ?"
  )
    .bind(email.toLowerCase().trim())
    .first<{
      id: string; email: string; full_name: string; department: string;
      role: string; tier: string; referral_code: string; totp_secret: string;
      totp_enabled: number; user_type: string | null;
    }>();

  if (!user || !user.totp_secret) {
    return c.json({ error: "User not found or TOTP not configured" }, 400);
  }

  const valid = await verifyTOTP(user.totp_secret, code);
  if (!valid) {
    return c.json({ error: "Invalid verification code. Check your authenticator app and try again." }, 400);
  }

  // Enable TOTP and set auth_method
  await ensureAuthMethodColumns(c.env.DB);
  await c.env.DB.prepare(
    "UPDATE users SET totp_enabled = 1, auth_method = 'totp' WHERE id = ?"
  ).bind(user.id).run();

  const token = await createToken(user.id, c.env);

  // Regenerate recovery code to return it here (only time it's shown)
  const newRecoveryCode = generateRecoveryCode();
  const newRecoveryHash = await hashPassword(newRecoveryCode);
  await c.env.DB.prepare("UPDATE users SET recovery_code_hash = ? WHERE id = ?")
    .bind(newRecoveryHash, user.id).run();

  return c.json({
    token,
    recoveryCode: newRecoveryCode,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      department: user.department,
      role: user.role || "civil_servant",
      tier: user.tier || "free",
      effectiveTier: user.tier || "free",
      referralCode: user.referral_code,
      userType: user.user_type || "gog_employee",
    },
  });
});

app.post("/api/auth/login", async (c) => {
  const { email, password, accessCode, totpCode } = await c.req.json();
  const credential = totpCode || accessCode || password;

  if (!email || !credential) {
    return c.json({ error: "Email and authentication code are required" }, 400);
  }

  // Rate limit login attempts
  const clientIP = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
  const rateCheck = await checkRateLimit(c.env, `${clientIP}:${email}`, "auth");
  if (!rateCheck.allowed) {
    return c.json({ error: "Too many login attempts. Please wait 5 minutes." }, 429);
  }

  await ensureTrialColumn(c.env.DB);
  await ensureUserTypeColumn(c.env.DB);
  await ensureAuthMethodColumns(c.env.DB);
  const user = await c.env.DB.prepare(
    "SELECT id, email, password_hash, full_name, department, role, tier, referral_code, affiliate_tier, total_referrals, affiliate_earnings, trial_expires_at, user_type, totp_secret, totp_enabled, auth_method, recovery_code_hash FROM users WHERE email = ?"
  )
    .bind(email.toLowerCase().trim())
    .first<{
      id: string; email: string; password_hash: string; full_name: string;
      department: string; role: string; tier: string; referral_code: string;
      affiliate_tier: string; total_referrals: number; affiliate_earnings: number;
      trial_expires_at: string | null; user_type: string | null;
      totp_secret: string | null; totp_enabled: number; auth_method: string | null;
      recovery_code_hash: string | null;
    }>();

  if (!user) {
    return c.json({ error: "Invalid email or authentication code" }, 401);
  }

  const trimmedCred = credential.trim();
  const isNumericCode = /^\d{6}$/.test(trimmedCred);
  let authenticated = false;
  let legacyAuth = false;
  let recoveryUsed = false;

  if (isNumericCode && user.totp_secret && user.totp_enabled) {
    // TOTP login: 6-digit numeric code
    authenticated = await verifyTOTP(user.totp_secret, trimmedCred);
  }

  if (!authenticated) {
    // Try as access code
    const normalized = normalizeAccessCode(trimmedCred);
    if (await verifyPassword(normalized, user.password_hash)) {
      authenticated = true;
      legacyAuth = true;
    }

    // Fallback: try raw credential
    if (!authenticated && normalized !== trimmedCred) {
      if (await verifyPassword(trimmedCred, user.password_hash)) {
        authenticated = true;
        legacyAuth = true;
      }
    }

    // Try as recovery code
    if (!authenticated && user.recovery_code_hash) {
      const recoveryNormalized = normalizeAccessCode(trimmedCred);
      if (await verifyPassword(recoveryNormalized, user.recovery_code_hash)) {
        authenticated = true;
        recoveryUsed = true;
      }
      if (!authenticated) {
        if (await verifyPassword(trimmedCred, user.recovery_code_hash)) {
          authenticated = true;
          recoveryUsed = true;
        }
      }
    }
  }

  if (!authenticated) {
    return c.json({ error: "Invalid email or authentication code" }, 401);
  }

  // Re-hash legacy SHA-256 credentials to PBKDF2 on successful login
  if (authenticated && legacyAuth && !user.password_hash.startsWith("pbkdf2:")) {
    const credential = normalizeAccessCode(trimmedCred);
    const newHash = await hashPassword(await verifyPassword(credential, user.password_hash) ? credential : trimmedCred);
    await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, user.id).run();
  }

  // If recovery code used, invalidate it (one-time use)
  if (recoveryUsed) {
    await c.env.DB.prepare(
      "UPDATE users SET recovery_code_hash = NULL WHERE id = ?"
    ).bind(user.id).run();
  }

  await c.env.DB.prepare(
    "UPDATE users SET last_login = datetime('now') WHERE id = ?"
  ).bind(user.id).run();

  const token = await createToken(user.id, c.env);

  // Compute effective tier honoring trial
  const trialActive = user.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date();
  const effectiveTier = (trialActive && (user.tier || "free") === "free") ? "professional" : (user.tier || "free");

  return c.json({
    token,
    legacyAuth,
    recoveryUsed,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      department: user.department,
      role: user.role || "civil_servant",
      tier: user.tier,
      effectiveTier,
      referralCode: user.referral_code,
      affiliateTier: user.affiliate_tier,
      totalReferrals: user.total_referrals,
      affiliateEarnings: user.affiliate_earnings,
      trialExpiresAt: user.trial_expires_at || null,
      userType: user.user_type || "gog_employee",
    },
  });
});

app.post("/api/auth/logout", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    await c.env.SESSIONS.delete(`session:${token}`);
  }
  return c.json({ success: true });
});

// ─── Conversation Routes ────────────────────────────────────────────

app.get("/api/conversations", authMiddleware, async (c) => {
  const userId = c.get("userId");

  const { results } = await c.env.DB.prepare(
    "SELECT id, title, template_id, model, folder_id, pinned, agent_id, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT 50"
  )
    .bind(userId)
    .all();

  return c.json({ conversations: results });
});

app.post("/api/conversations", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { title, templateId, model, agentId } = await c.req.json();
  const convoId = generateId();

  await c.env.DB.prepare(
    "INSERT INTO conversations (id, user_id, title, template_id, model, agent_id) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(
      convoId,
      userId,
      title || "New Conversation",
      templateId || null,
      model || "@cf/meta/llama-4-scout-17b-16e-instruct",
      agentId || null
    )
    .run();

  return c.json({ id: convoId, title: title || "New Conversation", agentId: agentId || null });
});

app.delete("/api/conversations/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const convoId = c.req.param("id");

  await c.env.DB.prepare(
    "DELETE FROM conversations WHERE id = ? AND user_id = ?"
  )
    .bind(convoId, userId)
    .run();

  return c.json({ success: true });
});

// ─── Message Routes ─────────────────────────────────────────────────

app.get("/api/conversations/:id/messages", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const convoId = c.req.param("id");

  // Verify ownership
  const convo = await c.env.DB.prepare(
    "SELECT id FROM conversations WHERE id = ? AND user_id = ?"
  )
    .bind(convoId, userId)
    .first();

  if (!convo) {
    return c.json({ error: "Conversation not found" }, 404);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT id, role, content, model, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
  )
    .bind(convoId)
    .all();

  return c.json({ messages: results });
});

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
    models: "all",
    features: ["200 messages/day", "All 10 AI models", "Priority speed", "Unlimited history", "Template customisation"],
  },
  enterprise: {
    name: "Enterprise",
    price: 100,
    studentPrice: 45,
    messagesPerDay: -1, // unlimited
    models: "all",
    features: ["Unlimited messages", "All 10 AI models", "Fastest priority", "Unlimited history", "Custom templates", "Dedicated support"],
  },
};

const FREE_TIER_MODELS = [
  "@cf/openai/gpt-oss-20b",
  "@cf/google/gemma-3-12b-it",
  "@cf/meta/llama-3.1-8b-instruct-fast",
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

// ─── Push Subscriptions Table Lazy Migration ────────────────────────

let pushSubsTableExists = false;
async function ensurePushSubscriptionsTable(db: D1Database) {
  if (pushSubsTableExists) return;
  try {
    await db.prepare("SELECT id FROM push_subscriptions LIMIT 1").first();
    pushSubsTableExists = true;
  } catch {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        notify_announcements INTEGER DEFAULT 1,
        notify_queue_sync INTEGER DEFAULT 1,
        notify_shared_chat INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id)"),
    ]);
    pushSubsTableExists = true;
  }
}

// ─── Effective Tier (honors trial) ──────────────────────────────────

async function getEffectiveTier(db: D1Database, userId: string): Promise<string> {
  const user = await db.prepare(
    "SELECT tier, trial_expires_at FROM users WHERE id = ?"
  ).bind(userId).first<{ tier: string; trial_expires_at: string | null }>();
  if (!user) return "free";
  if (user.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date()) {
    return "professional";
  }
  return user.tier || "free";
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
- For document drafting, follow GoG formatting standards above`;

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
- Structure responses with clear headings, bullet points, and numbered steps`;

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

async function searchKnowledge(env: Env, query: string, topK = 5): Promise<{
  ragResults: Array<{ content: string; score: number; source: string; title: string; category: string }>;
  faqResults: Array<{ question: string; answer: string; category: string }>;
}> {
  const ragResults: Array<{ content: string; score: number; source: string; title: string; category: string }> = [];
  let faqResults: Array<{ question: string; answer: string; category: string }> = [];

  // RAG: Embed query and search Vectorize
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
  } catch (e) {
    // Graceful degradation — Vectorize may be empty or unavailable
  }

  // FAQ: Keyword search in D1 knowledge_base
  try {
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (keywords.length > 0) {
      const likeClauses = keywords.slice(0, 5).map(() => '(keywords LIKE ? OR question LIKE ?)').join(' OR ');
      const params = keywords.slice(0, 5).flatMap(kw => [`%${kw}%`, `%${kw}%`]);

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

function buildAugmentedPrompt(
  base: string,
  ragResults: Array<{ content: string; score: number; source: string; title: string; category: string }>,
  faqResults: Array<{ question: string; answer: string; category: string }>
): string {
  let prompt = base;

  if (ragResults.length > 0) {
    prompt += '\n\n--- RELEVANT KNOWLEDGE BASE CONTEXT (cite sources when using this information) ---\n';
    prompt += 'The following excerpts are from official GoG documents and may be relevant to the user\'s query. Use them to provide accurate, well-sourced answers. When citing information from the knowledge base, reference the source document title and category using the format: [Source: Document Title, Category].\n\n';
    for (const r of ragResults) {
      prompt += `[Source: ${r.title} | Category: ${r.category}]\n${r.content}\n\n`;
    }
  }

  if (faqResults.length > 0) {
    prompt += '\n--- FREQUENTLY ASKED QUESTIONS ---\n';
    prompt += 'These FAQ entries may directly address the user\'s question:\n\n';
    for (const f of faqResults) {
      prompt += `Q: ${f.question}\nA: ${f.answer}\n[Category: ${f.category}]\n\n`;
    }
  }

  if (ragResults.length > 0 || faqResults.length > 0) {
    prompt += '---\nIMPORTANT: When using the above context, ALWAYS cite the source document title and category in your response using the format [Source: Document Title, Category]. If the context does not fully answer the question, supplement with your general knowledge of GoG procedures but clearly distinguish between cited knowledge base content and general knowledge.';
  }

  return prompt;
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
    console.error("Web search failed:", e);
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
app.post("/api/web-search", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { query } = await c.req.json();

  if (!query) return c.json({ error: "query is required" }, 400);

  const user = await c.env.DB.prepare("SELECT tier FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string }>();
  const userTier = user?.tier || "free";

  const wsLimit = await checkWebSearchLimit(c.env, userId, userTier);
  if (!wsLimit.allowed) {
    return c.json({
      error: `Web search limit reached (${wsLimit.limit}/day). Upgrade for unlimited searches.`,
      code: "WEB_SEARCH_LIMIT",
    }, 429);
  }

  const results = await webSearch(query);
  await incrementWebSearchCount(c.env, userId);

  return c.json({ results });
});

// ─── Chat (Streaming) ──────────────────────────────────────────────

app.post("/api/chat", authMiddleware, async (c) => {
  const userId = c.get("userId");

  // Rate limit chat requests
  const chatRateCheck = await checkRateLimit(c.env, userId, "chat");
  if (!chatRateCheck.allowed) {
    return c.json({ error: "Too many requests. Please slow down.", code: "RATE_LIMITED" }, 429);
  }

  const { conversationId, message, model, systemPrompt, agentId, webSearch: webSearchEnabled, language } = await c.req.json();

  if (!conversationId || !message) {
    return c.json({ error: "conversationId and message are required" }, 400);
  }

  if (message && message.length > 50000) {
    return c.json({ error: "Message too long (max 50,000 characters)" }, 400);
  }

  // Get user tier and type (with trial support)
  await ensureUserTypeColumn(c.env.DB);
  const user = await c.env.DB.prepare("SELECT tier, trial_expires_at, user_type FROM users WHERE id = ?")
    .bind(userId)
    .first<{ tier: string; trial_expires_at: string | null; user_type: string | null }>();
  let userTier = user?.tier || "free";
  // Honor trial
  const trialActive = user?.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date();
  if (trialActive && userTier === "free") userTier = "professional";

  // Check daily usage limit
  const usage = await checkUsageLimit(c.env.DB, userId, userTier);
  if (!usage.allowed) {
    const tierConfig = PRICING_TIERS[userTier] || PRICING_TIERS.free;
    return c.json({
      error: `Daily message limit reached (${usage.limit} messages). Upgrade your plan for more.`,
      code: "LIMIT_REACHED",
      used: usage.used,
      limit: usage.limit,
      tier: userTier,
    }, 429);
  }

  // Verify ownership
  const convo = await c.env.DB.prepare(
    "SELECT id, model FROM conversations WHERE id = ? AND user_id = ?"
  )
    .bind(conversationId, userId)
    .first<{ id: string; model: string }>();

  if (!convo) {
    return c.json({ error: "Conversation not found" }, 404);
  }

  let selectedModel = model || convo.model || "@cf/meta/llama-4-scout-17b-16e-instruct";

  // Free tier: restrict to basic models
  if (userTier === "free" && !FREE_TIER_MODELS.includes(selectedModel)) {
    selectedModel = "@cf/openai/gpt-oss-20b"; // fallback to best free model
  }

  // Save user message
  const userMsgId = generateId();
  await c.env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', ?)"
  )
    .bind(userMsgId, conversationId, message)
    .run();

  // Auto-flag user message for moderation
  c.executionCtx.waitUntil(checkModeration(c.env.DB, conversationId, userMsgId, userId, message));

  // Audit trail: log chat action (non-blocking)
  c.executionCtx.waitUntil(logUserAudit(c, "chat", message, selectedModel));

  // Track productivity (non-blocking)
  c.executionCtx.waitUntil(trackProductivity(c, "chat"));

  // Update daily streak (non-blocking)
  c.executionCtx.waitUntil(updateUserStreak(c.env.DB, userId));

  // Get conversation history (last 20 messages for context)
  const { results: history } = await c.env.DB.prepare(
    "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20"
  )
    .bind(conversationId)
    .all<{ role: string; content: string }>();

  const messages: Array<{ role: string; content: string }> = [];

  // Fetch user memories for personalization
  let memoryPrefix = "";
  try {
    const { results: memories } = await c.env.DB.prepare(
      "SELECT key, value FROM user_memories WHERE user_id = ? ORDER BY key"
    ).bind(userId).all<{ key: string; value: string }>();
    if (memories && memories.length > 0) {
      memoryPrefix = `## About this user\n${memories.map(m => `- ${m.key}: ${m.value}`).join("\n")}\n\nUse this context to personalize your responses. Reference the user's role, department, and preferences when relevant.\n\n`;
    }
  } catch {}

  // Determine base system prompt (agent or default, persona-aware)
  const defaultPrompt = (user?.user_type === "student") ? STUDENT_SYSTEM_PROMPT : GOG_SYSTEM_PROMPT;
  let baseSystemPrompt = systemPrompt || defaultPrompt;
  let agentKnowledgeCategory: string | null = null;

  if (agentId) {
    try {
      const agent = await c.env.DB.prepare(
        "SELECT * FROM agents WHERE id = ? AND active = 1"
      ).bind(agentId).first<{ system_prompt: string; knowledge_category: string | null }>();
      if (agent) {
        baseSystemPrompt = agent.system_prompt;
        if (agent.knowledge_category) {
          agentKnowledgeCategory = agent.knowledge_category;
        }
      }
    } catch {}
  }

  // RAG: Search knowledge base for relevant context
  const { ragResults: rawRagResults, faqResults } = await searchKnowledge(c.env, message);

  // If agent has a knowledge_category, filter RAG results to that category
  let ragResults = rawRagResults;
  if (agentKnowledgeCategory) {
    ragResults = rawRagResults.filter(r =>
      r.source.toLowerCase().includes(agentKnowledgeCategory!.toLowerCase())
    );
    // If filtering removed everything, fall back to unfiltered results
    if (ragResults.length === 0) ragResults = rawRagResults;
  }

  // Web search: if enabled, search the web and inject results as numbered citations
  let webSearchResults: Array<{ title: string; url: string; snippet: string }> = [];
  const actualMessage = message.startsWith("@web ") ? message.slice(5) : message;
  const shouldWebSearch = webSearchEnabled || message.startsWith("@web ");

  if (shouldWebSearch) {
    try {
      const wsLimit = await checkWebSearchLimit(c.env, userId, userTier);
      if (wsLimit.allowed) {
        webSearchResults = await webSearch(actualMessage, 5);
        await incrementWebSearchCount(c.env, userId);
      }
    } catch {}
  }

  let augmentedPrompt = memoryPrefix + buildAugmentedPrompt(baseSystemPrompt, ragResults, faqResults);

  if (webSearchResults.length > 0) {
    augmentedPrompt += '\n\n--- REAL-TIME WEB SEARCH RESULTS ---\n';
    augmentedPrompt += 'The following are live search results from the web. Use them to provide up-to-date answers. ALWAYS cite sources using numbered references like [1], [2], etc.\n\n';
    webSearchResults.forEach((r, i) => {
      augmentedPrompt += `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}\n\n`;
    });
    augmentedPrompt += '---\nIMPORTANT: When referencing information from web results, cite the source number (e.g., [1], [2]). At the end of your response, list all cited sources in a "Sources:" section.\n';
  }

  // Language support: instruct AI to respond in target language
  if (language && language !== "en" && SUPPORTED_LANGUAGES[language]) {
    const langName = SUPPORTED_LANGUAGES[language].name;
    const isGhanaianLang = !SUPPORTED_LANGUAGES[language].m2mCode;
    if (isGhanaianLang) {
      augmentedPrompt += `\n\nCRITICAL LANGUAGE REQUIREMENT: You MUST respond ENTIRELY in ${langName}. Write every single word in ${langName} — do NOT use any English words at all. Even technical terms and descriptions must be expressed in ${langName} using native phrasing. Only proper nouns (organization names like SSNIT, GRA, DVLA), URLs, and phone numbers may remain in their original form. Think in ${langName} and write naturally as a fluent native ${langName} speaker from Ghana would. This is non-negotiable.`;
    } else {
      augmentedPrompt += `\n\nIMPORTANT: The user has selected ${langName} as their language. You MUST respond entirely in ${langName}.`;
    }
  }

  messages.push({ role: "system", content: augmentedPrompt });

  // Add history (reversed to chronological order, skip the message we just added)
  const historyChronological = history.reverse();
  for (const msg of historyChronological) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Stream response from Workers AI
  const stream = await c.env.AI.run(selectedModel as any, {
    messages: messages as any,
    stream: true,
    max_tokens: 4096,
  });

  // We need to collect the full response to save it
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Process in background
  c.executionCtx.waitUntil(
    (async () => {
      let fullResponse = "";
      const reader = (stream as ReadableStream).getReader();
      const decoder = new TextDecoder();

      try {
        // Send web search sources as a custom SSE event before AI response
        if (webSearchResults.length > 0) {
          await writer.write(encoder.encode(`event: sources\ndata: ${JSON.stringify(webSearchResults)}\n\n`));
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = typeof value === "string" ? value : decoder.decode(value);
          await writer.write(encoder.encode(chunk));

          // Parse SSE data to collect full text
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ") && !line.includes("[DONE]")) {
              try {
                const data = JSON.parse(line.slice(6));
                // Workers AI legacy format
                if (data.response) {
                  fullResponse += data.response;
                }
                // OpenAI-compatible format (gpt-oss, newer models)
                else if (data.choices?.[0]?.delta?.content) {
                  fullResponse += data.choices[0].delta.content;
                }
              } catch {
                // skip malformed chunks
              }
            }
          }
        }

        // Generate follow-up suggestions before closing stream
        try {
          if (fullResponse.length > 20) {
            const suggestionResp = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
              messages: [
                { role: "system", content: "Generate exactly 3 short follow-up questions the user might ask next based on this conversation. Return ONLY a JSON array of 3 strings, nothing else. Each question should be under 60 characters." },
                { role: "user", content: message.substring(0, 300) },
                { role: "assistant", content: fullResponse.substring(0, 500) }
              ],
              max_tokens: 200,
            });

            const suggText = (suggestionResp as any)?.response || "";
            const suggMatch = suggText.match(/\[[\s\S]*?\]/);
            if (suggMatch) {
              const suggestions = JSON.parse(suggMatch[0]);
              if (Array.isArray(suggestions) && suggestions.length > 0) {
                await writer.write(encoder.encode(`event: suggestions\ndata: ${JSON.stringify(suggestions.slice(0, 3))}\n\n`));
              }
            }
          }
        } catch { /* ignore suggestion errors */ }
      } finally {
        await writer.close();

        // Save assistant message
        if (fullResponse) {
          const assistantMsgId = generateId();
          await c.env.DB.prepare(
            "INSERT INTO messages (id, conversation_id, role, content, model) VALUES (?, ?, 'assistant', ?, ?)"
          )
            .bind(assistantMsgId, conversationId, fullResponse, selectedModel)
            .run();

          // Update conversation title if it's the first exchange
          const msgCount = await c.env.DB.prepare(
            "SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?"
          )
            .bind(conversationId)
            .first<{ count: number }>();

          // Auto-flag for moderation
          await checkModeration(c.env.DB, conversationId, assistantMsgId, userId, fullResponse);

          if (msgCount && msgCount.count <= 2) {
            // AI-generated title from first exchange
            try {
              const titleResponse = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
                messages: [
                  { role: "system", content: "Generate a short title (max 50 chars) for this conversation. Return ONLY the title, nothing else." },
                  { role: "user", content: message.substring(0, 500) },
                ],
                max_tokens: 60,
              });
              let title = (titleResponse as any)?.response || message;
              title = title.replace(/^["']|["']$/g, "").trim();
              if (title.length > 55) title = title.substring(0, 52) + "...";
              if (!title || title.length < 3) title = message.length > 60 ? message.substring(0, 57) + "..." : message;
              await c.env.DB.prepare(
                "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?"
              ).bind(title, conversationId).run();
            } catch {
              const title = message.length > 60 ? message.substring(0, 57) + "..." : message;
              await c.env.DB.prepare(
                "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?"
              ).bind(title, conversationId).run();
            }
          } else {
            await c.env.DB.prepare(
              "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?"
            )
              .bind(conversationId)
              .run();
          }

          // Auto-detect memories from user message
          try {
            const memoryCount = await c.env.DB.prepare(
              "SELECT COUNT(*) as count FROM user_memories WHERE user_id = ?"
            ).bind(userId).first<{ count: number }>();

            if (memoryCount && memoryCount.count < 20) {
              const extractResponse = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
                messages: [
                  {
                    role: "system",
                    content: `Extract any personal/professional facts from this message. Return JSON array of {key, value} pairs or empty array []. Examples: {"key": "department", "value": "Ministry of Finance"}, {"key": "role", "value": "Procurement Officer"}. Only extract clear, explicit facts. Return ONLY the JSON array, nothing else.`,
                  },
                  {
                    role: "user",
                    content: message.substring(0, 1000),
                  },
                ],
                max_tokens: 300,
              });

              const extractRaw = (extractResponse as any)?.response || "";
              try {
                const arrayMatch = extractRaw.match(/\[[\s\S]*?\]/);
                if (arrayMatch) {
                  const facts = JSON.parse(arrayMatch[0]);
                  if (Array.isArray(facts)) {
                    for (const fact of facts.slice(0, 5)) {
                      if (fact.key && fact.value && typeof fact.key === "string" && typeof fact.value === "string") {
                        const memId = generateId();
                        await c.env.DB.prepare(
                          `INSERT INTO user_memories (id, user_id, key, value, type)
                           VALUES (?, ?, ?, ?, 'auto')
                           ON CONFLICT(user_id, key) DO UPDATE SET value = ?, type = 'auto', updated_at = datetime('now')`
                        ).bind(memId, userId, fact.key.substring(0, 100), fact.value.substring(0, 500), fact.value.substring(0, 500)).run();
                      }
                    }
                  }
                }
              } catch {}
            }
          } catch {}
        }
      }
    })()
  );

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// ─── Deep Research Mode ─────────────────────────────────────────────

app.post("/api/research", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { query, conversationId } = await c.req.json();

  if (!query || !conversationId) {
    return c.json({ error: "query and conversationId are required" }, 400);
  }

  // Tier gate: Professional+ only (honors trial)
  const user = await c.env.DB.prepare("SELECT tier, trial_expires_at FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string; trial_expires_at: string | null }>();
  let userTier = user?.tier || "free";
  if (userTier === "free" && user?.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date()) {
    userTier = "professional";
  }
  if (userTier === "free") {
    return c.json({ error: "Deep Research requires a Professional or Enterprise plan.", code: "TIER_REQUIRED" }, 403);
  }

  const reportId = generateId();

  // Create report record
  await c.env.DB.prepare(
    "INSERT INTO research_reports (id, user_id, conversation_id, query) VALUES (?, ?, ?, ?)"
  ).bind(reportId, userId, conversationId, query).run();

  // Audit trail: log research action (non-blocking)
  c.executionCtx.waitUntil(logUserAudit(c, "research", query));

  // Track productivity (non-blocking)
  c.executionCtx.waitUntil(trackProductivity(c, "research"));

  // SSE stream for real-time progress
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendEvent = async (event: string, data: any) => {
    await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  c.executionCtx.waitUntil(
    (async () => {
      const allSources: Array<{ title: string; url: string; snippet: string }> = [];
      let report = "";

      try {
        // ── Step 1: Query Analysis ──
        await sendEvent("research:step", { step: 1, total: 5, description: "Analysing research question..." });

        const analysisResponse = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
          messages: [
            { role: "system", content: "You are a research assistant. Break down the following research question into 3-5 specific sub-queries that would help comprehensively answer it. Return ONLY a JSON array of strings, nothing else. Example: [\"sub-query 1\", \"sub-query 2\", \"sub-query 3\"]" },
            { role: "user", content: query },
          ],
          max_tokens: 512,
        });
        const analysisText = (analysisResponse as any).response || JSON.stringify([query]);
        let subQueries: string[];
        try {
          const jsonMatch = analysisText.match(/\[[\s\S]*?\]/);
          subQueries = jsonMatch ? JSON.parse(jsonMatch[0]) : [query];
        } catch {
          subQueries = [query];
        }
        subQueries = subQueries.slice(0, 5);

        await c.env.DB.prepare("UPDATE research_reports SET steps_completed = 1 WHERE id = ?").bind(reportId).run();

        // ── Step 2: Knowledge Base Search ──
        await sendEvent("research:step", { step: 2, total: 5, description: "Searching knowledge base..." });

        let kbContext = "";
        for (const sq of subQueries) {
          try {
            const { ragResults, faqResults } = await searchKnowledge(c.env, sq, 3);
            for (const r of ragResults) {
              kbContext += `[Source: ${r.title} | Category: ${r.category}] ${r.content}\n\n`;
            }
            for (const f of faqResults) {
              kbContext += `[FAQ] Q: ${f.question}\nA: ${f.answer}\n\n`;
            }
          } catch {}
        }

        await c.env.DB.prepare("UPDATE research_reports SET steps_completed = 2 WHERE id = ?").bind(reportId).run();

        // ── Step 3: Web Search ──
        await sendEvent("research:step", { step: 3, total: 5, description: "Searching the web..." });

        let webContext = "";
        for (const sq of subQueries) {
          try {
            const results = await webSearch(sq, 3);
            for (const r of results) {
              const isDuplicate = allSources.some(s => s.url === r.url);
              if (!isDuplicate) {
                allSources.push(r);
                await sendEvent("research:source", { title: r.title, url: r.url });
              }
              webContext += `[${allSources.findIndex(s => s.url === r.url) + 1}] ${r.title}\n${r.snippet}\nURL: ${r.url}\n\n`;
            }
          } catch {}
        }

        await c.env.DB.prepare("UPDATE research_reports SET steps_completed = 3 WHERE id = ?").bind(reportId).run();

        // ── Step 4: Synthesis ──
        await sendEvent("research:step", { step: 4, total: 5, description: "Synthesising findings..." });

        const synthesisPrompt = `You are a senior research analyst for the Government of Ghana. Compile a comprehensive research report on the following topic.

Research Question: ${query}

Sub-queries investigated: ${subQueries.join(", ")}

${kbContext ? `--- KNOWLEDGE BASE FINDINGS ---\n${kbContext}\n` : ""}
${webContext ? `--- WEB SEARCH FINDINGS ---\n${webContext}\n` : ""}

Write a well-structured research report with:
1. **Executive Summary** — 2-3 sentence overview
2. **Key Findings** — Main discoveries organized by theme
3. **Detailed Analysis** — In-depth discussion with citations [1], [2], etc.
4. **Recommendations** — Actionable next steps for GoG context
5. **Sources** — List all cited sources

Use formal British English. Cite web sources using numbered references [1], [2], etc.`;

        const synthesisResponse = await c.env.AI.run("@cf/openai/gpt-oss-20b" as any, {
          messages: [
            { role: "system", content: synthesisPrompt },
            { role: "user", content: `Generate the comprehensive research report for: ${query}` },
          ],
          max_tokens: 4096,
        });

        report = (synthesisResponse as any).response || "Research report generation failed.";

        await c.env.DB.prepare("UPDATE research_reports SET steps_completed = 4 WHERE id = ?").bind(reportId).run();

        // ── Step 5: Finalize ──
        await sendEvent("research:step", { step: 5, total: 5, description: "Finalising report..." });

        // Save to database
        await c.env.DB.prepare(
          "UPDATE research_reports SET status = 'completed', steps_completed = 5, report = ?, sources = ?, completed_at = datetime('now') WHERE id = ?"
        ).bind(report, JSON.stringify(allSources), reportId).run();

        // Save report as assistant message in conversation
        const assistantMsgId = generateId();
        await c.env.DB.prepare(
          "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'assistant', ?)"
        ).bind(assistantMsgId, conversationId, report).run();

        await sendEvent("research:complete", { reportId, report, sources: allSources });
      } catch (e) {
        await c.env.DB.prepare(
          "UPDATE research_reports SET status = 'failed' WHERE id = ?"
        ).bind(reportId).run();
        await sendEvent("research:error", { error: "Research failed. Please try again." });
      } finally {
        await writer.close();
      }
    })()
  );

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// GET /api/research/:id — retrieve saved research report
app.get("/api/research/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const reportId = c.req.param("id");

  const report = await c.env.DB.prepare(
    "SELECT * FROM research_reports WHERE id = ? AND user_id = ?"
  ).bind(reportId, userId).first();

  if (!report) return c.json({ error: "Report not found" }, 404);
  return c.json({ report });
});

// ─── Data Analysis Mode ─────────────────────────────────────────────

app.post("/api/analyze", authMiddleware, async (c) => {
  const userId = c.get("userId");

  // Tier gate: Professional+ only (honors trial)
  const user = await c.env.DB.prepare("SELECT tier, trial_expires_at FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string; trial_expires_at: string | null }>();
  let userTier = user?.tier || "free";
  if (userTier === "free" && user?.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date()) {
    userTier = "professional";
  }
  if (userTier === "free") {
    return c.json({ error: "Data Analysis requires a Professional plan or above.", code: "TIER_REQUIRED" }, 403);
  }

  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const prompt = (formData.get("prompt") as string) || "Analyze this data and provide insights.";

  if (!file) {
    return c.json({ error: "A file (CSV or XLSX) is required" }, 400);
  }

  // Audit trail: log analyze action (non-blocking)
  c.executionCtx.waitUntil(logUserAudit(c, "analyze", prompt));

  const fileName = file.name.toLowerCase();
  let csvText = "";

  if (fileName.endsWith(".csv")) {
    csvText = await file.text();
  } else if (fileName.endsWith(".xlsx")) {
    // Parse XLSX (ZIP archive with XML sheets)
    try {
      const arrayBuffer = await file.arrayBuffer();
      const blob = new Blob([arrayBuffer]);
      const ds = new DecompressionStream("raw" as any);
      // XLSX is a ZIP — we need to find shared strings and sheet data
      // For Workers environment, use a simplified approach: extract sheet1.xml
      const bytes = new Uint8Array(arrayBuffer);
      let sheetXml = "";
      let stringsXml = "";

      // Find ZIP local file headers and extract relevant XML files
      for (let i = 0; i < bytes.length - 4; i++) {
        if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
          const nameLen = bytes[i + 26] | (bytes[i + 27] << 8);
          const extraLen = bytes[i + 28] | (bytes[i + 29] << 8);
          const compMethod = bytes[i + 8] | (bytes[i + 9] << 8);
          const compSize = bytes[i + 18] | (bytes[i + 19] << 8) | (bytes[i + 20] << 16) | (bytes[i + 21] << 24);
          const nameBytes = bytes.slice(i + 30, i + 30 + nameLen);
          const name = new TextDecoder().decode(nameBytes);
          const dataStart = i + 30 + nameLen + extraLen;

          if (name.includes("sheet1.xml") || name.includes("sharedStrings.xml")) {
            const compressedData = bytes.slice(dataStart, dataStart + compSize);
            let text = "";
            if (compMethod === 0) {
              text = new TextDecoder().decode(compressedData);
            } else {
              try {
                const ds = new DecompressionStream("raw" as any);
                const dsWriter = ds.writable.getWriter();
                dsWriter.write(compressedData);
                dsWriter.close();
                const reader = ds.readable.getReader();
                const chunks: Uint8Array[] = [];
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  chunks.push(value);
                }
                const totalLen = chunks.reduce((a, c) => a + c.length, 0);
                const merged = new Uint8Array(totalLen);
                let offset = 0;
                for (const ch of chunks) { merged.set(ch, offset); offset += ch.length; }
                text = new TextDecoder().decode(merged);
              } catch {
                text = new TextDecoder().decode(compressedData);
              }
            }
            if (name.includes("sheet1.xml")) sheetXml = text;
            if (name.includes("sharedStrings.xml")) stringsXml = text;
          }
        }
      }

      // Parse shared strings
      const sharedStrings: string[] = [];
      const siMatches = stringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g);
      for (const m of siMatches) {
        const tMatch = m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/);
        sharedStrings.push(tMatch ? tMatch[1] : "");
      }

      // Parse sheet data to CSV
      const rows: string[][] = [];
      const rowMatches = sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g);
      for (const rm of rowMatches) {
        const cells: string[] = [];
        const cellMatches = rm[1].matchAll(/<c[^>]*(?:t="s")?[^>]*>([\s\S]*?)<\/c>/g);
        for (const cm of cellMatches) {
          const vMatch = cm[1].match(/<v>([\s\S]*?)<\/v>/);
          const isShared = cm[0].includes('t="s"');
          if (vMatch) {
            const val = vMatch[1];
            cells.push(isShared ? (sharedStrings[parseInt(val)] || val) : val);
          } else {
            cells.push("");
          }
        }
        rows.push(cells);
      }

      csvText = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    } catch (e) {
      return c.json({ error: "Failed to parse XLSX file. Please try converting to CSV first." }, 400);
    }
  } else {
    return c.json({ error: "Unsupported file type. Please upload a CSV or XLSX file." }, 400);
  }

  // Truncate for AI context
  const truncatedCsv = csvText.substring(0, 15000);
  const rowCount = csvText.split("\n").length;

  const analysisPrompt = `You are a data analyst for the Government of Ghana. Analyze the following dataset and provide insights.

User's request: ${prompt}

Dataset (${rowCount} rows, ${fileName}):
\`\`\`csv
${truncatedCsv}
\`\`\`

Provide your analysis in EXACTLY this JSON format (no other text):
{
  "summary": "Brief overview of the dataset and key statistics",
  "insights": ["insight 1", "insight 2", "insight 3", "insight 4", "insight 5"],
  "chartConfigs": [
    {
      "type": "bar",
      "title": "Chart title",
      "labels": ["label1", "label2"],
      "datasets": [{"label": "Series", "data": [10, 20]}]
    }
  ]
}

For chartConfigs, suggest 1-3 Chart.js-compatible chart configurations. Use types: bar, line, pie, or doughnut.
For budget data, include variance analysis. All monetary values in GHS.
Keep datasets data arrays to max 20 items. Return ONLY valid JSON.`;

  try {
    const analysisResponse = await c.env.AI.run("@cf/openai/gpt-oss-20b" as any, {
      messages: [
        { role: "system", content: analysisPrompt },
        { role: "user", content: "Analyze this data and return JSON." },
      ],
      max_tokens: 4096,
    });

    const responseText = (analysisResponse as any).response || "";

    // Try to parse as JSON
    let analysis;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      analysis = null;
    }

    if (!analysis) {
      // Fallback: return raw text analysis
      analysis = {
        summary: responseText.substring(0, 500),
        insights: [responseText],
        chartConfigs: [],
      };
    }

    // Parse raw data for the data table
    const lines = csvText.split("\n").filter(l => l.trim());
    const headers = lines[0] ? lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim()) : [];
    const dataRows = lines.slice(1, 101).map(line => {
      const cells: string[] = [];
      let current = "";
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes; }
        else if (ch === ',' && !inQuotes) { cells.push(current.trim()); current = ""; }
        else { current += ch; }
      }
      cells.push(current.trim());
      return cells;
    });

    // Track productivity (non-blocking)
    c.executionCtx.waitUntil(trackProductivity(c, "analysis"));

    return c.json({
      summary: analysis.summary,
      insights: analysis.insights || [],
      chartConfigs: analysis.chartConfigs || [],
      rawData: { headers, rows: dataRows, totalRows: rowCount },
    });
  } catch (e) {
    return c.json({ error: "Analysis failed. Please try again with a smaller file." }, 500);
  }
});

// ─── Translation / Language Support ──────────────────────────────────

const SUPPORTED_LANGUAGES: Record<string, { name: string; m2mCode: string | null }> = {
  en: { name: "English", m2mCode: "en" },
  fr: { name: "French", m2mCode: "fr" },
  ha: { name: "Hausa", m2mCode: "ha" },
  tw: { name: "Twi (Akan)", m2mCode: null },      // LLM fallback
  ga: { name: "Ga", m2mCode: null },               // LLM fallback
  ee: { name: "Ewe", m2mCode: null },              // LLM fallback
  dag: { name: "Dagbani", m2mCode: null },          // LLM fallback
};

async function translateText(
  ai: Ai,
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  const source = SUPPORTED_LANGUAGES[sourceLang];
  const target = SUPPORTED_LANGUAGES[targetLang];

  if (!source || !target || sourceLang === targetLang) return text;

  // Use m2m100 if both languages are supported
  if (source.m2mCode && target.m2mCode) {
    try {
      const result = await ai.run("@cf/meta/m2m100-1.2b" as any, {
        text,
        source_lang: source.m2mCode,
        target_lang: target.m2mCode,
      });
      return (result as any).translated_text || text;
    } catch {
      // Fall through to LLM fallback
    }
  }

  // LLM fallback for unsupported language pairs (Twi, Ga, Ewe, Dagbani)
  try {
    const result = await ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast" as any, {
      messages: [
        {
          role: "system",
          content: `You are a professional ${target.name} translator from Ghana. Your ONLY job is to translate text from ${source.name} into ${target.name}.

CRITICAL RULES:
- Output ONLY the ${target.name} translation. No English at all.
- Do NOT include the original text, explanations, or notes.
- Do NOT mix English words into the translation. Translate EVERYTHING including technical terms, place names can stay.
- If a word has no direct ${target.name} equivalent, use the closest ${target.name} phrase to describe it.
- URLs, phone numbers, and proper nouns (organization names like SSNIT, GRA, DVLA) can remain as-is.
- Maintain the same formatting (bullet points, numbering, bold markers).
- Write naturally as a native ${target.name} speaker would.`,
        },
        { role: "user", content: `Translate this to ${target.name}:\n\n${text}` },
      ],
      max_tokens: 2048,
    });
    return (result as any).response || text;
  } catch {
    return text;
  }
}

app.post("/api/translate", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { text, sourceLang, targetLang } = await c.req.json();

  if (!text || !targetLang) {
    return c.json({ error: "text and targetLang are required" }, 400);
  }

  const translated = await translateText(c.env.AI, text, sourceLang || "en", targetLang);
  return c.json({ translated, sourceLang: sourceLang || "en", targetLang });
});

// ─── Image / Vision Understanding ───────────────────────────────────

app.post("/api/vision", authMiddleware, async (c) => {
  const userId = c.get("userId");

  // Tier gate: Professional+ only (honors trial)
  const user = await c.env.DB.prepare("SELECT tier, trial_expires_at FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string; trial_expires_at: string | null }>();
  let userTier = user?.tier || "free";
  if (userTier === "free" && user?.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date()) {
    userTier = "professional";
  }
  if (userTier === "free") {
    return c.json({ error: "Image understanding requires a Professional plan or above.", code: "TIER_REQUIRED" }, 403);
  }

  const formData = await c.req.formData();
  const image = formData.get("image") as File | null;
  const prompt = (formData.get("prompt") as string) || "Describe this image in detail.";
  const mode = (formData.get("mode") as string) || "describe";

  if (!image) {
    return c.json({ error: "An image file is required" }, 400);
  }

  // Validate file type
  const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (!validTypes.includes(image.type)) {
    return c.json({ error: "Unsupported image type. Use JPEG, PNG, GIF, or WebP." }, 400);
  }

  // 5MB limit
  if (image.size > 5 * 1024 * 1024) {
    return c.json({ error: "Image must be under 5MB" }, 400);
  }

  // Audit trail: log vision action (non-blocking)
  c.executionCtx.waitUntil(logUserAudit(c, "vision", prompt, "@cf/llava-hf/llava-1.5-7b-hf"));

  const imageBytes = await image.arrayBuffer();
  const imageArray = [...new Uint8Array(imageBytes)];

  // Build mode-specific prompt
  let visionPrompt = prompt;
  if (mode === "ocr") {
    visionPrompt = "Extract ALL text from this image exactly as written. Preserve formatting, line breaks, and structure. Return only the extracted text.";
  } else if (mode === "form") {
    visionPrompt = "This is a form or document. Extract all field labels and their values as structured data. Format as:\nField: Value\nFor each field found.";
  } else if (mode === "receipt") {
    visionPrompt = "This is a receipt or invoice. Extract: vendor name, date, all line items (description, quantity, amount), subtotal, tax, and total. Format clearly.";
  }

  try {
    const result = await c.env.AI.run("@cf/llava-hf/llava-1.5-7b-hf" as any, {
      image: imageArray,
      prompt: visionPrompt,
      max_tokens: 1024,
    });

    const description = (result as any).description || (result as any).response || "";

    // Track productivity (non-blocking)
    c.executionCtx.waitUntil(trackProductivity(c, "vision"));

    return c.json({
      description,
      mode,
      imageSize: image.size,
      imageType: image.type,
    });
  } catch (e) {
    return c.json({ error: "Image analysis failed. Please try a different image." }, 500);
  }
});

// POST /api/chat/image — send image with message in chat context
app.post("/api/chat/image", authMiddleware, async (c) => {
  const userId = c.get("userId");

  const formData = await c.req.formData();
  const image = formData.get("image") as File | null;
  const message = (formData.get("message") as string) || "What's in this image?";
  const conversationId = formData.get("conversationId") as string;
  const model = formData.get("model") as string;

  if (!image || !conversationId) {
    return c.json({ error: "image and conversationId are required" }, 400);
  }

  // Tier gate: Professional+ (honors trial)
  const user = await c.env.DB.prepare("SELECT tier, trial_expires_at FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string; trial_expires_at: string | null }>();
  let userTier = user?.tier || "free";
  if (userTier === "free" && user?.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date()) {
    userTier = "professional";
  }
  if (userTier === "free") {
    return c.json({ error: "Image understanding requires a Professional plan or above.", code: "TIER_REQUIRED" }, 403);
  }

  // Check usage
  const usage = await checkUsageLimit(c.env.DB, userId, userTier);
  if (!usage.allowed) {
    return c.json({ error: `Daily limit reached (${usage.limit} messages).`, code: "LIMIT_REACHED" }, 429);
  }

  // Verify conversation ownership
  const convo = await c.env.DB.prepare(
    "SELECT id FROM conversations WHERE id = ? AND user_id = ?"
  ).bind(conversationId, userId).first();
  if (!convo) return c.json({ error: "Conversation not found" }, 404);

  // Analyze image
  const imageBytes = await image.arrayBuffer();
  const imageArray = [...new Uint8Array(imageBytes)];

  let imageDescription = "";
  try {
    const visionResult = await c.env.AI.run("@cf/llava-hf/llava-1.5-7b-hf" as any, {
      image: imageArray,
      prompt: message,
      max_tokens: 1024,
    });
    imageDescription = (visionResult as any).description || (visionResult as any).response || "Unable to analyze image.";
  } catch {
    imageDescription = "Image analysis is temporarily unavailable.";
  }

  // Save user message
  const userMsgId = generateId();
  await c.env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', ?)"
  ).bind(userMsgId, conversationId, `[Image uploaded] ${message}`).run();

  // Save AI response
  const assistantMsgId = generateId();
  await c.env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'assistant', ?)"
  ).bind(assistantMsgId, conversationId, imageDescription).run();

  // Track productivity (non-blocking)
  c.executionCtx.waitUntil(trackProductivity(c, "vision"));

  return c.json({ response: imageDescription, messageId: assistantMsgId });
});

// ─── User Profile ───────────────────────────────────────────────────

app.get("/api/user/profile", authMiddleware, async (c) => {
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

// ─── Available Models ───────────────────────────────────────────────

app.get("/api/models", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const user = await c.env.DB.prepare("SELECT tier, trial_expires_at FROM users WHERE id = ?")
    .bind(userId)
    .first<{ tier: string; trial_expires_at: string | null }>();
  let userTier = user?.tier || "free";
  // Honor trial
  if (userTier === "free" && user?.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date()) {
    userTier = "professional";
  }
  const isFree = userTier === "free";

  return c.json({
    userTier,
    models: [
      {
        id: "@cf/openai/gpt-oss-120b",
        name: "GPT-OSS 120B (OpenAI)",
        description: "OpenAI's open-weight model — top-tier reasoning, agentic tasks, and general purpose",
        contextWindow: 131072,
        requiredTier: "professional",
        locked: isFree,
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
        requiredTier: "professional",
        locked: isFree,
        recommended: false,
      },
      {
        id: "@cf/qwen/qwq-32b",
        name: "QwQ 32B (Qwen)",
        description: "Qwen reasoning model — exceptional at thinking through complex problems step-by-step",
        contextWindow: 131072,
        requiredTier: "professional",
        locked: isFree,
        recommended: false,
      },
      {
        id: "@cf/qwen/qwen3-30b-a3b-fp8",
        name: "Qwen3 30B (Qwen)",
        description: "Latest Qwen3 — advanced reasoning, multilingual, agent capabilities",
        contextWindow: 131072,
        requiredTier: "professional",
        locked: isFree,
        recommended: false,
      },
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
        id: "@cf/mistralai/mistral-small-3.1-24b-instruct",
        name: "Mistral Small 3.1 24B",
        description: "Excellent for long documents, vision understanding, and multilingual writing",
        contextWindow: 128000,
        requiredTier: "professional",
        locked: isFree,
        recommended: false,
      },
      {
        id: "@cf/google/gemma-3-12b-it",
        name: "Gemma 3 12B (Google)",
        description: "Google's model — 128K context, 140+ languages, strong at summarisation",
        contextWindow: 128000,
        requiredTier: "free",
        locked: false,
        recommended: false,
      },
      {
        id: "@cf/ibm-granite/granite-4.0-h-micro",
        name: "Granite 4.0 Micro (IBM)",
        description: "IBM's enterprise model — small but accurate, great for structured tasks",
        contextWindow: 131072,
        requiredTier: "professional",
        locked: isFree,
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

    // Check if already awarded
    const existing = await db.prepare(
      "SELECT COUNT(*) as cnt FROM affiliate_transactions WHERE user_id = ? AND type = 'bonus' AND description LIKE ?"
    ).bind(userId, `Milestone: ${m.threshold}%`).first<{ cnt: number }>();

    if (existing && existing.cnt > 0) continue;

    await creditWallet(db, userId, m.bonus, "bonus", `Milestone: ${m.threshold} referrals — GHS ${m.bonus} bonus`, undefined, undefined);
  }
}

// ─── Affiliate Dashboard (Enhanced) ─────────────────────────────────

app.get("/api/affiliate/dashboard", authMiddleware, async (c) => {
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
    // Backward compat
    affiliateTier: user.affiliate_tier,
    totalReferrals: user.total_referrals,
    totalEarnings: user.affiliate_earnings,
  });
});

// ─── Affiliate Transactions (Paginated) ─────────────────────────────

app.get("/api/affiliate/transactions", authMiddleware, async (c) => {
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

app.post("/api/affiliate/withdraw", authMiddleware, async (c) => {
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

app.get("/api/affiliate/leaderboard", authMiddleware, async (c) => {
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

app.get("/api/admin/affiliate/withdrawals", adminMiddleware, async (c) => {
  await ensureAffiliateTables(c.env.DB);
  const status = c.req.query("status") || "pending";
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "20")));
  const offset = (page - 1) * limit;

  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM withdrawal_requests WHERE status = ?"
  ).bind(status).first<{ cnt: number }>();

  const { results } = await c.env.DB.prepare(
    `SELECT wr.*, u.full_name, u.email
     FROM withdrawal_requests wr
     JOIN users u ON u.id = wr.user_id
     WHERE wr.status = ?
     ORDER BY wr.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(status, limit, offset).all();

  return c.json({
    withdrawals: results || [],
    total: total?.cnt || 0,
    page,
    limit,
  });
});

app.post("/api/admin/affiliate/withdrawals/:id/approve", adminMiddleware, async (c) => {
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

app.post("/api/admin/affiliate/withdrawals/:id/reject", adminMiddleware, async (c) => {
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

app.get("/api/admin/affiliate/stats", adminMiddleware, async (c) => {
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
    topAffiliates: topAffiliates || [],
    monthlyTrend,
  });
});

// ─── Pricing & Plans ─────────────────────────────────────────────────

app.get("/api/pricing", async (c) => {
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

  const plans = Object.entries(PRICING_TIERS).map(([id, tier]) => ({
    id,
    name: tier.name,
    price: isStudent ? tier.studentPrice : tier.price,
    standardPrice: tier.price,
    studentPrice: tier.studentPrice,
    isStudentPricing: isStudent,
    messagesPerDay: tier.messagesPerDay,
    features: tier.features,
    popular: id === "professional",
  }));
  return c.json({ plans, isStudentPricing: isStudent });
});

app.get("/api/usage/status", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const user = await c.env.DB.prepare("SELECT tier, trial_expires_at FROM users WHERE id = ?")
    .bind(userId)
    .first<{ tier: string; trial_expires_at: string | null }>();

  let userTier = user?.tier || "free";
  const trialActive = user?.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date();
  if (trialActive && userTier === "free") userTier = "professional";

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
    trialActive: !!trialActive,
    trialExpiresAt: user?.trial_expires_at || null,
  });
});

// Admin-only manual tier upgrade (payment upgrades go through Paystack webhooks)
app.post("/api/upgrade", adminMiddleware, async (c) => {
  const { userId, tier } = await c.req.json();

  if (!userId || !PRICING_TIERS[tier] || tier === "free") {
    return c.json({ error: "Valid userId and tier required" }, 400);
  }

  await c.env.DB.prepare("UPDATE users SET tier = ? WHERE id = ?")
    .bind(tier, userId)
    .run();

  const tierConfig = PRICING_TIERS[tier];
  return c.json({
    success: true,
    tier,
    name: tierConfig.name,
    message: `Admin upgraded user to ${tierConfig.name} plan`,
  });
});

// ─── Admin Routes ────────────────────────────────────────────────────

// Bootstrap: self-disabling — only works when zero admins exist
app.post("/api/admin/bootstrap", async (c) => {
  const { email, secret } = await c.req.json();
  if (!email) return c.json({ error: "Email is required" }, 400);

  if (c.env.BOOTSTRAP_SECRET && secret !== c.env.BOOTSTRAP_SECRET) {
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
app.get("/api/admin/verify", adminMiddleware, async (c) => {
  const userId = c.get("userId");
  const user = await c.env.DB.prepare(
    "SELECT id, email, full_name, role FROM users WHERE id = ?"
  )
    .bind(userId)
    .first();
  return c.json({ admin: true, user });
});

// Dashboard stats
app.get("/api/admin/dashboard", adminMiddleware, async (c) => {
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
app.get("/api/admin/users", adminMiddleware, async (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const search = c.req.query("search") || "";
  const offset = (page - 1) * limit;

  const countQuery = "SELECT COUNT(*) as count FROM users";
  const dataQuery = "SELECT id, email, full_name, department, role, tier, affiliate_tier, total_referrals, affiliate_earnings, created_at, last_login FROM users";

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
app.patch("/api/admin/users/:id/tier", adminMiddleware, async (c) => {
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
app.patch("/api/admin/users/:id/role", adminMiddleware, async (c) => {
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

// Delete user + all data
app.delete("/api/admin/users/:id", adminMiddleware, async (c) => {
  const id = c.req.param("id");
  const adminId = c.get("userId");
  if (id === adminId) {
    return c.json({ error: "Cannot delete your own account" }, 400);
  }
  // Delete messages in user's conversations
  await c.env.DB.prepare(
    "DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)"
  ).bind(id).run();
  // Delete conversations
  await c.env.DB.prepare("DELETE FROM conversations WHERE user_id = ?").bind(id).run();
  // Delete referrals
  await c.env.DB.prepare("DELETE FROM referrals WHERE referrer_id = ? OR referred_id = ?").bind(id, id).run();
  // Delete user
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  return c.json({ success: true });
});

// All conversations with user info + message counts
app.get("/api/admin/conversations", adminMiddleware, async (c) => {
  const page = parseInt(c.req.query("page") || "1");
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
app.get("/api/admin/conversations/:id/messages", adminMiddleware, async (c) => {
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
app.delete("/api/admin/conversations/:id", adminMiddleware, async (c) => {
  const convoId = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM messages WHERE conversation_id = ?").bind(convoId).run();
  await c.env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(convoId).run();
  return c.json({ success: true });
});

// Analytics: messages/day, signups/day (7 days), model usage, top users
app.get("/api/admin/analytics", adminMiddleware, async (c) => {
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

// Referrals overview
app.get("/api/admin/referrals", adminMiddleware, async (c) => {
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
app.post("/api/admin/promote", adminMiddleware, async (c) => {
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
    const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
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

const PRODUCTIVITY_MULTIPLIERS: Record<string, { column: string; minutes: number }> = {
  chat: { column: "messages_sent", minutes: 2 },
  research: { column: "research_reports", minutes: 30 },
  analysis: { column: "analyses_run", minutes: 20 },
  vision: { column: "messages_sent", minutes: 2 },
  meeting: { column: "meetings_processed", minutes: 60 },
  workflow: { column: "workflows_completed", minutes: 45 },
  document: { column: "documents_generated", minutes: 15 },
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

// ─── Productivity Dashboard (User) ──────────────────────────────────

app.get("/api/productivity/me", authMiddleware, async (c) => {
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

// ─── Productivity Dashboard (Admin) ─────────────────────────────────

app.get("/api/admin/productivity", adminMiddleware, async (c) => {
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

// ─── Message Rating ───────────────────────────────────────────────────

app.post("/api/messages/:id/rate", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const messageId = c.req.param("id");
  const { rating } = await c.req.json();

  if (rating !== 1 && rating !== -1) {
    return c.json({ error: "Rating must be 1 (thumbs up) or -1 (thumbs down)" }, 400);
  }

  // Verify the message exists and user owns the conversation
  const msg = await c.env.DB.prepare(
    `SELECT m.id, m.conversation_id FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.id = ? AND c.user_id = ?`
  ).bind(messageId, userId).first<{ id: string; conversation_id: string }>();

  if (!msg) return c.json({ error: "Message not found" }, 404);

  // Upsert rating
  await c.env.DB.prepare(
    `INSERT INTO message_ratings (id, user_id, message_id, conversation_id, rating)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, message_id) DO UPDATE SET rating = excluded.rating`
  ).bind(generateId(), userId, messageId, msg.conversation_id, rating).run();

  return c.json({ success: true, rating });
});

// ─── Regenerate Response ──────────────────────────────────────────────

app.post("/api/messages/:id/regenerate", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const messageId = c.req.param("id");
  const { model } = await c.req.json();

  // Find the assistant message and its conversation
  const msg = await c.env.DB.prepare(
    `SELECT m.id, m.conversation_id, m.content FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.id = ? AND m.role = 'assistant' AND c.user_id = ?`
  ).bind(messageId, userId).first<{ id: string; conversation_id: string; content: string }>();

  if (!msg) return c.json({ error: "Message not found" }, 404);

  // Get user tier for model access
  const user = await c.env.DB.prepare("SELECT tier FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string }>();
  const userTier = user?.tier || "free";

  // Delete the assistant message
  await c.env.DB.prepare("DELETE FROM messages WHERE id = ?").bind(messageId).run();

  // Get conversation history
  const { results: history } = await c.env.DB.prepare(
    "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
  ).bind(msg.conversation_id).all<{ role: string; content: string }>();

  let selectedModel = model || "@cf/openai/gpt-oss-20b";
  if (userTier === "free" && !FREE_TIER_MODELS.includes(selectedModel)) {
    selectedModel = "@cf/openai/gpt-oss-20b";
  }

  // Get the last user message for RAG context
  const lastUserMsg = history.filter(h => h.role === 'user').pop();
  const regenQuery = lastUserMsg?.content || '';
  const { ragResults: regenRag, faqResults: regenFaq } = await searchKnowledge(c.env, regenQuery);
  const regenPrompt = buildAugmentedPrompt(GOG_SYSTEM_PROMPT, regenRag, regenFaq);

  const messages: Array<{ role: string; content: string }> = [];
  messages.push({ role: "system", content: regenPrompt });

  for (const h of history) {
    messages.push({ role: h.role, content: h.content });
  }

  // Stream new response
  const stream = await c.env.AI.run(selectedModel as any, {
    messages: messages as any,
    stream: true,
    max_tokens: 4096,
  });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  c.executionCtx.waitUntil(
    (async () => {
      let fullResponse = "";
      const reader = (stream as ReadableStream).getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = typeof value === "string" ? value : decoder.decode(value);
          await writer.write(encoder.encode(chunk));
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ") && !line.includes("[DONE]")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.response) fullResponse += data.response;
                else if (data.choices?.[0]?.delta?.content) fullResponse += data.choices[0].delta.content;
              } catch {}
            }
          }
        }
      } finally {
        await writer.close();
        if (fullResponse) {
          await c.env.DB.prepare(
            "INSERT INTO messages (id, conversation_id, role, content, model) VALUES (?, ?, 'assistant', ?, ?)"
          ).bind(generateId(), msg.conversation_id, fullResponse, selectedModel).run();
        }
      }
    })()
  );

  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
});

// ─── Conversation Search ──────────────────────────────────────────────

app.get("/api/conversations/search", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const q = c.req.query("q") || "";

  if (!q || q.length < 2) {
    return c.json({ results: [] });
  }

  const searchTerm = `%${q}%`;

  // Search in conversation titles and message content
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT c.id, c.title, c.updated_at,
       (SELECT content FROM messages WHERE conversation_id = c.id AND content LIKE ? LIMIT 1) as matched_content
     FROM conversations c
     LEFT JOIN messages m ON m.conversation_id = c.id
     WHERE c.user_id = ? AND (c.title LIKE ? OR m.content LIKE ?)
     ORDER BY c.updated_at DESC
     LIMIT 20`
  ).bind(searchTerm, userId, searchTerm, searchTerm).all();

  return c.json({ results: results || [] });
});

// ─── User Memories ────────────────────────────────────────────────────

app.get("/api/memories", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM user_memories WHERE user_id = ? ORDER BY updated_at DESC"
  ).bind(userId).all();
  return c.json({ memories: results || [] });
});

app.post("/api/memories", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { key, value, type } = await c.req.json();

  if (!key || !value) {
    return c.json({ error: "Key and value are required" }, 400);
  }

  const id = generateId();
  const memoryType = type || "preference";

  await c.env.DB.prepare(
    `INSERT INTO user_memories (id, user_id, key, value, type)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = ?, type = ?, updated_at = datetime('now')`
  ).bind(id, userId, key, value, memoryType, value, memoryType).run();

  const memory = await c.env.DB.prepare(
    "SELECT * FROM user_memories WHERE user_id = ? AND key = ?"
  ).bind(userId, key).first();

  return c.json({ memory });
});

app.delete("/api/memories/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const memoryId = c.req.param("id");

  const memory = await c.env.DB.prepare(
    "SELECT id FROM user_memories WHERE id = ? AND user_id = ?"
  ).bind(memoryId, userId).first();

  if (!memory) {
    return c.json({ error: "Memory not found" }, 404);
  }

  await c.env.DB.prepare(
    "DELETE FROM user_memories WHERE id = ? AND user_id = ?"
  ).bind(memoryId, userId).run();

  return c.json({ success: true });
});

app.get("/api/admin/users/:id/memories", adminMiddleware, async (c) => {
  const targetUserId = c.req.param("id");
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM user_memories WHERE user_id = ? ORDER BY updated_at DESC"
  ).bind(targetUserId).all();
  return c.json({ memories: results || [] });
});

// ─── Custom Agents (public) ──────────────────────────────────────────

app.get("/api/agents", async (c) => {
  const userType = c.req.query("user_type") || "gog_employee";
  await ensureAgentUserTypeColumn(c.env.DB);
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, description, department, icon, knowledge_category, user_type FROM agents WHERE active = 1 AND (user_type = ? OR user_type = 'all') ORDER BY name"
  ).bind(userType).all();
  return c.json({ agents: results || [] });
});

app.get("/api/agents/:id", async (c) => {
  const agentId = c.req.param("id");
  const agent = await c.env.DB.prepare(
    "SELECT id, name, description, department, icon, knowledge_category FROM agents WHERE id = ? AND active = 1"
  ).bind(agentId).first();

  if (!agent) {
    return c.json({ error: "Agent not found" }, 404);
  }

  return c.json({ agent });
});

// ─── Custom Agents (admin) ───────────────────────────────────────────

app.post("/api/admin/agents", adminMiddleware, async (c) => {
  const adminId = c.get("userId");
  const { name, description, system_prompt, department, knowledge_category, icon } = await c.req.json();

  if (!name || !system_prompt) {
    return c.json({ error: "Name and system_prompt are required" }, 400);
  }

  const id = generateId();
  await c.env.DB.prepare(
    "INSERT INTO agents (id, name, description, system_prompt, department, knowledge_category, icon, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, name, description || "", system_prompt, department || "", knowledge_category || "", icon || "\u{1F916}", adminId).run();

  const agent = await c.env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(id).first();
  await logAudit(c.env.DB, adminId, "create_agent", "agent", id, name);

  return c.json({ agent });
});

app.patch("/api/admin/agents/:id", adminMiddleware, async (c) => {
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

app.delete("/api/admin/agents/:id", adminMiddleware, async (c) => {
  const adminId = c.get("userId");
  const agentId = c.req.param("id");

  const agent = await c.env.DB.prepare("SELECT name FROM agents WHERE id = ?")
    .bind(agentId).first<{ name: string }>();

  await c.env.DB.prepare("DELETE FROM agents WHERE id = ?").bind(agentId).run();
  await logAudit(c.env.DB, adminId, "delete_agent", "agent", agentId, agent?.name || "");

  return c.json({ success: true });
});

app.get("/api/admin/agents", adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM agents ORDER BY created_at DESC"
  ).all();
  return c.json({ agents: results || [] });
});

// ─── Seed Default Agents ─────────────────────────────────────────────

app.post("/api/admin/seed-agents", adminMiddleware, async (c) => {
  await ensureAgentUserTypeColumn(c.env.DB);
  const adminId = c.get("userId");

  const defaultAgents = [
    {
      name: "Procurement Specialist",
      description: "Expert guidance on Ghana Public Procurement Act (Act 663), tendering, and compliance",
      system_prompt: "You are a Procurement Specialist AI for the Government of Ghana. You are deeply knowledgeable about the Public Procurement Act, 2003 (Act 663) as amended by Act 914 (2016), procurement thresholds, competitive tendering, restricted tendering, single-source procurement, and request for quotations. Guide civil servants through procurement processes step by step, citing specific sections of the Act. Help with bid evaluation, contract management, and PPA compliance. Always reference current threshold values and entity classifications from Schedule 3.",
      department: "Procurement",
      icon: "\u{1F4DC}",
      user_type: "gog_employee",
      knowledge_category: "procurement"
    },
    {
      name: "IT Helpdesk",
      description: "Technical support for GIFMIS, email, network, and government IT systems",
      system_prompt: "You are an IT Helpdesk specialist for Government of Ghana operations. Help civil servants troubleshoot GIFMIS (Ghana Integrated Financial Management Information System), government email systems, network connectivity, VPN access, printer issues, Microsoft Office problems, and general IT support. Provide clear step-by-step troubleshooting instructions. Know common GoG IT infrastructure including GIFMIS, e-payroll, and departmental systems.",
      department: "IT",
      icon: "\u{1F527}",
      user_type: "gog_employee",
      knowledge_category: "it"
    },
    {
      name: "HR & Admin Officer",
      description: "Civil Service regulations, promotions, leave, pensions, and HR procedures",
      system_prompt: "You are an HR & Administrative Officer AI for the Ghana Civil Service. You are expert in the Civil Service Act (PNDCL 327), Labour Act 2003 (Act 651), National Pensions Act 2008 (Act 766), and OHCS regulations. Help with promotion processes, leave applications, disciplinary procedures, pension calculations (3-tier scheme), staff appraisals, transfer requests, and general HR administration. Reference specific Acts and sections.",
      department: "HR & Admin",
      icon: "\u{1F465}",
      user_type: "gog_employee",
      knowledge_category: "hr"
    },
    {
      name: "Study Coach",
      description: "Personalised study plans, motivation, and effective learning strategies",
      system_prompt: "You are a Study Coach AI for Ghanaian students. Help create personalised study timetables, recommend effective study techniques (active recall, spaced repetition, Pomodoro technique, mind mapping), provide motivation and accountability tips, and help manage exam stress. Understand the Ghana academic calendar, WASSCE/BECE schedules, and university semester systems. Be encouraging, practical, and culturally aware.",
      department: "Academic Support",
      icon: "\u{1F4DA}",
      user_type: "student",
      knowledge_category: ""
    },
    {
      name: "Essay Writing Tutor",
      description: "Structure, argumentation, and grammar coaching for academic essays",
      system_prompt: "You are an Essay Writing Tutor AI for Ghanaian students. Help with essay planning, thesis statements, paragraph structure, argumentation, transitions, conclusions, and grammar. Teach the difference between argumentative, expository, narrative, and descriptive essays. Review essay drafts for structure, coherence, and style. Encourage original thinking and proper citation (APA 7th edition). For WASSCE English essays, focus on the marking criteria: content, organisation, expression, and mechanical accuracy.",
      department: "Academic Support",
      icon: "\u{270D}\u{FE0F}",
      user_type: "student",
      knowledge_category: ""
    },
    {
      name: "WASSCE Prep",
      description: "Subject revision, past questions, and exam strategies for WASSCE/BECE",
      system_prompt: "You are a WASSCE/BECE Preparation AI for Ghanaian students. Help revise subjects using past question patterns and WAEC marking schemes. Cover Core subjects (English, Maths, Integrated Science, Social Studies) and popular electives. Provide practice questions, explain solutions step by step, identify common mistakes, and share exam tips. Know the WASSCE grading system (A1-F9) and how aggregates are calculated. Help students target specific grades and universities.",
      department: "Exam Preparation",
      icon: "\u{1F393}",
      user_type: "student",
      knowledge_category: ""
    },
    {
      name: "Research Assistant",
      description: "Literature review, citations, methodology guidance, and thesis support",
      system_prompt: "You are a Research Assistant AI for Ghanaian university students. Help with research proposals, literature reviews, methodology design (qualitative, quantitative, mixed methods), data analysis approaches, APA 7th edition citations, and thesis/project writing. Understand Ghana university thesis formats and requirements. Guide students through research ethics, sampling techniques, questionnaire design, and academic writing conventions. Help structure chapters and maintain academic rigour.",
      department: "Research",
      icon: "\u{1F52C}",
      user_type: "student",
      knowledge_category: ""
    }
  ];

  let seeded = 0;
  for (const agent of defaultAgents) {
    const existing = await c.env.DB.prepare("SELECT id FROM agents WHERE name = ?").bind(agent.name).first();
    if (!existing) {
      const id = generateId();
      await c.env.DB.prepare(
        "INSERT INTO agents (id, name, description, system_prompt, department, knowledge_category, icon, user_type, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(id, agent.name, agent.description, agent.system_prompt, agent.department, agent.knowledge_category, agent.icon, agent.user_type, adminId).run();
      seeded++;
    }
  }

  return c.json({ success: true, seeded, total: defaultAgents.length });
});

// ─── Artifact Detection ──────────────────────────────────────────────

app.post("/api/chat/detect-artifact", authMiddleware, async (c) => {
  const { content } = await c.req.json();

  if (!content || content.length < 20) {
    return c.json({ type: "text", title: "Chat response" });
  }

  try {
    const response = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
      messages: [
        {
          role: "system",
          content: `Classify this content. Is it primarily: (a) a document/memo/letter, (b) a code snippet, (c) a data table, (d) a list/outline, or (e) conversational text? Return JSON only: {"type": "document"|"code"|"table"|"list"|"text", "title": "short title"}. No explanation.`,
        },
        {
          role: "user",
          content: content.substring(0, 1500),
        },
      ],
      max_tokens: 100,
    });

    const raw = (response as any)?.response || "";
    try {
      // Try to parse JSON from the response
      const jsonMatch = raw.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const validTypes = ["document", "code", "table", "list", "text"];
        return c.json({
          type: validTypes.includes(parsed.type) ? parsed.type : "text",
          title: (parsed.title || "Chat response").substring(0, 100),
        });
      }
    } catch {}

    return c.json({ type: "text", title: "Chat response" });
  } catch {
    return c.json({ type: "text", title: "Chat response" });
  }
});

// ─── Folders (CRUD) ───────────────────────────────────────────────────

app.get("/api/folders", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, color, sort_order FROM folders WHERE user_id = ? ORDER BY sort_order ASC, name ASC"
  ).bind(userId).all();
  return c.json({ folders: results || [] });
});

app.post("/api/folders", authMiddleware, async (c) => {
  const userId = c.get("userId");

  // Check if user is on a paid plan
  const folderUser = await c.env.DB.prepare("SELECT tier FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string }>();
  if ((folderUser?.tier || "free") === "free") {
    return c.json({ error: "Folders are a premium feature. Upgrade to organize your conversations.", code: "PREMIUM_REQUIRED" }, 403);
  }

  const { name, color } = await c.req.json();
  if (!name) return c.json({ error: "Folder name is required" }, 400);

  const id = generateId();
  await c.env.DB.prepare(
    "INSERT INTO folders (id, user_id, name, color) VALUES (?, ?, ?, ?)"
  ).bind(id, userId, name, color || "#FCD116").run();

  return c.json({ id, name, color: color || "#FCD116" });
});

app.patch("/api/folders/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");

  // Check if user is on a paid plan
  const folderPatchUser = await c.env.DB.prepare("SELECT tier FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string }>();
  if ((folderPatchUser?.tier || "free") === "free") {
    return c.json({ error: "Folders are a premium feature. Upgrade to organize your conversations.", code: "PREMIUM_REQUIRED" }, 403);
  }

  const folderId = c.req.param("id");
  const { name, color } = await c.req.json();

  await c.env.DB.prepare(
    "UPDATE folders SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ? AND user_id = ?"
  ).bind(name || null, color || null, folderId, userId).run();

  return c.json({ success: true });
});

app.delete("/api/folders/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const folderId = c.req.param("id");

  // Unassign conversations from this folder
  await c.env.DB.prepare(
    "UPDATE conversations SET folder_id = NULL WHERE folder_id = ? AND user_id = ?"
  ).bind(folderId, userId).run();

  await c.env.DB.prepare(
    "DELETE FROM folders WHERE id = ? AND user_id = ?"
  ).bind(folderId, userId).run();

  return c.json({ success: true });
});

// ─── Conversation Pinning & Folder Assignment ─────────────────────────

app.patch("/api/conversations/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const convoId = c.req.param("id");
  const body = await c.req.json();

  const updates: string[] = [];
  const params: any[] = [];

  if (body.pinned !== undefined) {
    updates.push("pinned = ?");
    params.push(body.pinned ? 1 : 0);
  }
  if (body.folder_id !== undefined) {
    updates.push("folder_id = ?");
    params.push(body.folder_id);
  }
  if (body.title !== undefined) {
    updates.push("title = ?");
    params.push(body.title);
  }

  if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

  params.push(convoId, userId);
  await c.env.DB.prepare(
    `UPDATE conversations SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`
  ).bind(...params).run();

  return c.json({ success: true });
});

// ─── Conversation Sharing ──────────────────────────────────────────────

app.post("/api/conversations/:id/share", authMiddleware, async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const rl = await checkRateLimit(c.env, `${ip}:share`, "share");
  if (!rl.allowed) return c.json({ error: "Too many share requests. Please wait." }, 429);

  const userId = c.get("userId");
  const convoId = c.req.param("id");

  // Verify ownership
  const convo = await c.env.DB.prepare(
    "SELECT id, title FROM conversations WHERE id = ? AND user_id = ?"
  ).bind(convoId, userId).first();

  if (!convo) return c.json({ error: "Conversation not found" }, 404);

  // Check if already shared
  const existing = await c.env.DB.prepare(
    "SELECT share_token FROM conversations WHERE id = ? AND share_token IS NOT NULL"
  ).bind(convoId).first<{ share_token: string }>();

  if (existing?.share_token) {
    return c.json({ shareToken: existing.share_token, alreadyShared: true });
  }

  // Generate share token
  const shareToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  await c.env.DB.prepare(
    "UPDATE conversations SET share_token = ?, shared_at = datetime('now') WHERE id = ?"
  ).bind(shareToken, convoId).run();

  return c.json({ shareToken });
});

app.delete("/api/conversations/:id/share", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const convoId = c.req.param("id");

  await c.env.DB.prepare(
    "UPDATE conversations SET share_token = NULL, shared_at = NULL WHERE id = ? AND user_id = ?"
  ).bind(convoId, userId).run();

  return c.json({ success: true });
});

app.get("/api/shared/:token", async (c) => {
  const token = c.req.param("token");
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const rl = await checkRateLimit(c.env, ip, "api");
  if (!rl.allowed) return c.json({ error: "Rate limited" }, 429);

  const convo = await c.env.DB.prepare(
    `SELECT c.id, c.title, c.shared_at, u.full_name as author_name, u.department as author_dept
     FROM conversations c JOIN users u ON u.id = c.user_id
     WHERE c.share_token = ?`
  ).bind(token).first<any>();

  if (!convo) return c.json({ error: "Shared conversation not found or link expired" }, 404);

  // Enforce 30-day expiration on shared links
  if (convo.shared_at) {
    const sharedDate = new Date(convo.shared_at + "Z");
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - sharedDate.getTime() > thirtyDaysMs) {
      return c.json({ error: "This shared link has expired" }, 410);
    }
  }

  // Anonymize author name (e.g. "Kofi Asante" -> "K. A.")
  if (convo.author_name) {
    const parts = convo.author_name.split(" ");
    convo.author_name = parts.map((p: string) => p[0] + ".").join(" ");
  }

  const { results: messages } = await c.env.DB.prepare(
    "SELECT role, content, model, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
  ).bind((convo as any).id).all();

  return c.json({
    title: (convo as any).title,
    authorName: (convo as any).author_name,
    authorDept: (convo as any).author_dept,
    sharedAt: (convo as any).shared_at,
    messages: messages || [],
  });
});

// ─── Follow-up Suggestions ────────────────────────────────────────────

app.get("/api/chat/suggestions/:conversationId", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const conversationId = c.req.param("conversationId");

  const convo = await c.env.DB.prepare(
    "SELECT id, template_id FROM conversations WHERE id = ? AND user_id = ?"
  ).bind(conversationId, userId).first<{ id: string; template_id: string | null }>();

  if (!convo) return c.json({ suggestions: [] });

  // Get last assistant message
  const lastMsg = await c.env.DB.prepare(
    "SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1"
  ).bind(conversationId).first<{ content: string }>();

  if (!lastMsg) return c.json({ suggestions: [] });

  // Generate context-aware suggestions using a fast model
  try {
    const response = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant. Based on the conversation context, suggest exactly 3 short follow-up prompts the user might want to ask next. Return ONLY a JSON array of 3 strings, each under 60 characters. No explanation."
        },
        {
          role: "user",
          content: `The assistant just responded with: "${lastMsg.content.substring(0, 500)}"\n\nSuggest 3 follow-up questions or actions.`
        },
      ],
      max_tokens: 200,
    });

    let suggestions: string[] = [];
    const raw = (response as any)?.response || "";
    try {
      const parsed = JSON.parse(raw.trim());
      if (Array.isArray(parsed)) suggestions = parsed.slice(0, 3).map((s: any) => String(s).slice(0, 80));
    } catch {
      // Fallback: extract lines
      suggestions = raw.split("\n").filter((l: string) => l.trim().length > 5).slice(0, 3).map((l: string) => l.replace(/^\d+[.)]\s*/, "").replace(/^["']|["']$/g, "").trim());
    }

    return c.json({ suggestions });
  } catch {
    return c.json({ suggestions: [] });
  }
});

// ─── Announcements (user-facing) ──────────────────────────────────────

app.get("/api/announcements", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, content, type, dismissible, created_at
     FROM announcements
     WHERE active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))
     ORDER BY created_at DESC LIMIT 5`
  ).all();
  return c.json({ announcements: results || [] });
});

// ─── Announcements (admin CRUD) ───────────────────────────────────────

app.get("/api/admin/announcements", adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, u.full_name as admin_name
     FROM announcements a JOIN users u ON u.id = a.admin_id
     ORDER BY a.created_at DESC LIMIT 50`
  ).all();
  return c.json({ announcements: results || [] });
});

app.post("/api/admin/announcements", adminMiddleware, async (c) => {
  const adminId = c.get("userId");
  const { title, content, type, dismissible, expiresAt } = await c.req.json();
  if (!title || !content) return c.json({ error: "Title and content required" }, 400);

  const id = generateId();
  await c.env.DB.prepare(
    "INSERT INTO announcements (id, admin_id, title, content, type, dismissible, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, adminId, title, content, type || "info", dismissible !== false ? 1 : 0, expiresAt || null).run();

  await logAudit(c.env.DB, adminId, "create_announcement", "announcement", id, title);
  return c.json({ id, success: true });
});

app.patch("/api/admin/announcements/:id", adminMiddleware, async (c) => {
  const announcementId = c.req.param("id");
  const { active } = await c.req.json();
  await c.env.DB.prepare("UPDATE announcements SET active = ? WHERE id = ?")
    .bind(active ? 1 : 0, announcementId).run();

  await logAudit(c.env.DB, c.get("userId"), active ? "activate_announcement" : "deactivate_announcement", "announcement", announcementId);
  return c.json({ success: true });
});

app.delete("/api/admin/announcements/:id", adminMiddleware, async (c) => {
  const announcementId = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM announcements WHERE id = ?").bind(announcementId).run();
  await logAudit(c.env.DB, c.get("userId"), "delete_announcement", "announcement", announcementId);
  return c.json({ success: true });
});

// ─── CSV Export (admin) ───────────────────────────────────────────────

app.get("/api/admin/export/users", adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, email, full_name, department, role, tier, affiliate_tier, total_referrals, affiliate_earnings, created_at, last_login FROM users ORDER BY created_at DESC"
  ).all();

  const headers = ["id","email","full_name","department","role","tier","affiliate_tier","total_referrals","affiliate_earnings","created_at","last_login"];
  const csv = [headers.join(","), ...(results || []).map((r: any) =>
    headers.map(h => `"${String(r[h] || "").replace(/"/g, '""')}"`).join(",")
  )].join("\n");

  await logAudit(c.env.DB, c.get("userId"), "export_users_csv", "system");
  return new Response(csv, {
    headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=askozzy-users.csv" },
  });
});

app.get("/api/admin/export/analytics", adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT date(m.created_at) as date, COUNT(*) as messages,
       COUNT(DISTINCT c.user_id) as active_users,
       COUNT(DISTINCT c.id) as conversations
     FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE m.created_at >= datetime('now', '-30 days')
     GROUP BY date(m.created_at) ORDER BY date ASC`
  ).all();

  const headers = ["date","messages","active_users","conversations"];
  const csv = [headers.join(","), ...(results || []).map((r: any) =>
    headers.map(h => String(r[h] || "")).join(",")
  )].join("\n");

  await logAudit(c.env.DB, c.get("userId"), "export_analytics_csv", "system");
  return new Response(csv, {
    headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=askozzy-analytics.csv" },
  });
});

// ─── Audit Log — Admin Actions (legacy view) ─────────────────────────

app.get("/api/admin/audit-log", adminMiddleware, async (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
  const offset = (page - 1) * limit;

  const total = await c.env.DB.prepare("SELECT COUNT(*) as count FROM audit_log").first<{ count: number }>();

  const { results } = await c.env.DB.prepare(
    `SELECT a.*, u.full_name as admin_name, u.email as admin_email
     FROM audit_log a JOIN users u ON u.id = a.admin_id
     ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  return c.json({ logs: results || [], total: total?.count || 0, page, limit });
});

// ─── User Activity Audit Trail (admin view, filterable + paginated) ────

app.get("/api/admin/audit", adminMiddleware, async (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
  const offset = (page - 1) * limit;
  const actionType = c.req.query("action_type") || "";
  const userId = c.req.query("user_id") || "";
  const dateFrom = c.req.query("date_from") || "";
  const dateTo = c.req.query("date_to") || "";
  const search = c.req.query("search") || "";

  let where = "WHERE 1=1";
  const params: any[] = [];

  if (actionType) {
    where += " AND action_type = ?";
    params.push(actionType);
  }
  if (userId) {
    where += " AND user_id = ?";
    params.push(userId);
  }
  if (dateFrom) {
    where += " AND created_at >= ?";
    params.push(dateFrom + " 00:00:00");
  }
  if (dateTo) {
    where += " AND created_at <= ?";
    params.push(dateTo + " 23:59:59");
  }
  if (search) {
    where += " AND (user_email LIKE ? OR query_preview LIKE ? OR department LIKE ?)";
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM user_audit_log ${where}`
  ).bind(...params).first<{ count: number }>();

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM user_audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  return c.json({
    entries: results || [],
    total: countResult?.count || 0,
    page,
    limit,
  });
});

// ─── User Activity Audit: CSV Export ──────────────────────────────────

app.get("/api/admin/audit/export", adminMiddleware, async (c) => {
  const actionType = c.req.query("action_type") || "";
  const dateFrom = c.req.query("date_from") || "";
  const dateTo = c.req.query("date_to") || "";
  const search = c.req.query("search") || "";

  let where = "WHERE 1=1";
  const params: any[] = [];

  if (actionType) {
    where += " AND action_type = ?";
    params.push(actionType);
  }
  if (dateFrom) {
    where += " AND created_at >= ?";
    params.push(dateFrom + " 00:00:00");
  }
  if (dateTo) {
    where += " AND created_at <= ?";
    params.push(dateTo + " 23:59:59");
  }
  if (search) {
    where += " AND (user_email LIKE ? OR query_preview LIKE ? OR department LIKE ?)";
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM user_audit_log ${where} ORDER BY created_at DESC LIMIT 10000`
  ).bind(...params).all();

  const rows = results || [];
  let csv = "ID,User ID,Email,Department,Action Type,Query Preview,Model Used,IP Address,Timestamp\n";
  for (const r of rows) {
    const escape = (v: any) => {
      if (v === null || v === undefined) return "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    };
    csv += [
      r.id, r.user_id, escape(r.user_email), escape(r.department),
      r.action_type, escape(r.query_preview), escape(r.model_used),
      r.ip_address, r.created_at,
    ].join(",") + "\n";
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="askozzy-audit-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
});

// ─── User Activity Audit: Aggregate Stats ─────────────────────────────

app.get("/api/admin/audit/stats", adminMiddleware, async (c) => {
  const totalResult = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM user_audit_log"
  ).first<{ count: number }>();

  const todayStr = new Date().toISOString().split("T")[0];
  const todayResult = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM user_audit_log WHERE date(created_at) = ?"
  ).bind(todayStr).first<{ count: number }>();

  const { results: byAction } = await c.env.DB.prepare(
    "SELECT action_type, COUNT(*) as count FROM user_audit_log GROUP BY action_type ORDER BY count DESC"
  ).all<{ action_type: string; count: number }>();

  const { results: byDepartment } = await c.env.DB.prepare(
    "SELECT department, COUNT(*) as count FROM user_audit_log WHERE department IS NOT NULL AND department != '' GROUP BY department ORDER BY count DESC LIMIT 15"
  ).all<{ department: string; count: number }>();

  const { results: dailyCounts } = await c.env.DB.prepare(
    "SELECT date(created_at) as day, COUNT(*) as count FROM user_audit_log WHERE created_at >= datetime('now', '-30 days') GROUP BY date(created_at) ORDER BY day ASC"
  ).all<{ day: string; count: number }>();

  return c.json({
    total: totalResult?.count || 0,
    today: todayResult?.count || 0,
    byAction: byAction || [],
    byDepartment: byDepartment || [],
    dailyCounts: dailyCounts || [],
  });
});

// ─── Content Moderation (admin) ───────────────────────────────────────

app.get("/api/admin/moderation", adminMiddleware, async (c) => {
  const status = c.req.query("status") || "pending";
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = (page - 1) * limit;

  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM moderation_flags WHERE status = ?"
  ).bind(status).first<{ count: number }>();

  const { results } = await c.env.DB.prepare(
    `SELECT f.*, u.full_name as user_name, u.email as user_email,
       c.title as conversation_title,
       (SELECT content FROM messages WHERE id = f.message_id) as message_content
     FROM moderation_flags f
     JOIN users u ON u.id = f.user_id
     JOIN conversations c ON c.id = f.conversation_id
     WHERE f.status = ?
     ORDER BY f.created_at DESC LIMIT ? OFFSET ?`
  ).bind(status, limit, offset).all();

  return c.json({ flags: results || [], total: total?.count || 0, page, limit });
});

app.patch("/api/admin/moderation/:id", adminMiddleware, async (c) => {
  const flagId = c.req.param("id");
  const { status } = await c.req.json();
  if (!["reviewed", "dismissed"].includes(status)) {
    return c.json({ error: "Status must be 'reviewed' or 'dismissed'" }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE moderation_flags SET status = ?, reviewed_by = ? WHERE id = ?"
  ).bind(status, c.get("userId"), flagId).run();

  await logAudit(c.env.DB, c.get("userId"), `moderation_${status}`, "moderation_flag", flagId);
  return c.json({ success: true });
});

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

// ─── User Usage Dashboard ─────────────────────────────────────────────

app.get("/api/user/dashboard", authMiddleware, async (c) => {
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

app.get("/api/user/sessions", authMiddleware, async (c) => {
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

app.post("/api/user/sessions/revoke-all", authMiddleware, async (c) => {
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

app.post("/api/user/2fa/setup", authMiddleware, async (c) => {
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

app.post("/api/user/2fa/verify", authMiddleware, async (c) => {
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

app.post("/api/user/2fa/disable", authMiddleware, async (c) => {
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

// TOTP verification helper
async function verifyTOTP(secret: string, code: string): Promise<boolean> {
  const timeStep = 30;
  const now = Math.floor(Date.now() / 1000);

  // Check current and adjacent time windows (±1 step for clock drift)
  for (const offset of [-1, 0, 1]) {
    const counter = Math.floor((now / timeStep) + offset);
    const expected = await generateTOTPCode(secret, counter);
    if (expected === code) return true;
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

// ─── WebAuthn Registration ─────────────────────────────────────────────

app.post("/api/auth/webauthn/register-options", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const user = await c.env.DB.prepare("SELECT email, full_name FROM users WHERE id = ?")
    .bind(userId).first<{ email: string; full_name: string }>();
  if (!user) return c.json({ error: "User not found" }, 404);

  await ensureWebAuthnTable(c.env.DB);

  // Fetch existing credentials to exclude
  const { results: existingCreds } = await c.env.DB.prepare(
    "SELECT credential_id FROM webauthn_credentials WHERE user_id = ?"
  ).bind(userId).all();

  const challenge = bufToBase64url(crypto.getRandomValues(new Uint8Array(32)));
  await c.env.SESSIONS.put(`webauthn_challenge:${userId}`, challenge, { expirationTtl: 300 });

  return c.json({
    challenge,
    rp: { name: "AskOzzy", id: new URL(c.req.url).hostname },
    user: {
      id: bufToBase64url(new TextEncoder().encode(userId)),
      name: user.email,
      displayName: user.full_name,
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 }, // ES256
    ],
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "preferred",
    },
    timeout: 60000,
    excludeCredentials: (existingCreds || []).map((cr: any) => ({
      type: "public-key",
      id: cr.credential_id,
    })),
  });
});

app.post("/api/auth/webauthn/register-complete", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { credentialId, attestationObject, clientDataJSON } = await c.req.json();

  if (!credentialId || !attestationObject || !clientDataJSON) {
    return c.json({ error: "Missing registration data" }, 400);
  }

  // Verify challenge
  const storedChallenge = await c.env.SESSIONS.get(`webauthn_challenge:${userId}`);
  if (!storedChallenge) return c.json({ error: "Challenge expired" }, 400);
  await c.env.SESSIONS.delete(`webauthn_challenge:${userId}`);

  const clientData = JSON.parse(new TextDecoder().decode(base64urlToBuf(clientDataJSON)));
  if (clientData.challenge !== storedChallenge) {
    return c.json({ error: "Challenge mismatch" }, 400);
  }
  if (clientData.type !== "webauthn.create") {
    return c.json({ error: "Invalid client data type" }, 400);
  }
  const expectedOrigin = `https://${new URL(c.req.url).hostname}`;
  if (clientData.origin !== expectedOrigin) {
    return c.json({ error: "Origin mismatch" }, 400);
  }

  // Parse attestation object (CBOR)
  const attestation = decodeCBOR(base64urlToBuf(attestationObject));
  const authData = attestation.authData as Uint8Array;

  // authData structure: rpIdHash(32) + flags(1) + signCount(4) + attestedCredData(variable)
  // attestedCredData: aaguid(16) + credIdLen(2) + credId(credIdLen) + credentialPublicKey(CBOR)
  const credIdLen = (authData[53] << 8) | authData[54];
  const credIdBytes = authData.slice(55, 55 + credIdLen);
  const coseKeyBytes = authData.slice(55 + credIdLen);
  const coseKey = decodeCBOR(coseKeyBytes.buffer);
  const spki = coseToSpki(coseKey);
  const publicKeyBase64 = bufToBase64url(spki);

  await ensureWebAuthnTable(c.env.DB);
  await c.env.DB.prepare(
    "INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key, sign_count) VALUES (?, ?, ?, ?, 0)"
  ).bind(generateId(), userId, credentialId, publicKeyBase64).run();

  // Update auth_method if first passkey
  await ensureAuthMethodColumns(c.env.DB);
  const { results: creds } = await c.env.DB.prepare(
    "SELECT id FROM webauthn_credentials WHERE user_id = ?"
  ).bind(userId).all();
  if (creds && creds.length === 1) {
    await c.env.DB.prepare("UPDATE users SET auth_method = 'webauthn' WHERE id = ? AND auth_method != 'totp'")
      .bind(userId).run();
  }

  return c.json({ success: true, message: "Passkey registered successfully" });
});

// ─── WebAuthn Login ──────────────────────────────────────────────────────

app.post("/api/auth/webauthn/login-options", async (c) => {
  const { email } = await c.req.json();
  if (!email) return c.json({ error: "Email is required" }, 400);

  const user = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email.toLowerCase().trim()).first<{ id: string }>();
  if (!user) return c.json({ error: "No account found" }, 404);

  await ensureWebAuthnTable(c.env.DB);
  const { results: creds } = await c.env.DB.prepare(
    "SELECT credential_id FROM webauthn_credentials WHERE user_id = ?"
  ).bind(user.id).all();

  if (!creds || creds.length === 0) {
    return c.json({ error: "No passkeys registered for this account" }, 400);
  }

  const challenge = bufToBase64url(crypto.getRandomValues(new Uint8Array(32)));
  await c.env.SESSIONS.put(`webauthn_challenge:${user.id}`, challenge, { expirationTtl: 300 });

  return c.json({
    challenge,
    rpId: new URL(c.req.url).hostname,
    allowCredentials: creds.map((cr: any) => ({
      type: "public-key",
      id: cr.credential_id,
    })),
    userVerification: "preferred",
    timeout: 60000,
  });
});

app.post("/api/auth/webauthn/login-complete", async (c) => {
  const { email, credentialId, authenticatorData, clientDataJSON, signature } = await c.req.json();

  if (!email || !credentialId || !authenticatorData || !clientDataJSON || !signature) {
    return c.json({ error: "Missing authentication data" }, 400);
  }

  const user = await c.env.DB.prepare(
    "SELECT id, email, full_name, department, role, tier, referral_code, affiliate_tier, total_referrals, affiliate_earnings, trial_expires_at, user_type FROM users WHERE email = ?"
  ).bind(email.toLowerCase().trim()).first<{
    id: string; email: string; full_name: string; department: string;
    role: string; tier: string; referral_code: string;
    affiliate_tier: string; total_referrals: number; affiliate_earnings: number;
    trial_expires_at: string | null; user_type: string | null;
  }>();
  if (!user) return c.json({ error: "User not found" }, 401);

  // Verify challenge
  const storedChallenge = await c.env.SESSIONS.get(`webauthn_challenge:${user.id}`);
  if (!storedChallenge) return c.json({ error: "Challenge expired" }, 400);
  await c.env.SESSIONS.delete(`webauthn_challenge:${user.id}`);

  const clientData = JSON.parse(new TextDecoder().decode(base64urlToBuf(clientDataJSON)));
  if (clientData.challenge !== storedChallenge) return c.json({ error: "Challenge mismatch" }, 400);
  if (clientData.type !== "webauthn.get") return c.json({ error: "Invalid client data type" }, 400);
  const expectedOrigin = `https://${new URL(c.req.url).hostname}`;
  if (clientData.origin !== expectedOrigin) {
    return c.json({ error: "Origin mismatch" }, 400);
  }

  // Find credential
  await ensureWebAuthnTable(c.env.DB);
  const cred = await c.env.DB.prepare(
    "SELECT id, public_key, sign_count FROM webauthn_credentials WHERE credential_id = ? AND user_id = ?"
  ).bind(credentialId, user.id).first<{ id: string; public_key: string; sign_count: number }>();
  if (!cred) return c.json({ error: "Credential not found" }, 401);

  // Verify signature: signature is over (authData + SHA256(clientDataJSON))
  const authDataBuf = base64urlToBuf(authenticatorData);
  const clientDataHash = await crypto.subtle.digest("SHA-256", base64urlToBuf(clientDataJSON));
  const signedData = new Uint8Array(authDataBuf.byteLength + clientDataHash.byteLength);
  signedData.set(new Uint8Array(authDataBuf), 0);
  signedData.set(new Uint8Array(clientDataHash), authDataBuf.byteLength);

  const publicKey = await crypto.subtle.importKey(
    "spki", base64urlToBuf(cred.public_key),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, publicKey, base64urlToBuf(signature), signedData
  );

  if (!valid) return c.json({ error: "Invalid signature" }, 401);

  // Update sign count
  const authDataArr = new Uint8Array(authDataBuf);
  const newSignCount = (authDataArr[33] << 24) | (authDataArr[34] << 16) | (authDataArr[35] << 8) | authDataArr[36];
  if (newSignCount > 0 && newSignCount <= cred.sign_count) {
    return c.json({ error: "Possible credential cloning detected" }, 401);
  }
  await c.env.DB.prepare("UPDATE webauthn_credentials SET sign_count = ? WHERE id = ?")
    .bind(newSignCount, cred.id).run();

  await c.env.DB.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?")
    .bind(user.id).run();

  const token = await createToken(user.id, c.env);
  const trialActive = user.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date();
  const effectiveTier = (trialActive && (user.tier || "free") === "free") ? "professional" : (user.tier || "free");

  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      department: user.department,
      role: user.role || "civil_servant",
      tier: user.tier,
      effectiveTier,
      referralCode: user.referral_code,
      affiliateTier: user.affiliate_tier,
      totalReferrals: user.total_referrals,
      affiliateEarnings: user.affiliate_earnings,
      trialExpiresAt: user.trial_expires_at || null,
      userType: user.user_type || "gog_employee",
    },
  });
});

// ─── WebAuthn Credential Management ──────────────────────────────────────

app.get("/api/auth/webauthn/credentials", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureWebAuthnTable(c.env.DB);
  const { results } = await c.env.DB.prepare(
    "SELECT id, credential_id, created_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC"
  ).bind(userId).all();
  return c.json({ credentials: results || [] });
});

app.delete("/api/auth/webauthn/credentials/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const credId = c.req.param("id");
  await ensureWebAuthnTable(c.env.DB);
  await c.env.DB.prepare(
    "DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?"
  ).bind(credId, userId).run();
  return c.json({ success: true });
});

// ─── Recovery Code Regeneration ──────────────────────────────────────────

app.post("/api/auth/recovery-code/regenerate", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const newCode = generateRecoveryCode();
  const hash = await hashPassword(newCode);
  await ensureAuthMethodColumns(c.env.DB);
  await c.env.DB.prepare("UPDATE users SET recovery_code_hash = ? WHERE id = ?")
    .bind(hash, userId).run();
  return c.json({ recoveryCode: newCode });
});

// ─── Organization / Team Billing ──────────────────────────────────────

app.post("/api/organizations", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { name } = await c.req.json();
  if (!name) return c.json({ error: "Organization name required" }, 400);

  const id = generateId();
  await c.env.DB.prepare(
    "INSERT INTO organizations (id, name, owner_id) VALUES (?, ?, ?)"
  ).bind(id, name, userId).run();

  await c.env.DB.prepare("UPDATE users SET org_id = ? WHERE id = ?")
    .bind(id, userId).run();

  return c.json({ id, name });
});

app.get("/api/organizations/mine", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const user = await c.env.DB.prepare("SELECT org_id FROM users WHERE id = ?")
    .bind(userId).first<{ org_id: string | null }>();

  if (!user?.org_id) return c.json({ organization: null });

  const org = await c.env.DB.prepare(
    "SELECT o.*, (SELECT COUNT(*) FROM users WHERE org_id = o.id) as member_count FROM organizations o WHERE o.id = ?"
  ).bind(user.org_id).first();

  const { results: members } = await c.env.DB.prepare(
    "SELECT id, email, full_name, department, tier, role FROM users WHERE org_id = ? ORDER BY full_name"
  ).bind(user.org_id).all();

  return c.json({ organization: org, members: members || [], isOwner: org && (org as any).owner_id === userId });
});

app.post("/api/organizations/:id/invite", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const orgId = c.req.param("id");
  const { email } = await c.req.json();

  // Verify caller is org owner
  const org = await c.env.DB.prepare(
    "SELECT id FROM organizations WHERE id = ? AND owner_id = ?"
  ).bind(orgId, userId).first();
  if (!org) return c.json({ error: "Not authorized" }, 403);

  // Find user by email
  const invitee = await c.env.DB.prepare(
    "SELECT id, org_id FROM users WHERE email = ?"
  ).bind(email.toLowerCase().trim()).first<{ id: string; org_id: string | null }>();

  if (!invitee) return c.json({ error: "User not found" }, 404);
  if (invitee.org_id) return c.json({ error: "User already in an organization" }, 400);

  // Check seat limit
  const memberCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM users WHERE org_id = ?"
  ).bind(orgId).first<{ count: number }>();

  const orgDetails = await c.env.DB.prepare(
    "SELECT max_seats FROM organizations WHERE id = ?"
  ).bind(orgId).first<{ max_seats: number }>();

  if (memberCount && orgDetails && memberCount.count >= orgDetails.max_seats) {
    return c.json({ error: `Organization seat limit (${orgDetails.max_seats}) reached` }, 400);
  }

  await c.env.DB.prepare("UPDATE users SET org_id = ? WHERE id = ?")
    .bind(orgId, invitee.id).run();

  return c.json({ success: true, message: `${email} added to organization` });
});

app.post("/api/organizations/:id/remove", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const orgId = c.req.param("id");
  const { memberId } = await c.req.json();

  const org = await c.env.DB.prepare(
    "SELECT id FROM organizations WHERE id = ? AND owner_id = ?"
  ).bind(orgId, userId).first();
  if (!org) return c.json({ error: "Not authorized" }, 403);
  if (memberId === userId) return c.json({ error: "Cannot remove yourself" }, 400);

  await c.env.DB.prepare("UPDATE users SET org_id = NULL WHERE id = ? AND org_id = ?")
    .bind(memberId, orgId).run();

  return c.json({ success: true });
});

// ─── Paystack Payment Integration ─────────────────────────────────────

const PAYSTACK_PLANS: Record<string, { amount: number; studentAmount: number; planCode: string }> = {
  professional: { amount: 6000, studentAmount: 2500, planCode: "professional" }, // GHS 60 / GHS 25 students
  enterprise: { amount: 10000, studentAmount: 4500, planCode: "enterprise" },   // GHS 100 / GHS 45 students
};

app.post("/api/payments/initialize", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { tier } = await c.req.json();

  if (!PAYSTACK_PLANS[tier]) {
    return c.json({ error: "Invalid plan" }, 400);
  }

  const user = await c.env.DB.prepare("SELECT email, tier, user_type FROM users WHERE id = ?")
    .bind(userId).first<{ email: string; tier: string; user_type: string }>();

  if (!user) return c.json({ error: "User not found" }, 404);
  if (user.tier === tier) return c.json({ error: "Already on this plan" }, 400);

  const plan = PAYSTACK_PLANS[tier];
  const isStudent = user.user_type === "student";
  const chargeAmount = isStudent ? plan.studentAmount : plan.amount;
  const reference = `askozzy_${userId}_${tier}_${Date.now()}`;

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
          metadata: { userId, tier, custom_fields: [{ display_name: "Plan", variable_name: "plan", value: tier }] },
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
app.post("/api/webhooks/paystack", async (c) => {
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

  const event = JSON.parse(body);

  if (event.event === "charge.success") {
    const { metadata, reference, amount: amountPesewas, customer } = event.data;
    if (metadata?.userId && metadata?.tier) {
      // Validate tier exists in our plans
      const plan = PAYSTACK_PLANS[metadata.tier];
      if (!plan) {
        console.error("Webhook: unknown tier", metadata.tier);
        return c.json({ error: "Unknown tier" }, 400);
      }

      // Validate payment amount matches expected price (allow student pricing)
      const paidAmount = Number(amountPesewas) || 0;
      if (paidAmount < plan.studentAmount) {
        console.error("Webhook: amount mismatch", { expected: plan.studentAmount, received: paidAmount, tier: metadata.tier });
        return c.json({ error: "Payment amount mismatch" }, 400);
      }

      // Upgrade user's tier
      await c.env.DB.prepare("UPDATE users SET tier = ? WHERE id = ?")
        .bind(metadata.tier, metadata.userId).run();

      // Process affiliate commissions (non-blocking)
      // Paystack amounts are in pesewas (1 GHS = 100 pesewas)
      const paymentAmountGHS = paidAmount / 100;

      if (paymentAmountGHS > 0) {
        c.executionCtx.waitUntil((async () => {
          try {
            await processAffiliateCommissions(c.env.DB, metadata.userId, paymentAmountGHS, reference || "");
          } catch (err) {
            console.error("Affiliate commission error:", err);
          }
        })());
      }
    }
  }

  return c.json({ received: true });
});

// ─── Admin: Moderation Stats, Rate Limiting Dashboard ──────────────────

app.get("/api/admin/moderation/stats", adminMiddleware, async (c) => {
  const pending = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM moderation_flags WHERE status = 'pending'"
  ).first<{ count: number }>();

  const reviewed = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM moderation_flags WHERE status = 'reviewed'"
  ).first<{ count: number }>();

  const dismissed = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM moderation_flags WHERE status = 'dismissed'"
  ).first<{ count: number }>();

  const { results: recentFlags } = await c.env.DB.prepare(
    `SELECT f.reason, f.created_at, u.full_name, u.email
     FROM moderation_flags f JOIN users u ON u.id = f.user_id
     WHERE f.status = 'pending'
     ORDER BY f.created_at DESC LIMIT 10`
  ).all();

  return c.json({
    pending: pending?.count || 0,
    reviewed: reviewed?.count || 0,
    dismissed: dismissed?.count || 0,
    recentFlags: recentFlags || [],
  });
});

app.get("/api/admin/rate-limits", adminMiddleware, async (c) => {
  // Show current tier configurations and active usage
  const { results: heavyUsers } = await c.env.DB.prepare(
    `SELECT u.full_name, u.email, u.tier, COUNT(m.id) as today_messages
     FROM users u
     JOIN conversations c ON c.user_id = u.id
     JOIN messages m ON m.conversation_id = c.id AND m.role = 'user' AND date(m.created_at) = date('now')
     GROUP BY u.id
     ORDER BY today_messages DESC
     LIMIT 20`
  ).all();

  return c.json({
    tiers: PRICING_TIERS,
    heavyUsers: heavyUsers || [],
  });
});

// ─── Admin: Organization management ───────────────────────────────────

app.get("/api/admin/organizations", adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT o.*, u.full_name as owner_name, u.email as owner_email,
       (SELECT COUNT(*) FROM users WHERE org_id = o.id) as member_count
     FROM organizations o JOIN users u ON u.id = o.owner_id
     ORDER BY o.created_at DESC`
  ).all();
  return c.json({ organizations: results || [] });
});

// ─── Admin: Bulk User Import ──────────────────────────────────────────

app.post("/api/admin/users/bulk", adminMiddleware, async (c) => {
  const adminId = c.get("userId");
  const { users: userList, defaultTier } = await c.req.json();

  if (!Array.isArray(userList) || userList.length === 0) {
    return c.json({ error: "Users array is required" }, 400);
  }
  if (userList.length > 500) {
    return c.json({ error: "Maximum 500 users per batch" }, 400);
  }

  const tier = defaultTier || "free";
  const results: Array<{ email: string; status: string; accessCode?: string }> = [];

  for (const u of userList) {
    const email = (u.email || "").toLowerCase().trim();
    const fullName = (u.fullName || u.full_name || u.name || "").trim();
    const department = (u.department || u.dept || "").trim();

    if (!email || !fullName) {
      results.push({ email: email || "unknown", status: "skipped — missing email or name" });
      continue;
    }

    // Check if already exists
    const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(email).first();
    if (existing) {
      results.push({ email, status: "skipped — already exists" });
      continue;
    }

    const userId = generateId();
    const accessCode = generateAccessCode();
    const passwordHash = await hashPassword(accessCode);
    const firstName = fullName.split(" ")[0].toUpperCase();
    const suffix = generateReferralSuffix();
    const referralCode = `OZZY-${firstName}-${suffix}`;

    try {
      await c.env.DB.prepare(
        "INSERT INTO users (id, email, password_hash, full_name, department, tier, referral_code) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(userId, email, passwordHash, fullName, department, tier, referralCode).run();

      results.push({ email, status: "created", accessCode });
    } catch (err) {
      console.error("Bulk user import error:", email, (err as Error).message);
      results.push({ email, status: "failed" });
    }
  }

  const created = results.filter(r => r.status === "created").length;
  await logAudit(c.env.DB, adminId, "bulk_import_users", "system", undefined, `Imported ${created} of ${userList.length} users`);

  return c.json({ results, summary: { total: userList.length, created, skipped: results.length - created } });
});

// ═══════════════════════════════════════════════════════════════════════
//  KNOWLEDGE BASE — RAG Document & FAQ Management
// ═══════════════════════════════════════════════════════════════════════

// 4. KB Stats (must be before :id routes)
app.get("/api/admin/kb/stats", adminMiddleware, async (c) => {
  const docCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM documents"
  ).first<{ count: number }>();

  const chunkCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM document_chunks"
  ).first<{ count: number }>();

  const faqCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM knowledge_base"
  ).first<{ count: number }>();

  const { results: docCategories } = await c.env.DB.prepare(
    "SELECT category, COUNT(*) as count FROM documents GROUP BY category ORDER BY count DESC"
  ).all<{ category: string; count: number }>();

  const { results: faqCategories } = await c.env.DB.prepare(
    "SELECT category, COUNT(*) as count FROM knowledge_base GROUP BY category ORDER BY count DESC"
  ).all<{ category: string; count: number }>();

  const readyDocs = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM documents WHERE status = 'ready'"
  ).first<{ count: number }>();

  const processingDocs = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM documents WHERE status = 'processing'"
  ).first<{ count: number }>();

  return c.json({
    documents: docCount?.count || 0,
    chunks: chunkCount?.count || 0,
    faqs: faqCount?.count || 0,
    readyDocs: readyDocs?.count || 0,
    processingDocs: processingDocs?.count || 0,
    docCategories: docCategories || [],
    faqCategories: faqCategories || [],
  });
});

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
app.post("/api/admin/documents", adminMiddleware, async (c) => {
  const adminId = c.get("userId");
  const { title, source, category, content } = await c.req.json();

  if (!title || !content) {
    return c.json({ error: "Title and content are required" }, 400);
  }

  if (content.length > 100000) {
    return c.json({ error: "Document too large. Maximum 100,000 characters." }, 400);
  }

  if (content.length < 50) {
    return c.json({ error: "Document too short. Minimum 50 characters." }, 400);
  }

  const docId = generateId();

  // Save document with 'processing' status
  await c.env.DB.prepare(
    "INSERT INTO documents (id, title, source, category, content, status, uploaded_by) VALUES (?, ?, ?, ?, ?, 'processing', ?)"
  ).bind(docId, title, source || '', category || 'general', content, adminId).run();

  await logAudit(c.env.DB, adminId, "upload_document", "document", docId, title);

  // Process in background: chunk, embed, store in Vectorize
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const chunks = chunkText(content, 500, 50);
        const chunkIds: string[] = [];

        // Process in batches of 100 (embedding API limit)
        for (let i = 0; i < chunks.length; i += 100) {
          const batch = chunks.slice(i, i + 100);
          const embeddings = await generateEmbeddings(c.env.AI, batch);

          const vectors: Array<{ id: string; values: number[]; metadata: Record<string, string> }> = [];

          for (let j = 0; j < batch.length; j++) {
            const chunkId = generateId();
            const vectorId = `doc_${docId}_chunk_${i + j}`;
            chunkIds.push(chunkId);

            vectors.push({
              id: vectorId,
              values: embeddings[j],
              metadata: {
                content: batch[j],
                document_id: docId,
                title: title,
                source: source || '',
                category: category || 'general',
              },
            });

            // Save chunk to D1
            await c.env.DB.prepare(
              "INSERT INTO document_chunks (id, document_id, chunk_index, content, vector_id) VALUES (?, ?, ?, ?, ?)"
            ).bind(chunkId, docId, i + j, batch[j], vectorId).run();
          }

          // Upsert to Vectorize
          await c.env.VECTORIZE.upsert(vectors);
        }

        // Update document status
        await c.env.DB.prepare(
          "UPDATE documents SET status = 'ready', chunk_count = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(chunks.length, docId).run();

      } catch (err) {
        await c.env.DB.prepare(
          "UPDATE documents SET status = 'error', updated_at = datetime('now') WHERE id = ?"
        ).bind(docId).run();
      }
    })()
  );

  return c.json({ id: docId, status: "processing", message: "Document uploaded. Processing chunks and embeddings..." });
});

// Admin: Upload document via file (text extraction)
app.post("/api/admin/documents/upload-file", adminMiddleware, async (c) => {
  const adminId = c.get("userId");

  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const title = formData.get("title") as string || "";
    const source = formData.get("source") as string || "";
    const category = formData.get("category") as string || "general";

    if (!file) return c.json({ error: "File is required" }, 400);
    if (!title) return c.json({ error: "Title is required" }, 400);

    // Reject truly unsupported binary formats
    const fileName = file.name.toLowerCase();
    const unsupportedExts = [".zip", ".rar", ".7z", ".exe", ".bin", ".dll", ".iso", ".mp3", ".mp4", ".avi", ".mov", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".woff", ".woff2", ".ttf", ".pdf"];
    for (const ext of unsupportedExts) {
      if (fileName.endsWith(ext)) {
        return c.json({ error: `Format (${ext}) is not supported. Supported: .docx, .pptx, .doc, .txt, .md, .csv, .json, .html` }, 400);
      }
    }

    // Extract text content from file based on format
    let content = "";

    if (fileName.endsWith(".docx")) {
      try {
        content = await extractDocxText(file);
      } catch (err) {
        console.error("DOCX extraction error:", (err as Error).message);
        return c.json({ error: "Failed to extract text from DOCX. The file may be corrupted or in an unsupported format." }, 400);
      }
    } else if (fileName.endsWith(".pptx")) {
      try {
        content = await extractPptxText(file);
      } catch (err) {
        console.error("PPTX extraction error:", (err as Error).message);
        return c.json({ error: "Failed to extract text from PPTX. The file may be corrupted or in an unsupported format." }, 400);
      }
    } else if (fileName.endsWith(".doc")) {
      try {
        content = await extractDocText(file);
        if (content.length < 50) {
          return c.json({ error: "Could not extract enough readable text from this .doc file. Try converting it to .docx first." }, 400);
        }
      } catch (err) {
        console.error("DOC extraction error:", (err as Error).message);
        return c.json({ error: "Failed to extract text from DOC. Try converting to .docx first." }, 400);
      }
    } else if (fileName.endsWith(".ppt")) {
      return c.json({ error: "Old .ppt format is not supported. Please convert to .pptx first (open in PowerPoint and Save As .pptx)." }, 400);
    } else if (fileName.endsWith(".xls") || fileName.endsWith(".xlsx")) {
      return c.json({ error: "Excel files are not yet supported. Export as .csv first." }, 400);
    } else if (fileName.endsWith(".txt") || fileName.endsWith(".md") || fileName.endsWith(".csv")) {
      content = await file.text();
    } else if (fileName.endsWith(".json")) {
      const jsonText = await file.text();
      try {
        const parsed = JSON.parse(jsonText);
        content = typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
      } catch {
        content = jsonText;
      }
    } else if (fileName.endsWith(".html") || fileName.endsWith(".htm")) {
      const htmlText = await file.text();
      content = htmlText.replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    } else {
      try {
        content = await file.text();
      } catch {
        return c.json({ error: "Unable to extract text. Supported: .docx, .pptx, .doc, .txt, .md, .csv, .json, .html" }, 400);
      }
    }

    if (content.length < 50) {
      return c.json({ error: "Extracted content is too short (minimum 50 characters)" }, 400);
    }
    if (content.length > 200000) {
      return c.json({ error: "File content exceeds 200,000 character limit" }, 400);
    }

    // Create document record
    const docId = generateId();
    await c.env.DB.prepare(
      "INSERT INTO documents (id, title, source, category, content, uploaded_by, status) VALUES (?, ?, ?, ?, ?, ?, 'processing')"
    ).bind(docId, title, source, category, content, adminId).run();

    // Process embeddings in background
    c.executionCtx.waitUntil(processDocumentEmbeddings(c.env, docId, title, source, content, category));

    await logAudit(c.env.DB, adminId, "upload_document_file", "document", docId, `${title} (${file.name}, ${content.length} chars)`);

    return c.json({
      id: docId,
      title,
      source,
      category,
      charCount: content.length,
      fileName: file.name,
      message: "File uploaded and processing started",
    });
  } catch (err) {
    console.error("File upload failed:", (err as Error).message);
    return c.json({ error: "File upload failed" }, 500);
  }
});

// Admin: Scrape URL(s) for document training
app.post("/api/admin/documents/scrape-url", adminMiddleware, async (c) => {
  const adminId = c.get("userId");

  try {
    const { urls, title, source, category, followLinks } = await c.req.json();

    // Accept single URL string or array of URLs
    const urlList: string[] = Array.isArray(urls) ? urls : [urls];
    if (urlList.length === 0 || !urlList[0]) {
      return c.json({ error: "At least one URL is required" }, 400);
    }
    if (urlList.length > 20) {
      return c.json({ error: "Maximum 20 URLs per batch" }, 400);
    }

    // Validate URLs
    for (const u of urlList) {
      try { new URL(u); } catch {
        return c.json({ error: `Invalid URL: ${u}` }, 400);
      }
    }

    // SSRF protection: block private/internal addresses
    for (const u of urlList) {
      const urlObj = new URL(u);
      const blockedHosts = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"];
      const blockedPatterns = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./, /^fc00:/, /^fe80:/];
      if (blockedHosts.includes(urlObj.hostname) || blockedPatterns.some(p => p.test(urlObj.hostname))) {
        return c.json({ error: "URL not allowed: private/internal addresses blocked" }, 400);
      }
    }

    const results: Array<{ url: string; status: string; docId?: string; charCount?: number; error?: string; title?: string }> = [];

    for (const url of urlList) {
      try {
        // Fetch the page
        const response = await fetch(url, {
          headers: {
            "User-Agent": "AskOzzy-Bot/1.0 (Government of Ghana AI Training)",
            "Accept": "text/html,application/xhtml+xml,text/plain,application/json",
          },
          redirect: "follow",
        });

        if (!response.ok) {
          results.push({ url, status: "failed", error: `HTTP ${response.status}` });
          continue;
        }

        const contentType = response.headers.get("content-type") || "";
        const rawText = await response.text();

        let content = "";
        let pageTitle = title || "";

        if (contentType.includes("html")) {
          // Extract title from HTML if not provided
          if (!pageTitle) {
            const titleMatch = rawText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            pageTitle = titleMatch ? titleMatch[1].trim().replace(/\s+/g, " ") : new URL(url).hostname;
          }

          // Strip HTML to extract text content
          content = rawText
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<nav[\s\S]*?<\/nav>/gi, "")
            .replace(/<footer[\s\S]*?<\/footer>/gi, "")
            .replace(/<header[\s\S]*?<\/header>/gi, "")
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/\s{2,}/g, " ")
            .trim();

          // If followLinks is true, extract and scrape linked pages on same domain
          if (followLinks && urlList.length === 1) {
            const baseDomain = new URL(url).hostname;
            const linkRegex = /href=["']([^"']+)["']/gi;
            const foundLinks = new Set<string>();
            let match;
            while ((match = linkRegex.exec(rawText)) !== null) {
              try {
                const absUrl = new URL(match[1], url).href;
                const linkDomain = new URL(absUrl).hostname;
                if (linkDomain === baseDomain && absUrl !== url && !absUrl.includes("#") && foundLinks.size < 10) {
                  foundLinks.add(absUrl);
                }
              } catch {}
            }

            // Scrape child pages and append content
            const blockedHostsChild = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"];
            const blockedPatternsChild = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./, /^fc00:/, /^fe80:/];
            for (const childUrl of foundLinks) {
              try {
                const childHost = new URL(childUrl).hostname;
                if (blockedHostsChild.includes(childHost) || blockedPatternsChild.some(p => p.test(childHost))) continue;
                const childRes = await fetch(childUrl, {
                  headers: { "User-Agent": "AskOzzy-Bot/1.0 (Government of Ghana AI Training)", "Accept": "text/html" },
                  redirect: "follow",
                });
                if (childRes.ok) {
                  const childHtml = await childRes.text();
                  const childText = childHtml
                    .replace(/<script[\s\S]*?<\/script>/gi, "")
                    .replace(/<style[\s\S]*?<\/style>/gi, "")
                    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
                    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
                    .replace(/<!--[\s\S]*?-->/g, "")
                    .replace(/<[^>]+>/g, " ")
                    .replace(/\s{2,}/g, " ")
                    .trim();
                  if (childText.length > 100) {
                    content += `\n\n--- Page: ${childUrl} ---\n\n${childText}`;
                  }
                }
              } catch {}
            }
          }

        } else if (contentType.includes("json")) {
          pageTitle = pageTitle || new URL(url).pathname.split("/").pop() || "JSON Data";
          try {
            const parsed = JSON.parse(rawText);
            content = JSON.stringify(parsed, null, 2);
          } catch {
            content = rawText;
          }
        } else {
          // Plain text or other text format
          pageTitle = pageTitle || new URL(url).pathname.split("/").pop() || url;
          content = rawText;
        }

        // Truncate if too long
        if (content.length > 200000) {
          content = content.slice(0, 200000);
        }

        if (content.length < 50) {
          results.push({ url, status: "failed", error: "Extracted content too short (< 50 chars)" });
          continue;
        }

        // Create document record
        const docId = generateId();
        const docSource = source || new URL(url).hostname;
        await c.env.DB.prepare(
          "INSERT INTO documents (id, title, source, category, content, uploaded_by, status) VALUES (?, ?, ?, ?, ?, ?, 'processing')"
        ).bind(docId, pageTitle, docSource, category || "general", content, adminId).run();

        // Process embeddings in background
        c.executionCtx.waitUntil(processDocumentEmbeddings(c.env, docId, pageTitle, docSource, content, category || "general"));

        await logAudit(c.env.DB, adminId, "scrape_url", "document", docId, `${pageTitle} (${url}, ${content.length} chars)`);

        results.push({ url, status: "success", docId, charCount: content.length, title: pageTitle });
      } catch (err) {
        console.error("Scrape error for", url, (err as Error).message);
        results.push({ url, status: "failed", error: "Failed to scrape this URL" });
      }
    }

    const succeeded = results.filter(r => r.status === "success").length;
    return c.json({
      results,
      summary: { total: urlList.length, succeeded, failed: urlList.length - succeeded },
    });
  } catch (err) {
    console.error("URL scraping failed:", (err as Error).message);
    return c.json({ error: "URL scraping failed" }, 500);
  }
});

// 2. List documents
app.get("/api/admin/documents", adminMiddleware, async (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = (page - 1) * limit;

  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM documents"
  ).first<{ count: number }>();

  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.title, d.source, d.category, d.chunk_count, d.status, d.created_at, d.updated_at,
            u.full_name as uploaded_by_name
     FROM documents d
     JOIN users u ON u.id = d.uploaded_by
     ORDER BY d.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  return c.json({ documents: results || [], total: total?.count || 0, page, limit });
});

// 3. Delete document + chunks + vectors
app.delete("/api/admin/documents/:id", adminMiddleware, async (c) => {
  const docId = c.req.param("id");
  const adminId = c.get("userId");

  // Get vector IDs for Vectorize deletion
  const { results: chunks } = await c.env.DB.prepare(
    "SELECT vector_id FROM document_chunks WHERE document_id = ?"
  ).bind(docId).all<{ vector_id: string }>();

  // Delete from Vectorize
  if (chunks && chunks.length > 0) {
    const vectorIds = chunks.map(ch => ch.vector_id);
    try {
      await c.env.VECTORIZE.deleteByIds(vectorIds);
    } catch (e) {
      // Continue even if Vectorize delete fails
    }
  }

  // Delete chunks from D1
  await c.env.DB.prepare(
    "DELETE FROM document_chunks WHERE document_id = ?"
  ).bind(docId).run();

  // Get title for audit log
  const doc = await c.env.DB.prepare(
    "SELECT title FROM documents WHERE id = ?"
  ).bind(docId).first<{ title: string }>();

  // Delete document
  await c.env.DB.prepare(
    "DELETE FROM documents WHERE id = ?"
  ).bind(docId).run();

  await logAudit(c.env.DB, adminId, "delete_document", "document", docId, doc?.title || '');
  return c.json({ success: true });
});

// 5. Create FAQ entry
app.post("/api/admin/kb", adminMiddleware, async (c) => {
  const adminId = c.get("userId");
  const { category, question, answer, keywords, priority } = await c.req.json();

  if (!question || !answer) {
    return c.json({ error: "Question and answer are required" }, 400);
  }

  const id = generateId();
  await c.env.DB.prepare(
    "INSERT INTO knowledge_base (id, category, question, answer, keywords, priority, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, category || 'general', question, answer, keywords || '', priority || 0, adminId).run();

  await logAudit(c.env.DB, adminId, "create_faq", "knowledge_base", id, question.substring(0, 100));
  return c.json({ id, success: true });
});

// 6. List FAQ entries
app.get("/api/admin/kb", adminMiddleware, async (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = (page - 1) * limit;
  const category = c.req.query("category") || "";

  let countQuery = "SELECT COUNT(*) as count FROM knowledge_base";
  let dataQuery = `SELECT kb.*, u.full_name as created_by_name FROM knowledge_base kb JOIN users u ON u.id = kb.created_by`;

  if (category) {
    countQuery += " WHERE category = ?";
    dataQuery += " WHERE kb.category = ?";
    const total = await c.env.DB.prepare(countQuery).bind(category).first<{ count: number }>();
    const { results } = await c.env.DB.prepare(dataQuery + " ORDER BY kb.priority DESC, kb.created_at DESC LIMIT ? OFFSET ?")
      .bind(category, limit, offset).all();
    return c.json({ entries: results || [], total: total?.count || 0, page, limit });
  }

  const total = await c.env.DB.prepare(countQuery).first<{ count: number }>();
  const { results } = await c.env.DB.prepare(dataQuery + " ORDER BY kb.priority DESC, kb.created_at DESC LIMIT ? OFFSET ?")
    .bind(limit, offset).all();
  return c.json({ entries: results || [], total: total?.count || 0, page, limit });
});

// 7. Update FAQ entry
app.patch("/api/admin/kb/:id", adminMiddleware, async (c) => {
  const faqId = c.req.param("id");
  const body = await c.req.json();

  const updates: string[] = [];
  const params: any[] = [];

  if (body.category !== undefined) { updates.push("category = ?"); params.push(body.category); }
  if (body.question !== undefined) { updates.push("question = ?"); params.push(body.question); }
  if (body.answer !== undefined) { updates.push("answer = ?"); params.push(body.answer); }
  if (body.keywords !== undefined) { updates.push("keywords = ?"); params.push(body.keywords); }
  if (body.priority !== undefined) { updates.push("priority = ?"); params.push(body.priority); }
  if (body.active !== undefined) { updates.push("active = ?"); params.push(body.active ? 1 : 0); }

  if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

  updates.push("updated_at = datetime('now')");
  params.push(faqId);

  await c.env.DB.prepare(
    `UPDATE knowledge_base SET ${updates.join(", ")} WHERE id = ?`
  ).bind(...params).run();

  await logAudit(c.env.DB, c.get("userId"), "update_faq", "knowledge_base", faqId);
  return c.json({ success: true });
});

// 8. Delete FAQ entry
app.delete("/api/admin/kb/:id", adminMiddleware, async (c) => {
  const faqId = c.req.param("id");

  const faq = await c.env.DB.prepare(
    "SELECT question FROM knowledge_base WHERE id = ?"
  ).bind(faqId).first<{ question: string }>();

  await c.env.DB.prepare(
    "DELETE FROM knowledge_base WHERE id = ?"
  ).bind(faqId).run();

  await logAudit(c.env.DB, c.get("userId"), "delete_faq", "knowledge_base", faqId, faq?.question?.substring(0, 100) || '');
  return c.json({ success: true });
});

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

app.get("/api/workflows/templates", async (c) => {
  return c.json({ templates: Object.entries(WORKFLOW_TEMPLATES).map(([id, t]) => ({ id, ...t })) });
});

app.post("/api/workflows", authMiddleware, async (c) => {
  const userId = c.get("userId");
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

app.get("/api/workflows", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, type, status, current_step, created_at, completed_at FROM workflows WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
  ).bind(userId).all();
  return c.json({ workflows: results || [] });
});

app.get("/api/workflows/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const workflow = await c.env.DB.prepare(
    "SELECT * FROM workflows WHERE id = ? AND user_id = ?"
  ).bind(id, userId).first();
  if (!workflow) return c.json({ error: "Workflow not found" }, 404);
  return c.json({ workflow });
});

app.post("/api/workflows/:id/step", authMiddleware, async (c) => {
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

app.delete("/api/workflows/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM workflows WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return c.json({ success: true });
});

// ─── Feature 10: AI Meeting Assistant ───────────────────────────────

app.post("/api/meetings/upload", authMiddleware, async (c) => {
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

  const meetingId = generateId();
  await c.env.DB.prepare(
    "INSERT INTO meetings (id, user_id, title) VALUES (?, ?, ?)"
  ).bind(meetingId, userId, title).run();

  // Audit trail: log meeting transcription (non-blocking)
  c.executionCtx.waitUntil(logUserAudit(c, "meeting_transcribe", title, "@cf/openai/whisper"));

  // Transcribe with Whisper
  try {
    const audioBytes = await audio.arrayBuffer();
    const transcriptResult = await c.env.AI.run("@cf/openai/whisper" as any, {
      audio: [...new Uint8Array(audioBytes)],
    });
    const transcript = (transcriptResult as any).text || "";

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

app.post("/api/meetings/:id/minutes", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const meetingId = c.req.param("id");

  const meeting = await c.env.DB.prepare(
    "SELECT * FROM meetings WHERE id = ? AND user_id = ?"
  ).bind(meetingId, userId).first<{ transcript: string; title: string }>();
  if (!meeting) return c.json({ error: "Meeting not found" }, 404);
  if (!meeting.transcript) return c.json({ error: "No transcript available" }, 400);

  try {
    const minutesResult = await c.env.AI.run("@cf/openai/gpt-oss-20b" as any, {
      messages: [
        { role: "system", content: `You are a professional minutes secretary for the Government of Ghana. Generate formal meeting minutes from the following transcript.

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

Use formal British English. Be thorough but concise.` },
        { role: "user", content: `Meeting: ${meeting.title}\n\nTranscript:\n${meeting.transcript.substring(0, 12000)}` },
      ],
      max_tokens: 4096,
    });
    const minutes = (minutesResult as any).response || "";

    // Extract action items
    const actionsResult = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
      messages: [
        { role: "system", content: 'Extract all action items from these meeting minutes. Return a JSON array: [{"action": "description", "assignee": "person", "deadline": "date or TBD"}]. Return ONLY the JSON array.' },
        { role: "user", content: minutes },
      ],
      max_tokens: 1024,
    });

    let actionItems: any[] = [];
    try {
      const aiText = (actionsResult as any).response || "[]";
      const match = aiText.match(/\[[\s\S]*\]/);
      actionItems = match ? JSON.parse(match[0]) : [];
    } catch {}

    await c.env.DB.prepare(
      "UPDATE meetings SET minutes = ?, action_items = ?, status = 'completed' WHERE id = ?"
    ).bind(minutes, JSON.stringify(actionItems), meetingId).run();

    return c.json({ minutes, actionItems, status: "completed" });
  } catch {
    return c.json({ error: "Minutes generation failed" }, 500);
  }
});

app.get("/api/meetings", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    "SELECT id, title, status, created_at FROM meetings WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
  ).bind(userId).all();
  return c.json({ meetings: results || [] });
});

app.get("/api/meetings/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const meeting = await c.env.DB.prepare(
    "SELECT * FROM meetings WHERE id = ? AND user_id = ?"
  ).bind(id, userId).first();
  if (!meeting) return c.json({ error: "Meeting not found" }, 404);
  return c.json({ meeting });
});

app.delete("/api/meetings/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM meetings WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return c.json({ success: true });
});

// ─── Feature 11: Collaborative Spaces ───────────────────────────────

app.post("/api/spaces", authMiddleware, async (c) => {
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

app.get("/api/spaces", authMiddleware, async (c) => {
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

app.get("/api/spaces/:id", authMiddleware, async (c) => {
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

app.post("/api/spaces/:id/invite", authMiddleware, async (c) => {
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

  await c.env.DB.prepare(
    "INSERT INTO space_members (space_id, user_id, role) VALUES (?, ?, ?)"
  ).bind(spaceId, invitee.id, role || "member").run();

  return c.json({ success: true });
});

app.post("/api/spaces/:id/share-conversation", authMiddleware, async (c) => {
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

app.delete("/api/spaces/:id/members/:memberId", authMiddleware, async (c) => {
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

app.delete("/api/spaces/:id", authMiddleware, async (c) => {
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

// ─── Feature 12: Citizen Service Bot ────────────────────────────────

const CITIZEN_SYSTEM_PROMPT = `You are Ozzy, the AI assistant for Ghana's Citizen Service Portal. You help citizens of Ghana with public service enquiries.

You can help with:
- **Pension queries**: SSNIT pension scheme, eligibility, how to check balances (dial *711#)
- **Tax information**: GRA tax obligations, TIN registration, filing deadlines
- **Permits & licences**: Business registration (RGD), building permits, driving licences (DVLA)
- **Birth & death certificates**: Births and Deaths Registry procedures
- **Passport services**: Ghana Passport Office locations, requirements, processing times
- **Health insurance**: NHIS registration, card renewal, covered services
- **Education**: Scholarship applications, school placement enquiries
- **Land services**: Lands Commission processes, title registration
- **National ID**: Ghana Card (NIA) registration and collection

GUIDELINES:
- Be patient, clear, and helpful — many citizens may not be familiar with bureaucratic processes
- Provide step-by-step instructions where possible
- Include phone numbers, website addresses, and office locations when known
- Use simple English by default. If the user writes in a local language, respond in that language
- Never ask for sensitive personal information (ID numbers, bank details)
- If unsure, direct citizens to the relevant government office

Respond concisely and helpfully.`;

app.post("/api/citizen/chat", async (c) => {
  const { sessionId, message, language } = await c.req.json();
  if (!message) return c.json({ error: "message is required" }, 400);

  // Rate limit citizen bot
  const clientIP = c.req.header("CF-Connecting-IP") || "unknown";
  const rateCheck = await checkRateLimit(c.env, clientIP, "chat");
  if (!rateCheck.allowed) {
    return c.json({ error: "Too many requests. Please try again later." }, 429);
  }

  try {
    // Get or create session (upsert to handle both new and existing)
    let sid = sessionId;
    if (!sid) {
      sid = generateId();
    }
    await c.env.DB.prepare(
      "INSERT INTO citizen_sessions (id, language) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET last_active = datetime('now')"
    ).bind(sid, language || "en").run();

    // Save citizen message
    const citizenMsgId = generateId();
    await c.env.DB.prepare(
      "INSERT INTO citizen_messages (id, session_id, role, content) VALUES (?, ?, 'user', ?)"
    ).bind(citizenMsgId, sid, message).run();

    // Get recent history
    const { results: history } = await c.env.DB.prepare(
      "SELECT role, content FROM citizen_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 10"
    ).bind(sid).all<{ role: string; content: string }>();

    const targetLang = (language && language !== "en" && SUPPORTED_LANGUAGES[language]) ? language : "";

    // Always generate in English for accuracy, then translate
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: CITIZEN_SYSTEM_PROMPT },
    ];

    for (const msg of (history || []).reverse()) {
      messages.push({ role: msg.role, content: msg.content });
    }

    const aiResult = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
      messages: messages as any,
      max_tokens: 1024,
    });

    let response = (aiResult as any).response || "I apologise, I am unable to respond at the moment. Please try again.";

    // Translate to target language as a separate step for better quality
    if (targetLang) {
      response = await translateText(c.env.AI, response, "en", targetLang);
    }

    // Save bot response
    const botMsgId = generateId();
    await c.env.DB.prepare(
      "INSERT INTO citizen_messages (id, session_id, role, content) VALUES (?, ?, 'assistant', ?)"
    ).bind(botMsgId, sid, response).run();

    return c.json({ sessionId: sid, response });
  } catch (err: any) {
    console.error("Citizen chat error:", err?.message || err);
    return c.json({ error: "Service temporarily unavailable. Please try again." }, 500);
  }
});

app.get("/api/citizen/session/:id", async (c) => {
  const sid = c.req.param("id");
  const { results } = await c.env.DB.prepare(
    "SELECT role, content, created_at FROM citizen_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 50"
  ).bind(sid).all();
  return c.json({ messages: results || [] });
});

// ═══════════════════════════════════════════════════════════════════════
//  DEPARTMENT ONBOARDING KITS — Feature #17
// ═══════════════════════════════════════════════════════════════════════

// ─── Bulk User Import (CSV file upload via multipart/form-data) ──────

app.post("/api/admin/bulk-import", adminMiddleware, async (c) => {
  const adminId = c.get("userId");

  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const defaultTier = (formData.get("tier") as string) || "free";

    if (!file) {
      return c.json({ error: "CSV file is required" }, 400);
    }

    const text = await file.text();
    const lines = text.split("\n").map((l: string) => l.trim()).filter((l: string) => l);

    if (lines.length < 2) {
      return c.json({ error: "CSV must have a header row and at least one data row" }, 400);
    }

    // Parse header
    const headerLine = lines[0].toLowerCase();
    const headers = headerLine.split(",").map((h: string) => h.trim().replace(/['"]/g, ""));
    const emailIdx = headers.findIndex((h: string) => h.includes("email"));
    const nameIdx = headers.findIndex((h: string) => h.includes("name") || h.includes("full"));
    const deptIdx = headers.findIndex((h: string) => h.includes("dept") || h.includes("department") || h.includes("mda"));
    const tierIdx = headers.findIndex((h: string) => h === "tier");

    if (emailIdx === -1 || nameIdx === -1) {
      return c.json({ error: "CSV must have columns for email and full_name" }, 400);
    }

    // Parse rows
    const userRows: Array<{ email: string; fullName: string; department: string; tier: string }> = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((col: string) => col.trim().replace(/^["']|["']$/g, ""));
      const email = (cols[emailIdx] || "").toLowerCase().trim();
      const fullName = (cols[nameIdx] || "").trim();
      if (!email || !fullName) continue;

      const department = deptIdx >= 0 ? (cols[deptIdx] || "").trim() : "";
      const tier = tierIdx >= 0 && cols[tierIdx] ? cols[tierIdx].trim().toLowerCase() : defaultTier;

      userRows.push({ email, fullName, department, tier });
    }

    if (userRows.length === 0) {
      return c.json({ error: "No valid user rows found in CSV" }, 400);
    }
    if (userRows.length > 500) {
      return c.json({ error: "Maximum 500 users per batch" }, 400);
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    const users: Array<{ name: string; email: string; access_code: string; department: string; tier: string; status: string }> = [];

    for (const row of userRows) {
      // Check if already exists
      const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
        .bind(row.email).first();
      if (existing) {
        skipped++;
        users.push({ name: row.fullName, email: row.email, access_code: "", department: row.department, tier: row.tier, status: "skipped — already exists" });
        continue;
      }

      const userId = generateId();
      const accessCode = generateAccessCode();
      const passwordHash = await hashPassword(accessCode);
      const firstName = row.fullName.split(" ")[0].toUpperCase();
      const suffix = generateReferralSuffix();
      const referralCode = `OZZY-${firstName}-${suffix}`;

      try {
        await c.env.DB.prepare(
          "INSERT INTO users (id, email, password_hash, full_name, department, tier, referral_code) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(userId, row.email, passwordHash, row.fullName, row.department, row.tier, referralCode).run();

        imported++;
        users.push({ name: row.fullName, email: row.email, access_code: accessCode, department: row.department, tier: row.tier, status: "created" });
      } catch (err) {
        console.error("CSV import error:", row.email, (err as Error).message);
        errors.push(`${row.email}: import failed`);
        users.push({ name: row.fullName, email: row.email, access_code: "", department: row.department, tier: row.tier, status: "failed" });
      }
    }

    await logAudit(c.env.DB, adminId, "bulk_import_csv", "system", undefined, `CSV import: ${imported} created, ${skipped} skipped, ${errors.length} errors out of ${userRows.length} rows`);

    return c.json({
      imported,
      skipped,
      errors,
      users,
      total: userRows.length,
    });
  } catch (err) {
    console.error("CSV processing error:", (err as Error).message);
    return c.json({ error: "Failed to process CSV. Check the file format and try again." }, 500);
  }
});

// ─── Department Stats ──────────────────────────────────────────────────

app.get("/api/admin/departments/stats", deptAdminMiddleware, async (c) => {
  const deptFilter = c.get("deptFilter") as string | undefined;

  try {
    // Build base WHERE clause for department filtering
    const deptWhere = deptFilter ? " WHERE u.department = ?" : "";
    const deptBindings = deptFilter ? [deptFilter] : [];

    // 1. Per-department user counts
    let userCountQuery: string;
    let userCountBindings: string[];
    if (deptFilter) {
      userCountQuery = "SELECT department, COUNT(*) as user_count FROM users WHERE department = ? GROUP BY department";
      userCountBindings = [deptFilter];
    } else {
      userCountQuery = "SELECT department, COUNT(*) as user_count FROM users WHERE department != '' GROUP BY department ORDER BY user_count DESC";
      userCountBindings = [];
    }

    const { results: deptUsers } = deptFilter
      ? await c.env.DB.prepare(userCountQuery).bind(...userCountBindings).all<{ department: string; user_count: number }>()
      : await c.env.DB.prepare(userCountQuery).all<{ department: string; user_count: number }>();

    // 2. Active users per department (last 7 days)
    let activeQuery: string;
    if (deptFilter) {
      activeQuery = `SELECT u.department, COUNT(DISTINCT u.id) as active_users
        FROM users u
        INNER JOIN conversations c ON c.user_id = u.id
        WHERE u.department = ? AND c.updated_at >= datetime('now', '-7 days')
        GROUP BY u.department`;
    } else {
      activeQuery = `SELECT u.department, COUNT(DISTINCT u.id) as active_users
        FROM users u
        INNER JOIN conversations c ON c.user_id = u.id
        WHERE u.department != '' AND c.updated_at >= datetime('now', '-7 days')
        GROUP BY u.department
        ORDER BY active_users DESC`;
    }

    const { results: activeUsers } = deptFilter
      ? await c.env.DB.prepare(activeQuery).bind(deptFilter).all<{ department: string; active_users: number }>()
      : await c.env.DB.prepare(activeQuery).all<{ department: string; active_users: number }>();

    // 3. Total conversations per department
    let convoQuery: string;
    if (deptFilter) {
      convoQuery = `SELECT u.department, COUNT(c.id) as total_conversations
        FROM users u
        INNER JOIN conversations c ON c.user_id = u.id
        WHERE u.department = ?
        GROUP BY u.department`;
    } else {
      convoQuery = `SELECT u.department, COUNT(c.id) as total_conversations
        FROM users u
        INNER JOIN conversations c ON c.user_id = u.id
        WHERE u.department != ''
        GROUP BY u.department
        ORDER BY total_conversations DESC`;
    }

    const { results: deptConversations } = deptFilter
      ? await c.env.DB.prepare(convoQuery).bind(deptFilter).all<{ department: string; total_conversations: number }>()
      : await c.env.DB.prepare(convoQuery).all<{ department: string; total_conversations: number }>();

    // 4. Total messages per department
    let msgQuery: string;
    if (deptFilter) {
      msgQuery = `SELECT u.department, COUNT(m.id) as total_messages
        FROM users u
        INNER JOIN conversations c ON c.user_id = u.id
        INNER JOIN messages m ON m.conversation_id = c.id
        WHERE u.department = ?
        GROUP BY u.department`;
    } else {
      msgQuery = `SELECT u.department, COUNT(m.id) as total_messages
        FROM users u
        INNER JOIN conversations c ON c.user_id = u.id
        INNER JOIN messages m ON m.conversation_id = c.id
        WHERE u.department != ''
        GROUP BY u.department
        ORDER BY total_messages DESC`;
    }

    const { results: deptMessages } = deptFilter
      ? await c.env.DB.prepare(msgQuery).bind(deptFilter).all<{ department: string; total_messages: number }>()
      : await c.env.DB.prepare(msgQuery).all<{ department: string; total_messages: number }>();

    // 5. Top templates per department (from conversations with template_id set)
    let templateQuery: string;
    if (deptFilter) {
      templateQuery = `SELECT u.department, c.template_id, COUNT(*) as usage_count
        FROM users u
        INNER JOIN conversations c ON c.user_id = u.id
        WHERE u.department = ? AND c.template_id IS NOT NULL AND c.template_id != ''
        GROUP BY u.department, c.template_id
        ORDER BY usage_count DESC
        LIMIT 20`;
    } else {
      templateQuery = `SELECT u.department, c.template_id, COUNT(*) as usage_count
        FROM users u
        INNER JOIN conversations c ON c.user_id = u.id
        WHERE u.department != '' AND c.template_id IS NOT NULL AND c.template_id != ''
        GROUP BY u.department, c.template_id
        ORDER BY usage_count DESC
        LIMIT 50`;
    }

    const { results: templateUsage } = deptFilter
      ? await c.env.DB.prepare(templateQuery).bind(deptFilter).all<{ department: string; template_id: string; usage_count: number }>()
      : await c.env.DB.prepare(templateQuery).all<{ department: string; template_id: string; usage_count: number }>();

    // Merge all data into per-department stats
    const departmentMap: Record<string, {
      department: string;
      user_count: number;
      active_users: number;
      total_conversations: number;
      total_messages: number;
      top_templates: Array<{ template_id: string; usage_count: number }>;
    }> = {};

    for (const row of deptUsers || []) {
      if (!row.department) continue;
      departmentMap[row.department] = {
        department: row.department,
        user_count: row.user_count,
        active_users: 0,
        total_conversations: 0,
        total_messages: 0,
        top_templates: [],
      };
    }

    for (const row of activeUsers || []) {
      if (!row.department) continue;
      if (!departmentMap[row.department]) {
        departmentMap[row.department] = { department: row.department, user_count: 0, active_users: 0, total_conversations: 0, total_messages: 0, top_templates: [] };
      }
      departmentMap[row.department].active_users = row.active_users;
    }

    for (const row of deptConversations || []) {
      if (!row.department) continue;
      if (!departmentMap[row.department]) {
        departmentMap[row.department] = { department: row.department, user_count: 0, active_users: 0, total_conversations: 0, total_messages: 0, top_templates: [] };
      }
      departmentMap[row.department].total_conversations = row.total_conversations;
    }

    for (const row of deptMessages || []) {
      if (!row.department) continue;
      if (!departmentMap[row.department]) {
        departmentMap[row.department] = { department: row.department, user_count: 0, active_users: 0, total_conversations: 0, total_messages: 0, top_templates: [] };
      }
      departmentMap[row.department].total_messages = row.total_messages;
    }

    for (const row of templateUsage || []) {
      if (!row.department || !departmentMap[row.department]) continue;
      departmentMap[row.department].top_templates.push({
        template_id: row.template_id,
        usage_count: row.usage_count,
      });
    }

    // Sort by user count descending
    const departments = Object.values(departmentMap).sort((a, b) => b.user_count - a.user_count);

    return c.json({ departments });
  } catch (err) {
    console.error("Department stats error:", err);
    return c.json({ error: "Failed to load department stats" }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  KNOWLEDGE BASE — Bulk Upload & Enhanced Stats
// ═══════════════════════════════════════════════════════════════════════

// GoG category auto-detection from filename/content
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

// Bulk Upload Endpoint — multipart/form-data with multiple files
app.post("/api/admin/knowledge/bulk", adminMiddleware, async (c) => {
  const adminId = c.get("userId");

  try {
    const formData = await c.req.formData();
    const files: File[] = [];
    const categoryOverrides: Record<string, string> = {};

    // Collect all files and category overrides from formData
    for (const [key, value] of formData.entries()) {
      if (key === 'files' || key.startsWith('file')) {
        if (typeof value !== 'string' && (value as any).name) {
          files.push(value as File);
        }
      }
      // Category overrides: category_0, category_1, etc.
      if (key.startsWith('category_')) {
        const idx = key.replace('category_', '');
        categoryOverrides[idx] = value as string;
      }
    }

    // Also accept a single "category" for all files
    const globalCategory = formData.get("category") as string || "";

    if (files.length === 0) {
      return c.json({ error: "No files provided" }, 400);
    }

    if (files.length > 50) {
      return c.json({ error: "Maximum 50 files per bulk upload" }, 400);
    }

    // Supported text-based extensions
    const SUPPORTED_EXT = ['.txt', '.csv', '.md', '.json', '.html', '.htm', '.docx', '.pptx', '.doc'];
    const BINARY_EXT = ['.pdf', '.zip', '.rar', '.7z', '.exe', '.bin', '.dll', '.iso', '.mp3', '.mp4', '.avi', '.mov', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.woff', '.woff2', '.ttf'];

    const results: Array<{ filename: string; status: string; docId?: string; chunks?: number; category?: string; error?: string }> = [];
    let totalUploaded = 0;
    let totalChunks = 0;

    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const file = files[fileIdx];
      const fileName = file.name.toLowerCase();
      const ext = '.' + fileName.split('.').pop();

      // Check if binary/unsupported
      if (BINARY_EXT.includes(ext)) {
        if (ext === '.pdf') {
          results.push({ filename: file.name, status: 'error', error: 'PDF files not yet supported in bulk upload. Convert to .txt or .docx first.' });
        } else {
          results.push({ filename: file.name, status: 'error', error: `Unsupported binary format (${ext})` });
        }
        continue;
      }

      if (!SUPPORTED_EXT.includes(ext) && ext !== '.txt') {
        // Try to read as text anyway
      }

      try {
        let content = '';

        if (fileName.endsWith('.docx')) {
          try {
            content = await extractDocxText(file);
          } catch (err) {
            console.error("Bulk DOCX error:", file.name, (err as Error).message);
            results.push({ filename: file.name, status: 'error', error: 'Failed to extract DOCX text. File may be corrupted.' });
            continue;
          }
        } else if (fileName.endsWith('.pptx')) {
          try {
            content = await extractPptxText(file);
          } catch (err) {
            console.error("Bulk PPTX error:", file.name, (err as Error).message);
            results.push({ filename: file.name, status: 'error', error: 'Failed to extract PPTX text. File may be corrupted.' });
            continue;
          }
        } else if (fileName.endsWith('.doc')) {
          try {
            content = await extractDocText(file);
            if (content.length < 50) {
              results.push({ filename: file.name, status: 'error', error: 'Could not extract enough text from .doc file. Convert to .docx.' });
              continue;
            }
          } catch (err) {
            results.push({ filename: file.name, status: 'error', error: 'Failed to extract DOC text. Convert to .docx.' });
            continue;
          }
        } else if (fileName.endsWith('.json')) {
          const jsonText = await file.text();
          try {
            const parsed = JSON.parse(jsonText);
            content = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
          } catch {
            content = jsonText;
          }
        } else if (fileName.endsWith('.html') || fileName.endsWith('.htm')) {
          const htmlText = await file.text();
          content = htmlText.replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();
        } else {
          // .txt, .csv, .md, and others — read as text
          content = await file.text();
        }

        if (content.length < 50) {
          results.push({ filename: file.name, status: 'error', error: 'Content too short (< 50 characters)' });
          continue;
        }
        if (content.length > 200000) {
          content = content.slice(0, 200000);
        }

        // Determine category: per-file override > global > auto-detect
        const category = categoryOverrides[String(fileIdx)] || globalCategory || detectCategory(file.name, content);

        // Generate title from filename
        const title = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');

        // Create document record
        const docId = generateId();
        await c.env.DB.prepare(
          "INSERT INTO documents (id, title, source, category, content, uploaded_by, status) VALUES (?, ?, ?, ?, ?, ?, 'processing')"
        ).bind(docId, title, 'Bulk Upload', category, content, adminId).run();

        // Process embeddings in background
        c.executionCtx.waitUntil(processDocumentEmbeddings(c.env, docId, title, 'Bulk Upload', content, category));

        const estimatedChunks = Math.ceil(content.length / 450); // Rough estimate with overlap
        totalUploaded++;
        totalChunks += estimatedChunks;

        results.push({
          filename: file.name,
          status: 'success',
          docId,
          chunks: estimatedChunks,
          category,
        });

        await logAudit(c.env.DB, adminId, "bulk_upload_document", "document", docId, `${title} (${file.name}, ${content.length} chars)`);

      } catch (err) {
        console.error("Bulk upload error:", file.name, (err as Error).message);
        results.push({ filename: file.name, status: 'error', error: 'Failed to process file' });
      }
    }

    return c.json({
      uploaded: totalUploaded,
      chunks_created: totalChunks,
      total_files: files.length,
      errors: results.filter(r => r.status === 'error'),
      results,
    });

  } catch (err) {
    console.error("Bulk upload failed:", (err as Error).message);
    return c.json({ error: "Bulk upload failed" }, 500);
  }
});

// Enhanced Knowledge Base Stats
app.get("/api/admin/knowledge/stats", adminMiddleware, async (c) => {
  try {
    const docCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM documents"
    ).first<{ count: number }>();

    const chunkCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM document_chunks"
    ).first<{ count: number }>();

    const faqCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM knowledge_base"
    ).first<{ count: number }>();

    const { results: byCategory } = await c.env.DB.prepare(
      "SELECT category, COUNT(*) as doc_count, SUM(chunk_count) as chunk_count FROM documents GROUP BY category ORDER BY doc_count DESC"
    ).all<{ category: string; doc_count: number; chunk_count: number }>();

    const readyDocs = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM documents WHERE status = 'ready'"
    ).first<{ count: number }>();

    const processingDocs = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM documents WHERE status = 'processing'"
    ).first<{ count: number }>();

    const errorDocs = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM documents WHERE status = 'error'"
    ).first<{ count: number }>();

    // Estimate storage: average ~500 chars per chunk, 4 bytes per float * 384 dims for embeddings
    const totalChunks = chunkCount?.count || 0;
    const textStorageBytes = totalChunks * 500;
    const vectorStorageBytes = totalChunks * 384 * 4;
    const storageEstimate = {
      text_mb: +(textStorageBytes / (1024 * 1024)).toFixed(2),
      vector_mb: +(vectorStorageBytes / (1024 * 1024)).toFixed(2),
      total_mb: +((textStorageBytes + vectorStorageBytes) / (1024 * 1024)).toFixed(2),
    };

    // GoG document library status — check which recommended docs have been uploaded
    const gogDocuments = [
      { name: "Public Procurement Act (Act 663)", category: "procurement_law", keywords: ["procurement act", "act 663"] },
      { name: "Financial Administration Act (Act 654)", category: "financial_admin", keywords: ["financial administration", "act 654"] },
      { name: "Civil Service Act", category: "civil_service", keywords: ["civil service act"] },
      { name: "Budget Statement & Economic Policy", category: "budget_policy", keywords: ["budget statement", "economic policy"] },
      { name: "Standard GoG Forms & Templates", category: "gog_forms", keywords: ["gog forms", "standard forms", "government forms"] },
    ];

    const gogStatus: Array<{ name: string; category: string; uploaded: boolean; doc_count: number }> = [];
    for (const gogDoc of gogDocuments) {
      const likeClauses = gogDoc.keywords.map(() => 'LOWER(title) LIKE ?').join(' OR ');
      const params = gogDoc.keywords.map(kw => `%${kw}%`);
      const found = await c.env.DB.prepare(
        `SELECT COUNT(*) as count FROM documents WHERE (${likeClauses}) OR category = ?`
      ).bind(...params, gogDoc.category).first<{ count: number }>();
      gogStatus.push({
        name: gogDoc.name,
        category: gogDoc.category,
        uploaded: (found?.count || 0) > 0,
        doc_count: found?.count || 0,
      });
    }

    return c.json({
      total_documents: docCount?.count || 0,
      total_chunks: totalChunks,
      total_faqs: faqCount?.count || 0,
      ready_documents: readyDocs?.count || 0,
      processing_documents: processingDocs?.count || 0,
      error_documents: errorDocs?.count || 0,
      by_category: byCategory || [],
      categories_covered: (byCategory || []).length,
      storage_estimate: storageEstimate,
      gog_library: gogStatus,
    });
  } catch (err) {
    console.error("Failed to load knowledge stats:", (err as Error).message);
    return c.json({ error: "Failed to load knowledge stats" }, 500);
  }
});

// Enhanced document listing with search and category filter
app.get("/api/admin/knowledge/documents", adminMiddleware, async (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = (page - 1) * limit;
  const category = c.req.query("category") || "";
  const search = c.req.query("search") || "";

  let countQuery = "SELECT COUNT(*) as count FROM documents";
  let dataQuery = `SELECT d.id, d.title, d.source, d.category, d.chunk_count, d.status, d.created_at, d.updated_at,
          u.full_name as uploaded_by_name
   FROM documents d
   JOIN users u ON u.id = d.uploaded_by`;

  const conditions: string[] = [];
  const params: string[] = [];

  if (category) {
    conditions.push("d.category = ?");
    params.push(category);
  }
  if (search) {
    conditions.push("(LOWER(d.title) LIKE ? OR LOWER(d.source) LIKE ?)");
    params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
  }

  if (conditions.length > 0) {
    const where = " WHERE " + conditions.join(" AND ");
    countQuery += where.replace(/d\./g, '');
    dataQuery += where;
  }

  dataQuery += " ORDER BY d.created_at DESC LIMIT ? OFFSET ?";

  const total = await c.env.DB.prepare(countQuery).bind(...params).first<{ count: number }>();
  const { results } = await c.env.DB.prepare(dataQuery).bind(...params, limit, offset).all();

  return c.json({ documents: results || [], total: total?.count || 0, page, limit });
});

// ═══════════════════════════════════════════════════════════════════
//  USSD Fallback — Africa's Talking Callback
// ═══════════════════════════════════════════════════════════════════

// Lazy table creation flag (per isolate)
let ussdTableCreated = false;

async function ensureUSSDTable(db: D1Database): Promise<void> {
  if (ussdTableCreated) return;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS ussd_sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      service_code TEXT,
      current_menu TEXT DEFAULT 'main',
      input_history TEXT DEFAULT '',
      ai_response TEXT,
      message_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  await db.batch([
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ussd_session ON ussd_sessions(session_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ussd_phone ON ussd_sessions(phone_number)`),
  ]);
  ussdTableCreated = true;
}

// ─── USSD Helpers ────────────────────────────────────────────────

function truncateForUSSD(text: string, maxLen: number = 182): string {
  if (!text) return "";
  // Strip any markdown artifacts
  const clean = text.replace(/[*_#`]/g, "").replace(/\n{3,}/g, "\n\n").trim();

  if (clean.length <= maxLen) return clean;

  // Try to cut at a sentence boundary
  const truncated = clean.substring(0, maxLen);
  const lastPeriod = truncated.lastIndexOf(".");
  const lastQuestion = truncated.lastIndexOf("?");
  const lastExclamation = truncated.lastIndexOf("!");
  const sentenceEnd = Math.max(lastPeriod, lastQuestion, lastExclamation);

  if (sentenceEnd > maxLen * 0.4) {
    return clean.substring(0, sentenceEnd + 1);
  }

  // Fall back to word boundary
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.4) {
    return clean.substring(0, lastSpace) + "...";
  }

  return truncated.substring(0, maxLen - 3) + "...";
}

async function getUSSDResponse(ai: Ai, prompt: string): Promise<string> {
  try {
    const result = await ai.run(
      "@cf/meta/llama-3.1-8b-instruct-fast" as any,
      {
        messages: [
          {
            role: "system",
            content:
              "You are AskOzzy USSD assistant for Ghana government workers. Give extremely brief answers (under 150 characters). No markdown, no bullet points, no asterisks, plain text only. Be direct and concise.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 100,
      }
    );
    return (result as any)?.response || "Sorry, I could not process that request.";
  } catch (err) {
    console.error("USSD AI error:", err);
    return "Service temporarily unavailable. Please try again.";
  }
}

async function getUSSDMemoResponse(ai: Ai, topic: string): Promise<string> {
  try {
    const result = await ai.run(
      "@cf/meta/llama-3.1-8b-instruct-fast" as any,
      {
        messages: [
          {
            role: "system",
            content:
              "You are AskOzzy USSD assistant. Generate a very brief memo outline for Ghana government workers. Keep it under 150 characters. No markdown, plain text only. Format: TO/FROM/RE/Body in one line each.",
          },
          { role: "user", content: `Draft a brief memo about: ${topic}` },
        ],
        max_tokens: 120,
      }
    );
    return (result as any)?.response || "Could not generate memo. Please try again.";
  } catch (err) {
    console.error("USSD memo AI error:", err);
    return "Service temporarily unavailable. Please try again.";
  }
}

// ─── USSD Template Responses ─────────────────────────────────────

const USSD_TEMPLATES: Record<string, string> = {
  "1": "INTERNAL MEMO\nTO: [Recipient]\nFROM: [Your Name]\nDATE: [Date]\nRE: [Subject]\n\n[Body]",
  "2": "OFFICIAL LETTER\n[Your Office]\n[Date]\n\nDear [Title/Name],\n\nRE: [Subject]\n\n[Body]\n\nYours faithfully,\n[Name/Title]",
  "3": "MEETING MINUTES\nDate: [Date]\nVenue: [Place]\nPresent: [Names]\n\nAgenda:\n1. [Item]\n\nResolutions:\n- [Decision]\n\nAdjourned: [Time]",
  "4": "BUDGET REQUEST\nTO: Finance Dept\nFROM: [Your Dept]\nDATE: [Date]\n\nItem: [Description]\nAmount: GHS [Amount]\nJustification: [Reason]\n\nApproval: ________",
};

// ─── USSD Main Menu Builder ──────────────────────────────────────

function ussdMainMenu(): string {
  return (
    "CON Welcome to AskOzzy - Ghana's AI Assistant\n\n" +
    "1. Ask a Question\n" +
    "2. Draft a Memo\n" +
    "3. Use a Template\n" +
    "4. My Account"
  );
}

function ussdTemplateMenu(): string {
  return (
    "CON Select template:\n\n" +
    "1. Internal Memo\n" +
    "2. Official Letter\n" +
    "3. Meeting Minutes\n" +
    "4. Budget Request\n" +
    "0. Back"
  );
}

// ─── USSD Callback Endpoint ──────────────────────────────────────

app.post("/api/ussd/callback", async (c) => {
  try {
    await ensureUSSDTable(c.env.DB);

    // Africa's Talking sends form-encoded data by default, but also accept JSON
    const contentType = c.req.header("Content-Type") || "";
    let sessionId: string,
      phoneNumber: string,
      serviceCode: string,
      text: string;

    if (contentType.includes("application/json")) {
      const body = await c.req.json();
      sessionId = body.sessionId || "";
      phoneNumber = body.phoneNumber || "";
      serviceCode = body.serviceCode || "";
      text = body.text || "";
    } else {
      const body = await c.req.parseBody();
      sessionId = (body.sessionId as string) || "";
      phoneNumber = (body.phoneNumber as string) || "";
      serviceCode = (body.serviceCode as string) || "";
      text = (body.text as string) || "";
    }

    if (!sessionId) {
      return new Response("END Invalid session", {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Check if USSD is enabled via KV config
    const ussdConfig = await c.env.SESSIONS.get("ussd_config");
    if (ussdConfig) {
      try {
        const config = JSON.parse(ussdConfig);
        if (config.enabled === false) {
          return new Response(
            "END AskOzzy USSD is currently disabled.\nVisit askozzy.ghwmelite.workers.dev",
            { headers: { "Content-Type": "text/plain" } }
          );
        }
      } catch {}
    }

    // Parse the cumulative text input to determine menu navigation
    // Africa's Talking format: "" -> "1" -> "1*hello" -> "1*hello*0"
    const inputs = text === "" ? [] : text.split("*");
    const level = inputs.length;

    let response = "";
    let menuState = "main";
    let isEnd = false;

    // ── Level 0: Initial dial — show main menu ──
    if (level === 0) {
      response = ussdMainMenu();
      menuState = "main";
    }
    // ── Level 1: User selected a main menu option ──
    else if (level === 1) {
      const choice = inputs[0].trim();

      if (choice === "1") {
        response = "CON Type your question:";
        menuState = "ask_question";
      } else if (choice === "2") {
        response = "CON Enter memo topic:";
        menuState = "draft_memo";
      } else if (choice === "3") {
        response = ussdTemplateMenu();
        menuState = "templates";
      } else if (choice === "4") {
        // Look up user by phone number (best-effort match)
        const cleanPhone = phoneNumber.replace(/^\+/, "");
        const last9 = cleanPhone.length >= 9 ? cleanPhone.slice(-9) : cleanPhone;
        const user = await c.env.DB.prepare(
          "SELECT full_name, tier, email FROM users WHERE email LIKE ? OR email LIKE ? LIMIT 1"
        )
          .bind(`%${cleanPhone}%`, `%${last9}%`)
          .first<{ full_name: string; tier: string; email: string }>();

        if (user) {
          const msgCount = await c.env.DB.prepare(
            `SELECT COUNT(*) as cnt FROM messages
             WHERE conversation_id IN (
               SELECT id FROM conversations WHERE user_id = (
                 SELECT id FROM users WHERE email = ?
               )
             )`
          )
            .bind(user.email)
            .first<{ cnt: number }>();

          response =
            "END Account Info:\n" +
            `Name: ${user.full_name}\n` +
            `Tier: ${user.tier}\n` +
            `Messages: ${msgCount?.cnt || 0}`;
        } else {
          response =
            "END No account linked to this number.\n" +
            "Visit askozzy.ghwmelite.workers.dev\nto register and link your phone.";
        }
        isEnd = true;
        menuState = "account";
      } else if (choice === "0") {
        response = ussdMainMenu();
        menuState = "main";
      } else {
        response =
          "CON Invalid choice. Try again:\n\n" +
          "1. Ask a Question\n" +
          "2. Draft a Memo\n" +
          "3. Use a Template\n" +
          "4. My Account";
        menuState = "main";
      }
    }
    // ── Level 2: Second-level interactions ──
    else if (level === 2) {
      const firstChoice = inputs[0].trim();
      const secondInput = inputs[1].trim();

      if (firstChoice === "1") {
        // Ask a Question — secondInput is the user's question
        if (secondInput.length < 2) {
          response = "END Please type a longer question next time.";
        } else {
          const aiAnswer = await getUSSDResponse(c.env.AI, secondInput);
          const truncated = truncateForUSSD(aiAnswer, 140);
          response = `END AI: ${truncated}`;
        }
        isEnd = true;
        menuState = "ai_response";
      } else if (firstChoice === "2") {
        // Draft a Memo — secondInput is the topic
        if (secondInput.length < 2) {
          response = "END Please enter a longer topic next time.";
        } else {
          const memoResponse = await getUSSDMemoResponse(c.env.AI, secondInput);
          const truncated = truncateForUSSD(memoResponse, 140);
          response = `END Memo:\n${truncated}`;
        }
        isEnd = true;
        menuState = "memo_response";
      } else if (firstChoice === "3") {
        // Template selection
        if (secondInput === "0") {
          response = ussdMainMenu();
          menuState = "main";
        } else if (USSD_TEMPLATES[secondInput]) {
          const template = truncateForUSSD(USSD_TEMPLATES[secondInput], 180);
          response = `END ${template}`;
          isEnd = true;
          menuState = "template_view";
        } else {
          response =
            "CON Invalid choice.\n\n" +
            "1. Internal Memo\n" +
            "2. Official Letter\n" +
            "3. Meeting Minutes\n" +
            "4. Budget Request\n" +
            "0. Back";
          menuState = "templates";
        }
      } else {
        response = "END Invalid input. Dial again to restart.";
        isEnd = true;
        menuState = "error";
      }
    }
    // ── Level 3+: Deep navigation ──
    else {
      const lastInput = inputs[inputs.length - 1].trim();
      if (lastInput === "0") {
        response = ussdMainMenu();
        menuState = "main";
      } else {
        response = "END Thank you for using AskOzzy. Dial again to start over.";
        isEnd = true;
        menuState = "end";
      }
    }

    // Persist session to D1
    const existingSession = await c.env.DB.prepare(
      "SELECT id FROM ussd_sessions WHERE session_id = ?"
    )
      .bind(sessionId)
      .first<{ id: string }>();

    if (existingSession) {
      await c.env.DB.prepare(
        `UPDATE ussd_sessions
         SET current_menu = ?, input_history = ?, ai_response = ?,
             message_count = message_count + 1, updated_at = datetime('now')
         WHERE session_id = ?`
      )
        .bind(
          menuState,
          text,
          isEnd ? response.replace(/^(CON |END )/, "") : null,
          sessionId
        )
        .run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO ussd_sessions (id, session_id, phone_number, service_code, current_menu, input_history, ai_response, message_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      )
        .bind(
          generateId(),
          sessionId,
          phoneNumber,
          serviceCode,
          menuState,
          text,
          isEnd ? response.replace(/^(CON |END )/, "") : null
        )
        .run();
    }

    return new Response(response, {
      headers: { "Content-Type": "text/plain" },
    });
  } catch (err: any) {
    console.error("USSD callback error:", err);
    return new Response("END An error occurred. Please try again later.", {
      headers: { "Content-Type": "text/plain" },
    });
  }
});

// ─── USSD Admin Stats ───────────────────────────────────────────

app.get("/api/admin/ussd/stats", adminMiddleware, async (c) => {
  try {
    await ensureUSSDTable(c.env.DB);

    const [totalResult, todayResult, phonesResult, menuResult] = await c.env.DB.batch([
      c.env.DB.prepare("SELECT COUNT(DISTINCT session_id) as total FROM ussd_sessions"),
      c.env.DB.prepare(
        "SELECT COUNT(DISTINCT session_id) as today FROM ussd_sessions WHERE created_at >= date('now')"
      ),
      c.env.DB.prepare(
        "SELECT COUNT(DISTINCT phone_number) as unique_phones FROM ussd_sessions"
      ),
      c.env.DB.prepare(
        "SELECT current_menu, COUNT(*) as count FROM ussd_sessions GROUP BY current_menu ORDER BY count DESC LIMIT 10"
      ),
    ]);

    const total = (totalResult.results?.[0] as any)?.total || 0;
    const today = (todayResult.results?.[0] as any)?.today || 0;
    const uniquePhones = (phonesResult.results?.[0] as any)?.unique_phones || 0;
    const menuChoices = (menuResult.results || []) as Array<{
      current_menu: string;
      count: number;
    }>;

    return c.json({
      total_sessions: total,
      sessions_today: today,
      unique_phones: uniquePhones,
      popular_menu_choices: menuChoices,
    });
  } catch (err: any) {
    console.error("USSD stats error:", err);
    return c.json({ error: "Failed to load USSD stats" }, 500);
  }
});

// ─── USSD Admin Config ──────────────────────────────────────────

app.get("/api/admin/ussd/config", adminMiddleware, async (c) => {
  try {
    const raw = await c.env.SESSIONS.get("ussd_config");
    if (raw) {
      return c.json(JSON.parse(raw));
    }
    return c.json({
      enabled: true,
      serviceCode: "*713*OZZY#",
      callbackUrl: "https://askozzy.ghwmelite.workers.dev/api/ussd/callback",
    });
  } catch {
    return c.json({
      enabled: true,
      serviceCode: "*713*OZZY#",
      callbackUrl: "https://askozzy.ghwmelite.workers.dev/api/ussd/callback",
    });
  }
});

app.put("/api/admin/ussd/config", adminMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const config = {
      enabled: body.enabled !== false,
      serviceCode: body.serviceCode || "*713*OZZY#",
      callbackUrl: "https://askozzy.ghwmelite.workers.dev/api/ussd/callback",
    };
    await c.env.SESSIONS.put("ussd_config", JSON.stringify(config));
    return c.json({ success: true, config });
  } catch (err: any) {
    return c.json({ error: "Failed to save USSD config" }, 500);
  }
});

// ─── USSD Test Endpoint (Admin) ─────────────────────────────────

app.post("/api/admin/ussd/test", adminMiddleware, async (c) => {
  try {
    const { text } = await c.req.json();

    await ensureUSSDTable(c.env.DB);

    const inputs = !text || text === "" ? [] : text.split("*");
    const level = inputs.length;

    let response = "";

    if (level === 0) {
      response = ussdMainMenu();
    } else if (level === 1) {
      const choice = inputs[0].trim();
      if (choice === "1") {
        response = "CON Type your question:";
      } else if (choice === "2") {
        response = "CON Enter memo topic:";
      } else if (choice === "3") {
        response = ussdTemplateMenu();
      } else if (choice === "4") {
        response =
          "END Account Info (Test):\nName: Test User\nTier: free\nMessages: 0";
      } else {
        response =
          "CON Invalid choice. Try again:\n\n" +
          "1. Ask a Question\n" +
          "2. Draft a Memo\n" +
          "3. Use a Template\n" +
          "4. My Account";
      }
    } else if (level === 2) {
      const firstChoice = inputs[0].trim();
      const secondInput = inputs[1].trim();

      if (firstChoice === "1") {
        const aiAnswer = await getUSSDResponse(c.env.AI, secondInput);
        response = `END AI: ${truncateForUSSD(aiAnswer, 140)}`;
      } else if (firstChoice === "2") {
        const memoResponse = await getUSSDMemoResponse(c.env.AI, secondInput);
        response = `END Memo:\n${truncateForUSSD(memoResponse, 140)}`;
      } else if (firstChoice === "3") {
        if (USSD_TEMPLATES[secondInput]) {
          response = `END ${truncateForUSSD(USSD_TEMPLATES[secondInput], 180)}`;
        } else {
          response = "END Invalid template selection.";
        }
      } else {
        response = "END Invalid input.";
      }
    } else {
      response = "END Session ended. Dial again to restart.";
    }

    return c.json({
      response,
      isEnd: response.startsWith("END"),
    });
  } catch (err: any) {
    console.error("USSD test error:", err);
    return c.json(
      { error: "USSD test failed. Check server logs for details." },
      500
    );
  }
});

// ═══════════════════════════════════════════════════════════════════
//  WhatsApp / SMS Messaging Integration
// ═══════════════════════════════════════════════════════════════════

// ─── Lazy Migration: Create messaging tables if they don't exist ──

let messagingTablesCreated = false;

async function ensureMessagingTables(db: D1Database): Promise<void> {
  if (messagingTablesCreated) return;
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS whatsapp_sessions (
      id TEXT PRIMARY KEY,
      phone_number TEXT NOT NULL UNIQUE,
      user_id TEXT,
      last_message TEXT,
      last_response TEXT,
      message_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`).run();

    await db.batch([
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_wa_phone ON whatsapp_sessions(phone_number)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
        content TEXT NOT NULL,
        channel TEXT DEFAULT 'whatsapp' CHECK(channel IN ('whatsapp', 'sms')),
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES whatsapp_sessions(id)
      )`),
    ]);

    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_wa_msg_session ON whatsapp_messages(session_id, created_at)`).run();
    messagingTablesCreated = true;
  } catch {
    // Tables likely already exist — safe to ignore
    messagingTablesCreated = true;
  }
}

// ─── Helper: Get AI Response (non-streaming, for messaging) ──────

async function getMessagingAIResponse(
  env: Env,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }> = []
): Promise<string> {
  const { ragResults, faqResults } = await searchKnowledge(env, userMessage, 3);
  const augmentedPrompt = buildAugmentedPrompt(
    GOG_SYSTEM_PROMPT + `\n\nIMPORTANT: You are responding via WhatsApp/SMS. Keep responses concise and mobile-friendly:
- Use short paragraphs (2-3 sentences max)
- Use simple bullet points with dashes (-) instead of complex formatting
- NO markdown headers (#), NO bold (**), NO code blocks, NO tables
- Keep total response under 2000 characters when possible
- Be direct and actionable
- If a topic needs a long answer, summarize the key points and suggest the user visit AskOzzy web app for the full details`,
    ragResults,
    faqResults
  );

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: augmentedPrompt },
  ];

  for (const msg of conversationHistory.slice(-10)) {
    messages.push(msg);
  }
  messages.push({ role: "user", content: userMessage });

  try {
    const result = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct" as any, {
      messages: messages as any,
      max_tokens: 1024,
    });

    if (typeof result === "string") return result;
    if (result && typeof result === "object" && "response" in result) return (result as any).response || "";
    return String(result);
  } catch (err) {
    console.error("Messaging AI error:", err);
    return "Sorry, I'm having trouble processing your request right now. Please try again or use the AskOzzy web app at https://askozzy.ghwmelite.workers.dev";
  }
}

// ─── Helper: Format response for WhatsApp (4096 char limit) ──────

function formatForWhatsApp(text: string): string {
  let formatted = text;
  formatted = formatted.replace(/^#{1,6}\s+/gm, "");
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, "$1");
  formatted = formatted.replace(/\*(.+?)\*/g, "$1");
  formatted = formatted.replace(/```[\s\S]*?```/g, "");
  formatted = formatted.replace(/`([^`]+)`/g, "$1");
  formatted = formatted.replace(/\n{3,}/g, "\n\n").trim();
  if (formatted.length > 4096) {
    formatted = formatted.substring(0, 4060) + "\n\n... [Message truncated. Visit AskOzzy for full response]";
  }
  return formatted;
}

// ─── Helper: Format response for SMS (split into 160-char parts) ──

function formatForSMS(text: string): string[] {
  let plain = text;
  plain = plain.replace(/^#{1,6}\s+/gm, "");
  plain = plain.replace(/\*\*(.+?)\*\*/g, "$1");
  plain = plain.replace(/\*(.+?)\*/g, "$1");
  plain = plain.replace(/```[\s\S]*?```/g, "");
  plain = plain.replace(/`([^`]+)`/g, "$1");
  plain = plain.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  plain = plain.replace(/\n{2,}/g, "\n").trim();

  if (plain.length <= 160) return [plain];

  const parts: string[] = [];
  const maxPartLen = 153;
  let remaining = plain;

  while (remaining.length > 0 && parts.length < 5) {
    if (remaining.length <= 160 && parts.length === 0) {
      parts.push(remaining);
      break;
    }
    let cut = maxPartLen;
    const sentenceEnd = remaining.lastIndexOf(". ", cut);
    const wordEnd = remaining.lastIndexOf(" ", cut);
    if (sentenceEnd > cut * 0.5) cut = sentenceEnd + 1;
    else if (wordEnd > cut * 0.5) cut = wordEnd;

    parts.push(remaining.substring(0, cut).trim());
    remaining = remaining.substring(cut).trim();
  }

  if (remaining.length > 0) {
    parts[parts.length - 1] = parts[parts.length - 1].substring(0, 120) + "... Reply MORE for full answer.";
  }

  if (parts.length > 1) {
    return parts.map((p, i) => `(${i + 1}/${parts.length}) ${p}`);
  }
  return parts;
}

// ─── Helper: Validate webhook secret ─────────────────────────────

async function validateWebhookSecret(env: Env, request: Request): Promise<boolean> {
  try {
    const configStr = await env.SESSIONS.get("messaging_config");
    if (!configStr) return false;
    const config = JSON.parse(configStr);
    if (!config.webhook_secret) return false;

    const signature = request.headers.get("X-AT-Signature") ||
                      request.headers.get("X-Webhook-Secret") ||
                      request.headers.get("x-webhook-secret");
    if (!signature || signature.length !== config.webhook_secret.length) return false;
    const encoder = new TextEncoder();
    const a = encoder.encode(signature);
    const b = encoder.encode(config.webhook_secret);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  } catch {
    return false;
  }
}

// ─── Helper: Parse WhatsApp command ──────────────────────────────

function parseMessagingCommand(text: string): { command: string; args: string } {
  const trimmed = text.trim();
  if (trimmed.startsWith("/")) {
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx === -1) {
      return { command: trimmed.substring(1).toLowerCase(), args: "" };
    }
    return {
      command: trimmed.substring(1, spaceIdx).toLowerCase(),
      args: trimmed.substring(spaceIdx + 1).trim(),
    };
  }
  return { command: "ask", args: trimmed };
}

// ─── WhatsApp Webhook Endpoint ───────────────────────────────────

app.post("/api/whatsapp/webhook", async (c) => {
  const isValid = await validateWebhookSecret(c.env, c.req.raw);
  if (!isValid) {
    return c.json({ error: "Invalid webhook signature" }, 403);
  }

  await ensureMessagingTables(c.env.DB);

  try {
    const configStr = await c.env.SESSIONS.get("messaging_config");
    if (configStr) {
      const config = JSON.parse(configStr);
      if (config.whatsapp_enabled === false) {
        return c.json({ error: "WhatsApp integration is disabled" }, 503);
      }
    }
  } catch {}

  let phoneNumber: string;
  let messageText: string;
  let incomingSessionId: string;

  const contentType = c.req.header("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await c.req.json();
    phoneNumber = body.from || body.phoneNumber || body.phone || "";
    messageText = body.text || body.message || body.body || "";
    incomingSessionId = body.sessionId || body.session_id || "";
  } else {
    const body = await c.req.parseBody();
    phoneNumber = String(body.from || body.phoneNumber || body.phone || "");
    messageText = String(body.text || body.message || body.body || "");
    incomingSessionId = String(body.sessionId || body.session_id || "");
  }

  if (!phoneNumber || !messageText) {
    return c.json({ error: "Phone number and message text are required" }, 400);
  }

  phoneNumber = phoneNumber.replace(/\s+/g, "");
  if (!phoneNumber.startsWith("+")) phoneNumber = "+" + phoneNumber;

  let session = await c.env.DB.prepare(
    "SELECT id, message_count FROM whatsapp_sessions WHERE phone_number = ?"
  ).bind(phoneNumber).first<{ id: string; message_count: number }>();

  if (!session) {
    const sessionId = generateId();
    await c.env.DB.prepare(
      "INSERT INTO whatsapp_sessions (id, phone_number, message_count) VALUES (?, ?, 0)"
    ).bind(sessionId, phoneNumber).run();
    session = { id: sessionId, message_count: 0 };
  }

  await c.env.DB.prepare(
    "INSERT INTO whatsapp_messages (id, session_id, direction, content, channel) VALUES (?, ?, 'inbound', ?, 'whatsapp')"
  ).bind(generateId(), session.id, messageText).run();

  const { command, args } = parseMessagingCommand(messageText);
  let responseText: string;

  switch (command) {
    case "help": {
      responseText = `Welcome to AskOzzy on WhatsApp!

Available commands:
- /ask <question> - Ask Ozzy anything about GoG operations
- /memo <topic> - Get a quick memo drafted
- /template <name> - Use a GoG template (e.g., /template cabinet-memo)
- /help - Show this help message

You can also just type your question directly without any command.

For the full experience, visit: https://askozzy.ghwmelite.workers.dev`;
      break;
    }

    case "memo": {
      if (!args) {
        responseText = "Please provide a memo topic. Example: /memo request for additional budget allocation for Q3";
        break;
      }
      const memoPrompt = `Draft a brief professional memo for a Ghana Government civil servant about: ${args}. Keep it concise and mobile-friendly. Use standard GoG memo format but abbreviated for WhatsApp.`;
      const { results: memoHistory } = await c.env.DB.prepare(
        "SELECT direction, content FROM whatsapp_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 6"
      ).bind(session.id).all<{ direction: string; content: string }>();
      const memoConvHistory = (memoHistory || []).reverse().map(m => ({
        role: m.direction === "inbound" ? "user" : "assistant",
        content: m.content,
      }));
      responseText = await getMessagingAIResponse(c.env, memoPrompt, memoConvHistory);
      break;
    }

    case "template": {
      if (!args) {
        responseText = `Available templates:
- cabinet-memo (Cabinet Memorandum)
- budget-proposal (Budget Proposal)
- procurement-plan (Procurement Plan)
- meeting-minutes (Meeting Minutes)
- policy-brief (Policy Brief)
- official-letter (Official Letter)

Usage: /template cabinet-memo <your topic>

For all 25+ templates, visit the AskOzzy web app.`;
        break;
      }
      const templateParts = args.split(" ");
      const templateName = templateParts[0].toLowerCase();
      const templateTopic = templateParts.slice(1).join(" ") || "general topic";
      const templatePrompts: Record<string, string> = {
        "cabinet-memo": `Draft a Cabinet Memorandum following the 9-section GoG format (Title, Sponsoring Ministry, Problem Statement, Background, Policy Options, Recommendation, Fiscal Impact, Implementation Plan, Conclusion) about: ${templateTopic}`,
        "budget-proposal": `Draft a budget proposal following GoG MTEF format about: ${templateTopic}`,
        "procurement-plan": `Draft a procurement plan following PPA Act 663 guidelines about: ${templateTopic}`,
        "meeting-minutes": `Draft professional meeting minutes in GoG standard format about: ${templateTopic}`,
        "policy-brief": `Draft a concise policy brief for GoG leadership about: ${templateTopic}`,
        "official-letter": `Draft an official block-format letter following GoG correspondence standards about: ${templateTopic}`,
      };
      const prompt = templatePrompts[templateName];
      if (!prompt) {
        responseText = `Template "${templateName}" not found. Type /template to see available templates.`;
        break;
      }
      responseText = await getMessagingAIResponse(c.env, prompt);
      break;
    }

    default: {
      const question = args || messageText;
      const { results: chatHistory } = await c.env.DB.prepare(
        "SELECT direction, content FROM whatsapp_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 10"
      ).bind(session.id).all<{ direction: string; content: string }>();
      const convHistory = (chatHistory || []).reverse().map(m => ({
        role: m.direction === "inbound" ? "user" : "assistant",
        content: m.content,
      }));
      responseText = await getMessagingAIResponse(c.env, question, convHistory);
      break;
    }
  }

  const formattedResponse = formatForWhatsApp(responseText);

  await c.env.DB.prepare(
    "INSERT INTO whatsapp_messages (id, session_id, direction, content, channel) VALUES (?, ?, 'outbound', ?, 'whatsapp')"
  ).bind(generateId(), session.id, formattedResponse).run();

  await c.env.DB.prepare(
    "UPDATE whatsapp_sessions SET last_message = ?, last_response = ?, message_count = message_count + 1, updated_at = datetime('now') WHERE id = ?"
  ).bind(messageText, formattedResponse, session.id).run();

  return c.json({
    message: formattedResponse,
    to: phoneNumber,
    sessionId: incomingSessionId || session.id,
  });
});

// ─── SMS Webhook Endpoint ────────────────────────────────────────

app.post("/api/sms/webhook", async (c) => {
  const isValid = await validateWebhookSecret(c.env, c.req.raw);
  if (!isValid) {
    return c.json({ error: "Invalid webhook signature" }, 403);
  }

  await ensureMessagingTables(c.env.DB);

  try {
    const configStr = await c.env.SESSIONS.get("messaging_config");
    if (configStr) {
      const config = JSON.parse(configStr);
      if (config.sms_enabled === false) {
        return c.json({ error: "SMS integration is disabled" }, 503);
      }
    }
  } catch {}

  let phoneNumber: string;
  let messageText: string;
  const contentType = c.req.header("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await c.req.json();
    phoneNumber = body.from || body.phoneNumber || body.phone || "";
    messageText = body.text || body.message || body.body || "";
  } else {
    const body = await c.req.parseBody();
    phoneNumber = String(body.from || body.phoneNumber || body.phone || "");
    messageText = String(body.text || body.message || body.body || "");
  }

  if (!phoneNumber || !messageText) {
    return c.json({ error: "Phone number and message text are required" }, 400);
  }

  phoneNumber = phoneNumber.replace(/\s+/g, "");
  if (!phoneNumber.startsWith("+")) phoneNumber = "+" + phoneNumber;

  let session = await c.env.DB.prepare(
    "SELECT id, message_count FROM whatsapp_sessions WHERE phone_number = ?"
  ).bind(phoneNumber).first<{ id: string; message_count: number }>();

  if (!session) {
    const sessionId = generateId();
    await c.env.DB.prepare(
      "INSERT INTO whatsapp_sessions (id, phone_number, message_count) VALUES (?, ?, 0)"
    ).bind(sessionId, phoneNumber).run();
    session = { id: sessionId, message_count: 0 };
  }

  await c.env.DB.prepare(
    "INSERT INTO whatsapp_messages (id, session_id, direction, content, channel) VALUES (?, ?, 'inbound', ?, 'sms')"
  ).bind(generateId(), session.id, messageText).run();

  const trimmedMsg = messageText.trim().toUpperCase();
  let responseText: string;

  if (trimmedMsg === "HELP" || trimmedMsg === "/HELP") {
    responseText = "AskOzzy SMS: Send any question about GoG operations. Send HELP for this message. For full features visit askozzy.ghwmelite.workers.dev";
  } else {
    const { results: smsHistory } = await c.env.DB.prepare(
      "SELECT direction, content FROM whatsapp_messages WHERE session_id = ? AND channel = 'sms' ORDER BY created_at DESC LIMIT 4"
    ).bind(session.id).all<{ direction: string; content: string }>();
    const convHistory = (smsHistory || []).reverse().map(m => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.content,
    }));
    responseText = await getMessagingAIResponse(c.env, messageText, convHistory);
  }

  const smsParts = formatForSMS(responseText);

  await c.env.DB.prepare(
    "INSERT INTO whatsapp_messages (id, session_id, direction, content, channel) VALUES (?, ?, 'outbound', ?, 'sms')"
  ).bind(generateId(), session.id, smsParts.join(" | ")).run();

  await c.env.DB.prepare(
    "UPDATE whatsapp_sessions SET last_message = ?, last_response = ?, message_count = message_count + 1, updated_at = datetime('now') WHERE id = ?"
  ).bind(messageText, smsParts[0], session.id).run();

  return c.json({
    messages: smsParts.map(part => ({
      to: phoneNumber,
      message: part,
    })),
  });
});

// ─── Admin: Messaging Config ─────────────────────────────────────

app.get("/api/admin/messaging/config", adminMiddleware, async (c) => {
  try {
    const configStr = await c.env.SESSIONS.get("messaging_config");
    const config = configStr ? JSON.parse(configStr) : {
      whatsapp_enabled: false,
      sms_enabled: false,
      webhook_secret: "",
      api_key: "",
      api_username: "",
      sender_id: "AskOzzy",
    };
    const url = new URL(c.req.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    return c.json({
      config,
      webhook_urls: {
        whatsapp: `${baseUrl}/api/whatsapp/webhook`,
        sms: `${baseUrl}/api/sms/webhook`,
      },
    });
  } catch (err) {
    return c.json({ error: "Failed to load messaging config" }, 500);
  }
});

app.put("/api/admin/messaging/config", adminMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const config = {
      whatsapp_enabled: !!body.whatsapp_enabled,
      sms_enabled: !!body.sms_enabled,
      webhook_secret: body.webhook_secret || "",
      api_key: body.api_key || "",
      api_username: body.api_username || "",
      sender_id: body.sender_id || "AskOzzy",
    };
    await c.env.SESSIONS.put("messaging_config", JSON.stringify(config));
    return c.json({ success: true, config });
  } catch (err) {
    return c.json({ error: "Failed to save messaging config" }, 500);
  }
});

// ─── Admin: Messaging Stats ──────────────────────────────────────

app.get("/api/admin/messaging/stats", adminMiddleware, async (c) => {
  try {
    await ensureMessagingTables(c.env.DB);

    const totalSessions = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM whatsapp_sessions"
    ).first<{ count: number }>();

    const messagesToday = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM whatsapp_messages WHERE date(created_at) = date('now')"
    ).first<{ count: number }>();

    const messagesThisWeek = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM whatsapp_messages WHERE created_at >= datetime('now', '-7 days')"
    ).first<{ count: number }>();

    const activeSessions = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM whatsapp_sessions WHERE updated_at >= datetime('now', '-24 hours')"
    ).first<{ count: number }>();

    const channelBreakdown = await c.env.DB.prepare(
      "SELECT channel, COUNT(*) as count FROM whatsapp_messages GROUP BY channel"
    ).all<{ channel: string; count: number }>();

    const { results: recentSessions } = await c.env.DB.prepare(
      "SELECT id, phone_number, last_message, last_response, message_count, created_at, updated_at FROM whatsapp_sessions ORDER BY updated_at DESC LIMIT 20"
    ).all<{
      id: string;
      phone_number: string;
      last_message: string;
      last_response: string;
      message_count: number;
      created_at: string;
      updated_at: string;
    }>();

    return c.json({
      total_sessions: totalSessions?.count || 0,
      messages_today: messagesToday?.count || 0,
      messages_this_week: messagesThisWeek?.count || 0,
      active_sessions: activeSessions?.count || 0,
      channel_breakdown: channelBreakdown?.results || [],
      recent_sessions: recentSessions || [],
    });
  } catch (err) {
    console.error("Messaging stats error:", err);
    return c.json({
      total_sessions: 0,
      messages_today: 0,
      messages_this_week: 0,
      active_sessions: 0,
      channel_breakdown: [],
      recent_sessions: [],
    });
  }
});

// ─── Admin: Webhook Test (simulate inbound message) ──────────────

app.post("/api/admin/messaging/test", adminMiddleware, async (c) => {
  try {
    await ensureMessagingTables(c.env.DB);

    const { channel, message: testMessage } = await c.req.json();
    const testPhone = "+233000000000";

    let session = await c.env.DB.prepare(
      "SELECT id, message_count FROM whatsapp_sessions WHERE phone_number = ?"
    ).bind(testPhone).first<{ id: string; message_count: number }>();

    if (!session) {
      const sessionId = generateId();
      await c.env.DB.prepare(
        "INSERT INTO whatsapp_sessions (id, phone_number, message_count) VALUES (?, ?, 0)"
      ).bind(sessionId, testPhone).run();
      session = { id: sessionId, message_count: 0 };
    }

    await c.env.DB.prepare(
      "INSERT INTO whatsapp_messages (id, session_id, direction, content, channel) VALUES (?, ?, 'inbound', ?, ?)"
    ).bind(generateId(), session.id, testMessage || "Hello, what is AskOzzy?", channel || "whatsapp").run();

    const responseText = await getMessagingAIResponse(c.env, testMessage || "Hello, what is AskOzzy?");

    const formatted = channel === "sms"
      ? formatForSMS(responseText)
      : [formatForWhatsApp(responseText)];

    await c.env.DB.prepare(
      "INSERT INTO whatsapp_messages (id, session_id, direction, content, channel) VALUES (?, ?, 'outbound', ?, ?)"
    ).bind(generateId(), session.id, formatted[0], channel || "whatsapp").run();

    await c.env.DB.prepare(
      "UPDATE whatsapp_sessions SET last_message = ?, last_response = ?, message_count = message_count + 1, updated_at = datetime('now') WHERE id = ?"
    ).bind(testMessage || "Hello, what is AskOzzy?", formatted[0], session.id).run();

    return c.json({
      success: true,
      channel: channel || "whatsapp",
      input: testMessage || "Hello, what is AskOzzy?",
      response: formatted,
      session_id: session.id,
    });
  } catch (err) {
    console.error("Messaging test error:", err);
    return c.json({ error: "Messaging test failed. Check server logs for details." }, 500);
  }
});

// ─── Admin: Get session messages ─────────────────────────────────

app.get("/api/admin/messaging/sessions/:sessionId/messages", adminMiddleware, async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const { results: messages } = await c.env.DB.prepare(
      "SELECT id, direction, content, channel, created_at FROM whatsapp_messages WHERE session_id = ? ORDER BY created_at ASC"
    ).bind(sessionId).all<{
      id: string;
      direction: string;
      content: string;
      channel: string;
      created_at: string;
    }>();
    return c.json({ messages: messages || [] });
  } catch (err) {
    return c.json({ error: "Failed to load messages" }, 500);
  }
});

// ─── Smart Upgrade Nudges ────────────────────────────────────────────

app.get("/api/usage/nudge", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const user = await c.env.DB.prepare("SELECT tier, trial_expires_at FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string; trial_expires_at: string | null }>();
  const userTier = user?.tier || "free";

  // Check if trial is active
  const trialActive = user?.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date();
  const effectiveTier = (trialActive && userTier === "free") ? "professional" : userTier;

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

// ─── Referral Landing Info ──────────────────────────────────────────

app.get("/api/referral/info", async (c) => {
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

app.post("/api/trial/activate", authMiddleware, async (c) => {
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

app.get("/api/trial/status", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureTrialColumn(c.env.DB);

  const user = await c.env.DB.prepare(
    "SELECT tier, trial_expires_at FROM users WHERE id = ?"
  ).bind(userId).first<{ tier: string; trial_expires_at: string | null }>();

  if (!user) return c.json({ error: "User not found" }, 404);

  const trialActive = user.trial_expires_at && new Date(user.trial_expires_at + "Z") > new Date();
  const effectiveTier = (trialActive && user.tier === "free") ? "professional" : user.tier;

  return c.json({
    tier: user.tier,
    effectiveTier,
    trialExpiresAt: user.trial_expires_at || null,
    trialActive: !!trialActive,
    trialUsed: !!user.trial_expires_at,
  });
});

// ─── Daily Streaks & Badges ─────────────────────────────────────────

app.get("/api/streaks", authMiddleware, async (c) => {
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

// ─── Push Notification Endpoints ────────────────────────────────────

// Public: Return VAPID public key (no auth required)
app.get("/api/push/vapid-public-key", async (c) => {
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY || "" });
});

// Save push subscription
app.post("/api/push/subscribe", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { endpoint, keys, preferences } = await c.req.json();

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return c.json({ error: "Missing required subscription fields (endpoint, keys.p256dh, keys.auth)" }, 400);
    }

    await ensurePushSubscriptionsTable(c.env.DB);

    const id = generateId();
    const notifyAnnouncements = preferences?.announcements !== false ? 1 : 0;
    const notifyQueueSync = preferences?.queueSync !== false ? 1 : 0;
    const notifySharedChat = preferences?.sharedChat !== false ? 1 : 0;

    // Upsert: insert or update on conflict (endpoint is UNIQUE)
    await c.env.DB.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, notify_announcements, notify_queue_sync, notify_shared_chat)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         notify_announcements = excluded.notify_announcements,
         notify_queue_sync = excluded.notify_queue_sync,
         notify_shared_chat = excluded.notify_shared_chat`
    )
      .bind(id, userId, endpoint, keys.p256dh, keys.auth, notifyAnnouncements, notifyQueueSync, notifySharedChat)
      .run();

    return c.json({ success: true });
  } catch (err: any) {
    console.error("Push subscribe error:", err.message);
    return c.json({ error: "Failed to save push subscription" }, 500);
  }
});

// Remove push subscription
app.delete("/api/push/unsubscribe", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { endpoint } = await c.req.json();

    if (!endpoint) {
      return c.json({ error: "Missing endpoint" }, 400);
    }

    await ensurePushSubscriptionsTable(c.env.DB);

    await c.env.DB.prepare(
      "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?"
    )
      .bind(endpoint, userId)
      .run();

    return c.json({ success: true });
  } catch (err: any) {
    console.error("Push unsubscribe error:", err.message);
    return c.json({ error: "Failed to remove push subscription" }, 500);
  }
});

// Check subscription status
app.get("/api/push/status", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");

    await ensurePushSubscriptionsTable(c.env.DB);

    const sub = await c.env.DB.prepare(
      "SELECT notify_announcements, notify_queue_sync, notify_shared_chat FROM push_subscriptions WHERE user_id = ? LIMIT 1"
    )
      .bind(userId)
      .first<{ notify_announcements: number; notify_queue_sync: number; notify_shared_chat: number }>();

    if (!sub) {
      return c.json({ subscribed: false, preferences: null });
    }

    return c.json({
      subscribed: true,
      preferences: {
        announcements: !!sub.notify_announcements,
        queueSync: !!sub.notify_queue_sync,
        sharedChat: !!sub.notify_shared_chat,
      },
    });
  } catch (err: any) {
    console.error("Push status error:", err.message);
    return c.json({ error: "Failed to check push status" }, 500);
  }
});

// Update notification preferences
app.put("/api/push/preferences", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { endpoint, announcements, queueSync, sharedChat } = await c.req.json();

    if (!endpoint) {
      return c.json({ error: "Missing endpoint" }, 400);
    }

    await ensurePushSubscriptionsTable(c.env.DB);

    const result = await c.env.DB.prepare(
      `UPDATE push_subscriptions
       SET notify_announcements = ?, notify_queue_sync = ?, notify_shared_chat = ?
       WHERE endpoint = ? AND user_id = ?`
    )
      .bind(
        announcements !== false ? 1 : 0,
        queueSync !== false ? 1 : 0,
        sharedChat !== false ? 1 : 0,
        endpoint,
        userId
      )
      .run();

    if (!result.meta.changes) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    return c.json({ success: true });
  } catch (err: any) {
    console.error("Push preferences error:", err.message);
    return c.json({ error: "Failed to update preferences" }, 500);
  }
});

export default app;
