# Education Content Ingest Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate AskOzzy's exam prep system with WASSCE/BECE past questions (D1) and Vectorize KB with WAEC syllabuses and thesis/research guides.

**Architecture:** Two pipelines — Pipeline A: new script downloads exam PDFs, AI-parses into structured questions, bulk-inserts into D1 `exam_questions` table via two new admin endpoints. Pipeline B: add education/research document entries to existing `scripts/documents.json` and re-run `scripts/ingest-kb.js`.

**Tech Stack:** Node.js, pdf-parse, Hono (backend), Cloudflare Workers AI (Llama 3.1 8B), D1, Vectorize

---

## File Structure

| File | Responsibility |
|------|---------------|
| Create: `schema-exam-columns.sql` | DB migration — add options, correct_answer, explanation columns |
| Modify: `src/routes/admin-content.ts` | Add parse-exam-paper + bulk exam questions endpoints |
| Create: `scripts/exam-papers.json` | Exam paper registry (subject, year, exam type, URL/local) |
| Create: `scripts/ingest-exam-questions.js` | Download PDFs, extract text, AI-parse, upload questions |
| Modify: `scripts/documents.json` | Add 6 education/research KB document entries |

---

## Chunk 1: Database Migration + Backend Endpoints

### Task 1: Database migration — add MCQ columns to exam_questions

**Files:**
- Create: `schema-exam-columns.sql`

- [ ] **Step 1: Create the migration SQL file**

Create `schema-exam-columns.sql` in the project root:

```sql
-- Add MCQ columns to exam_questions table for structured exam prep
-- These columns are needed for WASSCE/BECE past question ingestion

ALTER TABLE exam_questions ADD COLUMN options TEXT DEFAULT NULL;
ALTER TABLE exam_questions ADD COLUMN correct_answer TEXT DEFAULT NULL;
ALTER TABLE exam_questions ADD COLUMN explanation TEXT DEFAULT '';
```

- [ ] **Step 2: Run migration against remote D1**

Run: `npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-exam-columns.sql`
Expected: 3 statements executed successfully.

Note: If columns already exist, the ALTER TABLE will fail with "duplicate column" — this is safe to ignore. Wrap each in separate execution if needed:
```bash
npx wrangler d1 execute ghana-civil-ai-db --remote --command "ALTER TABLE exam_questions ADD COLUMN options TEXT DEFAULT NULL"
npx wrangler d1 execute ghana-civil-ai-db --remote --command "ALTER TABLE exam_questions ADD COLUMN correct_answer TEXT DEFAULT NULL"
npx wrangler d1 execute ghana-civil-ai-db --remote --command "ALTER TABLE exam_questions ADD COLUMN explanation TEXT DEFAULT ''"
```

- [ ] **Step 3: Verify columns exist**

Run: `npx wrangler d1 execute ghana-civil-ai-db --remote --command "PRAGMA table_info(exam_questions)"`
Expected: Output includes `options`, `correct_answer`, `explanation` columns alongside existing columns.

- [ ] **Step 4: Commit**

```bash
git add schema-exam-columns.sql
git commit -m "feat: add MCQ columns to exam_questions table for WASSCE/BECE ingest"
```

---

### Task 2: Add AI parsing endpoint to admin-content.ts

**Files:**
- Modify: `src/routes/admin-content.ts:2245` (append before `export default`)

- [ ] **Step 1: Add the parse-exam-paper endpoint**

Insert the following before `export default adminContent;` (line 2245) in `src/routes/admin-content.ts`:

```typescript
// ─── Admin: AI Parse Exam Paper ──────────────────────────────────────

const EXAM_PARSE_SYSTEM_PROMPT = `You are a WAEC exam paper parser. Extract every question from the provided exam paper text into structured JSON.

