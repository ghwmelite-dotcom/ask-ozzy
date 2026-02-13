# Admin Portal Guide

The AskOzzy admin portal provides comprehensive platform management for super administrators. It is accessible at `/admin` (or `/admin.html`) and requires the `super_admin` role.

## Access

| Property       | Value                          |
|----------------|--------------------------------|
| URL            | `/admin` or `/admin.html`      |
| Required Role  | `super_admin`                  |
| Verification   | `GET /api/admin/verify` on load |

On page load, the portal calls `GET /api/admin/verify` to confirm the current session holds the `super_admin` role. Unauthorized users are redirected back to the main application.

---

## Overview

The admin portal provides **16 management tabs** organized in a sidebar navigation. Each tab loads its content dynamically via API calls. The frontend is built with ~1,920 lines of vanilla JavaScript (`admin.js`), using Chart.js for visualizations, modal dialogs for CRUD operations, and CSV export functionality throughout.

---

## Tab 1: Dashboard

**Purpose**: Platform overview at a glance.

**API**: `GET /api/admin/dashboard`

### Stats Displayed

| Metric              | Description                        |
|----------------------|------------------------------------|
| Total Users          | All registered users               |
| Total Conversations  | All conversations across users     |
| Total Messages       | All messages sent on the platform  |
| Active Users (Today) | Users who sent a message today     |
| New Users (7 Days)   | Users registered in the last week  |
| Messages Today       | Messages sent in the current day   |

### Charts

- **User Growth**: 7-day trend line chart showing new registrations per day.
- **Message Volume**: 7-day trend line chart showing messages sent per day.

---

## Tab 2: Users

**Purpose**: User management.

**API**: `GET /api/admin/users?search=&page=&limit=`

### Features

- **Search**: Filter users by name or email.
- **Paginated List**: Browse users across pages with configurable page size.
- **User Details**: View email, department, tier, role, referral code, `created_at`, and `last_login`.
- **Change Tier**: Reassign a user to `free`, `starter`, `professional`, or `enterprise`.
- **Change Role**: Reassign a user to `civil_servant`, `dept_admin`, or `super_admin`.
- **Delete User**: Permanently remove a user account.
- **View Memories**: Inspect stored user memories (AI personalization data).
- **Promote to Admin**: One-click promotion to admin role.

### User Detail Fields

| Field         | Description                       |
|---------------|-----------------------------------|
| email         | User email address                |
| full_name     | Display name                      |
| department    | Government department             |
| tier          | Subscription tier                 |
| role          | Platform role                     |
| referral_code | Unique referral code              |
| created_at    | Account creation timestamp        |
| last_login    | Most recent login timestamp       |

---

## Tab 3: Conversations

**Purpose**: View and moderate all conversations.

**API**: `GET /api/admin/conversations`

### Features

- Browse all conversations across all users.
- View full conversation message history.
- Delete conversations.
- See metadata: model used, template used, message count.

---

## Tab 4: Analytics

**Purpose**: Platform usage analytics.

**API**: `GET /api/admin/analytics`

### Stats

| Metric             | Description                            |
|--------------------|----------------------------------------|
| Messages per Day   | Daily message volume over time         |
| Active Users/Day   | Daily active user count                |
| Popular Models     | Most-used AI models                    |
| Popular Templates  | Most-used GoG prompt templates         |
| Top Users          | Users ranked by usage volume           |

### Export

- `GET /api/admin/export/analytics` returns analytics data as a CSV file.

---

## Tab 5: Referrals

**Purpose**: Referral program analytics.

**API**: `GET /api/admin/referrals`

### Stats

| Metric                   | Description                              |
|--------------------------|------------------------------------------|
| Total Referrals          | All-time referral count                  |
| Top Referrers            | Users with the most successful referrals |
| Referral Conversion Rate | Percentage of referrals that sign up     |
| Recent Referrals         | Latest referral activity list            |

---

## Tab 6: System

**Purpose**: System configuration and health.

### Features

