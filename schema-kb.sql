-- AskOzzy — Knowledge Base Schema Migration
-- Run: npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-kb.sql

-- RAG Documents — metadata for uploaded documents
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT DEFAULT '',
  category TEXT DEFAULT 'general',
  content TEXT NOT NULL,
  chunk_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'error')),
  uploaded_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

-- Document Chunks — individual chunks stored in Vectorize
CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  vector_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

-- Knowledge Base — structured FAQ entries
CREATE TABLE IF NOT EXISTS knowledge_base (
  id TEXT PRIMARY KEY,
  category TEXT DEFAULT 'general',
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  keywords TEXT DEFAULT '',
  priority INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document ON document_chunks(document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_document_chunks_vector ON document_chunks(vector_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_category ON knowledge_base(category, active);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_active ON knowledge_base(active, priority DESC);
