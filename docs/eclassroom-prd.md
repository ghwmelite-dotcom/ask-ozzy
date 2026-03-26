# eClassroom — AI-Powered Academic Preparation Platform

## Product Requirements Document

**Product**: eClassroom (module within AskOzzy.work)
**Owner**: Ozzy — Hodges & Co. Limited
**Status**: Draft
**Created**: 2026-03-26
**Stack**: React + Vite + TypeScript, Cloudflare Workers/Pages/D1/KV/R2/Durable Objects/Vectorize/Queues, Workers AI

---

## 1. Problem Statement

Ghanaian students preparing for BECE (JHS) and WASSCE (SHS) spend significant money on private tutoring that many families cannot afford. Rural students, especially in regions like the Volta Region, have limited access to quality teachers. University students lack affordable 24/7 tutoring for high-failure-rate courses. No existing platform combines AI teaching with Ghanaian curriculum alignment, interactive whiteboard instruction, and data sovereignty.

## 2. Vision

eClassroom is an AI-powered virtual classroom where Black African AI teachers teach students on an interactive whiteboard, aligned to the GES syllabus and WAEC exam formats. It is the first platform to bring personalized, curriculum-aligned AI tutoring to every Ghanaian student at a fraction of private tutoring costs.

## 3. Target Users

- **JHS students (ages 12-15)**: Preparing for BECE
- **SHS students (ages 15-18)**: Preparing for WASSCE (highest-value segment)
- **University students (ages 18-25)**: Needing course support for high-failure-rate foundational courses
- **Parents**: Seeking affordable supplementary education for their children

## 4. Academic Levels & Curriculum

### 4.1 Basic School — BECE Preparation (JHS 1-3)
**Subjects**: Mathematics, Integrated Science, English Language, Social Studies, ICT
**Source Material**: GES syllabi, past BECE papers, WAEC marking schemes
**Goal**: Students pass BECE with strong aggregates for SHS placement

### 4.2 Senior High School — WASSCE Preparation (SHS 1-3)
**Subjects**:
- Core: Core Mathematics, English Language, Integrated Science, Social Studies
- Electives: Elective Mathematics, Physics, Chemistry, Biology, Economics, Government, Accounting, Geography, History, Literature in English
**Source Material**: GES SHS syllabi, past WASSCE papers (2015-2025), WAEC Chief Examiner reports, WAEC marking schemes
**Goal**: Students achieve grades A1-C6 in WASSCE for university admission aggregates

### 4.3 University Level — Course Support
**Focus**: Foundational courses with high failure rates at Ghanaian universities (UG, KNUST, UCC, UDS, UPSA, etc.)
- Engineering Mathematics, Statistics, Accounting Principles, Programming Fundamentals, Anatomy & Physiology, Constitutional Law, Business Management
**Source Material**: Students upload their own course outlines, lecture notes, past exam papers
**Goal**: Students pass university exams, understand course material deeply

**IMPORTANT**: Ghanaian universities do NOT have entrance exams. Admission is based on WASSCE aggregate scores. Do not build entrance exam prep features.

## 5. Core Features

### 5.1 AI Virtual Teachers (Budget-Friendly SVG Avatars)

**What**: Illustrated Black African teacher characters rendered as SVG/CSS components with lip-sync animation and TTS voice.

