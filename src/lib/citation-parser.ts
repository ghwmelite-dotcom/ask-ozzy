import type { RetrievedContext } from '../config/agent-prompts';

export interface CitedResponse {
  text: string;
  citations: Array<{
    index: number;
    source: string;
    chunk_id: string;
    relevance_score: number;
  }>;
  has_uncited_claims: boolean;
}

export function parseCitations(
  rawResponse: string,
  contexts: RetrievedContext[]
): CitedResponse {
  const citationPattern = /\[SOURCE_(\d+)\]/g;
  const usedIndices = new Set<number>();
  let match;

  while ((match = citationPattern.exec(rawResponse)) !== null) {
    usedIndices.add(parseInt(match[1]) - 1);
  }

  const citations = Array.from(usedIndices)
    .filter(i => i < contexts.length)
    .map(i => ({
      index: i + 1,
      source: contexts[i].source,
      chunk_id: contexts[i].id,
      relevance_score: contexts[i].score
    }));

  // Detect sentences with regulatory keywords that lack [SOURCE_N] citations
  const sentences = rawResponse.split(/[.!?]+/).filter(s => s.trim().length > 20);
  const uncitedFactualSentences = sentences.filter(s =>
    !s.includes('[SOURCE_') &&
    /\b(section|act|article|regulation|must|shall|required|percent|threshold)\b/i.test(s)
  );

  return {
    text: rawResponse,
    citations,
    has_uncited_claims: uncitedFactualSentences.length > 0
  };
}
