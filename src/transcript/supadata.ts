import { z } from 'zod';
import { fetchWithOneRetry } from '../http.js';
import type { RunContext } from '../run-context.js';
import { assertUsableTranscript, normalizeSegments } from './normalize.js';
import { languageSchema, sameLanguageFamily, TranscriptError } from './provider.js';
import type { TranscriptProvider, TranscriptResult } from './provider.js';

/**
 * Supadata adapter.
 *
 * API (https://docs.supadata.ai/get-transcript):
 * - GET https://api.supadata.ai/v1/transcript
 * - Header: `x-api-key: <SUPADATA_API_KEY>`
 * - Query: url (YouTube URL), mode=native (never auto/generate), text=false
 * - 200: { content: [{ text, offset, duration, lang }], lang, availableLangs }
 *   (offset/duration already in milliseconds)
 * - 202: { jobId } — async job. This benchmark never polls jobs; that is a failure.
 * - 206: no existing captions in native mode.
 */

const responseSchema = z.object({
  content: z
    .array(
      z.object({
        text: z.string().trim().min(1),
        offset: z.number().finite().nonnegative(),
        duration: z.number().finite().nonnegative(),
        lang: languageSchema,
      }),
    )
    .min(1),
  lang: languageSchema,
  availableLangs: z.array(languageSchema),
});

const SUPADATA_RETRY_POLICY = {
  // Supadata documents 5xx as infrastructure failures. Its 429 can mean a plan limit.
  isRetryableStatus: (status: number) => status >= 500 && status < 600,
  defaultDelayMs: 1000,
};

export class SupadataProvider implements TranscriptProvider {
  readonly name = 'supadata';

  constructor(private readonly apiKey: string) {}

  async fetchTranscript(
    videoId: string,
    ctx: RunContext,
    requestedLanguage = 'en',
  ): Promise<TranscriptResult> {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const url =
      `https://api.supadata.ai/v1/transcript` +
      `?url=${encodeURIComponent(videoUrl)}` +
      `&lang=${encodeURIComponent(requestedLanguage)}&mode=native&text=false`;

    const { response, firstFailure } = await fetchWithOneRetry(
      url,
      { headers: { 'x-api-key': this.apiKey } },
      ctx,
      SUPADATA_RETRY_POLICY,
    );

    if (response.status === 202) {
      throw providerFailure(
        'Supadata answered with an async job (video likely too long). This benchmark does not wait for jobs.',
        firstFailure,
      );
    }
    if (response.status === 206) {
      throw providerFailure(
        'Supadata: this video has no existing captions (native mode).',
        firstFailure,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw providerFailure(
        'Supadata rejected the API key (check SUPADATA_API_KEY in .env).',
        firstFailure,
      );
    }
    if (response.status === 404) {
      throw providerFailure('Supadata: video not found, private, or unavailable.', firstFailure);
    }
    if (!response.ok) {
      throw providerFailure(
        `Supadata request failed with HTTP status ${response.status}.`,
        firstFailure,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw providerFailure('Supadata sent a response that was not valid JSON.', firstFailure);
    }

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) {
      throw providerFailure('Supadata sent a response in an unexpected format.', firstFailure);
    }
    if (!sameLanguageFamily(parsed.data.lang, requestedLanguage)) {
      throw providerFailure(
        `Supadata returned ${parsed.data.lang} captions instead of requested ${requestedLanguage} captions.`,
        firstFailure,
      );
    }

    const { text, segments } = normalizeSegments(
      parsed.data.content.map((segment) => ({
        text: segment.text,
        startMs: segment.offset,
        durationMs: segment.duration,
      })),
    );
    assertUsableTranscript(text, 'Supadata');

    return {
      provider: this.name,
      videoId,
      language: parsed.data.lang,
      text,
      segments,
      metadata: { availableLangs: parsed.data.availableLangs },
    };
  }
}

function providerFailure(message: string, firstFailure: string | undefined): TranscriptError {
  return new TranscriptError(
    message + (firstFailure ? ` First attempt failed with ${firstFailure}.` : ''),
  );
}
