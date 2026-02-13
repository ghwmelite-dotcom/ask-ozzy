-- ═══════════════════════════════════════════════════════════════════
-- AskOzzy — Phase 5: Audit Trail & Compliance Schema
-- ═══════════════════════════════════════════════════════════════════

-- User activity audit log (tracks all user AI operations)
CREATE TABLE IF NOT EXISTS user_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  user_email TEXT,
  department TEXT,
  action_type TEXT NOT NULL,
  query_preview TEXT,
  model_used TEXT,
  ip_address TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_audit_created ON user_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_user_audit_user ON user_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_user_audit_action ON user_audit_log(action_type);
CREATE INDEX IF NOT EXISTS idx_user_audit_department ON user_audit_log(department);

-- ═══════════════════════════════════════════════════════════════════
-- Productivity Stats (per-user, per-day tracking)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS productivity_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  stat_date TEXT NOT NULL,
  messages_sent INTEGER DEFAULT 0,
  documents_generated INTEGER DEFAULT 0,
  research_reports INTEGER DEFAULT 0,
  analyses_run INTEGER DEFAULT 0,
  meetings_processed INTEGER DEFAULT 0,
  workflows_completed INTEGER DEFAULT 0,
  estimated_minutes_saved INTEGER DEFAULT 0,
  UNIQUE(user_id, stat_date)
);
CREATE INDEX IF NOT EXISTS idx_prod_user_date ON productivity_stats(user_id, stat_date);
