import { Hono } from "hono";
import type { AppType } from "../types";
import {
  generateId, hashPassword, verifyPassword,
  generateAccessCode, normalizeAccessCode,
  generateRecoveryCode, generateReferralSuffix,
  createToken, verifyToken,
} from "../lib/utils";
import { checkRateLimit, authMiddleware } from "../lib/middleware";
import { log } from "../lib/logger";

const auth = new Hono<AppType>();

// ─── Org Pricing Tiers ──────────────────────────────────────────────

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

// ─── Lazy Migration Helpers ─────────────────────────────────────────

async function ensureTrialColumn(db: D1Database) {
  try {
    await db.prepare("SELECT trial_expires_at FROM users LIMIT 1").first();
  } catch {
    await db.prepare("ALTER TABLE users ADD COLUMN trial_expires_at TEXT DEFAULT NULL").run();
  }
}

async function ensureUserTypeColumn(db: D1Database) {
  try {
    await db.prepare("SELECT user_type FROM users LIMIT 1").first();
  } catch {
    await db.prepare("ALTER TABLE users ADD COLUMN user_type TEXT DEFAULT 'gog_employee'").run();
  }
}

async function ensureOrgRoleColumn(db: D1Database) {
  try {
    await db.prepare("SELECT org_role FROM users LIMIT 1").first();
  } catch {
    await db.prepare("ALTER TABLE users ADD COLUMN org_role TEXT DEFAULT NULL").run();
  }
}

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

async function ensureSessionVersionColumn(db: D1Database) {
  try {
    await db.prepare("SELECT session_version FROM users LIMIT 1").first();
  } catch {
    await db.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1");
  }
}

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

// ─── Affiliate Helpers (used by registration referral flow) ─────────

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

async function ensureWallet(db: D1Database, userId: string): Promise<{ balance: number; total_earned: number; total_withdrawn: number }> {
  await ensureAffiliateTables(db);
  const existing = await db.prepare("SELECT balance, total_earned, total_withdrawn FROM affiliate_wallets WHERE user_id = ?")
    .bind(userId).first<{ balance: number; total_earned: number; total_withdrawn: number }>();
  if (existing) return existing;
  await db.prepare("INSERT OR IGNORE INTO affiliate_wallets (user_id) VALUES (?)").bind(userId).run();
  return { balance: 0, total_earned: 0, total_withdrawn: 0 };
}

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

// ─── TOTP Helpers ───────────────────────────────────────────────────

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

// ─── WebAuthn Crypto Helpers ────────────────────────────────────────

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
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════

// ─── Individual Registration ────────────────────────────────────────

