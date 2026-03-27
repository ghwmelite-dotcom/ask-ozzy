import { useRef, useState, useCallback } from 'react';
import type { Editor } from 'tldraw';
import { Whiteboard } from '@/components/whiteboard/Whiteboard';
import { WhiteboardTeacher } from '@/components/whiteboard/WhiteboardTeacher';
import { LessonPlayer } from './LessonPlayer';
import type { PlayerState } from './LessonPlayer';
import { Checkpoint } from './Checkpoint';
import { AskTeacher } from './AskTeacher';
import { TeacherPanel } from '@/components/teacher/TeacherPanel';
import { LessonProgress } from './LessonProgress';
import type { Lesson, Checkpoint as CheckpointType } from '@/types/lesson';
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
  const editorRef = useRef<Editor | null>(null);
  const playerRef = useRef<LessonPlayer | null>(null);
  const whiteboardTeacherRef = useRef<WhiteboardTeacher | null>(null);

  const [currentStep, setCurrentStep] = useState(1);
  const [mood, setMood] = useState<Mood>('explaining');
  const [playerState, setPlayerState] = useState<PlayerState>('idle');
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [activeCheckpoint, setActiveCheckpoint] = useState<CheckpointType | null>(null);
  const [xpEarned, setXpEarned] = useState(0);
  const [askTeacherOpen, setAskTeacherOpen] = useState(false);

  const teacherId = lesson.teacher_id as TeacherId;
  const isPlaying = playerState === 'playing';

  const progressSteps = lesson.steps.map((s) => ({
    step: s.step,
    hasCheckpoint: s.checkpoint !== null,
  }));

  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor;

    const wbTeacher = new WhiteboardTeacher(editor);
    whiteboardTeacherRef.current = wbTeacher;

    const audio = audioRef.current;
    if (!audio) return;

    const player = new LessonPlayer(audio, wbTeacher, lesson.steps, teacherId, {
      onStepChange: (step) => setCurrentStep(step),
      onMoodChange: (m) => setMood(m),
      onStateChange: (state) => setPlayerState(state),
      onStepComplete: (step) =>
        setCompletedSteps((prev) => {
          const next = new Set(prev);
          next.add(step);
          return next;
        }),
      onCheckpoint: (checkpoint) => setActiveCheckpoint(checkpoint),
      onLessonComplete: () => setMood('celebrating'),
    });
    playerRef.current = player;
  }, [lesson.steps, teacherId]);

  const handlePlayPause = () => {
    const player = playerRef.current;
    if (!player) return;

    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  };

  const handleCheckpointAnswer = (_correct: boolean, xp: number) => {
    setActiveCheckpoint(null);
    setXpEarned((prev) => prev + xp);
    playerRef.current?.resumeAfterCheckpoint();
  };

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
          {xpEarned > 0 && (
            <div
              className="mt-3 px-3 py-2 rounded-lg text-center text-xs font-semibold"
              style={{ background: 'rgba(252,209,22,0.15)', color: 'var(--accent)' }}
            >
              {xpEarned} XP earned
            </div>
          )}
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

        {/* Whiteboard + Checkpoint overlay + Ask Teacher */}
        <div className="flex-1 relative">
          <Whiteboard onEditorReady={handleEditorReady} />

          {/* Checkpoint overlay — z-index 40, above FAB */}
          {activeCheckpoint && (
            <Checkpoint
              checkpoint={activeCheckpoint}
              onAnswer={handleCheckpointAnswer}
            />
          )}

          {/* Ask Teacher slide-up panel — z-index 30, above whiteboard, below checkpoint */}
          <AskTeacher
            teacherId={teacherId}
            teacherName={TEACHER_NAMES[teacherId] ?? teacherId}
            subject={lesson.subject}
            level={lesson.level}
            isOpen={askTeacherOpen}
            onClose={() => setAskTeacherOpen(false)}
          />

          {/* Ask Teacher FAB — bottom-right of whiteboard area */}
          {!askTeacherOpen && (
            <button
              onClick={() => setAskTeacherOpen(true)}
              aria-label="Ask your teacher a question"
              title="Ask your teacher a question"
              style={{
                position: 'absolute',
                bottom: 20,
                right: 20,
                zIndex: 20,
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'var(--accent)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(252,209,22,0.35), 0 2px 6px rgba(0,0,0,0.3)',
                transition: 'background 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease',
              }}
              onMouseEnter={(e) => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.style.background = 'var(--accent-hover)';
                btn.style.transform = 'scale(1.08)';
                btn.style.boxShadow = '0 6px 24px rgba(252,209,22,0.5), 0 2px 8px rgba(0,0,0,0.35)';
              }}
              onMouseLeave={(e) => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.style.background = 'var(--accent)';
                btn.style.transform = 'scale(1)';
                btn.style.boxShadow = '0 4px 16px rgba(252,209,22,0.35), 0 2px 6px rgba(0,0,0,0.3)';
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#0f1117"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </button>
          )}
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
            onPlayPause={handlePlayPause}
          />
        </div>
      </aside>
    </div>
  );
}
