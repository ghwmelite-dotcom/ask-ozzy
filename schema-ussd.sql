-- ═══════════════════════════════════════════════════════════════════
--  AskOzzy — USSD Fallback Schema
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ussd_sessions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  service_code TEXT,
  current_menu TEXT DEFAULT 'main',
  input_history TEXT DEFAULT '',
  ai_response TEXT,
  message_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ussd_session ON ussd_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_ussd_phone ON ussd_sessions(phone_number);
