// ═══════════════════════════════════════════════════════════════════
//  AskOzzy — Frontend Application
//  Interface-first: users see everything, auth on interaction
// ═══════════════════════════════════════════════════════════════════

// ─── Theme Initialization (runs before paint) ────────────────────────
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
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.setAttribute("aria-label", `Switch to ${current} mode`);
}

// Auto-switch on system preference change (only if no explicit choice saved)
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
  if (!localStorage.getItem("askozzy_theme")) {
    document.documentElement.setAttribute("data-theme", e.matches ? "light" : "dark");
  }
});

const API = "";
let state = {
  token: localStorage.getItem("askozzy_token") || null,
  user: JSON.parse(localStorage.getItem("askozzy_user") || "null"),
  conversations: [],
  activeConversationId: null,
  messages: [],
  isStreaming: false,
  selectedModel: "@cf/openai/gpt-oss-20b",
  activeCategory: "All",
  pendingAction: null,
};

// ─── Initialization ──────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  renderTemplateGrid();
  renderCategoryTabs();
  updateSidebarFooter();
  updateUsageBadge(null); // hide until loaded

  if (state.token && state.user) {
    onAuthenticated();
  }
});

// ─── Auth Gate — the core UX pattern ─────────────────────────────────

/**
 * Wrap any action that requires login.
 * If the user is logged in, run the callback immediately.
 * If not, open the auth modal and run it after successful login.
 */
function requireAuth(callback, ...args) {
  if (state.token && state.user) {
    callback(...args);
  } else {
    state.pendingAction = () => callback(...args);
    openAuthModal();
  }
}

function isLoggedIn() {
  return !!(state.token && state.user);
}

// ─── Auth Modal ──────────────────────────────────────────────────────

function openAuthModal() {
  document.getElementById("auth-modal").classList.add("active");
  document.getElementById("auth-error").classList.remove("visible");
  // Focus the first input
  setTimeout(() => {
    const visible = document.getElementById("login-form").classList.contains("hidden")
      ? document.getElementById("reg-name")
      : document.getElementById("login-email");
    visible.focus();
  }, 100);
}

function closeAuthModal() {
  document.getElementById("auth-modal").classList.remove("active");
  state.pendingAction = null;
}

function toggleAuthForm() {
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const toggleText = document.getElementById("toggle-text");
  const toggleLink = document.getElementById("auth-toggle-link");
  const modalTitle = document.getElementById("auth-modal-title");
  const errorEl = document.getElementById("auth-error");

  errorEl.classList.remove("visible");

  if (loginForm.classList.contains("hidden")) {
    loginForm.classList.remove("hidden");
    registerForm.classList.add("hidden");
    toggleText.textContent = "Don't have an account?";
    toggleLink.textContent = "Create one";
    modalTitle.textContent = "Sign in to continue";
  } else {
    loginForm.classList.add("hidden");
    registerForm.classList.remove("hidden");
    toggleText.textContent = "Already have an account?";
    toggleLink.textContent = "Sign in";
    modalTitle.textContent = "Create your account";
  }
}

function showAuthError(msg) {
  const el = document.getElementById("auth-error");
  el.textContent = msg;
  el.classList.add("visible");
}

// Runs after successful login or register
function onAuthenticated() {
  updateSidebarFooter();
  loadConversations();
  loadUsageStatus();

  // Run the action the user was trying to do before auth
  if (state.pendingAction) {
    const action = state.pendingAction;
    state.pendingAction = null;
    action();
  }
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  const btn = e.target.querySelector(".btn-auth");
  btn.disabled = true;
  btn.textContent = "Signing in...";

  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");

    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("askozzy_token", data.token);
    localStorage.setItem("askozzy_user", JSON.stringify(data.user));
    closeAuthModal();
    onAuthenticated();
  } catch (err) {
    showAuthError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign In";
  }
});

