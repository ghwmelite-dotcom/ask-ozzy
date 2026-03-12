import type { Env } from '../types';
import type { GeneratedResponse } from './generator';
import type { VerificationReport } from './verifier';

export interface FinalResponse {
  text: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  verified: boolean;
  flagged: boolean;
}

export async function adjudicate(
  generated: GeneratedResponse,
  verification: VerificationReport,
  env: Env,
  requestId: string,
  agentType: string,
  query: string
): Promise<FinalResponse> {
  if (verification.overall === 'PASS') {
    return {
      text: generated.text,
      confidence: 'high',
      verified: true,
      flagged: false
    };
  }

  if (verification.overall === 'FAIL') {
    // Log hallucination event
    try {
      await env.DB.prepare(`
        INSERT INTO hallucination_events
        (request_id, agent_type, query, generated_response, verification_report,
         contradicted_claims, flagged_by, created_at, reviewed)
        VALUES (?, ?, ?, ?, ?, ?, 'verifier', datetime('now'), 0)
      `).bind(
        requestId,
        agentType,
        query.slice(0, 500),
        generated.text.slice(0, 2000),
        JSON.stringify(verification),
        JSON.stringify(verification.contradicted_claims)
      ).run();
    } catch (e) {
      console.error('Failed to log hallucination event:', e);
    }

    return {
      text: buildUncertaintyResponse(verification.contradicted_claims),
      confidence: 'low',
      verified: false,
      flagged: true
    };
  }

  // PARTIAL: hedge unsupported claims
  const hedgedText = generated.text +
    '\n\n_Note: Some aspects of this answer could not be fully verified from current sources. Please cross-reference with official documents._';

  return {
    text: hedgedText,
    confidence: 'medium',
    verified: false,
    flagged: false
  };
}

function buildUncertaintyResponse(contradictedClaims: string[]): string {
  if (contradictedClaims.length === 0) {
    return 'I\'ve detected potential inaccuracies in generating this response and cannot provide a verified answer. Please consult the official document or relevant authority directly.';
  }
  return `I've detected potential inaccuracies in generating this response and cannot provide a verified answer. The following points conflicted with my verified sources:\n\n${contradictedClaims.map(c => `• ${c}`).join('\n')}\n\nPlease consult the official document or relevant authority directly.`;
}
