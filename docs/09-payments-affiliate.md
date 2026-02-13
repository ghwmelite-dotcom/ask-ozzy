# Payments & Affiliate System

## Pricing Tiers

| Feature | Free | Professional | Enterprise |
|---------|------|-------------|-----------|
| Price (GHS/month) | 0 | 60 | 100 |
| Student Price (GHS/month) | 0 | 25 | 45 |
| Messages per day | 10 | 200 | Unlimited |
| AI Models | 3 (basic) | All 10 | All 10 |
| Response speed | Standard | Priority | Fastest priority |
| Chat history | Limited | Unlimited | Unlimited |
| Template customization | No | Yes | Yes |
| Custom templates | No | No | Yes |
| Dedicated support | No | No | Yes |
| Popular | - | Yes | - |

Free tier models: GPT-OSS 20B, Gemma 3 12B, Llama 3.1 8B Fast.

## Paystack Integration

### Payment Flow

```
User selects plan → POST /api/payments/initialize → Paystack checkout URL →
User pays (MoMo/Card) → Paystack webhook → POST /api/webhooks/paystack →
Verify HMAC → Update user tier → Process affiliate commissions
```

### Initialize Payment

- API: POST /api/payments/initialize
- Body: `{ "plan": "professional", "channel": "mobile_money" }`
- Returns: `{ "authorization_url": "https://checkout.paystack.com/...", "reference": "..." }`
- Paystack generates checkout page
- User redirected to complete payment

### Payment Channels

| Channel | Description |
|---------|-------------|
| mobile_money | MTN MoMo, Vodafone Cash, AirtelTigo Money |
| card | Visa, Mastercard |
| (default) | Paystack shows all available options |

### Webhook Verification

- POST /api/webhooks/paystack
- Paystack sends event to webhook URL
- HMAC-SHA512 signature verification using Paystack secret key
- Verifies: `crypto.subtle.sign("HMAC", key, body)` matches `x-paystack-signature` header
- On success: updates user tier, processes affiliate commissions

### Webhook Events Handled

- `charge.success` — Payment successful, upgrade user tier

## Affiliate Commission Engine

### Overview

- 2-level commission system
- Every user gets a unique referral code on registration
- No tier requirements — everyone earns 30% from day one

### Commission Structure

| Level | Rate | Description |
|-------|------|-------------|
| L1 (Direct) | 30% | Commission from direct referral's payment |
| L2 (2nd level) | 5% | Commission from referral's referral's payment |
| Max per payment | 35% | Combined L1 + L2 |

### How It Works

1. User A shares referral code
2. User B registers with User A's code (`referred_by` field)
3. User B upgrades to Professional (GHS 60)
4. User A gets 30% = GHS 18 (L1 commission)
5. If User A was referred by User C, User C gets 5% = GHS 3 (L2 commission)

### Commission Processing

```
Payment received → Find L1 referrer (who referred the payer?) →
Credit 30% to L1 wallet → Find L2 referrer (who referred the L1 referrer?) →
Credit 5% to L2 wallet → Check milestone bonuses
```

Function: `processAffiliateCommissions(db, payingUserId, paymentAmountGHS, paymentReference)`

### Milestone Bonuses

| Threshold | Bonus (GHS) | Description |
|-----------|------------|-------------|
| 10 referrals | 30 | Cash bonus |
| 25 referrals | 60 | 1 month Professional value |
| 50 referrals | 100 | Enterprise value + permanent discount |
| 100 referrals | 200 | Free Enterprise for life |

Milestones are checked after each referral via `checkMilestones()`.
Bonus is only awarded once per milestone (checked via transaction history).

### Affiliate Wallet

Each user has an affiliate wallet (affiliate_wallets table):

- balance: Current available balance
- total_earned: Lifetime earnings
- total_withdrawn: Lifetime withdrawals

### Withdrawal Flow

```
User requests withdrawal → POST /api/affiliate/withdraw →
Validate balance >= amount → Create withdrawal_request (status: pending) →
Debit wallet → Admin reviews → Approve/Reject →
If approved: MoMo payout (manual) → Update status to 'paid'
If rejected: Re-credit wallet → Update status to 'rejected'
```

Minimum withdrawal: Validated in application logic.
Payment method: MTN MoMo (primary), Vodafone Cash, AirtelTigo Money.

### Affiliate Dashboard (User)

- GET /api/affiliate/dashboard
- Shows: balance, total_earned, total_withdrawn, total_referrals
- Network visualization (L1 and L2 referrals)
- Recent transactions
- Referral link with share button

### Leaderboard

- GET /api/affiliate/leaderboard
- Top affiliates ranked by total referrals
- Shows: rank, name, referral count, total earned

### Admin Management

- GET /api/admin/affiliate/withdrawals — View pending withdrawals
- POST /api/admin/affiliate/withdrawals/:id/approve — Approve + mark for payout
- POST /api/admin/affiliate/withdrawals/:id/reject — Reject with reason, re-credit wallet
- GET /api/admin/affiliate/stats — Program-wide statistics

## 3-Day Free Trial

- POST /api/trial/activate — Activates Professional tier for 3 days
- Sets `trial_expires_at` on user record
- During trial, free users get Professional tier access
- Checked via: `trial_expires_at > now()` → treat as Professional
- GET /api/trial/status — Check if trial is active

## Student Pricing

- Users with `user_type = 'student'` get discounted pricing
- Professional: GHS 25 (vs 60), Enterprise: GHS 45 (vs 100)
- GET /api/pricing checks auth to detect student status
- Student persona includes academic templates