For each question, extract:
- question_number: integer
- question_text: the full question text including any sub-parts
- options: object with keys A, B, C, D (for MCQ) or null (for theory/essay questions)
- correct_answer: the letter (A/B/C/D) or null if not determinable from the text
- explanation: brief explanation of the answer, or empty string if unknown
- difficulty: "easy", "medium", or "hard" based on cognitive demand (recall=easy, application=medium, analysis=hard)
- marks: integer marks allocated, or null if not specified
- topic: the subject topic (e.g., "surds", "photosynthesis", "essay writing", "comprehension")

Return ONLY a valid JSON array of question objects. Do not include any text outside the JSON.
If you cannot determine the correct answer, set correct_answer to null — do NOT guess.
If you cannot determine marks, set marks to null.`;

adminContent.post("/api/admin/parse-exam-paper", async (c, next) => {
  const bootstrapSecret = c.req.header("X-Bootstrap-Secret");
  if (bootstrapSecret && bootstrapSecret === c.env.BOOTSTRAP_SECRET) {
    c.set("userId", "system-ingest");
    return next();
  }
  return adminMiddleware(c, next);
}, async (c) => {
  const { text, exam_type, subject, year } = await c.req.json();

  if (!text || !exam_type || !subject || !year) {
    return c.json({ error: "text, exam_type, subject, and year are required" }, 400);
  }

  // Split long text into segments (~12K chars each) at question boundaries
  const MAX_SEGMENT = 12000;
  const segments: string[] = [];

  if (text.length <= MAX_SEGMENT) {
    segments.push(text);
  } else {
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + MAX_SEGMENT, text.length);
      if (end < text.length) {
        // Try to split at a question number boundary (e.g., "\n1." or "\nQuestion")
        const questionBoundary = text.lastIndexOf("\n", end);
        if (questionBoundary > start + MAX_SEGMENT * 0.5) {
          end = questionBoundary;
        }
      }
      segments.push(text.slice(start, end).trim());
      start = end;
    }
  }

  const allQuestions: any[] = [];

  for (const segment of segments) {
    try {
      const response = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast' as any, {
        messages: [
          { role: "system", content: EXAM_PARSE_SYSTEM_PROMPT },
          { role: "user", content: `Parse this ${exam_type.toUpperCase()} ${subject} (${year}) exam paper:\n\n${segment}` },
        ],
        max_tokens: 4096,
        response_format: { type: "json_object" },
      });

      const responseText = typeof response === 'string' ? response : (response as any).response || '';

      // Extract JSON array from response (handle markdown code blocks)
      let jsonText = responseText.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(jsonText);
      const questions = Array.isArray(parsed) ? parsed : (parsed.questions || []);
      allQuestions.push(...questions);
    } catch (err: any) {
      // Log but continue with other segments
      console.error(`Parse segment error: ${err.message}`);
    }
  }

  return c.json({
    exam_type,
    subject,
    year,
    question_count: allQuestions.length,
    questions: allQuestions,
  });
});
```

- [ ] **Step 2: Verify build**

Run: `npx wrangler deploy --dry-run`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin-content.ts
git commit -m "feat: add AI exam paper parsing endpoint for WASSCE/BECE ingest"
```

---

### Task 3: Add bulk exam question insert endpoint to admin-content.ts

**Files:**
- Modify: `src/routes/admin-content.ts` (append before `export default`)

- [ ] **Step 1: Add the bulk insert endpoint**

Insert the following before `export default adminContent;` in `src/routes/admin-content.ts`:

```typescript
// ─── Admin: Bulk Insert Exam Questions ───────────────────────────────

