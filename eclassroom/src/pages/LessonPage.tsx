import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { LessonView } from '@/components/lesson/LessonView';
import type { Lesson } from '@/types/lesson';
import { api } from '@/services/api';

export function LessonPage() {
  const { id } = useParams<{ id: string }>();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getLesson(id)
      .then((data) => setLesson(data.lesson as Lesson))
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center p-6 rounded-xl" style={{ background: 'var(--bg-secondary)' }}>
          <p className="text-lg font-semibold" style={{ color: 'var(--error)' }}>
            Failed to load lesson
          </p>
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!lesson) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse text-sm" style={{ color: 'var(--text-muted)' }}>
          Loading lesson...
        </div>
      </div>
    );
  }

  return <LessonView lesson={lesson} />;
}
