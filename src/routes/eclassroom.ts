import { Hono } from "hono";
import type { AppType } from "../types";
import { authMiddleware, adminMiddleware } from "../lib/middleware";
import { log } from "../lib/logger";
import { chunkExamQuestion, chunkLegalDocument } from "../lib/chunker";
import type { Chunk } from "../lib/chunker";
import { ingestChunks } from "../lib/ingest";
import { retrieveContext } from "../lib/retrieve";
import { buildContextBlock, buildGroundedSystemPrompt } from "../config/agent-prompts";
import type { RetrievedContext } from "../config/agent-prompts";
import { parseCitations } from "../lib/citation-parser";
import { getParams } from "../config/inference-params";

const eclassroom = new Hono<AppType>();

// ─── GET /api/eclassroom/teachers ────────────────────────────────────
// List all teachers (public)
eclassroom.get("/api/eclassroom/teachers", async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT id, name, subject, avatar_config, voice_config FROM ec_teachers ORDER BY name"
    ).all();

    const teachers = (results ?? []).map((row: any) => ({
      ...row,
      avatar_config: row.avatar_config ? JSON.parse(row.avatar_config) : null,
      voice_config: row.voice_config ? JSON.parse(row.voice_config) : null,
    }));

    return c.json({ teachers });
  } catch (err: any) {
    log("error", "eclassroom: list teachers failed", { error: err?.message });
    return c.json({ error: "Failed to fetch teachers" }, 500);
  }
});

// ─── GET /api/eclassroom/teachers/:id ────────────────────────────────
// Get single teacher with personality_prompt
eclassroom.get("/api/eclassroom/teachers/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const row: any = await c.env.DB.prepare(
      "SELECT id, name, subject, avatar_config, voice_config, personality_prompt FROM ec_teachers WHERE id = ?"
    ).bind(id).first();

    if (!row) {
      return c.json({ error: "Teacher not found" }, 404);
    }

    const teacher = {
      ...row,
      avatar_config: row.avatar_config ? JSON.parse(row.avatar_config) : null,
      voice_config: row.voice_config ? JSON.parse(row.voice_config) : null,
    };

    return c.json({ teacher });
  } catch (err: any) {
    log("error", "eclassroom: get teacher failed", { error: err?.message });
    return c.json({ error: "Failed to fetch teacher" }, 500);
  }
});

// ─── GET /api/eclassroom/lessons ─────────────────────────────────────
// List lessons with optional subject and level filters
eclassroom.get("/api/eclassroom/lessons", async (c) => {
  try {
    const subject = c.req.query("subject");
    const level = c.req.query("level");

    let sql = "SELECT id, teacher_id, topic, subject, level, estimated_minutes, xp_reward, content_json, created_at FROM ec_lessons";
    const conditions: string[] = [];
    const bindings: string[] = [];

    if (subject) {
      conditions.push("subject = ?");
      bindings.push(subject);
    }
    if (level) {
      conditions.push("level = ?");
      bindings.push(level);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY created_at DESC";

    const stmt = c.env.DB.prepare(sql);
    const { results } = bindings.length > 0
      ? await stmt.bind(...bindings).all()
      : await stmt.all();

    const lessons = (results ?? []).map((row: any) => ({
      ...row,
      content_json: undefined,
      steps: row.content_json ? JSON.parse(row.content_json) : [],
    }));

    return c.json({ lessons });
  } catch (err: any) {
    log("error", "eclassroom: list lessons failed", { error: err?.message });
    return c.json({ error: "Failed to fetch lessons" }, 500);
  }
});

// ─── GET /api/eclassroom/lessons/:id ─────────────────────────────────
// Get single lesson with parsed content_json as steps
eclassroom.get("/api/eclassroom/lessons/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const row: any = await c.env.DB.prepare(
      "SELECT id, teacher_id, topic, subject, level, estimated_minutes, xp_reward, content_json, created_at FROM ec_lessons WHERE id = ?"
    ).bind(id).first();

    if (!row) {
      return c.json({ error: "Lesson not found" }, 404);
    }

    const lesson = {
      ...row,
      content_json: undefined,
      steps: row.content_json ? JSON.parse(row.content_json) : [],
    };

    return c.json({ lesson });
  } catch (err: any) {
    log("error", "eclassroom: get lesson failed", { error: err?.message });
    return c.json({ error: "Failed to fetch lesson" }, 500);
  }
});

// ─── POST /api/eclassroom/tts ────────────────────────────────────────
// Text-to-speech via Workers AI MeloTTS
eclassroom.post("/api/eclassroom/tts", async (c) => {
  try {
    const body = await c.req.json<{ text: string; teacher?: string }>();

    if (!body.text || typeof body.text !== "string") {
      return c.json({ error: "text is required" }, 400);
    }

    if (body.text.length > 2000) {
      return c.json({ error: "Text must be 2000 characters or fewer" }, 400);
    }

    const result = await c.env.AI.run(
      "@cf/myshell-ai/melotts" as any,
      { prompt: body.text }
    );

    // MeloTTS returns an object — extract audio data
    const audioData = (result as any)?.audio;
    if (!audioData) {
      log("error", "eclassroom: TTS returned no audio", { result: JSON.stringify(result).slice(0, 200) });
      return c.json({ error: "TTS returned no audio" }, 500);
    }

    // audioData may be a Uint8Array, ArrayBuffer, or ReadableStream
    const body2 = audioData instanceof ReadableStream ? audioData :
                   audioData instanceof Uint8Array ? audioData.buffer :
                   audioData;

    return new Response(body2, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err: any) {
    log("error", "eclassroom: TTS failed", { error: err?.message });
    return c.json({ error: "TTS generation failed" }, 500);
  }
});

// ─── POST /api/eclassroom/lessons/:id/progress ───────────────────────
// Update student lesson progress (authenticated)
eclassroom.post("/api/eclassroom/lessons/:id/progress", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const lessonId = c.req.param("id");
    const body = await c.req.json<{
      current_step: number;
      completed: boolean;
      score?: number;
    }>();

    if (typeof body.current_step !== "number" || typeof body.completed !== "boolean") {
      return c.json({ error: "current_step (number) and completed (boolean) are required" }, 400);
    }

    const now = new Date().toISOString().replace("T", " ").split(".")[0];

    await c.env.DB.prepare(
      `INSERT INTO ec_student_progress (student_id, lesson_id, current_step, completed, score, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(student_id, lesson_id) DO UPDATE SET
         current_step = excluded.current_step,
         completed = excluded.completed,
         score = excluded.score,
         updated_at = excluded.updated_at`
    )
      .bind(userId, lessonId, body.current_step, body.completed ? 1 : 0, body.score ?? null, now)
      .run();

    return c.json({ success: true });
  } catch (err: any) {
    log("error", "eclassroom: update progress failed", { error: err?.message });
    return c.json({ error: "Failed to update progress" }, 500);
  }
});

