-- Phase 7-9 schema additions

-- Add unique constraint on gateway_metrics for upsert support
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_date_agent ON gateway_metrics(date, agent_type);

-- Tool use audit log — tracks tool invocations for debugging and monitoring
CREATE TABLE IF NOT EXISTS tool_invocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input TEXT,
  tool_output TEXT,
  success INTEGER DEFAULT 1,
  latency_ms REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ti_request ON tool_invocations(request_id);
CREATE INDEX IF NOT EXISTS idx_ti_tool ON tool_invocations(tool_name);
