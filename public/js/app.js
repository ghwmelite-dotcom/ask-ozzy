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
  // Update PWA theme-color meta tag
  const themeColor = next === "dark" ? "#0f1117" : "#f5f3ef";
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", themeColor));
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

let _pendingCodeReveal = false;

function closeAuthModal() {
  if (_pendingCodeReveal) {
    if (!confirm("You haven't saved your access code yet! Are you sure you want to close? You won't be able to see it again.")) {
      return;
    }
    _pendingCodeReveal = false;
    onAuthenticated();
  }
  // Reset code reveal UI
  const codeReveal = document.getElementById("code-reveal");
  if (codeReveal) codeReveal.classList.add("hidden");
  document.getElementById("login-form").classList.remove("hidden");
  document.getElementById("register-form").classList.add("hidden");
  const authToggle = document.querySelector(".auth-toggle");
  if (authToggle) authToggle.style.display = "";
  const privacyBanner = document.querySelector("#auth-modal .privacy-banner");
  if (privacyBanner) privacyBanner.style.display = "";
  document.getElementById("auth-modal-title").textContent = "Sign in to AskOzzy";

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

  // Reset code reveal if it's visible
  const codeReveal = document.getElementById("code-reveal");
  if (codeReveal && !codeReveal.classList.contains("hidden")) {
    codeReveal.classList.add("hidden");
    const authToggle = document.querySelector(".auth-toggle");
    if (authToggle) authToggle.style.display = "";
    const privacyBanner = document.querySelector("#auth-modal .privacy-banner");
    if (privacyBanner) privacyBanner.style.display = "";
    _pendingCodeReveal = false;
  }

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

function showAccessCodeReveal(code) {
  document.getElementById("auth-error").classList.remove("visible");
  document.getElementById("login-form").classList.add("hidden");
  document.getElementById("register-form").classList.add("hidden");
  const authToggle = document.querySelector(".auth-toggle");
  if (authToggle) authToggle.style.display = "none";
  const privacyBanner = document.querySelector("#auth-modal .privacy-banner");
  if (privacyBanner) privacyBanner.style.display = "none";

  document.getElementById("code-reveal").classList.remove("hidden");
  document.getElementById("reveal-code-display").textContent = code;
  document.getElementById("auth-modal-title").textContent = "Account Created!";
  _pendingCodeReveal = true;
}

function copyAccessCode() {
  const code = document.getElementById("reveal-code-display").textContent;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.getElementById("btn-copy-code");
    btn.textContent = "Copied!";
    btn.style.background = "var(--green-light)";
    setTimeout(() => {
      btn.textContent = "Copy Code";
      btn.style.background = "var(--gold)";
    }, 2000);
  });
}

function finishRegistration() {
  _pendingCodeReveal = false;
  document.getElementById("code-reveal").classList.add("hidden");
  // Restore form visibility for next time
  document.getElementById("login-form").classList.remove("hidden");
  document.getElementById("register-form").classList.add("hidden");
  const authToggle = document.querySelector(".auth-toggle");
  if (authToggle) authToggle.style.display = "";
  const privacyBanner = document.querySelector("#auth-modal .privacy-banner");
  if (privacyBanner) privacyBanner.style.display = "";
  document.getElementById("auth-modal-title").textContent = "Sign in to AskOzzy";

  document.getElementById("auth-modal").classList.remove("active");
  onAuthenticated();
}