// ─── POST /api/eclassroom/rag/ingest ─────────────────────────────────
// Bulk ingest exam questions or syllabus text into Vectorize (admin-only)
// Body for exam questions:
//   { type: 'exam', exam_type: 'wassce'|'bece', subject: string, year: number, paper?: number,
//     questions: Array<{ question_number: number, question_text: string, options?: Record<string,string>,
//       correct_answer?: string, explanation?: string, difficulty?: string }> }
// Body for syllabus text:
//   { type: 'syllabus', subject: string, year: number, text: string }
eclassroom.post("/api/eclassroom/rag/ingest", adminMiddleware, async (c) => {
  try {
    const body = await c.req.json<{
      type: 'exam' | 'syllabus';
      exam_type?: string;
      subject: string;
      year: number;
      paper?: number;
      text?: string;
      questions?: Array<{
        question_number: number;
        question_text: string;
        options?: Record<string, string>;
        correct_answer?: string;
        explanation?: string;
        difficulty?: string;
      }>;
    }>();

    if (!body.type || !body.subject || !body.year) {
      return c.json({ error: "type, subject, and year are required" }, 400);
    }

    const subjectSlug = body.subject.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const chunks: Chunk[] = [];

    if (body.type === 'exam') {
      if (!body.questions || !Array.isArray(body.questions) || body.questions.length === 0) {
        return c.json({ error: "questions array is required for exam type" }, 400);
      }
      if (!body.exam_type || !['wassce', 'bece'].includes(body.exam_type)) {
        return c.json({ error: "exam_type must be 'wassce' or 'bece'" }, 400);
      }

      for (const q of body.questions) {
        // Build full question text with options and explanation
        let fullText = `Q${q.question_number}. ${q.question_text}`;
        if (q.options) {
          fullText += '\n' + Object.entries(q.options).map(([k, v]) => `${k}. ${v}`).join('\n');
        }
        if (q.correct_answer) {
          fullText += `\nCorrect Answer: ${q.correct_answer}`;
        }
        if (q.explanation) {
          fullText += `\nExplanation: ${q.explanation}`;
        }

        const chunk = chunkExamQuestion(fullText, {
          subject: body.subject,
          year: body.year,
          section: `Q${q.question_number}${body.paper ? `_P${body.paper}` : ''}`,
          difficulty: q.difficulty,
        });

        // Override agent_tags with eclassroom-scoped tags
        chunk.metadata.agent_tags = ['eclassroom', body.exam_type, subjectSlug];
        // Update chunk ID to be unique per paper
        chunk.id = `ec_${body.exam_type}_${subjectSlug}_${body.year}${body.paper ? `_p${body.paper}` : ''}_q${q.question_number}`;

        chunks.push(chunk);
      }
    } else if (body.type === 'syllabus') {
      if (!body.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
        return c.json({ error: "text is required for syllabus type" }, 400);
      }

      const syllabusChunks = chunkLegalDocument(
        body.text,
        `${body.subject} Syllabus`,
        body.year,
        ['eclassroom', 'syllabus', subjectSlug]
      );
      chunks.push(...syllabusChunks);
    } else {
      return c.json({ error: "type must be 'exam' or 'syllabus'" }, 400);
    }

    const result = await ingestChunks(chunks, c.env);

    log('info', 'eclassroom: RAG ingest complete', {
      type: body.type,
      subject: body.subject,
      year: body.year,
      chunks_total: chunks.length,
      success: result.success,
      failed: result.failed,
    });

    return c.json({
      success: true,
      ingested: result.success,
      failed: result.failed,
      total_chunks: chunks.length,
    });
  } catch (err: any) {
    log("error", "eclassroom: RAG ingest failed", { error: err?.message });
    return c.json({ error: "Ingestion failed" }, 500);
  }
});

