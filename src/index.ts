import path from 'node:path';
import { runBenchmark } from './benchmark.js';
import type { ProviderEntry } from './benchmark.js';
import { TranscriptCache } from './cache.js';
import { parseCliArgs } from './cli.js';
import { loadConfig } from './config.js';
import { formatReport } from './report.js';
import { collectRuntimeProvenance, saveResults } from './results.js';
import { GEMINI_PROMPT_VERSION, GeminiSummaryProvider } from './summary/gemini.js';
import { TranscriptApiProvider } from './transcript/transcriptapi.js';
import { loadVideos } from './videos.js';

/**
 * Benchmark entry point.
 *
 * Flags:
 *   --no-cache     always fetch transcripts live (real latency numbers)
 *   --cache-only   run Gemini only; fail rather than fetch on a cache miss
 *   --clear-cache  delete the local transcript cache and exit
 */

const CACHE_DIR = path.resolve('.cache');
const RESULTS_DIR = path.resolve('results');
const VIDEOS_FILE = path.resolve('videos.json');

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const cache = new TranscriptCache(CACHE_DIR);

  if (cli.clearCache) {
    await cache.clear();
    console.log('Transcript cache cleared.');
    return;
  }

  const config = loadConfig();
  const videos = await loadVideos(VIDEOS_FILE);
  const runtime = await collectRuntimeProvenance();
  const useCache = cli.useCache;

  // Supadata remains implemented and tested, but is intentionally not active.
  const providers: ProviderEntry[] = cli.cacheOnly
    ? [{ name: 'transcriptapi', skippedReason: 'Cache-only mode' }]
    : [
        config.TRANSCRIPTAPI_API_KEY
          ? {
              name: 'transcriptapi',
              provider: new TranscriptApiProvider(config.TRANSCRIPTAPI_API_KEY),
            }
          : { name: 'transcriptapi', skippedReason: 'TRANSCRIPTAPI_API_KEY is missing in .env' },
      ];

  const summaryProvider = config.GEMINI_API_KEY
    ? new GeminiSummaryProvider(config.GEMINI_API_KEY, config.GEMINI_MODEL)
    : undefined;
  if (!summaryProvider) {
    console.log('Note: GEMINI_API_KEY is missing in .env — transcripts only, no summaries.');
  }

  console.log(
    `Benchmarking ${videos.length} video${videos.length === 1 ? '' : 's'} × ` +
      `TranscriptAPI (${cli.cacheOnly ? 'cache only' : `cache ${useCache ? 'on' : 'off'}`}, ` +
      `deadline ${config.END_TO_END_TIMEOUT_MS} ms` +
      `${
        summaryProvider
          ? `, model ${config.GEMINI_MODEL}, pacing ${config.GEMINI_PACING_MS} ms outside measured runs`
          : ''
      })…`,
  );

  const records = await runBenchmark({
    videos,
    providers,
    cache,
    useCache,
    cacheOnly: cli.cacheOnly,
    timeoutMs: config.END_TO_END_TIMEOUT_MS,
    interRunDelayMs: config.GEMINI_PACING_MS,
    summaryProvider,
  });

  for (const record of records) {
    if (record.verdict) {
      console.log(`\n[${record.provider} | ${record.source}] ${record.title}`);
      console.log(record.url);
      console.log(`${record.verdict} — ${record.reason}`);
      console.log(record.summary);
      console.log(
        record.source === 'CACHED'
          ? `Gemini time: ${record.summaryMs ?? 'n/a'} ms (cached transcript)`
          : `Measured total: ${record.totalMs ?? 'n/a'} ms`,
      );
      if (record.summaryInputTokens !== undefined && record.summaryOutputTokens !== undefined) {
        console.log(
          `Tokens: ${record.summaryInputTokens} input, ${record.summaryOutputTokens} output, ` +
            `${record.summaryThoughtTokens ?? 0} thinking`,
        );
      }
    }
  }

  console.log(formatReport(records, config.END_TO_END_TIMEOUT_MS));

  const resultsFile = await saveResults(
    RESULTS_DIR,
    records,
    {
      transcriptProvider: 'transcriptapi',
      timeoutMs: config.END_TO_END_TIMEOUT_MS,
      useCache,
      cacheOnly: cli.cacheOnly,
      model: config.GEMINI_MODEL,
      summaryEnabled: summaryProvider !== undefined,
      promptVersion: GEMINI_PROMPT_VERSION,
      providerOrder: providers.map((provider) => provider.name),
      geminiPacingMs: config.GEMINI_PACING_MS,
    },
    runtime,
  );
  console.log(`\nFull results saved to: ${resultsFile}`);
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
