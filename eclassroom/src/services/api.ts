const API_BASE = import.meta.env.VITE_API_URL ?? '';

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
};