// ─── POST /api/eclassroom/rag/query ──────────────────────────────────
// RAG-grounded Q&A for eClassroom
// Body: { question: string, subject?: string, level?: string, teacher_id?: string }
eclassroom.post("/api/eclassroom/rag/query", async (c) => {
  try {
    const body = await c.req.json<{
      question: string;
      subject?: string;
      level?: string;
      teacher_id?: string;
    }>();

    if (!body.question || typeof body.question !== 'string' || body.question.trim().length === 0) {
      return c.json({ error: "question is required" }, 400);
    }

    if (body.question.length > 2000) {
      return c.json({ error: "Question must be 2000 characters or fewer" }, 400);
    }

    // Retrieve relevant context from Vectorize
    const contexts: RetrievedContext[] = await retrieveContext(
      body.question,
      'eclassroom',
      c.env,
      6
    );

    // Build context block
    const contextBlock = buildContextBlock(contexts);

    // Get teacher personality prompt if teacher_id provided
    let teacherPrompt = '';
    let teacherName = 'eClassroom Tutor';
    if (body.teacher_id) {
      const teacher: any = await c.env.DB.prepare(
        "SELECT name, personality_prompt FROM ec_teachers WHERE id = ?"
      ).bind(body.teacher_id).first();

      if (teacher) {
        teacherPrompt = teacher.personality_prompt || '';
        teacherName = teacher.name || teacherName;
      }
    }

    // Build the grounded system prompt
    const baseIdentity = teacherPrompt
      ? `You are ${teacherName}, an eClassroom AI tutor. ${teacherPrompt}\n\nYou help students with ${body.subject || 'their studies'} at the ${body.level || 'SHS'} level. Use the Socratic approach: concept → worked example → student practice.`
      : `You are an eClassroom AI tutor helping students with ${body.subject || 'their studies'} at the ${body.level || 'SHS'} level. Use the Socratic approach: concept → worked example → student practice. Be encouraging and clear.`;

    const systemPrompt = buildGroundedSystemPrompt(
      teacherName,
      baseIdentity,
      'wassce', // knowledge category for authority lookup
      contextBlock
    );

    // Get inference params for eclassroom (use wassce params)
    const params = getParams('wassce');

    // Generate response via Workers AI
    const aiResponse = await c.env.AI.run(params.model as any, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: body.question },
      ],
      temperature: params.temperature,
      top_p: params.top_p,
      top_k: params.top_k,
      max_tokens: params.max_tokens,
    });

    const rawAnswer = (aiResponse as any)?.response || '';

    // Parse citations
    const cited = parseCitations(rawAnswer, contexts);

    // Determine confidence based on context availability
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (contexts.length >= 3 && !cited.has_uncited_claims) {
      confidence = 'high';
    } else if (contexts.length >= 1) {
      confidence = 'medium';
    }

    return c.json({
      answer: cited.text,
      citations: cited.citations,
      confidence,
      sources_used: contexts.length,
      teacher: teacherName,
      has_uncited_claims: cited.has_uncited_claims,
    });
  } catch (err: any) {
    log("error", "eclassroom: RAG query failed", { error: err?.message });
    return c.json({ error: "Query failed" }, 500);
  }
});

