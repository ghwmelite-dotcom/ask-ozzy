# eClassroom Phase 2 — Whiteboard & Teaching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the whiteboard placeholder with a live tldraw canvas, build the WhiteboardTeacher service that draws on the board in sync with TTS audio, add checkpoint quizzes, and seed 10 sample lessons.

**Architecture:** tldraw SDK embedded in LessonView, WhiteboardTeacher translates lesson JSON board_actions into tldraw Editor API calls, LessonPlayer orchestrates the TTS→board→checkpoint flow. All runs client-side in the React app.

**Tech Stack:** tldraw 3.x, React 18, TypeScript, existing TTS service from Phase 1

---

## File Structure

- **Modify:** `eclassroom/package.json` — Add tldraw dependency
- **Create:** `eclassroom/src/components/whiteboard/Whiteboard.tsx` — tldraw wrapper with dark theme
- **Create:** `eclassroom/src/components/whiteboard/WhiteboardTeacher.ts` — Lesson JSON → tldraw commands
- **Create:** `eclassroom/src/components/lesson/LessonPlayer.ts` — TTS + board + step orchestrator
- **Create:** `eclassroom/src/components/lesson/Checkpoint.tsx` — Embedded quiz component (MCQ + text input)
- **Modify:** `eclassroom/src/components/lesson/LessonView.tsx` — Replace placeholder with tldraw + wire LessonPlayer
- **Create:** `migrations/eclassroom-sample-lessons-batch.sql` — 9 more sample lessons (10 total)

---

## Task 1: Install tldraw + Whiteboard Component

**Files:**
- Modify: `eclassroom/package.json`
- Create: `eclassroom/src/components/whiteboard/Whiteboard.tsx`

- [ ] **Step 1: Install tldraw**
```bash
cd eclassroom && npm install tldraw
```

- [ ] **Step 2: Create Whiteboard wrapper**

`eclassroom/src/components/whiteboard/Whiteboard.tsx`:
```tsx
import { Tldraw, Editor } from 'tldraw';
import 'tldraw/tldraw.css';
import { useCallback } from 'react';

interface WhiteboardProps {
  onEditorReady: (editor: Editor) => void;
  readOnly?: boolean;
}

export function Whiteboard({ onEditorReady, readOnly = false }: WhiteboardProps) {
  const handleMount = useCallback((editor: Editor) => {
    // Dark board background
    editor.user.updateUserPreferences({ colorScheme: 'dark' });
    // Zoom to fit content area
    editor.zoomToFit();
    onEditorReady(editor);
  }, [onEditorReady]);

  return (
    <div className="w-full h-full" style={{ background: '#1a2332' }}>
      <Tldraw
        onMount={handleMount}
        hideUi={readOnly}
        inferDarkMode
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify build**
```bash
cd eclassroom && npm run build
```

---

## Task 2: WhiteboardTeacher Service

**Files:**
- Create: `eclassroom/src/components/whiteboard/WhiteboardTeacher.ts`

- [ ] **Step 1: Create the service**

`eclassroom/src/components/whiteboard/WhiteboardTeacher.ts`:
```ts
import type { Editor } from 'tldraw';
import { createShapeId } from 'tldraw';
import type { BoardAction, LessonStep } from '@/types/lesson';

export class WhiteboardTeacher {
  private shapeCounter = 0;

  constructor(private editor: Editor) {}

  async executeStep(step: LessonStep): Promise<void> {
    for (const action of step.board_actions) {
      if (action.delay_ms > 0) {
        await this.delay(action.delay_ms);
      }
      this.executeAction(action);
    }
  }

  private executeAction(action: BoardAction): void {
    switch (action.action) {
      case 'drawShape':
        this.drawShape(action);
        break;
      case 'addLabel':
        this.addLabel(action);
        break;
      case 'drawLine':
        this.drawLine(action);
        break;
      case 'clearBoard':
        this.clearBoard();
        break;
    }
  }