document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fullName = document.getElementById("reg-name").value;
  const email = document.getElementById("reg-email").value;
  const department = document.getElementById("reg-dept").value;
  const password = document.getElementById("reg-password").value;
  const btn = e.target.querySelector(".btn-auth");
  btn.disabled = true;
  btn.textContent = "Creating account...";

  try {
    const res = await fetch(`${API}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, fullName, department, referralCode: document.getElementById("reg-referral").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");

    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("askozzy_token", data.token);
    localStorage.setItem("askozzy_user", JSON.stringify(data.user));
    closeAuthModal();
    onAuthenticated();
  } catch (err) {
    showAuthError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Create Account";
  }
});

async function logout() {
  try {
    await fetch(`${API}/api/auth/logout`, {
      method: "POST",
      headers: authHeaders(),
    });
  } catch {}
  state.token = null;
  state.user = null;
  state.conversations = [];
  state.activeConversationId = null;
  state.messages = [];
  localStorage.removeItem("askozzy_token");
  localStorage.removeItem("askozzy_user");
  updateSidebarFooter();
  updateUsageBadge(null);
  showWelcomeScreen();
  renderConversationList();
  // Remove limit banner if present
  const banner = document.querySelector(".limit-banner");
  if (banner) banner.remove();
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${state.token}`,
  };
}

// Close auth modal on overlay click
document.getElementById("auth-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeAuthModal();
});

// ─── Sidebar Footer (dynamic based on auth) ─────────────────────────

function updateSidebarFooter() {
  const footer = document.getElementById("sidebar-footer");

  if (isLoggedIn()) {
    const initials = state.user.fullName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

    const tier = state.user.tier || "free";
    const tierName = { free: "Free", starter: "Starter", professional: "Professional", enterprise: "Enterprise" }[tier] || "Free";

    footer.innerHTML = `
      <div class="user-info">
        <div class="user-avatar">${initials}</div>
        <div>
          <div class="user-name">${escapeHtml(state.user.fullName)}</div>
          <div class="user-dept">${escapeHtml(state.user.department || "GoG Operations")}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="sidebar-tier-btn tier-${tier}" onclick="openPricingModal()">
          ${tierName} Plan ${tier === 'free' ? '— Upgrade' : ''}
        </button>
        <button class="sidebar-earn-btn" onclick="openAffiliateModal()">
          Earn GHS
        </button>
      </div>
      <button class="btn-logout" onclick="logout()">Sign Out</button>`;
  } else {
    footer.innerHTML = `
      <button class="btn-sidebar-signin" onclick="openAuthModal()">
        Sign In / Create Account
      </button>
      <div class="sidebar-signin-hint">
        Sign in to save conversations and access all features
      </div>`;
  }
}

// ─── Conversations ───────────────────────────────────────────────────

async function loadConversations() {
  if (!isLoggedIn()) return;

  try {
    const res = await fetch(`${API}/api/conversations`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      if (res.status === 401) return logout();
      throw new Error("Failed to load conversations");
    }
    const data = await res.json();
    state.conversations = data.conversations || [];
    renderConversationList();
  } catch (err) {
    console.error("Failed to load conversations:", err);
  }
}

function renderConversationList() {
  const container = document.getElementById("conversation-list");
  const label = '<div class="section-label">Recent Conversations</div>';

  if (!isLoggedIn() || state.conversations.length === 0) {
    container.innerHTML =
      label +
      `<div style="padding:12px;font-size:12px;color:var(--text-muted);text-align:center;">
        ${isLoggedIn() ? "No conversations yet. Start a new one!" : "Sign in to see your conversations"}
      </div>`;
    return;
  }

  container.innerHTML =
    label +
    state.conversations
      .map(
        (c) => `
    <div class="conversation-item ${c.id === state.activeConversationId ? "active" : ""}"
         onclick="openConversation('${c.id}')">
      <span class="convo-icon">💬</span>
      <span class="convo-title">${escapeHtml(c.title)}</span>
      <button class="convo-delete" onclick="event.stopPropagation();deleteConversation('${c.id}')" title="Delete">🗑</button>
    </div>`
      )
      .join("");
}

