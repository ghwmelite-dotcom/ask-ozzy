import { Hono } from "hono";
import type { AppType } from "../types";
import { authMiddleware } from "../lib/middleware";
import { generateId } from "../lib/utils";
import { log } from "../lib/logger";

const push = new Hono<AppType>();

// ─── Push Subscriptions Table Lazy Migration ────────────────────────

let pushSubsTableExists = false;
async function ensurePushSubscriptionsTable(db: D1Database) {
  if (pushSubsTableExists) return;
  try {
    await db.prepare("SELECT id FROM push_subscriptions LIMIT 1").first();
    pushSubsTableExists = true;
  } catch {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        notify_announcements INTEGER DEFAULT 1,
        notify_queue_sync INTEGER DEFAULT 1,
        notify_shared_chat INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id)"),
    ]);
    pushSubsTableExists = true;
  }
}

// ─── Push Notification Endpoints ────────────────────────────────────

// Public: Return VAPID public key (no auth required)
push.get("/api/push/vapid-public-key", async (c) => {
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY || "" });
});

// Save push subscription
push.post("/api/push/subscribe", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { endpoint, keys, preferences } = await c.req.json();

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return c.json({ error: "Missing required subscription fields (endpoint, keys.p256dh, keys.auth)" }, 400);
    }

    await ensurePushSubscriptionsTable(c.env.DB);

    const id = generateId();
    const notifyAnnouncements = preferences?.announcements !== false ? 1 : 0;
    const notifyQueueSync = preferences?.queueSync !== false ? 1 : 0;
    const notifySharedChat = preferences?.sharedChat !== false ? 1 : 0;

    // Upsert: insert or update on conflict (endpoint is UNIQUE)
    await c.env.DB.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, notify_announcements, notify_queue_sync, notify_shared_chat)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         notify_announcements = excluded.notify_announcements,
         notify_queue_sync = excluded.notify_queue_sync,
         notify_shared_chat = excluded.notify_shared_chat`
    )
      .bind(id, userId, endpoint, keys.p256dh, keys.auth, notifyAnnouncements, notifyQueueSync, notifySharedChat)
      .run();

    return c.json({ success: true });
  } catch (err: any) {
    log("error", "Push subscribe error", { error: err.message });
    return c.json({ error: "Failed to save push subscription" }, 500);
  }
});

// Remove push subscription
push.delete("/api/push/unsubscribe", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { endpoint } = await c.req.json();

    if (!endpoint) {
      return c.json({ error: "Missing endpoint" }, 400);
    }

    await ensurePushSubscriptionsTable(c.env.DB);

    await c.env.DB.prepare(
      "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?"
    )
      .bind(endpoint, userId)
      .run();

    return c.json({ success: true });
  } catch (err: any) {
    log("error", "Push unsubscribe error", { error: err.message });
    return c.json({ error: "Failed to remove push subscription" }, 500);
  }
});

// Check subscription status
push.get("/api/push/status", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");

    await ensurePushSubscriptionsTable(c.env.DB);

    const sub = await c.env.DB.prepare(
      "SELECT notify_announcements, notify_queue_sync, notify_shared_chat FROM push_subscriptions WHERE user_id = ? LIMIT 1"
    )
      .bind(userId)
      .first<{ notify_announcements: number; notify_queue_sync: number; notify_shared_chat: number }>();

    if (!sub) {
      return c.json({ subscribed: false, preferences: null });
    }

    return c.json({
      subscribed: true,
      preferences: {
        announcements: !!sub.notify_announcements,
        queueSync: !!sub.notify_queue_sync,
        sharedChat: !!sub.notify_shared_chat,
      },
    });
  } catch (err: any) {
    log("error", "Push status error", { error: err.message });
    return c.json({ error: "Failed to check push status" }, 500);
  }
});

// Update notification preferences
push.put("/api/push/preferences", authMiddleware, async (c) => {
  try {
    const userId = c.get("userId");
    const { endpoint, announcements, queueSync, sharedChat } = await c.req.json();

    if (!endpoint) {
      return c.json({ error: "Missing endpoint" }, 400);
    }

    await ensurePushSubscriptionsTable(c.env.DB);

    const result = await c.env.DB.prepare(
      `UPDATE push_subscriptions
       SET notify_announcements = ?, notify_queue_sync = ?, notify_shared_chat = ?
       WHERE endpoint = ? AND user_id = ?`
    )
      .bind(
        announcements !== false ? 1 : 0,
        queueSync !== false ? 1 : 0,
        sharedChat !== false ? 1 : 0,
        endpoint,
        userId
      )
      .run();

    if (!result.meta.changes) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    return c.json({ success: true });
  } catch (err: any) {
    log("error", "Push preferences error", { error: err.message });
    return c.json({ error: "Failed to update preferences" }, 500);
  }
});

export default push;
