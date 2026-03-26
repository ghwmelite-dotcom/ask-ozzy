# eClassroom — Claude Code Quick Start Guide

## How to Use These Files

You have 3 files that work together with your CCPM workflow:

| File | Purpose | Where to put it |
|------|---------|-----------------|
| `eclassroom-prd.md` | Product requirements — feeds into CCPM Plan phase | `docs/prd.md` in your project |
| `CLAUDE.md` | Project context Claude Code reads automatically on every invocation | Root of your project repo |
| `eclassroom-skill.md` | Code patterns & component templates for Claude Code agents | `/mnt/skills/user/eclassroom/SKILL.md` (or project `skills/` folder) |

---

## Step-by-Step Setup

### Step 1: Create your project repo

```bash
# Create the project (or cd into your existing AskOzzy repo)
mkdir askozzy-eclassroom && cd askozzy-eclassroom
git init

# Initialize React + Vite + TypeScript
npm create vite@latest . -- --template react-ts
npm install

# Install key dependencies
npm install tldraw
npm install wrangler --save-dev
```

### Step 2: Place the files

```bash
# Copy CLAUDE.md to project root (Claude Code reads this automatically)
cp /path/to/CLAUDE.md ./CLAUDE.md

# Create docs directory and place PRD
mkdir -p docs
cp /path/to/eclassroom-prd.md ./docs/prd.md

# Place skill file (choose one location):

# Option A: User-level skill (available across all projects)
mkdir -p ~/.claude/skills/eclassroom
cp /path/to/eclassroom-skill.md ~/.claude/skills/eclassroom/SKILL.md

# Option B: Project-level skill (only this project)
mkdir -p skills/eclassroom
cp /path/to/eclassroom-skill.md ./skills/eclassroom/SKILL.md
```

### Step 3: Initialize with CCPM

Open Claude Code in your project directory and run these commands in sequence:

```
# PHASE 1: Generate the epic from the PRD
> I want to build eClassroom. Read docs/prd.md and turn it into an epic.
  Focus on Phase 1 (Foundation) first — we will do other phases as separate epics.

# Claude Code will read the PRD and create an epic file in docs/epics/

# PHASE 2: Decompose into tasks
> Break down the eClassroom Phase 1 epic into tasks

# Claude Code creates numbered task files with dependencies

# PHASE 3: Push to GitHub
> Sync the eClassroom Phase 1 epic to GitHub

# Creates GitHub issues for each task

# PHASE 4: Start building
> Start working on issue 1 (D1 schema setup)

# Claude Code analyzes the task and begins coding
```

### Step 4: The Build Sequence

Here is the exact order to feed tasks to Claude Code, one epic at a time:

#### Epic 1: Foundation (do this first)
```
> Let's plan eClassroom Phase 1 Foundation — read docs/prd.md sections 5.1, 6, 7, 8
```
This creates tasks for:
1. D1 schema migration (all tables)
2. Wrangler.toml configuration (D1, KV, R2, DO bindings)
3. API Worker scaffold with route structure
4. TeacherAvatar React component (SVG portraits for 4 teachers)
5. LipSync hook (AudioContext → mouth shape)
6. TTS integration endpoint (/api/tts/stream)
7. Basic lesson view page layout (whiteboard area + teacher panel + progress sidebar)
8. Student auth integration (connect to existing AskOzzy auth)

#### Epic 2: Whiteboard & Teaching
```
> Let's plan eClassroom Phase 2 Whiteboard — read docs/prd.md section 5.2
```
Tasks:
1. tldraw embed component with dark board theme
2. WhiteboardTeacher service (lesson JSON → editor commands)
3. LessonPlayer orchestrator (sync TTS + board + steps)
4. Checkpoint component (embedded quiz within lesson flow)
5. Whiteboard toolbar (draw, text, shapes, eraser)
6. 5 sample BECE Math lesson JSONs
7. 5 sample WASSCE Core Math lesson JSONs
8. Board state persistence (save/resume via KV)

#### Epic 3: RAG & Curriculum
```
> Let's plan eClassroom Phase 3 RAG — read docs/prd.md section 5.3
```
Tasks:
1. R2 upload endpoint with file validation
2. Queue producer (trigger processing on upload)
3. RAG processor Worker (extract text → chunk → embed → Vectorize)
4. RAG query endpoint (embed question → search → inject context)
5. Citation system (source + page number references)
6. Admin content upload UI
7. Ingest initial GES syllabi and past papers

#### Epic 4: Study Tools & Gamification
```
> Let's plan eClassroom Phase 4 Study Tools — read docs/prd.md sections 5.4, 5.6
```

#### Epic 5: Multiplayer & Audio
```
> Let's plan eClassroom Phase 5 Multiplayer — read docs/prd.md sections 5.5, 5.7
```

### Step 5: Daily Workflow

Each day when you open Claude Code:

```
# Check where things stand
> standup

# See what is next
> what's next

# Start working on the next issue
> start working on issue N

# When you want parallel work (e.g., frontend + backend simultaneously)
> analyze parallel work streams for the current epic
> start working on issues 5 and 6 in parallel
```

---

## Key Prompts for Specific Tasks

### Building a teacher avatar
```
> Build the Madam Abena SVG avatar component. She has braids, warm brown skin
  (#8B5E3C), and a kente-accent blouse. Follow the TeacherAvatar pattern in the
  eclassroom skill. Include all 5 mouth shapes and idle blink animation.
```

### Building the whiteboard integration
```
> Integrate tldraw into the lesson view. The whiteboard should fill the main
  content area with a dark background (#1a2332). Include the WhiteboardTeacher
  service that executes board_actions from lesson JSON. Follow the patterns in
  the eclassroom skill.
```

### Building a lesson
```
> Create a lesson JSON for WASSCE Core Mathematics: Trigonometric Ratios.
  Follow the lesson content format in the PRD. Include at least 8 steps with
  board_actions that progressively draw a right triangle, label the sides,
  write out SOH CAH TOA, and include 2 checkpoints (one MCQ, one text input).
  Use Madam Abena as the teacher. Make the voice scripts natural and
  encouraging with Ghana-relevant examples.
```

### Building the RAG pipeline
```
> Build the RAG processor Queue consumer worker. It should: fetch PDF from R2,
  extract text using pdf-parse, chunk into ~500 token segments with 50-token
  overlap, generate embeddings via Workers AI @cf/baai/bge-base-en-v1.5, and
  store in Vectorize + D1. Follow the pattern in the eclassroom skill.
```

### Building the XP system
```
> Build the XP tracking system. D1 tables for student_xp, badges, and streaks.
  Worker API endpoints for: award XP, get profile, get leaderboard. React
  components for XP display bar, streak counter, and badge gallery. Follow
  the XP values defined in PRD section 5.6.
```

---

## Troubleshooting

**Claude Code doesn't see CLAUDE.md**: Make sure it's in the root of your working directory when you launch Claude Code. It reads `CLAUDE.md` automatically from the project root.

**Skill not triggering**: If using project-level skills, make sure the path matches what Claude Code expects. Try referencing it explicitly: "Read the eclassroom skill file and follow its patterns."

**tldraw import issues**: tldraw requires `"moduleResolution": "bundler"` in tsconfig.json. Claude Code should handle this but double-check if you get import errors.

**Workers AI TTS not available**: Check your Cloudflare plan. Workers AI TTS requires the Workers Paid plan ($5/month). Verify with `wrangler ai models list`.

**Durable Objects not deploying**: Ensure `wrangler.toml` has the DO binding and the class is exported from the worker entry point with the exact name specified in the binding.
