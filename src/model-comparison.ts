import path from 'node:path';
import { runBenchmark } from './benchmark.js';
import type { ProviderEntry } from './benchmark.js';
import { TranscriptCache } from './cache.js';
import { loadConfig } from './config.js';
import { formatReport } from './report.js';
import { collectRuntimeProvenance, saveResults } from './results.js';
import {
  createGenerateContentAdapter,
  generateContentThinkingLabel,
} from './summary/generate-content.js';
import { GEMINI_PROMPT_VERSION, GeminiSummaryProvider } from './summary/gemini.js';
import { loadVideos } from './videos.js';

const CACHE_DIR = path.resolve('.cache');
const RESULTS_DIR = path.resolve('results');
const VIDEOS_FILE = path.resolve('videos.json');
const COMPARISON_MODELS = new Set(['gemini-3.1-flash-lite', 'gemini-2.5-flash']);

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required for model comparison.');
  if (!COMPARISON_MODELS.has(config.GEMINI_MODEL)) {
    throw new Error(`Model comparison does not allow ${config.GEMINI_MODEL}.`);
  }

  const videos = await loadVideos(VIDEOS_FILE);
  const runtime = await collectRuntimeProvenance();
  const providers: ProviderEntry[] = [
    { name: 'transcriptapi', skippedReason: 'Cache-only model comparison' },
  ];
  const summaryProvider = new GeminiSummaryProvider(
    config.GEMINI_API_KEY,
    config.GEMINI_MODEL,
    createGenerateContentAdapter(config.GEMINI_API_KEY),
  );
  const thinkingSetting = generateContentThinkingLabel(config.GEMINI_MODEL);

  console.log(
    `Comparing ${config.GEMINI_MODEL} on ${videos.length} cached transcripts ` +
      `through generateContent (${thinkingSetting}, pacing ${config.GEMINI_PACING_MS} ms)...`,
  );
  const records = await runBenchmark({
    videos,
    providers,
    cache: new TranscriptCache(CACHE_DIR),
    useCache: true,
    cacheOnly: true,
    timeoutMs: config.END_TO_END_TIMEOUT_MS,
    interRunDelayMs: config.GEMINI_PACING_MS,
    summaryProvider,
  });

  for (const record of records) {
    console.log(
      `\n[${record.title}] ${record.verdict ?? 'FAILED'}${record.rejectedSummary ? ' (REJECTED)' : ''}`,
    );
    if (record.reason) console.log(`Reason: ${record.reason}`);
    if (record.summary) console.log(`Summary: ${record.summary}`);
    console.log(
      `Metrics: ${record.summaryMs ?? 'n/a'} ms; ${record.summaryInputTokens ?? 'n/a'} input; ` +
        `${record.summaryOutputTokens ?? 'n/a'} output; ${record.summaryThoughtTokens ?? 'n/a'} thinking`,
    );
    if (record.failureReason) console.log(`Failure: ${record.failureReason}`);
  }

  console.log(formatReport(records, config.END_TO_END_TIMEOUT_MS));
  const resultsFile = await saveResults(
    RESULTS_DIR,
    records,
    {
      transcriptProvider: 'transcriptapi',
      timeoutMs: config.END_TO_END_TIMEOUT_MS,
      useCache: true,
      cacheOnly: true,
      model: config.GEMINI_MODEL,
      summaryEnabled: true,
      promptVersion: GEMINI_PROMPT_VERSION,
      providerOrder: providers.map((provider) => provider.name),
      geminiPacingMs: config.GEMINI_PACING_MS,
      geminiTransport: 'generateContent',
      thinkingSetting,
    },
    runtime,
  );
  console.log(`\nFull results saved to: ${resultsFile}`);
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
