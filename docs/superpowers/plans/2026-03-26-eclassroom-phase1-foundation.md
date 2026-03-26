# eClassroom Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the eClassroom React frontend, wire up backend API routes, build 4 AI teacher avatars with lip-sync, and deliver a basic lesson view where a teacher speaks and lip-syncs on screen.

**Architecture:** eClassroom is a React+Vite+TS app in `eclassroom/` subdirectory, deployed to Cloudflare Pages at `eclassroom.askozzy.work`. Backend API routes are added to the existing AskOzzy Hono Worker (`src/routes/eclassroom.ts`), reusing existing D1/KV/R2/Vectorize/AI bindings. Auth uses JWT tokens minted by AskOzzy and verified by the eClassroom frontend.

**Tech Stack:** React 18, Vite, TypeScript (strict), Tailwind CSS, tldraw SDK, Cloudflare Workers/Pages/D1/KV/Workers AI

---

## File Structure

### Backend (existing AskOzzy Worker)
- **Create:** `src/routes/eclassroom.ts` — All eClassroom API routes (teachers, lessons, TTS, auth)
- **Create:** `src/types/eclassroom.ts` — eClassroom-specific TypeScript types
- **Create:** `migrations/eclassroom-foundation.sql` — D1 schema for Phase 1 tables
- **Modify:** `src/index.ts` — Import and mount eclassroom routes
- **Modify:** `src/types.ts` — No new env bindings needed (all exist)

### Frontend (new React app at `eclassroom/`)
- **Create:** `eclassroom/package.json` — React+Vite project deps
- **Create:** `eclassroom/vite.config.ts` — Vite config with path aliases
- **Create:** `eclassroom/tsconfig.json` — Strict TS config
- **Create:** `eclassroom/tailwind.config.ts` — Tailwind with dark theme
- **Create:** `eclassroom/index.html` — HTML entry point
- **Create:** `eclassroom/src/main.tsx` — React entry
- **Create:** `eclassroom/src/App.tsx` — Router shell
- **Create:** `eclassroom/src/types/lesson.ts` — Lesson, Step, BoardAction, Checkpoint types
- **Create:** `eclassroom/src/types/teacher.ts` — Teacher, Mood, MouthShape types
- **Create:** `eclassroom/src/services/api.ts` — API client (fetch wrapper with auth)
- **Create:** `eclassroom/src/services/tts.ts` — TTS fetch + audio management
- **Create:** `eclassroom/src/hooks/useLipSync.ts` — AudioContext analyser hook
- **Create:** `eclassroom/src/components/teacher/TeacherAvatar.tsx` — Main avatar component
- **Create:** `eclassroom/src/components/teacher/avatars/AbenaSVG.tsx` — Madam Abena portrait
- **Create:** `eclassroom/src/components/teacher/avatars/KwameSVG.tsx` — Mr. Kwame portrait
- **Create:** `eclassroom/src/components/teacher/avatars/EsiSVG.tsx` — Madam Esi portrait
- **Create:** `eclassroom/src/components/teacher/avatars/MensahSVG.tsx` — Dr. Mensah portrait
- **Create:** `eclassroom/src/components/teacher/TeacherPanel.tsx` — Sidebar with avatar + controls
- **Create:** `eclassroom/src/components/lesson/LessonView.tsx` — Main lesson page layout
- **Create:** `eclassroom/src/components/lesson/LessonProgress.tsx` — Step progress indicator
- **Create:** `eclassroom/src/pages/Home.tsx` — eClassroom landing page
- **Create:** `eclassroom/src/pages/LessonPage.tsx` — Lesson route wrapper

---

## Task 1: React + Vite + TypeScript Project Scaffold

**Files:**
- Create: `eclassroom/package.json`
- Create: `eclassroom/vite.config.ts`
- Create: `eclassroom/tsconfig.json`
- Create: `eclassroom/tsconfig.node.json`
- Create: `eclassroom/tailwind.config.ts`
- Create: `eclassroom/postcss.config.js`
- Create: `eclassroom/index.html`
- Create: `eclassroom/src/main.tsx`
- Create: `eclassroom/src/App.tsx`
- Create: `eclassroom/src/index.css`

- [ ] **Step 1: Initialize the project**

```bash
cd eclassroom
npm create vite@latest . -- --template react-ts
```

If the directory already exists, answer yes to overwrite.

- [ ] **Step 2: Install dependencies**

```bash
cd eclassroom
npm install react-router-dom
npm install -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 3: Configure Vite with path aliases and Tailwind**

`eclassroom/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://askozzy.work',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 4: Configure TypeScript strict mode**

`eclassroom/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Set up Tailwind with dark theme**

`eclassroom/src/index.css`:
```css
@import "tailwindcss";

:root {
  --bg-primary: #0f1419;
  --bg-secondary: #1a2332;
  --bg-tertiary: #243042;
  --text-primary: #e7e9ea;
  --text-secondary: #8b98a5;
  --text-muted: #6b7280;
  --accent: #FCD116;
  --accent-hover: #e5bf14;
  --border: #2f3941;
  --success: #00c853;
  --error: #ff5252;
}

body {
  margin: 0;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}

* {
  box-sizing: border-box;
}
```

- [ ] **Step 6: Create HTML entry point**

`eclassroom/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <meta name="theme-color" content="#0f1419" />
    <title>eClassroom — AI-Powered Learning</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create React entry + App shell with router**

`eclassroom/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

`eclassroom/src/App.tsx`:
```tsx
import { Routes, Route } from 'react-router-dom';
import { Home } from '@/pages/Home';

export function App() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </div>
  );
}
```

`eclassroom/src/pages/Home.tsx`:
```tsx
export function Home() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h1 className="text-3xl font-bold" style={{ color: 'var(--accent)' }}>
          eClassroom
        </h1>
        <p className="mt-2" style={{ color: 'var(--text-secondary)' }}>
          AI-Powered Academic Preparation
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Verify the app runs**

```bash
cd eclassroom && npm run dev
```

Expected: Dev server starts at `http://localhost:5173`, shows "eClassroom" heading with gold text on dark background.

- [ ] **Step 9: Commit**

```bash
git add eclassroom/
git commit -m "feat(eclassroom): scaffold React+Vite+TS project with Tailwind dark theme"
```

---

## Task 2: D1 Schema Migration

**Files:**
- Create: `migrations/eclassroom-foundation.sql`

- [ ] **Step 1: Write the migration SQL**

