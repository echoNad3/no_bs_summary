import path from 'node:path';
import { runBenchmark } from './benchmark.js';
import type { ProviderEntry } from './benchmark.js';
import { TranscriptCache } from './cache.js';
import { loadConfig } from './config.js';
import { formatReport } from './report.js';
import { saveResults } from './results.js';
import { SupadataProvider } from './transcript/supadata.js';
import { TranscriptApiProvider } from './transcript/transcriptapi.js';
import { loadVideos } from './videos.js';

/**
 * Benchmark entry point.
 *
 * Flags:
 *   --no-cache     always fetch transcripts live (real latency numbers)
 *   --clear-cache  delete the local transcript cache and exit
 *
 * Phase 2: transcript benchmark only. The Gemini summary stage (Phase 3)
 * will plug into the same per-run deadline.
 */

const CACHE_DIR = path.resolve('.cache');
const RESULTS_DIR = path.resolve('results');
const VIDEOS_FILE = path.resolve('videos.json');

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const cache = new TranscriptCache(CACHE_DIR);

  if (args.has('--clear-cache')) {
    await cache.clear();
    console.log('Transcript cache cleared.');
    return;
  }

  const config = loadConfig();
  const videos = await loadVideos(VIDEOS_FILE);
  const useCache = !args.has('--no-cache');

  const providers: ProviderEntry[] = [];
  if (config.TRANSCRIPT_PROVIDER === 'supadata' || config.TRANSCRIPT_PROVIDER === 'all') {
    providers.push(
      config.SUPADATA_API_KEY
        ? { name: 'supadata', provider: new SupadataProvider(config.SUPADATA_API_KEY) }
        : { name: 'supadata', skippedReason: 'SUPADATA_API_KEY is missing in .env' },
    );
  }
  if (config.TRANSCRIPT_PROVIDER === 'transcriptapi' || config.TRANSCRIPT_PROVIDER === 'all') {
    providers.push(
      config.TRANSCRIPTAPI_API_KEY
        ? {
            name: 'transcriptapi',
            provider: new TranscriptApiProvider(config.TRANSCRIPTAPI_API_KEY),
          }
        : { name: 'transcriptapi', skippedReason: 'TRANSCRIPTAPI_API_KEY is missing in .env' },
    );
  }

  console.log(
    `Benchmarking ${videos.length} video${videos.length === 1 ? '' : 's'} × ` +
      `${providers.length} provider${providers.length === 1 ? '' : 's'} ` +
      `(cache ${useCache ? 'on' : 'off'}, deadline ${config.END_TO_END_TIMEOUT_MS} ms)…`,
  );

  const records = await runBenchmark({
    videos,
    providers,
    cache,
    useCache,
    timeoutMs: config.END_TO_END_TIMEOUT_MS,
  });

  console.log(formatReport(records, config.END_TO_END_TIMEOUT_MS));

  const resultsFile = await saveResults(RESULTS_DIR, records, {
    transcriptProvider: config.TRANSCRIPT_PROVIDER,
    timeoutMs: config.END_TO_END_TIMEOUT_MS,
    useCache,
  });
  console.log(`\nFull results saved to: ${resultsFile}`);
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
