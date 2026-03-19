import type { Env } from "../types";
import { verifyToken, getSessionData } from "./utils";

// ─── Rate Limiting ──────────────────────────────────────────────────

const RATE_LIMITS: Record<string, { maxRequests: number; windowSeconds: number }> = {
  "auth": { maxRequests: 10, windowSeconds: 300 },
  "chat": { maxRequests: 30, windowSeconds: 60 },
  "api": { maxRequests: 100, windowSeconds: 60 },
  "share": { maxRequests: 10, windowSeconds: 300 },
};

export async function checkRateLimit(env: Env, key: string, category: string): Promise<{ allowed: boolean; remaining: number }> {
  const config = RATE_LIMITS[category] || RATE_LIMITS.api;
  const kvKey = `ratelimit:${category}:${key}`;

  try {
    const current = await env.SESSIONS.get(kvKey);
    const count = current ? parseInt(current) : 0;

    if (count >= config.maxRequests) {
      return { allowed: false, remaining: 0 };
    }

    await env.SESSIONS.put(kvKey, String(count + 1), { expirationTtl: config.windowSeconds });
    return { allowed: true, remaining: config.maxRequests - count - 1 };
  } catch {
    // Fail closed for security-sensitive categories
    if (category === "auth" || category === "chat" || category === "share") {
      return { allowed: false, remaining: 0 };
    }
    return { allowed: true, remaining: config.maxRequests };
  }
}

// ─── Global Per-User Rate Limit (100/hr across all agents) ─────────

export async function globalRateLimit(env: Env, userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const key = `global_rate:${userId}`;
  try {
    const current = parseInt(await env.SESSIONS.get(key) || '0');
    if (current >= 100) {
      return { allowed: false, remaining: 0 };
    }
    await env.SESSIONS.put(key, String(current + 1), { expirationTtl: 3600 });
    return { allowed: true, remaining: 100 - current - 1 };
  } catch {
    return { allowed: false, remaining: 0 };
  }
}

// ─── Auth Middleware ─────────────────────────────────────────────────

export async function authMiddleware(c: any, next: () => Promise<void>): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice(7);
  const session = await getSessionData(token, c.env);
  if (!session) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }
  // Validate session version if present (new sessions have it, legacy sessions don't)
  if (session.sessionVersion) {
    const user = (await c.env.DB.prepare("SELECT session_version FROM users WHERE id = ?")
      .bind(session.userId).first()) as { session_version: number } | null;
    if (!user || user.session_version !== session.sessionVersion) {
      // Session was revoked — clean up the stale KV entry
      await c.env.SESSIONS.delete(`session:${token}`);
      return c.json({ error: "Session revoked" }, 401);
    }
  }
  c.set("userId", session.userId);
  await next();
}

// ─── Admin Middleware ────────────────────────────────────────────────

export async function adminMiddleware(c: any, next: () => Promise<void>): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice(7);
  const session = await getSessionData(token, c.env);
  if (!session) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }
  const user = (await c.env.DB.prepare("SELECT role, session_version FROM users WHERE id = ?")
    .bind(session.userId)
    .first()) as { role: string; session_version: number } | null;
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }
  if (session.sessionVersion && user.session_version !== session.sessionVersion) {
    await c.env.SESSIONS.delete(`session:${token}`);
    return c.json({ error: "Session revoked" }, 401);
  }
  if (user.role !== "super_admin") {
    return c.json({ error: "Forbidden: admin access required" }, 403);
  }
  c.set("userId", session.userId);
  await next();
}

// ─── Department Admin Middleware ─────────────────────────────────────

export async function deptAdminMiddleware(c: any, next: () => Promise<void>): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice(7);
  const session = await getSessionData(token, c.env);
  if (!session) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }
  const user = (await c.env.DB.prepare("SELECT role, department, session_version FROM users WHERE id = ?")
    .bind(session.userId)
    .first()) as { role: string; department: string; session_version: number } | null;
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }
  if (session.sessionVersion && user.session_version !== session.sessionVersion) {
    await c.env.SESSIONS.delete(`session:${token}`);
    return c.json({ error: "Session revoked" }, 401);
  }
  if (user.role !== "super_admin" && user.role !== "dept_admin") {
    return c.json({ error: "Forbidden: admin or department admin access required" }, 403);
  }
  c.set("userId", session.userId);
  if (user.role === "dept_admin") {
    c.set("deptFilter", user.department);
  }
  await next();
}

// ─── Org Admin Middleware ────────────────────────────────────────────

export async function orgAdminMiddleware(c: any, next: () => Promise<void>): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice(7);
  const session = await getSessionData(token, c.env);
  if (!session) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }
  const user = (await c.env.DB.prepare(
    "SELECT role, org_id, org_role, session_version FROM users WHERE id = ?"
  ).bind(session.userId).first()) as { role: string; org_id: string | null; org_role: string | null; session_version: number } | null;

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }
  if (session.sessionVersion && user.session_version !== session.sessionVersion) {
    await c.env.SESSIONS.delete(`session:${token}`);
    return c.json({ error: "Session revoked" }, 401);
  }
  // Super admins can access any org admin route
  if (user.role === "super_admin") {
    c.set("userId", session.userId);
    c.set("orgId", c.req.query("org_id") || user.org_id);
    c.set("isSuperAdmin", true);
    await next();
    return;
  }
  if (!user.org_id || user.org_role !== "org_admin") {
    return c.json({ error: "Forbidden: organisation admin access required" }, 403);
  }
  c.set("userId", session.userId);
  c.set("orgId", user.org_id);
  c.set("isSuperAdmin", false);
  await next();
}
