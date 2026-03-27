interface StreakCounterProps {
  current: number;
  longest: number;
  multiplier: number;
}

export function StreakCounter({ current, longest, multiplier }: StreakCounterProps) {
  const isActive = current > 0;

  return (
    <div
      className="animate-in rounded-2xl p-5 flex items-center gap-4"
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
      }}
    >
      {/* Flame icon */}
      <div
        className="flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center text-2xl"
        style={{
          background: isActive ? 'rgba(251, 146, 60, 0.12)' : 'var(--bg-tertiary)',
          animation: isActive ? 'flamePulse 2s ease-in-out infinite' : 'none',
        }}
      >
        <span style={{ filter: isActive ? 'none' : 'grayscale(1) opacity(0.4)' }}>
          <svg width={28} height={28} viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2c.5 3.5-1 6-3 8 1.5.5 3 2 3.5 4.5C13 12 15 10 16 7c.5 2 1 5-1 8 2-1 4-4 4-7 0-5-3-6-7-6z"
              fill={isActive ? '#fb923c' : '#6b7089'}
            />
            <path
              d="M10 22c-2-1-3-3-3-5 0-3 3-4 3-7 1 2 3 3 3 6 0 2.5-1 4.5-3 6z"
              fill={isActive ? '#fbbf24' : '#4a4e65'}
            />
          </svg>
        </span>
      </div>

      {/* Text */}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span
            className="text-xl font-extrabold"
            style={{ color: isActive ? '#fb923c' : 'var(--text-muted)' }}
          >
            {current}
          </span>
          <span
            className="text-xs font-semibold"
            style={{ color: isActive ? 'var(--text-secondary)' : 'var(--text-muted)' }}
          >
            day{current !== 1 ? 's' : ''} streak
          </span>

          {/* Multiplier badge */}
          {multiplier > 1 && (
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full ml-auto"
              style={{
                background: 'var(--accent-dim)',
                color: 'var(--accent)',
                border: '1px solid var(--accent-border)',
              }}
            >
              {multiplier}x XP
            </span>
          )}
        </div>

        <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
          Longest: {longest} day{longest !== 1 ? 's' : ''}
        </p>
      </div>
    </div>
  );
}
