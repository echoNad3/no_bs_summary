import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FileSummaryCache,
  summaryCacheKey,
  type SummaryCacheIdentity,
} from '../src/product/summary-cache.js';
import type { SummarizeResponse } from '../src/product/schema.js';
import { legacySummaryCacheKey } from '../src/product/summary-store.js';

let dir: string;

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

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nbs-summary-cache-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('FileSummaryCache', () => {
  it('keys saved summaries by video, language, model, and prompt version', () => {
    const key = summaryCacheKey(identity);

    expect(key).not.toBe(summaryCacheKey({ ...identity, videoId: 'dQw4w9WgXcQ' }));
    expect(key).not.toBe(summaryCacheKey({ ...identity, language: 'de' }));
    expect(key).not.toBe(summaryCacheKey({ ...identity, model: 'gemini-2.5-flash' }));
    expect(key).not.toBe(summaryCacheKey({ ...identity, promptVersion: 'summary-first-v30' }));
  });

  it('reads a matching pre-language cache entry without sharing it across languages', async () => {
    const cache = new FileSummaryCache(dir);
    const { language: _language, ...legacyIdentity } = identity;
    await fs.writeFile(
      path.join(dir, `${legacySummaryCacheKey(identity)}.json`),
      JSON.stringify({ identity: legacyIdentity, response }),
      'utf8',
    );

    await expect(cache.read(identity)).resolves.toEqual(response);
    await expect(cache.read({ ...identity, language: 'de' })).resolves.toBeUndefined();
  });

  it('round-trips the complete response without changing timing or source', async () => {
    const cache = new FileSummaryCache(dir);

    await cache.write(identity, response);

    await expect(cache.read(identity)).resolves.toEqual(response);
    expect((await fs.readdir(dir)).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('treats missing, corrupt, and identity-mismatched entries as misses', async () => {
    const cache = new FileSummaryCache(dir);
    await expect(cache.read(identity)).resolves.toBeUndefined();

    await cache.write(identity, response);
    const [file] = await fs.readdir(dir);
    if (!file) throw new Error('Expected a cached summary file.');
    const filePath = path.join(dir, file);
    await fs.writeFile(filePath, '{not-json', 'utf8');
    await expect(cache.read(identity)).resolves.toBeUndefined();

    await fs.writeFile(
      filePath,
      JSON.stringify({ identity: { ...identity, model: 'different-model' }, response }),
      'utf8',
    );
    await expect(cache.read(identity)).resolves.toBeUndefined();
  });

  it('overwrites an existing key', async () => {
    const cache = new FileSummaryCache(dir);
    await cache.write(identity, response);
    const replacement: SummarizeResponse = { ...response, verdict: 'SKIM' };

    await cache.write(identity, replacement);

    await expect(cache.read(identity)).resolves.toEqual(replacement);
  });
});
