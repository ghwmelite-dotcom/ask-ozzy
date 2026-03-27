import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/services/api';
import { TeacherAvatar } from '@/components/teacher/TeacherAvatar';
import type { TeacherId } from '@/types/teacher';

interface LessonSummary {
  id: string;
  teacher_id: string;
  topic: string;
  subject: string;
  level: string;
  estimated_minutes: number;
  xp_reward: number;
}

interface TeacherSummary {
  id: string;
  name: string;
  subject: string;
  avatar_config: { skinTone: string; hairstyle: string; attire: string };
}

const LEVELS = [
  { id: 'all', label: 'All Levels' },
  { id: 'jhs', label: 'BECE (JHS)' },
  { id: 'shs', label: 'WASSCE (SHS)' },
  { id: 'university', label: 'University' },
];

const SUBJECT_ICONS: Record<string, string> = {
  mathematics: '📐', core_mathematics: '📊', science: '🔬',
  english: '📝', social_studies: '🌍', ict: '💻',
};

const SUBJECT_GRADIENTS: Record<string, string> = {
  mathematics: 'var(--gradient-math)',
  core_mathematics: 'var(--gradient-math)',
  science: 'var(--gradient-science)',
  english: 'var(--gradient-english)',
  social_studies: 'var(--gradient-social)',
  ict: 'var(--gradient-ict)',
};

const TEACHER_NAMES: Record<string, string> = {
  abena: 'Madam Abena', kwame: 'Mr. Kwame',
  esi: 'Madam Esi', mensah: 'Dr. Mensah',
};

const TEACHER_TAGLINES: Record<string, string> = {
  abena: 'Encouraging, uses real-world Ghana examples',
  kwame: 'Methodical, loves diagrams & experiments',
  esi: 'Gentle corrections, praise first',
  mensah: 'Scholarly storyteller & historian',
};

