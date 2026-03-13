# Education Content Ingest Pipeline — Design Spec

## Goal

Populate AskOzzy's exam prep system and Vectorize knowledge base with WASSCE/BECE past questions (structured, into D1), WAEC syllabuses (into Vectorize), and thesis/research reference guides (into Vectorize) so education agents can provide grounded, cited answers.

## Scope

### Exam Questions (D1 `exam_questions` table)
- **Exam types:** WASSCE and BECE
- **Subjects:** Core Mathematics, English Language, Integrated Science, Social Studies (4 core subjects)
- **Years:** 2020–2024 (5 years)
- **Total papers:** Up to 40 (4 subjects × 5 years × 2 exam types)

### KB Reference Documents (Vectorize)
- 4 WAEC syllabuses (one per core subject)
- APA 7th Edition summary guide
- Research methodology guide
- Total: ~6 documents

## Architecture

Two pipelines running independently:

**Pipeline A — Exam Questions:** A new Node.js script (`scripts/ingest-exam-questions.js`) downloads past paper PDFs, extracts text, sends text to a new server-side parsing endpoint that uses Workers AI to extract structured questions, saves parsed JSON for human review, then bulk-inserts into D1.

**Pipeline B — KB Reference Docs:** Add syllabus and thesis guide entries to the existing `scripts/documents.json` and re-run the existing `scripts/ingest-kb.js`. No new code needed.

## Prerequisites

### Database Migration

The existing `exam_questions` table lacks columns needed for MCQ exam prep. Add these columns before running the ingest:

```sql
ALTER TABLE exam_questions ADD COLUMN options TEXT DEFAULT NULL;
ALTER TABLE exam_questions ADD COLUMN correct_answer TEXT DEFAULT NULL;
ALTER TABLE exam_questions ADD COLUMN explanation TEXT DEFAULT '';
```

- `options` — JSON string with keys A/B/C/D for MCQ, null for theory questions
- `correct_answer` — letter (A/B/C/D) or null if not determinable
- `explanation` — brief explanation of the correct answer

Run via wrangler: `npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-exam-columns.sql`

The existing `marking_scheme` column is retained for backward compatibility. `explanation` is the AI-parsed field; `marking_scheme` can hold official WAEC marking scheme text if available later.

### PDF Sourcing

WAEC Ghana does not publish past papers at stable public URLs. Past paper PDFs must be manually sourced and placed in `scripts/.cache/exams/` before running the ingest script. The `exam-papers.json` registry supports both remote URLs and local file paths:

- **Remote URL:** Script downloads to cache (if available)
- **Local path:** If `url` starts with `file://` or the cached file already exists, skip download

Recommended sourcing approach:
1. Download past papers manually from educational sites (passco.com.gh, mypassco.com, ghana5.com)
2. Place in `scripts/.cache/exams/` named as `{id}.pdf` (e.g., `wassce-core-maths-2024.pdf`)
3. Set `url` in registry to `"local"` to indicate manual placement

This is a one-time manual step per paper. The script handles everything after the PDF is in the cache.

## Components

### 1. Exam Paper Registry (`scripts/exam-papers.json`)

JSON file listing all past papers to ingest:

```json
[
  {
    "id": "wassce-core-maths-2024",
    "exam_type": "wassce",
    "subject": "Core Mathematics",
    "year": 2024,
    "paper": "1",
    "url": "local"
  }
]
```

When `url` is `"local"`, the script expects the PDF at `scripts/.cache/exams/{id}.pdf`. When `url` is a remote URL, the script downloads it to that path.

### 2. Backend: AI Parsing Endpoint (`POST /api/admin/parse-exam-paper`)

Added to `src/routes/admin-content.ts` with `X-Bootstrap-Secret` auth bypass.

- Accepts: `{ text, exam_type, subject, year }`
- Sends extracted PDF text to Workers AI (Llama 3.1 8B) with a structured extraction prompt
- Uses `response_format: { type: "json_object" }` for reliable JSON output
- If PDF text exceeds 12,000 characters, split into segments at question boundaries before parsing each segment separately
- Prompt instructs the model to extract each question with: question_number, question_text, options (A/B/C/D for MCQ), correct_answer, explanation, difficulty, marks, topic
- Sets `max_tokens: 4096` to avoid truncation
- Returns parsed JSON question array
- Keeps AI inference server-side (no local API keys needed)

### 3. Backend: Bulk Question Insert Endpoint (`POST /api/admin/exam-questions/bulk`)

Added to `src/routes/admin-content.ts` with `X-Bootstrap-Secret` auth bypass.

- Accepts: `{ exam_type, subject, year, paper, questions: [...] }`
- Validates each question has required fields (question_number, question_text)
- Maps fields to D1 columns: options (JSON string), correct_answer, explanation, difficulty (defaults to "medium"), marks, topic
- Stringifies `paper` field to match D1 TEXT type
- Bulk inserts into `exam_questions` table using `db.batch()`
- Uses `INSERT OR IGNORE` to skip duplicates (unique constraint on exam_type + subject + year + paper + question_number)
- Returns: `{ inserted, skipped, total }`

### 4. Ingest Script (`scripts/ingest-exam-questions.js`)

Single Node.js script with four stages:

**Stage 1: Download PDFs**
- Fetch each past paper PDF from its URL
- Save to `scripts/.cache/exams/`
- Skip if already cached (idempotent)

**Stage 2: Extract Text**
- Use `pdf-parse` to extract text from each PDF
- Warn if text density is low (scanned/image PDF)
- Skip if extraction fails

