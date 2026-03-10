-- Add status column to users table for activate/deactivate functionality
ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active' NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
