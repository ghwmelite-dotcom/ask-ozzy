import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LiveClassroom } from '@/components/classroom/LiveClassroom';
import { JoinRoom } from '@/components/classroom/JoinRoom';
import { api } from '@/services/api';

interface ClassroomInfo {
  id: string;
  title: string;
  join_code: string;
}

export function ClassroomPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [classroom, setClassroom] = useState<ClassroomInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Generate a simple student ID from session
  const studentId = sessionStorage.getItem('ec_student_id') ?? (() => {
    const id = crypto.randomUUID();
    sessionStorage.setItem('ec_student_id', id);
    return id;
  })();

  const studentName = sessionStorage.getItem('ec_student_name') ?? 'Student';

  const handleJoin = useCallback(async (joinCode: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.joinClassroom(joinCode) as { classroom: ClassroomInfo };
      setClassroom(result.classroom);
      // Update URL to reflect the code
      if (joinCode !== code) {
        navigate(`/live/${joinCode}`, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid room code. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [code, navigate]);

  const handleCreate = useCallback(async (title: string, type: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.createClassroom({ title, type }) as { classroom: ClassroomInfo };
      setClassroom(result.classroom);
      navigate(`/live/${result.classroom.join_code}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room.');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  const handleLeave = useCallback(() => {
    setClassroom(null);
    navigate('/');
  }, [navigate]);

  // Auto-join if code is present in URL and no classroom loaded yet
  if (code && code.length === 6 && !classroom && !loading && !error) {
    void handleJoin(code);
  }

  // Show loading state when auto-joining from URL
  if (code && code.length === 6 && loading && !classroom) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-center animate-in">
          <div
            className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center skeleton-shimmer"
            style={{ border: '1px solid var(--border-color)' }}
          />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
            Joining classroom...
          </p>
        </div>
      </div>
    );
  }

  // Show the live classroom if joined
  if (classroom) {
    return (
      <LiveClassroom
        classroomId={classroom.id}
        studentId={studentId}
        studentName={studentName}
        title={classroom.title}
        onLeave={handleLeave}
      />
    );
  }

  // Show join/create UI
  return (
    <JoinRoom
      onJoin={handleJoin}
      onCreate={handleCreate}
      error={error}
      loading={loading}
    />
  );
}
