import { Hono } from "hono";
import type { AppType } from "../types";
import { authMiddleware } from "../lib/middleware";
import { generateId } from "../lib/utils";
import { mintJWT } from "../lib/jwt";
import { log } from "../lib/logger";

const eclassroom = new Hono<AppType>();

// ═══════════════════════════════════════════════════════════════════════
// Tier helpers (same pattern as features.ts)
// ═══════════════════════════════════════════════════════════════════════

const TIER_RANK: Record<string, number> = { free: 0, professional: 1, enterprise: 2 };

function getEffectiveTier(user: {
  tier: string;
  subscription_expires_at: string | null;
  trial_expires_at: string | null;
  org_sponsored_tier?: string | null;
}): string {
  const now = new Date();
  if (user.trial_expires_at && new Date(user.trial_expires_at + "Z") > now) {
    return "professional";
  }
  let base = user.tier || "free";
  if (user.subscription_expires_at && new Date(user.subscription_expires_at + "Z") < now) {
    base = "free";
  }
  if (user.org_sponsored_tier) {
    const orgRank = TIER_RANK[user.org_sponsored_tier] || 0;
    const baseRank = TIER_RANK[base] || 0;
    return orgRank > baseRank ? user.org_sponsored_tier : base;
  }
  return base;
}

// Free tier: 3 classroom sessions per calendar month
const FREE_MONTHLY_LIMIT = 3;

// ═══════════════════════════════════════════════════════════════════════
// POST /api/ai-proxy/chat/completions
// OpenAI-compatible proxy → Workers AI
// Called by eClassroom (OpenMAIC) running on VPS
// ═══════════════════════════════════════════════════════════════════════

const MODEL_MAP: Record<string, string> = {
  "gpt-4":            "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "gpt-4o":           "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "gpt-4-turbo":      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "gpt-3.5-turbo":    "@cf/meta/llama-3.1-8b-instruct",
  "gpt-3.5":          "@cf/meta/llama-3.1-8b-instruct",
};

const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

