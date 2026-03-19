import { Hono } from "hono";
import type { Env, Variables, AppType } from "../types";
import { generateId } from "../lib/utils";
import { checkRateLimit, globalRateLimit, authMiddleware } from "../lib/middleware";
import {
  buildGroundedSystemPrompt, buildContextBlock, buildNoContextResponse,
  GROUNDING_RULES, UNCERTAINTY_PROTOCOL, PROHIBITED_BEHAVIORS,
  type RetrievedContext,
} from "../config/agent-prompts";
import { getAuthorityForAgent } from "../config/authorities";
import { getParams, resolveAgentCategory } from "../config/inference-params";
import { checkKnownErrors } from "../lib/known-errors";
import { handleFeedback, type FeedbackPayload } from "../lib/feedback";
import { hybridRetrieve } from "../lib/hybrid-retriever";
import { runStreamWithGateway } from "../lib/ai-client";
import { buildCacheKey, shouldSkipCache } from "../lib/cache-key";
import { checkAgentRateLimit, recordGatewayMetrics } from "../lib/rate-limiter";
import { runWithTools, agentHasTools } from "../lib/tool-loop";
import { getToolsForAgent, TOOL_USE_RULES } from "../config/tools";
import { generate } from "../lib/generator";
import { verify, requiresFullVerification, selfConsistencyCheck } from "../lib/verifier";
import { adjudicate } from "../lib/adjudicator";
import { computeConfidence } from "../lib/confidence";
import { parseCitations } from "../lib/citation-parser";
import { loadStudentProfile, saveStudentProfile, updateSessionScore } from "../lib/session-tracker";
import { assessStudentLevel, getOrCreateStudentProfile, buildScaffoldingPrompt, generateOrientationBrief, isNewTopic } from "../agents/tutor-agent";
import { retrieveAtLevel } from "../lib/difficulty-retriever";
import { log } from "../lib/logger";

function escapeLike(s: string): string { return s.replace(/[%_\\]/g, '\\$&'); }

const chat = new Hono<AppType>();

// ─── Duplicated Constants & Helpers from index.ts ─────────────────────

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

const FREE_TIER_MODELS = [
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/openai/gpt-oss-20b",
  "@cf/google/gemma-3-12b-it",
  "@cf/meta/llama-3.1-8b-instruct-fast",
];

