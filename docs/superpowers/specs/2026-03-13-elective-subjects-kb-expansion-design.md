# Elective Subjects KB Expansion — Design Spec

**Goal:** Scrape 15 popular WASSCE elective subjects (2020-2024) from kuulchat.com and ingest into the AskOzzy exam questions knowledge base.

**Architecture:** Extend the existing `scripts/scrape-kuulchat.js` scraper with new subject slug mappings. No new modules or endpoints needed — reuses the full existing pipeline (scraper → JSON files → bulk upload → D1).

**Tech Stack:** Node.js scraper, Cloudflare D1, existing bulk ingest endpoint

---

## Subjects (15 electives, WASSCE only)

| # | Subject | URL Slug (to verify) | Track |
|---|---------|---------------------|-------|
| 1 | Business Management | `business-management` | Business |
| 2 | Financial Accounting | `financial-accounting` | Business |
| 3 | Economics | `economics` | Business |
| 4 | Cost Accounting | `cost-accounting` | Business |
| 5 | Government | `government` | Humanities |
| 6 | History | `history` | Humanities |
| 7 | Literature in English | `literature-in-english` | Humanities |
| 8 | Christian Religious Studies | `christian-religious-studies` | Humanities |
| 9 | Geography | `geography` | Humanities |
| 10 | Physics | `physics` | Science |
| 11 | Chemistry | `chemistry` | Science |
| 12 | Biology | `biology` | Science |
| 13 | Elective Mathematics | `elective-mathematics` | Science |
| 14 | ICT | `ict` | Tech |
| 15 | French | `french` | Humanities |

## URL Pattern

```
https://kuulchat.com/wassce/questions/june-{year}-{subject-slug}/
```

Years: 2020, 2021, 2022, 2023, 2024 (75 total paper URLs)

## Implementation Steps

1. **Verify URL slugs** — HTTP probe each subject to confirm actual kuulchat slug
2. **Add subjects to scraper** — Extend the WASSCE papers array in `scripts/scrape-kuulchat.js`
3. **Run scraper** — Output JSON files to `knowledge-docs/education/wassce/`
4. **Update document registry** — Add entries to `scripts/documents.json`
5. **Bulk insert** — Upload via `/api/admin/exam-questions/bulk` endpoint

## Output Format (per JSON file)

```json
{
  "exam_type": "wassce",
  "subject": "Business Management",
  "year": 2023,
  "paper": "1",
  "source_url": "https://kuulchat.com/wassce/questions/june-2023-business-management/",
  "questions": [
    {
      "question_number": 1,
      "question_text": "...",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "correct_answer": "B",
      "explanation": "...",
      "difficulty": "medium",
      "marks": null,
      "topic": null
    }
  ]
}
```

## What's Reused (no changes needed)

- MCQ parsing logic (question number regex, options A-D extraction)
- Answer detection (4 pattern strategies + option value matching)
- Deduplication (by question number)
- MCQ filter (require 3+ options, excludes theory questions)
- Bulk upload endpoint (`POST /api/admin/exam-questions/bulk`)
- D1 schema (`exam_questions` table with UNIQUE constraint)
- Rate limiting and error handling

## Risks & Mitigations

- **Slug mismatch:** Some slugs may differ from convention — probe first, adjust
- **Missing years:** Some subjects may not have all 5 years — scraper logs and skips gracefully
- **Theory-heavy papers:** Some electives (Literature, History) may have fewer MCQs — existing 3+ option filter handles this
- **French content:** Questions may mix French/English — parser handles any text content

## Expected Output

- ~75 JSON files in `knowledge-docs/education/wassce/`
- ~2,000-4,000 new exam questions in D1 (varies by MCQ availability)
- 15 new entries in `scripts/documents.json`

## Not in Scope

- BECE papers (electives are SHS-only)
- Vectorize embedding (separate pipeline, triggered after ingest)
- WAEC syllabus documents for electives (future work)
- Theory/essay question parsing (MCQ only)