async function createNewChat(templateId) {
  // This is always called via requireAuth, so user is logged in
  const template = templateId
    ? TEMPLATES.find((t) => t.id === templateId)
    : null;

  try {
    const res = await fetch(`${API}/api/conversations`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        title: template ? template.title : "New Conversation",
        templateId: templateId || null,
        model: state.selectedModel,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create conversation");

    state.activeConversationId = data.id;
    state.messages = [];
    await loadConversations();
    showChatScreen();

    if (template) {
      document.getElementById("chat-input").value = template.prompt;
      autoResizeInput();
      updateSendButton();
    }

    closeTemplateModal();
  } catch (err) {
    console.error("Failed to create chat:", err);
  }
}

async function openConversation(id) {
  state.activeConversationId = id;
  renderConversationList();
  showChatScreen();

  try {
    const res = await fetch(`${API}/api/conversations/${id}/messages`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    state.messages = data.messages || [];
    renderMessages();
  } catch (err) {
    console.error("Failed to load messages:", err);
  }
}

async function deleteConversation(id) {
  if (!confirm("Delete this conversation?")) return;

  try {
    await fetch(`${API}/api/conversations/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });

    if (state.activeConversationId === id) {
      state.activeConversationId = null;
      state.messages = [];
      showWelcomeScreen();
    }
    await loadConversations();
  } catch (err) {
    console.error("Failed to delete:", err);
  }
}

// ─── Chat ────────────────────────────────────────────────────────────

function showChatScreen() {
  document.getElementById("welcome-screen").classList.add("hidden");
  const chatScreen = document.getElementById("chat-screen");
  chatScreen.classList.remove("hidden");
  chatScreen.style.display = "flex";
  document.getElementById("chat-input").focus();
}

function showWelcomeScreen() {
  document.getElementById("welcome-screen").classList.remove("hidden");
  const chatScreen = document.getElementById("chat-screen");
  chatScreen.classList.add("hidden");
  chatScreen.style.display = "none";
}

function renderMessages() {
  const container = document.getElementById("chat-messages");

  container.innerHTML = state.messages
    .map(
      (msg) => `
    <div class="message ${msg.role}">
      <div class="message-avatar">
        ${msg.role === "user" ? getUserInitials() : "G"}
      </div>
      <div class="message-body">
        <div class="message-sender">${msg.role === "user" ? "You" : "AskOzzy"}</div>
        <div class="message-content">${msg.role === "user" ? escapeHtml(msg.content) : renderMarkdown(msg.content)}</div>
      </div>
    </div>`
    )
    .join("");

  scrollToBottom();
}

function getUserInitials() {
  if (!state.user) return "U";
  return state.user.fullName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

async function sendMessage() {
  const input = document.getElementById("chat-input");
  const message = input.value.trim();
  if (!message || state.isStreaming) return;

  // Gate behind auth
  if (!isLoggedIn()) {
    state.pendingAction = () => sendMessage();
    openAuthModal();
    return;
  }

  // If no active conversation, create one first
  if (!state.activeConversationId) {
    try {
      const res = await fetch(`${API}/api/conversations`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          title: message.length > 60 ? message.substring(0, 57) + "..." : message,
          model: state.selectedModel,
        }),
      });
      const data = await res.json();
      state.activeConversationId = data.id;
      showChatScreen();
      await loadConversations();
    } catch (err) {
      console.error("Failed to create conversation:", err);
      return;
    }
  }

  input.value = "";
  autoResizeInput();
  updateSendButton();

  // Add user message to UI
  state.messages.push({ role: "user", content: message });
  renderMessages();

  // Add typing indicator
  addTypingIndicator();

  state.isStreaming = true;
  updateSendButton();

  try {
    const res = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        conversationId: state.activeConversationId,
        message,
        model: state.selectedModel,
      }),
    });

    if (!res.ok) {
      const errData = await res.json();
      if (errData.code === "LIMIT_REACHED") {
        removeTypingIndicator();
        showLimitReachedBanner(errData);
        state.messages.push({
          role: "assistant",
          content: `**Daily limit reached** — You've used all ${errData.limit} messages for today on the ${state.user.tier === 'free' ? 'Free' : state.user.tier} plan.\n\nUpgrade your plan to continue chatting with more messages and access to all premium AI models.`,
        });
        renderMessages();
        state.isStreaming = false;
        updateSendButton();
        return;
      }
      throw new Error(errData.error || "Chat request failed");
    }

    removeTypingIndicator();
    state.messages.push({ role: "assistant", content: "" });
    renderMessages();

    // Stream response
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ") && !line.includes("[DONE]")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.response) {
              fullText += data.response;
              state.messages[state.messages.length - 1].content = fullText;
              updateLastMessage(fullText);
            }
          } catch {
            // skip malformed
          }
        }
      }
    }

    renderMessages();
    await loadConversations();
    loadUsageStatus(); // refresh usage counter
  } catch (err) {
    removeTypingIndicator();
    console.error("Chat error:", err);
    state.messages.push({
      role: "assistant",
      content: `**Error:** ${err.message}. Please try again.`,
    });
    renderMessages();
  } finally {
    state.isStreaming = false;
    updateSendButton();
  }
}

