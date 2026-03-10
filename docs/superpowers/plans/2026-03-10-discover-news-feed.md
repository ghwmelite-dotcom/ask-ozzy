# Discover News Feed — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Discover screen that displays trending global news from GNews API + RSS feeds, with "Discuss with Ozzy" to chat about any article.

**Architecture:** New D1 table `discover_articles` cached by a 2-hour cron job that fetches 8 categories from GNews API (7 topics + 1 keyword search). Frontend adds a third top-level screen alongside Welcome and Chat, navigated via a header icon. "Discuss with Ozzy" creates a conversation pre-loaded with article context.

**Tech Stack:** Cloudflare Workers (Hono), D1, vanilla JS, CSS custom properties

**Spec:** `docs/superpowers/specs/2026-03-10-discover-news-feed-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `schema-discover.sql` | Create | D1 migration: `discover_articles` table + indexes |
| `src/types.ts` | Modify | Add `GNEWS_API_KEY` to `Env` type |
| `src/index.ts` | Modify | Add `GET /api/discover`, `POST /api/discover/discuss`, cron fetch logic |
| `public/index.html` | Modify | Add Discover header icon + Discover screen container |
| `public/js/app.js` | Modify | Add Discover screen logic, card rendering, screen switching |
| `public/css/app.css` | Modify | Add Discover screen styles (cards, grid, tabs, skeleton) |
| `wrangler.jsonc` | Modify | Update cron schedule from daily to every 2 hours |

---

## Chunk 1: Database + Backend API

### Task 1: Database Migration

**Files:**
- Create: `schema-discover.sql`

- [ ] **Step 1: Create the migration file**

```sql
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
```

- [ ] **Step 2: Run migration against D1**

```bash
npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-discover.sql
```

Expected: "Executed N commands successfully"

- [ ] **Step 3: Commit**

```bash
git add schema-discover.sql
git commit -m "feat: add discover_articles table for news feed"
```

---

### Task 2: Add GNEWS_API_KEY to Env Type

**Files:**
- Modify: `src/types.ts:3-12`

- [ ] **Step 1: Add GNEWS_API_KEY to Env**

In `src/types.ts`, add `GNEWS_API_KEY: string;` to the `Env` type after `BOOTSTRAP_SECRET`:

```typescript
export type Env = {
  AI: Ai;
  DB: D1Database;
  SESSIONS: KVNamespace;
  VECTORIZE: VectorizeIndex;
  JWT_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  PAYSTACK_SECRET: string;
  BOOTSTRAP_SECRET?: string;
  GNEWS_API_KEY: string;
};
```

- [ ] **Step 2: Set the secret in Cloudflare**

```bash
npx wrangler secret put GNEWS_API_KEY
```

When prompted, enter: `7cb1fc9aaadbba08f9b2a65d42cadc75`

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add GNEWS_API_KEY to Env type"
```

---

### Task 3: GET /api/discover Endpoint

**Files:**
- Modify: `src/index.ts` (insert before the `export default` block at line ~11550)

- [ ] **Step 1: Add the discover GET endpoint**

Insert this block before the `export default {` line in `src/index.ts`:

```typescript
// ─── Discover News Feed ─────────────────────────────────────────────

app.get("/api/discover", async (c) => {
  const category = c.req.query("category");
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "20")));
  const offset = (page - 1) * limit;

  let query = "SELECT * FROM discover_articles";
  let countQuery = "SELECT COUNT(*) as total FROM discover_articles";
  const params: string[] = [];

  if (category && category !== "all") {
    query += " WHERE category = ?";
    countQuery += " WHERE category = ?";
    params.push(category);
  }

  query += " ORDER BY published_at DESC LIMIT ? OFFSET ?";

  const countParams = [...params];
  params.push(String(limit), String(offset));

  const [articles, countResult] = await Promise.all([
    c.env.DB.prepare(query).bind(...params).all(),
    c.env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>(),
  ]);

  const total = countResult?.total || 0;

  return c.json({
    articles: articles.results,
    total,
    page,
    hasMore: offset + limit < total,
  });
});
```

