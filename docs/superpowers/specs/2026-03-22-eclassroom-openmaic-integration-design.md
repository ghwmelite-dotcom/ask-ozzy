# eClassroom — OpenMAIC Integration Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Subdomain:** `eclassroom.askozzy.work`
**Source:** [THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) (AGPL-3.0)

---

## 1. Overview

Integrate OpenMAIC (multi-agent interactive classroom) as a companion service to AskOzzy and OS Browser. OpenMAIC runs on a Hostinger VPS (Ubuntu, 8GB RAM, 100GB storage) alongside the existing Matrix server. Users access it at `eclassroom.askozzy.work` with shared JWT authentication from AskOzzy.

### What eClassroom Provides
- AI teachers + classmates that discuss topics in real-time
- Whiteboard with step-by-step problem solving
- Auto-generated slides with narration
- Interactive quizzes with AI grading
- Voice interaction (TTS + speech recognition)
- PowerPoint export for offline study

### Who It Serves
- **Students:** BECE/WASSCE exam prep, academic subjects
- **Government employees:** Procurement training, policy writing, onboarding
- **Both platforms:** AskOzzy (web PWA) and OS Browser (desktop app)

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                       │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────────┐  │
│  │   AskOzzy    │  │  Workers AI │  │   D1 / KV     │  │
│  │  (Hono on    │  │  (10 models)│  │ (Users, Auth, │  │
│  │   Workers)   │  │             │  │  Sessions)    │  │
│  └──────┬───────┘  └──────┬──────┘  └───────┬───────┘  │
└─────────┼─────────────────┼─────────────────┼───────────┘
          │                 │                 │
          │ JWT tokens      │ OpenAI-compat   │ Tier lookups
          │                 │ /api/ai-proxy   │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────┐
│              Hostinger VPS (Ubuntu 8GB RAM)              │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │                  Nginx Reverse Proxy               │  │
│  │  eclassroom.askozzy.work → localhost:3100          │  │
│  │  SSL via Let's Encrypt (Certbot)                   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌────────────────────┐    ┌─────────────────────────┐  │
│  │    eClassroom       │    │    Matrix Server        │  │
│  │    (OpenMAIC)       │    │    (existing)           │  │
│  │                     │    │    for OS Browser       │  │
│  │  Docker container   │    │                         │  │
│  │  Port 3100          │    │                         │  │
│  └────────────────────┘    └─────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
          ▲                           ▲
          │                           │
   ┌──────┴───────┐           ┌───────┴──────┐
   │  AskOzzy     │           │  OS Browser  │
   │  PWA Users   │           │  Desktop App │
   │  (web)       │           │  (Matrix)    │
   └──────────────┘           └──────────────┘
```

### Resource Budget (8GB RAM)
| Service | Estimated RAM | Notes |
|---------|--------------|-------|
| Matrix server | ~1-2 GB | Existing |
| OpenMAIC (Next.js) | ~1.5-2 GB | Docker container |
| Nginx | ~50 MB | Reverse proxy |
| OS overhead | ~500 MB | Ubuntu |
| **Headroom** | **~3-4 GB** | Buffer for spikes |

---

## 3. Authentication Flow

AskOzzy mints JWT tokens. eClassroom validates them. No separate login needed.

```
User logs into AskOzzy
        │
        ▼
AskOzzy creates JWT with claims:
  { sub: user_id, tier: "pro", role: "student", exp: ... }
        │
        ▼
User clicks "Launch Classroom"
        │
        ▼
AskOzzy redirects to:
  eclassroom.askozzy.work/join?token=<JWT>
        │
        ▼
eClassroom validates JWT using shared secret (JWT_SECRET)
        │
        ▼
