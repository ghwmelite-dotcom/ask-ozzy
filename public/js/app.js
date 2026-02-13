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
  folders: [],
  collapsedFolders: {},
  memories: [],
  agents: [],
  selectedAgent: null,
  currentArtifact: null,
  webSearchEnabled: false,
  webSearchSources: [],
  language: 'en',
  voiceMode: false,
  spacesLoaded: false,
  userType: null,
};

// ─── Persona System ─────────────────────────────────────────────────
let _selectedPersona = 'gog_employee';

function selectPersona(type, btn) {
  _selectedPersona = type;
  document.querySelectorAll('.persona-option').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // Update dept label and placeholder based on persona
  const deptLabel = document.getElementById('reg-dept-label');
  const deptInput = document.getElementById('reg-dept');
  if (type === 'student') {
    if (deptLabel) deptLabel.textContent = 'School / Institution';
    if (deptInput) deptInput.placeholder = 'e.g. University of Ghana';
  } else {
    if (deptLabel) deptLabel.textContent = 'Department / MDA';
    if (deptInput) deptInput.placeholder = 'e.g. Ministry of Finance';
  }
}

function selectWelcomePersona(type, btn) {
  _selectedPersona = type;
  // Update welcome screen buttons
  document.querySelectorAll('.welcome-persona-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // Sync the registration form selector too
  document.querySelectorAll('.persona-option').forEach(b => {
    b.classList.toggle('active', b.onclick && b.outerHTML.includes(type));
  });
  // Apply persona to pre-login state
  state.userType = type;
  localStorage.setItem('askozzy_persona', type);
  applyPersonaUI();
  renderCategoryTabs();
  renderTemplateGrid();
  // Update dept label in registration form
  selectPersona(type, null);
}

function isStudent() {
  return state.userType === 'student';
}

function getPersonaTemplates() {
  if (isStudent()) return TEMPLATES.filter(t => t.studentOnly);
  return TEMPLATES; // GoG employees see ALL templates
}

function getPersonaCategories() {
  if (isStudent()) return TEMPLATE_CATEGORIES.filter(c => c.studentOnly);
  return TEMPLATE_CATEGORIES; // GoG employees see ALL categories
}

function applyPersonaUI() {
  const subtitle = document.getElementById('welcome-subtitle');
  const sidebarSub = document.getElementById('sidebar-subtitle');
  const welcomeSelector = document.getElementById('welcome-persona-selector');
  const welcomeHeading = document.querySelector('#welcome-screen h2');

  // Personalized greeting when logged in
  if (isLoggedIn() && state.user && state.user.fullName) {
    const firstName = state.user.fullName.split(' ')[0];
    if (welcomeHeading) welcomeHeading.textContent = `Welcome to AskOzzy, ${firstName}`;
  } else {
    if (welcomeHeading) welcomeHeading.textContent = 'Welcome to AskOzzy';
  }

  if (isStudent()) {
    if (subtitle) subtitle.textContent = 'Your AI study companion for academic success. Choose a template below or start a free conversation.';
    if (sidebarSub) sidebarSub.textContent = 'AI for Ghana Students';
  } else {
    if (subtitle) subtitle.textContent = 'Your private AI assistant for GoG operations. Choose a template below or start a free conversation.';
    if (sidebarSub) sidebarSub.textContent = 'AI for All GoG Staff';
  }
  // Hide welcome persona selector when logged in (persona is saved in account)
  if (welcomeSelector) {
    welcomeSelector.style.display = isLoggedIn() ? 'none' : '';
  }
}

// ─── Adinkra Symbol System ───────────────────────────────────────────

const ADINKRA = {
  // Gye Nyame — Supremacy of God → AI Intelligence
  gyeNyame: (size = 24, color = 'currentColor') => `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none"><path d="M32 8c-2 0-4 1.5-5 4l-3 8c-1 2.5-3 4-6 4h-4c-3 0-5 2-5 5s2 5 5 5h2c3 0 5 1.5 6 4l2 6c1 3 3 5 5 5h2c2 0 4-2 5-5l2-6c1-2.5 3-4 6-4h2c3 0 5-2 5-5s-2-5-5-5h-4c-3 0-5-1.5-6-4l-3-8c-1-2.5-3-4-5-4z" fill="${color}"/><circle cx="32" cy="29" r="6" fill="${color}" opacity="0.3"/></svg>`,
  // Sankofa — Learn from past → Memory
  sankofa: (size = 24, color = 'currentColor') => `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none"><path d="M42 12c-4 0-7 2-9 5l-4 7c-1 2-3 3-5 3-4 0-7 3-7 7s3 7 7 7c2 0 4-1 5-3l2-3v10c0 4 3 7 7 7s7-3 7-7V26c0-8-1-14-3-14z" fill="${color}"/><circle cx="42" cy="18" r="3" fill="${color}" opacity="0.5"/></svg>`,
  // Dwennimmen — Strength → Security
  dwennimmen: (size = 24, color = 'currentColor') => `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none"><path d="M16 16c0 8 4 14 10 16v16h4V32c6-2 10-8 10-16" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M16 16c-4 4-6 10-4 16 2 5 6 8 10 8" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M40 16c4 4 6 10 4 16-2 5-6 8-10 8" stroke="${color}" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="20" cy="16" r="3" fill="${color}"/><circle cx="36" cy="16" r="3" fill="${color}"/></svg>`,
  // Aya — Endurance → Offline mode
  aya: (size = 24, color = 'currentColor') => `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none"><line x1="32" y1="8" x2="32" y2="56" stroke="${color}" stroke-width="2.5"/><path d="M32 16l-10 6 10-2m0 0l10 6-10-2m0 6l-12 7 12-2m0 0l12 7-12-2m0 6l-10 6 10-2m0 0l10 6-10-2" stroke="${color}" stroke-width="2" stroke-linecap="round"/><circle cx="32" cy="10" r="2.5" fill="${color}"/></svg>`,
};

// ─── User Guide Data ────────────────────────────────────────────────

const GUIDE_SECTION_EMOJIS = {
  'getting-started': { emoji: '\u{1F680}', gradient: 'linear-gradient(135deg, #ff6b35, #f7c948)' },
  'chat-ai':         { emoji: '\u{1F4AC}', gradient: 'linear-gradient(135deg, #4a9eff, #6c5ce7)' },
  'smart-tools':     { emoji: '\u{1F6E0}\uFE0F', gradient: 'linear-gradient(135deg, #00b894, #00cec9)' },
  'file-media':      { emoji: '\u{1F4C1}', gradient: 'linear-gradient(135deg, #e17055, #fdcb6e)' },
  'organization':    { emoji: '\u{1F4C2}', gradient: 'linear-gradient(135deg, #a29bfe, #6c5ce7)' },
  'personalization': { emoji: '\u{2699}\uFE0F', gradient: 'linear-gradient(135deg, #fd79a8, #e84393)' },
  'languages':       { emoji: '\u{1F30D}', gradient: 'linear-gradient(135deg, #00b894, #55efc4)' },
  'vision':          { emoji: '\u{1F441}\uFE0F', gradient: 'linear-gradient(135deg, #0984e3, #74b9ff)' },
  'account-security':{ emoji: '\u{1F512}', gradient: 'linear-gradient(135deg, #636e72, #b2bec3)' },
  'citizen-bot':     { emoji: '\u{1F465}', gradient: 'linear-gradient(135deg, #006B3F, #00a86b)' },
  'shortcuts':       { emoji: '\u{2328}\uFE0F', gradient: 'linear-gradient(135deg, #2d3436, #636e72)' },
  'install-offline': { emoji: '\u{1F4E5}', gradient: 'linear-gradient(135deg, #0984e3, #00cec9)' },
};

const GUIDE_TRY_IT_ACTIONS = {
  'st-templates': { label: 'Open Templates \u2192', action: "closeGuide();openTemplateModal();" },
  'st-research':  { label: 'Try Deep Research \u2192', action: "closeGuide();openDeepResearch();" },
  'st-analysis':  { label: 'Analyze Data \u2192', action: "closeGuide();openDataAnalysis();" },
  'st-workflows': { label: 'Open Workflows \u2192', action: "closeGuide();openWorkflows();" },
  'st-meetings':  { label: 'Start Meeting \u2192', action: "closeGuide();openMeetingAssistant();" },
  'st-spaces':    { label: 'Open Spaces \u2192', action: "closeGuide();openSpaces();" },
  'gs-models':    { label: 'View Models \u2192', action: "closeGuide();document.getElementById('model-selector').focus();" },
  'as-pricing':   { label: 'View Plans \u2192', action: "closeGuide();openPricingModal();" },
  'ps-memory':    { label: 'Open Memory \u2192', action: "closeGuide();openMemoryModal();" },
  'fm-upload':    { label: 'Upload a File \u2192', action: "closeGuide();openFileUpload();" },
};

const GUIDE_TIPS = [
  'Press <kbd>Ctrl</kbd>+<kbd>K</kbd> to search all your conversations instantly.',
  'Use <kbd>Shift</kbd>+<kbd>Enter</kbd> for multi-line messages without sending.',
  'Pin your most important conversations so they always appear at the top of the sidebar.',
  'Try Deep Research mode for comprehensive reports with citations on any topic.',
  'Upload a CSV file and ask Ozzy to create charts and find trends in your data.',
  'Create custom AI agents with specialized instructions for your department.',
  'Enable Web Search to get AI responses grounded in current, real-time information.',
  'Press <kbd>Ctrl</kbd>+<kbd>N</kbd> to instantly start a new conversation.',
  'Use the Citizen Bot (bottom-right) for quick government service queries.',
  'Switch between AI models to find the best one for your task \u2014 some are faster, others more detailed.',
];

const GUIDE_SECTIONS = [
  {
    id: 'getting-started',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    title: 'Getting Started',
    description: 'Registration, sign-in, and model selection',
    features: [
      { id: 'gs-register', title: 'Create Your Account', tier: 'free', description: 'Register with your name, email, and GoG department to get your personal access code.', steps: ['Click "Sign In / Create Account" in the sidebar', 'Switch to the "Register" tab', 'Enter your full name, email, and department', 'Save your access code — it\'s shown only once!', 'You\'re now signed in and ready to go'] },
      { id: 'gs-signin', title: 'Sign In with Access Code', tier: 'free', description: 'Use your email and access code to sign in. No passwords needed — simple and secure.', steps: ['Click "Sign In / Create Account"', 'Enter your email and access code', 'If you have 2FA enabled, enter your 6-digit code', 'You\'re signed in with your conversations restored'] },
      { id: 'gs-models', title: 'Choose Your AI Model', tier: 'free', description: 'Select from multiple AI models optimized for different tasks. Higher tiers unlock more powerful models.', steps: ['Look for the model selector dropdown near the chat input', 'Free tier includes GPT-OSS 20B, Gemma 3, and Llama 3.1 8B', 'Professional tier unlocks all 11 models including Llama 3.3 70B', 'Each model has strengths — experiment to find your favorite'] },
    ]
  },
  {
    id: 'chat-ai',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    title: 'Chat & AI',
    description: 'Messaging, streaming responses, and message actions',
    features: [
      { id: 'ca-send', title: 'Send Messages', tier: 'free', description: 'Type your question or task and press Enter (or click send) to get AI-powered responses.', steps: ['Type your message in the input area at the bottom', 'Press Enter or click the send button', 'The AI responds in real-time with streaming text', 'Use Shift+Enter for new lines within your message'] },
      { id: 'ca-stream', title: 'Streaming Responses', tier: 'free', description: 'Responses stream in word-by-word for a natural feel. You can stop generation anytime.', steps: ['Responses appear progressively as they\'re generated', 'Click the stop button to halt generation early', 'Markdown formatting renders automatically (bold, code, lists)', 'Code blocks include syntax highlighting and copy buttons'] },
      { id: 'ca-actions', title: 'Message Actions', tier: 'free', description: 'Copy, regenerate, or take actions on any AI response.', steps: ['Hover over any AI message to see action buttons', 'Copy — copies the full response to clipboard', 'Regenerate — asks the AI to try again with a fresh response', 'Messages support full Markdown rendering'] },
      { id: 'ca-conversations', title: 'Conversation Management', tier: 'free', description: 'Create, rename, pin, and organize your conversations.', steps: ['Click "New Chat" or press Ctrl+N to start fresh', 'Conversations auto-save and appear in the sidebar', 'Click the pencil icon to rename a conversation', 'Right-click or long-press for more options (delete, pin, share)'] },
    ]
  },
  {
    id: 'smart-tools',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    title: 'Smart Tools',
    description: 'Templates, research, workflows, meetings, spaces, and web search',
    features: [
      { id: 'st-templates', title: 'GoG Prompt Templates', tier: 'free', description: '25+ pre-built templates for Government of Ghana operations — memos, briefs, reports, and more.', steps: ['Browse templates on the welcome screen or click "Templates"', 'Filter by category: Writing, Analysis, HR, Finance, Legal, etc.', 'Click a template to auto-fill the chat input', 'Customize the template text before sending'] },
      { id: 'st-research', title: 'Deep Research Mode', tier: 'professional', description: 'AI-powered research that synthesizes information into structured reports with citations.', steps: ['Click the Research tool pill below the input area', 'Enter your research topic or question', 'AI generates a comprehensive report with sections', 'Review findings, sources, and recommendations'] },
      { id: 'st-analysis', title: 'Data Analysis', tier: 'professional', description: 'Upload spreadsheets or paste data for AI-powered analysis with charts and insights.', steps: ['Upload a CSV/Excel file or paste tabular data', 'Ask the AI to analyze trends, summarize, or visualize', 'Get charts, statistics, and actionable insights', 'Export results or continue the analysis conversation'] },
      { id: 'st-workflows', title: 'Workflow Wizard', tier: 'professional', description: 'Multi-step guided workflows for complex GoG processes like procurement, HR actions, and policy drafts.', steps: ['Click the Workflow tool pill', 'Select a workflow category (procurement, HR, policy, etc.)', 'Follow the step-by-step wizard with guided inputs', 'AI generates complete documents based on your inputs', 'Review, edit, and export the final output'] },
      { id: 'st-meetings', title: 'Meeting Assistant', tier: 'professional', description: 'Generate agendas, take notes, and create minutes with AI assistance.', steps: ['Click the Meeting tool pill', 'Choose: create agenda, take notes, or generate minutes', 'Enter meeting details (participants, topics, decisions)', 'AI structures and formats everything professionally'] },
      { id: 'st-spaces', title: 'Collaborative Spaces', tier: 'professional', description: 'Shared workspaces where team members can collaborate on AI-powered projects together.', steps: ['Click "Spaces" in the sidebar', 'Create a new space with a name and description', 'Invite team members by email', 'All members can chat, share files, and collaborate in real-time'] },
      { id: 'st-websearch', title: 'Web Search', tier: 'professional', description: 'Enable real-time web search to ground AI responses with current information.', steps: ['Toggle the Web Search pill below the input area', 'Ask a question that needs up-to-date information', 'AI searches the web and cites sources in its response', 'Source links appear below the message for verification'] },
    ]
  },
  {
    id: 'file-media',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    title: 'File & Media',
    description: 'File upload, images, camera, voice input, and voice mode',
    features: [
      { id: 'fm-upload', title: 'File Upload & Analysis', tier: 'free', description: 'Upload documents (PDF, TXT, CSV, DOCX, PPTX) for AI analysis. Files are processed and can be queried.', steps: ['Click the paperclip icon or drag files into the chat', 'Supported: PDF, TXT, CSV, DOCX, PPTX (up to 10MB)', 'The AI reads the file content and can answer questions about it', 'Ask for summaries, key points, specific data extraction'] },
      { id: 'fm-images', title: 'Image Upload', tier: 'free', description: 'Upload images for AI vision analysis — describe, extract text, analyze content.', steps: ['Click the image icon or drag an image into chat', 'Supported: JPG, PNG, GIF, WebP', 'The AI can describe, analyze, or extract text from images', 'Combine with prompts like "What does this show?"'] },
      { id: 'fm-camera', title: 'Camera Capture', tier: 'free', description: 'Take photos directly from your device camera for instant AI analysis.', steps: ['Click the camera icon in the input area', 'Allow camera access when prompted', 'Frame your subject and click the capture button', 'The photo is sent to AI for analysis — great for documents and receipts'] },
      { id: 'fm-voice', title: 'Voice Input', tier: 'free', description: 'Speak your messages instead of typing using browser speech recognition.', steps: ['Click the microphone icon in the input area', 'Allow microphone access when prompted', 'Speak clearly — your words appear as text in the input', 'Click the mic icon again or press Enter to send'] },
      { id: 'fm-voicemode', title: 'Voice Mode', tier: 'professional', description: 'Hands-free voice conversation mode with text-to-speech responses.', steps: ['Click the Voice Mode toggle in the input area', 'Speak your question — AI responds with both text and speech', 'Supports continuous conversation without touching the screen', 'Toggle off to return to text-only mode'] },
    ]
  },
  {
    id: 'organization',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    title: 'Organization',
    description: 'Folders, pinning, search, and sharing conversations',
    features: [
      { id: 'org-folders', title: 'Conversation Folders', tier: 'free', description: 'Organize conversations into custom folders for easy access.', steps: ['Click "New Folder" in the sidebar', 'Name your folder (e.g., "Budget Reports", "HR Queries")', 'Drag conversations into folders or use the move option', 'Click folder names to expand/collapse them'] },
      { id: 'org-pin', title: 'Pin Conversations', tier: 'free', description: 'Pin important conversations to the top of your sidebar for quick access.', steps: ['Right-click or long-press a conversation', 'Select "Pin" from the context menu', 'Pinned conversations appear at the top of the sidebar', 'Unpin by right-clicking and selecting "Unpin"'] },
      { id: 'org-search', title: 'Search Conversations', tier: 'free', description: 'Search across all your messages and conversations instantly.', steps: ['Press Ctrl+K or click the search icon', 'Type your search query', 'Results show matching messages with conversation context', 'Click a result to jump directly to that conversation'] },
      { id: 'org-share', title: 'Share Conversations', tier: 'free', description: 'Generate a read-only link to share any conversation with colleagues.', steps: ['Open the conversation you want to share', 'Click the share icon in the conversation header', 'A unique read-only link is generated', 'Copy and send the link — recipients can view without logging in', 'Revoke sharing anytime from the share dialog'] },
    ]
  },
  {
    id: 'personalization',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    title: 'AI Personalization',
    description: 'Memory, custom agents, and artifacts',
    features: [
      { id: 'ps-memory', title: 'AI Memory', tier: 'professional', description: 'Teach AI about your preferences, projects, and context. It remembers across conversations.', steps: ['Click "Memory" in the sidebar footer', 'Add memories like "I work in the Finance department"', 'AI uses memories to personalize all future responses', 'Delete or edit memories anytime from the Memory modal'] },
      { id: 'ps-agents', title: 'Custom AI Agents', tier: 'professional', description: 'Create specialized AI agents with custom instructions for specific tasks or roles.', steps: ['Click "Agents" in the sidebar or tool area', 'Create a new agent with a name and description', 'Write custom instructions (e.g., "You are a legal advisor for GoG")', 'Select the agent before chatting to activate its persona', 'Switch between agents or use the default assistant'] },
      { id: 'ps-artifacts', title: 'Artifacts', tier: 'professional', description: 'AI generates rich artifacts — documents, code, diagrams — that render in a side panel.', steps: ['Ask the AI to create a document, report, or code snippet', 'Artifacts appear in a dedicated panel beside the chat', 'Edit artifacts directly in the panel', 'Download or copy artifacts for use in other tools'] },
    ]
  },
  {
    id: 'languages',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    title: 'Languages',
    description: '7 Ghanaian and international languages with text-to-speech',
    features: [
      { id: 'lang-multi', title: 'Multilingual Support', tier: 'free', description: 'Chat in English, Twi, Ga, Ewe, Dagbani, Hausa, or French. The interface and AI adapt to your language.', steps: ['Click the language selector (globe icon) in the input area', 'Choose from: English, Twi, Ga, Ewe, Dagbani, Hausa, French', 'The AI responds in your selected language', 'Interface labels also translate where available'] },
      { id: 'lang-tts', title: 'Text-to-Speech', tier: 'free', description: 'Listen to AI responses read aloud. Useful for accessibility and hands-free use.', steps: ['Click the speaker icon on any AI response', 'The message is read aloud using browser TTS', 'Works best with English; Ghanaian languages use approximation', 'Adjust system volume to control speech volume'] },
    ]
  },
  {
    id: 'vision',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    title: 'Vision & Image AI',
    description: '4 vision modes: describe, OCR, form data extraction, receipt scanning',
    features: [
      { id: 'vis-describe', title: 'Image Description', tier: 'free', description: 'Upload an image and get a detailed AI description of its contents.', steps: ['Upload or capture an image', 'Select "Describe" mode (or just ask "What is this?")', 'AI provides a detailed description of the image contents', 'Useful for accessibility, documentation, and content analysis'] },
      { id: 'vis-ocr', title: 'OCR Text Extraction', tier: 'free', description: 'Extract printed or handwritten text from images with AI-powered OCR.', steps: ['Upload a photo of a document, sign, or handwritten text', 'Select "Extract Text" mode', 'AI reads and outputs all visible text from the image', 'Copy the extracted text for use in other documents'] },
      { id: 'vis-form', title: 'Form Data Extraction', tier: 'professional', description: 'Extract structured data from forms — applications, surveys, registration documents.', steps: ['Take a photo or upload a scan of a filled form', 'Select "Form Data" mode', 'AI identifies fields and values in a structured format', 'Results can be used to populate digital records'] },
      { id: 'vis-receipt', title: 'Receipt Scanning', tier: 'professional', description: 'Scan receipts and invoices to extract amounts, dates, vendors, and line items.', steps: ['Photograph or upload a receipt/invoice', 'Select "Receipt" mode', 'AI extracts: vendor, date, items, amounts, total, tax', 'Great for expense reporting and record-keeping'] },
    ]
  },
  {
    id: 'account-security',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    title: 'Account & Security',
    description: '2FA, sessions, pricing tiers, and affiliate program',
    features: [
      { id: 'as-2fa', title: 'Two-Factor Authentication', tier: 'free', description: 'Add an extra layer of security with TOTP-based 2FA using any authenticator app.', steps: ['Click "2FA Security" in the sidebar footer', 'Scan the QR code with Google Authenticator or similar', 'Enter the 6-digit code to verify setup', 'On future logins, you\'ll enter the code after your access code'] },
      { id: 'as-sessions', title: 'Session Management', tier: 'free', description: 'View and revoke active sessions for security. Revoke all sessions to sign out everywhere.', steps: ['Click "Revoke Sessions" in the sidebar footer', 'Confirm to sign out all devices except your current one', 'Useful if you suspect unauthorized access', 'You\'ll need to sign in again on other devices'] },
      { id: 'as-pricing', title: 'Subscription Tiers', tier: 'free', description: 'Choose from Free, Professional (GHS 60), or Enterprise (GHS 100) plans.', steps: ['Click your tier badge in the sidebar footer', 'Compare features across all 3 tiers', 'Click "Upgrade" on your desired plan', 'Pay via Mobile Money (MoMo) or card through Paystack', 'Your tier activates immediately after payment'] },
      { id: 'as-affiliate', title: 'Affiliate Program', tier: 'free', description: 'Earn GHS by referring colleagues. Share your referral link and earn commissions.', steps: ['Click "Earn GHS" in the sidebar footer', 'Copy your unique referral link', 'Share with colleagues — earn when they subscribe', 'Track your referrals and earnings in the affiliate dashboard'] },
    ]
  },
  {
    id: 'citizen-bot',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    title: 'Citizen Bot',
    description: 'Public-facing widget with quick actions and multilingual support',
    features: [
      { id: 'cb-widget', title: 'Citizen Bot Widget', tier: 'free', description: 'A floating chat widget for citizens to ask government-related questions without logging in.', steps: ['The Citizen Bot appears as a floating button on the bottom-right', 'Click to open the chat widget', 'Citizens can ask about government services, forms, procedures', 'Responses are AI-powered with GoG knowledge'] },
      { id: 'cb-quick', title: 'Quick Actions', tier: 'free', description: 'Pre-built quick action buttons for common citizen queries.', steps: ['Open the Citizen Bot widget', 'Quick action buttons appear at the bottom', 'Tap any action to get instant, pre-formatted responses', 'Actions include: find forms, office hours, service requirements'] },
      { id: 'cb-lang', title: 'Multilingual Citizen Support', tier: 'free', description: 'Citizen Bot supports all 7 languages so citizens can interact in their preferred language.', steps: ['Open the Citizen Bot widget', 'Select your preferred language from the language picker', 'Chat in Twi, Ga, Ewe, Dagbani, Hausa, French, or English', 'Responses come in the selected language'] },
    ]
  },
  {
    id: 'shortcuts',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="8" x2="6" y2="8"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="18" y1="8" x2="18" y2="8"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="6" y1="16" x2="10" y2="16"/><line x1="14" y1="16" x2="18" y2="16"/></svg>',
    title: 'Keyboard Shortcuts',
    description: 'Quick keyboard shortcuts for power users',
    features: [] // Rendered as special table instead
  },
  {
    id: 'install-offline',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    title: 'Install & Offline',
    description: 'Install as PWA and use offline',
    features: [
      { id: 'io-pwa', title: 'Install as App (PWA)', tier: 'free', description: 'Install AskOzzy on your device for a native app-like experience with faster loading.', steps: ['Look for the "Install" prompt in your browser\'s address bar', 'On Chrome: click the install icon (or Menu > Install App)', 'On Safari iOS: tap Share > Add to Home Screen', 'AskOzzy launches as a standalone app with its own icon'] },
      { id: 'io-offline', title: 'Offline Mode', tier: 'free', description: 'Continue using AskOzzy even without internet. Messages queue and sync when you\'re back online.', steps: ['Install the PWA for the best offline experience', 'When offline, you can still browse cached conversations', 'New messages queue locally using the service worker', 'When connectivity returns, queued messages send automatically'] },
    ]
  },
];

// ─── Initialization ──────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  renderTemplateGrid();
  renderCategoryTabs();
  updateSidebarFooter();
  updateUsageBadge(null); // hide until loaded

  // Feature 2: Referral landing overlay for ?ref=CODE visitors
  checkReferralLanding();

  // Pre-fill referral code if present in URL
  const refParams = new URLSearchParams(window.location.search);
  const refCode = refParams.get('ref');
  if (refCode) {
    const regRefInput = document.getElementById('reg-referral');
    if (regRefInput) regRefInput.value = refCode;
  }

  // Restore persona choice for pre-login visitors
  const savedPersona = localStorage.getItem('askozzy_persona');
  if (savedPersona) {
    _selectedPersona = savedPersona;
    state.userType = savedPersona;
    applyPersonaUI();
    renderTemplateGrid();
    renderCategoryTabs();
    // Sync welcome selector buttons
    document.querySelectorAll('.welcome-persona-btn').forEach(b => {
      b.classList.toggle('active', b.outerHTML.includes(savedPersona));
    });
  }

  if (state.token && state.user) {
    state.userType = state.user.userType || 'gog_employee';
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
  // Show passkey login button if WebAuthn is supported
  const passkeyBtn = document.getElementById("passkey-login-btn");
  if (passkeyBtn) passkeyBtn.style.display = window.PublicKeyCredential ? "" : "none";
  // Focus the first input
  setTimeout(() => {
    const visible = document.getElementById("login-form").classList.contains("hidden")
      ? document.getElementById("reg-name")
      : document.getElementById("login-email");
    visible.focus();
  }, 100);
}

function closeAuthModal() {
  // Reset TOTP setup step UI
  const totpSetup = document.getElementById("totp-setup-step");
  if (totpSetup) totpSetup.classList.add("hidden");
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


// ─── TOTP Setup (New Registration Flow) ─────────────────────────────

let _pendingTOTPEmail = null;

function showTOTPSetup(totpUri, totpSecret, recoveryCode, email) {
  _pendingTOTPEmail = email;
  document.getElementById("auth-error").classList.remove("visible");
  document.getElementById("login-form").classList.add("hidden");
  document.getElementById("register-form").classList.add("hidden");
  const authToggle = document.querySelector(".auth-toggle");
  if (authToggle) authToggle.style.display = "none";
  const privacyBanner = document.querySelector("#auth-modal .privacy-banner");
  if (privacyBanner) privacyBanner.style.display = "none";

  document.getElementById("totp-setup-step").classList.remove("hidden");
  document.getElementById("totp-qr-img").src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(totpUri)}`;
  document.getElementById("totp-manual-secret").textContent = totpSecret;
  document.getElementById("recovery-code-value").textContent = recoveryCode;
  document.getElementById("totp-setup-error").textContent = "";
  document.getElementById("totp-setup-code").value = "";
  document.getElementById("auth-modal-title").textContent = "Set Up Authenticator";
}

function copyRecoveryCode() {
  const code = document.getElementById("recovery-code-value").textContent;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.getElementById("btn-copy-recovery");
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy"; }, 2000);
  });
}

async function verifyTOTPSetup() {
  const code = document.getElementById("totp-setup-code").value.trim();
  const errEl = document.getElementById("totp-setup-error");
  const btn = document.getElementById("btn-verify-totp-setup");

  if (code.length !== 6 || !/^\d{6}$/.test(code)) {
    errEl.textContent = "Enter a 6-digit code from your authenticator app";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Verifying...";
  errEl.textContent = "";

  try {
    const res = await fetch(`${API}/api/auth/register/verify-totp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: _pendingTOTPEmail, code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Verification failed");

    state.token = data.token;
    state.user = data.user;
    state.userType = data.user.userType || 'gog_employee';
    localStorage.setItem("askozzy_token", data.token);
    localStorage.setItem("askozzy_user", JSON.stringify(state.user));

    // Clean up and redirect
    document.getElementById("totp-setup-step").classList.add("hidden");
    document.getElementById("login-form").classList.remove("hidden");
    document.getElementById("register-form").classList.add("hidden");
    const authToggle = document.querySelector(".auth-toggle");
    if (authToggle) authToggle.style.display = "";
    const privacyBanner = document.querySelector("#auth-modal .privacy-banner");
    if (privacyBanner) privacyBanner.style.display = "";
    document.getElementById("auth-modal-title").textContent = "Sign in to AskOzzy";

    document.getElementById("auth-modal").classList.remove("active");
    _pendingTOTPEmail = null;
    onAuthenticated();
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Verify & Complete Registration";
  }
}