- [ ] **Step 2: Verify it builds**

```bash
npx wrangler dev --test-scheduled
```

Expected: Worker starts without TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add GET /api/discover endpoint"
```

---

### Task 4: POST /api/discover/discuss Endpoint

**Files:**
- Modify: `src/index.ts` (insert after the GET /api/discover route)

- [ ] **Step 1: Add the discuss endpoint**

Insert immediately after the `GET /api/discover` handler:

```typescript
app.post("/api/discover/discuss", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { articleId } = await c.req.json();

  if (!articleId) {
    return c.json({ error: "articleId is required" }, 400);
  }

  const article = await c.env.DB.prepare(
    "SELECT * FROM discover_articles WHERE id = ?"
  ).bind(articleId).first();

  if (!article) {
    return c.json({ error: "Article not found" }, 404);
  }

  const convoId = generateId();
  const title = `Discussing: ${(article.title as string).substring(0, 80)}`;

  await c.env.DB.prepare(
    "INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)"
  ).bind(convoId, userId, title).run();

  // Insert article context as the first assistant message
  const contextMessage = `📰 **${article.title}**\n*Source: ${article.source_name} · ${article.published_at}*\n\n${article.description || ""}\n\n🔗 [Read full article](${article.article_url})\n\nI've read this article summary. What would you like to know or discuss about it?`;

  const msgId = generateId();
  await c.env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'assistant', ?)"
  ).bind(msgId, convoId, contextMessage).run();

  return c.json({ conversationId: convoId, title });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: add POST /api/discover/discuss endpoint"