Creates eClassroom session, applies tier-based access control
```

### JWT Payload
```json
{
  "sub": "user_abc123",
  "email": "user@gov.gh",
  "name": "Kwame Asante",
  "tier": "pro",
  "role": "student",
  "iat": 1711100000,
  "exp": 1711103600
}
```

### Shared Secret
Same `JWT_SECRET` used by AskOzzy (already in Cloudflare secrets) will be set as an environment variable in the eClassroom Docker container.

---

## 4. Workers AI Proxy Endpoint

OpenMAIC expects an OpenAI-compatible API. AskOzzy exposes Workers AI through a new proxy route.

### New Route: `POST /api/ai-proxy/chat/completions`

**Location:** `src/index.ts`

```typescript
// Validates request comes from eClassroom (API key check)
// Maps OpenAI format → Workers AI format
// Returns Workers AI response in OpenAI format
app.post('/api/ai-proxy/chat/completions', async (c) => {
  // 1. Validate API key header (shared secret between AskOzzy and eClassroom)
  // 2. Extract model, messages, temperature from OpenAI-format body
  // 3. Map to Workers AI model (@cf/meta/llama-3.1-8b-instruct, etc.)
  // 4. Call env.AI.run() with getParams()
  // 5. Return response in OpenAI chat completion format
});
```

### Model Mapping
| OpenMAIC requests | Workers AI serves |
|-------------------|-------------------|
| `gpt-4` / default | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| `gpt-3.5-turbo` | `@cf/meta/llama-3.1-8b-instruct` |
| Outline generation | 70B model (higher quality) |
| Scene/quiz generation | 8B model (faster, cheaper) |

### Security
- API key in `Authorization: Bearer <ECLASSROOM_API_KEY>` header
- Rate limited: 100 requests/minute per eClassroom instance
- Only accessible from VPS IP (optional IP allowlist)

---

## 5. Access Control Tiers

### Free Tier
- Browse and join 5-10 pre-built classrooms
- 3 classroom sessions per month
- Full interactive experience (whiteboard, quizzes, discussions)
- No custom classroom creation
- No PowerPoint export

### Starter / Pro Tier
- Unlimited pre-built classroom access
- Create custom classrooms (type topic or upload notes/past questions)
- PowerPoint export
- Voice interaction
- AI remembers learning progress

### Enterprise Tier
- Everything in Pro
- Bulk classroom creation for departments
- Government training module builder
- Custom branding on classroom sessions
- Usage analytics dashboard

### Enforcement
eClassroom checks tier from the JWT `tier` claim. Session counting stored in a simple SQLite DB on the VPS (or calls back to AskOzzy's D1 via API).

---

## 6. AskOzzy UI Integration Points

### Student Screen
- New "eClassroom" icon button in the header navigation (next to Discover)
- Opens a classroom browser: grid of available classrooms with subject, topic, difficulty
- "Launch" button on each card → opens `eclassroom.askozzy.work/join?token=<JWT>&classroom=<id>`

### Student Agent Suggestions
When a student asks about a topic covered by a pre-built classroom, the agent responds with:
> "I can explain this here, or you can experience it interactively in eClassroom with AI teachers walking you through it step by step. [Launch Classroom →]"

### Chat-to-Classroom
- New button in chat: "Turn this into a classroom"
- Takes current conversation topic → calls eClassroom API to generate a classroom
- Pro/Enterprise only

---

## 7. OS Browser Integration

### Matrix Bot Command
```
/classroom <topic>
```
- Bot calls eClassroom API to generate classroom
- Returns link when ready: `eclassroom.askozzy.work/join?token=<JWT>&classroom=<id>`

### Sidebar Shortcut
- "eClassroom" entry in OS Browser's sidebar/app launcher
- Opens `eclassroom.askozzy.work` in embedded browser view
- Auto-authenticates via Matrix session → JWT exchange

---

## 8. VPS Setup Guide (Step-by-Step)

> This section assumes no prior Docker or Nginx experience.

### 8.1 Connect to Your VPS

Open a terminal (Command Prompt, PowerShell, or Git Bash on Windows).

```bash
ssh root@<YOUR_VPS_IP>
```

Replace `<YOUR_VPS_IP>` with your actual Hostinger VPS IP address. You'll find this in your Hostinger control panel under VPS → Overview.

If this is your first time connecting, it will ask you to trust the server — type `yes` and press Enter. Then enter your root password (set during VPS creation in Hostinger).

### 8.2 Update the System

Once logged in, update all packages:

```bash
apt update && apt upgrade -y
```

This may take a few minutes. If it asks about restarting services, press Enter to accept defaults.

### 8.3 Install Docker

Docker lets us run OpenMAIC in an isolated container so it doesn't conflict with Matrix or anything else.

```bash
# Install prerequisites
apt install -y ca-certificates curl gnupg

# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker's repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Verify Docker is working:

```bash
docker --version
# Should print something like: Docker version 27.x.x
```

### 8.4 Install Nginx

Nginx will act as a "traffic director" — when someone visits `eclassroom.askozzy.work`, Nginx sends them to the OpenMAIC container.

```bash
apt install -y nginx
```

Verify Nginx is running:

```bash
systemctl status nginx
# Should show "active (running)" in green
```

### 8.5 Clone and Configure OpenMAIC

Create a directory for the project:

```bash
mkdir -p /opt/eclassroom
cd /opt/eclassroom
```

Clone the OpenMAIC repository:

```bash
git clone https://github.com/THU-MAIC/OpenMAIC.git .
```

The `.` at the end means "clone into the current folder" (not a subfolder).

Create the environment configuration file:

```bash
nano .env.local
```

This opens a text editor. Paste the following (replace the placeholder values):

```env
# === LLM Configuration ===
# Points to AskOzzy's Workers AI proxy
OPENAI_API_BASE=https://askozzy.ghwmelite.work/api/ai-proxy
OPENAI_API_KEY=<ECLASSROOM_API_KEY>

# === Authentication ===
JWT_SECRET=<SAME_JWT_SECRET_AS_ASKOZZY>

# === App Settings ===
NEXT_PUBLIC_APP_URL=https://eclassroom.askozzy.work
PORT=3100

# === TTS (Text-to-Speech) ===
# Optional: configure if you want voice narration
# TTS_PROVIDER=edge
```

To save and exit nano:
1. Press `Ctrl + X`
2. Press `Y` to confirm save
3. Press `Enter` to confirm filename

### 8.6 Create the Docker Setup

Create a `docker-compose.yml` file:

```bash
nano docker-compose.yml
```

Paste this content:

```yaml
services:
  eclassroom:
    build: .
    container_name: eclassroom
    restart: unless-stopped
    ports:
      - "3100:3000"
    env_file:
      - .env.local
    environment:
      - NODE_ENV=production
    mem_limit: 2g
    cpus: 2
```

Save and exit (`Ctrl + X`, `Y`, `Enter`).

**What this does:**
- `build: .` — builds the app from the code we cloned
- `ports: "3100:3000"` — maps the container's port 3000 to port 3100 on your VPS
- `mem_limit: 2g` — caps RAM at 2GB so it doesn't starve Matrix
- `cpus: 2` — limits to 2 CPU cores
- `restart: unless-stopped` — auto-restarts if it crashes or VPS reboots

### 8.7 Build and Start the Container

```bash
# Build the Docker image (this takes 5-10 minutes the first time)
docker compose build

# Start the container in the background
docker compose up -d
```

Check it's running:

```bash
docker compose ps
```

You should see `eclassroom` with status `Up`. If it says `Exited` or `Restarting`, check the logs:

```bash
docker compose logs --tail 50
```

Test it's responding:

```bash
curl http://localhost:3100
```

You should see HTML content (the OpenMAIC homepage).

### 8.8 Configure Nginx Reverse Proxy

Create the Nginx configuration for eClassroom:

```bash
nano /etc/nginx/sites-available/eclassroom
```

Paste this entire block:

```nginx
server {
    listen 80;
    server_name eclassroom.askozzy.work;

    # Redirect all HTTP to HTTPS (will work after SSL is set up)
    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name eclassroom.askozzy.work;

    # SSL certificates (will be created by Certbot in the next step)
    ssl_certificate /etc/letsencrypt/live/eclassroom.askozzy.work/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/eclassroom.askozzy.work/privkey.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Allow AskOzzy to embed in iframe (for OS Browser)
    add_header Content-Security-Policy "frame-ancestors 'self' https://askozzy.ghwmelite.work https://askozzy.work;" always;

    # Proxy to OpenMAIC container
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;

        # Required for SSE (Server-Sent Events) — classroom streaming
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;

        # Required for WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Pass real client info
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Long timeout for classroom generation (can take a while)
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

Save and exit.

**Enable the site** (create a shortcut Nginx looks for):

```bash
ln -s /etc/nginx/sites-available/eclassroom /etc/nginx/sites-enabled/
```

**Test the Nginx config for syntax errors:**

```bash
nginx -t
```

If it says `syntax is ok` and `test is successful`, you're good. If it complains about the SSL certificate not existing yet, that's expected — we'll fix that next.

### 8.9 Set Up SSL (HTTPS)

**Important:** Before this step, make sure your DNS record for `eclassroom.askozzy.work` is already pointing to your VPS IP in Cloudflare (DNS only / grey cloud). DNS can take a few minutes to propagate.

Install Certbot (the tool that gets free SSL certificates from Let's Encrypt):

```bash
apt install -y certbot python3-certbot-nginx
```

**Temporarily comment out the HTTPS server block** so Nginx can start without the certificate:

```bash
nano /etc/nginx/sites-available/eclassroom
```

Add `#` at the beginning of every line in the second `server { ... }` block (the one with `listen 443`). Save and exit.

Restart Nginx with just the HTTP block:

```bash
systemctl restart nginx
```

Now get the SSL certificate:

```bash
certbot --nginx -d eclassroom.askozzy.work
```

Certbot will ask:
1. **Email address** — enter yours (for renewal notices)
2. **Agree to terms** — type `Y`
3. **Share email with EFF** — your choice, `N` is fine
4. Certbot will automatically configure Nginx with the certificate

**Now uncomment the HTTPS server block** you commented out earlier:

```bash
nano /etc/nginx/sites-available/eclassroom
```

Remove the `#` from all lines in the second server block. Save and exit.

Reload Nginx:

```bash
nginx -t && systemctl reload nginx
```

**Set up auto-renewal** (SSL certificates expire every 90 days):

```bash
# Test renewal works
certbot renew --dry-run
```

If that succeeds, Certbot already set up a timer to auto-renew. Verify:

```bash
systemctl list-timers | grep certbot
```

You should see a certbot timer listed.

### 8.10 Test Everything

**From your VPS:**

```bash
curl -I https://eclassroom.askozzy.work
```

You should see `HTTP/2 200` or `HTTP/1.1 200 OK`.

**From your browser:**

Open `https://eclassroom.askozzy.work` — you should see the OpenMAIC interface.

### 8.11 Firewall Setup

Make sure only the necessary ports are open:

```bash
# Check if UFW (firewall) is installed
ufw status

# If inactive, set it up:
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh          # Port 22 — so you can still connect
ufw allow 80/tcp       # HTTP (redirects to HTTPS)
ufw allow 443/tcp      # HTTPS

# If Matrix uses specific ports, allow those too:
# ufw allow 8448/tcp   # Matrix federation (if applicable)
# ufw allow <matrix_port>/tcp

# Enable the firewall
ufw enable
```

It will warn "Command may disrupt existing SSH connections" — type `y`. Your current SSH session will continue working.

### 8.12 Monitoring and Maintenance

**View eClassroom logs:**

```bash
cd /opt/eclassroom
docker compose logs -f          # Live log stream (Ctrl+C to stop)
docker compose logs --tail 100  # Last 100 lines
```

**Restart eClassroom:**

```bash
cd /opt/eclassroom
docker compose restart
```

**Update to latest OpenMAIC version:**

```bash
cd /opt/eclassroom
git pull origin main
docker compose build
docker compose up -d
```

**Check resource usage:**

```bash
# Overall system resources
htop    # (install with: apt install htop)

# Docker-specific resources
docker stats
```

**Auto-start on VPS reboot:**
Docker's `restart: unless-stopped` handles the container. Make sure Docker and Nginx start on boot:

```bash
systemctl enable docker
systemctl enable nginx
```

---

## 9. AskOzzy Code Changes Required

### 9.1 New API Route: Workers AI Proxy

**File:** `src/index.ts`

New route `POST /api/ai-proxy/chat/completions` that:
1. Validates `Authorization: Bearer <ECLASSROOM_API_KEY>` header
2. Accepts OpenAI-format chat completion request
3. Maps to Workers AI model
4. Returns response in OpenAI format

### 9.2 New Cloudflare Secret

