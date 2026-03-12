-- AskOzzy Anti-Hallucination Schema Migration
-- Run: npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-anti-hallucination.sql

-- Knowledge documents — full text storage for Vectorize chunks
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  document TEXT NOT NULL,
  section TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT NOT NULL,
  embedded_at TEXT,
  verified_by TEXT,
  verified_at TEXT,
  hallucination_flags INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_kd_document ON knowledge_documents(document);
CREATE INDEX IF NOT EXISTS idx_kd_flags ON knowledge_documents(hallucination_flags);

-- Hallucination events audit log
CREATE TABLE IF NOT EXISTS hallucination_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  query TEXT NOT NULL,
  generated_response TEXT,
  verification_report TEXT,
  contradicted_claims TEXT,
  user_id TEXT,
  flagged_by TEXT CHECK(flagged_by IN ('verifier', 'user_report', 'consistency_check')),
  created_at TEXT DEFAULT (datetime('now')),
  reviewed INTEGER DEFAULT 0,
  resolution TEXT
);

CREATE INDEX IF NOT EXISTS idx_he_agent ON hallucination_events(agent_type);
CREATE INDEX IF NOT EXISTS idx_he_reviewed ON hallucination_events(reviewed);
CREATE INDEX IF NOT EXISTS idx_he_created ON hallucination_events(created_at);

-- Response feedback with issue categorization
CREATE TABLE IF NOT EXISTS response_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  session_id TEXT,
  agent_type TEXT NOT NULL,
  query TEXT NOT NULL,
  response_text TEXT NOT NULL,
  confidence_level TEXT,
  rating INTEGER CHECK(rating IN (1, -1)),
  issue_type TEXT CHECK(issue_type IN (
    'hallucination', 'incomplete', 'confusing',
    'wrong_citation', 'outdated', 'off_topic', 'other'
  )),
  user_correction TEXT,
  channel TEXT CHECK(channel IN ('web', 'whatsapp', 'ussd')) DEFAULT 'web',
  created_at TEXT DEFAULT (datetime('now')),
  reviewed INTEGER DEFAULT 0,
  review_outcome TEXT
);

CREATE INDEX IF NOT EXISTS idx_rf_agent ON response_feedback(agent_type);
CREATE INDEX IF NOT EXISTS idx_rf_rating ON response_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_rf_reviewed ON response_feedback(reviewed);

-- KB gaps identified from negative feedback
CREATE TABLE IF NOT EXISTS kb_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_type TEXT NOT NULL,
  topic TEXT NOT NULL,
  query_examples TEXT NOT NULL,
  frequency INTEGER DEFAULT 1,
  priority TEXT CHECK(priority IN ('critical', 'high', 'medium', 'low')) DEFAULT 'medium',
  status TEXT DEFAULT 'open',
  resolution_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_gaps_priority ON kb_gaps(priority, status);

-- Known errors — prevents serving cached hallucinations
CREATE TABLE IF NOT EXISTS known_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_hash TEXT NOT NULL UNIQUE,
  agent_type TEXT NOT NULL,
  error_description TEXT NOT NULL,
  confirmed_at TEXT DEFAULT (datetime('now')),
  correction TEXT
);

-- Gateway performance metrics
CREATE TABLE IF NOT EXISTS gateway_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  total_requests INTEGER DEFAULT 0,
  cache_hits INTEGER DEFAULT 0,
  hallucination_flags INTEGER DEFAULT 0,
  avg_response_ms REAL,
  avg_confidence_score REAL
);
