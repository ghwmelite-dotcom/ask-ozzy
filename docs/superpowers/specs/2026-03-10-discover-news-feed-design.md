# AskOzzy Discover — Global News Feed

**Date:** 2026-03-10
**Status:** Approved

## Overview

A dedicated Discover screen that displays trending global news from top media outlets across 8 categories. Users can browse headlines, read originals, or tap "Discuss with Ozzy" to open an AI-powered conversation about any article.

## Data Pipeline

### Sources

1. **GNews API** (primary) — 7 built-in topic endpoints + 1 keyword search for Government & Politics
2. **RSS feeds** (supplementary/fallback) — BBC, Reuters, Al Jazeera, AP News, CNN

### Refresh Schedule

- Cloudflare Workers cron trigger every 2 hours
- 8 API calls per refresh × 12 refreshes/day = 96 requests/day (within GNews 100/day free limit)
- Stale articles (>48 hours old) purged on each refresh

### Categories

| Category | Source | Method |
|----------|--------|--------|
| World | GNews | `/top-headlines?topic=world` |
| Government & Politics | GNews | `/search?q=government OR politics OR policy OR parliament OR legislation` |
| Business | GNews | `/top-headlines?topic=business` |
| Technology | GNews | `/top-headlines?topic=technology` |
| Science | GNews | `/top-headlines?topic=science` |
| Health | GNews | `/top-headlines?topic=health` |
| Sports | GNews | `/top-headlines?topic=sports` |
| Entertainment | GNews | `/top-headlines?topic=entertainment` |

## Database

### `discover_articles` table

```sql
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

CREATE INDEX idx_discover_category ON discover_articles(category);
CREATE INDEX idx_discover_published ON discover_articles(published_at DESC);
```

## API Endpoints

### `GET /api/discover`

Returns cached articles from D1. Public endpoint (auth optional).

**Query params:**
- `category` (optional) — Filter by category. Omit for all.
- `page` (optional, default 1) — Pagination.
- `limit` (optional, default 20) — Articles per page (max 50).

**Response:**
```json
{
  "articles": [
    {
      "id": "uuid",
      "title": "Headline text",
      "description": "Brief summary...",
      "source_name": "BBC News",
      "source_url": "https://bbc.com",
      "article_url": "https://bbc.com/article/...",
      "image_url": "https://...",
      "category": "world",
      "published_at": "2026-03-10T12:00:00Z"
    }
  ],
  "total": 140,
  "page": 1,
  "hasMore": true
}
```

### `POST /api/discover/discuss`

Creates a new conversation pre-loaded with article context. Requires auth.

**Request body:**
```json
{
  "articleId": "uuid"
}
```

**Response:**
```json
{
  "conversationId": "uuid",
  "title": "Discussing: Article Headline"
}
```

**Behavior:**
1. Fetches article from `discover_articles` by ID
2. Creates a new conversation with title `"Discussing: [headline]"`
3. Stores first message with article context (headline, summary, source, URL)
4. Returns conversation ID for frontend navigation

## Frontend

### Navigation

- New "Discover" icon (newspaper icon) added to the header bar, next to existing nav elements
- Icon navigates to the Discover screen (new top-level screen alongside Welcome and Chat)

### Discover Screen Layout

```
┌─────────────────────────────────────────────┐
│  Header: [☰] [Logo]  [🗞️ Discover] [⚙️]    │
├─────────────────────────────────────────────┤
│  Category Tabs:                             │
│  [All] [World] [Gov & Politics] [Business]  │
│  [Technology] [Science] [Health] [Sports]   │
│  [Entertainment]                            │
├─────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ 📰 Image │  │ 📰 Image │  │ 📰 Image │  │
│  │ Headline │  │ Headline │  │ Headline │  │
│  │ Source·2h│  │ Source·1h│  │ Source·3h│  │
│  │ [Read]   │  │ [Read]   │  │ [Read]   │  │
│  │ [Discuss]│  │ [Discuss]│  │ [Discuss]│  │
│  └──────────┘  └──────────┘  └──────────┘  │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ 📰 Image │  │ 📰 Image │  │ 📰 Image │  │
│  │ ...      │  │ ...      │  │ ...      │  │
│  └──────────┘  └──────────┘  └──────────┘  │
│                                             │
│           [Load More Articles]              │
└─────────────────────────────────────────────┘
```

### Card Design

Each news card displays:
- **Image thumbnail** (with fallback placeholder if no image)
- **Headline** (truncated to 2 lines)
- **Source name + relative time** (e.g., "Reuters · 2h ago")
- **Category badge** (color-coded pill)
- **Two action buttons:**
  - "Read Original" — opens `article_url` in new tab
  - "Discuss with Ozzy" — calls `POST /api/discover/discuss`, navigates to chat

### Responsive Layout

- Desktop: 3-column grid
- Tablet: 2-column grid
- Mobile: 1-column stack with horizontal category scroll

### Theme Support

- Inherits existing AskOzzy light/dark theme
- Cards use existing CSS variables for backgrounds, text, borders

### Loading States

- Skeleton cards while fetching
- Error state with retry button if fetch fails

## "Discuss with Ozzy" Flow

1. User clicks "Discuss with Ozzy" on a card
2. Frontend calls `POST /api/discover/discuss` with `articleId`
3. Backend creates conversation titled `"Discussing: [Headline]"`
4. Backend inserts first message with system context:
   ```
   📰 **[Headline]**
   *Source: [Source Name] · [Published Date]*

   [Description/Summary]

   🔗 [Read full article]([article_url])

   I've read this article. What would you like to know or discuss about it?
   ```
5. Frontend navigates to chat screen with the new conversation
6. User can ask questions, request deeper analysis, get related context, etc.

## Cron Job

### Scheduled Handler

Registered in `wrangler.jsonc` as a cron trigger:
```jsonc
"triggers": {
  "crons": ["0 */2 * * *"]  // Every 2 hours
}
```

### Fetch Logic

1. For each of 7 built-in topics: call `GET https://gnews.io/api/v4/top-headlines?topic={topic}&lang=en&max=20&apikey={key}`
2. For Government & Politics: call `GET https://gnews.io/api/v4/search?q=government OR politics OR policy OR parliament OR legislation&lang=en&max=20&apikey={key}`
3. Parse responses, generate UUIDs for each article
4. Upsert into `discover_articles` (skip duplicates by `article_url`)
5. Delete articles where `published_at < datetime('now', '-48 hours')`

### RSS Fallback

If GNews API fails or returns empty for a category:
1. Parse RSS feeds from backup sources (BBC, Reuters, AP, Al Jazeera, CNN)
2. Map RSS items to same schema
3. Insert as supplementary articles

## Security

- GNews API key stored as a Cloudflare Worker secret (not in code)
- `GET /api/discover` is public (no auth required) so all users see news
- `POST /api/discover/discuss` requires auth (creates a conversation)
- No full article content is scraped or stored — only headlines, descriptions, and links
