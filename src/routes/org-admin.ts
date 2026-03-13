// Organisation Admin routes — extracted from index.ts
import { Hono } from 'hono';
import type { AppType } from '../types';
import { orgAdminMiddleware } from '../lib/middleware';
import { generateId } from '../lib/utils';

// Volume discount helper (moved from index.ts)
const VOLUME_DISCOUNTS = [
  { minSeats: 200, discount: 0.35 },
  { minSeats: 51, discount: 0.25 },
  { minSeats: 11, discount: 0.15 },
  { minSeats: 1, discount: 0 },
];

function getVolumeDiscount(seats: number): number {
  for (const tier of VOLUME_DISCOUNTS) {
    if (seats >= tier.minSeats) return tier.discount;
  }
  return 0;
}

const orgAdmin = new Hono<AppType>();

orgAdmin.get("/api/org-admin/verify", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const org = await c.env.DB.prepare(
    "SELECT o.*, u.full_name as owner_name, u.email as owner_email FROM organizations o JOIN users u ON u.id = o.owner_id WHERE o.id = ?"
  ).bind(orgId).first();

  if (!org) return c.json({ error: "Organisation not found" }, 404);

  return c.json({ org });
});

orgAdmin.get("/api/org-admin/dashboard", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const [totalMembers, activeToday, messagesToday, totalConversations, orgInfo, pricing] = await Promise.all([
    c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM users WHERE org_id = ?"
    ).bind(orgId).first<{ count: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM users WHERE org_id = ? AND last_login >= date('now')"
    ).bind(orgId).first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN users u ON u.id = c.user_id
       WHERE u.org_id = ? AND m.created_at >= date('now')`
    ).bind(orgId).first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM conversations c
       JOIN users u ON u.id = c.user_id
       WHERE u.org_id = ?`
    ).bind(orgId).first<{ count: number }>(),
    c.env.DB.prepare(
      "SELECT name, slug, max_seats, used_seats, tier, sector FROM organizations WHERE id = ?"
    ).bind(orgId).first<{ name: string; slug: string; max_seats: number; used_seats: number; tier: string; sector: string | null }>(),
    c.env.DB.prepare(
      "SELECT plan, seats_purchased, price_per_seat, billing_cycle FROM org_pricing WHERE org_id = ?"
    ).bind(orgId).first(),
  ]);

  return c.json({
    totalMembers: totalMembers?.count || 0,
    activeToday: activeToday?.count || 0,
    messagesToday: messagesToday?.count || 0,
    totalConversations: totalConversations?.count || 0,
    seats: {
      used: orgInfo?.used_seats || 0,
      total: orgInfo?.max_seats || 0,
    },
    tier: orgInfo?.tier || "starter",
    orgName: orgInfo?.name || "",
    orgSlug: orgInfo?.slug || "",
    sector: orgInfo?.sector || "",
    pricing: pricing || null,
  });
});

orgAdmin.get("/api/org-admin/users", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const page = parseInt(c.req.query("page") || "1");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const search = c.req.query("search") || "";
  const offset = (page - 1) * limit;

  let countQuery = "SELECT COUNT(*) as count FROM users WHERE org_id = ?";
  let dataQuery = "SELECT id, email, full_name, department, tier, org_role, last_login, created_at FROM users WHERE org_id = ?";
  const params: string[] = [orgId];

  if (search) {
    const searchFilter = " AND (full_name LIKE ? OR email LIKE ?)";
    countQuery += searchFilter;
    dataQuery += searchFilter;
    params.push(`%${search}%`, `%${search}%`);
  }

  dataQuery += " ORDER BY created_at DESC LIMIT ? OFFSET ?";

  const countStmt = c.env.DB.prepare(countQuery);
  const dataStmt = c.env.DB.prepare(dataQuery);

  const countParams = search ? [orgId, `%${search}%`, `%${search}%`] : [orgId];
  const dataParams = search ? [orgId, `%${search}%`, `%${search}%`, String(limit), String(offset)] : [orgId, String(limit), String(offset)];

  const [total, { results }] = await Promise.all([
    countStmt.bind(...countParams).first<{ count: number }>(),
    dataStmt.bind(...dataParams).all(),
  ]);

  return c.json({
    users: results || [],
    total: total?.count || 0,
    page,
    totalPages: Math.ceil((total?.count || 0) / limit),
  });
});