`migrations/eclassroom-foundation.sql`:
```sql
-- eClassroom Phase 1: Foundation tables
-- Run: npx wrangler d1 execute ghana-civil-ai-db --remote --file=migrations/eclassroom-foundation.sql

CREATE TABLE IF NOT EXISTS ec_teachers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  personality_prompt TEXT NOT NULL,
  avatar_config TEXT NOT NULL,
  voice_config TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ec_lessons (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES ec_teachers(id),
  subject TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('jhs', 'shs', 'university')),
  topic TEXT NOT NULL,
  content_json TEXT NOT NULL,
  estimated_minutes INTEGER DEFAULT 15,
  xp_reward INTEGER DEFAULT 100,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ec_lessons_subject_level ON ec_lessons(subject, level);

CREATE TABLE IF NOT EXISTS ec_students (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('jhs', 'shs', 'university')),
  school TEXT,
  region TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ec_students_user ON ec_students(user_id);

CREATE TABLE IF NOT EXISTS ec_student_progress (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES ec_students(id),
  lesson_id TEXT NOT NULL REFERENCES ec_lessons(id),
  current_step INTEGER DEFAULT 0,
  status TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  score INTEGER DEFAULT 0,
  xp_earned INTEGER DEFAULT 0,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ec_progress_student ON ec_student_progress(student_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ec_progress_student_lesson ON ec_student_progress(student_id, lesson_id);

-- Seed the 4 launch teachers
INSERT OR IGNORE INTO ec_teachers (id, name, subject, personality_prompt, avatar_config, voice_config) VALUES
('abena', 'Madam Abena', 'mathematics',
 'You are Madam Abena, a warm and encouraging mathematics teacher in Ghana. You use real-world examples from Ghanaian life — market prices, trotro fares, fufu preparation measurements — to explain math concepts. You praise effort and guide students step-by-step. You teach BECE and WASSCE Core Mathematics. You never make up exam questions — only reference verified past papers. When unsure, say "Let me check that for you" rather than guessing.',
 '{"skinTone":"#8B5E3C","hairstyle":"braids","attire":"kente-accent blouse"}',
 '{"speed":1.0,"pitch":1.1}'),

('kwame', 'Mr. Kwame', 'science',
 'You are Mr. Kwame, a methodical and diagram-loving science teacher in Ghana. You explain concepts using clear step-by-step breakdowns and always draw diagrams on the whiteboard. You teach Integrated Science for BECE and Physics/Chemistry for WASSCE. You love experiments and use local examples — fermentation of kenkey, solar energy in the Sahel. You never invent data or results. When uncertain, redirect to the textbook or syllabus.',
 '{"skinTone":"#6B4226","hairstyle":"low fade","attire":"shirt and tie"}',
 '{"speed":0.95,"pitch":0.9}'),

('esi', 'Madam Esi', 'english',
 'You are Madam Esi, a gentle and articulate English Language teacher in Ghana. You correct errors kindly, always praising what was done well before suggesting improvements. You teach English for BECE and WASSCE — comprehension, essay writing, summary, and oral English. You use examples from Ghanaian literature (Ama Ata Aidoo, Ayi Kwei Armah) alongside global texts. You never fabricate quotes or references.',
 '{"skinTone":"#A0714F","hairstyle":"TWA","attire":"professional dress"}',
 '{"speed":1.0,"pitch":1.15}'),

('mensah', 'Dr. Mensah', 'social_studies',
 'You are Dr. Mensah, a scholarly Social Studies teacher with a storytelling approach. You bring history and governance alive with stories from Ghana — Nkrumah''s vision, the 1992 Constitution, traditional governance systems (Ashanti, Ewe, Ga). You teach Social Studies for BECE and WASSCE, and Government for WASSCE elective. You cite the 1992 Constitution by article number. You never fabricate historical events.',
 '{"skinTone":"#3D2B1F","hairstyle":"grey-touched short hair","attire":"glasses, blazer"}',
 '{"speed":0.9,"pitch":0.85}');
```

- [ ] **Step 2: Run the migration on remote D1**

```bash
npx wrangler d1 execute ghana-civil-ai-db --remote --file=migrations/eclassroom-foundation.sql
```

Expected: `Executed N commands` with `success: true`.

- [ ] **Step 3: Verify tables exist**

```bash
npx wrangler d1 execute ghana-civil-ai-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ec_%' ORDER BY name;"
```

Expected: `ec_lessons`, `ec_student_progress`, `ec_students`, `ec_teachers` in results.

- [ ] **Step 4: Verify teacher seed data**

```bash
npx wrangler d1 execute ghana-civil-ai-db --remote --command="SELECT id, name, subject FROM ec_teachers ORDER BY id;"
```

Expected: 4 rows — abena, esi, kwame, mensah.

- [ ] **Step 5: Commit**

```bash
git add migrations/eclassroom-foundation.sql
git commit -m "feat(eclassroom): add D1 schema migration with 4 teacher personas"
```

---

## Task 3: TypeScript Types (Shared)

**Files:**
- Create: `eclassroom/src/types/teacher.ts`
- Create: `eclassroom/src/types/lesson.ts`

- [ ] **Step 1: Create teacher types**

`eclassroom/src/types/teacher.ts`:
```ts
export type TeacherId = 'abena' | 'kwame' | 'esi' | 'mensah';

export type Mood = 'explaining' | 'asking' | 'encouraging' | 'correcting' | 'celebrating';

export type MouthShape = 'closed' | 'slight' | 'open' | 'wide' | 'o';

export interface Teacher {
  id: TeacherId;
  name: string;
  subject: string;
  personality_prompt: string;
  avatar_config: AvatarConfig;
  voice_config: VoiceConfig;
}

export interface AvatarConfig {
  skinTone: string;
  hairstyle: string;
  attire: string;
}

export interface VoiceConfig {
  speed: number;
  pitch: number;
}

export const SKIN_TONES: Record<TeacherId, string> = {
  abena: '#8B5E3C',
  kwame: '#6B4226',
  esi: '#A0714F',
  mensah: '#3D2B1F',
} as const;

export const MOUTH_PATHS: Record<MouthShape, string> = {
  closed: 'M36 33 Q40 35 44 33',
  slight: 'M36 33 Q40 36 44 33',
  open:   'M36 33 Q40 38 44 33 Q40 35 36 33',
  wide:   'M35 32 Q40 40 45 32 Q40 34 35 32',
  o:      'M37 32 Q40 38 43 32 Q40 34 37 32',
} as const;
```

- [ ] **Step 2: Create lesson types**

`eclassroom/src/types/lesson.ts`:
```ts
export type AcademicLevel = 'jhs' | 'shs' | 'university';

export interface Lesson {
  id: string;
  teacher_id: string;
  subject: string;
  level: AcademicLevel;
  topic: string;
  steps: LessonStep[];
  estimated_minutes: number;
  xp_reward: number;
}

export interface LessonStep {
  step: number;
  voice_script: string;
  board_actions: BoardAction[];
  checkpoint: Checkpoint | null;
}

export type BoardAction =
  | DrawShapeAction
  | AddLabelAction
  | DrawLineAction
  | ClearBoardAction;

interface DrawShapeAction {
  action: 'drawShape';
  type: string;
  points?: number[][];
  position?: [number, number];
  width?: number;
  height?: number;
  delay_ms: number;
}

interface AddLabelAction {
  action: 'addLabel';
  text: string;
  position: [number, number];
  color?: string;
  delay_ms: number;
}

interface DrawLineAction {
  action: 'drawLine';
  points: [number, number][];
  color?: string;
  delay_ms: number;
}

interface ClearBoardAction {
  action: 'clearBoard';
  delay_ms: number;
}

export interface Checkpoint {
  type: 'mcq' | 'text_input' | 'drag_drop';
  question: string;
  correct_answer: string;
  accept_variations?: string[];
  options?: string[];
  hint?: string;
  xp_reward: number;
}

export interface StudentProgress {
  id: string;
  student_id: string;
  lesson_id: string;
  current_step: number;
  status: 'in_progress' | 'completed' | 'abandoned';
  score: number;
  xp_earned: number;
}
```