// ─── Passkey (WebAuthn) Functions ────────────────────────────────────

async function loginWithPasskey() {
  const email = document.getElementById("login-email").value;
  if (!email) {
    showAuthError("Please enter your email first");
    return;
  }

  try {
    // Get login options
    const optRes = await fetch(`${API}/api/auth/webauthn/login-options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const options = await optRes.json();
    if (!optRes.ok) throw new Error(options.error || "Failed to get passkey options");

    // Convert base64url to ArrayBuffer
    const challenge = base64urlToBuffer(options.challenge);
    const allowCredentials = options.allowCredentials.map(c => ({
      type: c.type,
      id: base64urlToBuffer(c.id),
    }));

    // Call WebAuthn API
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: options.rpId,
        allowCredentials,
        userVerification: options.userVerification,
        timeout: options.timeout,
      },
    });

    // Send assertion to server
    const completeRes = await fetch(`${API}/api/auth/webauthn/login-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        credentialId: bufferToBase64url(assertion.rawId),
        authenticatorData: bufferToBase64url(assertion.response.authenticatorData),
        clientDataJSON: bufferToBase64url(assertion.response.clientDataJSON),
        signature: bufferToBase64url(assertion.response.signature),
      }),
    });
    const data = await completeRes.json();
    if (!completeRes.ok) throw new Error(data.error || "Passkey login failed");

    state.token = data.token;
    state.user = data.user;
    state.userType = data.user.userType || 'gog_employee';
    localStorage.setItem("askozzy_token", data.token);
    localStorage.setItem("askozzy_user", JSON.stringify(state.user));
    closeAuthModal();
    onAuthenticated();
  } catch (err) {
    if (err.name === "NotAllowedError") return; // User cancelled
    showAuthError(err.message || "Passkey login failed");
  }
}

async function addPasskey() {
  if (!isLoggedIn()) return;

  try {
    const optRes = await fetch(`${API}/api/auth/webauthn/register-options`, {
      method: "POST",
      headers: authHeaders(),
    });
    const options = await optRes.json();
    if (!optRes.ok) throw new Error(options.error || "Failed to get registration options");

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: base64urlToBuffer(options.challenge),
        rp: options.rp,
        user: {
          id: base64urlToBuffer(options.user.id),
          name: options.user.name,
          displayName: options.user.displayName,
        },
        pubKeyCredParams: options.pubKeyCredParams,
        authenticatorSelection: options.authenticatorSelection,
        timeout: options.timeout,
        excludeCredentials: (options.excludeCredentials || []).map(c => ({
          type: c.type,
          id: base64urlToBuffer(c.id),
        })),
      },
    });

    const completeRes = await fetch(`${API}/api/auth/webauthn/register-complete`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        credentialId: bufferToBase64url(credential.rawId),
        attestationObject: bufferToBase64url(credential.response.attestationObject),
        clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
      }),
    });
    const data = await completeRes.json();
    if (!completeRes.ok) throw new Error(data.error || "Failed to register passkey");

    alert("Passkey registered successfully! You can now sign in with your fingerprint or Face ID.");
  } catch (err) {
    if (err.name === "NotAllowedError") return;
    alert("Failed to add passkey: " + (err.message || "Unknown error"));
  }
}

// ─── Base64url <-> ArrayBuffer utilities ────────────────────────────

function base64urlToBuffer(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// Runs after successful login or register
function onAuthenticated() {
  applyPersonaUI();
  renderTemplateGrid();
  renderCategoryTabs();
  updateSidebarFooter();
  loadConversations();
  loadUsageStatus();
  loadFolders();
  loadAnnouncements();
  loadMemories();
  loadAgents();

  // Feature 5: Load streak data for sidebar badge
  loadStreakData();

  // Feature 4: Enhanced onboarding tour for new users
  startEnhancedOnboarding();

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
  const credential = document.getElementById("login-access-code").value;
  const btn = e.target.querySelector(".btn-auth");
  btn.disabled = true;
  btn.textContent = "Signing in...";

  try {
    // Auto-detect: 6-digit numeric = TOTP, otherwise accessCode
    const isTotp = /^\d{6}$/.test(credential.trim());
    const body = isTotp
      ? { email, totpCode: credential.trim() }
      : { email, accessCode: credential };

    const res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");

    state.token = data.token;
    state.user = data.user;
    state.user.trialExpiresAt = data.trialExpiresAt || data.user.trialExpiresAt || null;
    state.userType = data.user.userType || 'gog_employee';
    localStorage.setItem("askozzy_token", data.token);
    localStorage.setItem("askozzy_user", JSON.stringify(state.user));
    closeAuthModal();
    onAuthenticated();

  } catch (err) {
    showAuthError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign In";
  }
});

// Auto-generate a system referral code for users who don't have one from a colleague
function autoGenerateReferralCode() {
  const input = document.getElementById("reg-referral");
  const hint = document.getElementById("referral-hint");
  const btn = document.getElementById("btn-auto-referral");
  const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const code = `OZZY-SYSTEM-${suffix}`;
  input.value = code;
  input.readOnly = true;
  input.style.opacity = "0.75";
  if (hint) {
    hint.textContent = "Auto-generated code applied. You can still replace it with a colleague's code.";
    hint.style.color = "var(--flag-green, #006B3F)";
  }
  if (btn) {
    btn.textContent = "Clear";
    btn.onclick = function () {
      input.value = "";
      input.readOnly = false;
      input.style.opacity = "1";
      input.focus();
      if (hint) {
        hint.textContent = 'Enter a referral code from a colleague, or click "Auto-fill" if you don\'t have one.';
        hint.style.color = "var(--text-muted)";
      }
      btn.textContent = "Don't have one? Auto-fill";
      btn.onclick = autoGenerateReferralCode;
    };
  }
}

