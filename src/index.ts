import { Hono } from "hono";
import { cors } from "hono/cors";

type Env = {
  AI: Ai;
  DB: D1Database;
  SESSIONS: KVNamespace;
  VECTORIZE: VectorizeIndex;
  JWT_SECRET: string;
};

type Variables = {
  userId: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("/api/*", cors());

// ─── Utility Functions ──────────────────────────────────────────────

function generateId(): string {
  return crypto.randomUUID();
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

function generateAccessCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code.slice(0, 4) + "-" + code.slice(4);
}

function normalizeAccessCode(input: string): string {
  const stripped = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (stripped.length === 8) {
    return stripped.slice(0, 4) + "-" + stripped.slice(4);
  }
  return input;
}

async function createToken(userId: string, env: Env): Promise<string> {
  const token = generateId();
  await env.SESSIONS.put(`session:${token}`, userId, {
    expirationTtl: 60 * 60 * 24 * 7, // 7 days
  });
  return token;
}

async function verifyToken(
  token: string,
  env: Env
): Promise<string | null> {
  return await env.SESSIONS.get(`session:${token}`);
}

// ─── Rate Limiting (in-memory + KV backed) ─────────────────────────────

const RATE_LIMITS: Record<string, { maxRequests: number; windowSeconds: number }> = {
  "auth": { maxRequests: 10, windowSeconds: 300 },     // 10 auth attempts per 5 min
  "chat": { maxRequests: 30, windowSeconds: 60 },       // 30 chat requests per minute
  "api": { maxRequests: 100, windowSeconds: 60 },       // 100 API requests per minute
};

async function checkRateLimit(env: Env, key: string, category: string): Promise<{ allowed: boolean; remaining: number }> {
  const config = RATE_LIMITS[category] || RATE_LIMITS.api;
  const kvKey = `ratelimit:${category}:${key}`;

  try {
    const current = await env.SESSIONS.get(kvKey);
    const count = current ? parseInt(current) : 0;

    if (count >= config.maxRequests) {
      return { allowed: false, remaining: 0 };
    }

    await env.SESSIONS.put(kvKey, String(count + 1), { expirationTtl: config.windowSeconds });
    return { allowed: true, remaining: config.maxRequests - count - 1 };
  } catch {
    return { allowed: true, remaining: config.maxRequests }; // fail open
  }
}

// ─── Auth Middleware ─────────────────────────────────────────────────

async function authMiddleware(
  c: any,
  next: () => Promise<void>
): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice(7);
  const userId = await verifyToken(token, c.env);
  if (!userId) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }
  c.set("userId", userId);
  await next();
}

// ─── Admin Middleware ────────────────────────────────────────────────

async function adminMiddleware(
  c: any,
  next: () => Promise<void>
): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice(7);
  const userId = await verifyToken(token, c.env);
  if (!userId) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }
  const user = await c.env.DB.prepare("SELECT role FROM users WHERE id = ?")
    .bind(userId)
    .first<{ role: string }>();
  if (!user || user.role !== "super_admin") {
    return c.json({ error: "Forbidden: admin access required" }, 403);
  }
  c.set("userId", userId);
  await next();
}

// ─── Auth Routes ────────────────────────────────────────────────────

