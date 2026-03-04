# Design: Institutional Admin Portal & Multi-Tenancy

**Date:** 2026-03-03

## Summary

Add multi-tenancy support to Ask Ozzy so any organisation (government, university, company, NGO) can onboard with their own admin portal, manage members, and get org-scoped analytics. A separate org admin app (`/org-admin.html`) connects to the existing super admin portal for global oversight.

## Key Decisions

- **Approach:** Separate org admin app with own API routes, shared D1 database
- **Institution types:** Fully generic — any organisation
- **Org admin powers:** User management + analytics + org KB + org agents + org announcements
- **Data isolation:** Full — org admins see only their own org's data
- **Billing:** Hybrid — org sponsors seats, individuals can self-upgrade beyond org tier
- **Registration:** Split into Individual vs Organisation paths
- **Org pricing:** Per-seat with volume discounts

---

## 1. Database Schema Changes

### Expand `organizations` table

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `id` | TEXT PK | UUID | Generated |
| `name` | TEXT NOT NULL | Organisation display name | Required |
| `slug` | TEXT UNIQUE | URL-friendly identifier | Required |
| `owner_id` | TEXT FK | User who created the org | Required |
| `tier` | TEXT | Org subscription tier | `free` |
| `max_seats` | INTEGER | Seat limit for org-sponsored users | 10 |
| `used_seats` | INTEGER | Current count of org members | 0 |
| `sector` | TEXT | Industry/sector (government, education, private, ngo) | NULL |
| `logo_url` | TEXT | Optional org logo | NULL |
| `domain` | TEXT | Email domain for auto-join (e.g. "ug.edu.gh") | NULL |
| `settings` | TEXT | JSON blob for org-level config | '{}' |
| `created_at` | TEXT | Timestamp | datetime('now') |

### New `org_invites` table

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `id` | TEXT PK | UUID | Generated |
| `org_id` | TEXT FK | Which org | Required |
| `email` | TEXT | Invited email | Required |
| `role` | TEXT | Role to assign | `member` |
| `tier` | TEXT | Tier sponsored by org | NULL |
| `invited_by` | TEXT FK | Who invited | Required |
| `status` | TEXT | pending/accepted/expired | `pending` |
| `created_at` | TEXT | Timestamp | datetime('now') |

### New `org_pricing` table

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `id` | TEXT PK | UUID | Generated |
| `org_id` | TEXT FK | Organisation | Required |
| `plan` | TEXT | starter/business/custom | Required |
| `seats_purchased` | INTEGER | Seats in current plan | Required |
| `price_per_seat` | REAL | Effective price after discount | Required |
| `billing_cycle` | TEXT | monthly/annual | `monthly` |
| `billing_started_at` | TEXT | When billing began | datetime('now') |
| `billing_expires_at` | TEXT | Current period expiry | NULL |
| `custom_terms` | TEXT | JSON for custom plan details | NULL |

### Users table changes

- `org_id` — enforce FK constraint to organizations
- Add `org_role` TEXT DEFAULT NULL — `member` or `org_admin` (NULL = not in an org)
- Existing `tier` field: effective tier = MAX(org_sponsored_tier, user_personal_tier)

---

## 2. Organisation Pricing

### Tiers

| Org Tier | Per-Seat Price (Monthly) | Members Get | Includes |
|----------|-------------------------|-------------|----------|
| Org Starter | GHS 50/seat | Professional access | 10 AI models, 200 msgs/day |
| Org Business | GHS 85/seat | Enterprise access | All 14 models, unlimited msgs, org KB |
| Org Custom | Contact sales | Custom | Custom models, SLA, dedicated support |

### Volume Discounts

| Seats | Discount | Starter effective | Business effective |
|-------|----------|-------------------|-------------------|
| 1-10 | 0% | GHS 50/seat | GHS 85/seat |
| 11-50 | 15% off | GHS 42.50/seat | GHS 72.25/seat |
| 51-200 | 25% off | GHS 37.50/seat | GHS 63.75/seat |
| 200+ | 35% off | GHS 32.50/seat | GHS 55.25/seat |

### Hybrid Billing Logic

```
effective_tier = MAX(org_sponsored_tier, user_personal_tier)
```

- Org on Professional x 50 seats: members get Professional by default
- Member self-upgrades to Enterprise: they keep Enterprise
- Org downgrades: members without personal upgrade fall to free
- Seat count tracks org-sponsored users only

---

## 3. Registration Flow

### Path A: Individual (existing, mostly unchanged)
- Email, name, department, user_type
- Gets personal free tier
- Can join an org later via invite or domain auto-match

