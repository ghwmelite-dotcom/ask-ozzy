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
  const [editorReady, setEditorReady] = useState(false);

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
    setEditorReady(true);
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
    <div className="flex flex-col h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Hidden audio element for TTS */}
      <audio ref={audioRef} />

      {/* Top bar */}
      <header
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
      >
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>
            {lesson.topic}
          </h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {TEACHER_NAMES[teacherId] ?? teacherId} · {lesson.subject.replace(/_/g, ' ')} · {lesson.level.toUpperCase()} · {lesson.estimated_minutes} min
          </p>
        </div>
        <span
          className="px-2 py-1 rounded-md text-xs font-semibold flex-shrink-0 ml-3"
          style={{ background: 'rgba(252,209,22,0.15)', color: 'var(--accent)' }}
        >
          +{lesson.xp_reward} XP
        </span>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — step progress (hidden on small screens) */}
        <aside
          className="hidden md:flex flex-col w-48 overflow-y-auto border-r flex-shrink-0"
          style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
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

        {/* Whiteboard area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* tldraw container — needs explicit dimensions */}
          <div className="flex-1 relative" style={{ minHeight: 0 }}>
            <div style={{ position: 'absolute', inset: 0 }}>
              <Whiteboard onEditorReady={handleEditorReady} />
            </div>

            {/* Checkpoint overlay */}
            {activeCheckpoint && (
              <Checkpoint
                checkpoint={activeCheckpoint}
                onAnswer={handleCheckpointAnswer}
              />
            )}

            {/* Ask Teacher panel */}
            <AskTeacher
              teacherId={teacherId}
              teacherName={TEACHER_NAMES[teacherId] ?? teacherId}
              subject={lesson.subject}
              level={lesson.level}
              isOpen={askTeacherOpen}
              onClose={() => setAskTeacherOpen(false)}
            />

            {/* Ask Teacher FAB */}
            {!askTeacherOpen && (
              <button
                onClick={() => setAskTeacherOpen(true)}
                aria-label="Ask your teacher a question"
                title="Ask your teacher a question"
                style={{
                  position: 'absolute',
                  bottom: 80,
                  right: 16,
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
                  boxShadow: '0 4px 16px rgba(252,209,22,0.35)',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0f1117" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </button>
            )}
          </div>

          {/* Bottom control bar — ALWAYS visible (mobile + desktop) */}
          <div
            className="flex items-center gap-3 px-4 py-3 border-t flex-shrink-0"
            style={{
              background: 'var(--bg-secondary)',
              borderColor: 'var(--border-color)',
            }}
          >
            {/* Play/Pause button */}
            <button
              onClick={handlePlayPause}
              disabled={!editorReady}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all"
              style={{
                background: !editorReady ? 'var(--bg-tertiary)' : isPlaying ? 'var(--bg-tertiary)' : 'var(--accent)',
                color: !editorReady ? 'var(--text-muted)' : isPlaying ? 'var(--text-secondary)' : '#000',
                border: 'none',
                cursor: editorReady ? 'pointer' : 'not-allowed',
                opacity: editorReady ? 1 : 0.5,
                minWidth: 140,
              }}
            >
              {!editorReady ? (
                'Loading...'
              ) : isPlaying ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                  Pause
                </>
              ) : playerState === 'completed' ? (
                'Completed!'
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  {playerState === 'idle' ? 'Play Lesson' : 'Resume'}
                </>
              )}
            </button>

            {/* Step indicator */}
            <div className="flex-1 flex items-center gap-2">
              <div
                className="flex-1 h-1.5 rounded-full overflow-hidden"
                style={{ background: 'var(--bg-tertiary)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${(completedSteps.size / lesson.steps.length) * 100}%`,
                    background: 'var(--accent)',
                  }}
                />
              </div>
              <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                {currentStep}/{lesson.steps.length}
              </span>
            </div>

            {/* XP earned */}
            {xpEarned > 0 && (
              <span
                className="text-xs font-bold px-2 py-1 rounded-md flex-shrink-0"
                style={{ background: 'rgba(252,209,22,0.15)', color: 'var(--accent)' }}
              >
                +{xpEarned} XP
              </span>
            )}
          </div>
        </div>

        {/* Right sidebar — teacher panel (hidden on small screens) */}
        <aside
          className="hidden lg:flex flex-col w-56 border-l overflow-y-auto flex-shrink-0"
          style={{ borderColor: 'var(--border-color)' }}
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
    </div>
  );
}
