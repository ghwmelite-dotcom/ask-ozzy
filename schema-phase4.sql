-- ═══════════════════════════════════════════════════════════════════
-- AskOzzy — Phase 4: Platform Dominance Schema
-- ═══════════════════════════════════════════════════════════════════

-- Feature 9: Workflow Automation
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','in_progress','completed','cancelled')),
  steps TEXT DEFAULT '[]',
  current_step INTEGER DEFAULT 0,
  output TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT DEFAULT NULL,
  scheduled_at TEXT DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workflows_user ON workflows(user_id);

-- Feature 10: AI Meeting Assistant
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  transcript TEXT DEFAULT '',
  minutes TEXT DEFAULT '',
  action_items TEXT DEFAULT '[]',
  duration_seconds INTEGER DEFAULT 0,
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing','transcribed','completed','failed')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_meetings_user ON meetings(user_id);

-- Feature 11: Collaborative Spaces
CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  owner_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS space_members (
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin','member','viewer')),
  joined_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (space_id, user_id),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS space_conversations (
  space_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  shared_by TEXT NOT NULL,
  shared_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (space_id, conversation_id),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (shared_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Feature 12: Citizen Service Bot
CREATE TABLE IF NOT EXISTS citizen_sessions (
  id TEXT PRIMARY KEY,
  language TEXT DEFAULT 'en',
  created_at TEXT DEFAULT (datetime('now')),
  last_active TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS citizen_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES citizen_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_citizen_messages_session ON citizen_messages(session_id);
