-- eClassroom: session tracking + prebuilt classroom registry
-- Run: npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-eclassroom.sql

CREATE TABLE IF NOT EXISTS classroom_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  classroom_id TEXT NOT NULL,
  classroom_title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_classroom_sessions_user ON classroom_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_classroom_sessions_month ON classroom_sessions(user_id, created_at);

CREATE TABLE IF NOT EXISTS prebuilt_classrooms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  topic TEXT NOT NULL,
  description TEXT,
  difficulty TEXT NOT NULL DEFAULT 'intermediate',
  target_audience TEXT NOT NULL DEFAULT 'student',
  exam_type TEXT,
  openmaic_classroom_id TEXT,
  thumbnail_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prebuilt_subject ON prebuilt_classrooms(subject);
CREATE INDEX IF NOT EXISTS idx_prebuilt_audience ON prebuilt_classrooms(target_audience);
CREATE INDEX IF NOT EXISTS idx_prebuilt_active ON prebuilt_classrooms(is_active);
