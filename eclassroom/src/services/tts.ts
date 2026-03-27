const API_BASE = import.meta.env.VITE_API_URL ?? 'https://askozzy.work';

export async function fetchTTSAudio(text: string, teacher?: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/eclassroom/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, teacher }),
  });

  if (!res.ok) throw new Error('TTS request failed');

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export function revokeTTSUrl(url: string): void {
  URL.revokeObjectURL(url);
}
