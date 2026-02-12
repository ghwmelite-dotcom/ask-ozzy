-- AskOzzy — Phase 1 Schema Migration
-- Run: npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase1.sql
--
-- Phase 1: AI Memory, Custom Agents, Artifacts support
-- Prerequisites: schema.sql and schema-kb.sql must be applied first

-- ═══ User Memories (AI Personalization) ═══

CREATE TABLE IF NOT EXISTS user_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  type TEXT DEFAULT 'preference' CHECK (type IN ('preference', 'fact', 'auto')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_memories_type ON user_memories(user_id, type);

-- ═══ Custom AI Agents ═══

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  system_prompt TEXT NOT NULL,
  department TEXT DEFAULT '',
  knowledge_category TEXT DEFAULT '',
  icon TEXT DEFAULT '🤖',
  active INTEGER DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_agents_active ON agents(active, name);
CREATE INDEX IF NOT EXISTS idx_agents_department ON agents(department);

-- ═══ Conversations: agent tracking ═══

-- Add agent_id to track which agent was used per conversation
-- SQLite doesn't support ALTER TABLE ADD COLUMN with FK, so we add without constraint
-- The application layer enforces the relationship

-- Note: This may fail if column already exists — that's fine, just ignore the error
ALTER TABLE conversations ADD COLUMN agent_id TEXT DEFAULT NULL;
