# Frontend Guide

## File Overview

| File | Lines | Purpose |
|------|-------|---------|
| `public/js/app.js` | ~8,283 | Main application logic |
| `public/js/admin.js` | ~1,920 | Admin portal |
| `public/js/templates.js` | ~1,350 | 45 prompt templates |
| `public/index.html` | | Main app HTML |
| `public/admin.html` | | Admin portal HTML |
| `public/css/app.css` | ~8,573 | All styles |
| `public/css/admin.css` | | Admin-specific styles |
| `public/sw.js` | ~1,849 | Service worker |
| `public/manifest.json` | | PWA manifest |

## State Management

Global `state` object holds all app state:

```javascript
const state = {
  token: null,              // Auth session token
  user: null,               // Current user object
  conversations: [],        // Conversation list
  currentConversation: null, // Active conversation ID
  messages: [],             // Current messages
  models: [],               // Available AI models
  selectedModel: null,      // Current model selection
  streaming: false,         // SSE streaming active
  folders: [],              // Conversation folders
  memories: [],             // User AI memories
  agents: [],               // Available AI agents
  selectedAgent: null,      // Current agent
  persona: 'gog_employee',  // User persona type
  // ... more state fields
};
```

State is persisted to localStorage for session continuity.

## Feature Modules

### 1. Authentication Module

- Access code login (8-char code, format: `XXXX-XXXX`)
- WebAuthn passkey registration and login
- TOTP 2FA setup with QR code
- Session management
- Recovery codes

### 2. Chat Module

- SSE streaming with real-time token display
- Markdown rendering (code blocks, tables, lists, headers)
- Copy/download messages
- Message rating (thumbs up/down)
- Regenerate responses
- Auto-scroll with smart scroll detection
- Follow-up suggestions

### 3. Voice Module

- Voice input via Web Speech API (`SpeechRecognition`)
- 7 languages: English, Twi, Ga, Ewe, Hausa, Dagbani, French
- Text-to-speech output (`SpeechSynthesis`)
- Voice mode with visual waveform display

### 4. Template System

- 45 templates across 13 categories
- GoG templates: Memo Drafting (3), Official Letters (3), Reports (3), Minutes (2), Research & Analysis (3), Promotion & Career (3), IT Support (4), Web & Development (3), General (5)
- Student templates: Essay Writing (4), Exam Preparation (4), Study Skills (4), Academic Writing (4)
- Template selection modal with category filtering
- Placeholder extraction and fill-in prompts
- Persona-based filtering (GoG Employee vs Student)

### 5. Affiliate Module

- Dashboard with earnings, balance, referral count
- Transaction history
- Withdrawal request form (MoMo)
- Referral link sharing (Web Share API or clipboard)
- Leaderboard display

### 6. PWA Module

- Service worker registration
- Install prompt handling (`beforeinstallprompt`)
- Update notification (new version detection)
- Offline indicator
- Background sync for queued messages

### 7. File & Media Module

- File upload (documents, images)
- Camera capture (`MediaDevices` API)
- Image paste from clipboard
- Drag-and-drop support
- Vision AI modes: describe, OCR, form extraction, receipt scanning
- DOCX/PPTX parsing (ZIP extraction via `DecompressionStream`)

### 8. Smart Tools

- Deep Research mode (progress tracking UI)
- Data Analysis (CSV upload, chart rendering via Chart.js)
- Workflow automation (multi-step wizard)
- Meeting assistant (audio upload, minutes display)
- Collaborative Spaces (member management, shared conversations)
- Web search integration
- Translation
- Artifact canvas (code/document detection and rendering)

### 9. Organization Module

- Folder CRUD with color picker
- Conversation pinning
- Search with highlighting
- Conversation sharing (link generation)

## UI Components

### Modals and Panels

| Component | Purpose |
|-----------|---------|
| Auth modal | Login/register forms |
| Template modal | Template browser with categories |
| Model selector | AI model picker with tier badges |
| Agent selector | Agent browser |
| Settings panel | User preferences |
| Profile modal | User profile and stats |
| 2FA setup modal | QR code and verification |
| Passkey modal | WebAuthn management |
| Session manager | Active sessions list |
| Affiliate dashboard | Earnings and referrals |
| Withdrawal modal | MoMo withdrawal form |
| Folder manager | Create/edit/delete folders |
| Share modal | Conversation sharing |
| Vision modal | Image analysis options |
| Research panel | Deep research progress |
| Analysis panel | Data analysis results |
| Workflow wizard | Step-by-step workflow |
| Meeting panel | Upload and minutes display |
| Spaces panel | Space management |
| Memory manager | View/delete AI memories |
| Artifact canvas | Code/document viewer |
| Pricing modal | Tier comparison and payment |
| Announcement banner | System notifications |
| Keyboard shortcuts | Shortcut reference |
| Install prompt | PWA install CTA |

### Sidebar

- Conversation list (grouped by date: Today, Yesterday, Previous 7 Days, Older)
- Folder filtering
- New chat button
- Search bar
- User menu

### Chat Area

- Message bubbles (user right, assistant left)
- Streaming indicator (typing dots)
- Model badge on assistant messages
- Action bar (copy, download, rate, regenerate)
- Input area with toolbar (voice, attach, template, tools)

## Lazy Loading Strategy

- **Chart.js** -- Loaded on-demand when data analysis is triggered
- **docx.js** -- Loaded on-demand for DOCX generation
- Heavy modules are loaded via dynamic script injection

## Persona System

Two personas that filter templates and adjust UI:

1. **GoG Employee** -- Government-focused templates, formal tone
2. **Student** -- Academic templates, student pricing, study tools

Selected during registration, changeable in settings.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New conversation |
| `Ctrl+K` | Search conversations |
| `Ctrl+/` | Toggle sidebar |
| `Ctrl+Shift+V` | Toggle voice mode |
| `Ctrl+Shift+T` | Open templates |
| `Ctrl+Shift+M` | Open model selector |
| `Ctrl+Enter` | Send message |
| `Escape` | Close modal/panel |
