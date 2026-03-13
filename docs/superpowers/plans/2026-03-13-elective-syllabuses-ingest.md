# Elective Syllabuses KB Ingest Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download 15 WAEC elective subject syllabuses and register them in the KB document registry for ingest into Vectorize.

**Architecture:** Add 15 syllabus entries to `scripts/documents.json`, then run the existing `scripts/ingest-kb.js` pipeline which downloads PDFs, extracts text, chunks, and uploads to the `/api/admin/documents` endpoint. No new code needed.

**Tech Stack:** Node.js ingest script (existing), pdf-parse, Cloudflare D1 + Vectorize

---

## Chunk 1: Register syllabuses and ingest

### Task 1: Add 15 elective syllabus entries to document registry

**Files:**
- Modify: `scripts/documents.json`

- [ ] **Step 1: Add 15 syllabus entries to documents.json**

Append these entries to the JSON array:

```json
{
  "id": "waec-syllabus-business-management",
  "title": "WAEC WASSCE Syllabus — Business Management",
  "url": "https://waecsyllabus.com/download/ssce/BUSINESS%20MANAGEMENT.pdf",
  "source": "West African Examinations Council (WAEC)",
  "category": "education"
},
{
  "id": "waec-syllabus-financial-accounting",
  "title": "WAEC WASSCE Syllabus — Financial Accounting",
  "url": "https://waecsyllabus.com/download/ssce/FINANCIAL%20ACCOUNTS.pdf",
  "source": "West African Examinations Council (WAEC)",
  "category": "education"
},
{
  "id": "waec-syllabus-economics",
  "title": "WAEC WASSCE Syllabus — Economics",
  "url": "https://waecsyllabus.com/download/ssce/ECONOMICS.pdf",
  "source": "West African Examinations Council (WAEC)",
  "category": "education"
},
{
  "id": "waec-syllabus-cost-accounting",
  "title": "WAEC WASSCE Syllabus — Cost Accounting",
  "url": "https://www.larnedu.com/wp-content/uploads/2015/03/Cost-Accounting-WASSCE-_-WAEC-Syllabus.pdf",
  "source": "West African Examinations Council (WAEC)",
  "category": "education"
},
{
  "id": "waec-syllabus-government",
  "title": "WAEC WASSCE Syllabus — Government",
  "url": "https://waecsyllabus.com/download/ssce/GOVERNMENT.pdf",
  "source": "West African Examinations Council (WAEC)",
  "category": "education"
},
{
  "id": "waec-syllabus-history",
  "title": "WAEC WASSCE Syllabus — History",
  "url": "https://waecsyllabus.com/download/ssce/HISTORY.pdf",
  "source": "West African Examinations Council (WAEC)",
  "category": "education"
},
{
  "id": "waec-syllabus-literature-in-english",
  "title": "WAEC WASSCE Syllabus — Literature in English",
  "url": "https://waecsyllabus.com/download/ssce/LITERATURE%20IN%20ENGLISH.pdf",
  "source": "West African Examinations Council (WAEC)",
  "category": "education"
},
{
  "id": "waec-syllabus-christian-religious-studies",
  "title": "WAEC WASSCE Syllabus — Christian Religious Studies",
  "url": "https://waecsyllabus.com/download/ssce/CHRISTIAN%20RELIGIOUS%20STUDIES%20(NEW).pdf",
  "source": "West African Examinations Council (WAEC)",
  "category": "education"
},
{
  "id": "waec-syllabus-geography",
  "title": "WAEC WASSCE Syllabus — Geography",
  "url": "https://waecsyllabus.com/download/ssce/GEOGRAPHY.pdf",
  "source": "West African Examinations Council (WAEC)",
  "category": "education"
},
{
  "id": "waec-syllabus-physics",
  "title": "WAEC WASSCE Syllabus — Physics",
  "url": "https://waecsyllabus.com/download/ssce/PHYSICS.pdf",
  "source": "West African Examinations Council (WAEC)",
  "category": "education"
},
{
  "id": "waec-syllabus-chemistry",
  "title": "WAEC WASSCE Syllabus — Chemistry",
  "url": "https://waecsyllabus.com/download/ssce/CHEMISTRY.pdf",
  "source": "West African Examinations Council (WAEC)",
  "category": "education"
},
{
  "id": "waec-syllabus-biology",
  "title": "WAEC WASSCE Syllabus — Biology",
  "url": "https://waecsyllabus.com/download/ssce/BIOLOGY.pdf",
  "source": "West African Examinations Council (WAEC)",
  "category": "education"
},
{
  "id": "waec-syllabus-elective-mathematics",
  "title": "WAEC WASSCE Syllabus — Further Mathematics / Elective Mathematics",
  "url": "https://waecsyllabus.com/download/ssce/FURTHER%20MATHEMATICS%20OR%20MATHEMATICS%20(ELECTIVE).pdf",
  "source": "West African Examinations Council (WAEC)",
  "category": "education"
},
{
  "id": "waec-syllabus-ict",
  "title": "WAEC WASSCE Syllabus — Information and Communication Technology (ICT)",
  "url": "https://waecsyllabus.com/download/ssce/INFORMATION%20AND%20COMMUNICATION%20TECHNOLOGY%20(CORE).pdf",
  "source": "West African Examinations Council (WAEC)",
  "category": "education"
},
{
  "id": "waec-syllabus-french",
  "title": "WAEC WASSCE Syllabus — French",
  "url": "https://waecsyllabus.com/download/ssce/FRENCH.pdf",
  "source": "West African Examinations Council (WAEC)",
  "category": "education"
}
```

- [ ] **Step 2: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('scripts/documents.json','utf8')); console.log('Valid JSON')"`
Expected: "Valid JSON"

- [ ] **Step 3: Commit registry update**

```bash
git add scripts/documents.json
git commit -m "feat: add 15 WAEC elective subject syllabuses to KB registry"
```

### Task 2: Download and extract syllabus text

- [ ] **Step 4: Run ingest script in parse-only mode**

Run: `node scripts/ingest-kb.js --parse-only`

This downloads PDFs, extracts text via pdf-parse, and saves .txt files to `knowledge-docs/education/` without uploading to the API. Cached PDFs go to `scripts/.cache/`.

Expected: 15 new .txt files created (some PDFs may be scanned/image-based — script will flag those).

- [ ] **Step 5: Verify extracted text files exist and have content**

Run: `ls -la knowledge-docs/education/*.txt | wc -l` and spot-check a few files.

- [ ] **Step 6: Commit extracted text**

```bash
git add knowledge-docs/education/
git commit -m "docs: add extracted text for 15 WAEC elective subject syllabuses"
```

### Task 3: Ingest into Vectorize KB

- [ ] **Step 7: Run ingest script with upload**

Run: `BOOTSTRAP_SECRET=<secret> ASKOZZY_URL=https://askozzy.ghwmelite.workers.dev node scripts/ingest-kb.js`

This uploads extracted text to `/api/admin/documents` endpoint which chunks and embeds into Vectorize + D1.

Expected: 15 documents ingested, chunks created in `knowledge_documents` table.

- [ ] **Step 8: Commit final state**

```bash
git add .
git commit -m "feat: ingest 15 WAEC elective subject syllabuses into Vectorize KB"
```