// Runs after successful login or register
function onAuthenticated() {
  updateSidebarFooter();
  loadConversations();
  loadUsageStatus();
  loadFolders();
  loadAnnouncements();

  // Show onboarding tour for new users (after a short delay for UI to settle)
  setTimeout(() => showOnboardingTour(), 800);

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
  const accessCode = document.getElementById("login-access-code").value;
  const btn = e.target.querySelector(".btn-auth");
  btn.disabled = true;
  btn.textContent = "Signing in...";

  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, accessCode }),
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
  const btn = e.target.querySelector(".btn-auth");
  btn.disabled = true;
  btn.textContent = "Creating account...";

  try {
    const res = await fetch(`${API}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, fullName, department, referralCode: document.getElementById("reg-referral").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");

    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("askozzy_token", data.token);
    localStorage.setItem("askozzy_user", JSON.stringify(data.user));

    showAccessCodeReveal(data.accessCode);
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
      <div class="sidebar-links">
        <button class="sidebar-link-btn" onclick="openUserDashboard()">Dashboard</button>
        <button class="sidebar-link-btn" onclick="open2FASetup()">2FA Security</button>
        <button class="sidebar-link-btn" onclick="revokeAllSessions()">Revoke Sessions</button>
        ${state.user.role === 'super_admin' ? '<a class="sidebar-link-btn" href="/admin" style="text-decoration:none;text-align:center;">Admin</a>' : ''}
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

  if (!isLoggedIn() || state.conversations.length === 0) {
    container.innerHTML =
      '<div class="section-label">Recent Conversations</div>' +
      `<div style="padding:12px;font-size:12px;color:var(--text-muted);text-align:center;">
        ${isLoggedIn() ? "No conversations yet. Start a new one!" : "Sign in to see your conversations"}
      </div>`;
    return;
  }

  const pinned = state.conversations.filter(c => c.pinned);
  const unpinned = state.conversations.filter(c => !c.pinned);
  const folders = state.folders || [];

  let html = "";

  // Folders section
  if (folders.length > 0) {
    html += `<div class="folder-section">
      <div class="folder-header">
        <div class="section-label">Folders</div>
        <button class="folder-add-btn" onclick="createFolder()" title="New folder">+</button>
      </div>`;
    for (const folder of folders) {
      const folderConvos = state.conversations.filter(c => c.folder_id === folder.id);
      html += `<div class="folder-item">
        <span class="folder-icon">📁</span> ${escapeHtml(folder.name)} (${folderConvos.length})
        <button class="folder-delete" onclick="event.stopPropagation();deleteFolder('${folder.id}')" title="Delete folder">×</button>
      </div>`;
      html += folderConvos.map(c => renderConvoItem(c, true)).join("");
    }
    html += `</div>`;
  }

  // Pinned conversations
  if (pinned.length > 0) {
    html += '<div class="section-label">Pinned</div>';
    html += pinned.map(c => renderConvoItem(c)).join("");
  }

  // Recent conversations (not in folders, not pinned)
  const unfiled = unpinned.filter(c => !c.folder_id);
  html += '<div class="section-label">Recent Conversations</div>';
  if (folders.length > 0 && isLoggedIn()) {
    html += `<div style="padding:2px 12px;">
      <button class="folder-add-btn" onclick="createFolder()" title="New folder" style="font-size:11px;color:var(--text-muted);background:none;border:none;cursor:pointer;">+ New Folder</button>
    </div>`;
  }
  html += unfiled.map(c => renderConvoItem(c)).join("");

  container.innerHTML = html;
}

function renderConvoItem(c, inFolder) {
  return `
    <div class="conversation-item ${c.id === state.activeConversationId ? "active" : ""} ${c.pinned ? "pinned" : ""}"
         onclick="openConversation('${c.id}')" ${inFolder ? 'style="padding-left:28px;"' : ""}>
      <span class="convo-icon">${c.pinned ? "📌" : "💬"}</span>
      <span class="convo-title">${escapeHtml(c.title)}</span>
      <button class="convo-delete" onclick="event.stopPropagation();deleteConversation('${c.id}')" title="Delete">🗑</button>
    </div>`;
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
      (msg, i) => `
    <div class="message ${msg.role}">
      <div class="message-avatar">
        ${msg.role === "user" ? getUserInitials() : "G"}
      </div>
      <div class="message-body">
        <div class="message-sender">${msg.role === "user" ? "You" : "AskOzzy"}</div>
        <div class="message-content">${msg.role === "user" ? escapeHtml(msg.content) : renderMarkdown(msg.content)}</div>
        <div class="msg-actions">
          <button class="msg-action-btn" onclick="copyMessageText(${i})" title="Copy text">
            <span class="msg-action-icon">&#x2398;</span> Copy
          </button>
          ${msg.role === "assistant" ? `
          <button class="msg-action-btn" onclick="downloadMessageTxt(${i})" title="Download as text file">
            <span class="msg-action-icon">&#x1F4C4;</span> .txt
          </button>
          <button class="msg-action-btn" onclick="downloadMessageDoc(${i})" title="Download as Word document">
            <span class="msg-action-icon">&#x1F4DD;</span> .doc
          </button>
          <button class="msg-action-btn" onclick="printMessage(${i})" title="Print or save as PDF">
            <span class="msg-action-icon">&#x1F5A8;</span> Print
          </button>
          ${msg.id ? `
          <button class="msg-rate-btn ${msg.userRating === 1 ? 'rated' : ''}" data-rate-msg="${msg.id}" data-rating="1" onclick="rateMessage('${msg.id}', 1)" title="Good response">&#x1F44D;</button>
          <button class="msg-rate-btn ${msg.userRating === -1 ? 'rated' : ''}" data-rate-msg="${msg.id}" data-rating="-1" onclick="rateMessage('${msg.id}', -1)" title="Poor response">&#x1F44E;</button>
          <button class="msg-action-btn" onclick="regenerateMessage('${msg.id}')" title="Regenerate response">
            <span class="msg-action-icon">&#x1F504;</span> Regenerate
          </button>
          ` : ""}
          ` : ""}
        </div>
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
            // Workers AI legacy format
            let token = data.response || null;
            // OpenAI-compatible format (gpt-oss, newer models)
            if (!token && data.choices?.[0]?.delta?.content) {
              token = data.choices[0].delta.content;
            }
            if (token) {
              fullText += token;
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
    // Load follow-up suggestions after response
    setTimeout(loadFollowUpSuggestions, 500);
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

// ─── Message Actions (Copy / Download / Print) ──────────────────────

function copyMessageText(index) {
  const msg = state.messages[index];
  if (!msg) return;
  navigator.clipboard.writeText(msg.content).then(() => {
    // Flash the button
    const btns = document.querySelectorAll(`.message:nth-child(${index + 1}) .msg-action-btn`);
    const btn = btns[0];
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '<span class="msg-action-icon">&#x2713;</span> Copied!';
      btn.classList.add("copied");
      setTimeout(() => { btn.innerHTML = orig; btn.classList.remove("copied"); }, 1500);
    }
  });
}

function _getMessageFilename(index, ext) {
  const msg = state.messages[index];
  if (!msg) return `message.${ext}`;
  const preview = msg.content.replace(/[^a-zA-Z0-9 ]/g, "").trim().slice(0, 40).trim().replace(/\s+/g, "_");
  return `AskOzzy_${preview || "response"}.${ext}`;
}

function _triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadMessageTxt(index) {
  const msg = state.messages[index];
  if (!msg) return;
  const blob = new Blob([msg.content], { type: "text/plain;charset=utf-8" });
  _triggerDownload(blob, _getMessageFilename(index, "txt"));
}

function downloadMessageDoc(index) {
  const msg = state.messages[index];
  if (!msg) return;
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>AskOzzy Document</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:12pt;line-height:1.6;color:#1a1a1a;max-width:700px;margin:40px auto;padding:0 20px}h1{font-size:18pt;color:#006B3F}h2{font-size:16pt;color:#006B3F}h3{font-size:14pt;color:#333}pre{background:#f5f5f5;padding:12px;border:1px solid #ddd;border-radius:4px;font-family:Consolas,monospace;font-size:10pt;white-space:pre-wrap}code{font-family:Consolas,monospace;font-size:10pt;background:#f5f5f5;padding:2px 4px}blockquote{border-left:3px solid #006B3F;padding-left:12px;color:#555;font-style:italic}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left}th{background:#f0f0f0;font-weight:bold}</style></head>
<body>${renderMarkdown(msg.content)}</body></html>`;
  const blob = new Blob([html], { type: "application/msword" });
  _triggerDownload(blob, _getMessageFilename(index, "doc"));
}

function printMessage(index) {
  const msg = state.messages[index];
  if (!msg) return;
  const win = window.open("", "_blank");
  if (!win) { alert("Please allow popups to print."); return; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>AskOzzy — Print</title>
<style>body{font-family:Georgia,'Times New Roman',serif;font-size:12pt;line-height:1.7;color:#1a1a1a;max-width:700px;margin:40px auto;padding:0 20px}h1{font-size:18pt;color:#006B3F;border-bottom:2px solid #006B3F;padding-bottom:4px}h2{font-size:16pt;color:#006B3F}h3{font-size:14pt;color:#333}pre{background:#f5f5f5;padding:12px;border:1px solid #ddd;border-radius:4px;font-family:Consolas,monospace;font-size:10pt;white-space:pre-wrap}code{font-family:Consolas,monospace;font-size:10pt;background:#f5f5f5;padding:2px 4px}blockquote{border-left:3px solid #006B3F;padding-left:12px;color:#555;font-style:italic}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:8px;text-align:left}th{background:#eee;font-weight:bold}.footer{margin-top:40px;padding-top:12px;border-top:1px solid #ccc;font-size:9pt;color:#999;text-align:center}@media print{body{margin:0;padding:20px}}</style>
</head><body>
<div style="text-align:center;margin-bottom:24px;padding-bottom:12px;border-bottom:3px solid #006B3F;">
<div style="font-size:20pt;font-weight:bold;">AskOzzy</div>
<div style="font-size:10pt;color:#666;">AI Assistant for GoG Operations</div>
</div>
${renderMarkdown(msg.content)}
<div class="footer">Generated by AskOzzy &mdash; ${new Date().toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" })}</div>
</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 300);
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
  // Route through Paystack payment system
  await initPaystackPayment(planId, planName, price);
}

// ─── Keyboard Shortcuts ──────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  // Ctrl/Cmd + K — focus search (or open search modal)
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    openSearchModal();
    return;
  }
  // Ctrl/Cmd + N — new conversation
  if ((e.ctrlKey || e.metaKey) && e.key === "n") {
    e.preventDefault();
    requireAuth(createNewChat);
    return;
  }
  // Ctrl/Cmd + B — toggle sidebar
  if ((e.ctrlKey || e.metaKey) && e.key === "b") {
    e.preventDefault();
    toggleSidebar();
    return;
  }
  // Ctrl/Cmd + Shift + D — toggle theme
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "D") {
    e.preventDefault();
    toggleTheme();
    return;
  }
  // Escape — close any open modal
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay.active").forEach(m => m.classList.remove("active"));
  }
});

// ─── Voice Input (Web Speech API) ────────────────────────────────────

let _recognition = null;
let _isListening = false;

function initVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return; // Not supported

  _recognition = new SpeechRecognition();
  _recognition.continuous = false;
  _recognition.interimResults = true;
  _recognition.lang = "en-GH";

  _recognition.onresult = (event) => {
    const input = document.getElementById("chat-input");
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    if (event.results[event.results.length - 1].isFinal) {
      input.value += (input.value ? " " : "") + transcript;
    }
    autoResizeInput();
    updateSendButton();
  };

  _recognition.onend = () => {
    _isListening = false;
    updateVoiceButton();
  };

  _recognition.onerror = () => {
    _isListening = false;
    updateVoiceButton();
  };
}

function toggleVoice() {
  if (!_recognition) {
    alert("Voice input is not supported in this browser. Try Chrome or Edge.");
    return;
  }
  if (_isListening) {
    _recognition.stop();
    _isListening = false;
  } else {
    _recognition.start();
    _isListening = true;
  }
  updateVoiceButton();
}

function updateVoiceButton() {
  const btn = document.getElementById("btn-voice");
  if (!btn) return;
  btn.classList.toggle("listening", _isListening);
  btn.title = _isListening ? "Stop listening" : "Voice input";
}

// Init voice on load
document.addEventListener("DOMContentLoaded", initVoiceInput);

// ─── Response Rating ─────────────────────────────────────────────────

async function rateMessage(messageId, rating) {
  if (!isLoggedIn()) return;
  try {
    await fetch(`${API}/api/messages/${messageId}/rate`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ rating }),
    });
    // Update UI
    const btns = document.querySelectorAll(`[data-rate-msg="${messageId}"]`);
    btns.forEach(btn => {
      const r = parseInt(btn.dataset.rating);
      btn.classList.toggle("rated", r === rating);
    });
  } catch (err) {
    console.error("Rating failed:", err);
  }
}

// ─── Regenerate Response ─────────────────────────────────────────────

async function regenerateMessage(messageId) {
  if (!isLoggedIn() || state.isStreaming) return;

  state.isStreaming = true;
  updateSendButton();

  try {
    const res = await fetch(`${API}/api/messages/${messageId}/regenerate`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ model: state.selectedModel }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Regeneration failed");
    }

    // Find and replace the message in state
    const idx = state.messages.findIndex(m => m.id === messageId);
    if (idx !== -1) {
      state.messages[idx].content = "";
      renderMessages();
    }

    // Stream new response
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
            let token = data.response || null;
            if (!token && data.choices?.[0]?.delta?.content) token = data.choices[0].delta.content;
            if (token) {
              fullText += token;
              if (idx !== -1) {
                state.messages[idx].content = fullText;
                updateLastMessage(fullText);
              }
            }
          } catch {}
        }
      }
    }

    renderMessages();
    await loadConversations();
  } catch (err) {
    console.error("Regenerate error:", err);
    alert("Failed to regenerate: " + err.message);
  } finally {
    state.isStreaming = false;
    updateSendButton();
  }
}

// ─── Conversation Search ─────────────────────────────────────────────

function openSearchModal() {
  if (!isLoggedIn()) {
    requireAuth(openSearchModal);
    return;
  }
  let modal = document.getElementById("search-modal");
  if (!modal) {
    // Create search modal dynamically
    modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.id = "search-modal";
    modal.innerHTML = `
      <div class="modal" style="max-width:600px;">
        <div class="modal-header">
          <h3>Search Conversations</h3>
          <button class="modal-close" onclick="closeSearchModal()">&#x2715;</button>
        </div>
        <div class="modal-body" style="padding:16px 24px;">
          <input type="text" id="search-input" class="search-input" placeholder="Search messages and conversations..." oninput="debouncedSearch()" autofocus />
          <div id="search-results" class="search-results"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeSearchModal(); });
  }
  modal.classList.add("active");
  setTimeout(() => document.getElementById("search-input")?.focus(), 100);
}