function addTypingIndicator() {
  const container = document.getElementById("chat-messages");
  const div = document.createElement("div");
  div.id = "typing-indicator";
  div.className = "message assistant";
  div.innerHTML = `
    <div class="message-avatar">G</div>
    <div class="message-body">
      <div class="message-sender">AskOzzy</div>
      <div class="typing-indicator"><span></span><span></span><span></span></div>
    </div>`;
  container.appendChild(div);
  scrollToBottom();
}

function removeTypingIndicator() {
  const el = document.getElementById("typing-indicator");
  if (el) el.remove();
}

function updateLastMessage(text) {
  const messages = document.querySelectorAll(".message.assistant");
  const last = messages[messages.length - 1];
  if (last) {
    const contentEl = last.querySelector(".message-content");
    if (contentEl) {
      contentEl.innerHTML = renderMarkdown(text);
      scrollToBottom();
    }
  }
}

function scrollToBottom() {
  const chatArea = document.getElementById("chat-area");
  if (chatArea) {
    chatArea.scrollTop = chatArea.scrollHeight;
  }
}

// ─── Input Handling ──────────────────────────────────────────────────

function handleInputKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResizeInput() {
  const input = document.getElementById("chat-input");
  input.style.height = "24px";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
  updateSendButton();
}

function updateSendButton() {
  const input = document.getElementById("chat-input");
  const btn = document.getElementById("btn-send");
  btn.disabled = !input.value.trim() || state.isStreaming;
}

function onModelChange() {
  const selector = document.getElementById("model-selector");
  const model = selector.value;
  const userTier = (state.user && state.user.tier) || "free";
  const freeModels = ["@cf/openai/gpt-oss-20b", "@cf/google/gemma-3-12b-it", "@cf/meta/llama-3.1-8b-instruct-fast"];

  if (userTier === "free" && !freeModels.includes(model)) {
    alert(`This model requires a paid plan.\n\nUpgrade to Starter (GHS 30/mo) or higher to access all 10 AI models.`);
    selector.value = state.selectedModel;
    openPricingModal();
    return;
  }

  state.selectedModel = model;
}

// ─── Sidebar ─────────────────────────────────────────────────────────

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("collapsed");
}

// ─── Templates UI ────────────────────────────────────────────────────

function renderCategoryTabs() {
  const container = document.getElementById("category-tabs");
  const categories = ["All", ...TEMPLATE_CATEGORIES.map((c) => c.id)];

  container.innerHTML = categories
    .map(
      (cat) =>
        `<button class="category-tab ${cat === state.activeCategory ? "active" : ""}"
              onclick="filterTemplates('${cat}')">${cat}</button>`
    )
    .join("");
}

function filterTemplates(category) {
  state.activeCategory = category;
  renderCategoryTabs();
  renderTemplateGrid();
}

