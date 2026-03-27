const BADGE_ICONS: Record<string, string> = {
  first_lesson: '\u2B50',
  math_master: '\uD83D\uDCD0',
  science_star: '\uD83D\uDD2C',
  streak_7: '\uD83D\uDD25',
  streak_30: '\uD83D\uDC8E',
  bece_ready: '\uD83C\uDF93',
  wassce_warrior: '\uD83C\uDFC6',
};

const ALL_BADGES = [
  { badge_type: 'first_lesson', badge_name: 'First Lesson' },
  { badge_type: 'math_master', badge_name: 'Math Master' },
  { badge_type: 'science_star', badge_name: 'Science Star' },
  { badge_type: 'streak_7', badge_name: '7-Day Streak' },
  { badge_type: 'streak_30', badge_name: '30-Day Streak' },
  { badge_type: 'bece_ready', badge_name: 'BECE Ready' },
  { badge_type: 'wassce_warrior', badge_name: 'WASSCE Warrior' },
];

interface BadgeGalleryProps {
  badges: Array<{ badge_type: string; badge_name: string; earned_at: string }>;
}

export function BadgeGallery({ badges }: BadgeGalleryProps) {
  const earnedSet = new Set(badges.map((b) => b.badge_type));

  return (
    <div>
      <h4
        className="text-[11px] font-bold uppercase tracking-[0.15em] mb-4"
        style={{ color: 'var(--text-muted)' }}
      >
        Badges
      </h4>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {ALL_BADGES.map((def, i) => {
          const earned = badges.find((b) => b.badge_type === def.badge_type);
          const isEarned = earnedSet.has(def.badge_type);

          return (
            <div
              key={def.badge_type}
              className="animate-in card-hover rounded-xl p-3 flex flex-col items-center text-center"
              style={{
                background: 'var(--bg-secondary)',
                border: `1px solid ${isEarned ? 'var(--accent-border)' : 'var(--border-color)'}`,
                animationDelay: `${i * 60}ms`,
                opacity: isEarned ? 1 : 0.45,
              }}
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center text-xl mb-2"
                style={{
                  background: isEarned ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
                  filter: isEarned ? 'none' : 'grayscale(1)',
                }}
              >
                {isEarned ? (
                  BADGE_ICONS[def.badge_type] ?? '\uD83C\uDFC5'
                ) : (
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <rect x={7} y={11} width={10} height={9} rx={2} stroke="#6b7089" strokeWidth={1.5} />
                    <path d="M9 11V8a3 3 0 016 0v3" stroke="#6b7089" strokeWidth={1.5} strokeLinecap="round" />
                  </svg>
                )}
              </div>
              <p
                className="text-[10px] font-semibold leading-tight"
                style={{ color: isEarned ? 'var(--text-primary)' : 'var(--text-muted)' }}
              >
                {def.badge_name}
              </p>
              {earned && (
                <p className="text-[9px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  {new Date(earned.earned_at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
