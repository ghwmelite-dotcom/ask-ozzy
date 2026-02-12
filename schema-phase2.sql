-- ═══════════════════════════════════════════════════════════════════
-- AskOzzy — Phase 2: Intelligence Layer Schema
-- ═══════════════════════════════════════════════════════════════════

-- Deep Research Mode: stores completed research reports
CREATE TABLE IF NOT EXISTS research_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  query TEXT NOT NULL,
  status TEXT DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  steps_completed INTEGER DEFAULT 0,
  total_steps INTEGER DEFAULT 5,
  report TEXT DEFAULT '',
  sources TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_reports_user ON research_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_research_reports_conversation ON research_reports(conversation_id);