export function Home() {
  const navigate = useNavigate();
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [teachers, setTeachers] = useState<TeacherSummary[]>([]);
  const [activeLevel, setActiveLevel] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getLessons(activeLevel === 'all' ? undefined : { level: activeLevel }),
      api.getTeachers(),
    ])
      .then(([lessonData, teacherData]) => {
        setLessons(lessonData.lessons as LessonSummary[]);
        setTeachers(teacherData.teachers as TeacherSummary[]);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [activeLevel]);

  const handleLevelChange = (level: string) => {
    setActiveLevel(level);
    setLoading(true);
  };

  const EDU_SYMBOLS = [
    { icon: '∑', top: '8%', left: '5%', size: 28, delay: 0 },
    { icon: 'π', top: '15%', right: '8%', size: 32, delay: 1.2 },
    { icon: '∫', top: '35%', left: '3%', size: 26, delay: 0.5 },
    { icon: '√', top: '50%', right: '5%', size: 30, delay: 2 },
    { icon: 'Δ', top: '65%', left: '7%', size: 24, delay: 1.5 },
    { icon: '∞', top: '22%', left: '92%', size: 28, delay: 0.8 },
    { icon: 'α', top: '78%', right: '10%', size: 26, delay: 1.8 },
    { icon: '⊿', top: '42%', left: '95%', size: 22, delay: 2.5 },
    { icon: 'θ', top: '88%', left: '4%', size: 24, delay: 0.3 },
    { icon: '∂', top: '55%', left: '90%', size: 20, delay: 3 },
    { icon: '📐', top: '12%', left: '45%', size: 20, delay: 1 },
    { icon: '🔬', top: '70%', left: '50%', size: 18, delay: 2.2 },
    { icon: '📖', top: '30%', left: '88%', size: 18, delay: 1.7 },
    { icon: '🌍', top: '82%', left: '85%', size: 16, delay: 0.6 },
  ];

  return (
    <div className="min-h-screen edu-bg">

      {/* Floating educational symbols */}
      <div className="edu-symbols">
        {EDU_SYMBOLS.map((s, i) => (
          <span
            key={i}
            className="edu-symbol"
            style={{
              top: s.top,
              left: s.left,
              right: (s as { right?: string }).right,
              fontSize: s.size,
              animationDelay: `${s.delay}s`,
            }}
          >
            {s.icon}
          </span>
        ))}
      </div>

      {/* ─── Header ─── */}
      <header
        className="sticky top-[3px] z-50"
        style={{
          background: 'rgba(15, 17, 23, 0.85)',
          backdropFilter: 'blur(12px) saturate(180%)',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <div className="max-w-6xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
              style={{
                background: 'var(--accent)',
                color: '#000',
                fontWeight: 800,
                boxShadow: 'var(--gold-glow-soft)',
              }}
            >
              e
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                eClassroom
              </h1>
              <p className="text-[10px] tracking-wide uppercase" style={{ color: 'var(--text-muted)' }}>
                by AskOzzy
              </p>
            </div>
          </div>
          <a
            href="https://askozzy.work"
            className="text-xs px-4 py-2 rounded-lg font-medium"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              textDecoration: 'none',
              border: '1px solid var(--border-color)',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.color = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            AskOzzy.work
          </a>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-5 relative z-10">

        {/* ─── Hero ─── */}
        <section
          className="animate-in pt-10 pb-8 relative hero-glow"
        >
          <p
            className="text-[11px] font-bold uppercase tracking-[0.2em] mb-4"
            style={{ color: 'var(--accent)' }}
          >
            AI-Powered Academic Preparation
          </p>
          <h2
            className="text-gold-gradient text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.1] mb-4"
          >
            Learn with Ghana's<br />Best AI Teachers
          </h2>
          <p
            className="text-base max-w-lg leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            Interactive whiteboard lessons aligned to the GES syllabus.
            Prepare for BECE & WASSCE with personalized tutoring — anytime, anywhere.
          </p>
        </section>
        <div className="section-divider" />

        {/* ─── Teacher Roster ─── */}
        <section className="py-8">
          <h3
            className="text-[11px] font-bold uppercase tracking-[0.15em] mb-5"
            style={{ color: 'var(--text-muted)' }}
          >
            Meet Your Teachers
          </h3>
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-3"
          >
            {teachers.map((t, i) => (
              <div
                key={t.id}
                className="card-hover teacher-card animate-in rounded-2xl p-4 flex flex-col items-center text-center"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  animationDelay: `${i * 80}ms`,
                }}
              >
                <div className="mb-3">
                  <TeacherAvatar
                    teacher={t.id as TeacherId}
                    mood="explaining"
                    mouth="closed"
                    size={88}
                  />
                </div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                  {t.name}
                </p>
                <p
                  className="text-[10px] font-semibold uppercase tracking-wider mt-0.5 mb-1.5"
                  style={{ color: 'var(--accent)' }}
                >
                  {t.subject.replace(/_/g, ' ')}
                </p>
                <p className="text-[11px] leading-snug" style={{ color: 'var(--text-muted)' }}>
                  {TEACHER_TAGLINES[t.id] ?? ''}
                </p>
              </div>
            ))}
          </div>
        </section>
        <div className="section-divider" />

        {/* ─── Level Filter ─── */}
        <section className="pt-8 pb-2">
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <h3
              className="text-[11px] font-bold uppercase tracking-[0.15em]"
              style={{ color: 'var(--text-muted)' }}
            >
              Browse Lessons
            </h3>
            <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {LEVELS.map((l) => {
                const isActive = activeLevel === l.id;
                return (
                  <button
                    key={l.id}
                    onClick={() => handleLevelChange(l.id)}
                    className="flex-shrink-0 px-4 py-2 rounded-full text-xs font-semibold"
                    style={{
                      background: isActive ? 'var(--accent)' : 'var(--bg-secondary)',
                      color: isActive ? '#000' : 'var(--text-secondary)',
                      border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border-color)'}`,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      boxShadow: isActive ? 'var(--gold-glow-soft)' : 'none',
                    }}
                  >
                    {l.label}
                  </button>
                );
              })}
            </div>
            {!loading && (
              <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
                {lessons.length} lesson{lessons.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </section>

        {/* ─── Lesson Grid ─── */}
        <section className="pb-16">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array(6).fill(0).map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl overflow-hidden"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
                >
                  <div className="h-32 skeleton-shimmer" />
                  <div className="p-5 space-y-3">
                    <div className="h-3 rounded-full w-1/3 skeleton-shimmer" />
                    <div className="h-4 rounded-full w-4/5 skeleton-shimmer" />
                    <div className="h-3 rounded-full w-2/3 skeleton-shimmer" />
                  </div>
                </div>
              ))}
            </div>
          ) : lessons.length === 0 ? (
            <div className="text-center py-20">
              <div
                className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-3xl"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
              >
                📚
              </div>
              <p className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
                No lessons available yet
              </p>
              <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
                Check back soon for new content
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {lessons.map((lesson, i) => (
                <button
                  key={lesson.id}
                  onClick={() => navigate(`/lesson/${lesson.id}`)}
                  className="card-hover animate-in text-left rounded-2xl overflow-hidden"
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    boxShadow: 'var(--card-shadow)',
                    animationDelay: `${i * 60}ms`,
                  }}
                >
                  {/* Subject gradient header */}
                  <div
                    className="h-32 flex items-center justify-center relative"
                    style={{
                      background: SUBJECT_GRADIENTS[lesson.subject] ?? 'var(--gradient-default)',
                    }}
                  >
                    <span className="text-5xl opacity-90 drop-shadow-lg">
                      {SUBJECT_ICONS[lesson.subject] ?? '📚'}
                    </span>
                    {/* Level badge */}
                    <span
                      className="absolute top-3 right-3 text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                      style={{
                        background: 'rgba(0,0,0,0.4)',
                        color: '#fff',
                        backdropFilter: 'blur(4px)',
                      }}
                    >
                      {lesson.level === 'jhs' ? 'BECE' : lesson.level === 'shs' ? 'WASSCE' : 'UNI'}
                    </span>
                  </div>

                  {/* Card content */}
                  <div className="p-5">
                    <p
                      className="text-[10px] font-bold uppercase tracking-[0.12em] mb-2"
                      style={{ color: 'var(--accent)' }}
                    >
                      {lesson.subject.replace(/_/g, ' ')}
                    </p>

                    <h4
                      className="text-[15px] font-bold leading-snug mb-3"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {lesson.topic}
                    </h4>

                    <div
                      className="flex items-center justify-between pt-3"
                      style={{ borderTop: '1px solid var(--border-color)' }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full overflow-hidden flex-shrink-0">
                          <TeacherAvatar
                            teacher={lesson.teacher_id as TeacherId}
                            mood="explaining"
                            mouth="closed"
                            size={20}
                          />
                        </div>
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {TEACHER_NAMES[lesson.teacher_id] ?? lesson.teacher_id}
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--border-light, #3d4460)' }}>|</span>
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {lesson.estimated_minutes} min
                        </span>
                      </div>
                      <span
                        className="text-[10px] font-bold px-2 py-1 rounded-md"
                        style={{
                          background: 'var(--accent-dim)',
                          color: 'var(--accent)',
                        }}
                      >
                        +{lesson.xp_reward} XP
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ─── Study Tools CTA ─── */}
        <section className="pb-16">
          <button
            onClick={() => navigate('/study-tools')}
            className="card-hover animate-in w-full text-left rounded-2xl overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(252, 209, 22, 0.08) 0%, rgba(252, 209, 22, 0.02) 60%, rgba(0, 107, 63, 0.06) 100%)',
              border: '1px solid var(--accent-border)',
              cursor: 'pointer',
              boxShadow: 'var(--gold-glow-soft)',
            }}
          >
            <div className="p-6 flex items-center gap-5">
              <div
                className="flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center"
                style={{
                  background: 'var(--accent-dim)',
                  border: '1px solid var(--accent-border)',
                }}
              >
                <svg width={28} height={28} viewBox="0 0 24 24" fill="none">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="var(--accent)" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3
                  className="text-base font-bold mb-1"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Study Tools & Progress
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Review flashcards, track your XP, earn badges, and climb the leaderboard.
                </p>
              </div>
              <svg
                width={20}
                height={20}
                viewBox="0 0 24 24"
                fill="none"
                className="flex-shrink-0"
              >
                <path
                  d="M9 18l6-6-6-6"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </button>
        </section>
      </div>

      {/* ─── Footer ─── */}
      <footer style={{ borderTop: '1px solid var(--border-color)' }}>
        <div
          className="h-[2px]"
          style={{ background: 'linear-gradient(to right, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)' }}
        />
        <div className="max-w-6xl mx-auto px-5 py-6 flex items-center justify-between">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            eClassroom by AskOzzy
          </p>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Aligned to GES Syllabus & WAEC Exam Formats
          </p>
        </div>
      </footer>
    </div>
  );
}
