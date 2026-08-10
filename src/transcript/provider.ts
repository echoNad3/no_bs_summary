import { z } from 'zod';
import type { RequestContext } from '../request-context.js';

export const videoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
export const languageSchema = z
  .string()
  .trim()
  .regex(/^(?:asr-)?[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);
export const transcriptSegmentSchema = z.object({
  text: z.string().trim().min(1),
  startMs: z.number().finite().nonnegative(),
  durationMs: z.number().finite().nonnegative(),
});

/**
 * One timestamped piece of a transcript, as supplied by the provider.
 * Times are in milliseconds from the start of the video.
 */
export interface TranscriptSegment {
  text: string;
  startMs: number;
  durationMs: number;
}

/**
 * Normalized transcript result shared by every provider adapter.
 */
export interface TranscriptResult {
  provider: string;
  videoId: string;
  /** BCP-47 / ISO 639-1 language code reported by the provider, e.g. "en". */
  language: string;
  /** Full transcript as plain text (whitespace-normalized, order preserved). */
  text: string;
  /** Timestamped segments when the provider supplies them. */
  segments?: TranscriptSegment[];
  /** Provider-specific extras (e.g. available languages). Never contains secrets. */
  metadata?: Record<string, unknown>;
}

/**
 * A transcript source. Implementations must:
 * - use only official, documented APIs
 * - never fall back to another provider
 * - never trigger automatic or asynchronous transcription jobs
 * - respect the run context so requests stop at the end-to-end deadline
 */
export interface TranscriptProvider {
  /** Stable machine-readable name. */
  readonly name: string;
  fetchTranscript(
    videoId: string,
    ctx: RequestContext,
    requestedLanguage?: string,
  ): Promise<TranscriptResult>;
}

/** Plain and ASR-prefixed codes for the same base language are equivalent. */
export function sameLanguageFamily(actual: string, requested: string): boolean {
  return baseLanguage(actual) === baseLanguage(requested);
}

function baseLanguage(language: string): string {
  return language.toLowerCase().replace(/^asr-/, '').split('-')[0] ?? '';
}

/**
 * A transcript failure that must never be retried, e.g. "this video has no
 * captions" or "the API key is wrong". Retrying cannot fix these.
 */
export class TranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptError';
  }
}
