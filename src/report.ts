import type { RunRecord } from './benchmark.js';
import { max, median, percentile } from './stats.js';

/**
 * Builds the per-provider terminal report. Cached runs are listed separately
 * and are NEVER mixed into the live timing statistics.
 */

export interface ProviderStats {
  provider: string;
  attemptedLive: number;
  successes: number;
  failures: number;
  skipped: number;
  cachedRuns: number;
  transcriptSuccessRate: number | undefined;
  summarySuccessRate: number | undefined;
  medianLiveMs: number | undefined;
  p95LiveMs: number | undefined;
  slowestLiveMs: number | undefined;
  withinDeadlineCount: number;
  withinDeadlinePct: number | undefined;
  retriedRuns: number;
  failedRuns: { url: string; reason: string }[];
  liveSampleSize: number;
}

export function computeProviderStats(records: RunRecord[]): ProviderStats[] {
  const providers = [...new Set(records.map((record) => record.provider))];
  return providers.map((provider) => {
    const all = records.filter((record) => record.provider === provider);
    const live = all.filter((record) => record.source === 'LIVE');
    const cached = all.filter((record) => record.source === 'CACHED');
    const skipped = all.filter((record) => record.status === 'skipped');
    const liveSuccesses = live.filter((record) => record.status === 'success');
    const liveFailures = live.filter((record) => record.status === 'failure');
    const liveTimes = live
      .map((record) => record.totalMs)
      .filter((ms): ms is number => ms !== undefined);
    const successTimes = liveSuccesses
      .map((record) => record.totalMs)
      .filter((ms): ms is number => ms !== undefined);
    const withinDeadline = live.filter((record) => record.withinDeadline === true);
    const summarized = liveSuccesses.filter((record) => record.verdict !== undefined);

    return {
      provider,
      attemptedLive: live.length,
      successes: liveSuccesses.length,
      failures: liveFailures.length,
      skipped: skipped.length,
      cachedRuns: cached.length,
      transcriptSuccessRate: live.length > 0 ? liveSuccesses.length / live.length : undefined,
      // Until Phase 3 adds summaries, no run has a verdict, so this stays undefined.
      summarySuccessRate:
        live.length > 0 && summarized.length > 0 ? summarized.length / live.length : undefined,
      medianLiveMs: median(successTimes),
      p95LiveMs: percentile(successTimes, 95),
      slowestLiveMs: max(liveTimes),
      withinDeadlineCount: withinDeadline.length,
      withinDeadlinePct: live.length > 0 ? withinDeadline.length / live.length : undefined,
      retriedRuns: live.filter((record) => record.retried).length,
      failedRuns: liveFailures.map((record) => ({
        url: record.url,
        reason: record.failureReason ?? 'unknown reason',
      })),
      liveSampleSize: successTimes.length,
    };
  });
}

function pct(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${Math.round(value * 100)}%`;
}

function ms(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${value} ms`;
}

export function formatReport(records: RunRecord[], timeoutMs: number): string {
  const lines: string[] = [];
  for (const stats of computeProviderStats(records)) {
    lines.push('');
    lines.push(`=== ${stats.provider} ===`);
    if (stats.cachedRuns > 0) {
      lines.push(`Cached runs (not part of any timing stats): ${stats.cachedRuns}`);
    }
    lines.push(`Attempted live runs:   ${stats.attemptedLive}`);
    lines.push(`  Successes:           ${stats.successes}`);
    lines.push(`  Failures:            ${stats.failures}`);
    lines.push(`  Skipped:             ${stats.skipped}`);
    lines.push(`Transcript success:    ${pct(stats.transcriptSuccessRate)}`);
    lines.push(`Completed summaries:   ${pct(stats.summarySuccessRate)}`);
    lines.push(
      `Live times (sample of ${stats.liveSampleSize} successful run${stats.liveSampleSize === 1 ? '' : 's'}):`,
    );
    lines.push(`  Median:              ${ms(stats.medianLiveMs)}`);
    lines.push(`  p95:                 ${ms(stats.p95LiveMs)}`);
    lines.push(`  Slowest (any run):   ${ms(stats.slowestLiveMs)}`);
    lines.push(
      `Within ${timeoutMs} ms:       ${stats.withinDeadlineCount} of ${stats.attemptedLive} (${pct(stats.withinDeadlinePct)})`,
    );
    lines.push(`Retried runs:          ${stats.retriedRuns}`);
    if (stats.failedRuns.length > 0) {
      lines.push('Failed videos:');
      for (const failure of stats.failedRuns) {
        lines.push(`  - ${failure.url}`);
        lines.push(`    ${failure.reason}`);
      }
    }
  }
  return lines.join('\n');
}
