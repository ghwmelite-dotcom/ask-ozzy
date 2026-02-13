# Database Schema

## Overview

AskOzzy uses **Cloudflare D1** (SQLite at the edge) as its primary relational store. The schema is spread across **9 migration files** containing **34 CREATE TABLE statements** (32 unique tables, since `user_memories` and `agents` are duplicated in `schema-phase1.sql` with `IF NOT EXISTS` guards). There are **40+ indexes** for query performance.

**Engine:** SQLite (via Cloudflare D1)
**ID Strategy:** UUIDs (TEXT) for most tables; INTEGER AUTOINCREMENT for logs/stats
**Timestamps:** ISO 8601 TEXT columns with `datetime('now')` defaults
**Foreign Keys:** Enforced at schema level; `ON DELETE CASCADE` on user-owned data

---

## Migration Order

Run these in sequence against your D1 database:

```bash
# 1. Core tables (15 tables, 21 indexes)
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema.sql

# 2. Knowledge base (3 tables, 7 indexes)
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-kb.sql

# 3. Memories + agents (duplicates of schema.sql tables + ALTER for agent_id)
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase1.sql

# 4. Research reports (1 table, 2 indexes)
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase2.sql

# 5. Workflows, meetings, spaces, citizen bot (7 tables, 3 indexes)
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase4.sql

# 6. Audit trail + productivity stats (2 tables, 5 indexes)
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase5.sql

# 7. WhatsApp/SMS messaging (2 tables, 2 indexes)
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-phase5b.sql

# 8. USSD fallback (1 table, 2 indexes)
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-ussd.sql

# 9. Affiliate commission engine (3 tables, 3 indexes)
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-affiliate.sql
```

---

## ER Diagram (Simplified)

