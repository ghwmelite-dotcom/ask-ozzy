// ═══════════════════════════════════════════════════════════════════
//  AskOzzy — Super Admin Portal
// ═══════════════════════════════════════════════════════════════════

// ─── Theme (same logic as app.js) ───────────────────────────────────

(function initTheme() {
  const saved = localStorage.getItem("askozzy_theme");
  const preferLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  const theme = saved || (preferLight ? "light" : "dark");
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.classList.add("no-transition");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("no-transition");
    });
  });
})();

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("askozzy_theme", next);
}

// ─── State ──────────────────────────────────────────────────────────

const API = "";
let token = localStorage.getItem("askozzy_token");
let adminUser = null;
let currentTab = "dashboard";
let usersPage = 1;
let conversationsPage = 1;

// ─── Utility Functions ──────────────────────────────────────────────

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDateShort(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
  };
}

async function apiFetch(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (res.status === 401 || res.status === 403) {
    adminLogout();
    throw new Error("Unauthorized");
  }
  return res;
}

// ─── Markdown Rendering (simplified from app.js) ────────────────────

function renderMarkdown(text) {
  if (!text) return "";
  let html = text;
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    return "<pre><code>" + escapeHtml(code.trim()) + "</code></pre>";
  });
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/^[\-\*] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/\n\n/g, "</p><p>");
  html = html.replace(/(?<!<\/?\w+[^>]*)\n(?!<)/g, "<br>");
  if (!html.startsWith("<")) html = "<p>" + html + "</p>";
  return html;
}

// ─── Auth Check ─────────────────────────────────────────────────────

async function verifyAdmin() {
  if (!token) {
    window.location.href = "/";
    return;
  }

  try {
    const res = await fetch(API + "/api/admin/verify", { headers: authHeaders() });
    if (!res.ok) throw new Error("Not admin");
    const data = await res.json();
    adminUser = data.user;
    document.getElementById("admin-user-name").textContent = adminUser.full_name;
    document.getElementById("admin-loading").classList.add("hidden");
    document.getElementById("admin-app").classList.remove("hidden");
    loadDashboard();
  } catch {
    // Not an admin — redirect
    window.location.href = "/";
  }
}

function adminLogout() {
  fetch(API + "/api/auth/logout", { method: "POST", headers: authHeaders() }).catch(() => {});
  localStorage.removeItem("askozzy_token");
  localStorage.removeItem("askozzy_user");
  window.location.href = "/";
}

// ─── Tab Switching ──────────────────────────────────────────────────

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
  document.querySelector(`.admin-tab[data-tab="${tab}"]`).classList.add("active");
  document.querySelectorAll(".admin-tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("panel-" + tab).classList.add("active");

  // Load data for the tab
  const loaders = {
    dashboard: loadDashboard,
    users: () => loadUsers(1),
    conversations: () => loadConversations(1),
    analytics: loadAnalytics,
    referrals: loadReferrals,
    system: loadRateLimits,
    announcements: loadAnnouncements,
    moderation: () => loadModeration("pending"),
    "audit-log": () => loadAuditLog(1),
    knowledge: loadKnowledgeTab,
    "bulk-import": () => {},  // No auto-load needed
    "document-training": loadTrainingStatus,
  };
  if (loaders[tab]) loaders[tab]();
}

// ─── Pagination Helper ──────────────────────────────────────────────

function renderPagination(containerId, currentPage, totalItems, limit, loadFn) {
  const container = document.getElementById(containerId);
  const totalPages = Math.ceil(totalItems / limit);
  if (totalPages <= 1) { container.innerHTML = ""; return; }

  let html = "";
  html += '<button ' + (currentPage === 1 ? 'disabled' : '') + ' onclick="' + loadFn + '(' + (currentPage - 1) + ')">&#x2190;</button>';

  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);

  if (start > 1) {
    html += '<button onclick="' + loadFn + '(1)">1</button>';
    if (start > 2) html += '<button disabled>...</button>';
  }

  for (let i = start; i <= end; i++) {
    html += '<button class="' + (i === currentPage ? 'active' : '') + '" onclick="' + loadFn + '(' + i + ')">' + i + '</button>';
  }

  if (end < totalPages) {
    if (end < totalPages - 1) html += '<button disabled>...</button>';
    html += '<button onclick="' + loadFn + '(' + totalPages + ')">' + totalPages + '</button>';
  }

  html += '<button ' + (currentPage === totalPages ? 'disabled' : '') + ' onclick="' + loadFn + '(' + (currentPage + 1) + ')">&#x2192;</button>';

  container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Dashboard
// ═══════════════════════════════════════════════════════════════════

