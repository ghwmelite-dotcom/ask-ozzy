import type { Chunk } from './chunker';
import type { Env } from '../types';

export async function ingestChunks(
  chunks: Chunk[],
  env: Env
): Promise<{ success: number; failed: number }> {
  let success = 0, failed = 0;

  // Process in batches of 100 (Vectorize limit)
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);

    try {
      // Generate embeddings
      const embeddings = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
        text: batch.map(c => c.text)
      });

      const embeddingData = (embeddings as any).data as number[][];

      // Upsert to Vectorize
      const vectors = batch.map((chunk, idx) => ({
        id: chunk.id,
        values: embeddingData[idx],
        metadata: {
          ...chunk.metadata,
          content: chunk.text, // Store content in metadata for retrieval
        }
      }));

      await env.VECTORIZE.upsert(vectors);

      // Also store full text in D1 knowledge_documents table
      for (const chunk of batch) {
        try {
          await env.DB.prepare(
            `INSERT OR REPLACE INTO knowledge_documents
             (id, document, section, content, metadata, embedded_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))`
          ).bind(
            chunk.id,
            chunk.metadata.document,
            chunk.metadata.section,
            chunk.text,
            JSON.stringify(chunk.metadata)
          ).run();
        } catch (e) {
          // Individual chunk DB insert failure is non-fatal
          console.error('DB insert failed for chunk:', chunk.id, e);
        }
      }

      success += batch.length;
    } catch (e) {
      console.error('Ingest batch failed:', e);
      failed += batch.length;
    }
  }

  return { success, failed };
}
