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
              {isDone ? '\u2713' : s.step}
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
