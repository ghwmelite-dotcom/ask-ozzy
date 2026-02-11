// ═══════════════════════════════════════════════════════════════════
//  AskOzzy — Enhanced Service Worker v2
//  Cache-first for static, network-first for API, offline queue for messages
// ═══════════════════════════════════════════════════════════════════

const CACHE_NAME = "askozzy-v2";
const OFFLINE_QUEUE_KEY = "askozzy_offline_queue";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/offline.html",
  "/css/app.css",
  "/js/app.js",
  "/js/templates.js",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/manifest.json",
];

// API paths that should cache GET responses for offline reading
const CACHEABLE_API_PATHS = [
  "/api/conversations",
  "/api/pricing",
  "/api/announcements",
];

// ─── Install: pre-cache static shell ────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// ─── Activate: clean old caches ─────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch strategy ─────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET for caching (but still handle POST for offline queue)
  if (!url.protocol.startsWith("http")) return;

  // API: POST requests — try network, queue on failure
  if (request.method === "POST" && url.pathname.startsWith("/api/")) {
    event.respondWith(handleAPIPost(request));
    return;
  }

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // API GET: network-first with cache fallback for certain endpoints
  if (url.pathname.startsWith("/api/")) {
    const isCacheable = CACHEABLE_API_PATHS.some((p) => url.pathname.startsWith(p));

    if (isCacheable) {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(async () => {
            const cached = await caches.match(request);
            if (cached) return cached;
            return new Response(
              JSON.stringify({ error: "You are offline. Showing cached data.", offline: true }),
              { status: 503, headers: { "Content-Type": "application/json" } }
            );
          })
      );
    } else {
      event.respondWith(
        fetch(request).catch(() => {
          return new Response(
            JSON.stringify({ error: "You are offline. Please check your connection.", offline: true }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          );
        })
      );
    }
    return;
  }

  // Google Fonts: cache-first
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          if (request.mode === "navigate") {
            return caches.match("/offline.html");
          }
          return cached;
        });

      return cached || fetchPromise;
    })
  );
});

// ─── Offline POST handling ──────────────────────────────────────────
async function handleAPIPost(request) {
  try {
    const response = await fetch(request.clone());
    return response;
  } catch (error) {
    // Network failed — queue the request for later
    const url = new URL(request.url);

    // Only queue chat messages (not auth requests, etc.)
    if (url.pathname === "/api/chat") {
      try {
        const body = await request.clone().json();
        await queueOfflineMessage(url.pathname, body, Object.fromEntries(request.headers));

        return new Response(
          JSON.stringify({
            error: "You are offline. Your message has been saved and will be sent when you reconnect.",
            offline: true,
            queued: true,
          }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      } catch {
        // Fall through to generic error
      }
    }

    return new Response(
      JSON.stringify({ error: "You are offline. Please check your connection.", offline: true }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ─── Offline message queue (IndexedDB-like using cache API) ──────────
async function queueOfflineMessage(path, body, headers) {
  const cache = await caches.open(CACHE_NAME);
  const queueResponse = await cache.match(OFFLINE_QUEUE_KEY);
  let queue = [];

  if (queueResponse) {
    try {
      queue = await queueResponse.json();
    } catch {}
  }

  queue.push({
    path,
    body,
    headers,
    timestamp: Date.now(),
  });

  await cache.put(
    OFFLINE_QUEUE_KEY,
    new Response(JSON.stringify(queue), { headers: { "Content-Type": "application/json" } })
  );
}

// ─── Process offline queue when back online ──────────────────────────
async function processOfflineQueue() {
  const cache = await caches.open(CACHE_NAME);
  const queueResponse = await cache.match(OFFLINE_QUEUE_KEY);

  if (!queueResponse) return;

  let queue = [];
  try {
    queue = await queueResponse.json();
  } catch {
    return;
  }

  if (queue.length === 0) return;

  const remaining = [];

  for (const item of queue) {
    try {
      const response = await fetch(item.path, {
        method: "POST",
        headers: item.headers,
        body: JSON.stringify(item.body),
      });

      if (response.ok) {
        // Notify the client
        const clients = await self.clients.matchAll();
        clients.forEach((client) => {
          client.postMessage({
            type: "OFFLINE_MESSAGE_SENT",
            data: item.body,
          });
        });
      } else {
        remaining.push(item); // Keep for retry
      }
    } catch {
      remaining.push(item); // Still offline for this one
    }
  }

  // Update queue
  if (remaining.length > 0) {
    await cache.put(
      OFFLINE_QUEUE_KEY,
      new Response(JSON.stringify(remaining), { headers: { "Content-Type": "application/json" } })
    );
  } else {
    await cache.delete(OFFLINE_QUEUE_KEY);
  }
}

// ─── Message handling from main thread ───────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (event.data && event.data.type === "PROCESS_QUEUE") {
    processOfflineQueue();
  }

  if (event.data && event.data.type === "GET_QUEUE_STATUS") {
    caches.open(CACHE_NAME).then(async (cache) => {
      const queueResponse = await cache.match(OFFLINE_QUEUE_KEY);
      let count = 0;
      if (queueResponse) {
        try {
          const queue = await queueResponse.json();
          count = queue.length;
        } catch {}
      }
      event.source.postMessage({ type: "QUEUE_STATUS", count });
    });
  }
});

// ─── Online detection: process queue when connectivity returns ────────
self.addEventListener("fetch", () => {
  // A successful fetch means we're online — try to drain the queue
  processOfflineQueue();
});
