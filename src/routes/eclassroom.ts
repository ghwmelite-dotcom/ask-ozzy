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

export default eclassroom;
