import { Hono } from "hono";
import { cors } from "hono/cors";

type Env = {
  AI: Ai;
  DB: D1Database;
  SESSIONS: KVNamespace;
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

// ─── Auth Routes ────────────────────────────────────────────────────

app.post("/api/auth/register", async (c) => {
  const { email, password, fullName, department, referralCode } = await c.req.json();

  if (!email || !password || !fullName) {
    return c.json({ error: "Email, password, and full name are required" }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
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
  const passwordHash = await hashPassword(password);

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
    user: { id: userId, email: email.toLowerCase().trim(), fullName, department, tier: "free", referralCode: userReferralCode },
  });
});

app.post("/api/auth/login", async (c) => {
  const { email, password } = await c.req.json();

  if (!email || !password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  const user = await c.env.DB.prepare(
    "SELECT id, email, password_hash, full_name, department, tier, referral_code, affiliate_tier, total_referrals, affiliate_earnings FROM users WHERE email = ?"
  )
    .bind(email.toLowerCase().trim())
    .first<{
      id: string;
      email: string;
      password_hash: string;
      full_name: string;
      department: string;
      tier: string;
      referral_code: string;
      affiliate_tier: string;
      total_referrals: number;
      affiliate_earnings: number;
    }>();

  if (!user) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const passwordHash = await hashPassword(password);
  if (passwordHash !== user.password_hash) {
    return c.json({ error: "Invalid email or password" }, 401);
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
    "SELECT id, title, template_id, model, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50"
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

// ─── Chat (Streaming) ──────────────────────────────────────────────

app.post("/api/chat", authMiddleware, async (c) => {
  const userId = c.get("userId");
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

  // Get conversation history (last 20 messages for context)
  const { results: history } = await c.env.DB.prepare(
    "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20"
  )
    .bind(conversationId)
    .all<{ role: string; content: string }>();

  const messages: Array<{ role: string; content: string }> = [];

  // System prompt
  const defaultSystem = `You are Ozzy, the AI assistant powering AskOzzy — a private productivity platform built exclusively for Government of Ghana (GoG) operations. You provide precise, professional, and actionable assistance.

Key guidelines:
- Use formal British English (Ghana's official standard)
- Reference Ghana's public service regulations, protocols, and conventions where relevant
- Structure responses clearly with headings, bullet points, and numbered steps
- For document drafting, follow GoG formatting standards
- Be thorough but concise — civil servants value efficiency
- When drafting documents, provide complete, ready-to-use outputs
- Maintain strict confidentiality — never reference or store other users' data
- Sign off naturally as Ozzy when appropriate`;

  messages.push({ role: "system", content: systemPrompt || defaultSystem });

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
                if (data.response) {
                  fullResponse += data.response;
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

          if (msgCount && msgCount.count <= 2) {
            // Auto-generate title from first message
            const title =
              message.length > 60
                ? message.substring(0, 57) + "..."
                : message;
            await c.env.DB.prepare(
              "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?"
            )
              .bind(title, conversationId)
              .run();
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

export default app;