auth.post("/api/auth/register", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const rl = await checkRateLimit(c.env, ip, "auth");
  if (!rl.allowed) return c.json({ error: "Too many registration attempts. Try again later." }, 429);

  const { email, fullName, department, referralCode, userType } = await c.req.json();

  if (!email || !fullName) {
    return c.json({ error: "Email and full name are required" }, 400);
  }

  // Validate email format and length
  const trimmedEmail = email.trim().toLowerCase();
  if (trimmedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return c.json({ error: "Please enter a valid email address" }, 400);
  }

  if (fullName.trim().length < 2 || fullName.trim().length > 100) {
    return c.json({ error: "Full name must be between 2 and 100 characters" }, 400);
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
  await ensureSessionVersionColumn(c.env.DB);
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
        log("error", "Referral bonus error", { error: String(err) });
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

// ─── Organisation Registration ───────────────────────────────────────

auth.post("/api/auth/register/organisation", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const rl = await checkRateLimit(c.env, ip, "auth");
  if (!rl.allowed) return c.json({ error: "Too many registration attempts. Try again later." }, 429);

  const { orgName, orgSlug, orgSector, orgDomain, adminName, adminEmail, plan, seats, referralCode } = await c.req.json();

  if (!orgName || !orgSlug || !adminName || !adminEmail || !plan) {
    return c.json({ error: "Organisation name, slug, admin name, admin email, and plan are required" }, 400);
  }

  // Validate slug format: lowercase alphanumeric + hyphens only
  const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  if (!slugRegex.test(orgSlug)) {
    return c.json({ error: "Slug must be lowercase letters, numbers, and hyphens only (no leading/trailing hyphens)" }, 400);
  }

  if (orgSlug.length < 3 || orgSlug.length > 50) {
    return c.json({ error: "Slug must be between 3 and 50 characters" }, 400);
  }

  // Validate email
  const trimmedEmail = adminEmail.trim().toLowerCase();
  if (trimmedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return c.json({ error: "Please enter a valid email address" }, 400);
  }

  // Validate plan
  if (!ORG_PRICING_TIERS[plan]) {
    return c.json({ error: "Invalid plan. Choose starter, business, or custom" }, 400);
  }

  const seatCount = Math.max(1, Math.min(1000, parseInt(seats) || 10));

  // Check slug uniqueness
  const existingSlug = await c.env.DB.prepare(
    "SELECT id FROM organizations WHERE slug = ?"
  ).bind(orgSlug).first();
  if (existingSlug) {
    return c.json({ error: "This organisation slug is already taken" }, 409);
  }

  // Check email uniqueness
  const existingEmail = await c.env.DB.prepare(
    "SELECT id FROM users WHERE email = ?"
  ).bind(trimmedEmail).first();
  if (existingEmail) {
    return c.json({ error: "An account with this email already exists" }, 409);
  }

  const orgId = generateId();
  const userId = generateId();
  const accessCode = generateAccessCode();
  const passwordHash = await hashPassword(accessCode);

  // Generate referral code for the admin user
  const firstName = adminName.split(" ")[0].toUpperCase();
  const suffix = generateReferralSuffix();
  const userReferralCode = `OZZY-${firstName}-${suffix}`;

  // Calculate effective price
  const effectivePrice = getEffectiveOrgSeatPrice(plan, seatCount);
  const discount = getVolumeDiscount(seatCount);

  // Handle referral code lookup
  let referredBy: string | null = null;
  if (referralCode && referralCode.trim()) {
    const isSystemReferral = referralCode.trim().toUpperCase().startsWith("OZZY-SYSTEM-");
    if (!isSystemReferral) {
      const referrer = await c.env.DB.prepare(
        "SELECT id FROM users WHERE referral_code = ?"
      ).bind(referralCode.trim().toUpperCase()).first<{ id: string }>();
      if (referrer) {
        referredBy = referrer.id;
      }
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

  // Generate recovery code
  const recoveryCode = generateRecoveryCode();
  const recoveryCodeHash = await hashPassword(recoveryCode);

  const pricingId = generateId();

  // Batch insert: organization + admin user + org pricing
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, owner_id, tier, max_seats, used_seats, sector, domain, settings) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, '{}')"
    ).bind(orgId, orgName, orgSlug, userId, plan, seatCount, orgSector || null, orgDomain || null),
    c.env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, full_name, department, referral_code, referred_by, user_type, org_id, org_role, totp_secret, auth_method, recovery_code_hash) VALUES (?, ?, ?, ?, '', ?, ?, 'gog_employee', ?, 'org_admin', ?, 'totp', ?)"
    ).bind(userId, trimmedEmail, passwordHash, adminName, userReferralCode, referredBy, orgId, totpSecret, recoveryCodeHash),
    c.env.DB.prepare(
      "INSERT INTO org_pricing (id, org_id, plan, seats_purchased, price_per_seat, billing_cycle) VALUES (?, ?, ?, ?, ?, 'monthly')"
    ).bind(pricingId, orgId, plan, seatCount, effectivePrice),
  ]);

  // If referred, record the referral
  if (referredBy) {
    await c.env.DB.prepare(
      "INSERT INTO referrals (id, referrer_id, referred_id, status, bonus_amount) VALUES (?, ?, ?, 'completed', 0.00)"
    ).bind(generateId(), referredBy, userId).run();

    await c.env.DB.prepare(
      "UPDATE users SET total_referrals = total_referrals + 1 WHERE id = ?"
    ).bind(referredBy).run();
  }

  const totpUri = `otpauth://totp/AskOzzy:${trimmedEmail}?secret=${totpSecret}&issuer=AskOzzy&digits=6&period=30`;

  return c.json({
    totpUri,
    email: trimmedEmail,
    fullName: adminName,
    orgId,
    orgSlug,
    referralCode: userReferralCode,
    pricing: {
      plan,
      seats: seatCount,
      pricePerSeat: effectivePrice,
      discount: Math.round(discount * 100),
      monthlyTotal: Math.round(effectivePrice * seatCount * 100) / 100,
    },
  });
});

