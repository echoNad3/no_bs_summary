import { ProductError, SummaryService } from './product/service.js';
import { KvSummaryCache } from './product/kv-summary-cache.js';
import type { KvNamespaceLike } from './product/kv-summary-cache.js';
import { MemoryTranscriptStore } from './transcript/store.js';
import { GEMINI_PROMPT_VERSION, GeminiSummaryProvider } from './summary/gemini.js';
import { TranscriptApiProvider } from './transcript/transcriptapi.js';

/**
 * Cloudflare Worker entry: the production backend and PWA host.
 *
 * Mirrors the local Node server (server.ts) API exactly, with production
 * hardening: a shared app password on /api/summarize, restricted CORS, an
 * in-memory per-IP rate limit, a KV-backed daily request meter that bounds
 * API spend, and security headers on served assets. Summaries persist in
 * Workers KV; full transcripts are never written to durable cloud storage.
 *
 * Env uses minimal structural types instead of generated Workers types so the
 * whole repo type-checks and unit-tests under one Node TypeScript setup.
 * Keep the fields in sync with wrangler.jsonc bindings and secrets.
 */

const MAX_BODY_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_DAILY_SUMMARY_LIMIT = 300;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const RATE_LIMIT_MAX_TRACKED_CLIENTS = 5_000;

export interface AssetsFetcherLike {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerEnv {
  ASSETS: AssetsFetcherLike;
  SUMMARIES: KvNamespaceLike;
  /** Secrets — set with `wrangler secret put`, never in wrangler.jsonc. */
  GEMINI_API_KEY?: string;
  TRANSCRIPTAPI_API_KEY?: string;
  APP_PASSWORD?: string;
  /** Plain vars. */
  GEMINI_MODEL?: string;
  END_TO_END_TIMEOUT_MS?: string;
  DAILY_SUMMARY_LIMIT?: string;
}

export interface WorkerDeps {
  service?: Pick<SummaryService, 'summarize'>;
  rateLimiter?: SlidingWindowRateLimiter;
  now?: () => number;
}

/** Sliding-window request counter, intentionally per-isolate and approximate. */
export class SlidingWindowRateLimiter {
  private readonly log = new Map<string, number[]>();

  allow(client: string, now: number): boolean {
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const recent = (this.log.get(client) ?? []).filter((at) => at > windowStart);
    if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
      this.log.set(client, recent);
      return false;
    }
    recent.push(now);
    this.log.set(client, recent);
    if (this.log.size > RATE_LIMIT_MAX_TRACKED_CLIENTS) {
      const oldest = this.log.keys().next().value;
      if (oldest !== undefined) this.log.delete(oldest);
    }
    return true;
  }

  retryAfterSeconds(client: string, now: number): number {
    const oldest = (this.log.get(client) ?? []).filter((at) => at > now - RATE_LIMIT_WINDOW_MS)[0];
    if (oldest === undefined) return 0;
    return Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000));
  }
}

// Deliberate cross-request isolate state: request pacing and in-flight collapse
// only work when they survive across requests. Never store per-request data here.
const defaultRateLimiter = new SlidingWindowRateLimiter();
let cachedService: { fingerprint: string; service: SummaryService } | undefined;

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};

export async function handleRequest(
  request: Request,
  env: WorkerEnv,
  deps: WorkerDeps = {},
): Promise<Response> {
  const now = deps.now ?? Date.now;
  try {
    return await routeRequest(request, env, deps, now);
  } catch (error) {
    if (error instanceof ProductError) {
      const corsHeaders = corsHeadersFor(request, new URL(request.url)) ?? {};
      const retryHeaders: Record<string, string> =
        error.retryAfterSeconds === undefined
          ? {}
          : { 'Retry-After': String(error.retryAfterSeconds) };
      return json(
        error.statusCode,
        { error: { code: error.code, message: error.message } },
        { ...corsHeaders, ...retryHeaders },
      );
    }
    console.error(
      JSON.stringify({
        event: 'unhandled_error',
        method: request.method,
        path: new URL(request.url).pathname,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      }),
    );
    return json(500, { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } });
  }
}

