// User profile, memories, onboarding, streaks, and account management routes — extracted from index.ts
import { Hono } from "hono";
import type { AppType } from "../types";
import { authMiddleware, adminMiddleware } from "../lib/middleware";
import { generateId } from "../lib/utils";
import { log } from "../lib/logger";
import {
  getEffectiveTier,
  checkUsageLimit,
  ensureSubscriptionColumns,
} from "./payments";

const user = new Hono<AppType>();

// ─── Quiz Columns Lazy Migration ────────────────────────────────────

let quizColsExist = false;
async function ensureQuizColumns(db: D1Database) {
  if (quizColsExist) return;
  try {
    await db.prepare("SELECT experience_level FROM users LIMIT 1").first();
    quizColsExist = true;
  } catch {
    await db.batch([
      db.prepare("ALTER TABLE users ADD COLUMN experience_level TEXT DEFAULT NULL"),
      db.prepare("ALTER TABLE users ADD COLUMN primary_use_case TEXT DEFAULT NULL"),
      db.prepare("ALTER TABLE users ADD COLUMN onboarding_quiz_completed INTEGER DEFAULT 0"),
    ]);
    quizColsExist = true;
  }
}

// ─── User Profiles Table Lazy Migration ─────────────────────────────

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

// ─── Prompt Course Column Lazy Migration ────────────────────────────

let promptCourseColExists = false;
async function ensurePromptCourseColumn(db: D1Database) {
  if (promptCourseColExists) return;
  try {
    await db.prepare("SELECT prompt_course_progress FROM user_profiles LIMIT 1").first();
    promptCourseColExists = true;
  } catch {
    await db.prepare("ALTER TABLE user_profiles ADD COLUMN prompt_course_progress TEXT DEFAULT '{}'").run();
    promptCourseColExists = true;
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

// ─── Productivity Tracker (lightweight, for prompt course) ──────────

async function trackProductivity(c: any, statType: string) {
  try {
    const userId = c.get("userId");
    if (!userId) return;
    const today = new Date().toISOString().split("T")[0];
    await c.env.DB.prepare(
      `INSERT INTO productivity_stats (id, user_id, stat_type, stat_date, count)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(user_id, stat_type, stat_date) DO UPDATE SET count = count + 1`
    ).bind(generateId(), userId, statType, today).run();
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════
//  User Memories
// ═══════════════════════════════════════════════════════════════════

user.get("/api/memories", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM user_memories WHERE user_id = ? ORDER BY updated_at DESC"
  ).bind(userId).all();

  const includeProfile = c.req.query("includeProfile") === "true";
  if (includeProfile) {
    try {
      await ensureUserProfilesTable(c.env.DB);
      const profile = await c.env.DB.prepare(
        "SELECT * FROM user_profiles WHERE user_id = ?"
      ).bind(userId).first();
      return c.json({ memories: results || [], profile: profile || null });
    } catch {}
  }
  return c.json({ memories: results || [] });
});

user.post("/api/memories", authMiddleware, async (c) => {
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

user.delete("/api/memories/:id", authMiddleware, async (c) => {
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

user.get("/api/admin/users/:id/memories", adminMiddleware, async (c) => {
  const targetUserId = c.req.param("id");
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM user_memories WHERE user_id = ? ORDER BY updated_at DESC"
  ).bind(targetUserId).all();
  return c.json({ memories: results || [] });
});

// ═══════════════════════════════════════════════════════════════════
//  Onboarding Quiz
// ═══════════════════════════════════════════════════════════════════

user.get("/api/onboarding/status", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureQuizColumns(c.env.DB);
  const u = await c.env.DB.prepare(
    "SELECT onboarding_quiz_completed FROM users WHERE id = ?"
  ).bind(userId).first<{ onboarding_quiz_completed: number }>();
  return c.json({ quizCompleted: !!(u?.onboarding_quiz_completed) });
});

user.post("/api/onboarding/quiz", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { experienceLevel, primaryUseCase, additionalInfo } = await c.req.json();

  if (!experienceLevel || !primaryUseCase) {
    return c.json({ error: "Experience level and primary use case are required" }, 400);
  }

  const validLevels = ["new_civil_servant", "experienced_officer", "senior_management", "shs_bece", "university_undergrad", "postgraduate"];
  const validUseCases = ["memos_correspondence", "data_analysis", "research_policy", "general_productivity", "exam_prep", "essay_writing", "research_projects", "general_study"];
  if (!validLevels.includes(experienceLevel)) return c.json({ error: "Invalid experience level" }, 400);
  if (!validUseCases.includes(primaryUseCase)) return c.json({ error: "Invalid use case" }, 400);

  await ensureQuizColumns(c.env.DB);

  // Update user columns
  await c.env.DB.prepare(
    "UPDATE users SET experience_level = ?, primary_use_case = ?, onboarding_quiz_completed = 1 WHERE id = ?"
  ).bind(experienceLevel, primaryUseCase, userId).run();

  // Store as memories for AI personalization
  let memoriesCreated = 0;
  const memPairs: Array<{ key: string; value: string }> = [
    { key: "experience_level", value: experienceLevel.replace(/_/g, " ") },
    { key: "primary_use_case", value: primaryUseCase.replace(/_/g, " ") },
  ];

  for (const { key, value } of memPairs) {
    const memId = generateId();
    await c.env.DB.prepare(
      `INSERT INTO user_memories (id, user_id, key, value, type)
       VALUES (?, ?, ?, ?, 'preference')
       ON CONFLICT(user_id, key) DO UPDATE SET value = ?, type = 'preference', updated_at = datetime('now')`
    ).bind(memId, userId, key, value, value).run();
    memoriesCreated++;
  }

  // Extract additional facts from freeform text using AI
  if (additionalInfo && typeof additionalInfo === "string" && additionalInfo.trim().length > 10) {
    try {
      const extractResponse = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
        messages: [
          {
            role: "system",
            content: `Extract personal/professional facts from this message. Return JSON array of {key, value} pairs or empty array []. Examples: {"key": "department", "value": "Ministry of Finance"}, {"key": "role", "value": "Procurement Officer"}, {"key": "school", "value": "University of Ghana"}, {"key": "course", "value": "Economics"}, {"key": "exam_target", "value": "WASSCE 2026"}. Only extract clear, explicit facts. Return ONLY the JSON array, nothing else.`,
          },
          { role: "user", content: additionalInfo.substring(0, 1000) },
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
                memoriesCreated++;
              }
            }
          }
        }
      } catch {}
    } catch {}
  }

  return c.json({ success: true, memoriesCreated });
});

