import { Hono } from "hono";
import type { AppType } from "../types";
import { authMiddleware } from "../lib/middleware";
import { log } from "../lib/logger";

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
      "@cf/myshell-ai/melotts-english-v2" as any,
      { prompt: body.text }
    );

    return new Response(result as ReadableStream, {
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

export default eclassroom;
