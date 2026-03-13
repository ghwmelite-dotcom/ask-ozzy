import { Hono } from "hono";
import type { Env, AppType } from "../types";
import { adminMiddleware, deptAdminMiddleware } from "../lib/middleware";
import { generateId, generateAccessCode, hashPassword, generateRecoveryCode, generateReferralSuffix } from "../lib/utils";
import { log } from "../lib/logger";
import { uploadDocumentToR2, listR2Documents, deleteR2Document } from "../lib/autorag-retriever";

const adminContent = new Hono<AppType>();

// ─── Duplicated Helpers ─────────────────────────────────────────────

async function logAudit(db: D1Database, adminId: string, action: string, targetType: string, targetId?: string, details?: string) {
  await db.prepare(
    "INSERT INTO audit_log (id, admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(generateId(), adminId, action, targetType, targetId || null, details || null).run();
}

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
    messagesPerDay: -1, // unlimited
    models: "all",
    features: ["Unlimited messages", "All 14 AI models", "Fastest priority", "Unlimited history", "Custom templates", "Dedicated support"],
  },
};

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

// ─── File extraction helpers ────────────────────────────────────────

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

// ═══════════════════════════════════════════════════════════════════════
//  ADMIN CONTENT ROUTES
// ═══════════════════════════════════════════════════════════════════════

// ─── Announcements (admin) ────────────────────────────────────────────

