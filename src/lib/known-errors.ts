import type { Env } from '../types';

export interface KnownError {
  id: number;
  query_hash: string;
  agent_type: string;
  error_description: string;
  correction: string | null;
}

export async function checkKnownErrors(
  query: string,
  agentType: string,
  env: Env
): Promise<KnownError | null> {
  try {
    const queryHash = await hashQuery(query.toLowerCase().trim());
    const error = await env.DB.prepare(
      'SELECT * FROM known_errors WHERE query_hash = ? AND agent_type = ?'
    ).bind(queryHash, agentType).first<KnownError>();
    return error || null;
  } catch {
    return null;
  }
}

export async function hashQuery(query: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(query);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
