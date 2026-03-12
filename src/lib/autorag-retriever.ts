// AutoRAG retriever — queries Cloudflare AI Search for R2-ingested documents
import type { Env } from '../types';
import type { RetrievedContext } from '../config/agent-prompts';

const AGENT_TYPE_PREFIX: Record<string, string> = {
  procurement: 'legal/procurement/',
  legal: 'legal/',
  wassce: 'education/wassce/',
  bece: 'education/bece/',
  finance: 'legal/financial/',
  hr: 'legal/civil-service/',
  governance: 'policy/',
  it: 'it/',
  research: 'research/',
  citizen: 'policy/',
};

export async function queryAutoRag(
  query: string,
  agentType: string,
  env: Env
): Promise<RetrievedContext[]> {
  try {
    const autorag = (env.AI as any).autorag?.('askozzy-knowledge');
    if (!autorag) {
      // AutoRAG not configured — return empty (fallback to Vectorize)
      return [];
    }

    const searchOpts: Record<string, unknown> = { query };
    const prefix = AGENT_TYPE_PREFIX[agentType];
    if (prefix) {
      searchOpts.filters = { filepath_prefix: prefix };
    }

    const results = await autorag.aiSearch(searchOpts);

    if (!results?.results) return [];

    return results.results
      .filter((r: any) => r.score > 0.7)
      .map((r: any) => ({
        id: r.id || crypto.randomUUID(),
        text: r.content || r.text || '',
        score: r.score,
        source: r.filename || r.metadata?.filename || 'Ghana Knowledge Base',
      }));
  } catch (e) {
    console.error('AutoRAG query failed:', e);
    return [];
  }
}

// Upload a document to R2 for AutoRAG automatic indexing
export async function uploadDocumentToR2(
  file: ArrayBuffer,
  filename: string,
  category: string,
  subcategory: string,
  env: Env
): Promise<{ key: string; size: number }> {
  const r2Key = `${category}/${subcategory}/${filename}`;
  const obj = await env.KNOWLEDGE_R2.put(r2Key, file, {
    httpMetadata: { contentType: guessMimeType(filename) },
    customMetadata: {
      uploaded_at: new Date().toISOString(),
      category,
      subcategory,
    },
  });
  return { key: r2Key, size: obj?.size ?? file.byteLength };
}

// List documents in R2 bucket
export async function listR2Documents(
  env: Env,
  prefix?: string
): Promise<{ key: string; size: number; uploaded: string }[]> {
  const listed = await env.KNOWLEDGE_R2.list({ prefix, limit: 100 });
  return listed.objects.map((obj) => ({
    key: obj.key,
    size: obj.size,
    uploaded: obj.uploaded.toISOString(),
  }));
}

// Delete a document from R2
export async function deleteR2Document(
  env: Env,
  key: string
): Promise<void> {
  await env.KNOWLEDGE_R2.delete(key);
}

function guessMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    pdf: 'application/pdf',
    html: 'text/html',
    htm: 'text/html',
    txt: 'text/plain',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return mimeMap[ext || ''] || 'application/octet-stream';
}