// ─── Domain Check (email -> org match) ──────────────────────────────

auth.get("/api/auth/domain-check/:email", async (c) => {
  const email = c.req.param("email");
  if (!email || !email.includes("@")) {
    return c.json({ match: false, org: null });
  }

  const domain = email.split("@")[1].toLowerCase();
  const org = await c.env.DB.prepare(
    "SELECT id, name, slug FROM organizations WHERE domain = ?"
  ).bind(domain).first<{ id: string; name: string; slug: string }>();

  if (org) {
    return c.json({ match: true, org: { id: org.id, name: org.name, slug: org.slug } });
  }
  return c.json({ match: false, org: null });
});

// ─── Accept Org Invite ──────────────────────────────────────────────

auth.post("/api/auth/invite/accept/:id", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const rl = await checkRateLimit(c.env, ip, "auth");
  if (!rl.allowed) return c.json({ error: "Too many attempts. Try again later." }, 429);

  const inviteId = c.req.param("id");
  const { fullName } = await c.req.json();

  if (!fullName) {
    return c.json({ error: "Full name is required" }, 400);
  }

  // Look up invite
  const invite = await c.env.DB.prepare(
    "SELECT id, org_id, email, role, tier FROM org_invites WHERE id = ? AND status = 'pending'"
  ).bind(inviteId).first<{ id: string; org_id: string; email: string; role: string; tier: string | null }>();

  if (!invite) {
    return c.json({ error: "Invite not found or already used" }, 404);
  }

  // Check email not already registered
  const existingUser = await c.env.DB.prepare(
    "SELECT id FROM users WHERE email = ?"
  ).bind(invite.email.toLowerCase().trim()).first();
  if (existingUser) {
    return c.json({ error: "An account with this email already exists" }, 409);
  }

  // Check org seat limit
  const org = await c.env.DB.prepare(
    "SELECT id, max_seats, used_seats FROM organizations WHERE id = ?"
  ).bind(invite.org_id).first<{ id: string; max_seats: number; used_seats: number }>();

  if (!org) {
    return c.json({ error: "Organisation not found" }, 404);
  }

  if (org.used_seats >= org.max_seats) {
    return c.json({ error: "Organisation has reached its seat limit" }, 400);
  }

  // Create user account
  const userId = generateId();
  const accessCode = generateAccessCode();
  const passwordHash = await hashPassword(accessCode);
  const firstName = fullName.split(" ")[0].toUpperCase();
  const suffix = generateReferralSuffix();
  const userReferralCode = `OZZY-${firstName}-${suffix}`;

  // Auto-generate TOTP secret
  const secretBytes = new Uint8Array(20);
  crypto.getRandomValues(secretBytes);
  const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let totpSecret = "";
  for (let i = 0; i < secretBytes.length; i++) {
    totpSecret += base32Chars[secretBytes[i] % 32];
  }

  const recoveryCode = generateRecoveryCode();
  const recoveryCodeHash = await hashPassword(recoveryCode);

  // Batch: create user, update invite status, increment seats
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, full_name, department, referral_code, user_type, org_id, org_role, totp_secret, auth_method, recovery_code_hash) VALUES (?, ?, ?, ?, '', ?, 'gog_employee', ?, ?, ?, 'totp', ?)"
    ).bind(userId, invite.email.toLowerCase().trim(), passwordHash, fullName, userReferralCode, invite.org_id, invite.role || "member", totpSecret, recoveryCodeHash),
    c.env.DB.prepare(
      "UPDATE org_invites SET status = 'accepted' WHERE id = ?"
    ).bind(inviteId),
    c.env.DB.prepare(
      "UPDATE organizations SET used_seats = used_seats + 1 WHERE id = ?"
    ).bind(invite.org_id),
  ]);

  const totpUri = `otpauth://totp/AskOzzy:${invite.email.toLowerCase().trim()}?secret=${totpSecret}&issuer=AskOzzy&digits=6&period=30`;

  return c.json({
    totpUri,
    email: invite.email.toLowerCase().trim(),
    fullName,
    referralCode: userReferralCode,
    orgId: invite.org_id,
  });
});