document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fullName = document.getElementById("reg-name").value;
  const email = document.getElementById("reg-email").value;
  const department = document.getElementById("reg-dept").value;
  const referralInput = document.getElementById("reg-referral");
  const referralCode = referralInput.value.trim();

  // Validate referral code is filled
  if (!referralCode) {
    referralInput.focus();
    showAuthError("Referral code is required. Click \"Auto-fill\" if you don't have one from a colleague.");
    return;
  }

  const btn = e.target.querySelector(".btn-auth");
  btn.disabled = true;
  btn.textContent = "Creating account...";

  try {
    const res = await fetch(`${API}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, fullName, department, referralCode, userType: _selectedPersona }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");

    showTOTPSetup(data.totpUri, data.totpSecret, data.recoveryCode, data.email);
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
  state.userType = null;
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
    const tierName = { free: "Free", professional: "Professional", enterprise: "Enterprise" }[tier] || "Free";

    footer.innerHTML = `
      <div class="user-info">
        <div class="user-avatar">${initials}</div>
        <div>
          <div class="user-name">${escapeHtml(state.user.fullName)}</div>
          <div class="user-dept">${escapeHtml(state.user.department || (isStudent() ? "Student" : "GoG Operations"))}</div>
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
      <div id="streak-badge-container"></div>
      <div class="sidebar-links">
        <button class="sidebar-link-btn" onclick="openUserDashboard()">Dashboard</button>
        <button class="sidebar-link-btn" onclick="openProductivityDashboard()">Productivity</button>
        <button class="sidebar-link-btn" onclick="openMemoryModal()">🧠 Memory</button>
        <button class="sidebar-link-btn" onclick="openSecuritySettings()">Security</button>
        <button class="sidebar-link-btn" onclick="revokeAllSessions()">Revoke Sessions</button>
        <button class="sidebar-link-btn" onclick="openGuide()">User Guide</button>
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
      </div>
      <div class="sidebar-links" style="margin-top:8px;">
        <button class="sidebar-link-btn" onclick="openGuide()">User Guide</button>
      </div>`;
  }
  footer.innerHTML += `<div class="ghana-pride-badge"><div class="ghana-pride-flag"></div><span>Made with pride in Ghana</span></div>`;
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

  const isPaid = state.user && state.user.tier && state.user.tier !== "free";

  // Folders section (always visible for paid users)
  if (isPaid) {
    html += `<div class="folder-section">
      <div class="folder-header">
        <div class="section-label">Folders</div>
        <button class="folder-add-btn" onclick="createFolder()" title="New folder">+</button>
      </div>`;
    if (folders.length === 0) {
      html += `<div style="padding:8px 16px;font-size:11px;color:var(--text-muted);text-align:center;">No folders yet. Click + to create one.</div>`;
    }
    for (const folder of folders) {
      const folderConvos = state.conversations.filter(c => c.folder_id === folder.id);
      const isOpen = !state.collapsedFolders || !state.collapsedFolders[folder.id];
      html += `<div class="folder-item" onclick="toggleFolderCollapse('${folder.id}')">
        <span class="folder-icon">${isOpen ? "📂" : "📁"}</span> ${escapeHtml(folder.name)} <span style="font-size:10px;color:var(--text-muted);">(${folderConvos.length})</span>
        <button class="folder-delete" onclick="event.stopPropagation();deleteFolder('${folder.id}')" title="Delete folder">×</button>
      </div>`;
      if (isOpen) {
        html += folderConvos.map(c => renderConvoItem(c, true)).join("");
      }
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
  html += unfiled.map(c => renderConvoItem(c)).join("");

  container.innerHTML = html;
}

function renderConvoItem(c, inFolder) {
  const isPaid = state.user && state.user.tier && state.user.tier !== "free";
  return `
    <div class="conversation-item ${c.id === state.activeConversationId ? "active" : ""} ${c.pinned ? "pinned" : ""}"
         onclick="openConversation('${c.id}')" oncontextmenu="showConvoContextMenu(event,'${c.id}',${!!c.pinned},${c.folder_id ? `'${c.folder_id}'` : 'null'})" ${inFolder ? 'style="padding-left:28px;"' : ""}>
      <span class="convo-icon">${c.pinned ? "📌" : "💬"}</span>
      <span class="convo-title">${escapeHtml(c.title)}</span>
      <div class="convo-actions">
        ${isPaid ? `<button class="convo-action-btn" onclick="event.stopPropagation();showMoveToFolderMenu(event,'${c.id}')" title="Move to folder">📁</button>` : ""}
        <button class="convo-action-btn" onclick="event.stopPropagation();togglePin('${c.id}')" title="${c.pinned ? 'Unpin' : 'Pin'}">${c.pinned ? "📌" : "📍"}</button>
        <button class="convo-action-btn convo-delete" onclick="event.stopPropagation();deleteConversation('${c.id}')" title="Delete">🗑</button>
      </div>
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
        agentId: state.selectedAgent || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create conversation");

    state.activeConversationId = data.id;
    state.messages = [];
    await loadConversations();
    showChatScreen();

    // Auto-close sidebar on mobile
    if (window.innerWidth <= 768) {
      document.getElementById("sidebar").classList.add("collapsed");
      const backdrop = document.getElementById("sidebar-backdrop");
      if (backdrop) backdrop.classList.remove("active");
    }

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

  // Auto-close sidebar on mobile after selecting a conversation
  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.add("collapsed");
    const backdrop = document.getElementById("sidebar-backdrop");
    if (backdrop) backdrop.classList.remove("active");
  }

  // Restore agent selection from conversation data
  const convo = state.conversations.find(c => c.id === id);
  if (convo && convo.agent_id) {
    state.selectedAgent = convo.agent_id;
    renderAgentSelector();
  }

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
        ${msg.imageUrl ? `<div class="chat-image"><img src="${msg.imageUrl}" alt="Uploaded image" /></div>` : ""}
        <div class="message-content">${msg.role === "user" ? escapeHtml(msg.content) : renderMarkdownWithCitations(msg.content, msg.webSources)}</div>
        ${msg.webSources && msg.webSources.length > 0 ? renderSourcesFooter(msg.webSources) : ""}
        <div class="msg-actions">
          ${msg.role === "assistant" ? `<button class="msg-action-btn" data-speak="${i}" onclick="speakMessage(${i})" title="Listen to response"><span class="msg-action-icon">&#x1F50A;</span> Speak</button>` : ""}
          <button class="msg-action-btn" onclick="copyMessageText(${i})" title="Copy text">
            <span class="msg-action-icon">&#x2398;</span> Copy
          </button>
          ${msg.role === "assistant" ? `
          <button class="msg-action-btn" onclick="downloadMessageTxt(${i})" title="Download as text file">
            <span class="msg-action-icon">&#x1F4C4;</span> .txt
          </button>
          <button class="msg-action-btn" onclick="downloadMessageDoc(${i})" title="Download as formatted Word document with GoG letterhead">
            <span class="msg-action-icon">&#x1F4DD;</span> .docx
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

function renderMarkdownWithCitations(content, sources) {
  let html = renderMarkdown(content);
  if (sources && sources.length > 0) {
    // Replace [1], [2] etc with clickable citation links
    html = html.replace(/\[(\d+)\]/g, (match, num) => {
      const idx = parseInt(num) - 1;
      if (idx >= 0 && idx < sources.length) {
        return `<a href="${escapeHtml(sources[idx].url)}" target="_blank" rel="noopener" class="citation-ref" title="${escapeHtml(sources[idx].title)}">[${num}]</a>`;
      }
      return match;
    });
  }
  return html;
}

function renderSourcesFooter(sources) {
  if (!sources || sources.length === 0) return "";
  return `<div class="sources-footer">
    <div class="sources-label">Sources</div>
    <div class="sources-list">
      ${sources.map((s, i) => {
        const domain = (() => { try { return new URL(s.url).hostname.replace('www.', ''); } catch { return s.url; } })();
        return `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" class="source-card">
          <img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16" alt="" class="source-favicon" />
          <span class="source-title">${escapeHtml(s.title.substring(0, 60))}</span>
          <span class="source-domain">${escapeHtml(domain)}</span>
        </a>`;
      }).join("")}
    </div>
  </div>`;
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
          agentId: state.selectedAgent || null,
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
        agentId: state.selectedAgent,
        webSearch: state.webSearchEnabled || message.startsWith("@web "),
        language: state.language,
      }),
    });
    state.webSearchSources = [];

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
    let currentEvent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
          continue;
        }
        if (line.startsWith("data: ") && !line.includes("[DONE]")) {
          try {
            if (currentEvent === "sources") {
              state.webSearchSources = JSON.parse(line.slice(6));
              currentEvent = "";
              continue;
            }
            // Feature 6: Handle follow-up suggestions from SSE
            if (currentEvent === "suggestions") {
              const suggestions = JSON.parse(line.slice(6));
              if (Array.isArray(suggestions) && suggestions.length > 0) {
                renderFollowUpSuggestions(suggestions);
              }
              currentEvent = "";
              continue;
            }
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
          currentEvent = "";
        }
      }
    }

    // Attach web search sources to the message
    if (state.webSearchSources.length > 0) {
      state.messages[state.messages.length - 1].webSources = state.webSearchSources;
    }
    renderMessages();
    await loadConversations();
    loadUsageStatus(); // refresh usage counter
    checkUpgradeNudge(); // Feature 1: Smart upgrade nudge after each message

    // Check for artifacts
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      const artifact = detectArtifact(lastMsg.content);
      if (artifact) {
        // Add "Open in Canvas" button to the message
        const msgEls = document.querySelectorAll('.message.assistant');
        const lastMsgEl = msgEls[msgEls.length - 1];
        if (lastMsgEl) {
          const btn = document.createElement('button');
          btn.className = 'artifact-open-btn';
          btn.innerHTML = '\uD83D\uDCC4 Open in Canvas';
          btn.onclick = () => openArtifactPanel(artifact);
          lastMsgEl.appendChild(btn);
        }
      }

      // Cache the completed response for offline use via service worker
      if (fullText && navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "CACHE_RESPONSE",
          prompt: message,
          response: fullText,
        });
      }
    }
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
      <div class="typing-adinkra">${ADINKRA.gyeNyame(28, 'var(--gold)')}</div>
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

// ─── DOCX Generation with GoG Templates ─────────────────────────────

const GOG_DOCX_STYLES = {
  default: {
    document: {
      run: { font: "Calibri", size: 24 },
      paragraph: { spacing: { line: 276 } },
    },
    heading1: {
      run: { font: "Calibri", size: 36, bold: true, color: "006B3F" },
      paragraph: { spacing: { before: 240, after: 120 } },
    },
    heading2: {
      run: { font: "Calibri", size: 32, bold: true, color: "006B3F" },
      paragraph: { spacing: { before: 200, after: 100 } },
    },
    heading3: {
      run: { font: "Calibri", size: 28, bold: true, color: "333333" },
      paragraph: { spacing: { before: 160, after: 80 } },
    },
  },
};

function detectDocumentType(content) {
  if (/CABINET\s+MEMO/i.test(content)) return 'cabinet_memo';
  if (/MEMORANDUM|MEMO\b/i.test(content)) return 'memo';
  if (/BRIEFING\s+NOTE/i.test(content)) return 'brief';
  if (/MINUTES\s+OF|MEETING\s+MINUTES/i.test(content)) return 'minutes';
  if (/Dear\s+(?:Sir|Madam|Hon|Dr|Mr|Mrs|Ms)/i.test(content)) return 'letter';
  if (/(?:ANNUAL|QUARTERLY|PROGRESS)\s+REPORT|REPORT\s+ON/i.test(content)) return 'report';
  return 'general';
}

function parseInlineFormatting(text) {
  const runs = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) runs.push(new docx.TextRun({ text: text.slice(lastIndex, match.index) }));
    if (match[2]) runs.push(new docx.TextRun({ text: match[2], bold: true }));
    else if (match[3]) runs.push(new docx.TextRun({ text: match[3], italics: true }));
    else if (match[4]) runs.push(new docx.TextRun({ text: match[4], font: "Consolas", size: 20 }));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) runs.push(new docx.TextRun({ text: text.slice(lastIndex) }));
  if (runs.length === 0) runs.push(new docx.TextRun({ text: text }));
  return runs;
}

function buildDocxTable(lines) {
  const maxCols = Math.max(...lines.map(l => l.split('|').filter(c => c.trim()).length));
  const rows = lines.map((line, rowIdx) => {
    let cells = line.split('|').filter(c => c.trim());
    while (cells.length < maxCols) cells.push('');
    return new docx.TableRow({
      children: cells.map(c => new docx.TableCell({
        children: [new docx.Paragraph({ children: parseInlineFormatting(c.trim()) })],
        shading: rowIdx === 0 ? { fill: "F0F0F0", type: docx.ShadingType.SOLID } : undefined,
      }))
    });
  });
  return new docx.Table({ rows, width: { size: 100, type: docx.WidthType.PERCENTAGE } });
}

function markdownToDocxElements(content) {
  const elements = [];
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      let code = ''; i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { code += lines[i] + '\n'; i++; }
      if (i < lines.length) i++;
      elements.push(new docx.Paragraph({
        children: [new docx.TextRun({ text: code.trimEnd(), font: "Consolas", size: 20 })],
        shading: { fill: "F5F5F5", type: docx.ShadingType.SOLID },
        spacing: { before: 120, after: 120 },
      }));
      continue;
    }
    if (line.startsWith('### ')) { elements.push(new docx.Paragraph({ children: parseInlineFormatting(line.slice(4)), heading: docx.HeadingLevel.HEADING_3 })); i++; continue; }
    if (line.startsWith('## ')) { elements.push(new docx.Paragraph({ children: parseInlineFormatting(line.slice(3)), heading: docx.HeadingLevel.HEADING_2 })); i++; continue; }
    if (line.startsWith('# ')) { elements.push(new docx.Paragraph({ children: parseInlineFormatting(line.slice(2)), heading: docx.HeadingLevel.HEADING_1 })); i++; continue; }
    if (line.trim() === '---' || line.trim() === '***') { elements.push(new docx.Paragraph({ children: [], border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: "CCCCCC" } }, spacing: { before: 120, after: 120 } })); i++; continue; }
    if (/^[\-\*] /.test(line)) { elements.push(new docx.Paragraph({ children: parseInlineFormatting(line.replace(/^[\-\*] /, '')), bullet: { level: 0 }, spacing: { after: 60 } })); i++; continue; }
    if (/^\s{2,}[\-\*] /.test(line)) { elements.push(new docx.Paragraph({ children: parseInlineFormatting(line.replace(/^\s+[\-\*] /, '')), bullet: { level: 1 }, spacing: { after: 60 } })); i++; continue; }
    if (/^\d+\.\s/.test(line)) { elements.push(new docx.Paragraph({ children: parseInlineFormatting(line.replace(/^\d+\.\s/, '')), numbering: { reference: "default-numbering", level: 0 }, spacing: { after: 60 } })); i++; continue; }
    if (line.startsWith('> ')) { elements.push(new docx.Paragraph({ children: parseInlineFormatting(line.slice(2)), indent: { left: 720 }, border: { left: { style: docx.BorderStyle.SINGLE, size: 6, color: "006B3F" } }, spacing: { before: 60, after: 60 } })); i++; continue; }
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        if (!/^\|[\s\-:|]+\|$/.test(lines[i].trim())) tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 1) { elements.push(buildDocxTable(tableLines)); elements.push(new docx.Paragraph({ children: [] })); }
      continue;
    }
    if (line.trim() === '') { elements.push(new docx.Paragraph({ children: [], spacing: { after: 60 } })); i++; continue; }
    elements.push(new docx.Paragraph({ children: parseInlineFormatting(line), spacing: { after: 120 } }));
    i++;
  }
  return elements;
}

function createGoGHeader(docType) {
  const department = (state.user && state.user.department) || 'Government of Ghana';
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const children = [
    new docx.Paragraph({ children: [new docx.TextRun({ text: "REPUBLIC OF GHANA", bold: true, size: 28, font: "Calibri", color: "006B3F" })], alignment: docx.AlignmentType.CENTER, spacing: { after: 60 } }),
    new docx.Paragraph({ children: [new docx.TextRun({ text: "\u2605", size: 48, color: "D4AF37" })], alignment: docx.AlignmentType.CENTER, spacing: { after: 60 } }),
    new docx.Paragraph({ children: [new docx.TextRun({ text: department.toUpperCase(), bold: true, size: 22, font: "Calibri" })], alignment: docx.AlignmentType.CENTER, spacing: { after: 120 } }),
  ];
  if (['memo', 'cabinet_memo', 'letter', 'brief'].includes(docType)) {
    children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: "Date: " + date, size: 20, color: "333333" })], alignment: docx.AlignmentType.RIGHT, spacing: { after: 40 } }));
  }
  children.push(new docx.Paragraph({ children: [], border: { bottom: { style: docx.BorderStyle.DOUBLE, size: 6, color: "006B3F" } }, spacing: { after: 200 } }));
  return new docx.Header({ children });
}

function createGoGFooter() {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return new docx.Footer({ children: [
    new docx.Paragraph({ children: [], border: { top: { style: docx.BorderStyle.SINGLE, size: 4, color: "006B3F" } }, spacing: { before: 100 } }),
    new docx.Paragraph({
      children: [
        new docx.TextRun({ text: "Generated by AskOzzy", size: 16, color: "999999", font: "Calibri" }),
        new docx.TextRun({ text: "    |    ", size: 16, color: "999999" }),
        new docx.TextRun({ text: date, size: 16, color: "999999", font: "Calibri" }),
        new docx.TextRun({ text: "    |    Page ", size: 16, color: "999999" }),
        new docx.TextRun({ children: [docx.PageNumber.CURRENT], size: 16, color: "999999" }),
        new docx.TextRun({ text: " of ", size: 16, color: "999999" }),
        new docx.TextRun({ children: [docx.PageNumber.TOTAL_PAGES], size: 16, color: "999999" }),
      ],
      alignment: docx.AlignmentType.CENTER,
    }),
  ]});
}

function _buildGoGDocx(content, title) {
  const docType = detectDocumentType(content);
  return new docx.Document({
    creator: "AskOzzy - GoG AI Assistant",
    title: title || "AskOzzy Document",
    numbering: { config: [{ reference: "default-numbering", levels: [{ level: 0, format: docx.LevelFormat.DECIMAL, text: "%1.", alignment: docx.AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
    styles: GOG_DOCX_STYLES,
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 } } },
      headers: { default: createGoGHeader(docType) },
      footers: { default: createGoGFooter() },
      children: markdownToDocxElements(content),
    }],
  });
}

async function downloadMessageDoc(index) {
  const msg = state.messages[index];
  if (!msg) return;

  if (typeof docx !== 'undefined') {
    try {
      const doc = _buildGoGDocx(msg.content, _getMessageFilename(index, '').replace(/\.$/, ''));
      const blob = await docx.Packer.toBlob(doc);
      _triggerDownload(blob, _getMessageFilename(index, "docx"));
      return;
    } catch (err) { console.error('DOCX generation failed, using fallback:', err); }
  }
  // Fallback: HTML-in-Word
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>AskOzzy Document</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:12pt;line-height:1.6;color:#1a1a1a;max-width:700px;margin:40px auto;padding:0 20px}h1{font-size:18pt;color:#006B3F}h2{font-size:16pt;color:#006B3F}h3{font-size:14pt;color:#333}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px}th{background:#f0f0f0;font-weight:bold}</style></head>
<body>${renderMarkdown(msg.content)}</body></html>`;
  const blob = new Blob([html], { type: "application/msword" });
  _triggerDownload(blob, _getMessageFilename(index, "doc"));
}

function printMessage(index) {
  const msg = state.messages[index];
  if (!msg) return;
  const win = window.open("", "_blank");
  if (!win) { alert("Please allow popups to print."); return; }
  const department = (state.user && state.user.department) || '';
  const date = new Date().toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" });
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>AskOzzy \u2014 Print</title>
<style>body{font-family:Georgia,'Times New Roman',serif;font-size:12pt;line-height:1.7;color:#1a1a1a;max-width:700px;margin:40px auto;padding:0 20px}h1{font-size:18pt;color:#006B3F;border-bottom:2px solid #006B3F;padding-bottom:4px}h2{font-size:16pt;color:#006B3F}h3{font-size:14pt;color:#333}pre{background:#f5f5f5;padding:12px;border:1px solid #ddd;border-radius:4px;font-family:Consolas,monospace;font-size:10pt;white-space:pre-wrap}code{font-family:Consolas,monospace;font-size:10pt;background:#f5f5f5;padding:2px 4px}blockquote{border-left:3px solid #006B3F;padding-left:12px;color:#555;font-style:italic}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:8px;text-align:left}th{background:#eee;font-weight:bold}.gog-header{text-align:center;margin-bottom:24px;padding-bottom:12px;border-bottom:3px double #006B3F}.gog-header .republic{font-size:16pt;font-weight:bold;color:#006B3F;letter-spacing:2px;margin-bottom:4px}.gog-header .star{font-size:32pt;color:#D4AF37;line-height:1.2}.gog-header .dept{font-size:11pt;font-weight:bold;color:#333;text-transform:uppercase;letter-spacing:1px}.footer{margin-top:40px;padding-top:12px;border-top:1px solid #006B3F;font-size:9pt;color:#999;text-align:center}@media print{body{margin:0;padding:20px}}</style>
</head><body>
<div class="gog-header">
  <div class="republic">REPUBLIC OF GHANA</div>
  <div class="star">\u2605</div>
  ${department ? '<div class="dept">' + escapeHtml(department) + '</div>' : ''}
  <div style="font-size:10pt;color:#666;margin-top:8px">${date}</div>
</div>
${renderMarkdown(msg.content)}
<div class="footer">Generated by AskOzzy &mdash; ${date}</div>
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
    const proPrice = isStudent() ? 25 : 60;
    alert(`This model requires a paid plan.\n\nUpgrade to Professional (GHS ${proPrice}/mo) or higher to access all 11 AI models.`);
    selector.value = state.selectedModel;
    openPricingModal();
    return;
  }

  state.selectedModel = model;
}

// ─── Sidebar ─────────────────────────────────────────────────────────

// Sidebar starts collapsed in HTML. Expand it on desktop.
if (window.innerWidth > 768) {
  document.getElementById("sidebar").classList.remove("collapsed");
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  sidebar.classList.toggle("collapsed");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (sidebar.classList.contains("collapsed")) {
    if (backdrop) backdrop.classList.remove("active");
  } else if (window.innerWidth <= 768) {
    if (backdrop) backdrop.classList.add("active");
  }
}

// Close sidebar when tapping backdrop on mobile
document.addEventListener("DOMContentLoaded", () => {
  const backdrop = document.createElement("div");
  backdrop.id = "sidebar-backdrop";
  backdrop.className = "sidebar-backdrop";
  backdrop.addEventListener("click", () => {
    document.getElementById("sidebar").classList.add("collapsed");
    backdrop.classList.remove("active");
  });
  document.body.appendChild(backdrop);
});

// ─── Templates UI ────────────────────────────────────────────────────

function renderCategoryTabs() {
  const container = document.getElementById("category-tabs");
  const visibleCategories = getPersonaCategories();
  const categories = ["All", ...visibleCategories.map((c) => c.id)];

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
  const personaTemplates = getPersonaTemplates();
  const filtered =
    state.activeCategory === "All"
      ? personaTemplates
      : personaTemplates.filter((t) => t.category === state.activeCategory);

  const guideCta = state.activeCategory === "All" ? `
    <div class="template-card template-card--guide-cta" onclick="openGuide()">
      <span class="guide-cta-sparkle">NEW</span>
      <div class="card-icon">\u{1F1EC}\u{1F1ED}</div>
      <div class="card-title">Explore User Guide</div>
      <div class="card-desc">Discover 49+ features, shortcuts, and tips to master AskOzzy</div>
    </div>` : '';

  container.innerHTML = guideCta + filtered
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
  const visibleCategories = getPersonaCategories();
  const categories = ["All", ...visibleCategories.map((c) => c.id)];

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
  const personaTemplates = getPersonaTemplates();
  const filtered =
    category === "All"
      ? personaTemplates
      : personaTemplates.filter((t) => t.category === category);

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

// ─── Affiliate Programme (Enhanced Dashboard) ───────────────────────

// Affiliate state
let affiliateData = null;
let affiliateTab = "overview";
let affiliateTxPage = 1;
let affiliateEarningsChart = null;

async function openAffiliateModal() {
  const modal = document.getElementById("affiliate-modal");
  const body = document.getElementById("affiliate-modal-body");

  body.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner"></div><p style="margin-top:12px;color:var(--text-muted);font-size:13px;">Loading your affiliate dashboard...</p></div>';
  modal.classList.add("active");

  try {
    const res = await fetch(`${API}/api/affiliate/dashboard`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    affiliateData = data;
    affiliateTab = "overview";
    affiliateTxPage = 1;
    renderAffiliateDashboard();
  } catch (err) {
    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Failed to load affiliate data. Please try again.</div>';
  }
}

function renderAffiliateDashboard() {
  const body = document.getElementById("affiliate-modal-body");
  body.innerHTML = `
    <div class="affiliate-tabs">
      <button class="affiliate-tab ${affiliateTab === 'overview' ? 'active' : ''}" onclick="switchAffiliateTab('overview')">Overview</button>
      <button class="affiliate-tab ${affiliateTab === 'earnings' ? 'active' : ''}" onclick="switchAffiliateTab('earnings')">Earnings</button>
      <button class="affiliate-tab ${affiliateTab === 'network' ? 'active' : ''}" onclick="switchAffiliateTab('network')">My Network</button>
      <button class="affiliate-tab ${affiliateTab === 'withdraw' ? 'active' : ''}" onclick="switchAffiliateTab('withdraw')">Withdraw</button>
      <button class="affiliate-tab ${affiliateTab === 'leaderboard' ? 'active' : ''}" onclick="switchAffiliateTab('leaderboard')">Leaderboard</button>
    </div>
    <div class="affiliate-tab-content" id="affiliate-tab-content"></div>
  `;
  renderAffiliateTabContent();
}

function switchAffiliateTab(tab) {
  affiliateTab = tab;
  // Update tab active states
  document.querySelectorAll(".affiliate-tab").forEach(t => {
    t.classList.toggle("active", t.textContent.trim().toLowerCase() === tab);
  });
  renderAffiliateTabContent();
}

function renderAffiliateTabContent() {
  const el = document.getElementById("affiliate-tab-content");
  if (!el) return;
  switch (affiliateTab) {
    case "overview": renderAffiliateOverview(el); break;
    case "earnings": renderAffiliateEarnings(el); break;
    case "network": renderAffiliateNetwork(el); break;
    case "withdraw": renderAffiliateWithdraw(el); break;
    case "leaderboard": renderAffiliateLeaderboard(el); break;
  }
}

function renderAffiliateOverview(el) {
  const d = affiliateData;
  const wallet = d.wallet || 0;
  const stats = d.stats || {};
  const referralCode = d.referralCode || "";
  const referralLink = `${window.location.origin}?ref=${referralCode}`;
  const directCount = stats.directReferrals || d.totalReferrals || 0;
  const payingCount = stats.payingReferrals || 0;
  const monthEarnings = stats.thisMonthEarnings || 0;
  const l2Earnings = stats.secondLevelEarnings || 0;

  const milestones = [
    { target: 10, reward: "GHS 30 bonus", bonus: "GHS 30 bonus", icon: "$" },
    { target: 25, reward: "1 month Professional free", bonus: "GHS 60 bonus", icon: "P" },
    { target: 50, reward: "Permanent 50% discount", bonus: "GHS 100 bonus", icon: "D" },
    { target: 100, reward: "Free Enterprise for life", bonus: "GHS 200 bonus", icon: "E" }
  ];

  const shareMsg = encodeURIComponent(`Try AskOzzy - Ghana's AI Assistant for Government! Use my code ${referralCode} and get GHS 5 bonus. ${referralLink}`);

  el.innerHTML = `
    <div class="affiliate-overview-wrap">
      <!-- Wallet Card -->
      <div class="affiliate-wallet-card">
        <div class="affiliate-wallet-label">Available Balance</div>
        <div class="affiliate-wallet-amount">GHS ${(typeof wallet === 'number' ? wallet : 0).toFixed(2)}</div>
        <div class="affiliate-wallet-sub">Earn 30% on every referral payment</div>
      </div>

      <!-- Stats Grid -->
      <div class="affiliate-stats-grid">
        <div class="affiliate-stat-card">
          <div class="affiliate-stat-value">${directCount}</div>
          <div class="affiliate-stat-label">Direct Referrals</div>
        </div>
        <div class="affiliate-stat-card">
          <div class="affiliate-stat-value">${payingCount}</div>
          <div class="affiliate-stat-label">Paying Referrals</div>
        </div>
        <div class="affiliate-stat-card">
          <div class="affiliate-stat-value">GHS ${monthEarnings.toFixed(2)}</div>
          <div class="affiliate-stat-label">This Month</div>
        </div>
        <div class="affiliate-stat-card">
          <div class="affiliate-stat-value">GHS ${l2Earnings.toFixed(2)}</div>
          <div class="affiliate-stat-label">2nd Level Earnings</div>
        </div>
      </div>

      <!-- Passive Income Projector -->
      <div class="income-projector">
        <div class="income-projector-header">
          <div class="income-projector-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          <div>
            <div class="income-projector-title">Your Passive Income Potential</div>
            <div class="income-projector-sub">See how much you could earn monthly</div>
          </div>
        </div>

        <div class="income-slider-section">
          <label class="income-slider-label">
            If you refer <span class="income-slider-count" id="income-ref-count">10</span> paying users:
          </label>
          <input type="range" min="1" max="100" value="10" class="income-slider" id="income-slider" oninput="updateIncomeProjection()" />
          <div class="income-slider-range">
            <span>1</span><span>25</span><span>50</span><span>75</span><span>100</span>
          </div>
        </div>

        <div class="income-breakdown" id="income-breakdown">
          ${buildIncomeBreakdown(10)}
        </div>

        <div class="income-how-it-works">
          <div class="income-how-item">
            <span class="income-how-num">1</span>
            <span>Share your link &rarr; They subscribe</span>
          </div>
          <div class="income-how-item">
            <span class="income-how-num">2</span>
            <span>You earn <strong>30%</strong> of every payment, every month</span>
          </div>
          <div class="income-how-item">
            <span class="income-how-num">3</span>
            <span>When they refer others &rarr; You earn <strong>5%</strong> too</span>
          </div>
        </div>
      </div>

      <!-- Referral Code -->
      <div class="affiliate-ref-section">
        <div class="affiliate-ref-label">Your Referral Code</div>
        <div class="affiliate-ref-row">
          <input type="text" value="${escapeHtml(referralCode)}" readonly class="affiliate-ref-code-input" />
          <button onclick="copyToClipboard('${referralCode}', this)" class="affiliate-copy-btn">Copy</button>
        </div>
      </div>

      <!-- Referral Link -->
      <div class="affiliate-ref-section">
        <div class="affiliate-ref-label">Your Referral Link</div>
        <div class="affiliate-ref-row">
          <input type="text" value="${escapeHtml(referralLink)}" readonly class="affiliate-ref-link-input" />
          <button onclick="copyToClipboard('${referralLink}', this)" class="affiliate-copy-btn">Copy</button>
        </div>
      </div>

      <!-- Share Buttons -->
      <div class="affiliate-share-row">
        <a href="https://wa.me/?text=${shareMsg}" target="_blank" rel="noopener" class="affiliate-share-btn whatsapp">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          WhatsApp
        </a>
        <a href="sms:?body=${shareMsg}" class="affiliate-share-btn sms">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          SMS
        </a>
        <button onclick="copyToClipboard('${referralLink}', this)" class="affiliate-share-btn copy-link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy Link
        </button>
      </div>

      <!-- Milestones -->
      <div class="affiliate-milestones-section">
        <div class="affiliate-milestones-title">Milestone Rewards</div>
        ${milestones.map(m => {
          const achieved = directCount >= m.target;
          const pct = Math.min(100, (directCount / m.target) * 100);
          return `
          <div class="affiliate-milestone ${achieved ? 'achieved' : ''}">
            <div class="affiliate-milestone-header">
              <span class="affiliate-milestone-icon">${achieved ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--flag-green)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : m.icon}</span>
              <span class="affiliate-milestone-label">${m.target} referrals &mdash; ${m.reward}</span>
              <span class="affiliate-milestone-bonus">${m.bonus}</span>
            </div>
            <div class="affiliate-milestone-bar">
              <div class="affiliate-milestone-fill" style="width:${pct}%"></div>
            </div>
            <div class="affiliate-milestone-count">${Math.min(directCount, m.target)} / ${m.target}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function buildIncomeBreakdown(refs) {
  // Pricing: Professional GHS 60, Enterprise GHS 100
  // Assume 70% choose Professional, 30% choose Enterprise
  const proCount = Math.round(refs * 0.7);
  const entCount = refs - proCount;
  const proRevenue = proCount * 60;
  const entRevenue = entCount * 100;

  const l1Pro = proCount * 60 * 0.30;
  const l1Ent = entCount * 100 * 0.30;
  const l1Total = l1Pro + l1Ent;

  // Assume each referral brings ~2 of their own (L2)
  const l2Refs = refs * 2;
  const l2ProCount = Math.round(l2Refs * 0.7);
  const l2EntCount = l2Refs - l2ProCount;
  const l2Total = (l2ProCount * 60 * 0.05) + (l2EntCount * 100 * 0.05);

  const monthlyTotal = l1Total + l2Total;
  const yearlyTotal = monthlyTotal * 12;

  return `
    <div class="income-cards-row">
      <div class="income-card income-card-l1">
        <div class="income-card-emoji">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
        </div>
        <div class="income-card-label">Direct (30%)</div>
        <div class="income-card-amount">GHS ${l1Total.toFixed(0)}</div>
        <div class="income-card-detail">${proCount} Pro + ${entCount} Ent</div>
      </div>
      <div class="income-card income-card-plus">+</div>
      <div class="income-card income-card-l2">
        <div class="income-card-emoji">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="income-card-label">Level 2 (5%)</div>
        <div class="income-card-amount">GHS ${l2Total.toFixed(0)}</div>
        <div class="income-card-detail">~${l2Refs} sub-referrals</div>
      </div>
    </div>

    <div class="income-total-card">
      <div class="income-total-row">
        <div class="income-total-period">
          <div class="income-total-label">Monthly</div>
          <div class="income-total-amount monthly">GHS ${monthlyTotal.toFixed(0)}<span>/mo</span></div>
        </div>
        <div class="income-total-divider"></div>
        <div class="income-total-period">
          <div class="income-total-label">Yearly</div>
          <div class="income-total-amount yearly">GHS ${yearlyTotal.toLocaleString()}<span>/yr</span></div>
        </div>
      </div>
      <div class="income-total-note">${refs >= 20 ? 'That\u2019s a serious side income!' : refs >= 10 ? 'Enough to cover your own subscription and more!' : 'Just a few referrals to start earning!'}</div>
    </div>
  `;
}

function updateIncomeProjection() {
  const slider = document.getElementById("income-slider");
  const countEl = document.getElementById("income-ref-count");
  const breakdownEl = document.getElementById("income-breakdown");
  if (!slider || !countEl || !breakdownEl) return;
  const refs = parseInt(slider.value);
  countEl.textContent = refs;
  breakdownEl.innerHTML = buildIncomeBreakdown(refs);
}

async function renderAffiliateEarnings(el) {
  el.innerHTML = '<div style="text-align:center;padding:30px;"><div class="spinner"></div></div>';

  // Load transactions
  try {
    const [txRes, dashRes] = await Promise.all([
      fetch(`${API}/api/affiliate/transactions?page=${affiliateTxPage}&limit=20`, { headers: authHeaders() }),
      Promise.resolve(affiliateData) // use cached dashboard data for chart
    ]);
    const txData = await txRes.json();
    if (!txRes.ok) throw new Error(txData.error);

    const transactions = txData.transactions || [];
    const totalPages = txData.totalPages || 1;
    const monthlyEarnings = txData.monthlyEarnings || affiliateData.monthlyEarnings || [];

    el.innerHTML = `
      <div class="affiliate-earnings-wrap">
        <!-- Chart -->
        <div class="affiliate-chart-card">
          <div class="affiliate-chart-title">Monthly Earnings (Last 6 Months)</div>
          <canvas id="affiliate-earnings-chart" height="220"></canvas>
        </div>

        <!-- Transaction History -->
        <div class="affiliate-tx-section">
          <div class="affiliate-tx-title">Transaction History</div>
          ${transactions.length === 0 ? '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">No transactions yet. Start referring to earn!</div>' : `
          <div class="affiliate-tx-table-wrap">
            <table class="affiliate-tx-table">
              <thead>
                <tr><th>Date</th><th>Type</th><th>Amount</th><th>Description</th></tr>
              </thead>
              <tbody>
                ${transactions.map(tx => {
                  const typeMap = {
                    commission_l1: { label: "Direct 30%", cls: "l1" },
                    commission_l2: { label: "Level 2 5%", cls: "l2" },
                    bonus: { label: "Bonus", cls: "bonus" },
                    withdrawal: { label: "Withdrawal", cls: "withdrawal" }
                  };
                  const info = typeMap[tx.type] || { label: tx.type, cls: "l1" };
                  const isNeg = tx.type === "withdrawal";
                  const dateStr = tx.created_at ? new Date(tx.created_at + "Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "--";
                  return `<tr>
                    <td>${dateStr}</td>
                    <td><span class="affiliate-tx-badge ${info.cls}">${info.label}</span></td>
                    <td class="${isNeg ? 'tx-neg' : 'tx-pos'}">${isNeg ? '-' : '+'}GHS ${Math.abs(tx.amount || 0).toFixed(2)}</td>
                    <td>${escapeHtml(tx.description || '')}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
          ${totalPages > 1 ? `
          <div class="affiliate-tx-pagination">
            <button class="affiliate-page-btn" onclick="affiliateChangeTxPage(${affiliateTxPage - 1})" ${affiliateTxPage <= 1 ? 'disabled' : ''}>Prev</button>
            <span class="affiliate-page-info">Page ${affiliateTxPage} of ${totalPages}</span>
            <button class="affiliate-page-btn" onclick="affiliateChangeTxPage(${affiliateTxPage + 1})" ${affiliateTxPage >= totalPages ? 'disabled' : ''}>Next</button>
          </div>` : ''}
          `}
        </div>
      </div>
    `;

    // Render chart
    if (monthlyEarnings.length > 0) {
      renderAffiliateEarningsChart(monthlyEarnings);
    }
  } catch (err) {
    el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">Failed to load earnings data.</div>';
  }
}

function renderAffiliateEarningsChart(monthlyEarnings) {
  const canvas = document.getElementById("affiliate-earnings-chart");
  if (!canvas) return;

  // Destroy old chart if exists
  if (affiliateEarningsChart) {
    affiliateEarningsChart.destroy();
    affiliateEarningsChart = null;
  }

  const labels = monthlyEarnings.map(m => m.month || m.label || "");
  const l1Data = monthlyEarnings.map(m => m.l1 || m.direct || 0);
  const l2Data = monthlyEarnings.map(m => m.l2 || m.secondLevel || 0);

  const ctx = canvas.getContext("2d");
  affiliateEarningsChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Direct (30%)",
          data: l1Data,
          backgroundColor: "#006B3F",
          borderRadius: 4,
          barPercentage: 0.7,
          categoryPercentage: 0.6
        },
        {
          label: "Level 2 (5%)",
          data: l2Data,
          backgroundColor: "#FCD116",
          borderRadius: 4,
          barPercentage: 0.7,
          categoryPercentage: 0.6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: getComputedStyle(document.documentElement).getPropertyValue("--text-secondary").trim(), font: { size: 11 } }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim(), font: { size: 11 } }
        },
        y: {
          stacked: true,
          grid: { color: getComputedStyle(document.documentElement).getPropertyValue("--border-color").trim() },
          ticks: {
            color: getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim(),
            font: { size: 11 },
            callback: v => "GHS " + v
          }
        }
      }
    }
  });
}

function affiliateChangeTxPage(page) {
  if (page < 1) return;
  affiliateTxPage = page;
  const el = document.getElementById("affiliate-tab-content");
  if (el) renderAffiliateEarnings(el);
}

async function renderAffiliateNetwork(el) {
  el.innerHTML = '<div style="text-align:center;padding:30px;"><div class="spinner"></div></div>';

  try {
    const res = await fetch(`${API}/api/affiliate/dashboard`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const referrals = data.recentReferrals || data.referrals || [];
    const networkSize = data.stats ? (data.stats.directReferrals || 0) + (data.stats.secondLevelCount || 0) : referrals.length;

    el.innerHTML = `
      <div class="affiliate-network-wrap">
        <div class="affiliate-network-header">
          <span class="affiliate-network-size">Total Network: <strong>${networkSize}</strong> people</span>
        </div>

        ${referrals.length === 0 ? '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px;">No referrals yet. Share your link to grow your network!</div>' : `
        <div class="affiliate-network-tree">
          ${referrals.map(r => `
            <div class="affiliate-network-node">
              <div class="affiliate-network-person">
                <div class="affiliate-network-avatar">${(r.full_name || "?").charAt(0).toUpperCase()}</div>
                <div class="affiliate-network-info">
                  <div class="affiliate-network-name">${escapeHtml(r.full_name || "Unknown")}</div>
                  <div class="affiliate-network-meta">
                    <span class="affiliate-network-tier tier-${r.tier || 'free'}">${r.tier || 'free'}</span>
                    <span class="affiliate-network-status ${r.is_paying ? 'active' : 'free-status'}">${r.is_paying ? 'Active' : 'Free'}</span>
                    <span class="affiliate-network-date">Joined ${r.joined_at ? new Date(r.joined_at + "Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "--"}</span>
                  </div>
                </div>
              </div>
              ${(r.sub_referrals && r.sub_referrals.length > 0) ? `
              <div class="affiliate-network-children">
                ${r.sub_referrals.map(sr => `
                  <div class="affiliate-network-child">
                    <div class="affiliate-network-avatar small">${(sr.full_name || "?").charAt(0).toUpperCase()}</div>
                    <div class="affiliate-network-info">
                      <div class="affiliate-network-name">${escapeHtml(sr.full_name || "Unknown")}</div>
                      <div class="affiliate-network-meta">
                        <span class="affiliate-network-tier tier-${sr.tier || 'free'}">${sr.tier || 'free'}</span>
                        <span class="affiliate-network-status ${sr.is_paying ? 'active' : 'free-status'}">${sr.is_paying ? 'Active' : 'Free'}</span>
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>` : ''}
            </div>
          `).join('')}
        </div>
        `}
      </div>
    `;
  } catch (err) {
    el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">Failed to load network data.</div>';
  }
}

async function renderAffiliateWithdraw(el) {
  el.innerHTML = '<div style="text-align:center;padding:30px;"><div class="spinner"></div></div>';

  const wallet = affiliateData.wallet || 0;

  try {
    // Load withdrawal history from transactions
    const res = await fetch(`${API}/api/affiliate/transactions?page=1&limit=50`, { headers: authHeaders() });
    const txData = await res.json();
    const withdrawals = (txData.transactions || []).filter(t => t.type === "withdrawal");

    el.innerHTML = `
      <div class="affiliate-withdraw-wrap">
        <!-- Balance Display -->
        <div class="affiliate-wallet-card" style="margin-bottom:24px;">
          <div class="affiliate-wallet-label">Available for Withdrawal</div>
          <div class="affiliate-wallet-amount">GHS ${wallet.toFixed(2)}</div>
          <div class="affiliate-wallet-sub">Minimum withdrawal: GHS 20.00</div>
        </div>

        <!-- Withdrawal Form -->
        <div class="withdraw-form">
          <div class="withdraw-form-title">Request Withdrawal</div>
          <div class="withdraw-form-group">
            <label>Amount (GHS)</label>
            <div class="withdraw-amount-row">
              <input type="number" id="withdraw-amount" min="20" max="${wallet}" step="0.01" placeholder="Enter amount" class="withdraw-input" />
              <button onclick="document.getElementById('withdraw-amount').value='${wallet.toFixed(2)}'" class="withdraw-all-btn">Withdraw All</button>
            </div>
          </div>
          <div class="withdraw-form-group">
            <label>MoMo Number</label>
            <div class="withdraw-momo-row">
              <span class="withdraw-country-code">+233</span>
              <input type="tel" id="withdraw-momo" placeholder="24XXXXXXX" maxlength="10" class="withdraw-input momo-input" />
            </div>
          </div>
          <div class="withdraw-form-group">
            <label>Network</label>
            <select id="withdraw-network" class="withdraw-input">
              <option value="">Select network</option>
              <option value="MTN">MTN Mobile Money</option>
              <option value="Vodafone">Vodafone Cash</option>
              <option value="AirtelTigo">AirtelTigo Money</option>
            </select>
          </div>
          <div id="withdraw-error" class="withdraw-error" style="display:none;"></div>
          <button onclick="submitWithdrawal()" class="withdraw-submit-btn" id="withdraw-submit-btn">Request Withdrawal</button>
        </div>

        <!-- Withdrawal History -->
        <div class="affiliate-tx-section" style="margin-top:24px;">
          <div class="affiliate-tx-title">Withdrawal History</div>
          ${withdrawals.length === 0 ? '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:13px;">No withdrawals yet.</div>' : `
          <div class="affiliate-tx-table-wrap">
            <table class="affiliate-tx-table">
              <thead>
                <tr><th>Date</th><th>Amount</th><th>MoMo Number</th><th>Status</th></tr>
              </thead>
              <tbody>
                ${withdrawals.map(w => {
                  const dateStr = w.created_at ? new Date(w.created_at + "Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "--";
                  const status = w.status || "pending";
                  return `<tr>
                    <td>${dateStr}</td>
                    <td>GHS ${Math.abs(w.amount || 0).toFixed(2)}</td>
                    <td>${escapeHtml(w.momo_number || w.description || "--")}</td>
                    <td><span class="withdraw-status-badge ${status}">${status.charAt(0).toUpperCase() + status.slice(1)}</span></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
          `}
        </div>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `
      <div class="affiliate-withdraw-wrap">
        <div class="affiliate-wallet-card" style="margin-bottom:24px;">
          <div class="affiliate-wallet-label">Available for Withdrawal</div>
          <div class="affiliate-wallet-amount">GHS ${wallet.toFixed(2)}</div>
        </div>
        <div class="withdraw-form">
          <div class="withdraw-form-title">Request Withdrawal</div>
          <div class="withdraw-form-group">
            <label>Amount (GHS)</label>
            <div class="withdraw-amount-row">
              <input type="number" id="withdraw-amount" min="20" max="${wallet}" step="0.01" placeholder="Enter amount" class="withdraw-input" />
              <button onclick="document.getElementById('withdraw-amount').value='${wallet.toFixed(2)}'" class="withdraw-all-btn">Withdraw All</button>
            </div>
          </div>
          <div class="withdraw-form-group">
            <label>MoMo Number</label>
            <div class="withdraw-momo-row">
              <span class="withdraw-country-code">+233</span>
              <input type="tel" id="withdraw-momo" placeholder="24XXXXXXX" maxlength="10" class="withdraw-input momo-input" />
            </div>
          </div>
          <div class="withdraw-form-group">
            <label>Network</label>
            <select id="withdraw-network" class="withdraw-input">
              <option value="">Select network</option>
              <option value="MTN">MTN Mobile Money</option>
              <option value="Vodafone">Vodafone Cash</option>
              <option value="AirtelTigo">AirtelTigo Money</option>
            </select>
          </div>
          <div id="withdraw-error" class="withdraw-error" style="display:none;"></div>
          <button onclick="submitWithdrawal()" class="withdraw-submit-btn" id="withdraw-submit-btn">Request Withdrawal</button>
        </div>
      </div>
    `;
  }
}

async function submitWithdrawal() {
  const amount = parseFloat(document.getElementById("withdraw-amount").value);
  const momoNum = document.getElementById("withdraw-momo").value.trim();
  const network = document.getElementById("withdraw-network").value;
  const errEl = document.getElementById("withdraw-error");
  const btn = document.getElementById("withdraw-submit-btn");

  errEl.style.display = "none";

  if (!amount || amount < 20) {
    errEl.textContent = "Minimum withdrawal is GHS 20.00";
    errEl.style.display = "block";
    return;
  }
  if (amount > (affiliateData.wallet || 0)) {
    errEl.textContent = "Amount exceeds your available balance";
    errEl.style.display = "block";
    return;
  }
  if (!momoNum || momoNum.length < 9) {
    errEl.textContent = "Please enter a valid MoMo number";
    errEl.style.display = "block";
    return;
  }
  if (!network) {
    errEl.textContent = "Please select a mobile money network";
    errEl.style.display = "block";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Processing...";

  try {
    const res = await fetch(`${API}/api/affiliate/withdraw`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        amount,
        momo_number: "+233" + momoNum.replace(/^0/, ""),
        momo_network: network
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Withdrawal failed");

    // Update local wallet
    affiliateData.wallet = (affiliateData.wallet || 0) - amount;

    // Refresh the withdraw tab
    const el = document.getElementById("affiliate-tab-content");
    if (el) renderAffiliateWithdraw(el);

    // Show success message briefly
    setTimeout(() => {
      const errEl2 = document.getElementById("withdraw-error");
      if (errEl2) {
        errEl2.textContent = "Withdrawal request submitted successfully! You will receive your funds within 24-48 hours.";
        errEl2.style.display = "block";
        errEl2.style.color = "var(--green-light)";
        errEl2.style.background = "rgba(0,168,107,0.1)";
        errEl2.style.borderColor = "rgba(0,168,107,0.3)";
      }
    }, 100);

  } catch (err) {
    errEl.textContent = err.message || "Withdrawal failed. Please try again.";
    errEl.style.display = "block";
    btn.disabled = false;
    btn.textContent = "Request Withdrawal";
  }
}

async function renderAffiliateLeaderboard(el) {
  el.innerHTML = '<div style="text-align:center;padding:30px;"><div class="spinner"></div></div>';

  try {
    const res = await fetch(`${API}/api/affiliate/leaderboard`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const leaders = data.leaderboard || [];
    const myRank = data.myRank || null;

    el.innerHTML = `
      <div class="affiliate-leaderboard-wrap">
        <div class="affiliate-leaderboard-title">Top Affiliates</div>
        ${myRank ? `
        <div class="affiliate-leaderboard-myrank">
          Your rank: <strong>#${myRank.rank}</strong> with ${myRank.referrals || 0} referrals and GHS ${(myRank.earnings || 0).toFixed(2)} earned
        </div>` : ''}
        <div class="affiliate-leaderboard-list">
          ${leaders.length === 0 ? '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">No leaderboard data yet.</div>' : leaders.map((l, i) => {
            const rank = i + 1;
            const isMe = l.is_current_user || false;
            const rankCls = rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : "";
            return `
            <div class="affiliate-leaderboard-row ${rankCls} ${isMe ? 'is-me' : ''}">
              <div class="affiliate-leaderboard-rank">${rank <= 3 ? ['&#x1F947;', '&#x1F948;', '&#x1F949;'][rank - 1] : '#' + rank}</div>
              <div class="affiliate-leaderboard-name">${escapeHtml(l.name || "Anonymous")}</div>
              <div class="affiliate-leaderboard-stats">
                <span>${l.referrals || 0} referrals</span>
                <span>GHS ${(l.earnings || 0).toFixed(2)}</span>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">Failed to load leaderboard.</div>';
  }
}

function closeAffiliateModal() {
  document.getElementById("affiliate-modal").classList.remove("active");
  // Clean up chart
  if (affiliateEarningsChart) {
    affiliateEarningsChart.destroy();
    affiliateEarningsChart = null;
  }
}

document.getElementById("affiliate-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeAffiliateModal();
});

function copyToClipboard(text, btnElement) {
  navigator.clipboard.writeText(text).then(() => {
    const btn = btnElement || event.target;
    const original = btn.textContent;
    btn.textContent = "Copied!";
    btn.style.background = "var(--green-light)";
    btn.style.color = "#fff";
    setTimeout(() => {
      btn.textContent = original;
      btn.style.background = "";
      btn.style.color = "";
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
    const headers = {};
    if (state.token) headers["Authorization"] = `Bearer ${state.token}`;
    const res = await fetch(`${API}/api/pricing`, { headers });
    const data = await res.json();
    const currentTier = (state.user && state.user.tier) || "free";

    const studentPricing = data.isStudentPricing;

    body.innerHTML = `
      ${studentPricing ? '<div class="student-discount-banner"><span>🎓</span> Student pricing applied — save up to 58%!</div>' : ''}
      <div class="pricing-grid">
        ${data.plans.map(plan => {
          const isCurrent = plan.id === currentTier;
          const isDowngrade = getPlanOrder(plan.id) < getPlanOrder(currentTier);
          const showDiscount = studentPricing && plan.standardPrice > 0 && plan.price < plan.standardPrice;
          return `
          <div class="pricing-card ${plan.popular && !isCurrent ? 'popular' : ''} ${isCurrent ? 'current' : ''}">
            <div class="pricing-name">${plan.name}</div>
            <div class="pricing-price">
              ${plan.price === 0 ? 'Free' : `GHS ${plan.price}`}
              ${plan.price > 0 ? '<span>/month</span>' : ''}
            </div>
            ${showDiscount ? `<div class="pricing-original-price">was GHS ${plan.standardPrice}/month</div>` : ''}
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

    // Feature 3: Insert trial banner above pricing grid
    const trialExpires = state.user && state.user.trialExpiresAt;
    const trialActive = trialExpires && new Date(trialExpires) > new Date();
    const canTrial = currentTier === 'free' && !trialExpires;

    if (canTrial) {
      const pricingGrid = body.querySelector('.pricing-grid');
      if (pricingGrid) {
        const trialBanner = document.createElement('div');
        trialBanner.className = 'trial-banner';
        trialBanner.innerHTML = `
          <div class="trial-banner-icon">🎁</div>
          <div class="trial-banner-text">
            <div class="trial-banner-title">Try Professional FREE for 3 days</div>
            <div class="trial-banner-sub">Full access to all 11 AI models, 200 messages/day, and every premium feature. No card needed.</div>
          </div>
          <button class="trial-banner-btn" onclick="activateFreeTrial()">Start Free Trial</button>
        `;
        pricingGrid.parentNode.insertBefore(trialBanner, pricingGrid);
      }
    } else if (trialActive) {
      const expires = new Date(trialExpires);
      const hoursLeft = Math.max(0, Math.round((expires - Date.now()) / 3600000));
      const pricingGrid = body.querySelector('.pricing-grid');
      if (pricingGrid) {
        const activeBanner = document.createElement('div');
        activeBanner.className = 'trial-banner trial-active';
        activeBanner.innerHTML = `
          <div class="trial-banner-icon">⚡</div>
          <div class="trial-banner-text">
            <div class="trial-banner-title">Professional Trial Active</div>
            <div class="trial-banner-sub">${hoursLeft} hours remaining — upgrade now to keep all features</div>
          </div>
          <button class="trial-banner-btn" onclick="upgradeToPlan('professional','Professional',${studentPricing ? 25 : 60})">Upgrade Now</button>
        `;
        pricingGrid.parentNode.insertBefore(activeBanner, pricingGrid);
      }
    }
  } catch {
    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Failed to load pricing. Please try again.</div>';
  }
}

function getPlanOrder(tier) {
  const order = { free: 0, professional: 1, enterprise: 2 };
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
  // Ctrl/Cmd + / — open user guide
  if ((e.ctrlKey || e.metaKey) && e.key === "/") {
    e.preventDefault();
    openGuide();
    return;
  }
  // Escape — close any open modal
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay.active").forEach(m => m.classList.remove("active"));
  }
});

// ─── User Guide ─────────────────────────────────────────────────────

function openGuide(scrollToSection) {
  let modal = document.getElementById('guide-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'guide-modal-fullscreen';
    modal.id = 'guide-modal';
    modal.innerHTML = buildGuideHTML();
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeGuide(); });
    initGuideNavigation();
  }
  modal.classList.remove('closing');
  modal.classList.add('active');
  updateGuideTierHighlights();
  updateGuideProgress();

  // Mark FAB as seen (stop pulsing)
  const fab = document.querySelector('.guide-fab');
  if (fab) fab.classList.add('seen');

  // Sparkle effect on first-ever open
  setTimeout(() => playGuideSparkle(), 200);

  if (scrollToSection) {
    setTimeout(() => scrollGuideToSection(scrollToSection), 150);
  }
}

function closeGuide() {
  const modal = document.getElementById('guide-modal');
  if (!modal || !modal.classList.contains('active')) return;
  modal.classList.add('closing');
  setTimeout(() => {
    modal.classList.remove('active', 'closing');
  }, 200);
}

function buildGuideHTML() {
  const tierOrder = ['free', 'professional', 'enterprise'];
  const userTier = (state.user && state.user.tier) || 'free';
  const tierLabel = { free: 'Free', professional: 'Professional', enterprise: 'Enterprise' }[userTier] || 'Free';

  // Build nav items (emoji icons)
  const navItems = GUIDE_SECTIONS.map(s => {
    const emojiData = GUIDE_SECTION_EMOJIS[s.id];
    const icon = emojiData ? emojiData.emoji : '';
    return `<button class="guide-nav-item" data-section="${s.id}" onclick="scrollGuideToSection('${s.id}')">
      <span class="guide-nav-icon">${icon}</span>
      <span>${s.title}</span>
    </button>`;
  }).join('');

  // Build mobile pills
  const mobilePills = GUIDE_SECTIONS.map(s => {
    const emojiData = GUIDE_SECTION_EMOJIS[s.id];
    const icon = emojiData ? emojiData.emoji + ' ' : '';
    return `<button class="guide-mobile-nav-pill" data-section="${s.id}" onclick="scrollGuideToSection('${s.id}')">${icon}${s.title}</button>`;
  }).join('');

  // Build sections
  const sections = GUIDE_SECTIONS.map(s => {
    let content = '';
    if (s.id === 'shortcuts') {
      content = buildKeyboardShortcutsTable();
    } else {
      content = s.features.map(f => {
        const tierBadge = `<span class="guide-tier-badge tier-${f.tier}">${f.tier.charAt(0).toUpperCase() + f.tier.slice(1)}</span>`;
        const steps = f.steps.map(st => `<li>${escapeHtml(st)}</li>`).join('');
        const tryIt = GUIDE_TRY_IT_ACTIONS[f.id];
        const tryItBtn = tryIt ? `<button class="guide-try-btn" onclick="${tryIt.action}">${tryIt.label}</button>` : '';
        return `<div class="guide-feature-card" data-feature-id="${f.id}" data-tier="${f.tier}" data-search="${(f.title + ' ' + f.description + ' ' + f.steps.join(' ')).toLowerCase()}">
          <button class="guide-feature-head" onclick="toggleGuideFeature('${f.id}')">
            <svg class="guide-feature-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            <span class="guide-feature-title">${escapeHtml(f.title)}</span>
            ${tierBadge}
          </button>
          <div class="guide-feature-body">
            <div class="guide-feature-inner">
              <p class="guide-feature-desc">${escapeHtml(f.description)}</p>
              <ol class="guide-feature-steps">${steps}</ol>
              ${tryItBtn}
            </div>
          </div>
        </div>`;
      }).join('');
    }

    // Emoji icon in gradient circle
    const emojiData = GUIDE_SECTION_EMOJIS[s.id];
    const sectionIcon = emojiData
      ? `<div class="guide-section-icon" style="background:${emojiData.gradient};">${emojiData.emoji}</div>`
      : `<div class="guide-section-icon">${s.icon}</div>`;

    return `<div class="guide-section" id="guide-section-${s.id}" data-section-id="${s.id}" data-search="${(s.title + ' ' + s.description).toLowerCase()}">
      <div class="guide-section-header">
        ${sectionIcon}
        <div>
          <h3 class="guide-section-title">${s.title}</h3>
          <div class="guide-section-desc">${s.description}</div>
        </div>
      </div>
      ${content}
    </div>`;
  }).join('');

  // Tip of the day
  const tip = getRandomTip();
  const tipBanner = `<div class="guide-tip-banner" id="guide-tip-banner">
    <span class="guide-tip-icon">\u{1F4A1}</span>
    <span class="guide-tip-text"><strong>Tip:</strong> ${tip}</span>
    <button class="guide-tip-dismiss" onclick="document.getElementById('guide-tip-banner').style.display='none'" title="Dismiss">\u2715</button>
  </div>`;

  // Progress bar
  const progressBar = `<div class="guide-progress-bar">
    <div class="guide-progress-track"><div class="guide-progress-fill" id="guide-progress-fill" style="width:0%"></div></div>
    <div class="guide-progress-text" id="guide-progress-text">0 of 49 features explored (0%)</div>
  </div>`;

  return `<div class="guide-container">
    <div class="guide-header">
      <div class="guide-logo">O</div>
      <div class="guide-header-text">
        <h2 class="guide-title">
          AskOzzy User Guide
          <span class="guide-tier-badge tier-${userTier}">${tierLabel} Plan</span>
        </h2>
        <div class="guide-subtitle">Everything you need to know \u2014 49+ features across 12 categories</div>
      </div>
      <button class="guide-close" onclick="closeGuide()" title="Close (Esc)">&#x2715;</button>
    </div>
    <div class="guide-search-bar">
      <svg class="guide-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input class="guide-search-input" type="text" placeholder="Search features, tools, shortcuts..." oninput="filterGuide()" id="guide-search-input" />
      <span class="guide-search-count" id="guide-search-count"></span>
      <button class="guide-search-clear" id="guide-search-clear" onclick="clearGuideSearch()">&#x2715;</button>
    </div>
    <div class="guide-mobile-nav" id="guide-mobile-nav">${mobilePills}</div>
    <div class="guide-body">
      <nav class="guide-nav" id="guide-nav">${navItems}</nav>
      <div class="guide-content" id="guide-content">
        ${tipBanner}
        ${progressBar}
        ${sections}
        <div class="guide-no-results" id="guide-no-results" style="display:none;">
          <div class="guide-no-results-icon">&#128269;</div>
          <h3>No matching features</h3>
          <p>Try a different search term</p>
        </div>
        <button class="guide-scroll-top" id="guide-scroll-top" title="Scroll to top">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
        </button>
      </div>
    </div>
  </div>`;
}

function buildKeyboardShortcutsTable() {
  const shortcuts = [
    ['Ctrl + K', 'Search conversations'],
    ['Ctrl + N', 'New conversation'],
    ['Ctrl + B', 'Toggle sidebar'],
    ['Ctrl + Shift + D', 'Toggle dark/light mode'],
    ['Ctrl + /', 'Open this User Guide'],
    ['Enter', 'Send message'],
    ['Shift + Enter', 'New line in message'],
    ['Escape', 'Close any open modal/dialog'],
  ];

  const rows = shortcuts.map(([key, action]) => {
    const kbds = key.split(' + ').map(k => `<kbd>${k}</kbd>`).join(' + ');
    return `<tr><td>${kbds}</td><td>${escapeHtml(action)}</td></tr>`;
  }).join('');

  return `<table class="guide-shortcuts-table">
    <thead><tr><th>Shortcut</th><th>Action</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function toggleGuideFeature(id) {
  const card = document.querySelector(`.guide-feature-card[data-feature-id="${id}"]`);
  if (!card) return;

  const wasOpen = card.classList.contains('open');

  // Close all sibling cards in the same section
  const section = card.closest('.guide-section');
  if (section) {
    section.querySelectorAll('.guide-feature-card.open').forEach(c => c.classList.remove('open'));
  }

  // Toggle the clicked card
  if (!wasOpen) {
    card.classList.add('open');
    markFeatureExplored(id);
  }
}

function scrollGuideToSection(id) {
  const section = document.getElementById('guide-section-' + id);
  const content = document.getElementById('guide-content');
  if (!section || !content) return;

  content.scrollTo({ top: section.offsetTop - content.offsetTop, behavior: 'smooth' });

  // Update nav active state
  document.querySelectorAll('.guide-nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.guide-mobile-nav-pill').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.guide-nav-item[data-section="${id}"]`);
  const pillItem = document.querySelector(`.guide-mobile-nav-pill[data-section="${id}"]`);
  if (navItem) navItem.classList.add('active');
  if (pillItem) {
    pillItem.classList.add('active');
    pillItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
  // Update sliding nav indicator
  setTimeout(() => updateGuideNavIndicator(), 50);
}

function filterGuide() {
  const input = document.getElementById('guide-search-input');
  const clearBtn = document.getElementById('guide-search-clear');
  const noResults = document.getElementById('guide-no-results');
  const searchCount = document.getElementById('guide-search-count');
  if (!input) return;

  const query = input.value.trim().toLowerCase();
  clearBtn.classList.toggle('visible', query.length > 0);

  const sections = document.querySelectorAll('.guide-section');
  let anyVisible = false;
  let matchCount = 0;

  sections.forEach(section => {
    const sectionId = section.dataset.sectionId;

    // Keyboard shortcuts section — match on section title/desc
    if (sectionId === 'shortcuts') {
      const sectionMatch = !query || section.dataset.search.includes(query) || 'keyboard shortcut ctrl'.includes(query);
      section.classList.toggle('hidden', !sectionMatch);
      if (sectionMatch) anyVisible = true;
      return;
    }

    const cards = section.querySelectorAll('.guide-feature-card');
    let sectionHasMatch = false;

    cards.forEach(card => {
      const match = !query || card.dataset.search.includes(query);
      card.classList.toggle('hidden', !match);
      if (match) {
        sectionHasMatch = true;
        if (query) matchCount++;
        // Auto-expand matching cards during search
        if (query.length >= 2) card.classList.add('open');
        else card.classList.remove('open');
      }
    });

    // Also match on section-level search
    if (!sectionHasMatch && query && section.dataset.search.includes(query)) {
      sectionHasMatch = true;
      cards.forEach(card => { card.classList.remove('hidden'); matchCount++; });
    }

    section.classList.toggle('hidden', !sectionHasMatch);
    if (sectionHasMatch) anyVisible = true;
  });

  if (noResults) noResults.style.display = anyVisible || !query ? 'none' : 'block';

  // Update search results count badge
  if (searchCount) {
    if (query) {
      searchCount.textContent = matchCount + ' result' + (matchCount !== 1 ? 's' : '');
      searchCount.classList.add('visible');
    } else {
      searchCount.classList.remove('visible');
    }
  }
}

function clearGuideSearch() {
  const input = document.getElementById('guide-search-input');
  if (input) {
    input.value = '';
    filterGuide();
    input.focus();
  }
}

function updateGuideTierHighlights() {
  const tierOrder = ['free', 'professional', 'enterprise'];
  const userTier = (state.user && state.user.tier) || 'free';
  const userTierIndex = tierOrder.indexOf(userTier);

  document.querySelectorAll('.guide-feature-card').forEach(card => {
    const featureTier = card.dataset.tier;
    const featureTierIndex = tierOrder.indexOf(featureTier);
    const locked = featureTierIndex > userTierIndex;

    card.classList.toggle('locked', locked);

    // Add/remove locked badge
    const head = card.querySelector('.guide-feature-head');
    const existing = head.querySelector('.guide-locked-badge');
    if (locked && !existing) {
      const badge = document.createElement('span');
      badge.className = 'guide-locked-badge';
      badge.innerHTML = '\u{1F512} Unlock';
      badge.onclick = (e) => { e.stopPropagation(); closeGuide(); openPricingModal(); };
      head.appendChild(badge);
    } else if (!locked && existing) {
      existing.remove();
    }
  });

  // Update header tier badge
  const headerBadge = document.querySelector('.guide-title .guide-tier-badge');
  if (headerBadge) {
    const tierLabel = { free: 'Free', professional: 'Professional', enterprise: 'Enterprise' }[userTier] || 'Free';
    headerBadge.className = `guide-tier-badge tier-${userTier}`;
    headerBadge.textContent = `${tierLabel} Plan`;
  }
}

function initGuideNavigation() {
  // Use IntersectionObserver to track active section
  const content = document.getElementById('guide-content');
  if (!content) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const sectionId = entry.target.dataset.sectionId;
        if (!sectionId) return;

        document.querySelectorAll('.guide-nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.guide-mobile-nav-pill').forEach(n => n.classList.remove('active'));

        const navItem = document.querySelector(`.guide-nav-item[data-section="${sectionId}"]`);
        const pillItem = document.querySelector(`.guide-mobile-nav-pill[data-section="${sectionId}"]`);
        if (navItem) navItem.classList.add('active');
        if (pillItem) pillItem.classList.add('active');
        updateGuideNavIndicator();
      }
    });
  }, {
    root: content,
    rootMargin: '-10% 0px -80% 0px',
    threshold: 0
  });

  content.querySelectorAll('.guide-section').forEach(section => observer.observe(section));

  // Scroll-to-top button listener
  const scrollTopBtn = document.getElementById('guide-scroll-top');
  if (scrollTopBtn) {
    content.addEventListener('scroll', () => {
      scrollTopBtn.classList.toggle('visible', content.scrollTop > 300);
    });
    scrollTopBtn.addEventListener('click', () => {
      content.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Nav sliding indicator
  const nav = document.getElementById('guide-nav');
  if (nav) {
    const indicator = document.createElement('div');
    indicator.className = 'guide-nav-indicator';
    nav.appendChild(indicator);
    // Initial positioning
    setTimeout(() => updateGuideNavIndicator(), 100);
  }
}

// ─── Guide Utility Functions ──────────────────────────────────────────

function getExploredFeatures() {
  try { return JSON.parse(localStorage.getItem('ozzy_guide_explored') || '[]'); } catch { return []; }
}

function markFeatureExplored(featureId) {
  const explored = getExploredFeatures();
  if (!explored.includes(featureId)) {
    explored.push(featureId);
    localStorage.setItem('ozzy_guide_explored', JSON.stringify(explored));
  }
  updateGuideProgress();
}

function updateGuideProgress() {
  const explored = getExploredFeatures();
  const total = GUIDE_SECTIONS.reduce((sum, s) => sum + s.features.length, 0) || 49;
  const count = explored.length;
  const pct = Math.min(Math.round((count / total) * 100), 100);

  const fill = document.getElementById('guide-progress-fill');
  const text = document.getElementById('guide-progress-text');
  if (fill) fill.style.width = pct + '%';
  if (text) text.textContent = `${count} of ${total} features explored (${pct}%)`;
}

function getRandomTip() {
  const idx = Math.floor(Math.random() * GUIDE_TIPS.length);
  return GUIDE_TIPS[idx];
}

function updateGuideNavIndicator() {
  const nav = document.getElementById('guide-nav');
  const indicator = nav && nav.querySelector('.guide-nav-indicator');
  const activeItem = nav && nav.querySelector('.guide-nav-item.active');
  if (!indicator || !activeItem) return;

  const navRect = nav.getBoundingClientRect();
  const itemRect = activeItem.getBoundingClientRect();
  indicator.style.width = (itemRect.width - 24) + 'px';
  indicator.style.transform = `translateX(${itemRect.left - navRect.left}px) translateY(${itemRect.bottom - navRect.top - 3}px)`;
}

function playGuideSparkle() {
  if (localStorage.getItem('ozzy_guide_sparkled')) return;
  localStorage.setItem('ozzy_guide_sparkled', '1');

  const container = document.querySelector('.guide-container');
  if (!container) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'guide-sparkle-canvas';
  canvas.width = container.offsetWidth;
  canvas.height = container.offsetHeight;
  container.style.position = 'relative';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const colors = ['#CE1126', '#FCD116', '#006B3F', '#FFD700', '#FFFFFF'];
  const particles = [];
  const cx = canvas.width / 2, cy = canvas.height / 3;

  for (let i = 0; i < 60; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 4;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      r: 2 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 1,
      star: Math.random() > 0.5
    });
  }

  let frame = 0;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.life -= 0.015;
      if (p.life <= 0) return;
      alive = true;
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      if (p.star) {
        ctx.beginPath();
        for (let j = 0; j < 5; j++) {
          const a = (j * 4 * Math.PI) / 5 - Math.PI / 2;
          const m = j === 0 ? 'moveTo' : 'lineTo';
          ctx[m](p.x + Math.cos(a) * p.r, p.y + Math.sin(a) * p.r);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
    frame++;
    if (alive && frame < 90) requestAnimationFrame(animate);
    else canvas.remove();
  }
  requestAnimationFrame(animate);
}

// ─── Voice Input (Web Speech API) — Enhanced with Ghanaian Languages ─

let _recognition = null;
let _isListening = false;
let _voiceTimerInterval = null;
let _voiceTimerSeconds = 0;

// Language code mapping for speech recognition
const VOICE_LANG_MAP = {
  en: 'en-GH',     // Ghana English
  tw: 'ak-GH',     // Akan/Twi
  ga: 'gaa',        // Ga
  ee: 'ee-GH',      // Ewe
  ha: 'ha-GH',      // Hausa
  fr: 'fr-FR',      // French
  dag: 'dag',       // Dagbani
};

// Fallback language codes if browser doesn't support the specific locale
const VOICE_LANG_FALLBACK = {
  'en-GH': 'en-US',
  'ak-GH': 'ak',
  'ee-GH': 'ee',
  'ha-GH': 'ha',
};

// "Listening..." in each language
const LISTENING_LABELS = {
  en: 'Listening...',
  tw: 'Mente tie...',
  ga: 'Enu mli...',
  ee: 'Miele to...',
  ha: 'Ana sauraro...',
  fr: '\u00C9coute...',
  dag: 'Di wuhimi...',
};

function getRecognitionLang() {
  const lang = state.language || 'en';
  const mapped = VOICE_LANG_MAP[lang] || 'en-GH';
  return mapped;
}

function initVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return; // Not supported

  _recognition = new SpeechRecognition();
  _recognition.continuous = false;
  _recognition.interimResults = true;
  _recognition.lang = getRecognitionLang();

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
    updateVoiceUI(false);
  };

  _recognition.onerror = (e) => {
    _isListening = false;
    updateVoiceUI(false);
    // If language not supported, try fallback
    if (e.error === 'language-not-supported') {
      const currentLang = _recognition.lang;
      const fallback = VOICE_LANG_FALLBACK[currentLang];
      if (fallback) {
        _recognition.lang = fallback;
        // Auto-retry with fallback
        try {
          _recognition.start();
          _isListening = true;
          updateVoiceUI(true);
        } catch (retryErr) {
          // Silently fail
        }
      }
    }
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
    updateVoiceUI(false);
  } else {
    // Update recognition language before starting
    _recognition.lang = getRecognitionLang();
    try {
      _recognition.start();
      _isListening = true;
      updateVoiceUI(true);
    } catch (err) {
      // Already started or other error
      _isListening = false;
      updateVoiceUI(false);
    }
  }
}

function updateVoiceUI(isRecording) {
  // Update the small voice button
  const btnSmall = document.getElementById("btn-voice");
  if (btnSmall) {
    btnSmall.classList.toggle("listening", isRecording);
    btnSmall.title = isRecording ? "Stop listening" : "Voice input";
  }

  // Update the large voice button
  const btnLarge = document.getElementById("voice-btn-large");
  if (btnLarge) {
    btnLarge.classList.toggle("recording", isRecording);
    btnLarge.title = isRecording ? "Tap to stop" : "Tap to speak";
  }

  // Update the input wrapper state
  const wrapper = document.getElementById("input-wrapper");
  if (wrapper) {
    wrapper.classList.toggle("recording", isRecording);
  }

  // Update the recording indicator
  const indicator = document.getElementById("voice-recording-indicator");
  if (indicator) {
    indicator.classList.toggle("active", isRecording);
  }

  // Update listening label text
  const label = document.getElementById("voice-listening-label");
  if (label) {
    label.textContent = LISTENING_LABELS[state.language] || 'Listening...';
  }

  // Handle recording timer
  if (isRecording) {
    startVoiceTimer();
  } else {
    stopVoiceTimer();
  }
}

function startVoiceTimer() {
  _voiceTimerSeconds = 0;
  updateVoiceTimerDisplay();
  _voiceTimerInterval = setInterval(() => {
    _voiceTimerSeconds++;
    updateVoiceTimerDisplay();
  }, 1000);
}

function stopVoiceTimer() {
  if (_voiceTimerInterval) {
    clearInterval(_voiceTimerInterval);
    _voiceTimerInterval = null;
  }
  _voiceTimerSeconds = 0;
  updateVoiceTimerDisplay();
}

function updateVoiceTimerDisplay() {
  const timerEl = document.getElementById("voice-timer");
  if (!timerEl) return;
  const mins = Math.floor(_voiceTimerSeconds / 60);
  const secs = _voiceTimerSeconds % 60;
  timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Keep the old function name for backward compatibility
function updateVoiceButton() {
  updateVoiceUI(_isListening);
}

// ─── Voice-First Welcome Overlay ─────────────────────────────────────

function showVoiceWelcome() {
  if (localStorage.getItem('ozzy_voice_welcomed')) return;

  const overlay = document.createElement('div');
  overlay.className = 'voice-welcome-overlay';
  overlay.id = 'voice-welcome-overlay';
  overlay.innerHTML = `
    <div class="voice-welcome-card">
      <div class="voice-welcome-flag"><span></span><span></span><span></span></div>
      <h2>Welcome to AskOzzy</h2>
      <p class="subtitle">Tap the microphone to ask your question in any Ghanaian language</p>
      <button class="voice-welcome-mic" id="voice-welcome-mic-btn" title="Tap to speak">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="23"/>
          <line x1="8" y1="23" x2="16" y2="23"/>
        </svg>
      </button>
      <div class="voice-lang-pills" id="voice-welcome-langs"></div>
      <p class="or-type">Or type your question below</p>
      <button class="voice-welcome-dismiss" id="voice-welcome-dismiss">Got it</button>
    </div>
  `;

  document.body.appendChild(overlay);

  // Populate language pills
  const languages = [
    { code: 'en', name: 'English' },
    { code: 'tw', name: 'Twi' },
    { code: 'ga', name: 'Ga' },
    { code: 'ee', name: 'Ewe' },
    { code: 'ha', name: 'Hausa' },
    { code: 'fr', name: 'Fran\u00e7ais' },
    { code: 'dag', name: 'Dagbani' },
  ];

  const pillsContainer = document.getElementById('voice-welcome-langs');
  if (pillsContainer) {
    pillsContainer.innerHTML = languages.map(l =>
      `<button class="voice-lang-pill ${l.code === (state.language || 'en') ? 'active' : ''}" data-lang="${l.code}">${l.name}</button>`
    ).join('');

    // Language pill click handlers
    pillsContainer.addEventListener('click', (e) => {
      const pill = e.target.closest('.voice-lang-pill');
      if (!pill) return;
      const lang = pill.dataset.lang;
      // Update active state
      pillsContainer.querySelectorAll('.voice-lang-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      // Change the app language
      changeLanguage(lang);
    });
  }

  // Mic button in welcome — start voice and dismiss
  const micBtn = document.getElementById('voice-welcome-mic-btn');
  if (micBtn) {
    micBtn.addEventListener('click', () => {
      dismissVoiceWelcome();
      setTimeout(() => toggleVoice(), 200);
    });
  }

  // Dismiss button
  const dismissBtn = document.getElementById('voice-welcome-dismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', dismissVoiceWelcome);
  }

  // Click outside card to dismiss
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismissVoiceWelcome();
  });
}

function dismissVoiceWelcome() {
  localStorage.setItem('ozzy_voice_welcomed', '1');
  const overlay = document.getElementById('voice-welcome-overlay');
  if (overlay) {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.25s ease';
    setTimeout(() => overlay.remove(), 260);
  }
}

// Init voice on load + show welcome
document.addEventListener("DOMContentLoaded", () => {
  initVoiceInput();
  // Show voice welcome after a brief delay so the page renders first
  setTimeout(showVoiceWelcome, 600);
});

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
  const isPaid = state.user && state.user.tier && state.user.tier !== "free";
  if (!isPaid) {
    showFolderPremiumPrompt();
    return;
  }
  const name = prompt("Folder name:");
  if (!name) return;
  try {
    const res = await fetch(`${API}/api/folders`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.code === "PREMIUM_REQUIRED") { showFolderPremiumPrompt(); return; }
      alert(data.error || "Failed to create folder");
      return;
    }
    await loadFolders();
    renderConversationList();
  } catch {}
}

function toggleFolderCollapse(folderId) {
  if (!state.collapsedFolders) state.collapsedFolders = {};
  state.collapsedFolders[folderId] = !state.collapsedFolders[folderId];
  renderConversationList();
}

function showMoveToFolderMenu(event, convoId) {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();
  const folders = state.folders || [];
  const convo = state.conversations.find(c => c.id === convoId);

  let menuHtml = '<div class="context-menu" id="context-menu">';
  menuHtml += '<div class="context-menu-title">Move to folder</div>';
  if (convo && convo.folder_id) {
    menuHtml += `<button class="context-menu-item" onclick="moveToFolder('${convoId}',null);closeContextMenu();">Remove from folder</button>`;
  }
  for (const f of folders) {
    const isCurrent = convo && convo.folder_id === f.id;
    menuHtml += `<button class="context-menu-item ${isCurrent ? 'active' : ''}" onclick="moveToFolder('${convoId}','${f.id}');closeContextMenu();">📁 ${escapeHtml(f.name)}${isCurrent ? ' ✓' : ''}</button>`;
  }
  if (folders.length === 0) {
    menuHtml += '<div class="context-menu-empty">No folders yet</div>';
  }
  menuHtml += `<button class="context-menu-item context-menu-new" onclick="closeContextMenu();createFolder();">+ New Folder</button>`;
  menuHtml += '</div>';

  document.body.insertAdjacentHTML("beforeend", menuHtml);
  const menu = document.getElementById("context-menu");
  menu.style.left = Math.min(event.clientX, window.innerWidth - 200) + "px";
  menu.style.top = Math.min(event.clientY, window.innerHeight - 250) + "px";
  setTimeout(() => document.addEventListener("click", closeContextMenu, { once: true }), 10);
}

function showConvoContextMenu(event, convoId, isPinned, folderId) {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();
  const isPaid = state.user && state.user.tier && state.user.tier !== "free";
  const folders = state.folders || [];

  let menuHtml = '<div class="context-menu" id="context-menu">';
  menuHtml += `<button class="context-menu-item" onclick="togglePin('${convoId}');closeContextMenu();">${isPinned ? '📌 Unpin' : '📍 Pin to top'}</button>`;
  if (isPaid) {
    menuHtml += '<div class="context-menu-divider"></div>';
    menuHtml += '<div class="context-menu-title">Move to folder</div>';
    if (folderId) {
      menuHtml += `<button class="context-menu-item" onclick="moveToFolder('${convoId}',null);closeContextMenu();">Remove from folder</button>`;
    }
    for (const f of folders) {
      const isCurrent = folderId === f.id;
      menuHtml += `<button class="context-menu-item ${isCurrent ? 'active' : ''}" onclick="moveToFolder('${convoId}','${f.id}');closeContextMenu();">📁 ${escapeHtml(f.name)}${isCurrent ? ' ✓' : ''}</button>`;
    }
    menuHtml += `<button class="context-menu-item context-menu-new" onclick="closeContextMenu();createFolder();">+ New Folder</button>`;
  }
  menuHtml += '<div class="context-menu-divider"></div>';
  menuHtml += `<button class="context-menu-item context-menu-danger" onclick="deleteConversation('${convoId}');closeContextMenu();">🗑 Delete</button>`;
  menuHtml += '</div>';

  document.body.insertAdjacentHTML("beforeend", menuHtml);
  const menu = document.getElementById("context-menu");
  menu.style.left = Math.min(event.clientX, window.innerWidth - 200) + "px";
  menu.style.top = Math.min(event.clientY, window.innerHeight - 250) + "px";
  setTimeout(() => document.addEventListener("click", closeContextMenu, { once: true }), 10);
}

function closeContextMenu() {
  const menu = document.getElementById("context-menu");
  if (menu) menu.remove();
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

// ─── Productivity Dashboard ──────────────────────────────────────────

let productivityChartInstance = null;

async function openProductivityDashboard() {
  if (!isLoggedIn()) { requireAuth(openProductivityDashboard); return; }

  let modal = document.getElementById("productivity-dashboard-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.id = "productivity-dashboard-modal";
    modal.innerHTML = `
      <div class="modal" style="max-width:700px;">
        <div class="modal-header">
          <h3>Productivity Dashboard</h3>
          <button class="modal-close" onclick="document.getElementById('productivity-dashboard-modal').classList.remove('active')">&#x2715;</button>
        </div>
        <div class="modal-body" id="productivity-dashboard-body" style="padding:24px;">
          <div style="text-align:center;padding:40px;"><div class="spinner"></div></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("active"); });
  }

  modal.classList.add("active");
  const body = document.getElementById("productivity-dashboard-body");

  try {
    const res = await fetch(`${API}/api/productivity/me`, { headers: authHeaders() });
    if (!res.ok) throw new Error("Failed to load");
    const d = await res.json();

    const monthMsgs = (d.month?.messages_sent || 0);
    const monthDocs = (d.month?.documents_generated || 0) + (d.month?.workflows_completed || 0);
    const monthMinutes = d.month?.estimated_minutes_saved || 0;
    const monthHours = (monthMinutes / 60).toFixed(1);
    const allTimeHours = ((d.allTime?.estimated_minutes_saved || 0) / 60).toFixed(1);

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:20px;">
        <div style="background:var(--bg-tertiary);border-radius:10px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:var(--gold);">${monthMsgs}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">Messages This Month</div>
        </div>
        <div style="background:var(--bg-tertiary);border-radius:10px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:var(--green-light);">${monthDocs}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">Documents Generated</div>
        </div>
        <div style="background:var(--bg-tertiary);border-radius:10px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#CE1126;">${monthHours}h</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">Est. Hours Saved</div>
        </div>
        <div style="background:var(--bg-tertiary);border-radius:10px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:var(--text-strong);">${d.streak}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">Day Streak</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
        <div style="background:var(--bg-tertiary);border-radius:10px;padding:16px;">
          <div style="font-size:13px;font-weight:600;margin-bottom:8px;">This Week</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;">
            <div><span style="color:var(--text-muted);">Messages:</span> <strong>${d.week?.messages_sent || 0}</strong></div>
            <div><span style="color:var(--text-muted);">Research:</span> <strong>${d.week?.research_reports || 0}</strong></div>
            <div><span style="color:var(--text-muted);">Analyses:</span> <strong>${d.week?.analyses_run || 0}</strong></div>
            <div><span style="color:var(--text-muted);">Workflows:</span> <strong>${d.week?.workflows_completed || 0}</strong></div>
          </div>
        </div>
        <div style="background:var(--bg-tertiary);border-radius:10px;padding:16px;">
          <div style="font-size:13px;font-weight:600;margin-bottom:8px;">All Time</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;">
            <div><span style="color:var(--text-muted);">Total Msgs:</span> <strong>${d.allTime?.messages_sent || 0}</strong></div>
            <div><span style="color:var(--text-muted);">Hours Saved:</span> <strong>${allTimeHours}h</strong></div>
            <div><span style="color:var(--text-muted);">Top Feature:</span> <strong>${escapeHtml(d.topFeature)}</strong></div>
            <div><span style="color:var(--text-muted);">Meetings:</span> <strong>${d.allTime?.meetings_processed || 0}</strong></div>
          </div>
        </div>
      </div>

      <div style="background:var(--bg-tertiary);border-radius:10px;padding:16px;">
        <div style="font-size:13px;font-weight:600;margin-bottom:12px;">Daily Activity - Last 7 Days</div>
        <canvas id="productivity-chart-canvas" width="600" height="220"></canvas>
      </div>`;

    // Render chart with Chart.js
    if (typeof Chart !== "undefined") {
      // Destroy previous instance if it exists
      if (productivityChartInstance) {
        productivityChartInstance.destroy();
        productivityChartInstance = null;
      }

      const ghanaColors = ["#CE1126", "#FCD116", "#006B3F", "#1a1d27", "#e8eaed", "#00a86b"];
      const dailyData = d.dailyUsage || [];

      // Fill in missing days in the last 7 days
      const labels = [];
      const msgData = [];
      const docData = [];
      const researchData = [];
      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split("T")[0];
        labels.push(dateStr.slice(5)); // MM-DD
        const dayEntry = dailyData.find(dd => dd.stat_date === dateStr);
        msgData.push(dayEntry ? dayEntry.messages_sent : 0);
        docData.push(dayEntry ? (dayEntry.documents_generated + dayEntry.workflows_completed) : 0);
        researchData.push(dayEntry ? (dayEntry.research_reports + dayEntry.analyses_run) : 0);
      }

      setTimeout(() => {
        const canvas = document.getElementById("productivity-chart-canvas");
        if (!canvas) return;
        try {
          productivityChartInstance = new Chart(canvas, {
            type: "bar",
            data: {
              labels,
              datasets: [
                {
                  label: "Messages",
                  data: msgData,
                  backgroundColor: ghanaColors[0] + "CC",
                  borderRadius: 3,
                },
                {
                  label: "Documents",
                  data: docData,
                  backgroundColor: ghanaColors[2] + "CC",
                  borderRadius: 3,
                },
                {
                  label: "Research & Analysis",
                  data: researchData,
                  backgroundColor: ghanaColors[1] + "CC",
                  borderRadius: 3,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  position: "bottom",
                  labels: { color: "var(--text-secondary)", boxWidth: 12, font: { size: 11 } },
                },
              },
              scales: {
                x: { ticks: { color: "var(--text-secondary)", font: { size: 11 } }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { color: "var(--text-secondary)", font: { size: 11 }, stepSize: 1 }, grid: { color: "rgba(128,128,128,0.1)" } },
              },
            },
          });
        } catch (e) {
          console.error("Productivity chart error:", e);
        }
      }, 100);
    }
  } catch {
    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Failed to load productivity data. Please try again.</div>';
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

// ─── Security Settings ──────────────────────────────────────────────────

async function openSecuritySettings() {
  if (!isLoggedIn()) return;

  let modal = document.getElementById("security-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.id = "security-modal";
    modal.innerHTML = `
      <div class="modal" style="max-width:500px;">
        <div class="modal-header">
          <h3>Security Settings</h3>
          <button class="modal-close" onclick="document.getElementById('security-modal').classList.remove('active')">&#x2715;</button>
        </div>
        <div class="modal-body" id="security-body" style="padding:24px;">
          <div style="text-align:center;padding:40px;"><div class="spinner"></div></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("active"); });
  }

  modal.classList.add("active");
  await renderSecuritySettings();
}

async function renderSecuritySettings() {
  const body = document.getElementById("security-body");
  if (!body) return;

  body.innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner"></div></div>';

  try {
    // Fetch passkey credentials
    let passkeys = [];
    try {
      const res = await fetch(`${API}/api/auth/webauthn/credentials`, { headers: authHeaders() });
      const data = await res.json();
      passkeys = data.credentials || [];
    } catch {}

    const hasWebAuthn = !!window.PublicKeyCredential;

    body.innerHTML = `
      <div style="margin-bottom:24px;">
        <h4 style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Authenticator App (TOTP)</h4>
        <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;">Your primary sign-in method. Use Google Authenticator, Authy, or similar apps.</p>
        <button class="btn-auth" onclick="open2FASetup()" style="font-size:13px;padding:8px 16px;">Reconfigure Authenticator</button>
      </div>

      <div style="border-top:1px solid var(--border-color);padding-top:16px;margin-bottom:24px;">
        <h4 style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Passkeys</h4>
        <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;">Sign in with fingerprint or Face ID. Works as a backup to your authenticator.</p>
        ${passkeys.length > 0 ? passkeys.map(pk => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-tertiary);border-radius:8px;margin-bottom:6px;">
            <span style="font-size:12px;color:var(--text-secondary);">Passkey added ${new Date(pk.created_at).toLocaleDateString()}</span>
            <button onclick="deletePasskey('${pk.id}')" style="background:none;border:none;color:var(--red);font-size:11px;cursor:pointer;">Remove</button>
          </div>`).join("") : '<p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">No passkeys registered.</p>'}
        ${hasWebAuthn ? '<button class="btn-auth" onclick="addPasskey()" style="font-size:13px;padding:8px 16px;">Add Passkey</button>' : '<p style="font-size:11px;color:var(--text-muted);">Your browser does not support passkeys.</p>'}
      </div>

      <div style="border-top:1px solid var(--border-color);padding-top:16px;">
        <h4 style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Recovery Code</h4>
        <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;">One-time use backup code in case you lose your authenticator.</p>
        <button class="btn-auth" onclick="regenerateRecoveryCode()" style="font-size:13px;padding:8px 16px;background:var(--bg-tertiary);color:var(--text-primary);">Generate New Recovery Code</button>
        <div id="new-recovery-code" style="display:none;margin-top:12px;"></div>
      </div>`;
  } catch (err) {
    body.innerHTML = `<p style="color:var(--red-error-text);">Failed to load security settings.</p>`;
  }
}

async function deletePasskey(id) {
  if (!confirm("Remove this passkey?")) return;
  try {
    await fetch(`${API}/api/auth/webauthn/credentials/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    await renderSecuritySettings();
  } catch {}
}

async function regenerateRecoveryCode() {
  try {
    const res = await fetch(`${API}/api/auth/recovery-code/regenerate`, {
      method: "POST",
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const el = document.getElementById("new-recovery-code");
    if (el) {
      el.style.display = "block";
      el.innerHTML = `
        <div class="recovery-code-display">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">NEW RECOVERY CODE</div>
          <div class="recovery-code-value">${data.recoveryCode}</div>
          <p style="font-size:11px;color:var(--red-error-text);margin-top:8px;font-weight:600;">Save this code! It won't be shown again.</p>
        </div>`;
    }
  } catch (err) {
    alert("Failed to generate recovery code: " + (err.message || "Unknown error"));
  }
}

// Keep old function name for backward compat
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
          <h3>Set Up Authenticator</h3>
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
          <input type="text" id="totp-verify-code" maxlength="6" placeholder="000000" inputmode="numeric" style="text-align:center;font-size:24px;letter-spacing:8px;" />
        </div>
        <button class="btn-auth" onclick="verify2FA()">Verify & Enable</button>
        <div id="2fa-error" style="color:var(--red-error-text);font-size:12px;margin-top:8px;"></div>
      </div>`;
  } catch {
    body.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">Failed to set up authenticator</div>';
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

    alert("Authenticator enabled successfully! You can now sign in with your 6-digit code.");
    document.getElementById("2fa-modal").classList.remove("active");
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  }
}

// ─── Onboarding Tour ─────────────────────────────────────────────────

function showOnboardingTour() {
  if (localStorage.getItem("askozzy_onboarding_done")) return;

  const steps = [
    { target: ".model-selector", text: "Choose from 11 AI models. Free plans get 3 models, paid plans unlock all 11.", position: "bottom" },
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

// Detect iOS/Safari (no beforeinstallprompt support)
function isIOSSafari() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isInStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

// Show install banner: native on Android/Chrome, custom guide on iOS/Safari
function showInstallBanner() {
  if (sessionStorage.getItem("askozzy_install_dismissed")) return;
  if (isInStandaloneMode()) return;

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

// iOS-specific install guide (Safari doesn't fire beforeinstallprompt)
function showIOSInstallGuide() {
  if (sessionStorage.getItem("askozzy_install_dismissed")) return;
  if (isInStandaloneMode()) return;
  if (document.querySelector(".pwa-install-banner")) return;

  const banner = document.createElement("div");
  banner.className = "pwa-install-banner";
  banner.innerHTML = `
    <div class="pwa-install-content">
      <div class="pwa-install-icon">&#x26A1;</div>
      <div class="pwa-install-text">
        <strong>Install AskOzzy</strong>
        <span>Tap <strong style="font-size:16px;">&#x2191;</strong> Share then <strong>"Add to Home Screen"</strong></span>
      </div>
    </div>
    <div class="pwa-install-actions">
      <button class="pwa-install-dismiss" onclick="dismissInstallBanner()">Got it</button>
    </div>
  `;
  document.body.appendChild(banner);
}

// Trigger iOS banner after a short delay so user has context
if (isIOSSafari() && !isInStandaloneMode()) {
  setTimeout(showIOSInstallGuide, 3000);
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
  const badge = document.getElementById("offline-status-badge");
  const badgeText = badge ? badge.querySelector(".offline-status-text") : null;

  if (!navigator.onLine) {
    // Show bottom bar indicator
    if (!existing) {
      const indicator = document.createElement("div");
      indicator.className = "offline-indicator";
      indicator.innerHTML = '<span class="offline-dot"></span> Offline Mode — templates available, other messages will be queued';
      document.body.appendChild(indicator);
    }

    // Update header badge
    if (badge) {
      badge.classList.remove("online");
      badge.classList.add("offline");
      if (badgeText) badgeText.textContent = "Offline";
    }

    // Request queue status from service worker
    updateOfflineQueueBadge();
  } else {
    // Remove bottom bar indicator
    if (existing) existing.remove();

    // Update header badge
    if (badge) {
      badge.classList.remove("offline");
      badge.classList.add("online");
      if (badgeText) badgeText.textContent = "Online";
    }

    // Try to process queued messages
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "PROCESS_QUEUE" });
    }

    // Hide queue badge after a short delay (let sync complete)
    setTimeout(updateOfflineQueueBadge, 2000);
  }
}

// Initialize the header badge on load
function initOfflineStatusBadge() {
  const badge = document.getElementById("offline-status-badge");
  if (badge) {
    if (navigator.onLine) {
      badge.classList.add("online");
      badge.querySelector(".offline-status-text").textContent = "Online";
    } else {
      badge.classList.add("offline");
      badge.querySelector(".offline-status-text").textContent = "Offline";
    }
  }
}

// Update the sidebar queue badge with pending message count
function updateOfflineQueueBadge() {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "GET_QUEUE_STATUS" });
  }
}

// Show/hide the queue badge based on count
function renderQueueBadge(count) {
  const queueBadge = document.getElementById("offline-queue-badge");
  const queueCount = document.getElementById("offline-queue-count");

  if (queueBadge && queueCount) {
    if (count > 0) {
      queueBadge.style.display = "flex";
      queueCount.textContent = count;
    } else {
      queueBadge.style.display = "none";
    }
  }
}

// Show a toast when queued messages are synced
function showSyncToast(message, duration) {
  duration = duration || 3000;
  let toast = document.querySelector(".sync-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "sync-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("visible"), duration);
}

// Listen for messages from the service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    const { data } = event;
    if (!data || !data.type) return;

    switch (data.type) {
      case "QUEUE_STATUS":
        renderQueueBadge(data.count);
        updateAppBadge(data.count || 0);
        break;

      case "QUEUE_UPDATED":
        updateOfflineQueueBadge();
        break;

      case "OFFLINE_MESSAGE_SENT":
        hapticFeedback("success");
        showSyncToast("Queued message sent successfully");
        updateOfflineQueueBadge();
        updateAppBadge(0);
        if (typeof loadConversations === "function") {
          loadConversations();
        }
        break;

      case "OFFLINE_TEMPLATE_SERVED":
        showSyncToast("Serving offline template for: " + (data.templateId || "").replace(/-/g, " "));
        break;

      case "TEMPLATES_CACHED":
        console.log("Offline templates cached:", data.count);
        break;

      case "SW_UPDATE_AVAILABLE":
        showSyncToast("Update available — pull to refresh", 5000);
        break;
    }
  });
}

window.addEventListener("online", () => {
  updateOnlineStatus();
  hapticFeedback("success");
  showSyncToast("Back online — syncing queued messages...");
  // Trigger Background Sync
  registerBackgroundSync();
  // Also clear app badge
  updateAppBadge(0);
});
window.addEventListener("offline", () => {
  updateOnlineStatus();
  hapticFeedback("error");
});

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => {
  initOfflineStatusBadge();
  updateOnlineStatus();

  // Request template pre-caching from the service worker on first load
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "PRECACHE_TEMPLATES" });
  } else if (navigator.serviceWorker) {
    // Wait for the service worker to be ready
    navigator.serviceWorker.ready.then(() => {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "PRECACHE_TEMPLATES" });
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  PWA: Pull-to-Refresh
// ═══════════════════════════════════════════════════════════════════

(function initPullToRefresh() {
  const THRESHOLD = 80;
  const MAX_PULL = 120;
  let startY = 0;
  let currentY = 0;
  let pulling = false;
  let refreshing = false;

  // Create PTR UI
  const container = document.createElement("div");
  container.className = "ptr-container";
  container.innerHTML = `<div class="ptr-spinner"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.2-8.6"/><polyline points="21 3 21 9 15 9"/></svg></div>`;
  document.body.prepend(container);

  const spinner = container.querySelector(".ptr-spinner svg");

  function isScrolledToTop() {
    const chatArea = document.getElementById("chat-area");
    const chatMessages = document.getElementById("chat-messages");
    const welcomeScreen = document.getElementById("welcome-screen");
    // Check if the main scrollable area is at top
    if (chatArea && chatArea.scrollTop <= 0) return true;
    if (chatMessages && chatMessages.scrollTop <= 0) return true;
    if (welcomeScreen && !welcomeScreen.classList.contains("hidden")) return true;
    // Fallback: check document scroll
    return window.scrollY <= 0;
  }

  document.addEventListener("touchstart", (e) => {
    if (refreshing) return;
    if (!isScrolledToTop()) return;
    startY = e.touches[0].clientY;
    pulling = false;
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (refreshing) return;
    if (startY === 0) return;

    currentY = e.touches[0].clientY;
    const dy = currentY - startY;

    // Only activate when pulling down and at the top
    if (dy < 10 || !isScrolledToTop()) {
      if (pulling) {
        pulling = false;
        container.classList.remove("pulling");
        container.style.transform = "translateY(-60px)";
      }
      return;
    }

    pulling = true;
    container.classList.add("pulling");

    const progress = Math.min(dy / MAX_PULL, 1);
    const translateY = Math.min(dy * 0.5, 60) - 60;
    container.style.transform = `translateY(${translateY}px)`;

    // Rotate arrow based on progress
    const rotation = progress * 180;
    spinner.style.transform = `rotate(${rotation}deg)`;

    // Haptic feedback when crossing threshold
    if (dy >= THRESHOLD && !container.dataset.hapticFired) {
      container.dataset.hapticFired = "1";
      hapticFeedback("light");
    }
  }, { passive: true });

  document.addEventListener("touchend", () => {
    if (refreshing) return;
    delete container.dataset.hapticFired;

    if (!pulling) {
      startY = 0;
      return;
    }

    const dy = currentY - startY;
    pulling = false;
    container.classList.remove("pulling");

    if (dy >= THRESHOLD) {
      // Trigger refresh
      refreshing = true;
      container.classList.add("refreshing");
      container.style.transform = "translateY(0)";
      hapticFeedback("medium");

      doRefresh().finally(() => {
        refreshing = false;
        container.classList.remove("refreshing");
        container.style.transform = "translateY(-60px)";
        spinner.style.transform = "";
      });
    } else {
      container.style.transform = "translateY(-60px)";
      spinner.style.transform = "";
    }

    startY = 0;
    currentY = 0;
  }, { passive: true });

  async function doRefresh() {
    showSyncToast("Refreshing...");
    try {
      // Reload conversations if logged in
      if (isLoggedIn()) {
        await loadConversations();
        await loadUsageStatus();
      }
      // Process offline queue via SW
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "PROCESS_QUEUE" });
      }
      // Small delay so the animation feels natural
      await new Promise((r) => setTimeout(r, 600));
    } catch {
      // Ignore refresh errors
    }
  }
})();

