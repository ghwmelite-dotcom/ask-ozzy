# AskOzzy API Reference

**Base URL:** `https://askozzy.ghwmelite.workers.dev`

**Content Type:** All endpoints accept and return `application/json` unless otherwise noted.

**Authentication:** Include a Bearer token in the `Authorization` header for protected endpoints:

```
Authorization: Bearer <session_token>
```

**Auth Levels:**

| Level | Description |
|-------|-------------|
| Public | No authentication required |
| Auth required | Valid Bearer token required |
| Admin | Bearer token for a user with `super_admin` or `admin` role |
| Dept admin+ | Bearer token for a user with `dept_admin`, `admin`, or `super_admin` role |

**Standard Error Response:**

```json
{
  "error": "Description of what went wrong"
}
```

---

## Authentication

### POST /api/auth/register

Register a new user account. An access code is generated and returned.

**Auth:** Public

**Request Body:**

```json
{
  "email": "kwame.mensah@gov.gh",
  "fullName": "Kwame Mensah",
  "department": "Ministry of Finance",
  "referralCode": "ABC123",
  "userType": "government"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | User email address |
| fullName | string | Yes | Full name |
| department | string | No | Government department |
| referralCode | string | No | Referral code from another user |
| userType | string | No | User type (e.g., `government`, `student`) |

**Response (201):**

```json
{
  "accessCode": "OZZY-7K3M-X9PL",
  "token": "sess_abc123def456...",
  "user": {
    "id": "usr_abc123",
    "email": "kwame.mensah@gov.gh",
    "fullName": "Kwame Mensah",
    "department": "Ministry of Finance",
    "tier": "free",
    "role": "user"
  }
}
```

---

### POST /api/auth/register/verify-totp

Verify a TOTP code during registration when 2FA is enforced.

**Auth:** Public

**Request Body:**

```json
{
  "userId": "usr_abc123",
  "code": "482917"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| userId | string | Yes | The user ID returned from registration |
| code | string | Yes | 6-digit TOTP code |

**Response (200):**

```json
{
  "success": true,
  "token": "sess_abc123def456...",
  "user": {
    "id": "usr_abc123",
    "email": "kwame.mensah@gov.gh",
    "fullName": "Kwame Mensah"
  }
}
```

---

### POST /api/auth/login

Login with an access code.

**Auth:** Public

**Request Body:**

```json
{
  "accessCode": "OZZY-7K3M-X9PL"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| accessCode | string | Yes | The user's access code |

**Response (200):**

```json
{
  "token": "sess_abc123def456...",
  "user": {
    "id": "usr_abc123",
    "email": "kwame.mensah@gov.gh",
    "fullName": "Kwame Mensah",
    "tier": "professional",
    "role": "user",
    "department": "Ministry of Finance"
  }
}
```

---

### POST /api/auth/logout

Logout and invalidate the current session token.

**Auth:** Auth required

**Request Body:** None

**Response (200):**

```json
{
  "success": true
}
```

---

### POST /api/auth/webauthn/register-options

Get WebAuthn (passkey) registration options for the authenticated user.

**Auth:** Auth required

**Request Body:** None

**Response (200):**

```json
{
  "options": {
    "challenge": "base64-encoded-challenge",
    "rp": {
      "name": "AskOzzy",
      "id": "askozzy.ghwmelite.workers.dev"
    },
    "user": {
      "id": "base64-user-id",
      "name": "kwame.mensah@gov.gh",
      "displayName": "Kwame Mensah"
    },
    "pubKeyCredParams": [
      { "type": "public-key", "alg": -7 },
      { "type": "public-key", "alg": -257 }
    ],
    "authenticatorSelection": {
      "userVerification": "preferred"
    }
  }
}
```

---

### POST /api/auth/webauthn/register-complete

Complete WebAuthn registration by submitting the attestation response.

**Auth:** Auth required

**Request Body:**

```json
{
  "credential": {
    "id": "credential-id",
    "rawId": "base64-raw-id",
    "response": {
      "attestationObject": "base64-attestation",
      "clientDataJSON": "base64-client-data"
    },
    "type": "public-key"
  },
  "name": "My YubiKey"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| credential | object | Yes | WebAuthn credential response from browser |
| name | string | No | Friendly name for the passkey |

**Response (200):**

```json
{
  "success": true,
  "credentialId": "cred_abc123"
}
```

---

### POST /api/auth/webauthn/login-options

Get WebAuthn login options for a given email.

**Auth:** Public

**Request Body:**

```json
{
  "email": "kwame.mensah@gov.gh"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | User email to look up registered passkeys |

**Response (200):**

```json
{
  "options": {
    "challenge": "base64-encoded-challenge",
    "rpId": "askozzy.ghwmelite.workers.dev",
    "allowCredentials": [
      {
        "type": "public-key",
        "id": "base64-credential-id"
      }
    ],
    "userVerification": "preferred"
  }
}
```

---

### POST /api/auth/webauthn/login-complete

Complete WebAuthn login by submitting the assertion response.

**Auth:** Public

**Request Body:**

```json
{
  "credential": {
    "id": "credential-id",
    "rawId": "base64-raw-id",
    "response": {
      "authenticatorData": "base64-auth-data",
      "clientDataJSON": "base64-client-data",
      "signature": "base64-signature"
    },
    "type": "public-key"
  }
}
```

**Response (200):**

```json
{
  "token": "sess_abc123def456...",
  "user": {
    "id": "usr_abc123",
    "email": "kwame.mensah@gov.gh",
    "fullName": "Kwame Mensah",
    "tier": "professional",
    "role": "user"
  }
}
```

---

### GET /api/auth/webauthn/credentials

List the authenticated user's registered passkey credentials.

**Auth:** Auth required

**Response (200):**

```json
{
  "credentials": [
    {
      "id": "cred_abc123",
      "name": "My YubiKey",
      "createdAt": "2025-03-15T10:30:00Z",
      "lastUsed": "2025-04-01T14:22:00Z"
    }
  ]
}
```

---

### DELETE /api/auth/webauthn/credentials/:id

Delete a registered passkey credential.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Credential ID to delete |

**Response (200):**

```json
{
  "success": true
}
```

---

### POST /api/auth/recovery-code/regenerate

Regenerate the user's account recovery code.

**Auth:** Auth required

**Request Body:** None

**Response (200):**

```json
{
  "recoveryCode": "RCVY-ABCD-EFGH-1234"
}
```

---

### POST /api/auth/reset-account

Self-service account reset using a recovery code. Generates new access code, TOTP secret, and recovery code. No session is created — the user must verify TOTP via `POST /api/auth/register/verify-totp` before signing in.

**Auth:** None (public endpoint)

**Rate Limit:** `auth` category (10 attempts / 5 minutes per IP+email)

**Request Body:**

```json
{
  "email": "kwame@gov.gh",
  "recoveryCode": "R3K9-M2X7"
}
```

**Response (200):**

```json
{
  "totpUri": "otpauth://totp/AskOzzy:kwame@gov.gh?secret=JBSWY3DPEHPK3PXP&issuer=AskOzzy&digits=6&period=30",
  "totpSecret": "JBSWY3DPEHPK3PXP",
  "accessCode": "N7F2-K4PB",
  "recoveryCode": "W5H8-J3QL",
  "email": "kwame@gov.gh"
}
```

**Errors:**

| Status | Error |
|--------|-------|
| 400 | Email and recovery code are required |
| 401 | Invalid email or recovery code |
| 429 | Too many attempts. Please wait 5 minutes. |

**Notes:**
- The recovery code is verified against the stored PBKDF2 hash.
- On success, the old access code, TOTP secret, and recovery code are all invalidated.
- The user must scan the new QR code (from `totpUri`) with their authenticator app and verify a 6-digit code via `POST /api/auth/register/verify-totp` to complete the reset and receive a session token.
- The new access code and recovery code are shown only once and should be saved securely.

---

### POST /api/admin/users/:userId/reset-account

Admin-initiated full account reset. Generates new access code, TOTP secret, and recovery code for the specified user.

**Auth:** Admin required (`super_admin` role)

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| userId | ID of the user to reset |

**Request Body:** None

**Response (200):**

```json
{
  "success": true,
  "accessCode": "N7F2-K4PB",
  "recoveryCode": "W5H8-J3QL",
  "totpUri": "otpauth://totp/AskOzzy:kwame@gov.gh?secret=JBSWY3DPEHPK3PXP&issuer=AskOzzy&digits=6&period=30",
  "totpSecret": "JBSWY3DPEHPK3PXP",
  "email": "kwame@gov.gh",
  "fullName": "Kwame Asante"
}
```

**Errors:**

| Status | Error |
|--------|-------|
| 404 | User not found |

**Notes:**
- The admin shares the new access code with the user. The user signs in with it and is guided through TOTP re-enrollment.
- The action is logged to the audit trail as `reset_account`.
- Old access code, authenticator setup, and recovery code are all invalidated immediately.

---

## Conversations

### GET /api/conversations

List all conversations for the authenticated user.

**Auth:** Auth required

**Response (200):**

```json
{
  "conversations": [
    {
      "id": "conv_abc123",
      "title": "Budget Analysis Q4",
      "model": "@cf/meta/llama-3.1-70b-instruct",
      "templateId": null,
      "agentId": null,
      "folderId": null,
      "pinned": false,
      "messageCount": 12,
      "createdAt": "2025-04-01T09:15:00Z",
      "updatedAt": "2025-04-01T10:30:00Z"
    }
  ]
}
```

---

### POST /api/conversations

Create a new conversation.

**Auth:** Auth required

**Request Body:**

```json
{
  "title": "Procurement Policy Review",
  "model": "@cf/meta/llama-3.1-70b-instruct",
  "templateId": "budget-memo",
  "agentId": null,
  "folderId": "fold_abc123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| title | string | No | Conversation title (auto-generated if omitted) |
| model | string | No | AI model ID |
| templateId | string | No | Template to use for system prompt |
| agentId | string | No | Agent ID to assign |
| folderId | string | No | Folder to place conversation in |

**Response (201):**

```json
{
  "id": "conv_def456",
  "title": "Procurement Policy Review",
  "model": "@cf/meta/llama-3.1-70b-instruct",
  "createdAt": "2025-04-01T11:00:00Z"
}
```

---

### GET /api/conversations/:id/messages

Get all messages in a conversation.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Conversation ID |

**Response (200):**

```json
{
  "messages": [
    {
      "id": "msg_001",
      "role": "user",
      "content": "Summarize the Public Procurement Act",
      "createdAt": "2025-04-01T11:01:00Z"
    },
    {
      "id": "msg_002",
      "role": "assistant",
      "content": "The Public Procurement Act, 2003 (Act 663) establishes...",
      "model": "@cf/meta/llama-3.1-70b-instruct",
      "rating": 1,
      "createdAt": "2025-04-01T11:01:05Z"
    }
  ]
}
```

---

### DELETE /api/conversations/:id

Delete a conversation and all its messages.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Conversation ID |

**Response (200):**

```json
{
  "success": true
}
```

---

### PATCH /api/conversations/:id

Update conversation metadata.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Conversation ID |

**Request Body:**

```json
{
  "title": "Updated Title",
  "folderId": "fold_abc123",
  "pinned": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| title | string | No | New title |
| folderId | string | No | Move to folder (null to remove) |
| pinned | boolean | No | Pin/unpin conversation |

**Response (200):**

```json
{
  "success": true
}
```

---

### POST /api/conversations/:id/share

Share a conversation by generating a public share token.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Conversation ID |

**Request Body:** None

**Response (200):**

```json
{
  "shareToken": "share_xK9mP2qL",
  "shareUrl": "https://askozzy.ghwmelite.workers.dev/shared/share_xK9mP2qL"
}
```

---

### DELETE /api/conversations/:id/share

Remove public sharing from a conversation.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Conversation ID |

**Response (200):**

```json
{
  "success": true
}
```

---

### GET /api/shared/:token

View a shared conversation without authentication.

**Auth:** Public

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| token | Share token |

**Response (200):**

```json
{
  "conversation": {
    "title": "Budget Analysis Q4",
    "createdAt": "2025-04-01T09:15:00Z",
    "messages": [
      {
        "role": "user",
        "content": "Summarize the Q4 budget allocations"
      },
      {
        "role": "assistant",
        "content": "The Q4 budget allocations show..."
      }
    ]
  }
}
```

---

### GET /api/conversations/search

Search conversations by keyword.

**Auth:** Auth required

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| q | string | Yes | Search term |

**Example:** `GET /api/conversations/search?q=procurement`

**Response (200):**

```json
{
  "conversations": [
    {
      "id": "conv_abc123",
      "title": "Procurement Policy Review",
      "snippet": "...the procurement process requires...",
      "updatedAt": "2025-04-01T10:30:00Z"
    }
  ]
}
```

---

### GET /api/chat/suggestions/:conversationId

Get AI-generated follow-up question suggestions for a conversation.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| conversationId | Conversation ID |

**Response (200):**

```json
{
  "suggestions": [
    "What are the key amendments in the 2016 revision?",
    "How does this affect district-level procurement?",
    "Can you compare with the previous threshold limits?"
  ]
}
```

---

## Chat & AI

### POST /api/chat

Send a message and receive a streamed AI response via Server-Sent Events (SSE).

**Auth:** Auth required

**Request Body:**

```json
{
  "conversationId": "conv_abc123",
  "message": "Draft a memo on budget reallocation for Q2",
  "model": "@cf/meta/llama-3.1-70b-instruct",
  "imageData": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| conversationId | string | Yes | Conversation to add the message to |
| message | string | Yes | User message text |
| model | string | No | Override AI model for this message |
| imageData | string | No | Base64-encoded image for vision context |

**Response:** Server-Sent Events stream

```
data: {"type":"token","content":"The"}
data: {"type":"token","content":" memo"}
data: {"type":"token","content":" should"}
...
data: {"type":"done","messageId":"msg_xyz789","usage":{"prompt_tokens":150,"completion_tokens":420}}
```

**SSE Event Types:**

| Type | Description |
|------|-------------|
| token | Incremental text token |
| done | Stream complete with message ID and token usage |
| error | Error during generation |
| sources | RAG source documents used |

---

### POST /api/web-search

Perform a web search via DuckDuckGo and return results.

**Auth:** Auth required

**Request Body:**

```json
{
  "query": "Ghana 2025 budget statement highlights"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| query | string | Yes | Search query |

**Response (200):**

```json
{
  "results": [
    {
      "title": "2025 Budget Statement - Ministry of Finance",
      "url": "https://mofep.gov.gh/budget/2025",
      "snippet": "The 2025 budget allocates GHS 200 billion..."
    }
  ]
}
```

---

### POST /api/research

Start a deep research task (multi-step: search, gather, analyze, synthesize, report).

**Auth:** Auth required

**Request Body:**

```json
{
  "conversationId": "conv_abc123",
  "query": "Impact of Ghana's fiscal consolidation on public sector wages 2020-2025"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| conversationId | string | Yes | Conversation for the research output |
| query | string | Yes | Research question |

**Response (200):**

```json
{
  "researchId": "res_abc123",
  "status": "started",
  "steps": ["search", "gather", "analyze", "synthesize", "report"]
}
```

---

### GET /api/research/:id

Check the status of a deep research task.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Research task ID |

**Response (200):**

```json
{
  "researchId": "res_abc123",
  "status": "completed",
  "currentStep": "report",
  "progress": 100,
  "report": "## Research Report\n\n### Executive Summary\n..."
}
```

---

### POST /api/analyze

Analyze structured data (CSV or Excel) with AI.

**Auth:** Auth required

**Request Body:**

```json
{
  "conversationId": "conv_abc123",
  "data": "Department,Budget,Spent\nHealth,5000000,4200000\nEducation,8000000,7500000",
  "query": "Which department has the highest underspend?",
  "chartType": "bar"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| conversationId | string | Yes | Conversation context |
| data | string | Yes | CSV or tabular data as string |
| query | string | Yes | Analysis question |
| chartType | string | No | Chart type: `bar`, `line`, `pie`, `scatter` |

**Response (200):**

```json
{
  "analysis": "The Health department has the highest underspend at GHS 800,000 (16% of budget)...",
  "chartData": {
    "labels": ["Health", "Education"],
    "datasets": [
      {
        "label": "Underspend",
        "data": [800000, 500000]
      }
    ]
  }
}
```

---

### POST /api/translate

Translate text to a target language.

**Auth:** Auth required

**Request Body:**

```json
{
  "text": "The quarterly budget report is due by Friday",
  "targetLang": "tw"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| text | string | Yes | Text to translate |
| targetLang | string | Yes | Target language code (e.g., `tw` for Twi, `ee` for Ewe, `gaa` for Ga, `fr`, `ha`) |

**Response (200):**

```json
{
  "translation": "Abosome mmiensa budget amannebu no gyedi da Friday",
  "sourceLang": "en",
  "targetLang": "tw"
}
```

---

### POST /api/vision

Process an image with Vision AI in various modes.

**Auth:** Auth required

**Request Body:**

```json
{
  "conversationId": "conv_abc123",
  "imageData": "data:image/jpeg;base64,/9j/4AAQ...",
  "mode": "receipt"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| conversationId | string | Yes | Conversation context |
| imageData | string | Yes | Base64-encoded image with data URI prefix |
| mode | string | Yes | Processing mode: `describe`, `ocr`, `form`, `receipt` |

**Vision Modes:**

| Mode | Description |
|------|-------------|
| describe | General image description |
| ocr | Extract text from image |
| form | Parse form fields and values |
| receipt | Extract receipt line items, totals, vendor |

**Response (200):**

```json
{
  "result": "Receipt from Melcom Plus, Accra Mall\n\nItems:\n- Office Paper A4 (5 reams): GHS 125.00\n- Printer Toner: GHS 450.00\n\nSubtotal: GHS 575.00\nNHIL: GHS 14.38\nGETFund: GHS 14.38\nVAT (15%): GHS 90.56\nTotal: GHS 694.32",
  "messageId": "msg_xyz789"
}
```

---

### POST /api/chat/image

Chat with image context attached.

**Auth:** Auth required

**Request Body:**

```json
{
  "conversationId": "conv_abc123",
  "message": "What does this chart show?",
  "imageData": "data:image/png;base64,iVBOR..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| conversationId | string | Yes | Conversation context |
| message | string | Yes | User question about the image |
| imageData | string | Yes | Base64-encoded image |

**Response:** SSE stream (same format as POST /api/chat)

---

### POST /api/chat/detect-artifact

Detect whether an AI response contains an artifact (code block, table, document).

**Auth:** Auth required

**Request Body:**

```json
{
  "content": "Here is the HTML table:\n```html\n<table>...</table>\n```"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| content | string | Yes | AI response content to analyze |

**Response (200):**

```json
{
  "hasArtifact": true,
  "type": "html",
  "title": "Data Table"
}
```

---

## Messages

### POST /api/messages/:id/rate

Rate an AI message with thumbs up or thumbs down.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Message ID |

**Request Body:**

```json
{
  "rating": 1
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| rating | number | Yes | `1` for thumbs up, `-1` for thumbs down |

**Response (200):**

```json
{
  "success": true
}
```

---

### POST /api/messages/:id/regenerate

Regenerate the AI response for a given message.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Message ID to regenerate |

**Response:** SSE stream (same format as POST /api/chat)

---

## User Profile

### GET /api/user/profile

Get the authenticated user's profile information.

**Auth:** Auth required

**Response (200):**

```json
{
  "user": {
    "id": "usr_abc123",
    "email": "kwame.mensah@gov.gh",
    "fullName": "Kwame Mensah",
    "department": "Ministry of Finance",
    "tier": "professional",
    "role": "user",
    "referralCode": "KWAME-X7K9",
    "twoFactorEnabled": true,
    "createdAt": "2025-01-15T08:00:00Z"
  }
}
```

---

### GET /api/user/dashboard

Get the user's dashboard statistics.

**Auth:** Auth required

**Response (200):**

```json
{
  "stats": {
    "totalConversations": 47,
    "totalMessages": 312,
    "tokensUsed": 185420,
    "documentsGenerated": 8,
    "currentStreak": 5,
    "tier": "professional",
    "usagePercent": 62
  }
}
```

---

### GET /api/user/sessions

List the user's active sessions.

**Auth:** Auth required

**Response (200):**

```json
{
  "sessions": [
    {
      "id": "sess_abc123",
      "device": "Chrome on Windows",
      "ip": "41.215.x.x",
      "lastActive": "2025-04-01T14:30:00Z",
      "current": true
    },
    {
      "id": "sess_def456",
      "device": "Safari on iPhone",
      "ip": "41.215.x.x",
      "lastActive": "2025-03-30T09:15:00Z",
      "current": false
    }
  ]
}
```

---

### POST /api/user/sessions/revoke-all

Revoke all sessions except the current one.

**Auth:** Auth required

**Request Body:** None

**Response (200):**

```json
{
  "success": true,
  "revokedCount": 3
}
```

---

### POST /api/user/2fa/setup

Initialize TOTP two-factor authentication setup. Returns a secret and QR code URL.

**Auth:** Auth required

**Request Body:** None

**Response (200):**

```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "qrUrl": "otpauth://totp/AskOzzy:kwame.mensah@gov.gh?secret=JBSWY3DPEHPK3PXP&issuer=AskOzzy"
}
```

---

### POST /api/user/2fa/verify

Verify a TOTP code and enable two-factor authentication.

**Auth:** Auth required

**Request Body:**

```json
{
  "code": "847291"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| code | string | Yes | 6-digit TOTP code from authenticator app |

**Response (200):**

```json
{
  "success": true,
  "recoveryCode": "RCVY-ABCD-EFGH-1234"
}
```

---

### POST /api/user/2fa/disable

Disable two-factor authentication.

**Auth:** Auth required

**Request Body:**

```json
{
  "code": "847291"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| code | string | Yes | 6-digit TOTP code to confirm disabling |

**Response (200):**

```json
{
  "success": true
}
```

---

## Models

### GET /api/models

List all available AI models with tier access information.

**Auth:** Auth required

**Response (200):**

```json
{
  "models": [
    {
      "id": "@cf/meta/llama-3.1-8b-instruct",
      "name": "Llama 3.1 8B",
      "provider": "Meta",
      "tier": "free",
      "description": "Fast, efficient model for general tasks",
      "maxTokens": 4096,
      "supportsVision": false
    },
    {
      "id": "@cf/meta/llama-3.1-70b-instruct",
      "name": "Llama 3.1 70B",
      "provider": "Meta",
      "tier": "starter",
      "description": "Powerful model for complex reasoning",
      "maxTokens": 8192,
      "supportsVision": false
    },
    {
      "id": "@cf/meta/llama-3.2-11b-vision-instruct",
      "name": "Llama 3.2 Vision",
      "provider": "Meta",
      "tier": "professional",
      "description": "Multimodal model with image understanding",
      "maxTokens": 4096,
      "supportsVision": true
    }
  ]
}
```

---

## Pricing & Subscriptions

### GET /api/pricing

Get pricing tiers and feature details. If authenticated, includes student pricing.

**Auth:** Public (checks auth for student pricing)

**Response (200):**

```json
{
  "tiers": [
    {
      "id": "free",
      "name": "Free",
      "price": 0,
      "currency": "GHS",
      "features": [
        "10 messages/day",
        "Llama 3.1 8B model",
        "Basic templates"
      ]
    },
    {
      "id": "starter",
      "name": "Starter",
      "price": 30,
      "currency": "GHS",
      "period": "monthly",
      "features": [
        "100 messages/day",
        "Llama 3.1 70B model",
        "All templates",
        "Web search"
      ]
    },
    {
      "id": "professional",
      "name": "Professional",
      "price": 60,
      "currency": "GHS",
      "period": "monthly",
      "features": [
        "500 messages/day",
        "All models including Vision",
        "Deep research",
        "Document generation",
        "Priority support"
      ]
    },
    {
      "id": "enterprise",
      "name": "Enterprise",
      "price": 100,
      "currency": "GHS",
      "period": "monthly",
      "features": [
        "Unlimited messages",
        "All models",
        "Custom agents",
        "Team spaces",
        "API access",
        "Dedicated support"
      ]
    }
  ]
}
```

---

### GET /api/usage/status

Get the authenticated user's current usage against their tier limits.

**Auth:** Auth required

**Response (200):**

```json
{
  "usage": {
    "messagesUsed": 62,
    "messagesLimit": 500,
    "tier": "professional",
    "resetsAt": "2025-04-02T00:00:00Z"
  }
}
```

---

### POST /api/upgrade

Initiate a tier upgrade.

**Auth:** Auth required

**Request Body:**

```json
{
  "tier": "professional"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| tier | string | Yes | Target tier: `starter`, `professional`, `enterprise` |

**Response (200):**

```json
{
  "success": true,
  "paymentRequired": true,
  "paymentUrl": "https://paystack.com/pay/ozzy_pro_abc123"
}
```

---

### POST /api/payments/initialize

Initialize a Paystack payment for subscription.

**Auth:** Auth required

**Request Body:**

```json
{
  "plan": "professional",
  "channel": "mobile_money"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| plan | string | Yes | Subscription plan ID |
| channel | string | No | Payment channel: `card`, `mobile_money` |

**Response (200):**

```json
{
  "authorization_url": "https://checkout.paystack.com/abc123xyz",
  "access_code": "abc123xyz",
  "reference": "OZZY-PAY-1234567890"
}
```

---

### POST /api/webhooks/paystack

Paystack payment webhook. Verified using HMAC signature.

**Auth:** Public (HMAC verified via `x-paystack-signature` header)

**Request Body:** Paystack webhook payload (sent automatically by Paystack)

```json
{
  "event": "charge.success",
  "data": {
    "reference": "OZZY-PAY-1234567890",
    "amount": 6000,
    "currency": "GHS",
    "channel": "mobile_money",
    "customer": {
      "email": "kwame.mensah@gov.gh"
    }
  }
}
```

**Response (200):**

```json
{
  "success": true
}
```

---

## Affiliate

### GET /api/affiliate/dashboard

Get the authenticated user's affiliate dashboard data.

**Auth:** Auth required

**Response (200):**

```json
{
  "affiliate": {
    "referralCode": "KWAME-X7K9",
    "balance": 45.00,
    "totalEarned": 180.00,
    "totalReferrals": 12,
    "activeReferrals": 8,
    "tier": "silver",
    "network": [
      {
        "email": "ama.d***@gov.gh",
        "joinedAt": "2025-03-20T10:00:00Z",
        "tier": "starter",
        "earned": 15.00
      }
    ]
  }
}
```

---

### GET /api/affiliate/transactions

Get affiliate transaction history.

**Auth:** Auth required

**Response (200):**

```json
{
  "transactions": [
    {
      "id": "txn_abc123",
      "type": "commission",
      "amount": 15.00,
      "currency": "GHS",
      "description": "Referral commission from ama.d***@gov.gh",
      "createdAt": "2025-03-25T14:00:00Z"
    },
    {
      "id": "txn_def456",
      "type": "withdrawal",
      "amount": -50.00,
      "currency": "GHS",
      "status": "completed",
      "createdAt": "2025-03-28T09:00:00Z"
    }
  ]
}
```

---

### POST /api/affiliate/withdraw

Request an affiliate commission withdrawal via Mobile Money.

**Auth:** Auth required

**Request Body:**

```json
{
  "amount": 50.00,
  "momoNumber": "0241234567",
  "momoNetwork": "MTN"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| amount | number | Yes | Withdrawal amount in GHS |
| momoNumber | string | Yes | Mobile Money number |
| momoNetwork | string | Yes | Network: `MTN`, `Vodafone`, `AirtelTigo` |

**Response (200):**

```json
{
  "withdrawalId": "wd_abc123",
  "status": "pending",
  "amount": 50.00,
  "estimatedCompletion": "2025-04-03T00:00:00Z"
}
```

---

### GET /api/affiliate/leaderboard

Get the top affiliates leaderboard.

**Auth:** Auth required

**Response (200):**

```json
{
  "leaderboard": [
    {
      "rank": 1,
      "name": "Kwame M.",
      "referrals": 45,
      "earned": 675.00,
      "tier": "gold"
    },
    {
      "rank": 2,
      "name": "Ama D.",
      "referrals": 32,
      "earned": 480.00,
      "tier": "silver"
    }
  ]
}
```

---

### GET /api/admin/affiliate/withdrawals

List all affiliate withdrawal requests.

**Auth:** Admin

**Response (200):**

```json
{
  "withdrawals": [
    {
      "id": "wd_abc123",
      "userId": "usr_abc123",
      "userName": "Kwame Mensah",
      "amount": 50.00,
      "momoNumber": "0241234567",
      "momoNetwork": "MTN",
      "status": "pending",
      "createdAt": "2025-04-01T10:00:00Z"
    }
  ]
}
```

---

### POST /api/admin/affiliate/withdrawals/:id/approve

Approve an affiliate withdrawal request.

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Withdrawal ID |

**Request Body:** None

**Response (200):**

```json
{
  "success": true,
  "status": "approved"
}
```

---

### POST /api/admin/affiliate/withdrawals/:id/reject

Reject an affiliate withdrawal request with a reason.

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Withdrawal ID |

**Request Body:**

```json
{
  "reason": "Insufficient verification documents"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| reason | string | Yes | Reason for rejection |

**Response (200):**

```json
{
  "success": true,
  "status": "rejected"
}
```

---

### GET /api/admin/affiliate/stats

Get overall affiliate program statistics.

**Auth:** Admin

**Response (200):**

```json
{
  "stats": {
    "totalAffiliates": 156,
    "activeAffiliates": 89,
    "totalCommissions": 12450.00,
    "pendingWithdrawals": 850.00,
    "totalWithdrawn": 9800.00,
    "topReferrer": "Kwame Mensah",
    "averageReferrals": 4.2
  }
}
```

---

## Knowledge Base

### GET /api/admin/kb/stats

Get knowledge base statistics.

**Auth:** Admin

**Response (200):**

```json
{
  "stats": {
    "totalDocuments": 45,
    "totalChunks": 1230,
    "totalFaqs": 78,
    "vectorCount": 1230,
    "lastUpdated": "2025-04-01T08:00:00Z"
  }
}
```

---

### POST /api/admin/documents

Create a document entry in the knowledge base.

**Auth:** Admin

**Request Body:**

```json
{
  "title": "Public Procurement Act 2003",
  "content": "Act 663 of the Republic of Ghana...",
  "category": "legislation",
  "tags": ["procurement", "law", "act-663"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| title | string | Yes | Document title |
| content | string | Yes | Full document text content |
| category | string | No | Document category |
| tags | array | No | Tags for filtering |

**Response (201):**

```json
{
  "id": "doc_abc123",
  "title": "Public Procurement Act 2003",
  "chunksCreated": 24,
  "vectorsStored": 24
}
```

---

### POST /api/admin/documents/upload-file

Upload a file for RAG processing. Supports PDF, DOCX, PPTX, TXT, CSV.

**Auth:** Admin

**Request Body:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | File | Yes | Document file to upload |
| title | string | No | Override title (defaults to filename) |
| category | string | No | Document category |

**Response (201):**

```json
{
  "id": "doc_def456",
  "title": "Financial Administration Act.pdf",
  "pages": 42,
  "chunksCreated": 156,
  "vectorsStored": 156
}
```

---

### POST /api/admin/documents/scrape-url

Scrape a URL and add its content to the knowledge base.

**Auth:** Admin

**Request Body:**

```json
{
  "url": "https://mofep.gov.gh/publications/budget-2025",
  "title": "Ghana 2025 Budget Statement"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| url | string | Yes | URL to scrape |
| title | string | No | Override title |

**Response (201):**

```json
{
  "id": "doc_ghi789",
  "title": "Ghana 2025 Budget Statement",
  "contentLength": 45230,
  "chunksCreated": 90,
  "vectorsStored": 90
}
```

---

### GET /api/admin/documents

List all documents in the knowledge base.

**Auth:** Admin

**Response (200):**

```json
{
  "documents": [
    {
      "id": "doc_abc123",
      "title": "Public Procurement Act 2003",
      "category": "legislation",
      "chunks": 24,
      "createdAt": "2025-03-01T10:00:00Z"
    }
  ]
}
```

---

### DELETE /api/admin/documents/:id

Delete a document and all its associated chunks and vectors.

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Document ID |

**Response (200):**

```json
{
  "success": true,
  "chunksDeleted": 24,
  "vectorsDeleted": 24
}
```

---

### POST /api/admin/kb

Create a FAQ knowledge base entry.

**Auth:** Admin

**Request Body:**

```json
{
  "question": "What is the procurement threshold for single-source?",
  "answer": "Under Act 663, single-source procurement is permitted for goods and services below GHS 20,000...",
  "category": "procurement"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| question | string | Yes | FAQ question |
| answer | string | Yes | FAQ answer |
| category | string | No | FAQ category |

**Response (201):**

```json
{
  "id": "faq_abc123",
  "question": "What is the procurement threshold for single-source?",
  "createdAt": "2025-04-01T10:00:00Z"
}
```

---

### GET /api/admin/kb

List all FAQ entries.

**Auth:** Admin

**Response (200):**

```json
{
  "entries": [
    {
      "id": "faq_abc123",
      "question": "What is the procurement threshold for single-source?",
      "answer": "Under Act 663, single-source procurement is permitted...",
      "category": "procurement",
      "createdAt": "2025-04-01T10:00:00Z"
    }
  ]
}
```

---

### PATCH /api/admin/kb/:id

Update a FAQ entry.

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | FAQ entry ID |

**Request Body:**

```json
{
  "question": "Updated question text",
  "answer": "Updated answer text",
  "category": "updated-category"
}
```

**Response (200):**

```json
{
  "success": true
}
```

---

### DELETE /api/admin/kb/:id

Delete a FAQ entry.

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | FAQ entry ID |

**Response (200):**

```json
{
  "success": true
}
```

---

### POST /api/admin/knowledge/bulk

Bulk upload multiple knowledge documents at once.

**Auth:** Admin

**Request Body:**

```json
{
  "documents": [
    {
      "title": "Civil Service Act 1993",
      "content": "PNDCL 327 governs the civil service...",
      "category": "legislation"
    },
    {
      "title": "Financial Administration Regulations",
      "content": "LI 1802 provides the regulations...",
      "category": "regulations"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| documents | array | Yes | Array of document objects with title, content, and optional category |

**Response (201):**

```json
{
  "success": true,
  "documentsCreated": 2,
  "totalChunks": 48
}
```

---

### GET /api/admin/knowledge/stats

Get knowledge system statistics.

**Auth:** Admin

**Response (200):**

```json
{
  "stats": {
    "totalDocuments": 45,
    "totalChunks": 1230,
    "categories": {
      "legislation": 12,
      "regulations": 8,
      "policy": 15,
      "guidelines": 10
    }
  }
}
```

---

### GET /api/admin/knowledge/documents

List all knowledge documents with metadata.

**Auth:** Admin

**Response (200):**

```json
{
  "documents": [
    {
      "id": "kdoc_abc123",
      "title": "Civil Service Act 1993",
      "category": "legislation",
      "chunkCount": 18,
      "createdAt": "2025-03-15T10:00:00Z"
    }
  ]
}
```

---

## Memories

### GET /api/memories

List the authenticated user's saved memories (persistent context for AI).

**Auth:** Auth required

**Response (200):**

```json
{
  "memories": [
    {
      "id": "mem_abc123",
      "key": "department",
      "value": "Ministry of Finance, Budget Division",
      "type": "preference",
      "createdAt": "2025-03-01T10:00:00Z"
    },
    {
      "id": "mem_def456",
      "key": "writing_style",
      "value": "Formal, civil service tone with references to regulations",
      "type": "preference",
      "createdAt": "2025-03-05T14:00:00Z"
    }
  ]
}
```

---

### POST /api/memories

Create a new user memory.

**Auth:** Auth required

**Request Body:**

```json
{
  "key": "role",
  "value": "Principal Budget Analyst",
  "type": "preference"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| key | string | Yes | Memory key/identifier |
| value | string | Yes | Memory value |
| type | string | No | Memory type (e.g., `preference`, `fact`, `instruction`) |

**Response (201):**

```json
{
  "id": "mem_ghi789",
  "key": "role",
  "value": "Principal Budget Analyst",
  "createdAt": "2025-04-01T10:00:00Z"
}
```

---

### DELETE /api/memories/:id

Delete a user memory.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Memory ID |

**Response (200):**

```json
{
  "success": true
}
```

---

### GET /api/admin/users/:id/memories

View a specific user's memories (admin access).

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | User ID |

**Response (200):**

```json
{
  "memories": [
    {
      "id": "mem_abc123",
      "key": "department",
      "value": "Ministry of Finance, Budget Division",
      "type": "preference",
      "createdAt": "2025-03-01T10:00:00Z"
    }
  ]
}
```

---

## Agents

### GET /api/agents

List all active AI agents.

**Auth:** Public

**Response (200):**

```json
{
  "agents": [
    {
      "id": "agent_budget",
      "name": "Budget Analyst",
      "description": "Expert in Ghana government budgeting, MTEF, and fiscal policy",
      "avatar": "chart-bar",
      "category": "finance",
      "systemPrompt": "You are a budget analysis expert...",
      "active": true
    },
    {
      "id": "agent_legal",
      "name": "Legal Advisor",
      "description": "Specialist in Ghana public law, procurement regulations, and compliance",
      "avatar": "scale",
      "category": "legal",
      "systemPrompt": "You are a legal advisor...",
      "active": true
    }
  ]
}
```

---

### GET /api/agents/:id

Get detailed information about a specific agent.

**Auth:** Public

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Agent ID |

**Response (200):**

```json
{
  "agent": {
    "id": "agent_budget",
    "name": "Budget Analyst",
    "description": "Expert in Ghana government budgeting, MTEF, and fiscal policy",
    "avatar": "chart-bar",
    "category": "finance",
    "systemPrompt": "You are a budget analysis expert specializing in Ghana government finances...",
    "model": "@cf/meta/llama-3.1-70b-instruct",
    "active": true,
    "conversationCount": 234
  }
}
```

---

### POST /api/admin/agents

Create a new AI agent.

**Auth:** Admin

**Request Body:**

```json
{
  "name": "HR Advisor",
  "description": "Human resources specialist for Ghana civil service",
  "avatar": "users",
  "category": "hr",
  "systemPrompt": "You are an HR advisor specializing in Ghana civil service regulations...",
  "model": "@cf/meta/llama-3.1-70b-instruct",
  "active": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Agent name |
| description | string | Yes | Agent description |
| avatar | string | No | Icon identifier |
| category | string | No | Agent category |
| systemPrompt | string | Yes | System prompt for the agent |
| model | string | No | Preferred AI model |
| active | boolean | No | Whether agent is active (default true) |

**Response (201):**

```json
{
  "id": "agent_hr",
  "name": "HR Advisor",
  "createdAt": "2025-04-01T10:00:00Z"
}
```

---

### PATCH /api/admin/agents/:id

Update an existing agent.

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Agent ID |

**Request Body:**

```json
{
  "description": "Updated description",
  "systemPrompt": "Updated system prompt...",
  "active": false
}
```

**Response (200):**

```json
{
  "success": true
}
```

---

### DELETE /api/admin/agents/:id

Delete an agent.

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Agent ID |

**Response (200):**

```json
{
  "success": true
}
```

---

### GET /api/admin/agents

List all agents including inactive ones.

**Auth:** Admin

**Response (200):**

```json
{
  "agents": [
    {
      "id": "agent_budget",
      "name": "Budget Analyst",
      "active": true,
      "conversationCount": 234,
      "createdAt": "2025-01-15T10:00:00Z"
    },
    {
      "id": "agent_deprecated",
      "name": "Old Agent",
      "active": false,
      "conversationCount": 12,
      "createdAt": "2025-01-10T10:00:00Z"
    }
  ]
}
```

---

### POST /api/admin/seed-agents

Seed the platform with 25 default GoG-focused agents.

**Auth:** Admin

**Request Body:** None

**Response (201):**

```json
{
  "success": true,
  "agentsCreated": 25
}
```

---

## Folders

### GET /api/folders

List the authenticated user's conversation folders.

**Auth:** Auth required

**Response (200):**

```json
{
  "folders": [
    {
      "id": "fold_abc123",
      "name": "Budget Work",
      "color": "#2563eb",
      "conversationCount": 8,
      "createdAt": "2025-03-01T10:00:00Z"
    },
    {
      "id": "fold_def456",
      "name": "Research",
      "color": "#059669",
      "conversationCount": 3,
      "createdAt": "2025-03-15T10:00:00Z"
    }
  ]
}
```

---

### POST /api/folders

Create a new folder.

**Auth:** Auth required

**Request Body:**

```json
{
  "name": "Procurement",
  "color": "#dc2626"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Folder name |
| color | string | No | Hex color code (default assigned) |

**Response (201):**

```json
{
  "id": "fold_ghi789",
  "name": "Procurement",
  "color": "#dc2626",
  "createdAt": "2025-04-01T10:00:00Z"
}
```

---

### PATCH /api/folders/:id

Update a folder's name or color.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Folder ID |

**Request Body:**

```json
{
  "name": "Procurement Docs",
  "color": "#7c3aed"
}
```

**Response (200):**

```json
{
  "success": true
}
```

---

### DELETE /api/folders/:id

Delete a folder. Conversations in the folder are moved to unfiled, not deleted.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Folder ID |

**Response (200):**

```json
{
  "success": true
}
```

---

## Announcements

### GET /api/announcements

List active announcements for display to users.

**Auth:** Public

**Response (200):**

```json
{
  "announcements": [
    {
      "id": "ann_abc123",
      "title": "New Vision AI Feature",
      "content": "You can now upload images and receipts for AI analysis!",
      "type": "feature",
      "createdAt": "2025-04-01T10:00:00Z"
    }
  ]
}
```

---

### GET /api/admin/announcements

List all announcements (including expired/inactive).

**Auth:** Admin

**Response (200):**

```json
{
  "announcements": [
    {
      "id": "ann_abc123",
      "title": "New Vision AI Feature",
      "content": "You can now upload images and receipts for AI analysis!",
      "type": "feature",
      "active": true,
      "createdAt": "2025-04-01T10:00:00Z"
    }
  ]
}
```

---

### POST /api/admin/announcements

Create a new announcement.

**Auth:** Admin

**Request Body:**

```json
{
  "title": "Scheduled Maintenance",
  "content": "AskOzzy will undergo maintenance on Saturday 5th April from 2:00 AM to 4:00 AM GMT.",
  "type": "maintenance"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| title | string | Yes | Announcement title |
| content | string | Yes | Announcement body |
| type | string | Yes | Type: `feature`, `maintenance`, `info`, `warning` |

**Response (201):**

```json
{
  "id": "ann_def456",
  "title": "Scheduled Maintenance",
  "createdAt": "2025-04-01T10:00:00Z"
}
```

---

### PATCH /api/admin/announcements/:id

Update an existing announcement.

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Announcement ID |

**Request Body:**

```json
{
  "title": "Updated Title",
  "content": "Updated content",
  "active": false
}
```

**Response (200):**

```json
{
  "success": true
}
```

---

### DELETE /api/admin/announcements/:id

Delete an announcement.

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Announcement ID |

**Response (200):**

```json
{
  "success": true
}
```

---

## Workflows

### GET /api/workflows/templates

List available workflow templates.

**Auth:** Public

**Response (200):**

```json
{
  "templates": [
    {
      "id": "wf_budget_prep",
      "name": "Budget Preparation",
      "description": "Step-by-step budget document preparation workflow",
      "type": "budget",
      "steps": 5,
      "estimatedTime": "15 min"
    },
    {
      "id": "wf_procurement",
      "name": "Procurement Process",
      "description": "Guided procurement documentation workflow",
      "type": "procurement",
      "steps": 7,
      "estimatedTime": "25 min"
    }
  ]
}
```

---

### POST /api/workflows

Create a new workflow instance from a template.

**Auth:** Auth required

**Request Body:**

```json
{
  "name": "Q2 Budget Preparation",
  "type": "budget"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Workflow instance name |
| type | string | Yes | Workflow template type |

**Response (201):**

```json
{
  "id": "wfi_abc123",
  "name": "Q2 Budget Preparation",
  "type": "budget",
  "currentStep": 1,
  "totalSteps": 5,
  "status": "in_progress",
  "createdAt": "2025-04-01T10:00:00Z"
}
```

---

### GET /api/workflows

List the authenticated user's workflow instances.

**Auth:** Auth required

**Response (200):**

```json
{
  "workflows": [
    {
      "id": "wfi_abc123",
      "name": "Q2 Budget Preparation",
      "type": "budget",
      "currentStep": 3,
      "totalSteps": 5,
      "status": "in_progress",
      "createdAt": "2025-04-01T10:00:00Z"
    }
  ]
}
```

---

### GET /api/workflows/:id

Get detailed workflow instance information.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Workflow instance ID |

**Response (200):**

```json
{
  "workflow": {
    "id": "wfi_abc123",
    "name": "Q2 Budget Preparation",
    "type": "budget",
    "currentStep": 3,
    "totalSteps": 5,
    "status": "in_progress",
    "steps": [
      { "step": 1, "title": "Revenue Projections", "status": "completed", "output": "..." },
      { "step": 2, "title": "Expenditure Estimates", "status": "completed", "output": "..." },
      { "step": 3, "title": "Deficit Analysis", "status": "current", "output": null },
      { "step": 4, "title": "Recommendations", "status": "pending", "output": null },
      { "step": 5, "title": "Final Report", "status": "pending", "output": null }
    ],
    "createdAt": "2025-04-01T10:00:00Z"
  }
}
```

---

### POST /api/workflows/:id/step

Execute the next step in the workflow.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Workflow instance ID |

**Request Body:**

```json
{
  "input": "Total revenue projected at GHS 120 billion for Q2"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| input | string | No | Optional user input for the current step |

**Response (200):**

```json
{
  "step": 3,
  "title": "Deficit Analysis",
  "status": "completed",
  "output": "Based on the revenue projections of GHS 120 billion and expenditure estimates of GHS 135 billion, the projected deficit is...",
  "nextStep": 4
}
```

---

### DELETE /api/workflows/:id

Delete a workflow instance.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Workflow instance ID |

**Response (200):**

```json
{
  "success": true
}
```

---

## Meetings

### POST /api/meetings/upload

Upload a meeting recording (audio file) for transcription.

**Auth:** Auth required

**Request Body:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | File | Yes | Audio file (MP3, WAV, M4A, WebM) |
| title | string | No | Meeting title |

**Response (201):**

```json
{
  "id": "mtg_abc123",
  "title": "Budget Committee Meeting",
  "status": "processing",
  "duration": null,
  "createdAt": "2025-04-01T10:00:00Z"
}
```

---

### POST /api/meetings/:id/minutes

Generate AI-powered meeting minutes from the transcription.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Meeting ID |

**Request Body:** None

**Response (200):**

```json
{
  "minutes": {
    "title": "Budget Committee Meeting",
    "date": "2025-04-01",
    "attendees": ["Kwame Mensah", "Ama Darko", "Kofi Asante"],
    "agenda": [
      "Q2 budget review",
      "Capital expenditure approvals"
    ],
    "decisions": [
      "Approved GHS 5M allocation for IT infrastructure",
      "Deferred road project to Q3"
    ],
    "actionItems": [
      {
        "task": "Prepare revised expenditure report",
        "assignee": "Ama Darko",
        "deadline": "2025-04-08"
      }
    ],
    "summary": "The committee reviewed Q2 budget performance..."
  }
}
```

---

### GET /api/meetings

List the user's meetings.

**Auth:** Auth required

**Response (200):**

```json
{
  "meetings": [
    {
      "id": "mtg_abc123",
      "title": "Budget Committee Meeting",
      "status": "completed",
      "duration": 3420,
      "hasMinutes": true,
      "createdAt": "2025-04-01T10:00:00Z"
    }
  ]
}
```

---

### GET /api/meetings/:id

Get meeting details including transcript and minutes.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Meeting ID |

**Response (200):**

```json
{
  "meeting": {
    "id": "mtg_abc123",
    "title": "Budget Committee Meeting",
    "status": "completed",
    "duration": 3420,
    "transcript": "Speaker 1: Good morning everyone...",
    "minutes": { "...": "..." },
    "createdAt": "2025-04-01T10:00:00Z"
  }
}
```

---

### DELETE /api/meetings/:id

Delete a meeting and its associated data.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Meeting ID |

**Response (200):**

```json
{
  "success": true
}
```

---

## Spaces

### POST /api/spaces

Create a collaborative space.

**Auth:** Auth required

**Request Body:**

```json
{
  "name": "Budget Division Team",
  "description": "Shared workspace for the budget division"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Space name |
| description | string | No | Space description |

**Response (201):**

```json
{
  "id": "space_abc123",
  "name": "Budget Division Team",
  "description": "Shared workspace for the budget division",
  "role": "owner",
  "createdAt": "2025-04-01T10:00:00Z"
}
```

---

### GET /api/spaces

List spaces the user belongs to.

**Auth:** Auth required

**Response (200):**

```json
{
  "spaces": [
    {
      "id": "space_abc123",
      "name": "Budget Division Team",
      "description": "Shared workspace for the budget division",
      "role": "owner",
      "memberCount": 5,
      "conversationCount": 12
    }
  ]
}
```

---

### GET /api/spaces/:id

Get space details including members and shared conversations.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Space ID |

**Response (200):**

```json
{
  "space": {
    "id": "space_abc123",
    "name": "Budget Division Team",
    "description": "Shared workspace for the budget division",
    "members": [
      { "id": "usr_abc123", "name": "Kwame Mensah", "role": "owner" },
      { "id": "usr_def456", "name": "Ama Darko", "role": "member" }
    ],
    "conversations": [
      { "id": "conv_abc123", "title": "Q2 Budget Review", "sharedBy": "Kwame Mensah" }
    ]
  }
}
```

---

### POST /api/spaces/:id/invite

Invite a member to a space.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Space ID |

**Request Body:**

```json
{
  "email": "ama.darko@gov.gh",
  "role": "member"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | Email of user to invite |
| role | string | No | Role in space: `member` (default), `admin` |

**Response (200):**

```json
{
  "success": true,
  "memberId": "usr_def456"
}
```

---

### POST /api/spaces/:id/share-conversation

Share a conversation to a space.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Space ID |

**Request Body:**

```json
{
  "conversationId": "conv_abc123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| conversationId | string | Yes | Conversation to share |

**Response (200):**

```json
{
  "success": true
}
```

---

### DELETE /api/spaces/:id/members/:memberId

Remove a member from a space.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Space ID |
| memberId | User ID of member to remove |

**Response (200):**

```json
{
  "success": true
}
```

---

### DELETE /api/spaces/:id

Delete a space.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Space ID |

**Response (200):**

```json
{
  "success": true
}
```

---

## Organizations

### POST /api/organizations

Create a new organization.

**Auth:** Auth required

**Request Body:**

```json
{
  "name": "Ministry of Finance",
  "description": "Government of Ghana Ministry of Finance"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Organization name |
| description | string | No | Organization description |

**Response (201):**

```json
{
  "id": "org_abc123",
  "name": "Ministry of Finance",
  "role": "owner",
  "createdAt": "2025-04-01T10:00:00Z"
}
```

---

### GET /api/organizations/mine

Get the authenticated user's organization.

**Auth:** Auth required

**Response (200):**

```json
{
  "organization": {
    "id": "org_abc123",
    "name": "Ministry of Finance",
    "role": "owner",
    "memberCount": 25,
    "members": [
      { "id": "usr_abc123", "name": "Kwame Mensah", "role": "owner", "department": "Budget Division" },
      { "id": "usr_def456", "name": "Ama Darko", "role": "member", "department": "Revenue" }
    ]
  }
}
```

---

### POST /api/organizations/:id/invite

Invite a user to the organization.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Organization ID |

**Request Body:**

```json
{
  "email": "kofi.asante@gov.gh",
  "role": "member",
  "department": "Expenditure"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | User email to invite |
| role | string | No | Role: `member` (default), `admin` |
| department | string | No | Department within organization |

**Response (200):**

```json
{
  "success": true
}
```

---

### POST /api/organizations/:id/remove

Remove a member from the organization.

**Auth:** Auth required

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Organization ID |

**Request Body:**

```json
{
  "userId": "usr_ghi789"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| userId | string | Yes | User ID to remove |

**Response (200):**

```json
{
  "success": true
}
```

---

## Citizen Bot

### POST /api/citizen/chat

Public-facing citizen AI chat. No authentication required. Designed for Ghana citizens to get government service information.

**Auth:** Public

**Request Body:**

```json
{
  "sessionId": "citizen_sess_abc123",
  "message": "How do I renew my passport?",
  "language": "en"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| sessionId | string | No | Session ID for conversation continuity (auto-generated if omitted) |
| message | string | Yes | Citizen question |
| language | string | No | Language code: `en` (default), `tw`, `ee`, `gaa`, `ha` |

**Response (200):**

```json
{
  "sessionId": "citizen_sess_abc123",
  "response": "To renew your Ghana passport, you need to:\n\n1. Visit passport.mfa.gov.gh\n2. Fill the online application form\n3. Pay the fee (GHS 100 for 32 pages)\n4. Book an appointment at a regional office\n5. Attend with your old passport and 2 passport photos\n\nProcessing takes 10-15 working days.",
  "language": "en"
}
```

---

### GET /api/citizen/session/:id

Get all messages in a citizen chat session.

**Auth:** Public

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Session ID |

**Response (200):**

```json
{
  "sessionId": "citizen_sess_abc123",
  "messages": [
    {
      "role": "user",
      "content": "How do I renew my passport?",
      "createdAt": "2025-04-01T10:00:00Z"
    },
    {
      "role": "assistant",
      "content": "To renew your Ghana passport, you need to...",
      "createdAt": "2025-04-01T10:00:05Z"
    }
  ]
}
```

---

## USSD

### POST /api/ussd/callback

USSD callback endpoint in Africa's Talking format. Handles USSD session interactions for feature phone users.

**Auth:** Public

**Request Body:** (Africa's Talking format)

```json
{
  "sessionId": "ATUid_abc123",
  "serviceCode": "*713*699#",
  "phoneNumber": "+233241234567",
  "text": "1*2"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| sessionId | string | Yes | USSD session ID |
| serviceCode | string | Yes | USSD service code |
| phoneNumber | string | Yes | User phone number |
| text | string | Yes | User input chain (menu selections separated by `*`) |

**Response (200):** Plain text USSD response

```
CON Select a service:
1. Ask a question
2. Check budget info
3. Government services
4. My account
```

---

### GET /api/admin/ussd/stats

Get USSD usage statistics.

**Auth:** Admin

**Response (200):**

```json
{
  "stats": {
    "totalSessions": 1245,
    "activeSessions": 12,
    "uniqueUsers": 890,
    "topQueries": [
      { "query": "passport renewal", "count": 45 },
      { "query": "nhis registration", "count": 38 }
    ],
    "dailyAverage": 42
  }
}
```

---

### GET /api/admin/ussd/config

Get USSD service configuration.

**Auth:** Admin

**Response (200):**

```json
{
  "config": {
    "serviceCode": "*713*699#",
    "provider": "africas_talking",
    "enabled": true,
    "welcomeMessage": "Welcome to AskOzzy! Select a service:",
    "maxSessionLength": 180
  }
}
```

---

### PUT /api/admin/ussd/config

Update USSD service configuration.

**Auth:** Admin

**Request Body:**

```json
{
  "enabled": true,
  "welcomeMessage": "Akwaaba! Select a service:",
  "maxSessionLength": 180
}
```

**Response (200):**

```json
{
  "success": true
}
```

---

### POST /api/admin/ussd/test

Test a USSD interaction without a real session.

**Auth:** Admin

**Request Body:**

```json
{
  "phoneNumber": "+233241234567",
  "text": "1",
  "serviceCode": "*713*699#"
}
```

**Response (200):**

```json
{
  "response": "CON Ask your question (max 160 chars):",
  "sessionState": "awaiting_question"
}
```

---

## WhatsApp / SMS

### POST /api/whatsapp/webhook

WhatsApp webhook endpoint for receiving messages and sending AI responses.

**Auth:** Public (webhook verification)

**Request Body:** (Provider-specific webhook payload)

```json
{
  "from": "233241234567",
  "body": "What are the requirements for a business permit?",
  "type": "text"
}
```

**Response (200):**

```json
{
  "success": true
}
```

---

### POST /api/sms/webhook

SMS webhook endpoint for receiving text messages and sending AI responses.

**Auth:** Public (webhook verification)

**Request Body:** (Provider-specific webhook payload)

```json
{
  "from": "+233241234567",
  "text": "How to register a business in Ghana",
  "to": "OZZY"
}
```

**Response (200):**

```json
{
  "success": true
}
```

---

### GET /api/admin/messaging/config

Get messaging (WhatsApp/SMS) configuration.

**Auth:** Admin

**Response (200):**

```json
{
  "config": {
    "whatsapp": {
      "enabled": true,
      "provider": "africas_talking",
      "phoneNumber": "+233XXXXXXXXX"
    },
    "sms": {
      "enabled": true,
      "provider": "africas_talking",
      "shortCode": "OZZY"
    }
  }
}
```

---

### PUT /api/admin/messaging/config

Update messaging configuration.

**Auth:** Admin

**Request Body:**

```json
{
  "whatsapp": {
    "enabled": true,
    "apiKey": "AT_api_key_here"
  },
  "sms": {
    "enabled": true,
    "senderId": "OZZY"
  }
}
```

**Response (200):**

```json
{
  "success": true
}
```

---

### GET /api/admin/messaging/stats

Get messaging statistics.

**Auth:** Admin

**Response (200):**

```json
{
  "stats": {
    "whatsapp": {
      "totalMessages": 3456,
      "uniqueUsers": 890,
      "avgResponseTime": 2.3
    },
    "sms": {
      "totalMessages": 1234,
      "uniqueUsers": 567,
      "avgResponseTime": 3.1
    }
  }
}
```

---

### POST /api/admin/messaging/test

Test messaging by sending a test message.

**Auth:** Admin

**Request Body:**

```json
{
  "channel": "whatsapp",
  "to": "+233241234567",
  "message": "Test message from AskOzzy admin"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| channel | string | Yes | Channel: `whatsapp` or `sms` |
| to | string | Yes | Recipient phone number |
| message | string | Yes | Test message content |

**Response (200):**

```json
{
  "success": true,
  "messageId": "msg_test_abc123"
}
```

---

### GET /api/admin/messaging/sessions/:sessionId/messages

Get messages for a specific messaging session.

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| sessionId | Messaging session ID |

**Response (200):**

```json
{
  "messages": [
    {
      "role": "user",
      "content": "How to register a business?",
      "channel": "whatsapp",
      "createdAt": "2025-04-01T10:00:00Z"
    },
    {
      "role": "assistant",
      "content": "To register a business in Ghana, visit the Registrar General's Department...",
      "createdAt": "2025-04-01T10:00:05Z"
    }
  ]
}
```

---

## Push Notifications

### GET /api/push/vapid-public-key

Get the VAPID public key for push notification subscription.

**Auth:** Public

**Response (200):**

```json
{
  "publicKey": "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkOs-qy..."
}
```

---

### POST /api/push/subscribe

Subscribe the client to push notifications.

**Auth:** Auth required

**Request Body:**

```json
{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/...",
    "keys": {
      "p256dh": "BNcRd...",
      "auth": "tBHI..."
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| subscription | object | Yes | PushSubscription object from the browser |

**Response (200):**

```json
{
  "success": true
}
```

---

### DELETE /api/push/unsubscribe

Unsubscribe from push notifications.

**Auth:** Auth required

**Request Body:** None

**Response (200):**

```json
{
  "success": true
}
```

---

### GET /api/push/status

Get the user's push notification subscription status.

**Auth:** Auth required

**Response (200):**

```json
{
  "subscribed": true,
  "preferences": {
    "announcements": true,
    "researchComplete": true,
    "usageAlerts": true,
    "tips": false
  }
}
```

---

### PUT /api/push/preferences

Update push notification preferences.

**Auth:** Auth required

**Request Body:**

```json
{
  "announcements": true,
  "researchComplete": true,
  "usageAlerts": true,
  "tips": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| announcements | boolean | No | Receive announcement notifications |
| researchComplete | boolean | No | Notify when research tasks complete |
| usageAlerts | boolean | No | Notify on usage limit warnings |
| tips | boolean | No | Receive productivity tips |

**Response (200):**

```json
{
  "success": true
}
```

---

## Productivity

### GET /api/productivity/me

Get the authenticated user's productivity statistics.

**Auth:** Auth required

**Response (200):**

```json
{
  "productivity": {
    "hoursSaved": 24.5,
    "documentsGenerated": 18,
    "questionsAnswered": 312,
    "researchReports": 5,
    "meetingMinutes": 3,
    "topCategories": [
      { "category": "Budget Analysis", "count": 45 },
      { "category": "Policy Review", "count": 32 },
      { "category": "Report Drafting", "count": 28 }
    ],
    "weeklyTrend": [
      { "week": "2025-W13", "messages": 42 },
      { "week": "2025-W14", "messages": 58 }
    ]
  }
}
```

---

### GET /api/admin/productivity

Get platform-wide productivity dashboard.

**Auth:** Admin

**Response (200):**

```json
{
  "productivity": {
    "totalHoursSaved": 1250.5,
    "totalDocuments": 890,
    "totalResearch": 156,
    "activeUsers": 342,
    "departmentStats": [
      { "department": "Ministry of Finance", "users": 45, "hoursSaved": 320.5 },
      { "department": "Ministry of Health", "users": 32, "hoursSaved": 180.0 }
    ],
    "dailyActive": [
      { "date": "2025-04-01", "users": 128 },
      { "date": "2025-03-31", "users": 115 }
    ]
  }
}
```

---

## Gamification

### GET /api/streaks

Get the user's usage streaks and earned badges.

**Auth:** Auth required

**Response (200):**

```json
{
  "streak": {
    "current": 5,
    "longest": 14,
    "lastActive": "2025-04-01T14:30:00Z"
  },
  "badges": [
    { "id": "first_chat", "name": "First Steps", "description": "Complete your first conversation", "earnedAt": "2025-01-15T10:00:00Z" },
    { "id": "streak_7", "name": "Week Warrior", "description": "7-day usage streak", "earnedAt": "2025-02-20T10:00:00Z" },
    { "id": "power_user", "name": "Power User", "description": "Send 100 messages", "earnedAt": "2025-03-10T10:00:00Z" }
  ]
}
```

---

### GET /api/usage/nudge

Get a contextual usage nudge message to encourage engagement.

**Auth:** Auth required

**Response (200):**

```json
{
  "nudge": {
    "message": "You're on a 5-day streak! Keep it going to earn the 'Week Warrior' badge.",
    "type": "streak",
    "actionUrl": null
  }
}
```

---

### GET /api/referral/info

Get referral program information.

**Auth:** Public

**Response (200):**

```json
{
  "referral": {
    "commission": "20%",
    "description": "Earn 20% commission on every subscription payment from users you refer",
    "tiers": [
      { "name": "Bronze", "referrals": "1-5", "bonus": "None" },
      { "name": "Silver", "referrals": "6-20", "bonus": "5% extra" },
      { "name": "Gold", "referrals": "21+", "bonus": "10% extra" }
    ]
  }
}
```

---

### POST /api/trial/activate

Activate a 3-day free trial of a premium tier.

**Auth:** Auth required

**Request Body:**

```json
{
  "tier": "professional"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| tier | string | No | Trial tier (defaults to `professional`) |

**Response (200):**

```json
{
  "success": true,
  "trialEnd": "2025-04-04T10:00:00Z",
  "tier": "professional"
}
```

---

### GET /api/trial/status

Get the user's trial status.

**Auth:** Auth required

**Response (200):**

```json
{
  "trial": {
    "active": true,
    "tier": "professional",
    "startedAt": "2025-04-01T10:00:00Z",
    "endsAt": "2025-04-04T10:00:00Z",
    "daysRemaining": 2
  }
}
```

---

## Admin

### POST /api/admin/bootstrap

Bootstrap the initial super admin account. Only works once and requires the `bootstrapSecret` from environment variables.

**Auth:** Public (requires bootstrapSecret)

**Request Body:**

```json
{
  "email": "admin@gov.gh",
  "fullName": "Osborn Hodges",
  "bootstrapSecret": "your-secret-here"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | Admin email |
| fullName | string | Yes | Admin full name |
| bootstrapSecret | string | Yes | Secret from environment config |

**Response (201):**

```json
{
  "accessCode": "OZZY-ADMN-XXXX",
  "user": {
    "id": "usr_admin",
    "role": "super_admin",
    "tier": "enterprise"
  }
}
```

---

### GET /api/admin/verify

Verify that the current user has admin access.

**Auth:** Admin

**Response (200):**

```json
{
  "admin": true,
  "role": "super_admin"
}
```

---

### GET /api/admin/dashboard

Get admin dashboard statistics.

**Auth:** Admin

**Response (200):**

```json
{
  "stats": {
    "totalUsers": 1245,
    "activeToday": 342,
    "totalConversations": 8920,
    "totalMessages": 45230,
    "tierBreakdown": {
      "free": 890,
      "starter": 210,
      "professional": 120,
      "enterprise": 25
    },
    "revenue": {
      "monthly": 15300.00,
      "currency": "GHS"
    },
    "growth": {
      "usersThisWeek": 45,
      "usersLastWeek": 38
    }
  }
}
```

---

### GET /api/admin/users

List all users with pagination, search, and filtering.

**Auth:** Admin

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| page | number | No | Page number (default 1) |
| limit | number | No | Results per page (default 20) |
| search | string | No | Search by name or email |
| tier | string | No | Filter by tier |
| role | string | No | Filter by role |

**Example:** `GET /api/admin/users?page=1&limit=20&search=kwame&tier=professional`

**Response (200):**

```json
{
  "users": [
    {
      "id": "usr_abc123",
      "email": "kwame.mensah@gov.gh",
      "fullName": "Kwame Mensah",
      "department": "Ministry of Finance",
      "tier": "professional",
      "role": "user",
      "messageCount": 312,
      "lastActive": "2025-04-01T14:30:00Z",
      "createdAt": "2025-01-15T08:00:00Z"
    }
  ],
  "total": 1245,
  "page": 1,
  "totalPages": 63
}
```

---

### PATCH /api/admin/users/:id/tier

Update a user's subscription tier.

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | User ID |

**Request Body:**

```json
{
  "tier": "professional"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| tier | string | Yes | New tier: `free`, `starter`, `professional`, `enterprise` |

**Response (200):**

```json
{
  "success": true
}
```

---

### PATCH /api/admin/users/:id/role

Update a user's role.

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | User ID |

**Request Body:**

```json
{
  "role": "admin"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| role | string | Yes | New role: `user`, `dept_admin`, `admin`, `super_admin` |

**Response (200):**

```json
{
  "success": true
}
```

---

### DELETE /api/admin/users/:id

Delete a user and all their data.

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | User ID |

**Response (200):**

```json
{
  "success": true
}
```

---

### GET /api/admin/conversations

List all conversations across all users.

**Auth:** Admin

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| page | number | No | Page number |
| limit | number | No | Results per page |
| userId | string | No | Filter by user ID |

**Response (200):**

```json
{
  "conversations": [
    {
      "id": "conv_abc123",
      "userId": "usr_abc123",
      "userName": "Kwame Mensah",
      "title": "Budget Analysis Q4",
      "messageCount": 12,
      "model": "@cf/meta/llama-3.1-70b-instruct",
      "createdAt": "2025-04-01T09:15:00Z"
    }
  ],
  "total": 8920,
  "page": 1
}
```

---

### GET /api/admin/conversations/:id/messages

View all messages in any conversation (admin access).

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Conversation ID |

**Response (200):**

```json
{
  "messages": [
    {
      "id": "msg_001",
      "role": "user",
      "content": "Draft a budget memo",
      "createdAt": "2025-04-01T11:01:00Z"
    },
    {
      "id": "msg_002",
      "role": "assistant",
      "content": "Here is a draft budget memo...",
      "model": "@cf/meta/llama-3.1-70b-instruct",
      "createdAt": "2025-04-01T11:01:05Z"
    }
  ]
}
```

---

### DELETE /api/admin/conversations/:id

Delete any conversation (admin access).

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Conversation ID |

**Response (200):**

```json
{
  "success": true
}
```

---

### GET /api/admin/analytics

Get platform analytics data.

**Auth:** Admin

**Response (200):**

```json
{
  "analytics": {
    "userGrowth": [
      { "date": "2025-03-25", "total": 1180, "new": 12 },
      { "date": "2025-03-26", "total": 1195, "new": 15 }
    ],
    "messageVolume": [
      { "date": "2025-03-25", "count": 1234 },
      { "date": "2025-03-26", "count": 1456 }
    ],
    "modelUsage": {
      "@cf/meta/llama-3.1-8b-instruct": 4520,
      "@cf/meta/llama-3.1-70b-instruct": 2890,
      "@cf/meta/llama-3.2-11b-vision-instruct": 450
    },
    "topTemplates": [
      { "id": "budget-memo", "name": "Budget Memo", "uses": 234 },
      { "id": "policy-brief", "name": "Policy Brief", "uses": 189 }
    ]
  }
}
```

---

### GET /api/admin/referrals

Get referral analytics.

**Auth:** Admin

**Response (200):**

```json
{
  "referrals": {
    "totalReferrals": 456,
    "activeReferrers": 89,
    "conversionRate": 0.34,
    "revenueFromReferrals": 8900.00,
    "topReferrers": [
      { "name": "Kwame Mensah", "code": "KWAME-X7K9", "referrals": 45, "revenue": 2250.00 }
    ]
  }
}
```

---

### POST /api/admin/promote

Promote a user to admin role.

**Auth:** Admin

**Request Body:**

```json
{
  "userId": "usr_def456",
  "role": "admin"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| userId | string | Yes | User ID to promote |
| role | string | Yes | Target role: `admin`, `dept_admin` |

**Response (200):**

```json
{
  "success": true
}
```

---

### GET /api/admin/export/users

Export all users as a CSV file.

**Auth:** Admin

**Response (200):** CSV file download

```
Content-Type: text/csv
Content-Disposition: attachment; filename="askozzy-users-2025-04-01.csv"

id,email,fullName,department,tier,role,messageCount,createdAt
usr_abc123,kwame.mensah@gov.gh,Kwame Mensah,Ministry of Finance,professional,user,312,2025-01-15T08:00:00Z
```

---

### GET /api/admin/export/analytics

Export analytics data as a CSV file.

**Auth:** Admin

**Response (200):** CSV file download

```
Content-Type: text/csv
Content-Disposition: attachment; filename="askozzy-analytics-2025-04-01.csv"

date,newUsers,totalMessages,activeUsers
2025-03-25,12,1234,342
2025-03-26,15,1456,358
```

---

### GET /api/admin/audit-log

Get the legacy audit log.

**Auth:** Admin

**Response (200):**

```json
{
  "logs": [
    {
      "id": "log_abc123",
      "userId": "usr_abc123",
      "userName": "Kwame Mensah",
      "action": "chat",
      "details": "Sent message in conv_abc123",
      "ip": "41.215.x.x",
      "createdAt": "2025-04-01T14:30:00Z"
    }
  ]
}
```

---

### GET /api/admin/audit

Enhanced audit log with advanced filtering.

**Auth:** Admin

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| page | number | No | Page number |
| limit | number | No | Results per page |
| userId | string | No | Filter by user ID |
| action | string | No | Filter by action type |
| startDate | string | No | ISO date start |
| endDate | string | No | ISO date end |

**Example:** `GET /api/admin/audit?action=login&startDate=2025-04-01&limit=50`

**Response (200):**

```json
{
  "entries": [
    {
      "id": "audit_abc123",
      "userId": "usr_abc123",
      "userName": "Kwame Mensah",
      "action": "login",
      "resource": "auth",
      "details": { "method": "access_code" },
      "ip": "41.215.x.x",
      "userAgent": "Mozilla/5.0...",
      "createdAt": "2025-04-01T14:30:00Z"
    }
  ],
  "total": 15230,
  "page": 1,
  "totalPages": 305
}
```

---

### GET /api/admin/audit/export

Export audit log as a CSV file.

**Auth:** Admin

**Query Parameters:** Same as GET /api/admin/audit

**Response (200):** CSV file download

```
Content-Type: text/csv
Content-Disposition: attachment; filename="askozzy-audit-2025-04-01.csv"

id,userId,userName,action,resource,ip,createdAt
audit_abc123,usr_abc123,Kwame Mensah,login,auth,41.215.x.x,2025-04-01T14:30:00Z
```

---

### GET /api/admin/audit/stats

Get audit log statistics.

**Auth:** Admin

**Response (200):**

```json
{
  "stats": {
    "totalEvents": 152300,
    "eventsToday": 1234,
    "topActions": [
      { "action": "chat", "count": 45230 },
      { "action": "login", "count": 12450 },
      { "action": "document_upload", "count": 890 }
    ],
    "topUsers": [
      { "userId": "usr_abc123", "name": "Kwame Mensah", "events": 2340 }
    ]
  }
}
```

---

### GET /api/admin/moderation

List content moderation flags.

**Auth:** Admin

**Response (200):**

```json
{
  "flags": [
    {
      "id": "mod_abc123",
      "userId": "usr_def456",
      "userName": "Unknown User",
      "messageId": "msg_xyz789",
      "content": "Flagged message content...",
      "reason": "inappropriate_content",
      "status": "pending",
      "createdAt": "2025-04-01T10:00:00Z"
    }
  ]
}
```

---

### PATCH /api/admin/moderation/:id

Review and resolve a moderation flag.

**Auth:** Admin

**Path Parameters:**

| Parameter | Description |
|-----------|-------------|
| id | Moderation flag ID |

**Request Body:**

```json
{
  "status": "resolved",
  "action": "dismiss",
  "note": "Content is within acceptable use policy"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| status | string | Yes | New status: `resolved`, `dismissed` |
| action | string | Yes | Action taken: `dismiss`, `warn`, `ban` |
| note | string | No | Admin note |

**Response (200):**

```json
{
  "success": true
}
```

---

### GET /api/admin/moderation/stats

Get content moderation statistics.

**Auth:** Admin

**Response (200):**

```json
{
  "stats": {
    "totalFlags": 45,
    "pending": 3,
    "resolved": 38,
    "dismissed": 4,
    "topReasons": [
      { "reason": "inappropriate_content", "count": 20 },
      { "reason": "spam", "count": 15 }
    ]
  }
}
```

---

### GET /api/admin/rate-limits

View the current rate limit configuration.

**Auth:** Admin

**Response (200):**

```json
{
  "rateLimits": {
    "free": { "messagesPerDay": 10, "messagesPerMinute": 3 },
    "starter": { "messagesPerDay": 100, "messagesPerMinute": 10 },
    "professional": { "messagesPerDay": 500, "messagesPerMinute": 20 },
    "enterprise": { "messagesPerDay": -1, "messagesPerMinute": 30 }
  }
}
```

---

### GET /api/admin/organizations

List all organizations on the platform.

**Auth:** Admin

**Response (200):**

```json
{
  "organizations": [
    {
      "id": "org_abc123",
      "name": "Ministry of Finance",
      "owner": "Kwame Mensah",
      "memberCount": 25,
      "createdAt": "2025-02-01T10:00:00Z"
    }
  ]
}
```

---

### POST /api/admin/users/bulk

Bulk create user accounts.

**Auth:** Admin

**Request Body:**

```json
{
  "users": [
    {
      "email": "ama.darko@gov.gh",
      "fullName": "Ama Darko",
      "department": "Ministry of Health",
      "tier": "starter"
    },
    {
      "email": "kofi.asante@gov.gh",
      "fullName": "Kofi Asante",
      "department": "Ministry of Education",
      "tier": "starter"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| users | array | Yes | Array of user objects |

**Response (201):**

```json
{
  "created": 2,
  "users": [
    { "email": "ama.darko@gov.gh", "accessCode": "OZZY-XXXX-YYYY" },
    { "email": "kofi.asante@gov.gh", "accessCode": "OZZY-XXXX-ZZZZ" }
  ],
  "errors": []
}
```

---

### POST /api/admin/bulk-import

Bulk import users from a CSV file.

**Auth:** Admin

**Request Body:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | File | Yes | CSV file with columns: email, fullName, department, tier |

**CSV Format:**

```
email,fullName,department,tier
ama.darko@gov.gh,Ama Darko,Ministry of Health,starter
kofi.asante@gov.gh,Kofi Asante,Ministry of Education,starter
```

**Response (201):**

```json
{
  "imported": 2,
  "skipped": 0,
  "errors": [],
  "accessCodes": [
    { "email": "ama.darko@gov.gh", "accessCode": "OZZY-XXXX-YYYY" },
    { "email": "kofi.asante@gov.gh", "accessCode": "OZZY-XXXX-ZZZZ" }
  ]
}
```

---

### GET /api/admin/departments/stats

Get per-department usage statistics.

**Auth:** Dept admin+

**Response (200):**

```json
{
  "departments": [
    {
      "name": "Ministry of Finance",
      "users": 45,
      "activeUsers": 32,
      "totalMessages": 4520,
      "topModel": "@cf/meta/llama-3.1-70b-instruct",
      "hoursSaved": 320.5
    },
    {
      "name": "Ministry of Health",
      "users": 32,
      "activeUsers": 21,
      "totalMessages": 2890,
      "topModel": "@cf/meta/llama-3.1-8b-instruct",
      "hoursSaved": 180.0
    }
  ]
}
```

---

## Rate Limiting

All authenticated endpoints are rate-limited based on the user's subscription tier:

| Tier | Messages/Day | Messages/Minute |
|------|-------------|-----------------|
| Free | 10 | 3 |
| Starter | 100 | 10 |
| Professional | 500 | 20 |
| Enterprise | Unlimited | 30 |

Rate limit headers are included in responses:

```
X-RateLimit-Limit: 500
X-RateLimit-Remaining: 438
X-RateLimit-Reset: 1711929600
```

When rate limited, the API returns:

```json
{
  "error": "Rate limit exceeded. Upgrade your plan for more messages.",
  "retryAfter": 60
}
```

**HTTP Status:** `429 Too Many Requests`

---

## Error Codes

| HTTP Status | Meaning |
|-------------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request -- Invalid parameters |
| 401 | Unauthorized -- Missing or invalid token |
| 403 | Forbidden -- Insufficient permissions |
| 404 | Not Found -- Resource does not exist |
| 409 | Conflict -- Resource already exists |
| 429 | Too Many Requests -- Rate limit exceeded |
| 500 | Internal Server Error |

---

## SSE (Server-Sent Events) Format

Streaming endpoints (`POST /api/chat`, `POST /api/messages/:id/regenerate`) return responses as Server-Sent Events:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"type":"token","content":"Hello"}
data: {"type":"token","content":" there"}
data: {"type":"sources","documents":[{"title":"Act 663","snippet":"..."}]}
data: {"type":"done","messageId":"msg_abc123","usage":{"prompt_tokens":150,"completion_tokens":42}}
```

Clients should use the `EventSource` API or a compatible library to consume SSE streams.

---

## CORS

The API supports CORS for browser-based clients. The following headers are set:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

---

## Changelog

| Date | Change |
|------|--------|
| 2025-04 | Phase 4: Spaces, Organizations, Workflows, Meetings, Push Notifications |
| 2025-03 | Phase 3: Agents, Knowledge Base, Affiliate system, USSD/WhatsApp/SMS |
| 2025-02 | Phase 2: Vision AI, Deep Research, Web Search, Data Analysis |
| 2025-01 | Phase 1: Core chat, Auth, Conversations, Admin, Payments |