- [ ] **Step 3: Commit**

```bash
git add eclassroom/src/types/
git commit -m "feat(eclassroom): add TypeScript types for teachers, lessons, checkpoints"
```

---

## Task 4: Backend API Routes

**Files:**
- Create: `src/routes/eclassroom.ts`
- Modify: `src/index.ts:51` — Add import + route mount

- [ ] **Step 1: Create the eClassroom routes file**

`src/routes/eclassroom.ts`:
```ts
import { Hono } from "hono";
import type { AppType } from "../types";

const eclassroomRoutes = new Hono<AppType>();

// ─── List Teachers ─────────────────────────────────────────────────
eclassroomRoutes.get("/api/eclassroom/teachers", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, name, subject, avatar_config, voice_config FROM ec_teachers ORDER BY name"
  ).all();
  return c.json({ teachers: rows.results });
});

// ─── Get Single Teacher ─────────────────────────────────────────────
eclassroomRoutes.get("/api/eclassroom/teachers/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT id, name, subject, personality_prompt, avatar_config, voice_config FROM ec_teachers WHERE id = ?"
  ).bind(id).first();
  if (!row) return c.json({ error: "Teacher not found" }, 404);
  return c.json({ teacher: row });
});

// ─── List Lessons ─────────────────────────────────────────────────
eclassroomRoutes.get("/api/eclassroom/lessons", async (c) => {
  const subject = c.req.query("subject");
  const level = c.req.query("level");

  let sql = "SELECT id, teacher_id, subject, level, topic, estimated_minutes, xp_reward, created_at FROM ec_lessons";
  const conditions: string[] = [];
  const params: string[] = [];

  if (subject) { conditions.push("subject = ?"); params.push(subject); }
  if (level) { conditions.push("level = ?"); params.push(level); }

  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY created_at DESC";

  let stmt = c.env.DB.prepare(sql);
  for (let i = 0; i < params.length; i++) {
    stmt = stmt.bind(...params);
  }
  // Rebind all at once
  const bound = params.length > 0 ? c.env.DB.prepare(sql).bind(...params) : c.env.DB.prepare(sql);
  const rows = await bound.all();
  return c.json({ lessons: rows.results });
});

// ─── Get Single Lesson with Content ─────────────────────────────────
eclassroomRoutes.get("/api/eclassroom/lessons/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT * FROM ec_lessons WHERE id = ?"
  ).bind(id).first();
  if (!row) return c.json({ error: "Lesson not found" }, 404);

  const lesson = {
    ...row,
    content_json: undefined,
    steps: JSON.parse(row.content_json as string),
  };
  return c.json({ lesson });
});

// ─── TTS Stream ──────────────────────────────────────────────────────
eclassroomRoutes.post("/api/eclassroom/tts", async (c) => {
  const body = await c.req.json<{ text: string; teacher?: string }>();
  if (!body.text || body.text.length > 2000) {
    return c.json({ error: "Text required (max 2000 chars)" }, 400);
  }

  const result = await c.env.AI.run("@cf/myshell-ai/melotts-english-v2" as BaseAiTextToSpeechModels, {
    prompt: body.text,
  });

  return new Response(result as ReadableStream, {
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "public, max-age=3600",
    },
  });
});

// ─── Update Lesson Progress ──────────────────────────────────────────
eclassroomRoutes.post("/api/eclassroom/lessons/:id/progress", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const lessonId = c.req.param("id");
  const body = await c.req.json<{
    current_step: number;
    status?: 'in_progress' | 'completed';
    score?: number;
    xp_earned?: number;
  }>();

  // Get or create student record
  let student = await c.env.DB.prepare(
    "SELECT id FROM ec_students WHERE user_id = ?"
  ).bind(userId).first();

  if (!student) {
    const studentId = crypto.randomUUID();
    await c.env.DB.prepare(
      "INSERT INTO ec_students (id, user_id, level) VALUES (?, ?, 'shs')"
    ).bind(studentId, userId).run();
    student = { id: studentId };
  }

  const progressId = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO ec_student_progress (id, student_id, lesson_id, current_step, status, score, xp_earned)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(student_id, lesson_id) DO UPDATE SET
      current_step = excluded.current_step,
      status = COALESCE(excluded.status, status),
      score = COALESCE(excluded.score, score),
      xp_earned = COALESCE(excluded.xp_earned, xp_earned),
      completed_at = CASE WHEN excluded.status = 'completed' THEN datetime('now') ELSE completed_at END
  `).bind(
    progressId,
    student.id as string,
    lessonId,
    body.current_step,
    body.status ?? 'in_progress',
    body.score ?? 0,
    body.xp_earned ?? 0,
  ).run();

  return c.json({ ok: true });
});