function renderTemplateGrid() {
  const container = document.getElementById("template-grid");
  const filtered =
    state.activeCategory === "All"
      ? TEMPLATES
      : TEMPLATES.filter((t) => t.category === state.activeCategory);

  container.innerHTML = filtered
    .map(
      (t) => `
    <div class="template-card" onclick="selectTemplate('${t.id}')">
      <div class="card-icon">${t.icon}</div>
      <div class="card-title">${t.title}</div>
      <div class="card-desc">${t.description}</div>
    </div>`
    )
    .join("");
}

function selectTemplate(templateId) {
  // Gate behind auth — pass templateId to createNewChat after login
  requireAuth(createNewChat, templateId);
}

// Template Modal
function openTemplateModal() {
  const modal = document.getElementById("template-modal");
  modal.classList.add("active");
  renderModalCategories();
  renderModalTemplates("All");
}

function closeTemplateModal() {
  document.getElementById("template-modal").classList.remove("active");
}

function renderModalCategories() {
  const container = document.getElementById("modal-categories");
  const categories = ["All", ...TEMPLATE_CATEGORIES.map((c) => c.id)];

  container.innerHTML = categories
    .map(
      (cat) =>
        `<button class="category-tab ${cat === "All" ? "active" : ""}"
              onclick="filterModalTemplates('${cat}', this)">${cat}</button>`
    )
    .join("");
}

function filterModalTemplates(category, btn) {
  document
    .querySelectorAll("#modal-categories .category-tab")
    .forEach((b) => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  renderModalTemplates(category);
}

function renderModalTemplates(category) {
  const container = document.getElementById("modal-template-list");
  const filtered =
    category === "All"
      ? TEMPLATES
      : TEMPLATES.filter((t) => t.category === category);

  container.innerHTML = filtered
    .map(
      (t) => `
    <div class="modal-template-item" onclick="selectTemplate('${t.id}')">
      <div class="tpl-icon">${t.icon}</div>
      <div class="tpl-info">
        <div class="tpl-title">${t.title}</div>
        <div class="tpl-desc">${t.description}</div>
      </div>
      <div class="tpl-arrow">→</div>
    </div>`
    )
    .join("");
}

// Close modal on overlay click
document.getElementById("template-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeTemplateModal();
});

// ─── Markdown Rendering ──────────────────────────────────────────────

function renderMarkdown(text) {
  if (!text) return "";

  let html = text;

  // Code blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang || ""}">${escapeHtml(code.trim())}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Headers
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Unordered lists
  html = html.replace(/^[\-\*] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");

  // Horizontal rules
  html = html.replace(/^---$/gm, "<hr>");

  // Tables
  html = html.replace(
    /\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)*)/g,
    (_, header, rows) => {
      const ths = header
        .split("|")
        .filter((c) => c.trim())
        .map((c) => `<th>${c.trim()}</th>`)
        .join("");
      const trs = rows
        .trim()
        .split("\n")
        .map((row) => {
          const tds = row
            .split("|")
            .filter((c) => c.trim())
            .map((c) => `<td>${c.trim()}</td>`)
            .join("");
          return `<tr>${tds}</tr>`;
        })
        .join("");
      return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    }
  );

  // Paragraphs
  html = html.replace(/\n\n/g, "</p><p>");

  // Single newlines to <br>
  html = html.replace(/(?<!<\/?\w+[^>]*)\n(?!<)/g, "<br>");

  if (!html.startsWith("<")) {
    html = `<p>${html}</p>`;
  }

  return html;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ─── Affiliate Programme ─────────────────────────────────────────────

