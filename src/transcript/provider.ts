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

import type { RunContext } from '../run-context.js';

/**
 * A transcript source. Implementations must:
 * - use only official, documented APIs
 * - never fall back to another provider
 * - never trigger AI-generated or asynchronous transcription jobs
 * - respect the run context so requests stop at the end-to-end deadline
 */
export interface TranscriptProvider {
  /** Stable machine-readable name, e.g. "supadata". */
  readonly name: string;
  fetchTranscript(videoId: string, ctx: RunContext): Promise<TranscriptResult>;
}

/**
 * A transcript failure that must never be retried, e.g. "this video has no
 * captions" or "the API key is wrong". Retrying cannot fix these.
 */
export class TranscriptError extends Error {
  constructor(
    message: string,
    readonly stage: 'transcript' = 'transcript',
  ) {
    super(message);
    this.name = 'TranscriptError';
  }
}
