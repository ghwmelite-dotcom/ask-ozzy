# AI Features

## AI Models

AskOzzy offers 10 AI models via Cloudflare Workers AI:

| # | Model ID | Display Name | Parameters | Context | Tier | Recommended | Best For |
|---|----------|-------------|------------|---------|------|-------------|----------|
| 1 | @cf/openai/gpt-oss-120b | GPT-OSS 120B (OpenAI) | 120B | 131K | Professional | Yes | Top-tier reasoning, agentic tasks |
| 2 | @cf/meta/llama-4-scout-17b-16e-instruct | Llama 4 Scout 17B (Meta) | 17B (16 experts) | 131K | Professional | Yes | Complex drafting, multimodal |
| 3 | @cf/meta/llama-3.3-70b-instruct-fp8-fast | Llama 3.3 70B (Meta) | 70B | 131K | Professional | No | Deep reasoning, long documents |
| 4 | @cf/qwen/qwq-32b | QwQ 32B (Qwen) | 32B | 131K | Professional | No | Step-by-step problem solving |
| 5 | @cf/qwen/qwen3-30b-a3b-fp8 | Qwen3 30B (Qwen) | 30B | 131K | Professional | No | Multilingual, agent capabilities |
| 6 | @cf/openai/gpt-oss-20b | GPT-OSS 20B (OpenAI) | 20B | 131K | Free | No | Fast reasoning (free tier) |
| 7 | @cf/mistralai/mistral-small-3.1-24b-instruct | Mistral Small 3.1 24B | 24B | 128K | Professional | No | Long docs, vision, multilingual |
| 8 | @cf/google/gemma-3-12b-it | Gemma 3 12B (Google) | 12B | 128K | Free | No | 140+ languages, summarization |
| 9 | @cf/ibm-granite/granite-4.0-h-micro | Granite 4.0 Micro (IBM) | Micro | 131K | Professional | No | Structured enterprise tasks |
| 10 | @cf/meta/llama-3.1-8b-instruct-fast | Llama 3.1 8B Fast (Meta) | 8B | 8K | Free | No | Instant responses, simple tasks |

Free tier users get models #6, #8, #10. Professional/Enterprise get all 10.

## SSE Streaming Implementation

Chat responses use Server-Sent Events (SSE) for real-time token streaming:

```
Client                         Server (Worker)                Workers AI
  |                                |                              |
  |-- POST /api/chat ------------->|                              |
  |                                |-- stream: true ------------->|
  |                                |                              |
  |<-- Content-Type: text/event-stream                            |
  |                                |<-- token: "The" ------------|
  |<-- data: {"token":"The"}       |                              |
  |                                |<-- token: " answer" --------|
  |<-- data: {"token":" answer"}   |                              |
  |         ...                    |         ...                  |
  |                                |<-- [stream end] ------------|
  |<-- data: [DONE]               |                              |
  |                                |                              |
```

1. Client sends POST /api/chat with message
2. Server responds with `Content-Type: text/event-stream`
3. Workers AI `stream: true` option enables token-by-token output
4. Each SSE chunk: `data: {"token": "word"}\n\n`
5. Final chunk: `data: [DONE]\n\n`
6. Client uses EventSource or fetch + ReadableStream to consume
7. Tokens are rendered incrementally in the chat UI with markdown parsing

## RAG Pipeline (Retrieval-Augmented Generation)

### Document Processing (Upload)

```
+------------------+     +------------------+     +------------------+
|   Document       |     |   Text           |     |   Chunking       |
|   Upload         |---->|   Extraction     |---->|   (500 char,     |
|   (.pdf, .docx,  |     |   (parse/scrape) |     |    50 overlap)   |
|    .txt, URL)    |     |                  |     |                  |
+------------------+     +------------------+     +------------------+
                                                         |
                                                         v
+------------------+     +------------------+     +------------------+
|   Storage        |     |   Vectorize      |     |   Embedding      |
|   - Vectors -->  |<----|   Index:         |<----|   bge-base-en-   |
|     Vectorize    |     |   askozzy-       |     |   v1.5 (768d)    |
|   - Chunks -->   |     |   knowledge      |     |   batches of 5   |
|     D1 table     |     |                  |     |                  |
|   - Metadata --> |     +------------------+     +------------------+
|     D1 documents |
+------------------+
```

1. **Text Extraction**: Raw text from uploaded content, or scrape URL
2. **Chunking**: Split into 500-character chunks with 50-character overlap
3. **Embedding**: bge-base-en-v1.5 model (768 dimensions), batches of 5
4. **Storage**:
   - Vectors stored in Cloudflare Vectorize (index: askozzy-knowledge)
   - Chunks stored in D1 `document_chunks` table
   - Metadata stored in D1 `documents` table (content truncated to 1000 chars in Vectorize metadata)

### Query Pipeline

```
+-------------+     +-------------+     +----------------+     +-------------+     +-------------+
|  User       |     |  Embed      |     |  Vectorize     |     |  Augment    |     |  AI         |
|  Query      |---->|  Query      |---->|  Search        |---->|  Prompt     |---->|  Response   |
|             |     |  (bge-base) |     |  (top-K cosine)|     |  (inject    |     |  (grounded  |
|             |     |             |     |                |     |   chunks)   |     |   in KB)    |
+-------------+     +-------------+     +----------------+     +-------------+     +-------------+
```

1. **Embed query**: Same bge-base-en-v1.5 model
2. **Similarity search**: Vectorize returns top-K matching chunks (cosine similarity)
3. **Prompt augmentation**: Matching chunks injected into system prompt as context
4. **AI generates**: Response grounded in retrieved knowledge