async function routeRequest(
  request: Request,
  env: WorkerEnv,
  deps: WorkerDeps,
  now: () => number,
): Promise<Response> {
  const url = new URL(request.url);
  const corsHeaders = corsHeadersFor(request, url);
  if (corsHeaders === undefined) {
    return json(403, { error: { code: 'ORIGIN_DENIED', message: 'Origin not allowed.' } });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json(
      200,
      { status: 'ok', provider: 'transcriptapi', promptVersion: GEMINI_PROMPT_VERSION },
      corsHeaders,
    );
  }

  if (request.method === 'GET' && url.pathname === '/api/status') {
    if (!(await passwordMatches(request.headers.get('x-app-password'), env.APP_PASSWORD))) {
      return json(
        401,
        { error: { code: 'UNAUTHORIZED', message: 'Missing or wrong app password.' } },
        corsHeaders,
      );
    }
    return json(
      200,
      {
        status: 'ok',
        cache: 'cloud',
        dailyGeneration: await readDailyBudget(env, now()),
        transcriptApiCredits: {
          availableViaApi: false,
          dashboardUrl: 'https://transcriptapi.com/dashboard/billing',
        },
      },
      corsHeaders,
    );
  }

  if (request.method === 'POST' && url.pathname === '/api/summarize') {
    return summarize(request, env, deps, now, corsHeaders);
  }

  if (url.pathname.startsWith('/api/')) {
    return json(
      404,
      { error: { code: 'NOT_FOUND', message: 'API route not found.' } },
      corsHeaders,
    );
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } });
  }

  return serveAsset(request, env);
}

async function summarize(
  request: Request,
  env: WorkerEnv,
  deps: WorkerDeps,
  now: () => number,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  if (!(await passwordMatches(request.headers.get('x-app-password'), env.APP_PASSWORD))) {
    return json(
      401,
      { error: { code: 'UNAUTHORIZED', message: 'Missing or wrong app password.' } },
      corsHeaders,
    );
  }

  const client = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const rateLimiter = deps.rateLimiter ?? defaultRateLimiter;
  const requestTime = now();
  if (!rateLimiter.allow(client, requestTime)) {
    const retryAfterSeconds = rateLimiter.retryAfterSeconds(client, requestTime);
    return json(
      429,
      {
        error: {
          code: 'RATE_LIMITED',
          message: `Too many requests. Try again in ${retryAfterSeconds} seconds.`,
        },
      },
      { ...corsHeaders, 'Retry-After': String(retryAfterSeconds) },
    );
  }

  const input = await readJsonBody(request);
  const service = deps.service ?? getService(env);
  const result = await service.summarize(input);
  return json(200, result, corsHeaders);
}

/**
 * CORS allowlist. Returns undefined when the origin is denied. Allowed:
 * no Origin header, the Worker's own origin (the deployed PWA), Chrome
 * extensions, and localhost during development.
 */
function corsHeadersFor(request: Request, url: URL): Record<string, string> | undefined {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  const allowed =
    origin === url.origin ||
    /^chrome-extension:\/\/[a-p]{32}$/u.test(origin) ||
    /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/u.test(origin);
  if (!allowed) return undefined;
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Password',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

/**
 * Constant-time password check. Hashing both sides gives equal-length inputs,
 * so neither length nor content leaks through timing.
 */
export async function passwordMatches(
  supplied: string | null,
  expected: string | undefined,
): Promise<boolean> {
  if (!expected || expected.trim() === '') {
    // Fail closed if the APP_PASSWORD secret is missing.
    throw new ProductError(
      500,
      'SERVER_MISCONFIGURED',
      'The app password is not configured on the server.',
    );
  }
  if (supplied === null) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index]! ^ right[index]!;
  }
  return diff === 0;
}

/**
 * Global daily meter in KV. Approximate by design (KV counters are not
 * atomic); it exists to bound worst-case API spend, not for precision.
 */
