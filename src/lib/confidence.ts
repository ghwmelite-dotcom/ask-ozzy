import type { ConfidenceBreakdown } from '../types/agent-response';

export function computeConfidence(
  retrievalScores: number[],
  verificationVerdict: 'PASS' | 'PARTIAL' | 'FAIL' | 'SKIPPED',
  selfConsistency: number
): ConfidenceBreakdown {
  const avgRetrieval = retrievalScores.length > 0
    ? retrievalScores.reduce((a, b) => a + b, 0) / retrievalScores.length
    : 0;

  const verificationScore: Record<string, number> = {
    PASS: 1.0, PARTIAL: 0.5, FAIL: 0.0, SKIPPED: 0.6
  };

  const compositeScore = (avgRetrieval * 0.4) + ((verificationScore[verificationVerdict] ?? 0.6) * 0.4) + (selfConsistency * 0.2);

  let final_confidence: 'high' | 'medium' | 'low' | 'none';
  if (avgRetrieval === 0) final_confidence = 'none';
  else if (compositeScore >= 0.75 && verificationVerdict !== 'FAIL') final_confidence = 'high';
  else if (compositeScore >= 0.5) final_confidence = 'medium';
  else final_confidence = 'low';

  return {
    retrieval_score: avgRetrieval,
    verification_verdict: verificationVerdict,
    self_consistency_score: selfConsistency,
    final_confidence
  };
}