  private drawShape(action: BoardAction & { action: 'drawShape' }): void {
    if (action.points && action.points.length >= 3) {
      // Draw as freehand polygon using draw shape
      const segments = [{
        type: 'free' as const,
        points: action.points.map(([x, y]) => ({ x, y, z: 0.5 })),
      }];
      // Close the shape
      segments[0].points.push({ x: action.points[0][0], y: action.points[0][1], z: 0.5 });

      this.editor.createShape({
        id: createShapeId(`wb-${this.shapeCounter++}`),
        type: 'draw',
        x: 0,
        y: 0,
        props: {
          segments,
          color: 'white',
          size: 'm',
          isClosed: true,
          isComplete: true,
        },
      });
    } else if (action.position && action.width && action.height) {
      this.editor.createShape({
        id: createShapeId(`wb-${this.shapeCounter++}`),
        type: 'geo',
        x: action.position[0],
        y: action.position[1],
        props: {
          geo: action.type === 'circle' ? 'ellipse' : 'rectangle',
          w: action.width,
          h: action.height,
          color: 'white',
          fill: 'none',
          size: 'm',
        },
      });
    }
  }

  private addLabel(action: BoardAction & { action: 'addLabel' }): void {
    this.editor.createShape({
      id: createShapeId(`wb-${this.shapeCounter++}`),
      type: 'text',
      x: action.position[0],
      y: action.position[1],
      props: {
        text: action.text,
        color: this.mapColor(action.color),
        size: 'm',
        autoSize: true,
      },
    });
  }

  private drawLine(action: BoardAction & { action: 'drawLine' }): void {
    if (action.points.length < 2) return;
    const segments = [{
      type: 'free' as const,
      points: action.points.map(([x, y]) => ({ x, y, z: 0.5 })),
    }];

    this.editor.createShape({
      id: createShapeId(`wb-${this.shapeCounter++}`),
      type: 'draw',
      x: 0,
      y: 0,
      props: {
        segments,
        color: this.mapColor(action.color),
        size: 'm',
        isComplete: true,
      },
    });
  }

  private clearBoard(): void {
    const allShapeIds = this.editor.getCurrentPageShapeIds();
    if (allShapeIds.size > 0) {
      this.editor.deleteShapes([...allShapeIds]);
    }
  }

  private mapColor(hex?: string): string {
    // Map hex colors to tldraw's built-in color names
    if (!hex) return 'white';
    const colorMap: Record<string, string> = {
      '#FCD116': 'yellow',
      '#EF9F27': 'orange',
      '#4FC3F7': 'light-blue',
      '#81C784': 'light-green',
      '#FF5252': 'red',
      '#CE1126': 'red',
      '#FFFFFF': 'white',
      '#ffffff': 'white',
    };
    return colorMap[hex] ?? 'white';
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  reset(): void {
    this.clearBoard();
    this.shapeCounter = 0;
  }
}
```

---

## Task 3: LessonPlayer Orchestrator

**Files:**
- Create: `eclassroom/src/components/lesson/LessonPlayer.ts`

- [ ] **Step 1: Create the orchestrator**

`eclassroom/src/components/lesson/LessonPlayer.ts`:
```ts
import type { LessonStep, Checkpoint } from '@/types/lesson';
import type { Mood } from '@/types/teacher';
import { WhiteboardTeacher } from '@/components/whiteboard/WhiteboardTeacher';
import { fetchTTSAudio, revokeTTSUrl } from '@/services/tts';

export type PlayerState = 'idle' | 'playing' | 'paused' | 'checkpoint' | 'completed';

export interface PlayerCallbacks {
  onStepChange: (step: number) => void;
  onMoodChange: (mood: Mood) => void;
  onStateChange: (state: PlayerState) => void;
  onStepComplete: (step: number) => void;
  onCheckpoint: (checkpoint: Checkpoint, stepNumber: number) => void;
  onLessonComplete: () => void;
}

export class LessonPlayer {
  private currentStepIndex = 0;
  private state: PlayerState = 'idle';
  private audioElement: HTMLAudioElement;
  private whiteboardTeacher: WhiteboardTeacher;
  private callbacks: PlayerCallbacks;
  private steps: LessonStep[];
  private teacherId: string;
  private currentTTSUrl: string | null = null;
  private abortController: AbortController | null = null;

  constructor(
    audioElement: HTMLAudioElement,
    whiteboardTeacher: WhiteboardTeacher,
    steps: LessonStep[],
    teacherId: string,
    callbacks: PlayerCallbacks,
  ) {
    this.audioElement = audioElement;
    this.whiteboardTeacher = whiteboardTeacher;
    this.steps = steps;
    this.teacherId = teacherId;
    this.callbacks = callbacks;
  }

  async play(): Promise<void> {
    if (this.state === 'completed') return;

    if (this.state === 'paused') {
      this.audioElement.play();
      this.setState('playing');
      return;
    }

    this.setState('playing');
    await this.playFromCurrentStep();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.audioElement.pause();
    this.setState('paused');
  }