app.post("/api/auth/register", async (c) => {
  const { email, fullName, department, referralCode } = await c.req.json();

  if (!email || !fullName) {
    return c.json({ error: "Email and full name are required" }, 400);
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
  const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const userReferralCode = `OZZY-${firstName}-${suffix}`;

  // Check if referred by someone
  let referredBy: string | null = null;
  if (referralCode && referralCode.trim()) {
    const referrer = await c.env.DB.prepare(
      "SELECT id FROM users WHERE referral_code = ?"
    )
      .bind(referralCode.trim().toUpperCase())
      .first<{ id: string }>();

    if (referrer) {
      referredBy = referrer.id;
    }
  }

  await c.env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, full_name, department, referral_code, referred_by) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(userId, email.toLowerCase().trim(), passwordHash, fullName, department || "", userReferralCode, referredBy)
    .run();

  // If referred, record the referral and credit the referrer
  if (referredBy) {
    await c.env.DB.prepare(
      "INSERT INTO referrals (id, referrer_id, referred_id, status, bonus_amount) VALUES (?, ?, ?, 'completed', 10.00)"
    )
      .bind(generateId(), referredBy, userId)
      .run();

    // Update referrer stats
    await c.env.DB.prepare(
      "UPDATE users SET total_referrals = total_referrals + 1, affiliate_earnings = affiliate_earnings + 10.00 WHERE id = ?"
    )
      .bind(referredBy)
      .run();

    // Check if referrer should be upgraded to a higher tier
    const referrer = await c.env.DB.prepare(
      "SELECT total_referrals, affiliate_tier FROM users WHERE id = ?"
    )
      .bind(referredBy)
      .first<{ total_referrals: number; affiliate_tier: string }>();

    if (referrer) {
      let newTier = referrer.affiliate_tier;
      if (referrer.total_referrals >= 50) newTier = "gold";
      else if (referrer.total_referrals >= 20) newTier = "silver";
      else if (referrer.total_referrals >= 5) newTier = "bronze";

      if (newTier !== referrer.affiliate_tier) {
        await c.env.DB.prepare(
          "UPDATE users SET affiliate_tier = ? WHERE id = ?"
        )
          .bind(newTier, referredBy)
          .run();
      }
    }
  }

  const token = await createToken(userId, c.env);

  return c.json({
    token,
    accessCode,
    user: { id: userId, email: email.toLowerCase().trim(), fullName, department, role: "civil_servant", tier: "free", referralCode: userReferralCode },
  });
});

