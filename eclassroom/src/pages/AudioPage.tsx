import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/services/api';
import { AudioPlayer } from '@/components/audio/AudioPlayer';

interface AudioLesson {
  id: string;
  topic: string;
  subject: string;
  teacher_name?: string;
  duration_seconds?: number;
  has_audio: boolean;
}

export function AudioPage() {
  const navigate = useNavigate();
  const [lessons, setLessons] = useState<AudioLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);

  useEffect(() => {
    api.listAudioLessons()
      .then((data) => {
        setLessons((data as { lessons: AudioLesson[] }).lessons);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleGenerate = async (lessonId: string) => {
    setGenerating(lessonId);
    try {
      await api.generateAudio(lessonId);
      // Refresh list
      const data = await api.listAudioLessons() as { lessons: AudioLesson[] };
      setLessons(data.lessons);
    } catch (err) {
      console.error('Failed to generate audio:', err);
    } finally {
      setGenerating(null);
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const SUBJECT_ICONS: Record<string, string> = {
    mathematics: '📐', core_mathematics: '📊', science: '🔬',
    english: '📝', social_studies: '🌍', ict: '💻',
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header
        className="sticky top-[3px] z-50"
        style={{
          background: 'rgba(15, 17, 23, 0.85)',
          backdropFilter: 'blur(12px) saturate(180%)',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <div className="max-w-4xl mx-auto px-5 py-3.5 flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="flex items-center justify-center rounded-lg"
            style={{
              width: 44,
              height: 44,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            aria-label="Back to home"
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div>
            <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              Audio Lessons
            </h1>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Listen & learn on the go
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-5 py-6">
        {loading ? (
          <div className="space-y-3">
            {Array(4).fill(0).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl overflow-hidden"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
              >
                <div className="p-5 space-y-3">
                  <div className="h-3 rounded-full w-1/4 skeleton-shimmer" />
                  <div className="h-4 rounded-full w-3/4 skeleton-shimmer" />
                  <div className="h-3 rounded-full w-1/2 skeleton-shimmer" />
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
              🎧
            </div>
            <p className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
              No audio lessons yet
            </p>
            <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
              Audio summaries will be available soon
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {lessons.map((lesson, i) => (
              <div key={lesson.id}>
                <button
                  onClick={() => {
                    if (lesson.has_audio) {
                      setActiveId(activeId === lesson.id ? null : lesson.id);
                    }
                  }}
                  className={`card-hover animate-in w-full text-left rounded-2xl p-5 ${
                    activeId === lesson.id ? '' : ''
                  }`}
                  style={{
                    background: activeId === lesson.id
                      ? 'linear-gradient(135deg, rgba(252, 209, 22, 0.06) 0%, var(--bg-secondary) 100%)'
                      : 'var(--bg-secondary)',
                    border: `1px solid ${activeId === lesson.id ? 'var(--accent-border)' : 'var(--border-color)'}`,
                    cursor: lesson.has_audio ? 'pointer' : 'default',
                    boxShadow: 'var(--card-shadow)',
                    animationDelay: `${i * 60}ms`,
                  }}
                >
                  <div className="flex items-center gap-4">
                    {/* Icon */}
                    <div
                      className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center text-xl"
                      style={{
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-color)',
                      }}
                    >
                      {lesson.has_audio ? '🎧' : (SUBJECT_ICONS[lesson.subject] ?? '📚')}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] mb-0.5" style={{ color: 'var(--accent)' }}>
                        {lesson.subject.replace(/_/g, ' ')}
                      </p>
                      <h3 className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                        {lesson.topic}
                      </h3>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {lesson.teacher_name ?? 'AI Teacher'}
                        {lesson.duration_seconds ? ` · ${formatDuration(lesson.duration_seconds)}` : ''}
                      </p>
                    </div>

                    {/* Action */}
                    {lesson.has_audio ? (
                      <div
                        className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
                        style={{
                          background: activeId === lesson.id ? 'var(--accent)' : 'var(--accent-dim)',
                          color: activeId === lesson.id ? '#000' : 'var(--accent)',
                        }}
                      >
                        {activeId === lesson.id ? (
                          <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                            <rect x={6} y={4} width={4} height={16} rx={1} />
                            <rect x={14} y={4} width={4} height={16} rx={1} />
                          </svg>
                        ) : (
                          <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleGenerate(lesson.id);
                        }}
                        disabled={generating === lesson.id}
                        className="flex-shrink-0 px-3 py-2 rounded-lg text-[11px] font-bold"
                        style={{
                          background: 'var(--accent-dim)',
                          color: 'var(--accent)',
                          border: '1px solid var(--accent-border)',
                          cursor: generating === lesson.id ? 'wait' : 'pointer',
                          opacity: generating === lesson.id ? 0.6 : 1,
                          minHeight: 36,
                        }}
                      >
                        {generating === lesson.id ? 'Generating...' : 'Generate'}
                      </button>
                    )}
                  </div>
                </button>

                {/* Inline player */}
                {activeId === lesson.id && lesson.has_audio && (
                  <div className="mt-2">
                    <AudioPlayer
                      src={api.getAudioUrl(lesson.id)}
                      topic={lesson.topic}
                      teacher={lesson.teacher_name}
                      subject={lesson.subject}
                      onClose={() => setActiveId(null)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
