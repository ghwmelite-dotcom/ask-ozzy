# CLAUDE.md — eClassroom Project Configuration

## Project Overview

eClassroom is an AI-powered academic preparation platform integrated into AskOzzy.work. It features Black African AI teacher avatars teaching on interactive whiteboards, aligned to Ghana's GES syllabus and WAEC exam formats. Targets BECE, WASSCE, and university course preparation.

## Stack

- **Frontend**: React 18 + Vite + TypeScript, deployed to Cloudflare Pages
- **Backend**: Cloudflare Workers (TypeScript)
- **Database**: Cloudflare D1 (SQLite)
- **Cache/State**: Cloudflare KV
- **File Storage**: Cloudflare R2
- **Real-time**: Cloudflare Durable Objects (WebSocket rooms, tldraw sync)
- **AI**: Cloudflare Workers AI (LLM inference + TTS)
- **Vector Search**: Cloudflare Vectorize
- **Async Jobs**: Cloudflare Queues
- **Whiteboard**: tldraw SDK (React infinite canvas)

## Architecture Principles

1. **Zero external API costs for avatars** — Teachers are SVG/CSS components with lip-sync animation driven by AudioContext. No D-ID, HeyGen, or Synthesia.
2. **Workers AI for everything** — LLM inference, TTS, embeddings all run on Cloudflare. No OpenAI/Anthropic API calls from the backend.
3. **Mobile-first** — 80%+ of users are on Android phones over 3G/4G. Every component must work on low-end devices.
4. **Offline-capable** — PWA service worker caches audio lessons, flashcards, and lesson content for offline use.
5. **Data sovereignty** — All student data stays on Cloudflare infrastructure. This is a key selling point.

## Key Technical Decisions

### Teacher Avatars
- Each teacher is a React component: `<TeacherAvatar teacher="abena" mood="explaining" />`
- SVG portraits with 4-5 mouth shape variants (CSS transitions between them)
- `AudioContext.createAnalyser()` reads TTS amplitude → maps to mouth shape
- Idle animations: CSS `@keyframes` blink (3-4s interval), subtle head movement
- Skin tones are hardcoded hex (NOT theme variables): `#8B5E3C`, `#6B4226`, `#A0714F`, `#3D2B1F`
- Teacher personality via system prompts stored in D1 `teachers` table

### Interactive Whiteboard
- tldraw embedded via `import { Tldraw } from 'tldraw'`
- AI teacher draws programmatically via `editor.createShape()`, `editor.createText()`, etc.
- Drawing commands in lesson JSON are executed sequentially with `delay_ms` timing
- Multiplayer via tldraw's `@tldraw/sync` + Cloudflare Durable Objects
- Student drawings readable via `editor.getCurrentPageShapes()`

### RAG System
- Upload pipeline: R2 → Queue → Worker (extract text → chunk → embed → Vectorize)
- Chunks: ~500 tokens with 50-token overlap, tagged with source metadata
- Query: embed question → Vectorize top-K → inject into LLM context → cite sources
- Citations reference specific page numbers and sections

### Lesson Format
- Lessons stored as structured JSON in D1 (see PRD for schema)
- Each step has: `voice_script`, `board_actions[]`, optional `checkpoint`
- Checkpoints are embedded assessments (MCQ, text input, drag-and-drop)

## File Structure

