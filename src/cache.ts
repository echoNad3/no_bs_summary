import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { cachedTranscriptSchema } from './transcript/store.js';
import type { CacheIdentity, TranscriptStore } from './transcript/store.js';
import type { TranscriptResult } from './transcript/provider.js';

/**
 * Small on-disk cache for transcripts, so repeated runs don't burn API
 * credits. Backend product summaries use a separate replaceable cache in
 * product/summary-cache.ts, so benchmark transcript behavior stays unchanged.
 *
 * The storage contract, schema, and key derivation live in
 * transcript/store.ts so the Cloudflare Worker can share them without
 * depending on node:fs.
 *
 * Writes are atomic: content goes to a temporary file first, then the file
 * is renamed into place. An interrupted run can never leave a half-written
 * cache file behind.
 */

export { CACHE_VERSION, cacheKey } from './transcript/store.js';
export type { CacheIdentity, TranscriptStore } from './transcript/store.js';

export class TranscriptCache implements TranscriptStore {
  constructor(private readonly dir: string) {}

  private filePath(key: string): string {
    return path.join(this.dir, `${key}.json`);
  }

  /** Returns the cached transcript, or undefined if there is none (or it is unreadable). */
  async read(key: string, expected?: CacheIdentity): Promise<TranscriptResult | undefined> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath(key), 'utf8');
    } catch {
      return undefined; // no cache entry
    }
    try {
      const parsed = cachedTranscriptSchema.parse(JSON.parse(raw));
      if (
        expected &&
        (parsed.provider !== expected.provider || parsed.videoId !== expected.videoId)
      ) {
        return undefined;
      }
      return parsed as TranscriptResult;
    } catch {
      return undefined; // corrupt entry — treat as a cache miss
    }
  }

  async write(key: string, transcript: TranscriptResult): Promise<void> {
    const validated = cachedTranscriptSchema.parse(transcript);
    await fs.mkdir(this.dir, { recursive: true });
    const target = this.filePath(key);
    const temp = `${target}.tmp-${randomBytes(4).toString('hex')}`;
    try {
      await fs.writeFile(temp, JSON.stringify(validated, null, 2), 'utf8');
      await fs.rename(temp, target);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }

  /** Deletes the whole cache directory. */
  async clear(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}
