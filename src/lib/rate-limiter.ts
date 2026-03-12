// Agent-specific rate limiting via KV
import type { Env } from '../types';

const RATE_LIMITS: Record<string, { requests: number; window: number }> = {
  wassce: { requests: 50, window: 3600 },       // 50/hour for students
  bece: { requests: 50, window: 3600 },          // 50/hour for students
  study_coach: { requests: 50, window: 3600 },   // 50/hour
  procurement: { requests: 20, window: 3600 },   // 20/hour for civil servants
  legal: { requests: 20, window: 3600 },          // 20/hour
  finance: { requests: 20, window: 3600 },        // 20/hour
  translation: { requests: 30, window: 3600 },    // 30/hour
  research: { requests: 30, window: 3600 },        // 30/hour
  default: { requests: 30, window: 3600 },         // 30/hour default
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export async function checkAgentRateLimit(
  userId: string,
  agentType: string,
  env: Env
): Promise<RateLimitResult> {
  const limit = RATE_LIMITS[agentType] ?? RATE_LIMITS.default;
  const key = `rate:${userId}:${agentType}`;
  const now = Math.floor(Date.now() / 1000);

  const count = await env.SESSIONS.get(key);
  const currentCount = count ? parseInt(count, 10) : 0;

  if (currentCount >= limit.requests) {
    return { allowed: false, remaining: 0, resetAt: now + limit.window };
  }

  await env.SESSIONS.put(key, String(currentCount + 1), {
    expirationTtl: limit.window,
  });

  return {
    allowed: true,
    remaining: limit.requests - currentCount - 1,
    resetAt: now + limit.window,
  };
}

// Log gateway metrics to D1 (called from cron or after each request batch)
export async function recordGatewayMetrics(
  env: Env,
  agentType: string,
  cacheHit: boolean,
  hallucinationFlagged: boolean,
  responseMs: number,
  confidenceScore: number
): Promise<void> {
  const date = new Date().toISOString().split('T')[0];
  try {
    // Upsert daily metrics
    await env.DB.prepare(`
      INSERT INTO gateway_metrics (date, agent_type, total_requests, cache_hits, hallucination_flags, avg_response_ms, avg_confidence_score)
      VALUES (?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(date, agent_type) DO UPDATE SET
        total_requests = total_requests + 1,
        cache_hits = cache_hits + excluded.cache_hits,
        hallucination_flags = hallucination_flags + excluded.hallucination_flags,
        avg_response_ms = (avg_response_ms * total_requests + excluded.avg_response_ms) / (total_requests + 1),
        avg_confidence_score = (avg_confidence_score * total_requests + excluded.avg_confidence_score) / (total_requests + 1)
    `).bind(
      date,
      agentType,
      cacheHit ? 1 : 0,
      hallucinationFlagged ? 1 : 0,
      responseMs,
      confidenceScore
    ).run();
  } catch (e) {
    console.error('Failed to record gateway metrics:', e);
  }
}
