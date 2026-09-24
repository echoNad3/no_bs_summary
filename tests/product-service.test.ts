import { describe, expect, it, vi } from 'vitest';
import { ProductError, SummaryService } from '../src/product/service.js';
import type { SummarizeResponse } from '../src/product/schema.js';
import type { SummaryCache, SummaryCacheIdentity } from '../src/product/summary-store.js';
import type { SummaryProvider } from '../src/summary/provider.js';
import type { TranscriptProvider } from '../src/transcript/provider.js';
import { MemoryTranscriptStore } from '../src/transcript/store.js';
import type { TranscriptStore } from '../src/transcript/store.js';

class MemorySummaryCache implements SummaryCache {
  private readonly entries = new Map<string, SummarizeResponse>();

  async read(identity: SummaryCacheIdentity): Promise<SummarizeResponse | undefined> {
    return this.entries.get(JSON.stringify(identity));
  }

  async write(identity: SummaryCacheIdentity, response: SummarizeResponse): Promise<void> {
    this.entries.set(JSON.stringify(identity), response);
  }
}

function service(
  overrides: {
    transcript?: TranscriptProvider;
    summary?: SummaryProvider;
    summaryCache?: SummaryCache;
    cache?: TranscriptStore;
    timeoutMs?: number;
  } = {},
) {
  const transcript: TranscriptProvider =
    overrides.transcript ??
    ({
      name: 'transcriptapi',
      fetchTranscript: vi.fn().mockResolvedValue({
        provider: 'transcriptapi',
        videoId: 'dQw4w9WgXcQ',
        language: 'en',
        text: 'Useful caption text.',
        segments: [{ text: 'Useful caption text.', startMs: 0, durationMs: 1000 }],
      }),
    } satisfies TranscriptProvider);
  const summary: SummaryProvider =
    overrides.summary ??
    ({
      name: 'gemini',
      summarize: vi.fn().mockResolvedValue({
        verdict: 'SKIP',
        reason: 'The useful part fits here.',
        summary: '- **Main point:** One useful fact.',
      }),
    } satisfies SummaryProvider);
  return {
    instance: new SummaryService({
      transcriptProvider: transcript,
      summaryProvider: summary,
      cache: overrides.cache ?? new MemoryTranscriptStore(),
      summaryCache: overrides.summaryCache ?? new MemorySummaryCache(),
      summaryModel: 'gemini-3.1-flash-lite',
      summaryPromptVersion: 'summary-first-test-v1',
      timeoutMs: overrides.timeoutMs ?? 15000,
    }),
    transcript,
    summary,
  };
}

