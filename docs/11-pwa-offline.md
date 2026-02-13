# PWA & Offline Features

## Service Worker Architecture

- **File:** `public/sw.js` (~1,849 lines)
- **Version:** v5 (Cache name: `askozzy-v8`)
- **Registration:** In `app.js` on page load
- **Scope:** `/` (entire app)
- **Navigation preload:** Enabled for faster SW boot

## Caching Strategies

| Strategy | Used For | Description |
|----------|----------|-------------|
| Cache-First | Static assets (CSS, JS, icons, fonts) | Check cache first, fall back to network |
| Network-First | API calls (`/api/*`) | Try network first, fall back to cache |
| Stale-While-Revalidate | HTML pages | Serve from cache, update in background |

### Static Assets Cached

- `/css/app.css`, `/css/admin.css`
- `/js/app.js`, `/js/admin.js`, `/js/templates.js`
- `/manifest.json`
- `/icons/*` (SVG, PNG, maskable)
- `/index.html`, `/admin.html`

## Offline Queue

When the user is offline:

1. Messages are queued using the Cache API
2. Queue stored in a dedicated cache named `ozzy-offline-queue`
3. Each queued item: URL, method, headers, body, timestamp
4. Visual indicator shows offline status and queue count
5. When back online: Background Sync triggers automatic queue processing

### Queue Processing Flow

```
User sends message (offline) → Store in Cache API queue →
Show "Queued" indicator → Connection restored →
Background Sync event fires → Process queue FIFO →
Send each request to server → Remove from queue on success →
Update UI with responses
```

## IndexedDB Stores

| Store | Purpose | Key |
|-------|---------|-----|
| `template_cache` | 25+ GoG document template responses | `template_id` |
| `response_cache` | Cached AI responses (max 50, 24-hour TTL) | SHA-256 prompt hash |
| `conversation_cache` | Offline conversation list (max 200) | `conversation_id` |
| `message_cache` | Offline messages (indexed by conversation_id) | `message_id` |

**Database:** `ozzy-offline` (version 2). LRU cleanup enforced at capacity limits.

## Background Sync

3 sync tags registered:

| Tag | Purpose | Trigger |
|-----|---------|---------|
| `sync-offline-queue` | Process queued chat messages (debounced 10s min) | Connection restored |
| `refresh-templates` | Pre-cache template responses | Periodic sync |
| `sync-conversations` | Sync offline conversations | Periodic sync |

**Implementation:** `self.addEventListener('sync', event => { ... })`

## Push Notifications

### VAPID (Voluntary Application Server Identification)

- Server holds VAPID key pair
- Public key exposed via `GET /api/push/vapid-public-key`
- Used to authenticate push messages

### Subscription Flow

```
App requests notification permission → navigator.serviceWorker.ready →
registration.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: vapidPublicKey
}) → POST /api/push/subscribe with endpoint, p256dh, auth keys
```

### Notification Preferences

- `notify_announcements`: System announcements
- `notify_queue_sync`: Offline queue sync completed
- `notify_shared_chat`: Shared conversation notifications
- Managed via `PUT /api/push/preferences`

### Push Event Handling

```javascript
self.addEventListener('push', event => {
  const data = event.data.json();
  self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: data.url
  });
});
```

### Notification Click

Opens the relevant URL or focuses existing window.

## PWA Manifest

**File:** `public/manifest.json`

| Property | Value |
|----------|-------|
| `name` | AskOzzy |
| `short_name` | AskOzzy |
| `display` | standalone |
| `display_override` | window-controls-overlay, standalone, minimal-ui |
| `orientation` | any |
| `theme_color` | #0f1117 |
| `background_color` | #0f1117 |
| `categories` | productivity, utilities, business |
| `scope` | / |
| `start_url` | / |

### App Shortcuts

| Shortcut | URL | Description |
|----------|-----|-------------|
| New Conversation | `/?action=new-chat` | Start a new AI conversation |
| Admin Portal | `/admin` | Super Admin dashboard |

### Share Target

- **Action:** `/?action=share`
- **Method:** GET
- **Params:** title, text, url
- Allows sharing content TO AskOzzy from other apps

### Protocol Handler

- **Protocol:** `web+ozzy`
- **URL:** `/?action=protocol&data=%s`
- Enables deep linking via custom protocol

### Launch Handler

- **client_mode:** `focus-existing`
- Focuses existing window instead of opening new one

### Icons

- `icon.svg` (any size, SVG)
- `icon-192.png` (192x192, any purpose)
- `icon-512.png` (512x512, any purpose)
- `icon-maskable-192.png` (192x192, maskable)
- `icon-maskable-512.png` (512x512, maskable)

## Offline Template Responses

The service worker includes 25+ pre-cached template responses for common GoG document types. When offline, the SW performs fuzzy keyword matching against template categories:

- Memo templates: internal, cabinet, briefing (with Ghana Civil Service structure)
- Letter templates: official, response, circular (with GoG letterheads)
- Report templates: annual/quarterly, activity/trip, investigation
- Minutes templates: formal, quick summary
- Career templates: interview prep, CV, appraisal
- IT templates: troubleshooting, maintenance, procurement specs
- General templates: speeches, presentations, tenders, training programmes

These ensure users get useful structured output even without connectivity.

## Service Worker Message Handling

The SW responds to messages from the main thread:

| Message | Purpose |
|---------|---------|
| `SKIP_WAITING` | Activate new SW version immediately |
| `PROCESS_QUEUE` | Manually trigger offline queue sync |
| `GET_QUEUE_STATUS` | Check count of queued messages |
| `PRECACHE_TEMPLATES` | On-demand template caching |
| `CACHE_RESPONSE` | Client-driven response caching |

The SW also sends `SW_UPDATE_AVAILABLE` to clients when a new version is installed.

## Advanced PWA APIs

| API | Usage in AskOzzy |
|-----|-------------------|
| Wake Lock | Keeps screen on during voice mode |
| Idle Detection | Detects user inactivity for status |
| App Badging | Shows unread count on app icon |
| Media Session | Controls for audio playback/TTS |
| Contact Picker | Pick contacts for sharing (mobile) |
| File System Access | Save files directly to device |
| Web Share | Share conversations/referral links |
| Clipboard | Copy messages, paste images |

## Install Experience

1. Browser detects PWA criteria (manifest, service worker, HTTPS)
2. `beforeinstallprompt` event fires
3. App shows custom install banner/button
4. User clicks install
5. App installs to home screen/desktop
6. Opens in standalone mode (no browser chrome)

## Update Flow

1. Service worker detects new version
2. New SW installed in background (waiting)
3. User notified "Update available"
4. On next visit or manual refresh: new SW activates
5. Old caches cleaned up
