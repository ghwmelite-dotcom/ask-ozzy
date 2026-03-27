import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { api } from '@/services/api';
import { XPDisplay } from '@/components/gamification/XPDisplay';
import { StreakCounter } from '@/components/gamification/StreakCounter';
import { BadgeGallery } from '@/components/gamification/BadgeGallery';
import { FlashcardReview } from '@/components/study-tools/FlashcardReview';
import type { XPProfile, Flashcard, LeaderboardEntry } from '@/types/gamification';

const TABS = ['Flashcards', 'Profile', 'Leaderboard'] as const;
type Tab = (typeof TABS)[number];

const SUBJECTS = [
  { id: '', label: 'All Subjects' },
  { id: 'mathematics', label: 'Mathematics' },
  { id: 'science', label: 'Science' },
  { id: 'english', label: 'English' },
  { id: 'social_studies', label: 'Social Studies' },
  { id: 'ict', label: 'ICT' },
];

const LEVEL_COLORS: Record<string, string> = {
  Trainee: '#a0a4b8',
  Scholar: '#22d3ee',
  Master: '#a78bfa',
  Expert: '#fbbf24',
};

export function StudyToolsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Flashcards');
  const [profile, setProfile] = useState<XPProfile | null>(null);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderSubject, setLeaderSubject] = useState('');
  const [loading, setLoading] = useState(true);

  // Fetch profile + flashcards on mount
  useEffect(() => {
    setLoading(true);
    Promise.all([api.getXPProfile(), api.getDueFlashcards()])
      .then(([profileData, flashcardData]) => {
        setProfile(profileData.profile);
        setFlashcards(flashcardData.flashcards);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Fetch leaderboard when tab switches or filter changes
  useEffect(() => {
    if (activeTab !== 'Leaderboard') return;
    setLoading(true);
    api
      .getLeaderboard(leaderSubject ? { subject: leaderSubject } : undefined)
      .then((data) => setLeaderboard(data.rankings))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [activeTab, leaderSubject]);

  const handleReview = async (id: string, quality: number) => {
    await api.reviewFlashcard(id, quality);
  };

  const handleComplete = () => {
    // Refresh flashcards
    api
      .getDueFlashcards()
      .then((data) => setFlashcards(data.flashcards))
      .catch(console.error);
    // Refresh profile
    api
      .getXPProfile()
      .then((data) => setProfile(data.profile))
      .catch(console.error);
  };

  // Compute aggregate XP from profile
  const totalXP = profile?.subjects.reduce((sum, s) => sum + s.total_xp, 0) ?? 0;
  const topSubject = profile?.subjects.sort((a, b) => b.total_xp - a.total_xp)[0];
  const overallLevel = topSubject?.level ?? 'Trainee';

  return (
    <div className="min-h-screen edu-bg">
      <PageHeader title="Study Tools" subtitle="Flashcards, XP, Badges & Leaderboard" />
      <div className="max-w-3xl mx-auto px-5 relative z-10">
        {/* Header */}
        <header className="pt-6 pb-4 animate-in">
          <h2
            className="text-2xl font-extrabold tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            Study Tools
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Review flashcards, track progress, and climb the leaderboard.
          </p>
        </header>

        {/* Tab bar */}
        <div
          className="flex gap-1 p-1 rounded-xl mb-6"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="flex-1 py-2.5 rounded-lg text-xs font-semibold"
                style={{
                  background: isActive ? 'var(--accent)' : 'transparent',
                  color: isActive ? '#000' : 'var(--text-secondary)',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: isActive ? 'var(--gold-glow-soft)' : 'none',
                }}
              >
                {tab}
              </button>
            );
          })}
        </div>

        {/* ─── Tab content ─── */}
        <div className="pb-16">
          {/* Loading skeleton */}
          {loading && (
            <div className="space-y-4">
              {Array(3)
                .fill(0)
                .map((_, i) => (
                  <div
                    key={i}
                    className="rounded-2xl p-5"
                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
                  >
                    <div className="h-4 rounded-full w-1/3 skeleton-shimmer mb-3" />
                    <div className="h-3 rounded-full w-2/3 skeleton-shimmer mb-2" />
                    <div className="h-3 rounded-full w-1/2 skeleton-shimmer" />
                  </div>
                ))}
            </div>
          )}

          {/* Flashcards tab */}
          {!loading && activeTab === 'Flashcards' && (
            <FlashcardReview
              flashcards={flashcards}
              onReview={handleReview}
              onComplete={handleComplete}
            />
          )}

          {/* Profile tab */}
          {!loading && activeTab === 'Profile' && profile && (
            <div className="space-y-4">
              <XPDisplay totalXP={totalXP} level={overallLevel} />
              <StreakCounter
                current={profile.streak.current}
                longest={profile.streak.longest}
                multiplier={profile.streak.multiplier}
              />

              {/* Per-subject XP breakdown */}
              {profile.subjects.length > 0 && (
                <div
                  className="animate-in rounded-2xl p-5"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
                >
                  <h4
                    className="text-[11px] font-bold uppercase tracking-[0.15em] mb-4"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Subject Progress
                  </h4>
                  <div className="space-y-3">
                    {profile.subjects.map((s) => (
                      <div key={s.subject} className="flex items-center gap-3">
                        <span
                          className="text-xs font-semibold w-28 truncate capitalize"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {s.subject.replace(/_/g, ' ')}
                        </span>
                        <div
                          className="flex-1 h-2 rounded-full overflow-hidden"
                          style={{ background: 'var(--bg-tertiary)' }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min((s.total_xp / 5000) * 100, 100)}%`,
                              background: LEVEL_COLORS[s.level] ?? 'var(--accent)',
                              transition: 'width 0.6s ease',
                            }}
                          />
                        </div>
                        <span
                          className="text-[10px] font-bold w-14 text-right"
                          style={{ color: LEVEL_COLORS[s.level] ?? 'var(--text-muted)' }}
                        >
                          {s.total_xp} XP
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <BadgeGallery badges={profile.badges} />
            </div>
          )}

          {/* Leaderboard tab */}
          {!loading && activeTab === 'Leaderboard' && (
            <div className="animate-in">
              {/* Subject filter */}
              <div className="flex gap-2 overflow-x-auto mb-5" style={{ scrollbarWidth: 'none' }}>
                {SUBJECTS.map((s) => {
                  const isActive = leaderSubject === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setLeaderSubject(s.id)}
                      className="flex-shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-semibold"
                      style={{
                        background: isActive ? 'var(--accent)' : 'var(--bg-secondary)',
                        color: isActive ? '#000' : 'var(--text-secondary)',
                        border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border-color)'}`,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>

              {/* Rankings list */}
              {leaderboard.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    No rankings yet. Start learning to earn XP!
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {leaderboard.map((entry, i) => {
                    const isTop3 = entry.rank <= 3;
                    const medals = ['', '\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
                    return (
                      <div
                        key={entry.rank}
                        className="card-hover animate-in rounded-xl px-4 py-3 flex items-center gap-3"
                        style={{
                          background: isTop3 ? 'var(--bg-elevated)' : 'var(--bg-secondary)',
                          border: `1px solid ${isTop3 ? 'var(--accent-border)' : 'var(--border-color)'}`,
                          animationDelay: `${i * 40}ms`,
                        }}
                      >
                        {/* Rank */}
                        <span
                          className="w-8 text-center font-extrabold text-sm"
                          style={{
                            color: isTop3 ? 'var(--accent)' : 'var(--text-muted)',
                          }}
                        >
                          {medals[entry.rank] ?? `#${entry.rank}`}
                        </span>

                        {/* Name */}
                        <span
                          className="flex-1 text-sm font-semibold truncate"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {entry.student_name}
                        </span>

                        {/* Level */}
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                          style={{
                            background: 'var(--bg-tertiary)',
                            color: LEVEL_COLORS[entry.level] ?? 'var(--text-muted)',
                          }}
                        >
                          {entry.level}
                        </span>

                        {/* XP */}
                        <span
                          className="text-xs font-bold"
                          style={{ color: 'var(--accent)' }}
                        >
                          {entry.total_xp.toLocaleString()} XP
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
