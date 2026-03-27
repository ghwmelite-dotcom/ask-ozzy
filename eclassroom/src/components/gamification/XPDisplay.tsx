const LEVEL_THRESHOLDS: Record<string, { min: number; next: number; color: string }> = {
  Trainee: { min: 0, next: 500, color: '#a0a4b8' },
  Scholar: { min: 500, next: 2000, color: '#22d3ee' },
  Master: { min: 2000, next: 5000, color: '#a78bfa' },
  Expert: { min: 5000, next: 10000, color: '#fbbf24' },
};

interface XPDisplayProps {
  totalXP: number;
  level: string;
  subject?: string;
}

const FALLBACK_TIER = { min: 0, next: 500, color: '#a0a4b8' } as const;

export function XPDisplay({ totalXP, level, subject }: XPDisplayProps) {
  const tier: { min: number; next: number; color: string } =
    LEVEL_THRESHOLDS[level] ?? FALLBACK_TIER;
  const progressInLevel = totalXP - tier.min;
  const levelRange = tier.next - tier.min;
  const pct = Math.min(progressInLevel / levelRange, 1);
  const remaining = tier.next - totalXP;

  // SVG circle math
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);

  return (
    <div
      className="animate-in flex items-center gap-5 rounded-2xl p-5"
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
      }}
    >
      {/* Progress ring */}
      <div className="relative flex-shrink-0" style={{ width: 100, height: 100 }}>
        <svg viewBox="0 0 100 100" width={100} height={100}>
          {/* Background ring */}
          <circle
            cx={50}
            cy={50}
            r={radius}
            fill="none"
            stroke="var(--border-color)"
            strokeWidth={6}
          />
          {/* Progress arc */}
          <circle
            cx={50}
            cy={50}
            r={radius}
            fill="none"
            stroke={tier.color}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{
              transform: 'rotate(-90deg)',
              transformOrigin: '50% 50%',
              transition: 'stroke-dashoffset 0.8s ease',
              filter: `drop-shadow(0 0 6px ${tier.color}55)`,
            }}
          />
        </svg>
        {/* Center label */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{ color: tier.color }}
        >
          <span className="text-lg font-extrabold leading-none">
            {totalXP.toLocaleString()}
          </span>
          <span className="text-[9px] font-semibold uppercase tracking-wider opacity-80">
            XP
          </span>
        </div>
      </div>

      {/* Text info */}
      <div className="flex-1 min-w-0">
        {subject && (
          <p
            className="text-[10px] font-bold uppercase tracking-[0.12em] mb-1"
            style={{ color: 'var(--accent)' }}
          >
            {subject.replace(/_/g, ' ')}
          </p>
        )}
        <p className="text-base font-bold" style={{ color: tier.color }}>
          {level}
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          {remaining > 0
            ? `${remaining.toLocaleString()} XP to next level`
            : 'Max level reached!'}
        </p>
        {/* Mini progress bar */}
        <div
          className="mt-2 h-1.5 rounded-full overflow-hidden"
          style={{ background: 'var(--bg-tertiary)' }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct * 100}%`,
              background: tier.color,
              transition: 'width 0.8s ease',
              boxShadow: `0 0 8px ${tier.color}44`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
