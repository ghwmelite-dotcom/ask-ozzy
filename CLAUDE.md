# AskOzzy — Claude Code Context

## Architecture
14-agent AI platform on Cloudflare Workers + D1 + Vectorize + Workers AI.
Anti-hallucination system applied via 12 skills in `~/.claude/skills/askozzy/`.

## Critical rules for any future AI work on this codebase
1. NEVER write an `env.AI.run()` call that bypasses the grounding pipeline
2. NEVER hardcode temperature — always use `getParams()` from `src/config/inference-params.ts`
3. NEVER let raw model output reach the user — always validate/parse structured responses
4. ALL agent system prompts must include the GROUNDING RULES block
5. Knowledge base is in Vectorize + D1 — populate before agents can answer reliably
6. Every response must include a `request_id` for feedback tracking
7. Known errors are checked BEFORE RAG retrieval in the chat pipeline

## New Module Structure

```
src/
├── config/
│   ├── agent-prompts.ts      — Grounding rules, uncertainty protocol, context block builder
│   ├── authorities.ts         — Agent → official authority reference map
│   ├── inference-params.ts    — Per-agent temperature/top_p/top_k/max_tokens
│   └── translation-resources.ts — Language tiers, risk classification, disclaimers
├── lib/
│   ├── chunker.ts             — Legal document + exam question chunking
│   ├── ingest.ts              — Vectorize embedding + upsert pipeline
│   ├── retrieve.ts            — Vectorize query with metadata filtering (0.75 threshold)
│   ├── generator.ts           — Llama 3.1 8B grounded response generation
│   ├── verifier.ts            — Llama 3.1 70B fact-checking (for procurement/legal/finance)
│   ├── adjudicator.ts         — PASS/PARTIAL/FAIL response adjudication
│   ├── confidence.ts          — Weighted confidence scoring algorithm
│   ├── response-parser.ts     — JSON response parsing with safe fallbacks
│   ├── channel-formatter.ts   — Web/WhatsApp/USSD output formatting
│   ├── citation-parser.ts     — [SOURCE_N] extraction + uncited claim detection
│   ├── known-errors.ts        — Query hash checking against known hallucinations
│   ├── feedback.ts            — Feedback storage + KB gap tracking
│   └── session-tracker.ts     — Student adaptive session scoring (KV-backed)
├── types/
│   ├── agent-response.ts      — AskOzzyResponse, Citation, ConfidenceBreakdown
│   └── student-profile.ts     — StudentLevel, ConfidenceLevel, StudentProfile
└── index.ts                   — Main app (Hono routes, chat pipeline)
```

## Anti-Hallucination Skills Reference

| Skill | File | Trigger keywords |
|---|---|---|
| **Master Index** | `00-master-suite.md` | Architecture review, "where do I start" |
| **Vectorize KB** | `01-vectorize-kb.md` | Knowledge base, document ingestion, embeddings |
| **RAG Citations** | `02-rag-citations.md` | Citations, context injection, grounding |
| **Verification Layer** | `03-verification-layer.md` | Fact-checking, 8B→70B pipeline |
| **Structured JSON** | `04-structured-json.md` | Response schemas, confidence scoring |
| **Temperature Params** | `05-temperature-params.md` | Inference config, sampling params |
| **System Prompts** | `06-system-prompts.md` | Agent prompts, uncertainty protocol |
| **AI Gateway** | `07-ai-gateway.md` | Caching, rate limiting, monitoring |
| **Tool Use** | `08-tool-use.md` | Calculators, statute lookup |
| **Feedback Loop** | `09-feedback-loop.md` | Thumbs up/down, report incorrect |
| **AutoRAG** | `10-autorag.md` | Bulk document ingestion |
| **Adaptive Difficulty** | `11-adaptive-difficulty.md` | Student levels, scaffolding |
| **Translation Verification** | `12-translation-verification.md` | Back-translation, disclaimers |

### Key Principles (always enforce)
1. **No claim without a source** — If not in `[CONTEXT_BLOCK]`, the agent doesn't know it
2. **Fail safe, not silent** — When unsure, say so and redirect to an authority
3. **Confidence is transparent** — Users always see the confidence level
4. **Tools for computation** — Calculate with a calculator, not model reasoning
5. **Teach, don't just tell** — Student agents scaffold and adapt
6. **Translations carry warnings** — Ghanaian language AI is draft-quality
7. **Feedback closes the loop** — Every wrong answer is a KB gap to fill

## Implementation Status
- Phase 1 (System Prompts): [x] Complete — All 14 agents + base prompts have grounding rules, uncertainty protocol, prohibited behaviors
- Phase 2 (Inference Params): [x] Complete — Centralized config, chat endpoint uses getParams()
- Phase 3 (Vectorize KB): [x] Complete — chunker, ingest, retrieve modules + schema migration + knowledge-docs structure
- Phase 4 (Structured JSON): [x] Complete — AskOzzyResponse types, confidence scoring, response parser, channel formatter, citation parser
- Phase 5 (RAG Citations): [x] Complete — Context block builder with [SOURCE_N] format, buildAugmentedPrompt updated
- Phase 6 (Verification Layer): [x] Complete — Generator, verifier (70B), adjudicator modules with hallucination logging
- Phase 7 (AutoRAG): [ ] Pending — R2 bucket + AutoRAG index creation needed (Cloudflare dashboard)
- Phase 8 (AI Gateway): [ ] Pending — Gateway config + ai-client wrapper
- Phase 9 (Tool Use): [ ] Pending — Calculator, statute lookup, function calling
- Phase 10 (Feedback Loop): [x] Complete — /api/feedback endpoint, known-errors check, KB gap tracking, request_id SSE event
- Phase 11 (Adaptive Difficulty): [x] Complete — StudentProfile types, session tracker with KV persistence
- Phase 12 (Translation Verification): [x] Complete — Risk classification, language tiers, certified resources

## Database Migrations
- `schema-anti-hallucination.sql` — New tables: knowledge_documents, hallucination_events, response_feedback, kb_gaps, known_errors, gateway_metrics
- Run: `npx wrangler d1 execute ghana-civil-ai-db --remote --file=schema-anti-hallucination.sql`
