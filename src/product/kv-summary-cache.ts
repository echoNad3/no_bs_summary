import {
  cachedSummaryEntrySchema,
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
    if (raw === null) return undefined;

    try {
      const cached = cachedSummaryEntrySchema.parse(JSON.parse(raw));
      if (
        cached.identity.videoId !== identity.videoId ||
        cached.identity.model !== identity.model ||
        cached.identity.promptVersion !== identity.promptVersion
      ) {
        return undefined;
      }
      return cached.response;
    } catch {
      return undefined; // corrupt entry — treat as a cache miss
    }
  }

  async write(rawIdentity: SummaryCacheIdentity, response: SummarizeResponse): Promise<void> {
    const entry = cachedSummaryEntrySchema.parse({ identity: rawIdentity, response });
    await this.kv.put(summaryCacheKey(entry.identity), JSON.stringify(entry));
  }
}