```
                                    +-------------------+
                                    |   organizations   |
                                    |-------------------|
                                    | id (PK)           |
                                    | owner_id (FK)-----+------+
                                    | name, tier        |      |
                                    +-------------------+      |
                                                               |
+-------------------+       +====================+       +-----+-------+
|    referrals      |       |      users         |       |   folders   |
|-------------------|       |====================|       |-------------|
| id (PK)           |  +-->| id (PK)            |<--+   | id (PK)     |
| referrer_id (FK)--+--+   | email (UNIQUE)     |   +---| user_id(FK) |
| referred_id (FK)--+--+   | full_name          |   |   | name, color |
| status, bonus     |      | department, role   |   |   +------+------+
+-------------------+      | tier, org_id (FK)  |   |          |
                           | referral_code (UQ) |   |          |
+-------------------+      | affiliate_tier     |   |   +------+----------+
| webauthn_creds    |      | totp_*, auth_method|   |   | conversations   |
|-------------------|      +========+=====+=====+   |   |-----------------|
| id (PK)           |           |   |     |         |   | id (PK)         |
| user_id (FK)------+----------+   |     |         +---| user_id (FK)    |
| credential_id(UQ) |              |     |             | folder_id (FK)--+
| public_key        |              |     |             | agent_id (FK)   |
+-------------------+              |     |             | title, model    |
                                   |     |             | pinned          |
+-------------------+              |     |             | share_token     |
| push_subscriptions|              |     |             +----+---+--------+
|-------------------|              |     |                  |   |
| id (PK)           |              |     |                  |   |
| user_id (FK)------+--------------+     |                  |   |
| endpoint (UNIQUE) |                    |          +-------+   |
| p256dh, auth      |                    |          |           |
+-------------------+                    |   +------+------+   |
                                         |   |  messages   |   |
+-------------------+                    |   |-------------|   |
|  user_memories    |                    |   | id (PK)     |   |
|-------------------|                    |   | conv_id(FK)-+---+
| id (PK)           |                    |   | role        |
| user_id (FK)------+--------------------+   | content     |
| key (UQ w/user)   |                    |   | model       |
| value, type       |                    |   +------+------+
+-------------------+                    |          |
                                         |   +------+----------+
+-------------------+                    |   | message_ratings  |
|     agents        |                    |   |------------------|
|-------------------|                    |   | id (PK)          |
| id (PK)           |                    |   | user_id (FK)     |
| name              |                    |   | message_id (FK)  |
| system_prompt     |                    |   | rating (-1 or 1) |
| department        |                    |   +------------------+
| created_by (FK)---+--------------------+
+-------------------+                    |   +------------------+
                                         |   |   usage_log      |
+-------------------+                    |   |------------------|
|   documents       |                    |   | id (PK AUTO)     |
|-------------------|                    +---| user_id (FK)     |
| id (PK)           |                    |   | model, tokens    |
| title, source     |                    |   | date             |
| content, status   |                    |   +------------------+
| uploaded_by (FK)--+--------------------+
+------+------------+                    |   +------------------+
       |                                 |   |  announcements   |
+------+------------+                    |   |------------------|
| document_chunks   |                    +---| admin_id (FK)    |
|-------------------|                    |   | title, content   |
| id (PK)           |                    |   | type, active     |
| document_id (FK)  |                    |   +------------------+
| chunk_index       |                    |
| content           |                    |   +------------------+
| vector_id         |                    |   |   audit_log      |
+-------------------+                    |   |------------------|
                                         +---| admin_id (FK)    |
+-------------------+                    |   | action, target   |
|  knowledge_base   |                    |   +------------------+
|-------------------|                    |
| id (PK)           |                    |   +------------------+
| category          |                    |   | moderation_flags |
| question, answer  |                    |   |------------------|
| created_by (FK)---+--------------------+   | id (PK)          |
+-------------------+                    |   | conv_id, msg_id  |
                                         +---| user_id (FK)     |
+-------------------+                    |   | reason, status   |
| research_reports  |                    |   +------------------+
|-------------------|                    |
| id (PK)           |                    |
| user_id (FK)------+--------------------+
| conversation_id   |                    |   +-------------------+
| query, status     |                    |   |     spaces        |
| report, sources   |                    |   |-------------------|
+-------------------+                    |   | id (PK)           |
                                         +---| owner_id (FK)     |
+-------------------+                    |   | name, description |
|    workflows      |                    |   +----+---------+----+
|-------------------|                    |        |         |
| id (PK)           |                    |   +----+------+  +----+-----------+
| user_id (FK)------+--------------------+   | space_   |  | space_         |
| name, type        |                    |   | members  |  | conversations  |
| steps, status     |                    |   |----------|  |----------------|
+-------------------+                    |   | space_id |  | space_id (FK)  |
                                         |   | user_id  |  | conv_id (FK)   |
+-------------------+                    |   | role     |  | shared_by (FK) |
|    meetings       |                    |   +----------+  +----------------+
|-------------------|                    |
| id (PK)           |                    |
| user_id (FK)------+--------------------+
| title, transcript |
| minutes, status   |                   +--------------------+
+-------------------+                   |  citizen_sessions   |
                                        |--------------------|
+-------------------+                   | id (PK)            |
| whatsapp_sessions |                   | language            |
|-------------------|                   +----+---------------+
| id (PK)           |                        |
| phone_number (UQ) |               +--------+---------+
| user_id           |               | citizen_messages  |
+------+------------+               |-------------------|
       |                            | id (PK)           |
+------+------------+               | session_id (FK)   |
| whatsapp_messages |               | role, content     |
|-------------------|               +-------------------+
| id (PK)           |
| session_id (FK)   |         +-----------------------+
| direction         |         |    ussd_sessions      |
| content, channel  |         |-----------------------|
+-------------------+         | id (PK)               |
                              | session_id, phone     |
+-------------------+         | current_menu          |
| affiliate_wallets |         | ai_response           |
|-------------------|         +-----------------------+
| user_id (PK/FK)   |
| balance            |
| total_earned       |        +-------------------------+
+------+-------------+        |  affiliate_transactions |
       |                      |-------------------------|
       |                      | id (PK)                 |
       |                      | user_id, type, amount   |
       |                      | source_user_id          |
       |                      +-------------------------+
       |
+------+---------------+
| withdrawal_requests  |
|----------------------|
| id (PK)              |
| user_id, amount      |
| momo_number          |
| status               |
+----------------------+
```

---

## All Tables

---

### schema.sql -- Core (15 tables)

#### 1. users

Central user table. Every authenticated entity in AskOzzy.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| email | TEXT | UNIQUE NOT NULL | -- | Login identifier |
| password_hash | TEXT | NOT NULL | -- | Hashed access code |
| full_name | TEXT | NOT NULL | -- | Display name |
| department | TEXT | -- | `''` | GoG department |
| role | TEXT | -- | `'civil_servant'` | `civil_servant` / `admin` / `super_admin` |
| tier | TEXT | -- | `'free'` | `free` / `starter` / `professional` / `enterprise` |
| referral_code | TEXT | UNIQUE | -- | Auto-generated referral slug |
| referred_by | TEXT | FK -> users(id) | NULL | Who referred this user |
| affiliate_tier | TEXT | -- | `'starter'` | Affiliate program tier |
| total_referrals | INTEGER | -- | 0 | Cached referral count |
| affiliate_earnings | REAL | -- | 0.0 | Cached total earnings |
| totp_secret | TEXT | -- | NULL | 2FA TOTP secret |
| totp_enabled | INTEGER | -- | 0 | Boolean: 2FA active |
| auth_method | TEXT | -- | `'access_code'` | `access_code` / `passkey` / `totp` |
| recovery_code_hash | TEXT | -- | NULL | Hashed recovery code |
| referral_source | TEXT | -- | `'organic'` | Acquisition channel |
| submitted_referral_code | TEXT | -- | NULL | Code entered at signup |
| org_id | TEXT | -- | NULL | Organization membership |
| created_at | TEXT | -- | `datetime('now')` | ISO 8601 |
| last_login | TEXT | -- | `datetime('now')` | Last authentication |