function closeSearchModal() {
  const modal = document.getElementById("search-modal");
  if (modal) modal.classList.remove("active");
}

const debouncedSearch = debounce(async () => {
  const q = document.getElementById("search-input")?.value || "";
  const container = document.getElementById("search-results");
  if (!container) return;

  if (q.length < 2) {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px;">Type at least 2 characters to search</div>';
    return;
  }

  container.innerHTML = '<div style="text-align:center;padding:24px;"><div class="spinner"></div></div>';

  try {
    const res = await fetch(`${API}/api/conversations/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() });
    const data = await res.json();

    if (!data.results || data.results.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px;">No results found</div>';
      return;
    }

    container.innerHTML = data.results.map(r => `
      <div class="search-result-item" onclick="closeSearchModal();openConversation('${r.id}')">
        <div class="search-result-title">${escapeHtml(r.title)}</div>
        ${r.matched_content ? `<div class="search-result-preview">${escapeHtml(r.matched_content.substring(0, 120))}...</div>` : ""}
        <div class="search-result-date">${formatDateShort(r.updated_at)}</div>
      </div>
    `).join("");
  } catch {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">Search failed</div>';
  }
}, 300);

function debounce(fn, ms) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

function formatDateShort(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Folders ─────────────────────────────────────────────────────────

async function loadFolders() {
  if (!isLoggedIn()) return;
  try {
    const res = await fetch(`${API}/api/folders`, { headers: authHeaders() });
    const data = await res.json();
    state.folders = data.folders || [];
  } catch {}
}

async function createFolder() {
  const name = prompt("Folder name:");
  if (!name) return;
  try {
    await fetch(`${API}/api/folders`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name }),
    });
    await loadFolders();
    renderConversationList();
  } catch {}
}

async function deleteFolder(id) {
  if (!confirm("Delete this folder? Conversations will be unassigned.")) return;
  try {
    await fetch(`${API}/api/folders/${id}`, { method: "DELETE", headers: authHeaders() });
    await loadFolders();
    await loadConversations();
  } catch {}
}

async function moveToFolder(convoId, folderId) {
  try {
    await fetch(`${API}/api/conversations/${convoId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ folder_id: folderId || null }),
    });
    await loadConversations();
  } catch {}
}