orgAdmin.post("/api/org-admin/users/invite", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const userId = c.get("userId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const { email, role } = await c.req.json();
  if (!email) return c.json({ error: "Email is required" }, 400);

  const trimmedEmail = email.trim().toLowerCase();

  const org = await c.env.DB.prepare(
    "SELECT max_seats, used_seats FROM organizations WHERE id = ?"
  ).bind(orgId).first<{ max_seats: number; used_seats: number }>();

  if (org && org.used_seats >= org.max_seats) {
    return c.json({ error: `Organisation seat limit (${org.max_seats}) reached. Upgrade your plan to add more seats.` }, 400);
  }

  const existingInvite = await c.env.DB.prepare(
    "SELECT id FROM org_invites WHERE org_id = ? AND email = ? AND status = 'pending'"
  ).bind(orgId, trimmedEmail).first();
  if (existingInvite) {
    return c.json({ error: "An invite for this email is already pending" }, 409);
  }

  const existingMember = await c.env.DB.prepare(
    "SELECT id FROM users WHERE email = ? AND org_id = ?"
  ).bind(trimmedEmail, orgId).first();
  if (existingMember) {
    return c.json({ error: "This user is already a member of your organisation" }, 409);
  }

  const inviteId = generateId();
  await c.env.DB.prepare(
    "INSERT INTO org_invites (id, org_id, email, role, invited_by) VALUES (?, ?, ?, ?, ?)"
  ).bind(inviteId, orgId, trimmedEmail, role || "member", userId).run();

  return c.json({ id: inviteId, success: true, message: `Invite sent to ${trimmedEmail}` });
});

orgAdmin.delete("/api/org-admin/users/:id", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const memberId = c.req.param("id");

  const member = await c.env.DB.prepare(
    "SELECT id, org_role FROM users WHERE id = ? AND org_id = ?"
  ).bind(memberId, orgId).first<{ id: string; org_role: string | null }>();

  if (!member) {
    return c.json({ error: "User is not a member of this organisation" }, 404);
  }

  const org = await c.env.DB.prepare(
    "SELECT owner_id FROM organizations WHERE id = ?"
  ).bind(orgId).first<{ owner_id: string }>();

  if (org && org.owner_id === memberId) {
    return c.json({ error: "Cannot remove the organisation owner" }, 400);
  }

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET org_id = NULL, org_role = NULL WHERE id = ?").bind(memberId),
    c.env.DB.prepare("UPDATE organizations SET used_seats = MAX(0, used_seats - 1) WHERE id = ?").bind(orgId),
  ]);

  return c.json({ success: true });
});

orgAdmin.patch("/api/org-admin/users/:id/role", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const memberId = c.req.param("id");
  const { role } = await c.req.json();

  if (!role || !["member", "org_admin"].includes(role)) {
    return c.json({ error: "Role must be 'member' or 'org_admin'" }, 400);
  }

  const member = await c.env.DB.prepare(
    "SELECT id FROM users WHERE id = ? AND org_id = ?"
  ).bind(memberId, orgId).first();

  if (!member) {
    return c.json({ error: "User is not a member of this organisation" }, 404);
  }

  await c.env.DB.prepare(
    "UPDATE users SET org_role = ? WHERE id = ? AND org_id = ?"
  ).bind(role, memberId, orgId).run();

  return c.json({ success: true, role });
});