// ═══════════════════════════════════════════════════════════════════
//  PWA: Swipe-from-Left-Edge to Open Sidebar
// ═══════════════════════════════════════════════════════════════════

(function initSwipeToOpenSidebar() {
  const EDGE_WIDTH = 24; // px from left edge
  const SWIPE_THRESHOLD = 60;
  let startX = 0;
  let startY = 0;
  let tracking = false;

  // Edge indicator
  const indicator = document.createElement("div");
  indicator.className = "swipe-edge-indicator";
  document.body.appendChild(indicator);

  document.addEventListener("touchstart", (e) => {
    const touch = e.touches[0];
    if (touch.clientX <= EDGE_WIDTH) {
      const sidebar = document.getElementById("sidebar");
      if (sidebar && sidebar.classList.contains("collapsed")) {
        startX = touch.clientX;
        startY = touch.clientY;
        tracking = true;
        indicator.classList.add("active");
      }
    }
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!tracking) return;
    const dx = e.touches[0].clientX - startX;
    const dy = Math.abs(e.touches[0].clientY - startY);

    // If vertical movement exceeds horizontal, cancel
    if (dy > dx) {
      tracking = false;
      indicator.classList.remove("active");
      return;
    }

    // Visual feedback on edge indicator
    const progress = Math.min(dx / SWIPE_THRESHOLD, 1);
    indicator.style.opacity = progress * 0.6;
    indicator.style.width = `${6 + progress * 4}px`;
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    indicator.classList.remove("active");
    indicator.style.opacity = "";
    indicator.style.width = "";

    const dx = (e.changedTouches[0] || {}).clientX - startX;
    if (dx >= SWIPE_THRESHOLD) {
      hapticFeedback("light");
      toggleSidebar();
    }
    startX = 0;
  }, { passive: true });
})();