// ─── GET /api/eclassroom/rag/documents ───────────────────────────────
// List ingested eClassroom documents from D1
eclassroom.get("/api/eclassroom/rag/documents", adminMiddleware, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT document, COUNT(*) as chunks, MAX(embedded_at) as last_updated
       FROM knowledge_documents
       WHERE metadata LIKE '%eclassroom%'
       GROUP BY document
       ORDER BY document`
    ).all();

    return c.json({ documents: results ?? [] });
  } catch (err: any) {
    log("error", "eclassroom: list documents failed", { error: err?.message });
    return c.json({ error: "Failed to fetch documents" }, 500);
  }
});

// ─── HELPER: Get or create ec_students record ──────────────────────────
async function getOrCreateStudent(db: D1Database, userId: string): Promise<{ id: string; level: string }> {
  const existing: any = await db.prepare(
    "SELECT id, level FROM ec_students WHERE user_id = ?"
  ).bind(userId).first();

  if (existing) return { id: existing.id, level: existing.level };

  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO ec_students (id, user_id, level) VALUES (?, ?, 'shs1')"
  ).bind(id, userId).run();

  return { id, level: 'shs1' };
}

// ─── HELPER: Calculate XP level ─────────────────────────────────────────
function xpLevel(totalXp: number): string {
  if (totalXp >= 5000) return 'Expert';
  if (totalXp >= 2000) return 'Master';
  if (totalXp >= 500) return 'Scholar';
  return 'Trainee';
}

// ─── HELPER: Update streak ──────────────────────────────────────────────
async function updateStreak(db: D1Database, studentId: string): Promise<{ current_streak: number; longest_streak: number; streak_multiplier: number }> {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];

  const row: any = await db.prepare(
    "SELECT id, current_streak, longest_streak, last_activity_date, streak_multiplier FROM ec_streaks WHERE student_id = ?"
  ).bind(studentId).first();

  if (!row) {
    const id = crypto.randomUUID();
    await db.prepare(
      "INSERT INTO ec_streaks (id, student_id, current_streak, longest_streak, last_activity_date, streak_multiplier, updated_at) VALUES (?, ?, 1, 1, ?, 1.0, ?)"
    ).bind(id, studentId, todayStr, todayStr).run();
    return { current_streak: 1, longest_streak: 1, streak_multiplier: 1.0 };
  }

  if (row.last_activity_date === todayStr) {
    return { current_streak: row.current_streak, longest_streak: row.longest_streak, streak_multiplier: row.streak_multiplier };
  }

  let newStreak: number;
  if (row.last_activity_date === yesterday) {
    newStreak = row.current_streak + 1;
  } else {
    newStreak = 1;
  }

  const newLongest = Math.max(newStreak, row.longest_streak);
  const multiplier = Math.min(2.0, 1.0 + (newStreak - 1) * 0.1);

  await db.prepare(
    "UPDATE ec_streaks SET current_streak = ?, longest_streak = ?, last_activity_date = ?, streak_multiplier = ?, updated_at = ? WHERE id = ?"
  ).bind(newStreak, newLongest, todayStr, multiplier, todayStr, row.id).run();

  return { current_streak: newStreak, longest_streak: newLongest, streak_multiplier: multiplier };
}

// ─── HELPER: Check and award badges ─────────────────────────────────────
async function checkBadges(db: D1Database, studentId: string, streak: number): Promise<Array<{ badge_type: string; badge_name: string }>> {
  const newBadges: Array<{ badge_type: string; badge_name: string }> = [];
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  // Fetch all XP records for this student
  const { results: xpRows } = await db.prepare(
    "SELECT subject, total_xp FROM ec_student_xp WHERE student_id = ?"
  ).bind(studentId).all();
  const xpMap = new Map<string, number>();
  for (const r of (xpRows ?? []) as any[]) {
    xpMap.set(r.subject.toLowerCase(), r.total_xp);
  }

  // Fetch existing badges
  const { results: badgeRows } = await db.prepare(
    "SELECT badge_type FROM ec_badges WHERE student_id = ?"
  ).bind(studentId).all();
  const existingBadges = new Set((badgeRows ?? []).map((b: any) => b.badge_type));

  const badgeDefs: Array<{ type: string; name: string; check: () => boolean }> = [
    { type: 'first_lesson', name: 'First Steps', check: () => xpMap.size > 0 },
    { type: 'math_master', name: 'Math Master', check: () => (xpMap.get('mathematics') ?? 0) >= 1000 },
    { type: 'science_star', name: 'Science Star', check: () => (xpMap.get('science') ?? xpMap.get('integrated science') ?? 0) >= 1000 },
    { type: 'streak_7', name: '7-Day Streak', check: () => streak >= 7 },
    { type: 'streak_30', name: '30-Day Streak', check: () => streak >= 30 },
    {
      type: 'bece_ready', name: 'BECE Ready', check: () => {
        const beceSubjects = ['mathematics', 'english', 'integrated science', 'social studies'];
        return beceSubjects.every(s => (xpMap.get(s) ?? 0) > 0);
      }
    },
    {
      type: 'wassce_warrior', name: 'WASSCE Warrior', check: () => {
        const wassceCore = ['mathematics', 'english', 'integrated science', 'social studies'];
        return wassceCore.every(s => (xpMap.get(s) ?? 0) > 0);
      }
    },
  ];

  for (const bd of badgeDefs) {
    if (!existingBadges.has(bd.type) && bd.check()) {
      const id = crypto.randomUUID();
      try {
        await db.prepare(
          "INSERT INTO ec_badges (id, student_id, badge_type, badge_name, earned_at) VALUES (?, ?, ?, ?, ?)"
        ).bind(id, studentId, bd.type, bd.name, now).run();
        newBadges.push({ badge_type: bd.type, badge_name: bd.name });
      } catch (_) {
        // UNIQUE constraint — badge already exists, skip
      }
    }
  }

  return newBadges;
}

// ─── POST /api/eclassroom/xp/award ──────────────────────────────────────
// Award XP to the authenticated student
eclassroom.post("/api/eclassroom/xp/award", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const body = await c.req.json<{ subject: string; xp: number; reason: string }>();

    if (!body.subject || typeof body.xp !== 'number' || body.xp <= 0 || !body.reason) {
      return c.json({ error: "subject (string), xp (positive number), and reason (string) are required" }, 400);
    }

    if (body.xp > 500) {
      return c.json({ error: "Maximum XP per award is 500" }, 400);
    }

    const student = await getOrCreateStudent(c.env.DB, userId);
    const now = new Date().toISOString().replace('T', ' ').split('.')[0];
    const subjectLower = body.subject.toLowerCase();

    // UPSERT XP
    await c.env.DB.prepare(
      `INSERT INTO ec_student_xp (id, student_id, subject, total_xp, current_level, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(student_id, subject) DO UPDATE SET
         total_xp = total_xp + excluded.total_xp,
         current_level = excluded.current_level,
         updated_at = excluded.updated_at`
    ).bind(crypto.randomUUID(), student.id, subjectLower, body.xp, xpLevel(body.xp), now).run();

    // Get updated total
    const xpRow: any = await c.env.DB.prepare(
      "SELECT total_xp FROM ec_student_xp WHERE student_id = ? AND subject = ?"
    ).bind(student.id, subjectLower).first();
    const totalXp = xpRow?.total_xp ?? body.xp;
    const level = xpLevel(totalXp);

    // Update the level in the XP row
    await c.env.DB.prepare(
      "UPDATE ec_student_xp SET current_level = ? WHERE student_id = ? AND subject = ?"
    ).bind(level, student.id, subjectLower).run();

    // Update streak
    const streak = await updateStreak(c.env.DB, student.id);

    // Check badges
    const newBadges = await checkBadges(c.env.DB, student.id, streak.current_streak);

    return c.json({
      total_xp: totalXp,
      level,
      streak: {
        current: streak.current_streak,
        longest: streak.longest_streak,
        multiplier: streak.streak_multiplier,
      },
      new_badges: newBadges,
    });
  } catch (err: any) {
    log("error", "eclassroom: award XP failed", { error: err?.message });
    return c.json({ error: "Failed to award XP" }, 500);
  }
});

// ─── GET /api/eclassroom/xp/profile ─────────────────────────────────────
// Get the authenticated student's XP profile
eclassroom.get("/api/eclassroom/xp/profile", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const student = await getOrCreateStudent(c.env.DB, userId);

    const { results: xpRows } = await c.env.DB.prepare(
      "SELECT subject, total_xp, current_level FROM ec_student_xp WHERE student_id = ? ORDER BY total_xp DESC"
    ).bind(student.id).all();

    const { results: badgeRows } = await c.env.DB.prepare(
      "SELECT badge_type, badge_name, earned_at FROM ec_badges WHERE student_id = ? ORDER BY earned_at DESC"
    ).bind(student.id).all();

    const streakRow: any = await c.env.DB.prepare(
      "SELECT current_streak, longest_streak, streak_multiplier FROM ec_streaks WHERE student_id = ?"
    ).bind(student.id).first();

    return c.json({
      subjects: (xpRows ?? []).map((r: any) => ({
        subject: r.subject,
        total_xp: r.total_xp,
        level: r.current_level,
      })),
      streak: {
        current: streakRow?.current_streak ?? 0,
        longest: streakRow?.longest_streak ?? 0,
        multiplier: streakRow?.streak_multiplier ?? 1.0,
      },
      badges: (badgeRows ?? []).map((b: any) => ({
        badge_type: b.badge_type,
        badge_name: b.badge_name,
        earned_at: b.earned_at,
      })),
    });
  } catch (err: any) {
    log("error", "eclassroom: get XP profile failed", { error: err?.message });
    return c.json({ error: "Failed to fetch XP profile" }, 500);
  }
});

// ─── GET /api/eclassroom/leaderboard ────────────────────────────────────
// Public leaderboard with optional subject and period filters
eclassroom.get("/api/eclassroom/leaderboard", async (c) => {
  try {
    const subject = c.req.query("subject");
    const period = c.req.query("period") || "alltime";

    if (!['weekly', 'monthly', 'alltime'].includes(period)) {
      return c.json({ error: "period must be weekly, monthly, or alltime" }, 400);
    }

    let sql = `SELECT xp.student_id, xp.total_xp, xp.current_level, s.user_id
               FROM ec_student_xp xp
               JOIN ec_students s ON s.id = xp.student_id`;
    const conditions: string[] = [];
    const bindings: string[] = [];

    if (subject) {
      conditions.push("xp.subject = ?");
      bindings.push(subject.toLowerCase());
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    // For weekly/monthly we'd filter by updated_at but since XP is cumulative,
    // we order by total and note the period scope for future refinement
    sql += " ORDER BY xp.total_xp DESC LIMIT 20";

    const stmt = c.env.DB.prepare(sql);
    const { results } = bindings.length > 0
      ? await stmt.bind(...bindings).all()
      : await stmt.all();

    const rankings = (results ?? []).map((r: any, i: number) => ({
      rank: i + 1,
      student_id: r.student_id,
      total_xp: r.total_xp,
      level: r.current_level,
    }));

    return c.json({ rankings, period, subject: subject || 'all' });
  } catch (err: any) {
    log("error", "eclassroom: leaderboard failed", { error: err?.message });
    return c.json({ error: "Failed to fetch leaderboard" }, 500);
  }
});

// ─── POST /api/eclassroom/flashcards/generate ───────────────────────────
// AI-generate flashcards from a lesson
eclassroom.post("/api/eclassroom/flashcards/generate", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const body = await c.req.json<{ lesson_id: string }>();

    if (!body.lesson_id) {
      return c.json({ error: "lesson_id is required" }, 400);
    }

    const student = await getOrCreateStudent(c.env.DB, userId);

    // Fetch lesson
    const lesson: any = await c.env.DB.prepare(
      "SELECT id, topic, subject, level, content_json FROM ec_lessons WHERE id = ?"
    ).bind(body.lesson_id).first();

    if (!lesson) {
      return c.json({ error: "Lesson not found" }, 404);
    }

    const steps = lesson.content_json ? JSON.parse(lesson.content_json) : [];
    const lessonText = steps.map((s: any) => `${s.title || ''}: ${s.content || s.text || ''}`).join('\n');

    // Generate flashcards via Workers AI
    const aiResponse = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct' as any, {
      messages: [
        {
          role: 'system',
          content: `You are a study tool generator. Generate 5-8 flashcard pairs from the lesson content. Return ONLY a JSON array of objects with "front" (question) and "back" (answer) fields. Keep answers concise (1-3 sentences). No markdown, no explanation, just the JSON array.`
        },
        {
          role: 'user',
          content: `Generate flashcards from this ${lesson.subject} lesson titled "${lesson.topic}":\n\n${lessonText.substring(0, 3000)}`
        },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const rawText = (aiResponse as any)?.response || '[]';

    // Parse the JSON array from AI response
    let cards: Array<{ front: string; back: string }> = [];
    try {
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        cards = JSON.parse(jsonMatch[0]);
      }
    } catch (_) {
      return c.json({ error: "Failed to parse AI-generated flashcards" }, 500);
    }

    if (!Array.isArray(cards) || cards.length === 0) {
      return c.json({ error: "AI did not generate valid flashcards" }, 500);
    }

    const now = new Date().toISOString().replace('T', ' ').split('.')[0];
    const insertedCards: any[] = [];

    for (const card of cards.slice(0, 8)) {
      if (!card.front || !card.back) continue;
      const id = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO ec_flashcards (id, student_id, lesson_id, subject, level, front, back, ease_factor, interval_days, repetitions, next_review, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 2.5, 1, 0, ?, ?)`
      ).bind(id, student.id, body.lesson_id, lesson.subject, lesson.level, card.front, card.back, now, now).run();
      insertedCards.push({ id, front: card.front, back: card.back });
    }

    return c.json({ flashcards: insertedCards, count: insertedCards.length });
  } catch (err: any) {
    log("error", "eclassroom: generate flashcards failed", { error: err?.message });
    return c.json({ error: "Failed to generate flashcards" }, 500);
  }
});

