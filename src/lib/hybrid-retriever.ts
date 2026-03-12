// Hybrid retriever — merges AutoRAG (R2) + manual Vectorize results
import type { Env } from '../types';
import type { RetrievedContext } from '../config/agent-prompts';
import { queryAutoRag } from './autorag-retriever';
import { retrieveContext } from './retrieve';

export async function hybridRetrieve(
  query: string,
  agentType: string,
  env: Env
): Promise<RetrievedContext[]> {
  // Run both retrievals in parallel — either can fail gracefully
  const [autoragResults, vectorizeResults] = await Promise.all([
    queryAutoRag(query, agentType, env).catch(() => []),
    retrieveContext(query, agentType, env).catch(() => []),
  ]);

  // Merge, deduplicate by source label, sort by score
  const combined = [...autoragResults, ...vectorizeResults];
  const seen = new Set<string>();

  return combined
    .filter((r) => {
      // Deduplicate by source name (same document shouldn't appear twice)
      const key = r.source.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return r.score > 0.7;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6); // Top 6 chunks
}
