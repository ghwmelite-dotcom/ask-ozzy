-- Phase 7: Enhanced AI Meeting Minutes + Full Local Language AI Responses
-- Run after schema-phase6.sql

-- Extend meetings table
ALTER TABLE meetings ADD COLUMN meeting_type TEXT DEFAULT 'general';
ALTER TABLE meetings ADD COLUMN language TEXT DEFAULT 'en';

-- Action item tracking (separate table, not JSON blob)
CREATE TABLE IF NOT EXISTS meeting_action_items (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  assignee TEXT DEFAULT '',
  deadline TEXT DEFAULT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done')),
  completed_at TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_action_items_meeting ON meeting_action_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_action_items_user_status ON meeting_action_items(user_id, status);