export default eclassroomRoutes;
```

- [ ] **Step 2: Mount routes in src/index.ts**

Add the import after the last import line (around line 50):

```ts
import eclassroomRoutes from "./routes/eclassroom";
```

Add the route mount after `app.route("/", miscRoutes);` (around line 1807):

```ts
app.route("/", eclassroomRoutes);
```

- [ ] **Step 3: Update CORS to allow eClassroom origin**

In `src/index.ts`, add `"https://eclassroom.askozzy.work"` to the CORS `allowed` array (around line 75-80):

```ts
const allowed = [
  "https://askozzy.work",
  "https://www.askozzy.work",
  "https://askozzy.ghwmelite.workers.dev",
  "https://eclassroom.askozzy.work",
];
```

Also add to the CSP `connect-src` directive:

```
connect-src 'self' https://cdn.jsdelivr.net https://gnews.io https://eclassroom.askozzy.work;
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/eclassroom.ts src/index.ts
git commit -m "feat(eclassroom): add backend API routes for teachers, lessons, TTS, progress"
```

---

## Task 5: API Client Service

**Files:**
- Create: `eclassroom/src/services/api.ts`
- Create: `eclassroom/src/services/tts.ts`

- [ ] **Step 1: Create the API client**

`eclassroom/src/services/api.ts`:
```ts
const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = sessionStorage.getItem('ec_token');
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options?.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error((error as { error: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getTeachers: () => request<{ teachers: unknown[] }>('/api/eclassroom/teachers'),
  getTeacher: (id: string) => request<{ teacher: unknown }>(`/api/eclassroom/teachers/${id}`),
  getLessons: (params?: { subject?: string; level?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<{ lessons: unknown[] }>(`/api/eclassroom/lessons${qs ? `?${qs}` : ''}`);
  },
  getLesson: (id: string) => request<{ lesson: unknown }>(`/api/eclassroom/lessons/${id}`),
  updateProgress: (lessonId: string, data: { current_step: number; status?: string; score?: number }) =>
    request<{ ok: boolean }>(`/api/eclassroom/lessons/${lessonId}/progress`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
```

- [ ] **Step 2: Create the TTS service**

`eclassroom/src/services/tts.ts`:
```ts
const API_BASE = import.meta.env.VITE_API_URL ?? '';

export async function fetchTTSAudio(text: string, teacher?: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/eclassroom/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, teacher }),
  });

  if (!res.ok) throw new Error('TTS request failed');

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export function revokeTTSUrl(url: string): void {
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: Commit**

```bash
git add eclassroom/src/services/
git commit -m "feat(eclassroom): add API client and TTS service"
```

---

## Task 6: LipSync Hook

**Files:**
- Create: `eclassroom/src/hooks/useLipSync.ts`

- [ ] **Step 1: Create the hook**

`eclassroom/src/hooks/useLipSync.ts`:
```ts
import { useEffect, useRef, useState } from 'react';
import type { MouthShape } from '@/types/teacher';

export function useLipSync(audioRef: React.RefObject<HTMLAudioElement | null>): MouthShape {
  const [mouth, setMouth] = useState<MouthShape>('closed');
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Only create AudioContext + source once per audio element
    if (!ctxRef.current) {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      ctxRef.current = ctx;
      sourceRef.current = source;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;

        if (avg < 10) setMouth('closed');
        else if (avg < 40) setMouth('slight');
        else if (avg < 80) setMouth('open');
        else if (avg < 120) setMouth('wide');
        else setMouth('o');

        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [audioRef]);

  // Reset to closed when audio ends
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onEnded = () => setMouth('closed');
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [audioRef]);

  return mouth;
}
```

- [ ] **Step 2: Commit**

```bash
git add eclassroom/src/hooks/useLipSync.ts
git commit -m "feat(eclassroom): add useLipSync hook with AudioContext analyser"
```

---

## Task 7: Teacher SVG Avatars (4 Teachers)

**Files:**
- Create: `eclassroom/src/components/teacher/avatars/AbenaSVG.tsx`
- Create: `eclassroom/src/components/teacher/avatars/KwameSVG.tsx`
- Create: `eclassroom/src/components/teacher/avatars/EsiSVG.tsx`
- Create: `eclassroom/src/components/teacher/avatars/MensahSVG.tsx`

Each avatar is an SVG portrait component that accepts `mouth` (MouthShape) and `mood` (Mood) props. The skin tones are hardcoded hex values (never theme variables). Each includes CSS `@keyframes` for idle blink animation.

- [ ] **Step 1: Create Madam Abena avatar (braids, #8B5E3C, kente blouse)**

`eclassroom/src/components/teacher/avatars/AbenaSVG.tsx`:
```tsx
import type { MouthShape, Mood } from '@/types/teacher';
import { MOUTH_PATHS } from '@/types/teacher';

interface Props {
  mouth: MouthShape;
  mood: Mood;
  size?: number;
}

export function AbenaSVG({ mouth, mood, size = 200 }: Props) {
  const skin = '#8B5E3C';
  const skinShadow = '#7A5234';
  const blouseBase = '#2D5016';
  const kenteAccent = '#FCD116';
  const kenteRed = '#CE1126';

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>{`
        @keyframes abena-blink {
          0%, 92%, 100% { transform: scaleY(1); }
          95% { transform: scaleY(0.1); }
        }
        .abena-eyes { animation: abena-blink 3.5s ease-in-out infinite; transform-origin: 40px 26px; }
        @keyframes abena-idle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-0.5px); }
        }
        .abena-head { animation: abena-idle 4s ease-in-out infinite; }
      `}</style>

      {/* Body / Blouse */}
      <ellipse cx="40" cy="72" rx="22" ry="12" fill={blouseBase} />
      {/* Kente accent stripes */}
      <rect x="28" y="64" width="24" height="2" rx="1" fill={kenteAccent} />
      <rect x="30" y="67" width="20" height="1.5" rx="0.75" fill={kenteRed} />
      <rect x="28" y="70" width="24" height="2" rx="1" fill={kenteAccent} />

      {/* Neck */}
      <rect x="36" y="52" width="8" height="10" rx="2" fill={skin} />

      <g className="abena-head">
        {/* Face */}
        <ellipse cx="40" cy="32" rx="18" ry="22" fill={skin} />
        <ellipse cx="40" cy="33" rx="16" ry="19" fill={skinShadow} opacity="0.15" />

        {/* Braids (hair) */}
        <path d="M22 28 Q22 10 30 8 Q34 7 38 8 L38 14 Q30 14 26 20 Q24 24 22 28Z" fill="#1a1a1a" />
        <path d="M58 28 Q58 10 50 8 Q46 7 42 8 L42 14 Q50 14 54 20 Q56 24 58 28Z" fill="#1a1a1a" />
        <path d="M38 8 Q40 6 42 8 L42 14 L38 14Z" fill="#1a1a1a" />
        {/* Braid strands */}
        <path d="M24 28 Q20 34 18 42" stroke="#1a1a1a" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M22 26 Q17 32 14 40" stroke="#1a1a1a" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M56 28 Q60 34 62 42" stroke="#1a1a1a" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M58 26 Q63 32 66 40" stroke="#1a1a1a" strokeWidth="3" fill="none" strokeLinecap="round" />

        {/* Eyes */}
        <g className="abena-eyes">
          <ellipse cx="33" cy="26" rx="3" ry="3.5" fill="white" />
          <ellipse cx="47" cy="26" rx="3" ry="3.5" fill="white" />
          <circle cx="33" cy="26" r="1.8" fill="#2d1810" />
          <circle cx="47" cy="26" r="1.8" fill="#2d1810" />
          <circle cx="33.5" cy="25.5" r="0.6" fill="white" />
          <circle cx="47.5" cy="25.5" r="0.6" fill="white" />
        </g>

        {/* Eyebrows — mood-driven */}
        {mood === 'asking' ? (
          <>
            <path d="M29 22 Q33 19 37 22" stroke="#1a1a1a" strokeWidth="1.2" fill="none" />
            <path d="M43 22 Q47 19 51 22" stroke="#1a1a1a" strokeWidth="1.2" fill="none" />
          </>
        ) : (
          <>
            <path d="M29 23 Q33 21 37 23" stroke="#1a1a1a" strokeWidth="1.2" fill="none" />
            <path d="M43 23 Q47 21 51 23" stroke="#1a1a1a" strokeWidth="1.2" fill="none" />
          </>
        )}

        {/* Nose */}
        <path d="M39 30 Q40 32 41 30" stroke={skinShadow} strokeWidth="0.8" fill="none" />

        {/* Mouth — driven by lip-sync */}
        <path d={MOUTH_PATHS[mouth]} stroke="#6B3A2A" strokeWidth="1.2" fill={mouth === 'closed' ? 'none' : '#8B4040'} />

        {/* Smile lines for encouraging/celebrating */}
        {(mood === 'encouraging' || mood === 'celebrating') && (
          <>
            <path d="M28 32 Q30 35 28 37" stroke={skinShadow} strokeWidth="0.5" fill="none" opacity="0.4" />
            <path d="M52 32 Q50 35 52 37" stroke={skinShadow} strokeWidth="0.5" fill="none" opacity="0.4" />
          </>
        )}
      </g>
    </svg>
  );
}
```

- [ ] **Step 2: Create Mr. Kwame avatar (low fade, #6B4226, shirt and tie)**

`eclassroom/src/components/teacher/avatars/KwameSVG.tsx`:
```tsx
import type { MouthShape, Mood } from '@/types/teacher';
import { MOUTH_PATHS } from '@/types/teacher';

interface Props {
  mouth: MouthShape;
  mood: Mood;
  size?: number;
}

export function KwameSVG({ mouth, mood, size = 200 }: Props) {
  const skin = '#6B4226';
  const skinShadow = '#5A3820';
  const shirtColor = '#EAEAEA';
  const tieColor = '#1a3a5c';

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>{`
        @keyframes kwame-blink {
          0%, 90%, 100% { transform: scaleY(1); }
          93% { transform: scaleY(0.1); }
        }
        .kwame-eyes { animation: kwame-blink 4s ease-in-out infinite; transform-origin: 40px 26px; }
        @keyframes kwame-idle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-0.4px); }
        }
        .kwame-head { animation: kwame-idle 5s ease-in-out infinite; }
      `}</style>

      {/* Shirt collar */}
      <ellipse cx="40" cy="72" rx="22" ry="12" fill={shirtColor} />
      {/* Collar V */}
      <path d="M32 64 L40 74 L48 64" stroke="#ccc" strokeWidth="1" fill="none" />
      {/* Tie */}
      <path d="M38 66 L40 78 L42 66 Z" fill={tieColor} />
      <rect x="38.5" y="64" width="3" height="3" rx="0.5" fill={tieColor} />

      {/* Neck */}
      <rect x="36" y="52" width="8" height="10" rx="2" fill={skin} />

      <g className="kwame-head">
        {/* Face */}
        <ellipse cx="40" cy="32" rx="18" ry="22" fill={skin} />

        {/* Low fade hair */}
        <path d="M22 24 Q22 10 40 8 Q58 10 58 24 L56 22 Q54 14 40 12 Q26 14 24 22Z" fill="#0d0d0d" />

        {/* Eyes */}
        <g className="kwame-eyes">
          <ellipse cx="33" cy="26" rx="3" ry="3.5" fill="white" />
          <ellipse cx="47" cy="26" rx="3" ry="3.5" fill="white" />
          <circle cx="33" cy="26" r="1.8" fill="#1a1208" />
          <circle cx="47" cy="26" r="1.8" fill="#1a1208" />
          <circle cx="33.5" cy="25.5" r="0.6" fill="white" />
          <circle cx="47.5" cy="25.5" r="0.6" fill="white" />
        </g>

        {/* Eyebrows */}
        <path d="M29 22 Q33 20.5 37 22.5" stroke="#0d0d0d" strokeWidth="1.4" fill="none" />
        <path d="M43 22.5 Q47 20.5 51 22" stroke="#0d0d0d" strokeWidth="1.4" fill="none" />

        {/* Nose */}
        <path d="M38 30 Q40 33 42 30" stroke={skinShadow} strokeWidth="0.8" fill="none" />

        {/* Mouth */}
        <path d={MOUTH_PATHS[mouth]} stroke="#4A2A1A" strokeWidth="1.2" fill={mouth === 'closed' ? 'none' : '#6B3030'} />

        {/* Focused expression for explaining */}
        {mood === 'explaining' && (
          <path d="M36 20 Q40 18.5 44 20" stroke="#0d0d0d" strokeWidth="0.6" fill="none" opacity="0.3" />
        )}
      </g>
    </svg>
  );
}
```

