---
name: eclassroom
description: "Use this skill when building any part of the eClassroom AI-powered academic preparation platform within AskOzzy.work. Covers: AI teacher SVG avatars with lip-sync, tldraw interactive whiteboard integration, lesson JSON schema and playback, RAG pipeline for curriculum documents, study tools (flashcards with SM-2 spaced repetition, quiz generation, audio summaries), multiplayer classroom via Durable Objects, XP/gamification system, and audio learning hub. Trigger on any mention of: eClassroom, AI teacher, whiteboard lesson, BECE prep, WASSCE prep, teacher avatar, lesson player, flashcards, spaced repetition, live classroom, XP system, RAG upload, or curriculum alignment."
---

# eClassroom — AI Academic Preparation Platform Skill

## Quick Context

eClassroom is a module within AskOzzy.work where Black African AI teachers teach Ghanaian students on interactive whiteboards. Stack: React+TS+Vite on Cloudflare Pages, Workers API, D1, KV, R2, Durable Objects, Workers AI, Vectorize, Queues, tldraw SDK.

**Critical rule**: Ghanaian universities do NOT have entrance exams. Admission is based on WASSCE aggregate scores. Never build entrance exam features.

## Component Patterns

### Teacher Avatar Component

Every teacher avatar follows this exact pattern:

```tsx
// src/components/teacher/TeacherAvatar.tsx
import { useEffect, useRef, useState } from 'react';

type Mood = 'explaining' | 'asking' | 'encouraging' | 'correcting' | 'celebrating';
type MouthShape = 'closed' | 'slight' | 'open' | 'wide' | 'o';

interface TeacherAvatarProps {
  teacher: 'abena' | 'kwame' | 'esi' | 'mensah';
  mood: Mood;
  audioRef?: React.RefObject<HTMLAudioElement>;
  size?: number;
}

// Lip-sync: AudioContext analyser → mouth shape
function useLipSync(audioRef?: React.RefObject<HTMLAudioElement>): MouthShape {
  const [mouth, setMouth] = useState<MouthShape>('closed');
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!audioRef?.current) return;
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audioRef.current);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    analyserRef.current = analyser;

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
    return () => { cancelAnimationFrame(rafRef.current); ctx.close(); };
  }, [audioRef]);

  return mouth;
}
```

**Skin tone constants** (hardcoded, never use theme variables):
```ts
const SKIN_TONES = {
  abena: '#8B5E3C',
  kwame: '#6B4226',
  esi: '#A0714F',
  mensah: '#3D2B1F',
} as const;
```

**Mouth shapes** are SVG path variants on the face:
```tsx
const MOUTH_PATHS: Record<MouthShape, string> = {
  closed: 'M36 33 Q40 35 44 33',           // neutral line
  slight: 'M36 33 Q40 36 44 33',           // slightly open
  open:   'M36 33 Q40 38 44 33 Q40 35 36 33', // open oval
  wide:   'M35 32 Q40 40 45 32 Q40 34 35 32', // wide open
  o:      'M37 32 Q40 38 43 32 Q40 34 37 32', // rounded O
};
```

### Whiteboard Teaching Service

The WhiteboardTeacher service translates lesson JSON steps into tldraw Editor API calls:

```ts
// src/components/whiteboard/WhiteboardTeacher.ts
import type { Editor } from 'tldraw';
import type { BoardAction, LessonStep } from '@/types/lesson';

export class WhiteboardTeacher {
  constructor(private editor: Editor) {}

  async executeStep(step: LessonStep): Promise<void> {
    for (const action of step.board_actions) {
      await this.delay(action.delay_ms);
      await this.executeAction(action);
    }
  }

  private async executeAction(action: BoardAction): Promise<void> {
    switch (action.action) {
      case 'drawShape':
        this.editor.createShape({
          type: 'geo',
          x: action.position?.[0] ?? 0,
          y: action.position?.[1] ?? 0,
          props: { geo: action.type, w: action.width, h: action.height },
        });
        break;
      case 'addLabel':
        this.editor.createShape({
          type: 'text',
          x: action.position[0],
          y: action.position[1],
          props: { text: action.text, color: action.color ?? 'white', size: 'm' },
        });
        break;
      case 'drawLine':
        this.editor.createShape({
          type: 'line',
          props: {
            points: action.points.reduce((acc, [x, y], i) => {
              acc[`a${i}`] = { id: `a${i}`, index: `a${i}`, x, y };
              return acc;
            }, {} as Record<string, any>),
          },
        });
        break;
      case 'clearBoard':
        this.editor.selectAll().deleteShapes(this.editor.getSelectedShapeIds());
        break;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### Lesson Player Orchestrator

Coordinates TTS audio, whiteboard drawing, and step progression:

```ts
// src/components/lesson/LessonPlayer.ts
export class LessonPlayer {
  private currentStep = 0;
  private audioElement: HTMLAudioElement;
  private whiteboardTeacher: WhiteboardTeacher;

