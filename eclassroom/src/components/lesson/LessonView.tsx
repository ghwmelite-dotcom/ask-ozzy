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
  const [currentStep, _setCurrentStep] = useState(1);
  const [mood, _setMood] = useState<Mood>('explaining');
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
