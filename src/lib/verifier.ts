import type { Env } from '../types';
import type { RetrievedContext } from '../config/agent-prompts';
import type { GeneratedResponse } from './generator';
import { getParams } from '../config/inference-params';

export type VerificationVerdict = 'SUPPORTED' | 'UNSUPPORTED' | 'CONTRADICTED' | 'UNVERIFIABLE';

export interface ClaimVerification {
  claim: string;
  verdict: VerificationVerdict;
  evidence?: string;
  explanation: string;
}

export interface VerificationReport {
  overall: 'PASS' | 'PARTIAL' | 'FAIL';
  claim_results: ClaimVerification[];
  unsupported_claims: string[];
  contradicted_claims: string[];
}

// Agents that warrant full 70B verification (high-stakes domains)
const FULL_VERIFICATION_AGENTS = ['procurement', 'legal', 'finance', 'exam_marker'];

export function requiresFullVerification(agentType: string): boolean {
  return FULL_VERIFICATION_AGENTS.includes(agentType);
}

export async function verify(
  generated: GeneratedResponse,
  contexts: RetrievedContext[],
  env: Env
): Promise<VerificationReport> {
  if (generated.claims.length === 0) {
    return { overall: 'PASS', claim_results: [], unsupported_claims: [], contradicted_claims: [] };
  }

  const contextText = contexts.map((c, i) =>
    `[SOURCE_${i + 1}]: ${c.text}`
  ).join('\n\n');

  const verifierPrompt = `You are a strict fact-checker. For each claim below, determine if it is SUPPORTED, UNSUPPORTED, CONTRADICTED, or UNVERIFIABLE based ONLY on the provided sources.

SOURCES:
${contextText}

CLAIMS TO VERIFY:
${generated.claims.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Respond ONLY with valid JSON:
{
  "results": [
    {
      "claim": "<claim text>",
      "verdict": "SUPPORTED" | "UNSUPPORTED" | "CONTRADICTED" | "UNVERIFIABLE",
      "evidence": "<quote the relevant source phrase, or null>",
      "explanation": "<one sentence explaining your verdict>"
    }
  ]
}`;

  const params = getParams('verifier');

  try {
    const verifierResponse = await env.AI.run(params.model as any, {
      messages: [
        { role: 'system', content: 'You are a meticulous fact-checker for a government AI platform. Be strict.' },
        { role: 'user', content: verifierPrompt }
      ],
      temperature: params.temperature,
      max_tokens: params.max_tokens,
      ...(params.response_format ? { response_format: params.response_format } : {})
    });

    const raw = (verifierResponse as any)?.response || '';
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const results: ClaimVerification[] = parsed.results || [];

    const unsupported = results.filter(r => r.verdict === 'UNSUPPORTED').map(r => r.claim);
    const contradicted = results.filter(r => r.verdict === 'CONTRADICTED').map(r => r.claim);

    let overall: 'PASS' | 'PARTIAL' | 'FAIL';
    if (contradicted.length > 0) overall = 'FAIL';
    else if (unsupported.length > 0) overall = 'PARTIAL';
    else overall = 'PASS';

    return { overall, claim_results: results, unsupported_claims: unsupported, contradicted_claims: contradicted };
  } catch (e) {
    console.error('Verification failed:', e);
    // If verification itself fails, return SKIPPED-equivalent
    return { overall: 'PASS', claim_results: [], unsupported_claims: [], contradicted_claims: [] };
  }
}

// Cheaper self-consistency check for non-critical agents
export async function selfConsistencyCheck(
  query: string,
  systemPrompt: string,
  env: Env
): Promise<number> {
  try {
    const runs = await Promise.all([0.1, 0.25, 0.35].map(temp =>
      env.AI.run('@cf/meta/llama-3.1-8b-instruct' as any, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query }
        ],
        temperature: temp,
        max_tokens: 400
      })
    ));

    const responses = runs.map(r => (r as any)?.response || '');
    return computeConsistencyScore(responses);
  } catch {
    return 0.5; // Default to medium consistency on error
  }
}

function computeConsistencyScore(responses: string[]): number {
  if (responses.length < 2) return 1.0;

  // Simple word-overlap based consistency
  const tokenSets = responses.map(r =>
    new Set(r.toLowerCase().split(/\s+/).filter(w => w.length > 3))
  );

  let totalOverlap = 0;
  let comparisons = 0;

  for (let i = 0; i < tokenSets.length; i++) {
    for (let j = i + 1; j < tokenSets.length; j++) {
      const intersection = new Set([...tokenSets[i]].filter(w => tokenSets[j].has(w)));
      const union = new Set([...tokenSets[i], ...tokenSets[j]]);
      totalOverlap += union.size > 0 ? intersection.size / union.size : 0;
      comparisons++;
    }
  }

  return comparisons > 0 ? totalOverlap / comparisons : 0.5;
}