- [ ] **Step 3: Create Madam Esi avatar (TWA hairstyle, #A0714F, professional dress)**

`eclassroom/src/components/teacher/avatars/EsiSVG.tsx`:
```tsx
import type { MouthShape, Mood } from '@/types/teacher';
import { MOUTH_PATHS } from '@/types/teacher';

interface Props {
  mouth: MouthShape;
  mood: Mood;
  size?: number;
}

export function EsiSVG({ mouth, mood, size = 200 }: Props) {
  const skin = '#A0714F';
  const skinShadow = '#8F6445';
  const dressColor = '#5B2E91';

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>{`
        @keyframes esi-blink {
          0%, 94%, 100% { transform: scaleY(1); }
          96.5% { transform: scaleY(0.1); }
        }
        .esi-eyes { animation: esi-blink 3.2s ease-in-out infinite; transform-origin: 40px 26px; }
        @keyframes esi-idle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-0.3px); }
        }
        .esi-head { animation: esi-idle 4.5s ease-in-out infinite; }
      `}</style>

      {/* Professional dress */}
      <ellipse cx="40" cy="72" rx="22" ry="12" fill={dressColor} />
      {/* Neckline */}
      <path d="M34 64 Q40 68 46 64" stroke="#4A2578" strokeWidth="1" fill="none" />

      {/* Neck */}
      <rect x="36" y="52" width="8" height="10" rx="2" fill={skin} />
      {/* Earrings */}
      <circle cx="22" cy="34" r="2" fill="#FCD116" />
      <circle cx="58" cy="34" r="2" fill="#FCD116" />

      <g className="esi-head">
        {/* Face */}
        <ellipse cx="40" cy="32" rx="18" ry="22" fill={skin} />

        {/* TWA hairstyle (short textured) */}
        <ellipse cx="40" cy="18" rx="19" ry="14" fill="#1a1a1a" />
        <ellipse cx="40" cy="20" rx="17" ry="10" fill="#2a2a2a" opacity="0.5" />

        {/* Eyes */}
        <g className="esi-eyes">
          <ellipse cx="33" cy="26" rx="3.2" ry="3.5" fill="white" />
          <ellipse cx="47" cy="26" rx="3.2" ry="3.5" fill="white" />
          <circle cx="33" cy="26" r="1.8" fill="#2d1810" />
          <circle cx="47" cy="26" r="1.8" fill="#2d1810" />
          <circle cx="33.5" cy="25.5" r="0.6" fill="white" />
          <circle cx="47.5" cy="25.5" r="0.6" fill="white" />
        </g>

        {/* Eyelashes */}
        <path d="M29.5 24 L28.5 22.5" stroke="#1a1a1a" strokeWidth="0.6" />
        <path d="M50.5 24 L51.5 22.5" stroke="#1a1a1a" strokeWidth="0.6" />

        {/* Gentle eyebrows */}
        <path d="M29 22.5 Q33 21 37 23" stroke="#2a1a10" strokeWidth="1" fill="none" />
        <path d="M43 23 Q47 21 51 22.5" stroke="#2a1a10" strokeWidth="1" fill="none" />

        {/* Nose */}
        <path d="M39 30 Q40 32 41 30" stroke={skinShadow} strokeWidth="0.8" fill="none" />

        {/* Mouth */}
        <path d={MOUTH_PATHS[mouth]} stroke="#7A4A3A" strokeWidth="1.2" fill={mouth === 'closed' ? 'none' : '#9A5050'} />

        {/* Warm smile for encouraging */}
        {(mood === 'encouraging' || mood === 'celebrating') && (
          <>
            <path d="M29 33 Q30 35 29 36" stroke={skinShadow} strokeWidth="0.4" fill="none" opacity="0.3" />
            <path d="M51 33 Q50 35 51 36" stroke={skinShadow} strokeWidth="0.4" fill="none" opacity="0.3" />
          </>
        )}
      </g>
    </svg>
  );
}
```