  async resumeAfterCheckpoint(): Promise<void> {
    if (this.state !== 'checkpoint') return;
    this.callbacks.onStepComplete(this.steps[this.currentStepIndex].step);
    this.currentStepIndex++;

    if (this.currentStepIndex >= this.steps.length) {
      this.setState('completed');
      this.callbacks.onLessonComplete();
      return;
    }

    this.setState('playing');
    await this.playFromCurrentStep();
  }

  stop(): void {
    this.abortController?.abort();
    this.audioElement.pause();
    this.audioElement.src = '';
    if (this.currentTTSUrl) {
      revokeTTSUrl(this.currentTTSUrl);
      this.currentTTSUrl = null;
    }
    this.setState('idle');
  }

  getCurrentStep(): number {
    return this.steps[this.currentStepIndex]?.step ?? 0;
  }

  private async playFromCurrentStep(): Promise<void> {
    while (this.currentStepIndex < this.steps.length && this.state === 'playing') {
      const step = this.steps[this.currentStepIndex];
      this.callbacks.onStepChange(step.step);

      // Set mood based on step content
      if (step.checkpoint) {
        this.callbacks.onMoodChange('asking');
      } else {
        this.callbacks.onMoodChange('explaining');
      }

      // Fetch and play TTS
      this.abortController = new AbortController();
      try {
        const audioUrl = await fetchTTSAudio(step.voice_script, this.teacherId);
        if (this.state !== 'playing') {
          revokeTTSUrl(audioUrl);
          return;
        }

        this.currentTTSUrl = audioUrl;
        this.audioElement.src = audioUrl;

        // Start audio and board actions concurrently
        const audioPromise = new Promise<void>((resolve) => {
          this.audioElement.onended = () => resolve();
          this.audioElement.onerror = () => resolve();
        });

        await this.audioElement.play().catch(() => {});
        const boardPromise = this.whiteboardTeacher.executeStep(step);

        // Wait for both audio and board actions
        await Promise.all([audioPromise, boardPromise]);

        // Cleanup TTS URL
        if (this.currentTTSUrl) {
          revokeTTSUrl(this.currentTTSUrl);
          this.currentTTSUrl = null;
        }
      } catch {
        if (this.state !== 'playing') return;
      }

      if (this.state !== 'playing') return;

      // Check for checkpoint
      if (step.checkpoint) {
        this.callbacks.onMoodChange('asking');
        this.setState('checkpoint');
        this.callbacks.onCheckpoint(step.checkpoint, step.step);
        return; // Pauses until resumeAfterCheckpoint()
      }

      // Mark step complete and advance
      this.callbacks.onStepComplete(step.step);
      this.callbacks.onMoodChange('encouraging');
      this.currentStepIndex++;
    }

    if (this.currentStepIndex >= this.steps.length) {
      this.setState('completed');
      this.callbacks.onLessonComplete();
    }
  }

