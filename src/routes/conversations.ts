import { Hono } from "hono";
import type { AppType } from "../types";
import { authMiddleware, checkRateLimit } from "../lib/middleware";
import { generateId } from "../lib/utils";

const conversations = new Hono<AppType>();

// ─── List Conversations ───────────────────────────────────────────────

conversations.get("/api/conversations", authMiddleware, async (c) => {
  const userId = c.get("userId");

  const { results } = await c.env.DB.prepare(
    "SELECT id, title, template_id, model, folder_id, pinned, agent_id, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT 50"
  )
    .bind(userId)
    .all();

  return c.json({ conversations: results });
});

// ─── Create Conversation ──────────────────────────────────────────────

conversations.post("/api/conversations", authMiddleware, async (c) => {
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

// ─── Delete Conversation ──────────────────────────────────────────────

conversations.delete("/api/conversations/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const convoId = c.req.param("id");

  await c.env.DB.prepare(
    "DELETE FROM conversations WHERE id = ? AND user_id = ?"
  )
    .bind(convoId, userId)
    .run();

  return c.json({ success: true });
});

// ─── Get Conversation Messages ────────────────────────────────────────

conversations.get("/api/conversations/:id/messages", authMiddleware, async (c) => {
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

// ─── Search Conversations ─────────────────────────────────────────────

conversations.get("/api/conversations/search", authMiddleware, async (c) => {
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

// ─── Update Conversation (pin, folder, title) ─────────────────────────

conversations.patch("/api/conversations/:id", authMiddleware, async (c) => {
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

// ─── Share Conversation ───────────────────────────────────────────────

conversations.post("/api/conversations/:id/share", authMiddleware, async (c) => {
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

// ─── Unshare Conversation ─────────────────────────────────────────────

conversations.delete("/api/conversations/:id/share", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const convoId = c.req.param("id");

  await c.env.DB.prepare(
    "UPDATE conversations SET share_token = NULL, shared_at = NULL WHERE id = ? AND user_id = ?"
  ).bind(convoId, userId).run();

  return c.json({ success: true });
});

// ─── View Shared Conversation ─────────────────────────────────────────

conversations.get("/api/shared/:token", async (c) => {
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

export default conversations;