async function togglePin(convoId) {
  const convo = state.conversations.find(c => c.id === convoId);
  if (!convo) return;
  try {
    await fetch(`${API}/api/conversations/${convoId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ pinned: !convo.pinned }),
    });
    await loadConversations();
  } catch {}
}

// ─── Announcements Banner ────────────────────────────────────────────

async function loadAnnouncements() {
  try {
    const res = await fetch(`${API}/api/announcements`);
    const data = await res.json();
    const dismissed = JSON.parse(localStorage.getItem("askozzy_dismissed_announcements") || "[]");
    const active = (data.announcements || []).filter(a => !dismissed.includes(a.id));

    const container = document.getElementById("announcements-area");
    if (!container || active.length === 0) return;

    container.innerHTML = active.map(a => `
      <div class="announcement-banner announcement-${a.type}">
        <div class="announcement-content">
          <strong>${escapeHtml(a.title)}</strong>
          <span>${escapeHtml(a.content)}</span>
        </div>
        ${a.dismissible ? `<button class="announcement-dismiss" onclick="dismissAnnouncement('${a.id}')">&times;</button>` : ""}
      </div>
    `).join("");
  } catch {}
}

function dismissAnnouncement(id) {
  const dismissed = JSON.parse(localStorage.getItem("askozzy_dismissed_announcements") || "[]");
  dismissed.push(id);
  localStorage.setItem("askozzy_dismissed_announcements", JSON.stringify(dismissed));
  const container = document.getElementById("announcements-area");
  if (container) {
    const banner = container.querySelector(`[onclick*="${id}"]`);
    if (banner) banner.parentElement.remove();
  }
}

// ─── User Usage Dashboard ────────────────────────────────────────────

async function openUserDashboard() {
  if (!isLoggedIn()) { requireAuth(openUserDashboard); return; }

  let modal = document.getElementById("user-dashboard-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.id = "user-dashboard-modal";
    modal.innerHTML = `
      <div class="modal" style="max-width:640px;">
        <div class="modal-header">
          <h3>Your Usage Dashboard</h3>
          <button class="modal-close" onclick="document.getElementById('user-dashboard-modal').classList.remove('active')">&#x2715;</button>
        </div>
        <div class="modal-body" id="user-dashboard-body" style="padding:24px;">
          <div style="text-align:center;padding:40px;"><div class="spinner"></div></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("active"); });
  }

  modal.classList.add("active");
  const body = document.getElementById("user-dashboard-body");

  try {
    const res = await fetch(`${API}/api/user/dashboard`, { headers: authHeaders() });
    const d = await res.json();
    const maxMsg = Math.max(...(d.messagesPerDay || []).map(x => x.count), 1);

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px;">
        <div style="background:var(--bg-tertiary);border-radius:10px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:var(--gold);">${d.totalMessages}</div>
          <div style="font-size:11px;color:var(--text-muted);">Total Messages</div>
        </div>
        <div style="background:var(--bg-tertiary);border-radius:10px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:var(--green-light);">${d.totalConversations}</div>
          <div style="font-size:11px;color:var(--text-muted);">Conversations</div>
        </div>
        <div style="background:var(--bg-tertiary);border-radius:10px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:var(--text-strong);">${formatDateShort(d.memberSince)}</div>
          <div style="font-size:11px;color:var(--text-muted);">Member Since</div>
        </div>
      </div>
      <div style="background:var(--bg-tertiary);border-radius:10px;padding:16px;margin-bottom:16px;">
        <div style="font-size:13px;font-weight:600;margin-bottom:12px;">Messages — Last 7 Days</div>
        ${(d.messagesPerDay || []).map(day => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="font-size:11px;color:var(--text-muted);min-width:60px;">${day.day.slice(5)}</span>
            <div style="flex:1;background:var(--bg-primary);border-radius:4px;height:18px;overflow:hidden;">
              <div style="background:var(--gold);height:100%;width:${(day.count / maxMsg) * 100}%;border-radius:4px;transition:width 0.3s;"></div>
            </div>
            <span style="font-size:11px;color:var(--text-secondary);min-width:24px;text-align:right;">${day.count}</span>
          </div>
        `).join("")}
      </div>
      <div style="background:var(--bg-tertiary);border-radius:10px;padding:16px;">
        <div style="font-size:13px;font-weight:600;margin-bottom:12px;">Models Used</div>
        ${(d.modelUsage || []).map(m => `
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-color);font-size:12px;">
            <span style="color:var(--text-primary);">${m.model.split("/").pop()}</span>
            <span style="color:var(--gold);font-weight:600;">${m.count} msgs</span>
          </div>
        `).join("")}
      </div>`;
  } catch {
    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Failed to load dashboard</div>';
  }
}