**Lazy columns** (added via ALTER TABLE in application code):
- `trial_expires_at` TEXT -- Trial period end
- `current_streak` INTEGER -- Consecutive active days
- `longest_streak` INTEGER -- All-time best streak
- `last_active_date` TEXT -- For streak calculation
- `badges` TEXT -- JSON array of earned badges
- `user_type` TEXT -- User classification

---

#### 2. webauthn_credentials

Passkey (WebAuthn) credential storage for passwordless login.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| user_id | TEXT | NOT NULL, FK -> users(id) ON DELETE CASCADE | -- | Owner |
| credential_id | TEXT | NOT NULL, UNIQUE | -- | WebAuthn credential ID |
| public_key | TEXT | NOT NULL | -- | COSE public key |
| sign_count | INTEGER | -- | 0 | Replay attack counter |
| created_at | TEXT | -- | `datetime('now')` | Registration time |

---

#### 3. referrals

Tracks referral relationships and commission status.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| referrer_id | TEXT | NOT NULL, FK -> users(id) ON DELETE CASCADE | -- | Who referred |
| referred_id | TEXT | NOT NULL, FK -> users(id) ON DELETE CASCADE | -- | Who was referred |
| status | TEXT | CHECK IN (`pending`, `completed`, `paid`) | `'completed'` | Lifecycle state |
| bonus_amount | REAL | -- | 10.0 | One-time bonus (GHS) |
| recurring_rate | REAL | -- | 0.05 | Recurring commission % |
| created_at | TEXT | -- | `datetime('now')` | When referral occurred |

---

#### 4. folders

User-created folders for organizing conversations.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| user_id | TEXT | NOT NULL, FK -> users(id) ON DELETE CASCADE | -- | Owner |
| name | TEXT | NOT NULL | -- | Folder label |
| color | TEXT | -- | `'#FCD116'` | Ghana gold default |
| sort_order | INTEGER | -- | 0 | Manual ordering |
| created_at | TEXT | -- | `datetime('now')` | Creation time |

---

#### 5. conversations

Chat conversations. Central to the messaging system.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| user_id | TEXT | NOT NULL, FK -> users(id) ON DELETE CASCADE | -- | Owner |
| title | TEXT | -- | `'New Conversation'` | Auto-generated or user-set |
| template_id | TEXT | -- | NULL | GoG prompt template used |
| model | TEXT | -- | `'@cf/meta/llama-4-scout-17b-16e-instruct'` | AI model for this chat |
| folder_id | TEXT | FK -> folders(id) | NULL | Optional folder grouping |
| pinned | INTEGER | -- | 0 | Boolean: pinned to top |
| agent_id | TEXT | -- | NULL | Custom agent (added by phase1 ALTER) |
| share_token | TEXT | -- | NULL | Public share URL token |
| shared_at | TEXT | -- | NULL | When sharing was enabled |
| created_at | TEXT | -- | `datetime('now')` | Creation time |
| updated_at | TEXT | -- | `datetime('now')` | Last message time |

---

#### 6. messages

Individual messages within conversations.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| conversation_id | TEXT | NOT NULL, FK -> conversations(id) ON DELETE CASCADE | -- | Parent conversation |
| role | TEXT | NOT NULL, CHECK IN (`user`, `assistant`, `system`) | -- | Message author type |
| content | TEXT | NOT NULL | -- | Message body (markdown) |
| model | TEXT | -- | NULL | Which AI model responded |
| tokens_used | INTEGER | -- | 0 | Token count for billing |
| created_at | TEXT | -- | `datetime('now')` | Send time |

---

#### 7. message_ratings

Thumbs up/down feedback on AI responses.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| user_id | TEXT | NOT NULL, FK -> users(id) ON DELETE CASCADE | -- | Who rated |
| message_id | TEXT | NOT NULL, FK -> messages(id) ON DELETE CASCADE | -- | Which message |
| conversation_id | TEXT | NOT NULL | -- | Denormalized for queries |
| rating | INTEGER | NOT NULL, CHECK IN (-1, 1) | -- | -1 = thumbs down, 1 = thumbs up |
| created_at | TEXT | -- | `datetime('now')` | Rating time |

**Unique constraint:** `UNIQUE(user_id, message_id)` -- one rating per user per message.

---

#### 8. usage_log

Token usage tracking for billing and quotas.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | -- | Auto-increment |
| user_id | TEXT | NOT NULL, FK -> users(id) ON DELETE CASCADE | -- | Who used tokens |
| model | TEXT | NOT NULL | -- | Model identifier |
| input_tokens | INTEGER | -- | 0 | Prompt tokens |
| output_tokens | INTEGER | -- | 0 | Completion tokens |
| date | TEXT | -- | `date('now')` | Date only (for daily aggregation) |

---

#### 9. announcements

