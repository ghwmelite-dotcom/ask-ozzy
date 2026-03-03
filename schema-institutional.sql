-- Institutional Admin & Multi-Tenancy Schema Migration
-- Run after existing schema.sql

-- 1. Recreate organizations table with expanded fields
DROP TABLE IF EXISTS organizations;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_id TEXT NOT NULL,
  tier TEXT DEFAULT 'free',
  max_seats INTEGER DEFAULT 10,
  used_seats INTEGER DEFAULT 0,
  sector TEXT DEFAULT NULL,
  logo_url TEXT DEFAULT NULL,
  domain TEXT DEFAULT NULL,
  settings TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- 2. Org invites table
CREATE TABLE IF NOT EXISTS org_invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  tier TEXT DEFAULT NULL,
  invited_by TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (invited_by) REFERENCES users(id)
);

-- 3. Org pricing table
CREATE TABLE IF NOT EXISTS org_pricing (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'starter',
  seats_purchased INTEGER NOT NULL DEFAULT 10,
  price_per_seat REAL NOT NULL DEFAULT 50.0,
  billing_cycle TEXT DEFAULT 'monthly',
  billing_started_at TEXT DEFAULT (datetime('now')),
  billing_expires_at TEXT DEFAULT NULL,
  custom_terms TEXT DEFAULT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id)
);

-- 4. Add org_id to announcements for org-scoped announcements
ALTER TABLE announcements ADD COLUMN org_id TEXT DEFAULT NULL;

-- 5. Add org_id to agents for org-scoped agents
ALTER TABLE agents ADD COLUMN org_id TEXT DEFAULT NULL;