// ═══════════════════════════════════════════════════════════════════
//  PWA: Haptic Feedback Utility
// ═══════════════════════════════════════════════════════════════════

function hapticFeedback(intensity) {
  if (!navigator.vibrate) return;
  switch (intensity) {
    case "light":
      navigator.vibrate(10);
      break;
    case "medium":
      navigator.vibrate(25);
      break;
    case "heavy":
      navigator.vibrate([30, 10, 30]);
      break;
    case "success":
      navigator.vibrate([10, 50, 20]);
      break;
    case "error":
      navigator.vibrate([50, 30, 50, 30, 50]);
      break;
    default:
      navigator.vibrate(10);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  PWA: App Badging API — show queued message count on icon
// ═══════════════════════════════════════════════════════════════════

async function updateAppBadge(count) {
  if (!("setAppBadge" in navigator)) return;
  try {
    if (count > 0) {
      await navigator.setAppBadge(count);
    } else {
      await navigator.clearAppBadge();
    }
  } catch {
    // Badge API not supported or permission denied
  }
}

// ═══════════════════════════════════════════════════════════════════
//  PWA: Background Sync Registration
// ═══════════════════════════════════════════════════════════════════

async function registerBackgroundSync() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if ("sync" in reg) {
      await reg.sync.register("sync-offline-queue");
    }
  } catch {
    // Background Sync not supported
  }
}

// ═══════════════════════════════════════════════════════════════════
//  PWA: Skeleton Loading Screens
// ═══════════════════════════════════════════════════════════════════

function showChatSkeleton() {
  const chatMessages = document.getElementById("chat-messages");
  if (!chatMessages || chatMessages.children.length > 0) return;

  const skeleton = document.createElement("div");
  skeleton.className = "chat-skeleton";
  skeleton.innerHTML = `
    <div class="skeleton-message skeleton"><div class="skeleton-line skeleton" style="width:75%"></div><div class="skeleton-line skeleton" style="width:50%"></div><div class="skeleton-line skeleton" style="width:85%"></div></div>
    <div class="skeleton-message skeleton" style="margin-left:auto;max-width:70%;"><div class="skeleton-line skeleton" style="width:60%"></div><div class="skeleton-line skeleton"></div></div>
    <div class="skeleton-message skeleton"><div class="skeleton-line skeleton" style="width:90%"></div><div class="skeleton-line skeleton" style="width:40%"></div></div>
  `;
  chatMessages.appendChild(skeleton);
}

function removeChatSkeleton() {
  const skeleton = document.querySelector(".chat-skeleton");
  if (skeleton) skeleton.remove();
}

function showSidebarSkeleton() {
  const list = document.getElementById("conversations-list");
  if (!list) return;
  list.innerHTML = Array.from({ length: 5 }, () =>
    '<div class="skeleton-sidebar-item skeleton"></div>'
  ).join("");
}

// ═══════════════════════════════════════════════════════════════════
//  PWA: Network Information API — connection-aware behavior
// ═══════════════════════════════════════════════════════════════════

function getConnectionQuality() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) return "unknown";
  if (conn.saveData) return "save-data";
  const ect = conn.effectiveType; // "slow-2g", "2g", "3g", "4g"
  return ect || "unknown";
}

// ═══════════════════════════════════════════════════════════════════
//  PWA: Screen Wake Lock — keep screen on during long AI responses
// ═══════════════════════════════════════════════════════════════════

let _wakeLock = null;

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request("screen");
    _wakeLock.addEventListener("release", () => { _wakeLock = null; });
  } catch {
    // Wake Lock not available (e.g., low battery)
  }
}

function releaseWakeLock() {
  if (_wakeLock) {
    _wakeLock.release();
    _wakeLock = null;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  PWA: Share Target Handler
// ═══════════════════════════════════════════════════════════════════

(function handleShareTarget() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("action") !== "share") return;

  const title = params.get("title") || "";
  const text = params.get("text") || "";
  const url = params.get("url") || "";
  const shared = [title, text, url].filter(Boolean).join("\n");

  if (shared) {
    // Clean the URL
    window.history.replaceState({}, "", "/");
    // Pre-fill chat input after DOM is ready
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => {
        const input = document.getElementById("chat-input");
        if (input) {
          input.value = shared;
          input.focus();
          if (typeof autoResizeInput === "function") autoResizeInput();
          showSyncToast("Content shared to AskOzzy");
        }
      }, 500);
    });
  }
})();

// ═══════════════════════════════════════════════════════════════════
//  PWA: Wake Lock + Haptic on Send (late-bind after function hoisting)
// ═══════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {
  // Add haptic feedback to send button
  const sendBtn = document.querySelector(".send-btn, #send-btn, [onclick*='sendMessage']");
  if (sendBtn) {
    sendBtn.addEventListener("pointerdown", () => hapticFeedback("light"), { passive: true });
  }

  // Add haptic to all sidebar conversation items on tap
  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".conversation-item, .template-card, .category-tab")) {
      hapticFeedback("light");
    }
  }, { passive: true });
});

// ═══════════════════════════════════════════════════════════════════
//  PWA: Push Notifications
// ═══════════════════════════════════════════════════════════════════

