// Difficulty-aware retriever — filters Vectorize results by student level metadata
import type { Env } from '../types';
import type { RetrievedContext } from '../config/agent-prompts';
import type { StudentLevel } from '../types/student-profile';

// Map student levels to difficulty ranges for Vectorize metadata filtering
const LEVEL_DIFFICULTY_MAP: Record<StudentLevel, string[]> = {
  jhs1: ['easy', 'basic'],
  jhs2: ['easy', 'basic', 'intermediate'],
  jhs3: ['basic', 'intermediate', 'bece'],
  shs1: ['intermediate', 'shs'],
  shs2: ['intermediate', 'shs', 'wassce'],
  shs3: ['wassce', 'advanced', 'shs'],
  adult_learner: ['advanced', 'wassce', 'university'],
};

export async function retrieveAtLevel(
  query: string,
  agentType: string,
  studentLevel: StudentLevel,
  env: Env,
  topK = 5
): Promise<RetrievedContext[]> {
  const difficulties = LEVEL_DIFFICULTY_MAP[studentLevel] || ['intermediate'];

  try {
    // Embed the query
    const embeddingResult = await env.AI.run('@cf/baai/bge-base-en-v1.5' as any, {
      text: [query],
    });
    const queryVector = (embeddingResult as any).data?.[0];
    if (!queryVector) return [];

    // Query Vectorize with difficulty metadata filter
    const vectorResults = await env.VECTORIZE.query(queryVector, {
      topK,
      returnMetadata: 'all',
      filter: {
        difficulty: { $in: difficulties },
      },
    });

    if (vectorResults.matches && vectorResults.matches.length > 0) {
      return vectorResults.matches
        .filter((m: any) => m.score >= 0.7)
        .map((m: any) => ({
          id: m.id,
          text: m.metadata?.content || m.metadata?.text || '',
          score: m.score,
          source: m.metadata?.source || m.metadata?.title || 'Knowledge Base',
        }));
    }

    // Fallback: if no difficulty-filtered results, try without filter
    const fallbackResults = await env.VECTORIZE.query(queryVector, {
      topK,
      returnMetadata: 'all',
      filter: {
        agent_tags: { $in: [agentType] },
      },
    });

    return (fallbackResults.matches || [])
      .filter((m: any) => m.score >= 0.7)
      .map((m: any) => ({
        id: m.id,
        text: m.metadata?.content || m.metadata?.text || '',
        score: m.score,
        source: m.metadata?.source || m.metadata?.title || 'Knowledge Base',
      }));
  } catch (e) {
    console.error('Difficulty retriever error:', e);
    return [];
  }
}
