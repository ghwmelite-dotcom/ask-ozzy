import { Hono } from "hono";
import type { Env, AppType } from "../types";
import { adminMiddleware } from "../lib/middleware";
import { generateId } from "../lib/utils";
import { log } from "../lib/logger";
import { GOG_SYSTEM_PROMPT, searchKnowledge, buildAugmentedPrompt } from "../index";

const messaging = new Hono<AppType>();

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
    const today = new Date().toISOString().split("T")[0];
    const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date().getDay()];
    const result = await ai.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as any,
      {
        messages: [
          {
            role: "system",
            content:
              `You are AskOzzy USSD assistant for Ghana government workers. Today is ${dayName}, ${today}. Give extremely brief answers (under 150 characters). No markdown, no bullet points, no asterisks, plain text only. Be direct and concise. For date/day-of-week questions, calculate carefully.`,
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 100,
      }
    );
    return (result as any)?.response || "Sorry, I could not process that request.";
  } catch (err) {
    log("error", "USSD AI error", { error: String(err) });
    return "Service temporarily unavailable. Please try again.";
  }
}

async function getUSSDMemoResponse(ai: Ai, topic: string): Promise<string> {
  try {
    const today = new Date().toISOString().split("T")[0];
    const result = await ai.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as any,
      {
        messages: [
          {
            role: "system",
            content:
              `You are AskOzzy USSD assistant. Today is ${today}. Generate a very brief memo outline for Ghana government workers. Keep it under 150 characters. No markdown, plain text only. Format: TO/FROM/RE/Body in one line each.`,
          },
          { role: "user", content: `Draft a brief memo about: ${topic}` },
        ],
        max_tokens: 120,
      }
    );
    return (result as any)?.response || "Could not generate memo. Please try again.";
  } catch (err) {
    log("error", "USSD memo AI error", { error: String(err) });
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

messaging.post("/api/ussd/callback", async (c) => {
  // Africa's Talking USSD callbacks don't include a webhook secret header,
  // so we validate by checking the serviceCode matches our configured code
  // and that required AT fields (sessionId, phoneNumber, serviceCode) are present.
  // For additional security, the USSD config enable/disable check below acts as a gate.

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

    if (!sessionId || !phoneNumber || !serviceCode) {
      return new Response("END Invalid request", {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Validate the service code matches our configured USSD code
    const ussdCfg = await c.env.SESSIONS.get("ussd_config");
    if (ussdCfg) {
      try {
        const cfg = JSON.parse(ussdCfg);
        if (cfg.service_code && serviceCode !== cfg.service_code) {
          return new Response("END Service unavailable", {
            headers: { "Content-Type": "text/plain" },
          });
        }
      } catch { /* proceed if config parse fails */ }
    }

    // Validate phone number format (Ghana: +233XXXXXXXXX or 0XXXXXXXXX)
    if (phoneNumber && !/^\+?[0-9]{10,15}$/.test(phoneNumber.replace(/\s/g, ""))) {
      return new Response("END Invalid phone number", {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Sanitize text input (strip control characters)
    text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

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
    log("error", "USSD callback error", { error: String(err) });
    return new Response("END An error occurred. Please try again later.", {
      headers: { "Content-Type": "text/plain" },
    });
  }
});

// ─── USSD Admin Stats ───────────────────────────────────────────

messaging.get("/api/admin/ussd/stats", adminMiddleware, async (c) => {
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
    log("error", "USSD stats error", { error: String(err) });
    return c.json({ error: "Failed to load USSD stats" }, 500);
  }
});

// ─── USSD Admin Config ──────────────────────────────────────────

messaging.get("/api/admin/ussd/config", adminMiddleware, async (c) => {
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

messaging.put("/api/admin/ussd/config", adminMiddleware, async (c) => {
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

messaging.post("/api/admin/ussd/test", adminMiddleware, async (c) => {
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
    log("error", "USSD test error", { error: String(err) });
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
    log("error", "Messaging AI error", { error: String(err) });
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

// ─── Helper: Send SMS via Africa's Talking HTTP API ──────────────

interface ATSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  statusCode?: number;
}

async function sendSMSviaAT(
  to: string,
  message: string,
  credentials: { api_key: string; api_username: string; sender_id?: string }
): Promise<ATSendResult> {
  const { api_key, api_username, sender_id } = credentials;
  if (!api_key || !api_username) {
    return { success: false, error: "Missing AT credentials (api_key or api_username)" };
  }

  const isSandbox = api_username.toLowerCase() === "sandbox";
  const url = isSandbox
    ? "https://api.sandbox.africastalking.com/version1/messaging"
    : "https://api.africastalking.com/version1/messaging";

  const params = new URLSearchParams({
    username: api_username,
    to,
    message,
  });
  // Sandbox ignores sender_id; only include it in production
  if (!isSandbox && sender_id) {
    params.set("from", sender_id);
  }

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "apiKey": api_key,
      },
      body: params.toString(),
    });

    const data = await resp.json() as {
      SMSMessageData?: {
        Message?: string;
        Recipients?: Array<{
          statusCode: number;
          status: string;
          messageId: string;
          number: string;
        }>;
      };
    };

    const recipient = data.SMSMessageData?.Recipients?.[0];
    if (recipient && (recipient.statusCode === 101 || recipient.statusCode === 100)) {
      return { success: true, messageId: recipient.messageId, statusCode: recipient.statusCode };
    }

    return {
      success: false,
      error: recipient?.status || data.SMSMessageData?.Message || `HTTP ${resp.status}`,
      statusCode: recipient?.statusCode,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Fetch failed: ${errMsg}` };
  }
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

messaging.post("/api/whatsapp/webhook", async (c) => {
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

messaging.post("/api/sms/webhook", async (c) => {
  // Africa's Talking SMS callbacks don't include a webhook secret/signature header,
  // so we skip validateWebhookSecret(). Security is provided by the AT API key check
  // when sending replies and the sms_enabled gate below.

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

  // ── Send SMS reply via Africa's Talking ──
  let atCredentials: { api_key: string; api_username: string; sender_id?: string } | null = null;
  try {
    const cfgStr = await c.env.SESSIONS.get("messaging_config");
    if (cfgStr) {
      const cfg = JSON.parse(cfgStr);
      if (cfg.api_key && cfg.api_username) {
        atCredentials = { api_key: cfg.api_key, api_username: cfg.api_username, sender_id: cfg.sender_id };
      }
    }
  } catch {}

  const sendResults: ATSendResult[] = [];
  if (atCredentials) {
    // Send parts sequentially to preserve message ordering
    for (const part of smsParts) {
      const result = await sendSMSviaAT(phoneNumber, part, atCredentials);
      sendResults.push(result);
      if (result.success) {
        console.log(`[SMS] Sent to ${phoneNumber}: messageId=${result.messageId}`);
      } else {
        log('error', 'SMS send failed', { phoneNumber, error: result.error });
      }
    }
  } else {
    console.warn(`[SMS] No AT credentials configured — reply not sent to ${phoneNumber}`);
  }

  // Store outbound messages in DB regardless of send result
  await c.env.DB.prepare(
    "INSERT INTO whatsapp_messages (id, session_id, direction, content, channel) VALUES (?, ?, 'outbound', ?, 'sms')"
  ).bind(generateId(), session.id, smsParts.join(" | ")).run();

  await c.env.DB.prepare(
    "UPDATE whatsapp_sessions SET last_message = ?, last_response = ?, message_count = message_count + 1, updated_at = datetime('now') WHERE id = ?"
  ).bind(messageText, smsParts[0], session.id).run();

  return c.json({
    messages: smsParts.map((part, i) => ({
      to: phoneNumber,
      message: part,
      sent: sendResults[i]?.success ?? false,
      messageId: sendResults[i]?.messageId,
    })),
  });
});

// ─── Admin: Messaging Config ─────────────────────────────────────

messaging.get("/api/admin/messaging/config", adminMiddleware, async (c) => {
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
    // Mask sensitive fields before returning
    const maskSecret = (s: string) => s ? ("*".repeat(Math.max(0, s.length - 4)) + s.slice(-4)) : "";
    const safeConfig = {
      ...config,
      webhook_secret: maskSecret(config.webhook_secret || ""),
      api_key: maskSecret(config.api_key || ""),
    };
    const url = new URL(c.req.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    return c.json({
      config: safeConfig,
      webhook_urls: {
        whatsapp: `${baseUrl}/api/whatsapp/webhook`,
        sms: `${baseUrl}/api/sms/webhook`,
      },
    });
  } catch (err) {
    return c.json({ error: "Failed to load messaging config" }, 500);
  }
});

messaging.put("/api/admin/messaging/config", adminMiddleware, async (c) => {
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

messaging.get("/api/admin/messaging/stats", adminMiddleware, async (c) => {
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
    log("error", "Messaging stats error", { error: String(err) });
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

messaging.post("/api/admin/messaging/test", adminMiddleware, async (c) => {
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
    log("error", "Messaging test error", { error: String(err) });
    return c.json({ error: "Messaging test failed. Check server logs for details." }, 500);
  }
});

// ─── Admin: Get session messages ─────────────────────────────────

messaging.get("/api/admin/messaging/sessions/:sessionId/messages", adminMiddleware, async (c) => {
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

export default messaging;
