# Security & Authentication

## Authentication Methods

### 1. Access Codes (Primary)
- Format: XXXX-XXXX (8 alphanumeric characters, hyphenated)
- Character set: ABCDEFGHJKMNPQRSTUVWXYZ23456789 (no ambiguous chars like 0/O, 1/I/L)
- Generated on registration via `generateAccessCode()`
- User logs in by entering their access code
- No traditional passwords — access codes serve as credentials
- Access codes are hashed with SHA-256 and stored as `password_hash`
- Code normalization: `normalizeAccessCode()` strips non-alphanumeric chars, uppercases, re-formats

### 2. WebAuthn Passkeys
- FIDO2/WebAuthn standard for passwordless authentication
- Registration flow:
  1. POST /api/auth/webauthn/register-options — Server generates challenge
  2. Client calls `navigator.credentials.create()` with options
  3. POST /api/auth/webauthn/register-complete — Server verifies and stores credential
- Login flow:
  1. POST /api/auth/webauthn/login-options — Server generates challenge for user's credentials
  2. Client calls `navigator.credentials.get()` with options
  3. POST /api/auth/webauthn/login-complete — Server verifies assertion, creates session
- Credentials stored in `webauthn_credentials` table (credential_id, public_key, sign_count)
- Multiple passkeys per user supported
- Manage via GET /api/auth/webauthn/credentials, DELETE /api/auth/webauthn/credentials/:id

### 3. TOTP Two-Factor Authentication
- Time-based One-Time Password (RFC 6238)
- Setup flow:
  1. POST /api/user/2fa/setup — Server generates TOTP secret, returns QR code URL
  2. User scans QR with authenticator app (Google Authenticator, Authy, etc.)
  3. POST /api/user/2fa/verify — User enters 6-digit code to enable 2FA
- Login with 2FA: After access code login, prompted for TOTP code
- POST /api/auth/register/verify-totp — Verify during registration
- Disable: POST /api/user/2fa/disable (requires current TOTP code)
- Fields: totp_secret, totp_enabled on users table

### 4. Recovery Codes
- Single-use backup code for account recovery
- Format: XXXX-XXXX (same as access code format)
- Hashed with SHA-256, stored as `recovery_code_hash`
- Regenerate: POST /api/auth/recovery-code/regenerate

## Session Management

- **Token generation**: `crypto.randomUUID()` generates session token
- **Storage**: Cloudflare KV with key format `session:{token}`
- **Value**: User ID string
- **TTL**: 7 days (`expirationTtl: 60 * 60 * 24 * 7`)
- **Verification**: `verifyToken()` looks up token in KV, returns userId or null
- **Transport**: Bearer token in Authorization header
- **Logout**: DELETE token from KV
- **Revoke all**: POST /api/user/sessions/revoke-all — deletes all sessions for user

## Rate Limiting

KV-backed per-category rate limits:

| Category | Max Requests | Window | Key Format |
|----------|-------------|--------|------------|
| auth | 10 | 5 minutes | ratelimit:auth:{identifier} |
| chat | 30 | 1 minute | ratelimit:chat:{identifier} |
| api | 100 | 1 minute | ratelimit:api:{identifier} |

Implementation:
- `checkRateLimit(env, key, category)` returns `{allowed: boolean, remaining: number}`
- Counter stored in KV with TTL matching window
- Incremented on each request
- Fails open (if KV error, allows request)
- Returns remaining count for rate limit headers

## Role-Based Access Control (RBAC)

| Role | Access Level | Description |
|------|-------------|-------------|
| civil_servant (default) | User | Standard user access |
| dept_admin | Department | User access + department-scoped admin |
| super_admin | Full | Complete admin access |

### Middleware Stack
1. **authMiddleware** — Verifies Bearer token, sets userId. Returns 401 if invalid.
2. **adminMiddleware** — Verifies Bearer token + checks `role = 'super_admin'` from D1. Returns 403 if not admin.
3. **deptAdminMiddleware** — Allows `super_admin` or `dept_admin`. For dept_admin, sets `deptFilter` variable to scope queries to their department.

### Access Levels

| Resource | User | Dept Admin | Super Admin |
|----------|------|-----------|-------------|
| Own conversations | Yes | Yes | Yes |
| Own profile/settings | Yes | Yes | Yes |
| Department users | No | Read-only | Full CRUD |
| All users | No | No | Full CRUD |
| Admin dashboard | No | Dept stats | Full |
| Knowledge base mgmt | No | No | Full CRUD |
| System config | No | No | Full |
| Audit log | No | No | Full |

## Password Hashing

- Algorithm: SHA-256 via Web Crypto API
- Implementation: `crypto.subtle.digest("SHA-256", data)`
- Encoding: Base64 via `btoa(String.fromCharCode(...new Uint8Array(hash)))`
- Used for: access codes, recovery codes

## HMAC Webhook Verification

Paystack webhook signature verification:

```
1. Receive POST /api/webhooks/paystack
2. Read raw request body
3. Read x-paystack-signature header
4. Compute HMAC-SHA512 of body using Paystack secret key
5. Compare computed hash with provided signature
6. If match: process payment event
7. If no match: return 401
```

## Content Moderation

- Messages can be flagged for review
- Stored in `moderation_flags` table
- Status flow: pending → reviewed/dismissed
- Admin reviews via GET /api/admin/moderation
- Admin actions: PATCH /api/admin/moderation/:id with status + review notes

## Audit Trail

Two audit systems:
1. **Admin audit log** (audit_log table) — Tracks admin actions (user changes, deletions, promotions)
2. **User audit log** (user_audit_log table) — Tracks all AI operations (chat, research, analysis, vision)

User audit captures: user_id, email, department, action_type, query_preview, model_used, ip_address, timestamp.

Export: GET /api/admin/audit/export (CSV format).

## Security Headers

- CORS enabled for /api/* routes via Hono cors() middleware
- No custom CSP headers (served by Cloudflare)

## Data Sovereignty

- All data stored on Cloudflare's global network
- D1 database uses SQLite (edge-replicated)
- No data leaves Cloudflare infrastructure
- Workers AI inference runs on Cloudflare GPUs