// ─── Session Management ──────────────────────────────────────────────

async function revokeAllSessions() {
  if (!confirm("This will sign you out of ALL devices and generate a new access code. Continue?")) return;

  try {
    const res = await fetch(`${API}/api/user/sessions/revoke-all`, {
      method: "POST",
      headers: authHeaders(),
    });
    const data = await res.json();
    if (data.newAccessCode) {
      alert(`All sessions revoked!\n\nYour NEW access code is:\n${data.newAccessCode}\n\nSave this code — you'll need it to sign in again!`);
      logout();
    }
  } catch {
    alert("Failed to revoke sessions");
  }
}

// ─── 2FA Setup ───────────────────────────────────────────────────────

async function open2FASetup() {
  if (!isLoggedIn()) return;

  let modal = document.getElementById("2fa-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.id = "2fa-modal";
    modal.innerHTML = `
      <div class="modal" style="max-width:460px;">
        <div class="modal-header">
          <h3>Two-Factor Authentication</h3>
          <button class="modal-close" onclick="document.getElementById('2fa-modal').classList.remove('active')">&#x2715;</button>
        </div>
        <div class="modal-body" id="2fa-body" style="padding:24px;">
          <div style="text-align:center;padding:40px;"><div class="spinner"></div></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("active"); });
  }

  modal.classList.add("active");
  const body = document.getElementById("2fa-body");

  try {
    const res = await fetch(`${API}/api/user/2fa/setup`, { method: "POST", headers: authHeaders() });
    const data = await res.json();

    body.innerHTML = `
      <div style="text-align:center;">
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">
          Scan this code with your authenticator app (Google Authenticator, Authy, etc.):
        </p>
        <div style="background:#fff;padding:16px;border-radius:12px;display:inline-block;margin-bottom:16px;">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.uri)}" alt="QR Code" width="200" height="200" />
        </div>
        <p style="font-size:11px;color:var(--text-muted);margin-bottom:16px;">
          Or enter this secret manually: <code style="color:var(--gold);font-size:13px;">${data.secret}</code>
        </p>
        <div class="form-group">
          <label>Enter the 6-digit code from your app:</label>
          <input type="text" id="totp-verify-code" maxlength="6" placeholder="000000" style="text-align:center;font-size:24px;letter-spacing:8px;" />
        </div>
        <button class="btn-auth" onclick="verify2FA()">Verify & Enable 2FA</button>
        <div id="2fa-error" style="color:var(--red-error-text);font-size:12px;margin-top:8px;"></div>
      </div>`;
  } catch {
    body.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">Failed to set up 2FA</div>';
  }
}

async function verify2FA() {
  const code = document.getElementById("totp-verify-code")?.value || "";
  const errEl = document.getElementById("2fa-error");

  if (code.length !== 6) {
    if (errEl) errEl.textContent = "Enter a 6-digit code";
    return;
  }

  try {
    const res = await fetch(`${API}/api/user/2fa/verify`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert("2FA enabled successfully! You'll need your authenticator app code when signing in.");
    document.getElementById("2fa-modal").classList.remove("active");
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  }
}

// ─── Onboarding Tour ─────────────────────────────────────────────────

function showOnboardingTour() {
  if (localStorage.getItem("askozzy_onboarding_done")) return;

  const steps = [
    { target: ".model-selector", text: "Choose from 10 AI models. Free plans get 3 models, paid plans unlock all 10.", position: "bottom" },
    { target: ".btn-new-chat", text: "Start conversations here. Try a template for guided prompts!", position: "right" },
    { target: ".theme-toggle", text: "Switch between dark and light modes.", position: "bottom" },
    { target: ".usage-badge", text: "Track your daily usage. Click to see upgrade plans.", position: "bottom" },
  ];

  let currentStep = 0;

  function showStep(index) {
    // Remove previous overlay
    const prev = document.querySelector(".onboarding-overlay");
    if (prev) prev.remove();

    if (index >= steps.length) {
      localStorage.setItem("askozzy_onboarding_done", "1");
      return;
    }

    const step = steps[index];
    const target = document.querySelector(step.target);
    if (!target) { showStep(index + 1); return; }

    const rect = target.getBoundingClientRect();
    const overlay = document.createElement("div");
    overlay.className = "onboarding-overlay";
    overlay.innerHTML = `
      <div class="onboarding-highlight" style="top:${rect.top - 4}px;left:${rect.left - 4}px;width:${rect.width + 8}px;height:${rect.height + 8}px;"></div>
      <div class="onboarding-tooltip onboarding-${step.position}" style="top:${step.position === "bottom" ? rect.bottom + 12 : rect.top}px;left:${rect.left}px;">
        <p>${step.text}</p>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="onboarding-skip" onclick="this.closest('.onboarding-overlay').remove();localStorage.setItem('askozzy_onboarding_done','1')">Skip Tour</button>
          <button class="onboarding-next" onclick="showOnboardingStep(${index + 1})">${index === steps.length - 1 ? "Finish" : "Next"}</button>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:6px;">${index + 1} of ${steps.length}</div>
      </div>`;
    document.body.appendChild(overlay);
  }

  window.showOnboardingStep = showStep;
  showStep(0);
}

// ─── Paystack Payment ────────────────────────────────────────────────

async function initPaystackPayment(planId, planName, price) {
  if (!isLoggedIn()) {
    closePricingModal();
    state.pendingAction = () => openPricingModal();
    openAuthModal();
    return;
  }

  try {
    const res = await fetch(`${API}/api/payments/initialize`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ tier: planId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (data.authorization_url) {
      // Real Paystack — redirect to payment page
      window.location.href = data.authorization_url;
    } else if (data.simulated) {
      // Dev mode — instant upgrade
      state.user.tier = planId;
      localStorage.setItem("askozzy_user", JSON.stringify(state.user));
      closePricingModal();
      loadUsageStatus();
      updateSidebarFooter();
      const banner = document.querySelector(".limit-banner");
      if (banner) banner.remove();
      alert(`Welcome to ${planName}! ${data.message}`);
    }
  } catch (err) {
    alert("Payment failed: " + err.message);
  }
}

// ─── PWA: Service Worker Registration ────────────────────────────────

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // Check for updates periodically
        setInterval(() => reg.update(), 60 * 60 * 1000); // every hour

        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "activated" && navigator.serviceWorker.controller) {
              showUpdateBanner();
            }
          });
        });
      })
      .catch((err) => console.log("SW registration failed:", err));
  });
}

function showUpdateBanner() {
  const existing = document.querySelector(".pwa-update-banner");
  if (existing) return;

  const banner = document.createElement("div");
  banner.className = "pwa-update-banner";
  banner.innerHTML = `
    <span>A new version of AskOzzy is available.</span>
    <button onclick="window.location.reload()">Update Now</button>
    <button class="dismiss" onclick="this.parentElement.remove()">Later</button>
  `;
  document.body.appendChild(banner);
}

// ─── PWA: Install Prompt ─────────────────────────────────────────────

let _deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  showInstallBanner();
});

window.addEventListener("appinstalled", () => {
  _deferredInstallPrompt = null;
  const banner = document.querySelector(".pwa-install-banner");
  if (banner) banner.remove();
});

function showInstallBanner() {
  // Don't show if already dismissed this session
  if (sessionStorage.getItem("askozzy_install_dismissed")) return;

  const existing = document.querySelector(".pwa-install-banner");
  if (existing) return;

  const banner = document.createElement("div");
  banner.className = "pwa-install-banner";
  banner.innerHTML = `
    <div class="pwa-install-content">
      <div class="pwa-install-icon">&#x26A1;</div>
      <div class="pwa-install-text">
        <strong>Install AskOzzy</strong>
        <span>Add to your home screen for quick access</span>
      </div>
    </div>
    <div class="pwa-install-actions">
      <button class="pwa-install-btn" onclick="installPWA()">Install</button>
      <button class="pwa-install-dismiss" onclick="dismissInstallBanner()">Not now</button>
    </div>
  `;
  document.body.appendChild(banner);
}

async function installPWA() {
  if (!_deferredInstallPrompt) return;

  _deferredInstallPrompt.prompt();
  const { outcome } = await _deferredInstallPrompt.userChoice;

  if (outcome === "accepted") {
    _deferredInstallPrompt = null;
  }

  const banner = document.querySelector(".pwa-install-banner");
  if (banner) banner.remove();
}

function dismissInstallBanner() {
  sessionStorage.setItem("askozzy_install_dismissed", "1");
  const banner = document.querySelector(".pwa-install-banner");
  if (banner) banner.remove();
}

// ─── PWA: Online/Offline Detection ───────────────────────────────────

function updateOnlineStatus() {
  const existing = document.querySelector(".offline-indicator");

  if (!navigator.onLine) {
    if (existing) return;
    const indicator = document.createElement("div");
    indicator.className = "offline-indicator";
    indicator.innerHTML = '<span class="offline-dot"></span> You are offline — messages will fail until reconnected';
    document.body.appendChild(indicator);
  } else {
    if (existing) existing.remove();
  }
}

window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);

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
      if (regRef) regRef.value = savedRef;
    }
  };

  // Handle PWA shortcut ?action=new-chat
  const action = params.get("action");
  if (action === "new-chat") {
    window.history.replaceState({}, "", window.location.pathname);
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => requireAuth(createNewChat), 500);
    });
  }
})();

// ─── Paystack Payment Success Banner ─────────────────────────────────

function showPaymentSuccess(planName) {
  const banner = document.createElement("div");
  banner.className = "payment-success-banner";
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:16px 24px;background:linear-gradient(135deg, var(--green), var(--green-light));color:white;border-radius:12px;margin:12px;font-size:14px;font-weight:600;animation:slideDown 0.3s ease;">
      <span style="font-size:24px;">&#x2705;</span>
      <span>Successfully upgraded to ${planName}! All premium features are now unlocked.</span>
      <button onclick="this.parentElement.parentElement.remove()" style="background:none;border:none;color:white;font-size:18px;cursor:pointer;margin-left:auto;">&#x2715;</button>
    </div>`;
  document.querySelector(".main-content").prepend(banner);
  setTimeout(() => banner.remove(), 8000);
}

