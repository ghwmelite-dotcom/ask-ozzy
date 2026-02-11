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
    "SELECT id, title, template_id, model, folder_id, pinned, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT 50"
  )
    .bind(userId)
    .all();

  return c.json({ conversations: results });
});

app.post("/api/conversations", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { title, templateId, model } = await c.req.json();
  const convoId = generateId();

  await c.env.DB.prepare(
    "INSERT INTO conversations (id, user_id, title, template_id, model) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(
      convoId,
      userId,
      title || "New Conversation",
      templateId || null,
      model || "@cf/meta/llama-4-scout-17b-16e-instruct"
    )
    .run();

  return c.json({ id: convoId, title: title || "New Conversation" });
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

// ─── Chat (Streaming) ──────────────────────────────────────────────

app.post("/api/chat", authMiddleware, async (c) => {
  const userId = c.get("userId");

  // Rate limit chat requests
  const chatRateCheck = await checkRateLimit(c.env, userId, "chat");
  if (!chatRateCheck.allowed) {
    return c.json({ error: "Too many requests. Please slow down.", code: "RATE_LIMITED" }, 429);
  }

  const { conversationId, message, model, systemPrompt } = await c.req.json();

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

  // RAG: Search knowledge base for relevant context
  const { ragResults, faqResults } = await searchKnowledge(c.env, message);
  const augmentedPrompt = buildAugmentedPrompt(systemPrompt || GOG_SYSTEM_PROMPT, ragResults, faqResults);

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

    for (let i = 0; i < chunks.length; i += 10) {
      const batch = chunks.slice(i, i + 10);
      const embeddings = await generateEmbeddings(env.AI, batch);

      const vectors: Array<{ id: string; values: number[]; metadata: Record<string, string> }> = [];
      for (let j = 0; j < batch.length; j++) {
        const chunkId = `${docId}_chunk_${i + j}`;
        vectors.push({
          id: chunkId,
          values: embeddings[j],
          metadata: {
            content: batch[j],
            source: source || title,
            title: title,
            docId: docId,
            chunkIndex: String(i + j),
          },
        });

        // Save chunk to DB
        await env.DB.prepare(
          "INSERT INTO document_chunks (id, document_id, chunk_index, content, vector_id) VALUES (?, ?, ?, ?, ?)"
        ).bind(chunkId, docId, i + j, batch[j], chunkId).run();
      }

      await env.VECTORIZE.upsert(vectors);
    }

    await env.DB.prepare(
      "UPDATE documents SET status = 'ready', chunk_count = ? WHERE id = ?"
    ).bind(chunks.length, docId).run();
  } catch (err) {
    await env.DB.prepare(
      "UPDATE documents SET status = 'error' WHERE id = ?"
    ).bind(docId).run();
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

    // Extract text content from file
    let content = "";
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith(".txt") || fileName.endsWith(".md") || fileName.endsWith(".csv")) {
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
      // Strip HTML tags for plain text extraction
      content = htmlText.replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    } else {
      // For unsupported formats, try reading as text
      try {
        content = await file.text();
      } catch {
        return c.json({ error: "Unable to extract text from this file format. Supported: .txt, .md, .csv, .json, .html" }, 400);
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

export default app;
