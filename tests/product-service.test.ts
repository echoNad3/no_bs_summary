import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptCache } from '../src/cache.js';
import { ProductError, SummaryService } from '../src/product/service.js';
import { FileSummaryCache } from '../src/product/summary-cache.js';
import type { SummaryProvider } from '../src/summary/provider.js';
import type { TranscriptProvider } from '../src/transcript/provider.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nbs-product-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function service(overrides: { transcript?: TranscriptProvider; summary?: SummaryProvider } = {}) {
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
      cache: new TranscriptCache(dir),
      summaryCache: new FileSummaryCache(path.join(dir, 'summaries')),
      summaryModel: 'gemini-3.1-flash-lite',
      summaryPromptVersion: 'summary-first-test-v1',
      timeoutMs: 15000,
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

  it('keeps an internal regenerate seam that replaces the saved response', async () => {
    const summary = {
      name: 'gemini',
      summarize: vi
        .fn()
        .mockResolvedValueOnce({
          verdict: 'WATCH',
          reason: 'The delivery is catchy and commits fully to the bit.',
          summary: 'The singer promises that he will stay loyal to his partner.',
        })
        .mockResolvedValueOnce({
          verdict: 'SKIM',
          reason: 'The hook is catchy, but the same promise repeats too often.',
          summary: 'The lyrics repeatedly promise loyalty and refusing to abandon a partner.',
        }),
    } satisfies SummaryProvider;
    const { instance } = service({ summary });
    const input = { url: 'https://youtu.be/dQw4w9WgXcQ' };

    const first = await instance.summarize(input);
    const regenerated = await instance.summarize(input, { regenerate: true });
    const saved = await instance.summarize(input);

    expect(first.verdict).toBe('WATCH');
    expect(regenerated.verdict).toBe('SKIM');
    expect(saved).toEqual(regenerated);
    expect(summary.summarize).toHaveBeenCalledTimes(2);
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
