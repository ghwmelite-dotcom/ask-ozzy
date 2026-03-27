import type { XPProfile, Flashcard, LeaderboardEntry } from '@/types/gamification';

const API_BASE = import.meta.env.VITE_API_URL ?? 'https://askozzy.work';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = sessionStorage.getItem('ec_token');
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options?.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error((error as { error: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getTeachers: () => request<{ teachers: unknown[] }>('/api/eclassroom/teachers'),
  getTeacher: (id: string) => request<{ teacher: unknown }>(`/api/eclassroom/teachers/${id}`),
  getLessons: (params?: { subject?: string; level?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<{ lessons: unknown[] }>(`/api/eclassroom/lessons${qs ? `?${qs}` : ''}`);
  },
  getLesson: (id: string) => request<{ lesson: unknown }>(`/api/eclassroom/lessons/${id}`),
  updateProgress: (lessonId: string, data: { current_step: number; status?: string; score?: number }) =>
    request<{ ok: boolean }>(`/api/eclassroom/lessons/${lessonId}/progress`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  askTeacher: (data: { question: string; subject: string; level: string; teacher_id: string }) =>
    request<{ answer: string; citations: Array<{ source: string; score: number }>; confidence: string }>(
      '/api/eclassroom/rag/query',
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // ── Gamification & Study Tools ──
  getXPProfile: () => request<{ profile: XPProfile }>('/api/eclassroom/xp/profile'),
  awardXP: (data: { subject: string; xp: number; reason: string }) =>
    request('/api/eclassroom/xp/award', { method: 'POST', body: JSON.stringify(data) }),
  getLeaderboard: (params?: { subject?: string; period?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<{ rankings: LeaderboardEntry[] }>('/api/eclassroom/leaderboard' + (qs ? '?' + qs : ''));
  },
  getDueFlashcards: () =>
    request<{ flashcards: Flashcard[]; count: number }>('/api/eclassroom/flashcards/due'),
  reviewFlashcard: (id: string, quality: number) =>
    request('/api/eclassroom/flashcards/' + id + '/review', {
      method: 'POST',
      body: JSON.stringify({ quality }),
    }),
  generateStudyTools: (lessonId: string, tools: string[]) =>
    request('/api/eclassroom/study-tools/generate', {
      method: 'POST',
      body: JSON.stringify({ lesson_id: lessonId, tools }),
    }),
  submitQuiz: (data: {
    lesson_id: string;
    subject: string;
    level: string;
    answers: Array<{ question_number: number; selected: string; correct: string }>;
  }) =>
    request('/api/eclassroom/quiz/submit', { method: 'POST', body: JSON.stringify(data) }),

  // ── Live Classroom ──
  createClassroom: (data: { title: string; type: string; lesson_id?: string }) =>
    request('/api/eclassroom/classroom/create', { method: 'POST', body: JSON.stringify(data) }),
  joinClassroom: (join_code: string) =>
    request('/api/eclassroom/classroom/join', { method: 'POST', body: JSON.stringify({ join_code }) }),

  // ── Audio Lessons ──
  listAudioLessons: () => request('/api/eclassroom/audio'),
  generateAudio: (lesson_id: string) =>
    request('/api/eclassroom/audio/generate', { method: 'POST', body: JSON.stringify({ lesson_id }) }),
  getAudioUrl: (lesson_id: string) => `${API_BASE}/api/eclassroom/audio/${lesson_id}`,
};