// ═══════════════════════════════════════════════════════════════════
//  User Profile (structured memory)
// ═══════════════════════════════════════════════════════════════════

user.get("/api/profile", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureUserProfilesTable(c.env.DB);

  let profile = await c.env.DB.prepare(
    "SELECT * FROM user_profiles WHERE user_id = ?"
  ).bind(userId).first();

  if (!profile) {
    await c.env.DB.prepare(
      "INSERT INTO user_profiles (user_id) VALUES (?)"
    ).bind(userId).run();
    profile = await c.env.DB.prepare(
      "SELECT * FROM user_profiles WHERE user_id = ?"
    ).bind(userId).first();
  }

  return c.json({ profile });
});

user.put("/api/profile", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  await ensureUserProfilesTable(c.env.DB);

  const validStyles = ["formal", "casual", "academic", "creative", "technical"];
  const validLevels = ["beginner", "intermediate", "advanced", "expert"];

  const updates: string[] = [];
  const values: any[] = [];

  if (body.writingStyle && validStyles.includes(body.writingStyle)) {
    updates.push("writing_style = ?"); values.push(body.writingStyle);
  }
  if (body.experienceLevel && validLevels.includes(body.experienceLevel)) {
    updates.push("experience_level = ?"); values.push(body.experienceLevel);
  }
  if (body.preferredLanguage && typeof body.preferredLanguage === "string") {
    updates.push("preferred_language = ?"); values.push(body.preferredLanguage.substring(0, 10));
  }
  if (body.courses !== undefined) {
    try {
      const arr = typeof body.courses === "string" ? JSON.parse(body.courses) : body.courses;
      if (Array.isArray(arr) && arr.length <= 20) {
        updates.push("courses = ?"); values.push(JSON.stringify(arr.map((s: string) => String(s).substring(0, 100))));
      }
    } catch {}
  }
  if (body.subjectsOfInterest !== undefined) {
    try {
      const arr = typeof body.subjectsOfInterest === "string" ? JSON.parse(body.subjectsOfInterest) : body.subjectsOfInterest;
      if (Array.isArray(arr) && arr.length <= 20) {
        updates.push("subjects_of_interest = ?"); values.push(JSON.stringify(arr.map((s: string) => String(s).substring(0, 100))));
      }
    } catch {}
  }
  if (body.organizationContext !== undefined) {
    updates.push("organization_context = ?"); values.push(String(body.organizationContext).substring(0, 500));
  }
  if (body.examTarget !== undefined) {
    updates.push("exam_target = ?"); values.push(String(body.examTarget).substring(0, 200));
  }

  if (updates.length === 0) return c.json({ error: "No valid fields to update" }, 400);

  updates.push("updated_at = datetime('now')");

  // Ensure row exists
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)"
  ).bind(userId).run();

  await c.env.DB.prepare(
    `UPDATE user_profiles SET ${updates.join(", ")} WHERE user_id = ?`
  ).bind(...values, userId).run();

  const profile = await c.env.DB.prepare(
    "SELECT * FROM user_profiles WHERE user_id = ?"
  ).bind(userId).first();

  return c.json({ profile });
});

