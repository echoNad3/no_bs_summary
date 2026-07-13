import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { TranscriptResult } from './transcript/provider.js';

/**
 * Small on-disk cache for transcripts, so repeated runs don't burn API
 * credits. Gemini summaries are never cached — only transcripts.
 *
 * Cache key = format version + provider + video ID + requested language.
 * We always ask providers for their default language, so the requested
 * language slot is the constant "default"; the actual language of the
 * transcript is stored inside the file.
 *
 * Writes are atomic: content goes to a temporary file first, then the file
 * is renamed into place. An interrupted run can never leave a half-written
 * cache file behind.
 */

export const CACHE_VERSION = 1;

const cachedTranscriptSchema = z.object({
  provider: z.string(),
  videoId: z.string(),
  language: z.string(),
  text: z.string(),
  segments: z
    .array(z.object({ text: z.string(), startMs: z.number(), durationMs: z.number() }))
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export function cacheKey(provider: string, videoId: string, requestedLanguage = 'default'): string {
  return `v${CACHE_VERSION}-${provider}-${videoId}-${requestedLanguage}`;
}

export class TranscriptCache {
  constructor(private readonly dir: string) {}

  private filePath(key: string): string {
    return path.join(this.dir, `${key}.json`);
  }

  /** Returns the cached transcript, or undefined if there is none (or it is unreadable). */
  async read(key: string): Promise<TranscriptResult | undefined> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath(key), 'utf8');
    } catch {
      return undefined; // no cache entry
    }
    try {
      const parsed = cachedTranscriptSchema.parse(JSON.parse(raw));
      return parsed as TranscriptResult;
    } catch {
      return undefined; // corrupt entry — treat as a cache miss
    }
  }

  async write(key: string, transcript: TranscriptResult): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const target = this.filePath(key);
    const temp = `${target}.tmp-${randomBytes(4).toString('hex')}`;
    await fs.writeFile(temp, JSON.stringify(transcript, null, 2), 'utf8');
    await fs.rename(temp, target);
  }

  /** Deletes the whole cache directory. */
  async clear(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}
