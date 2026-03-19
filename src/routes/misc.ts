import { Hono } from "hono";
import type { Env, AppType } from "../types";
import { authMiddleware } from "../lib/middleware";
import { generateId } from "../lib/utils";
import { log } from "../lib/logger";
import { handleFeedback, type FeedbackPayload } from "../lib/feedback";
import {
  buildContextBlock,
  type RetrievedContext,
  GROUNDING_RULES,
  UNCERTAINTY_PROTOCOL,
  PROHIBITED_BEHAVIORS,
} from "../config/agent-prompts";
import { hybridRetrieve } from "../lib/hybrid-retriever";

function escapeLike(s: string): string { return s.replace(/[%_\\]/g, '\\$&'); }

const misc = new Hono<AppType>();

// ─── Duplicated Helpers ──────────────────────────────────────────────

async function ensureAgentUserTypeColumn(db: D1Database) {
  try {
    await db.prepare("SELECT user_type FROM agents LIMIT 1").first();
  } catch {
    await db.prepare("ALTER TABLE agents ADD COLUMN user_type TEXT DEFAULT 'all'").run();
  }
}

const FREE_TIER_MODELS = [
  "@cf/openai/gpt-oss-20b",
  "@cf/google/gemma-3-12b-it",
  "@cf/meta/llama-3.1-8b-instruct-fast",
];

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

async function generateEmbeddings(ai: Ai, texts: string[]): Promise<number[][]> {
  const response = await ai.run('@cf/baai/bge-base-en-v1.5', { text: texts });
  return (response as any).data as number[][];
}

async function searchKnowledge(env: Env, query: string, topK = 5, agentType?: string): Promise<{
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

function buildAugmentedPrompt(
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

// ─── Message Rating ───────────────────────────────────────────────────

misc.post("/api/messages/:id/rate", authMiddleware, async (c) => {
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

// ─── Response Feedback (Anti-Hallucination Pipeline) ─────────────────

misc.post("/api/feedback", authMiddleware, async (c) => {
  try {
    const body = await c.req.json() as FeedbackPayload;

    if (!body.request_id || !body.rating || !body.agent_type || !body.query || !body.response_text) {
      return c.json({ error: "Missing required fields: request_id, rating, agent_type, query, response_text" }, 400);
    }

    if (body.rating !== 1 && body.rating !== -1) {
      return c.json({ error: "Rating must be 1 or -1" }, 400);
    }

    await handleFeedback(body, c.env);
    return c.json({ success: true });
  } catch (e: any) {
    log("error", "Feedback submission failed", { error: e?.message });
    return c.json({ error: "Failed to submit feedback" }, 500);
  }
});

// ─── Regenerate Response ──────────────────────────────────────────────

misc.post("/api/messages/:id/regenerate", authMiddleware, async (c) => {
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

// ─── Custom Agents (public) ──────────────────────────────────────────

misc.get("/api/agents", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureAgentUserTypeColumn(c.env.DB);

  // Look up user's tier and user_type
  const user = await c.env.DB.prepare("SELECT tier, user_type FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string; user_type: string }>();
  const tier = user?.tier || "free";
  const userType = user?.user_type || "gog_employee";
  const isPaid = tier !== "free";

  // Employees see all agents; students see only student + all
  let query: string;
  const params: any[] = [];

  if (userType === "student") {
    if (isPaid) {
      query = "SELECT id, name, description, department, icon, knowledge_category, user_type, requires_paid FROM agents WHERE active = 1 AND (user_type = 'student' OR user_type = 'all') ORDER BY name";
    } else {
      query = "SELECT id, name, description, department, icon, knowledge_category, user_type, requires_paid FROM agents WHERE active = 1 AND (user_type = 'student' OR user_type = 'all') AND requires_paid = 0 ORDER BY name";
    }
  } else {
    // gog_employee sees gog_employee + all agents (not student-only)
    if (isPaid) {
      query = "SELECT id, name, description, department, icon, knowledge_category, user_type, requires_paid FROM agents WHERE active = 1 AND (user_type = 'gog_employee' OR user_type = 'all') ORDER BY name";
    } else {
      query = "SELECT id, name, description, department, icon, knowledge_category, user_type, requires_paid FROM agents WHERE active = 1 AND (user_type = 'gog_employee' OR user_type = 'all') AND requires_paid = 0 ORDER BY name";
    }
  }

  const { results } = await c.env.DB.prepare(query).all();
  return c.json({ agents: results || [] });
});

misc.get("/api/agents/:id", async (c) => {
  const agentId = c.req.param("id");
  const agent = await c.env.DB.prepare(
    "SELECT id, name, description, department, icon, knowledge_category FROM agents WHERE id = ? AND active = 1"
  ).bind(agentId).first();

  if (!agent) {
    return c.json({ error: "Agent not found" }, 404);
  }

  return c.json({ agent });
});

// ─── Folders (CRUD) ───────────────────────────────────────────────────

misc.get("/api/folders", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, color, sort_order FROM folders WHERE user_id = ? ORDER BY sort_order ASC, name ASC"
  ).bind(userId).all();
  return c.json({ folders: results || [] });
});

misc.post("/api/folders", authMiddleware, async (c) => {
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

misc.patch("/api/folders/:id", authMiddleware, async (c) => {
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

misc.delete("/api/folders/:id", authMiddleware, async (c) => {
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

// ─── Announcements (user-facing) ──────────────────────────────────────

misc.get("/api/announcements", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, content, type, dismissible, created_at
     FROM announcements
     WHERE active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))
     ORDER BY created_at DESC LIMIT 5`
  ).all();
  return c.json({ announcements: results || [] });
});

// ─── Organization / Team Billing ──────────────────────────────────────

misc.post("/api/organizations", authMiddleware, async (c) => {
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

misc.get("/api/organizations/mine", authMiddleware, async (c) => {
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

misc.post("/api/organizations/:id/invite", authMiddleware, async (c) => {
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

misc.post("/api/organizations/:id/remove", authMiddleware, async (c) => {
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

export default misc;
