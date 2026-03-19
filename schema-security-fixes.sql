-- Security fixes migration
-- Run: npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-security-fixes.sql

-- 1. Session version counter for session invalidation
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;

-- 2. Payment idempotency tracking
CREATE TABLE IF NOT EXISTS processed_payments (
  reference TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount_pesewas INTEGER NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_processed_payments_user ON processed_payments(user_id);
