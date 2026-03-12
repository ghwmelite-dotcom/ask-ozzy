import type { AskOzzyResponse } from '../types/agent-response';

export function parseAgentResponse(
  raw: string,
  fallbackAnswer: string,
  agentType: string,
  modelUsed: string,
  requestId: string,
  responseTimeMs: number
): AskOzzyResponse {
  try {
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    // Validate required fields
    if (!parsed.answer || typeof parsed.answer !== 'string') throw new Error('Missing answer');
    if (!['high', 'medium', 'low', 'none'].includes(parsed.confidence)) {
      parsed.confidence = 'low';
    }

    return {
      answer: parsed.answer,
      summary: parsed.summary || undefined,
      citations: parsed.citations || [],
      confidence: parsed.confidence,
      confidence_breakdown: {
        retrieval_score: 0,
        verification_verdict: 'SKIPPED',
        self_consistency_score: 0,
        final_confidence: parsed.confidence
      },
      verified: false,
      sources_available: (parsed.citations && parsed.citations.length > 0) || false,
      knowledge_gap: parsed.knowledge_gap || undefined,
      reasoning_steps: parsed.reasoning_steps || undefined,
      agent_type: agentType,
      response_language: 'en',
      caveats: parsed.caveats || undefined,
      suggested_followups: parsed.suggested_followups || undefined,
      request_id: requestId,
      response_time_ms: responseTimeMs,
      model_used: modelUsed,
    };
  } catch (e) {
    console.error('Response parse failed:', e, 'Raw:', raw.slice(0, 200));
    return {
      answer: fallbackAnswer || raw, // Use raw response as-is if JSON parsing fails
      citations: [],
      confidence: 'none',
      confidence_breakdown: {
        retrieval_score: 0,
        verification_verdict: 'SKIPPED',
        self_consistency_score: 0,
        final_confidence: 'none'
      },
      verified: false,
      sources_available: false,
      agent_type: agentType,
      response_language: 'en',
      request_id: requestId,
      response_time_ms: responseTimeMs,
      model_used: modelUsed,
    };
  }
}