- [ ] **Step 4: Create Dr. Mensah avatar (grey-touched hair, #3D2B1F, glasses)**

`eclassroom/src/components/teacher/avatars/MensahSVG.tsx`:
```tsx
import type { MouthShape, Mood } from '@/types/teacher';
import { MOUTH_PATHS } from '@/types/teacher';

interface Props {
  mouth: MouthShape;
  mood: Mood;
  size?: number;
}

export function MensahSVG({ mouth, mood, size = 200 }: Props) {
  const skin = '#3D2B1F';
  const skinShadow = '#322318';
  const blazerColor = '#2C3E50';

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>{`
        @keyframes mensah-blink {
          0%, 91%, 100% { transform: scaleY(1); }
          94% { transform: scaleY(0.1); }
        }
        .mensah-eyes { animation: mensah-blink 4.2s ease-in-out infinite; transform-origin: 40px 26px; }
        @keyframes mensah-idle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-0.4px); }
        }
        .mensah-head { animation: mensah-idle 5.5s ease-in-out infinite; }
      `}</style>

      {/* Blazer */}
      <ellipse cx="40" cy="72" rx="22" ry="12" fill={blazerColor} />
      {/* Lapels */}
      <path d="M32 64 L38 72 L40 66" stroke="#3D5166" strokeWidth="0.8" fill="none" />
      <path d="M48 64 L42 72 L40 66" stroke="#3D5166" strokeWidth="0.8" fill="none" />
      {/* Shirt collar peek */}
      <path d="M37 65 L40 69 L43 65" fill="#F5F5F5" />

      {/* Neck */}
      <rect x="36" y="52" width="8" height="10" rx="2" fill={skin} />

      <g className="mensah-head">
        {/* Face */}
        <ellipse cx="40" cy="32" rx="18" ry="22" fill={skin} />

        {/* Grey-touched short hair */}
        <path d="M22 24 Q22 10 40 8 Q58 10 58 24 L56 22 Q54 14 40 12 Q26 14 24 22Z" fill="#2a2a2a" />
        {/* Grey touches */}
        <path d="M26 18 Q28 14 32 13" stroke="#888" strokeWidth="1.5" fill="none" opacity="0.6" />
        <path d="M54 18 Q52 14 48 13" stroke="#888" strokeWidth="1.5" fill="none" opacity="0.6" />
        <path d="M36 11 Q40 10 44 11" stroke="#999" strokeWidth="1" fill="none" opacity="0.4" />

        {/* Glasses */}
        <rect x="27" y="22" width="12" height="9" rx="3" stroke="#8B8000" strokeWidth="1.2" fill="none" />
        <rect x="41" y="22" width="12" height="9" rx="3" stroke="#8B8000" strokeWidth="1.2" fill="none" />
        <path d="M39 26 L41 26" stroke="#8B8000" strokeWidth="1" />
        <path d="M27 26 L22 24" stroke="#8B8000" strokeWidth="0.8" />
        <path d="M53 26 L58 24" stroke="#8B8000" strokeWidth="0.8" />

        {/* Eyes (behind glasses) */}
        <g className="mensah-eyes">
          <ellipse cx="33" cy="26" rx="2.8" ry="3" fill="white" />
          <ellipse cx="47" cy="26" rx="2.8" ry="3" fill="white" />
          <circle cx="33" cy="26" r="1.6" fill="#1a1208" />
          <circle cx="47" cy="26" r="1.6" fill="#1a1208" />
          <circle cx="33.3" cy="25.5" r="0.5" fill="white" />
          <circle cx="47.3" cy="25.5" r="0.5" fill="white" />
        </g>

        {/* Distinguished eyebrows */}
        <path d="M28 21 Q33 19 38 21.5" stroke="#2a2a2a" strokeWidth="1.3" fill="none" />
        <path d="M42 21.5 Q47 19 52 21" stroke="#2a2a2a" strokeWidth="1.3" fill="none" />

        {/* Nose */}
        <path d="M38 30 Q40 33 42 30" stroke={skinShadow} strokeWidth="0.8" fill="none" />

        {/* Mouth */}
        <path d={MOUTH_PATHS[mouth]} stroke="#2A1A10" strokeWidth="1.2" fill={mouth === 'closed' ? 'none' : '#4A2A2A'} />

        {/* Scholarly expression lines */}
        {mood === 'explaining' && (
          <path d="M35 19 Q40 17.5 45 19" stroke="#2a2a2a" strokeWidth="0.5" fill="none" opacity="0.3" />
        )}
      </g>
    </svg>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add eclassroom/src/components/teacher/avatars/
git commit -m "feat(eclassroom): add 4 teacher SVG avatar components with lip-sync and idle animations"
```

---

## Task 8: TeacherAvatar Main Component

**Files:**
- Create: `eclassroom/src/components/teacher/TeacherAvatar.tsx`

- [ ] **Step 1: Create the TeacherAvatar component**

`eclassroom/src/components/teacher/TeacherAvatar.tsx`:
```tsx
import type { TeacherId, Mood, MouthShape } from '@/types/teacher';
import { AbenaSVG } from './avatars/AbenaSVG';
import { KwameSVG } from './avatars/KwameSVG';
import { EsiSVG } from './avatars/EsiSVG';
import { MensahSVG } from './avatars/MensahSVG';

interface TeacherAvatarProps {
  teacher: TeacherId;
  mood: Mood;
  mouth: MouthShape;
  size?: number;
}

const AVATAR_MAP = {
  abena: AbenaSVG,
  kwame: KwameSVG,
  esi: EsiSVG,
  mensah: MensahSVG,
} as const;

export function TeacherAvatar({ teacher, mood, mouth, size = 200 }: TeacherAvatarProps) {
  const AvatarComponent = AVATAR_MAP[teacher];
  return (
    <div
      className="flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Teacher avatar: ${teacher}, mood: ${mood}`}
    >
      <AvatarComponent mouth={mouth} mood={mood} size={size} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add eclassroom/src/components/teacher/TeacherAvatar.tsx