```

---

### Task 5: Cron Job — Fetch News from GNews API

**Files:**
- Modify: `src/index.ts` (inside the `scheduled()` handler, after existing cron logic at line ~11567)
- Modify: `wrangler.jsonc` (update cron schedule)

- [ ] **Step 1: Update wrangler.jsonc cron to run every 2 hours**

Change the `triggers.crons` value from `["0 2 * * *"]` to `["0 */2 * * *"]`:

```jsonc
"triggers": {
  "crons": ["0 */2 * * *"]
}
```

- [ ] **Step 2: Add the news fetch logic to the scheduled handler**

In `src/index.ts`, inside the `async scheduled()` handler, after the existing exam_seasons block (after line ~11567's `} catch {}`), add:

```typescript
    // ─── Discover: Fetch news from GNews API ────────────────────────
    try {
      const GNEWS_BASE = "https://gnews.io/api/v4";
      const apiKey = env.GNEWS_API_KEY;

      // 7 built-in topics + 1 keyword search
      const topicFetches = [
        { category: "world", url: `${GNEWS_BASE}/top-headlines?topic=world&lang=en&max=20&apikey=${apiKey}` },
        { category: "business", url: `${GNEWS_BASE}/top-headlines?topic=business&lang=en&max=20&apikey=${apiKey}` },
        { category: "technology", url: `${GNEWS_BASE}/top-headlines?topic=technology&lang=en&max=20&apikey=${apiKey}` },
        { category: "science", url: `${GNEWS_BASE}/top-headlines?topic=science&lang=en&max=20&apikey=${apiKey}` },
        { category: "health", url: `${GNEWS_BASE}/top-headlines?topic=health&lang=en&max=20&apikey=${apiKey}` },
        { category: "sports", url: `${GNEWS_BASE}/top-headlines?topic=sports&lang=en&max=20&apikey=${apiKey}` },
        { category: "entertainment", url: `${GNEWS_BASE}/top-headlines?topic=entertainment&lang=en&max=20&apikey=${apiKey}` },
        { category: "government", url: `${GNEWS_BASE}/search?q=government OR politics OR policy OR parliament OR legislation&lang=en&max=20&apikey=${apiKey}` },
      ];

      for (const { category, url } of topicFetches) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const data = await res.json() as { articles?: Array<{ title: string; description: string; url: string; image: string; publishedAt: string; source: { name: string; url: string } }> };
          if (!data.articles) continue;

          for (const article of data.articles) {
            const id = generateId();
            try {
              await env.DB.prepare(
                `INSERT OR IGNORE INTO discover_articles (id, title, description, source_name, source_url, article_url, image_url, category, published_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(
                id,
                article.title,
                article.description || "",
                article.source?.name || "Unknown",
                article.source?.url || "",
                article.url,
                article.image || "",
                category,
                article.publishedAt || new Date().toISOString()
              ).run();
            } catch {
              // Duplicate article_url — skip silently
            }
          }
        } catch {
          console.error(`Discover: failed to fetch ${category}`);
        }
      }

      // Purge articles older than 48 hours
      await env.DB.prepare(
        "DELETE FROM discover_articles WHERE published_at < datetime('now', '-48 hours')"
      ).run();
    } catch (err: any) {
      console.error("Discover cron error:", err?.message);
    }
```

- [ ] **Step 3: Verify it builds**

```bash
npx wrangler dev --test-scheduled
```

Expected: No TypeScript errors. Can trigger scheduled event via local dashboard.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts wrangler.jsonc
git commit -m "feat: add discover news cron job (GNews API, 8 categories, 2h refresh)"
```

---

## Chunk 2: Update CSP Header for News Images

### Task 6: Allow External Images in CSP

**Files:**
- Modify: `src/index.ts:39` (Content-Security-Policy header)

- [ ] **Step 1: Update img-src directive**

The current CSP has `img-src 'self' data: blob:;`. News article images come from external domains, so update to:

Change:
```
img-src 'self' data: blob:;
```
To:
```
img-src 'self' data: blob: https:;
```

This allows loading images over HTTPS from any domain (necessary since news images come from hundreds of different media CDNs).

- [ ] **Step 2: Also update connect-src to allow GNews API**

Change:
```
connect-src 'self' https://cdn.jsdelivr.net;
```
To:
```
connect-src 'self' https://cdn.jsdelivr.net https://gnews.io;
```

Note: The GNews fetch happens server-side in the cron, so `connect-src` update is only needed if you ever call GNews from the frontend. Include it for safety.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "fix: update CSP to allow external news images"
```

---

## Chunk 3: Frontend — HTML Structure

### Task 7: Add Discover Icon to Header + Discover Screen Container

**Files:**
- Modify: `public/index.html:98-138` (header) and `public/index.html:141-172` (after announcements, before welcome screen)

- [ ] **Step 1: Add Discover button to header**

In `public/index.html`, after the sidebar toggle button (line 99) and before the model selector (line 100), insert the Discover nav button:

```html
        <button class="btn-discover-nav" id="btn-discover-nav" onclick="showDiscoverScreen()" title="Discover News">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
        </button>
```

- [ ] **Step 2: Add Discover screen container**

In `public/index.html`, after the `announcements-area` div (line 141) and before the Welcome Screen div (line 143), insert:

```html
      <!-- Discover Screen -->
      <div id="discover-screen" class="discover-screen hidden" style="display:none;">
        <div class="discover-header">
          <div class="discover-title-row">
            <h2>Discover</h2>
            <p class="discover-subtitle">Trending news from around the world</p>
          </div>
        </div>
        <div class="discover-categories" id="discover-categories"></div>
        <div class="discover-grid" id="discover-grid"></div>
        <div class="discover-load-more" id="discover-load-more" style="display:none;">
          <button class="btn-load-more" onclick="loadMoreDiscover()">Load More Articles</button>
        </div>
        <div class="discover-empty" id="discover-empty" style="display:none;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
          <p>No articles available right now. Check back soon.</p>
        </div>
      </div>
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add Discover screen HTML structure and header nav icon"
```

---

## Chunk 4: Frontend — CSS Styles

### Task 8: Add Discover Screen Styles

**Files:**
- Modify: `public/css/app.css` (append at end of file)

- [ ] **Step 1: Add all Discover CSS**

Append the following to the end of `public/css/app.css`:

```css
/* ═══════════════════════════════════════════════════════════════════
   Discover News Feed
   ═══════════════════════════════════════════════════════════════════ */

/* ── Header Nav Button ── */
.btn-discover-nav {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px;
  border-radius: var(--radius-sm);
  transition: color var(--transition), background var(--transition);
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn-discover-nav:hover {
  color: var(--accent);
  background: var(--bg-hover);
}
.btn-discover-nav.active {
  color: var(--accent);
}

/* ── Discover Screen ── */
.discover-screen {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.discover-header {
  margin-bottom: 24px;
}
.discover-title-row h2 {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 4px 0;
}
.discover-subtitle {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin: 0;
}

/* ── Category Tabs ── */
.discover-categories {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  overflow-x: auto;
  padding-bottom: 8px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.discover-categories::-webkit-scrollbar {
  display: none;
}
.discover-cat-btn {
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition);
}
.discover-cat-btn:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}
.discover-cat-btn.active {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
  font-weight: 600;
}

/* ── News Card Grid ── */
.discover-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

@media (max-width: 1024px) {
  .discover-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 640px) {
  .discover-grid {
    grid-template-columns: 1fr;
  }
  .discover-screen {
    padding: 16px;
  }
}

/* ── News Card ── */
.discover-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  overflow: hidden;
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1),
              border-color var(--transition);
  cursor: default;
  display: flex;
  flex-direction: column;
  opacity: 0;
  transform: translateY(20px);
  animation: discoverReveal 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.discover-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--card-shadow);
  border-color: var(--border-light);
}

/* Staggered reveal animation */
.discover-card:nth-child(1) { animation-delay: 0ms; }
.discover-card:nth-child(2) { animation-delay: 60ms; }
.discover-card:nth-child(3) { animation-delay: 120ms; }
.discover-card:nth-child(4) { animation-delay: 180ms; }
.discover-card:nth-child(5) { animation-delay: 240ms; }
.discover-card:nth-child(6) { animation-delay: 300ms; }
.discover-card:nth-child(7) { animation-delay: 360ms; }
.discover-card:nth-child(8) { animation-delay: 420ms; }
.discover-card:nth-child(9) { animation-delay: 480ms; }

@keyframes discoverReveal {
  to { opacity: 1; transform: translateY(0); }
}

/* Card image */
.discover-card-img {
  width: 100%;
  height: 180px;
  object-fit: cover;
  background: var(--bg-tertiary);
}
.discover-card-img-placeholder {
  width: 100%;
  height: 180px;
  background: linear-gradient(135deg, var(--bg-tertiary), var(--bg-hover));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

/* Card body */
.discover-card-body {
  padding: 16px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.discover-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  color: var(--text-muted);
}
.discover-card-category {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
/* Category colors */
.cat-world { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
.cat-government { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
.cat-business { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.cat-technology { background: rgba(6, 182, 212, 0.15); color: #22d3ee; }
.cat-science { background: rgba(249, 115, 22, 0.15); color: #fb923c; }
.cat-health { background: rgba(236, 72, 153, 0.15); color: #f472b6; }
.cat-sports { background: rgba(234, 179, 8, 0.15); color: #facc15; }
.cat-entertainment { background: rgba(244, 63, 94, 0.15); color: #fb7185; }

.discover-card-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0;
}
.discover-card-desc {
  font-size: 0.82rem;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0;
}

/* Card actions */
.discover-card-actions {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
  margin-top: auto;
}
.discover-btn {
  flex: 1;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.discover-btn-read {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}
.discover-btn-read:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.discover-btn-discuss {
  background: var(--accent);
  color: var(--text-on-accent);
  font-weight: 600;
}
.discover-btn-discuss:hover {
  background: var(--accent-hover);
  box-shadow: var(--gold-glow-faint);
}

/* ── Load More Button ── */
.discover-load-more {
  text-align: center;
  padding: 24px 0;
}
.btn-load-more {
  padding: 10px 28px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
}
.btn-load-more:hover {
  border-color: var(--accent);
  color: var(--text-primary);
  background: var(--bg-hover);
}

/* ── Empty State ── */
.discover-empty {
  text-align: center;
  padding: 64px 16px;
  color: var(--text-muted);
}
.discover-empty svg {
  margin-bottom: 16px;
  opacity: 0.5;
}
.discover-empty p {
  font-size: 0.9rem;
}

/* ── Skeleton Loading Cards ── */
.discover-skeleton {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  overflow: hidden;
}
.discover-skeleton-img {
  width: 100%;
  height: 180px;
  background: linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-hover) 50%, var(--bg-tertiary) 75%);
  background-size: 200% 100%;
  animation: discoverShimmer 1.5s infinite;
}
.discover-skeleton-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.discover-skeleton-line {
  height: 14px;
  border-radius: 6px;
  background: linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-hover) 50%, var(--bg-tertiary) 75%);
  background-size: 200% 100%;
  animation: discoverShimmer 1.5s infinite;
}
.discover-skeleton-line.short { width: 60%; }
.discover-skeleton-line.medium { width: 85%; }

@keyframes discoverShimmer {
  from { background-position: -200% 0; }
  to { background-position: 200% 0; }
}

/* ── Reduced Motion ── */
@media (prefers-reduced-motion: reduce) {
  .discover-card {
    animation: none;
    opacity: 1;
    transform: none;
  }
  .discover-card:hover {
    transform: none;
  }
  .discover-skeleton-img,
  .discover-skeleton-line {
    animation: none;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add public/css/app.css
git commit -m "feat: add Discover screen CSS (cards, grid, skeleton, animations)"
```

---

## Chunk 5: Frontend — JavaScript Logic

### Task 9: Add Discover Screen Logic to app.js

**Files:**
- Modify: `public/js/app.js` (insert new section before the final IIFE features block, around line ~11300)

- [ ] **Step 1: Add Discover state + screen switching**

Insert this block in `public/js/app.js` after the announcements section (after `dismissAnnouncement` function, around line ~4830):

```javascript
// ─── Discover News Feed ─────────────────────────────────────────────

const discoverState = {
  articles: [],
  category: 'all',
  page: 1,
  hasMore: false,
  loading: false,
};

const DISCOVER_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'world', label: 'World' },
  { id: 'government', label: 'Gov & Politics' },
  { id: 'business', label: 'Business' },
  { id: 'technology', label: 'Technology' },
  { id: 'science', label: 'Science' },
  { id: 'health', label: 'Health' },
  { id: 'sports', label: 'Sports' },
  { id: 'entertainment', label: 'Entertainment' },
];

function showDiscoverScreen() {
  document.getElementById('welcome-screen').classList.add('hidden');
  document.getElementById('welcome-screen').style.display = 'none';
  const chat = document.getElementById('chat-screen');
  chat.classList.add('hidden');
  chat.style.display = 'none';

  const discover = document.getElementById('discover-screen');
  discover.classList.remove('hidden');
  discover.style.display = '';

  // Highlight nav button
  const navBtn = document.getElementById('btn-discover-nav');
  if (navBtn) navBtn.classList.add('active');

  // Load on first visit or if stale
  if (discoverState.articles.length === 0) {
    renderDiscoverCategories();
    loadDiscoverArticles(true);
  }
}

function hideDiscoverScreen() {
  const discover = document.getElementById('discover-screen');
  if (discover) {
    discover.classList.add('hidden');
    discover.style.display = 'none';
  }
  const navBtn = document.getElementById('btn-discover-nav');
  if (navBtn) navBtn.classList.remove('active');
}

function renderDiscoverCategories() {
  const container = document.getElementById('discover-categories');
  if (!container) return;

  container.innerHTML = DISCOVER_CATEGORIES.map(cat => `
    <button class="discover-cat-btn${cat.id === discoverState.category ? ' active' : ''}"
            onclick="selectDiscoverCategory('${cat.id}')">
      ${cat.label}
    </button>
  `).join('');
}

function selectDiscoverCategory(categoryId) {
  discoverState.category = categoryId;
  discoverState.page = 1;
  discoverState.articles = [];
  renderDiscoverCategories();
  loadDiscoverArticles(true);
}

async function loadDiscoverArticles(reset) {
  if (discoverState.loading) return;
  discoverState.loading = true;

  const grid = document.getElementById('discover-grid');
  const loadMoreBtn = document.getElementById('discover-load-more');
  const emptyState = document.getElementById('discover-empty');

  if (reset) {
    discoverState.page = 1;
    grid.innerHTML = renderDiscoverSkeletons(6);
    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
    if (emptyState) emptyState.style.display = 'none';
  }

  try {
    const params = new URLSearchParams({
      page: String(discoverState.page),
      limit: '20',
    });
    if (discoverState.category !== 'all') {
      params.set('category', discoverState.category);
    }

    const res = await fetch(`${API}/api/discover?${params}`);
    const data = await res.json();

    if (reset) {
      discoverState.articles = data.articles || [];
    } else {
      discoverState.articles = discoverState.articles.concat(data.articles || []);
    }
    discoverState.hasMore = data.hasMore || false;

    if (discoverState.articles.length === 0) {
      grid.innerHTML = '';
      if (emptyState) emptyState.style.display = '';
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
    } else {
      if (emptyState) emptyState.style.display = 'none';
      grid.innerHTML = discoverState.articles.map(renderDiscoverCard).join('');
      if (loadMoreBtn) loadMoreBtn.style.display = discoverState.hasMore ? '' : 'none';
    }
  } catch (err) {
    console.error('Failed to load discover articles:', err);
    if (reset) {
      grid.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:32px;">Failed to load news. Please try again.</p>';
    }
  } finally {
    discoverState.loading = false;
  }
}

function loadMoreDiscover() {
  discoverState.page++;
  loadDiscoverArticles(false);
}

function renderDiscoverCard(article) {
  const timeAgo = getTimeAgo(article.published_at);
  const catClass = `cat-${article.category}`;
  const catLabel = DISCOVER_CATEGORIES.find(c => c.id === article.category)?.label || article.category;

  const imgHtml = article.image_url
    ? `<img class="discover-card-img" src="${escapeHtml(article.image_url)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'discover-card-img-placeholder\\'><svg width=\\'32\\' height=\\'32\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.5\\'><circle cx=\\'12\\' cy=\\'12\\' r=\\'10\\'/><polygon points=\\'16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76\\'/></svg></div>'">`
    : `<div class="discover-card-img-placeholder"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg></div>`;

  return `
    <article class="discover-card">
      ${imgHtml}
      <div class="discover-card-body">
        <div class="discover-card-meta">
          <span class="discover-card-category ${catClass}">${escapeHtml(catLabel)}</span>
          <span>${escapeHtml(article.source_name || 'Unknown')}</span>
          <span>·</span>
          <span>${timeAgo}</span>
        </div>
        <h3 class="discover-card-title">${escapeHtml(article.title)}</h3>
        <p class="discover-card-desc">${escapeHtml(article.description || '')}</p>
      </div>
      <div class="discover-card-actions">
        <a class="discover-btn discover-btn-read" href="${escapeHtml(article.article_url)}" target="_blank" rel="noopener noreferrer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Read
        </a>
        <button class="discover-btn discover-btn-discuss" onclick="discussArticle('${article.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Discuss with Ozzy
        </button>
      </div>
    </article>
  `;
}

function renderDiscoverSkeletons(count) {
  return Array.from({ length: count }, () => `
    <div class="discover-skeleton">
      <div class="discover-skeleton-img"></div>
      <div class="discover-skeleton-body">
        <div class="discover-skeleton-line short"></div>
        <div class="discover-skeleton-line medium"></div>
        <div class="discover-skeleton-line"></div>
      </div>
    </div>
  `).join('');
}

function getTimeAgo(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  return days + 'd ago';
}

async function discussArticle(articleId) {
  if (!isLoggedIn()) {
    requireAuth(() => discussArticle(articleId));
    return;
  }

  try {
    const res = await fetch(`${API}/api/discover/discuss`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId }),
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to start discussion');
      return;
    }

    const data = await res.json();
    state.activeConversationId = data.conversationId;

    // Hide Discover, show Chat
    hideDiscoverScreen();
    showChatScreen();
    await loadConversations();

    // Load the conversation messages (the pre-loaded article context)
    await loadMessages(data.conversationId);
  } catch (err) {
    console.error('Failed to discuss article:', err);
    alert('Something went wrong. Please try again.');
  }
}
```

- [ ] **Step 2: Patch existing screen switching functions**

The existing `showWelcomeScreen()` and `showChatScreen()` need to hide the Discover screen. Find the `showChatScreen` function (line ~1610) and add `hideDiscoverScreen();` at the start:

```javascript
function showChatScreen() {
  hideDiscoverScreen();
  document.getElementById("welcome-screen").classList.add("hidden");
  // ... rest unchanged
}
```

Find the `showWelcomeScreen` function (line ~1618) and add `hideDiscoverScreen();` at the start:

```javascript
function showWelcomeScreen() {
  hideDiscoverScreen();
  document.getElementById("welcome-screen").classList.remove("hidden");
  // ... rest unchanged
}
```

- [ ] **Step 3: Load discover on app startup (optional prefetch)**

In the `onAuthenticated()` function (line ~1067), after the `loadAnnouncements();` call, add:

```javascript
  // Prefetch discover articles in background
  loadDiscoverArticles(true).catch(() => {});
```

This is optional — the articles will also load on first Discover screen visit.

- [ ] **Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add Discover screen JS (cards, categories, discuss flow, screen switching)"
```

---

## Chunk 6: Manual Seed + Testing

### Task 10: Trigger Initial News Fetch

- [ ] **Step 1: Deploy and trigger the cron manually**

```bash
npx wrangler deploy
```

Then trigger the scheduled event via the Cloudflare dashboard or:

```bash
curl "https://askozzy.ghwmelite.workers.dev/__scheduled?cron=0+*/2+*+*+*"
```

Or trigger via local dev:

```bash
npx wrangler dev --test-scheduled
# Then visit http://localhost:8787/__scheduled in browser
```

- [ ] **Step 2: Verify articles were fetched**

```bash
npx wrangler d1 execute ghana-civil-ai-db --remote --command="SELECT category, COUNT(*) as count FROM discover_articles GROUP BY category"
```

Expected: 8 rows, each with ~20 articles.

- [ ] **Step 3: Test the Discover screen in browser**

1. Open the app in browser
2. Click the compass/Discover icon in the header
3. Verify: Category tabs render, news cards load with images, staggered reveal animation plays
4. Click a category tab — cards filter correctly
5. Click "Read" — opens article in new tab
6. Click "Discuss with Ozzy" — creates conversation, navigates to chat with article context

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "feat: complete Discover news feed feature"
```

---

## Summary of All Files Changed

| File | Changes |
|------|---------|
| `schema-discover.sql` | **NEW** — D1 migration for `discover_articles` table |
| `src/types.ts` | Add `GNEWS_API_KEY` to Env |
| `src/index.ts` | Add `GET /api/discover`, `POST /api/discover/discuss`, cron fetch logic, CSP update |
| `wrangler.jsonc` | Update cron from `0 2 * * *` to `0 */2 * * *` |
| `public/index.html` | Add Discover header icon + Discover screen container |
| `public/js/app.js` | Add Discover state, screen switching, card rendering, discuss flow |
| `public/css/app.css` | Add Discover styles (grid, cards, skeleton, animations, responsive) |

**Total new API endpoints:** 2
**Total new DB tables:** 1
**Estimated API calls per day:** 96 (within GNews free tier of 100)