orgAdmin.get("/api/org-admin/analytics", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const [messagesPerDay, activePerDay, popularModels, topUsers, tierBreakdown] = await Promise.all([
    c.env.DB.prepare(
      `SELECT date(m.created_at) as date, COUNT(*) as count
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN users u ON u.id = c.user_id
       WHERE u.org_id = ? AND m.created_at >= datetime('now', '-30 days')
       GROUP BY date(m.created_at) ORDER BY date ASC`
    ).bind(orgId).all(),
    c.env.DB.prepare(
      `SELECT date(m.created_at) as date, COUNT(DISTINCT c.user_id) as count
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN users u ON u.id = c.user_id
       WHERE u.org_id = ? AND m.created_at >= datetime('now', '-30 days')
       GROUP BY date(m.created_at) ORDER BY date ASC`
    ).bind(orgId).all(),
    c.env.DB.prepare(
      `SELECT m.model as name, COUNT(*) as count
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN users u ON u.id = c.user_id
       WHERE u.org_id = ? AND m.role = 'assistant' AND m.created_at >= datetime('now', '-30 days')
       GROUP BY m.model ORDER BY count DESC LIMIT 10`
    ).bind(orgId).all(),
    c.env.DB.prepare(
      `SELECT u.id, u.full_name, u.email, COUNT(m.id) as message_count
       FROM users u
       JOIN conversations c ON c.user_id = u.id
       JOIN messages m ON m.conversation_id = c.id
       WHERE u.org_id = ? AND m.created_at >= datetime('now', '-30 days')
       GROUP BY u.id ORDER BY message_count DESC LIMIT 10`
    ).bind(orgId).all(),
    c.env.DB.prepare(
      "SELECT tier, COUNT(*) as count FROM users WHERE org_id = ? GROUP BY tier"
    ).bind(orgId).all(),
  ]);

  return c.json({
    messagesPerDay: messagesPerDay.results || [],
    activePerDay: activePerDay.results || [],
    popularModels: popularModels.results || [],
    topUsers: topUsers.results || [],
    tierBreakdown: tierBreakdown.results || [],
  });
});

orgAdmin.get("/api/org-admin/export/users", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const { results } = await c.env.DB.prepare(
    "SELECT id, email, full_name, department, tier, org_role, last_login, created_at FROM users WHERE org_id = ? ORDER BY created_at DESC"
  ).bind(orgId).all();

  const headers = ["id", "email", "full_name", "department", "tier", "org_role", "last_login", "created_at"];
  const csv = [headers.join(","), ...(results || []).map((r: any) =>
    headers.map(h => `"${String(r[h] || "").replace(/"/g, '""')}"`).join(",")
  )].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=org-members.csv",
    },
  });
});

orgAdmin.get("/api/org-admin/announcements", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const { results } = await c.env.DB.prepare(
    `SELECT a.*, u.full_name as admin_name
     FROM announcements a JOIN users u ON u.id = a.admin_id
     WHERE a.org_id = ?
     ORDER BY a.created_at DESC LIMIT 50`
  ).bind(orgId).all();

  return c.json({ announcements: results || [] });
});

orgAdmin.post("/api/org-admin/announcements", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const adminId = c.get("userId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const { title, content, type, dismissible, expiresAt } = await c.req.json();
  if (!title || !content) return c.json({ error: "Title and content are required" }, 400);

  const id = generateId();
  await c.env.DB.prepare(
    "INSERT INTO announcements (id, admin_id, title, content, type, dismissible, expires_at, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, adminId, title, content, type || "info", dismissible !== false ? 1 : 0, expiresAt || null, orgId).run();

  return c.json({ id, success: true });
});

orgAdmin.patch("/api/org-admin/announcements/:id", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const announcementId = c.req.param("id");
  const { active, title, content } = await c.req.json();

  const updates: string[] = [];
  const params: any[] = [];

  if (active !== undefined) { updates.push("active = ?"); params.push(active ? 1 : 0); }
  if (title !== undefined) { updates.push("title = ?"); params.push(title); }
  if (content !== undefined) { updates.push("content = ?"); params.push(content); }

  if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

  params.push(announcementId, orgId);

  await c.env.DB.prepare(
    `UPDATE announcements SET ${updates.join(", ")} WHERE id = ? AND org_id = ?`
  ).bind(...params).run();

  return c.json({ success: true });
});

orgAdmin.delete("/api/org-admin/announcements/:id", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const announcementId = c.req.param("id");
  await c.env.DB.prepare(
    "DELETE FROM announcements WHERE id = ? AND org_id = ?"
  ).bind(announcementId, orgId).run();

  return c.json({ success: true });
});

orgAdmin.get("/api/org-admin/agents", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM agents WHERE org_id = ? ORDER BY created_at DESC"
  ).bind(orgId).all();

  return c.json({ agents: results || [] });
});

