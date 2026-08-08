import { z } from 'zod';
import { fetchWithOneRetry } from '../http.js';
import type { RequestContext } from '../request-context.js';
import { assertUsableTranscript, normalizeSegments } from './normalize.js';
import { languageSchema, sameLanguageFamily, TranscriptError, videoIdSchema } from './provider.js';
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
  video_id: videoIdSchema,
  language: languageSchema,
  transcript: z
    .array(
      z.object({
        text: z.string().trim().min(1),
        start: z.number().finite().nonnegative(),
        duration: z.number().finite().nonnegative(),
      }),
    )
    .min(1),
});

const TRANSCRIPTAPI_RETRY_POLICY = {
  isRetryableStatus: (status: number) => status === 408 || status === 429 || status === 503,
  defaultDelayMs: 1000,
};

export class TranscriptApiProvider implements TranscriptProvider {
  readonly name = 'transcriptapi';

  constructor(private readonly apiKey: string) {}

  async fetchTranscript(
    videoId: string,
    ctx: RequestContext,
    requestedLanguage = 'en',
  ): Promise<TranscriptResult> {
    const url =
      `https://transcriptapi.com/api/v2/youtube/transcript` +
      `?video_url=${encodeURIComponent(videoId)}` +
      `&language=${encodeURIComponent(requestedLanguage)}` +
      `&format=json&include_timestamp=true&send_metadata=false`;

    const { response, firstFailure } = await fetchWithOneRetry(
      url,
      { headers: { Authorization: `Bearer ${this.apiKey}` } },
      ctx,
      TRANSCRIPTAPI_RETRY_POLICY,
    );

    if (response.status === 401) {
      throw providerFailure(
        'TranscriptAPI rejected the API key (check TRANSCRIPTAPI_API_KEY in .env).',
        firstFailure,
      );
    }
    if (response.status === 402) {
      throw providerFailure('TranscriptAPI: no credits left on this account.', firstFailure);
    }
    if (response.status === 404) {
      throw providerFailure('TranscriptAPI: no captions available for this video.', firstFailure);
    }
    if (!response.ok) {
      throw providerFailure(
        `TranscriptAPI request failed with HTTP status ${response.status}.`,
        firstFailure,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw providerFailure('TranscriptAPI sent a response that was not valid JSON.', firstFailure);
    }

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) {
      throw providerFailure('TranscriptAPI sent a response in an unexpected format.', firstFailure);
    }
    if (parsed.data.video_id !== videoId) {
      throw providerFailure(
        `TranscriptAPI returned transcript data for a different video (${parsed.data.video_id}).`,
        firstFailure,
      );
    }
    if (!sameLanguageFamily(parsed.data.language, requestedLanguage)) {
      throw providerFailure(
        `TranscriptAPI returned ${parsed.data.language} captions instead of requested ${requestedLanguage} captions.`,
        firstFailure,
      );
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
      language: parsed.data.language,
      text,
      segments,
    };
  }
}

function providerFailure(message: string, firstFailure: string | undefined): TranscriptError {
  return new TranscriptError(
    message + (firstFailure ? ` First attempt failed with ${firstFailure}.` : ''),
  );
}