// ─── Verify TOTP After Registration ──────────────────────────────────

auth.post("/api/auth/register/verify-totp", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const rl = await checkRateLimit(c.env, `${ip}:totp`, "auth");
  if (!rl.allowed) return c.json({ error: "Too many verification attempts. Try again later." }, 429);

  const { email, code } = await c.req.json();

  if (!email || !code) {
    return c.json({ error: "Email and verification code are required" }, 400);
  }

  const user = await c.env.DB.prepare(
    "SELECT id, email, full_name, department, role, tier, referral_code, totp_secret, totp_enabled, user_type, recovery_code_hash FROM users WHERE email = ?"
  )
    .bind(email.toLowerCase().trim())
    .first<{
      id: string; email: string; full_name: string; department: string;
      role: string; tier: string; referral_code: string; totp_secret: string;
      totp_enabled: number; user_type: string | null; recovery_code_hash: string | null;
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

  await ensureSessionVersionColumn(c.env.DB);
  const sv = await c.env.DB.prepare("SELECT session_version FROM users WHERE id = ?")
    .bind(user.id).first<{ session_version: number }>();
  const token = await createToken(user.id, c.env, sv?.session_version);

  // Only generate recovery code if one doesn't already exist (e.g. set during account reset)
  let newRecoveryCode: string | null = null;
  if (!user.recovery_code_hash) {
    newRecoveryCode = generateRecoveryCode();
    const newRecoveryHash = await hashPassword(newRecoveryCode);
    await c.env.DB.prepare("UPDATE users SET recovery_code_hash = ? WHERE id = ?")
      .bind(newRecoveryHash, user.id).run();
  }

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
      effectiveTier: getEffectiveTier({ tier: user.tier, subscription_expires_at: null, trial_expires_at: null }),
      referralCode: user.referral_code,
      userType: user.user_type || "gog_employee",
    },
  });
});

// ─── Self-Service Account Reset via Recovery Code ────────────────────