### Path B: Organisation
1. Org details: name, slug, domain (optional), sector
2. Admin account: email, name (becomes org_admin + owner)
3. Plan selection: org tier + seat count
4. Invite members: optional bulk invite via email/CSV

### Joining an existing org
- Via invite link/email from org admin
- Via email domain auto-match (if org has domain set)

---

## 4. Roles & Permissions

| Role | Scope | Access |
|------|-------|--------|
| `civil_servant` / `member` | Own data | Chat, profile, own conversations |
| `org_admin` | Organisation | Org members, org analytics, org KB, org agents, org invites, org announcements, org billing view |
| `dept_admin` | Department | Department users (read-only), dept stats |
| `super_admin` | Global | Everything + org management, global config |

### Org admin CANNOT:
- See other orgs' data
- Access global moderation, USSD, messaging config
- Change org tier/billing (super admin does this)
- Access audit logs outside their org
- Delete users outside their org

---

## 5. API Routes

### New: `/api/org-admin/*` (orgAdminMiddleware)

```
GET    /api/org-admin/verify                — Verify org_admin role, return org info
GET    /api/org-admin/dashboard             — Org dashboard stats
GET    /api/org-admin/users                 — List org members (paginated, searchable)
POST   /api/org-admin/users/invite          — Invite user by email
DELETE /api/org-admin/users/:id             — Remove member from org
PATCH  /api/org-admin/users/:id/role        — Change member's org_role
GET    /api/org-admin/analytics             — Org-scoped analytics
GET    /api/org-admin/export/users          — Export org users CSV
GET    /api/org-admin/announcements         — List org announcements
POST   /api/org-admin/announcements         — Create org announcement
PATCH  /api/org-admin/announcements/:id     — Edit org announcement
DELETE /api/org-admin/announcements/:id     — Delete org announcement
GET    /api/org-admin/agents                — List org agents
POST   /api/org-admin/agents               — Create org agent
PATCH  /api/org-admin/agents/:id           — Edit org agent
DELETE /api/org-admin/agents/:id           — Delete org agent
GET    /api/org-admin/kb/stats             — Org KB stats
POST   /api/org-admin/kb/documents         — Upload org KB document
GET    /api/org-admin/billing              — Org billing/seat info
PATCH  /api/org-admin/settings             — Update org settings
```

### New: Registration endpoints

```
POST   /api/auth/register/individual       — Individual registration (existing, renamed)
POST   /api/auth/register/organisation     — Org registration (new)
POST   /api/auth/invite/accept/:id         — Accept org invite
GET    /api/auth/domain-check/:email       — Check if email domain matches an org
```

### Super admin additions

```
GET    /api/admin/organizations            — List all orgs (enhanced)
POST   /api/admin/organizations            — Create org
PATCH  /api/admin/organizations/:id        — Edit org (tier, seats, settings)
DELETE /api/admin/organizations/:id        — Delete org
GET    /api/admin/organizations/:id/users  — View org members
PATCH  /api/admin/organizations/:id/pricing — Set org pricing/discounts
```

---

## 6. New Middleware

```typescript
orgAdminMiddleware(c, next)
  - Verifies Bearer token
  - Checks user.org_role === 'org_admin'
  - Sets c.orgId from user.org_id
  - All downstream queries filter by org_id
  - Returns 403 if not org_admin
```

---

## 7. Frontend

### New files
- `public/org-admin.html`
- `public/js/org-admin.js`
- `public/css/org-admin.css`

### Org Admin Portal Tabs (8)

| Tab | Purpose |
|-----|---------|
| Dashboard | Org stats: members, active users, messages today, seat usage |
| Members | List/invite/remove members, change org roles, bulk invite |
| Analytics | Org usage charts: messages/day, active users, popular models |
| Knowledge Base | Upload org-specific documents, manage FAQs |
| AI Agents | Create/manage org-scoped custom agents |
| Announcements | Org-wide announcements |
| Billing | Seat usage vs limit, org tier, volume discount, next renewal |
| Settings | Org name, logo, domain auto-join, sector |

### Registration page update
- Add organisation/individual toggle on existing registration page
- Organisation path: multi-step form (org details -> admin account -> plan -> invites)

### Super admin enhancement
- Replace minimal "Organisations" section with full org management tab

---

## 8. Data Isolation

All org-scoped queries include `WHERE org_id = ?`:
- Users: `WHERE org_id = :orgId`
- Conversations: `WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id IN (SELECT id FROM users WHERE org_id = :orgId))`
- Analytics: scoped to org users
- Knowledge base: org-specific documents tagged with `org_id`
- AI agents: `WHERE org_id = :orgId`
- Announcements: `WHERE org_id = :orgId`

Super admin bypasses all org_id filters.