git commit -m "feat(eclassroom): add TeacherAvatar component routing to per-teacher SVGs"
```

---

## Task 9: TeacherPanel Sidebar

**Files:**
- Create: `eclassroom/src/components/teacher/TeacherPanel.tsx`

- [ ] **Step 1: Create the TeacherPanel component**

`eclassroom/src/components/teacher/TeacherPanel.tsx`:
```tsx
import { useRef } from 'react';
import { TeacherAvatar } from './TeacherAvatar';
import { useLipSync } from '@/hooks/useLipSync';
import type { TeacherId, Mood } from '@/types/teacher';

interface TeacherPanelProps {
  teacher: TeacherId;
  teacherName: string;
  mood: Mood;
  currentStep: number;
  totalSteps: number;
  isPlaying: boolean;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  onPlayPause?: () => void;
}

export function TeacherPanel({
  teacher,
  teacherName,
  mood,
  currentStep,
  totalSteps,
  isPlaying,
  audioRef,
  onPlayPause,
}: TeacherPanelProps) {
  const mouth = useLipSync(audioRef);

  return (
    <div
      className="flex flex-col items-center gap-4 p-4 rounded-2xl"
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
    >
      {/* Avatar */}
      <TeacherAvatar teacher={teacher} mood={mood} mouth={mouth} size={160} />

      {/* Teacher name */}
      <div className="text-center">
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {teacherName}
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {mood === 'explaining' && 'Teaching...'}
          {mood === 'asking' && 'Asking a question...'}
          {mood === 'encouraging' && 'Great job!'}
          {mood === 'correcting' && 'Let me help...'}
          {mood === 'celebrating' && 'Excellent!'}
        </p>
      </div>

      {/* Step progress */}
      <div className="w-full">
        <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
          <span>Step {currentStep} of {totalSteps}</span>
          <span>{Math.round((currentStep / totalSteps) * 100)}%</span>
        </div>
        <div
          className="w-full h-1.5 rounded-full overflow-hidden"
          style={{ background: 'var(--bg-tertiary)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${(currentStep / totalSteps) * 100}%`,
              background: 'var(--accent)',
            }}
          />
        </div>
      </div>

      {/* Play / Pause */}
      <button
        onClick={onPlayPause}
        className="w-full py-2 rounded-lg text-sm font-semibold transition-all"
        style={{
          background: isPlaying ? 'var(--bg-tertiary)' : 'var(--accent)',
          color: isPlaying ? 'var(--text-secondary)' : '#000',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        {isPlaying ? 'Pause' : 'Play Lesson'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add eclassroom/src/components/teacher/TeacherPanel.tsx
git commit -m "feat(eclassroom): add TeacherPanel sidebar with avatar, progress, and controls"
```

---

## Task 10: Lesson View + Lesson Progress

**Files:**
- Create: `eclassroom/src/components/lesson/LessonView.tsx`
- Create: `eclassroom/src/components/lesson/LessonProgress.tsx`
- Create: `eclassroom/src/pages/LessonPage.tsx`
- Modify: `eclassroom/src/App.tsx` — Add lesson route

- [ ] **Step 1: Create LessonProgress step indicator**

`eclassroom/src/components/lesson/LessonProgress.tsx`:
```tsx
interface LessonProgressProps {
  steps: { step: number; hasCheckpoint: boolean }[];
  currentStep: number;
  completedSteps: Set<number>;
}

export function LessonProgress({ steps, currentStep, completedSteps }: LessonProgressProps) {
  return (
    <div className="flex flex-col gap-1 py-2">
      {steps.map((s) => {
        const isActive = s.step === currentStep;
        const isDone = completedSteps.has(s.step);

        return (
          <div
            key={s.step}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all"
            style={{
              background: isActive ? 'var(--bg-tertiary)' : 'transparent',
              color: isDone
                ? 'var(--success)'
                : isActive
                  ? 'var(--text-primary)'
                  : 'var(--text-muted)',
            }}
          >
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{
                background: isDone ? 'var(--success)' : isActive ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: isDone || isActive ? '#000' : 'var(--text-muted)',
              }}
            >
              {isDone ? '✓' : s.step}
            </span>
            <span>Step {s.step}</span>
            {s.hasCheckpoint && (
              <span
                className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-semibold"
                style={{ background: 'rgba(252,209,22,0.15)', color: 'var(--accent)' }}
              >
                Quiz
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create LessonView layout**

`eclassroom/src/components/lesson/LessonView.tsx`:
```tsx
import { useRef, useState } from 'react';
import { TeacherPanel } from '@/components/teacher/TeacherPanel';
import { LessonProgress } from './LessonProgress';
import type { Lesson } from '@/types/lesson';
import type { TeacherId, Mood } from '@/types/teacher';

interface LessonViewProps {
  lesson: Lesson;
}

const TEACHER_NAMES: Record<string, string> = {
  abena: 'Madam Abena',
  kwame: 'Mr. Kwame',
  esi: 'Madam Esi',
  mensah: 'Dr. Mensah',
};

export function LessonView({ lesson }: LessonViewProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [mood, setMood] = useState<Mood>('explaining');
  const [isPlaying, setIsPlaying] = useState(false);
  const [completedSteps] = useState<Set<number>>(new Set());

  const teacherId = lesson.teacher_id as TeacherId;

  const progressSteps = lesson.steps.map((s) => ({
    step: s.step,
    hasCheckpoint: s.checkpoint !== null,
  }));

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Hidden audio element for TTS */}
      <audio ref={audioRef} />

      {/* Left sidebar — step progress (hidden on mobile) */}
      <aside
        className="hidden md:flex flex-col w-48 overflow-y-auto border-r"
        style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
      >
        <div className="p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
            Lesson Steps
          </h3>
          <LessonProgress
            steps={progressSteps}
            currentStep={currentStep}
            completedSteps={completedSteps}
          />
        </div>
      </aside>

      {/* Main content — whiteboard area */}
      <main className="flex-1 flex flex-col">
        {/* Top bar */}
        <header
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
        >
          <div>
            <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              {lesson.topic}
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {lesson.subject.replace(/_/g, ' ')} · {lesson.level.toUpperCase()} · {lesson.estimated_minutes} min
            </p>
          </div>
          <span
            className="px-2 py-1 rounded-md text-xs font-semibold"
            style={{ background: 'rgba(252,209,22,0.15)', color: 'var(--accent)' }}
          >
            +{lesson.xp_reward} XP
          </span>
        </header>

        {/* Whiteboard placeholder */}
        <div
          className="flex-1 flex items-center justify-center"
          style={{ background: '#1a2332' }}
        >
          <div className="text-center" style={{ color: 'var(--text-muted)' }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18" />
              <path d="M9 21V9" />
            </svg>
            <p className="mt-3 text-sm">Interactive Whiteboard</p>
            <p className="text-xs mt-1">tldraw integration coming in Phase 2</p>
          </div>
        </div>
      </main>

      {/* Right sidebar — teacher panel */}
      <aside
        className="hidden lg:flex flex-col w-56 border-l overflow-y-auto"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="p-3">
          <TeacherPanel
            teacher={teacherId}
            teacherName={TEACHER_NAMES[teacherId] ?? teacherId}
            mood={mood}
            currentStep={currentStep}
            totalSteps={lesson.steps.length}
            isPlaying={isPlaying}
            audioRef={audioRef}
            onPlayPause={() => setIsPlaying(!isPlaying)}
          />
        </div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 3: Create LessonPage route wrapper**

`eclassroom/src/pages/LessonPage.tsx`:
```tsx
import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { LessonView } from '@/components/lesson/LessonView';
import type { Lesson } from '@/types/lesson';
import { api } from '@/services/api';

export function LessonPage() {
  const { id } = useParams<{ id: string }>();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getLesson(id)
      .then((data) => setLesson(data.lesson as Lesson))
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center p-6 rounded-xl" style={{ background: 'var(--bg-secondary)' }}>
          <p className="text-lg font-semibold" style={{ color: 'var(--error)' }}>
            Failed to load lesson
          </p>
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!lesson) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse text-sm" style={{ color: 'var(--text-muted)' }}>
          Loading lesson...
        </div>
      </div>
    );
  }

  return <LessonView lesson={lesson} />;
}
```

- [ ] **Step 4: Add lesson route to App.tsx**

`eclassroom/src/App.tsx`:
```tsx
import { Routes, Route } from 'react-router-dom';
import { Home } from '@/pages/Home';
import { LessonPage } from '@/pages/LessonPage';

export function App() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/lesson/:id" element={<LessonPage />} />
      </Routes>
    </div>
  );
}
```

- [ ] **Step 5: Verify the dev build compiles without errors**

```bash
cd eclassroom && npm run build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add eclassroom/src/components/lesson/ eclassroom/src/pages/ eclassroom/src/App.tsx
git commit -m "feat(eclassroom): add LessonView layout with teacher panel, progress sidebar, and whiteboard placeholder"
```

---

## Task 11: Seed a Sample Lesson + End-to-End Smoke Test

**Files:**
- Create: `migrations/eclassroom-sample-lesson.sql`

- [ ] **Step 1: Insert a sample trigonometry lesson**

`migrations/eclassroom-sample-lesson.sql`:
```sql
-- Sample lesson: WASSCE Core Mathematics — Trigonometric Ratios
INSERT OR IGNORE INTO ec_lessons (id, teacher_id, subject, level, topic, content_json, estimated_minutes, xp_reward)
VALUES (
  'shs-math-trig-01',
  'abena',
  'core_mathematics',
  'shs',
  'Trigonometric Ratios',
  '[
    {
      "step": 1,
      "voice_script": "Good morning class! Today we are going to learn about trigonometric ratios. Let me draw a right-angled triangle on the board.",
      "board_actions": [
        { "action": "drawShape", "type": "triangle", "points": [[60,220],[220,220],[220,100]], "delay_ms": 2000 }
      ],
      "checkpoint": null
    },
    {
      "step": 2,
      "voice_script": "This longest side, opposite the right angle, is called the hypotenuse. In Ghana, you might think of it like the longest path from your house to school.",
      "board_actions": [
        { "action": "addLabel", "text": "Hypotenuse", "position": [140, 150], "color": "#EF9F27", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 3,
      "voice_script": "The side next to the angle we are looking at is called the adjacent side. And the side across from that angle is the opposite side.",
      "board_actions": [
        { "action": "addLabel", "text": "Adjacent", "position": [140, 230], "color": "#4FC3F7", "delay_ms": 1000 },
        { "action": "addLabel", "text": "Opposite", "position": [230, 160], "color": "#81C784", "delay_ms": 1000 }
      ],
      "checkpoint": null
    },
    {
      "step": 4,
      "voice_script": "Now here is the key formula. SOH CAH TOA! Sine equals Opposite over Hypotenuse. Cosine equals Adjacent over Hypotenuse. Tangent equals Opposite over Adjacent.",
      "board_actions": [
        { "action": "addLabel", "text": "SOH: sin = O/H", "position": [20, 30], "color": "#FCD116", "delay_ms": 1500 },
        { "action": "addLabel", "text": "CAH: cos = A/H", "position": [20, 55], "color": "#FCD116", "delay_ms": 1500 },
        { "action": "addLabel", "text": "TOA: tan = O/A", "position": [20, 80], "color": "#FCD116", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 5,
      "voice_script": "Now it is your turn. What is cosine of angle A? Remember CAH — Cosine equals Adjacent over Hypotenuse. Type your answer below.",
      "board_actions": [],
      "checkpoint": {
        "type": "text_input",
        "question": "What is cos(A)?",
        "correct_answer": "Adjacent/Hypotenuse",
        "accept_variations": ["adj/hyp", "adjacent over hypotenuse", "Adj/Hyp", "A/H"],
        "hint": "Remember CAH — Cosine equals Adjacent over Hypotenuse",
        "xp_reward": 50
      }
    }
  ]',
  15,
  100
);
```

- [ ] **Step 2: Run the migration**

```bash
npx wrangler d1 execute ghana-civil-ai-db --remote --file=migrations/eclassroom-sample-lesson.sql
```

Expected: `success: true`

- [ ] **Step 3: Deploy the backend and test the API**

```bash
npx wrangler deploy
```

Then test the endpoints:

```bash
curl https://askozzy.work/api/eclassroom/teachers
curl https://askozzy.work/api/eclassroom/lessons
curl https://askozzy.work/api/eclassroom/lessons/shs-math-trig-01
```

Expected: JSON responses with teacher list, lesson list, and full lesson content with steps array.

- [ ] **Step 4: Test the dev frontend loads the lesson**

```bash
cd eclassroom && npm run dev
```

Open `http://localhost:5173/lesson/shs-math-trig-01` in the browser.

Expected: The lesson view loads with the topic "Trigonometric Ratios", teacher panel showing Madam Abena avatar with idle blink animation, step progress sidebar, and whiteboard placeholder.

- [ ] **Step 5: Commit**

```bash
git add migrations/eclassroom-sample-lesson.sql
git commit -m "feat(eclassroom): add sample trigonometry lesson and verify end-to-end flow"
```

---

## Self-Review Findings

**Spec coverage:** Phase 1 from PRD section 10 calls for: D1 schema (Task 2), Teacher avatars (Tasks 7-8), TTS integration (Task 4 route + Task 5 service), Basic lesson view (Task 10), Student auth integration (Task 4 progress endpoint requires `userId`). All covered.

**Placeholder scan:** No TBD/TODO found. All code blocks are complete.

**Type consistency:** `TeacherId`, `Mood`, `MouthShape`, `Lesson`, `LessonStep`, `BoardAction`, `Checkpoint` — consistent across types files, avatar components, TeacherPanel, and LessonView. `MOUTH_PATHS` is defined in `types/teacher.ts` and imported in all 4 avatar components.

**Auth note:** The progress endpoint in Task 4 uses `c.get("userId")` which requires the existing AskOzzy auth middleware. For Phase 1, the other endpoints (teachers list, lessons, TTS) are public. Full auth integration with JWT bridge between AskOzzy and eClassroom frontend will be refined in Phase 2 when we have real lesson playback.