// ═══════════════════════════════════════════════════════════════════
//  Smart Upgrade Nudges
// ═══════════════════════════════════════════════════════════════════

user.get("/api/usage/nudge", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureSubscriptionColumns(c.env.DB);
  const u = await c.env.DB.prepare("SELECT tier, trial_expires_at, subscription_expires_at FROM users WHERE id = ?")
    .bind(userId).first<{ tier: string; trial_expires_at: string | null; subscription_expires_at: string | null }>();

  const effectiveTier = getEffectiveTier({ tier: u?.tier || "free", trial_expires_at: u?.trial_expires_at || null, subscription_expires_at: u?.subscription_expires_at || null });

  if (effectiveTier !== "free") return c.json({ nudge: null, effectiveTier });

  const usage = await checkUsageLimit(c.env.DB, userId, effectiveTier);
  if (usage.limit <= 0) return c.json({ nudge: null, effectiveTier });

  const remaining = usage.limit - usage.used;
  const pct = usage.used / usage.limit;

  let nudge = null;
  if (remaining <= 0) {
    nudge = { type: "limit_reached", used: usage.used, limit: usage.limit, remaining: 0, message: "You've reached your daily limit. Upgrade to Professional for 200 messages/day." };
  } else if (pct >= 0.8) {
    nudge = { type: "almost_there", used: usage.used, limit: usage.limit, remaining, message: `Only ${remaining} message${remaining === 1 ? '' : 's'} left today. Upgrade to Professional for 200/day.` };
  } else if (pct >= 0.5) {
    nudge = { type: "halfway", used: usage.used, limit: usage.limit, remaining, message: `${remaining} messages remaining today. Professional plan gives you 200/day.` };
  }

  return c.json({ nudge, effectiveTier });
});

// ═══════════════════════════════════════════════════════════════════
//  Daily Streaks & Badges
// ═══════════════════════════════════════════════════════════════════

