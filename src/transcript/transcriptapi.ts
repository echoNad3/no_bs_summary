import { z } from 'zod';
import { fetchWithOneRetry } from '../http.js';
import type { RunContext } from '../run-context.js';
import { assertUsableTranscript, normalizeSegments } from './normalize.js';
import { TranscriptError } from './provider.js';
import type { TranscriptProvider, TranscriptResult } from './provider.js';

/**
 * TranscriptAPI adapter.
 *
 * API (https://transcriptapi.com/docs/api/):
 * - GET https://transcriptapi.com/api/v2/youtube/transcript
 * - Header: `Authorization: Bearer <TRANSCRIPTAPI_API_KEY>`
 * - Query: video_url (a bare video ID works), format=json.
 *   send_metadata stays at its default (false) — extra metadata costs latency.
 * - 200: { video_id, language, transcript: [{ text, start, duration }] }
 *   (start/duration in SECONDS — converted to milliseconds here)
 */

const responseSchema = z.object({
  video_id: z.string().optional(),
  language: z.string().optional(),
  transcript: z.array(
    z.object({
      text: z.string(),
      start: z.number(),
      duration: z.number(),
    }),
  ),
});

export class TranscriptApiProvider implements TranscriptProvider {
  readonly name = 'transcriptapi';

  constructor(private readonly apiKey: string) {}

  async fetchTranscript(videoId: string, ctx: RunContext): Promise<TranscriptResult> {
    const url =
      `https://transcriptapi.com/api/v2/youtube/transcript` +
      `?video_url=${encodeURIComponent(videoId)}&format=json`;

    const { response } = await fetchWithOneRetry(
      url,
      { headers: { Authorization: `Bearer ${this.apiKey}` } },
      ctx,
    );

    if (response.status === 401) {
      throw new TranscriptError(
        'TranscriptAPI rejected the API key (check TRANSCRIPTAPI_API_KEY in .env).',
      );
    }
    if (response.status === 402) {
      throw new TranscriptError('TranscriptAPI: no credits left on this account.');
    }
    if (response.status === 404) {
      throw new TranscriptError('TranscriptAPI: no captions available for this video.');
    }
    if (!response.ok) {
      throw new TranscriptError(
        `TranscriptAPI request failed with HTTP status ${response.status}.`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TranscriptError('TranscriptAPI sent a response that was not valid JSON.');
    }

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) {
      throw new TranscriptError('TranscriptAPI sent a response in an unexpected format.');
    }

    const { text, segments } = normalizeSegments(
      parsed.data.transcript.map((segment) => ({
        text: segment.text,
        startMs: Math.round(segment.start * 1000),
        durationMs: Math.round(segment.duration * 1000),
      })),
    );
    assertUsableTranscript(text, 'TranscriptAPI');

    return {
      provider: this.name,
      videoId,
      language: parsed.data.language ?? 'unknown',
      text,
      segments,
    };
  }
}