// ─── GET /api/eclassroom/flashcards/due ─────────────────────────────────
// Get flashcards due for review
eclassroom.get("/api/eclassroom/flashcards/due", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const student = await getOrCreateStudent(c.env.DB, userId);

    const { results } = await c.env.DB.prepare(
      `SELECT id, lesson_id, subject, level, front, back, ease_factor, interval_days, repetitions, next_review
       FROM ec_flashcards
       WHERE student_id = ? AND next_review <= datetime('now')
       ORDER BY next_review ASC
       LIMIT 20`
    ).bind(student.id).all();

    return c.json({ flashcards: results ?? [], count: (results ?? []).length });
  } catch (err: any) {
    log("error", "eclassroom: get due flashcards failed", { error: err?.message });
    return c.json({ error: "Failed to fetch due flashcards" }, 500);
  }
});

// ─── POST /api/eclassroom/flashcards/:id/review ─────────────────────────
// Record a flashcard review using the SM-2 algorithm
eclassroom.post("/api/eclassroom/flashcards/:id/review", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const cardId = c.req.param("id");
    const body = await c.req.json<{ quality: number }>();

    if (typeof body.quality !== 'number' || body.quality < 0 || body.quality > 5) {
      return c.json({ error: "quality must be a number between 0 and 5" }, 400);
    }

    const student = await getOrCreateStudent(c.env.DB, userId);

    const card: any = await c.env.DB.prepare(
      "SELECT id, subject, ease_factor, interval_days, repetitions FROM ec_flashcards WHERE id = ? AND student_id = ?"
    ).bind(cardId, student.id).first();

    if (!card) {
      return c.json({ error: "Flashcard not found" }, 404);
    }

    const q = body.quality;
    let repetitions = card.repetitions;
    let interval = card.interval_days;
    let easeFactor = card.ease_factor;

    // SM-2 algorithm
    if (q < 3) {
      repetitions = 0;
      interval = 1;
    } else {
      if (repetitions === 0) {
        interval = 1;
      } else if (repetitions === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * easeFactor);
      }
      repetitions++;
    }

    easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

    // Calculate next review date
    const nextReview = new Date(Date.now() + interval * 86400000).toISOString().replace('T', ' ').split('.')[0];

    await c.env.DB.prepare(
      "UPDATE ec_flashcards SET ease_factor = ?, interval_days = ?, repetitions = ?, next_review = ? WHERE id = ?"
    ).bind(easeFactor, interval, repetitions, nextReview, cardId).run();

    // Award 10 XP for reviewing a flashcard
    const now = new Date().toISOString().replace('T', ' ').split('.')[0];
    await c.env.DB.prepare(
      `INSERT INTO ec_student_xp (id, student_id, subject, total_xp, current_level, updated_at)
       VALUES (?, ?, ?, 10, 'Trainee', ?)
       ON CONFLICT(student_id, subject) DO UPDATE SET
         total_xp = total_xp + 10,
         updated_at = excluded.updated_at`
    ).bind(crypto.randomUUID(), student.id, card.subject.toLowerCase(), now).run();

    // Update level after XP award
    const xpRow: any = await c.env.DB.prepare(
      "SELECT total_xp FROM ec_student_xp WHERE student_id = ? AND subject = ?"
    ).bind(student.id, card.subject.toLowerCase()).first();
    if (xpRow) {
      await c.env.DB.prepare(
        "UPDATE ec_student_xp SET current_level = ? WHERE student_id = ? AND subject = ?"
      ).bind(xpLevel(xpRow.total_xp), student.id, card.subject.toLowerCase()).run();
    }

    return c.json({
      next_review: nextReview,
      ease_factor: easeFactor,
      interval_days: interval,
    });
  } catch (err: any) {
    log("error", "eclassroom: flashcard review failed", { error: err?.message });
    return c.json({ error: "Failed to record review" }, 500);
  }
});

