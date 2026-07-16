import { z } from 'zod';
import { languageSchema, transcriptSegmentSchema, videoIdSchema } from './provider.js';
import type { TranscriptResult } from './provider.js';

/**
 * Runtime-neutral transcript storage contract shared by the local filesystem
 * cache (cache.ts) and the Cloudflare Worker's in-memory store. This file must
 * stay free of node:fs so the Worker bundle never depends on a filesystem.
 *
 * Cache key = format version + provider + video ID + requested language.
 * The requested language is part of the key, while the resolved language is
 * stored inside the entry.
 */

export const CACHE_VERSION = 2;

export const cachedTranscriptSchema = z
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

export interface TranscriptStore {
  /** Returns the stored transcript, or undefined if there is none (or it is unusable). */
  read(key: string, expected?: CacheIdentity): Promise<TranscriptResult | undefined>;
  write(key: string, transcript: TranscriptResult): Promise<void>;
}

const MEMORY_STORE_MAX_ENTRIES = 16;

/**
 * Ephemeral per-isolate store for the Worker. Full transcripts must never be
 * written to durable cloud storage; this only avoids paying for a second
 * transcript fetch when a retry lands on the same warm isolate.
 */
export class MemoryTranscriptStore implements TranscriptStore {
  private readonly entries = new Map<string, TranscriptResult>();

  async read(key: string, expected?: CacheIdentity): Promise<TranscriptResult | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (expected && (entry.provider !== expected.provider || entry.videoId !== expected.videoId)) {
      return undefined;
    }
    return entry;
  }

  async write(key: string, transcript: TranscriptResult): Promise<void> {
    const validated = cachedTranscriptSchema.parse(transcript) as TranscriptResult;
    this.entries.delete(key);
    while (this.entries.size >= MEMORY_STORE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, validated);
  }
}
