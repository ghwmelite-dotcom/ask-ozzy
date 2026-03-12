import type { Env } from '../types';
import type { RetrievedContext } from '../config/agent-prompts';
import { buildGroundedSystemPrompt, buildContextBlock } from '../config/agent-prompts';
import { getParams } from '../config/inference-params';

export interface GeneratedResponse {
  text: string;
  claims: string[];
  citations_used: string[];
  raw: string;
}

export async function generate(
  query: string,
  contexts: RetrievedContext[],
  agentType: string,
  agentName: string,
  agentSystemPrompt: string,
  env: Env
): Promise<GeneratedResponse> {
  const contextBlock = buildContextBlock(contexts);
  const systemPrompt = buildGroundedSystemPrompt(
    agentName,
    agentSystemPrompt,
    agentType,
    contextBlock,
    { includeJsonSchema: true }
  );

  const params = getParams(agentType);

  const response = await env.AI.run(params.model as any, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query }
    ],
    temperature: params.temperature,
    top_p: params.top_p,
    top_k: params.top_k,
    max_tokens: params.max_tokens,
    ...(params.response_format ? { response_format: params.response_format } : {})
  });

  const raw = (response as any)?.response || '';

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      text: parsed.answer || raw,
      claims: parsed.claims || [],
      citations_used: parsed.citations || [],
      raw
    };
  } catch {
    // If JSON parsing fails, treat the whole response as the answer
    return {
      text: raw,
      claims: [],
      citations_used: [],
      raw
    };
  }
}