Admin broadcast messages shown to all users.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| admin_id | TEXT | NOT NULL, FK -> users(id) | -- | Publishing admin |
| title | TEXT | NOT NULL | -- | Announcement headline |
| content | TEXT | NOT NULL | -- | Full message body |
| type | TEXT | CHECK IN (`info`, `warning`, `success`, `maintenance`) | `'info'` | Visual style |
| active | INTEGER | -- | 1 | Boolean: currently shown |
| dismissible | INTEGER | -- | 1 | Boolean: user can dismiss |
| created_at | TEXT | -- | `datetime('now')` | Publish time |
| expires_at | TEXT | -- | NULL | Auto-expire time |

---

#### 10. audit_log

Admin action audit trail (role changes, user management, etc.).

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| admin_id | TEXT | NOT NULL, FK -> users(id) | -- | Acting admin |
| action | TEXT | NOT NULL | -- | Action performed |
| target_type | TEXT | NOT NULL | -- | Entity type (user, conversation, etc.) |
| target_id | TEXT | -- | NULL | Entity ID |
| details | TEXT | -- | NULL | JSON with additional context |
| created_at | TEXT | -- | `datetime('now')` | Action time |

---

#### 11. moderation_flags

Content moderation flags raised by users or automated systems.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| conversation_id | TEXT | NOT NULL, FK -> conversations(id) ON DELETE CASCADE | -- | Flagged conversation |
| message_id | TEXT | -- | NULL | Specific message (optional) |
| user_id | TEXT | NOT NULL, FK -> users(id) ON DELETE CASCADE | -- | Who flagged |
| reason | TEXT | NOT NULL | -- | Flag reason |
| status | TEXT | CHECK IN (`pending`, `reviewed`, `dismissed`) | `'pending'` | Review state |
| reviewed_by | TEXT | -- | NULL | Reviewing admin |
| created_at | TEXT | -- | `datetime('now')` | Flag time |

---

#### 12. organizations

Team/department billing and seat management.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| name | TEXT | NOT NULL | -- | Organization name |
| owner_id | TEXT | NOT NULL, FK -> users(id) | -- | Billing owner |
| tier | TEXT | -- | `'free'` | Subscription tier |
| max_seats | INTEGER | -- | 10 | Licensed user count |
| created_at | TEXT | -- | `datetime('now')` | Creation time |

---

#### 13. user_memories

AI personalization memory. Stores user preferences and facts for context injection.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| user_id | TEXT | NOT NULL, FK -> users(id) ON DELETE CASCADE | -- | Owner |
| key | TEXT | NOT NULL | -- | Memory key (e.g., `preferred_language`) |
| value | TEXT | NOT NULL | -- | Memory value |
| type | TEXT | CHECK IN (`preference`, `fact`, `auto`) | `'preference'` | How it was created |
| created_at | TEXT | -- | `datetime('now')` | First set |
| updated_at | TEXT | -- | `datetime('now')` | Last modified |

**Unique constraint:** `UNIQUE(user_id, key)` -- one value per key per user.

---

#### 14. agents

Custom AI agents with specialized system prompts.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| name | TEXT | NOT NULL | -- | Agent display name |
| description | TEXT | -- | `''` | Short description |
| system_prompt | TEXT | NOT NULL | -- | Full system prompt injected into chat |
| department | TEXT | -- | `''` | Target department |
| knowledge_category | TEXT | -- | `''` | RAG category filter |
| icon | TEXT | -- | `'robot emoji'` | Display icon |
| active | INTEGER | -- | 1 | Boolean: available for use |
| created_by | TEXT | NOT NULL, FK -> users(id) | -- | Creator |
| created_at | TEXT | -- | `datetime('now')` | Creation time |
| updated_at | TEXT | -- | `datetime('now')` | Last modified |

**Lazy column:** `user_type` TEXT -- added via ALTER TABLE in application code.

---

#### 15. push_subscriptions

Web Push API subscription storage for notifications.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| user_id | TEXT | NOT NULL, FK -> users(id) ON DELETE CASCADE | -- | Subscriber |
| endpoint | TEXT | NOT NULL, UNIQUE | -- | Push service URL |
| p256dh | TEXT | NOT NULL | -- | Encryption key |
| auth | TEXT | NOT NULL | -- | Auth secret |
| notify_announcements | INTEGER | -- | 1 | Receive announcement pushes |
| notify_queue_sync | INTEGER | -- | 1 | Receive offline queue sync pushes |
| notify_shared_chat | INTEGER | -- | 1 | Receive shared chat pushes |
| created_at | TEXT | -- | `datetime('now')` | Subscription time |

---

### schema-kb.sql -- Knowledge Base (3 tables)

#### 16. documents