orgAdmin.post("/api/org-admin/agents", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  const adminId = c.get("userId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const { name, description, system_prompt, department, knowledge_category, icon } = await c.req.json();
  if (!name || !system_prompt) {
    return c.json({ error: "Name and system_prompt are required" }, 400);
  }

  const id = generateId();
  await c.env.DB.prepare(
    "INSERT INTO agents (id, name, description, system_prompt, department, knowledge_category, icon, created_by, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, name, description || "", system_prompt, department || "", knowledge_category || "", icon || "\u{1F916}", adminId, orgId).run();

  const agent = await c.env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(id).first();
  return c.json({ agent });
});

orgAdmin.patch("/api/org-admin/agents/:id", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const agentId = c.req.param("id");
  const body = await c.req.json();

  const updates: string[] = [];
  const params: any[] = [];

  if (body.name !== undefined) { updates.push("name = ?"); params.push(body.name); }
  if (body.description !== undefined) { updates.push("description = ?"); params.push(body.description); }
  if (body.system_prompt !== undefined) { updates.push("system_prompt = ?"); params.push(body.system_prompt); }
  if (body.department !== undefined) { updates.push("department = ?"); params.push(body.department); }
  if (body.knowledge_category !== undefined) { updates.push("knowledge_category = ?"); params.push(body.knowledge_category); }
  if (body.icon !== undefined) { updates.push("icon = ?"); params.push(body.icon); }
  if (body.active !== undefined) { updates.push("active = ?"); params.push(body.active ? 1 : 0); }

  if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

  updates.push("updated_at = datetime('now')");
  params.push(agentId, orgId);

  await c.env.DB.prepare(
    `UPDATE agents SET ${updates.join(", ")} WHERE id = ? AND org_id = ?`
  ).bind(...params).run();

  const agent = await c.env.DB.prepare("SELECT * FROM agents WHERE id = ? AND org_id = ?").bind(agentId, orgId).first();
  return c.json({ agent });
});

orgAdmin.delete("/api/org-admin/agents/:id", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const agentId = c.req.param("id");
  await c.env.DB.prepare(
    "DELETE FROM agents WHERE id = ? AND org_id = ?"
  ).bind(agentId, orgId).run();

  return c.json({ success: true });
});

orgAdmin.get("/api/org-admin/kb/stats", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM knowledge_base WHERE created_by IN (SELECT id FROM users WHERE org_id = ?)"
  ).bind(orgId).first<{ count: number }>();

  return c.json({ totalDocuments: count?.count || 0 });
});

orgAdmin.get("/api/org-admin/billing", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const [org, pricing] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, name, slug, tier, max_seats, used_seats, sector, created_at FROM organizations WHERE id = ?"
    ).bind(orgId).first(),
    c.env.DB.prepare(
      "SELECT plan, seats_purchased, price_per_seat, billing_cycle, billing_started_at, billing_expires_at FROM org_pricing WHERE org_id = ?"
    ).bind(orgId).first<{ plan: string; seats_purchased: number; price_per_seat: number; billing_cycle: string; billing_started_at: string; billing_expires_at: string | null }>(),
  ]);

  if (!org) return c.json({ error: "Organisation not found" }, 404);

  const discount = pricing ? getVolumeDiscount(pricing.seats_purchased) : 0;
  const monthlyTotal = pricing ? Math.round(pricing.price_per_seat * pricing.seats_purchased * 100) / 100 : 0;

  return c.json({
    org,
    pricing: pricing || null,
    discount: Math.round(discount * 100),
    monthlyTotal,
  });
});

orgAdmin.patch("/api/org-admin/settings", orgAdminMiddleware, async (c) => {
  const orgId = c.get("orgId");
  if (!orgId) return c.json({ error: "No organisation context" }, 400);

  const body = await c.req.json();
  const updates: string[] = [];
  const params: any[] = [];

  if (body.name !== undefined) { updates.push("name = ?"); params.push(body.name); }
  if (body.logo_url !== undefined) { updates.push("logo_url = ?"); params.push(body.logo_url); }
  if (body.domain !== undefined) { updates.push("domain = ?"); params.push(body.domain); }
  if (body.sector !== undefined) { updates.push("sector = ?"); params.push(body.sector); }

  if (updates.length === 0) return c.json({ error: "No fields to update" }, 400);

  params.push(orgId);

  await c.env.DB.prepare(
    `UPDATE organizations SET ${updates.join(", ")} WHERE id = ?`
  ).bind(...params).run();

  const updated = await c.env.DB.prepare(
    "SELECT id, name, slug, tier, max_seats, used_seats, sector, logo_url, domain FROM organizations WHERE id = ?"
  ).bind(orgId).first();

  return c.json({ success: true, org: updated });
});

export default orgAdmin;
