import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GoogleGenAI } from '@google/genai';

// Optional real-provider diagnostic. Local source files only; never calls the live Worker.
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--'))
    throw new Error(`Missing ${name} value.`);
  return args[index + 1];
}
const baselinePath = option('--baseline');
const casesPath = option('--cases');
const reportPath = option('--report', 'results/summary-quality-evidence.json');
const only = option('--only');
const thinking = option('--thinking');
if (thinking && !['minimal', 'low', 'medium', 'high'].includes(thinking))
  throw new Error('--thinking must be minimal, low, medium or high.');
const names = option('--names')?.split(',');
if (only && !['baseline', 'candidate'].includes(only))
  throw new Error('--only must be baseline or candidate.');
if (existsSync(reportPath) && !args.includes('--resume'))
  throw new Error('Report already exists; use --resume or a new report path to preserve evidence.');
if (!baselinePath || !casesPath) {
  throw new Error(
    'Supply --baseline (immutable provider bundle), --cases (local source manifest), and optionally --report / --resume.',
  );
}
const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
if (
  !Array.isArray(cases) ||
  cases.length < 1 ||
  cases.length > 6 ||
  cases.some(
    (c) => !c.name || !c.path || !Number.isInteger(c.rounds) || c.rounds < 1 || c.rounds > 3,
  )
)
  throw new Error('Supply 1–6 named local cases, each with path and rounds (1–3).');
if (
  new Set(cases.map((c) => c.name)).size !== cases.length ||
  cases.reduce((sum, c) => sum + 2 * c.rounds, 0) > 20
)
  throw new Error('Case names must be unique and the budget is at most 20 normal requests.');

const candidatePath = path.resolve(
  path.dirname(reportPath),
  `${path.basename(reportPath, '.json')}.candidate.mjs`,
);
if (path.resolve(baselinePath) === candidatePath)
  throw new Error('Candidate must not overwrite the baseline.');
await build({
  stdin: {
    contents: `export {GeminiSummaryProvider,GEMINI_PROMPT_VERSION} from './src/summary/gemini.ts';
export {createRequestContext} from './src/request-context.ts';
export {normalizeSegments} from './src/transcript/normalize.ts';
export {parseCanonicalSummaryPoints,countGeneratedWords,countWords} from './src/summary/provider.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: candidatePath,
});
const baseline = await import(pathToFileURL(path.resolve(baselinePath)).href);
const candidate = await import(pathToFileURL(candidatePath).href);
const sources = cases.map((c) => {
  const raw = JSON.parse(readFileSync(c.path, 'utf8').replace(/^\uFEFF/u, ''));
  const text =
    typeof raw.text === 'string'
      ? raw.text
      : candidate.normalizeSegments(
          raw.transcript.map((s) => ({
            text: s.text,
            startMs: Math.round(s.start * 1000),
            durationMs: Math.round(s.duration * 1000),
          })),
        ).text;
  if (!text.trim()) throw new Error(`Empty source: ${c.name}`);
  return {
    ...c,
    text,
    language: raw.language ?? 'en',
    sourceHash: createHash('sha256').update(text).digest('hex'),
  };
});
if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.GEMINI_API_KEY)
  throw new Error('GEMINI_API_KEY is required for this optional diagnostic.');
const model = option('--model', 'gemini-3.1-flash-lite');
const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const identity = {
  model,
  baseline: baseline.GEMINI_PROMPT_VERSION,
  candidate: candidate.GEMINI_PROMPT_VERSION,
  thinking: thinking ?? 'provider-default',
  baselineBundleHash: createHash('sha256').update(readFileSync(baselinePath)).digest('hex'),
  candidateBundleHash: createHash('sha256').update(readFileSync(candidatePath)).digest('hex'),
  sources: sources.map(({ name, sourceHash, rounds }) => ({ name, sourceHash, rounds })),
};
const report =
  args.includes('--resume') && existsSync(reportPath)
    ? JSON.parse(readFileSync(reportPath, 'utf8'))
    : { at: new Date().toISOString(), identity, runs: [] };
if (JSON.stringify(report.identity) !== JSON.stringify(identity))
  throw new Error('Resume identity mismatch; use a new report for different code/source/version.');
const persist = () => writeFileSync(reportPath, JSON.stringify(report, null, 2));
persist();

for (const source of sources) {
  if (names && !names.includes(source.name)) continue;
  for (let round = 1; round <= source.rounds; round++) {
    const order = round % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    for (const version of order) {
      if (only && only !== version) continue;
      const key = `${source.name}:${round}:${version}`;
      if (report.runs.some((run) => run.key === key)) continue;
      if (report.runs.length >= 20) throw new Error('Diagnostic request budget exhausted.');
      const module = version === 'baseline' ? baseline : candidate;
      const attempts = [];
      const provider = new module.GeminiSummaryProvider(
        process.env.GEMINI_API_KEY,
        model,
        async (params, options) => {
          if (thinking)
            params = {
              ...params,
              generation_config: { ...params.generation_config, thinking_level: thinking },
            };
          const start = performance.now();
          try {
            const result = await client.interactions.create(params, options);
            attempts.push({
              model: params.model,
              ms: Math.round(performance.now() - start),
              output: result.output_text,
              usage: result.usage,
              repair: params.input.match(/Fix this issue: ([^\r\n]+)/u)?.[1],
            });
            return result;
          } catch (error) {
            attempts.push({
              model: params.model,
              ms: Math.round(performance.now() - start),
              status: error.status ?? error.statusCode,
              message: String(error.message).slice(0, 400),
              repair: params.input.match(/Fix this issue: ([^\r\n]+)/u)?.[1],
            });
            throw error;
          }
        },
      );
      const { context, dispose } = module.createRequestContext(60_000);
      const start = performance.now();
      const run = {
        key,
        name: source.name,
        round,
        version,
        prompt: module.GEMINI_PROMPT_VERSION,
        sourceHash: source.sourceHash,
      };
      try {
        const result = await provider.summarize(source.text, context, {
          transcriptLanguage: source.language,
        });
        const points = module.parseCanonicalSummaryPoints(result.summary);
        const bodyWords = points.map((point) => module.countWords(point.body));
        Object.assign(run, {
          status: 'ok',
          result,
          points: points.length,
          words: module.countGeneratedWords(result.verdict, result.reason, points),
          bodyWords,
          lengthRatio: Math.max(...bodyWords) / Math.min(...bodyWords),
          genericPrefixes: (result.summary.match(/the speaker reports:/giu) ?? []).length,
        });
      } catch (error) {
        Object.assign(run, { status: 'failed', message: String(error.message).slice(0, 1200) });
      } finally {
        dispose();
      }
      Object.assign(run, {
        ms: Math.round(performance.now() - start),
        retries: context.summaryRetries,
        attempts,
      });
      report.runs.push(run);
      persist();
      console.log(
        JSON.stringify({
          key,
          status: run.status,
          ms: run.ms,
          points: run.points,
          words: run.words,
          retries: run.retries,
          genericPrefixes: run.genericPrefixes,
          error: run.message,
        }),
      );
      if (
        run.status === 'failed' &&
        attempts.some((attempt) => [429, 503].includes(attempt.status))
      ) {
        console.log(
          'Stopped on provider quota/overload. Evidence preserved; unrun qualification remains pending.',
        );
        process.exitCode = 2;
        break;
      }
      // Keep a single diagnostic below the free tier's request-rate ceiling,
      // including the provider's bounded second attempt. Run diagnostics serially.
      await new Promise((resolve) => setTimeout(resolve, 3500));
    }
    if (process.exitCode) break;
  }
  if (process.exitCode) break;
}