const PRO_TIER_MODELS = [
  ...FREE_TIER_MODELS,
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/qwen/qwq-32b",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/zai-org/glm-4.7-flash",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "@cf/qwen/qwen2.5-coder-32b-instruct",
  "@cf/meta/llama-3.2-11b-vision-instruct",
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

// ─── Subscription Columns Lazy Migration ─────────────────────────────

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

// ─── User Type Column Lazy Migration ─────────────────────────────────

async function ensureUserTypeColumn(db: D1Database) {
  try {
    await db.prepare("SELECT user_type FROM users LIMIT 1").first();
  } catch {
    await db.prepare("ALTER TABLE users ADD COLUMN user_type TEXT DEFAULT 'gog_employee'").run();
  }
}

// ─── User Profiles Table Lazy Migration ──────────────────────────────

let profileTableExists = false;
async function ensureUserProfilesTable(db: D1Database) {
  if (profileTableExists) return;
  try {
    await db.prepare("SELECT user_id FROM user_profiles LIMIT 1").first();
    profileTableExists = true;
  } catch {
    await db.prepare(`CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      writing_style TEXT DEFAULT 'formal',
      experience_level TEXT DEFAULT 'intermediate',
      preferred_language TEXT DEFAULT 'en',
      courses TEXT DEFAULT '[]',
      subjects_of_interest TEXT DEFAULT '[]',
      organization_context TEXT DEFAULT '',
      exam_target TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`).run();
    profileTableExists = true;
  }
}

// ─── Phase 7: Meeting Action Items Table Lazy Migration ─────────────

let phase7TablesExist = false;
async function ensurePhase7Tables(db: D1Database) {
  if (phase7TablesExist) return;
  try {
    await db.prepare("SELECT id FROM meeting_action_items LIMIT 1").first();
    phase7TablesExist = true;
  } catch {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS meeting_action_items (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        assignee TEXT DEFAULT '',
        deadline TEXT DEFAULT NULL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done')),
        completed_at TEXT DEFAULT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_action_items_meeting ON meeting_action_items(meeting_id)"),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_action_items_user_status ON meeting_action_items(user_id, status)"),
    ]);
    phase7TablesExist = true;
  }
  // Also ensure meeting_type and language columns on meetings table
  try {
    await db.prepare("SELECT meeting_type FROM meetings LIMIT 1").first();
  } catch {
    await db.batch([
      db.prepare("ALTER TABLE meetings ADD COLUMN meeting_type TEXT DEFAULT 'general'"),
      db.prepare("ALTER TABLE meetings ADD COLUMN language TEXT DEFAULT 'en'"),
    ]);
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
    log("error", "Web search failed", { error: String(e) });
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

// ─── User Activity Audit Helper (non-blocking) ─────────────────────────

async function logUserAudit(c: any, actionType: string, queryPreview?: string, model?: string) {
  try {
    const userId = c.get("userId");
    const ip = c.req.header("cf-connecting-ip") || "unknown";
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

const VALID_STAT_COLUMNS = new Set([
  "messages_sent", "research_reports", "analyses_run",
  "meetings_processed", "workflows_completed", "documents_generated",
]);

const PRODUCTIVITY_MULTIPLIERS: Record<string, { column: string; minutes: number }> = {
  chat: { column: "messages_sent", minutes: 2 },
  research: { column: "research_reports", minutes: 30 },
  analysis: { column: "analyses_run", minutes: 20 },
  vision: { column: "messages_sent", minutes: 2 },
  meeting: { column: "meetings_processed", minutes: 60 },
  workflow: { column: "workflows_completed", minutes: 45 },
  document: { column: "documents_generated", minutes: 15 },
  exam_attempt: { column: "messages_sent", minutes: 10 },
};

async function trackProductivity(c: any, statType: string) {
  try {
    const userId = c.get("userId");
    const today = new Date().toISOString().split("T")[0];
    const multiplier = PRODUCTIVITY_MULTIPLIERS[statType];
    if (!multiplier || !VALID_STAT_COLUMNS.has(multiplier.column)) return;

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

// ─── Moderation ──────────────────────────────────────────────────────

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

// ─── Document Embeddings Processing ──────────────────────────────────

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
- For document drafting, follow GoG formatting standards above

${GROUNDING_RULES}

${UNCERTAINTY_PROTOCOL}

${PROHIBITED_BEHAVIORS}`;

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
- Structure responses with clear headings, bullet points, and numbered steps

${GROUNDING_RULES}

${UNCERTAINTY_PROTOCOL}

${PROHIBITED_BEHAVIORS}`;

// ═══════════════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════════════

// POST /api/web-search — standalone web search endpoint
chat.post("/api/web-search", authMiddleware, async (c) => {
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

chat.post("/api/chat", authMiddleware, async (c) => {
  const userId = c.get("userId");

  // Rate limit chat requests
  const chatRateCheck = await checkRateLimit(c.env, userId, "chat");
  if (!chatRateCheck.allowed) {
    return c.json({ error: "Too many requests. Please slow down.", code: "RATE_LIMITED" }, 429);
  }

  // Global per-user rate limit (100/hr across all agents)
  const globalCheck = await globalRateLimit(c.env, userId);
  if (!globalCheck.allowed) {
    return c.json({ error: "Hourly request limit reached (100/hr). Please try again later.", code: "GLOBAL_RATE_LIMITED" }, 429);
  }

  const { conversationId, message, model, systemPrompt, agentId, webSearch: webSearchEnabled } = await c.req.json();

  if (!conversationId || !message) {
    return c.json({ error: "conversationId and message are required" }, 400);
  }

  if (message && message.length > 50000) {
    return c.json({ error: "Message too long (max 50,000 characters)" }, 400);
  }

  if (systemPrompt && (typeof systemPrompt !== 'string' || systemPrompt.length > 4000)) {
    return c.json({ error: "System prompt too long (max 4000 characters)" }, 400);
  }

  // Get user tier and type (with trial + subscription expiry support)
  await ensureUserTypeColumn(c.env.DB);
  await ensureSubscriptionColumns(c.env.DB);
  const user = await c.env.DB.prepare("SELECT tier, trial_expires_at, user_type, subscription_expires_at FROM users WHERE id = ?")
    .bind(userId)
    .first<{ tier: string; trial_expires_at: string | null; user_type: string | null; subscription_expires_at: string | null }>();
  let userTier = getEffectiveTier({ tier: user?.tier || "free", trial_expires_at: user?.trial_expires_at || null, subscription_expires_at: user?.subscription_expires_at || null });

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

  let selectedModel = model || convo.model || "@cf/qwen/qwen3-30b-a3b-fp8";
  let modelDowngraded = false;

  // Free tier: restrict to basic models
  if (userTier === "free" && !FREE_TIER_MODELS.includes(selectedModel)) {
    selectedModel = "@cf/qwen/qwen3-30b-a3b-fp8"; // fallback to best free model (MoE, 3B active)
    modelDowngraded = true;
  }
  // Professional tier: restrict to pro + free models
  if (userTier === "professional" && !PRO_TIER_MODELS.includes(selectedModel)) {
    selectedModel = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"; // fallback to best pro model
    modelDowngraded = true;
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

  // Fetch user memories + structured profile for personalization
  let memoryPrefix = "";
  try {
    // Structured profile
    let profileSection = "";
    try {
      await ensureUserProfilesTable(c.env.DB);
      const profile = await c.env.DB.prepare(
        "SELECT * FROM user_profiles WHERE user_id = ?"
      ).bind(userId).first<{ writing_style: string; experience_level: string; courses: string; organization_context: string; exam_target: string }>();
      if (profile) {
        const parts: string[] = [];
        if (profile.writing_style && profile.writing_style !== "formal") parts.push(`- Writing style: ${profile.writing_style}`);
        if (profile.experience_level && profile.experience_level !== "intermediate") parts.push(`- Experience: ${profile.experience_level}`);
        if (profile.organization_context) parts.push(`- Organization: ${profile.organization_context}`);
        if (profile.exam_target) parts.push(`- Exam target: ${profile.exam_target}`);
        try {
          const courses = JSON.parse(profile.courses || "[]");
          if (Array.isArray(courses) && courses.length > 0) parts.push(`- Courses: ${courses.join(", ")}`);
        } catch {}
        if (parts.length > 0) profileSection = parts.join("\n") + "\n";
      }
    } catch {}

    const { results: memories } = await c.env.DB.prepare(
      "SELECT key, value FROM user_memories WHERE user_id = ? ORDER BY key"
    ).bind(userId).all<{ key: string; value: string }>();
    if ((memories && memories.length > 0) || profileSection) {
      memoryPrefix = `## About this user\n${profileSection}${memories ? memories.map(m => `- ${m.key}: ${m.value}`).join("\n") : ""}\n\nUse this context to personalize your responses. Reference the user's role, department, and preferences when relevant.\n\n`;
    }
  } catch (e: any) { log('error', 'Memory lookup failed', { error: e?.message }); }

  // Determine base system prompt (agent or default, persona-aware)
  const defaultPrompt = (user?.user_type === "student") ? STUDENT_SYSTEM_PROMPT : GOG_SYSTEM_PROMPT;
  let baseSystemPrompt = systemPrompt || defaultPrompt;
  let agentKnowledgeCategory: string | null = null;
  let agentName: string | null = null;

  if (agentId) {
    try {
      const agent = await c.env.DB.prepare(
        "SELECT * FROM agents WHERE id = ? AND active = 1"
      ).bind(agentId).first<{ name: string; system_prompt: string; knowledge_category: string | null }>();
      if (agent) {
        baseSystemPrompt = agent.system_prompt;
        agentName = agent.name;
        if (agent.knowledge_category) {
          agentKnowledgeCategory = agent.knowledge_category;
        }
      }
    } catch (e: any) { log('error', 'Agent lookup failed', { error: e?.message }); }
  }

  // Resolve inference parameters for this agent type
  const agentCategory = resolveAgentCategory(agentKnowledgeCategory, agentName || undefined);
  const inferenceParams = getParams(agentCategory);

  // Generate a unique request ID for tracking feedback and hallucination events
  const requestId = crypto.randomUUID();

  // Check known errors before proceeding (prevents serving cached hallucinations)
  try {
    const knownError = await checkKnownErrors(message, agentCategory, c.env);
    if (knownError) {
      const correctionMsg = knownError.correction
        ? `The correct information is: ${knownError.correction}`
        : `Please consult ${getAuthorityForAgent(agentCategory)} for accurate information.`;
      const errorResponse = `I've identified that this question has previously produced inaccurate results. ${correctionMsg}`;

      // Return as a non-streaming response
      const assistantMsgId = generateId();
      await c.env.DB.prepare(
        "INSERT INTO messages (id, conversation_id, role, content, model) VALUES (?, ?, 'assistant', ?, ?)"
      ).bind(assistantMsgId, conversationId, errorResponse, 'known-error-guard').run();

      return c.json({ response: errorResponse, request_id: requestId, known_error: true });
    }
  } catch (e: any) {
    // Known errors check is non-fatal — proceed with normal pipeline
    log("error", "Known errors check failed", { error: e?.message });
  }

  // RAG: Hybrid search (Vectorize + AutoRAG) for relevant context
  const { ragResults: rawRagResults, faqResults } = await searchKnowledge(c.env, message, 5, agentCategory);

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
    } catch (e: any) { log('error', 'Web search failed', { error: e?.message }); }
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

  // Inject tool use rules for tool-enabled agents
  if (agentHasTools(agentCategory)) {
    augmentedPrompt += '\n\n' + TOOL_USE_RULES;
  }

  // Adaptive difficulty for student-facing agents (WASSCE, BECE, Study Coach)
  const isTutorAgent = ['wassce', 'bece', 'study_coach', 'exam_marker'].includes(agentCategory);
  let studentProfile = null;
  if (isTutorAgent) {
    try {
      studentProfile = await getOrCreateStudentProfile(conversationId, message, c.env);
      augmentedPrompt += '\n\n' + buildScaffoldingPrompt(studentProfile, agentCategory);

      // Generate orientation brief for new topics (first message in conversation)
      const msgCount = history.length;
      if (isNewTopic(msgCount)) {
        const brief = await generateOrientationBrief(message, studentProfile, agentCategory, c.env);
        if (brief.key_concepts.length > 0) {
          augmentedPrompt += `\n\n## ORIENTATION BRIEF FOR THIS TOPIC
Topic: ${brief.topic_title}
Key concepts to cover: ${brief.key_concepts.join(', ')}
Prerequisites: ${brief.prerequisites.join(', ') || 'None identified'}
Estimated difficulty: ${brief.estimated_difficulty}
Start with these warm-up questions: ${brief.starter_questions.join(' | ') || 'N/A'}`;
        }
      }
    } catch (e: any) {
      log("error", "Tutor scaffolding failed", { error: e?.message });
    }
  }

  messages.push({ role: "system", content: augmentedPrompt });

  // Add history (reversed to chronological order, skip the message we just added)
  const historyChronological = [...history].reverse();
  for (const msg of historyChronological) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Agent-specific rate limiting
  try {
    const rateCheck = await checkAgentRateLimit(userId, agentCategory, c.env);
    if (!rateCheck.allowed) {
      return c.json({
        error: `Rate limit exceeded for this agent. ${rateCheck.remaining} requests remaining. Resets at ${new Date(rateCheck.resetAt * 1000).toISOString()}.`,
        rate_limited: true,
      }, 429);
    }
  } catch (e: any) {
    log("error", "Agent rate limit check failed", { error: e?.message });
    // Non-fatal — proceed
  }

  // Tier-based max_tokens
  const tierMaxTokens: Record<string, number> = { free: 2048, starter: 4096, professional: 6144, enterprise: 8192 };
  const maxTokens = tierMaxTokens[userTier] || 4096;

  // Convert RAG results to RetrievedContext for verification pipeline
  const retrievedContexts: RetrievedContext[] = ragResults.map((r, i) => ({
    id: `rag_${i}`,
    text: r.content,
    score: r.score,
    source: r.source,
  }));

  // Tool execution for tool-enabled agents (non-streaming first pass)
  if (agentHasTools(agentCategory)) {
    try {
      const toolResult = await runWithTools(
        messages as any,
        agentCategory,
        c.env,
        requestId,
      );
      if (toolResult.toolsUsed.length > 0) {
        const assistantMsgId = generateId();
        await c.env.DB.prepare(
          "INSERT INTO messages (id, conversation_id, role, content, model) VALUES (?, ?, 'assistant', ?, ?)"
        ).bind(assistantMsgId, conversationId, toolResult.response, selectedModel).run();

        // Auto-flag for moderation
        c.executionCtx.waitUntil(checkModeration(c.env.DB, conversationId, assistantMsgId, userId, toolResult.response));

        // Post-response verification in background
        c.executionCtx.waitUntil((async () => {
          try {
            if (requiresFullVerification(agentCategory) && retrievedContexts.length > 0) {
              const citationReport = parseCitations(toolResult.response, retrievedContexts);
              const generatedForVerify = {
                text: toolResult.response,
                claims: citationReport.citations.map(ct => ct.source),
                citations_used: citationReport.citations.map(ct => ct.source),
                raw: toolResult.response,
              };
              const vResult = await Promise.race([
                verify(generatedForVerify, retrievedContexts, c.env),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('verification timeout')), 10000)),
              ]);
              if (vResult.overall === 'FAIL') {
                await adjudicate(generatedForVerify, vResult, c.env, requestId, agentCategory, toolResult.response.substring(0, 500));
              }
            }
          } catch (e: any) {
            log("error", "Tool-use post-response verification failed", { error: e?.message });
          }
        })());

        // Record gateway metrics
        c.executionCtx.waitUntil(recordGatewayMetrics(c.env, agentCategory, false, false, 0, 0).catch(() => {}));

        // Update student profile for tutor agents
        if (isTutorAgent && studentProfile) {
          try {
            const outcome = toolResult.response.length > 100 ? 'correct' : 'skipped';
            const updatedProfile = updateSessionScore(studentProfile, outcome as any);
            await saveStudentProfile(conversationId, updatedProfile, c.env);
          } catch (e: any) {
            log("error", "Student profile update failed", { error: e?.message });
          }
        }

        return c.json({ response: toolResult.response, request_id: requestId, tools_used: toolResult.toolsUsed });
      }
    } catch (e: any) {
      log("error", "Tool execution failed, falling back to streaming", { error: e?.message });
    }
  }

  // Build cache options for AI Gateway
  const skipCache = shouldSkipCache(message);
  const cacheOpts = await buildCacheKey(message, agentCategory, ragResults.map(r => r.source));
  cacheOpts.skipCache = skipCache;
  cacheOpts.requestId = requestId;
  cacheOpts.userTier = userTier;

  // Stream response via AI Gateway with agent-specific inference params
  const stream = await runStreamWithGateway(selectedModel, {
    messages: messages as any,
    max_tokens: maxTokens,
    temperature: inferenceParams.temperature,
    top_p: inferenceParams.top_p,
    top_k: inferenceParams.top_k,
  }, c.env, cacheOpts);

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
      const streamStartMs = Date.now();

      try {
        // Send request_id for feedback tracking
        await writer.write(encoder.encode(`event: request_id\ndata: ${JSON.stringify({ request_id: requestId, agent_type: agentCategory })}\n\n`));

        // Notify client if model was downgraded due to tier restrictions
        if (modelDowngraded) {
          await writer.write(encoder.encode(`event: model_info\ndata: ${JSON.stringify({ model: selectedModel, downgraded: true })}\n\n`));
        }

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

          // Update student profile score and interaction count for tutor agents
          if (isTutorAgent && studentProfile) {
            try {
              // Simple heuristic: if response is long and structured, mark as correct interaction
              const outcome = fullResponse.length > 100 ? 'correct' : 'skipped';
              const updatedProfile = updateSessionScore(studentProfile, outcome as any);

              // Increment interaction count and reassess level every 10 interactions
              const count = (updatedProfile.interaction_count || 0) + 1;
              updatedProfile.interaction_count = count;
              if (count > 0 && count % 10 === 0) {
                try {
                  const reassessment = await assessStudentLevel(message, c.env);
                  if (reassessment.level !== updatedProfile.level) {
                    updatedProfile.level = reassessment.level;
                    updatedProfile.confidence = reassessment.confidence;
                    log('info', 'Student level reassessed', {
                      conversationId,
                      oldLevel: studentProfile.level,
                      newLevel: reassessment.level,
                      interactions: count,
                    });
                  }
                } catch {}
              }

              await saveStudentProfile(conversationId, updatedProfile, c.env);
            } catch {}
          }

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

            if (memoryCount && memoryCount.count < 50) {
              const extractResponse = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
                messages: [
                  {
                    role: "system",
                    content: `Extract any personal/professional facts from this message. Return JSON array of {key, value} pairs or empty array []. Examples: {"key": "department", "value": "Ministry of Finance"}, {"key": "role", "value": "Procurement Officer"}, {"key": "writing_style", "value": "formal"}, {"key": "course", "value": "Economics"}, {"key": "expertise", "value": "public procurement"}, {"key": "topic_interest", "value": "data analysis"}. Only extract clear, explicit facts. Return ONLY the JSON array, nothing else.`,
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

          // ─── Post-Stream Verification Pipeline ──────────────────────
          // Run verification AFTER streaming to avoid blocking UX
          // For high-risk agents: full 70B verification
          // For other agents: self-consistency check
          try {
            const responseTimeMs = Date.now() - streamStartMs;

            if (fullResponse.length > 50 && retrievedContexts.length > 0) {
              // Parse citations from the response
              const citationReport = parseCitations(fullResponse, retrievedContexts);

              if (requiresFullVerification(agentCategory)) {
                // High-risk agents: 70B verification (10s timeout)
                const generatedForVerify = {
                  text: fullResponse,
                  claims: citationReport.citations.map(c => c.source),
                  citations_used: citationReport.citations.map(c => c.source),
                  raw: fullResponse,
                };
                const verificationReport = await Promise.race([
                  verify(generatedForVerify, retrievedContexts, c.env),
                  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('verification timed out after 10s')), 10000)),
                ]);

                if (verificationReport.overall === 'FAIL') {
                  // Log hallucination event to D1 (10s timeout)
                  await Promise.race([
                    adjudicate(generatedForVerify, verificationReport, c.env, requestId, agentCategory, message),
                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('adjudication timed out after 10s')), 10000)),
                  ]);
                }

                // Record metrics
                const confidence = computeConfidence(
                  retrievedContexts.map(r => r.score),
                  verificationReport.overall === 'PASS' ? 'PASS' : verificationReport.overall === 'FAIL' ? 'FAIL' : 'PARTIAL',
                  1.0
                );
                const confidenceNumeric = confidence.final_confidence === 'high' ? 0.9 : confidence.final_confidence === 'medium' ? 0.6 : confidence.final_confidence === 'low' ? 0.3 : 0;
                await recordGatewayMetrics(c.env, agentCategory, false, verificationReport.overall === 'FAIL', responseTimeMs, confidenceNumeric);
              } else {
                // Non-critical agents: self-consistency check (10s timeout)
                const consistencyScore = await Promise.race([
                  selfConsistencyCheck(message, augmentedPrompt, c.env),
                  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('self-consistency timed out after 10s')), 10000)),
                ]);
                const confidence = computeConfidence(
                  retrievedContexts.map(r => r.score),
                  'SKIPPED',
                  consistencyScore
                );

                // Flag if consistency is very low
                if (consistencyScore < 0.3) {
                  try {
                    await c.env.DB.prepare(
                      `INSERT INTO hallucination_events (request_id, agent_type, query, generated_response, verification_report, flagged_by)
                       VALUES (?, ?, ?, ?, ?, 'consistency_check')`
                    ).bind(requestId, agentCategory, message.slice(0, 500), fullResponse.slice(0, 2000), JSON.stringify({ consistency: consistencyScore })).run();
                  } catch {}
                }
                const confNum = confidence.final_confidence === 'high' ? 0.9 : confidence.final_confidence === 'medium' ? 0.6 : confidence.final_confidence === 'low' ? 0.3 : 0;
                await recordGatewayMetrics(c.env, agentCategory, false, consistencyScore < 0.3, responseTimeMs, confNum);
              }
            }
          } catch (verifyErr: any) {
            log("error", "Post-stream verification failed", { error: verifyErr?.message });
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

// ─── Deep Research Mode ─────────────────────────────────────────────

chat.post("/api/research", authMiddleware, async (c) => {
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
chat.get("/api/research/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const reportId = c.req.param("id");

  const report = await c.env.DB.prepare(
    "SELECT * FROM research_reports WHERE id = ? AND user_id = ?"
  ).bind(reportId, userId).first();

  if (!report) return c.json({ error: "Report not found" }, 404);
  return c.json({ report });
});

// ─── Data Analysis Mode ─────────────────────────────────────────────

chat.post("/api/analyze", authMiddleware, async (c) => {
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

// ─── Image / Vision Understanding ───────────────────────────────────

chat.post("/api/vision", authMiddleware, async (c) => {
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
chat.post("/api/chat/image", authMiddleware, async (c) => {
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

// ─── Artifact Detection ──────────────────────────────────────────────

chat.post("/api/chat/detect-artifact", authMiddleware, async (c) => {
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

// ─── Follow-up Suggestions ────────────────────────────────────────────

chat.get("/api/chat/suggestions/:conversationId", authMiddleware, async (c) => {
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

export default chat;
