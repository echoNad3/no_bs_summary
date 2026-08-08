import {
  cachedSummaryEntrySchema,
  legacyCachedSummaryEntrySchema,
  legacySummaryCacheKey,
  summaryCacheIdentitySchema,
  summaryCacheKey,
} from './summary-store.js';
import type { SummaryCache, SummaryCacheIdentity } from './summary-store.js';
import type { SummarizeResponse } from './schema.js';

/**
 * Cloudflare Workers KV implementation of the summary storage contract.
 *
 * Uses a minimal structural KV type instead of the generated Workers types so
 * this module stays testable in Node (vitest) and the rest of the repo keeps
 * one TypeScript configuration. The shape matches the KVNamespace binding.
 */
export interface KvNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export class KvSummaryCache implements SummaryCache {
  constructor(private readonly kv: KvNamespaceLike) {}

  async read(rawIdentity: SummaryCacheIdentity): Promise<SummarizeResponse | undefined> {
    const identity = summaryCacheIdentitySchema.parse(rawIdentity);
    const raw = await this.kv.get(summaryCacheKey(identity));
    if (raw !== null) {
      try {
        const cached = cachedSummaryEntrySchema.parse(JSON.parse(raw));
        if (currentEntryMatches(cached, identity)) return cached.response;
      } catch {
        // Corrupt entry: continue to the read-only legacy key before treating it as a miss.
      }
    }

    const legacyRaw = await this.kv.get(legacySummaryCacheKey(identity));
    if (legacyRaw !== null) {
      try {
        const cached = legacyCachedSummaryEntrySchema.parse(JSON.parse(legacyRaw));
        if (
          cached.identity.videoId === identity.videoId &&
          cached.identity.model === identity.model &&
          cached.identity.promptVersion === identity.promptVersion &&
          cached.response.language.toLowerCase() === identity.language.toLowerCase()
        ) {
          return cached.response;
        }
      } catch {
        // Corrupt legacy entry: treat it as a cache miss.
      }
    }
    return undefined;
  }

  async write(rawIdentity: SummaryCacheIdentity, response: SummarizeResponse): Promise<void> {
    const entry = cachedSummaryEntrySchema.parse({ identity: rawIdentity, response });
    await this.kv.put(summaryCacheKey(entry.identity), JSON.stringify(entry));
  }
}

function currentEntryMatches(
  cached: ReturnType<typeof cachedSummaryEntrySchema.parse>,
  identity: SummaryCacheIdentity,
): boolean {
  return (
    cached.identity.videoId === identity.videoId &&
    cached.identity.language.toLowerCase() === identity.language.toLowerCase() &&
    cached.identity.model === identity.model &&
    cached.identity.promptVersion === identity.promptVersion &&
    cached.response.language.toLowerCase() === identity.language.toLowerCase()
  );
}
