import { describe, expect, it } from 'vitest';
import { KvSummaryCache, type KvNamespaceLike } from '../src/product/kv-summary-cache.js';
import type { SummarizeResponse } from '../src/product/schema.js';
import {
  legacySummaryCacheKey,
  summaryCacheKey,
  type SummaryCacheIdentity,
} from '../src/product/summary-store.js';

const identity: SummaryCacheIdentity = {
  videoId: 'EwMSGdE2bOQ',
  language: 'en',
  model: 'gemini-3.1-flash-lite',
  promptVersion: 'summary-first-v29-2026-07-14',
};

const response: SummarizeResponse = {
  verdict: 'WATCH',
  reason: 'The host keeps a long list of topics funny and easy to follow.',
  summary: 'Wizard Detective, Kane Pixels, and several Backrooms projects are the main topics.',
  videoId: 'EwMSGdE2bOQ',
  language: 'en',
  source: 'CACHED',
  timing: { transcriptMs: 8, summaryMs: 3210, totalMs: 3218 },
  retries: { transcript: 0, summary: 0 },
};

class FakeKv implements KvNamespaceLike {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

describe('Cloudflare summary cache', () => {
  it('keys summaries by video, language, model, and prompt version', () => {
    const key = summaryCacheKey(identity);
    expect(key).not.toBe(summaryCacheKey({ ...identity, videoId: 'dQw4w9WgXcQ' }));
    expect(key).not.toBe(summaryCacheKey({ ...identity, language: 'de' }));
    expect(key).not.toBe(summaryCacheKey({ ...identity, model: 'gemini-2.5-flash' }));
    expect(key).not.toBe(summaryCacheKey({ ...identity, promptVersion: 'summary-first-v30' }));
  });

  it('round-trips the complete response', async () => {
    const cache = new KvSummaryCache(new FakeKv());
    await cache.write(identity, response);
    await expect(cache.read(identity)).resolves.toEqual(response);
  });

  it('reads a matching legacy entry without sharing it across languages', async () => {
    const kv = new FakeKv();
    const { language: _language, ...legacyIdentity } = identity;
    kv.values.set(
      legacySummaryCacheKey(identity),
      JSON.stringify({ identity: legacyIdentity, response }),
    );
    const cache = new KvSummaryCache(kv);
    await expect(cache.read(identity)).resolves.toEqual(response);
    await expect(cache.read({ ...identity, language: 'de' })).resolves.toBeUndefined();
  });

  it('treats corrupt and mismatched entries as misses', async () => {
    const kv = new FakeKv();
    kv.values.set(summaryCacheKey(identity), '{not-json');
    const cache = new KvSummaryCache(kv);
    await expect(cache.read(identity)).resolves.toBeUndefined();

    kv.values.set(
      summaryCacheKey(identity),
      JSON.stringify({ identity: { ...identity, model: 'other' }, response }),
    );
    await expect(cache.read(identity)).resolves.toBeUndefined();
  });
});
