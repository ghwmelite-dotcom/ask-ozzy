-- Phase 6: Revenue & Engagement Schema
-- Run after all previous schema files

-- Onboarding Quiz columns on users
ALTER TABLE users ADD COLUMN experience_level TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN primary_use_case TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN onboarding_quiz_completed INTEGER DEFAULT 0;

-- Structured User Profiles
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  writing_style TEXT DEFAULT 'formal',
  experience_level TEXT DEFAULT 'intermediate',
  preferred_language TEXT DEFAULT 'en',
  courses TEXT DEFAULT '[]',
  subjects_of_interest TEXT DEFAULT '[]',
  organization_context TEXT DEFAULT '',
  exam_target TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Document Credits
CREATE TABLE IF NOT EXISTS document_credits (
  user_id TEXT PRIMARY KEY,
  balance INTEGER DEFAULT 0,
  total_purchased INTEGER DEFAULT 0,
  total_used INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS document_credit_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('purchase', 'use', 'bonus', 'refund')),
  amount INTEGER NOT NULL,
  description TEXT,
  payment_reference TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_doc_credit_tx_user ON document_credit_transactions(user_id, created_at DESC);

-- Exam Prep
CREATE TABLE IF NOT EXISTS exam_questions (
  id TEXT PRIMARY KEY,
  exam_type TEXT NOT NULL CHECK(exam_type IN ('wassce', 'bece')),
  subject TEXT NOT NULL,
  year INTEGER NOT NULL,
  paper TEXT DEFAULT '1',
  question_number INTEGER NOT NULL,
  question_text TEXT NOT NULL,
  marking_scheme TEXT DEFAULT '',
  marks INTEGER DEFAULT 0,
  difficulty TEXT DEFAULT 'medium' CHECK(difficulty IN ('easy', 'medium', 'hard')),
  topic TEXT DEFAULT '',
  vector_id TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(exam_type, subject, year, paper, question_number)
);
CREATE INDEX IF NOT EXISTS idx_exam_q_subject ON exam_questions(exam_type, subject, year);

CREATE TABLE IF NOT EXISTS exam_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  question_id TEXT,
  exam_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  question_text TEXT NOT NULL,
  student_answer TEXT NOT NULL,
  ai_feedback TEXT DEFAULT '',
  score_content INTEGER DEFAULT 0,
  score_organization INTEGER DEFAULT 0,
  score_expression INTEGER DEFAULT 0,
  score_accuracy INTEGER DEFAULT 0,
  total_score INTEGER DEFAULT 0,
  max_score INTEGER DEFAULT 0,
  time_spent_seconds INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_user ON exam_attempts(user_id, subject, created_at DESC);

CREATE TABLE IF NOT EXISTS exam_seasons (
  id TEXT PRIMARY KEY,
  exam_type TEXT NOT NULL,
  year INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(exam_type, year)
);