export interface DailyGenerationBudget {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}

export async function readDailyBudget(
  env: Pick<WorkerEnv, 'SUMMARIES' | 'DAILY_SUMMARY_LIMIT'>,
  now: number,
): Promise<DailyGenerationBudget> {
  const limit = positiveInteger(env.DAILY_SUMMARY_LIMIT) ?? DEFAULT_DAILY_SUMMARY_LIMIT;
  const key = `meter-${new Date(now).toISOString().slice(0, 10)}`;
  const stored = Number((await env.SUMMARIES.get(key)) ?? '0');
  const used = Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0;
  const reset = new Date(now);
  reset.setUTCHours(24, 0, 0, 0);
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt: reset.toISOString(),
  };
}

export async function consumeDailyBudget(
  env: Pick<WorkerEnv, 'SUMMARIES' | 'DAILY_SUMMARY_LIMIT'>,
  now: number,
): Promise<void> {
  const budget = await readDailyBudget(env, now);
  if (budget.remaining <= 0) {
    const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(budget.resetsAt) - now) / 1000));
    throw new ProductError(
      429,
      'DAILY_LIMIT_REACHED',
      'Daily new-summary limit reached. Already cached videos still work.',
      retryAfterSeconds,
    );
  }
  const key = `meter-${new Date(now).toISOString().slice(0, 10)}`;
  await env.SUMMARIES.put(key, String(budget.used + 1), { expirationTtl: 2 * 24 * 60 * 60 });
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ProductError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.');
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new ProductError(413, 'REQUEST_TOO_LARGE', 'Request body is too large.');
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ProductError(400, 'INVALID_JSON', 'Request body is not valid JSON.');
  }
}

async function serveAsset(request: Request, env: WorkerEnv): Promise<Response> {
  const assetResponse = await env.ASSETS.fetch(request);
  const response = new Response(assetResponse.body, assetResponse);
  const pathname = new URL(request.url).pathname;
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  response.headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  if ((response.headers.get('content-type') ?? '').includes('text/html')) {
    response.headers.set('Cache-Control', 'no-cache');
    response.headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https://i.ytimg.com; connect-src 'self'; manifest-src 'self'; " +
        "worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
  } else if (pathname === '/sw.js' || pathname.endsWith('.webmanifest')) {
    response.headers.set('Cache-Control', 'no-cache');
  } else if (/^\/assets\/.+-[A-Za-z0-9_-]+\.(?:css|js)$/u.test(pathname)) {
    response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (pathname.startsWith('/icons/')) {
    response.headers.set('Cache-Control', 'public, max-age=604800');
  }
  return response;
}

function getService(env: WorkerEnv): SummaryService {
  const geminiKey = env.GEMINI_API_KEY?.trim();
  const transcriptKey = env.TRANSCRIPTAPI_API_KEY?.trim();
  if (!geminiKey || !transcriptKey) {
    throw new ProductError(
      500,
      'SERVER_MISCONFIGURED',
      'The API keys are not configured on the server.',
    );
  }
  const model = env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite';
  const timeoutMs = positiveInteger(env.END_TO_END_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;
  const fingerprint = JSON.stringify([
    model,
    timeoutMs,
    env.DAILY_SUMMARY_LIMIT,
    geminiKey,
    transcriptKey,
  ]);
  if (cachedService?.fingerprint !== fingerprint) {
    cachedService = {
      fingerprint,
      service: new SummaryService({
        transcriptProvider: new TranscriptApiProvider(transcriptKey),
        summaryProvider: new GeminiSummaryProvider(geminiKey, model),
        cache: new MemoryTranscriptStore(),
        summaryCache: new KvSummaryCache(env.SUMMARIES),
        summaryModel: model,
        summaryPromptVersion: GEMINI_PROMPT_VERSION,
        timeoutMs,
        beforeGenerate: () => consumeDailyBudget(env, Date.now()),
      }),
    };
  }
  return cachedService.service;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function json(
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
      ...extraHeaders,
    },
  });
}
