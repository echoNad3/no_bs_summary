import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { languageSchema, transcriptSegmentSchema, videoIdSchema } from './transcript/provider.js';
import type { TranscriptResult } from './transcript/provider.js';

/**
 * Small on-disk cache for transcripts, so repeated runs don't burn API
 * credits. Backend product summaries use a separate replaceable cache in
 * product/summary-cache.ts, so benchmark transcript behavior stays unchanged.
 *
 * Cache key = format version + provider + video ID + requested language.
 * The requested language is part of the key, while the resolved language is
 * stored inside the file.
 *
 * Writes are atomic: content goes to a temporary file first, then the file
 * is renamed into place. An interrupted run can never leave a half-written
 * cache file behind.
 */

export const CACHE_VERSION = 2;

const cachedTranscriptSchema = z
  .object({
    provider: z.string().trim().min(1),
    videoId: videoIdSchema,
    language: languageSchema,
    text: z.string().trim().min(1),
    segments: z.array(transcriptSegmentSchema).min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.segments && value.segments.map((segment) => segment.text).join(' ') !== value.text) {
      ctx.addIssue({
        code: 'custom',
        path: ['segments'],
        message: 'cached segments do not match cached transcript text',
      });
    }
  });

export interface CacheIdentity {
  provider: string;
  videoId: string;
}

export function cacheKey(provider: string, videoId: string, requestedLanguage = 'default'): string {
  return `v${CACHE_VERSION}-${provider}-${videoId}-${requestedLanguage}`;
}

export class TranscriptCache {
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
