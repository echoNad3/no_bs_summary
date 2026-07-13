import type { TranscriptProvider, TranscriptResult } from './provider.js';

/**
 * Supadata adapter (implemented in Phase 2).
 *
 * Confirmed API details (https://docs.supadata.ai/get-transcript):
 * - GET https://api.supadata.ai/v1/transcript
 * - Header: `x-api-key: <SUPADATA_API_KEY>`
 * - Query: url (encoded YouTube URL), mode=native, text=false, optional lang
 * - 200 (text=false): { content: [{ text, offset, duration, lang }], lang, availableLangs }
 * - 202: { jobId } — async job. This benchmark must NOT poll jobs; treat as failure.
 * - 206: transcript unavailable in native mode.
 */
export class SupadataProvider implements TranscriptProvider {
  readonly name = 'supadata';

  constructor(private readonly apiKey: string) {}

  async fetchTranscript(_videoId: string, _signal: AbortSignal): Promise<TranscriptResult> {
    throw new Error('SupadataProvider is not implemented yet (Phase 2).');
  }
}