eclassroom.post("/api/ai-proxy/chat/completions", async (c) => {
  // EXCEPTION to CLAUDE.md rules #1 and #2:
  // This is a proxy endpoint — eClassroom (OpenMAIC) controls its own prompts
  // and temperature. We intentionally bypass the grounding pipeline and accept
  // caller-provided temperature because this serves an external application.

  // Validate API key
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing authorization" }, 401);
  }
  const apiKey = authHeader.slice(7);
  if (apiKey !== c.env.ECLASSROOM_API_KEY) {
    return c.json({ error: "Invalid API key" }, 403);
  }

  try {
    const body = await c.req.json();
    const requestedModel = body.model || "gpt-4";
    const messages = body.messages || [];
    const temperature = body.temperature ?? 0.3;
    const maxTokens = body.max_tokens ?? 2048;
    const stream = body.stream ?? false;

    const workersModel = MODEL_MAP[requestedModel] || DEFAULT_MODEL;

    if (stream) {
      // SSE streaming response
      const aiStream = await c.env.AI.run(workersModel as any, {
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      });

      return new Response(aiStream as ReadableStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // Non-streaming response
    const result: any = await c.env.AI.run(workersModel as any, {
      messages,
      temperature,
      max_tokens: maxTokens,
    });

    const responseText = typeof result === "string"
      ? result
      : result?.response || result?.result || JSON.stringify(result);

    // Return in OpenAI chat completion format
    return c.json({
      id: `chatcmpl-${generateId()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: responseText,
        },
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    });
  } catch (err: any) {
    log("error", "AI proxy error", { error: err?.message });
    return c.json({ error: "AI proxy request failed" }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/eclassroom/token
// Mints a short-lived JWT for authenticated users to access eClassroom
// ═══════════════════════════════════════════════════════════════════════

eclassroom.get("/api/eclassroom/token", authMiddleware, async (c) => {
  const userId = c.get("userId");

  try {
    // Fetch user details for JWT claims
    const user: any = await c.env.DB.prepare(
      "SELECT id, email, display_name, tier, user_type, subscription_expires_at, trial_expires_at, org_sponsored_tier FROM users WHERE id = ?"
    ).bind(userId).first();

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const effectiveTier = getEffectiveTier(user);

    // Check free-tier session limit
    if (effectiveTier === "free") {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthStartStr = monthStart.toISOString().replace("T", " ").split(".")[0];

      const countResult: any = await c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM classroom_sessions WHERE user_id = ? AND created_at >= ?"
      ).bind(userId, monthStartStr).first();

      const sessionsUsed = countResult?.count || 0;
      if (sessionsUsed >= FREE_MONTHLY_LIMIT) {
        return c.json({
          error: "Monthly classroom limit reached",
          limit: FREE_MONTHLY_LIMIT,
          used: sessionsUsed,
          upgrade: true,
        }, 429);
      }
    }

    // Mint short-lived JWT (1 hour)
    const payload = {
      sub: user.id,
      email: user.email || "",
      name: user.display_name || "",
      tier: effectiveTier,
      role: user.user_type || "gog_employee",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    };

    const token = await mintJWT(payload, c.env.JWT_SECRET);

    return c.json({ token, tier: effectiveTier });
  } catch (err: any) {
    log("error", "eClassroom token error", { error: err?.message, userId });
    return c.json({ error: "Failed to generate classroom token" }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/eclassroom/classrooms
// List prebuilt classrooms (filterable by subject, audience)
// Intentionally public — lets unauthenticated users browse before signing up
// ═══════════════════════════════════════════════════════════════════════

eclassroom.get("/api/eclassroom/classrooms", async (c) => {
  const subject = c.req.query("subject") || "";
  const audience = c.req.query("audience") || "";

  try {
    let sql = "SELECT * FROM prebuilt_classrooms WHERE is_active = 1";
    const binds: string[] = [];

    if (subject) {
      sql += " AND subject = ?";
      binds.push(subject);
    }
    if (audience) {
      sql += " AND target_audience = ?";
      binds.push(audience);
    }

    sql += " ORDER BY sort_order ASC, created_at DESC";

    const stmt = binds.length > 0
      ? c.env.DB.prepare(sql).bind(...binds)
      : c.env.DB.prepare(sql);

    const { results } = await stmt.all();

    return c.json({ classrooms: results || [] });
  } catch (err: any) {
    log("error", "Classroom list error", { error: err?.message });
    return c.json({ classrooms: [] });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/eclassroom/sessions
// Track when a user launches a classroom (for free-tier counting)
// ═══════════════════════════════════════════════════════════════════════

eclassroom.post("/api/eclassroom/sessions", authMiddleware, async (c) => {
  const userId = c.get("userId");

  try {
    const { classroomId, classroomTitle } = await c.req.json();

    if (!classroomId) {
      return c.json({ error: "classroomId required" }, 400);
    }

    const sessionId = generateId();
    await c.env.DB.prepare(
      "INSERT INTO classroom_sessions (id, user_id, classroom_id, classroom_title) VALUES (?, ?, ?, ?)"
    ).bind(sessionId, userId, classroomId, classroomTitle || "").run();

    // Return updated count for this month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartStr = monthStart.toISOString().replace("T", " ").split(".")[0];

    const countResult: any = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM classroom_sessions WHERE user_id = ? AND created_at >= ?"
    ).bind(userId, monthStartStr).first();

    return c.json({
      sessionId,
      sessionsUsed: countResult?.count || 0,
      limit: FREE_MONTHLY_LIMIT,
    });
  } catch (err: any) {
    log("error", "Session tracking error", { error: err?.message, userId });
    return c.json({ error: "Failed to track session" }, 500);
  }
});

export default eclassroom;
