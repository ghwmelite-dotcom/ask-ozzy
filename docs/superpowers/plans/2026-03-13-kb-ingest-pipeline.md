# KB Ingest Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate AskOzzy's Vectorize knowledge base with 10 verified Ghana government legal documents via a local Node.js script.

**Architecture:** A document registry (`scripts/documents.json`) lists PDFs to ingest. A Node.js script downloads them, extracts text with `pdf-parse`, and uploads to the existing `/api/admin/documents` endpoint. A small backend change adds `X-Bootstrap-Secret` auth bypass for script authentication.

**Tech Stack:** Node.js (scripts), pdf-parse (PDF text extraction), Hono (backend), Cloudflare Workers AI + Vectorize (embeddings/storage)

---

## File Structure

| File | Responsibility |
|------|---------------|
| Create: `scripts/documents.json` | Document registry — URLs, titles, categories |
| Create: `scripts/ingest-kb.js` | Download PDFs, extract text, upload to API |
| Modify: `src/routes/admin-content.ts:1036` | Add bootstrap secret auth bypass to document upload endpoint |

---

## Chunk 1: Backend Auth Bypass + Document Registry

### Task 1: Add bootstrap secret auth bypass to admin documents endpoint

**Files:**
- Modify: `src/routes/admin-content.ts:1036`

- [ ] **Step 1: Read the current endpoint code**

Read `src/routes/admin-content.ts` lines 1036-1116 to understand the current `/api/admin/documents` POST handler.

- [ ] **Step 2: Add bootstrap secret check before adminMiddleware**

Replace the route definition to check for `X-Bootstrap-Secret` header. If it matches, set userId to `"system-ingest"` and proceed. Otherwise, fall through to normal `adminMiddleware`.

In `src/routes/admin-content.ts`, change line 1036 from:

```typescript
adminContent.post("/api/admin/documents", adminMiddleware, async (c) => {
  const adminId = c.get("userId");
```

to:

```typescript
adminContent.post("/api/admin/documents", async (c, next) => {
  const bootstrapSecret = c.req.header("X-Bootstrap-Secret");
  if (bootstrapSecret && bootstrapSecret === c.env.BOOTSTRAP_SECRET) {
    c.set("userId", "system-ingest");
    return next();
  }
  return adminMiddleware(c, next);
}, async (c) => {
  const adminId = c.get("userId");
```

- [ ] **Step 3: Verify build**

