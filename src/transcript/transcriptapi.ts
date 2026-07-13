import type { TranscriptProvider, TranscriptResult } from './provider.js';

/**
 * TranscriptAPI adapter (implemented in Phase 2).
 *
 * Confirmed API details (https://transcriptapi.com/docs/api/):
 * - GET https://transcriptapi.com/api/v2/youtube/transcript
 * - Header: `Authorization: Bearer <TRANSCRIPTAPI_API_KEY>`
 * - Query: video_url (full URL or bare video ID), format=json,
 *   send_metadata=false (default; keep false to avoid extra latency)
 * - 200: { video_id, language, transcript: [{ text, start, duration }] }
 * - 404: no transcript for requested languages
 * - Retryable per docs: 408, 429, 503
 */
export class TranscriptApiProvider implements TranscriptProvider {
  readonly name = 'transcriptapi';

  constructor(private readonly apiKey: string) {}

  async fetchTranscript(_videoId: string, _signal: AbortSignal): Promise<TranscriptResult> {
    throw new Error('TranscriptApiProvider is not implemented yet (Phase 2).');
  }
}
