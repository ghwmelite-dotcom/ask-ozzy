-- AskOzzy — Discover News Feed Schema

CREATE TABLE IF NOT EXISTS discover_articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  source_name TEXT,
  source_url TEXT,
  article_url TEXT UNIQUE NOT NULL,
  image_url TEXT,
  category TEXT NOT NULL,
  published_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_discover_category ON discover_articles(category);
CREATE INDEX IF NOT EXISTS idx_discover_published ON discover_articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_discover_fetched ON discover_articles(fetched_at);
