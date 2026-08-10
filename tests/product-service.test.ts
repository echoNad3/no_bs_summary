import { describe, expect, it, vi } from 'vitest';
import { ProductError, SummaryService } from '../src/product/service.js';
import type { SummarizeResponse } from '../src/product/schema.js';
import type { SummaryCache, SummaryCacheIdentity } from '../src/product/summary-store.js';
import type { SummaryProvider } from '../src/summary/provider.js';
import type { TranscriptProvider } from '../src/transcript/provider.js';
import { MemoryTranscriptStore } from '../src/transcript/store.js';

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
    beforeGenerate?: () => Promise<void>;
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
        summary: 'One useful fact.',
      }),
    } satisfies SummaryProvider);
  return {
    instance: new SummaryService({
      transcriptProvider: transcript,
      summaryProvider: summary,
      cache: new MemoryTranscriptStore(),
      summaryCache: new MemorySummaryCache(),
      summaryModel: 'gemini-3.1-flash-lite',
      summaryPromptVersion: 'summary-first-test-v1',
      timeoutMs: 15000,
      beforeGenerate: overrides.beforeGenerate,
    }),
    transcript,
    summary,
  };
}

describe('SummaryService', () => {
  it('runs the existing pipeline and returns only safe product fields', async () => {
    const { instance } = service();
    const result = await instance.summarize({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      title: 'A video',
      language: 'en',
    });
    expect(result).toMatchObject({
      verdict: 'SKIP',
      videoId: 'dQw4w9WgXcQ',
      language: 'en',
      source: 'LIVE',
      retries: { transcript: 0, summary: 0 },
    });
    expect(result).not.toHaveProperty('transcript');
    expect(JSON.stringify(result)).not.toContain('API_KEY');
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
    const beforeGenerate = vi.fn().mockResolvedValue(undefined);
    const { instance } = service({ beforeGenerate });
    const input = { url: 'https://youtu.be/dQw4w9WgXcQ', language: 'en' };

    await instance.summarize(input);
    await instance.summarize(input);

    expect(beforeGenerate).toHaveBeenCalledTimes(1);
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
      summary: 'The song promises loyalty and says the singer will never abandon his partner.',
    });

    const [pwaResult, extensionResult] = await Promise.all([pwaRequest, extensionRequest]);
    expect(extensionResult).toEqual(pwaResult);
    expect(transcript.fetchTranscript).toHaveBeenCalledTimes(1);
    expect(summary.summarize).toHaveBeenCalledTimes(1);
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
    ).rejects.toMatchObject({ code: 'TRANSCRIPT_FAILED', statusCode: 502 });

    const summary = {
      name: 'gemini',
      summarize: vi.fn().mockRejectedValue(new Error('summary failed')),
    } satisfies SummaryProvider;
    await expect(
      service({ summary }).instance.summarize({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
    ).rejects.toMatchObject({ code: 'SUMMARY_FAILED', statusCode: 502 });
  });
});