```
askozzy-eclassroom/
├── src/
│   ├── components/
│   │   ├── teacher/
│   │   │   ├── TeacherAvatar.tsx          # Main avatar component
│   │   │   ├── avatars/                   # Per-teacher SVG portraits
│   │   │   │   ├── AbenaSVG.tsx
│   │   │   │   ├── KwameSVG.tsx
│   │   │   │   ├── EsiSVG.tsx
│   │   │   │   └── MensahSVG.tsx
│   │   │   ├── LipSync.tsx               # AudioContext → mouth shape mapper
│   │   │   └── TeacherPanel.tsx           # Right sidebar with avatar + controls
│   │   ├── whiteboard/
│   │   │   ├── Whiteboard.tsx             # tldraw wrapper component
│   │   │   ├── WhiteboardTeacher.ts       # Translates lesson JSON → tldraw commands
│   │   │   ├── WhiteboardToolbar.tsx      # Draw/Text/Shapes/Eraser tools
│   │   │   └── StudentDrawingAnalyser.ts  # Reads student shapes for AI feedback
│   │   ├── lesson/
│   │   │   ├── LessonView.tsx             # Main lesson page (whiteboard + teacher + progress)
│   │   │   ├── LessonProgress.tsx         # Step indicator sidebar
│   │   │   ├── Checkpoint.tsx             # Embedded quiz/question component
│   │   │   └── LessonPlayer.ts           # Orchestrates voice + board + timing
│   │   ├── study-tools/
│   │   │   ├── FlashcardReview.tsx        # Spaced repetition card flip UI
│   │   │   ├── QuizView.tsx              # Practice quiz (MCQ + essay format)
│   │   │   ├── MindMap.tsx               # Interactive SVG mind map
│   │   │   └── AudioPlayer.tsx           # Audio lesson player with speed control
│   │   ├── classroom/
│   │   │   ├── LiveClassroom.tsx          # Multiplayer room view
│   │   │   ├── JoinRoom.tsx              # Join via code
│   │   │   ├── HandRaise.tsx             # Student hand-raise button
│   │   │   └── LiveLeaderboard.tsx       # Real-time quiz leaderboard
│   │   └── gamification/
│   │       ├── XPDisplay.tsx             # XP bar, level badge
│   │       ├── StreakCounter.tsx          # Daily streak display
│   │       ├── BadgeGallery.tsx          # Earned badges grid
│   │       └── Leaderboard.tsx           # Filterable leaderboard table
│   ├── services/
│   │   ├── tts.ts                        # Workers AI TTS client
│   │   ├── rag.ts                        # RAG query client
│   │   ├── xp.ts                         # XP calculation and tracking
│   │   └── spaced-repetition.ts          # SM-2 algorithm implementation
│   ├── pages/                            # Route-level page components
│   └── types/
│       ├── lesson.ts                     # Lesson, Step, BoardAction, Checkpoint types
│       ├── teacher.ts                    # Teacher, Mood, MouthShape types
│       └── student.ts                    # Student, XP, Badge, Progress types
├── workers/
│   ├── api/                              # Main API Worker
│   │   ├── routes/
│   │   │   ├── lessons.ts
│   │   │   ├── teachers.ts
│   │   │   ├── rag.ts
│   │   │   ├── study-tools.ts
│   │   │   ├── xp.ts
│   │   │   ├── classroom.ts
│   │   │   ├── tts.ts
│   │   │   └── audio.ts
│   │   └── index.ts
│   ├── rag-processor/                    # Queue consumer: PDF → chunks → embeddings
│   │   └── index.ts
│   ├── audio-generator/                  # Queue consumer: lesson → TTS → MP3 → R2
│   │   └── index.ts
│   └── classroom-do/                     # Durable Object: WebSocket room state
│       └── index.ts
├── migrations/                           # D1 schema migrations
├── wrangler.toml
├── CLAUDE.md                            # This file
└── docs/
    ├── prd.md                           # Product requirements
    └── epics/                           # CCPM epic files
```

## Coding Standards

- TypeScript strict mode, no `any` types
- React functional components with hooks only
- Tailwind CSS for styling (available via CDN in AskOzzy)
- Error boundaries around every major feature section
- All Workers use `export default { fetch, queue, scheduled }` pattern
- D1 queries use prepared statements (no string concatenation)
- R2 keys follow pattern: `eclassroom/{type}/{id}/{filename}`
- KV keys follow pattern: `ec:{namespace}:{id}`

## Testing

- Vitest for unit tests
- Test on Chrome Android (low-end device simulation)
- Test on 3G throttled connection
- All tldraw interactions testable via Editor API mocks

## Ghana-Specific Context

- Currency: Ghana Cedis (GHS), use GH₵ symbol
- School year: September to July
- BECE: typically June
- WASSCE: typically August-October
- Universities admit based on WASSCE aggregate scores (NOT entrance exams)
- Popular exam subjects vary by programme choice
- Internet: often 3G/4G mobile data, not always stable
- Devices: mostly Android phones, some tablets, fewer laptops
- Languages: English (instruction language), but Ewe, Twi, Ga spoken at home
