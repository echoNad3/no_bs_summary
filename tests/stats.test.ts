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
    expect(median([4, 1, 3, 2])).toBe(2); // rank ceil(0.5*4)=2 → 2nd smallest
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(median([5, 1, 9])).toBe(5);
  });
});

function record(partial: Partial<RunRecord>): RunRecord {
  return {
    url: 'https://youtu.be/dQw4w9WgXcQ',
    videoId: 'dQw4w9WgXcQ',
    provider: 'supadata',
    status: 'success',
    retried: false,
    ...partial,
  };
}

describe('computeProviderStats', () => {
  it('keeps cached runs out of the live statistics', () => {
    const stats = computeProviderStats([
      record({ source: 'LIVE', totalMs: 1000, withinDeadline: true }),
      record({ source: 'CACHED' }), // must not affect timings or rates
      record({
        source: 'LIVE',
        status: 'failure',
        totalMs: 15000,
        withinDeadline: false,
        failureReason: 'no captions',
      }),
    ]);
    const supadata = stats.find((s) => s.provider === 'supadata');
    expect(supadata?.attemptedLive).toBe(2);
    expect(supadata?.successes).toBe(1);
    expect(supadata?.failures).toBe(1);
    expect(supadata?.cachedRuns).toBe(1);
    expect(supadata?.transcriptSuccessRate).toBe(0.5);
    expect(supadata?.medianLiveMs).toBe(1000); // cached run not included
    expect(supadata?.slowestLiveMs).toBe(15000);
    expect(supadata?.withinDeadlineCount).toBe(1);
    expect(supadata?.failedRuns).toHaveLength(1);
  });

  it('counts skipped runs separately', () => {
    const stats = computeProviderStats([
      record({ status: 'skipped', failureReason: 'API key missing' }),
    ]);
    expect(stats[0]?.skipped).toBe(1);
    expect(stats[0]?.attemptedLive).toBe(0);
    expect(stats[0]?.transcriptSuccessRate).toBeUndefined();
  });

  it('reports providers separately', () => {
    const stats = computeProviderStats([
      record({ source: 'LIVE', totalMs: 100, withinDeadline: true }),
      record({ provider: 'transcriptapi', source: 'LIVE', totalMs: 900, withinDeadline: true }),
    ]);
    expect(stats).toHaveLength(2);
    expect(stats.map((s) => s.provider).sort()).toEqual(['supadata', 'transcriptapi']);
  });

  it('counts retried runs', () => {
    const stats = computeProviderStats([
      record({ source: 'LIVE', totalMs: 100, retried: true, withinDeadline: true }),
      record({ source: 'LIVE', totalMs: 100, withinDeadline: true }),
    ]);
    expect(stats[0]?.retriedRuns).toBe(1);
  });
});
