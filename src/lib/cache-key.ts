// Cache key builder for AI Gateway response caching

export interface CacheOptions {
  cacheable: boolean;
  cacheKey: string;
  ttlSeconds: number;
  agentType: string;
  requestId: string;
  skipCache?: boolean;
  userTier?: string;
}

export async function buildCacheKey(
  query: string,
  agentType: string,
  topChunkIds: string[]
): Promise<CacheOptions> {
  // Normalize query for cache hit consistency
  const normalizedQuery = query.toLowerCase().trim().replace(/\s+/g, ' ');
  const contextSignature = topChunkIds.sort().join('|');
  const data = new TextEncoder().encode(normalizedQuery + contextSignature);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
  const key = `${agentType}:${hashHex}`;

  // TTL varies by content type — legal/exam content changes slowly
  const ttlMap: Record<string, number> = {
    procurement: 7 * 24 * 3600,  // 7 days
    legal: 7 * 24 * 3600,        // 7 days
    wassce: 30 * 24 * 3600,      // 30 days
    bece: 30 * 24 * 3600,        // 30 days
    exam_marker: 30 * 24 * 3600, // 30 days
    finance: 7 * 24 * 3600,      // 7 days
    hr: 7 * 24 * 3600,           // 7 days
    translation: 24 * 3600,      // 1 day
    general: 24 * 3600,          // 1 day
  };

  return {
    cacheable: true,
    cacheKey: key,
    ttlSeconds: ttlMap[agentType] ?? 86400,
    agentType,
    requestId: crypto.randomUUID(),
  };
}

// Skip cache for time-sensitive queries
export function shouldSkipCache(query: string): boolean {
  const freshKeywords = ['today', 'current', 'latest', 'now', 'recent', 'this year', 'update', '2026', 'new'];
  return freshKeywords.some((kw) => query.toLowerCase().includes(kw));
}