## Deep Research Mode

5-step AI research pipeline:

| Step | Name | Description |
|------|------|-------------|
| 1 | Query Analysis | AI breaks down the research question into sub-queries |
| 2 | Web Search | DuckDuckGo search for each sub-query |
| 3 | Source Analysis | AI analyzes and evaluates search results |
| 4 | Synthesis | AI combines findings into coherent analysis |
| 5 | Report Generation | Final structured report with citations |

```
+-----------------+     +-----------------+     +-----------------+
|  1. Query       |     |  2. Web Search  |     |  3. Source      |
|  Analysis       |---->|  (DuckDuckGo    |---->|  Analysis       |
|  (break into    |     |   per sub-query)|     |  (evaluate      |
|   sub-queries)  |     |                 |     |   results)      |
+-----------------+     +-----------------+     +-----------------+
                                                       |
                                                       v
                        +-----------------+     +-----------------+
                        |  5. Report      |     |  4. Synthesis   |
                        |  Generation     |<----|  (combine       |
                        |  (citations,    |     |   findings)     |
                        |   structure)    |     |                 |
                        +-----------------+     +-----------------+
```

- Stored in `research_reports` table
- Status tracking: running --> completed/failed
- Progress visible to user in real-time via polling
- Results include: report text, sources array, step progress

## Data Analysis

- User uploads CSV or Excel data
- Data parsed and summarized by AI
- Chart generation via Chart.js (lazy-loaded)
- Chart types: bar, line, pie, doughnut, scatter
- AI provides insights, trends, recommendations
- API: POST /api/analyze

```
+----------+     +----------+     +----------+     +----------+
|  Upload  |     |  Parse   |     |  AI      |     |  Chart   |
|  CSV /   |---->|  Data    |---->|  Analyze |---->|  Render  |
|  Excel   |     |  Summary |     |  Insights|     |  Chart.js|
+----------+     +----------+     +----------+     +----------+
```

## Vision AI

4 vision modes available:

| Mode | Description | Use Case |
|------|-------------|----------|
| describe | General image description | Understanding image content |
| ocr | Optical character recognition | Extracting text from images |
| form | Form field extraction | Processing government forms |
| receipt | Receipt data extraction | Expense processing |

- Uses multimodal models (Llama 4 Scout, Mistral Small)
- Image sent as base64 in request body
- Camera capture supported on mobile

```
+----------+     +----------+     +------------------+     +----------+
|  Image   |     |  Base64  |     |  Multimodal AI   |     |  Result  |
|  Upload  |---->|  Encode  |---->|  (Llama 4 Scout  |---->|  Text /  |
|  or      |     |          |     |   or Mistral     |     |  Fields  |
|  Camera  |     |          |     |   Small)         |     |          |
+----------+     +----------+     +------------------+     +----------+
```

## Custom AI Agents

25 pre-seeded agents covering GoG departments:

| Category | Agents |
|----------|--------|
| Core Operations | Legal Advisor, HR Manager, Procurement Officer, Budget Analyst, IT Support |
| Communications | Communications, Policy Analyst, Research Assistant, Project Manager |
| Compliance | Audit Specialist, Environmental Officer, Records Manager |
| Sector-Specific | Health Policy, Education Planner, Agriculture Expert, Trade & Industry |
| Specialized | Gender Specialist, Youth Development, Digital Transformation |
| Governance | Parliamentary Affairs, Foreign Affairs, Local Government, Security Advisor |
| Analytics | Statistical Analyst, Training Coordinator |

Each agent has:
- **name**: Display name
- **description**: What the agent does
- **system_prompt**: Specialized instructions for the AI
- **department**: Associated GoG department
- **icon**: Visual identifier
- **knowledge_category**: RAG filter category

Admin can create, edit, delete, and toggle active/inactive.

## AI Memory System

Two types of memory:

| Type | Source | Example |
|------|--------|---------|
| Manual | User creates key-value pairs | "department" --> "Ministry of Finance" |
| Auto-extracted | AI detects preferences/facts from conversation | "prefers formal tone" |

```
+------------------+     +------------------+     +------------------+
|  Conversation    |     |  Memory          |     |  System Prompt   |
|  Messages        |---->|  Extraction      |---->|  Injection       |
|                  |     |  (manual or      |     |  (personalized   |
|                  |     |   auto-detect)   |     |   responses)     |
+------------------+     +------------------+     +------------------+
```

- Memory types: preference, fact, auto
- Stored in `user_memories` table with UNIQUE(user_id, key)
- Memories are injected into the system prompt for every chat, personalizing responses

## Artifact Detection & Canvas

AI responses are scanned for artifacts:

| Artifact Type | Detection Method |
|---------------|-----------------|
| Code blocks | Fenced code blocks with language tag |
| Tables | Markdown table syntax |
| Documents | Structured document patterns |
| Charts | Data visualization patterns |

Detected artifacts open in a side panel (canvas) for better viewing, copying, and downloading.

API: POST /api/chat/detect-artifact

## Web Search Integration

- Search engine: DuckDuckGo HTML search
- API: POST /api/web-search
- Results parsed and returned as structured data
- Used in deep research mode and can be triggered manually from chat

## Translation

- Model: m2m100 (via Workers AI)
- API: POST /api/translate
- Body: `{text, targetLang}`
- Supports 100+ languages

## Transcription

- Model: Whisper (via Workers AI)
- Used in meeting assistant for audio-to-text
- Supports multiple audio formats
