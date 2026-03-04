/* ═══════════════════════════════════════════════════════════════════
   AskOzzy — Organisation Admin Portal
   ═══════════════════════════════════════════════════════════════════ */

// ── Theme ──────────────────────────────────────────────────────────
(function initTheme() {
  var saved = localStorage.getItem("askozzy_theme");
  if (saved) {
    document.documentElement.setAttribute("data-theme", saved);
  } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();

function toggleTheme() {
  var current = document.documentElement.getAttribute("data-theme");
  var next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("askozzy_theme", next);
}

// ── Global State ───────────────────────────────────────────────────
var API = "";
var token = localStorage.getItem("askozzy_token");
var orgAdminUser = null;
var currentOrg = null;
var currentTab = "dashboard";
var membersPage = 1;

// ── Utilities ──────────────────────────────────────────────────────
function escapeHtml(text) {
  if (!text) return "";
  var div = document.createElement("div");
  div.appendChild(document.createTextNode(String(text)));
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear() + " " +
    String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function formatDateShort(dateStr) {
  if (!dateStr) return "";
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return d.getDate() + " " + months[d.getMonth()];
}

function debounce(fn, ms) {
  var timer;
  return function() {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: "Bearer " + token,
  };
}

async function apiFetch(path, options) {
  options = options || {};
  var res = await fetch(API + path, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (res.status === 401 || res.status === 403) {
    orgAdminLogout();
    throw new Error("Unauthorized");
  }
  return res;
}

// ── Auth ────────────────────────────────────────────────────────────
async function verifyOrgAdmin() {
  if (!token) {
    window.location.href = "/";
    return;
  }

  try {
    var res = await apiFetch("/api/org-admin/verify");
    if (!res.ok) throw new Error("Not org admin");
    var data = await res.json();
    orgAdminUser = data;
    currentOrg = data.org;

    document.getElementById("admin-user-name").textContent = orgAdminUser.verified ? "Org Admin" : "";
    if (currentOrg) {
      document.getElementById("org-name-subtitle").textContent = currentOrg.name;
    }

    document.getElementById("admin-loading").classList.add("hidden");
    document.getElementById("admin-app").classList.remove("hidden");
    loadDashboard();
  } catch (e) {
    window.location.href = "/";
  }
}

function orgAdminLogout() {
  fetch(API + "/api/auth/logout", { method: "POST", headers: authHeaders() }).catch(function() {});
  localStorage.removeItem("askozzy_token");
  localStorage.removeItem("askozzy_user");
  window.location.href = "/";
}

// ── Tab Navigation ─────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".admin-tab").forEach(function(t) { t.classList.remove("active"); });
  var activeBtn = document.querySelector('.admin-tab[data-tab="' + tab + '"]');
  if (activeBtn) activeBtn.classList.add("active");
  document.querySelectorAll(".admin-tab-panel").forEach(function(p) { p.classList.remove("active"); });
  var panel = document.getElementById("panel-" + tab);
  if (panel) panel.classList.add("active");

  var loaders = {
    dashboard: loadDashboard,
    members: function() { loadMembers(1); },
    analytics: loadAnalytics,
    knowledge: loadKnowledge,
    agents: loadAgents,
    announcements: loadAnnouncements,
    billing: loadBilling,
    settings: loadSettings,
  };
  if (loaders[tab]) loaders[tab]();
}

// ── Pagination Helper ──────────────────────────────────────────────
function renderPagination(containerId, currentPage, totalItems, limit, loadFn) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var totalPages = Math.ceil(totalItems / limit);
  if (totalPages <= 1) { container.innerHTML = ""; return; }

  var html = "";
  html += '<button ' + (currentPage === 1 ? 'disabled' : '') +
    ' onclick="' + loadFn + '(' + (currentPage - 1) + ')">&#x2190;</button>';

  var start = Math.max(1, currentPage - 2);
  var end = Math.min(totalPages, currentPage + 2);

  if (start > 1) {
    html += '<button onclick="' + loadFn + '(1)">1</button>';
    if (start > 2) html += '<span style="color:var(--text-muted);padding:0 4px;">...</span>';
  }

  for (var i = start; i <= end; i++) {
    html += '<button class="' + (i === currentPage ? 'active' : '') +
      '" onclick="' + loadFn + '(' + i + ')">' + i + '</button>';
  }

  if (end < totalPages) {
    if (end < totalPages - 1) html += '<span style="color:var(--text-muted);padding:0 4px;">...</span>';
    html += '<button onclick="' + loadFn + '(' + totalPages + ')">' + totalPages + '</button>';
  }

  html += '<button ' + (currentPage === totalPages ? 'disabled' : '') +
    ' onclick="' + loadFn + '(' + (currentPage + 1) + ')">&#x2192;</button>';

  container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Dashboard
// ═══════════════════════════════════════════════════════════════════

async function loadDashboard() {
  var el = document.getElementById("dashboard-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    var res = await apiFetch("/api/org-admin/dashboard");
    var d = await res.json();

    var seatPct = d.seats.max > 0 ? Math.round((d.seats.used / d.seats.max) * 100) : 0;
    var seatClass = seatPct >= 100 ? "full" : seatPct >= 80 ? "warning" : "";

    el.innerHTML =
      '<div class="stats-grid">' +
        '<div class="stat-card"><div class="stat-value">' + (d.totalMembers || 0) + '</div><div class="stat-label">Total Members</div></div>' +
        '<div class="stat-card green"><div class="stat-value">' + (d.activeToday || 0) + '</div><div class="stat-label">Active Today</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + (d.messagesToday || 0) + '</div><div class="stat-label">Messages Today</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + (d.totalConversations || 0) + '</div><div class="stat-label">Total Conversations</div></div>' +
      '</div>' +
      '<div class="admin-row">' +
        '<div class="admin-card">' +
          '<h3>Seat Usage</h3>' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:8px;">' +
            '<span style="color:var(--text-secondary);font-size:13px;">' + d.seats.used + ' of ' + d.seats.max + ' seats used</span>' +
            '<span style="color:var(--gold);font-weight:600;font-size:13px;">' + seatPct + '%</span>' +
          '</div>' +
          '<div class="seat-usage-bar"><div class="seat-usage-fill ' + seatClass + '" style="width:' + Math.min(seatPct, 100) + '%"></div></div>' +
        '</div>' +
        '<div class="admin-card">' +
          '<h3>Plan</h3>' +
          '<div style="text-align:center;padding:12px 0;">' +
            '<div style="font-size:24px;font-weight:700;color:var(--gold);text-transform:capitalize;">' + escapeHtml(d.tier || "free") + '</div>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Current subscription tier</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load dashboard data</div>';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Members
// ═══════════════════════════════════════════════════════════════════

async function loadMembers(page) {
  membersPage = page || 1;
  var el = document.getElementById("members-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  var search = document.getElementById("member-search") ? document.getElementById("member-search").value : "";

  try {
    var url = "/api/org-admin/users?page=" + membersPage + "&limit=25";
    if (search) url += "&search=" + encodeURIComponent(search);
    var res = await apiFetch(url);
    var d = await res.json();

    document.getElementById("member-count").textContent = (d.total || 0) + " members";

    if (!d.users || d.users.length === 0) {
      el.innerHTML = '<div class="admin-empty">No members found</div>';
      document.getElementById("members-pagination").innerHTML = "";
      return;
    }

    var html = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
      '<th>Name</th><th>Email</th><th>Role</th><th>Tier</th><th>Last Login</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    d.users.forEach(function(u) {
      var roleBadge = u.org_role === "org_admin"
        ? '<span class="badge badge-admin">Admin</span>'
        : '<span class="badge badge-member">Member</span>';

      html += '<tr>' +
        '<td>' + escapeHtml(u.full_name) + '</td>' +
        '<td style="color:var(--text-secondary)">' + escapeHtml(u.email) + '</td>' +
        '<td>' + roleBadge + '</td>' +
        '<td style="text-transform:capitalize">' + escapeHtml(u.tier || "—") + '</td>' +
        '<td style="color:var(--text-muted);font-size:12px">' + formatDate(u.last_login) + '</td>' +
        '<td style="display:flex;gap:4px;">' +
          '<select class="inline-select" onchange="changeMemberRole(\'' + u.id + '\', this.value)" title="Change role">' +
            '<option value="member"' + (u.org_role === "member" ? " selected" : "") + '>Member</option>' +
            '<option value="org_admin"' + (u.org_role === "org_admin" ? " selected" : "") + '>Admin</option>' +
          '</select>' +
          '<button class="btn-action danger" onclick="removeMember(\'' + u.id + '\', \'' + escapeHtml(u.full_name).replace(/'/g, "\\'") + '\')">Remove</button>' +
        '</td>' +
      '</tr>';
    });

    html += '</tbody></table></div>';
    el.innerHTML = html;

    renderPagination("members-pagination", membersPage, d.total, 25, "loadMembers");
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load members</div>';
  }
}

var debouncedMemberSearch = debounce(function() { loadMembers(1); }, 400);

async function changeMemberRole(userId, role) {
  try {
    var res = await apiFetch("/api/org-admin/users/" + userId + "/role", {
      method: "PATCH",
      body: JSON.stringify({ role: role }),
    });
    if (!res.ok) {
      var d = await res.json();
      alert(d.error || "Failed to change role");
    }
    loadMembers(membersPage);
  } catch (err) {
    alert("Failed to change role");
  }
}

async function removeMember(userId, name) {
  if (!confirm("Remove " + name + " from this organisation? They will lose access to org resources.")) return;

  try {
    var res = await apiFetch("/api/org-admin/users/" + userId, { method: "DELETE" });
    if (!res.ok) {
      var d = await res.json();
      alert(d.error || "Failed to remove member");
    }
    loadMembers(membersPage);
  } catch (err) {
    alert("Failed to remove member");
  }
}

// ── Invite Modal ───────────────────────────────────────────────────
function openInviteModal() {
  document.getElementById("invite-email").value = "";
  document.getElementById("invite-role").value = "member";
  document.getElementById("invite-tier").value = "";
  document.getElementById("invite-result").innerHTML = "";
  document.getElementById("invite-modal").classList.add("active");
}

function closeInviteModal() {
  document.getElementById("invite-modal").classList.remove("active");
}

document.addEventListener("click", function(e) {
  if (e.target.id === "invite-modal") closeInviteModal();
});

async function submitInvite() {
  var email = document.getElementById("invite-email").value.trim();
  var role = document.getElementById("invite-role").value;
  var tier = document.getElementById("invite-tier").value || null;
  var resultEl = document.getElementById("invite-result");

  if (!email) {
    resultEl.innerHTML = '<span class="msg-error">Email is required</span>';
    return;
  }

  try {
    var res = await apiFetch("/api/org-admin/users/invite", {
      method: "POST",
      body: JSON.stringify({ email: email, role: role, tier: tier }),
    });
    var d = await res.json();
    if (!res.ok) {
      resultEl.innerHTML = '<span class="msg-error">' + escapeHtml(d.error || "Failed to send invite") + '</span>';
      return;
    }
    resultEl.innerHTML = '<span class="msg-success">Invite sent! Share the invite link: /api/auth/invite/accept/' + escapeHtml(d.inviteId) + '</span>';
    loadMembers(membersPage);
  } catch (err) {
    resultEl.innerHTML = '<span class="msg-error">Failed to send invite</span>';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Analytics
// ═══════════════════════════════════════════════════════════════════

var orgMessagesChart = null;
var orgActiveChart = null;

async function loadAnalytics() {
  var el = document.getElementById("analytics-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    var res = await apiFetch("/api/org-admin/analytics");
    var d = await res.json();

    var html = '<div class="admin-row">' +
      '<div class="admin-card">' +
        '<h3>Messages Per Day (Last 30 Days)</h3>' +
        '<div style="height:250px;position:relative;"><canvas id="org-messages-chart"></canvas></div>' +
      '</div>' +
      '<div class="admin-card">' +
        '<h3>Active Users Per Day (Last 30 Days)</h3>' +
        '<div style="height:250px;position:relative;"><canvas id="org-active-chart"></canvas></div>' +
      '</div>' +
    '</div>';

    // Popular Models
    html += '<div class="admin-row">' +
      '<div class="admin-card"><h3>Popular Models</h3>';
    if (d.popularModels && d.popularModels.length > 0) {
      var maxModel = Math.max.apply(null, d.popularModels.map(function(m) { return m.count; }));
      html += '<div class="bar-chart">';
      d.popularModels.forEach(function(m) {
        var pct = maxModel > 0 ? (m.count / maxModel * 100) : 0;
        html += '<div class="bar-row">' +
          '<span class="bar-label" title="' + escapeHtml(m.model) + '">' + escapeHtml(m.model || "Unknown") + '</span>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(pct, 1) + '%"></div></div>' +
          '<span class="bar-value">' + m.count + '</span></div>';
      });
      html += '</div>';
    } else {
      html += '<div class="admin-empty">No model data yet</div>';
    }
    html += '</div>';

    // Top Users
    html += '<div class="admin-card"><h3>Top Users</h3>';
    if (d.topUsers && d.topUsers.length > 0) {
      var maxUser = Math.max.apply(null, d.topUsers.map(function(u) { return u.message_count; }));
      html += '<div class="bar-chart">';
      d.topUsers.forEach(function(u) {
        var pct = maxUser > 0 ? (u.message_count / maxUser * 100) : 0;
        html += '<div class="bar-row">' +
          '<span class="bar-label" title="' + escapeHtml(u.full_name) + '">' + escapeHtml(u.full_name) + '</span>' +
          '<div class="bar-track"><div class="bar-fill green" style="width:' + Math.max(pct, 1) + '%"></div></div>' +
          '<span class="bar-value">' + u.message_count + '</span></div>';
      });
      html += '</div>';
    } else {
      html += '<div class="admin-empty">No user data yet</div>';
    }
    html += '</div></div>';

    // Tier Breakdown
    if (d.tierBreakdown && d.tierBreakdown.length > 0) {
      html += '<div class="admin-card" style="margin-bottom:24px;"><h3>Tier Breakdown</h3>' +
        '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr><th>Tier</th><th>Members</th></tr></thead><tbody>';
      d.tierBreakdown.forEach(function(t) {
        html += '<tr><td style="text-transform:capitalize">' + escapeHtml(t.tier) + '</td><td>' + t.count + '</td></tr>';
      });
      html += '</tbody></table></div></div>';
    }

    // Export
    html += '<div style="display:flex;gap:12px;margin-top:16px;">' +
      '<button class="btn-action export-btn" onclick="exportMembers()">Export Members CSV</button>' +
    '</div>';

    el.innerHTML = html;

    // Render Chart.js charts
    if (typeof Chart !== "undefined") {
      setTimeout(function() {
        if (orgMessagesChart) { orgMessagesChart.destroy(); orgMessagesChart = null; }
        if (orgActiveChart) { orgActiveChart.destroy(); orgActiveChart = null; }

        var msgCanvas = document.getElementById("org-messages-chart");
        var activeCanvas = document.getElementById("org-active-chart");

        if (msgCanvas && d.messagesPerDay && d.messagesPerDay.length > 0) {
          try {
            orgMessagesChart = new Chart(msgCanvas, {
              type: "line",
              data: {
                labels: d.messagesPerDay.map(function(r) { return r.day ? r.day.slice(5) : ""; }),
                datasets: [{
                  label: "Messages",
                  data: d.messagesPerDay.map(function(r) { return r.count; }),
                  borderColor: "#FCD116",
                  backgroundColor: "rgba(252, 209, 22, 0.1)",
                  fill: true,
                  tension: 0.3,
                  borderWidth: 2,
                  pointRadius: 2,
                }],
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: { ticks: { maxRotation: 45 }, grid: { display: false } },
                  y: { beginAtZero: true },
                },
              },
            });
          } catch (e) { console.error("Chart error:", e); }
        }

        if (activeCanvas && d.activePerDay && d.activePerDay.length > 0) {
          try {
            orgActiveChart = new Chart(activeCanvas, {
              type: "line",
              data: {
                labels: d.activePerDay.map(function(r) { return r.day ? r.day.slice(5) : ""; }),
                datasets: [{
                  label: "Active Users",
                  data: d.activePerDay.map(function(r) { return r.count; }),
                  borderColor: "#00a86b",
                  backgroundColor: "rgba(0, 168, 107, 0.1)",
                  fill: true,
                  tension: 0.3,
                  borderWidth: 2,
                  pointRadius: 2,
                }],
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: { ticks: { maxRotation: 45 }, grid: { display: false } },
                  y: { beginAtZero: true },
                },
              },
            });
          } catch (e) { console.error("Chart error:", e); }
        }
      }, 100);
    }
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load analytics</div>';
  }
}

async function exportMembers() {
  try {
    var res = await apiFetch("/api/org-admin/export/users");
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "org-members.csv";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("Failed to export members");
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Knowledge Base
// ═══════════════════════════════════════════════════════════════════

async function loadKnowledge() {
  var el = document.getElementById("knowledge-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    var res = await apiFetch("/api/org-admin/kb/stats");
    var d = await res.json();

    el.innerHTML = '<div class="admin-card">' +
      '<h3>Knowledge Base</h3>' +
      '<div class="stats-grid" style="margin-bottom:0;">' +
        '<div class="stat-card"><div class="stat-value">' + (d.documents || 0) + '</div><div class="stat-label">Documents</div></div>' +
      '</div>' +
      '<p style="color:var(--text-muted);font-size:13px;margin-top:16px;">Contact your system administrator to add org-specific knowledge base documents.</p>' +
    '</div>';
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load knowledge base stats</div>';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: AI Agents
// ═══════════════════════════════════════════════════════════════════

async function loadAgents() {
  var el = document.getElementById("agents-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    var res = await apiFetch("/api/org-admin/agents");
    var d = await res.json();

    if (!d.agents || d.agents.length === 0) {
      el.innerHTML = '<div class="admin-empty">No custom agents yet. Create one above.</div>';
      return;
    }

    var html = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
      '<th>Icon</th><th>Name</th><th>Description</th><th>Model</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    d.agents.forEach(function(a) {
      html += '<tr>' +
        '<td style="font-size:20px;">' + escapeHtml(a.icon || "&#x1F916;") + '</td>' +
        '<td>' + escapeHtml(a.name) + '</td>' +
        '<td style="color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(a.description || "—") + '</td>' +
        '<td style="color:var(--text-muted);font-size:12px;">' + escapeHtml(a.model || "Default") + '</td>' +
        '<td><button class="btn-action danger" onclick="deleteAgent(\'' + a.id + '\', \'' + escapeHtml(a.name).replace(/'/g, "\\'") + '\')">Delete</button></td>' +
      '</tr>';
    });

    html += '</tbody></table></div>';
    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load agents</div>';
  }
}

async function createAgent() {
  var name = document.getElementById("agent-name").value.trim();
  var icon = document.getElementById("agent-icon").value.trim() || "\uD83E\uDD16";
  var description = document.getElementById("agent-description").value.trim();
  var systemPrompt = document.getElementById("agent-system-prompt").value.trim();

  if (!name || !systemPrompt) {
    alert("Agent name and system prompt are required");
    return;
  }

  try {
    var res = await apiFetch("/api/org-admin/agents", {
      method: "POST",
      body: JSON.stringify({ name: name, description: description, system_prompt: systemPrompt, icon: icon }),
    });
    if (!res.ok) {
      var d = await res.json();
      alert(d.error || "Failed to create agent");
      return;
    }
    document.getElementById("agent-name").value = "";
    document.getElementById("agent-description").value = "";
    document.getElementById("agent-system-prompt").value = "";
    loadAgents();
  } catch (err) {
    alert("Failed to create agent");
  }
}

async function deleteAgent(id, name) {
  if (!confirm("Delete agent '" + name + "'? This cannot be undone.")) return;

  try {
    var res = await apiFetch("/api/org-admin/agents/" + id, { method: "DELETE" });
    if (!res.ok) {
      var d = await res.json();
      alert(d.error || "Failed to delete agent");
    }
    loadAgents();
  } catch (err) {
    alert("Failed to delete agent");
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Announcements
// ═══════════════════════════════════════════════════════════════════

async function loadAnnouncements() {
  var el = document.getElementById("announcements-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    var res = await apiFetch("/api/org-admin/announcements");
    var d = await res.json();

    if (!d.announcements || d.announcements.length === 0) {
      el.innerHTML = '<div class="admin-empty">No announcements yet</div>';
      return;
    }

    var html = '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr>' +
      '<th>Title</th><th>Type</th><th>Content</th><th>Created</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    d.announcements.forEach(function(a) {
      var typeBadge = '<span class="badge badge-' + escapeHtml(a.type || "info") + '">' + escapeHtml(a.type || "info") + '</span>';
      html += '<tr>' +
        '<td>' + escapeHtml(a.title) + '</td>' +
        '<td>' + typeBadge + '</td>' +
        '<td style="color:var(--text-secondary);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(a.content) + '</td>' +
        '<td style="color:var(--text-muted);font-size:12px;">' + formatDate(a.created_at) + '</td>' +
        '<td><button class="btn-action danger" onclick="deleteAnnouncement(\'' + a.id + '\')">Delete</button></td>' +
      '</tr>';
    });

    html += '</tbody></table></div>';
    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load announcements</div>';
  }
}

async function createAnnouncement() {
  var title = document.getElementById("announcement-title").value.trim();
  var content = document.getElementById("announcement-content").value.trim();
  var type = document.getElementById("announcement-type").value;
  var dismissible = document.getElementById("announcement-dismissible").checked;

  if (!title || !content) {
    alert("Title and content are required");
    return;
  }

  try {
    var res = await apiFetch("/api/org-admin/announcements", {
      method: "POST",
      body: JSON.stringify({ title: title, content: content, type: type, dismissible: dismissible }),
    });
    if (!res.ok) {
      var d = await res.json();
      alert(d.error || "Failed to create announcement");
      return;
    }
    document.getElementById("announcement-title").value = "";
    document.getElementById("announcement-content").value = "";
    loadAnnouncements();
  } catch (err) {
    alert("Failed to create announcement");
  }
}

async function deleteAnnouncement(id) {
  if (!confirm("Delete this announcement?")) return;

  try {
    await apiFetch("/api/org-admin/announcements/" + id, { method: "DELETE" });
    loadAnnouncements();
  } catch (err) {
    alert("Failed to delete announcement");
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Billing
// ═══════════════════════════════════════════════════════════════════

async function loadBilling() {
  var el = document.getElementById("billing-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  try {
    var res = await apiFetch("/api/org-admin/billing");
    var d = await res.json();

    var org = d.org || {};
    var pricing = d.pricing || {};
    var seatPct = org.max_seats > 0 ? Math.round((org.used_seats / org.max_seats) * 100) : 0;
    var seatClass = seatPct >= 100 ? "full" : seatPct >= 80 ? "warning" : "";

    el.innerHTML =
      '<div class="stats-grid">' +
        '<div class="stat-card"><div class="billing-value">GH\u20B5' + (d.monthlyTotal || 0).toFixed(2) + '</div><div class="billing-label">Monthly Total</div></div>' +
        '<div class="stat-card"><div class="billing-value">GH\u20B5' + (pricing.price_per_seat || 0).toFixed(2) + '</div><div class="billing-label">Per Seat / Month</div></div>' +
        '<div class="stat-card"><div class="billing-value">' + (d.discount || 0) + '%</div><div class="billing-label">Volume Discount</div></div>' +
        '<div class="stat-card"><div class="billing-value" style="text-transform:capitalize">' + escapeHtml(pricing.plan || "—") + '</div><div class="billing-label">Current Plan</div></div>' +
      '</div>' +
      '<div class="admin-row">' +
        '<div class="admin-card">' +
          '<h3>Seat Usage</h3>' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:8px;">' +
            '<span style="color:var(--text-secondary);font-size:13px;">' + (org.used_seats || 0) + ' of ' + (org.max_seats || 0) + ' seats used</span>' +
            '<span style="color:var(--gold);font-weight:600;font-size:13px;">' + seatPct + '%</span>' +
          '</div>' +
          '<div class="seat-usage-bar"><div class="seat-usage-fill ' + seatClass + '" style="width:' + Math.min(seatPct, 100) + '%"></div></div>' +
          '<p style="color:var(--text-muted);font-size:12px;margin-top:12px;">Purchased seats: ' + (pricing.seats_purchased || 0) + ' | Billing cycle: ' + escapeHtml(pricing.billing_cycle || "monthly") + '</p>' +
        '</div>' +
        '<div class="admin-card">' +
          '<h3>Plan Details</h3>' +
          '<table class="admin-table" style="margin-bottom:0;"><tbody>' +
            '<tr><td style="color:var(--text-muted)">Plan</td><td style="text-transform:capitalize;font-weight:600">' + escapeHtml(pricing.plan || "—") + '</td></tr>' +
            '<tr><td style="color:var(--text-muted)">Tier</td><td style="text-transform:capitalize">' + escapeHtml(org.tier || "—") + '</td></tr>' +
            '<tr><td style="color:var(--text-muted)">Billing Cycle</td><td style="text-transform:capitalize">' + escapeHtml(pricing.billing_cycle || "monthly") + '</td></tr>' +
            (pricing.billing_expires_at ? '<tr><td style="color:var(--text-muted)">Expires</td><td>' + formatDate(pricing.billing_expires_at) + '</td></tr>' : '') +
          '</tbody></table>' +
        '</div>' +
      '</div>';
  } catch (err) {
    el.innerHTML = '<div class="admin-empty">Failed to load billing information</div>';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB: Settings
// ═══════════════════════════════════════════════════════════════════

async function loadSettings() {
  var el = document.getElementById("settings-content");
  el.innerHTML = '<div class="admin-loader"><div class="spinner"></div></div>';

  if (!currentOrg) {
    el.innerHTML = '<div class="admin-empty">Organisation data not available</div>';
    return;
  }

  el.innerHTML =
    '<div class="admin-card" style="max-width:640px;">' +
      '<h3>Organisation Settings</h3>' +
      '<div style="display:flex;flex-direction:column;gap:16px;">' +
        '<div>' +
          '<label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;">Organisation Name</label>' +
          '<input type="text" id="settings-name" class="admin-search" style="max-width:100%;width:100%;" value="' + escapeHtml(currentOrg.name || "") + '" />' +
        '</div>' +
        '<div>' +
          '<label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;">Slug</label>' +
          '<input type="text" class="admin-search" style="max-width:100%;width:100%;opacity:0.6;" value="' + escapeHtml(currentOrg.slug || "") + '" disabled />' +
          '<p style="font-size:11px;color:var(--text-muted);margin-top:4px;">Slug cannot be changed after creation</p>' +
        '</div>' +
        '<div>' +
          '<label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;">Email Domain</label>' +
          '<input type="text" id="settings-domain" class="admin-search" style="max-width:100%;width:100%;" value="' + escapeHtml(currentOrg.domain || "") + '" placeholder="e.g. company.gov.gh" />' +
        '</div>' +
        '<div>' +
          '<label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;">Sector</label>' +
          '<input type="text" id="settings-sector" class="admin-search" style="max-width:100%;width:100%;" value="' + escapeHtml(currentOrg.sector || "") + '" placeholder="e.g. Health, Education, Finance" />' +
        '</div>' +
        '<div>' +
          '<label style="display:block;font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.3px;">Logo URL</label>' +
          '<input type="text" id="settings-logo" class="admin-search" style="max-width:100%;width:100%;" value="' + escapeHtml(currentOrg.logo_url || "") + '" placeholder="https://example.com/logo.png" />' +
        '</div>' +
        '<div id="settings-result"></div>' +
        '<button class="btn-action primary" onclick="saveSettings()">Save Changes</button>' +
      '</div>' +
    '</div>';
}

async function saveSettings() {
  var resultEl = document.getElementById("settings-result");
  var name = document.getElementById("settings-name").value.trim();
  var domain = document.getElementById("settings-domain").value.trim() || null;
  var sector = document.getElementById("settings-sector").value.trim() || null;
  var logo_url = document.getElementById("settings-logo").value.trim() || null;

  if (!name) {
    resultEl.innerHTML = '<span class="msg-error">Organisation name is required</span>';
    return;
  }

  try {
    var res = await apiFetch("/api/org-admin/settings", {
      method: "PATCH",
      body: JSON.stringify({ name: name, domain: domain, sector: sector, logo_url: logo_url }),
    });
    if (!res.ok) {
      var d = await res.json();
      resultEl.innerHTML = '<span class="msg-error">' + escapeHtml(d.error || "Failed to save settings") + '</span>';
      return;
    }
    // Update local state
    currentOrg.name = name;
    currentOrg.domain = domain;
    currentOrg.sector = sector;
    currentOrg.logo_url = logo_url;
    document.getElementById("org-name-subtitle").textContent = name;
    resultEl.innerHTML = '<span class="msg-success">Settings saved successfully</span>';
  } catch (err) {
    resultEl.innerHTML = '<span class="msg-error">Failed to save settings</span>';
  }
}

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", verifyOrgAdmin);