// ─── POST /api/eclassroom/study-tools/generate ──────────────────────────
// Generate study tools (flashcards and/or quiz) from a lesson
eclassroom.post("/api/eclassroom/study-tools/generate", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const body = await c.req.json<{ lesson_id: string; tools: Array<'flashcards' | 'quiz'> }>();

    if (!body.lesson_id || !body.tools || !Array.isArray(body.tools) || body.tools.length === 0) {
      return c.json({ error: "lesson_id and tools (array of 'flashcards'|'quiz') are required" }, 400);
    }

    const validTools = body.tools.filter(t => t === 'flashcards' || t === 'quiz');
    if (validTools.length === 0) {
      return c.json({ error: "tools must contain 'flashcards' and/or 'quiz'" }, 400);
    }

    const student = await getOrCreateStudent(c.env.DB, userId);

    // Fetch lesson
    const lesson: any = await c.env.DB.prepare(
      "SELECT id, topic, subject, level, content_json FROM ec_lessons WHERE id = ?"
    ).bind(body.lesson_id).first();

    if (!lesson) {
      return c.json({ error: "Lesson not found" }, 404);
    }

    const steps = lesson.content_json ? JSON.parse(lesson.content_json) : [];
    const lessonText = steps.map((s: any) => `${s.title || ''}: ${s.content || s.text || ''}`).join('\n').substring(0, 3000);

    const result: any = {};

    // Generate flashcards
    if (validTools.includes('flashcards')) {
      const aiResponse = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct' as any, {
        messages: [
          {
            role: 'system',
            content: `You are a study tool generator. Generate 5-8 flashcard pairs from the lesson content. Return ONLY a JSON array of objects with "front" (question) and "back" (answer) fields. Keep answers concise (1-3 sentences). No markdown, no explanation, just the JSON array.`
          },
          {
            role: 'user',
            content: `Generate flashcards from this ${lesson.subject} lesson titled "${lesson.topic}":\n\n${lessonText}`
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      });

      const rawText = (aiResponse as any)?.response || '[]';
      let cards: Array<{ front: string; back: string }> = [];
      try {
        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        if (jsonMatch) cards = JSON.parse(jsonMatch[0]);
      } catch (_) { /* parse failed */ }

      const now = new Date().toISOString().replace('T', ' ').split('.')[0];
      const insertedCards: any[] = [];

      for (const card of (cards || []).slice(0, 8)) {
        if (!card.front || !card.back) continue;
        const id = crypto.randomUUID();
        await c.env.DB.prepare(
          `INSERT INTO ec_flashcards (id, student_id, lesson_id, subject, level, front, back, ease_factor, interval_days, repetitions, next_review, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 2.5, 1, 0, ?, ?)`
        ).bind(id, student.id, body.lesson_id, lesson.subject, lesson.level, card.front, card.back, now, now).run();
        insertedCards.push({ id, front: card.front, back: card.back });
      }

      result.flashcards = insertedCards;
    }

    // Generate quiz
    if (validTools.includes('quiz')) {
      const aiResponse = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct' as any, {
        messages: [
          {
            role: 'system',
            content: `You are a quiz generator. Generate a 10-question multiple-choice quiz from the lesson content. Return ONLY a JSON array of objects with these fields: "question_number" (1-10), "question" (the question text), "options" (object with keys A, B, C, D and string values), "correct" (the correct letter A/B/C/D). No markdown, no explanation, just the JSON array.`
          },
          {
            role: 'user',
            content: `Generate a quiz from this ${lesson.subject} lesson titled "${lesson.topic}":\n\n${lessonText}`
          },
        ],
        temperature: 0.3,
        max_tokens: 3000,
      });

      const rawText = (aiResponse as any)?.response || '[]';
      let questions: Array<{ question_number: number; question: string; options: Record<string, string>; correct: string }> = [];
      try {
        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        if (jsonMatch) questions = JSON.parse(jsonMatch[0]);
      } catch (_) { /* parse failed */ }

      result.quiz = {
        lesson_id: body.lesson_id,
        subject: lesson.subject,
        level: lesson.level,
        questions: questions.slice(0, 10),
      };
    }

    return c.json(result);
  } catch (err: any) {
    log("error", "eclassroom: generate study tools failed", { error: err?.message });
    return c.json({ error: "Failed to generate study tools" }, 500);
  }
});