const PushManager = {
  _vapidKey: null,

  async init() {
    if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) return;
    // Only prompt after 3 successful conversations (not on first visit)
    const convCount = parseInt(localStorage.getItem('askozzy_conv_count') || '0', 10);
    if (convCount < 3) return;
    // Check if already subscribed
    const status = await this.getStatus();
    if (status === 'subscribed') return;
    if (status === 'denied') return;
    // Show non-intrusive prompt
    if (Notification.permission === 'default') {
      this.showPermissionPrompt();
    }
  },

  async subscribe() {
    if (!('Notification' in window) || !('PushManager' in window)) return false;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;

      const reg = await navigator.serviceWorker.ready;

      // Fetch VAPID public key from backend
      if (!this._vapidKey) {
        try {
          const res = await fetch(API + '/api/push/vapid-public-key');
          if (res.ok) {
            const data = await res.json();
            this._vapidKey = data.key;
          }
        } catch { /* VAPID endpoint not available */ }
      }

      if (!this._vapidKey) return false;

      // Convert VAPID key to Uint8Array
      const rawKey = atob(this._vapidKey.replace(/-/g, '+').replace(/_/g, '/'));
      const keyArray = new Uint8Array(rawKey.length);
      for (let i = 0; i < rawKey.length; i++) keyArray[i] = rawKey.charCodeAt(i);

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyArray,
      });

      // Send subscription to backend
      if (state.token) {
        await fetch(API + '/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        });
      }

      showSyncToast('Push notifications enabled');
      hapticFeedback('success');
      this._dismissPrompt();
      return true;
    } catch (err) {
      console.error('Push subscribe failed:', err);
      return false;
    }
  },

  async unsubscribe() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        // Notify backend
        if (state.token) {
          await fetch(API + '/api/push/unsubscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
        }
      }
      showSyncToast('Push notifications disabled');
      return true;
    } catch {
      return false;
    }
  },

  async getStatus() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission === 'default') return 'prompt';
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      return sub ? 'subscribed' : 'unsubscribed';
    } catch {
      return 'error';
    }
  },

  async updatePreferences(prefs) {
    if (!state.token) return;
    try {
      await fetch(API + '/api/push/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.token },
        body: JSON.stringify(prefs),
      });
    } catch { /* silently fail */ }
  },

  showPermissionPrompt() {
    // Non-intrusive slide-down bar (not a modal or browser default)
    if (document.getElementById('push-prompt-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'push-prompt-bar';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;transform:translateY(-100%);transition:transform 0.35s ease;background:var(--surface, #1a1a2e);border-bottom:1px solid var(--border, #333);padding:12px 16px;display:flex;align-items:center;gap:12px;font-size:13px;color:var(--text, #eee);';
    bar.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #ffd700)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <span style="flex:1;">Get notified when your AI tasks complete</span>
      <button id="push-prompt-yes" style="background:var(--accent, #ffd700);color:#000;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;">Enable</button>
      <button id="push-prompt-no" style="background:transparent;border:1px solid var(--border, #555);color:var(--text-secondary, #aaa);border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer;">Not now</button>`;
    document.body.appendChild(bar);

    // Slide in after a brief delay
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { bar.style.transform = 'translateY(0)'; });
    });

    document.getElementById('push-prompt-yes').addEventListener('click', () => PushManager.subscribe());
    document.getElementById('push-prompt-no').addEventListener('click', () => PushManager._dismissPrompt());
  },

  _dismissPrompt() {
    const bar = document.getElementById('push-prompt-bar');
    if (bar) {
      bar.style.transform = 'translateY(-100%)';
      setTimeout(() => bar.remove(), 400);
    }
  },
};

// ═══════════════════════════════════════════════════════════════════
//  Native: View Transitions
// ═══════════════════════════════════════════════════════════════════

function viewTransition(callback) {
  if (document.startViewTransition) {
    document.startViewTransition(callback);
  } else {
    callback();
  }
}

(function patchViewTransitions() {
  if (!document.startViewTransition) return;

  // Patch showChatScreen
  const origShowChat = window.showChatScreen;
  if (typeof origShowChat === 'function') {
    window.showChatScreen = function () {
      document.startViewTransition(() => origShowChat.apply(this, arguments));
    };
  }

  // Patch showWelcomeScreen
  const origShowWelcome = window.showWelcomeScreen;
  if (typeof origShowWelcome === 'function') {
    window.showWelcomeScreen = function () {
      document.startViewTransition(() => origShowWelcome.apply(this, arguments));
    };
  }

  // Patch openConversation
  const origOpenConv = window.openConversation;
  if (typeof origOpenConv === 'function') {
    window.openConversation = function () {
      document.startViewTransition(() => origOpenConv.apply(this, arguments));
    };
  }
})();

// ═══════════════════════════════════════════════════════════════════
//  Native: Web Share (Outbound)
// ═══════════════════════════════════════════════════════════════════

async function shareContent(title, text, url) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      hapticFeedback('success');
    } catch (e) {
      if (e.name !== 'AbortError') copyToClipboard(text || url);
    }
  } else {
    copyToClipboard(text || url);
  }
}

async function shareConversationExcerpt(conversationId) {
  const convo = state.conversations.find(function (c) { return c.id === conversationId; });
  if (!convo) return;

  const title = convo.title || 'AskOzzy Conversation';
  // Get the last few messages as a summary excerpt
  let excerpt = '';
  try {
    const res = await fetch(API + '/api/conversations/' + conversationId + '/messages', { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      const msgs = data.messages || [];
      const last = msgs.slice(-3);
      excerpt = last.map(function (m) { return (m.role === 'user' ? 'You: ' : 'Ozzy: ') + m.content.substring(0, 200); }).join('\n\n');
    }
  } catch { /* use title only */ }

  const text = excerpt || title;
  const url = 'https://askozzy.ghwmelite.workers.dev';
  await shareContent('AskOzzy: ' + title, text, url);
}

async function shareReferralLink() {
  const referralCode = (state.user && state.user.referral_code) ? state.user.referral_code : '';
  const url = 'https://askozzy.ghwmelite.workers.dev' + (referralCode ? '?ref=' + referralCode : '');
  const text = 'Try AskOzzy — AI-powered productivity for Government of Ghana.' + (referralCode ? ' Use my referral code: ' + referralCode : '');
  await shareContent('Join AskOzzy', text, url);
}

// ═══════════════════════════════════════════════════════════════════
//  Native: Enhanced Clipboard
// ═══════════════════════════════════════════════════════════════════

async function copyRichText(html, plaintext) {
  if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
    try {
      var item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plaintext], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      showSyncToast('Copied to clipboard');
      hapticFeedback('success');
    } catch {
      fallbackCopy(plaintext);
    }
  } else {
    fallbackCopy(plaintext);
  }
}

function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* older browser */ }
  ta.remove();
  showSyncToast('Copied to clipboard');
}

// Paste image handler for chat input
(function initPasteImageHandler() {
  document.addEventListener('DOMContentLoaded', function () {
    var chatInput = document.getElementById('chat-input');
    if (!chatInput) return;

    chatInput.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;

      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image/') === 0) {
          e.preventDefault();
          var file = items[i].getAsFile();
          if (file && typeof handleImageFile === 'function') {
            handleImageFile(file);
          }
          break;
        }
      }
    });
  });
})();

// ═══════════════════════════════════════════════════════════════════
//  Native: File System Access
// ═══════════════════════════════════════════════════════════════════

async function saveFile(content, suggestedName, types) {
  if ('showSaveFilePicker' in window) {
    try {
      var handle = await window.showSaveFilePicker({
        suggestedName: suggestedName,
        types: types || [
          { description: 'Text Document', accept: { 'text/plain': ['.txt'] } },
          { description: 'Document', accept: { 'application/octet-stream': ['.docx', '.pdf'] } },
        ],
      });
      var writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      showSyncToast('File saved successfully');
      hapticFeedback('success');
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
      // Fall through to standard download
    }
  }
  // Fallback: standard download
  downloadFile(content, suggestedName);
  return true;
}

function downloadFile(content, filename) {
  var blob = content instanceof Blob ? content : new Blob([content]);
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

// ═══════════════════════════════════════════════════════════════════
//  Native: Media Session (Voice Mode)
// ═══════════════════════════════════════════════════════════════════

function setMediaSession(isActive) {
  if (!('mediaSession' in navigator)) return;
  if (isActive) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'AskOzzy Voice',
      artist: 'AskOzzy AI Assistant',
      album: 'Government of Ghana',
      artwork: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
    navigator.mediaSession.setActionHandler('stop', function () {
      if (typeof toggleVoice === 'function') toggleVoice();
    });
    navigator.mediaSession.setActionHandler('pause', function () {
      if (typeof toggleVoice === 'function') toggleVoice();
    });
  } else {
    navigator.mediaSession.metadata = null;
    try {
      navigator.mediaSession.setActionHandler('stop', null);
      navigator.mediaSession.setActionHandler('pause', null);
    } catch { /* some browsers throw on null handlers */ }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Native: Screen Orientation
// ═══════════════════════════════════════════════════════════════════

async function lockOrientation(orientation) {
  if (!screen.orientation || !screen.orientation.lock) return;
  try {
    await screen.orientation.lock(orientation);
  } catch { /* orientation lock not supported or not in fullscreen */ }
}

function unlockOrientation() {
  if (screen.orientation && screen.orientation.unlock) {
    try { screen.orientation.unlock(); } catch { /* ignore */ }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Native: Idle Detection (Auto-save drafts)
// ═══════════════════════════════════════════════════════════════════

async function initIdleDetection() {
  if (!('IdleDetector' in window)) return;
  try {
    var permission = await IdleDetector.requestPermission();
    if (permission !== 'granted') return;

    var detector = new IdleDetector();
    detector.addEventListener('change', function () {
      if (detector.userState === 'idle') {
        // Auto-save draft message
        var input = document.getElementById('chat-input');
        if (input && input.value.trim()) {
          localStorage.setItem('askozzy_draft', JSON.stringify({
            text: input.value,
            conversationId: state.activeConversationId,
            timestamp: Date.now(),
          }));
        }
      }
    });
    await detector.start({ threshold: 120000 }); // 2 minutes idle threshold
  } catch { /* permission denied or unsupported */ }
}

// ═══════════════════════════════════════════════════════════════════
//  Native: Contact Picker (Referrals)
// ═══════════════════════════════════════════════════════════════════

async function pickContactForReferral() {
  if (!('contacts' in navigator && 'ContactsManager' in window)) {
    // Fallback: use Web Share for referral
    shareReferralLink();
    return;
  }
  try {
    var contacts = await navigator.contacts.select(['name', 'email', 'tel'], { multiple: false });
    if (contacts.length > 0) {
      var contact = contacts[0];
      var referralCode = (state.user && state.user.referral_code) ? state.user.referral_code : '';
      var contactName = (contact.name && contact.name[0]) ? contact.name[0] : 'there';
      var msg = 'Hey ' + contactName + '! Try AskOzzy \u2014 AI for Government of Ghana. Use my code: ' + referralCode + '\nhttps://askozzy.ghwmelite.workers.dev?ref=' + referralCode;

      if (contact.email && contact.email[0]) {
        window.open('mailto:' + contact.email[0] + '?subject=Try AskOzzy&body=' + encodeURIComponent(msg));
      } else if (contact.tel && contact.tel[0]) {
        window.open('sms:' + contact.tel[0] + '?body=' + encodeURIComponent(msg));
      } else {
        // No email or phone, share via Web Share
        await shareContent('Join AskOzzy', msg, 'https://askozzy.ghwmelite.workers.dev?ref=' + referralCode);
      }
      hapticFeedback('success');
    }
  } catch {
    shareReferralLink();
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Native: Draft Restoration
// ═══════════════════════════════════════════════════════════════════

(function restoreDraft() {
  document.addEventListener('DOMContentLoaded', function () {
    var draft = localStorage.getItem('askozzy_draft');
    if (!draft) return;
    try {
      var parsed = JSON.parse(draft);
      var text = parsed.text;
      var timestamp = parsed.timestamp;
      // Only restore if less than 24 hours old
      if (Date.now() - timestamp > 86400000) {
        localStorage.removeItem('askozzy_draft');
        return;
      }
      var input = document.getElementById('chat-input');
      if (input && !input.value) {
        input.value = text;
        if (typeof autoResizeInput === 'function') autoResizeInput();
        showSyncToast('Draft restored');
      }
    } catch {
      localStorage.removeItem('askozzy_draft');
    }
  });
})();

// ═══════════════════════════════════════════════════════════════════
//  Native: Feature Initialization
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function () {
  // Push notifications: init after a delay so it doesn't disrupt initial load
  setTimeout(function () { PushManager.init(); }, 5000);

  // Idle detection for draft auto-save
  initIdleDetection();

  // Increment conversation count for push notification gating
  // (triggered when user successfully sends a message — tracked here as a proxy)
  var convCountKey = 'askozzy_conv_count';
  var currentCount = parseInt(localStorage.getItem(convCountKey) || '0', 10);
  if (state.conversations && state.conversations.length > currentCount) {
    localStorage.setItem(convCountKey, String(state.conversations.length));
  }

  // Listen for SW navigation messages (e.g., push notification click)
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'NAVIGATE') {
        window.location.href = e.data.url;
      }
    });
  }
});

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
  const proPrice = isStudent() ? 25 : 60;
  const go = confirm(`Folders are a premium feature!\n\nUpgrade to Professional (GHS ${proPrice}/mo) or higher to organize your conversations into folders.\n\nWould you like to view plans?`);
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

// ─── Web Search Toggle ──────────────────────────────────────────────

function toggleWebSearch() {
  state.webSearchEnabled = !state.webSearchEnabled;
  const btn = document.getElementById("btn-web-search");
  if (btn) {
    btn.classList.toggle("active", state.webSearchEnabled);
    btn.title = state.webSearchEnabled ? "Web search ON — click to disable" : "Search the web";
  }
}

// ─── Language / Translation ─────────────────────────────────────────

function changeLanguage(lang) {
  state.language = lang;
  const btn = document.getElementById('lang-selector');
  const langNames = { en: 'EN', fr: 'FR', ha: 'HA', tw: 'TW', ga: 'GA', ee: 'EW', dag: 'DG' };
  if (btn) btn.textContent = langNames[lang] || 'EN';
  // Update placeholder
  const input = document.getElementById('chat-input');
  if (input && lang !== 'en') {
    const placeholders = {
      tw: 'Bisa Ozzy biribiara... (Twi)',
      ha: 'Tambayi Ozzy komai... (Hausa)',
      ga: 'Bi Ozzy nu... (Ga)',
      ee: 'Bia Ozzy nu... (Ewe)',
      fr: 'Demandez \u00e0 Ozzy... (Fran\u00e7ais)',
      dag: 'Bui Ozzy soli... (Dagbani)',
    };
    input.placeholder = placeholders[lang] || 'Ask Ozzy anything...';
  } else if (input) {
    input.placeholder = 'Ask Ozzy anything... (Shift+Enter for new line)';
  }
  // Update speech recognition language when language changes
  if (_recognition) {
    _recognition.lang = getRecognitionLang();
  }
}

function openLanguageMenu() {
  const languages = [
    { code: 'en', name: 'English', flag: '\u{1F1EC}\u{1F1E7}' },
    { code: 'tw', name: 'Twi (Akan)', flag: '\u{1F1EC}\u{1F1ED}' },
    { code: 'ga', name: 'Ga', flag: '\u{1F1EC}\u{1F1ED}' },
    { code: 'ee', name: 'Ewe', flag: '\u{1F1EC}\u{1F1ED}' },
    { code: 'ha', name: 'Hausa', flag: '\u{1F1EC}\u{1F1ED}' },
    { code: 'fr', name: 'Fran\u00e7ais', flag: '\u{1F1EB}\u{1F1F7}' },
    { code: 'dag', name: 'Dagbani', flag: '\u{1F1EC}\u{1F1ED}' },
  ];

  let menu = document.getElementById('lang-menu');
  if (menu) {
    menu.classList.toggle('active');
    return;
  }

  menu = document.createElement('div');
  menu.id = 'lang-menu';
  menu.className = 'lang-menu active';
  menu.innerHTML = languages.map(l =>
    `<button class="lang-option ${state.language === l.code ? 'active' : ''}" onclick="changeLanguage('${l.code}'); document.getElementById('lang-menu').classList.remove('active');">
      <span>${l.flag}</span> ${l.name}
    </button>`
  ).join('');

  const btn = document.getElementById('lang-selector');
  if (btn) btn.parentElement.appendChild(menu);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function closeLang(e) {
      if (!menu.contains(e.target) && e.target.id !== 'lang-selector') {
        menu.classList.remove('active');
        document.removeEventListener('click', closeLang);
      }
    });
  }, 10);
}

async function translateMessage(text, targetLang) {
  if (!state.token || targetLang === 'en') return text;
  try {
    const res = await fetch(`${API}/api/translate`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ text, sourceLang: 'en', targetLang }),
    });
    const data = await res.json();
    return data.translated || text;
  } catch {
    return text;
  }
}

// ─── Text-to-Speech ─────────────────────────────────────────────────

function speakMessage(index) {
  const msg = state.messages[index];
  if (!msg || msg.role !== 'assistant') return;

  // Stop any current speech
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    return;
  }

  const text = msg.content.replace(/\*\*|__|`{1,3}|#{1,6}\s|>\s|\[.*?\]\(.*?\)/g, '').replace(/<[^>]*>/g, '');
  const utterance = new SpeechSynthesisUtterance(text.substring(0, 5000));

  // Map language codes to speech synthesis lang
  const langMap = { en: 'en-GB', fr: 'fr-FR', ha: 'ha', tw: 'ak', ga: 'gaa', ee: 'ee', dag: 'dag' };
  utterance.lang = langMap[state.language] || 'en-GB';
  utterance.rate = 0.95;
  utterance.pitch = 1;

  // Update button state
  const btn = document.querySelector(`[data-speak="${index}"]`);
  if (btn) btn.classList.add('speaking');

  utterance.onend = () => {
    if (btn) btn.classList.remove('speaking');
    // In voice mode, auto-focus input for next question
    if (state.voiceMode) {
      setTimeout(() => toggleVoice(), 300);
    }
  };

  window.speechSynthesis.speak(utterance);
}

function toggleVoiceMode() {
  state.voiceMode = !state.voiceMode;
  const btn = document.getElementById('btn-voice-mode');
  if (btn) btn.classList.toggle('active', state.voiceMode);

  if (state.voiceMode) {
    // Start listening immediately
    toggleVoice();
  }
}

// ─── Image / Vision Upload ──────────────────────────────────────────

function openImageUpload() {
  requireAuth(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.onchange = (e) => {
      const file = Array.from(e.target.files)[0];
      if (!file) return;
      handleImageFile(file);
    };
    input.click();
  });
}

function openCamera() {
  requireAuth(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      showCameraPreview(stream);
    } catch (err) {
      alert('Camera access denied. Please allow camera access and try again.');
    }
  });
}

function showCameraPreview(stream) {
  let overlay = document.getElementById('camera-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'camera-overlay';
    overlay.className = 'camera-overlay';
    overlay.innerHTML = `
      <div class="camera-container">
        <video id="camera-video" autoplay playsinline></video>
        <div class="camera-controls">
          <button class="camera-btn cancel" onclick="closeCamera()">&#x2715;</button>
          <button class="camera-btn capture" onclick="capturePhoto()">&#x1F4F7;</button>
          <button class="camera-btn switch" onclick="switchCamera()">&#x1F504;</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }

  overlay.classList.add('active');
  const video = document.getElementById('camera-video');
  video.srcObject = stream;
  overlay._stream = stream;
}

function closeCamera() {
  const overlay = document.getElementById('camera-overlay');
  if (overlay) {
    const video = document.getElementById('camera-video');
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    if (overlay._stream) {
      overlay._stream.getTracks().forEach(t => t.stop());
    }
    overlay.classList.remove('active');
  }
}

async function switchCamera() {
  closeCamera();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    showCameraPreview(stream);
  } catch {}
}

function capturePhoto() {
  const video = document.getElementById('camera-video');
  if (!video) return;

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  canvas.toBlob((blob) => {
    closeCamera();
    const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    handleImageFile(file);
  }, 'image/jpeg', 0.85);
}

function handleImageFile(file) {
  if (file.size > 5 * 1024 * 1024) {
    alert('Image must be under 5MB');
    return;
  }

  // Show preview
  showImagePreview(file);
}

function showImagePreview(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    let preview = document.getElementById('image-preview');
    if (!preview) {
      preview = document.createElement('div');
      preview.id = 'image-preview';
      preview.className = 'image-preview';
      const inputWrapper = document.querySelector('.input-wrapper');
      if (inputWrapper) inputWrapper.insertBefore(preview, inputWrapper.firstChild);
    }

    preview.innerHTML = `
      <div class="image-preview-inner">
        <img src="${e.target.result}" alt="Preview" />
        <div class="image-preview-actions">
          <select id="vision-mode" class="vision-mode-select">
            <option value="describe">Describe</option>
            <option value="ocr">Extract Text (OCR)</option>
            <option value="form">Extract Form Data</option>
            <option value="receipt">Process Receipt</option>
          </select>
          <button onclick="sendImageMessage()" class="btn-send-image">Analyse</button>
          <button onclick="clearImagePreview()" class="btn-clear-image">&#x2715;</button>
        </div>
      </div>`;
    preview.classList.add('active');
    preview._file = file;
  };
  reader.readAsDataURL(file);
}

function clearImagePreview() {
  const preview = document.getElementById('image-preview');
  if (preview) {
    preview.classList.remove('active');
    preview._file = null;
    preview.innerHTML = '';
  }
}

async function sendImageMessage() {
  const preview = document.getElementById('image-preview');
  const file = preview?._file;
  if (!file) return;

  const mode = document.getElementById('vision-mode')?.value || 'describe';
  const chatInput = document.getElementById('chat-input');
  const customPrompt = chatInput.value.trim();

  clearImagePreview();
  chatInput.value = '';
  showChatScreen();

  // Create conversation if needed
  if (!state.activeConversationId) {
    try {
      const res = await fetch(`${API}/api/conversations`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ title: 'Image Analysis', model: state.selectedModel }),
      });
      const data = await res.json();
      state.activeConversationId = data.id;
      await loadConversations();
    } catch {
      alert('Failed to create conversation');
      return;
    }
  }

  // Show user message with image thumbnail
  const imgUrl = URL.createObjectURL(file);
  state.messages.push({ role: 'user', content: `[Image: ${file.name}] ${customPrompt || mode}`, imageUrl: imgUrl });
  renderMessages();
  addTypingIndicator();
  state.isStreaming = true;
  updateSendButton();

  try {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('conversationId', state.activeConversationId);
    formData.append('mode', mode);
    if (customPrompt) formData.append('prompt', customPrompt);
    formData.append('model', state.selectedModel);

    const res = await fetch(`${API}/api/chat/image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
      body: formData,
    });

    removeTypingIndicator();

    if (!res.ok) {
      const err = await res.json();
      if (err.code === 'TIER_REQUIRED') {
        state.messages.push({ role: 'assistant', content: '**Image understanding requires a Professional plan or above.** Upgrade to unlock image analysis, OCR, and document scanning.' });
        renderMessages();
        return;
      }
      throw new Error(err.error || 'Image analysis failed');
    }

    const data = await res.json();
    state.messages.push({ role: 'assistant', content: data.response });
    renderMessages();
    await loadConversations();
  } catch (err) {
    removeTypingIndicator();
    state.messages.push({ role: 'assistant', content: `**Error:** ${err.message}` });
    renderMessages();
  } finally {
    state.isStreaming = false;
    updateSendButton();
  }
}

// ─── Deep Research Mode ─────────────────────────────────────────────

function openDeepResearch() {
  requireAuth(() => {
    const input = document.getElementById("chat-input");
    const query = input.value.trim();
    if (!query) {
      input.placeholder = "Type your research question, then click Deep Research...";
      input.focus();
      return;
    }
    startResearch(query);
  });
}

async function startResearch(query) {
  if (state.isStreaming) return;

  // Create conversation if needed
  if (!state.activeConversationId) {
    try {
      const res = await fetch(`${API}/api/conversations`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          title: "Research: " + (query.length > 50 ? query.substring(0, 47) + "..." : query),
          model: state.selectedModel,
        }),
      });
      const data = await res.json();
      state.activeConversationId = data.id;
      showChatScreen();
      await loadConversations();
    } catch (err) {
      alert("Failed to create conversation");
      return;
    }
  }

  const input = document.getElementById("chat-input");
  input.value = "";
  autoResizeInput();
  updateSendButton();

  // Add user message
  state.messages.push({ role: "user", content: query });
  renderMessages();

  // Add research progress card
  const researchCardId = "research-card-" + Date.now();
  const container = document.getElementById("chat-messages");
  const card = document.createElement("div");
  card.id = researchCardId;
  card.className = "message assistant";
  card.innerHTML = `
    <div class="message-avatar">G</div>
    <div class="message-body">
      <div class="message-sender">AskOzzy Deep Research</div>
      <div class="research-card">
        <div class="research-progress">
          <div class="research-progress-bar" id="${researchCardId}-bar" style="width:0%"></div>
        </div>
        <div class="research-step" id="${researchCardId}-step">Initialising research...</div>
        <div class="research-sources" id="${researchCardId}-sources">
          <div class="sources-label">Sources found:</div>
        </div>
      </div>
    </div>`;
  container.appendChild(card);
  scrollToBottom();

  state.isStreaming = true;
  updateSendButton();

  try {
    const res = await fetch(`${API}/api/research`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        query,
        conversationId: state.activeConversationId,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      if (err.code === "TIER_REQUIRED") {
        card.querySelector(".research-card").innerHTML = `
          <div style="text-align:center;padding:20px;">
            <div style="font-size:32px;margin-bottom:12px;">&#x1F512;</div>
            <h4>Professional Plan Required</h4>
            <p style="color:var(--text-secondary);margin:8px 0 16px;">Deep Research is available on Professional and Enterprise plans.</p>
            <button class="btn-auth" onclick="openPricingModal()" style="padding:10px 24px;">View Plans</button>
          </div>`;
        return;
      }
      throw new Error(err.error || "Research failed");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let currentEvent = "";
    let allSources = [];
    let report = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
          continue;
        }
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));

            if (currentEvent === "research:step") {
              const pct = (data.step / data.total) * 100;
              const bar = document.getElementById(`${researchCardId}-bar`);
              const stepEl = document.getElementById(`${researchCardId}-step`);
              if (bar) bar.style.width = pct + "%";
              if (stepEl) stepEl.textContent = `Step ${data.step}/${data.total}: ${data.description}`;
              scrollToBottom();
            }

            if (currentEvent === "research:source") {
              allSources.push(data);
              const sourcesEl = document.getElementById(`${researchCardId}-sources`);
              if (sourcesEl) {
                const sourceItem = document.createElement("a");
                sourceItem.href = data.url;
                sourceItem.target = "_blank";
                sourceItem.rel = "noopener";
                sourceItem.className = "source-card";
                const domain = (() => { try { return new URL(data.url).hostname.replace('www.', ''); } catch { return ''; } })();
                sourceItem.innerHTML = `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16" alt="" class="source-favicon" /><span class="source-title">${escapeHtml(data.title.substring(0, 50))}</span>`;
                sourcesEl.appendChild(sourceItem);
                scrollToBottom();
              }
            }

            if (currentEvent === "research:complete") {
              report = data.report;
              // Replace the research card with the final report
              state.messages.push({
                role: "assistant",
                content: report,
                webSources: data.sources || allSources,
                isResearch: true,
              });
              card.remove();
              renderMessages();

              // Auto-open in artifact panel
              const artifact = { type: "document", title: "Research Report", content: report };
              openArtifactPanel(artifact);
            }

            if (currentEvent === "research:error") {
              card.querySelector(".research-card").innerHTML = `<div style="color:var(--red-error-text);padding:16px;">Research failed: ${escapeHtml(data.error)}</div>`;
            }
          } catch {}
          currentEvent = "";
        }
      }
    }

    await loadConversations();
  } catch (err) {
    const cardEl = document.getElementById(researchCardId);
    if (cardEl) {
      cardEl.querySelector(".research-card").innerHTML = `<div style="color:var(--red-error-text);padding:16px;">Error: ${escapeHtml(err.message)}</div>`;
    }
  } finally {
    state.isStreaming = false;
    updateSendButton();
  }
}

// ─── Data Analysis Mode ─────────────────────────────────────────────

function openDataAnalysis() {
  requireAuth(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.xlsx";
    input.onchange = async (e) => {
      const file = Array.from(e.target.files)[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        alert("File size must be under 10MB");
        return;
      }
      await analyzeData(file);
    };
    input.click();
  });
}

function parseCSV(text) {
  const rows = [];
  let current = "";
  let inQuotes = false;
  const lines = text.split("\n");

  for (const line of lines) {
    const cells = [];
    let cell = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cell += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += ch;
      }
    }
    cells.push(cell.trim());
    if (cells.some(c => c)) rows.push(cells);
  }
  return rows;
}

async function analyzeData(file, prompt) {
  showChatScreen();

  // Create conversation if needed
  if (!state.activeConversationId) {
    try {
      const res = await fetch(`${API}/api/conversations`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          title: "Analysis: " + file.name,
          model: state.selectedModel,
        }),
      });
      const data = await res.json();
      state.activeConversationId = data.id;
      await loadConversations();
    } catch {
      alert("Failed to create conversation");
      return;
    }
  }

  // Show processing indicator
  state.messages.push({ role: "user", content: `Analyze data: ${file.name}${prompt ? '\n' + prompt : ''}` });
  renderMessages();
  addTypingIndicator();
  state.isStreaming = true;
  updateSendButton();

  try {
    const formData = new FormData();
    formData.append("file", file);
    if (prompt) formData.append("prompt", prompt);

    const res = await fetch(`${API}/api/analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${state.token}` },
      body: formData,
    });

    removeTypingIndicator();

    if (!res.ok) {
      const err = await res.json();
      if (err.code === "TIER_REQUIRED") {
        state.messages.push({
          role: "assistant",
          content: "**Data Analysis requires a Professional plan or above.** Upgrade to unlock data analysis, chart generation, and insights.\n\n[View Plans](#)",
        });
        renderMessages();
        return;
      }
      throw new Error(err.error || "Analysis failed");
    }

    const data = await res.json();

    // Build analysis summary message
    let msgContent = `**Data Analysis: ${file.name}**\n\n`;
    msgContent += `**Summary:** ${data.summary}\n\n`;
    if (data.insights && data.insights.length > 0) {
      msgContent += `**Key Insights:**\n`;
      data.insights.forEach((ins, i) => { msgContent += `${i + 1}. ${ins}\n`; });
    }
    msgContent += `\n*${data.rawData?.totalRows || 0} rows analysed. Open the analysis panel for charts and data table.*`;

    state.messages.push({ role: "assistant", content: msgContent });
    renderMessages();

    // Open analysis in artifact panel
    openAnalysisPanel(data, file.name);

  } catch (err) {
    removeTypingIndicator();
    state.messages.push({ role: "assistant", content: `**Error:** ${err.message}` });
    renderMessages();
  } finally {
    state.isStreaming = false;
    updateSendButton();
  }
}