async function openAffiliateModal() {
  const modal = document.getElementById("affiliate-modal");
  const body = document.getElementById("affiliate-modal-body");

  body.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner"></div><p style="margin-top:12px;color:var(--text-muted);font-size:13px;">Loading your affiliate dashboard...</p></div>';
  modal.classList.add("active");

  try {
    const res = await fetch(`${API}/api/affiliate/dashboard`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const referralLink = `${window.location.origin}?ref=${data.referralCode}`;

    body.innerHTML = `
      <div style="padding:4px 0;">
        <!-- Tier Badge -->
        <div style="text-align:center;margin-bottom:20px;">
          <div class="affiliate-tier-badge tier-${data.affiliateTier || 'starter'}">
            ${data.currentTier.name} Affiliate
          </div>
        </div>

        <!-- Stats Grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px;">
          <div style="background:var(--bg-tertiary);border-radius:10px;padding:14px;text-align:center;">
            <div style="font-size:24px;font-weight:700;color:var(--gold);">${data.totalReferrals}</div>
            <div style="font-size:11px;color:var(--text-muted);">Referrals</div>
          </div>
          <div style="background:var(--bg-tertiary);border-radius:10px;padding:14px;text-align:center;">
            <div style="font-size:24px;font-weight:700;color:var(--green-light);">GHS ${data.totalEarnings.toFixed(2)}</div>
            <div style="font-size:11px;color:var(--text-muted);">Total Earned</div>
          </div>
          <div style="background:var(--bg-tertiary);border-radius:10px;padding:14px;text-align:center;">
            <div style="font-size:24px;font-weight:700;color:var(--text-strong);">${data.currentTier.recurringPercent}%</div>
            <div style="font-size:11px;color:var(--text-muted);">Recurring Rate</div>
          </div>
        </div>

        <!-- Commission Table -->
        <div style="background:var(--bg-tertiary);border-radius:10px;padding:16px;margin-bottom:20px;">
          <div style="font-size:13px;font-weight:600;margin-bottom:10px;">Commission Tiers</div>
          <table style="width:100%;font-size:12px;border-collapse:collapse;">
            <tr style="color:var(--text-muted);border-bottom:1px solid var(--border-color);">
              <th style="text-align:left;padding:6px 0;">Tier</th>
              <th style="text-align:center;padding:6px 0;">Referrals</th>
              <th style="text-align:center;padding:6px 0;">Signup Bonus</th>
              <th style="text-align:center;padding:6px 0;">Recurring %</th>
            </tr>
            <tr ${data.affiliateTier === 'starter' ? 'style="color:var(--gold);font-weight:600;"' : ''}>
              <td style="padding:6px 0;">Starter</td><td style="text-align:center;">0+</td><td style="text-align:center;">GHS 10</td><td style="text-align:center;">5%</td>
            </tr>
            <tr ${data.affiliateTier === 'bronze' ? 'style="color:var(--gold);font-weight:600;"' : ''}>
              <td style="padding:6px 0;">Bronze</td><td style="text-align:center;">5+</td><td style="text-align:center;">GHS 15</td><td style="text-align:center;">10%</td>
            </tr>
            <tr ${data.affiliateTier === 'silver' ? 'style="color:var(--gold);font-weight:600;"' : ''}>
              <td style="padding:6px 0;">Silver</td><td style="text-align:center;">20+</td><td style="text-align:center;">GHS 20</td><td style="text-align:center;">15%</td>
            </tr>
            <tr ${data.affiliateTier === 'gold' ? 'style="color:var(--gold);font-weight:600;"' : ''}>
              <td style="padding:6px 0;">Gold</td><td style="text-align:center;">50+</td><td style="text-align:center;">GHS 30</td><td style="text-align:center;">20%</td>
            </tr>
          </table>
        </div>

        ${data.nextTier ? `
        <div style="background:var(--bg-tertiary);border-radius:10px;padding:14px;margin-bottom:20px;text-align:center;">
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">Next tier: <strong style="color:var(--text-primary);">${data.nextTier.name}</strong></div>
          <div style="background:var(--bg-primary);border-radius:6px;height:8px;overflow:hidden;">
            <div style="background:var(--gold);height:100%;width:${Math.min(100, ((data.totalReferrals) / data.nextTier.requiredReferrals) * 100)}%;border-radius:6px;transition:width 0.5s;"></div>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${data.referralsToNextTier} more referrals needed</div>
        </div>
        ` : '<div style="background:rgba(252,209,22,0.1);border:1px solid rgba(252,209,22,0.3);border-radius:10px;padding:14px;margin-bottom:20px;text-align:center;font-size:13px;color:var(--gold);font-weight:600;">You\'ve reached the highest tier! Maximum earnings unlocked.</div>'}

        <!-- Referral Link -->
        <div style="margin-bottom:16px;">
          <div style="font-size:13px;font-weight:600;margin-bottom:6px;">Your Referral Code</div>
          <div style="display:flex;gap:8px;">
            <input type="text" value="${data.referralCode}" readonly style="flex:1;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:8px;padding:10px 14px;color:var(--gold);font-size:15px;font-weight:700;font-family:monospace;letter-spacing:1px;" />
            <button onclick="copyToClipboard('${data.referralCode}')" style="background:var(--gold);color:var(--text-on-accent);border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer;font-size:12px;">Copy</button>
          </div>
        </div>

        <div>
          <div style="font-size:13px;font-weight:600;margin-bottom:6px;">Your Referral Link</div>
          <div style="display:flex;gap:8px;">
            <input type="text" value="${referralLink}" readonly style="flex:1;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:8px;padding:10px 14px;color:var(--text-primary);font-size:12px;" />
            <button onclick="copyToClipboard('${referralLink}')" style="background:var(--gold);color:var(--text-on-accent);border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer;font-size:12px;">Copy</button>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">Share this link — when someone signs up using it, you earn commissions automatically!</div>
        </div>

        ${data.recentReferrals.length > 0 ? `
        <div style="margin-top:20px;">
          <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Recent Referrals</div>
          ${data.recentReferrals.map(r => `
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-color);font-size:12px;">
              <span>${escapeHtml(r.full_name)}</span>
              <span style="color:var(--green-light);">+GHS ${r.bonus_amount.toFixed(2)}</span>
            </div>
          `).join('')}
        </div>
        ` : ''}
      </div>`;
  } catch (err) {
    body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">Failed to load affiliate data. Please try again.</div>`;
  }
}

function closeAffiliateModal() {
  document.getElementById("affiliate-modal").classList.remove("active");
}

document.getElementById("affiliate-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeAffiliateModal();
});

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    const btn = event.target;
    const original = btn.textContent;
    btn.textContent = "Copied!";
    btn.style.background = "var(--green-light)";
    setTimeout(() => {
      btn.textContent = original;
      btn.style.background = "var(--gold)";
    }, 2000);
  });
}

