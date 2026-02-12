-- ═══════════════════════════════════════════════════════════════════
--  AskOzzy — Phase 5b: WhatsApp/SMS Messaging Integration
-- ═══════════════════════════════════════════════════════════════════

-- WhatsApp/SMS sessions (one per phone number)
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL UNIQUE,
  user_id TEXT,
  last_message TEXT,
  last_response TEXT,
  message_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_phone ON whatsapp_sessions(phone_number);

-- Individual messages for audit trail
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
  content TEXT NOT NULL,
  channel TEXT DEFAULT 'whatsapp' CHECK(channel IN ('whatsapp', 'sms')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES whatsapp_sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_wa_msg_session ON whatsapp_messages(session_id, created_at);
