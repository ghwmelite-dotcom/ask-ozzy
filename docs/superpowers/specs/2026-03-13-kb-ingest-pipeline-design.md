# Knowledge Base Ingest Pipeline — Design Spec

## Goal

Populate AskOzzy's Vectorize knowledge base with verified Ghana government documents so agents can provide grounded, cited answers instead of falling back to "I don't have enough information."

## Architecture

A local Node.js script (`scripts/ingest-kb.js`) downloads official PDFs, extracts text, and uploads to the existing `/api/admin/documents` endpoint. The backend handles chunking, embedding, and Vectorize upsert — no new server-side infrastructure needed.

## Components

### 1. Backend Auth Bypass (small change)

Add `X-Bootstrap-Secret` header check to `/api/admin/documents` and `/api/admin/documents/upload-file` endpoints. If the header matches `env.BOOTSTRAP_SECRET`, skip `adminMiddleware` auth and set `userId` to `"system-ingest"` for audit logging.

This reuses the existing `BOOTSTRAP_SECRET` Cloudflare secret — no new secrets needed. Note: `BOOTSTRAP_SECRET` must be configured in the Cloudflare dashboard for production.

### 2. Ingest Script (`scripts/ingest-kb.js`)

Single Node.js script with three stages:

**Stage 1: Download PDFs**
- Fetch each PDF from its official URL (follow redirects, verify `Content-Type` is PDF)
- Save to a temp directory (`scripts/.cache/`)
- Skip download if cached file already exists (idempotent re-runs)

**Stage 2: Extract Text**
- Use `pdf-parse` npm package to extract text from each PDF
- Log page count and character count for QC
- Warn if extracted text is suspiciously short relative to page count (possible scanned/image PDF)
- Save extracted text to `knowledge-docs/` for human review

**Stage 3: Upload to API**
- Check if document already exists (by title) — skip if already ingested, unless `--force` flag is set
- For documents over 80,000 characters, split into parts before uploading (backend has 100K char limit)
- POST each document/part to `{API_URL}/api/admin/documents`
- Body: `{ title, content, source, category }`
- Header: `X-Bootstrap-Secret: {secret}`
- 2-second delay between uploads to respect Workers AI embedding rate limits
- Log response: chunk count, success/failure

### 3. Document Registry (`scripts/documents.json`)

JSON file listing all documents to ingest:

```json
[
  {
    "id": "constitution-1992",
    "title": "Constitution of the Republic of Ghana, 1992",
    "url": "https://constitutionnet.org/sites/default/files/Ghana%20Constitution.pdf",
    "source": "Parliament of Ghana",
    "category": "legal"
  }
]
```

Adding new documents = adding an entry to this file and re-running the script.

## Document List (First Batch — Legal Priority)

| # | Document | URL | Category |
|---|----------|-----|----------|
| 1 | 1992 Constitution of Ghana | constitutionnet.org PDF | legal |
| 2 | Public Procurement Act 663 (2003) | ppa.gov.gh PDF | procurement_law |
| 3 | Public Financial Management Act 921 (2016) | mofep.gov.gh PDF | financial_admin |
| 4 | Financial Administration Act 654 (2003) | ghalii.org PDF | financial_admin |
| 5 | Data Protection Act 843 (2012) | nita.gov.gh PDF | legal |
| 6 | Labour Act 651 (2003) | gipc.gov.gh PDF | legal |
| 7 | Civil Service Act PNDCL 327 (1993) | NDPC S3 PDF | civil_service |
| 8 | SSNIT Omnibus Guide | ssnit.org.gh PDF | hr |
| 9 | Civil Service Administrative Instructions | ohcs.gov.gh PDF | civil_service |
| 10 | PPA Procurement Manual | ppa.gov.gh PDF | procurement_law |

## Data Flow

```
scripts/documents.json
        |
        v
scripts/ingest-kb.js
  1. Download PDF from URL → scripts/.cache/
  2. pdf-parse → extract text
  3. Save text → knowledge-docs/{category}/{filename}.txt
  4. POST text → /api/admin/documents
        |
        v
Existing backend pipeline:
  - chunkText() → split into ~500-char chunks
  - Workers AI → generate embeddings (bge-base-en-v1.5)
  - Vectorize.upsert() → store vectors + metadata
  - D1 INSERT → knowledge_documents table
```

## Error Handling

- **PDF download fails:** Log error, skip to next document, report at end
- **PDF text extraction fails:** Log error with filename, skip
- **API upload fails:** Retry once, then log and skip
- **Empty text extraction:** Skip document, warn (some PDFs are scanned images without OCR)

## Usage

```bash
# Install dependency
npm install pdf-parse

# Set environment variables
export ASKOZZY_URL=https://askozzy.ghwmelite.workers.dev
export BOOTSTRAP_SECRET=your_secret_here

# Run ingest
node scripts/ingest-kb.js

# Or ingest a single document by ID
node scripts/ingest-kb.js --only constitution-1992

# Force re-upload even if document already exists
node scripts/ingest-kb.js --force
```

## Success Criteria

- All 10 documents downloaded and text extracted
- Text saved to `knowledge-docs/` for human review
- Documents uploaded and chunked via admin API
- Vectorize index populated (verify with a test query like "What is the procurement threshold in Act 663?")
- No AI-generated or hallucinated content in the KB

## Future Batches

After legal documents are verified working:
- Batch 2: Education (WASSCE/BECE past questions from passco.com.gh, ghana5.com)
- Batch 3: Operational docs (OHCS HR circulars, PPA regulations, SSNIT guides)

## Non-Goals

- No automatic scheduling/cron — this is a manual, run-once-per-batch script
- No web scraping of HTML pages — PDF download only for this batch
- No OCR for scanned PDFs — skip those and flag for manual conversion