async function loadDashboard() {
  const el = document.getElementById("dashboard-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    const res = await apiFetch("/api/admin/dashboard");
    const d = await res.json();

    const tierMap = {};
    (d.tierDistribution || []).forEach(t => { tierMap[t.tier] = t.count; });
    const totalForTier = d.totalUsers || 1;

    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${d.totalUsers}</div>
          <div class="stat-label">Total Users</div>
        </div>
        <div class="stat-card green">
          <div class="stat-value">${d.usersToday}</div>
          <div class="stat-label">New Today</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${d.totalConversations}</div>
          <div class="stat-label">Conversations</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${d.messagesToday}</div>
          <div class="stat-label">Messages Today</div>
        </div>
        <div class="stat-card green">
          <div class="stat-value">${d.active24h}</div>
          <div class="stat-label">Active (24h)</div>
        </div>
      </div>

      <div class="admin-row">
        <div class="admin-card">
          <h3>Tier Distribution</h3>
          <div class="bar-chart">
            ${["free", "starter", "professional", "enterprise"].map(tier => {
              const count = tierMap[tier] || 0;
              const pct = totalForTier > 0 ? (count / totalForTier * 100) : 0;
              return '<div class="bar-row">' +
                '<span class="bar-label">' + tier.charAt(0).toUpperCase() + tier.slice(1) + '</span>' +
                '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(pct, 1) + '%"></div></div>' +
                '<span class="bar-value">' + count + '</span>' +
                '</div>';
            }).join("")}
          </div>
        </div>
        <div class="admin-card">
          <h3>Recent Signups</h3>
          ${d.recentSignups.length === 0 ? '<div class="admin-empty">No signups yet</div>' :
            '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Tier</th><th>Date</th></tr></thead><tbody>' +
            d.recentSignups.map(u =>
              '<tr><td>' + escapeHtml(u.full_name) + '</td><td>' + escapeHtml(u.email) + '</td><td><span class="badge badge-' + u.tier + '">' + u.tier + '</span></td><td>' + formatDateShort(u.created_at) + '</td></tr>'
            ).join("") +
            '</tbody></table></div>'
          }
        </div>
      </div>
    `;
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load dashboard</div>';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Users
// ═══════════════════════════════════════════════════════════════════

const debouncedUserSearch = debounce(() => loadUsers(1), 400);

async function loadUsers(page) {
  usersPage = page || 1;
  const el = document.getElementById("users-content");
  const search = document.getElementById("user-search").value.trim();
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    const params = new URLSearchParams({ page: usersPage, limit: 20 });
    if (search) params.set("search", search);

    const res = await apiFetch("/api/admin/users?" + params.toString());
    const d = await res.json();

    document.getElementById("user-count").textContent = d.total + " total users";

    if (d.users.length === 0) {
      el.innerHTML = '<div class="admin-empty">No users found</div>';
      document.getElementById("users-pagination").innerHTML = "";
      return;
    }

    el.innerHTML = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
      '<th>Name</th><th>Email</th><th>Department</th><th>Tier</th><th>Role</th><th>Referrals</th><th>Joined</th><th>Actions</th>' +
      '</tr></thead><tbody>' +
      d.users.map(u => {
        const isSelf = u.id === adminUser.id;
        return '<tr>' +
          '<td>' + escapeHtml(u.full_name) + '</td>' +
          '<td>' + escapeHtml(u.email) + '</td>' +
          '<td>' + escapeHtml(u.department || '—') + '</td>' +
          '<td><select class="inline-select" onchange="changeTier(\'' + u.id + '\', this.value)" ' + '>' +
            ['free','starter','professional','enterprise'].map(t =>
              '<option value="' + t + '"' + (t === u.tier ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>'
            ).join('') +
          '</select></td>' +
          '<td><select class="inline-select" onchange="changeRole(\'' + u.id + '\', this.value)"' + (isSelf ? ' disabled title="Cannot change own role"' : '') + '>' +
            ['civil_servant','super_admin'].map(r =>
              '<option value="' + r + '"' + (r === u.role ? ' selected' : '') + '>' + (r === 'super_admin' ? 'Admin' : 'User') + '</option>'
            ).join('') +
          '</select></td>' +
          '<td>' + (u.total_referrals || 0) + '</td>' +
          '<td>' + formatDateShort(u.created_at) + '</td>' +
          '<td>' + (isSelf ? '<span style="font-size:11px;color:var(--text-muted);">You</span>' :
            '<button class="btn-action danger" onclick="deleteUser(\'' + u.id + '\', \'' + escapeHtml(u.email) + '\')">Delete</button>') +
          '</td>' +
        '</tr>';
      }).join("") +
      '</tbody></table></div>';

    renderPagination("users-pagination", usersPage, d.total, 20, "loadUsers");
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load users</div>';
  }
}

async function changeTier(userId, tier) {
  try {
    const res = await apiFetch("/api/admin/users/" + userId + "/tier", {
      method: "PATCH",
      body: JSON.stringify({ tier }),
    });
    if (!res.ok) {
      const d = await res.json();
      alert(d.error || "Failed to change tier");
      loadUsers(usersPage);
    }
  } catch {
    alert("Failed to change tier");
    loadUsers(usersPage);
  }
}

async function changeRole(userId, role) {
  try {
    const res = await apiFetch("/api/admin/users/" + userId + "/role", {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const d = await res.json();
      alert(d.error || "Failed to change role");
      loadUsers(usersPage);
    }
  } catch {
    alert("Failed to change role");
    loadUsers(usersPage);
  }
}

async function deleteUser(userId, email) {
  if (!confirm("Delete user " + email + " and ALL their data?\n\nThis cannot be undone.")) return;

  try {
    const res = await apiFetch("/api/admin/users/" + userId, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json();
      alert(d.error || "Failed to delete user");
    } else {
      loadUsers(usersPage);
    }
  } catch {
    alert("Failed to delete user");
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Conversations
// ═══════════════════════════════════════════════════════════════════

async function loadConversations(page) {
  conversationsPage = page || 1;
  const el = document.getElementById("conversations-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    const res = await apiFetch("/api/admin/conversations?page=" + conversationsPage + "&limit=20");
    const d = await res.json();

    if (d.conversations.length === 0) {
      el.innerHTML = '<div class="admin-empty">No conversations yet</div>';
      document.getElementById("conversations-pagination").innerHTML = "";
      return;
    }

    el.innerHTML = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
      '<th>Title</th><th>User</th><th>Model</th><th>Messages</th><th>Updated</th><th>Actions</th>' +
      '</tr></thead><tbody>' +
      d.conversations.map(c => {
        const modelShort = (c.model || "").split("/").pop() || "—";
        return '<tr>' +
          '<td>' + escapeHtml(c.title || 'Untitled') + '</td>' +
          '<td>' + escapeHtml(c.user_name) + '<br><span style="font-size:10px;color:var(--text-muted);">' + escapeHtml(c.user_email) + '</span></td>' +
          '<td style="font-size:11px;">' + escapeHtml(modelShort) + '</td>' +
          '<td>' + c.message_count + '</td>' +
          '<td>' + formatDateShort(c.updated_at) + '</td>' +
          '<td style="display:flex;gap:6px;">' +
            '<button class="btn-action" onclick="viewMessages(\'' + c.id + '\')">View</button>' +
            '<button class="btn-action danger" onclick="deleteConversation(\'' + c.id + '\')">Delete</button>' +
          '</td>' +
        '</tr>';
      }).join("") +
      '</tbody></table></div>';

    renderPagination("conversations-pagination", conversationsPage, d.total, 20, "loadConversations");
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load conversations</div>';
  }
}

async function viewMessages(convoId) {
  const modal = document.getElementById("message-modal");
  const body = document.getElementById("message-modal-body");
  body.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';
  modal.classList.add("active");

  try {
    const res = await apiFetch("/api/admin/conversations/" + convoId + "/messages");
    const d = await res.json();

    document.getElementById("message-modal-title").textContent = d.conversation.title || "Conversation";
    document.getElementById("message-modal-subtitle").textContent =
      d.conversation.user_name + " (" + d.conversation.user_email + ")";

    if (d.messages.length === 0) {
      body.innerHTML = '<div class="admin-empty">No messages in this conversation</div>';
      return;
    }

    body.innerHTML = '<div class="message-viewer">' +
      d.messages.map(m => {
        const isUser = m.role === "user";
        return '<div class="viewer-msg ' + m.role + '">' +
          '<div class="viewer-avatar">' + (isUser ? 'U' : 'G') + '</div>' +
          '<div class="viewer-body">' +
            '<div class="viewer-role">' + (isUser ? 'User' : 'Ozzy') + '</div>' +
            '<div class="viewer-content">' + (isUser ? escapeHtml(m.content) : renderMarkdown(m.content)) + '</div>' +
            '<div class="viewer-time">' + formatDate(m.created_at) + '</div>' +
          '</div>' +
        '</div>';
      }).join("") +
    '</div>';
  } catch {
    body.innerHTML = '<div class="admin-empty">Failed to load messages</div>';
  }
}

function closeMessageModal() {
  document.getElementById("message-modal").classList.remove("active");
}

document.getElementById("message-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeMessageModal();
});

async function deleteConversation(convoId) {
  if (!confirm("Delete this conversation and all its messages?")) return;

  try {
    const res = await apiFetch("/api/admin/conversations/" + convoId, { method: "DELETE" });
    if (res.ok) {
      loadConversations(conversationsPage);
    } else {
      alert("Failed to delete conversation");
    }
  } catch {
    alert("Failed to delete conversation");
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Analytics
// ═══════════════════════════════════════════════════════════════════

async function loadAnalytics() {
  const el = document.getElementById("analytics-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    const res = await apiFetch("/api/admin/analytics");
    const d = await res.json();

    const maxMsgs = Math.max(...(d.messagesPerDay || []).map(r => r.count), 1);
    const maxSignups = Math.max(...(d.signupsPerDay || []).map(r => r.count), 1);
    const maxModelUse = Math.max(...(d.modelUsage || []).map(r => r.count), 1);

    el.innerHTML = `
      <div class="admin-row">
        <div class="admin-card">
          <h3>Messages per Day (Last 7 Days)</h3>
          ${(d.messagesPerDay || []).length === 0 ? '<div class="admin-empty">No data yet</div>' :
            '<div class="bar-chart">' +
            d.messagesPerDay.map(r =>
              '<div class="bar-row">' +
                '<span class="bar-label">' + formatDateShort(r.day) + '</span>' +
                '<div class="bar-track"><div class="bar-fill" style="width:' + (r.count / maxMsgs * 100) + '%"></div></div>' +
                '<span class="bar-value">' + r.count + '</span>' +
              '</div>'
            ).join("") +
            '</div>'
          }
        </div>
        <div class="admin-card">
          <h3>Signups per Day (Last 7 Days)</h3>
          ${(d.signupsPerDay || []).length === 0 ? '<div class="admin-empty">No data yet</div>' :
            '<div class="bar-chart">' +
            d.signupsPerDay.map(r =>
              '<div class="bar-row">' +
                '<span class="bar-label">' + formatDateShort(r.day) + '</span>' +
                '<div class="bar-track"><div class="bar-fill green" style="width:' + (r.count / maxSignups * 100) + '%"></div></div>' +
                '<span class="bar-value">' + r.count + '</span>' +
              '</div>'
            ).join("") +
            '</div>'
          }
        </div>
      </div>

      <div class="admin-row">
        <div class="admin-card">
          <h3>Model Usage</h3>
          ${(d.modelUsage || []).length === 0 ? '<div class="admin-empty">No data yet</div>' :
            '<div class="bar-chart">' +
            d.modelUsage.map(r => {
              const name = (r.model || "").split("/").pop() || "unknown";
              return '<div class="bar-row">' +
                '<span class="bar-label" title="' + escapeHtml(r.model) + '">' + escapeHtml(name) + '</span>' +
                '<div class="bar-track"><div class="bar-fill" style="width:' + (r.count / maxModelUse * 100) + '%"></div></div>' +
                '<span class="bar-value">' + r.count + '</span>' +
              '</div>';
            }).join("") +
            '</div>'
          }
        </div>
        <div class="admin-card">
          <h3>Top Users by Messages</h3>
          ${(d.topUsers || []).length === 0 ? '<div class="admin-empty">No data yet</div>' :
            '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Messages</th></tr></thead><tbody>' +
            d.topUsers.map((u, i) =>
              '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(u.full_name) + '</td><td>' + escapeHtml(u.email) + '</td><td><strong>' + u.message_count + '</strong></td></tr>'
            ).join("") +
            '</tbody></table></div>'
          }
        </div>
      </div>
    `;
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load analytics</div>';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Referrals
// ═══════════════════════════════════════════════════════════════════

async function loadReferrals() {
  const el = document.getElementById("referrals-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    const res = await apiFetch("/api/admin/referrals");
    const d = await res.json();

    el.innerHTML = `
      <div class="stats-grid" style="margin-bottom:24px;">
        <div class="stat-card">
          <div class="stat-value">${d.totalReferrals}</div>
          <div class="stat-label">Total Referrals</div>
        </div>
        <div class="stat-card green">
          <div class="stat-value">GHS ${(d.totalEarnings || 0).toFixed(2)}</div>
          <div class="stat-label">Total Paid Out</div>
        </div>
      </div>

      <div class="admin-row">
        <div class="admin-card">
          <h3>Top Referrers</h3>
          ${(d.topReferrers || []).length === 0 ? '<div class="admin-empty">No referrers yet</div>' :
            '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Tier</th><th>Referrals</th><th>Earnings</th></tr></thead><tbody>' +
            d.topReferrers.map(r =>
              '<tr><td>' + escapeHtml(r.full_name) + '</td><td>' + escapeHtml(r.email) + '</td><td><span class="badge badge-' + (r.affiliate_tier || 'starter') + '">' + (r.affiliate_tier || 'starter') + '</span></td><td>' + r.total_referrals + '</td><td>GHS ' + (r.affiliate_earnings || 0).toFixed(2) + '</td></tr>'
            ).join("") +
            '</tbody></table></div>'
          }
        </div>
        <div class="admin-card">
          <h3>Recent Referrals</h3>
          ${(d.recentReferrals || []).length === 0 ? '<div class="admin-empty">No referrals yet</div>' :
            '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr><th>Referrer</th><th>Referred</th><th>Bonus</th><th>Date</th></tr></thead><tbody>' +
            d.recentReferrals.map(r =>
              '<tr><td>' + escapeHtml(r.referrer_name) + '</td><td>' + escapeHtml(r.referred_name) + '</td><td>GHS ' + (r.bonus_amount || 0).toFixed(2) + '</td><td>' + formatDateShort(r.created_at) + '</td></tr>'
            ).join("") +
            '</tbody></table></div>'
          }
        </div>
      </div>
    `;
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load referrals</div>';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: System — Promote User
// ═══════════════════════════════════════════════════════════════════

async function promoteUser() {
  const email = document.getElementById("promote-email").value.trim();
  const resultEl = document.getElementById("promote-result");
  if (!email) {
    resultEl.innerHTML = '<span class="msg-error">Please enter an email</span>';
    return;
  }

  try {
    const res = await apiFetch("/api/admin/promote", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    const d = await res.json();
    if (!res.ok) {
      resultEl.innerHTML = '<span class="msg-error">' + escapeHtml(d.error) + '</span>';
    } else {
      resultEl.innerHTML = '<span class="msg-success">' + escapeHtml(d.message) + '</span>';
      document.getElementById("promote-email").value = "";
    }
  } catch {
    resultEl.innerHTML = '<span class="msg-error">Failed to promote user</span>';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Announcements
// ═══════════════════════════════════════════════════════════════════

async function loadAnnouncements() {
  const el = document.getElementById("announcements-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    const res = await apiFetch("/api/admin/announcements");
    const d = await res.json();
    const announcements = d.announcements || d || [];

    if (announcements.length === 0) {
      el.innerHTML = '<div class="admin-empty">No announcements yet</div>';
      return;
    }

    el.innerHTML = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
      '<th>Title</th><th>Content</th><th>Type</th><th>Active</th><th>Created</th><th>Expires</th><th>Actions</th>' +
      '</tr></thead><tbody>' +
      announcements.map(a => {
        return '<tr>' +
          '<td>' + escapeHtml(a.title) + '</td>' +
          '<td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(a.content) + '</td>' +
          '<td><span class="type-badge type-' + (a.type || 'info') + '">' + (a.type || 'info') + '</span></td>' +
          '<td>' +
            '<button class="btn-action' + (a.is_active ? ' primary' : '') + '" onclick="toggleAnnouncement(\'' + a.id + '\', ' + (a.is_active ? 'false' : 'true') + ')">' +
              (a.is_active ? 'Active' : 'Inactive') +
            '</button>' +
          '</td>' +
          '<td>' + formatDateShort(a.created_at) + '</td>' +
          '<td>' + (a.expires_at ? formatDateShort(a.expires_at) : '—') + '</td>' +
          '<td><button class="btn-action danger" onclick="deleteAnnouncement(\'' + a.id + '\')">Delete</button></td>' +
        '</tr>';
      }).join("") +
      '</tbody></table></div>';
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load announcements</div>';
  }
}

async function createAnnouncement() {
  const title = document.getElementById("announce-title").value.trim();
  const content = document.getElementById("announce-content").value.trim();
  const type = document.getElementById("announce-type").value;
  const dismissible = document.getElementById("announce-dismissible").checked;
  const expiresAt = document.getElementById("announce-expires").value || null;
  const resultEl = document.getElementById("announce-result");

  if (!title || !content) {
    resultEl.innerHTML = '<span class="msg-error">Title and content are required</span>';
    return;
  }

  try {
    const res = await apiFetch("/api/admin/announcements", {
      method: "POST",
      body: JSON.stringify({ title, content, type, dismissible, expires_at: expiresAt }),
    });
    const d = await res.json();
    if (!res.ok) {
      resultEl.innerHTML = '<span class="msg-error">' + escapeHtml(d.error || "Failed to create") + '</span>';
    } else {
      resultEl.innerHTML = '<span class="msg-success">Announcement published</span>';
      document.getElementById("announce-title").value = "";
      document.getElementById("announce-content").value = "";
      document.getElementById("announce-expires").value = "";
      loadAnnouncements();
    }
  } catch {
    resultEl.innerHTML = '<span class="msg-error">Failed to create announcement</span>';
  }
}

async function toggleAnnouncement(id, active) {
  try {
    await apiFetch("/api/admin/announcements/" + id, {
      method: "PATCH",
      body: JSON.stringify({ is_active: active }),
    });
    loadAnnouncements();
  } catch {
    alert("Failed to toggle announcement");
  }
}

async function deleteAnnouncement(id) {
  if (!confirm("Delete this announcement?")) return;
  try {
    const res = await apiFetch("/api/admin/announcements/" + id, { method: "DELETE" });
    if (res.ok) {
      loadAnnouncements();
    } else {
      alert("Failed to delete announcement");
    }
  } catch {
    alert("Failed to delete announcement");
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Moderation
// ═══════════════════════════════════════════════════════════════════

let currentModerationStatus = "pending";

async function loadModeration(status) {
  currentModerationStatus = status || "pending";

  // Update sub-tab active state
  document.querySelectorAll(".mod-tab").forEach(t => t.classList.remove("active"));
  const activeTab = document.querySelector('.mod-tab[data-status="' + currentModerationStatus + '"]');
  if (activeTab) activeTab.classList.add("active");

  const statsEl = document.getElementById("moderation-stats");
  const el = document.getElementById("moderation-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    // Load stats and flags in parallel
    const [statsRes, flagsRes] = await Promise.all([
      apiFetch("/api/admin/moderation/stats"),
      apiFetch("/api/admin/moderation?status=" + currentModerationStatus),
    ]);

    const statsData = await statsRes.json();
    const flagsData = await flagsRes.json();

    const stats = statsData.stats || statsData;
    const flags = flagsData.flags || flagsData || [];

    // Render stats cards
    statsEl.innerHTML = '<div class="stats-grid">' +
      '<div class="stat-card"><div class="stat-value">' + (stats.pending || 0) + '</div><div class="stat-label">Pending</div></div>' +
      '<div class="stat-card green"><div class="stat-value">' + (stats.reviewed || 0) + '</div><div class="stat-label">Reviewed</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (stats.dismissed || 0) + '</div><div class="stat-label">Dismissed</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (stats.total || 0) + '</div><div class="stat-label">Total Flags</div></div>' +
    '</div>';

    // Render flags table
    if (flags.length === 0) {
      el.innerHTML = '<div class="admin-empty">No ' + currentModerationStatus + ' flags</div>';
      return;
    }

    el.innerHTML = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
      '<th>Reason</th><th>User</th><th>Conversation</th><th>Message Preview</th><th>Date</th><th>Actions</th>' +
      '</tr></thead><tbody>' +
      flags.map(f => {
        const preview = (f.message_content || f.message_preview || "").substring(0, 80);
        return '<tr>' +
          '<td><span class="type-badge type-warning">' + escapeHtml(f.reason || f.flag_reason || '—') + '</span></td>' +
          '<td>' + escapeHtml(f.user_name || f.user_email || '—') + '</td>' +
          '<td>' + escapeHtml(f.conversation_title || '—') + '</td>' +
          '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text-muted);">' + escapeHtml(preview) + '</td>' +
          '<td>' + formatDateShort(f.created_at) + '</td>' +
          '<td style="display:flex;gap:6px;">' +
            (currentModerationStatus === "pending" ?
              '<button class="btn-action primary" onclick="reviewFlag(\'' + f.id + '\', \'reviewed\')">Review</button>' +
              '<button class="btn-action" onclick="reviewFlag(\'' + f.id + '\', \'dismissed\')">Dismiss</button>'
            : '<span style="font-size:11px;color:var(--text-muted);text-transform:capitalize;">' + (f.status || currentModerationStatus) + '</span>') +
          '</td>' +
        '</tr>';
      }).join("") +
      '</tbody></table></div>';
  } catch (err) {
    statsEl.innerHTML = '';
    el.innerHTML = '<div class="admin-empty">Failed to load moderation data</div>';
  }
}

function switchModerationStatus(status) {
  loadModeration(status);
}

async function reviewFlag(flagId, action) {
  try {
    const res = await apiFetch("/api/admin/moderation/" + flagId, {
      method: "PATCH",
      body: JSON.stringify({ status: action }),
    });
    if (res.ok) {
      loadModeration(currentModerationStatus);
    } else {
      alert("Failed to update flag");
    }
  } catch {
    alert("Failed to update flag");
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Audit Log
// ═══════════════════════════════════════════════════════════════════

let auditLogPage = 1;

async function loadAuditLog(page) {
  auditLogPage = page || 1;
  const el = document.getElementById("audit-log-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    const res = await apiFetch("/api/admin/audit-log?page=" + auditLogPage + "&limit=50");
    const d = await res.json();
    const logs = d.logs || d.entries || d || [];
    const total = d.total || logs.length;

    if (logs.length === 0) {
      el.innerHTML = '<div class="admin-empty">No audit log entries</div>';
      document.getElementById("audit-log-pagination").innerHTML = "";
      return;
    }

    el.innerHTML = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
      '<th>Admin</th><th>Action</th><th>Target Type</th><th>Target ID</th><th>Details</th><th>Timestamp</th>' +
      '</tr></thead><tbody>' +
      logs.map(entry => {
        const details = typeof entry.details === "object" ? JSON.stringify(entry.details) : (entry.details || '—');
        return '<tr>' +
          '<td>' + escapeHtml(entry.admin_name || entry.admin_email || '—') + '</td>' +
          '<td><span class="audit-action">' + escapeHtml(entry.action || '—') + '</span></td>' +
          '<td>' + escapeHtml(entry.target_type || '—') + '</td>' +
          '<td style="font-size:11px;font-family:monospace;color:var(--text-muted);">' + escapeHtml(entry.target_id || '—') + '</td>' +
          '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">' + escapeHtml(details) + '</td>' +
          '<td>' + formatDate(entry.created_at || entry.timestamp) + '</td>' +
        '</tr>';
      }).join("") +
      '</tbody></table></div>';

    renderPagination("audit-log-pagination", auditLogPage, total, 50, "loadAuditLog");
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load audit log</div>';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Organizations
// ═══════════════════════════════════════════════════════════════════

async function loadOrganizations() {
  try {
    const res = await apiFetch("/api/admin/organizations");
    const d = await res.json();
    const orgs = d.organizations || d || [];

    if (orgs.length === 0) return '<div class="admin-empty">No organizations yet</div>';

    return '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
      '<th>Organization</th><th>Owner</th><th>Members</th><th>Tier</th><th>Created</th>' +
      '</tr></thead><tbody>' +
      orgs.map(o =>
        '<tr>' +
          '<td>' + escapeHtml(o.name) + '</td>' +
          '<td>' + escapeHtml(o.owner_name || o.owner_email || '—') + '</td>' +
          '<td>' + (o.member_count || 0) + '</td>' +
          '<td><span class="badge badge-' + (o.tier || 'free') + '">' + (o.tier || 'free') + '</span></td>' +
          '<td>' + formatDateShort(o.created_at) + '</td>' +
        '</tr>'
      ).join("") +
      '</tbody></table></div>';
  } catch {
    return '<div class="admin-empty">Failed to load organizations</div>';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  CSV Export
// ═══════════════════════════════════════════════════════════════════

async function exportCSV(type) {
  try {
    const res = await apiFetch("/api/admin/export/" + type);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Export failed");
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "askozzy-" + type + "-" + new Date().toISOString().split("T")[0] + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch {
    alert("Failed to export " + type);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Rate Limits
// ═══════════════════════════════════════════════════════════════════

async function loadRateLimits() {
  const el = document.getElementById("rate-limits-content");
  if (!el) return;
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    const res = await apiFetch("/api/admin/rate-limits");
    const d = await res.json();
    const tiers = d.tiers || d.tierConfigs || [];
    const heavyUsers = d.heavyUsers || d.heavy_users || [];

    let html = '';

    if (tiers.length > 0) {
      html += '<h4 style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Tier Limits</h4>' +
        '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
        '<th>Tier</th><th>Limit</th><th>Window</th>' +
        '</tr></thead><tbody>' +
        tiers.map(t =>
          '<tr><td><span class="badge badge-' + (t.tier || 'free') + '">' + (t.tier || t.name || '—') + '</span></td>' +
          '<td>' + (t.limit || t.max_requests || '—') + '</td>' +
          '<td>' + (t.window || t.window_seconds || '—') + '</td></tr>'
        ).join("") +
        '</tbody></table></div>';
    }

    if (heavyUsers.length > 0) {
      html += '<h4 style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 10px;">Heavy Users Today</h4>' +
        '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
        '<th>User</th><th>Requests</th>' +
        '</tr></thead><tbody>' +
        heavyUsers.map(u =>
          '<tr><td>' + escapeHtml(u.name || u.email || '—') + '</td><td><strong>' + (u.count || u.requests || 0) + '</strong></td></tr>'
        ).join("") +
        '</tbody></table></div>';
    }

    if (!html) html = '<div style="font-size:13px;color:var(--text-muted);">No rate limit data available</div>';

    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Rate limit info unavailable</div>';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Knowledge Base
// ═══════════════════════════════════════════════════════════════════

let documentsPage = 1;
let faqPage = 1;
let currentKbTab = "documents";

function loadKnowledgeTab() {
  loadKbStats();
  if (currentKbTab === "documents") {
    loadDocuments(1);
  } else {
    loadFaqEntries(1);
  }
}

function switchKbTab(tab) {
  currentKbTab = tab;
  document.querySelectorAll("#kb-sub-tabs .mod-tab").forEach(t => t.classList.remove("active"));
  const activeTab = document.querySelector('#kb-sub-tabs .mod-tab[data-kbtab="' + tab + '"]');
  if (activeTab) activeTab.classList.add("active");

  document.getElementById("kb-documents-panel").style.display = tab === "documents" ? "block" : "none";
  document.getElementById("kb-faq-panel").style.display = tab === "faq" ? "block" : "none";

  if (tab === "documents") {
    loadDocuments(1);
  } else {
    loadFaqEntries(1);
  }
}

async function loadKbStats() {
  const el = document.getElementById("kb-stats");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    const res = await apiFetch("/api/admin/kb/stats");
    const d = await res.json();

    el.innerHTML = '<div class="stats-grid">' +
      '<div class="stat-card"><div class="stat-value">' + (d.documents || 0) + '</div><div class="stat-label">Documents</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (d.chunks || 0) + '</div><div class="stat-label">Chunks</div></div>' +
      '<div class="stat-card green"><div class="stat-value">' + (d.readyDocs || 0) + '</div><div class="stat-label">Ready</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (d.faqs || 0) + '</div><div class="stat-label">FAQ Entries</div></div>' +
    '</div>';
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load KB stats</div>';
  }
}

function updateDocCharCount() {
  const textarea = document.getElementById("doc-content");
  const counter = document.getElementById("doc-char-count");
  const len = textarea.value.length;
  counter.textContent = len.toLocaleString() + " / 100,000";
  counter.style.color = len > 100000 ? "var(--red)" : "var(--text-muted)";
}

async function uploadDocument() {
  const title = document.getElementById("doc-title").value.trim();
  const source = document.getElementById("doc-source").value.trim();
  const category = document.getElementById("doc-category").value;
  const content = document.getElementById("doc-content").value.trim();
  const resultEl = document.getElementById("doc-upload-result");

  if (!title) {
    resultEl.innerHTML = '<span class="msg-error">Title is required</span>';
    return;
  }
  if (!content || content.length < 50) {
    resultEl.innerHTML = '<span class="msg-error">Content must be at least 50 characters</span>';
    return;
  }
  if (content.length > 100000) {
    resultEl.innerHTML = '<span class="msg-error">Content exceeds 100,000 character limit</span>';
    return;
  }

  resultEl.innerHTML = '<span style="color:var(--gold);">Uploading...</span>';

  try {
    const res = await apiFetch("/api/admin/documents", {
      method: "POST",
      body: JSON.stringify({ title, source, category, content }),
    });
    const d = await res.json();
    if (!res.ok) {
      resultEl.innerHTML = '<span class="msg-error">' + escapeHtml(d.error || "Upload failed") + '</span>';
    } else {
      resultEl.innerHTML = '<span class="msg-success">Document uploaded! Processing embeddings...</span>';
      document.getElementById("doc-title").value = "";
      document.getElementById("doc-source").value = "";
      document.getElementById("doc-content").value = "";
      updateDocCharCount();
      loadKbStats();
      loadDocuments(1);
    }
  } catch {
    resultEl.innerHTML = '<span class="msg-error">Failed to upload document</span>';
  }
}

async function loadDocuments(page) {
  documentsPage = page || 1;
  const el = document.getElementById("documents-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    const res = await apiFetch("/api/admin/documents?page=" + documentsPage + "&limit=20");
    const d = await res.json();

    if ((d.documents || []).length === 0) {
      el.innerHTML = '<div class="admin-empty">No documents uploaded yet</div>';
      document.getElementById("documents-pagination").innerHTML = "";
      return;
    }

    const statusIcons = {
      ready: '<span style="color:var(--green-light);font-weight:600;">Ready</span>',
      processing: '<span style="color:var(--gold);font-weight:600;">Processing...</span>',
      error: '<span style="color:var(--red);font-weight:600;">Error</span>',
    };

    el.innerHTML = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
      '<th>Title</th><th>Source</th><th>Category</th><th>Chunks</th><th>Status</th><th>Uploaded By</th><th>Date</th><th>Actions</th>' +
      '</tr></thead><tbody>' +
      d.documents.map(function(doc) {
        return '<tr>' +
          '<td>' + escapeHtml(doc.title) + '</td>' +
          '<td>' + escapeHtml(doc.source || '—') + '</td>' +
          '<td><span class="type-badge type-info">' + escapeHtml(doc.category || 'general') + '</span></td>' +
          '<td>' + (doc.chunk_count || 0) + '</td>' +
          '<td>' + (statusIcons[doc.status] || doc.status) + '</td>' +
          '<td>' + escapeHtml(doc.uploaded_by_name || '—') + '</td>' +
          '<td>' + formatDateShort(doc.created_at) + '</td>' +
          '<td><button class="btn-action danger" onclick="deleteDocument(\'' + doc.id + '\', \'' + escapeHtml(doc.title).replace(/'/g, "\\'") + '\')">Delete</button></td>' +
        '</tr>';
      }).join("") +
      '</tbody></table></div>';

    renderPagination("documents-pagination", documentsPage, d.total, 20, "loadDocuments");
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load documents</div>';
  }
}

async function deleteDocument(id, title) {
  if (!confirm("Delete document \"" + title + "\" and all its vector embeddings?\n\nThis cannot be undone.")) return;

  try {
    const res = await apiFetch("/api/admin/documents/" + id, { method: "DELETE" });
    if (res.ok) {
      loadKbStats();
      loadDocuments(documentsPage);
    } else {
      alert("Failed to delete document");
    }
  } catch {
    alert("Failed to delete document");
  }
}

async function createFaqEntry() {
  const category = document.getElementById("faq-category").value;
  const question = document.getElementById("faq-question").value.trim();
  const answer = document.getElementById("faq-answer").value.trim();
  const keywords = document.getElementById("faq-keywords").value.trim();
  const priority = parseInt(document.getElementById("faq-priority").value) || 0;
  const resultEl = document.getElementById("faq-create-result");

  if (!question) {
    resultEl.innerHTML = '<span class="msg-error">Question is required</span>';
    return;
  }
  if (!answer) {
    resultEl.innerHTML = '<span class="msg-error">Answer is required</span>';
    return;
  }

  try {
    const res = await apiFetch("/api/admin/kb", {
      method: "POST",
      body: JSON.stringify({ category, question, answer, keywords, priority }),
    });
    const d = await res.json();
    if (!res.ok) {
      resultEl.innerHTML = '<span class="msg-error">' + escapeHtml(d.error || "Failed to create") + '</span>';
    } else {
      resultEl.innerHTML = '<span class="msg-success">FAQ entry created</span>';
      document.getElementById("faq-question").value = "";
      document.getElementById("faq-answer").value = "";
      document.getElementById("faq-keywords").value = "";
      document.getElementById("faq-priority").value = "0";
      loadKbStats();
      loadFaqEntries(1);
    }
  } catch {
    resultEl.innerHTML = '<span class="msg-error">Failed to create FAQ entry</span>';
  }
}

async function loadFaqEntries(page) {
  faqPage = page || 1;
  const el = document.getElementById("faq-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    const res = await apiFetch("/api/admin/kb?page=" + faqPage + "&limit=20");
    const d = await res.json();
    const entries = d.entries || [];

    if (entries.length === 0) {
      el.innerHTML = '<div class="admin-empty">No FAQ entries yet</div>';
      document.getElementById("faq-pagination").innerHTML = "";
      return;
    }

    el.innerHTML = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
      '<th>Category</th><th>Question</th><th>Answer</th><th>Keywords</th><th>Priority</th><th>Active</th><th>Actions</th>' +
      '</tr></thead><tbody>' +
      entries.map(function(faq) {
        const answerPreview = (faq.answer || "").length > 80 ? faq.answer.substring(0, 80) + "..." : faq.answer;
        return '<tr>' +
          '<td><span class="type-badge type-info">' + escapeHtml(faq.category || 'general') + '</span></td>' +
          '<td style="max-width:200px;">' + escapeHtml(faq.question) + '</td>' +
          '<td style="max-width:250px;font-size:12px;color:var(--text-muted);">' + escapeHtml(answerPreview) + '</td>' +
          '<td style="font-size:11px;color:var(--text-muted);">' + escapeHtml(faq.keywords || '—') + '</td>' +
          '<td>' + (faq.priority || 0) + '</td>' +
          '<td><button class="btn-action' + (faq.active ? ' primary' : '') + '" onclick="toggleFaq(\'' + faq.id + '\', ' + (faq.active ? 'false' : 'true') + ')">' + (faq.active ? 'Active' : 'Inactive') + '</button></td>' +
          '<td><button class="btn-action danger" onclick="deleteFaq(\'' + faq.id + '\')">Delete</button></td>' +
        '</tr>';
      }).join("") +
      '</tbody></table></div>';

    renderPagination("faq-pagination", faqPage, d.total, 20, "loadFaqEntries");
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load FAQ entries</div>';
  }
}

async function toggleFaq(id, active) {
  try {
    await apiFetch("/api/admin/kb/" + id, {
      method: "PATCH",
      body: JSON.stringify({ active: active }),
    });
    loadFaqEntries(faqPage);
  } catch {
    alert("Failed to toggle FAQ status");
  }
}

async function deleteFaq(id) {
  if (!confirm("Delete this FAQ entry?")) return;
  try {
    const res = await apiFetch("/api/admin/kb/" + id, { method: "DELETE" });
    if (res.ok) {
      loadKbStats();
      loadFaqEntries(faqPage);
    } else {
      alert("Failed to delete FAQ entry");
    }
  } catch {
    alert("Failed to delete FAQ entry");
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Bulk Import
// ═══════════════════════════════════════════════════════════════════

let bulkUsers = [];

function parseBulkCSV() {
  const fileInput = document.getElementById("bulk-csv-file");
  const file = fileInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const lines = text.split("\n").map(l => l.trim()).filter(l => l);

    if (lines.length < 2) {
      alert("CSV must have a header row and at least one data row");
      return;
    }

    // Parse header
    const headerLine = lines[0].toLowerCase();
    const headers = headerLine.split(",").map(h => h.trim().replace(/['"]/g, ""));
    const emailIdx = headers.findIndex(h => h.includes("email"));
    const nameIdx = headers.findIndex(h => h.includes("name") || h.includes("full"));
    const deptIdx = headers.findIndex(h => h.includes("dept") || h.includes("department") || h.includes("mda"));

    if (emailIdx === -1 || nameIdx === -1) {
      alert("CSV must have columns for email and name (full_name or fullName)");
      return;
    }

    bulkUsers = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map(c => c.trim().replace(/^["']|["']$/g, ""));
      if (cols[emailIdx] && cols[nameIdx]) {
        bulkUsers.push({
          email: cols[emailIdx],
          fullName: cols[nameIdx],
          department: deptIdx >= 0 ? (cols[deptIdx] || "") : "",
        });
      }
    }

    showBulkPreview();
  };
  reader.readAsText(file);
}

function parseBulkPaste() {
  const text = document.getElementById("bulk-paste").value.trim();
  if (!text) return;

  bulkUsers = text.split("\n").map(line => {
    const parts = line.split(",").map(p => p.trim());
    return {
      email: parts[0] || "",
      fullName: parts[1] || "",
      department: parts[2] || "",
    };
  }).filter(u => u.email && u.fullName);

  showBulkPreview();
}

// Also parse on paste input
document.addEventListener("DOMContentLoaded", () => {
  const pasteEl = document.getElementById("bulk-paste");
  if (pasteEl) {
    pasteEl.addEventListener("input", debounce(parseBulkPaste, 500));
  }
  // File preview listeners for document training
  const trainFile = document.getElementById("train-doc-file");
  if (trainFile) trainFile.addEventListener("change", updateFilePreview);
  const trainFolder = document.getElementById("train-doc-folder");
  if (trainFolder) trainFolder.addEventListener("change", updateFilePreview);
});

function showBulkPreview() {
  const previewEl = document.getElementById("bulk-preview");
  const countEl = document.getElementById("bulk-count");
  const tableEl = document.getElementById("bulk-preview-table");
  const btnEl = document.getElementById("btn-bulk-import");

  if (bulkUsers.length === 0) {
    previewEl.style.display = "none";
    btnEl.disabled = true;
    return;
  }

  previewEl.style.display = "block";
  countEl.textContent = bulkUsers.length;
  btnEl.disabled = false;

  tableEl.innerHTML = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr><th>#</th><th>Email</th><th>Name</th><th>Department</th></tr></thead><tbody>' +
    bulkUsers.slice(0, 20).map(function(u, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(u.email) + '</td><td>' + escapeHtml(u.fullName) + '</td><td>' + escapeHtml(u.department || '—') + '</td></tr>';
    }).join("") +
    (bulkUsers.length > 20 ? '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">...and ' + (bulkUsers.length - 20) + ' more</td></tr>' : '') +
    '</tbody></table></div>';
}

async function executeBulkImport() {
  if (bulkUsers.length === 0) return;

  const tier = document.getElementById("bulk-tier").value;
  const resultEl = document.getElementById("bulk-result");
  const btnEl = document.getElementById("btn-bulk-import");

  btnEl.disabled = true;
  resultEl.innerHTML = '<span style="color:var(--gold);">Importing ' + bulkUsers.length + ' users...</span>';

  try {
    const res = await apiFetch("/api/admin/users/bulk", {
      method: "POST",
      body: JSON.stringify({ users: bulkUsers, defaultTier: tier }),
    });
    const d = await res.json();

    if (!res.ok) {
      resultEl.innerHTML = '<span class="msg-error">' + escapeHtml(d.error || "Import failed") + '</span>';
      btnEl.disabled = false;
      return;
    }

    resultEl.innerHTML = '<span class="msg-success">Imported ' + d.summary.created + ' of ' + d.summary.total + ' users</span>';

    // Show results table with access codes
    const resultsEl = document.getElementById("bulk-results-content");
    resultsEl.style.display = "block";
    document.getElementById("bulk-results-table").innerHTML =
      '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr><th>Email</th><th>Status</th><th>Access Code</th></tr></thead><tbody>' +
      d.results.map(function(r) {
        const isCreated = r.status === "created";
        return '<tr>' +
          '<td>' + escapeHtml(r.email) + '</td>' +
          '<td><span class="' + (isCreated ? 'msg-success' : 'msg-error') + '">' + escapeHtml(r.status) + '</span></td>' +
          '<td>' + (r.accessCode ? '<code style="font-size:14px;color:var(--gold);letter-spacing:1px;">' + r.accessCode + '</code>' : '—') + '</td>' +
        '</tr>';
      }).join("") +
      '</tbody></table></div>' +
      '<div style="margin-top:12px;"><button class="btn-action" onclick="exportBulkResults()">Export Results as CSV</button></div>';

    // Store results for export
    window._bulkResults = d.results;
    btnEl.disabled = false;
  } catch {
    resultEl.innerHTML = '<span class="msg-error">Import failed</span>';
    btnEl.disabled = false;
  }
}

function exportBulkResults() {
  if (!window._bulkResults) return;
  const csv = "email,status,access_code\n" +
    window._bulkResults.map(function(r) {
      return '"' + r.email + '","' + r.status + '","' + (r.accessCode || '') + '"';
    }).join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "askozzy-bulk-import-" + new Date().toISOString().split("T")[0] + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Document Training (Enhanced)
// ═══════════════════════════════════════════════════════════════════

function updateTrainCharCount() {
  const textarea = document.getElementById("train-doc-content");
  const counter = document.getElementById("train-char-count");
  if (!textarea || !counter) return;
  const len = textarea.value.length;
  counter.textContent = len.toLocaleString() + " / 200,000";
  counter.style.color = len > 200000 ? "var(--red)" : "var(--text-muted)";
}

function getTrainFiles() {
  // Collect ALL files from both inputs (no filtering here — filtering happens in trainDocument)
  const fileInput = document.getElementById("train-doc-file");
  const folderInput = document.getElementById("train-doc-folder");
  const allFiles = [];

  if (fileInput && fileInput.files && fileInput.files.length > 0) {
    const files = Array.from(fileInput.files);
    for (let i = 0; i < files.length; i++) allFiles.push(files[i]);
  }
  if (folderInput && folderInput.files && folderInput.files.length > 0) {
    const files = Array.from(folderInput.files);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      // Only skip hidden/system files
      if (f.name.startsWith(".") || f.name === "Thumbs.db" || f.name === "desktop.ini") continue;
      allFiles.push(f);
    }
  }
  return allFiles;
}

function updateFilePreview() {
  const el = document.getElementById("train-file-preview");
  if (!el) return;
  const files = getTrainFiles();
  if (files.length === 0) { el.innerHTML = ""; return; }
  if (files.length === 1) {
    el.innerHTML = "Selected: <strong>" + escapeHtml(files[0].name) + "</strong> (" + (files[0].size / 1024).toFixed(1) + " KB)";
  } else {
    const totalSize = files.reduce((s, f) => s + f.size, 0);
    el.innerHTML = "<strong>" + files.length + " files</strong> selected (" + (totalSize / 1024).toFixed(1) + " KB total): " +
      files.slice(0, 5).map(f => escapeHtml(f.name)).join(", ") + (files.length > 5 ? ", ..." : "");
  }
}

async function trainDocument() {
  const title = document.getElementById("train-doc-title").value.trim();
  const source = document.getElementById("train-doc-source").value.trim();
  const category = document.getElementById("train-doc-category").value;
  const textContent = document.getElementById("train-doc-content").value.trim();
  const resultEl = document.getElementById("train-result");

  var allFiles = getTrainFiles();

  // Filter binary formats and give clear feedback
  var BINARY_EXT = [".doc", ".docx", ".pptx", ".ppt", ".xls", ".xlsx", ".pdf", ".zip", ".rar", ".7z", ".exe", ".bin", ".dll", ".iso", ".img", ".mp3", ".mp4", ".avi", ".mov", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".woff", ".woff2", ".ttf", ".eot"];
  var textFiles = [];
  var skippedBinary = [];
  for (let i = 0; i < allFiles.length; i++) {
    var ext = "." + allFiles[i].name.split(".").pop().toLowerCase();
    if (BINARY_EXT.indexOf(ext) !== -1) {
      skippedBinary.push(allFiles[i].name);
    } else {
      textFiles.push(allFiles[i]);
    }
  }

  // Case: Files were selected but ALL are binary
  if (allFiles.length > 0 && textFiles.length === 0) {
    resultEl.innerHTML = '<span class="msg-error">All ' + allFiles.length + ' selected files are binary formats that cannot be processed.</span>' +
      '<br><span style="font-size:11px;color:var(--text-muted);">Unsupported: ' + skippedBinary.slice(0, 5).join(", ") + (skippedBinary.length > 5 ? ", ..." : "") + '</span>' +
      '<br><span style="font-size:11px;color:var(--gold);">Supported formats: .txt, .md, .csv, .json, .html — Please convert your documents first.</span>';
    return;
  }

  if (textFiles.length > 1) {
    // Batch upload multiple text files
    if (!source) {
      resultEl.innerHTML = '<span class="msg-error">Please enter a source/author for batch uploads</span>';
      return;
    }

    var skipNote = skippedBinary.length > 0 ? ' (skipping ' + skippedBinary.length + ' binary files)' : '';
    resultEl.innerHTML = '<span style="color:var(--gold);">Uploading ' + textFiles.length + ' files...' + skipNote + ' (0/' + textFiles.length + ')</span>';

    let uploaded = 0, failed = 0, errors = [];
    for (let i = 0; i < textFiles.length; i++) {
      const file = textFiles[i];
      const docTitle = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", docTitle);
      formData.append("source", source);
      formData.append("category", category);

      try {
        const res = await fetch(API + "/api/admin/documents/upload-file", {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
          body: formData,
        });
        const d = await res.json();
        if (res.ok) {
          uploaded++;
        } else {
          failed++;
          errors.push(file.name + ": " + (d.error || "failed"));
        }
      } catch {
        failed++;
        errors.push(file.name + ": network error");
      }
      resultEl.innerHTML = '<span style="color:var(--gold);">Uploading... (' + (i + 1) + '/' + textFiles.length + ')</span>';
    }

    let msg = '<span class="msg-success">' + uploaded + ' of ' + textFiles.length + ' documents uploaded successfully!</span>';
    if (skippedBinary.length > 0) {
      msg += '<br><span style="font-size:11px;color:var(--text-muted);">' + skippedBinary.length + ' binary files skipped (unsupported format)</span>';
    }
    if (failed > 0) {
      msg += '<br><span class="msg-error">' + failed + ' failed: ' + escapeHtml(errors.slice(0, 3).join("; ")) + (errors.length > 3 ? "..." : "") + '</span>';
    }
    resultEl.innerHTML = msg;
    document.getElementById("train-doc-title").value = "";
    document.getElementById("train-doc-source").value = "";
    document.getElementById("train-doc-file").value = "";
    if (document.getElementById("train-doc-folder")) document.getElementById("train-doc-folder").value = "";
    updateFilePreview();
    loadTrainingStatus();

  } else if (textFiles.length === 1) {
    // Single file upload
    var singleTitle = title || textFiles[0].name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    resultEl.innerHTML = '<span style="color:var(--gold);">Uploading file...</span>';

    const formData = new FormData();
    formData.append("file", textFiles[0]);
    formData.append("title", singleTitle);
    formData.append("source", source);
    formData.append("category", category);

    try {
      const res = await fetch(API + "/api/admin/documents/upload-file", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: formData,
      });
      const d = await res.json();

      if (!res.ok) {
        resultEl.innerHTML = '<span class="msg-error">' + escapeHtml(d.error || "Upload failed") + '</span>';
      } else {
        var successMsg = '<span class="msg-success">Document uploaded! ' + d.charCount.toLocaleString() + ' characters extracted. Processing embeddings...</span>';
        if (skippedBinary.length > 0) {
          successMsg += '<br><span style="font-size:11px;color:var(--text-muted);">' + skippedBinary.length + ' binary files skipped</span>';
        }
        resultEl.innerHTML = successMsg;
        document.getElementById("train-doc-title").value = "";
        document.getElementById("train-doc-source").value = "";
        document.getElementById("train-doc-content").value = "";
        document.getElementById("train-doc-file").value = "";
        if (document.getElementById("train-doc-folder")) document.getElementById("train-doc-folder").value = "";
        updateFilePreview();
        updateTrainCharCount();
        loadTrainingStatus();
      }
    } catch {
      resultEl.innerHTML = '<span class="msg-error">Upload failed — network error</span>';
    }
  } else if (textContent) {
    // Text content paste (single document)
    if (!title) {
      resultEl.innerHTML = '<span class="msg-error">Document title is required for pasted content</span>';
      return;
    }
    if (textContent.length < 50) {
      resultEl.innerHTML = '<span class="msg-error">Content must be at least 50 characters</span>';
      return;
    }

    resultEl.innerHTML = '<span style="color:var(--gold);">Uploading document...</span>';

    try {
      const res = await apiFetch("/api/admin/documents", {
        method: "POST",
        body: JSON.stringify({ title: title, source: source, category: category, content: textContent }),
      });
      const d = await res.json();

      if (!res.ok) {
        resultEl.innerHTML = '<span class="msg-error">' + escapeHtml(d.error || "Upload failed") + '</span>';
      } else {
        resultEl.innerHTML = '<span class="msg-success">Document uploaded! Processing embeddings...</span>';
        document.getElementById("train-doc-title").value = "";
        document.getElementById("train-doc-source").value = "";
        document.getElementById("train-doc-content").value = "";
        updateTrainCharCount();
        loadTrainingStatus();
      }
    } catch {
      resultEl.innerHTML = '<span class="msg-error">Upload failed — network error</span>';
    }
  } else {
    resultEl.innerHTML = '<span class="msg-error">No files selected and no content pasted. Please choose files, select a folder, or paste document text above.</span>';
  }
}

async function loadTrainingStatus() {
  const el = document.getElementById("training-status-content");
  if (!el) return;
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    const [statsRes, docsRes] = await Promise.all([
      apiFetch("/api/admin/kb/stats"),
      apiFetch("/api/admin/documents?page=1&limit=10"),
    ]);
    const stats = await statsRes.json();
    const docs = await docsRes.json();

    const statusIcons = {
      ready: '<span style="color:var(--green-light);font-weight:600;">Ready</span>',
      processing: '<span style="color:var(--gold);font-weight:600;">Processing...</span>',
      error: '<span style="color:var(--red);font-weight:600;">Error</span>',
    };

    el.innerHTML = '<div class="stats-grid" style="margin-bottom:16px;">' +
      '<div class="stat-card"><div class="stat-value">' + (stats.documents || 0) + '</div><div class="stat-label">Documents</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (stats.chunks || 0) + '</div><div class="stat-label">Chunks</div></div>' +
      '<div class="stat-card green"><div class="stat-value">' + (stats.readyDocs || 0) + '</div><div class="stat-label">Ready</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (stats.faqs || 0) + '</div><div class="stat-label">FAQs</div></div>' +
    '</div>' +
    ((docs.documents || []).length > 0 ?
      '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
      '<th>Title</th><th>Source</th><th>Category</th><th>Chunks</th><th>Status</th><th>Date</th>' +
      '</tr></thead><tbody>' +
      docs.documents.map(function(doc) {
        return '<tr><td>' + escapeHtml(doc.title) + '</td><td>' + escapeHtml(doc.source || '—') + '</td>' +
          '<td>' + escapeHtml(doc.category || 'general') + '</td><td>' + (doc.chunk_count || 0) + '</td>' +
          '<td>' + (statusIcons[doc.status] || doc.status) + '</td><td>' + formatDateShort(doc.created_at) + '</td></tr>';
      }).join("") +
      '</tbody></table></div>' :
      '<div class="admin-empty">No documents trained yet. Upload your first document above!</div>'
    );
  } catch {
    el.innerHTML = '<div class="admin-empty">Failed to load training status</div>';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  URL Scraping for Document Training
// ═══════════════════════════════════════════════════════════════════

async function trainFromURLs() {
  const urlsRaw = document.getElementById("scrape-urls").value.trim();
  const title = document.getElementById("scrape-title").value.trim();
  const source = document.getElementById("scrape-source").value.trim();
  const category = document.getElementById("scrape-category").value;
  const followLinks = document.getElementById("scrape-follow-links").checked;
  const resultEl = document.getElementById("scrape-result");
  const detailEl = document.getElementById("scrape-results-detail");

  if (!urlsRaw) {
    resultEl.innerHTML = '<span class="msg-error">Please enter at least one URL</span>';
    return;
  }

  // Parse URLs (one per line, filter empty lines)
  const urls = urlsRaw.split("\n").map(function(u) { return u.trim(); }).filter(function(u) { return u.length > 0; });

  if (urls.length === 0) {
    resultEl.innerHTML = '<span class="msg-error">No valid URLs found</span>';
    return;
  }

  // Basic URL validation
  for (var i = 0; i < urls.length; i++) {
    try {
      new URL(urls[i]);
    } catch (e) {
      resultEl.innerHTML = '<span class="msg-error">Invalid URL: ' + escapeHtml(urls[i]) + '</span>';
      return;
    }
  }

  resultEl.innerHTML = '<span style="color:var(--gold);">Scraping ' + urls.length + ' URL' + (urls.length > 1 ? 's' : '') + '... This may take a moment.</span>';
  detailEl.innerHTML = '';

  try {
    var res = await fetch(API + "/api/admin/documents/scrape-url", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        urls: urls,
        title: title,
        source: source,
        category: category,
        followLinks: followLinks,
      }),
    });

    var data = await res.json();

    if (!res.ok) {
      resultEl.innerHTML = '<span class="msg-error">' + escapeHtml(data.error || "Scraping failed") + '</span>';
      return;
    }

    var summary = data.summary;
    resultEl.innerHTML = '<span class="msg-success">' + summary.succeeded + ' of ' + summary.total + ' URLs scraped successfully!</span>' +
      (summary.failed > 0 ? ' <span class="msg-error">(' + summary.failed + ' failed)</span>' : '');

    // Show detailed results
    if (data.results && data.results.length > 0) {
      var tableHtml = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
        '<th>URL</th><th>Title</th><th>Characters</th><th>Status</th>' +
        '</tr></thead><tbody>';

      for (var j = 0; j < data.results.length; j++) {
        var r = data.results[j];
        var shortUrl = r.url.length > 50 ? r.url.substring(0, 50) + '...' : r.url;
        if (r.status === 'success') {
          tableHtml += '<tr><td title="' + escapeHtml(r.url) + '">' + escapeHtml(shortUrl) + '</td>' +
            '<td>' + escapeHtml(r.title || '—') + '</td>' +
            '<td>' + (r.charCount || 0).toLocaleString() + '</td>' +
            '<td><span style="color:var(--green-light);font-weight:600;">Success</span></td></tr>';
        } else {
          tableHtml += '<tr><td title="' + escapeHtml(r.url) + '">' + escapeHtml(shortUrl) + '</td>' +
            '<td>—</td><td>—</td>' +
            '<td><span style="color:var(--red);font-weight:600;">' + escapeHtml(r.error || 'Failed') + '</span></td></tr>';
        }
      }

      tableHtml += '</tbody></table></div>';
      detailEl.innerHTML = tableHtml;
    }

    // Clear inputs on success
    if (summary.succeeded > 0) {
      document.getElementById("scrape-urls").value = "";
      document.getElementById("scrape-title").value = "";
      document.getElementById("scrape-source").value = "";
      document.getElementById("scrape-follow-links").checked = false;
      loadTrainingStatus();
    }
  } catch (e) {
    resultEl.innerHTML = '<span class="msg-error">Network error: ' + escapeHtml(e.message || "Failed to connect") + '</span>';
  }
}

// ─── Init ───────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", verifyAdmin);
