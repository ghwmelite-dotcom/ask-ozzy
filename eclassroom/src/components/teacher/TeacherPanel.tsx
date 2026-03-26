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