RAG document metadata. Tracks uploaded files processed into vector chunks.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| title | TEXT | NOT NULL | -- | Document title |
| source | TEXT | -- | `''` | Origin (URL, filename, etc.) |
| category | TEXT | -- | `'general'` | Classification for filtering |
| content | TEXT | NOT NULL | -- | Full extracted text |
| chunk_count | INTEGER | -- | 0 | Number of vector chunks |
| status | TEXT | CHECK IN (`processing`, `ready`, `error`) | `'processing'` | Pipeline state |
| uploaded_by | TEXT | NOT NULL, FK -> users(id) | -- | Uploader |
| created_at | TEXT | -- | `datetime('now')` | Upload time |
| updated_at | TEXT | -- | `datetime('now')` | Last processed |

---

#### 17. document_chunks

Individual text chunks stored alongside Vectorize embeddings.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| document_id | TEXT | NOT NULL, FK -> documents(id) ON DELETE CASCADE | -- | Parent document |
| chunk_index | INTEGER | NOT NULL | -- | Order within document |
| content | TEXT | NOT NULL | -- | Chunk text (500 chars, 50-char overlap) |
| vector_id | TEXT | NOT NULL | -- | Vectorize vector ID |
| created_at | TEXT | -- | `datetime('now')` | Chunk creation time |

---

#### 18. knowledge_base

Structured FAQ entries for direct retrieval (no embedding needed).

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| category | TEXT | -- | `'general'` | Topic category |
| question | TEXT | NOT NULL | -- | FAQ question |
| answer | TEXT | NOT NULL | -- | FAQ answer |
| keywords | TEXT | -- | `''` | Comma-separated search keywords |
| priority | INTEGER | -- | 0 | Display/retrieval priority |
| active | INTEGER | -- | 1 | Boolean: shown to users |
| created_by | TEXT | NOT NULL, FK -> users(id) | -- | Author |
| created_at | TEXT | -- | `datetime('now')` | Creation time |
| updated_at | TEXT | -- | `datetime('now')` | Last edited |

---

### schema-phase1.sql -- Memories + Agents (ALTER only)

This migration re-declares `user_memories` and `agents` with `IF NOT EXISTS` (no-ops if `schema.sql` was already applied) and adds a new column to `conversations`:

```sql
ALTER TABLE conversations ADD COLUMN agent_id TEXT DEFAULT NULL;
```

No new tables are created.

---

### schema-phase2.sql -- Research (1 table)

#### 19. research_reports

Deep research mode results. Multi-step analysis stored for retrieval.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| user_id | TEXT | NOT NULL, FK -> users(id) ON DELETE CASCADE | -- | Requester |
| conversation_id | TEXT | NOT NULL, FK -> conversations(id) ON DELETE CASCADE | -- | Source conversation |
| query | TEXT | NOT NULL | -- | Research query |
| status | TEXT | CHECK IN (`running`, `completed`, `failed`) | `'running'` | Pipeline state |
| steps_completed | INTEGER | -- | 0 | Progress counter |
| total_steps | INTEGER | -- | 5 | Expected step count |
| report | TEXT | -- | `''` | Final markdown report |
| sources | TEXT | -- | `'[]'` | JSON array of source URLs |
| created_at | TEXT | -- | `datetime('now')` | Start time |
| completed_at | TEXT | -- | NULL | Finish time |

---

### schema-phase4.sql -- Platform (7 tables)

#### 20. workflows

Workflow automation engine. Multi-step document/process generation.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| user_id | TEXT | NOT NULL, FK -> users(id) ON DELETE CASCADE | -- | Owner |
| name | TEXT | NOT NULL | -- | Workflow name |
| type | TEXT | NOT NULL | -- | Workflow type identifier |
| status | TEXT | CHECK IN (`draft`, `in_progress`, `completed`, `cancelled`) | `'draft'` | Lifecycle state |
| steps | TEXT | -- | `'[]'` | JSON array of step definitions |
| current_step | INTEGER | -- | 0 | Active step index |
| output | TEXT | -- | `''` | Final output content |
| created_at | TEXT | -- | `datetime('now')` | Creation time |
| completed_at | TEXT | -- | NULL | Completion time |
| scheduled_at | TEXT | -- | NULL | Future execution time |

---

#### 21. meetings

AI meeting assistant. Stores transcriptions, minutes, and action items.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| user_id | TEXT | NOT NULL, FK -> users(id) ON DELETE CASCADE | -- | Owner |
| title | TEXT | NOT NULL | -- | Meeting title |
| transcript | TEXT | -- | `''` | Full transcription |
| minutes | TEXT | -- | `''` | AI-generated minutes |
| action_items | TEXT | -- | `'[]'` | JSON array of action items |
| duration_seconds | INTEGER | -- | 0 | Recording duration |
| status | TEXT | CHECK IN (`processing`, `transcribed`, `completed`, `failed`) | `'processing'` | Pipeline state |
| created_at | TEXT | -- | `datetime('now')` | Upload time |

---

#### 22. spaces