- **Rate Limit Configuration**: Display current rate limiting rules.
- **Organization Management**: Manage organizational units.
- **Bulk User Creation**: Create multiple users at once.
- **Export Users CSV**: Download the full user list as CSV.
- **Platform Version Info**: Display current AskOzzy version and build information.

---

## Tab 7: Announcements

**Purpose**: Broadcast messages to all users.

**API**: CRUD via `/api/admin/announcements`

### Features

- **Create Announcement**: Set title, content, and type.
- **Announcement Types**: `info`, `warning`, `success`, `maintenance`.
- **Dismissible Flag**: Allow users to dismiss the announcement.
- **Expiry Date**: Set an automatic expiration.
- **Toggle Active/Inactive**: Enable or disable without deleting.
- **Edit and Delete**: Full CRUD lifecycle.

### Announcement Fields

| Field       | Type    | Description                                 |
|-------------|---------|---------------------------------------------|
| title       | string  | Announcement headline                       |
| content     | string  | Full announcement body                      |
| type        | enum    | `info` / `warning` / `success` / `maintenance` |
| dismissible | boolean | Whether users can dismiss it                |
| expires_at  | date    | Auto-expiry timestamp (optional)            |
| active      | boolean | Whether the announcement is currently shown |

---

## Tab 8: Moderation

**Purpose**: Content moderation and review.

**API**: `GET /api/admin/moderation`, `PATCH /api/admin/moderation/:id`

### Features

- **List Flagged Content**: View items by status (`pending`, `reviewed`, `dismissed`).
- **Review Flags**: Mark flagged content as reviewed or dismissed.
- **View Context**: See the flagged message content and its surrounding conversation context.
- **Moderation Statistics**: Overview of flagging activity and resolution rates.

---

## Tab 9: Audit Log

**Purpose**: Admin action audit trail.

**API**: `GET /api/admin/audit` (with filters)

### Features

- **Filter by Action Type**: Narrow results to specific admin actions.
- **Filter by Date Range**: Set start and end dates for the log window.
- **Filter by User**: View actions performed by or affecting a specific user.
- **Audit Entries**: Each entry records who did what, when, and to whom.
- **Audit Statistics**: Actions per day, top admins by activity.
- **Export**: Download the audit log as CSV.
- **Enhanced Search**: Full-text search across audit entries.

### Audit Entry Fields

| Field      | Description                          |
|------------|--------------------------------------|
| admin_id   | Admin who performed the action       |
| action     | Type of action taken                 |
| target_id  | User or resource affected            |
| details    | Additional context or changed values |
| created_at | Timestamp of the action              |

---

## Tab 10: Knowledge Base

**Purpose**: RAG document and FAQ management.

**API**: Multiple KB endpoints under `/api/admin/knowledge/`

### Features

#### Document Management

- Upload documents for RAG processing (text content, URLs).
- Scrape URLs for content extraction.
- View document processing status: `processing`, `ready`, `error`.
- Delete documents and their associated vector chunks.

#### FAQ Management

- Create, edit, and delete FAQ entries.
- FAQs are returned as direct answers when matched.

#### Statistics

| Metric       | Description                         |
|--------------|-------------------------------------|
| Total Docs   | Number of uploaded documents        |
| Total Chunks | Number of vectorized text chunks    |
| FAQ Entries  | Number of FAQ question-answer pairs |

---

## Tab 11: Bulk Import

**Purpose**: Mass user onboarding.

**API**: `POST /api/admin/bulk-import`

### Features

- **CSV Upload**: Upload a CSV file to create multiple users at once.
- **Auto-Generated Access Codes**: Each imported user receives a unique access code.

### CSV Fields

| Column      | Required | Description                  |
|-------------|----------|------------------------------|
| email       | Yes      | User email address           |
| full_name   | Yes      | User display name            |
| department  | No       | Government department        |
| tier        | No       | Subscription tier (default: `free`) |
| role        | No       | Platform role (default: `civil_servant`) |

### Results Summary

After import, a summary is displayed showing:

- **Created**: Number of users successfully created.
- **Skipped**: Number of users skipped (e.g., duplicate email).
- **Errors**: Number of rows that failed with error details.

