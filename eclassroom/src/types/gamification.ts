export interface XPProfile {
  subjects: Array<{ subject: string; total_xp: number; level: string }>;
  streak: { current: number; longest: number; multiplier: number };
  badges: Array<{ badge_type: string; badge_name: string; earned_at: string }>;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  subject: string;
  level: string;
  ease_factor: number;
  interval_days: number;
  next_review: string;
}

export interface QuizQuestion {
  question_number: number;
  question_text: string;
  options: Record<string, string>;
  correct_answer?: string;
}

export interface LeaderboardEntry {
  rank: number;
  student_name: string;
  total_xp: number;
  level: string;
}
