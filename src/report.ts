import type { FailureStage, RunRecord } from './benchmark.js';
import { max, median, percentile } from './stats.js';

/** LIVE and CACHED records are summarized independently. */

export interface TimingStats {
  sampleSize: number;
  medianMs: number | undefined;
  p95Ms: number | undefined;
  slowestMs: number | undefined;
}

export interface ProviderStats {
  provider: string;
  skipped: number;
  attemptedLive: number;
  transcriptSuccesses: number;
  transcriptFailures: number;
  transcriptSuccessRate: number | undefined;
  summaryAttempts: number;
  summarySuccesses: number;
  summaryFailures: number;
  summarySuccessRate: number | undefined;
  endToEndSuccesses: number;
  transcriptTiming: TimingStats;
  summaryTiming: TimingStats;
  totalTiming: TimingStats;
  withinDeadlineCount: number;
  withinDeadlinePct: number | undefined;
  transcriptRetriedRuns: number;
  summaryRetriedRuns: number;
  failedRuns: { url: string; stage: FailureStage | 'unknown'; reason: string }[];
  cachedRuns: number;
  cachedSummaryAttempts: number;
  cachedSummarySuccesses: number;
  cachedSummaryFailures: number;
  cachedSummaryTiming: TimingStats;
  cachedFailedRuns: { url: string; reason: string }[];
}

export function computeProviderStats(records: RunRecord[]): ProviderStats[] {
  const providers = [...new Set(records.map((record) => record.provider))];
  return providers.map((provider) => {
    const all = records.filter((record) => record.provider === provider);
    const live = all.filter((record) => record.source === 'LIVE');
    const cached = all.filter((record) => record.source === 'CACHED');
    const transcriptSuccesses = live.filter((record) => record.transcriptStatus === 'success');
    const transcriptFailures = live.filter((record) => record.transcriptStatus === 'failure');
    const summaryAttempts = live.filter((record) => record.summaryStatus !== 'skipped');
    const summarySuccesses = summaryAttempts.filter((record) => record.summaryStatus === 'success');
    const summaryFailures = summaryAttempts.filter((record) => record.summaryStatus === 'failure');
    const endToEndSuccesses = live.filter((record) => record.status === 'success');
    const cachedSummaryAttempts = cached.filter((record) => record.summaryStatus !== 'skipped');
    const cachedSummarySuccesses = cachedSummaryAttempts.filter(
      (record) => record.summaryStatus === 'success',
    );
    const cachedSummaryFailures = cachedSummaryAttempts.filter(
      (record) => record.summaryStatus === 'failure',
    );

    return {
      provider,
      skipped: all.filter((record) => record.status === 'skipped').length,
      attemptedLive: live.length,
      transcriptSuccesses: transcriptSuccesses.length,
      transcriptFailures: transcriptFailures.length,
      transcriptSuccessRate: rate(transcriptSuccesses.length, live.length),
      summaryAttempts: summaryAttempts.length,
      summarySuccesses: summarySuccesses.length,
      summaryFailures: summaryFailures.length,
      summarySuccessRate: rate(summarySuccesses.length, summaryAttempts.length),
      endToEndSuccesses: endToEndSuccesses.length,
      // Provider speed is based ONLY on successful live transcript retrieval time.
      transcriptTiming: timing(transcriptSuccesses, 'transcriptMs'),
      summaryTiming: timing(summarySuccesses, 'summaryMs'),
      totalTiming: timing(endToEndSuccesses, 'totalMs'),
      withinDeadlineCount: live.filter((record) => record.withinDeadline === true).length,
      withinDeadlinePct: rate(
        live.filter((record) => record.withinDeadline === true).length,
        live.length,
      ),
      transcriptRetriedRuns: live.filter((record) => record.transcriptRetries > 0).length,
      summaryRetriedRuns: live.filter((record) => record.summaryRetries > 0).length,
      failedRuns: live
        .filter((record) => record.status === 'failure')
        .map((record) => ({
          url: record.url,
          stage: record.failureStage ?? 'unknown',
          reason: record.failureReason ?? 'unknown reason',
        })),
      cachedRuns: cached.length,
      cachedSummaryAttempts: cachedSummaryAttempts.length,
      cachedSummarySuccesses: cachedSummarySuccesses.length,
      cachedSummaryFailures: cachedSummaryFailures.length,
      cachedSummaryTiming: timing(cachedSummarySuccesses, 'summaryMs'),
      cachedFailedRuns: cached
        .filter((record) => record.status === 'failure')
        .map((record) => ({
          url: record.url,
          reason: record.failureReason ?? 'unknown reason',
        })),
    };
  });
}