adminContent.get("/api/admin/announcements", adminMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, u.full_name as admin_name
     FROM announcements a JOIN users u ON u.id = a.admin_id
     ORDER BY a.created_at DESC LIMIT 50`
  ).all();
  return c.json({ announcements: results || [] });
});

adminContent.post("/api/admin/announcements", adminMiddleware, async (c) => {
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

adminContent.patch("/api/admin/announcements/:id", adminMiddleware, async (c) => {
  const announcementId = c.req.param("id");
  const { active } = await c.req.json();
  await c.env.DB.prepare("UPDATE announcements SET active = ? WHERE id = ?")
    .bind(active ? 1 : 0, announcementId).run();

  await logAudit(c.env.DB, c.get("userId"), active ? "activate_announcement" : "deactivate_announcement", "announcement", announcementId);
  return c.json({ success: true });
});

adminContent.delete("/api/admin/announcements/:id", adminMiddleware, async (c) => {
  const announcementId = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM announcements WHERE id = ?").bind(announcementId).run();
  await logAudit(c.env.DB, c.get("userId"), "delete_announcement", "announcement", announcementId);
  return c.json({ success: true });
});

// ─── CSV Export (admin) ───────────────────────────────────────────────

adminContent.get("/api/admin/export/users", adminMiddleware, async (c) => {
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

adminContent.get("/api/admin/export/analytics", adminMiddleware, async (c) => {
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

adminContent.get("/api/admin/audit-log", adminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
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

adminContent.get("/api/admin/audit", adminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
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

adminContent.get("/api/admin/audit/export", adminMiddleware, async (c) => {
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

adminContent.get("/api/admin/audit/stats", adminMiddleware, async (c) => {
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

adminContent.get("/api/admin/moderation", adminMiddleware, async (c) => {
  const status = c.req.query("status") || "pending";
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
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

adminContent.patch("/api/admin/moderation/:id", adminMiddleware, async (c) => {
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

// ─── Moderation Stats ─────────────────────────────────────────────────

adminContent.get("/api/admin/moderation/stats", adminMiddleware, async (c) => {
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

adminContent.get("/api/admin/rate-limits", adminMiddleware, async (c) => {
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

adminContent.get("/api/admin/organizations", adminMiddleware, async (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "25")));
  const search = c.req.query("search") || "";
  const offset = (page - 1) * limit;

  let query = `SELECT o.*, op.plan, op.seats_purchased, op.price_per_seat, op.billing_cycle, op.billing_expires_at,
    (SELECT full_name FROM users WHERE id = o.owner_id) as owner_name,
    (SELECT email FROM users WHERE id = o.owner_id) as owner_email
    FROM organizations o LEFT JOIN org_pricing op ON o.id = op.org_id`;
  const params: any[] = [];

  if (search) {
    query += " WHERE o.name LIKE ? OR o.slug LIKE ?";
    params.push(`%${search}%`, `%${search}%`);
  }
  query += " ORDER BY o.created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const { results } = await c.env.DB.prepare(query).bind(...params).all();

  let countQuery = "SELECT COUNT(*) as count FROM organizations";
  const countParams: any[] = [];
  if (search) {
    countQuery += " WHERE name LIKE ? OR slug LIKE ?";
    countParams.push(`%${search}%`, `%${search}%`);
  }
  const total = countParams.length > 0
    ? await c.env.DB.prepare(countQuery).bind(...countParams).first<{ count: number }>()
    : await c.env.DB.prepare(countQuery).first<{ count: number }>();

  return c.json({ organizations: results, total: total?.count || 0, page, limit });
});

adminContent.post("/api/admin/organizations", adminMiddleware, async (c) => {
  const { name, slug, ownerEmail, tier, maxSeats, sector, domain, plan } = await c.req.json();
  if (!name || !slug || !ownerEmail) return c.json({ error: "Name, slug, and owner email required" }, 400);

  const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  if (!slugRegex.test(slug)) return c.json({ error: "Slug must be lowercase letters, numbers, and hyphens" }, 400);

  const existingSlug = await c.env.DB.prepare("SELECT id FROM organizations WHERE slug = ?").bind(slug).first();
  if (existingSlug) return c.json({ error: "Organisation slug already taken" }, 409);

  const owner = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(ownerEmail.toLowerCase()).first<{ id: string }>();
  if (!owner) return c.json({ error: "Owner email not found" }, 404);

  const orgId = generateId();
  const seatCount = Math.max(1, Math.min(1000, parseInt(maxSeats) || 10));
  const selectedPlan = plan || "starter";
  const effectivePrice = getEffectiveOrgSeatPrice(selectedPlan, seatCount);

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO organizations (id, name, slug, owner_id, tier, max_seats, used_seats, sector, domain) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)"
    ).bind(orgId, name, slug, owner.id, tier || "professional", seatCount, sector || null, domain || null),
    c.env.DB.prepare("UPDATE users SET org_id = ?, org_role = 'org_admin' WHERE id = ?").bind(orgId, owner.id),
    c.env.DB.prepare(
      "INSERT INTO org_pricing (id, org_id, plan, seats_purchased, price_per_seat) VALUES (?, ?, ?, ?, ?)"
    ).bind(generateId(), orgId, selectedPlan, seatCount, effectivePrice),
  ]);

  return c.json({ success: true, orgId });
});

adminContent.patch("/api/admin/organizations/:id", adminMiddleware, async (c) => {
  const orgId = c.req.param("id");
  const { name, tier, maxSeats, sector, domain, plan } = await c.req.json();

  const org = await c.env.DB.prepare("SELECT id FROM organizations WHERE id = ?").bind(orgId).first();
  if (!org) return c.json({ error: "Organisation not found" }, 404);

  await c.env.DB.prepare(
    "UPDATE organizations SET name = COALESCE(?, name), tier = COALESCE(?, tier), max_seats = COALESCE(?, max_seats), sector = COALESCE(?, sector), domain = COALESCE(?, domain) WHERE id = ?"
  ).bind(name || null, tier || null, maxSeats || null, sector || null, domain || null, orgId).run();

  if (plan || maxSeats) {
    const seats = maxSeats || 10;
    const effectivePrice = getEffectiveOrgSeatPrice(plan || "starter", seats);
    await c.env.DB.prepare(
      "UPDATE org_pricing SET plan = COALESCE(?, plan), seats_purchased = COALESCE(?, seats_purchased), price_per_seat = ? WHERE org_id = ?"
    ).bind(plan || null, maxSeats || null, effectivePrice, orgId).run();
  }

  return c.json({ success: true });
});

adminContent.delete("/api/admin/organizations/:id", adminMiddleware, async (c) => {
  const orgId = c.req.param("id");

  const org = await c.env.DB.prepare("SELECT id FROM organizations WHERE id = ?").bind(orgId).first();
  if (!org) return c.json({ error: "Organisation not found" }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET org_id = NULL, org_role = NULL WHERE org_id = ?").bind(orgId),
    c.env.DB.prepare("DELETE FROM org_invites WHERE org_id = ?").bind(orgId),
    c.env.DB.prepare("DELETE FROM org_pricing WHERE org_id = ?").bind(orgId),
    c.env.DB.prepare("DELETE FROM organizations WHERE id = ?").bind(orgId),
  ]);

  return c.json({ success: true });
});

adminContent.get("/api/admin/organizations/:id/users", adminMiddleware, async (c) => {
  const orgId = c.req.param("id");
  const { results } = await c.env.DB.prepare(
    "SELECT id, email, full_name, department, tier, org_role, last_login, created_at FROM users WHERE org_id = ? ORDER BY created_at"
  ).bind(orgId).all();
  return c.json({ users: results });
});

// ─── Admin: Reset User Access Code ───────────────────────────────────

adminContent.post("/api/admin/users/:userId/reset-code", adminMiddleware, async (c) => {
  const targetUserId = c.req.param("userId");
  const user = await c.env.DB.prepare("SELECT id, email, full_name FROM users WHERE id = ?")
    .bind(targetUserId).first<{ id: string; email: string; full_name: string }>();
  if (!user) return c.json({ error: "User not found" }, 404);

  const newAccessCode = generateAccessCode();
  const newHash = await hashPassword(newAccessCode);
  await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .bind(newHash, targetUserId).run();

  await logAudit(c.env.DB, c.get("userId"), "reset_access_code", "user", targetUserId, `Reset access code for ${user.email}`);

  return c.json({ success: true, accessCode: newAccessCode, email: user.email, fullName: user.full_name });
});

// ─── Admin: Full Account Reset (access code + TOTP + recovery code) ───

adminContent.post("/api/admin/users/:userId/reset-account", adminMiddleware, async (c) => {
  const targetUserId = c.req.param("userId");
  const user = await c.env.DB.prepare("SELECT id, email, full_name FROM users WHERE id = ?")
    .bind(targetUserId).first<{ id: string; email: string; full_name: string }>();
  if (!user) return c.json({ error: "User not found" }, 404);

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

  // Update: new access code, new TOTP secret, new recovery code, disable TOTP until user re-verifies
  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, totp_secret = ?, totp_enabled = 0, recovery_code_hash = ? WHERE id = ?"
  ).bind(newPasswordHash, newTotpSecret, newRecoveryHash, targetUserId).run();

  await logAudit(c.env.DB, c.get("userId"), "reset_account", "user", targetUserId, `Full account reset for ${user.email}`);

  const totpUri = `otpauth://totp/AskOzzy:${user.email}?secret=${newTotpSecret}&issuer=AskOzzy&digits=6&period=30`;

  return c.json({
    success: true,
    accessCode: newAccessCode,
    recoveryCode: newRecoveryCode,
    totpUri,
    totpSecret: newTotpSecret,
    email: user.email,
    fullName: user.full_name,
  });
});

