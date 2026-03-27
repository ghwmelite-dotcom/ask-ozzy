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
  mathematics: '📐',
  core_mathematics: '📊',
  science: '🔬',
  english: '📝',
  social_studies: '🌍',
  ict: '💻',
};

const TEACHER_NAMES: Record<string, string> = {
  abena: 'Madam Abena',
  kwame: 'Mr. Kwame',
  esi: 'Madam Esi',
  mensah: 'Dr. Mensah',
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

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-10 border-b"
        style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
      >
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold"
              style={{ background: 'var(--accent)', color: '#000' }}
            >
              e
            </div>
            <div>
              <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                eClassroom
              </h1>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                AI-Powered Academic Preparation
              </p>
            </div>
          </div>
          <a
            href="https://askozzy.work"
            className="text-xs px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            AskOzzy.work
          </a>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Hero */}
        <section className="mb-8">
          <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Learn with AI Teachers
          </h2>
          <p className="text-sm max-w-xl" style={{ color: 'var(--text-secondary)' }}>
            Interactive whiteboard lessons aligned to the GES syllabus. Prepare for BECE, WASSCE, and university exams with personalized AI tutoring.
          </p>
        </section>

        {/* Teacher Roster */}
        <section className="mb-8">
          <h3
            className="text-xs font-semibold uppercase tracking-wide mb-3"
            style={{ color: 'var(--text-muted)' }}
          >
            Your Teachers
          </h3>
          <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
            {teachers.map((t) => (
              <div
                key={t.id}
                className="flex flex-col items-center gap-2 flex-shrink-0"
                style={{ minWidth: 90 }}
              >
                <div
                  className="rounded-2xl p-2"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                >
                  <TeacherAvatar
                    teacher={t.id as TeacherId}
                    mood="explaining"
                    mouth="closed"
                    size={72}
                  />
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {t.name}
                  </p>
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {t.subject.replace(/_/g, ' ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Level Filter Tabs */}
        <section className="mb-6">
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {LEVELS.map((l) => (
              <button
                key={l.id}
                onClick={() => handleLevelChange(l.id)}
                className="flex-shrink-0 px-4 py-2 rounded-full text-xs font-semibold transition-all"
                style={{
                  background: activeLevel === l.id ? 'var(--accent)' : 'var(--bg-secondary)',
                  color: activeLevel === l.id ? '#000' : 'var(--text-secondary)',
                  border: `1px solid ${activeLevel === l.id ? 'var(--accent)' : 'var(--border)'}`,
                  cursor: 'pointer',
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
        </section>

        {/* Lesson Grid */}
        <section>
          <h3
            className="text-xs font-semibold uppercase tracking-wide mb-3"
            style={{ color: 'var(--text-muted)' }}
          >
            {activeLevel === 'all' ? 'All Lessons' : `${LEVELS.find(l => l.id === activeLevel)?.label} Lessons`}
            {!loading && ` (${lessons.length})`}
          </h3>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array(6).fill(0).map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl overflow-hidden animate-pulse"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                >
                  <div className="h-28" style={{ background: 'var(--bg-tertiary)' }} />
                  <div className="p-4 space-y-2">
                    <div className="h-3 rounded w-1/3" style={{ background: 'var(--bg-tertiary)' }} />
                    <div className="h-4 rounded w-3/4" style={{ background: 'var(--bg-tertiary)' }} />
                    <div className="h-3 rounded w-1/2" style={{ background: 'var(--bg-tertiary)' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : lessons.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-4xl mb-3">📚</p>
              <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                No lessons available yet
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                Check back soon for new content
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {lessons.map((lesson) => (
                <button
                  key={lesson.id}
                  onClick={() => navigate(`/lesson/${lesson.id}`)}
                  className="text-left rounded-2xl overflow-hidden transition-all"
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.borderColor = 'var(--accent)';
                    e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = '';
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.boxShadow = '';
                  }}
                >
                  {/* Card header with icon */}
                  <div
                    className="h-28 flex items-center justify-center text-4xl"
                    style={{
                      background: 'linear-gradient(135deg, var(--bg-tertiary), var(--bg-secondary))',
                    }}
                  >
                    {SUBJECT_ICONS[lesson.subject] ?? '📚'}
                  </div>

                  {/* Card body */}
                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: 'var(--accent)' }}
                      >
                        {lesson.subject.replace(/_/g, ' ')}
                      </span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
                      >
                        {lesson.level.toUpperCase()}
                      </span>
                    </div>

                    <h4
                      className="text-sm font-bold mb-2 leading-tight"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {lesson.topic}
                    </h4>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        <span>{TEACHER_NAMES[lesson.teacher_id] ?? lesson.teacher_id}</span>
                        <span>·</span>
                        <span>{lesson.estimated_minutes} min</span>
                      </div>
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                        style={{ background: 'rgba(252,209,22,0.12)', color: 'var(--accent)' }}
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
      </div>

      {/* Footer */}
      <footer className="border-t mt-12 py-6" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            eClassroom by AskOzzy — Aligned to GES Syllabus & WAEC Exam Formats
          </p>
        </div>
      </footer>
    </div>
  );
}