Run: `npx wrangler deploy --dry-run`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin-content.ts
git commit -m "feat: add bootstrap secret auth bypass for KB ingest script"
```

---

### Task 2: Create the document registry

**Files:**
- Create: `scripts/documents.json`

- [ ] **Step 1: Create the document registry file**

Create `scripts/documents.json` with all 10 legal documents:

```json
[
  {
    "id": "constitution-1992",
    "title": "Constitution of the Republic of Ghana, 1992",
    "url": "https://constitutionnet.org/sites/default/files/Ghana%20Constitution.pdf",
    "source": "Parliament of Ghana",
    "category": "legal"
  },
  {
    "id": "procurement-act-663",
    "title": "Public Procurement Act, 2003 (Act 663)",
    "url": "https://ppa.gov.gh/wp-content/uploads/2019/01/Public-Procurement-Act-2003-Act-663.pdf",
    "source": "Public Procurement Authority, Ghana",
    "category": "procurement_law"
  },
  {
    "id": "pfm-act-921",
    "title": "Public Financial Management Act, 2016 (Act 921)",
    "url": "https://www.mofep.gov.gh/sites/default/files/acts/PUBLIC-FINANCIAL-MANAGEMENT-ACT-2016.pdf",
    "source": "Ministry of Finance, Ghana",
    "category": "financial_admin"
  },
  {
    "id": "financial-admin-act-654",
    "title": "Financial Administration Act, 2003 (Act 654)",
    "url": "https://ghalii.org/akn/gh/act/2003/654/eng@2003-10-31/source.pdf",
    "source": "Ghana Legal Information Institute",
    "category": "financial_admin"
  },
  {
    "id": "data-protection-act-843",
    "title": "Data Protection Act, 2012 (Act 843)",
    "url": "https://nita.gov.gh/wp-content/uploads/2017/12/Data-Protection-Act-2012-Act-843.pdf",
    "source": "National Information Technology Agency, Ghana",
    "category": "legal"
  },
  {
    "id": "labour-act-651",
    "title": "Labour Act, 2003 (Act 651)",
    "url": "https://www.gipc.gov.gh/wp-content/uploads/2023/05/LABOUR-ACT-2003-ACT-651.pdf",
    "source": "Ghana Investment Promotion Centre",
    "category": "legal"
  },
  {
    "id": "civil-service-act-pndcl-327",
    "title": "Civil Service Act, 1993 (PNDCL 327)",
    "url": "https://new-ndpc-static1.s3.amazonaws.com/pubication/Civil+Service+Act+1993.pdf",
    "source": "National Development Planning Commission, Ghana",
    "category": "civil_service"
  },
  {
    "id": "ssnit-omnibus-guide",
    "title": "SSNIT Omnibus Guide",
    "url": "https://www.ssnit.org.gh/wp-content/uploads/2023/08/SSNIT-Omnibus.pdf",
    "source": "Social Security and National Insurance Trust, Ghana",
    "category": "hr"
  },
  {
    "id": "civil-service-admin-instructions",
    "title": "Civil Service Administrative Instructions",
    "url": "https://ohcs.gov.gh/wp-content/uploads/2024/10/CIVIL-SERVICE-ADMINISTRATIVE-INSTRUCTIONS.pdf",
    "source": "Office of the Head of Civil Service, Ghana",
    "category": "civil_service"
  },
  {
    "id": "ppa-procurement-manual",
    "title": "Public Procurement Manual",
    "url": "https://ppa.gov.gh/wp-content/uploads/2019/01/FINAL-MANUAL-PPB.pdf",
    "source": "Public Procurement Authority, Ghana",
    "category": "procurement_law"
  }
]
```

- [ ] **Step 2: Commit**

```bash
git add scripts/documents.json
git commit -m "feat: add document registry for KB ingest (10 Ghana legal docs)"
```

---

## Chunk 2: Ingest Script

### Task 3: Create the ingest script

**Files:**
- Create: `scripts/ingest-kb.js`

- [ ] **Step 1: Install pdf-parse**

Run: `npm install pdf-parse`

- [ ] **Step 2: Create the ingest script**

Create `scripts/ingest-kb.js`:

```javascript
#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

// ─── Configuration ───────────────────────────────────────────────────

const API_URL = process.env.ASKOZZY_URL || "https://askozzy.ghwmelite.workers.dev";
const SECRET = process.env.BOOTSTRAP_SECRET;
const CACHE_DIR = path.join(__dirname, ".cache");
const DOCS_DIR = path.join(__dirname, "..", "knowledge-docs");
const REGISTRY = path.join(__dirname, "documents.json");
const MAX_CONTENT_LENGTH = 80000; // Split docs larger than this
const UPLOAD_DELAY_MS = 2000; // Delay between uploads for rate limiting

// ─── Parse CLI flags ─────────────────────────────────────────────────

const args = process.argv.slice(2);
const forceFlag = args.includes("--force");
const onlyIndex = args.indexOf("--only");
const onlyId = onlyIndex !== -1 ? args[onlyIndex + 1] : null;

// ─── Helpers ─────────────────────────────────────────────────────────