// ─── Admin: Bulk User Import ──────────────────────────────────────────

adminContent.post("/api/admin/users/bulk", adminMiddleware, async (c) => {
  const adminId = c.get("userId");
  const { users: userList, defaultTier, defaultUserType } = await c.req.json();

  if (!Array.isArray(userList) || userList.length === 0) {
    return c.json({ error: "Users array is required" }, 400);
  }
  if (userList.length > 500) {
    return c.json({ error: "Maximum 500 users per batch" }, 400);
  }

  const tier = defaultTier || "free";
  const userType = defaultUserType || "gog_employee";
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
        "INSERT INTO users (id, email, password_hash, full_name, department, tier, referral_code, user_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(userId, email, passwordHash, fullName, department, tier, referralCode, userType).run();

      results.push({ email, status: "created", accessCode });
    } catch (err) {
      log("error", "Bulk user import error", { email, error: (err as Error).message });
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
adminContent.get("/api/admin/kb/stats", adminMiddleware, async (c) => {
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

// 1. Upload document
adminContent.post("/api/admin/documents", async (c, next) => {
  const bootstrapSecret = c.req.header("X-Bootstrap-Secret");
  if (bootstrapSecret && bootstrapSecret === c.env.BOOTSTRAP_SECRET) {
    c.set("userId", "system-ingest");
    return next();
  }
  return adminMiddleware(c, next);
}, async (c) => {
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
adminContent.post("/api/admin/documents/upload-file", adminMiddleware, async (c) => {
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
        log("error", "DOCX extraction error", { error: (err as Error).message });
        return c.json({ error: "Failed to extract text from DOCX. The file may be corrupted or in an unsupported format." }, 400);
      }
    } else if (fileName.endsWith(".pptx")) {
      try {
        content = await extractPptxText(file);
      } catch (err) {
        log("error", "PPTX extraction error", { error: (err as Error).message });
        return c.json({ error: "Failed to extract text from PPTX. The file may be corrupted or in an unsupported format." }, 400);
      }
    } else if (fileName.endsWith(".doc")) {
      try {
        content = await extractDocText(file);
        if (content.length < 50) {
          return c.json({ error: "Could not extract enough readable text from this .doc file. Try converting it to .docx first." }, 400);
        }
      } catch (err) {
        log("error", "DOC extraction error", { error: (err as Error).message });
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
    log("error", "File upload failed", { error: (err as Error).message });
    return c.json({ error: "File upload failed" }, 500);
  }
});

// Admin: Scrape URL(s) for document training
adminContent.post("/api/admin/documents/scrape-url", adminMiddleware, async (c) => {
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
        log("error", "Scrape error", { url, error: (err as Error).message });
        results.push({ url, status: "failed", error: "Failed to scrape this URL" });
      }
    }

    const succeeded = results.filter(r => r.status === "success").length;
    return c.json({
      results,
      summary: { total: urlList.length, succeeded, failed: urlList.length - succeeded },
    });
  } catch (err) {
    log("error", "URL scraping failed", { error: (err as Error).message });
    return c.json({ error: "URL scraping failed" }, 500);
  }
});

// 2. List documents
adminContent.get("/api/admin/documents", adminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
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
adminContent.delete("/api/admin/documents/:id", adminMiddleware, async (c) => {
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
adminContent.post("/api/admin/kb", adminMiddleware, async (c) => {
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
adminContent.get("/api/admin/kb", adminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
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
adminContent.patch("/api/admin/kb/:id", adminMiddleware, async (c) => {
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
adminContent.delete("/api/admin/kb/:id", adminMiddleware, async (c) => {
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

// ─── Admin: CSV Bulk Import ──────────────────────────────────────────

adminContent.post("/api/admin/bulk-import", adminMiddleware, async (c) => {
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
        log("error", "CSV import error", { email: row.email, error: (err as Error).message });
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
    log("error", "CSV processing error", { error: (err as Error).message });
    return c.json({ error: "Failed to process CSV. Check the file format and try again." }, 500);
  }
});

// ─── Department Stats ──────────────────────────────────────────────────

adminContent.get("/api/admin/departments/stats", deptAdminMiddleware, async (c) => {
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
    log("error", "Department stats error", { error: String(err) });
    return c.json({ error: "Failed to load department stats" }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  KNOWLEDGE BASE — Bulk Upload & Enhanced Stats
// ═══════════════════════════════════════════════════════════════════════

// Bulk Upload Endpoint — multipart/form-data with multiple files
adminContent.post("/api/admin/knowledge/bulk", adminMiddleware, async (c) => {
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
            log("error", "Bulk DOCX error", { file: file.name, error: (err as Error).message });
            results.push({ filename: file.name, status: 'error', error: 'Failed to extract DOCX text. File may be corrupted.' });
            continue;
          }
        } else if (fileName.endsWith('.pptx')) {
          try {
            content = await extractPptxText(file);
          } catch (err) {
            log("error", "Bulk PPTX error", { file: file.name, error: (err as Error).message });
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
        log("error", "Bulk upload error", { file: file.name, error: (err as Error).message });
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
    log("error", "Bulk upload failed", { error: (err as Error).message });
    return c.json({ error: "Bulk upload failed" }, 500);
  }
});

// Enhanced Knowledge Base Stats
adminContent.get("/api/admin/knowledge/stats", adminMiddleware, async (c) => {
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
    log("error", "Failed to load knowledge stats", { error: (err as Error).message });
    return c.json({ error: "Failed to load knowledge stats" }, 500);
  }
});

// Enhanced document listing with search and category filter
adminContent.get("/api/admin/knowledge/documents", adminMiddleware, async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
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

// ─── Admin: Discover Refresh ─────────────────────────────────────────

adminContent.post("/api/admin/discover/refresh", adminMiddleware, async (c) => {
  const env = c.env;
  const results: Record<string, number> = {};

  const GNEWS_BASE = "https://gnews.io/api/v4";
  const apiKey = env.GNEWS_API_KEY;

  const topicFetches = [
    { category: "ghana", url: `${GNEWS_BASE}/top-headlines?country=gh&lang=en&max=20&apikey=${apiKey}` },
    { category: "africa", url: `${GNEWS_BASE}/search?q=Africa OR "African Union" OR ECOWAS OR "West Africa" OR "East Africa" OR "South Africa"&lang=en&max=20&apikey=${apiKey}` },
    { category: "world", url: `${GNEWS_BASE}/top-headlines?topic=world&lang=en&max=20&apikey=${apiKey}` },
    { category: "business", url: `${GNEWS_BASE}/top-headlines?topic=business&lang=en&max=20&apikey=${apiKey}` },
    { category: "technology", url: `${GNEWS_BASE}/top-headlines?topic=technology&lang=en&max=20&apikey=${apiKey}` },
    { category: "science", url: `${GNEWS_BASE}/top-headlines?topic=science&lang=en&max=20&apikey=${apiKey}` },
    { category: "health", url: `${GNEWS_BASE}/top-headlines?topic=health&lang=en&max=20&apikey=${apiKey}` },
    { category: "sports", url: `${GNEWS_BASE}/top-headlines?topic=sports&lang=en&max=20&apikey=${apiKey}` },
    { category: "entertainment", url: `${GNEWS_BASE}/top-headlines?topic=entertainment&lang=en&max=20&apikey=${apiKey}` },
    { category: "government", url: `${GNEWS_BASE}/search?q=government OR politics OR policy OR parliament OR legislation&lang=en&max=20&apikey=${apiKey}` },
  ];

  for (const { category, url } of topicFetches) {
    let count = 0;
    try {
      const res = await fetch(url);
      if (!res.ok) { results[category] = 0; continue; }
      const data = await res.json() as { articles?: Array<{ title: string; description: string; url: string; image: string; publishedAt: string; source: { name: string; url: string } }> };
      if (!data.articles) { results[category] = 0; continue; }

      for (const article of data.articles) {
        const id = generateId();
        try {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO discover_articles (id, title, description, source_name, source_url, article_url, image_url, category, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(id, article.title, article.description || "", article.source?.name || "Unknown", article.source?.url || "", article.url, article.image || "", category, article.publishedAt || new Date().toISOString()).run();
          count++;
        } catch { /* duplicate */ }
      }
    } catch { /* fetch error */ }
    results[category] = count;
  }

  await env.DB.prepare("DELETE FROM discover_articles WHERE published_at < datetime('now', '-48 hours')").run();

  return c.json({ success: true, results });
});

// ─── Admin: R2 Knowledge Document Management ────────────────────────

// Upload a document to R2 for AutoRAG indexing
adminContent.post("/api/admin/knowledge/upload", adminMiddleware, async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const category = formData.get("category") as string || "general";
  const subcategory = formData.get("subcategory") as string || "misc";

  if (!file) return c.json({ error: "No file provided" }, 400);

  const buffer = await file.arrayBuffer();
  const result = await uploadDocumentToR2(buffer, file.name, category, subcategory, c.env);
  return c.json({ success: true, ...result, filename: file.name });
});

// List documents in R2 bucket
adminContent.get("/api/admin/knowledge/documents", adminMiddleware, async (c) => {
  const prefix = c.req.query("prefix");
  const docs = await listR2Documents(c.env, prefix || undefined);
  return c.json({ success: true, documents: docs, count: docs.length });
});

// Delete a document from R2
adminContent.delete("/api/admin/knowledge/documents/:key{.+}", adminMiddleware, async (c) => {
  const key = c.req.param("key");
  await deleteR2Document(c.env, key);
  return c.json({ success: true, deleted: key });
});

// ─── Admin: Gateway Metrics ─────────────────────────────────────────

adminContent.get("/api/admin/metrics/gateway", adminMiddleware, async (c) => {
  const days = parseInt(c.req.query("days") || "7", 10);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM gateway_metrics WHERE date >= date('now', '-' || ? || ' days') ORDER BY date DESC, agent_type`
  ).bind(days).all();
  return c.json({ success: true, metrics: rows.results });
});

// ─── Admin: Tool Invocation Logs ────────────────────────────────────

adminContent.get("/api/admin/metrics/tools", adminMiddleware, async (c) => {
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const rows = await c.env.DB.prepare(
    `SELECT id, request_id, agent_type, tool_name, success, latency_ms, created_at
     FROM tool_invocations ORDER BY created_at DESC LIMIT ?`
  ).bind(limit).all();
  return c.json({ success: true, invocations: rows.results });
});

export default adminContent;
