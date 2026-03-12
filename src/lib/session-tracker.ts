import type { Env } from '../types';
import type { StudentProfile, ConfidenceLevel } from '../types/student-profile';

export function updateSessionScore(
  profile: StudentProfile,
  checkQuestionOutcome: 'correct' | 'partially_correct' | 'incorrect' | 'skipped'
): StudentProfile {
  const delta: Record<string, number> = { correct: 8, partially_correct: 3, incorrect: -5, skipped: 0 };
  const newScore = Math.max(0, Math.min(100, profile.session_score + (delta[checkQuestionOutcome] || 0)));

  let newConfidence: ConfidenceLevel = profile.confidence;
  if (newScore >= 80) newConfidence = 'advanced';
  else if (newScore >= 60) newConfidence = 'proficient';
  else if (newScore >= 40) newConfidence = 'developing';
  else newConfidence = 'struggling';

  return { ...profile, session_score: newScore, confidence: newConfidence };
}

export async function saveStudentProfile(
  sessionId: string,
  profile: StudentProfile,
  env: Env
): Promise<void> {
  await env.SESSIONS.put(`student:${sessionId}:profile`, JSON.stringify(profile), {
    expirationTtl: 4 * 3600 // 4 hour session
  });
}

export async function loadStudentProfile(
  sessionId: string,
  env: Env
): Promise<StudentProfile | null> {
  const data = await env.SESSIONS.get(`student:${sessionId}:profile`);
  if (!data) return null;
  try {
    return JSON.parse(data) as StudentProfile;
  } catch {
    return null;
  }
}