user.get("/api/streaks", authMiddleware, async (c) => {
  const userId = c.get("userId");
  await ensureStreakColumns(c.env.DB);

  const u = await c.env.DB.prepare(
    "SELECT current_streak, longest_streak, last_active_date, badges, total_referrals FROM users WHERE id = ?"
  ).bind(userId).first<{ current_streak: number; longest_streak: number; last_active_date: string | null; badges: string; total_referrals: number }>();

  if (!u) return c.json({ error: "User not found" }, 404);

  let badges: string[] = [];
  try { badges = JSON.parse(u.badges || "[]"); } catch { badges = []; }

  // Count total messages for message-based badges
  const msgCount = await c.env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM conversations WHERE user_id = ?"
  ).bind(userId).first<{ cnt: number }>();

  // Check message badges
  const msgBadges = [
    { id: "messages_10", threshold: 10 },
    { id: "messages_50", threshold: 50 },
    { id: "messages_100", threshold: 100 },
    { id: "messages_500", threshold: 500 },
  ];

  let updated = false;
  for (const b of msgBadges) {
    if (!badges.includes(b.id) && (msgCount?.cnt || 0) >= b.threshold) {
      badges.push(b.id);
      updated = true;
    }
  }

  // Referral badges
  const refBadges = [
    { id: "referral_1", threshold: 1 },
    { id: "referral_5", threshold: 5 },
    { id: "referral_10", threshold: 10 },
  ];
  for (const b of refBadges) {
    if (!badges.includes(b.id) && (u.total_referrals || 0) >= b.threshold) {
      badges.push(b.id);
      updated = true;
    }
  }

  if (updated) {
    await c.env.DB.prepare("UPDATE users SET badges = ? WHERE id = ?")
      .bind(JSON.stringify(badges), userId).run();
  }

  // Calculate today check
  const today = new Date().toISOString().split("T")[0];
  const activeToday = u.last_active_date === today;

  return c.json({
    currentStreak: u.current_streak || 0,
    longestStreak: u.longest_streak || 0,
    lastActiveDate: u.last_active_date,
    activeToday,
    badges,
    totalConversations: msgCount?.cnt || 0,
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Prompt Engineering 101 Course
// ═══════════════════════════════════════════════════════════════════

user.get("/api/prompt-course/progress", authMiddleware, async (c) => {
  const userId = c.get("userId");
  try {
    await ensureUserProfilesTable(c.env.DB);
    await ensurePromptCourseColumn(c.env.DB);
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)"
    ).bind(userId).run();
    const row = await c.env.DB.prepare(
      "SELECT prompt_course_progress FROM user_profiles WHERE user_id = ?"
    ).bind(userId).first<{ prompt_course_progress: string | null }>();
    const progress = row?.prompt_course_progress ? JSON.parse(row.prompt_course_progress) : {};
    return c.json({ progress });
  } catch (err: any) {
    log("error", "Prompt course progress error", { error: err.message });
    return c.json({ error: "Failed to load progress" }, 500);
  }
});

user.post("/api/prompt-course/grade", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { moduleId, exerciseId, userPrompt, exerciseBrief, exerciseContext } = await c.req.json();

  if (!userPrompt || userPrompt.trim().length < 15) {
    return c.json({ error: "Please write a more detailed prompt (at least 15 characters)" }, 400);
  }
  if (!moduleId || !exerciseId) {
    return c.json({ error: "Missing module or exercise ID" }, 400);
  }

  const gradingPrompt = `You are an expert prompt engineering instructor. Grade this student's prompt attempt.

EXERCISE: ${String(exerciseBrief || "").substring(0, 500)}
CONTEXT: ${String(exerciseContext || "").substring(0, 500)}

STUDENT'S PROMPT:
${userPrompt.substring(0, 2000)}

Score on these 4 axes (each 1-10):
1. Clarity — Is the intent obvious and unambiguous?
2. Specificity — Does it include concrete details, constraints, and scope?
3. Structure — Is it well-organized with role, task, context, and format?
4. Effectiveness — Would this prompt produce a high-quality AI response?

Also provide:
- feedback: 2-3 sentences of constructive feedback
- grade: letter grade (A/B/C/D/F)
- improvedVersion: rewrite their prompt to demonstrate best practices

Return ONLY a JSON object:
{"clarity": N, "specificity": N, "structure": N, "effectiveness": N, "feedback": "...", "grade": "X", "improvedVersion": "..."}`;

  try {
    const aiResponse = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
      messages: [
        { role: "system", content: "You are a prompt engineering instructor. Return ONLY valid JSON, no markdown." },
        { role: "user", content: gradingPrompt },
      ],
      max_tokens: 800,
    });

    const raw = (aiResponse as any)?.response || "";
    let scores = { clarity: 5, specificity: 5, structure: 5, effectiveness: 5, feedback: "Grading completed.", grade: "C", improvedVersion: "" };

    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        scores.clarity = Math.min(10, Math.max(1, parseInt(parsed.clarity) || 5));
        scores.specificity = Math.min(10, Math.max(1, parseInt(parsed.specificity) || 5));
        scores.structure = Math.min(10, Math.max(1, parseInt(parsed.structure) || 5));
        scores.effectiveness = Math.min(10, Math.max(1, parseInt(parsed.effectiveness) || 5));
        scores.feedback = String(parsed.feedback || "").substring(0, 2000) || "Grading completed.";
        scores.grade = ["A", "B", "C", "D", "F"].includes(parsed.grade) ? parsed.grade : "C";
        scores.improvedVersion = String(parsed.improvedVersion || "").substring(0, 3000);
      }
    } catch {}

    const totalScore = scores.clarity + scores.specificity + scores.structure + scores.effectiveness;

    // Save progress
    try {
      await ensureUserProfilesTable(c.env.DB);
      await ensurePromptCourseColumn(c.env.DB);
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)"
      ).bind(userId).run();
      const row = await c.env.DB.prepare(
        "SELECT prompt_course_progress FROM user_profiles WHERE user_id = ?"
      ).bind(userId).first<{ prompt_course_progress: string | null }>();
      const progress = row?.prompt_course_progress ? JSON.parse(row.prompt_course_progress) : {};
      if (!progress[moduleId] || (progress[moduleId].totalScore || 0) < totalScore) {
        progress[moduleId] = { exerciseId, totalScore, maxScore: 40, grade: scores.grade, completedAt: new Date().toISOString() };
      }
      await c.env.DB.prepare(
        "UPDATE user_profiles SET prompt_course_progress = ?, updated_at = datetime('now') WHERE user_id = ?"
      ).bind(JSON.stringify(progress), userId).run();
    } catch (saveErr: any) {
      log("error", "Progress save error", { error: saveErr.message });
    }

    c.executionCtx.waitUntil(trackProductivity(c, "prompt_course_exercise"));

    return c.json({
      scores: { clarity: scores.clarity, specificity: scores.specificity, structure: scores.structure, effectiveness: scores.effectiveness },
      totalScore,
      maxScore: 40,
      grade: scores.grade,
      feedback: scores.feedback,
      improvedVersion: scores.improvedVersion,
    });
  } catch (err: any) {
    log("error", "Prompt course grading error", { error: err?.message });
    return c.json({ error: "Grading failed. Please try again." }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  Self-Service Account Deletion
// ═══════════════════════════════════════════════════════════════════

user.delete("/api/account", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ confirm?: boolean }>().catch(() => ({ confirm: false }));

  if (!body.confirm) {
    return c.json({ error: "Must send { confirm: true } to delete account" }, 400);
  }

  try {
    // Cascade delete all user data via batch
    const db = c.env.DB;
    const stmts = [
      db.prepare("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)").bind(userId),
      db.prepare("DELETE FROM conversations WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM shared_conversations WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM response_feedback WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM productivity_stats WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM webauthn_credentials WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM folders WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM action_items WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM notes WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM saved_prompts WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM user_preferences WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM api_keys WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM audit_log WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM user_memories WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM user_profiles WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM document_credits WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM document_credit_transactions WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM exam_progress WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM student_profiles WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM session_tracking WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM referrals WHERE referrer_id = ? OR referred_id = ?").bind(userId, userId),
      db.prepare("DELETE FROM affiliate_commissions WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM moderation_log WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM hallucination_events WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM kb_gaps WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM user_tools WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM org_invites WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
    ];

    await db.batch(stmts);

    // Clean up current KV session
    const token = c.req.header("Authorization")?.slice(7);
    if (token) {
      await c.env.SESSIONS.delete(`session:${token}`);
    }

    return c.json({ deleted: true });
  } catch (err: any) {
    log("error", "Account deletion failed", { userId, error: err?.message });
    return c.json({ error: "Account deletion failed. Please try again." }, 500);
  }
});

// ─── Exports ────────────────────────────────────────────────────────

export {
  ensureQuizColumns,
  ensureUserProfilesTable,
  ensurePromptCourseColumn,
  ensureStreakColumns,
};

export default user;