Collaborative workspaces for team conversations.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| name | TEXT | NOT NULL | -- | Space name |
| description | TEXT | -- | `''` | Space description |
| owner_id | TEXT | NOT NULL, FK -> users(id) ON DELETE CASCADE | -- | Creator/owner |
| created_at | TEXT | -- | `datetime('now')` | Creation time |

---

#### 23. space_members

Space membership junction table with role-based access.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| space_id | TEXT | NOT NULL, FK -> spaces(id) ON DELETE CASCADE | -- | Space |
| user_id | TEXT | NOT NULL, FK -> users(id) ON DELETE CASCADE | -- | Member |
| role | TEXT | CHECK IN (`admin`, `member`, `viewer`) | `'member'` | Permission level |
| joined_at | TEXT | -- | `datetime('now')` | Join time |

**Primary key:** `(space_id, user_id)` -- composite.

---

#### 24. space_conversations

Conversations shared into collaborative spaces.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| space_id | TEXT | NOT NULL, FK -> spaces(id) ON DELETE CASCADE | -- | Target space |
| conversation_id | TEXT | NOT NULL, FK -> conversations(id) ON DELETE CASCADE | -- | Shared conversation |
| shared_by | TEXT | NOT NULL, FK -> users(id) ON DELETE CASCADE | -- | Who shared it |
| shared_at | TEXT | -- | `datetime('now')` | Share time |

**Primary key:** `(space_id, conversation_id)` -- composite.

---

#### 25. citizen_sessions

Public-facing citizen service bot. No authentication required.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| language | TEXT | -- | `'en'` | Session language |
| created_at | TEXT | -- | `datetime('now')` | Session start |
| last_active | TEXT | -- | `datetime('now')` | Last interaction |

---

#### 26. citizen_messages

Messages within citizen bot sessions.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| session_id | TEXT | NOT NULL, FK -> citizen_sessions(id) ON DELETE CASCADE | -- | Parent session |
| role | TEXT | NOT NULL, CHECK IN (`user`, `assistant`) | -- | Author type |
| content | TEXT | NOT NULL | -- | Message body |
| created_at | TEXT | -- | `datetime('now')` | Send time |

---

### schema-phase5.sql -- Audit + Productivity (2 tables)

#### 27. user_audit_log

User-level activity audit trail. Tracks all AI operations for compliance.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | -- | Auto-increment |
| user_id | TEXT | -- | -- | Acting user |
| user_email | TEXT | -- | -- | Denormalized for reports |
| department | TEXT | -- | -- | Denormalized for reports |
| action_type | TEXT | NOT NULL | -- | Action (chat, research, upload, etc.) |
| query_preview | TEXT | -- | -- | Truncated query text |
| model_used | TEXT | -- | -- | AI model identifier |
| ip_address | TEXT | -- | -- | Client IP |
| created_at | TEXT | -- | `datetime('now')` | Action time |

---

#### 28. productivity_stats

Per-user, per-day productivity metrics for the dashboard.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | -- | Auto-increment |
| user_id | INTEGER | NOT NULL | -- | User reference |
| stat_date | TEXT | NOT NULL | -- | Date (YYYY-MM-DD) |
| messages_sent | INTEGER | -- | 0 | Chat messages |
| documents_generated | INTEGER | -- | 0 | Docs exported |
| research_reports | INTEGER | -- | 0 | Deep research runs |
| analyses_run | INTEGER | -- | 0 | Analysis operations |
| meetings_processed | INTEGER | -- | 0 | Meetings transcribed |
| workflows_completed | INTEGER | -- | 0 | Workflows finished |
| estimated_minutes_saved | INTEGER | -- | 0 | Calculated time savings |

**Unique constraint:** `UNIQUE(user_id, stat_date)` -- one row per user per day.

---

### schema-phase5b.sql -- WhatsApp/SMS (2 tables)

#### 29. whatsapp_sessions

One session per phone number. Links to user account when verified.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| phone_number | TEXT | NOT NULL, UNIQUE | -- | E.164 format |
| user_id | TEXT | -- | -- | Linked AskOzzy account (optional) |
| last_message | TEXT | -- | -- | Last inbound message |
| last_response | TEXT | -- | -- | Last outbound response |
| message_count | INTEGER | -- | 0 | Total messages exchanged |
| created_at | TEXT | -- | `datetime('now')` | First contact |
| updated_at | TEXT | -- | `datetime('now')` | Last activity |

---

#### 30. whatsapp_messages

Individual WhatsApp/SMS messages for audit trail.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| session_id | TEXT | NOT NULL, FK -> whatsapp_sessions(id) | -- | Parent session |
| direction | TEXT | NOT NULL, CHECK IN (`inbound`, `outbound`) | -- | Message direction |
| content | TEXT | NOT NULL | -- | Message body |
| channel | TEXT | CHECK IN (`whatsapp`, `sms`) | `'whatsapp'` | Delivery channel |
| created_at | TEXT | -- | `datetime('now')` | Send/receive time |

---

### schema-ussd.sql -- USSD (1 table)

#### 31. ussd_sessions