// ─── POST /api/eclassroom/quiz/submit ───────────────────────────────────
// Submit quiz answers and get results
eclassroom.post("/api/eclassroom/quiz/submit", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const body = await c.req.json<{
      lesson_id: string;
      subject: string;
      level: string;
      answers: Array<{ question_number: number; selected: string; correct: string }>;
    }>();

    if (!body.lesson_id || !body.subject || !body.level || !body.answers || !Array.isArray(body.answers)) {
      return c.json({ error: "lesson_id, subject, level, and answers array are required" }, 400);
    }

    if (body.answers.length === 0) {
      return c.json({ error: "answers array must not be empty" }, 400);
    }

    const student = await getOrCreateStudent(c.env.DB, userId);

    // Calculate score
    const total = body.answers.length;
    let correctCount = 0;
    for (const a of body.answers) {
      if (a.selected && a.correct && a.selected.toUpperCase() === a.correct.toUpperCase()) {
        correctCount++;
      }
    }

    const percentage = Math.round((correctCount / total) * 100);
    const now = new Date().toISOString().replace('T', ' ').split('.')[0];

    // Insert quiz result
    const resultId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO ec_quiz_results (id, student_id, lesson_id, subject, level, score, total_questions, answers_json, taken_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(resultId, student.id, body.lesson_id, body.subject, body.level, correctCount, total, JSON.stringify(body.answers), now).run();

    // Award XP if score >= 70%
    let xpEarned = 0;
    if (percentage >= 70) {
      xpEarned = 50;
      await c.env.DB.prepare(
        `INSERT INTO ec_student_xp (id, student_id, subject, total_xp, current_level, updated_at)
         VALUES (?, ?, ?, 50, 'Trainee', ?)
         ON CONFLICT(student_id, subject) DO UPDATE SET
           total_xp = total_xp + 50,
           updated_at = excluded.updated_at`
      ).bind(crypto.randomUUID(), student.id, body.subject.toLowerCase(), now).run();

      // Update level
      const xpRow: any = await c.env.DB.prepare(
        "SELECT total_xp FROM ec_student_xp WHERE student_id = ? AND subject = ?"
      ).bind(student.id, body.subject.toLowerCase()).first();
      if (xpRow) {
        await c.env.DB.prepare(
          "UPDATE ec_student_xp SET current_level = ? WHERE student_id = ? AND subject = ?"
        ).bind(xpLevel(xpRow.total_xp), student.id, body.subject.toLowerCase()).run();
      }

      // Update streak
      await updateStreak(c.env.DB, student.id);
    }

    return c.json({
      score: correctCount,
      total,
      percentage,
      xp_earned: xpEarned,
    });
  } catch (err: any) {
    log("error", "eclassroom: quiz submit failed", { error: err?.message });
    return c.json({ error: "Failed to submit quiz" }, 500);
  }
});

// ─── POST /api/eclassroom/audio/generate ─────────────────────────────
// Generate TTS audio summary for a lesson (auth required)
eclassroom.post("/api/eclassroom/audio/generate", authMiddleware, async (c) => {
  try {
    // Ensure ec_audio_lessons table exists
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS ec_audio_lessons (
        id TEXT PRIMARY KEY,
        lesson_id TEXT NOT NULL UNIQUE,
        r2_key TEXT NOT NULL,
        duration_estimate INTEGER,
        generated_at TEXT DEFAULT (datetime('now'))
      )
    `).run();

    const body = await c.req.json<{ lesson_id: string }>();
    if (!body?.lesson_id) {
      return c.json({ error: "lesson_id is required" }, 400);
    }

    // Fetch lesson from D1
    const lesson: any = await c.env.DB.prepare(
      "SELECT id, topic, subject, level, content_json FROM ec_lessons WHERE id = ?"
    ).bind(body.lesson_id).first();

    if (!lesson) {
      return c.json({ error: "Lesson not found" }, 404);
    }

    // Combine all voice_scripts (or fallback to content/text) from steps into lecture text
    const steps: any[] = lesson.content_json ? JSON.parse(lesson.content_json) : [];
    const rawLecture = steps
      .map((s: any) => s.voice_script || s.content || s.text || "")
      .filter(Boolean)
      .join(" ");

    // Truncate to 2000 chars (Workers AI TTS limit)
    const lectureText = rawLecture.substring(0, 2000);

    if (!lectureText.trim()) {
      return c.json({ error: "No text content found in lesson steps" }, 422);
    }

    // Generate TTS audio via Workers AI
    const ttsResponse = await c.env.AI.run(
      "@cf/myshell-ai/melotts" as any,
      { prompt: lectureText }
    );

    // ttsResponse is an ArrayBuffer or similar binary
    const audioBuffer = ttsResponse as unknown as ArrayBuffer;

    // Store audio in R2
    const r2Key = `eclassroom/audio/${body.lesson_id}.wav`;
    await c.env.KNOWLEDGE_R2.put(r2Key, audioBuffer, {
      httpMetadata: { contentType: "audio/wav" },
    });

    // Rough duration estimate: ~150 words per minute, ~5 chars per word
    const wordCount = Math.ceil(lectureText.length / 5);
    const durationEstimate = Math.ceil((wordCount / 150) * 60); // seconds

    const audioId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Insert or update record in ec_audio_lessons
    await c.env.DB.prepare(
      `INSERT INTO ec_audio_lessons (id, lesson_id, r2_key, duration_estimate, generated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(lesson_id) DO UPDATE SET
         r2_key = excluded.r2_key,
         duration_estimate = excluded.duration_estimate,
         generated_at = excluded.generated_at`
    ).bind(audioId, body.lesson_id, r2Key, durationEstimate, now).run();

    log("info", "eclassroom: audio generated", { lesson_id: body.lesson_id, r2Key });

    return c.json({ audio_id: audioId, r2_key: r2Key, duration_estimate: durationEstimate });
  } catch (err: any) {
    log("error", "eclassroom: audio generate failed", { error: err?.message });
    return c.json({ error: "Failed to generate audio" }, 500);
  }
});

// ─── GET /api/eclassroom/audio/:lesson_id ─────────────────────────────
// Stream audio for a lesson (public)
eclassroom.get("/api/eclassroom/audio/:lesson_id", async (c) => {
  try {
    const lessonId = c.req.param("lesson_id");

    const row: any = await c.env.DB.prepare(
      "SELECT r2_key FROM ec_audio_lessons WHERE lesson_id = ?"
    ).bind(lessonId).first();

    if (!row) {
      return c.json({ error: "Audio not found for this lesson" }, 404);
    }

    const obj = await c.env.KNOWLEDGE_R2.get(row.r2_key);
    if (!obj) {
      return c.json({ error: "Audio file missing from storage" }, 404);
    }

    return new Response(obj.body as ReadableStream, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err: any) {
    log("error", "eclassroom: audio fetch failed", { error: err?.message });
    return c.json({ error: "Failed to fetch audio" }, 500);
  }
});

// ─── GET /api/eclassroom/audio ────────────────────────────────────────
// List all available audio lessons (public)
eclassroom.get("/api/eclassroom/audio", async (c) => {
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT
        al.lesson_id,
        el.topic,
        el.subject,
        el.level,
        al.duration_estimate,
        al.generated_at
      FROM ec_audio_lessons al
      JOIN ec_lessons el ON el.id = al.lesson_id
      ORDER BY al.generated_at DESC
    `).all();

    return c.json({ audio_lessons: results ?? [] });
  } catch (err: any) {
    log("error", "eclassroom: audio list failed", { error: err?.message });
    return c.json({ error: "Failed to list audio lessons" }, 500);
  }
});

