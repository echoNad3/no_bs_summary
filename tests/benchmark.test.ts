import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBenchmark } from '../src/benchmark.js';
import { cacheKey, TranscriptCache } from '../src/cache.js';
import type { RunContext } from '../src/run-context.js';
import type { Summary, SummaryProvider } from '../src/summary/provider.js';
import type { TranscriptProvider, TranscriptResult } from '../src/transcript/provider.js';

const VIDEO = { url: 'https://youtu.be/dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ' };

function fakeTranscript(provider: string): TranscriptResult {
  return {
    provider,
    videoId: VIDEO.videoId,
    language: 'en',
    text: 'hello world',
  };
}

function okProvider(name = 'fake'): TranscriptProvider {
  return {
    name,
    fetchTranscript: vi.fn().mockResolvedValue(fakeTranscript(name)),
  };
}

/** A provider that hangs until the deadline aborts it. */
function slowProvider(name = 'slow'): TranscriptProvider {
  return {
    name,
    fetchTranscript: (_videoId: string, ctx: RunContext) =>
      new Promise<TranscriptResult>((_, reject) => {
        ctx.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  };
}

const FAKE_SUMMARY: Summary = {
  verdict: 'SKIM',
  reason: 'Useful core, padded edges.',
  summary: 'Main point: X. Rest is padding.',
};

function okSummaryProvider(): SummaryProvider {
  return { name: 'fake-gemini', summarize: vi.fn().mockResolvedValue(FAKE_SUMMARY) };
}

/** A summary provider that hangs until the deadline aborts it. */
function slowSummaryProvider(): SummaryProvider {
  return {
    name: 'slow-gemini',
    summarize: (_text: string, ctx: RunContext) =>
      new Promise<Summary>((_, reject) => {
        ctx.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  };
}

let dir: string;
let cache: TranscriptCache;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nbs-bench-test-'));
  cache = new TranscriptCache(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('runBenchmark', () => {
  it('marks providers without a key as skipped instead of crashing', async () => {
    const records = await runBenchmark({
      videos: [VIDEO],
      providers: [{ name: 'supadata', skippedReason: 'SUPADATA_API_KEY is missing in .env' }],
      cache,
      useCache: true,
      timeoutMs: 1000,
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe('skipped');
    expect(records[0]?.failureReason).toContain('missing');
  });

  it('labels a fresh fetch as LIVE and stores it in the cache', async () => {
    const provider = okProvider();
    const records = await runBenchmark({
      videos: [VIDEO],
      providers: [{ name: provider.name, provider }],
      cache,
      useCache: true,
      timeoutMs: 5000,
    });
    expect(records[0]?.status).toBe('success');
    expect(records[0]?.source).toBe('LIVE');
    expect(records[0]?.withinDeadline).toBe(true);
    expect(records[0]?.transcriptChars).toBe('hello world'.length);
    expect(await cache.read(cacheKey(provider.name, VIDEO.videoId))).toBeTruthy();
  });

  it('labels a repeat run as CACHED and does not call the provider', async () => {
    const provider = okProvider();
    await cache.write(cacheKey(provider.name, VIDEO.videoId), fakeTranscript(provider.name));
    const records = await runBenchmark({
      videos: [VIDEO],
      providers: [{ name: provider.name, provider }],
      cache,
      useCache: true,
      timeoutMs: 5000,
    });
    expect(records[0]?.source).toBe('CACHED');
    expect(records[0]?.status).toBe('success');
    expect(provider.fetchTranscript).not.toHaveBeenCalled();
  });

  it('ignores the cache when useCache is false', async () => {
    const provider = okProvider();
    await cache.write(cacheKey(provider.name, VIDEO.videoId), fakeTranscript(provider.name));
    const records = await runBenchmark({
      videos: [VIDEO],
      providers: [{ name: provider.name, provider }],
      cache,
      useCache: false,
      timeoutMs: 5000,
    });
    expect(records[0]?.source).toBe('LIVE');
    expect(provider.fetchTranscript).toHaveBeenCalledTimes(1);
  });

  it('stops a run at the deadline and reports the stage', async () => {
    const provider = slowProvider();
    const records = await runBenchmark({
      videos: [VIDEO],
      providers: [{ name: provider.name, provider }],
      cache,
      useCache: false,
      timeoutMs: 50,
    });
    expect(records[0]?.status).toBe('failure');
    expect(records[0]?.failureStage).toBe('transcript');
    expect(records[0]?.failureReason).toContain('Ran out of time');
    expect(records[0]?.withinDeadline).toBe(false);
  });

  it('adds a summary to a LIVE run inside the same deadline', async () => {
    const provider = okProvider();
    const summaryProvider = okSummaryProvider();
    const records = await runBenchmark({
      videos: [VIDEO],
      providers: [{ name: provider.name, provider }],
      cache,
      useCache: false,
      timeoutMs: 5000,
      summaryProvider,
    });
    const record = records[0];
    expect(record?.status).toBe('success');
    expect(record?.verdict).toBe('SKIM');
    expect(record?.reason).toBe(FAKE_SUMMARY.reason);
    expect(record?.summary).toBe(FAKE_SUMMARY.summary);
    expect(record?.summaryMs).toBeGreaterThanOrEqual(0);
    expect(record?.totalMs).toBeGreaterThanOrEqual(record?.summaryMs ?? 0);
    expect(summaryProvider.summarize).toHaveBeenCalledWith('hello world', expect.anything());
  });

  it('reports a summary failure with the summary stage', async () => {
    const provider = okProvider();
    const failing: SummaryProvider = {
      name: 'failing-gemini',
      summarize: vi.fn().mockRejectedValue(new Error('Gemini returned no text.')),
    };
    const records = await runBenchmark({
      videos: [VIDEO],
      providers: [{ name: provider.name, provider }],
      cache,
      useCache: false,
      timeoutMs: 5000,
      summaryProvider: failing,
    });
    expect(records[0]?.status).toBe('failure');
    expect(records[0]?.failureStage).toBe('summary');
    expect(records[0]?.failureReason).toContain('no text');
  });

  it('reports the summary stage when the deadline hits during the summary', async () => {
    const provider = okProvider();
    const records = await runBenchmark({
      videos: [VIDEO],
      providers: [{ name: provider.name, provider }],
      cache,
      useCache: false,
      timeoutMs: 50,
      summaryProvider: slowSummaryProvider(),
    });
    expect(records[0]?.status).toBe('failure');
    expect(records[0]?.failureStage).toBe('summary');
    expect(records[0]?.failureReason).toContain('summary stage');
    expect(records[0]?.withinDeadline).toBe(false);
  });

  it('still summarizes a CACHED transcript (kept out of live stats)', async () => {
    const provider = okProvider();
    await cache.write(cacheKey(provider.name, VIDEO.videoId), fakeTranscript(provider.name));
    const summaryProvider = okSummaryProvider();
    const records = await runBenchmark({
      videos: [VIDEO],
      providers: [{ name: provider.name, provider }],
      cache,
      useCache: true,
      timeoutMs: 5000,
      summaryProvider,
    });
    const record = records[0];
    expect(record?.source).toBe('CACHED');
    expect(record?.status).toBe('success');
    expect(record?.verdict).toBe('SKIM');
    expect(record?.withinDeadline).toBeUndefined(); // never counted as a live run
    expect(provider.fetchTranscript).not.toHaveBeenCalled();
    expect(summaryProvider.summarize).toHaveBeenCalledWith('hello world', expect.anything());
  });

  it('never falls back from one provider to another', async () => {
    const failing: TranscriptProvider = {
      name: 'failing',
      fetchTranscript: vi.fn().mockRejectedValue(new Error('no captions')),
    };
    const working = okProvider('working');
    const records = await runBenchmark({
      videos: [VIDEO],
      providers: [
        { name: failing.name, provider: failing },
        { name: working.name, provider: working },
      ],
      cache,
      useCache: false,
      timeoutMs: 5000,
    });
    // Each provider is tested independently: one failure, one success.
    expect(records.map((record) => record.status).sort()).toEqual(['failure', 'success']);
    expect(failing.fetchTranscript).toHaveBeenCalledTimes(1);
    expect(working.fetchTranscript).toHaveBeenCalledTimes(1);
  });
});