USSD fallback sessions for feature phone users (`*713*OZZY#`).

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| session_id | TEXT | NOT NULL | -- | Telco session ID |
| phone_number | TEXT | NOT NULL | -- | Caller MSISDN |
| service_code | TEXT | -- | -- | USSD short code |
| current_menu | TEXT | -- | `'main'` | Active menu state |
| input_history | TEXT | -- | `''` | Accumulated user inputs |
| ai_response | TEXT | -- | -- | Last AI response |
| message_count | INTEGER | -- | 0 | Interaction count |
| created_at | TEXT | -- | `datetime('now')` | Session start |
| updated_at | TEXT | -- | `datetime('now')` | Last interaction |

---

### schema-affiliate.sql -- Affiliate (3 tables)

#### 32. affiliate_wallets

Wallet balance tracking for the 2-level affiliate program.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| user_id | TEXT | PRIMARY KEY | -- | FK to users (app-enforced) |
| balance | REAL | -- | 0.0 | Available balance (GHS) |
| total_earned | REAL | -- | 0.0 | Lifetime earnings |
| total_withdrawn | REAL | -- | 0.0 | Lifetime withdrawals |
| updated_at | TEXT | -- | `datetime('now')` | Last transaction |

---

#### 33. affiliate_transactions

Every commission credit and withdrawal debit. Immutable ledger.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| user_id | TEXT | NOT NULL | -- | Wallet owner |
| type | TEXT | NOT NULL, CHECK IN (`commission_l1`, `commission_l2`, `withdrawal`, `bonus`, `reward`) | -- | Transaction type |
| amount | REAL | NOT NULL | -- | GHS amount (positive for credits, negative for debits) |
| description | TEXT | -- | -- | Human-readable description |
| source_user_id | TEXT | -- | -- | Who triggered the commission |
| source_payment_id | TEXT | -- | -- | Paystack payment reference |
| created_at | TEXT | -- | `datetime('now')` | Transaction time |

**Commission rates:**
- L1 (direct referral): 30% of payment
- L2 (second level): 5% of payment
- Max per payment: 35%

---

#### 34. withdrawal_requests

Mobile Money (MoMo) withdrawal requests requiring admin approval.

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| id | TEXT | PRIMARY KEY | -- | UUID |
| user_id | TEXT | NOT NULL | -- | Requester |
| amount | REAL | NOT NULL | -- | Withdrawal amount (GHS) |
| momo_number | TEXT | NOT NULL | -- | Mobile Money number |
| momo_network | TEXT | -- | `'mtn'` | Network (`mtn`, `vodafone`, `airteltigo`) |
| status | TEXT | CHECK IN (`pending`, `approved`, `paid`, `rejected`) | `'pending'` | Approval state |
| admin_note | TEXT | -- | -- | Admin comment on decision |
| processed_at | TEXT | -- | -- | Approval/rejection time |
| created_at | TEXT | -- | `datetime('now')` | Request time |

---

## Indexes

### users

| Index Name | Columns | Notes |
|---|---|---|
| `idx_users_referral_code` | `referral_code` | Referral code lookup |
| `idx_users_org` | `org_id` | Organization membership filter |

### webauthn_credentials

| Index Name | Columns | Notes |
|---|---|---|
| `idx_webauthn_user` | `user_id` | User's credentials |
| `idx_webauthn_credential` | `credential_id` | Credential lookup |

### referrals

| Index Name | Columns | Notes |
|---|---|---|
| `idx_referrals_referrer` | `referrer_id, created_at DESC` | Referrer's history |

### folders

| Index Name | Columns | Notes |
|---|---|---|
| `idx_folders_user` | `user_id, sort_order` | User's folders sorted |

### conversations

| Index Name | Columns | Notes |
|---|---|---|
| `idx_conversations_user` | `user_id, updated_at DESC` | User's recent conversations |
| `idx_conversations_folder` | `folder_id` | Folder contents |
| `idx_conversations_pinned` | `user_id, pinned DESC, updated_at DESC` | Pinned-first listing |
| `idx_conversations_agent` | `agent_id` | Agent usage tracking |

### messages

| Index Name | Columns | Notes |
|---|---|---|
| `idx_messages_conversation` | `conversation_id, created_at ASC` | Chronological message retrieval |

### message_ratings

| Index Name | Columns | Notes |
|---|---|---|
| `idx_message_ratings_message` | `message_id` | Ratings per message |
| `idx_message_ratings_user` | `user_id` | User's rating history |

### usage_log

| Index Name | Columns | Notes |
|---|---|---|
| `idx_usage_user_date` | `user_id, date` | Daily usage aggregation |

### announcements

| Index Name | Columns | Notes |
|---|---|---|
| `idx_announcements_active` | `active, expires_at` | Active announcement queries |

### audit_log

| Index Name | Columns | Notes |
|---|---|---|
| `idx_audit_log_admin` | `admin_id, created_at DESC` | Admin's action history |
| `idx_audit_log_target` | `target_type, target_id` | Target entity lookup |