auth.post("/api/auth/reset-account", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const { email, recoveryCode } = await c.req.json();

  if (!email || !recoveryCode) {
    return c.json({ error: "Email and recovery code are required" }, 400);
  }

  const rl = await checkRateLimit(c.env, `${ip}:${email.toLowerCase().trim()}`, "auth");
  if (!rl.allowed) return c.json({ error: "Too many attempts. Please wait 5 minutes." }, 429);

  const user = await c.env.DB.prepare(
    "SELECT id, email, recovery_code_hash FROM users WHERE email = ?"
  )
    .bind(email.toLowerCase().trim())
    .first<{ id: string; email: string; recovery_code_hash: string | null }>();

  if (!user || !user.recovery_code_hash) {
    return c.json({ error: "Invalid email or recovery code" }, 401);
  }

  // Verify recovery code against stored hash
  const normalizedCode = normalizeAccessCode(recoveryCode.trim());
  let recoveryValid = await verifyPassword(normalizedCode, user.recovery_code_hash);
  if (!recoveryValid) {
    recoveryValid = await verifyPassword(recoveryCode.trim(), user.recovery_code_hash);
  }
  if (!recoveryValid) {
    return c.json({ error: "Invalid email or recovery code" }, 401);
  }

  // Generate new credentials
  const newAccessCode = generateAccessCode();
  const newPasswordHash = await hashPassword(newAccessCode);

  const secretBytes = new Uint8Array(20);
  crypto.getRandomValues(secretBytes);
  const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let newTotpSecret = "";
  for (let i = 0; i < secretBytes.length; i++) {
    newTotpSecret += base32Chars[secretBytes[i] % 32];
  }

  const newRecoveryCode = generateRecoveryCode();
  const newRecoveryHash = await hashPassword(newRecoveryCode);

  // Update user: new access code, new TOTP secret, new recovery code, disable TOTP until re-verified
  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, totp_secret = ?, totp_enabled = 0, recovery_code_hash = ? WHERE id = ?"
  ).bind(newPasswordHash, newTotpSecret, newRecoveryHash, user.id).run();

  // Bump session version to invalidate all existing sessions
  await ensureSessionVersionColumn(c.env.DB);
  await c.env.DB.prepare("UPDATE users SET session_version = session_version + 1 WHERE id = ?").bind(user.id).run();

  const totpUri = `otpauth://totp/AskOzzy:${user.email}?secret=${newTotpSecret}&issuer=AskOzzy&digits=6&period=30`;

  return c.json({
    totpUri,
    totpSecret: newTotpSecret,
    accessCode: newAccessCode,
    recoveryCode: newRecoveryCode,
    email: user.email,
  });
});

// ─── Login ──────────────────────────────────────────────────────────

auth.post("/api/auth/login", async (c) => {
  const { email, password, accessCode, totpCode } = await c.req.json();
  const credential = totpCode || accessCode || password;

  if (!email || !credential) {
    return c.json({ error: "Email and authentication code are required" }, 400);
  }

  // Rate limit login attempts (only trust cf-connecting-ip behind Cloudflare)
  const clientIP = c.req.header("cf-connecting-ip") || "unknown";
  const rateCheck = await checkRateLimit(c.env, `${clientIP}:${email}`, "auth");
  if (!rateCheck.allowed) {
    return c.json({ error: "Too many login attempts. Please wait 5 minutes." }, 429);
  }

  await ensureTrialColumn(c.env.DB);
  await ensureUserTypeColumn(c.env.DB);
  await ensureAuthMethodColumns(c.env.DB);
  await ensureSubscriptionColumns(c.env.DB);
  await ensureOrgRoleColumn(c.env.DB);
  await ensureSessionVersionColumn(c.env.DB);
  const user = await c.env.DB.prepare(
    "SELECT id, email, password_hash, full_name, department, role, tier, referral_code, affiliate_tier, total_referrals, affiliate_earnings, trial_expires_at, user_type, totp_secret, totp_enabled, auth_method, recovery_code_hash, subscription_expires_at, billing_cycle, org_id, org_role, session_version FROM users WHERE email = ?"
  )
    .bind(email.toLowerCase().trim())
    .first<{
      id: string; email: string; password_hash: string; full_name: string;
      department: string; role: string; tier: string; referral_code: string;
      affiliate_tier: string; total_referrals: number; affiliate_earnings: number;
      trial_expires_at: string | null; user_type: string | null;
      totp_secret: string | null; totp_enabled: number; auth_method: string | null;
      recovery_code_hash: string | null;
      subscription_expires_at: string | null; billing_cycle: string | null;
      session_version: number;
    }>();

  if (!user) {
    return c.json({ error: "Invalid email or authentication code" }, 401);
  }

  // Check if account is deactivated
  const userStatus = await c.env.DB.prepare("SELECT status FROM users WHERE id = ?").bind(user.id).first<{ status: string }>();
  if (userStatus?.status === "deactivated") {
    return c.json({ error: "Your account has been deactivated. Please contact your administrator." }, 403);
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

  const token = await createToken(user.id, c.env, user.session_version);

  // Compute effective tier honoring trial + subscription expiry
  const effectiveTier = getEffectiveTier(user);

  // Grace period detection for frontend
  let inGracePeriod = false;
  if (user.tier && user.tier !== "free" && user.subscription_expires_at) {
    const expiresAt = new Date(user.subscription_expires_at + "Z");
    inGracePeriod = new Date() > expiresAt && effectiveTier !== "free";
  }

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
      subscriptionExpiresAt: user.subscription_expires_at || null,
      billingCycle: user.billing_cycle || "monthly",
      inGracePeriod,
      userType: user.user_type || "gog_employee",
    },
  });
});

