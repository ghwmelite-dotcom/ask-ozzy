# Changelog

## Current Version: v1.0.0

AskOzzy — AI-powered productivity platform for Government of Ghana operations.

---

## Phase Timeline

### Phase 1: Foundation (Core Platform)

- User authentication with access codes
- Multi-model AI chat with SSE streaming
- Conversation management (CRUD, search)
- Prompt templates for GoG civil servants (27 templates)
- Pricing tiers (Free/Professional/Enterprise)
- Paystack payment integration (MoMo + cards)
- Referral system with affiliate tracking
- Admin portal with dashboard, user management
- D1 database with core schema (15 tables)
- PWA with service worker and offline support
- Mobile-responsive design

### Phase 2: Intelligence Layer

- Deep Research mode (5-step AI research pipeline)
- Data Analysis with Chart.js visualizations
- Vision AI (4 modes: describe, OCR, form, receipt)
- Web search integration (DuckDuckGo)
- Translation (m2m100 model)
- AI Memory system (auto-extraction + manual)
- Custom AI Agents (25 pre-seeded)
- Artifact detection and canvas
- Message rating (thumbs up/down)
- Message regeneration
- Follow-up suggestions
- Knowledge base (RAG) with document upload
- FAQ management system
- Research reports table

### Phase 3: Enhanced Experience

- WebAuthn passkeys (FIDO2)
- TOTP 2FA with QR code setup
- Recovery codes
- Session management (view/revoke)
- Voice input (7 languages: English, Twi, Ga, Ewe, Hausa, Dagbani, French)
- Text-to-speech output
- Voice mode with waveform
- Conversation folders with color picker
- Conversation pinning
- Conversation sharing (public links)
- Dark theme (default)
- Keyboard shortcuts
- Enhanced markdown rendering

### Phase 4: Platform Dominance

- Workflow automation (multi-step wizards)
- AI Meeting Assistant (upload → transcribe → minutes)
- Collaborative Spaces (invite, share conversations)
- Citizen Bot (public-facing, no auth required)
- Organizations (team billing, member management)
- Student persona with academic templates (16 templates)
- Student pricing (discounted tiers)
- Affiliate commission engine (2-level: 30% L1, 5% L2)
- Affiliate wallet with withdrawal requests
- Milestone bonuses (10/25/50/100 referrals)
- Leaderboard
- Bulk user import (CSV)
- Department admin role
- Enhanced admin portal (16 tabs)

### Phase 5: Competition Killers

- USSD fallback (`*713*OZZY#`) for feature phones
- WhatsApp bot integration
- SMS bot integration
- Push notifications (VAPID)
- Audit trail (user activity logging)
- Productivity dashboard (hours saved, docs generated)
- Gamification (streaks, badges)
- 3-day free trial system
- Usage nudge system
- Advanced admin tools:
  - Moderation system with flagging
  - Enhanced audit log with filtering/export
  - Knowledge base bulk upload
  - Document training pipeline
  - Messaging session management
  - USSD configuration
  - Rate limit monitoring
  - Organization management

---

## Recent Updates (February 2025)

### Week 1 (Feb 1-7)

- Implemented 2-level affiliate commission engine
- Added affiliate wallets and withdrawal system
- Built affiliate admin management (approve/reject withdrawals)
- Added milestone bonus system
- Implemented leaderboard

### Week 2 (Feb 8-14)

- Added USSD callback handler with menu system
- Implemented WhatsApp webhook integration
- Added SMS webhook integration
- Built messaging admin panel (config, stats, test)
- Added push notification system (VAPID, subscribe, preferences)
- Implemented gamification (streaks, badges, nudges)
- Added 3-day free trial activation
- Built productivity tracking (per-user daily stats)
- Enhanced audit log (filtering, export, statistics)
- Added moderation statistics
- Student persona with 16 academic templates
- Student pricing for all tiers
- Comprehensive documentation suite (15 files)

---

## Known Limitations

| # | Limitation | Details |
|---|-----------|---------|
| 1 | Single Worker | Entire backend in one file (8,600+ lines) — could benefit from modularization |
| 2 | No email sending | Access codes displayed on-screen only (no email delivery) |
| 3 | Manual MoMo payouts | Affiliate withdrawals require manual admin processing |
| 4 | D1 limitations | SQLite at edge — no stored procedures, limited concurrent writes |
| 5 | No real-time collaboration | Spaces are share-only (no live co-editing) |
| 6 | USSD response length | Limited by carrier (182 chars typical) |
| 7 | WhatsApp/SMS | Requires external API provider (Africa's Talking / Twilio) — not yet connected to live provider |
| 8 | WebAuthn | Not supported in all browsers (Firefox partial support) |
| 9 | Voice input | Requires browser Web Speech API support (Chrome best) |
| 10 | Offline | Only previously cached content available offline |

---

## Planned Improvements

### Short-term

- Email integration for access code delivery
- Automated MoMo payouts via API
- File attachment support in chat (beyond images)
- Conversation export (PDF, DOCX)
- Multi-language UI (not just voice input)

### Medium-term

- Real-time collaboration in Spaces
- Custom template builder for users
- API key system for external integrations
- Webhook system for third-party notifications
- Mobile native app (React Native or Flutter)

### Long-term

- On-device AI via WebLLM (true offline AI)
- Ghana-specific fine-tuned models
- Document output with GoG letterheads (.docx/.pdf)
- Integration with Ghana.gov services
- Biometric attendance integration
- District-level deployment

---

*For setup instructions, see [Getting Started](03-getting-started.md).*
*For deployment, see [Deployment Guide](13-deployment.md).*
