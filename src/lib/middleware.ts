import type { Env } from "../types";
import { verifyToken } from "./utils";

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
    if (category === "auth") return { allowed: false, remaining: 0 };
    return { allowed: true, remaining: config.maxRequests };
  }
}

// ─── Auth Middleware ─────────────────────────────────────────────────

export async function authMiddleware(c: any, next: () => Promise<void>): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice(7);
  const userId = await verifyToken(token, c.env);
  if (!userId) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }
  c.set("userId", userId);
  await next();
}

// ─── Admin Middleware ────────────────────────────────────────────────

export async function adminMiddleware(c: any, next: () => Promise<void>): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice(7);
  const userId = await verifyToken(token, c.env);
  if (!userId) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }
  const user = (await c.env.DB.prepare("SELECT role FROM users WHERE id = ?")
    .bind(userId)
    .first()) as { role: string } | null;
  if (!user || user.role !== "super_admin") {
    return c.json({ error: "Forbidden: admin access required" }, 403);
  }
  c.set("userId", userId);
  await next();
}

// ─── Department Admin Middleware ─────────────────────────────────────

export async function deptAdminMiddleware(c: any, next: () => Promise<void>): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice(7);
  const userId = await verifyToken(token, c.env);
  if (!userId) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }
  const user = (await c.env.DB.prepare("SELECT role, department FROM users WHERE id = ?")
    .bind(userId)
    .first()) as { role: string; department: string } | null;
  if (!user || (user.role !== "super_admin" && user.role !== "dept_admin")) {
    return c.json({ error: "Forbidden: admin or department admin access required" }, 403);
  }
  c.set("userId", userId);
  if (user.role === "dept_admin") {
    c.set("deptFilter", user.department);
  }
  await next();
}