// ─── Logout ─────────────────────────────────────────────────────────

auth.post("/api/auth/logout", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    await c.env.SESSIONS.delete(`session:${token}`);
  }
  return c.json({ success: true });
});

// ─── WebAuthn Registration ─────────────────────────────────────────────

auth.post("/api/auth/webauthn/register-options", authMiddleware, async (c) => {
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

auth.post("/api/auth/webauthn/register-complete", authMiddleware, async (c) => {
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

auth.post("/api/auth/webauthn/login-options", async (c) => {
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

auth.post("/api/auth/webauthn/login-complete", async (c) => {
  const { email, credentialId, authenticatorData, clientDataJSON, signature } = await c.req.json();

  if (!email || !credentialId || !authenticatorData || !clientDataJSON || !signature) {
    return c.json({ error: "Missing authentication data" }, 400);
  }

  await ensureSubscriptionColumns(c.env.DB);
  await ensureSessionVersionColumn(c.env.DB);
  const user = await c.env.DB.prepare(
    "SELECT id, email, full_name, department, role, tier, referral_code, affiliate_tier, total_referrals, affiliate_earnings, trial_expires_at, user_type, subscription_expires_at, billing_cycle, session_version FROM users WHERE email = ?"
  ).bind(email.toLowerCase().trim()).first<{
    id: string; email: string; full_name: string; department: string;
    role: string; tier: string; referral_code: string;
    affiliate_tier: string; total_referrals: number; affiliate_earnings: number;
    trial_expires_at: string | null; user_type: string | null;
    subscription_expires_at: string | null; billing_cycle: string | null;
    session_version: number;
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

  const token = await createToken(user.id, c.env, user.session_version);
  const effectiveTier = getEffectiveTier(user);

  // Grace period detection
  let inGracePeriod = false;
  if (user.tier && user.tier !== "free" && user.subscription_expires_at) {
    const expiresAt = new Date(user.subscription_expires_at + "Z");
    inGracePeriod = new Date() > expiresAt && effectiveTier !== "free";
  }

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
      subscriptionExpiresAt: user.subscription_expires_at || null,
      billingCycle: user.billing_cycle || "monthly",
      inGracePeriod,
      userType: user.user_type || "gog_employee",
    },
  });
});

// ─── WebAuthn Credential Management ──────────────────────────────────────

auth.get("/api/auth/webauthn/credentials", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureWebAuthnTable(c.env.DB);
  const { results } = await c.env.DB.prepare(
    "SELECT id, credential_id, created_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC"
  ).bind(userId).all();
  return c.json({ credentials: results || [] });
});

auth.delete("/api/auth/webauthn/credentials/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const credId = c.req.param("id");
  await ensureWebAuthnTable(c.env.DB);
  await c.env.DB.prepare(
    "DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?"
  ).bind(credId, userId).run();
  return c.json({ success: true });
});

// ─── Recovery Code Regeneration ──────────────────────────────────────────

auth.post("/api/auth/recovery-code/regenerate", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const newCode = generateRecoveryCode();
  const hash = await hashPassword(newCode);
  await ensureAuthMethodColumns(c.env.DB);
  await c.env.DB.prepare("UPDATE users SET recovery_code_hash = ? WHERE id = ?")
    .bind(hash, userId).run();
  return c.json({ recoveryCode: newCode });
});

export default auth;
