import type { Env } from '../types';
import type { RetrievedContext } from '../config/agent-prompts';

const RELEVANCE_THRESHOLD = 0.75;

export async function retrieveContext(
  query: string,
  agentType: string,
  env: Env,
  topK = 5
): Promise<RetrievedContext[]> {
  try {
    // Embed the query
    const queryEmbedding = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [query]
    });

    const embeddingData = (queryEmbedding as any).data as number[][];

    // Query Vectorize with metadata filter scoped to relevant agents
    const results = await env.VECTORIZE.query(embeddingData[0], {
      topK,
      filter: { agent_tags: { $in: [agentType] } },
      returnMetadata: 'all',
      returnValues: false
    });

    // Threshold: only use chunks with score > 0.75
    const relevant = (results.matches || []).filter(m => m.score > RELEVANCE_THRESHOLD);

    if (relevant.length === 0) {
      // Fall back to unfiltered search
      const unfilteredResults = await env.VECTORIZE.query(embeddingData[0], {
        topK,
        returnMetadata: 'all',
        returnValues: false
      });
      const unfilteredRelevant = (unfilteredResults.matches || []).filter(m => m.score > RELEVANCE_THRESHOLD);
      return unfilteredRelevant.map(match => ({
        id: match.id,
        text: (match.metadata as any)?.content ?? '',
        score: match.score,
        source: `${(match.metadata as any)?.document ?? 'Knowledge Base'}, ${(match.metadata as any)?.section ?? ''}`
      }));
    }

    return relevant.map(match => ({
      id: match.id,
      text: (match.metadata as any)?.content ?? '',
      score: match.score,
      source: `${(match.metadata as any)?.document ?? 'Knowledge Base'}, ${(match.metadata as any)?.section ?? ''}`
    }));
  } catch (e) {
    console.error('Vectorize retrieval failed:', e);
    return [];
  }
}
