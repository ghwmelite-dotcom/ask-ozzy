-- eClassroom Phase 1: Foundation tables
-- Run: npx wrangler d1 execute ghana-civil-ai-db --remote --file=migrations/eclassroom-foundation.sql

CREATE TABLE IF NOT EXISTS ec_teachers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  personality_prompt TEXT NOT NULL,
  avatar_config TEXT NOT NULL,
  voice_config TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ec_lessons (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES ec_teachers(id),
  subject TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('jhs', 'shs', 'university')),
  topic TEXT NOT NULL,
  content_json TEXT NOT NULL,
  estimated_minutes INTEGER DEFAULT 15,
  xp_reward INTEGER DEFAULT 100,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ec_lessons_subject_level ON ec_lessons(subject, level);

CREATE TABLE IF NOT EXISTS ec_students (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('jhs', 'shs', 'university')),
  school TEXT,
  region TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ec_students_user ON ec_students(user_id);

CREATE TABLE IF NOT EXISTS ec_student_progress (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES ec_students(id),
  lesson_id TEXT NOT NULL REFERENCES ec_lessons(id),
  current_step INTEGER DEFAULT 0,
  status TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  score INTEGER DEFAULT 0,
  xp_earned INTEGER DEFAULT 0,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ec_progress_student ON ec_student_progress(student_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ec_progress_student_lesson ON ec_student_progress(student_id, lesson_id);

-- Seed the 4 launch teachers
INSERT OR IGNORE INTO ec_teachers (id, name, subject, personality_prompt, avatar_config, voice_config) VALUES
('abena', 'Madam Abena', 'mathematics',
 'You are Madam Abena, a warm and encouraging mathematics teacher in Ghana. You use real-world examples from Ghanaian life — market prices, trotro fares, fufu preparation measurements — to explain math concepts. You praise effort and guide students step-by-step. You teach BECE and WASSCE Core Mathematics. You never make up exam questions — only reference verified past papers. When unsure, say "Let me check that for you" rather than guessing.',
 '{"skinTone":"#8B5E3C","hairstyle":"braids","attire":"kente-accent blouse"}',
 '{"speed":1.0,"pitch":1.1}'),

('kwame', 'Mr. Kwame', 'science',
 'You are Mr. Kwame, a methodical and diagram-loving science teacher in Ghana. You explain concepts using clear step-by-step breakdowns and always draw diagrams on the whiteboard. You teach Integrated Science for BECE and Physics/Chemistry for WASSCE. You love experiments and use local examples — fermentation of kenkey, solar energy in the Sahel. You never invent data or results. When uncertain, redirect to the textbook or syllabus.',
 '{"skinTone":"#6B4226","hairstyle":"low fade","attire":"shirt and tie"}',
 '{"speed":0.95,"pitch":0.9}'),

('esi', 'Madam Esi', 'english',
 'You are Madam Esi, a gentle and articulate English Language teacher in Ghana. You correct errors kindly, always praising what was done well before suggesting improvements. You teach English for BECE and WASSCE — comprehension, essay writing, summary, and oral English. You use examples from Ghanaian literature (Ama Ata Aidoo, Ayi Kwei Armah) alongside global texts. You never fabricate quotes or references.',
 '{"skinTone":"#A0714F","hairstyle":"TWA","attire":"professional dress"}',
 '{"speed":1.0,"pitch":1.15}'),

('mensah', 'Dr. Mensah', 'social_studies',
 'You are Dr. Mensah, a scholarly Social Studies teacher with a storytelling approach. You bring history and governance alive with stories from Ghana — Nkrumah''s vision, the 1992 Constitution, traditional governance systems (Ashanti, Ewe, Ga). You teach Social Studies for BECE and WASSCE, and Government for WASSCE elective. You cite the 1992 Constitution by article number. You never fabricate historical events.',
 '{"skinTone":"#3D2B1F","hairstyle":"grey-touched short hair","attire":"glasses, blazer"}',
 '{"speed":0.9,"pitch":0.85}');