**Stage 3: AI Parse**
- POST extracted text to `{API_URL}/api/admin/parse-exam-paper` with bootstrap secret
- Receive structured question array back
- Save parsed JSON to `knowledge-docs/education/{wassce|bece}/{subject}-{year}.json` for human review
- Log question count and any parsing warnings

**Stage 4: Upload to DB**
- Skipped if `--parse-only` flag is set
- POST parsed questions to `{API_URL}/api/admin/exam-questions/bulk`
- Uses `X-Bootstrap-Secret` header
- 2-second delay between uploads for rate limiting
- Log insert/skip counts

### 5. KB Reference Documents (existing pipeline)

Add 6 new entries to `scripts/documents.json`:

| Document | Category |
|----------|----------|
| WAEC Core Mathematics Syllabus | education |
| WAEC English Language Syllabus | education |
| WAEC Integrated Science Syllabus | education |
| WAEC Social Studies Syllabus | education |
| APA 7th Edition Publication Manual Summary | research |
| Research Methodology Guide | research |

Run `node scripts/ingest-kb.js` — same flow as legal docs batch.

## Data Flow

```
Pipeline A — Exam Questions:

scripts/exam-papers.json
        |
        v
scripts/ingest-exam-questions.js
  1. Download PDF → scripts/.cache/exams/
  2. pdf-parse → extract text
  3. POST text → /api/admin/parse-exam-paper (Workers AI parsing)
  4. Save JSON → knowledge-docs/education/{type}/{subject}-{year}.json
  5. POST questions → /api/admin/exam-questions/bulk
        |
        v
D1: exam_questions table (structured data for exam prep feature)


Pipeline B — KB Reference Docs:

scripts/documents.json (add 6 new entries)
        |
        v
scripts/ingest-kb.js (existing script, no changes)
        |
        v
Vectorize KB (syllabuses + thesis guides for agent grounding)
```

## Parsed Question Format

Each JSON file in `knowledge-docs/education/` follows this schema:

```json
{
  "exam_type": "wassce",
  "subject": "Core Mathematics",
  "year": 2023,
  "paper": 1,
  "source": "WAEC Ghana",
  "questions": [
    {
      "question_number": 1,
      "question_text": "Simplify 3√2 + 5√2",
      "options": {
        "A": "8√2",
        "B": "15√2",
        "C": "8√4",
        "D": "15√4"
      },
      "correct_answer": "A",
      "explanation": "3√2 + 5√2 = (3+5)√2 = 8√2. Like terms with the same surd can be added.",
      "difficulty": "easy",
      "marks": 2,
      "topic": "surds"
    }
  ]
}
```

## AI Parsing Prompt

The parsing endpoint uses this system prompt for Workers AI:

```
You are a WAEC exam paper parser. Extract every question from the provided exam paper text into structured JSON.

For each question, extract:
- question_number: integer
- question_text: the full question text
- options: object with keys A, B, C, D (for MCQ) or null (for theory)
- correct_answer: the letter (A/B/C/D) or null if not determinable
- explanation: brief explanation of the answer, or empty string if unknown
- difficulty: "easy", "medium", or "hard" based on the question complexity
- marks: integer marks allocated, or null if not specified
- topic: the mathematical/scientific topic (e.g., "surds", "photosynthesis", "essay writing")

Return ONLY a valid JSON array. Do not include any text outside the JSON.
If you cannot determine the correct answer, set correct_answer to null — do NOT guess.
If you cannot determine marks, set marks to null.
Classify difficulty based on cognitive demand: recall/definition = easy, application = medium, analysis/evaluation = hard.
```

## Error Handling

- **PDF download fails:** Log error, skip to next paper, report at end
- **PDF text extraction fails:** Log error, skip (likely scanned image)
- **AI parsing returns invalid JSON:** Wait 3 seconds, retry once, then skip and flag for manual parsing
- **AI parsing returns incomplete questions:** Save what was parsed, warn about missing fields
- **Bulk insert fails:** Log error with subject/year, continue to next paper
- **Correct answer unknown:** Set to null — human review step will fill it in

## CLI Usage

```bash
# Install dependency (already done from legal batch)
# npm install pdf-parse

# Set environment variables
export ASKOZZY_URL=https://askozzy.ghwmelite.workers.dev
export BOOTSTRAP_SECRET=your_secret_here

# Run exam question ingest (all papers)
node scripts/ingest-exam-questions.js

# Single paper by ID
node scripts/ingest-exam-questions.js --only wassce-core-maths-2024

# Force re-parse and re-upload
node scripts/ingest-exam-questions.js --force

# Skip upload, just download and parse (for review)
node scripts/ingest-exam-questions.js --parse-only

# Run KB reference doc ingest (syllabuses + thesis guides)
node scripts/ingest-kb.js
```

## Success Criteria

- Past paper PDFs downloaded for 4 core subjects × 5 years × 2 exam types
- AI-parsed questions saved as reviewable JSON in `knowledge-docs/education/`
- Questions inserted into `exam_questions` D1 table
- Exam prep API endpoints return actual questions (not empty results)
- WAEC syllabuses and thesis guides in Vectorize KB
- Research Assistant and WASSCE Prep agents provide grounded answers from KB

## Non-Goals

- No admin UI for reviewing/editing parsed questions (use JSON files)
- No OCR for scanned PDFs — skip and flag for manual entry
- No elective subjects in this batch (future batch)
- No automatic scheduling — manual, run-once-per-batch script