app.post("/api/auth/login", async (c) => {
  const { email, password, accessCode } = await c.req.json();
  const credential = accessCode || password;

  if (!email || !credential) {
    return c.json({ error: "Email and access code are required" }, 400);
  }

  // Rate limit login attempts
  const clientIP = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
  const rateCheck = await checkRateLimit(c.env, `${clientIP}:${email}`, "auth");
  if (!rateCheck.allowed) {
    return c.json({ error: "Too many login attempts. Please wait 5 minutes." }, 429);
  }

  const user = await c.env.DB.prepare(
    "SELECT id, email, password_hash, full_name, department, role, tier, referral_code, affiliate_tier, total_referrals, affiliate_earnings FROM users WHERE email = ?"
  )
    .bind(email.toLowerCase().trim())
    .first<{
      id: string;
      email: string;
      password_hash: string;
      full_name: string;
      department: string;
      role: string;
      tier: string;
      referral_code: string;
      affiliate_tier: string;
      total_referrals: number;
      affiliate_earnings: number;
    }>();

  if (!user) {
    return c.json({ error: "Invalid email or access code" }, 401);
  }

  const normalized = normalizeAccessCode(credential);
  const normalizedHash = await hashPassword(normalized);
  let match = normalizedHash === user.password_hash;

  // Fallback: try raw credential for legacy password users
  if (!match && normalized !== credential) {
    const rawHash = await hashPassword(credential);
    match = rawHash === user.password_hash;
  }

  if (!match) {
    return c.json({ error: "Invalid email or access code" }, 401);
  }

  await c.env.DB.prepare(
    "UPDATE users SET last_login = datetime('now') WHERE id = ?"
  )
    .bind(user.id)
    .run();

  const token = await createToken(user.id, c.env);

  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      department: user.department,
      role: user.role || "civil_servant",
      tier: user.tier,
      referralCode: user.referral_code,
      affiliateTier: user.affiliate_tier,
      totalReferrals: user.total_referrals,
      affiliateEarnings: user.affiliate_earnings,
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
  messagesPerDay: number;
  models: string;
  features: string[];
}> = {
  free: {
    name: "Free",
    price: 0,
    messagesPerDay: 10,
    models: "basic",
    features: ["10 messages/day", "Basic models (3)", "Standard response speed"],
  },
  starter: {
    name: "Starter",
    price: 30,
    messagesPerDay: 50,
    models: "all",
    features: ["50 messages/day", "All 10 AI models", "Faster responses", "Conversation history"],
  },
  professional: {
    name: "Professional",
    price: 60,
    messagesPerDay: 200,
    models: "all",
    features: ["200 messages/day", "All 10 AI models", "Priority speed", "Unlimited history", "Template customisation"],
  },
  enterprise: {
    name: "Enterprise",
    price: 100,
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
  ragResults: Array<{ content: string; score: number; source: string }>;
  faqResults: Array<{ question: string; answer: string; category: string }>;
}> {
  let ragResults: Array<{ content: string; score: number; source: string }> = [];
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
  ragResults: Array<{ content: string; score: number; source: string }>,
  faqResults: Array<{ question: string; answer: string; category: string }>
): string {
  let prompt = base;

  if (ragResults.length > 0) {
    prompt += '\n\n--- RELEVANT KNOWLEDGE BASE CONTEXT ---\n';
    prompt += 'The following excerpts are from official GoG documents and may be relevant to the user\'s query. Use them to provide accurate, well-sourced answers:\n\n';
    for (const r of ragResults) {
      prompt += `[Source: ${r.source}]\n${r.content}\n\n`;
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
    prompt += '---\nWhen using the above context, cite the source where possible. If the context does not fully answer the question, supplement with your general knowledge of GoG procedures.';
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
  starter: 10,
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

  // Get user tier
  const user = await c.env.DB.prepare("SELECT tier FROM users WHERE id = ?")
    .bind(userId)
    .first<{ tier: string }>();
  const userTier = user?.tier || "free";

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

  // Determine base system prompt (agent or default)
  let baseSystemPrompt = systemPrompt || GOG_SYSTEM_PROMPT;
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
  const stream = await c.env.AI.run(selectedModel as BaseAiTextGenerationModels, {
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
              const titleResponse = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as BaseAiTextGenerationModels, {
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
              const extractResponse = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as BaseAiTextGenerationModels, {
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

  // Tier gate: Professional+ only
  const user = await c.env.DB.prepare("SELECT tier FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string }>();
  const userTier = user?.tier || "free";
  if (userTier === "free" || userTier === "starter") {
    return c.json({ error: "Deep Research requires a Professional or Enterprise plan.", code: "TIER_REQUIRED" }, 403);
  }

  const reportId = generateId();

  // Create report record
  await c.env.DB.prepare(
    "INSERT INTO research_reports (id, user_id, conversation_id, query) VALUES (?, ?, ?, ?)"
  ).bind(reportId, userId, conversationId, query).run();

  // SSE stream for real-time progress
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendEvent = async (event: string, data: any) => {
    await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  c.executionCtx.waitUntil(
    (async () => {
      let allSources: Array<{ title: string; url: string; snippet: string }> = [];
      let report = "";

      try {
        // ── Step 1: Query Analysis ──
        await sendEvent("research:step", { step: 1, total: 5, description: "Analysing research question..." });

        const analysisResponse = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as BaseAiTextGenerationModels, {
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
              kbContext += `[KB: ${r.source}] ${r.content}\n\n`;
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

        const synthesisResponse = await c.env.AI.run("@cf/openai/gpt-oss-20b" as BaseAiTextGenerationModels, {
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

  // Tier gate: Starter+ only
  const user = await c.env.DB.prepare("SELECT tier FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string }>();
  const userTier = user?.tier || "free";
  if (userTier === "free") {
    return c.json({ error: "Data Analysis requires a Starter plan or above.", code: "TIER_REQUIRED" }, 403);
  }

  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const prompt = (formData.get("prompt") as string) || "Analyze this data and provide insights.";

  if (!file) {
    return c.json({ error: "A file (CSV or XLSX) is required" }, 400);
  }

  const fileName = file.name.toLowerCase();
  let csvText = "";

  if (fileName.endsWith(".csv")) {
    csvText = await file.text();
  } else if (fileName.endsWith(".xlsx")) {
    // Parse XLSX (ZIP archive with XML sheets)
    try {
      const arrayBuffer = await file.arrayBuffer();
      const blob = new Blob([arrayBuffer]);
      const ds = new DecompressionStream("raw");
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
                const ds = new DecompressionStream("raw");
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
    const analysisResponse = await c.env.AI.run("@cf/openai/gpt-oss-20b" as BaseAiTextGenerationModels, {
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
    const result = await ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast" as BaseAiTextGenerationModels, {
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

  // Tier gate: Starter+ only
  const user = await c.env.DB.prepare("SELECT tier FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string }>();
  const userTier = user?.tier || "free";
  if (userTier === "free") {
    return c.json({ error: "Image understanding requires a Starter plan or above.", code: "TIER_REQUIRED" }, 403);
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

  // Tier gate
  const user = await c.env.DB.prepare("SELECT tier FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string }>();
  const userTier = user?.tier || "free";
  if (userTier === "free") {
    return c.json({ error: "Image understanding requires a Starter plan or above.", code: "TIER_REQUIRED" }, 403);
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
  const user = await c.env.DB.prepare("SELECT tier FROM users WHERE id = ?")
    .bind(userId)
    .first<{ tier: string }>();
  const userTier = user?.tier || "free";
  const isFree = userTier === "free";

  return c.json({
    userTier,
    models: [
      {
        id: "@cf/openai/gpt-oss-120b",
        name: "GPT-OSS 120B (OpenAI)",
        description: "OpenAI's open-weight model — top-tier reasoning, agentic tasks, and general purpose",
        contextWindow: 131072,
        requiredTier: "starter",
        locked: isFree,
        recommended: true,
      },
      {
        id: "@cf/meta/llama-4-scout-17b-16e-instruct",
        name: "Llama 4 Scout 17B (Meta)",
        description: "Meta's latest — 16 experts, multimodal, excellent for complex drafting and analysis",
        contextWindow: 131000,
        requiredTier: "starter",
        locked: isFree,
        recommended: true,
      },
      {
        id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        name: "Llama 3.3 70B (Meta)",
        description: "70 billion parameters — the most powerful Llama for deep reasoning and long documents",
        contextWindow: 131072,
        requiredTier: "starter",
        locked: isFree,
        recommended: false,
      },
      {
        id: "@cf/qwen/qwq-32b",
        name: "QwQ 32B (Qwen)",
        description: "Qwen reasoning model — exceptional at thinking through complex problems step-by-step",
        contextWindow: 131072,
        requiredTier: "starter",
        locked: isFree,
        recommended: false,
      },
      {
        id: "@cf/qwen/qwen3-30b-a3b-fp8",
        name: "Qwen3 30B (Qwen)",
        description: "Latest Qwen3 — advanced reasoning, multilingual, agent capabilities",
        contextWindow: 131072,
        requiredTier: "starter",
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
        requiredTier: "starter",
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
        requiredTier: "starter",
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

// ─── Affiliate Programme ────────────────────────────────────────────

app.get("/api/affiliate/dashboard", authMiddleware, async (c) => {
  const userId = c.get("userId");

  const user = await c.env.DB.prepare(
    "SELECT referral_code, affiliate_tier, total_referrals, affiliate_earnings FROM users WHERE id = ?"
  )
    .bind(userId)
    .first<{
      referral_code: string;
      affiliate_tier: string;
      total_referrals: number;
      affiliate_earnings: number;
    }>();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  // Get recent referrals
  const { results: referrals } = await c.env.DB.prepare(
    `SELECT r.created_at, r.bonus_amount, r.recurring_rate, r.status, u.full_name
     FROM referrals r
     JOIN users u ON u.id = r.referred_id
     WHERE r.referrer_id = ?
     ORDER BY r.created_at DESC
     LIMIT 20`
  )
    .bind(userId)
    .all();

  // Commission rates by tier
  const tiers = {
    starter: { name: "Starter", bonusPerSignup: 10, recurringPercent: 5, requiredReferrals: 0 },
    bronze:  { name: "Bronze",  bonusPerSignup: 15, recurringPercent: 10, requiredReferrals: 5 },
    silver:  { name: "Silver",  bonusPerSignup: 20, recurringPercent: 15, requiredReferrals: 20 },
    gold:    { name: "Gold",    bonusPerSignup: 30, recurringPercent: 20, requiredReferrals: 50 },
  };

  const currentTier = tiers[user.affiliate_tier as keyof typeof tiers] || tiers.starter;
  const nextTierKey = user.affiliate_tier === "starter" ? "bronze" :
                      user.affiliate_tier === "bronze" ? "silver" :
                      user.affiliate_tier === "silver" ? "gold" : null;
  const nextTier = nextTierKey ? tiers[nextTierKey] : null;

  return c.json({
    referralCode: user.referral_code,
    affiliateTier: user.affiliate_tier,
    totalReferrals: user.total_referrals,
    totalEarnings: user.affiliate_earnings,
    currentTier,
    nextTier,
    referralsToNextTier: nextTier ? nextTier.requiredReferrals - user.total_referrals : 0,
    recentReferrals: referrals,
  });
});

// ─── Pricing & Plans ─────────────────────────────────────────────────

app.get("/api/pricing", async (c) => {
  const plans = Object.entries(PRICING_TIERS).map(([id, tier]) => ({
    id,
    name: tier.name,
    price: tier.price,
    messagesPerDay: tier.messagesPerDay,
    features: tier.features,
    popular: id === "professional",
  }));
  return c.json({ plans });
});

app.get("/api/usage/status", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const user = await c.env.DB.prepare("SELECT tier FROM users WHERE id = ?")
    .bind(userId)
    .first<{ tier: string }>();

  const userTier = user?.tier || "free";
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
  });
});

app.post("/api/upgrade", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { tier } = await c.req.json();

  if (!PRICING_TIERS[tier] || tier === "free") {
    return c.json({ error: "Invalid plan selected" }, 400);
  }

  // In production, this would integrate with a payment gateway (Paystack, MTN MoMo, etc.)
  // For now, we update the tier directly (simulating successful payment)
  await c.env.DB.prepare("UPDATE users SET tier = ? WHERE id = ?")
    .bind(tier, userId)
    .run();

  const tierConfig = PRICING_TIERS[tier];
  return c.json({
    success: true,
    tier,
    name: tierConfig.name,
    price: tierConfig.price,
    message: `Successfully upgraded to ${tierConfig.name} plan!`,
  });
});

// ─── Admin Routes ────────────────────────────────────────────────────

// Bootstrap: self-disabling — only works when zero admins exist
app.post("/api/admin/bootstrap", async (c) => {
  const { email } = await c.req.json();
  if (!email) return c.json({ error: "Email is required" }, 400);

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

  let countQuery = "SELECT COUNT(*) as count FROM users";
  let dataQuery = "SELECT id, email, full_name, department, role, tier, affiliate_tier, total_referrals, affiliate_earnings, created_at, last_login FROM users";

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
  const validTiers = ["free", "starter", "professional", "enterprise"];
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
  const validRoles = ["civil_servant", "super_admin"];
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
  const totalReferrals = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM referrals"
  ).first<{ count: number }>();

  const totalEarnings = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(bonus_amount), 0) as total FROM referrals"
  ).first<{ total: number }>();

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
            referred.full_name as referred_name, referred.email as referred_email
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
  const stream = await c.env.AI.run(selectedModel as BaseAiTextGenerationModels, {
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
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, description, department, icon, knowledge_category FROM agents WHERE active = 1 ORDER BY name"
  ).all();
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

// ─── Artifact Detection ──────────────────────────────────────────────

app.post("/api/chat/detect-artifact", authMiddleware, async (c) => {
  const { content } = await c.req.json();

  if (!content || content.length < 20) {
    return c.json({ type: "text", title: "Chat response" });
  }

  try {
    const response = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as BaseAiTextGenerationModels, {
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
  const shareToken = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
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

  const convo = await c.env.DB.prepare(
    `SELECT c.id, c.title, c.shared_at, u.full_name as author_name, u.department as author_dept
     FROM conversations c JOIN users u ON u.id = c.user_id
     WHERE c.share_token = ?`
  ).bind(token).first();

  if (!convo) return c.json({ error: "Shared conversation not found or link expired" }, 404);

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
    const response = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as BaseAiTextGenerationModels, {
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
      suggestions = raw.split("\n").filter((l: string) => l.trim().length > 5).slice(0, 3).map((l: string) => l.replace(/^\d+[\.\)]\s*/, "").replace(/^["']|["']$/g, "").trim());
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

// ─── Audit Log (admin view) ──────────────────────────────────────────

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

const PAYSTACK_PLANS: Record<string, { amount: number; planCode: string }> = {
  starter: { amount: 3000, planCode: "starter" },       // GHS 30 in pesewas
  professional: { amount: 6000, planCode: "professional" }, // GHS 60
  enterprise: { amount: 10000, planCode: "enterprise" },   // GHS 100
};

app.post("/api/payments/initialize", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { tier } = await c.req.json();

  if (!PAYSTACK_PLANS[tier]) {
    return c.json({ error: "Invalid plan" }, 400);
  }

  const user = await c.env.DB.prepare("SELECT email, tier FROM users WHERE id = ?")
    .bind(userId).first<{ email: string; tier: string }>();

  if (!user) return c.json({ error: "User not found" }, 404);
  if (user.tier === tier) return c.json({ error: "Already on this plan" }, 400);

  const plan = PAYSTACK_PLANS[tier];
  const reference = `askozzy_${userId}_${tier}_${Date.now()}`;

  // If PAYSTACK_SECRET is configured, use real Paystack
  const paystackSecret = (c.env as any).PAYSTACK_SECRET;
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
          amount: plan.amount,
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

  // Fallback: simulate payment (dev mode)
  await c.env.DB.prepare("UPDATE users SET tier = ? WHERE id = ?").bind(tier, userId).run();
  return c.json({
    success: true,
    simulated: true,
    reference,
    message: `Plan upgraded to ${tier} (payment integration pending — Paystack secret not configured)`,
  });
});

// Paystack webhook
app.post("/api/webhooks/paystack", async (c) => {
  const paystackSecret = (c.env as any).PAYSTACK_SECRET;
  if (!paystackSecret) return c.json({ error: "Not configured" }, 500);

  // Verify webhook signature
  const signature = c.req.header("x-paystack-signature") || "";
  const body = await c.req.text();

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(paystackSecret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expectedSig = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

  if (expectedSig !== signature) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  const event = JSON.parse(body);

  if (event.event === "charge.success") {
    const { metadata, reference } = event.data;
    if (metadata?.userId && metadata?.tier) {
      await c.env.DB.prepare("UPDATE users SET tier = ? WHERE id = ?")
        .bind(metadata.tier, metadata.userId).run();
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
    const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const referralCode = `OZZY-${firstName}-${suffix}`;

    try {
      await c.env.DB.prepare(
        "INSERT INTO users (id, email, password_hash, full_name, department, tier, referral_code) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(userId, email, passwordHash, fullName, department, tier, referralCode).run();

      results.push({ email, status: "created", accessCode });
    } catch (err) {
      results.push({ email, status: "failed — " + (err as Error).message });
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
async function processDocumentEmbeddings(env: Env, docId: string, title: string, source: string, content: string) {
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
        return c.json({ error: "Failed to extract text from DOCX: " + (err as Error).message }, 400);
      }
    } else if (fileName.endsWith(".pptx")) {
      try {
        content = await extractPptxText(file);
      } catch (err) {
        return c.json({ error: "Failed to extract text from PPTX: " + (err as Error).message }, 400);
      }
    } else if (fileName.endsWith(".doc")) {
      try {
        content = await extractDocText(file);
        if (content.length < 50) {
          return c.json({ error: "Could not extract enough readable text from this .doc file. Try converting it to .docx first." }, 400);
        }
      } catch (err) {
        return c.json({ error: "Failed to extract text from DOC: " + (err as Error).message + ". Try converting to .docx." }, 400);
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
    c.executionCtx.waitUntil(processDocumentEmbeddings(c.env, docId, title, source, content));

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
    return c.json({ error: "File upload failed: " + (err as Error).message }, 500);
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
            for (const childUrl of foundLinks) {
              try {
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
        c.executionCtx.waitUntil(processDocumentEmbeddings(c.env, docId, pageTitle, docSource, content));

        await logAudit(c.env.DB, adminId, "scrape_url", "document", docId, `${pageTitle} (${url}, ${content.length} chars)`);

        results.push({ url, status: "success", docId, charCount: content.length, title: pageTitle });
      } catch (err) {
        results.push({ url, status: "failed", error: (err as Error).message });
      }
    }

    const succeeded = results.filter(r => r.status === "success").length;
    return c.json({
      results,
      summary: { total: urlList.length, succeeded, failed: urlList.length - succeeded },
    });
  } catch (err) {
    return c.json({ error: "URL scraping failed: " + (err as Error).message }, 500);
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
      const aiResult = await c.env.AI.run("@cf/openai/gpt-oss-20b" as BaseAiTextGenerationModels, {
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

      return c.json({ step: steps[stepIndex], output, completed: true });
    } catch {
      return c.json({ error: "Document generation failed" }, 500);
    }
  } else {
    // AI assistance for current step
    let aiHint = "";
    try {
      const prevContext = steps.slice(0, stepIndex).filter((s: any) => s.input).map((s: any) => `${s.name}: ${s.input}`).join("; ");
      const aiResult = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as BaseAiTextGenerationModels, {
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

  // Tier gate: Professional+
  const user = await c.env.DB.prepare("SELECT tier FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string }>();
  if ((user?.tier || "free") === "free" || (user?.tier || "free") === "starter") {
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
    const minutesResult = await c.env.AI.run("@cf/openai/gpt-oss-20b" as BaseAiTextGenerationModels, {
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
    const actionsResult = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as BaseAiTextGenerationModels, {
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

  // Tier gate: Starter+
  const user = await c.env.DB.prepare("SELECT tier FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string }>();
  if ((user?.tier || "free") === "free") {
    return c.json({ error: "Collaborative Spaces requires a Starter plan or above.", code: "TIER_REQUIRED" }, 403);
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

    const aiResult = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as BaseAiTextGenerationModels, {
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

export default app;