  async playStep(step: LessonStep): Promise<void> {
    // 1. Start TTS audio
    const audioUrl = await this.fetchTTS(step.voice_script);
    this.audioElement.src = audioUrl;
    await this.audioElement.play();

    // 2. Execute board actions (timed to audio)
    await this.whiteboardTeacher.executeStep(step);

    // 3. Wait for audio to finish
    await new Promise(resolve => {
      this.audioElement.onended = resolve;
    });

    // 4. Show checkpoint if present
    if (step.checkpoint) {
      await this.showCheckpoint(step.checkpoint);
    }

    // 5. Advance to next step
    this.currentStep++;
  }

  private async fetchTTS(text: string): Promise<string> {
    const res = await fetch('/api/tts/stream', {
      method: 'POST',
      body: JSON.stringify({ text, teacher: this.teacherId }),
    });
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }
}
```

### Spaced Repetition (SM-2 Algorithm)

For flashcard scheduling:

```ts
// src/services/spaced-repetition.ts
interface ReviewResult {
  quality: 0 | 1 | 2 | 3 | 4 | 5; // 0=blackout, 5=perfect
}

interface CardState {
  ease_factor: number;  // starts at 2.5
  interval: number;     // days until next review
  repetitions: number;
}

export function calculateNextReview(card: CardState, result: ReviewResult): CardState {
  const { quality } = result;
  let { ease_factor, interval, repetitions } = card;

  if (quality < 3) {
    // Failed — reset
    repetitions = 0;
    interval = 1;
  } else {
    // Passed
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * ease_factor);
    repetitions++;
  }

  ease_factor = Math.max(1.3,
    ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );

  return { ease_factor, interval, repetitions };
}
```

### RAG Pipeline Worker

Queue consumer that processes uploaded documents:

```ts
// workers/rag-processor/index.ts
export default {
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const { sourceId, r2Key } = msg.body as { sourceId: string; r2Key: string };

      // 1. Fetch file from R2
      const obj = await env.R2.get(r2Key);
      if (!obj) continue;
      const buffer = await obj.arrayBuffer();

      // 2. Extract text (use pdf-parse for PDFs)
      const text = await extractText(buffer, r2Key);

      // 3. Chunk with overlap
      const chunks = chunkText(text, { chunkSize: 500, overlap: 50 });

      // 4. Generate embeddings via Workers AI
      const embeddings = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
        text: chunks.map(c => c.text),
      });

      // 5. Store in Vectorize + D1
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = `${sourceId}-${i}`;
        await env.VECTORIZE.upsert([{
          id: chunkId,
          values: embeddings.data[i],
          metadata: { sourceId, pageNumber: chunks[i].page, text: chunks[i].text },
        }]);
        await env.DB.prepare(
          'INSERT INTO rag_chunks (id, source_id, chunk_text, page_number, embedding_id) VALUES (?, ?, ?, ?, ?)'
        ).bind(chunkId, sourceId, chunks[i].text, chunks[i].page, chunkId).run();
      }

      msg.ack();
    }
  },
};
```

### Durable Object for Live Classroom

```ts
// workers/classroom-do/index.ts
export class ClassroomDO implements DurableObject {
  private sessions: Map<WebSocket, { studentId: string; name: string }> = new Map();
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      // Parse student info from URL params
      const url = new URL(request.url);
      this.sessions.set(server, {
        studentId: url.searchParams.get('studentId') ?? '',
        name: url.searchParams.get('name') ?? 'Student',
      });
      this.broadcast({ type: 'student_joined', name: url.searchParams.get('name') });
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('Expected WebSocket', { status: 400 });
  }

  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    const data = JSON.parse(message);
    switch (data.type) {
      case 'hand_raise':
        this.broadcast({ type: 'hand_raised', studentId: data.studentId, name: data.name });
        break;
      case 'quiz_answer':
        this.broadcast({ type: 'quiz_response', studentId: data.studentId, answer: data.answer });
        break;
      case 'whiteboard_sync':
        // Forward tldraw sync messages to all other clients
        this.broadcast(data, ws);
        break;
    }
  }

  private broadcast(data: any, exclude?: WebSocket): void {
    const msg = JSON.stringify(data);
    for (const [ws] of this.sessions) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }
}
```

## D1 Migration Pattern

Always create migrations in `migrations/` directory:

```sql
-- migrations/0001_eclassroom_base.sql
CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  personality_prompt TEXT NOT NULL,
  avatar_config TEXT NOT NULL, -- JSON: { skinTone, hairstyle, attire }
  voice_config TEXT NOT NULL,  -- JSON: { model, speed, pitch }
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id),
  subject TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('jhs', 'shs', 'university')),
  topic TEXT NOT NULL,
  content_json TEXT NOT NULL,
  estimated_minutes INTEGER DEFAULT 15,
  xp_reward INTEGER DEFAULT 100,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ... (see PRD for full schema)
```

## Testing Checklist

Before marking any task complete, verify:
- [ ] Works on Chrome Android (DevTools mobile simulation, Moto G Power profile)
- [ ] Works on 3G throttled connection (DevTools Network → Slow 3G)
- [ ] No external API calls to non-Cloudflare services
- [ ] All D1 queries use prepared statements
- [ ] Teacher skin tones render correctly (not washed out or theme-inverted)
- [ ] tldraw whiteboard loads without blocking lesson audio
- [ ] PWA service worker caches critical assets for offline use