function rate(successes: number, attempts: number): number | undefined {
  return attempts === 0 ? undefined : successes / attempts;
}

function timing(
  records: RunRecord[],
  field: 'transcriptMs' | 'summaryMs' | 'totalMs',
): TimingStats {
  const values = records
    .map((record) => record[field])
    .filter((value): value is number => value !== undefined);
  return {
    sampleSize: values.length,
    medianMs: median(values),
    p95Ms: percentile(values, 95),
    slowestMs: max(values),
  };
}

function pct(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${Math.round(value * 100)}%`;
}

function ms(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${value} ms`;
}

function timingLines(label: string, stats: TimingStats): string[] {
  const runs = stats.sampleSize === 1 ? 'run' : 'runs';
  return [
    `${label} (sample of ${stats.sampleSize} successful ${runs}):`,
    `  Median:              ${ms(stats.medianMs)}`,
    `  p95:                 ${ms(stats.p95Ms)}`,
    `  Slowest:             ${ms(stats.slowestMs)}`,
  ];
}

export function formatReport(records: RunRecord[], timeoutMs: number): string {
  const lines: string[] = [];
  for (const stats of computeProviderStats(records)) {
    lines.push('');
    lines.push(`=== ${stats.provider} ===`);
    lines.push('LIVE transcript retrieval:');
    lines.push(`  Attempted:            ${stats.attemptedLive}`);
    lines.push(`  Successes:            ${stats.transcriptSuccesses}`);
    lines.push(`  Failures:             ${stats.transcriptFailures}`);
    lines.push(`  Success rate:         ${pct(stats.transcriptSuccessRate)}`);
    lines.push(...timingLines('Transcript retrieval time', stats.transcriptTiming));
    lines.push(`Transcript retries:     ${stats.transcriptRetriedRuns} run(s)`);
    lines.push('LIVE Gemini summaries:');
    lines.push(`  Attempted:            ${stats.summaryAttempts}`);
    lines.push(`  Successes:            ${stats.summarySuccesses}`);
    lines.push(`  Failures:             ${stats.summaryFailures}`);
    lines.push(`  Success rate:         ${pct(stats.summarySuccessRate)}`);
    lines.push(...timingLines('Gemini summary time', stats.summaryTiming));
    lines.push(`Gemini retries:         ${stats.summaryRetriedRuns} run(s)`);
    lines.push(...timingLines('End-to-end live time', stats.totalTiming));
    lines.push(`End-to-end successes:   ${stats.endToEndSuccesses}`);
    lines.push(
      `Within ${timeoutMs} ms:       ${stats.withinDeadlineCount} of ${stats.attemptedLive} (${pct(stats.withinDeadlinePct)})`,
    );
    lines.push(`Skipped (missing key):  ${stats.skipped}`);

    if (stats.failedRuns.length > 0) {
      lines.push('LIVE failures:');
      for (const failure of stats.failedRuns) {
        lines.push(`  - ${failure.url} (${failure.stage})`);
        lines.push(`    ${failure.reason}`);
      }
    }

    if (stats.cachedRuns > 0) {
      lines.push('CACHED runs (never included above):');
      lines.push(`  Runs:                 ${stats.cachedRuns}`);
      lines.push(`  Gemini attempts:      ${stats.cachedSummaryAttempts}`);
      lines.push(`  Gemini successes:     ${stats.cachedSummarySuccesses}`);
      lines.push(`  Gemini failures:      ${stats.cachedSummaryFailures}`);
      lines.push(...timingLines('Cached-run Gemini time', stats.cachedSummaryTiming));
      for (const failure of stats.cachedFailedRuns) {
        lines.push(`  - ${failure.url}`);
        lines.push(`    ${failure.reason}`);
      }
    }
  }
  return lines.join('\n');
}