describe('SummaryService', () => {
  it('runs the existing pipeline and returns only safe product fields', async () => {
    const { instance, summary } = service();
    const result = await instance.summarize({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      title: 'A video',
      language: 'en',
    });
    expect(result).toMatchObject({
      outputVersion: 2,
      verdict: 'SKIP',
      videoId: 'dQw4w9WgXcQ',
      language: 'en',
      source: 'LIVE',
      retries: { transcript: 0, summary: 0 },
    });
    expect(result).not.toHaveProperty('transcript');
    expect(JSON.stringify(result)).not.toContain('API_KEY');
    expect(summary.summarize).toHaveBeenCalledWith('Useful caption text.', expect.any(Object), {
      transcriptLanguage: 'en',
    });
  });

  it('returns the exact saved response to PWA- and extension-shaped requests', async () => {
    const { instance, transcript, summary } = service();
    const pwaResult = await instance.summarize({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      language: 'en',
    });
    const extensionResult = await instance.summarize({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up',
      language: 'en',
    });

    expect(extensionResult).toEqual(pwaResult);
    expect(pwaResult.source).toBe('LIVE');
    expect(transcript.fetchTranscript).toHaveBeenCalledTimes(1);
    expect(summary.summarize).toHaveBeenCalledTimes(1);
  });

  it('runs the live-generation guard only on a persistent summary-cache miss', async () => {
    const requestGuard = vi.fn().mockResolvedValue(undefined);
    const { instance } = service();
    const input = { url: 'https://youtu.be/dQw4w9WgXcQ', language: 'en' };

    await instance.summarize(input, { beforeGenerate: requestGuard });
    await instance.summarize(input, { beforeGenerate: requestGuard });

    expect(requestGuard).toHaveBeenCalledTimes(1);
  });

  it('keeps different caption languages in separate summary-cache entries', async () => {
    const transcript = {
      name: 'transcriptapi',
      fetchTranscript: vi.fn().mockImplementation(async (_videoId, _ctx, language = 'en') => ({
        provider: 'transcriptapi',
        videoId: 'dQw4w9WgXcQ',
        language,
        text: `Useful ${language} caption text.`,
      })),
    } satisfies TranscriptProvider;
    const { instance, summary } = service({ transcript });

    const english = await instance.summarize({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      language: 'en',
    });
    const german = await instance.summarize({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      language: 'de',
    });

    expect(english.language).toBe('en');
    expect(german.language).toBe('de');
    expect(transcript.fetchTranscript).toHaveBeenCalledTimes(2);
    expect(summary.summarize).toHaveBeenCalledTimes(2);
  });

  it('deduplicates simultaneous requests for one backend cache key', async () => {
    let releaseSummary!: (value: { verdict: 'WATCH'; reason: string; summary: string }) => void;
    const pendingSummary = new Promise<{
      verdict: 'WATCH';
      reason: string;
      summary: string;
    }>((resolve) => {
      releaseSummary = resolve;
    });
    const summary = {
      name: 'gemini',
      summarize: vi.fn().mockReturnValue(pendingSummary),
    } satisfies SummaryProvider;
    const { instance, transcript } = service({ summary });

    const pwaRequest = instance.summarize({ url: 'https://youtu.be/dQw4w9WgXcQ' });
    const extensionRequest = instance.summarize({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Same video from the extension',
    });
    releaseSummary({
      verdict: 'WATCH',
      reason: 'The delivery stays clear and entertaining throughout.',
      summary:
        '- **Promise:** The song promises loyalty and says the singer will never abandon his partner.',
    });

    const [pwaResult, extensionResult] = await Promise.all([pwaRequest, extensionRequest]);
    expect(extensionResult).toEqual(pwaResult);
    expect(transcript.fetchTranscript).toHaveBeenCalledTimes(1);
    expect(summary.summarize).toHaveBeenCalledTimes(1);
  });

  it('regenerates past the summary cache, reuses captions, charges once, and replaces the saved result', async () => {
    const summaryCache = new MemorySummaryCache();
    const summary = {
      name: 'gemini',
      summarize: vi
        .fn()
        .mockResolvedValueOnce({
          verdict: 'SKIM',
          reason: 'Useful, but padded.',
          summary: '- **Old answer:** The first saved result.',
        })
        .mockResolvedValueOnce({
          verdict: 'WATCH',
          reason: 'Clear and worth the time.',
          summary: '- **Fresh answer:** The replacement result.',
        }),
    } satisfies SummaryProvider;
    const { instance, transcript } = service({ summary, summaryCache });
    const beforeGenerate = vi.fn().mockResolvedValue(undefined);
    const input = { url: 'https://youtu.be/dQw4w9WgXcQ', language: 'en' };

    const first = await instance.summarize(input, { beforeGenerate });
    const cached = await instance.summarize(input, { beforeGenerate });
    const fresh = await instance.summarize({ ...input, regenerate: true }, { beforeGenerate });
    const replaced = await instance.summarize(input, { beforeGenerate });

    expect(first.summary).toContain('Old answer');
    expect(cached).toEqual(first);
    expect(fresh.summary).toContain('Fresh answer');
    expect(replaced).toEqual(fresh);
    expect(summary.summarize).toHaveBeenCalledTimes(2);
    expect(transcript.fetchTranscript).toHaveBeenCalledTimes(1);
    expect(beforeGenerate).toHaveBeenCalledTimes(2);
  });

  it('keeps the previous cached summary when regeneration fails', async () => {
    const summaryCache = new MemorySummaryCache();
    const summary = {
      name: 'gemini',
      summarize: vi
        .fn()
        .mockResolvedValueOnce({
          verdict: 'WATCH',
          reason: 'Clear and useful.',
          summary: '- **Saved answer:** Keep this result.',
        })
        .mockRejectedValueOnce(new Error('provider failed')),
    } satisfies SummaryProvider;
    const { instance } = service({ summary, summaryCache });
    const input = { url: 'https://youtu.be/dQw4w9WgXcQ', language: 'en' };
    const saved = await instance.summarize(input);

    await expect(instance.summarize({ ...input, regenerate: true })).rejects.toMatchObject({
      code: 'SUMMARY_FAILED',
    });
    await expect(instance.summarize(input)).resolves.toEqual(saved);
  });

  it('coalesces simultaneous regeneration requests into one paid generation', async () => {
    let release!: (value: { verdict: 'WATCH'; reason: string; summary: string }) => void;
    const summary = {
      name: 'gemini',
      summarize: vi.fn().mockReturnValue(
        new Promise<{ verdict: 'WATCH'; reason: string; summary: string }>((resolve) => {
          release = resolve;
        }),
      ),
    } satisfies SummaryProvider;
    const { instance } = service({ summary });
    const beforeFirst = vi.fn().mockResolvedValue(undefined);
    const beforeSecond = vi.fn().mockResolvedValue(undefined);
    const input = {
      url: 'https://youtu.be/dQw4w9WgXcQ',
      language: 'en',
      regenerate: true,
    };

    const first = instance.summarize(input, { beforeGenerate: beforeFirst });
    const second = instance.summarize(input, { beforeGenerate: beforeSecond });
    release({
      verdict: 'WATCH',
      reason: 'Clear and useful.',
      summary: '- **Fresh answer:** One regenerated result.',
    });

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(summary.summarize).toHaveBeenCalledTimes(1);
    expect(beforeFirst).toHaveBeenCalledTimes(1);
    expect(beforeSecond).not.toHaveBeenCalled();
  });

  it('rejects bad URLs before calling a provider', async () => {
    const { instance, transcript } = service();
    await expect(instance.summarize({ url: 'https://example.com/nope' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_YOUTUBE_URL',
    } satisfies Partial<ProductError>);
    expect(transcript.fetchTranscript).not.toHaveBeenCalled();
  });

  it('maps transcript and summary failures to separate public errors', async () => {
    const transcript = {
      name: 'transcriptapi',
      fetchTranscript: vi.fn().mockRejectedValue(new Error('no captions')),
    } satisfies TranscriptProvider;
    await expect(
      service({ transcript }).instance.summarize({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
    ).rejects.toMatchObject({
      code: 'TRANSCRIPT_FAILED',
      statusCode: 502,
      message: 'No captions are available for this video.',
    });

    const summary = {
      name: 'gemini',
      summarize: vi.fn().mockRejectedValue(new Error('summary failed')),
    } satisfies SummaryProvider;
    await expect(
      service({ summary }).instance.summarize({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
    ).rejects.toMatchObject({
      code: 'SUMMARY_FAILED',
      statusCode: 502,
      message: 'Could not create a valid short summary. Try again.',
    });
  });

  it('identifies a model attempt timeout without claiming the global deadline passed', async () => {
    const summary = {
      name: 'gemini',
      summarize: vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')),
    } satisfies SummaryProvider;

    await expect(
      service({ summary }).instance.summarize({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
    ).rejects.toMatchObject({
      statusCode: 504,
      code: 'SUMMARY_TIMEOUT',
      message: 'The summary service took too long. Try again.',
    } satisfies Partial<ProductError>);
  });

  it('stops waiting at the global deadline when a model ignores abort', async () => {
    const summary = {
      name: 'gemini',
      summarize: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    } satisfies SummaryProvider;
    const { instance } = service({ summary, timeoutMs: 30 });

    await expect(instance.summarize({ url: 'https://youtu.be/dQw4w9WgXcQ' })).rejects.toMatchObject(
      {
        statusCode: 504,
        code: 'DEADLINE_EXCEEDED',
      } satisfies Partial<ProductError>,
    );
  });

  it('identifies model rate limits through a pipeline failure', async () => {
    const summary = {
      name: 'gemini',
      summarize: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('rate limited'), { statusCode: 429 })),
    } satisfies SummaryProvider;
    const { instance } = service({ summary });

    await expect(instance.summarize({ url: 'https://youtu.be/dQw4w9WgXcQ' })).rejects.toMatchObject(
      {
        statusCode: 503,
        code: 'MODEL_RATE_LIMITED',
      } satisfies Partial<ProductError>,
    );
  });

  it('returns completed paid work even when the optional cache write fails', async () => {
    const summaryCache: SummaryCache = {
      read: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockRejectedValue(new Error('KV unavailable')),
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      service({ summaryCache }).instance.summarize({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
    ).resolves.toMatchObject({
      verdict: 'SKIP',
      summary: '- **Main point:** One useful fact.',
    });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('summary_cache_write_failed'));
    warning.mockRestore();
  });

  it('continues from fetched captions when their cache write stalls', async () => {
    const cache: TranscriptStore = {
      read: async () => undefined,
      write: () => new Promise(() => undefined),
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { instance, summary } = service({ cache });

    await expect(
      instance.summarize({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
    ).resolves.toMatchObject({
      verdict: 'SKIP',
    });
    expect(summary.summarize).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('transcript_cache_write_failed'));
    warning.mockRestore();
  });

  it('bounds a stalled saved-summary read before reserving a generation', async () => {
    const summaryCache: SummaryCache = {
      read: () => new Promise(() => undefined),
      write: vi.fn(),
    };
    const { instance, transcript } = service({ summaryCache });
    // The real service uses a shorter cache-stage deadline than its overall budget.
    const pending = instance.summarize({ url: 'https://youtu.be/dQw4w9WgXcQ' });
    await expect(pending).rejects.toMatchObject({ code: 'SUMMARY_CACHE_FAILED' });
    expect(transcript.fetchTranscript).not.toHaveBeenCalled();
  }, 4_000);

  it('does not start paid work after a quota reservation stalls', async () => {
    const { instance, transcript } = service();
    const pending = instance.summarize(
      { url: 'https://youtu.be/dQw4w9WgXcQ' },
      { beforeGenerate: () => new Promise(() => undefined) },
    );
    await expect(pending).rejects.toMatchObject({ code: 'QUOTA_UNAVAILABLE' });
    expect(transcript.fetchTranscript).not.toHaveBeenCalled();
  }, 7_000);

  it('returns a completed summary when its persistent cache write stalls', async () => {
    const summaryCache: SummaryCache = {
      read: async () => undefined,
      write: () => new Promise(() => undefined),
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { instance } = service({ summaryCache });
    await expect(
      instance.summarize({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
    ).resolves.toMatchObject({
      verdict: 'SKIP',
    });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('summary_cache_write_failed'));
    warning.mockRestore();
  }, 3_000);
});