function openAnalysisPanel(data, fileName) {
  let panel = document.getElementById("artifact-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "artifact-panel";
    panel.className = "artifact-panel";
    panel.innerHTML = `
      <div class="artifact-header">
        <div class="artifact-title-area">
          <span class="artifact-type-icon"></span>
          <span class="artifact-title"></span>
        </div>
        <div class="artifact-actions">
          <button onclick="copyArtifact()" title="Copy">&#x1F4CB;</button>
          <button onclick="downloadArtifact()" title="Download">&#x1F4BE;</button>
          <button onclick="closeArtifactPanel()" title="Close">&#x2715;</button>
        </div>
      </div>
      <div class="artifact-content" id="artifact-content"></div>
    `;
    document.querySelector(".main-content").appendChild(panel);
  }

  panel.querySelector(".artifact-type-icon").textContent = "&#x1F4CA;";
  panel.querySelector(".artifact-title").textContent = "Data Analysis: " + (fileName || "");

  const contentEl = panel.querySelector("#artifact-content");

  // Tabs
  let html = `<div class="analysis-tabs">
    <button class="analysis-tab active" onclick="switchAnalysisTab('summary', this)">Summary</button>
    <button class="analysis-tab" onclick="switchAnalysisTab('charts', this)">Charts</button>
    <button class="analysis-tab" onclick="switchAnalysisTab('data', this)">Data Table</button>
  </div>`;

  // Summary tab
  html += `<div class="analysis-tab-content" id="analysis-tab-summary">
    <div class="analysis-summary"><p>${escapeHtml(data.summary || '')}</p></div>
    <h4>Key Insights</h4>
    <ul class="analysis-insights">
      ${(data.insights || []).map(ins => `<li>${escapeHtml(ins)}</li>`).join("")}
    </ul>
    <button class="btn-template-picker" onclick="downloadAnalysisReport()" style="margin-top:16px;">&#x1F4E5; Download Report</button>
  </div>`;

  // Charts tab
  html += `<div class="analysis-tab-content hidden" id="analysis-tab-charts">
    ${(data.chartConfigs || []).map((cfg, i) => `
      <div class="chart-container">
        <h4>${escapeHtml(cfg.title || 'Chart ' + (i + 1))}</h4>
        <canvas id="analysis-chart-${i}" width="400" height="250"></canvas>
      </div>
    `).join("") || '<p style="color:var(--text-muted);padding:20px;">No chart suggestions available for this dataset.</p>'}
  </div>`;

  // Data Table tab
  html += `<div class="analysis-tab-content hidden" id="analysis-tab-data">`;
  if (data.rawData && data.rawData.headers) {
    html += `<div class="data-table-wrapper"><table class="data-table">
      <thead><tr>${data.rawData.headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
      <tbody>${(data.rawData.rows || []).slice(0, 100).map(row =>
        `<tr>${row.map(c => `<td>${escapeHtml(String(c))}</td>`).join("")}</tr>`
      ).join("")}</tbody>
    </table></div>`;
    if (data.rawData.totalRows > 100) {
      html += `<p style="color:var(--text-muted);font-size:12px;padding:8px;">Showing first 100 of ${data.rawData.totalRows} rows</p>`;
    }
  }
  html += `</div>`;

  contentEl.innerHTML = html;

  // Store data for export
  state.currentArtifact = { type: "analysis", title: "Data Analysis: " + fileName, content: JSON.stringify(data, null, 2), analysisData: data };
  panel.classList.add("open");
  document.querySelector(".main-content").classList.add("has-artifact");

  // Render charts with Chart.js
  if (typeof Chart !== "undefined" && data.chartConfigs) {
    const ghanaColors = ["#CE1126", "#FCD116", "#006B3F", "#1a1d27", "#e8eaed", "#00a86b", "#b89a10", "#ff6b7a"];
    setTimeout(() => {
      data.chartConfigs.forEach((cfg, i) => {
        const canvas = document.getElementById(`analysis-chart-${i}`);
        if (!canvas) return;
        try {
          const datasets = (cfg.datasets || []).map((ds, di) => ({
            ...ds,
            backgroundColor: cfg.type === "pie" || cfg.type === "doughnut"
              ? ghanaColors.slice(0, (ds.data || []).length)
              : ghanaColors[di % ghanaColors.length] + "CC",
            borderColor: cfg.type === "line" ? ghanaColors[di % ghanaColors.length] : undefined,
            borderWidth: cfg.type === "line" ? 2 : 1,
          }));
          new Chart(canvas, {
            type: cfg.type || "bar",
            data: { labels: cfg.labels || [], datasets },
            options: {
              responsive: true,
              plugins: { legend: { labels: { color: "var(--text-primary)" } } },
              scales: cfg.type === "pie" || cfg.type === "doughnut" ? {} : {
                x: { ticks: { color: "var(--text-secondary)" } },
                y: { ticks: { color: "var(--text-secondary)" } },
              },
            },
          });
        } catch (e) {
          console.error("Chart render error:", e);
        }
      });
    }, 100);
  }
}

function switchAnalysisTab(tab, btn) {
  document.querySelectorAll(".analysis-tab-content").forEach(el => el.classList.add("hidden"));
  document.querySelectorAll(".analysis-tab").forEach(el => el.classList.remove("active"));
  const tabEl = document.getElementById("analysis-tab-" + tab);
  if (tabEl) tabEl.classList.remove("hidden");
  if (btn) btn.classList.add("active");
}

function downloadAnalysisReport() {
  if (!state.currentArtifact?.analysisData) return;
  const data = state.currentArtifact.analysisData;
  let text = "DATA ANALYSIS REPORT\n" + "=".repeat(50) + "\n\n";
  text += "SUMMARY\n" + data.summary + "\n\n";
  text += "KEY INSIGHTS\n";
  (data.insights || []).forEach((ins, i) => { text += `${i + 1}. ${ins}\n`; });
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "analysis-report.txt";
  link.click();
  URL.revokeObjectURL(url);
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

// ─── AI Memory ──────────────────────────────────────────────────────

async function loadMemories() {
  if (!isLoggedIn()) return;
  try {
    const res = await fetch(`${API}/api/memories`, { headers: authHeaders() });
    const data = await res.json();
    state.memories = data.memories || [];
  } catch {}
}

function openMemoryModal() {
  // Create/show a modal listing all user memories with edit/delete
  // Each memory: key (bold), value, delete button
  // Add new memory form at bottom: key input, value input, save button
  // Title: "Ozzy's Memory — What I know about you"
  // Subtitle: "Ozzy uses these to personalize responses. You can edit or remove any item."

  let html = '<div class="memory-list">';
  const memories = state.memories || [];
  if (memories.length === 0) {
    html += '<div style="text-align:center;padding:20px;color:var(--text-muted);">No memories yet. As you chat, Ozzy will learn about you — or add details manually below.</div>';
  }
  for (const m of memories) {
    html += `<div class="memory-item" id="memory-${m.id}">
      <div class="memory-content">
        <span class="memory-key">${escapeHtml(m.key)}</span>
        <span class="memory-value">${escapeHtml(m.value)}</span>
      </div>
      <button class="memory-delete" onclick="deleteMemory('${m.id}')" title="Remove">×</button>
    </div>`;
  }
  html += '</div>';
  html += `<div class="memory-add">
    <input type="text" id="memory-new-key" placeholder="e.g., Department" style="flex:1;" />
    <input type="text" id="memory-new-value" placeholder="e.g., Ministry of Finance" style="flex:2;" />
    <button onclick="addMemory()">Add</button>
  </div>`;
  html += `<div style="font-size:11px;color:var(--text-muted);margin-top:12px;text-align:center;">${memories.length} / 20 memory slots used</div>`;

  // Use a generic modal approach - create overlay if not exists
  let overlay = document.getElementById('memory-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'memory-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal" style="max-width:560px;">
      <div class="modal-header">
        <div>
          <h3>🧠 Ozzy's Memory</h3>
          <p style="font-size:12px;color:var(--text-muted);margin:4px 0 0;">What Ozzy knows about you — used to personalize responses</p>
        </div>
        <button class="modal-close" onclick="closeMemoryModal()">✕</button>
      </div>
      <div class="modal-body" id="memory-modal-body" style="padding:16px;"></div>
    </div>`;
    document.body.appendChild(overlay);
  }
  document.getElementById('memory-modal-body').innerHTML = html;
  overlay.classList.add('active');
}

function closeMemoryModal() {
  const el = document.getElementById('memory-modal');
  if (el) el.classList.remove('active');
}

async function addMemory() {
  const keyEl = document.getElementById('memory-new-key');
  const valEl = document.getElementById('memory-new-value');
  const key = keyEl.value.trim();
  const value = valEl.value.trim();
  if (!key || !value) return;
  try {
    await fetch(`${API}/api/memories`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ key, value }),
    });
    keyEl.value = '';
    valEl.value = '';
    await loadMemories();
    openMemoryModal(); // refresh
  } catch {}
}

async function deleteMemory(id) {
  try {
    await fetch(`${API}/api/memories/${id}`, { method: 'DELETE', headers: authHeaders() });
    await loadMemories();
    // Remove from DOM immediately
    const el = document.getElementById('memory-' + id);
    if (el) el.remove();
  } catch {}
}

// ─── Artifacts / Canvas ─────────────────────────────────────────────

function detectArtifact(content) {
  // Client-side heuristic detection (fast, no API call needed)
  // Returns { type, title } or null

  // Check for code blocks
  const codeMatch = content.match(/```(\w+)?\n([\s\S]{100,}?)```/);
  if (codeMatch) {
    return { type: 'code', title: codeMatch[1] ? `${codeMatch[1]} Code` : 'Code', content: codeMatch[2] };
  }

  // Check for document markers (memos, letters, reports)
  const docPatterns = [
    /(?:MEMORANDUM|MEMO|OFFICE\s+OF|MINISTRY\s+OF|REPUBLIC\s+OF|GOVERNMENT\s+OF)/i,
    /(?:Dear\s+(?:Sir|Madam|Hon|Dr|Mr|Mrs|Ms))/i,
    /(?:RE:|REF:|SUBJECT:)/i,
  ];
  const isDocument = docPatterns.some(p => p.test(content)) && content.length > 300;
  if (isDocument) {
    const titleMatch = content.match(/(?:RE:|SUBJECT:|MEMORANDUM|MEMO)[:\s]*([^\n]+)/i);
    return { type: 'document', title: titleMatch ? titleMatch[1].trim().slice(0, 60) : 'Document', content };
  }

  // Check for tables (markdown tables with |)
  const tableLines = content.split('\n').filter(l => l.includes('|') && l.trim().startsWith('|'));
  if (tableLines.length >= 3) {
    return { type: 'table', title: 'Data Table', content };
  }

  return null;
}

function openArtifactPanel(artifact) {
  // Show the artifact in a side panel (or overlay on mobile)
  let panel = document.getElementById('artifact-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'artifact-panel';
    panel.className = 'artifact-panel';
    panel.innerHTML = `
      <div class="artifact-header">
        <div class="artifact-title-area">
          <span class="artifact-type-icon"></span>
          <span class="artifact-title"></span>
        </div>
        <div class="artifact-actions">
          <button onclick="copyArtifact()" title="Copy">📋</button>
          <button onclick="downloadArtifact()" title="Download">💾</button>
          <button onclick="closeArtifactPanel()" title="Close">✕</button>
        </div>
      </div>
      <div class="artifact-content" id="artifact-content"></div>
    `;
    // Insert next to main content
    document.querySelector('.main-content').appendChild(panel);
  }

  const icons = { document: '📄', code: '💻', table: '📊', list: '📋' };
  panel.querySelector('.artifact-type-icon').textContent = icons[artifact.type] || '📄';
  panel.querySelector('.artifact-title').textContent = artifact.title;

  const contentEl = panel.querySelector('#artifact-content');

  if (artifact.type === 'code') {
    contentEl.innerHTML = `<pre class="artifact-code"><code>${escapeHtml(artifact.content)}</code></pre>`;
  } else if (artifact.type === 'table') {
    // Render markdown table as HTML table
    contentEl.innerHTML = renderMarkdownTable(artifact.content);
  } else {
    // Document — render as editable rich text
    contentEl.innerHTML = `<div class="artifact-document" contenteditable="true">${renderMarkdown(artifact.content)}</div>`;
  }

  state.currentArtifact = artifact;
  panel.classList.add('open');
  document.querySelector('.main-content').classList.add('has-artifact');
}

function renderMarkdownTable(content) {
  const lines = content.split('\n').filter(l => l.trim().startsWith('|'));
  if (lines.length < 2) return '<pre>' + escapeHtml(content) + '</pre>';

  let html = '<table class="artifact-table">';
  lines.forEach((line, i) => {
    if (line.includes('---')) return; // separator row
    const cells = line.split('|').filter(c => c.trim());
    const tag = i === 0 ? 'th' : 'td';
    html += '<tr>' + cells.map(c => `<${tag}>${escapeHtml(c.trim())}</${tag}>`).join('') + '</tr>';
  });
  html += '</table>';
  return html;
}

function closeArtifactPanel() {
  const panel = document.getElementById('artifact-panel');
  if (panel) panel.classList.remove('open');
  document.querySelector('.main-content').classList.remove('has-artifact');
  state.currentArtifact = null;
}

function copyArtifact() {
  if (!state.currentArtifact) return;
  navigator.clipboard.writeText(state.currentArtifact.content).then(() => {
    const btn = document.querySelector('.artifact-actions button');
    if (btn) { btn.textContent = '✓'; setTimeout(() => btn.textContent = '📋', 1500); }
  });
}

async function downloadArtifact() {
  if (!state.currentArtifact) return;
  const a = state.currentArtifact;

  // Use proper DOCX for document-type artifacts
  if (a.type === 'document' && typeof docx !== 'undefined') {
    try {
      const doc = _buildGoGDocx(a.content, a.title || 'Document');
      const blob = await docx.Packer.toBlob(doc);
      const filename = (a.title || 'document').replace(/[^a-zA-Z0-9-_ ]/g, '') + '.docx';
      _triggerDownload(blob, filename);
      return;
    } catch (err) { console.error('DOCX artifact generation failed:', err); }
  }

  // Fallback for code, table, or when docx unavailable
  const ext = a.type === 'code' ? '.txt' : a.type === 'table' ? '.csv' : '.md';
  let content = a.content;
  if (a.type === 'table') {
    const lines = content.split('\n').filter(l => l.includes('|') && !l.includes('---'));
    content = lines.map(l => l.split('|').filter(c => c.trim()).map(c => '"' + c.trim() + '"').join(',')).join('\n');
  }
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = (a.title || 'artifact').replace(/[^a-zA-Z0-9-_ ]/g, '') + ext;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Custom Agents ──────────────────────────────────────────────────

async function loadAgents() {
  try {
    const res = await fetch(`${API}/api/agents?user_type=${state.userType || 'gog_employee'}`);
    const data = await res.json();
    state.agents = data.agents || [];
    renderAgentSelector();
  } catch {}
}

function renderAgentSelector() {
  const agents = state.agents || [];
  if (agents.length === 0) return;

  // Add agent selector button next to model selector in header
  let agentBtn = document.getElementById('agent-selector-btn');
  if (!agentBtn) {
    agentBtn = document.createElement('button');
    agentBtn.id = 'agent-selector-btn';
    agentBtn.className = 'agent-selector-btn';
    agentBtn.onclick = openAgentModal;
    // Insert after model selector
    const modelSelector = document.getElementById('model-selector');
    if (modelSelector) modelSelector.parentNode.insertBefore(agentBtn, modelSelector.nextSibling);
  }

  const active = state.selectedAgent;
  if (active) {
    const agent = agents.find(a => a.id === active);
    agentBtn.innerHTML = `<span>${agent ? agent.icon : '🤖'}</span> ${agent ? agent.name : 'Agent'}`;
    agentBtn.classList.add('active');
  } else {
    agentBtn.innerHTML = '🤖 Agents';
    agentBtn.classList.remove('active');
  }
}

function openAgentModal() {
  const agents = state.agents || [];
  let overlay = document.getElementById('agent-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'agent-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal" style="max-width:640px;">
      <div class="modal-header">
        <h3>🤖 Choose an AI Agent</h3>
        <button class="modal-close" onclick="closeAgentModal()">✕</button>
      </div>
      <div class="modal-body" id="agent-modal-body" style="padding:16px;"></div>
    </div>`;
    document.body.appendChild(overlay);
  }

  let html = `<p style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">Agents are specialized AI assistants trained for specific government departments and tasks.</p>`;

  // "No agent" option (general Ozzy)
  html += `<div class="agent-card ${!state.selectedAgent ? 'active' : ''}" onclick="selectAgent(null)">
    <div class="agent-icon">⚡</div>
    <div class="agent-info">
      <div class="agent-name">General Ozzy</div>
      <div class="agent-desc">Default AI assistant — knows everything, no department focus</div>
    </div>
  </div>`;

  for (const agent of agents) {
    html += `<div class="agent-card ${state.selectedAgent === agent.id ? 'active' : ''}" onclick="selectAgent('${agent.id}')">
      <div class="agent-icon">${agent.icon || '🤖'}</div>
      <div class="agent-info">
        <div class="agent-name">${escapeHtml(agent.name)}</div>
        <div class="agent-desc">${escapeHtml(agent.description || agent.department || '')}</div>
      </div>
    </div>`;
  }

  document.getElementById('agent-modal-body').innerHTML = html;
  overlay.classList.add('active');
}

function closeAgentModal() {
  const el = document.getElementById('agent-modal');
  if (el) el.classList.remove('active');
}

function selectAgent(agentId) {
  state.selectedAgent = agentId;
  renderAgentSelector();
  closeAgentModal();
}

// ═══════════════════════════════════════════════════════════════════
// Phase 4: Platform Dominance
// ═══════════════════════════════════════════════════════════════════

// ─── Feature 9: Workflow Automation ─────────────────────────────────

async function openWorkflows() {
  requireAuth(async () => {
    let modal = document.getElementById('workflow-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'workflow-modal';
      modal.className = 'modal-overlay';
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
      document.body.appendChild(modal);
    }

    modal.innerHTML = `<div class="modal" style="max-width:700px;">
      <div class="modal-header">
        <h3>&#x2699;&#xFE0F; Workflow Automation</h3>
        <button class="modal-close" onclick="document.getElementById('workflow-modal').classList.remove('active')">&#x2715;</button>
      </div>
      <div class="modal-body" id="workflow-modal-body" style="padding:20px;">
        <div style="text-align:center;padding:20px;color:var(--text-muted);">Loading...</div>
      </div>
    </div>`;
    modal.classList.add('active');

    try {
      const [templatesRes, workflowsRes] = await Promise.all([
        fetch(API + '/api/workflows/templates', { headers: authHeaders() }),
        fetch(API + '/api/workflows', { headers: authHeaders() }),
      ]);
      const { templates } = await templatesRes.json();
      const { workflows } = await workflowsRes.json();

      let html = '<h4 style="margin:0 0 12px;font-size:14px;color:var(--text-primary);">Start New Workflow</h4>';
      html += '<div class="workflow-templates">';
      for (const t of templates) {
        html += `<button class="workflow-template-card" onclick="startWorkflow('${t.id}', '${escapeHtml(t.name)}')">
          <div class="wf-name">${escapeHtml(t.name)}</div>
          <div class="wf-desc">${escapeHtml(t.description)}</div>
          <div class="wf-steps">${t.steps.length} steps</div>
        </button>`;
      }
      html += '</div>';

      if (workflows.length > 0) {
        html += '<h4 style="margin:20px 0 12px;font-size:14px;color:var(--text-primary);">Recent Workflows</h4>';
        html += '<div class="workflow-list">';
        for (const w of workflows.slice(0, 10)) {
          const statusIcon = w.status === 'completed' ? '&#x2705;' : w.status === 'in_progress' ? '&#x1F504;' : '&#x1F4DD;';
          html += `<div class="workflow-item" onclick="openWorkflowDetail('${w.id}')">
            <span>${statusIcon}</span>
            <span class="wf-item-name">${escapeHtml(w.name)}</span>
            <span class="wf-item-status">${w.status}</span>
          </div>`;
        }
        html += '</div>';
      }

      document.getElementById('workflow-modal-body').innerHTML = html;
    } catch {
      document.getElementById('workflow-modal-body').innerHTML = '<p style="color:var(--red-error-text);">Failed to load workflows.</p>';
    }
  });
}

async function startWorkflow(templateId, name) {
  try {
    const res = await fetch(API + '/api/workflows', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ templateId, name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    openWorkflowWizard(data.id, data.steps, data.name, 0);
  } catch (err) {
    alert(err.message || 'Failed to start workflow');
  }
}

async function openWorkflowDetail(workflowId) {
  try {
    const res = await fetch(API + '/api/workflows/' + workflowId, { headers: authHeaders() });
    const { workflow } = await res.json();
    const steps = JSON.parse(workflow.steps || '[]');

    if (workflow.status === 'completed' && workflow.output) {
      // Show in artifact panel
      const artifact = { type: 'document', title: workflow.name, content: workflow.output };
      openArtifactPanel(artifact);
      document.getElementById('workflow-modal').classList.remove('active');
    } else {
      openWorkflowWizard(workflowId, steps, workflow.name, workflow.current_step);
    }
  } catch {
    alert('Failed to load workflow');
  }
}

function openWorkflowWizard(workflowId, steps, name, currentStep) {
  const body = document.getElementById('workflow-modal-body');
  renderWorkflowStep(body, workflowId, steps, name, currentStep);
}

function renderWorkflowStep(container, workflowId, steps, name, stepIndex) {
  const step = steps[stepIndex];
  if (!step) return;

  const progress = ((stepIndex) / steps.length * 100).toFixed(0);

  let html = `<div class="workflow-wizard">
    <div class="wf-progress"><div class="wf-progress-bar" style="width:${progress}%"></div></div>
    <div class="wf-step-indicator">Step ${stepIndex + 1} of ${steps.length}: <strong>${escapeHtml(step.name)}</strong></div>
    <div class="wf-step-dots">${steps.map((s, i) => `<span class="wf-dot ${i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''}">${i + 1}</span>`).join('')}</div>
    <textarea id="wf-step-input" class="wf-input" rows="6" placeholder="Enter details for: ${escapeHtml(step.name)}...">${escapeHtml(step.input || '')}</textarea>
    <div id="wf-hint" class="wf-hint"></div>
    <div class="wf-actions">
      ${stepIndex > 0 ? `<button class="btn-template-picker" onclick="renderWorkflowStep(document.getElementById('workflow-modal-body'), '${workflowId}', ${JSON.stringify(steps).replace(/'/g, "\\'")},'${escapeHtml(name)}', ${stepIndex - 1})">&#x2190; Back</button>` : '<div></div>'}
      <button class="btn-auth" id="wf-next-btn" onclick="submitWorkflowStep('${workflowId}', ${stepIndex}, '${escapeHtml(name)}')" style="min-width:120px;">
        ${stepIndex === steps.length - 1 ? 'Generate &#x2192;' : 'Next &#x2192;'}
      </button>
    </div>
  </div>`;

  container.innerHTML = html;
}

async function submitWorkflowStep(workflowId, stepIndex, name) {
  const input = document.getElementById('wf-step-input').value.trim();
  if (!input) { alert('Please fill in this step before continuing.'); return; }

  const btn = document.getElementById('wf-next-btn');
  btn.disabled = true;
  btn.textContent = 'Processing...';

  try {
    const res = await fetch(API + '/api/workflows/' + workflowId + '/step', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ stepIndex, input }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (data.completed) {
      // Show output in artifact panel
      document.getElementById('workflow-modal').classList.remove('active');
      const artifact = { type: 'document', title: name, content: data.output };
      openArtifactPanel(artifact);
    } else {
      // Load next step
      const wfRes = await fetch(API + '/api/workflows/' + workflowId, { headers: authHeaders() });
      const { workflow } = await wfRes.json();
      const steps = JSON.parse(workflow.steps || '[]');
      const body = document.getElementById('workflow-modal-body');
      renderWorkflowStep(body, workflowId, steps, name, stepIndex + 1);

      if (data.nextHint) {
        const hint = document.getElementById('wf-hint');
        if (hint) hint.innerHTML = '<strong>Tip:</strong> ' + escapeHtml(data.nextHint);
      }
    }
  } catch (err) {
    alert(err.message || 'Step submission failed');
    btn.disabled = false;
    btn.textContent = 'Next &#x2192;';
  }
}

// ─── Feature 10: AI Meeting Assistant ───────────────────────────────

function openMeetingAssistant() {
  requireAuth(async () => {
    let modal = document.getElementById('meeting-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'meeting-modal';
      modal.className = 'modal-overlay';
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
      document.body.appendChild(modal);
    }

    modal.innerHTML = `<div class="modal" style="max-width:700px;">
      <div class="modal-header">
        <h3>&#x1F3A4; Meeting Assistant</h3>
        <button class="modal-close" onclick="document.getElementById('meeting-modal').classList.remove('active')">&#x2715;</button>
      </div>
      <div class="modal-body" id="meeting-modal-body" style="padding:20px;"></div>
    </div>`;

    // Load meetings
    let meetingsHtml = `<div class="meeting-upload-area" id="meeting-upload-area">
      <div style="text-align:center;padding:30px 20px;border:2px dashed var(--border-color);border-radius:var(--radius);cursor:pointer;" onclick="document.getElementById('meeting-audio-input').click()">
        <div style="font-size:40px;margin-bottom:8px;">&#x1F399;&#xFE0F;</div>
        <p style="font-size:14px;color:var(--text-primary);font-weight:600;">Upload Meeting Recording</p>
        <p style="font-size:12px;color:var(--text-muted);">MP3, WAV, M4A, OGG — Max 25MB</p>
        <input type="file" id="meeting-audio-input" accept="audio/*" style="display:none;" onchange="uploadMeetingAudio(this.files[0])" />
      </div>
    </div>`;

    meetingsHtml += '<div id="meeting-list-area" style="margin-top:20px;"></div>';
    document.getElementById('meeting-modal-body').innerHTML = meetingsHtml;
    modal.classList.add('active');

    // Load existing meetings
    try {
      const res = await fetch(API + '/api/meetings', { headers: authHeaders() });
      const { meetings } = await res.json();
      if (meetings.length > 0) {
        let listHtml = '<h4 style="font-size:14px;margin:0 0 12px;">Previous Meetings</h4>';
        for (const m of meetings) {
          const icon = m.status === 'completed' ? '&#x2705;' : m.status === 'transcribed' ? '&#x1F4DD;' : '&#x23F3;';
          listHtml += `<div class="meeting-item" onclick="openMeetingDetail('${m.id}')">
            <span>${icon}</span>
            <span class="meeting-item-title">${escapeHtml(m.title)}</span>
            <span class="meeting-item-date">${new Date(m.created_at).toLocaleDateString()}</span>
          </div>`;
        }
        document.getElementById('meeting-list-area').innerHTML = listHtml;
      }
    } catch {}
  });
}

async function uploadMeetingAudio(file) {
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) { alert('Audio file must be under 25MB'); return; }

  const area = document.getElementById('meeting-upload-area');
  area.innerHTML = '<div style="text-align:center;padding:30px;"><div class="typing-indicator"><span></span><span></span><span></span></div><p style="margin-top:12px;color:var(--text-muted);">Transcribing audio... This may take a moment.</p></div>';

  const title = prompt('Meeting title:', file.name.replace(/\.[^.]+$/, '')) || file.name;

  try {
    const formData = new FormData();
    formData.append('audio', file);
    formData.append('title', title);

    const res = await fetch(API + '/api/meetings/upload', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + state.token },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      if (err.code === 'TIER_REQUIRED') {
        area.innerHTML = '<div style="text-align:center;padding:20px;"><p style="color:var(--text-secondary);">Meeting Assistant requires a Professional plan.</p><button class="btn-auth" onclick="openPricingModal()" style="margin-top:12px;">View Plans</button></div>';
        return;
      }
      throw new Error(err.error);
    }

    const data = await res.json();
    area.innerHTML = `<div style="padding:16px;background:var(--bg-tertiary);border-radius:var(--radius);margin-bottom:12px;">
      <h4 style="margin:0 0 8px;">&#x2705; Transcription Complete</h4>
      <div style="max-height:200px;overflow-y:auto;font-size:13px;color:var(--text-secondary);line-height:1.6;padding:12px;background:var(--bg-primary);border-radius:var(--radius-sm);">${escapeHtml(data.transcript.substring(0, 2000))}${data.transcript.length > 2000 ? '...' : ''}</div>
      <button class="btn-auth" onclick="generateMinutes('${data.meetingId}')" style="margin-top:12px;width:100%;">Generate Meeting Minutes</button>
    </div>`;
  } catch (err) {
    area.innerHTML = `<div style="color:var(--red-error-text);padding:20px;text-align:center;">${escapeHtml(err.message)}</div>`;
  }
}

async function generateMinutes(meetingId) {
  const area = document.getElementById('meeting-upload-area');
  area.innerHTML = '<div style="text-align:center;padding:30px;"><div class="typing-indicator"><span></span><span></span><span></span></div><p style="margin-top:12px;color:var(--text-muted);">Generating minutes and extracting action items...</p></div>';

  try {
    const res = await fetch(API + '/api/meetings/' + meetingId + '/minutes', {
      method: 'POST',
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Show in artifact panel
    document.getElementById('meeting-modal').classList.remove('active');
    const artifact = { type: 'document', title: 'Meeting Minutes', content: data.minutes };
    openArtifactPanel(artifact);

    // Show action items as a toast
    if (data.actionItems && data.actionItems.length > 0) {
      let msg = '**Meeting Minutes Generated**\n\n**Action Items:**\n';
      data.actionItems.forEach((a, i) => {
        msg += `${i + 1}. ${a.action} — *${a.assignee || 'TBD'}* (${a.deadline || 'TBD'})\n`;
      });
      if (state.activeConversationId) {
        state.messages.push({ role: 'assistant', content: msg });
        renderMessages();
      }
    }
  } catch (err) {
    area.innerHTML = `<div style="color:var(--red-error-text);padding:20px;">${escapeHtml(err.message)}</div>`;
  }
}

async function openMeetingDetail(meetingId) {
  try {
    const res = await fetch(API + '/api/meetings/' + meetingId, { headers: authHeaders() });
    const { meeting } = await res.json();

    if (meeting.minutes) {
      document.getElementById('meeting-modal').classList.remove('active');
      const artifact = { type: 'document', title: meeting.title + ' — Minutes', content: meeting.minutes };
      openArtifactPanel(artifact);
    } else if (meeting.transcript) {
      document.getElementById('meeting-upload-area').innerHTML = `
        <div style="padding:16px;background:var(--bg-tertiary);border-radius:var(--radius);">
          <h4 style="margin:0 0 8px;">${escapeHtml(meeting.title)}</h4>
          <div style="max-height:200px;overflow-y:auto;font-size:13px;color:var(--text-secondary);line-height:1.6;padding:12px;background:var(--bg-primary);border-radius:var(--radius-sm);">${escapeHtml(meeting.transcript.substring(0, 2000))}</div>
          <button class="btn-auth" onclick="generateMinutes('${meetingId}')" style="margin-top:12px;width:100%;">Generate Meeting Minutes</button>
        </div>`;
    }
  } catch {
    alert('Failed to load meeting');
  }
}

// ─── Feature 11: Collaborative Spaces ───────────────────────────────

async function openSpaces() {
  requireAuth(async () => {
    let modal = document.getElementById('spaces-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'spaces-modal';
      modal.className = 'modal-overlay';
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
      document.body.appendChild(modal);
    }

    modal.innerHTML = `<div class="modal" style="max-width:700px;">
      <div class="modal-header">
        <div><h3>&#x1F465; Collaborative Spaces</h3><p style="font-size:12px;color:var(--text-muted);margin:2px 0 0;">Share conversations and collaborate across departments</p></div>
        <button class="modal-close" onclick="document.getElementById('spaces-modal').classList.remove('active')">&#x2715;</button>
      </div>
      <div class="modal-body" id="spaces-modal-body" style="padding:20px;">
        <div style="text-align:center;padding:20px;color:var(--text-muted);">Loading...</div>
      </div>
    </div>`;
    modal.classList.add('active');

    try {
      const res = await fetch(API + '/api/spaces', { headers: authHeaders() });
      const { spaces } = await res.json();

      let html = `<button class="btn-auth" onclick="createSpaceForm()" style="margin-bottom:16px;">+ Create New Space</button>`;
      html += '<div id="create-space-area"></div>';

      if (spaces.length === 0) {
        html += '<div style="text-align:center;padding:30px;color:var(--text-muted);"><p>No spaces yet. Create one to start collaborating!</p></div>';
      } else {
        html += '<div class="spaces-list">';
        for (const s of spaces) {
          html += `<div class="space-card" onclick="openSpaceDetail('${s.id}')">
            <div class="space-card-header">
              <span class="space-name">${escapeHtml(s.name)}</span>
              <span class="space-role">${s.role}</span>
            </div>
            <div class="space-card-meta">${s.member_count} members &middot; ${s.conversation_count} conversations</div>
            ${s.description ? `<div class="space-desc">${escapeHtml(s.description)}</div>` : ''}
          </div>`;
        }
        html += '</div>';
      }

      document.getElementById('spaces-modal-body').innerHTML = html;
    } catch {
      document.getElementById('spaces-modal-body').innerHTML = '<p style="color:var(--red-error-text);">Failed to load spaces.</p>';
    }
  });
}

function createSpaceForm() {
  const area = document.getElementById('create-space-area');
  area.innerHTML = `<div style="padding:16px;background:var(--bg-tertiary);border-radius:var(--radius);margin-bottom:16px;">
    <div class="form-group"><label>Space Name</label><input type="text" id="new-space-name" placeholder="e.g. Budget Committee 2025" /></div>
    <div class="form-group"><label>Description</label><input type="text" id="new-space-desc" placeholder="Brief description (optional)" /></div>
    <div style="display:flex;gap:8px;"><button class="btn-auth" onclick="createSpace()">Create</button><button class="btn-template-picker" onclick="document.getElementById('create-space-area').innerHTML=''">Cancel</button></div>
  </div>`;
}

async function createSpace() {
  const name = document.getElementById('new-space-name').value.trim();
  const description = document.getElementById('new-space-desc').value.trim();
  if (!name) { alert('Space name is required'); return; }

  try {
    const res = await fetch(API + '/api/spaces', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name, description }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.code === 'TIER_REQUIRED') { openPricingModal(); return; }
      throw new Error(data.error);
    }
    openSpaces(); // refresh
  } catch (err) {
    alert(err.message || 'Failed to create space');
  }
}

async function openSpaceDetail(spaceId) {
  try {
    const res = await fetch(API + '/api/spaces/' + spaceId, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const body = document.getElementById('spaces-modal-body');
    let html = `<button class="btn-template-picker" onclick="openSpaces()" style="margin-bottom:16px;">&#x2190; Back to Spaces</button>`;
    html += `<h3 style="margin:0 0 4px;">${escapeHtml(data.space.name)}</h3>`;
    if (data.space.description) html += `<p style="font-size:13px;color:var(--text-muted);margin:0 0 16px;">${escapeHtml(data.space.description)}</p>`;

    // Members
    html += `<h4 style="font-size:14px;margin:16px 0 8px;">Members (${data.members.length})</h4>`;
    html += '<div class="space-members">';
    for (const m of data.members) {
      html += `<div class="space-member"><span class="member-name">${escapeHtml(m.full_name)}</span><span class="member-role">${m.role}</span>${m.department ? `<span class="member-dept">${escapeHtml(m.department)}</span>` : ''}</div>`;
    }
    html += '</div>';

    if (data.userRole === 'admin') {
      html += `<div style="margin-top:12px;display:flex;gap:8px;"><input type="email" id="invite-email" placeholder="Email to invite" style="flex:1;padding:8px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);font-size:13px;" /><button class="btn-auth" onclick="inviteToSpace('${spaceId}')">Invite</button></div>`;
    }

    // Shared conversations
    html += `<h4 style="font-size:14px;margin:20px 0 8px;">Shared Conversations (${data.conversations.length})</h4>`;
    if (data.conversations.length === 0) {
      html += '<p style="font-size:13px;color:var(--text-muted);">No conversations shared yet. Use the Share button in chat to add one.</p>';
    } else {
      for (const conv of data.conversations) {
        html += `<div class="space-conversation" onclick="loadConversation('${conv.conversation_id}'); document.getElementById('spaces-modal').classList.remove('active');">
          <span>${escapeHtml(conv.title || 'Untitled')}</span>
          <span class="space-conv-meta">by ${escapeHtml(conv.shared_by_name)} &middot; ${new Date(conv.shared_at).toLocaleDateString()}</span>
        </div>`;
      }
    }

    // Share conversation button
    if (state.activeConversationId) {
      html += `<button class="btn-template-picker" onclick="shareToSpace('${spaceId}')" style="margin-top:12px;">&#x1F517; Share Current Conversation</button>`;
    }

    body.innerHTML = html;
  } catch (err) {
    alert(err.message || 'Failed to load space');
  }
}

async function inviteToSpace(spaceId) {
  const email = document.getElementById('invite-email').value.trim();
  if (!email) return;
  try {
    const res = await fetch(API + '/api/spaces/' + spaceId + '/invite', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email, role: 'member' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    document.getElementById('invite-email').value = '';
    openSpaceDetail(spaceId); // refresh
  } catch (err) {
    alert(err.message);
  }
}

async function shareToSpace(spaceId) {
  if (!state.activeConversationId) return;
  try {
    const res = await fetch(API + '/api/spaces/' + spaceId + '/share-conversation', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ conversationId: state.activeConversationId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    alert('Conversation shared to space!');
    openSpaceDetail(spaceId);
  } catch (err) {
    alert(err.message);
  }
}

// ─── Feature: Smart Upgrade Nudges ───────────────────────────────────

async function checkUpgradeNudge() {
  if (!state.user || state.user.tier !== 'free') return;
  try {
    const res = await fetch(`${API}/api/usage/nudge`, { headers: authHeaders() });
    const data = await res.json();
    if (data.nudge) showUpgradeNudge(data.nudge);
    else hideUpgradeNudge();
  } catch {}
}

function showUpgradeNudge(nudge) {
  let banner = document.getElementById('upgrade-nudge');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'upgrade-nudge';
    banner.className = 'upgrade-nudge';
    // Insert above the chat input area
    const inputArea = document.querySelector('.input-area');
    if (inputArea) inputArea.parentNode.insertBefore(banner, inputArea);
  }

  const pct = Math.round((nudge.used / nudge.limit) * 100);
  banner.innerHTML = `
    <div class="nudge-progress">
      <div class="nudge-bar" style="width:${pct}%"></div>
    </div>
    <div class="nudge-content">
      <span class="nudge-icon">\u26A1</span>
      <span class="nudge-text">${escapeHtml(nudge.message)}</span>
      <button class="nudge-upgrade-btn" onclick="openPricingModal()">Upgrade</button>
      <button class="nudge-dismiss" onclick="hideUpgradeNudge()">\u00D7</button>
    </div>
  `;
  banner.classList.add('visible');
}

function hideUpgradeNudge() {
  const banner = document.getElementById('upgrade-nudge');
  if (banner) banner.classList.remove('visible');
}

// ─── Feature: Referral Landing Overlay ──────────────────────────────

async function checkReferralLanding() {
  const params = new URLSearchParams(window.location.search);
  const refCode = params.get('ref');
  if (!refCode) return;
  if (state.user) return; // Already logged in, skip
  if (sessionStorage.getItem('ref_landing_shown')) return; // Already shown this session

  try {
    const res = await fetch(`${API}/api/referral/info?code=${encodeURIComponent(refCode)}`);
    const data = await res.json();
    if (!data.valid) return;

    sessionStorage.setItem('ref_landing_shown', '1');
    showReferralLanding(data, refCode);
  } catch {}
}

function showReferralLanding(data, refCode) {
  const overlay = document.createElement('div');
  overlay.className = 'referral-landing-overlay';
  overlay.id = 'referral-landing';

  const firstName = (data.referrerName || '').split(' ')[0] || 'A colleague';

  overlay.innerHTML = `
    <div class="referral-landing-card">
      <div class="referral-landing-flag">
        <div class="referral-flag-stripe" style="background:#CE1126;"></div>
        <div class="referral-flag-stripe" style="background:#FCD116;"></div>
        <div class="referral-flag-stripe" style="background:#006B3F;"></div>
      </div>
      <div class="referral-landing-body">
        <div class="referral-landing-badge">INVITED BY ${escapeHtml(firstName.toUpperCase())}</div>
        <h1 class="referral-landing-title">Welcome to <span>AskOzzy</span></h1>
        <p class="referral-landing-subtitle">Ghana's AI-Powered Productivity Platform for Government</p>

        <div class="referral-landing-features">
          <div class="referral-feature-item">
            <span class="referral-feature-icon">\uD83E\uDD16</span>
            <span>11 AI Models for every task</span>
          </div>
          <div class="referral-feature-item">
            <span class="referral-feature-icon">\uD83D\uDCDD</span>
            <span>Generate memos, briefs & reports</span>
          </div>
          <div class="referral-feature-item">
            <span class="referral-feature-icon">\uD83D\uDD0D</span>
            <span>Deep Research with citations</span>
          </div>
          <div class="referral-feature-item">
            <span class="referral-feature-icon">\uD83D\uDCCA</span>
            <span>Data analysis with charts</span>
          </div>
          <div class="referral-feature-item">
            <span class="referral-feature-icon">\uD83D\uDDE3\uFE0F</span>
            <span>Voice input in Twi, Ga, Ewe & more</span>
          </div>
          <div class="referral-feature-item">
            <span class="referral-feature-icon">\uD83C\uDDEC\uD83C\uDDED</span>
            <span>Built in Ghana, for Ghana</span>
          </div>
        </div>

        <div class="referral-landing-cta">
          <button class="referral-cta-btn" onclick="closeReferralLanding()">
            Get Started Free
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </button>
          <div class="referral-cta-sub">Free forever \u2022 No credit card needed</div>
        </div>

        <div class="referral-landing-referrer">
          <div class="referral-referrer-avatar">${escapeHtml(firstName.charAt(0))}</div>
          <div>
            <div class="referral-referrer-name">${escapeHtml(data.referrerName || firstName)}</div>
            <div class="referral-referrer-dept">${data.referrerDepartment ? escapeHtml(data.referrerDepartment) : 'Government of Ghana'}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('active'));
}

function closeReferralLanding() {
  const overlay = document.getElementById('referral-landing');
  if (overlay) {
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 300);
  }
}

// ─── Feature: Free Pro Trial (3 days) ───────────────────────────────

async function activateFreeTrial() {
  try {
    const res = await fetch(`${API}/api/trial/activate`, { method: 'POST', headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not activate trial'); return; }

    // Update local state
    state.user.trialExpiresAt = data.expiresAt;
    state.user.tier = 'professional'; // Temporarily show as pro
    localStorage.setItem('askozzy_user', JSON.stringify(state.user));

    // Close pricing modal and show success
    closePricingModal();

    // Show success toast
    showTrialActivatedToast();

    // Refresh sidebar to show new tier
    updateSidebarFooter();
    loadUsageStatus();
  } catch {
    alert('Failed to activate trial. Please try again.');
  }
}

function showTrialActivatedToast() {
  const toast = document.createElement('div');
  toast.className = 'trial-toast';
  toast.innerHTML = `
    <div class="trial-toast-icon">\uD83C\uDF89</div>
    <div>
      <div class="trial-toast-title">Professional Trial Activated!</div>
      <div class="trial-toast-sub">You have 3 days of full access. Enjoy all 11 AI models and premium features.</div>
    </div>
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// ─── Feature: Enhanced Onboarding Tour (7-step) ─────────────────────

function getOnboardingSteps() {
  const student = isStudent();
  return [
    {
      target: '.sidebar',
      title: 'Your Sidebar',
      text: 'All your conversations, folders, and tools live here. Click the + button to start a new chat.',
      position: 'right'
    },
    {
      target: '#chat-input',
      title: student ? 'Ask Ozzy Anything' : 'Chat with AI',
      text: student
        ? 'Ask study questions, get essay help, or review for exams. Ozzy is your personal tutor.'
        : 'Type your question or paste a document. Ozzy understands memos, reports, and complex queries.',
      position: 'top'
    },
    {
      target: '#model-selector',
      title: 'Choose Your AI Model',
      text: 'Switch between 11 AI models. Each has different strengths \u2014 try a few to find your favorite.',
      position: 'top'
    },
    {
      target: '.template-grid',
      title: student ? 'Study Templates' : 'GoG Templates',
      text: student
        ? '40+ templates for essays, exam prep, study plans, research, and more. Click any to start.'
        : '25+ ready-made templates for memos, procurement, HR, and more. Click any to start.',
      position: 'bottom'
    },
    {
      target: '#voice-btn-large',
      title: 'Voice Input',
      text: 'Tap to speak in English, Twi, Ga, Ewe, or Hausa. Ozzy understands your language.',
      position: 'top'
    },
    {
      target: '.input-tools',
      title: 'Smart Tools',
      text: 'Research, Data Analysis, Web Search, Workflows \u2014 powerful tools at your fingertips.',
      position: 'top'
    },
    {
      target: '.guide-fab',
      title: 'Need Help?',
      text: 'Click this button anytime to open the full User Guide with 49+ features explained.',
      position: 'left'
    }
  ];
}

function startEnhancedOnboarding() {
  // Don't show if already completed (either version)
  if (localStorage.getItem('ozzy_onboarding_v2_done')) return;
  if (localStorage.getItem('askozzy_onboarding_done')) return;
  if (!state.user) return;
  // Delay slightly to let page render
  setTimeout(() => showEnhancedOnboardingStep(0, getOnboardingSteps()), 1200);
}

function showEnhancedOnboardingStep(stepIndex, steps) {
  if (!steps) steps = getOnboardingSteps();
  // Remove any existing overlay
  const existing = document.getElementById('onboarding-overlay-v2');
  if (existing) existing.remove();

  if (stepIndex >= steps.length) {
    localStorage.setItem('ozzy_onboarding_v2_done', '1');
    return;
  }

  const step = steps[stepIndex];
  const targetEl = document.querySelector(step.target);

  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'onboarding-overlay-v2';
  overlay.id = 'onboarding-overlay-v2';

  // If target exists, spotlight it
  if (targetEl) {
    const rect = targetEl.getBoundingClientRect();
    const spotlight = document.createElement('div');
    spotlight.className = 'onboarding-spotlight-v2';
    spotlight.style.cssText = `top:${rect.top - 6}px;left:${rect.left - 6}px;width:${rect.width + 12}px;height:${rect.height + 12}px;`;
    overlay.appendChild(spotlight);
  }

  // Create tooltip
  const tooltip = document.createElement('div');
  tooltip.className = `onboarding-tooltip-v2 position-${step.position}`;

  // Position tooltip relative to target
  if (targetEl) {
    const rect = targetEl.getBoundingClientRect();
    switch (step.position) {
      case 'right':
        tooltip.style.top = Math.max(10, rect.top + rect.height / 2 - 60) + 'px';
        tooltip.style.left = Math.min(rect.right + 16, window.innerWidth - 300) + 'px';
        break;
      case 'left':
        tooltip.style.top = Math.max(10, rect.top + rect.height / 2 - 60) + 'px';
        tooltip.style.left = Math.max(10, rect.left - 296) + 'px';
        break;
      case 'top':
        tooltip.style.top = Math.max(10, rect.top - 180) + 'px';
        tooltip.style.left = Math.max(10, Math.min(rect.left + rect.width / 2 - 140, window.innerWidth - 300)) + 'px';
        break;
      case 'bottom':
        tooltip.style.top = (rect.bottom + 16) + 'px';
        tooltip.style.left = Math.max(10, Math.min(rect.left + rect.width / 2 - 140, window.innerWidth - 300)) + 'px';
        break;
    }
  } else {
    // Fallback: center the tooltip
    tooltip.style.top = '50%';
    tooltip.style.left = '50%';
    tooltip.style.transform = 'translate(-50%, -50%)';
  }

  tooltip.innerHTML = `
    <div class="onboarding-step-count-v2">${stepIndex + 1} of ${steps.length}</div>
    <div class="onboarding-title-v2">${step.title}</div>
    <div class="onboarding-text-v2">${step.text}</div>
    <div class="onboarding-actions-v2">
      <button class="onboarding-skip-v2" onclick="skipEnhancedOnboarding()">Skip tour</button>
      <button class="onboarding-next-v2" onclick="showEnhancedOnboardingStep(${stepIndex + 1}, getOnboardingSteps())">
        ${stepIndex === steps.length - 1 ? 'Finish' : 'Next'}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
    <div class="onboarding-dots-v2">
      ${steps.map((_, i) => `<span class="onboarding-dot-v2 ${i === stepIndex ? 'active' : ''} ${i < stepIndex ? 'done' : ''}"></span>`).join('')}
    </div>
  `;

  overlay.appendChild(tooltip);
  document.body.appendChild(overlay);

  // Click overlay background to advance
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) showEnhancedOnboardingStep(stepIndex + 1, steps);
  });
}

