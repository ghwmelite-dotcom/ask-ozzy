-- AskOzzy Affiliate Commission Engine (2-Level)
-- Direct referral: 30% of every payment
-- 2nd level: 5% of every payment from referral's referrals
-- Max per payment: 35% (30% L1 + 5% L2)

-- Affiliate wallet (balance tracking per user)
CREATE TABLE IF NOT EXISTS affiliate_wallets (
  user_id TEXT PRIMARY KEY,
  balance REAL DEFAULT 0.0,
  total_earned REAL DEFAULT 0.0,
  total_withdrawn REAL DEFAULT 0.0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Every commission credit and withdrawal debit
CREATE TABLE IF NOT EXISTS affiliate_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('commission_l1', 'commission_l2', 'withdrawal', 'bonus', 'reward')),
  amount REAL NOT NULL,
  description TEXT,
  source_user_id TEXT,
  source_payment_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_aff_tx_user ON affiliate_transactions(user_id, created_at DESC);

-- MoMo withdrawal requests
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount REAL NOT NULL,
  momo_number TEXT NOT NULL,
  momo_network TEXT DEFAULT 'mtn',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'paid', 'rejected')),
  admin_note TEXT,
  processed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_withdraw_status ON withdrawal_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdraw_user ON withdrawal_requests(user_id);
