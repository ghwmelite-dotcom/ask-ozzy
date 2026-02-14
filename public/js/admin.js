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
const token = localStorage.getItem("askozzy_token");
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
  const codeBlocks = [];
  let html = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push("<pre><code>" + escapeHtml(code.trim()) + "</code></pre>");
    return "\x00CODEBLOCK_" + idx + "\x00";
  });
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push("<code>" + escapeHtml(code) + "</code>");
    return "\x00CODEBLOCK_" + idx + "\x00";
  });
  html = escapeHtml(html);
  html = html.replace(/\x00CODEBLOCK_(\d+)\x00/g, (_, idx) => codeBlocks[+idx]);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/^[\-\*] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
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
    "bulk-import": loadDepartmentStats,
    "document-training": loadTrainingStatus,
    "agents": loadAgentsList,
    "productivity": loadProductivityTab,
    "ussd": loadUSSDTab,
    "messaging": loadMessagingTab,
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
            ${["free", "professional", "enterprise"].map(tier => {
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
            ['free','professional','enterprise'].map(t =>
              '<option value="' + t + '"' + (t === u.tier ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>'
            ).join('') +
          '</select></td>' +
          '<td><select class="inline-select" onchange="changeRole(\'' + u.id + '\', this.value)"' + (isSelf ? ' disabled title="Cannot change own role"' : '') + '>' +
            ['civil_servant','dept_admin','super_admin'].map(r =>
              '<option value="' + r + '"' + (r === u.role ? ' selected' : '') + '>' + (r === 'super_admin' ? 'Admin' : r === 'dept_admin' ? 'Dept Admin' : 'User') + '</option>'
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

// ─── Single User Creation ──────────────────────────────────────────

function toggleAddUserForm() {
  const form = document.getElementById("add-user-form");
  const isVisible = form.style.display !== "none";
  if (isVisible) {
    form.style.display = "none";
  } else {
    // Reset form
    document.getElementById("add-user-name").value = "";
    document.getElementById("add-user-email").value = "";
    document.getElementById("add-user-dept").value = "";
    document.getElementById("add-user-tier").value = "free";
    document.getElementById("add-user-result").innerHTML = "";
    document.getElementById("add-user-code").style.display = "none";
    form.style.display = "block";
    document.getElementById("add-user-name").focus();
  }
}

async function submitAddUser() {
  const fullName = document.getElementById("add-user-name").value.trim();
  const email = document.getElementById("add-user-email").value.trim();
  const department = document.getElementById("add-user-dept").value.trim();
  const tier = document.getElementById("add-user-tier").value;
  const resultEl = document.getElementById("add-user-result");

  if (!fullName || !email) {
    resultEl.innerHTML = '<span class="msg-error">Name and email are required</span>';
    return;
  }

  resultEl.innerHTML = '<span style="color:var(--gold);">Creating user...</span>';

  try {
    const res = await apiFetch("/api/admin/users/bulk", {
      method: "POST",
      body: JSON.stringify({
        users: [{ fullName: fullName, email: email, department: department }],
        defaultTier: tier,
      }),
    });
    const d = await res.json();

    if (!res.ok) {
      resultEl.innerHTML = '<span class="msg-error">' + escapeHtml(d.error || "Failed to create user") + '</span>';
      return;
    }

    const result = d.results && d.results[0];
    if (!result) {
      resultEl.innerHTML = '<span class="msg-error">Unexpected response</span>';
      return;
    }

    if (result.status === "created") {
      resultEl.innerHTML = '<span class="msg-success">User created successfully!</span>';
      // Show access code
      var codeEl = document.getElementById("add-user-code");
      document.getElementById("add-user-code-value").textContent = result.accessCode || "";
      codeEl.style.display = "block";
      loadUsers(usersPage);
    } else {
      resultEl.innerHTML = '<span class="msg-error">' + escapeHtml(result.status) + '</span>';
    }
  } catch {
    resultEl.innerHTML = '<span class="msg-error">Failed to create user</span>';
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

    const sb = d.sourceBreakdown || {};
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
        <div class="stat-card" style="border-left:3px solid #2563eb;">
          <div class="stat-value">${sb.affiliate || 0}</div>
          <div class="stat-label">Affiliate Signups</div>
        </div>
        <div class="stat-card" style="border-left:3px solid #9ca3af;">
          <div class="stat-value">${sb.system || 0}</div>
          <div class="stat-label">System-Generated</div>
        </div>
        <div class="stat-card" style="border-left:3px solid #f59e0b;">
          <div class="stat-value">${sb.organic || 0}</div>
          <div class="stat-label">Organic (Legacy)</div>
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
            '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr><th>Referrer</th><th>Referred</th><th>Source</th><th>Bonus</th><th>Date</th></tr></thead><tbody>' +
            d.recentReferrals.map(r => {
              const src = r.source || 'affiliate';
              const srcBadge = src === 'system'
                ? '<span class="badge" style="background:#f3f4f6;color:#6b7280;font-size:10px;">System</span>'
                : '<span class="badge" style="background:#dbeafe;color:#2563eb;font-size:10px;">Affiliate</span>';
              return '<tr><td>' + escapeHtml(r.referrer_name) + '</td><td>' + escapeHtml(r.referred_name) + '</td><td>' + srcBadge + '</td><td>GHS ' + (r.bonus_amount || 0).toFixed(2) + '</td><td>' + formatDateShort(r.created_at) + '</td></tr>';
            }).join("") +
            '</tbody></table></div>'
          }
        </div>
      </div>
    `;
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load referrals</div>';
  }

  // Also load affiliate admin stats, payable report, and withdrawals
  loadAffiliateAdminStats();
  loadPayableAffiliates("all");
  loadWithdrawals("all");
}

// ═══════════════════════════════════════════════════════════════════
//  Affiliate Admin: Stats
// ═══════════════════════════════════════════════════════════════════

async function loadAffiliateAdminStats() {
  const el = document.getElementById("affiliate-admin-stats");
  if (!el) return;

  try {
    const res = await apiFetch("/api/admin/affiliate/stats");
    const d = await res.json();

    el.innerHTML = `
      <div class="stats-grid" style="margin-bottom:16px;">
        <div class="stat-card">
          <div class="stat-value">GHS ${(d.totalCommissions || 0).toFixed(2)}</div>
          <div class="stat-label">Total Commissions</div>
        </div>
        <div class="stat-card" style="border-left:3px solid #FFC107;">
          <div class="stat-value">GHS ${(d.totalPending || 0).toFixed(2)}</div>
          <div class="stat-label">Pending Withdrawals</div>
        </div>
        <div class="stat-card green">
          <div class="stat-value">GHS ${(d.totalPaidOut || 0).toFixed(2)}</div>
          <div class="stat-label">Total Paid Out</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${d.totalAffiliates || 0}</div>
          <div class="stat-label">Active Affiliates</div>
        </div>
      </div>

      ${(d.topAffiliates || []).length > 0 ? `
      <div class="admin-card" style="margin-bottom:0;">
        <h3>Top Affiliates by Earnings</h3>
        <div class="admin-table-wrapper">
          <table class="admin-table">
            <thead><tr><th>Rank</th><th>Name</th><th>Email</th><th>Referrals</th><th>Total Earned</th><th>Wallet Balance</th></tr></thead>
            <tbody>
              ${d.topAffiliates.map((a, i) =>
                '<tr style="cursor:pointer;" onclick="loadAffiliateLedger(\'' + a.user_id + '\', \'' + escapeHtml(a.full_name).replace(/'/g, "\\'") + '\', 1)"><td>' + (i + 1) + '</td><td style="color:var(--gold);text-decoration:underline;">' + escapeHtml(a.full_name) + '</td><td>' + escapeHtml(a.email) + '</td><td>' + (a.total_referrals || 0) + '</td><td>GHS ' + (a.total_earned || 0).toFixed(2) + '</td><td>GHS ' + (a.wallet_balance || a.balance || 0).toFixed(2) + '</td></tr>'
              ).join("")}
            </tbody>
          </table>
        </div>
      </div>` : ''}
    `;

    // Render monthly trend chart (B2)
    renderMonthlyTrendChart(d.monthlyTrend || []);
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load affiliate stats</div>';
  }
}

// ─── Monthly Trend Chart (Pure CSS bars) ──────────────────────────

function renderMonthlyTrendChart(monthlyTrend) {
  const chartEl = document.getElementById("affiliate-monthly-chart");
  if (!chartEl || !monthlyTrend || monthlyTrend.length === 0) {
    if (chartEl) chartEl.innerHTML = "";
    return;
  }

  const maxTotal = Math.max(...monthlyTrend.map(m => m.total), 1);

  var barsHtml = monthlyTrend.map(function(m) {
    var l1Height = Math.max((m.l1 / maxTotal) * 140, m.l1 > 0 ? 4 : 0);
    var l2Height = Math.max((m.l2 / maxTotal) * 140, m.l2 > 0 ? 4 : 0);
    var monthLabel = m.month.split("-")[1] + "/" + m.month.split("-")[0].slice(2);
    return '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:60px;">' +
      '<div style="font-size:10px;font-weight:600;color:var(--text-primary);">GHS ' + m.total.toFixed(0) + '</div>' +
      '<div style="display:flex;gap:3px;align-items:flex-end;height:140px;">' +
        '<div style="width:18px;background:linear-gradient(180deg, #DAA520, #B8860B);border-radius:3px 3px 0 0;height:' + l1Height + 'px;transition:height 0.3s;" title="L1: GHS ' + m.l1.toFixed(2) + '"></div>' +
        '<div style="width:18px;background:linear-gradient(180deg, #3B82F6, #2563EB);border-radius:3px 3px 0 0;height:' + l2Height + 'px;transition:height 0.3s;" title="L2: GHS ' + m.l2.toFixed(2) + '"></div>' +
      '</div>' +
      '<div style="font-size:10px;color:var(--text-muted);">' + monthLabel + '</div>' +
    '</div>';
  }).join("");

  chartEl.innerHTML = '<div class="admin-card">' +
    '<h3>Commission Trend (6 Months)</h3>' +
    '<div style="display:flex;gap:4px;align-items:center;margin-bottom:12px;">' +
      '<div style="width:12px;height:12px;background:#DAA520;border-radius:2px;"></div><span style="font-size:11px;color:var(--text-secondary);margin-right:12px;">Level 1</span>' +
      '<div style="width:12px;height:12px;background:#3B82F6;border-radius:2px;"></div><span style="font-size:11px;color:var(--text-secondary);">Level 2</span>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-around;align-items:flex-end;padding:8px 0;border-bottom:1px solid var(--border-color);">' +
      barsHtml +
    '</div>' +
  '</div>';
}

// ═══════════════════════════════════════════════════════════════════
//  Affiliate Admin: Withdrawals
// ═══════════════════════════════════════════════════════════════════

let currentWithdrawalFilter = "all";

async function loadWithdrawals(status) {
  currentWithdrawalFilter = status || "all";
  const el = document.getElementById("withdrawals-content");
  if (!el) return;
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    const queryParam = status && status !== "all" ? "?status=" + status : "";
    const res = await apiFetch("/api/admin/affiliate/withdrawals" + queryParam);
    const d = await res.json();
    const withdrawals = d.withdrawals || [];

    // Update pending badge
    const badge = document.getElementById("pending-withdrawals-badge");
    if (badge) {
      const pendingCount = d.pendingCount || withdrawals.filter(w => w.status === "pending").length;
      if (pendingCount > 0) {
        badge.textContent = pendingCount;
        badge.style.display = "inline-block";
      } else {
        badge.style.display = "none";
      }
    }

    if (withdrawals.length === 0) {
      el.innerHTML = '<div class="admin-empty">No withdrawal requests found for this filter.</div>';
      return;
    }

    el.innerHTML = `
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>User</th>
              <th>Email</th>
              <th>Amount</th>
              <th>MoMo Number</th>
              <th>Network</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${withdrawals.map(w => {
              const dateStr = w.created_at ? formatDate(w.created_at) : "--";
              const statusCls = {pending: "warning", approved: "info", paid: "success", rejected: "danger"}[w.status] || "default";
              const isPending = w.status === "pending";
              const isApproved = w.status === "approved";
              return '<tr>' +
                '<td>' + dateStr + '</td>' +
                '<td>' + escapeHtml(w.full_name || w.user_name || "--") + '</td>' +
                '<td>' + escapeHtml(w.email || "--") + '</td>' +
                '<td><strong>GHS ' + (w.amount || 0).toFixed(2) + '</strong></td>' +
                '<td>' + escapeHtml(w.momo_number ? '****' + w.momo_number.slice(-4) : "--") + '</td>' +
                '<td>' + escapeHtml(w.momo_network || "--") + '</td>' +
                '<td><span class="badge badge-' + statusCls + '">' + (w.status || "unknown") + '</span></td>' +
                '<td>' +
                  (isPending ? '<button class="btn-admin-sm btn-approve" onclick="approveWithdrawal(\'' + w.id + '\')">Approve</button> <button class="btn-admin-sm btn-reject" onclick="rejectWithdrawal(\'' + w.id + '\')">Reject</button>' :
                   isApproved ? '<button class="btn-admin-sm btn-approve" onclick="markWithdrawalPaid(\'' + w.id + '\')">Mark Paid</button> <button class="btn-admin-sm btn-reject" onclick="rejectWithdrawal(\'' + w.id + '\')">Reject</button>' :
                   '<span style="color:var(--text-muted);font-size:11px;">--</span>') +
                '</td>' +
              '</tr>';
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load withdrawals</div>';
  }
}

function filterWithdrawals(status, btnEl) {
  // Update active filter button
  document.querySelectorAll("[data-wstatus]").forEach(b => b.classList.remove("active"));
  if (btnEl) btnEl.classList.add("active");
  loadWithdrawals(status);
}

async function approveWithdrawal(id) {
  if (!confirm("Approve this withdrawal request?")) return;

  try {
    const res = await apiFetch("/api/admin/affiliate/withdrawals/" + id + "/approve", {
      method: "POST"
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Failed to approve");
    alert("Withdrawal approved successfully.");
    loadWithdrawals(currentWithdrawalFilter);
    loadAffiliateAdminStats();
  } catch (err) {
    alert("Error: " + (err.message || "Failed to approve withdrawal"));
  }
}

async function rejectWithdrawal(id) {
  const note = prompt("Enter reason for rejection (optional):");
  if (note === null) return; // cancelled

  try {
    const res = await apiFetch("/api/admin/affiliate/withdrawals/" + id + "/reject", {
      method: "POST",
      body: JSON.stringify({ admin_note: note || "" })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Failed to reject");
    alert("Withdrawal rejected.");
    loadWithdrawals(currentWithdrawalFilter);
    loadAffiliateAdminStats();
  } catch (err) {
    alert("Error: " + (err.message || "Failed to reject withdrawal"));
  }
}

async function markWithdrawalPaid(id) {
  if (!confirm("Mark this withdrawal as paid? This confirms the MoMo transfer has been sent.")) return;

  try {
    const res = await apiFetch("/api/admin/affiliate/withdrawals/" + id + "/approve", {
      method: "POST",
      body: JSON.stringify({ mark_paid: true })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Failed to update");
    alert("Withdrawal marked as paid.");
    loadWithdrawals(currentWithdrawalFilter);
    loadAffiliateAdminStats();
  } catch (err) {
    alert("Error: " + (err.message || "Failed to mark as paid"));
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Affiliate: Payable Affiliates Report
// ═══════════════════════════════════════════════════════════════════

let payableAffiliatesData = [];
let currentPayablePeriod = "all";

function filterPayable(period, btnEl) {
  document.querySelectorAll("[data-payperiod]").forEach(function(b) { b.classList.remove("active"); });
  if (btnEl) btnEl.classList.add("active");
  currentPayablePeriod = period;
  loadPayableAffiliates(period);
}

async function loadPayableAffiliates(period) {
  period = period || currentPayablePeriod || "all";
  currentPayablePeriod = period;
  var el = document.getElementById("payable-content");
  if (!el) return;
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    var res = await apiFetch("/api/admin/affiliate/payable?period=" + period);
    var d = await res.json();
    payableAffiliatesData = d.payable || [];

    // Show/hide export button
    var exportBtn = document.getElementById("btn-export-payable");
    if (exportBtn) exportBtn.style.display = payableAffiliatesData.length > 0 ? "inline-block" : "none";

    if (payableAffiliatesData.length === 0) {
      el.innerHTML = '<div class="admin-empty">No affiliates with outstanding balance.</div>';
      return;
    }

    el.innerHTML = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
      '<th>Name</th><th>Email</th><th>Balance</th><th>Period Earnings</th><th>Total Earned</th><th>Last Commission</th><th>MoMo</th>' +
      '</tr></thead><tbody>' +
      payableAffiliatesData.map(function(a) {
        var momoStr = a.momo_number ? (a.momo_network || "").toUpperCase() + " ****" + a.momo_number.slice(-4) : "--";
        return '<tr style="cursor:pointer;" onclick="loadAffiliateLedger(\'' + a.user_id + '\', \'' + escapeHtml(a.full_name).replace(/'/g, "\\'") + '\', 1)">' +
          '<td style="color:var(--gold);text-decoration:underline;">' + escapeHtml(a.full_name) + '</td>' +
          '<td>' + escapeHtml(a.email) + '</td>' +
          '<td><strong>GHS ' + (a.balance || 0).toFixed(2) + '</strong></td>' +
          '<td>GHS ' + (a.period_earnings || 0).toFixed(2) + '</td>' +
          '<td>GHS ' + (a.total_earned || 0).toFixed(2) + '</td>' +
          '<td>' + (a.last_commission ? formatDateShort(a.last_commission) : '--') + '</td>' +
          '<td style="font-size:11px;">' + escapeHtml(momoStr) + '</td>' +
        '</tr>';
      }).join("") +
      '</tbody></table></div>';
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load payable affiliates</div>';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Affiliate: Per-Affiliate Transaction Ledger
// ═══════════════════════════════════════════════════════════════════

let currentLedgerUserId = null;
let currentLedgerUserName = "";

async function loadAffiliateLedger(userId, userName, page) {
  currentLedgerUserId = userId;
  currentLedgerUserName = userName || "";
  page = page || 1;

  var section = document.getElementById("affiliate-ledger-section");
  section.style.display = "block";

  document.getElementById("ledger-title").textContent = "Ledger: " + (userName || "Affiliate");
  document.getElementById("ledger-content").innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';
  document.getElementById("ledger-summary").innerHTML = "";
  document.getElementById("ledger-pagination").innerHTML = "";

  // Scroll into view
  section.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    var res = await apiFetch("/api/admin/affiliate/transactions/" + userId + "?page=" + page + "&limit=20");
    var d = await res.json();

    // Summary cards
    var w = d.wallet || {};
    document.getElementById("ledger-summary").innerHTML =
      '<div class="stats-grid" style="margin-bottom:16px;">' +
        '<div class="stat-card"><div class="stat-value">GHS ' + (w.balance || 0).toFixed(2) + '</div><div class="stat-label">Balance</div></div>' +
        '<div class="stat-card green"><div class="stat-value">GHS ' + (w.total_earned || 0).toFixed(2) + '</div><div class="stat-label">Total Earned</div></div>' +
        '<div class="stat-card"><div class="stat-value">GHS ' + (w.total_withdrawn || 0).toFixed(2) + '</div><div class="stat-label">Withdrawn</div></div>' +
        '<div class="stat-card" style="border-left:3px solid #DAA520;"><div class="stat-value">GHS ' + (w.l1_total || 0).toFixed(2) + '</div><div class="stat-label">L1 Commissions</div></div>' +
        '<div class="stat-card" style="border-left:3px solid #3B82F6;"><div class="stat-value">GHS ' + (w.l2_total || 0).toFixed(2) + '</div><div class="stat-label">L2 Commissions</div></div>' +
        '<div class="stat-card" style="border-left:3px solid #10B981;"><div class="stat-value">GHS ' + (w.bonus_total || 0).toFixed(2) + '</div><div class="stat-label">Bonuses</div></div>' +
      '</div>';

    // Transactions table
    var transactions = d.transactions || [];
    if (transactions.length === 0) {
      document.getElementById("ledger-content").innerHTML = '<div class="admin-empty">No transactions found for this affiliate.</div>';
      return;
    }

    var typeBadge = function(type) {
      var colors = {
        commission_l1: "background:#FEF3C7;color:#92400E;",
        commission_l2: "background:#DBEAFE;color:#1E40AF;",
        bonus: "background:#D1FAE5;color:#065F46;",
        withdrawal: "background:#FEE2E2;color:#991B1B;",
        reward: "background:#E0E7FF;color:#3730A3;",
      };
      var labels = {
        commission_l1: "L1",
        commission_l2: "L2",
        bonus: "Bonus",
        withdrawal: "Withdraw",
        reward: "Reward",
      };
      var style = colors[type] || "background:#F3F4F6;color:#6B7280;";
      return '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;' + style + '">' + (labels[type] || type) + '</span>';
    };

    document.getElementById("ledger-content").innerHTML =
      '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
        '<th>Date</th><th>Type</th><th>Amount</th><th>Description</th><th>Source User</th>' +
      '</tr></thead><tbody>' +
      transactions.map(function(t) {
        var amtStr = t.amount >= 0
          ? '<span style="color:#10B981;font-weight:600;">+GHS ' + t.amount.toFixed(2) + '</span>'
          : '<span style="color:#EF4444;font-weight:600;">-GHS ' + Math.abs(t.amount).toFixed(2) + '</span>';
        return '<tr>' +
          '<td>' + formatDateShort(t.created_at) + '</td>' +
          '<td>' + typeBadge(t.type) + '</td>' +
          '<td>' + amtStr + '</td>' +
          '<td style="font-size:11px;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(t.description || '--') + '</td>' +
          '<td style="font-size:11px;">' + escapeHtml(t.source_user_name || '--') + '</td>' +
        '</tr>';
      }).join("") +
      '</tbody></table></div>';

    // Pagination
    renderPagination("ledger-pagination", page, d.total, 20, "loadAffiliateLedgerPage");
  } catch (err) {
    document.getElementById("ledger-content").innerHTML = '<div class="admin-empty">Failed to load ledger</div>';
  }
}

function loadAffiliateLedgerPage(page) {
  loadAffiliateLedger(currentLedgerUserId, currentLedgerUserName, page);
}

function closeAffiliateLedger() {
  document.getElementById("affiliate-ledger-section").style.display = "none";
  currentLedgerUserId = null;
}

// ═══════════════════════════════════════════════════════════════════
//  Affiliate: CSV Export (Payable)
// ═══════════════════════════════════════════════════════════════════

function exportPayableCSV() {
  if (!payableAffiliatesData || payableAffiliatesData.length === 0) return;

  var csv = "Name,Email,Balance,Total Earned,Total Withdrawn,Period Earnings,Last Commission,MoMo Number,Network\n";
  for (var i = 0; i < payableAffiliatesData.length; i++) {
    var a = payableAffiliatesData[i];
    csv += '"' + (a.full_name || "").replace(/"/g, '""') + '","' +
      (a.email || "").replace(/"/g, '""') + '",' +
      (a.balance || 0).toFixed(2) + ',' +
      (a.total_earned || 0).toFixed(2) + ',' +
      (a.total_withdrawn || 0).toFixed(2) + ',' +
      (a.period_earnings || 0).toFixed(2) + ',' +
      (a.last_commission || "") + ',' +
      (a.momo_number || "") + ',' +
      (a.momo_network || "") + '\n';
  }

  var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = "askozzy-payable-affiliates-" + new Date().toISOString().split("T")[0] + ".csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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
//  TAB: Audit Log (User Activity Trail)
// ═══════════════════════════════════════════════════════════════════

let auditLogPage = 1;
let auditStatsLoaded = false;

const debouncedAuditSearch = debounce(() => loadAuditLog(1), 400);

function getAuditFilters() {
  return {
    action_type: document.getElementById("audit-action-filter").value,
    date_from: document.getElementById("audit-date-from").value,
    date_to: document.getElementById("audit-date-to").value,
    search: document.getElementById("audit-search").value.trim(),
  };
}

function buildAuditQueryString(page) {
  const f = getAuditFilters();
  const params = new URLSearchParams({ page: page, limit: 50 });
  if (f.action_type) params.set("action_type", f.action_type);
  if (f.date_from) params.set("date_from", f.date_from);
  if (f.date_to) params.set("date_to", f.date_to);
  if (f.search) params.set("search", f.search);
  return params.toString();
}

const ACTION_LABELS = {
  chat: "Chat",
  research: "Research",
  analyze: "Analyze",
  vision: "Vision",
  workflow_step: "Workflow",
  meeting_transcribe: "Meeting",
};

function actionBadge(type) {
  var colors = {
    chat: "#3b82f6",
    research: "#8b5cf6",
    analyze: "#f59e0b",
    vision: "#10b981",
    workflow_step: "#6366f1",
    meeting_transcribe: "#ec4899",
  };
  var color = colors[type] || "var(--text-muted)";
  var label = ACTION_LABELS[type] || type;
  return '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:' + color + '22;color:' + color + ';border:1px solid ' + color + '44;">' + escapeHtml(label) + '</span>';
}

async function loadAuditStats() {
  var el = document.getElementById("audit-stats");
  try {
    var res = await apiFetch("/api/admin/audit/stats");
    var d = await res.json();

    var topDept = (d.byDepartment && d.byDepartment.length > 0) ? d.byDepartment[0].department : "N/A";
    var topDeptCount = (d.byDepartment && d.byDepartment.length > 0) ? d.byDepartment[0].count : 0;

    el.innerHTML = '<div class="stats-grid">' +
      '<div class="stat-card">' +
        '<div class="stat-value">' + (d.total || 0) + '</div>' +
        '<div class="stat-label">Total Queries</div>' +
      '</div>' +
      '<div class="stat-card green">' +
        '<div class="stat-value">' + (d.today || 0) + '</div>' +
        '<div class="stat-label">Queries Today</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-value">' + escapeHtml(topDept) + '</div>' +
        '<div class="stat-label">Top Department (' + topDeptCount + ')</div>' +
      '</div>' +
    '</div>' +
    '<div class="admin-row" style="margin-top:16px;">' +
      '<div class="admin-card">' +
        '<h3>Queries by Action Type</h3>' +
        ((d.byAction || []).length === 0 ? '<div class="admin-empty">No data yet</div>' :
          '<div class="bar-chart">' +
          d.byAction.map(function(r) {
            var maxCount = Math.max.apply(null, d.byAction.map(function(x) { return x.count; }));
            var pct = maxCount > 0 ? (r.count / maxCount * 100) : 0;
            return '<div class="bar-row">' +
              '<span class="bar-label">' + (ACTION_LABELS[r.action_type] || r.action_type) + '</span>' +
              '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(pct, 1) + '%"></div></div>' +
              '<span class="bar-value">' + r.count + '</span>' +
            '</div>';
          }).join("") +
          '</div>'
        ) +
      '</div>' +
      '<div class="admin-card">' +
        '<h3>Top Departments</h3>' +
        ((d.byDepartment || []).length === 0 ? '<div class="admin-empty">No data yet</div>' :
          '<div class="bar-chart">' +
          d.byDepartment.slice(0, 10).map(function(r) {
            var maxCount = Math.max.apply(null, d.byDepartment.map(function(x) { return x.count; }));
            var pct = maxCount > 0 ? (r.count / maxCount * 100) : 0;
            return '<div class="bar-row">' +
              '<span class="bar-label">' + escapeHtml(r.department) + '</span>' +
              '<div class="bar-track"><div class="bar-fill green" style="width:' + Math.max(pct, 1) + '%"></div></div>' +
              '<span class="bar-value">' + r.count + '</span>' +
            '</div>';
          }).join("") +
          '</div>'
        ) +
      '</div>' +
    '</div>' +
    '<div class="admin-card" style="margin-top:16px;">' +
      '<h3>Daily Activity (Last 30 Days)</h3>' +
      ((d.dailyCounts || []).length === 0 ? '<div class="admin-empty">No data yet</div>' :
        '<div class="bar-chart">' +
        d.dailyCounts.map(function(r) {
          var maxCount = Math.max.apply(null, d.dailyCounts.map(function(x) { return x.count; }));
          var pct = maxCount > 0 ? (r.count / maxCount * 100) : 0;
          return '<div class="bar-row">' +
            '<span class="bar-label">' + formatDateShort(r.day) + '</span>' +
            '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(pct, 1) + '%"></div></div>' +
            '<span class="bar-value">' + r.count + '</span>' +
          '</div>';
        }).join("") +
        '</div>'
      ) +
    '</div>';
    auditStatsLoaded = true;
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load audit stats</div>';
  }
}

async function loadAuditLog(page) {
  auditLogPage = page || 1;
  var el = document.getElementById("audit-log-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  // Load stats on first visit
  if (!auditStatsLoaded) {
    loadAuditStats();
  }

  try {
    var qs = buildAuditQueryString(auditLogPage);
    var res = await apiFetch("/api/admin/audit?" + qs);
    var d = await res.json();
    var entries = d.entries || [];
    var total = d.total || 0;

    if (entries.length === 0) {
      el.innerHTML = '<div class="admin-empty">No audit log entries match your filters</div>';
      document.getElementById("audit-log-pagination").innerHTML = "";
      return;
    }

    el.innerHTML = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
      '<th>Timestamp</th><th>User Email</th><th>Department</th><th>Action</th><th>Query Preview</th><th>Model</th><th>IP</th>' +
      '</tr></thead><tbody>' +
      entries.map(function(entry) {
        var modelShort = (entry.model_used || "").split("/").pop() || "—";
        var preview = entry.query_preview || "—";
        if (preview.length > 80) preview = preview.substring(0, 77) + "...";
        return '<tr>' +
          '<td style="white-space:nowrap;">' + formatDate(entry.created_at) + '</td>' +
          '<td>' + escapeHtml(entry.user_email || '—') + '</td>' +
          '<td>' + escapeHtml(entry.department || '—') + '</td>' +
          '<td>' + actionBadge(entry.action_type) + '</td>' +
          '<td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;" title="' + escapeHtml(entry.query_preview || '') + '">' + escapeHtml(preview) + '</td>' +
          '<td style="font-size:11px;color:var(--text-muted);" title="' + escapeHtml(entry.model_used || '') + '">' + escapeHtml(modelShort) + '</td>' +
          '<td style="font-size:11px;font-family:monospace;color:var(--text-muted);">' + escapeHtml(entry.ip_address ? entry.ip_address.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)/, '$1.$2.***.$4') : '—') + '</td>' +
        '</tr>';
      }).join("") +
      '</tbody></table></div>';

    renderPagination("audit-log-pagination", auditLogPage, total, 50, "loadAuditLog");
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load audit log</div>';
  }
}

async function exportAuditCSV() {
  try {
    var f = getAuditFilters();
    var params = new URLSearchParams();
    if (f.action_type) params.set("action_type", f.action_type);
    if (f.date_from) params.set("date_from", f.date_from);
    if (f.date_to) params.set("date_to", f.date_to);
    if (f.search) params.set("search", f.search);

    var res = await apiFetch("/api/admin/audit/export?" + params.toString());
    if (!res.ok) {
      var d = await res.json().catch(function() { return {}; });
      alert(d.error || "Export failed");
      return;
    }

    var blob = await res.blob();
    var url = window.URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "askozzy-audit-" + new Date().toISOString().split("T")[0] + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch {
    alert("Failed to export audit log");
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
//  TAB: Bulk Import & Department Onboarding
// ═══════════════════════════════════════════════════════════════════

let bulkUsers = [];
let bulkCSVFile = null; // Stores the raw CSV File object for server-side upload

function handleBulkFileDrop(event) {
  const files = event.dataTransfer.files;
  if (files.length > 0 && files[0].name.endsWith(".csv")) {
    const fileInput = document.getElementById("bulk-csv-file");
    // Create a new DataTransfer to assign to the input
    const dt = new DataTransfer();
    dt.items.add(files[0]);
    fileInput.files = dt.files;
    parseBulkCSV();
  } else {
    alert("Please drop a .csv file");
  }
}

function parseBulkCSV() {
  const fileInput = document.getElementById("bulk-csv-file");
  const file = fileInput.files[0];
  if (!file) return;

  // Store the file for potential server-side upload
  bulkCSVFile = file;

  // Show file name in drop zone
  const fileNameEl = document.getElementById("bulk-file-name");
  if (fileNameEl) {
    fileNameEl.textContent = file.name + " (" + (file.size / 1024).toFixed(1) + " KB)";
    fileNameEl.style.display = "block";
  }

  // Show the CSV upload button
  const csvBtn = document.getElementById("btn-bulk-csv-import");
  if (csvBtn) csvBtn.style.display = "inline-block";

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
    const tierIdx = headers.findIndex(h => h === "tier");

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
          tier: tierIdx >= 0 ? (cols[tierIdx] || "") : "",
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

  bulkCSVFile = null; // Clear any CSV file reference when pasting
  const csvBtn = document.getElementById("btn-bulk-csv-import");
  if (csvBtn) csvBtn.style.display = "none";

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

  // Show first 5 rows as preview with tier column
  const previewRows = bulkUsers.slice(0, 5);
  const remaining = bulkUsers.length - 5;

  tableEl.innerHTML = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr><th>#</th><th>Email</th><th>Name</th><th>Department</th><th>Tier</th></tr></thead><tbody>' +
    previewRows.map(function(u, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(u.email) + '</td><td>' + escapeHtml(u.fullName) + '</td><td>' + escapeHtml(u.department || '—') + '</td><td>' + escapeHtml(u.tier || 'default') + '</td></tr>';
    }).join("") +
    (remaining > 0 ? '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);font-size:12px;">...and ' + remaining + ' more user' + (remaining > 1 ? 's' : '') + '</td></tr>' : '') +
    '</tbody></table></div>';
}

// ─── JSON-based Bulk Import (paste or client-parsed CSV) ────────────

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

    // Store results and show results panel
    window._bulkImportResults = d.results;
    showBulkImportResults(d.results, d.summary);
    btnEl.disabled = false;

    // Refresh department stats
    loadDepartmentStats();
  } catch {
    resultEl.innerHTML = '<span class="msg-error">Import failed</span>';
    btnEl.disabled = false;
  }
}

// ─── CSV File Upload to Server ──────────────────────────────────────

async function executeBulkCSVImport() {
  if (!bulkCSVFile) {
    alert("No CSV file selected");
    return;
  }

  const tier = document.getElementById("bulk-tier").value;
  const resultEl = document.getElementById("bulk-result");
  const btnEl = document.getElementById("btn-bulk-csv-import");
  const btnImport = document.getElementById("btn-bulk-import");

  btnEl.disabled = true;
  if (btnImport) btnImport.disabled = true;
  resultEl.innerHTML = '<span style="color:var(--gold);">Uploading CSV to server...</span>';

  try {
    const formData = new FormData();
    formData.append("file", bulkCSVFile);
    formData.append("tier", tier);

    const res = await fetch(API + "/api/admin/bulk-import", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: formData,
    });
    const d = await res.json();

    if (!res.ok) {
      resultEl.innerHTML = '<span class="msg-error">' + escapeHtml(d.error || "Import failed") + '</span>';
      btnEl.disabled = false;
      if (btnImport) btnImport.disabled = false;
      return;
    }

    resultEl.innerHTML = '<span class="msg-success">Imported ' + d.imported + ' of ' + d.total + ' users' +
      (d.skipped > 0 ? ' (' + d.skipped + ' skipped)' : '') +
      (d.errors.length > 0 ? ' (' + d.errors.length + ' errors)' : '') + '</span>';

    // Convert server response to results format
    window._bulkImportResults = d.users;
    showBulkCSVImportResults(d);
    btnEl.disabled = false;
    if (btnImport) btnImport.disabled = false;

    // Refresh department stats
    loadDepartmentStats();
  } catch {
    resultEl.innerHTML = '<span class="msg-error">CSV upload failed</span>';
    btnEl.disabled = false;
    if (btnImport) btnImport.disabled = false;
  }
}

// ─── Display Import Results ─────────────────────────────────────────

function showBulkImportResults(results, summary) {
  const resultsEl = document.getElementById("bulk-results-content");
  resultsEl.style.display = "block";

  // Show summary
  var summaryEl = document.getElementById("bulk-results-summary");
  summaryEl.innerHTML = '<div class="stats-grid">' +
    '<div class="stat-card green"><div class="stat-value">' + summary.created + '</div><div class="stat-label">Created</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + summary.skipped + '</div><div class="stat-label">Skipped</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + summary.total + '</div><div class="stat-label">Total</div></div>' +
  '</div>';

  // Show download button
  var downloadBtn = document.getElementById("btn-download-codes");
  if (downloadBtn) downloadBtn.style.display = "inline-block";

  document.getElementById("bulk-results-table").innerHTML =
    '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr><th>Email</th><th>Status</th><th>Access Code</th><th>Actions</th></tr></thead><tbody>' +
    results.map(function(r) {
      const isCreated = r.status === "created";
      const code = r.accessCode || r.access_code || "";
      return '<tr>' +
        '<td>' + escapeHtml(r.email) + '</td>' +
        '<td><span class="' + (isCreated ? 'msg-success' : 'msg-error') + '">' + escapeHtml(r.status) + '</span></td>' +
        '<td>' + (code ? '<code style="font-size:14px;color:var(--gold);letter-spacing:1px;cursor:pointer;" onclick="copyAccessCode(this)" title="Click to copy">' + escapeHtml(code) + '</code>' : '—') + '</td>' +
        '<td>' + (code ? '<button class="btn-action" style="font-size:11px;padding:3px 8px;" onclick="copyAccessCode(this.parentElement.previousElementSibling.querySelector(\'code\'))">Copy</button>' : '') + '</td>' +
      '</tr>';
    }).join("") +
    '</tbody></table></div>';
}

function showBulkCSVImportResults(data) {
  const resultsEl = document.getElementById("bulk-results-content");
  resultsEl.style.display = "block";

  // Show summary
  var summaryEl = document.getElementById("bulk-results-summary");
  summaryEl.innerHTML = '<div class="stats-grid">' +
    '<div class="stat-card green"><div class="stat-value">' + data.imported + '</div><div class="stat-label">Created</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + data.skipped + '</div><div class="stat-label">Skipped</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + data.total + '</div><div class="stat-label">Total</div></div>' +
  '</div>';

  // Show download button
  var downloadBtn = document.getElementById("btn-download-codes");
  if (downloadBtn) downloadBtn.style.display = "inline-block";

  document.getElementById("bulk-results-table").innerHTML =
    '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Tier</th><th>Status</th><th>Access Code</th><th>Actions</th></tr></thead><tbody>' +
    data.users.map(function(r) {
      const isCreated = r.status === "created";
      const code = r.access_code || "";
      return '<tr>' +
        '<td>' + escapeHtml(r.name) + '</td>' +
        '<td>' + escapeHtml(r.email) + '</td>' +
        '<td>' + escapeHtml(r.department || '—') + '</td>' +
        '<td><span class="badge badge-' + (r.tier || 'free') + '">' + escapeHtml(r.tier || 'free') + '</span></td>' +
        '<td><span class="' + (isCreated ? 'msg-success' : 'msg-error') + '">' + escapeHtml(r.status) + '</span></td>' +
        '<td>' + (code ? '<code style="font-size:14px;color:var(--gold);letter-spacing:1px;cursor:pointer;" onclick="copyAccessCode(this)" title="Click to copy">' + escapeHtml(code) + '</code>' : '—') + '</td>' +
        '<td>' + (code ? '<button class="btn-action" style="font-size:11px;padding:3px 8px;" onclick="copyAccessCode(this.parentElement.previousElementSibling.querySelector(\'code\'))">Copy</button>' : '') + '</td>' +
      '</tr>';
    }).join("") +
    '</tbody></table></div>';
}

function copyAccessCode(codeEl) {
  if (!codeEl) return;
  const code = codeEl.textContent;
  navigator.clipboard.writeText(code).then(function() {
    const original = codeEl.textContent;
    codeEl.textContent = "Copied!";
    codeEl.style.color = "var(--green-light)";
    setTimeout(function() {
      codeEl.textContent = original;
      codeEl.style.color = "var(--gold)";
    }, 1500);
  }).catch(function() {
    // Fallback: select text
    const range = document.createRange();
    range.selectNodeContents(codeEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

// ─── Download Access Codes as CSV ───────────────────────────────────

function downloadAccessCodesCSV() {
  var results = window._bulkImportResults;
  if (!results || results.length === 0) return;

  var csv = "full_name,email,department,tier,access_code,status\n";
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var code = r.accessCode || r.access_code || "";
    var name = r.name || r.fullName || "";
    csv += '"' + name.replace(/"/g, '""') + '","' +
      (r.email || "").replace(/"/g, '""') + '","' +
      (r.department || "").replace(/"/g, '""') + '","' +
      (r.tier || "free").replace(/"/g, '""') + '","' +
      code.replace(/"/g, '""') + '","' +
      (r.status || "").replace(/"/g, '""') + '"\n';
  }

  var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "askozzy-access-codes-" + new Date().toISOString().split("T")[0] + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportBulkResults() {
  // Legacy compat — redirect to new function
  downloadAccessCodesCSV();
}

// ═══════════════════════════════════════════════════════════════════
//  Department Stats Dashboard
// ═══════════════════════════════════════════════════════════════════

async function loadDepartmentStats() {
  var el = document.getElementById("dept-stats-content");
  if (!el) return;
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    var res = await apiFetch("/api/admin/departments/stats");
    var data = await res.json();
    var departments = data.departments || [];

    if (departments.length === 0) {
      el.innerHTML = '<div class="admin-card"><h3>Department Dashboard</h3><div class="admin-empty">No department data yet. Import users with department fields to see stats here.</div></div>';
      return;
    }

    // Summary stats
    var totalUsers = 0, totalActive = 0, totalConvos = 0, totalMsgs = 0;
    for (var i = 0; i < departments.length; i++) {
      totalUsers += departments[i].user_count || 0;
      totalActive += departments[i].active_users || 0;
      totalConvos += departments[i].total_conversations || 0;
      totalMsgs += departments[i].total_messages || 0;
    }

    var html = '<div class="admin-card" style="margin-bottom:20px;">' +
      '<h3>Department Dashboard</h3>' +
      '<div class="stats-grid" style="margin-bottom:20px;">' +
        '<div class="stat-card"><div class="stat-value">' + departments.length + '</div><div class="stat-label">Departments</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + totalUsers + '</div><div class="stat-label">Total Users</div></div>' +
        '<div class="stat-card green"><div class="stat-value">' + totalActive + '</div><div class="stat-label">Active (7d)</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + totalConvos + '</div><div class="stat-label">Conversations</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + totalMsgs + '</div><div class="stat-label">Messages</div></div>' +
      '</div>';

    // Department comparison bar chart — Users
    var maxUsers = Math.max.apply(null, departments.map(function(d) { return d.user_count; }));
    if (maxUsers < 1) maxUsers = 1;

    html += '<div class="admin-row">' +
      '<div class="admin-card">' +
        '<h3 style="font-size:14px;">Users per Department</h3>' +
        '<div class="bar-chart">';

    for (var i = 0; i < Math.min(departments.length, 15); i++) {
      var dept = departments[i];
      var pct = (dept.user_count / maxUsers) * 100;
      html += '<div class="bar-row">' +
        '<span class="bar-label" title="' + escapeHtml(dept.department) + '">' + escapeHtml(dept.department.length > 30 ? dept.department.substring(0, 28) + '...' : dept.department) + '</span>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(pct, 1) + '%"></div></div>' +
        '<span class="bar-value">' + dept.user_count + '</span>' +
      '</div>';
    }

    html += '</div></div>';

    // Department comparison bar chart — Active Users
    var maxActive = Math.max.apply(null, departments.map(function(d) { return d.active_users; }));
    if (maxActive < 1) maxActive = 1;

    html += '<div class="admin-card">' +
        '<h3 style="font-size:14px;">Active Users (7d)</h3>' +
        '<div class="bar-chart">';

    for (var i = 0; i < Math.min(departments.length, 15); i++) {
      var dept = departments[i];
      var pct = (dept.active_users / maxActive) * 100;
      html += '<div class="bar-row">' +
        '<span class="bar-label" title="' + escapeHtml(dept.department) + '">' + escapeHtml(dept.department.length > 30 ? dept.department.substring(0, 28) + '...' : dept.department) + '</span>' +
        '<div class="bar-track"><div class="bar-fill green" style="width:' + Math.max(pct, 1) + '%"></div></div>' +
        '<span class="bar-value">' + dept.active_users + '</span>' +
      '</div>';
    }

    html += '</div></div></div>';

    // Department details table
    html += '<div class="admin-table-wrapper" style="margin-top:16px;"><table class="admin-table"><thead><tr>' +
      '<th>Department</th><th>Users</th><th>Active (7d)</th><th>Conversations</th><th>Messages</th><th>Top Templates</th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < departments.length; i++) {
      var dept = departments[i];
      var templates = (dept.top_templates || []).slice(0, 3).map(function(t) {
        return escapeHtml(t.template_id) + ' (' + t.usage_count + ')';
      }).join(', ') || '—';

      html += '<tr>' +
        '<td><strong>' + escapeHtml(dept.department) + '</strong></td>' +
        '<td>' + dept.user_count + '</td>' +
        '<td>' + dept.active_users + '</td>' +
        '<td>' + dept.total_conversations + '</td>' +
        '<td>' + dept.total_messages + '</td>' +
        '<td style="font-size:11px;color:var(--text-muted);">' + templates + '</td>' +
      '</tr>';
    }

    html += '</tbody></table></div></div>';

    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = '<div class="admin-card"><h3>Department Dashboard</h3><div class="admin-empty">Failed to load department stats</div></div>';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Document Training (Enhanced with Bulk Upload & Stats)
// ═══════════════════════════════════════════════════════════════════

// Category display names
var CATEGORY_LABELS = {
  general: "General",
  procurement: "Procurement",
  procurement_law: "Procurement Law",
  finance: "Finance & Budget",
  financial_admin: "Financial Admin",
  hr: "Human Resources",
  legal: "Legal & Regulations",
  civil_service: "Civil Service",
  budget_policy: "Budget Policy",
  gog_forms: "GoG Forms",
  general_regulation: "General Regulation",
  ict: "ICT & Digital",
  health: "Health",
  education: "Education",
  governance: "Governance",
};

function categoryLabel(cat) {
  return CATEGORY_LABELS[cat] || cat || "General";
}

// Bulk upload state
var bulkUploadFiles = [];

var dtSearchPage = 1;
var debouncedDtSearch = debounce(function() {
  dtSearchPage = 1;
  loadEnhancedTrainingStatus();
}, 400);

// ─── Stats Dashboard ─────────────────────────────────────────────

async function loadDtStatsDashboard() {
  var el = document.getElementById("dt-stats-dashboard");
  if (!el) return;

  try {
    var res = await apiFetch("/api/admin/knowledge/stats");
    var s = await res.json();

    var html = '<div class="stats-grid" style="margin-bottom:16px;">' +
      '<div class="stat-card"><div class="stat-value">' + (s.total_documents || 0) + '</div><div class="stat-label">Total Documents</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (s.total_chunks || 0).toLocaleString() + '</div><div class="stat-label">Total Chunks</div></div>' +
      '<div class="stat-card green"><div class="stat-value">' + (s.categories_covered || 0) + '</div><div class="stat-label">Categories</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (s.storage_estimate ? s.storage_estimate.total_mb : 0) + ' MB</div><div class="stat-label">Est. Storage</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (s.ready_documents || 0) + '</div><div class="stat-label">Ready</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (s.processing_documents || 0) + '</div><div class="stat-label">Processing</div></div>' +
    '</div>';

    var cats = s.by_category || [];
    if (cats.length > 0) {
      var maxCount = Math.max.apply(null, cats.map(function(c) { return c.doc_count; }));
      html += '<div style="margin-top:8px;">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;">Documents by Category</div>';
      for (var i = 0; i < cats.length; i++) {
        var pct = maxCount > 0 ? Math.round((cats[i].doc_count / maxCount) * 100) : 0;
        html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
          '<span style="min-width:120px;font-size:11px;color:var(--text-secondary);text-align:right;">' + categoryLabel(cats[i].category) + '</span>' +
          '<div style="flex:1;height:18px;background:var(--bg-tertiary);border-radius:9px;overflow:hidden;">' +
            '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,var(--gold),var(--green-light));border-radius:9px;transition:width 0.3s;"></div>' +
          '</div>' +
          '<span style="min-width:60px;font-size:11px;color:var(--text-muted);">' + cats[i].doc_count + ' docs / ' + (cats[i].chunk_count || 0) + ' chunks</span>' +
        '</div>';
      }
      html += '</div>';
    }

    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load knowledge base stats</div>';
  }
}

// ─── GoG Document Library ─────────────────────────────────────────

async function loadGogLibrary() {
  var el = document.getElementById("gog-library-content");
  if (!el) return;

  try {
    var res = await apiFetch("/api/admin/knowledge/stats");
    var s = await res.json();
    var library = s.gog_library || [];

    if (library.length === 0) {
      el.innerHTML = '<div class="admin-empty">Unable to load GoG document library status</div>';
      return;
    }

    var html = '<div style="display:grid;gap:8px;">';
    for (var i = 0; i < library.length; i++) {
      var doc = library[i];
      var statusColor = doc.uploaded ? 'var(--green-light)' : 'var(--text-muted)';
      var statusText = doc.uploaded ? 'Uploaded (' + doc.doc_count + ')' : 'Not yet uploaded';
      var statusIcon = doc.uploaded ? '&#x2713;' : '&#x25CB;';
      html += '<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--bg-tertiary);border-radius:var(--radius-sm);border:1px solid var(--border-color);">' +
        '<span style="font-size:18px;color:' + statusColor + ';">' + statusIcon + '</span>' +
        '<div style="flex:1;">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text-primary);">' + escapeHtml(doc.name) + '</div>' +
          '<div style="font-size:11px;color:var(--text-muted);">Category: ' + categoryLabel(doc.category) + '</div>' +
        '</div>' +
        '<span style="font-size:11px;font-weight:600;color:' + statusColor + ';">' + statusText + '</span>' +
      '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load GoG library status</div>';
  }
}

// ─── Bulk Upload ─────────────────────────────────────────────────

function detectCategoryFromName(filename) {
  var name = filename.toLowerCase();
  if (name.includes('procurement') || name.includes('tender') || name.includes('act 663') || name.includes('ppa')) return 'procurement_law';
  if (name.includes('financial admin') || name.includes('act 654') || name.includes('treasury')) return 'financial_admin';
  if (name.includes('civil service') || name.includes('ohcs')) return 'civil_service';
  if (name.includes('budget') || name.includes('economic policy') || name.includes('mtef')) return 'budget_policy';
  if (name.includes('form') || name.includes('template') || name.includes('voucher')) return 'gog_forms';
  if (name.includes('procurement')) return 'procurement';
  if (name.includes('finance') || name.includes('fiscal') || name.includes('revenue')) return 'finance';
  if (name.includes('human resource') || name.includes('staff') || name.includes('leave') || name.includes('pension')) return 'hr';
  if (name.includes('legal') || name.includes('law') || name.includes('regulation') || name.includes('act')) return 'legal';
  if (name.includes('ict') || name.includes('digital') || name.includes('technology') || name.includes('cyber')) return 'ict';
  if (name.includes('health') || name.includes('medical') || name.includes('nhis')) return 'health';
  if (name.includes('education') || name.includes('school') || name.includes('university')) return 'education';
  if (name.includes('governance') || name.includes('assembly') || name.includes('parliament')) return 'governance';
  return 'general';
}

function handleBulkDrop(e) {
  e.preventDefault();
  e.currentTarget.style.borderColor = 'var(--border-color)';
  e.currentTarget.style.background = 'var(--bg-tertiary)';
  var files = Array.from(e.dataTransfer.files);
  if (files.length > 0) addBulkFiles(files);
}

function handleBulkFileSelect(fileList) {
  var files = Array.from(fileList);
  if (files.length > 0) addBulkFiles(files);
}

function addBulkFiles(newFiles) {
  for (var i = 0; i < newFiles.length; i++) {
    var f = newFiles[i];
    if (f.name.startsWith('.') || f.name === 'Thumbs.db' || f.name === 'desktop.ini') continue;
    bulkUploadFiles.push({ file: f, category: detectCategoryFromName(f.name) });
  }
  renderBulkFileList();
}

function clearBulkFiles() {
  bulkUploadFiles = [];
  renderBulkFileList();
  document.getElementById("bulk-file-input").value = "";
  document.getElementById("bulk-upload-result").innerHTML = "";
  document.getElementById("bulk-upload-detail").innerHTML = "";
}

function removeBulkFile(idx) {
  bulkUploadFiles.splice(idx, 1);
  renderBulkFileList();
}

function updateBulkCategory(idx, value) {
  if (bulkUploadFiles[idx]) bulkUploadFiles[idx].category = value;
}

function renderBulkFileList() {
  var listEl = document.getElementById("bulk-file-list");
  var wrapperEl = document.getElementById("bulk-file-table-wrapper");
  var btnEl = document.getElementById("btn-bulk-upload");

  if (bulkUploadFiles.length === 0) {
    listEl.style.display = "none";
    btnEl.style.display = "none";
    return;
  }

  listEl.style.display = "block";
  btnEl.style.display = "inline-block";

  var totalSize = bulkUploadFiles.reduce(function(s, item) { return s + item.file.size; }, 0);
  var catOptions = Object.keys(CATEGORY_LABELS).map(function(key) {
    return '<option value="' + key + '">' + CATEGORY_LABELS[key] + '</option>';
  }).join('');

  var html = '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">' +
    bulkUploadFiles.length + ' files (' + (totalSize / 1024).toFixed(1) + ' KB total)</div>' +
    '<table class="admin-table" style="font-size:12px;"><thead><tr>' +
    '<th>File</th><th>Size</th><th>Detected Category</th><th></th></tr></thead><tbody>';

  for (var i = 0; i < bulkUploadFiles.length; i++) {
    var item = bulkUploadFiles[i];
    var selectedCatOptions = catOptions.replace('value="' + item.category + '">', 'value="' + item.category + '" selected>');
    html += '<tr>' +
      '<td>' + escapeHtml(item.file.name) + '</td>' +
      '<td>' + (item.file.size / 1024).toFixed(1) + ' KB</td>' +
      '<td><select class="inline-select" style="padding:4px 8px;font-size:11px;" onchange="updateBulkCategory(' + i + ',this.value)">' + selectedCatOptions + '</select></td>' +
      '<td><button class="btn-action" onclick="removeBulkFile(' + i + ')" style="font-size:10px;padding:2px 8px;color:var(--red);">Remove</button></td></tr>';
  }

  html += '</tbody></table>';
  wrapperEl.innerHTML = html;
}

async function executeBulkUpload() {
  if (bulkUploadFiles.length === 0) return;

  var resultEl = document.getElementById("bulk-upload-result");
  var detailEl = document.getElementById("bulk-upload-detail");
  var btnEl = document.getElementById("btn-bulk-upload");
  btnEl.disabled = true;

  resultEl.innerHTML = '<span style="color:var(--gold);">Uploading ' + bulkUploadFiles.length + ' files...</span>';
  detailEl.innerHTML = '';

  var formData = new FormData();
  for (var i = 0; i < bulkUploadFiles.length; i++) {
    formData.append('files', bulkUploadFiles[i].file);
    formData.append('category_' + i, bulkUploadFiles[i].category);
  }

  try {
    var res = await fetch(API + "/api/admin/knowledge/bulk", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: formData,
    });
    var data = await res.json();

    if (!res.ok) {
      resultEl.innerHTML = '<span class="msg-error">' + escapeHtml(data.error || "Bulk upload failed") + '</span>';
      btnEl.disabled = false;
      return;
    }

    var succCount = data.uploaded || 0;
    var errCount = (data.errors || []).length;

    resultEl.innerHTML = '<span class="msg-success">' + succCount + ' of ' + data.total_files + ' documents uploaded!</span>' +
      (errCount > 0 ? ' <span class="msg-error">(' + errCount + ' errors)</span>' : '') +
      '<br><span style="font-size:11px;color:var(--text-muted);">~' + (data.chunks_created || 0) + ' chunks will be created</span>';

    if (data.results && data.results.length > 0) {
      var tableHtml = '<div class="admin-table-wrapper"><table class="admin-table" style="font-size:12px;"><thead><tr>' +
        '<th>File</th><th>Category</th><th>Est. Chunks</th><th>Status</th></tr></thead><tbody>';
      for (var j = 0; j < data.results.length; j++) {
        var r = data.results[j];
        if (r.status === 'success') {
          tableHtml += '<tr><td>' + escapeHtml(r.filename) + '</td><td>' + categoryLabel(r.category) + '</td><td>' + (r.chunks || 0) + '</td><td><span style="color:var(--green-light);font-weight:600;">Processing</span></td></tr>';
        } else {
          tableHtml += '<tr><td>' + escapeHtml(r.filename) + '</td><td>-</td><td>-</td><td><span style="color:var(--red);font-weight:600;">' + escapeHtml(r.error || 'Failed') + '</span></td></tr>';
        }
      }
      tableHtml += '</tbody></table></div>';
      detailEl.innerHTML = tableHtml;
    }

    bulkUploadFiles = [];
    renderBulkFileList();
    document.getElementById("bulk-file-input").value = "";
    loadDtStatsDashboard();
    loadGogLibrary();
    loadEnhancedTrainingStatus();
  } catch (err) {
    resultEl.innerHTML = '<span class="msg-error">Bulk upload failed: ' + escapeHtml(err.message || "Network error") + '</span>';
  }

  btnEl.disabled = false;
}

// ─── Enhanced Training Status (search, filter, pagination, delete) ──

async function loadEnhancedTrainingStatus(page) {
  var el = document.getElementById("training-status-content");
  if (!el) return;
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  if (page) dtSearchPage = page;
  var currentPage = dtSearchPage || 1;

  var searchVal = "";
  var catVal = "";
  var searchEl = document.getElementById("dt-search");
  var catEl = document.getElementById("dt-category-filter");
  if (searchEl) searchVal = searchEl.value.trim();
  if (catEl) catVal = catEl.value;

  try {
    var url = "/api/admin/knowledge/documents?page=" + currentPage + "&limit=15";
    if (catVal) url += "&category=" + encodeURIComponent(catVal);
    if (searchVal) url += "&search=" + encodeURIComponent(searchVal);

    var docsRes = await apiFetch(url);
    var docs = await docsRes.json();

    var statusIcons = {
      ready: '<span style="color:var(--green-light);font-weight:600;">Ready</span>',
      processing: '<span style="color:var(--gold);font-weight:600;">Processing...</span>',
      error: '<span style="color:var(--red);font-weight:600;">Error</span>',
    };

    if ((docs.documents || []).length > 0) {
      el.innerHTML = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
        '<th>Title</th><th>Source</th><th>Category</th><th>Chunks</th><th>Status</th><th>Date</th><th>Actions</th>' +
        '</tr></thead><tbody>' +
        docs.documents.map(function(doc) {
          return '<tr><td><strong>' + escapeHtml(doc.title) + '</strong></td>' +
            '<td>' + escapeHtml(doc.source || '-') + '</td>' +
            '<td><span style="background:var(--bg-primary);padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;">' + categoryLabel(doc.category) + '</span></td>' +
            '<td>' + (doc.chunk_count || 0) + '</td>' +
            '<td>' + (statusIcons[doc.status] || doc.status) + '</td>' +
            '<td>' + formatDateShort(doc.created_at) + '</td>' +
            '<td><button class="btn-action" onclick="deleteTrainedDoc(\'' + doc.id + '\')" style="font-size:10px;padding:3px 8px;color:var(--red);">Delete</button></td></tr>';
        }).join("") +
        '</tbody></table></div>';

      renderPagination("dt-pagination", currentPage, docs.total || 0, 15, "loadEnhancedTrainingStatus");
    } else {
      el.innerHTML = '<div class="admin-empty">No documents found' +
        (searchVal || catVal ? ' matching your filters.' : '. Upload your first document above!') + '</div>';
      var pagEl = document.getElementById("dt-pagination");
      if (pagEl) pagEl.innerHTML = "";
    }
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load training status</div>';
  }
}

async function deleteTrainedDoc(docId) {
  if (!confirm("Delete this trained document? This will remove all chunks and vector embeddings.")) return;
  try {
    var res = await apiFetch("/api/admin/documents/" + docId, { method: "DELETE" });
    if (res.ok) { loadTrainingStatus(); }
    else { var d = await res.json(); alert("Delete failed: " + (d.error || "Unknown error")); }
  } catch (err) { alert("Delete failed: network error"); }
}

// ─── Single Document Upload & Existing Functions ─────────────────

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
  var BINARY_EXT = [".pdf", ".zip", ".rar", ".7z", ".exe", ".bin", ".dll", ".iso", ".img", ".mp3", ".mp4", ".avi", ".mov", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".woff", ".woff2", ".ttf", ".eot"];
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
      '<br><span style="font-size:11px;color:var(--gold);">Supported formats: .docx, .pptx, .doc, .txt, .md, .csv, .json, .html</span>';
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
  // Delegate to new enhanced sub-loaders
  loadDtStatsDashboard();
  loadGogLibrary();
  loadEnhancedTrainingStatus();
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

// ═══════════════════════════════════════════════════════════════════
//  TAB: AI Agents Management
// ═══════════════════════════════════════════════════════════════════

async function loadAgentsList() {
  var el = document.getElementById("agents-list-content");
  if (!el) return;
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    var res = await apiFetch("/api/admin/agents");
    var data = await res.json();
    var agents = data.agents || [];

    if (agents.length === 0) {
      el.innerHTML = '<div class="admin-empty">No agents created yet. Click "+ New Agent" to create your first department agent.</div>';
      return;
    }

    var html = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
      '<th>Icon</th><th>Name</th><th>Department</th><th>Category</th><th>Status</th><th>Created</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < agents.length; i++) {
      var a = agents[i];
      html += '<tr>' +
        '<td style="font-size:24px;text-align:center;">' + (a.icon || '🤖') + '</td>' +
        '<td><strong>' + escapeHtml(a.name) + '</strong><br><span style="font-size:11px;color:var(--text-muted);">' + escapeHtml(a.description || '').substring(0, 60) + '</span></td>' +
        '<td>' + escapeHtml(a.department || '—') + '</td>' +
        '<td>' + escapeHtml(a.knowledge_category || 'All') + '</td>' +
        '<td>' + (a.active ? '<span style="color:var(--green-light);font-weight:600;">Active</span>' : '<span style="color:var(--text-muted);">Inactive</span>') + '</td>' +
        '<td>' + formatDateShort(a.created_at) + '</td>' +
        '<td style="white-space:nowrap;">' +
          '<button class="btn-action" onclick="editAgent(\'' + a.id + '\')" style="font-size:11px;padding:4px 10px;">Edit</button> ' +
          '<button class="btn-action" onclick="toggleAgentActive(\'' + a.id + '\',' + (a.active ? 'false' : 'true') + ')" style="font-size:11px;padding:4px 10px;">' + (a.active ? 'Disable' : 'Enable') + '</button> ' +
          '<button class="btn-action" onclick="deleteAgent(\'' + a.id + '\')" style="font-size:11px;padding:4px 10px;color:var(--red);">Delete</button>' +
        '</td></tr>';
    }

    html += '</tbody></table></div>';
    el.innerHTML = html;
  } catch {
    el.innerHTML = '<div class="admin-empty">Failed to load agents</div>';
  }
}

function openAgentForm(agentData) {
  document.getElementById("agent-form-card").style.display = "block";
  document.getElementById("agent-form-title").textContent = agentData ? "Edit Agent" : "Create New Agent";
  document.getElementById("agent-form-id").value = agentData ? agentData.id : "";
  document.getElementById("agent-icon").value = agentData ? (agentData.icon || "🤖") : "🤖";
  document.getElementById("agent-name").value = agentData ? agentData.name : "";
  document.getElementById("agent-description").value = agentData ? (agentData.description || "") : "";
  document.getElementById("agent-department").value = agentData ? (agentData.department || "") : "";
  document.getElementById("agent-knowledge-cat").value = agentData ? (agentData.knowledge_category || "") : "";
  document.getElementById("agent-system-prompt").value = agentData ? agentData.system_prompt : "";
  document.getElementById("agent-form-result").textContent = "";
  document.getElementById("agent-form-card").scrollIntoView({ behavior: "smooth" });
}

function cancelAgentForm() {
  document.getElementById("agent-form-card").style.display = "none";
}

async function saveAgent() {
  var id = document.getElementById("agent-form-id").value;
  var body = {
    icon: document.getElementById("agent-icon").value.trim() || "🤖",
    name: document.getElementById("agent-name").value.trim(),
    description: document.getElementById("agent-description").value.trim(),
    department: document.getElementById("agent-department").value.trim(),
    knowledge_category: document.getElementById("agent-knowledge-cat").value || null,
    system_prompt: document.getElementById("agent-system-prompt").value.trim(),
  };

  var resultEl = document.getElementById("agent-form-result");

  if (!body.name) { resultEl.innerHTML = '<span class="msg-error">Name is required</span>'; return; }
  if (!body.system_prompt) { resultEl.innerHTML = '<span class="msg-error">System prompt is required</span>'; return; }

  resultEl.innerHTML = '<span style="color:var(--gold);">Saving...</span>';

  try {
    var url = id ? "/api/admin/agents/" + id : "/api/admin/agents";
    var method = id ? "PATCH" : "POST";
    var res = await apiFetch(url, { method: method, body: JSON.stringify(body) });
    var data = await res.json();

    if (!res.ok) {
      resultEl.innerHTML = '<span class="msg-error">' + escapeHtml(data.error || "Failed to save") + '</span>';
    } else {
      resultEl.innerHTML = '<span class="msg-success">Agent saved!</span>';
      cancelAgentForm();
      loadAgentsList();
    }
  } catch {
    resultEl.innerHTML = '<span class="msg-error">Network error</span>';
  }
}

async function editAgent(id) {
  try {
    var res = await apiFetch("/api/admin/agents");
    var data = await res.json();
    var agent = (data.agents || []).find(function(a) { return a.id === id; });
    if (agent) openAgentForm(agent);
  } catch {}
}

async function toggleAgentActive(id, active) {
  try {
    await apiFetch("/api/admin/agents/" + id, {
      method: "PATCH",
      body: JSON.stringify({ active: active ? 1 : 0 }),
    });
    loadAgentsList();
  } catch {}
}

async function deleteAgent(id) {
  if (!confirm("Delete this agent? This cannot be undone.")) return;
  try {
    await apiFetch("/api/admin/agents/" + id, { method: "DELETE" });
    loadAgentsList();
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Productivity Dashboard
// ═══════════════════════════════════════════════════════════════════

var adminProductivityChart = null;

async function loadProductivityTab() {
  var el = document.getElementById("productivity-content");
  if (!el) return;
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    var res = await apiFetch("/api/admin/productivity");
    var d = await res.json();

    var overall = d.overall || {};
    var totalMinutes = overall.estimated_minutes_saved || 0;
    var totalHours = (totalMinutes / 60).toFixed(1);
    var roiValue = (totalMinutes / 60 * 25).toFixed(2);
    var totalMessages = overall.messages_sent || 0;
    var totalDocs = (overall.documents_generated || 0) + (overall.workflows_completed || 0);
    var totalResearch = (overall.research_reports || 0) + (overall.analyses_run || 0);

    var html = '';

    // Stats cards
    html += '<div class="stats-grid">' +
      '<div class="stat-card"><div class="stat-value">' + totalMessages + '</div><div class="stat-label">Total Messages</div></div>' +
      '<div class="stat-card green"><div class="stat-value">' + totalHours + 'h</div><div class="stat-label">Hours Saved</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + totalDocs + '</div><div class="stat-label">Documents Generated</div></div>' +
      '<div class="stat-card green"><div class="stat-value">GHS ' + roiValue + '</div><div class="stat-label">Estimated ROI Value</div></div>' +
      '</div>';

    // ROI Calculator card
    html += '<div class="admin-row">' +
      '<div class="admin-card">' +
      '<h3>ROI Calculator</h3>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;text-align:center;">' +
      '<div style="background:var(--bg-tertiary);border-radius:8px;padding:16px;">' +
        '<div style="font-size:24px;font-weight:700;color:var(--gold);">' + totalHours + '</div>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Total Hours Saved</div>' +
      '</div>' +
      '<div style="background:var(--bg-tertiary);border-radius:8px;padding:16px;">' +
        '<div style="font-size:24px;font-weight:700;color:var(--text-primary);">GHS 25/hr</div>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Avg. Staff Rate</div>' +
      '</div>' +
      '<div style="background:var(--bg-tertiary);border-radius:8px;padding:16px;">' +
        '<div style="font-size:24px;font-weight:700;color:#006B3F;">GHS ' + roiValue + '</div>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Total Value Generated</div>' +
      '</div>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--text-muted);margin-top:12px;">Based on estimated time savings across all AI operations: chat (2 min/msg), research (30 min), analysis (20 min), meetings (60 min), workflows (45 min).</div>' +
      '</div>';

    // Daily usage trend chart
    html += '<div class="admin-card">' +
      '<h3>Daily Usage Trend (Last 30 Days)</h3>' +
      '<div style="position:relative;height:300px;">' +
      '<canvas id="admin-productivity-chart" width="800" height="300"></canvas>' +
      '</div>' +
      '</div>' +
      '</div>';

    // Department leaderboard
    html += '<div class="admin-row">' +
      '<div class="admin-card">' +
      '<h3>Department Leaderboard</h3>';

    if ((d.departments || []).length === 0) {
      html += '<div class="admin-empty">No productivity data yet</div>';
    } else {
      html += '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
        '<th>Department</th><th>Users</th><th>Messages</th><th>Research</th><th>Docs</th><th>Hours Saved</th>' +
        '</tr></thead><tbody>';
      (d.departments || []).forEach(function(dept) {
        var deptHours = (dept.estimated_minutes_saved / 60).toFixed(1);
        html += '<tr>' +
          '<td>' + escapeHtml(dept.department || 'Unknown') + '</td>' +
          '<td>' + dept.user_count + '</td>' +
          '<td>' + dept.messages_sent + '</td>' +
          '<td>' + dept.research_reports + '</td>' +
          '<td>' + ((dept.documents_generated || 0) + (dept.workflows_completed || 0)) + '</td>' +
          '<td style="font-weight:600;color:var(--gold);">' + deptHours + 'h</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';

    // Top users
    html += '<div class="admin-card">' +
      '<h3>Top 10 Users by Time Saved</h3>';

    if ((d.topUsers || []).length === 0) {
      html += '<div class="admin-empty">No productivity data yet</div>';
    } else {
      html += '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
        '<th>#</th><th>Name</th><th>Department</th><th>Messages</th><th>Hours Saved</th>' +
        '</tr></thead><tbody>';
      (d.topUsers || []).forEach(function(u, i) {
        var uHours = (u.estimated_minutes_saved / 60).toFixed(1);
        html += '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td>' + escapeHtml(u.full_name) + '</td>' +
          '<td>' + escapeHtml(u.department || 'Unknown') + '</td>' +
          '<td>' + u.messages_sent + '</td>' +
          '<td style="font-weight:600;color:var(--gold);">' + uHours + 'h</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div></div>';

    el.innerHTML = html;

    // Render line chart
    if (typeof Chart !== "undefined" && d.dailyTotals && d.dailyTotals.length > 0) {
      if (adminProductivityChart) {
        adminProductivityChart.destroy();
        adminProductivityChart = null;
      }

      var labels = d.dailyTotals.map(function(day) { return day.stat_date.slice(5); });
      var msgData = d.dailyTotals.map(function(day) { return day.messages_sent; });
      var minutesData = d.dailyTotals.map(function(day) { return Math.round(day.estimated_minutes_saved / 60 * 10) / 10; });

      setTimeout(function() {
        var canvas = document.getElementById("admin-productivity-chart");
        if (!canvas) return;
        try {
          adminProductivityChart = new Chart(canvas, {
            type: "line",
            data: {
              labels: labels,
              datasets: [
                {
                  label: "Messages",
                  data: msgData,
                  borderColor: "#CE1126",
                  backgroundColor: "rgba(206,17,38,0.1)",
                  fill: true,
                  tension: 0.3,
                  borderWidth: 2,
                  pointRadius: 2,
                  yAxisID: "y",
                },
                {
                  label: "Hours Saved",
                  data: minutesData,
                  borderColor: "#006B3F",
                  backgroundColor: "rgba(0,107,63,0.1)",
                  fill: true,
                  tension: 0.3,
                  borderWidth: 2,
                  pointRadius: 2,
                  yAxisID: "y1",
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: "index", intersect: false },
              plugins: {
                legend: {
                  position: "bottom",
                  labels: { color: "var(--text-secondary)", boxWidth: 12, font: { size: 11 } },
                },
              },
              scales: {
                x: {
                  ticks: { color: "var(--text-secondary)", font: { size: 10 }, maxRotation: 45 },
                  grid: { display: false },
                },
                y: {
                  type: "linear",
                  display: true,
                  position: "left",
                  beginAtZero: true,
                  title: { display: true, text: "Messages", color: "#CE1126", font: { size: 11 } },
                  ticks: { color: "#CE1126", font: { size: 10 } },
                  grid: { color: "rgba(128,128,128,0.1)" },
                },
                y1: {
                  type: "linear",
                  display: true,
                  position: "right",
                  beginAtZero: true,
                  title: { display: true, text: "Hours Saved", color: "#006B3F", font: { size: 11 } },
                  ticks: { color: "#006B3F", font: { size: 10 } },
                  grid: { drawOnChartArea: false },
                },
              },
            },
          });
        } catch (e) {
          console.error("Admin productivity chart error:", e);
        }
      }, 100);
    }
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load productivity data</div>';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: USSD
// ═══════════════════════════════════════════════════════════════════

let ussdTestHistory = [];

async function loadUSSDTab() {
  const el = document.getElementById("ussd-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    // Load config and stats in parallel
    const [configRes, statsRes] = await Promise.all([
      apiFetch("/api/admin/ussd/config"),
      apiFetch("/api/admin/ussd/stats"),
    ]);
    const config = await configRes.json();
    const stats = await statsRes.json();

    const menuLabels = {
      main: "Main Menu",
      ask_question: "Ask Question",
      draft_memo: "Draft Memo",
      templates: "Templates",
      template_view: "Template View",
      account: "My Account",
      ai_response: "AI Response",
      memo_response: "Memo Response",
      error: "Error",
      end: "Session End",
    };

    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${stats.total_sessions || 0}</div>
          <div class="stat-label">Total USSD Sessions</div>
        </div>
        <div class="stat-card green">
          <div class="stat-value">${stats.sessions_today || 0}</div>
          <div class="stat-label">Sessions Today</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.unique_phones || 0}</div>
          <div class="stat-label">Unique Phones</div>
        </div>
        <div class="stat-card ${config.enabled ? 'green' : ''}">
          <div class="stat-value">${config.enabled ? 'Active' : 'Disabled'}</div>
          <div class="stat-label">Service Status</div>
        </div>
      </div>

      <div class="admin-row">
        <!-- USSD Configuration -->
        <div class="admin-card">
          <h3>USSD Configuration</h3>
          <div style="display:flex;flex-direction:column;gap:14px;">
            <div>
              <label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;">Callback URL</label>
              <div style="display:flex;gap:8px;">
                <input type="text" id="ussd-callback-url" value="${escapeHtml(config.callbackUrl || 'https://askozzy.ghwmelite.workers.dev/api/ussd/callback')}" readonly
                  style="flex:1;padding:10px 14px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:var(--radius-sm);color:var(--text-primary);font-size:13px;font-family:monospace;outline:none;" />
                <button class="btn-action" onclick="copyUSSDUrl()" title="Copy URL">Copy</button>
              </div>
              <p style="font-size:11px;color:var(--text-muted);margin-top:4px;">Set this URL in your Africa's Talking USSD dashboard</p>
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;">Service Code</label>
              <input type="text" id="ussd-service-code" value="${escapeHtml(config.serviceCode || '*713*OZZY#')}"
                style="width:200px;padding:10px 14px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:var(--radius-sm);color:var(--text-primary);font-size:14px;outline:none;" />
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
              <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-secondary);cursor:pointer;">
                <input type="checkbox" id="ussd-enabled" ${config.enabled ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;" />
                USSD Service Enabled
              </label>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <button class="btn-action primary" onclick="saveUSSDConfig()">Save Configuration</button>
              <span id="ussd-config-result" style="font-size:12px;"></span>
            </div>
          </div>
        </div>

        <!-- Popular Menu Choices -->
        <div class="admin-card">
          <h3>Popular Menu Choices</h3>
          ${(stats.popular_menu_choices || []).length === 0
            ? '<div class="admin-empty">No USSD sessions yet</div>'
            : '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr><th>Menu</th><th>Count</th></tr></thead><tbody>' +
              (stats.popular_menu_choices || []).map(function(m) {
                return '<tr><td>' + escapeHtml(menuLabels[m.current_menu] || m.current_menu) + '</td><td>' + m.count + '</td></tr>';
              }).join('') +
              '</tbody></table></div>'
          }
        </div>
      </div>

      <!-- USSD Test Simulator (collapsed by default when not enabled) -->
      ${!config.enabled ? '<div class="admin-card" style="margin-top:16px;background:var(--bg-tertiary);border:1px dashed var(--border-color);"><p style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px;">Enable the USSD service and connect Africa\'s Talking to use the test simulator.</p></div>' : ''}
      <div class="admin-card" style="margin-top:16px;${!config.enabled ? 'display:none;' : ''}">
        <h3>USSD Test Simulator</h3>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">Test the USSD menu flow without an actual phone. This simulates Africa's Talking callbacks.</p>
        <div style="display:flex;gap:12px;align-items:flex-start;">
          <div style="flex:1;">
            <div id="ussd-sim-screen" style="background:#1a1a2e;color:#00ff88;font-family:'Courier New',monospace;padding:16px;border-radius:8px;min-height:180px;font-size:13px;line-height:1.6;white-space:pre-wrap;border:2px solid #333;margin-bottom:12px;">Dial to start...</div>
            <div style="display:flex;gap:8px;">
              <input type="text" id="ussd-sim-input" placeholder="Enter your response..."
                style="flex:1;padding:10px 14px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:var(--radius-sm);color:var(--text-primary);font-size:14px;outline:none;"
                onkeydown="if(event.key==='Enter')sendUSSDInput()" />
              <button class="btn-action primary" onclick="sendUSSDInput()">Send</button>
              <button class="btn-action" onclick="dialUSSD()">Dial</button>
              <button class="btn-action" onclick="resetUSSDSim()" style="color:var(--error);">End</button>
            </div>
          </div>
          <div style="width:200px;">
            <div style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:8px;">Session Log</div>
            <div id="ussd-sim-log" style="background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:10px;font-size:11px;color:var(--text-muted);max-height:180px;overflow-y:auto;font-family:monospace;line-height:1.5;">No activity yet</div>
          </div>
        </div>
      </div>
    `;

    ussdTestHistory = [];
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load USSD data</div>';
  }
}

function copyUSSDUrl() {
  const input = document.getElementById("ussd-callback-url");
  if (!input) return;
  navigator.clipboard.writeText(input.value).then(function() {
    const btn = input.nextElementSibling;
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(function() { btn.textContent = orig; }, 1500);
  }).catch(function() {
    input.select();
    document.execCommand("copy");
  });
}

async function saveUSSDConfig() {
  const resultEl = document.getElementById("ussd-config-result");
  resultEl.textContent = "Saving...";
  resultEl.style.color = "var(--text-muted)";

  try {
    const serviceCode = document.getElementById("ussd-service-code").value.trim();
    const enabled = document.getElementById("ussd-enabled").checked;

    const res = await apiFetch("/api/admin/ussd/config", {
      method: "PUT",
      body: JSON.stringify({ serviceCode, enabled }),
    });

    if (res.ok) {
      resultEl.textContent = "Configuration saved!";
      resultEl.style.color = "var(--success)";
    } else {
      const d = await res.json();
      resultEl.textContent = d.error || "Failed to save";
      resultEl.style.color = "var(--error)";
    }
  } catch (err) {
    resultEl.textContent = "Error saving config";
    resultEl.style.color = "var(--error)";
  }

  setTimeout(function() { resultEl.textContent = ""; }, 3000);
}

// ─── USSD Simulator Functions ────────────────────────────────────

async function dialUSSD() {
  ussdTestHistory = [];
  updateUSSDLog("Dialing...");
  await sendUSSDTest("");
}

async function sendUSSDInput() {
  const input = document.getElementById("ussd-sim-input");
  if (!input) return;
  const value = input.value.trim();
  if (value === "") return;

  ussdTestHistory.push(value);
  input.value = "";

  const fullText = ussdTestHistory.join("*");
  updateUSSDLog("Input: " + value + " (text=" + fullText + ")");
  await sendUSSDTest(fullText);
}

async function sendUSSDTest(text) {
  const screen = document.getElementById("ussd-sim-screen");
  screen.textContent = "Loading...";

  try {
    const res = await apiFetch("/api/admin/ussd/test", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    const data = await res.json();

    if (data.error) {
      screen.textContent = "Error: " + data.error;
      updateUSSDLog("ERROR: " + data.error);
      return;
    }

    const responseText = data.response || "";
    const isEnd = data.isEnd || responseText.startsWith("END");

    // Strip the CON/END prefix for display
    const display = responseText.replace(/^(CON |END )/, "");
    screen.textContent = display;

    if (isEnd) {
      updateUSSDLog("Session ended");
      ussdTestHistory = [];
      // Dim the screen slightly to indicate session ended
      screen.style.color = "#666";
      setTimeout(function() { screen.style.color = "#00ff88"; }, 2000);
    } else {
      updateUSSDLog("Menu displayed");
    }
  } catch (err) {
    screen.textContent = "Connection error. Try again.";
    updateUSSDLog("ERROR: " + (err.message || "Connection failed"));
  }
}

function resetUSSDSim() {
  ussdTestHistory = [];
  const screen = document.getElementById("ussd-sim-screen");
  if (screen) screen.textContent = "Dial to start...";
  const log = document.getElementById("ussd-sim-log");
  if (log) log.textContent = "No activity yet";
  const input = document.getElementById("ussd-sim-input");
  if (input) input.value = "";
}

function updateUSSDLog(msg) {
  const log = document.getElementById("ussd-sim-log");
  if (!log) return;
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (log.textContent === "No activity yet") {
    log.textContent = "";
  }
  log.textContent += time + " " + msg + "\n";
  log.scrollTop = log.scrollHeight;
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Messaging (WhatsApp / SMS)
// ═══════════════════════════════════════════════════════════════════

async function loadMessagingTab() {
  await Promise.all([loadMessagingConfig(), loadMessagingStats()]);
}

async function loadMessagingConfig() {
  try {
    const res = await apiFetch("/api/admin/messaging/config");
    const data = await res.json();
    const config = data.config || {};

    document.getElementById("msg-whatsapp-enabled").checked = !!config.whatsapp_enabled;
    document.getElementById("msg-sms-enabled").checked = !!config.sms_enabled;
    document.getElementById("msg-api-key").value = config.api_key || "";
    document.getElementById("msg-api-username").value = config.api_username || "";
    document.getElementById("msg-webhook-secret").value = config.webhook_secret || "";
    document.getElementById("msg-sender-id").value = config.sender_id || "AskOzzy";

    // Set webhook URLs
    if (data.webhook_urls) {
      document.getElementById("msg-wa-webhook-url").value = data.webhook_urls.whatsapp || "";
      document.getElementById("msg-sms-webhook-url").value = data.webhook_urls.sms || "";
    }
  } catch (err) {
    console.error("Failed to load messaging config:", err);
  }
}

async function saveMessagingConfig() {
  const resultEl = document.getElementById("msg-config-result");
  resultEl.innerHTML = '<span style="color:var(--text-muted);">Saving...</span>';

  try {
    const config = {
      whatsapp_enabled: document.getElementById("msg-whatsapp-enabled").checked,
      sms_enabled: document.getElementById("msg-sms-enabled").checked,
      api_key: document.getElementById("msg-api-key").value.trim(),
      api_username: document.getElementById("msg-api-username").value.trim(),
      webhook_secret: document.getElementById("msg-webhook-secret").value.trim(),
      sender_id: document.getElementById("msg-sender-id").value.trim() || "AskOzzy",
    };

    const res = await apiFetch("/api/admin/messaging/config", {
      method: "PUT",
      body: JSON.stringify(config),
    });

    if (res.ok) {
      resultEl.innerHTML = '<span style="color:#006B3F;">Configuration saved successfully.</span>';
    } else {
      const err = await res.json();
      resultEl.innerHTML = '<span style="color:#CE1126;">Error: ' + escapeHtml(err.error || "Failed to save") + '</span>';
    }
  } catch (err) {
    resultEl.innerHTML = '<span style="color:#CE1126;">Network error. Please try again.</span>';
  }

  setTimeout(() => { resultEl.textContent = ""; }, 5000);
}

async function loadMessagingStats() {
  try {
    const res = await apiFetch("/api/admin/messaging/stats");
    const data = await res.json();

    document.getElementById("msg-stat-sessions").textContent = data.total_sessions || 0;
    document.getElementById("msg-stat-today").textContent = data.messages_today || 0;
    document.getElementById("msg-stat-week").textContent = data.messages_this_week || 0;
    document.getElementById("msg-stat-active").textContent = data.active_sessions || 0;

    // Render sessions table
    const el = document.getElementById("messaging-sessions-content");
    const sessions = data.recent_sessions || [];

    if (sessions.length === 0) {
      el.innerHTML = '<div class="admin-empty">No messaging sessions yet. Use the webhook test above to create one.</div>';
      return;
    }

    let html = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
      '<th>Phone Number</th><th>Messages</th><th>Last Message</th><th>Last Response</th><th>Last Active</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    for (const s of sessions) {
      const lastMsg = s.last_message ? escapeHtml(s.last_message.substring(0, 60)) + (s.last_message.length > 60 ? '...' : '') : '--';
      const lastResp = s.last_response ? escapeHtml(s.last_response.substring(0, 60)) + (s.last_response.length > 60 ? '...' : '') : '--';

      html += '<tr>' +
        '<td><code style="font-size:12px;">' + escapeHtml(s.phone_number) + '</code></td>' +
        '<td>' + s.message_count + '</td>' +
        '<td style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(s.last_message || '') + '">' + lastMsg + '</td>' +
        '<td style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(s.last_response || '') + '">' + lastResp + '</td>' +
        '<td style="font-size:12px;">' + formatDate(s.updated_at) + '</td>' +
        '<td><button class="btn-action" style="padding:4px 10px;font-size:11px;" onclick="viewSessionMessages(\'' + s.id + '\', \'' + escapeHtml(s.phone_number) + '\')">View</button></td>' +
        '</tr>';
    }

    html += '</tbody></table></div>';
    el.innerHTML = html;
  } catch (err) {
    console.error("Failed to load messaging stats:", err);
    document.getElementById("messaging-sessions-content").innerHTML = '<div class="admin-empty">Failed to load messaging data.</div>';
  }
}

async function testMessagingWebhook() {
  const btn = document.getElementById("btn-msg-test");
  const resultDiv = document.getElementById("msg-test-result");
  const responseDiv = document.getElementById("msg-test-response");
  const message = document.getElementById("msg-test-input").value.trim() || "What is the procurement threshold for goods?";
  const channel = document.getElementById("msg-test-channel").value;

  btn.disabled = true;
  btn.textContent = "Sending...";
  resultDiv.style.display = "none";

  try {
    const res = await apiFetch("/api/admin/messaging/test", {
      method: "POST",
      body: JSON.stringify({ channel, message }),
    });

    const data = await res.json();

    if (data.success) {
      resultDiv.style.display = "block";
      const responses = Array.isArray(data.response) ? data.response : [data.response];
      responseDiv.textContent = responses.join("\n\n---\n\n");

      // Refresh stats after test
      setTimeout(loadMessagingStats, 500);
    } else {
      resultDiv.style.display = "block";
      responseDiv.innerHTML = '<span style="color:#CE1126;">Error: ' + escapeHtml(data.error || "Test failed") + '</span>';
    }
  } catch (err) {
    resultDiv.style.display = "block";
    responseDiv.innerHTML = '<span style="color:#CE1126;">Network error. Please try again.</span>';
  }

  btn.disabled = false;
  btn.textContent = "Send Test";
}

async function viewSessionMessages(sessionId, phoneNumber) {
  const modal = document.getElementById("wa-message-modal");
  const titleEl = document.getElementById("wa-modal-title");
  const subtitleEl = document.getElementById("wa-modal-subtitle");
  const bodyEl = document.getElementById("wa-modal-body");

  modal.style.display = "flex";
  titleEl.textContent = "Session Messages";
  subtitleEl.textContent = phoneNumber;
  bodyEl.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    const res = await apiFetch("/api/admin/messaging/sessions/" + sessionId + "/messages");
    const data = await res.json();
    const messages = data.messages || [];

    if (messages.length === 0) {
      bodyEl.innerHTML = '<div class="admin-empty">No messages in this session.</div>';
      return;
    }

    let html = '';
    for (const msg of messages) {
      const isInbound = msg.direction === "inbound";
      const align = isInbound ? "flex-start" : "flex-end";
      const bg = isInbound ? "var(--bg-tertiary)" : "var(--gold)";
      const color = isInbound ? "var(--text-primary)" : "#000";
      const label = isInbound ? "User" : "Ozzy";
      const channelBadge = msg.channel === "sms"
        ? '<span style="font-size:9px;background:var(--bg-primary);color:var(--text-muted);padding:1px 5px;border-radius:3px;margin-left:6px;">SMS</span>'
        : '<span style="font-size:9px;background:var(--bg-primary);color:var(--text-muted);padding:1px 5px;border-radius:3px;margin-left:6px;">WA</span>';

      html += '<div style="display:flex;justify-content:' + align + ';margin-bottom:12px;">' +
        '<div style="max-width:80%;background:' + bg + ';color:' + color + ';border-radius:12px;padding:10px 14px;font-size:13px;">' +
        '<div style="font-size:10px;font-weight:600;margin-bottom:4px;opacity:0.7;">' + label + channelBadge + ' &middot; ' + formatDate(msg.created_at) + '</div>' +
        '<div style="white-space:pre-wrap;word-wrap:break-word;">' + escapeHtml(msg.content) + '</div>' +
        '</div></div>';
    }

    bodyEl.innerHTML = html;
    bodyEl.scrollTop = bodyEl.scrollHeight;
  } catch (err) {
    bodyEl.innerHTML = '<div class="admin-empty">Failed to load messages.</div>';
  }
}

function copyToClipboard(text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    // Brief visual feedback — we don't have a toast system, just use a small alert
    const el = document.activeElement;
    if (el && el.textContent === "Copy") {
      const orig = el.textContent;
      el.textContent = "Copied!";
      setTimeout(() => { el.textContent = orig; }, 1500);
    }
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  });
}

// ─── Init ───────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", verifyAdmin);