function skipEnhancedOnboarding() {
  localStorage.setItem('ozzy_onboarding_v2_done', '1');
  const overlay = document.getElementById('onboarding-overlay-v2');
  if (overlay) overlay.remove();
}

// ─── Feature: Daily Streaks & Badges ────────────────────────────────

async function loadStreakData() {
  if (!state.user) return;
  try {
    const res = await fetch(`${API}/api/streaks`, { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    state.streakData = data;
    renderStreakBadge();
  } catch {}
}

function renderStreakBadge() {
  const d = state.streakData;
  if (!d) return;

  // Update or create streak badge in sidebar footer
  let badge = document.getElementById('streak-badge');
  const container = document.getElementById('streak-badge-container');
  if (!badge && container) {
    badge = document.createElement('button');
    badge.id = 'streak-badge';
    badge.className = 'streak-badge';
    badge.onclick = openStreakModal;
    container.appendChild(badge);
  }
  if (!badge) return;

  const streak = d.currentStreak || 0;
  const fire = streak >= 3 ? '\uD83D\uDD25' : '\u2728';
  badge.innerHTML = `<span class="streak-fire">${fire}</span><span class="streak-count">${streak}</span>`;
  badge.title = `${streak}-day streak! Click to view achievements`;
  if (streak >= 7) badge.classList.add('hot');
  else badge.classList.remove('hot');
}

function openStreakModal() {
  const d = state.streakData;
  if (!d) return;

  // Badge definitions
  const allBadges = [
    { id: 'streak_3', icon: '\uD83D\uDD25', name: '3-Day Streak', desc: 'Use AskOzzy 3 days in a row' },
    { id: 'streak_7', icon: '\uD83D\uDCAA', name: '7-Day Streak', desc: 'A full week of productivity' },
    { id: 'streak_14', icon: '\u26A1', name: '14-Day Streak', desc: 'Two weeks strong!' },
    { id: 'streak_30', icon: '\uD83C\uDFC6', name: '30-Day Streak', desc: 'An entire month \u2014 you\'re a champion' },
    { id: 'messages_10', icon: '\uD83D\uDCAC', name: 'Getting Started', desc: 'Send 10 messages' },
    { id: 'messages_50', icon: '\uD83D\uDCDD', name: 'Active User', desc: 'Send 50 messages' },
    { id: 'messages_100', icon: '\uD83E\uDDE0', name: 'Power User', desc: 'Send 100 messages' },
    { id: 'messages_500', icon: '\uD83C\uDF1F', name: 'AskOzzy Expert', desc: 'Send 500 messages' },
    { id: 'referral_1', icon: '\uD83E\uDD1D', name: 'First Referral', desc: 'Refer your first colleague' },
    { id: 'referral_5', icon: '\uD83D\uDCE2', name: 'Influencer', desc: 'Refer 5 colleagues' },
    { id: 'referral_10', icon: '\uD83C\uDFC5', name: 'Ambassador', desc: 'Refer 10 colleagues' },
  ];

  const earned = d.badges || [];

  let modal = document.getElementById('streak-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'streak-modal';
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal streak-modal-box">
      <div class="modal-header">
        <h3>Achievements & Streaks</h3>
        <button class="modal-close" onclick="document.getElementById('streak-modal').classList.remove('active')">\u2715</button>
      </div>
      <div class="modal-body" style="padding:24px;">
        <!-- Streak Card -->
        <div class="streak-hero">
          <div class="streak-hero-fire">${d.currentStreak >= 3 ? '\uD83D\uDD25' : '\u2728'}</div>
          <div class="streak-hero-count">${d.currentStreak || 0}</div>
          <div class="streak-hero-label">Day Streak</div>
          <div class="streak-hero-sub">Longest: ${d.longestStreak || 0} days \u2022 ${d.totalConversations || 0} total conversations</div>
        </div>

        <!-- Badges Grid -->
        <div class="streak-badges-title">Badges (${earned.length}/${allBadges.length})</div>
        <div class="streak-badges-grid">
          ${allBadges.map(b => {
            const isEarned = earned.includes(b.id);
            return `<div class="streak-badge-card ${isEarned ? 'earned' : 'locked'}">
              <div class="streak-badge-icon">${isEarned ? b.icon : '\uD83D\uDD12'}</div>
              <div class="streak-badge-name">${b.name}</div>
              <div class="streak-badge-desc">${b.desc}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>
  `;
  modal.classList.add('active');
}

// ─── Feature: Follow-up Suggestions (SSE) ───────────────────────────

function renderFollowUpSuggestions(suggestions) {
  // Remove any existing suggestions
  const existing = document.querySelector('.followup-suggestions');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.className = 'followup-suggestions';
  container.innerHTML = `
    <div class="followup-label">Follow up:</div>
    <div class="followup-chips">
      ${suggestions.map(s => `<button class="followup-chip" onclick="sendFollowUp(this)">${escapeHtml(s)}</button>`).join('')}
    </div>
  `;

  // Insert at the bottom of the messages area
  const messagesEl = document.getElementById('chat-messages');
  if (messagesEl) {
    messagesEl.appendChild(container);
    scrollToBottom();
  }
}

function sendFollowUp(btn) {
  const text = btn.textContent;
  // Remove suggestions
  const container = btn.closest('.followup-suggestions');
  if (container) container.remove();

  // Set input and send
  const input = document.getElementById('chat-input');
  if (input) {
    input.value = text;
    autoResizeInput();
    updateSendButton();
    sendMessage();
  }
}

// ─── Feature 12: Citizen Service Bot ────────────────────────────────

function openCitizenBot() {
  const fab = document.querySelector('.citizen-bot-fab');
  let widget = document.getElementById('citizen-bot');
  if (widget) {
    const isOpen = widget.classList.toggle('active');
    if (fab) fab.classList.toggle('open', isOpen);
    return;
  }

  widget = document.createElement('div');
  widget.id = 'citizen-bot';
  widget.className = 'citizen-bot active';
  widget.innerHTML = `
    <div class="citizen-header">
      <div class="citizen-title">
        <div class="citizen-logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        </div>
        <div>
          <strong>Ozzy Citizen</strong>
          <div class="citizen-subtitle">
            <span class="citizen-status-dot"></span> Online &middot; Government Services
          </div>
        </div>
      </div>
      <div class="citizen-header-actions">
        <select id="citizen-lang" class="citizen-lang-chip" onchange="citizenState.language = this.value">
          <option value="en">EN</option>
          <option value="tw">Twi</option>
          <option value="ha">Hausa</option>
          <option value="ee">Ewe</option>
          <option value="ga">Ga</option>
          <option value="dag">Dagbani</option>
          <option value="fr">FR</option>
        </select>
        <button class="citizen-close" onclick="document.getElementById('citizen-bot').classList.remove('active')" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <div class="citizen-messages" id="citizen-messages">
      <div class="citizen-msg bot">
        <div class="citizen-avatar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        </div>
        <div class="citizen-msg-content">
          <div class="citizen-msg-bubble">Hello! I'm <strong>Ozzy</strong>, your digital assistant for government services.</div>
          <div class="citizen-quick-actions">
            <button onclick="document.getElementById('citizen-input').value='How do I get a passport?';sendCitizenMessage()">Passports</button>
            <button onclick="document.getElementById('citizen-input').value='How do I check my SSNIT pension?';sendCitizenMessage()">Pensions</button>
            <button onclick="document.getElementById('citizen-input').value='How do I file my taxes?';sendCitizenMessage()">Taxes</button>
            <button onclick="document.getElementById('citizen-input').value='How do I get a Ghana Card?';sendCitizenMessage()">Ghana Card</button>
          </div>
        </div>
      </div>
    </div>
    <div class="citizen-input-area">
      <input type="text" id="citizen-input" placeholder="Type your question..." onkeydown="if(event.key==='Enter')sendCitizenMessage()" />
      <button class="citizen-send-btn" onclick="sendCitizenMessage()" aria-label="Send">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
      </button>
    </div>
    <div class="citizen-footer">Powered by AskOzzy AI</div>`;
  document.body.appendChild(widget);

  // Toggle FAB icon to X when open
  document.querySelector('.citizen-bot-fab')?.classList.add('open');
}

const citizenState = { sessionId: null, language: 'en' };

async function sendCitizenMessage() {
  const input = document.getElementById('citizen-input');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  const container = document.getElementById('citizen-messages');

  // Add user message
  const userDiv = document.createElement('div');
  userDiv.className = 'citizen-msg user';
  userDiv.innerHTML = `<div class="citizen-msg-content"><div class="citizen-msg-bubble">${escapeHtml(message)}</div></div>`;
  container.appendChild(userDiv);
  container.scrollTop = container.scrollHeight;

  // Typing indicator
  const typingDiv = document.createElement('div');
  typingDiv.className = 'citizen-msg bot';
  typingDiv.innerHTML = `<div class="citizen-avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div><div class="citizen-msg-content"><div class="citizen-msg-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div></div>`;
  container.appendChild(typingDiv);
  container.scrollTop = container.scrollHeight;

  try {
    const res = await fetch(API + '/api/citizen/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: citizenState.sessionId, message, language: citizenState.language }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    citizenState.sessionId = data.sessionId;
    typingDiv.remove();

    const botDiv = document.createElement('div');
    botDiv.className = 'citizen-msg bot';
    botDiv.innerHTML = `<div class="citizen-avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div><div class="citizen-msg-content"><div class="citizen-msg-bubble">${renderMarkdown(data.response)}</div></div>`;
    container.appendChild(botDiv);
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    typingDiv.remove();
    const errDiv = document.createElement('div');
    errDiv.className = 'citizen-msg bot';
    errDiv.innerHTML = `<div class="citizen-avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div><div class="citizen-msg-content"><div class="citizen-msg-bubble" style="color:var(--red-error-text);">Sorry, I'm temporarily unavailable. Please try again.</div></div>`;
    container.appendChild(errDiv);
  }
}