adminContent.post("/api/admin/exam-questions/bulk", async (c, next) => {
  const bootstrapSecret = c.req.header("X-Bootstrap-Secret");
  if (bootstrapSecret && bootstrapSecret === c.env.BOOTSTRAP_SECRET) {
    c.set("userId", "system-ingest");
    return next();
  }
  return adminMiddleware(c, next);
}, async (c) => {
  const { exam_type, subject, year, paper, questions } = await c.req.json();

  if (!exam_type || !subject || !year || !questions || !Array.isArray(questions)) {
    return c.json({ error: "exam_type, subject, year, and questions array are required" }, 400);
  }

  const paperStr = String(paper || "1");
  let inserted = 0;
  let skipped = 0;

  // Filter out invalid questions
  const validQuestions = questions.filter((q: any) => {
    if (!q.question_text || !q.question_number) {
      console.log(`Skipping invalid question: missing question_text or question_number`);
      skipped++;
      return false;
    }
    return true;
  });

  // Process in batches of 20 (D1 batch limit consideration)
  for (let i = 0; i < validQuestions.length; i += 20) {
    const batch = validQuestions.slice(i, i + 20);
    const statements = batch.map((q: any) => {
      const id = generateId();
      const optionsJson = q.options ? JSON.stringify(q.options) : null;
      const difficulty = ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium';

      return c.env.DB.prepare(
        `INSERT OR IGNORE INTO exam_questions
         (id, exam_type, subject, year, paper, question_number, question_text, options, correct_answer, explanation, marks, difficulty, topic)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        exam_type,
        subject,
        year,
        paperStr,
        q.question_number || 0,
        q.question_text || '',
        optionsJson,
        q.correct_answer || null,
        q.explanation || '',
        q.marks || 0,
        difficulty,
        q.topic || ''
      );
    });

    try {
      const results = await c.env.DB.batch(statements);
      for (const r of results) {
        if (r.meta.changes > 0) inserted++;
        else skipped++;
      }
    } catch (err: any) {
      console.error(`Batch insert error: ${err.message}`);
      skipped += batch.length;
    }
  }

  await logAudit(c.env.DB, c.get("userId"), "bulk_insert_exam_questions", "exam_questions", null, `${exam_type} ${subject} ${year}: ${inserted} inserted, ${skipped} skipped`);

  return c.json({ inserted, skipped, total: questions.length });
});
```

- [ ] **Step 2: Verify build**

Run: `npx wrangler deploy --dry-run`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin-content.ts
git commit -m "feat: add bulk exam question insert endpoint for WASSCE/BECE ingest"
```

---

## Chunk 2: Exam Paper Registry + Ingest Script

### Task 4: Create exam paper registry

**Files:**
- Create: `scripts/exam-papers.json`

- [ ] **Step 1: Create the registry file**

Create `scripts/exam-papers.json`. This contains entries for 4 core subjects × 5 years × 2 exam types. All use `"url": "local"` since WAEC PDFs must be manually sourced:

```json
[
  { "id": "wassce-core-maths-2024", "exam_type": "wassce", "subject": "Core Mathematics", "year": 2024, "paper": "1", "url": "local" },
  { "id": "wassce-core-maths-2023", "exam_type": "wassce", "subject": "Core Mathematics", "year": 2023, "paper": "1", "url": "local" },
  { "id": "wassce-core-maths-2022", "exam_type": "wassce", "subject": "Core Mathematics", "year": 2022, "paper": "1", "url": "local" },
  { "id": "wassce-core-maths-2021", "exam_type": "wassce", "subject": "Core Mathematics", "year": 2021, "paper": "1", "url": "local" },
  { "id": "wassce-core-maths-2020", "exam_type": "wassce", "subject": "Core Mathematics", "year": 2020, "paper": "1", "url": "local" },

  { "id": "wassce-english-2024", "exam_type": "wassce", "subject": "English Language", "year": 2024, "paper": "1", "url": "local" },
  { "id": "wassce-english-2023", "exam_type": "wassce", "subject": "English Language", "year": 2023, "paper": "1", "url": "local" },
  { "id": "wassce-english-2022", "exam_type": "wassce", "subject": "English Language", "year": 2022, "paper": "1", "url": "local" },
  { "id": "wassce-english-2021", "exam_type": "wassce", "subject": "English Language", "year": 2021, "paper": "1", "url": "local" },
  { "id": "wassce-english-2020", "exam_type": "wassce", "subject": "English Language", "year": 2020, "paper": "1", "url": "local" },

  { "id": "wassce-int-science-2024", "exam_type": "wassce", "subject": "Integrated Science", "year": 2024, "paper": "1", "url": "local" },
  { "id": "wassce-int-science-2023", "exam_type": "wassce", "subject": "Integrated Science", "year": 2023, "paper": "1", "url": "local" },
  { "id": "wassce-int-science-2022", "exam_type": "wassce", "subject": "Integrated Science", "year": 2022, "paper": "1", "url": "local" },
  { "id": "wassce-int-science-2021", "exam_type": "wassce", "subject": "Integrated Science", "year": 2021, "paper": "1", "url": "local" },
  { "id": "wassce-int-science-2020", "exam_type": "wassce", "subject": "Integrated Science", "year": 2020, "paper": "1", "url": "local" },

  { "id": "wassce-social-studies-2024", "exam_type": "wassce", "subject": "Social Studies", "year": 2024, "paper": "1", "url": "local" },
  { "id": "wassce-social-studies-2023", "exam_type": "wassce", "subject": "Social Studies", "year": 2023, "paper": "1", "url": "local" },
  { "id": "wassce-social-studies-2022", "exam_type": "wassce", "subject": "Social Studies", "year": 2022, "paper": "1", "url": "local" },
  { "id": "wassce-social-studies-2021", "exam_type": "wassce", "subject": "Social Studies", "year": 2021, "paper": "1", "url": "local" },
  { "id": "wassce-social-studies-2020", "exam_type": "wassce", "subject": "Social Studies", "year": 2020, "paper": "1", "url": "local" },

  { "id": "bece-core-maths-2024", "exam_type": "bece", "subject": "Core Mathematics", "year": 2024, "paper": "1", "url": "local" },
  { "id": "bece-core-maths-2023", "exam_type": "bece", "subject": "Core Mathematics", "year": 2023, "paper": "1", "url": "local" },
  { "id": "bece-core-maths-2022", "exam_type": "bece", "subject": "Core Mathematics", "year": 2022, "paper": "1", "url": "local" },
  { "id": "bece-core-maths-2021", "exam_type": "bece", "subject": "Core Mathematics", "year": 2021, "paper": "1", "url": "local" },
  { "id": "bece-core-maths-2020", "exam_type": "bece", "subject": "Core Mathematics", "year": 2020, "paper": "1", "url": "local" },

  { "id": "bece-english-2024", "exam_type": "bece", "subject": "English Language", "year": 2024, "paper": "1", "url": "local" },
  { "id": "bece-english-2023", "exam_type": "bece", "subject": "English Language", "year": 2023, "paper": "1", "url": "local" },
  { "id": "bece-english-2022", "exam_type": "bece", "subject": "English Language", "year": 2022, "paper": "1", "url": "local" },
  { "id": "bece-english-2021", "exam_type": "bece", "subject": "English Language", "year": 2021, "paper": "1", "url": "local" },
  { "id": "bece-english-2020", "exam_type": "bece", "subject": "English Language", "year": 2020, "paper": "1", "url": "local" },

  { "id": "bece-int-science-2024", "exam_type": "bece", "subject": "Integrated Science", "year": 2024, "paper": "1", "url": "local" },
  { "id": "bece-int-science-2023", "exam_type": "bece", "subject": "Integrated Science", "year": 2023, "paper": "1", "url": "local" },
  { "id": "bece-int-science-2022", "exam_type": "bece", "subject": "Integrated Science", "year": 2022, "paper": "1", "url": "local" },
  { "id": "bece-int-science-2021", "exam_type": "bece", "subject": "Integrated Science", "year": 2021, "paper": "1", "url": "local" },
  { "id": "bece-int-science-2020", "exam_type": "bece", "subject": "Integrated Science", "year": 2020, "paper": "1", "url": "local" },

  { "id": "bece-social-studies-2024", "exam_type": "bece", "subject": "Social Studies", "year": 2024, "paper": "1", "url": "local" },
  { "id": "bece-social-studies-2023", "exam_type": "bece", "subject": "Social Studies", "year": 2023, "paper": "1", "url": "local" },
  { "id": "bece-social-studies-2022", "exam_type": "bece", "subject": "Social Studies", "year": 2022, "paper": "1", "url": "local" },
  { "id": "bece-social-studies-2021", "exam_type": "bece", "subject": "Social Studies", "year": 2021, "paper": "1", "url": "local" },
  { "id": "bece-social-studies-2020", "exam_type": "bece", "subject": "Social Studies", "year": 2020, "paper": "1", "url": "local" }
]
```

- [ ] **Step 2: Commit**

```bash
git add scripts/exam-papers.json
git commit -m "feat: add exam paper registry for WASSCE/BECE ingest (40 papers)"
```

---

### Task 5: Create the exam questions ingest script

**Files:**
- Create: `scripts/ingest-exam-questions.js`

- [ ] **Step 1: Create the ingest script**

Create `scripts/ingest-exam-questions.js`:

```javascript
#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

// ─── Configuration ───────────────────────────────────────────────────

const API_URL = process.env.ASKOZZY_URL || "https://askozzy.ghwmelite.workers.dev";
const SECRET = process.env.BOOTSTRAP_SECRET;
const CACHE_DIR = path.join(__dirname, ".cache", "exams");
const DOCS_DIR = path.join(__dirname, "..", "knowledge-docs", "education");
const REGISTRY = path.join(__dirname, "exam-papers.json");
const UPLOAD_DELAY_MS = 2000;

// ─── Parse CLI flags ─────────────────────────────────────────────────

const args = process.argv.slice(2);
const forceFlag = args.includes("--force");
const parseOnlyFlag = args.includes("--parse-only");
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
  if (url === "local") {
    if (fs.existsSync(destPath)) {
      log("📁", `Local: ${path.basename(destPath)}`);
      return true;
    }
    log("❌", `Missing local PDF: ${destPath}`);
    log("💡", `Download the past paper and place it at: ${destPath}`);
    return false;
  }

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

  if (charsPerPage < 100 && pages > 2) {
    log("⚠️", `WARNING: Very low text density — this PDF may be scanned/image-based`);
  }

  if (chars < 50) {
    log("❌", `Text too short (${chars} chars) — skipping`);
    return null;
  }

  return text;
}

async function aiParse(text, examType, subject, year) {
  log("🤖", `AI parsing ${examType.toUpperCase()} ${subject} ${year}...`);

  const res = await fetch(`${API_URL}/api/admin/parse-exam-paper`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Secret": SECRET,
    },
    body: JSON.stringify({ text, exam_type: examType, subject, year }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI parse failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  log("✅", `Parsed: ${data.question_count} questions extracted`);
  return data;
}

async function uploadQuestions(examType, subject, year, paper, questions) {
  const res = await fetch(`${API_URL}/api/admin/exam-questions/bulk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Secret": SECRET,
    },
    body: JSON.stringify({ exam_type: examType, subject, year, paper, questions }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Bulk insert failed (${res.status}): ${errText}`);
  }

  return await res.json();
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  if (!SECRET) {
    console.error("ERROR: Set BOOTSTRAP_SECRET environment variable");
    process.exit(1);
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const papers = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
  const toProcess = onlyId ? papers.filter((p) => p.id === onlyId) : papers;

  if (toProcess.length === 0) {
    console.error(onlyId ? `No paper found with id: ${onlyId}` : "No papers in registry");
    process.exit(1);
  }

  log("🚀", `Processing ${toProcess.length} exam paper(s) → ${API_URL}`);
  if (parseOnlyFlag) log("📋", "Parse-only mode — skipping DB upload");
  console.log("");

  const results = { success: 0, skipped: 0, failed: 0, totalQuestions: 0 };

  for (const paper of toProcess) {
    console.log(`─── ${paper.exam_type.toUpperCase()} ${paper.subject} ${paper.year} ───`);

    // Stage 1: Download/locate PDF
    const pdfPath = path.join(CACHE_DIR, `${paper.id}.pdf`);
    const available = await downloadPdf(paper.url, pdfPath);
    if (!available) {
      results.skipped++;
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

    // Check for existing parsed JSON (skip AI parse unless --force)
    const typeDir = path.join(DOCS_DIR, paper.exam_type);
    fs.mkdirSync(typeDir, { recursive: true });
    const jsonPath = path.join(typeDir, `${paper.subject.toLowerCase().replace(/\s+/g, "-")}-${paper.year}.json`);

    let parsed;

    if (!forceFlag && fs.existsSync(jsonPath)) {
      log("⏭️", `Already parsed — loading from ${path.basename(jsonPath)}`);
      parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } else {
      // Stage 3: AI Parse
      try {
        parsed = await aiParse(text, paper.exam_type, paper.subject, paper.year);
      } catch (err) {
        log("⚠️", `AI parse failed: ${err.message} — retrying in 3s...`);
        await sleep(3000);
        try {
          parsed = await aiParse(text, paper.exam_type, paper.subject, paper.year);
        } catch (retryErr) {
          log("❌", `AI parse retry failed: ${retryErr.message}`);
          results.failed++;
          console.log("");
          continue;
        }
      }

      // Save parsed JSON for review
      fs.writeFileSync(jsonPath, JSON.stringify(parsed, null, 2));
      log("💾", `Saved: ${path.relative(path.join(__dirname, ".."), jsonPath)}`);
    }

    const questions = parsed.questions || [];
    if (questions.length === 0) {
      log("⚠️", "No questions parsed — skipping upload");
      results.failed++;
      console.log("");
      continue;
    }

    // Stage 4: Upload to DB
    if (parseOnlyFlag) {
      log("📋", `Parse-only: ${questions.length} questions ready for review`);
      results.success++;
      results.totalQuestions += questions.length;
      console.log("");
      continue;
    }

    try {
      const result = await uploadQuestions(paper.exam_type, paper.subject, paper.year, paper.paper, questions);
      log("✅", `Inserted: ${result.inserted}, Skipped: ${result.skipped}`);
      results.success++;
      results.totalQuestions += result.inserted;
    } catch (err) {
      log("❌", `Upload failed: ${err.message}`);
      results.failed++;
    }

    await sleep(UPLOAD_DELAY_MS);
    console.log("");
  }

  // Summary
  console.log("═══════════════════════════════════════");
  log("📊", `Results: ${results.success} succeeded, ${results.skipped} skipped (no PDF), ${results.failed} failed`);
  log("📝", `Total questions: ${results.totalQuestions}`);
  console.log("═══════════════════════════════════════");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add scripts/.cache/exams/ to .gitignore**

Append to `.gitignore`:
```
scripts/.cache/exams/
```

Note: `scripts/.cache/` is already gitignored from the legal batch, so this line is redundant but explicit. Verify `scripts/.cache/` is already in `.gitignore` — if so, skip this step.

- [ ] **Step 3: Verify script runs (dry check)**

Run: `node scripts/ingest-exam-questions.js`
Expected: "ERROR: Set BOOTSTRAP_SECRET environment variable"

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest-exam-questions.js
git commit -m "feat: add exam questions ingest script for WASSCE/BECE past papers"
```

---

## Chunk 3: KB Reference Documents + Deploy & Run

### Task 6: Add education/research documents to KB registry

**Files:**
- Modify: `scripts/documents.json`

- [ ] **Step 1: Add 6 new entries to documents.json**

Append these entries to the existing array in `scripts/documents.json` (before the closing `]`):

```json
  ,
  {
    "id": "apa-7th-edition-guide",
    "title": "APA 7th Edition Publication Manual — Style Guide Summary",
    "url": "https://apastyle.apa.org/instructional-aids/reference-guide.pdf",
    "source": "American Psychological Association",
    "category": "research"
  },
  {
    "id": "research-methodology-guide",
    "title": "Research Methodology: Methods and Techniques",
    "url": "https://ccsuniversity.ac.in/bridge-library/pdf/Research-Methodology-CR-Kothari.pdf",
    "source": "C.R. Kothari",
    "category": "research"
  }
```

**Note on WAEC syllabuses:** WAEC publishes syllabuses as HTML pages, not downloadable PDFs. To ingest them, manually download/print the syllabus pages as PDFs, place them in `scripts/.cache/` with filenames matching the registry IDs (e.g., `waec-core-maths-syllabus.pdf`), and add entries to `documents.json` with the correct URL. The `ingest-kb.js` script will find the cached file and skip download. Add syllabus entries only after confirming you have the PDFs:

```json
  {
    "id": "waec-core-maths-syllabus",
    "title": "WAEC Core Mathematics Syllabus for WASSCE",
    "url": "https://placeholder-update-after-download.pdf",
    "source": "West African Examinations Council",
    "category": "education"
  }
```

- [ ] **Step 2: Commit**

```bash
git add scripts/documents.json
git commit -m "feat: add education and research documents to KB registry"
```

---

### Task 7: Deploy backend and run pipelines

- [ ] **Step 1: Deploy the backend with new endpoints**

Run: `npx wrangler deploy`
Expected: Deployment succeeds with the two new endpoints available.

- [ ] **Step 2: Run KB reference doc ingest (Pipeline B)**

```bash
export ASKOZZY_URL=https://askozzy.ghwmelite.workers.dev
export BOOTSTRAP_SECRET=<your_secret>
node scripts/ingest-kb.js
```

Expected: New education/research documents download (where PDFs available), extract, and upload. Previously ingested legal docs are skipped.

- [ ] **Step 3: Source exam paper PDFs**

Manually download WASSCE/BECE past papers from educational sites and place them in `scripts/.cache/exams/` with filenames matching the registry IDs:

```
scripts/.cache/exams/wassce-core-maths-2024.pdf
scripts/.cache/exams/wassce-core-maths-2023.pdf
scripts/.cache/exams/wassce-english-2024.pdf
... etc
```

Start with 2-3 papers to validate the pipeline before doing all 40.

- [ ] **Step 4: Run exam question ingest — parse only first**

```bash
export ASKOZZY_URL=https://askozzy.ghwmelite.workers.dev
export BOOTSTRAP_SECRET=<your_secret>
node scripts/ingest-exam-questions.js --parse-only
```

Expected: PDFs are extracted, AI-parsed, and JSON saved to `knowledge-docs/education/{wassce|bece}/`. Review the JSON files to verify question quality.

- [ ] **Step 5: Review parsed questions**

Check `knowledge-docs/education/wassce/` and `knowledge-docs/education/bece/` for JSON files. Verify:
- Questions are readable and correctly extracted
- Options A/B/C/D are present for MCQ questions
- correct_answer is set where determinable (null is OK for theory)
- No hallucinated or fabricated content

Edit JSON files manually if corrections are needed.

- [ ] **Step 6: Run full ingest (parse + upload)**

```bash
node scripts/ingest-exam-questions.js
```

Expected: Previously parsed questions are loaded from JSON (not re-parsed), then uploaded to D1. Summary shows insert counts.

- [ ] **Step 7: Verify exam prep API returns questions**

```bash
curl -s "https://askozzy.ghwmelite.workers.dev/api/exam-prep/subjects?examType=wassce" \
  -H "Authorization: Bearer <your_token>"
```

Expected: Response lists subjects with question counts > 0.

- [ ] **Step 8: Commit parsed question files**

```bash
git add knowledge-docs/education/
git commit -m "docs: add AI-parsed WASSCE/BECE exam questions for review"
```