  private setState(state: PlayerState): void {
    this.state = state;
    this.callbacks.onStateChange(state);
  }
}
```

---

## Task 4: Checkpoint Component

**Files:**
- Create: `eclassroom/src/components/lesson/Checkpoint.tsx`

- [ ] **Step 1: Create the Checkpoint component**

`eclassroom/src/components/lesson/Checkpoint.tsx`:
```tsx
import { useState } from 'react';
import type { Checkpoint as CheckpointType } from '@/types/lesson';

interface CheckpointProps {
  checkpoint: CheckpointType;
  onAnswer: (correct: boolean, xpEarned: number) => void;
}

export function Checkpoint({ checkpoint, onAnswer }: CheckpointProps) {
  const [answer, setAnswer] = useState('');
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const checkAnswer = () => {
    let correct = false;

    if (checkpoint.type === 'mcq') {
      correct = selectedOption === checkpoint.correct_answer;
    } else {
      const normalized = answer.trim().toLowerCase();
      const correctNormalized = checkpoint.correct_answer.toLowerCase();
      const variations = (checkpoint.accept_variations ?? []).map(v => v.toLowerCase());
      correct = normalized === correctNormalized || variations.includes(normalized);
    }

    setIsCorrect(correct);
    setSubmitted(true);
  };

  const handleContinue = () => {
    onAnswer(isCorrect, isCorrect ? checkpoint.xp_reward : 0);
  };

  return (
    <div
      className="absolute inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(15, 20, 25, 0.85)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="w-full max-w-md mx-4 p-6 rounded-2xl"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
      >
        {/* Question */}
        <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          {checkpoint.question}
        </h3>

        {!submitted ? (
          <>
            {/* MCQ Options */}
            {checkpoint.type === 'mcq' && checkpoint.options && (
              <div className="flex flex-col gap-2 mb-4">
                {checkpoint.options.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setSelectedOption(opt)}
                    className="text-left px-4 py-3 rounded-xl text-sm font-medium transition-all"
                    style={{
                      background: selectedOption === opt ? 'rgba(252,209,22,0.15)' : 'var(--bg-tertiary)',
                      border: `2px solid ${selectedOption === opt ? 'var(--accent)' : 'var(--border)'}`,
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {/* Text Input */}
            {checkpoint.type === 'text_input' && (
              <input
                type="text"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type your answer..."
                className="w-full px-4 py-3 rounded-xl text-sm mb-4"
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '2px solid var(--border)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && answer.trim()) checkAnswer();
                }}
                autoFocus
              />
            )}

            {/* Hint */}
            {checkpoint.hint && (
              <button
                onClick={() => setShowHint(true)}
                className="text-xs mb-4 block"
                style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {showHint ? checkpoint.hint : 'Show hint'}
              </button>
            )}

            {/* Submit */}
            <button
              onClick={checkAnswer}
              disabled={checkpoint.type === 'mcq' ? !selectedOption : !answer.trim()}
              className="w-full py-3 rounded-xl text-sm font-bold transition-all"
              style={{
                background: 'var(--accent)',
                color: '#000',
                border: 'none',
                cursor: 'pointer',
                opacity: (checkpoint.type === 'mcq' ? !selectedOption : !answer.trim()) ? 0.5 : 1,
              }}
            >
              Check Answer
            </button>
          </>
        ) : (
          <>
            {/* Result */}
            <div
              className="p-4 rounded-xl mb-4 text-center"
              style={{
                background: isCorrect ? 'rgba(0,200,83,0.1)' : 'rgba(255,82,82,0.1)',
                border: `1px solid ${isCorrect ? 'var(--success)' : 'var(--error)'}`,
              }}
            >
              <p className="text-2xl mb-1">{isCorrect ? '🎉' : '💡'}</p>
              <p className="font-bold" style={{ color: isCorrect ? 'var(--success)' : 'var(--error)' }}>
                {isCorrect ? 'Correct!' : 'Not quite!'}
              </p>
              {isCorrect && (
                <p className="text-xs mt-1" style={{ color: 'var(--accent)' }}>
                  +{checkpoint.xp_reward} XP
                </p>
              )}
              {!isCorrect && (
                <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                  The answer is: <strong style={{ color: 'var(--text-primary)' }}>{checkpoint.correct_answer}</strong>
                </p>
              )}
            </div>

            <button
              onClick={handleContinue}
              className="w-full py-3 rounded-xl text-sm font-bold"
              style={{ background: 'var(--accent)', color: '#000', border: 'none', cursor: 'pointer' }}
            >
              Continue
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

---

## Task 5: Wire Everything into LessonView

**Files:**
- Modify: `eclassroom/src/components/lesson/LessonView.tsx` — Replace whiteboard placeholder, integrate LessonPlayer + Checkpoint

- [ ] **Step 1: Rewrite LessonView with full integration**

Replace `eclassroom/src/components/lesson/LessonView.tsx` with the complete version that:
1. Imports Whiteboard, LessonPlayer, Checkpoint
2. Creates WhiteboardTeacher when editor is ready
3. Initializes LessonPlayer with callbacks for step/mood/state changes
4. Replaces the placeholder div with `<Whiteboard>`
5. Shows Checkpoint overlay when player reaches a checkpoint step
6. Wires play/pause to LessonPlayer.play()/pause()
7. Tracks completedSteps and updates progress

---

## Task 6: Seed 9 More Sample Lessons

**Files:**
- Create: `migrations/eclassroom-sample-lessons-batch.sql`

Create 9 more lessons (5 BECE Math + 4 WASSCE Core Math) with realistic voice scripts, board actions, and checkpoints. Each lesson should have 4-6 steps with at least 1 checkpoint. Cover: Addition of Fractions, Percentages, Geometry Basics, Number Patterns, Ratios (BECE); Quadratic Equations, Simultaneous Equations, Probability, Statistics (WASSCE).
