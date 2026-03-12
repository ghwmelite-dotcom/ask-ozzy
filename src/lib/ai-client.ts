// AI Gateway wrapper — routes all AI calls through Cloudflare AI Gateway
// Provides caching for verified responses, request tagging, and monitoring
import type { Env } from '../types';
import type { CacheOptions } from './cache-key';

interface AIInput {
  messages?: Array<{ role: string; content: string }>;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  tools?: unknown[];
  [key: string]: unknown;
}

export async function runWithGateway(
  model: string,
  input: AIInput,
  env: Env,
  cacheOptions?: CacheOptions
): Promise<unknown> {
  const gatewayOpts: Record<string, unknown> = {
    id: 'askozzy-gateway',
  };

  // Cache verified responses by content hash
  if (cacheOptions?.cacheable && !cacheOptions.skipCache) {
    gatewayOpts['cf-aig-cache-key'] = cacheOptions.cacheKey;
    gatewayOpts['cf-aig-cache-ttl'] = String(cacheOptions.ttlSeconds ?? 86400);
  }

  if (cacheOptions?.skipCache) {
    gatewayOpts['skipCache'] = true;
  }

  // Tag requests for monitoring dashboards
  gatewayOpts['metadata'] = JSON.stringify({
    agent_type: cacheOptions?.agentType ?? 'unknown',
    request_id: cacheOptions?.requestId ?? crypto.randomUUID(),
    user_tier: cacheOptions?.userTier ?? 'standard',
  });

  try {
    return await env.AI.run(model as any, input as any, {
      gateway: gatewayOpts,
    } as any);
  } catch (e: any) {
    // If gateway fails, fall back to direct AI call
    console.error('AI Gateway error, falling back to direct:', e?.message);
    return env.AI.run(model as any, input as any);
  }
}

// Streaming variant for chat endpoint
export async function runStreamWithGateway(
  model: string,
  input: AIInput,
  env: Env,
  cacheOptions?: CacheOptions
): Promise<ReadableStream> {
  const streamInput = { ...input, stream: true };

  const gatewayOpts: Record<string, unknown> = {
    id: 'askozzy-gateway',
  };

  if (cacheOptions?.skipCache) {
    gatewayOpts['skipCache'] = true;
  }

  gatewayOpts['metadata'] = JSON.stringify({
    agent_type: cacheOptions?.agentType ?? 'unknown',
    request_id: cacheOptions?.requestId ?? crypto.randomUUID(),
    user_tier: cacheOptions?.userTier ?? 'standard',
  });

  try {
    return (await env.AI.run(model as any, streamInput as any, {
      gateway: gatewayOpts,
    } as any)) as ReadableStream;
  } catch (e: any) {
    console.error('AI Gateway stream error, falling back to direct:', e?.message);
    return (await env.AI.run(model as any, streamInput as any)) as ReadableStream;
  }
}