// ─── Helper: ensure ec_classrooms table exists ──────────────────────
async function ensureClassroomsTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS ec_classrooms (
      id TEXT PRIMARY KEY,
      join_code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      lesson_id TEXT,
      type TEXT DEFAULT 'study_group',
      created_by TEXT,
      status TEXT DEFAULT 'active',
      max_students INTEGER DEFAULT 50,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
}

// ─── Helper: generate 6-char join code ───────────────────────────────
function generateJoinCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(3)))
    .map((b) => b.toString(36).toUpperCase())
    .join("")
    .slice(0, 6);
}

// ─── POST /api/eclassroom/classroom/create ───────────────────────────
// Create a live classroom room (auth required)
eclassroom.post("/api/eclassroom/classroom/create", authMiddleware, async (c) => {
  try {
    const { title, lesson_id, type } = await c.req.json<{
      title: string;
      lesson_id?: string;
      type?: "ai_led" | "study_group";
    }>();

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return c.json({ error: "Title is required" }, 400);
    }

    await ensureClassroomsTable(c.env.DB);

    const classroomId = crypto.randomUUID();
    const joinCode = generateJoinCode();
    const classroomType = type === "ai_led" ? "ai_led" : "study_group";
    const userId = c.get("userId");

    await c.env.DB.prepare(
      "INSERT INTO ec_classrooms (id, join_code, title, lesson_id, type, created_by) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(classroomId, joinCode, title.trim(), lesson_id ?? null, classroomType, userId)
      .run();

    return c.json({ join_code: joinCode, classroom_id: classroomId });
  } catch (err: any) {
    log("error", "eclassroom: create classroom failed", { error: err?.message });
    return c.json({ error: "Failed to create classroom" }, 500);
  }
});

// ─── POST /api/eclassroom/classroom/join ─────────────────────────────
// Join a classroom by code
eclassroom.post("/api/eclassroom/classroom/join", async (c) => {
  try {
    const { join_code } = await c.req.json<{ join_code: string }>();

    if (!join_code || typeof join_code !== "string") {
      return c.json({ error: "Join code is required" }, 400);
    }

    await ensureClassroomsTable(c.env.DB);

    const row: any = await c.env.DB.prepare(
      "SELECT id, title, max_students, status FROM ec_classrooms WHERE join_code = ?"
    )
      .bind(join_code.trim().toUpperCase())
      .first();

    if (!row) {
      return c.json({ error: "Classroom not found" }, 404);
    }

    if (row.status !== "active") {
      return c.json({ error: "Classroom is no longer active" }, 410);
    }

    // Check current occupancy via the DO
    const doId = c.env.CLASSROOM_DO.idFromName(row.id);
    const stub = c.env.CLASSROOM_DO.get(doId);
    const infoRes = await stub.fetch(new Request("https://do/info"));
    const info = (await infoRes.json()) as { students: number };

    if (info.students >= (row.max_students ?? 50)) {
      return c.json({ error: "Classroom is full" }, 409);
    }

    return c.json({
      classroom_id: row.id,
      title: row.title,
    });
  } catch (err: any) {
    log("error", "eclassroom: join classroom failed", { error: err?.message });
    return c.json({ error: "Failed to join classroom" }, 500);
  }
});

// ─── GET /api/eclassroom/classroom/:id/ws ────────────────────────────
// WebSocket upgrade to Durable Object
eclassroom.get("/api/eclassroom/classroom/:id/ws", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 426);
  }

  const classroomId = c.req.param("id");
  const doId = c.env.CLASSROOM_DO.idFromName(classroomId);
  const stub = c.env.CLASSROOM_DO.get(doId);

  // Forward the original request (with query params for studentId/name) to the DO
  return stub.fetch(c.req.raw);
});

// ─── GET /api/eclassroom/classroom/:id/info ──────────────────────────
// Get room info from Durable Object
eclassroom.get("/api/eclassroom/classroom/:id/info", async (c) => {
  try {
    const classroomId = c.req.param("id");
    const doId = c.env.CLASSROOM_DO.idFromName(classroomId);
    const stub = c.env.CLASSROOM_DO.get(doId);

    const infoRes = await stub.fetch(new Request("https://do/info"));
    const info = await infoRes.json();

    return c.json(info);
  } catch (err: any) {
    log("error", "eclassroom: get classroom info failed", { error: err?.message });
    return c.json({ error: "Failed to get classroom info" }, 500);
  }
});

export default eclassroom;