// ─── Pricing & Usage ──────────────────────────────────────────────────

async function loadUsageStatus() {
  if (!isLoggedIn()) {
    updateUsageBadge(null);
    return;
  }

  try {
    const res = await fetch(`${API}/api/usage/status`, { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    state.user.tier = data.tier;
    localStorage.setItem("askozzy_user", JSON.stringify(state.user));
    updateUsageBadge(data);
  } catch {}
}

function updateUsageBadge(data) {
  const badge = document.getElementById("usage-badge");
  if (!badge) return;

  if (!data) {
    badge.style.display = "none";
    return;
  }

  badge.style.display = "flex";
  const tierLabel = data.tierName || "Free";

  if (data.limit === -1) {
    badge.textContent = `${tierLabel} — Unlimited`;
    badge.className = "usage-badge";
  } else {
    const pct = (data.used / data.limit) * 100;
    badge.textContent = `${tierLabel} — ${data.remaining}/${data.limit} left`;
    badge.className = "usage-badge" + (pct >= 90 ? " danger" : pct >= 70 ? " warning" : "");
  }
}

function showLimitReachedBanner(errData) {
  // Remove any existing banner
  const existing = document.querySelector(".limit-banner");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.className = "limit-banner";
  banner.innerHTML = `
    <span>You've reached your daily limit of ${errData.limit} messages.</span>
    <button class="btn-upgrade-inline" onclick="openPricingModal()">Upgrade Plan</button>
  `;

  const main = document.querySelector(".main-content");
  const header = main.querySelector(".main-header");
  header.after(banner);

  // Refresh usage badge
  loadUsageStatus();
}

async function openPricingModal() {
  const modal = document.getElementById("pricing-modal");
  const body = document.getElementById("pricing-modal-body");

  body.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner"></div></div>';
  modal.classList.add("active");

  try {
    const res = await fetch(`${API}/api/pricing`);
    const data = await res.json();
    const currentTier = (state.user && state.user.tier) || "free";

    body.innerHTML = `
      <div class="pricing-grid">
        ${data.plans.map(plan => {
          const isCurrent = plan.id === currentTier;
          const isDowngrade = getPlanOrder(plan.id) < getPlanOrder(currentTier);
          return `
          <div class="pricing-card ${plan.popular && !isCurrent ? 'popular' : ''} ${isCurrent ? 'current' : ''}">
            <div class="pricing-name">${plan.name}</div>
            <div class="pricing-price">
              ${plan.price === 0 ? 'Free' : `GHS ${plan.price}`}
              ${plan.price > 0 ? '<span>/month</span>' : ''}
            </div>
            <ul class="pricing-features">
              ${plan.features.map(f => `<li>${f}</li>`).join('')}
            </ul>
            ${isCurrent
              ? '<button class="btn-pricing current-btn">Current Plan</button>'
              : isDowngrade
                ? ''
                : `<button class="btn-pricing ${plan.popular ? 'primary' : 'secondary'}" onclick="upgradeToPlan('${plan.id}', '${plan.name}', ${plan.price})">${plan.price === 0 ? 'Get Started' : 'Upgrade to ' + plan.name}</button>`
            }
          </div>`;
        }).join('')}
      </div>
      <div style="text-align:center;margin-top:20px;font-size:12px;color:var(--text-muted);">
        All prices in Ghana Cedis (GHS). Cancel anytime. Payment via Mobile Money or card.
      </div>`;
  } catch {
    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Failed to load pricing. Please try again.</div>';
  }
}

function getPlanOrder(tier) {
  const order = { free: 0, starter: 1, professional: 2, enterprise: 3 };
  return order[tier] || 0;
}

function closePricingModal() {
  document.getElementById("pricing-modal").classList.remove("active");
}

document.getElementById("pricing-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closePricingModal();
});

async function upgradeToPlan(planId, planName, price) {
  if (!isLoggedIn()) {
    closePricingModal();
    state.pendingAction = () => openPricingModal();
    openAuthModal();
    return;
  }

  // In production: integrate Paystack / MTN MoMo here
  // For now: confirm and activate
  if (!confirm(`Upgrade to ${planName} for GHS ${price}/month?\n\nPayment integration with Mobile Money and card coming soon. For now, this activates a trial.`)) return;

  try {
    const res = await fetch(`${API}/api/upgrade`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ tier: planId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Update local state
    state.user.tier = planId;
    localStorage.setItem("askozzy_user", JSON.stringify(state.user));

    closePricingModal();
    loadUsageStatus();
    updateSidebarFooter();

    // Remove limit banner if present
    const banner = document.querySelector(".limit-banner");
    if (banner) banner.remove();

    alert(`Welcome to ${planName}! Your plan has been upgraded successfully.`);
  } catch (err) {
    alert("Upgrade failed: " + err.message);
  }
}

// ─── Auto-capture referral code from URL ─────────────────────────────

(function captureReferralFromURL() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get("ref");
  if (ref) {
    // Pre-fill the referral field when the auth modal opens
    localStorage.setItem("askozzy_pending_ref", ref);
    // Clean the URL
    window.history.replaceState({}, "", window.location.pathname);
  }

  // When auth modal opens, auto-fill the referral code
  const origOpen = openAuthModal;
  openAuthModal = function () {
    origOpen();
    const savedRef = localStorage.getItem("askozzy_pending_ref");
    if (savedRef) {
      const regRef = document.getElementById("reg-referral");
      const loginRef = document.getElementById("login-referral");
      if (regRef) regRef.value = savedRef;
      if (loginRef) loginRef.value = savedRef;
    }
  };
})();
