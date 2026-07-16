import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../src/benchmark.js';
import { computeProviderStats } from '../src/report.js';
import { max, median, percentile } from '../src/stats.js';

describe('stats helpers (nearest-rank percentiles)', () => {
  it('handles the empty case', () => {
    expect(median([])).toBeUndefined();
    expect(percentile([], 95)).toBeUndefined();
    expect(max([])).toBeUndefined();
  });

  it('works with a single value (tiny sample, still computed)', () => {
    expect(median([7])).toBe(7);
    expect(percentile([7], 95)).toBe(7);
  });

  it('computes median and p95 with nearest rank', () => {
    expect(median([4, 1, 3, 2])).toBe(2);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(median([5, 1, 9])).toBe(5);
  });
});

function record(partial: Partial<RunRecord>): RunRecord {
  return {
    url: 'https://youtu.be/dQw4w9WgXcQ',
    videoId: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up',
    provider: 'supadata',
    status: 'success',
    transcriptStatus: 'success',
    summaryStatus: 'skipped',
    requestedLanguage: 'en',
    transcriptRetries: 0,
    summaryRetries: 0,
    ...partial,
  };
}

describe('computeProviderStats', () => {
  it('keeps cached runs completely separate from live statistics', () => {
    const stats = computeProviderStats([
      record({
        source: 'LIVE',
        summaryStatus: 'success',
        transcriptMs: 1000,
        summaryMs: 500,
        totalMs: 1500,
        withinDeadline: true,
      }),
      record({ source: 'CACHED', summaryStatus: 'success', summaryMs: 5 }),
      record({
        source: 'LIVE',
        status: 'failure',
        transcriptStatus: 'failure',
        transcriptMs: 14000,
        totalMs: 14000,
        withinDeadline: false,
        failureStage: 'transcript',
        failureReason: 'no captions',
      }),
    ]);
    const supadata = stats[0];
    expect(supadata?.attemptedLive).toBe(2);
    expect(supadata?.transcriptSuccessRate).toBe(0.5);
    expect(supadata?.transcriptTiming.medianMs).toBe(1000);
    expect(supadata?.cachedRuns).toBe(1);
    expect(supadata?.cachedSummaryTiming.medianMs).toBe(5);
    expect(supadata?.failedRuns).toHaveLength(1);
  });

  it('does not count a Gemini failure as a transcript failure', () => {
    const [stats] = computeProviderStats([
      record({
        source: 'LIVE',
        status: 'failure',
        transcriptStatus: 'success',
        summaryStatus: 'failure',
        transcriptMs: 120,
        summaryMs: 300,
        totalMs: 420,
        failureStage: 'summary',
        failureReason: 'Gemini unavailable',
      }),
    ]);
    expect(stats?.transcriptSuccesses).toBe(1);
    expect(stats?.transcriptFailures).toBe(0);
    expect(stats?.transcriptSuccessRate).toBe(1);
    expect(stats?.summaryAttempts).toBe(1);
    expect(stats?.summaryFailures).toBe(1);
    expect(stats?.summarySuccessRate).toBe(0);
    expect(stats?.transcriptTiming.medianMs).toBe(120);
  });

  it('bases provider speed only on transcript retrieval time', () => {
    const [stats] = computeProviderStats([
      record({
        source: 'LIVE',
        summaryStatus: 'success',
        transcriptMs: 100,
        summaryMs: 9000,
        totalMs: 9100,
        withinDeadline: true,
      }),
      record({
        source: 'LIVE',
        summaryStatus: 'success',
        transcriptMs: 200,
        summaryMs: 10,
        totalMs: 210,
        withinDeadline: true,
      }),
    ]);
    expect(stats?.transcriptTiming.medianMs).toBe(100);
    expect(stats?.transcriptTiming.slowestMs).toBe(200);
    expect(stats?.summaryTiming.slowestMs).toBe(9000);
    expect(stats?.totalTiming.slowestMs).toBe(9100);
  });

  it('counts skipped runs separately', () => {
    const [stats] = computeProviderStats([
      record({
        status: 'skipped',
        transcriptStatus: 'skipped',
        failureReason: 'API key missing',
      }),
    ]);
    expect(stats?.skipped).toBe(1);
    expect(stats?.attemptedLive).toBe(0);
    expect(stats?.transcriptSuccessRate).toBeUndefined();
  });

  it('reports providers separately', () => {
    const stats = computeProviderStats([
      record({ source: 'LIVE', transcriptMs: 100, totalMs: 100, withinDeadline: true }),
      record({
        provider: 'transcriptapi',
        source: 'LIVE',
        transcriptMs: 900,
        totalMs: 900,
        withinDeadline: true,
      }),
    ]);
    expect(stats).toHaveLength(2);
    expect(stats.map((item) => item.provider).sort()).toEqual(['supadata', 'transcriptapi']);
  });

  it('attributes transcript and Gemini retries separately', () => {
    const [stats] = computeProviderStats([
      record({ source: 'LIVE', transcriptMs: 100, transcriptRetries: 1 }),
      record({ source: 'LIVE', transcriptMs: 100, summaryRetries: 1 }),
    ]);
    expect(stats?.transcriptRetriedRuns).toBe(1);
    expect(stats?.summaryRetriedRuns).toBe(1);
  });
});
