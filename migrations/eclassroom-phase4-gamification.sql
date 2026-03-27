-- eClassroom Phase 4: Study Tools & Gamification
-- Run: npx wrangler d1 execute ghana-civil-ai-db --remote --file=migrations/eclassroom-phase4-gamification.sql

-- Flashcards with SM-2 spaced repetition
CREATE TABLE IF NOT EXISTS ec_flashcards (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  lesson_id TEXT,
  subject TEXT NOT NULL,
  level TEXT NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  ease_factor REAL DEFAULT 2.5,
  interval_days INTEGER DEFAULT 0,
  repetitions INTEGER DEFAULT 0,
  next_review TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ec_flashcards_student ON ec_flashcards(student_id);
CREATE INDEX IF NOT EXISTS idx_ec_flashcards_review ON ec_flashcards(student_id, next_review);

-- Cumulative XP ledger (per subject)
CREATE TABLE IF NOT EXISTS ec_student_xp (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT 'general',
  total_xp INTEGER DEFAULT 0,
  current_level TEXT DEFAULT 'trainee',
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(student_id, subject)
);

CREATE INDEX IF NOT EXISTS idx_ec_xp_student ON ec_student_xp(student_id);
CREATE INDEX IF NOT EXISTS idx_ec_xp_leaderboard ON ec_student_xp(subject, total_xp DESC);

-- Daily streaks
CREATE TABLE IF NOT EXISTS ec_streaks (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL UNIQUE,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_activity_date TEXT,
  streak_multiplier REAL DEFAULT 1.0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Badges earned
CREATE TABLE IF NOT EXISTS ec_badges (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  badge_type TEXT NOT NULL,
  badge_name TEXT NOT NULL,
  earned_at TEXT DEFAULT (datetime('now')),
  UNIQUE(student_id, badge_type)
);

CREATE INDEX IF NOT EXISTS idx_ec_badges_student ON ec_badges(student_id);

-- Quiz results
CREATE TABLE IF NOT EXISTS ec_quiz_results (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  lesson_id TEXT,
  subject TEXT NOT NULL,
  level TEXT NOT NULL,
  score INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  answers_json TEXT,
  taken_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ec_quiz_student ON ec_quiz_results(student_id);

-- Leaderboard cache (computed periodically)
CREATE TABLE IF NOT EXISTS ec_leaderboard_cache (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  period TEXT NOT NULL,
  rankings_json TEXT NOT NULL,
  computed_at TEXT DEFAULT (datetime('now'))
);