// Handle payment callback from Paystack redirect
(function checkPaymentCallback() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("payment") === "success") {
    // Clean URL
    window.history.replaceState({}, "", "/");
    // Refresh user data
    setTimeout(() => {
      if (isLoggedIn()) {
        loadUsageStatus();
        showPaymentSuccess("your new plan");
      }
    }, 500);
  }
})();

// ─── Folders (Paid Feature Gating) ───────────────────────────────────

function showFolderPremiumPrompt() {
  const go = confirm("Folders are a premium feature!\n\nUpgrade to Starter (GHS 30/mo) or higher to organize your conversations into folders.\n\nWould you like to view plans?");
  if (go) openPricingModal();
}

async function pinConversation(conversationId, pinned) {
  try {
    await fetch(`${API}/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ pinned }),
    });
    await loadConversations();
  } catch {
    alert("Failed to update conversation");
  }
}

// ─── File Upload in Chat ─────────────────────────────────────────────

function openFileUpload() {
  if (!isLoggedIn()) {
    requireAuth(openFileUpload);
    return;
  }

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".txt,.md,.csv,.json,.html,.htm";
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert("File size must be under 2MB");
      return;
    }

    try {
      const text = await file.text();
      const chatInput = document.getElementById("chat-input");
      chatInput.value = `[Uploaded file: ${file.name}]\n\n${text.substring(0, 10000)}${text.length > 10000 ? "\n\n... (truncated)" : ""}\n\nPlease analyze this document and provide a summary.`;
      autoResizeInput();
      updateSendButton();
      showChatScreen();
    } catch {
      alert("Failed to read file");
    }
  };
  input.click();
}

// ─── Conversation Sharing ────────────────────────────────────────────

async function shareConversation(conversationId) {
  if (!isLoggedIn()) return;

  try {
    const res = await fetch(`${API}/api/conversations/${conversationId}/share`, {
      method: "POST",
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Failed to share");
      return;
    }

    const shareUrl = `${window.location.origin}/?shared=${data.shareToken}`;
    showShareModal(shareUrl, data.shareToken, conversationId);
  } catch {
    alert("Failed to share conversation");
  }
}

function showShareModal(shareUrl, shareToken, conversationId) {
  let modal = document.getElementById("share-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.id = "share-modal";
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("active"); });
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal" style="max-width:500px;">
      <div class="modal-header">
        <h3>Share Conversation</h3>
        <button class="modal-close" onclick="document.getElementById('share-modal').classList.remove('active')">&#x2715;</button>
      </div>
      <div class="modal-body" style="padding:24px;">
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Anyone with this link can view (read-only) this conversation.</p>
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <input type="text" value="${shareUrl}" readonly id="share-url-input" style="flex:1;padding:10px 14px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:8px;color:var(--text-primary);font-size:13px;" />
          <button onclick="navigator.clipboard.writeText('${shareUrl}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)" style="background:var(--gold);color:var(--text-on-accent);border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer;">Copy</button>
        </div>
        <button onclick="revokeShare('${conversationId}')" style="background:none;border:1px solid var(--red-error-text);color:var(--red-error-text);border-radius:8px;padding:8px 16px;font-size:12px;cursor:pointer;">Revoke Sharing</button>
      </div>
    </div>`;
  modal.classList.add("active");
}

async function revokeShare(conversationId) {
  try {
    await fetch(`${API}/api/conversations/${conversationId}/share`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    document.getElementById("share-modal")?.classList.remove("active");
    alert("Share link revoked");
  } catch {
    alert("Failed to revoke share");
  }
}

// Check if loading a shared conversation
(function checkSharedConversation() {
  const params = new URLSearchParams(window.location.search);
  const sharedToken = params.get("shared");
  if (sharedToken) {
    window.history.replaceState({}, "", "/");
    loadSharedConversation(sharedToken);
  }
})();

async function loadSharedConversation(token) {
  try {
    const res = await fetch(`${API}/api/shared/${token}`);
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Shared conversation not found");
      return;
    }

    // Show in a modal
    let modal = document.getElementById("shared-view-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.className = "modal-overlay active";
      modal.id = "shared-view-modal";
      modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("active"); });
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="modal" style="max-width:800px;max-height:85vh;">
        <div class="modal-header">
          <div>
            <h3>${escapeHtml(data.title)}</h3>
            <p style="font-size:12px;color:var(--text-muted);margin:4px 0 0;">Shared by ${escapeHtml(data.authorName)} (${escapeHtml(data.authorDept || "GoG")})</p>
          </div>
          <button class="modal-close" onclick="document.getElementById('shared-view-modal').classList.remove('active')">&#x2715;</button>
        </div>
        <div class="modal-body" style="padding:16px 24px;overflow-y:auto;max-height:65vh;">
          ${data.messages.map(m => `
            <div class="message ${m.role}" style="margin-bottom:16px;">
              <div class="message-avatar">${m.role === 'user' ? 'U' : 'G'}</div>
              <div class="message-body">
                <div class="message-sender">${m.role === 'user' ? 'User' : 'AskOzzy'}</div>
                <div class="message-content">${m.role === 'user' ? escapeHtml(m.content) : renderMarkdown(m.content)}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>`;
    modal.classList.add("active");
  } catch {
    alert("Failed to load shared conversation");
  }
}

// ─── Follow-up Suggestions ───────────────────────────────────────────

async function loadFollowUpSuggestions() {
  if (!isLoggedIn() || !state.activeConversationId || state.messages.length < 2) return;

  try {
    const res = await fetch(`${API}/api/chat/suggestions/${state.activeConversationId}`, {
      headers: authHeaders(),
    });
    const data = await res.json();

    if (data.suggestions && data.suggestions.length > 0) {
      renderSuggestionPills(data.suggestions);
    }
  } catch {}
}

function renderSuggestionPills(suggestions) {
  // Remove existing pills
  const existing = document.getElementById("suggestion-pills");
  if (existing) existing.remove();

  const container = document.createElement("div");
  container.id = "suggestion-pills";
  container.className = "suggestion-pills";
  container.innerHTML = suggestions.map(s =>
    `<button class="suggestion-pill" onclick="useSuggestion(this, '${escapeHtml(s).replace(/'/g, "\\'")}')">${escapeHtml(s)}</button>`
  ).join("");

  const inputArea = document.querySelector(".input-area");
  if (inputArea) inputArea.prepend(container);
}

function useSuggestion(btn, text) {
  const input = document.getElementById("chat-input");
  input.value = text;
  autoResizeInput();
  updateSendButton();
  input.focus();
  // Remove pills after use
  const pills = document.getElementById("suggestion-pills");
  if (pills) pills.remove();
}