### moderation_flags

| Index Name | Columns | Notes |
|---|---|---|
| `idx_moderation_flags_status` | `status, created_at DESC` | Pending flags queue |

### organizations

| Index Name | Columns | Notes |
|---|---|---|
| `idx_organizations_owner` | `owner_id` | Owner's organizations |

### user_memories

| Index Name | Columns | Notes |
|---|---|---|
| `idx_user_memories_user` | `user_id, updated_at DESC` | Recent memories |
| `idx_user_memories_type` | `user_id, type` | Memories by type |

### agents

| Index Name | Columns | Notes |
|---|---|---|
| `idx_agents_active` | `active, name` | Active agent listing |
| `idx_agents_department` | `department` | Department filter |

### push_subscriptions

| Index Name | Columns | Notes |
|---|---|---|
| `idx_push_subs_user` | `user_id` | User's subscriptions |

### documents

| Index Name | Columns | Notes |
|---|---|---|
| `idx_documents_status` | `status` | Pipeline state filter |
| `idx_documents_category` | `category` | Category browsing |
| `idx_documents_uploaded_by` | `uploaded_by` | Uploader's documents |

### document_chunks

| Index Name | Columns | Notes |
|---|---|---|
| `idx_document_chunks_document` | `document_id, chunk_index` | Ordered chunk retrieval |
| `idx_document_chunks_vector` | `vector_id` | Vectorize ID lookup |

### knowledge_base

| Index Name | Columns | Notes |
|---|---|---|
| `idx_knowledge_base_category` | `category, active` | Active entries by category |
| `idx_knowledge_base_active` | `active, priority DESC` | Priority-sorted active entries |

### research_reports

| Index Name | Columns | Notes |
|---|---|---|
| `idx_research_reports_user` | `user_id` | User's reports |
| `idx_research_reports_conversation` | `conversation_id` | Conversation's reports |

### workflows

| Index Name | Columns | Notes |
|---|---|---|
| `idx_workflows_user` | `user_id` | User's workflows |

### meetings

| Index Name | Columns | Notes |
|---|---|---|
| `idx_meetings_user` | `user_id` | User's meetings |

### citizen_messages

| Index Name | Columns | Notes |
|---|---|---|
| `idx_citizen_messages_session` | `session_id` | Session message history |

### user_audit_log

| Index Name | Columns | Notes |
|---|---|---|
| `idx_user_audit_created` | `created_at` | Chronological audit queries |
| `idx_user_audit_user` | `user_id` | User's audit trail |
| `idx_user_audit_action` | `action_type` | Action type filter |
| `idx_user_audit_department` | `department` | Department compliance reports |

### productivity_stats

| Index Name | Columns | Notes |
|---|---|---|
| `idx_prod_user_date` | `user_id, stat_date` | User's daily stats |

### whatsapp_sessions

| Index Name | Columns | Notes |
|---|---|---|
| `idx_wa_phone` | `phone_number` | Phone number lookup |

### whatsapp_messages

| Index Name | Columns | Notes |
|---|---|---|
| `idx_wa_msg_session` | `session_id, created_at` | Session message history |

### ussd_sessions

| Index Name | Columns | Notes |
|---|---|---|
| `idx_ussd_session` | `session_id` | Telco session lookup |
| `idx_ussd_phone` | `phone_number` | Phone number lookup |

### affiliate_transactions

| Index Name | Columns | Notes |
|---|---|---|
| `idx_aff_tx_user` | `user_id, created_at DESC` | User's transaction history |

### withdrawal_requests

| Index Name | Columns | Notes |
|---|---|---|
| `idx_withdraw_status` | `status, created_at DESC` | Pending withdrawal queue |
| `idx_withdraw_user` | `user_id` | User's withdrawal history |

---

## Summary

| Schema File | Tables | Indexes | Purpose |
|---|---|---|---|
| `schema.sql` | 15 | 21 | Core: users, auth, conversations, messages, ratings, usage, announcements, audit, moderation, orgs, memories, agents, push |
| `schema-kb.sql` | 3 | 7 | Knowledge base: documents, chunks, FAQ |
| `schema-phase1.sql` | 0 (dupes + ALTER) | 0 (dupes) | Adds `agent_id` column to conversations |
| `schema-phase2.sql` | 1 | 2 | Deep research reports |
| `schema-phase4.sql` | 7 | 3 | Workflows, meetings, spaces, citizen bot |
| `schema-phase5.sql` | 2 | 5 | User audit log, productivity stats |
| `schema-phase5b.sql` | 2 | 2 | WhatsApp/SMS messaging |
| `schema-ussd.sql` | 1 | 2 | USSD fallback |
| `schema-affiliate.sql` | 3 | 3 | Affiliate wallets, transactions, withdrawals |
| **Total** | **34 CREATE statements (32 unique)** | **45** | -- |