**Teacher Roster (Launch)**:
| Teacher | Subject Area | Personality | Appearance |
|---------|-------------|-------------|------------|
| Madam Abena | Mathematics | Encouraging, uses real-world Ghana examples | Braids, warm brown skin (#8B5E3C), kente-accent blouse |
| Mr. Kwame | Science / Physics | Methodical, loves diagrams | Low fade haircut, dark skin (#6B4226), shirt and tie |
| Madam Esi | English Language | Gentle corrections, praise first | TWA hairstyle, medium brown (#A0714F), professional dress |
| Dr. Mensah | Social Studies / General | Scholarly, storytelling approach | Grey-touched short hair, dark skin (#3D2B1F), glasses |

**Technical Implementation**:
- Each teacher is a React component: `<TeacherAvatar teacher="abena" mood="explaining" />`
- SVG portrait with 4-5 mouth shape variants (closed, slight-open, open, wide, "O")
- CSS `@keyframes` for idle blink (every 3-4 seconds), subtle head movement
- JavaScript `AudioContext` analyser reads TTS audio amplitude → maps to mouth shapes for lip-sync
- TTS via Cloudflare Workers AI (included in Workers paid plan, no additional cost)
- Each teacher has a personality system prompt stored in D1
- Moods: `explaining`, `asking`, `encouraging`, `correcting`, `celebrating`

**Cost**: GHS 0 per teacher (SVG built once, CSS animation client-side, TTS included in CF plan)

### 5.2 Interactive Whiteboard (tldraw)

**What**: A full interactive whiteboard where AI teachers draw, write equations, sketch diagrams, and walk students through problems step-by-step — just like a real classroom.

**Technical Implementation**:
- Embed tldraw SDK (`npm install tldraw`) as a React component in the lesson view
- AI teacher "teaches" by calling tldraw's Editor API programmatically:
  - `editor.createShape()` for geometric shapes (triangles, circles, graphs)
  - `editor.createShape({ type: 'text' })` for equations, labels, annotations
  - `editor.createShape({ type: 'draw' })` for freehand drawings, arrows, underlines
- Drawing commands are timed to sync with TTS audio (each step has a `delay_ms` before execution)
- Students can also draw on the whiteboard (for working through practice problems)
- AI reads student drawings via `editor.getCurrentPageShapes()` and provides feedback
- Multiplayer: Durable Objects for WebSocket sync — live classroom sessions where teacher + students share the same board
- Whiteboard tools toolbar: Draw, Text, Shapes, Eraser, Clear, Undo
- Board state persisted in KV (per lesson, per student) so students can resume

**Lesson Content Format** (stored in D1):
```json
{
  "lesson_id": "shs-math-trig-01",
  "teacher": "abena",
  "subject": "core_mathematics",
  "level": "shs",
  "topic": "Trigonometric Ratios",
  "steps": [
    {
      "step": 1,
      "voice_script": "Good morning class! Today we are going to learn about trigonometric ratios. Let me draw a right-angled triangle on the board.",
      "board_actions": [
        { "action": "drawShape", "type": "triangle", "points": [[60,220],[220,220],[220,100]], "delay_ms": 2000 },
        { "action": "drawShape", "type": "rightAngleMarker", "position": [220,220], "delay_ms": 500 }
      ],
      "checkpoint": null
    },
    {
      "step": 2,
      "voice_script": "This longest side, opposite the right angle, is called the hypotenuse.",
      "board_actions": [
        { "action": "addLabel", "text": "Hypotenuse", "position": [140, 150], "color": "#EF9F27", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 5,
      "voice_script": "Now it is your turn. What is cosine of angle A? Type your answer below.",
      "board_actions": [],
      "checkpoint": {
        "type": "text_input",
        "question": "What is cos(A)?",
        "correct_answer": "Adjacent/Hypotenuse",
        "accept_variations": ["adj/hyp", "adjacent over hypotenuse", "Adj/Hyp"],
        "hint": "Remember CAH — Cosine equals Adjacent over Hypotenuse",
        "xp_reward": 50
      }
    }
  ]
}
```

### 5.3 Source-Grounded Knowledge (RAG System)

**What**: Upload syllabi, past exam papers, textbooks, and marking schemes. The AI teacher ONLY answers from these sources and cites the exact page/section.

**Technical Implementation**:
- Admin uploads PDF/DOCX files → stored in R2
- Cloudflare Queue triggers a Worker that:
  1. Extracts text (using pdf-parse or similar)
  2. Chunks text into ~500-token segments with overlap
  3. Generates embeddings via Workers AI embedding model
  4. Stores chunks + embeddings in Vectorize (or D1 with vector extension)
  5. Stores metadata (source file, page number, subject, level) in D1
- When student asks a question or AI teacher needs reference material:
  1. Query embedding generated from the question
  2. Vectorize returns top-K most relevant chunks
  3. Chunks injected into LLM context with citation markers
  4. LLM generates response grounded in those chunks
  5. Response includes clickable citation: "See WASSCE 2022, Paper 2, Q4(a)"
- Source types to ingest:
  - GES syllabi (per subject, per level)
  - Past BECE papers (2015-2025)
  - Past WASSCE papers (2015-2025)
  - WAEC Chief Examiner reports
  - WAEC marking schemes
  - University course outlines (user-uploaded)

### 5.4 Study Tools Engine

**What**: Auto-generated flashcards, quizzes, mind maps, and audio summaries from lesson content.

**Technical Implementation**:
- After each lesson, student can click "Generate study tools"
- LLM generates from the lesson content + RAG sources:
  - **Flashcards**: Question/answer pairs, stored in D1, with spaced repetition scheduling (SM-2 algorithm)
  - **Practice Quiz**: 10-question quiz matching the exam format (BECE: objective + theory; WASSCE: Paper 1 MCQ + Paper 2 essay)
  - **Audio Summary**: TTS reads a condensed 3-5 minute summary of the lesson, cached as MP3 in R2
  - **Mind Map**: JSON structure of key concepts → rendered as interactive SVG in the client
- All study tools tagged with subject, level, topic for organized review
- Progress tracked per student in D1 (which flashcards reviewed, quiz scores, streaks)

### 5.5 Multiplayer Classroom

**What**: Live rooms where a teacher (human or AI) teaches students in real-time with shared whiteboard.

**Technical Implementation**:
- Teacher creates a room → gets a 6-character join code
- Students join via code → WebSocket connection to a Durable Object
- Shared state: whiteboard (tldraw sync), chat, quiz responses, hand-raise queue
- AI moderator assists: poses follow-up questions, tracks who answered correctly, generates real-time leaderboard
- Room capacity: up to 50 students per room
- Room types:
  - **AI-led**: AI teacher runs the entire session autonomously
  - **Human-led + AI assist**: Human teacher controls the board, AI handles Q&A sidebar
  - **Study group**: Students collaborate, AI available as tutor on demand

### 5.6 Gamification & XP System

**What**: XP, streaks, badges, levels, and leaderboards to keep students coming back daily.

**Technical Implementation**:
- XP earned for: completing lessons (100 XP), passing quizzes (50 XP per quiz), daily login streak (25 XP), flashcard review sessions (10 XP per session), helping peers in multiplayer (30 XP)
- Levels: Trainee (0-500 XP) → Scholar (500-2000) → Master (2000-5000) → Expert (5000+) per subject
- Streaks: consecutive days of activity, displayed prominently, bonus XP multiplier at 7-day and 30-day marks
- Badges: "BECE Ready", "WASSCE Warrior", "Math Master", "Science Star", "100-Day Streak"
- Leaderboards: per school, per region, per subject, all-time
- Weekly challenges: "Complete 5 trigonometry lessons this week" with bonus XP
- Certificate generation: auto-generated PDF certificates for completing a full subject course
- All stored in D1 tables: `student_xp`, `student_badges`, `student_streaks`, `leaderboard_cache`

### 5.7 Audio Learning Hub

**What**: AI-generated podcast-style audio lessons for offline study, optimized for low-bandwidth areas.

**Technical Implementation**:
- For each lesson, generate two audio formats:
  1. **Lecture**: Single teacher voice TTS reading a comprehensive lesson summary (5-10 min)
  2. **Discussion**: Two TTS voices (teacher + curious student) discussing the topic conversationally (8-15 min)
- Audio files generated async via Cloudflare Queue → Workers AI TTS → stored as MP3 in R2
- PWA service worker caches audio for offline playback
- Playback UI: play/pause, speed control (0.75x, 1x, 1.25x, 1.5x), progress tracking
- Each audio tagged with subject, level, topic
- Students can queue downloads over WiFi for later offline listening

## 6. Database Schema (D1)

Key tables (not exhaustive):
- `teachers` — id, name, subject, personality_prompt, avatar_config, voice_config
- `lessons` — id, teacher_id, subject, level, topic, content_json, created_at
- `students` — id, user_id, level, school, region, created_at
- `student_progress` — id, student_id, lesson_id, status, score, xp_earned, completed_at
- `student_xp` — id, student_id, subject, total_xp, current_level, streak_days
- `flashcards` — id, student_id, lesson_id, front, back, next_review, ease_factor, interval
- `quiz_results` — id, student_id, lesson_id, score, answers_json, taken_at
- `rag_sources` — id, filename, subject, level, file_type, r2_key, chunk_count, uploaded_at
- `rag_chunks` — id, source_id, chunk_text, page_number, embedding_id, created_at
- `classrooms` — id, teacher_id, join_code, type, status, max_students, created_at
- `classroom_members` — id, classroom_id, student_id, joined_at, xp_earned
- `badges` — id, student_id, badge_type, earned_at
- `leaderboard_cache` — id, scope, period, rankings_json, computed_at

## 7. API Routes (Cloudflare Workers)

```
POST   /api/lessons/generate          — AI generates a new lesson for a topic
GET    /api/lessons/:id               — Fetch lesson content
POST   /api/lessons/:id/progress      — Update student progress
GET    /api/teachers                   — List available teachers
POST   /api/whiteboard/sync           — Whiteboard state sync (Durable Object)
POST   /api/rag/upload                — Upload source document for RAG
POST   /api/rag/query                 — Query RAG sources
POST   /api/study-tools/generate      — Generate flashcards/quiz/audio for a lesson
GET    /api/flashcards                 — Get due flashcards (spaced repetition)
POST   /api/flashcards/:id/review     — Record flashcard review
POST   /api/quiz/submit               — Submit quiz answers
GET    /api/xp/profile                — Get student XP, level, streak, badges
GET    /api/leaderboard/:scope        — Get leaderboard (school/region/subject)
POST   /api/classroom/create          — Create live classroom room
POST   /api/classroom/join            — Join classroom via code
GET    /api/audio/:lesson_id          — Get audio lesson URL
POST   /api/tts/stream                — Stream TTS audio for real-time teaching
```

## 8. Pages / Routes (React Frontend)

```
/classroom                        — eClassroom home (subject picker, continue learning)
/classroom/lesson/:id             — Active lesson view (whiteboard + teacher + progress)
/classroom/live/:code             — Live multiplayer classroom
/classroom/subjects               — Browse subjects by level (JHS/SHS/Uni)
/classroom/subject/:id            — Subject overview (lessons, progress, quiz scores)
/classroom/study-tools            — Flashcards, quizzes, audio lessons hub
/classroom/flashcards             — Spaced repetition review session
/classroom/quiz/:id               — Take a practice quiz
/classroom/audio                  — Audio learning hub (browse, download, play)
/classroom/leaderboard            — XP leaderboards
/classroom/profile                — Student profile, XP, badges, certificates
/classroom/admin/content          — Admin: manage lessons, upload RAG sources
/classroom/admin/teachers         — Admin: manage AI teacher personas
```

## 9. Non-Functional Requirements

- **Performance**: Lessons load in <2s on 3G connections common in Ghana
- **Offline**: PWA with service worker caching for audio lessons and flashcards
- **Mobile-first**: 80%+ of Ghanaian students access via mobile phones
- **Data sovereignty**: All data stored on Cloudflare infrastructure, never sent to third-party AI APIs (all LLM inference via Workers AI)
- **Accessibility**: Works on low-end Android devices, minimal data consumption
- **Multilingual (future)**: English first, Ewe/Twi/Ga TTS support when models become available

## 10. Build Phases

### Phase 1 — Foundation (Week 1-2)
- D1 schema setup (all tables)
- Teacher avatar React components (4 teachers, SVG + CSS animation)
- TTS integration with Workers AI
- Basic lesson view with teacher panel + placeholder whiteboard
- Student auth integration with existing AskOzzy auth

### Phase 2 — Whiteboard & Teaching (Week 3-4)
- tldraw integration (embed in lesson view)
- WhiteboardTeacher service (translates lesson JSON → tldraw editor commands)
- Audio-synced teaching flow (TTS + board drawing + step progression)
- 10 sample lessons: 5 BECE Math, 5 WASSCE Core Math
- Lesson checkpoint system (embedded quizzes within lessons)

### Phase 3 — RAG & Curriculum (Week 5-6)
- File upload pipeline (R2 + Queue + text extraction + chunking)
- Vectorize integration for embeddings
- RAG query endpoint
- Upload initial source documents (GES syllabi, past papers)
- AI-generated lesson content from RAG sources

### Phase 4 — Study Tools & Gamification (Week 7-8)
- Flashcard generation + spaced repetition (SM-2)
- Quiz generation matching exam formats
- Audio summary generation
- XP system, streak tracking, badge awards
- Leaderboard computation and display

### Phase 5 — Multiplayer & Audio Hub (Week 9-10)
- Durable Object for classroom WebSocket rooms
- tldraw multiplayer sync
- Join code system, hand-raise, live leaderboard
- Audio learning hub with PWA offline caching
- Speed controls, download queue

### Phase 6 — Polish & Content (Week 11-12)
- Full lesson library: all BECE subjects, major WASSCE subjects
- Certificate PDF generation
- Mobile responsiveness pass
- Performance optimization (3G testing)
- Beta launch to pilot group of students
