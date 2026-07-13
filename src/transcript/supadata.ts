import { z } from 'zod';
import { fetchWithOneRetry } from '../http.js';
import type { RunContext } from '../run-context.js';
import { assertUsableTranscript, normalizeSegments } from './normalize.js';
import { TranscriptError } from './provider.js';
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
  content: z.array(
    z.object({
      text: z.string(),
      offset: z.number(),
      duration: z.number(),
      lang: z.string().optional(),
    }),
  ),
  lang: z.string().optional(),
  availableLangs: z.array(z.string()).optional(),
});

export class SupadataProvider implements TranscriptProvider {
  readonly name = 'supadata';

  constructor(private readonly apiKey: string) {}

  async fetchTranscript(videoId: string, ctx: RunContext): Promise<TranscriptResult> {
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const url =
      `https://api.supadata.ai/v1/transcript` +
      `?url=${encodeURIComponent(videoUrl)}&mode=native&text=false`;

    const { response } = await fetchWithOneRetry(
      url,
      { headers: { 'x-api-key': this.apiKey } },
      ctx,
    );

    if (response.status === 202) {
      throw new TranscriptError(
        'Supadata answered with an async job (video likely too long). This benchmark does not wait for jobs.',
      );
    }
    if (response.status === 206) {
      throw new TranscriptError('Supadata: this video has no existing captions (native mode).');
    }
    if (response.status === 401 || response.status === 403) {
      throw new TranscriptError('Supadata rejected the API key (check SUPADATA_API_KEY in .env).');
    }
    if (response.status === 404) {
      throw new TranscriptError('Supadata: video not found, private, or unavailable.');
    }
    if (!response.ok) {
      throw new TranscriptError(`Supadata request failed with HTTP status ${response.status}.`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TranscriptError('Supadata sent a response that was not valid JSON.');
    }

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) {
      throw new TranscriptError('Supadata sent a response in an unexpected format.');
    }

    const { text, segments } = normalizeSegments(
      parsed.data.content.map((segment) => ({
        text: segment.text,
        startMs: segment.offset,
        durationMs: segment.duration,
      })),
    );
    assertUsableTranscript(text, 'Supadata');

    const language = parsed.data.lang ?? parsed.data.content[0]?.lang ?? 'unknown';

    return {
      provider: this.name,
      videoId,
      language,
      text,
      segments,
      metadata: parsed.data.availableLangs
        ? { availableLangs: parsed.data.availableLangs }
        : undefined,
    };
  }
}
