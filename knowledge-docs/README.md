# AskOzzy Knowledge Base — Source Documents

## IMPORTANT: Do NOT use AI-generated or unverified documents

Each document must be sourced from official Ghana government publications.

## Required Documents

### Legal / Regulatory
| Document | Source | Status |
|---|---|---|
| Public Procurement Act 663 (2003) | Ghana Legal Portal / PPRA | PLACEHOLDER |
| Act 914 Amendment (2016) | Ghana Legal Portal / PPRA | PLACEHOLDER |
| 1992 Constitution of Ghana | Parliament of Ghana website | PLACEHOLDER |
| Civil Service Act (PNDCL 327) | OHCS official docs | PLACEHOLDER |
| Data Protection Act 843 (2012) | Data Protection Commission | PLACEHOLDER |
| Financial Administration Act 654 | Ministry of Finance | PLACEHOLDER |
| Public Financial Management Act 921 | Ministry of Finance | PLACEHOLDER |

### Education
| Document | Source | Status |
|---|---|---|
| WASSCE Past Papers (last 5 years) | WAEC Ghana official | PLACEHOLDER |
| WASSCE Marking Schemes | WAEC Ghana official | PLACEHOLDER |
| BECE Past Papers | WAEC Ghana official | PLACEHOLDER |

## Directory Structure

```
knowledge-docs/
├── legal/
│   ├── act-663-procurement.txt
│   ├── act-914-amendment.txt
│   ├── constitution-1992.txt
│   ├── civil-service-act-pndcl-327.txt
│   ├── data-protection-act-843.txt
│   └── financial-admin-act-654.txt
└── education/
    ├── wassce/
    └── bece/
```

## How to Add Documents

1. Acquire the verified official document
2. Convert to plain text (if PDF, run OCR if needed)
3. Place in the appropriate directory above
4. Run the ingest script: `npx wrangler d1 execute ...` (TODO)
5. Verify ingestion with a spot-check query
