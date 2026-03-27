# eClassroom Phase 3 — RAG & Curriculum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable admin upload of syllabi/past papers/textbooks to R2, auto-chunk+embed into Vectorize, and let students ask curriculum-grounded questions with cited sources during lessons.

**Architecture:** Reuses existing AskOzzy RAG pipeline (chunker.ts, ingest.ts, retrieve.ts, citation-parser.ts, agent-prompts.ts). Adds 3 new backend routes and a frontend "Ask Teacher" panel. Documents uploaded to R2 at `eclassroom/{subject}/{filename}`, chunked with exam-aware metadata, embedded into the shared `askozzy-knowledge` Vectorize index with `agent_tags: ['eclassroom', subject, level]`.

**Tech Stack:** Existing chunker/ingest/retrieve modules, Cloudflare R2/Vectorize/Workers AI, Hono routes

---

## File Structure

### Backend
- **Modify:** `src/routes/eclassroom.ts` — Add 3 routes: upload, list documents, RAG query
- **No new files needed** — All RAG logic reuses existing `src/lib/` modules

### Frontend
- **Create:** `eclassroom/src/components/lesson/AskTeacher.tsx` — Q&A panel with cited responses
- **Modify:** `eclassroom/src/components/lesson/LessonView.tsx` — Add "Ask Teacher" toggle
- **Modify:** `eclassroom/src/services/api.ts` — Add RAG query + upload methods

---

## Task 1: Backend RAG Routes

**Files:**
- Modify: `src/routes/eclassroom.ts`

- [ ] **Step 1: Read existing RAG modules to understand their APIs**

Read these files to understand exact function signatures:
- `src/lib/autorag-retriever.ts` — `uploadDocumentToR2`, `listR2Documents`, `deleteR2Document`
- `src/lib/chunker.ts` — `chunkLegalDocument`, `chunkExamQuestion`
- `src/lib/ingest.ts` — `ingestChunks`
- `src/lib/retrieve.ts` — `retrieveContext`
- `src/lib/hybrid-retriever.ts` — `hybridRetrieve`
- `src/config/agent-prompts.ts` — `buildContextBlock`, `buildGroundedSystemPrompt`
- `src/lib/citation-parser.ts` — `parseCitations`

- [ ] **Step 2: Add document upload route**

Add to `src/routes/eclassroom.ts`:

```ts
// POST /api/eclassroom/rag/upload — Admin uploads syllabus/paper/textbook
eclassroom.post("/api/eclassroom/rag/upload", authMiddleware, async (c) => {
  // 1. Parse multipart form: file, subject, level, doc_type (syllabus|past_paper|textbook|marking_scheme)
  // 2. Validate file type (PDF, DOCX, TXT) and size (<10MB)
  // 3. Upload to R2 at key: eclassroom/{subject}/{level}/{filename}
  // 4. Chunk the document using chunkLegalDocument (for syllabi) or chunkExamQuestion (for past papers)
  //    - Set metadata: agent_tags=['eclassroom', subject, level], document=filename, chunk_type=doc_type
  // 5. Ingest chunks into Vectorize via ingestChunks()
  // 6. Return { ok: true, chunks: N, r2Key }
});
```

- [ ] **Step 3: Add document list route**

```ts
// GET /api/eclassroom/rag/documents — List uploaded curriculum documents
eclassroom.get("/api/eclassroom/rag/documents", async (c) => {
  // Call listR2Documents(c.env, 'eclassroom/')
  // Return { documents: [...] }
});
```

- [ ] **Step 4: Add RAG query route**

```ts
// POST /api/eclassroom/rag/query — Student asks a curriculum question
eclassroom.post("/api/eclassroom/rag/query", async (c) => {
  const { question, subject, level, teacher_id } = await c.req.json();

  // 1. Retrieve context via hybridRetrieve(question, 'eclassroom', c.env)
  //    OR retrieveContext(question, 'eclassroom', c.env) for Vectorize-only
  // 2. Build context block via buildContextBlock(contexts)
  // 3. Get teacher personality prompt from D1
  // 4. Build grounded system prompt via buildGroundedSystemPrompt(
  //      teacher.name, teacher.personality_prompt, subject, contextBlock
  //    )
  // 5. Generate response via c.env.AI.run() with the grounded prompt
  // 6. Parse citations via parseCitations(response, contexts)
  // 7. Return { answer, citations, confidence }
});
```

- [ ] **Step 5: Verify backend compiles**
```bash
npx tsc --noEmit
```

---

## Task 2: Frontend API Methods

**Files:**
- Modify: `eclassroom/src/services/api.ts`

- [ ] **Step 1: Add RAG methods to the API client**

Add to `eclassroom/src/services/api.ts`:
```ts
askTeacher: (data: { question: string; subject: string; level: string; teacher_id: string }) =>
  request<{ answer: string; citations: Array<{ source: string; relevance_score: number }>; confidence: string }>(
    '/api/eclassroom/rag/query',
    { method: 'POST', body: JSON.stringify(data) }
  ),

uploadDocument: (formData: FormData) =>
  fetch(`${API_BASE}/api/eclassroom/rag/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionStorage.getItem('ec_token') ?? ''}` },
    body: formData,
  }).then(r => r.json()),

listDocuments: () =>
  request<{ documents: Array<{ key: string; size: number; uploaded: string }> }>(
    '/api/eclassroom/rag/documents'
  ),
```

---

## Task 3: AskTeacher Component

**Files:**
- Create: `eclassroom/src/components/lesson/AskTeacher.tsx`
- Modify: `eclassroom/src/components/lesson/LessonView.tsx`

- [ ] **Step 1: Create the AskTeacher panel**

`eclassroom/src/components/lesson/AskTeacher.tsx`:

A slide-out panel (or bottom sheet on mobile) where students type a question about the current lesson topic. Features:
- Text input with "Ask {teacher name}" placeholder
- Submit button (disabled when empty or loading)
- Response area showing the teacher's grounded answer
- Citation badges: clickable source references with relevance scores
- Confidence indicator (high=green, medium=yellow, low=red)
- "I don't have verified information" fallback when no context found
- Loading skeleton while waiting for response

Props: `teacher_id`, `teacherName`, `subject`, `level`, `onClose`

- [ ] **Step 2: Add toggle to LessonView**

Add a "Ask Teacher" floating button (bottom-right corner) to LessonView that opens/closes the AskTeacher panel. When open, the panel overlays the right portion of the whiteboard area.

- [ ] **Step 3: Verify build**
```bash
cd eclassroom && npm run build
```

---

## Self-Review

**Spec coverage:** PRD 5.3 requires upload pipeline, chunking, embedding, RAG query, citations. All covered by reusing existing modules + 3 new routes + 1 new component.

**What's intentionally deferred:** Admin content management UI (full dashboard) — keep it simple with API-only upload for now. Cloudflare Queues for async processing — sync processing is fine for <10MB files in Phase 3.