```bash
npx wrangler secret put ECLASSROOM_API_KEY
# Enter a strong random string — this authenticates eClassroom → AskOzzy AI proxy
```

### 9.3 JWT Auth Token for Classroom Launch

**File:** `src/index.ts`

New route `GET /api/eclassroom/token` that:
1. Checks user is authenticated
2. Mints a short-lived JWT (1 hour) with user claims (id, tier, role, name)
3. Returns the token for redirect to eClassroom

### 9.4 Frontend: eClassroom Button

**File:** `public/js/app.js`

- Add "eClassroom" icon to student header nav
- Classroom browser screen with pre-built classroom cards
- "Launch" button calls `/api/eclassroom/token` then redirects to `eclassroom.askozzy.work/join?token=<JWT>`

### 9.5 Frontend: Agent Classroom Suggestions

**File:** `public/js/app.js`

When student agent detects a topic matching a pre-built classroom, append a suggestion card:
> "Want to experience this interactively? [Launch eClassroom →]"

### 9.6 Access Control Tracking

**File:** `src/index.ts`

New D1 table and routes:
- `classroom_sessions` table: tracks free-tier usage (user_id, classroom_id, created_at)
- Middleware checks: free users ≤ 3 sessions/month before minting JWT

---

## 10. Phased Rollout

### Phase 1 — Foundation (Week 1-2)
- [ ] Add DNS record for `eclassroom.askozzy.work` (Cloudflare, DNS only)
- [ ] SSH into VPS, install Docker + Nginx
- [ ] Clone OpenMAIC, configure `.env.local`, build Docker container
- [ ] Set up Nginx reverse proxy + SSL
- [ ] Create `ECLASSROOM_API_KEY` secret on Cloudflare
- [ ] Build Workers AI proxy endpoint in AskOzzy
- [ ] Build JWT token endpoint in AskOzzy
- [ ] Smoke test: generate a classroom from eClassroom using AskOzzy's AI

### Phase 2 — Student Classrooms (Week 3-4)
- [ ] Pre-build 5-10 BECE/WASSCE classrooms
- [ ] Add "eClassroom" button to AskOzzy student header nav
- [ ] Build classroom browser screen (grid of cards)
- [ ] Add access control middleware (3 sessions/month for free)
- [ ] Add `classroom_sessions` D1 table
- [ ] Agent classroom suggestions in chat

### Phase 3 — OS Browser Integration (Week 5)
- [ ] Matrix bot `/classroom <topic>` command
- [ ] OS Browser sidebar shortcut
- [ ] Shared auth: Matrix session → JWT exchange

### Phase 4 — Government Training (Week 6-7)
- [ ] Build training module templates (procurement, policy, onboarding)
- [ ] Enterprise tier access control
- [ ] Admin panel: manage classrooms, view usage stats

### Phase 5 — Open Creation + Polish (Week 8)
- [ ] Pro users: custom classroom creation (topic input + document upload)
- [ ] PowerPoint export
- [ ] Performance tuning, VPS resource monitoring
- [ ] Update tip messages to promote eClassroom

---

## 11. Troubleshooting Guide

### Container won't start
```bash
cd /opt/eclassroom
docker compose logs --tail 50
# Look for error messages — common issues:
# - Missing .env.local values
# - Port 3100 already in use (change in docker-compose.yml)
# - Out of memory (check with: free -h)
```

### SSL certificate issues
```bash
# Check certificate status
certbot certificates

# Force renewal
certbot renew --force-renewal

# Check Nginx can read certs
nginx -t
```

### eClassroom can't reach Workers AI proxy
```bash
# Test from VPS
curl -X POST https://askozzy.ghwmelite.work/api/ai-proxy/chat/completions \
  -H "Authorization: Bearer <ECLASSROOM_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'
# Should return a JSON response with AI output
```

### High memory usage
```bash
# Check what's using RAM
docker stats --no-stream
free -h

# If eClassroom is over 2GB, restart it
cd /opt/eclassroom
docker compose restart
```

### Nginx 502 Bad Gateway
This means Nginx can't reach the container:
```bash
# Check container is running
docker compose ps

# Check it's listening on port 3100
curl http://localhost:3100

# If not running, start it
docker compose up -d
```