---

## Tab 12: Document Training

**Purpose**: Advanced knowledge base management.

**API**: `POST /api/admin/knowledge/bulk`, `GET /api/admin/knowledge/stats`

### Features

- **Bulk Upload**: Upload multiple knowledge documents at once.
- **Training Statistics**: View document count, chunk count, and embedding generation status.
- **Document List**: Browse documents with filtering by category.

---

## Tab 13: AI Agents

**Purpose**: Manage custom AI agents.

**API**: CRUD via `/api/admin/agents`

### Features

- **List Agents**: View all agents (active and inactive).
- **Create Agent**: Define name, description, system prompt, icon, department, and knowledge category.
- **Edit Agent**: Modify any agent property.
- **Toggle Active/Inactive**: Enable or disable agents without deleting.
- **Delete Agent**: Permanently remove an agent.
- **Seed Defaults**: One-click button to create 25 pre-configured GoG agents.

### Agent Fields

| Field              | Description                                  |
|--------------------|----------------------------------------------|
| name               | Agent display name                           |
| description        | Short description of what the agent does     |
| system_prompt      | System prompt defining agent behavior        |
| icon               | Emoji or icon identifier                     |
| department         | Target government department (optional)      |
| knowledge_category | KB category the agent draws from (optional)  |
| active             | Whether the agent is available to users      |

---

## Tab 14: Productivity

**Purpose**: Platform productivity metrics.

**API**: `GET /api/admin/productivity`

### Stats

| Metric              | Description                                  |
|----------------------|----------------------------------------------|
| Messages Sent        | Platform-wide total messages                 |
| Documents Generated  | Total documents created from chat            |
| Research Reports     | Total research reports produced              |
| Hours Saved Estimate | Estimated hours saved through AI assistance  |
| Per-Department       | Breakdown of all metrics by department       |
| Top Productive Users | Users ranked by productivity output          |

---

## Tab 15: USSD

**Purpose**: USSD service management.

**API**: `GET /api/admin/ussd/stats`, `GET /api/admin/ussd/config`, `PUT /api/admin/ussd/config`

### Features

#### Session Statistics

| Metric          | Description                        |
|-----------------|------------------------------------|
| Total Sessions  | All-time USSD session count        |
| Unique Numbers  | Distinct phone numbers served      |
| Total Messages  | Messages exchanged via USSD        |

#### Configuration

| Setting         | Description                             |
|-----------------|-----------------------------------------|
| Service Code    | USSD short code (e.g., `*713*OZZY#`)   |
| Welcome Message | Initial greeting shown to callers       |
| AI Model        | Model used for USSD AI responses        |

#### Testing

- Test USSD interactions directly from the admin panel by simulating a session.

---

## Tab 16: Messaging

**Purpose**: WhatsApp/SMS bot management.

**API**: `GET /api/admin/messaging/config`, `GET /api/admin/messaging/stats`

### Features

#### Session Statistics

- WhatsApp session count and message volume.
- SMS session count and message volume.

#### Configuration

| Setting          | Description                              |
|------------------|------------------------------------------|
| API Keys         | Third-party messaging API credentials    |
| Webhook URLs     | Inbound message webhook endpoints        |
| Welcome Messages | Initial greeting for WhatsApp/SMS users  |

#### Operations

- View session messages across WhatsApp and SMS channels.
- Test messaging interactions directly from the admin panel.

---

## Admin JavaScript Architecture

The admin portal frontend (`public/js/admin.js`) is approximately 1,920 lines of vanilla JavaScript with the following architecture:

| Component             | Description                                      |
|-----------------------|--------------------------------------------------|
| Tab Switching         | Sidebar navigation triggers dynamic content load |
| API Integration       | All calls authenticated with admin session token  |
| Chart.js              | Used for analytics and dashboard visualizations  |
| CSV Export            | Client-side CSV generation and download          |
| Modal Dialogs         | Used for create, edit, and confirmation actions   |
| Error Handling        | Toast notifications for success and error states |
| Dynamic Content       | Each tab fetches and renders data on activation  |