function log(emoji, msg) {
  console.log(`${emoji}  ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadPdf(url, destPath) {
  if (fs.existsSync(destPath)) {
    log("⏭️", `Cached: ${path.basename(destPath)}`);
    return true;
  }

  log("⬇️", `Downloading: ${url}`);
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      log("❌", `Download failed (${res.status}): ${url}`);
      return false;
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("pdf") && !contentType.includes("octet-stream")) {
      log("⚠️", `Unexpected content-type: ${contentType} — downloading anyway`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    log("✅", `Downloaded: ${path.basename(destPath)} (${(buffer.length / 1024).toFixed(0)} KB)`);
    return true;
  } catch (err) {
    log("❌", `Download error: ${err.message}`);
    return false;
  }
}

async function extractText(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(buffer);

  const pages = data.numpages;
  const text = data.text.trim();
  const chars = text.length;
  const charsPerPage = pages > 0 ? Math.round(chars / pages) : 0;

  log("📄", `Extracted: ${pages} pages, ${chars.toLocaleString()} chars (${charsPerPage} chars/page)`);

  if (charsPerPage < 100 && pages > 5) {
    log("⚠️", `WARNING: Very low text density — this PDF may be scanned/image-based`);
  }

  if (chars < 100) {
    log("❌", `Text too short (${chars} chars) — skipping`);
    return null;
  }

  return text;
}

function splitContent(text, maxLen) {
  if (text.length <= maxLen) return [text];

  const parts = [];
  let start = 0;
  let partNum = 1;

  while (start < text.length) {
    let end = start + maxLen;

    // Try to split at a paragraph boundary
    if (end < text.length) {
      const lastParagraph = text.lastIndexOf("\n\n", end);
      if (lastParagraph > start + maxLen * 0.5) {
        end = lastParagraph;
      }
    }

    parts.push(text.slice(start, end).trim());
    start = end;
    partNum++;
  }

  return parts;
}

async function checkExists(title) {
  try {
    const res = await fetch(`${API_URL}/api/admin/documents?search=${encodeURIComponent(title)}`, {
      headers: { "X-Bootstrap-Secret": SECRET },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.documents && data.documents.some((d) => d.title === title);
  } catch {
    return false;
  }
}

async function uploadDocument(title, content, source, category) {
  const res = await fetch(`${API_URL}/api/admin/documents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Secret": SECRET,
    },
    body: JSON.stringify({ title, content, source, category }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }

  return await res.json();
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  if (!SECRET) {
    console.error("ERROR: Set BOOTSTRAP_SECRET environment variable");
    process.exit(1);
  }

  // Ensure directories exist
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  // Load registry
  const documents = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
  const toProcess = onlyId ? documents.filter((d) => d.id === onlyId) : documents;

  if (toProcess.length === 0) {
    console.error(onlyId ? `No document found with id: ${onlyId}` : "No documents in registry");
    process.exit(1);
  }

  log("🚀", `Processing ${toProcess.length} document(s) → ${API_URL}`);
  console.log("");

  const results = { success: 0, skipped: 0, failed: 0 };

  for (const doc of toProcess) {
    console.log(`─── ${doc.title} ───`);

    // Stage 1: Download
    const pdfPath = path.join(CACHE_DIR, `${doc.id}.pdf`);
    const downloaded = await downloadPdf(doc.url, pdfPath);
    if (!downloaded) {
      results.failed++;
      console.log("");
      continue;
    }

    // Stage 2: Extract text
    let text;
    try {
      text = await extractText(pdfPath);
    } catch (err) {
      log("❌", `PDF parse error: ${err.message}`);
      results.failed++;
      console.log("");
      continue;
    }

    if (!text) {
      results.failed++;
      console.log("");
      continue;
    }

    // Save extracted text for human review
    const categoryDir = path.join(DOCS_DIR, doc.category);
    fs.mkdirSync(categoryDir, { recursive: true });
    const textPath = path.join(categoryDir, `${doc.id}.txt`);
    fs.writeFileSync(textPath, text);
    log("💾", `Saved text: ${path.relative(path.join(__dirname, ".."), textPath)}`);

    // Stage 3: Upload
    if (!forceFlag) {
      const exists = await checkExists(doc.title);
      if (exists) {
        log("⏭️", `Already ingested — skipping (use --force to re-upload)`);
        results.skipped++;
        console.log("");
        continue;
      }
    }

    const parts = splitContent(text, MAX_CONTENT_LENGTH);
    log("📤", `Uploading${parts.length > 1 ? ` (${parts.length} parts)` : ""}...`);

    let uploadOk = true;
    for (let i = 0; i < parts.length; i++) {
      const partTitle = parts.length > 1 ? `${doc.title} (Part ${i + 1})` : doc.title;

      try {
        const result = await uploadDocument(partTitle, parts[i], doc.source, doc.category);
        log("✅", `Uploaded: ${partTitle} → id: ${result.id}, status: ${result.status}`);
      } catch (err) {
        log("⚠️", `Upload failed: ${err.message} — retrying...`);
        await sleep(3000);
        try {
          const result = await uploadDocument(partTitle, parts[i], doc.source, doc.category);
          log("✅", `Retry succeeded: ${partTitle} → id: ${result.id}`);
        } catch (retryErr) {
          log("❌", `Retry failed: ${retryErr.message}`);
          uploadOk = false;
        }
      }

      if (i < parts.length - 1) await sleep(UPLOAD_DELAY_MS);
    }

    if (uploadOk) {
      results.success++;
    } else {
      results.failed++;
    }

    // Rate limit delay between documents
    await sleep(UPLOAD_DELAY_MS);
    console.log("");
  }

  // Summary
  console.log("═══════════════════════════════════════");
  log("📊", `Results: ${results.success} succeeded, ${results.skipped} skipped, ${results.failed} failed`);
  console.log("═══════════════════════════════════════");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Add scripts/.cache/ to .gitignore**

Append to `.gitignore`:

```
scripts/.cache/
```

- [ ] **Step 4: Verify script runs (dry check)**

Run: `node scripts/ingest-kb.js` (without setting BOOTSTRAP_SECRET)
Expected: "ERROR: Set BOOTSTRAP_SECRET environment variable"

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest-kb.js .gitignore package.json package-lock.json
git commit -m "feat: add KB ingest script for Ghana legal documents"
```

---

## Chunk 3: Run Ingestion + Verify

### Task 4: Run the ingest pipeline against production

- [ ] **Step 1: Deploy the backend auth bypass**

Run: `npx wrangler deploy`
Expected: Deployment succeeds.

- [ ] **Step 2: Run the ingest script**

```bash
export ASKOZZY_URL=https://askozzy.ghwmelite.workers.dev
export BOOTSTRAP_SECRET=<your_actual_secret>
node scripts/ingest-kb.js
```

Expected: Each document downloads, extracts text, and uploads. Summary shows success count.

- [ ] **Step 3: Review extracted text files**

Check `knowledge-docs/` for the saved `.txt` files. Skim a few to verify:
- Text is readable (not garbled)
- Content matches the expected document
- No binary junk or repeated headers/footers

- [ ] **Step 4: Verify KB population via API**

Test a knowledge query by sending a chat message through the app or via curl:

```bash
curl -X POST "${ASKOZZY_URL}/api/admin/kb/stats" \
  -H "X-Bootstrap-Secret: ${BOOTSTRAP_SECRET}" \
  -H "Content-Type: application/json"
```

Expected: Response shows documents and chunks in the KB.

- [ ] **Step 5: Test a grounded answer**

Ask AskOzzy a question that should now be answerable from the KB:
- "What is the single-source procurement threshold in Act 663?"
- "What are the fundamental human rights in the Ghana Constitution?"
- "What is the SSNIT contribution rate?"

Expected: The agent responds with a cited answer referencing the source document, not "I don't have enough information."

- [ ] **Step 6: Commit extracted text files**

```bash
git add knowledge-docs/
git commit -m "docs: add extracted text for 10 Ghana legal documents"
```
