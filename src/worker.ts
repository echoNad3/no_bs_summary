import { ProductError, SummaryService } from './product/service.js';
import type { SummaryRequestOptions } from './product/service.js';
import { KvSummaryCache } from './product/kv-summary-cache.js';
import type { KvNamespaceLike } from './product/kv-summary-cache.js';
import {
  DEFAULT_DAILY_SUMMARY_LIMIT,
  DEFAULT_FREE_GLOBAL_MONTHLY_LIMIT,
  DEFAULT_FREE_USER_MONTHLY_LIMIT,
  DurableGenerationQuotaClient,
  freeQuotaUserKey,
  generationQuotaRequest,
  type GenerationQuotaClient,
  type GenerationQuotaNamespaceLike,
  type GenerationQuotaRequest,
  type FreeQuotaStatus,
  type UsageCounterStatus,
  type QuotaAccess,
} from './generation-quota.js';
import { MemoryTranscriptStore } from './transcript/store.js';
import { GEMINI_PROMPT_VERSION, GeminiSummaryProvider } from './summary/gemini.js';
import { TranscriptApiProvider } from './transcript/transcriptapi.js';
import { DEFAULT_END_TO_END_TIMEOUT_MS } from './config.js';
import { fetchYouTubeVideoMetadata } from './video-metadata.js';

const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const METADATA_RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_MAX_TRACKED_CLIENTS = 5_000;

export interface AssetsFetcherLike {
  fetch(request: Request): Promise<Response>;
}

type RuntimeEnv = WorkerBindings;

export interface WorkerEnv {
  ASSETS: AssetsFetcherLike;
  SUMMARIES: KvNamespaceLike;
  GENERATION_QUOTA?: GenerationQuotaNamespaceLike;
  GEMINI_API_KEY?: string;
  TRANSCRIPTAPI_API_KEY?: string;
  APP_PASSWORD?: string;
  GEMINI_MODEL?: string;
  END_TO_END_TIMEOUT_MS?: string;
  DAILY_SUMMARY_LIMIT?: string;
  FREE_USER_MONTHLY_LIMIT?: string;
  FREE_GLOBAL_MONTHLY_LIMIT?: string;
}

export interface WorkerDeps {
  service?: Pick<SummaryService, 'summarize'>;
  generationQuota?: GenerationQuotaClient;
  rateLimiter?: SlidingWindowRateLimiter;
  metadataRateLimiter?: SlidingWindowRateLimiter;
  metadataFetcher?: typeof fetch;
  now?: () => number;
}

export { GenerationQuota } from './generation-quota.js';

export class SlidingWindowRateLimiter {
  private readonly log = new Map<string, number[]>();

  constructor(private readonly maxRequests = RATE_LIMIT_MAX_REQUESTS) {}

  allow(client: string, now: number): boolean {
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const recent = (this.log.get(client) ?? []).filter((at) => at > windowStart);
    if (recent.length >= this.maxRequests) {
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

// Shared only for rate limits and duplicate-request collapse.
const defaultRateLimiter = new SlidingWindowRateLimiter();
const defaultMetadataRateLimiter = new SlidingWindowRateLimiter(METADATA_RATE_LIMIT_MAX_REQUESTS);
let cachedService: { fingerprint: string; service: SummaryService } | undefined;

export default {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<RuntimeEnv>;

export async function handleRequest(
  request: Request,
  env: WorkerEnv,
  deps: WorkerDeps = {},
): Promise<Response> {
  const startedAt = Date.now();
  const now = deps.now ?? Date.now;
  try {
    return await routeRequest(request, env, deps, now);
  } catch (error) {
    const corsHeaders = corsHeadersFor(request, new URL(request.url)) ?? {};
    if (error instanceof ProductError) {
      if (error.statusCode >= 500) {
        console.error(
          JSON.stringify({
            event: 'request_failed',
            method: request.method,
            path: new URL(request.url).pathname,
            status: error.statusCode,
            code: error.code,
            durationMs: Math.max(0, Date.now() - startedAt),
          }),
        );
      }
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
        error: error instanceof Error ? error.name : 'UnknownError',
      }),
    );
    return json(
      500,
      { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } },
      corsHeaders,
    );
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
    const ownerAccess = await passwordMatches(
      request.headers.get('x-app-password'),
      env.APP_PASSWORD,
    );
    const generation = await readGenerationQuotaStatus(request, env, deps, now());
    return json(
      200,
      {
        status: 'ok',
        access: ownerAccess ? 'owner' : 'free',
        dailyGeneration: ownerAccess ? generation.daily : null,
        freeGeneration: generation.free,
      },
      corsHeaders,
    );
  }

  if (request.method === 'GET' && url.pathname === '/api/video-metadata') {
    return videoMetadata(request, url, deps, now, corsHeaders);
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

async function videoMetadata(
  request: Request,
  url: URL,
  deps: WorkerDeps,
  now: () => number,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const videoId = url.searchParams.get('id') ?? '';
  const client = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const rateLimiter = deps.metadataRateLimiter ?? defaultMetadataRateLimiter;
  const requestTime = now();
  if (!rateLimiter.allow(client, requestTime)) {
    const retryAfterSeconds = rateLimiter.retryAfterSeconds(client, requestTime);
    return json(
      429,
      {
        error: {
          code: 'RATE_LIMITED',
          message: `Too many title lookups. Try again in ${retryAfterSeconds} seconds.`,
        },
      },
      { ...corsHeaders, 'Retry-After': String(retryAfterSeconds) },
    );
  }

  const metadata = await fetchYouTubeVideoMetadata(videoId, deps.metadataFetcher);
  return json(200, metadata, {
    ...corsHeaders,
    'Cache-Control': 'public, max-age=86400',
    Vary: 'Origin',
  });
}

async function summarize(
  request: Request,
  env: WorkerEnv,
  deps: WorkerDeps,
  now: () => number,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const ownerAccess = await passwordMatches(
    request.headers.get('x-app-password'),
    env.APP_PASSWORD,
  );

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
  const access: QuotaAccess = ownerAccess ? 'owner' : 'free';
  const requestOptions: SummaryRequestOptions = {
    beforeGenerate: async () => {
      await consumeGenerationQuota(request, env, deps, now(), access);
    },
  };
  const result = await service.summarize(input, requestOptions);
  return json(200, result, corsHeaders);
}

async function readGenerationQuotaStatus(
  request: Request,
  env: WorkerEnv,
  deps: WorkerDeps,
  now: number,
): Promise<{ daily: UsageCounterStatus; free: FreeQuotaStatus }> {
  const input = await generationQuotaRequestFor(request, env, now);
  try {
    return await generationQuotaClient(env, deps).read(input);
  } catch {
    throw new ProductError(
      503,
      'QUOTA_UNAVAILABLE',
      'Generation limits are temporarily unavailable. Try again shortly.',
    );
  }
}

async function consumeGenerationQuota(
  request: Request,
  env: WorkerEnv,
  deps: WorkerDeps,
  now: number,
  access: QuotaAccess,
): Promise<void> {
  const input = await generationQuotaRequestFor(request, env, now);
  let decision;
  try {
    decision = await generationQuotaClient(env, deps).consume(input, access);
  } catch {
    throw new ProductError(
      503,
      'QUOTA_UNAVAILABLE',
      'Generation limits are temporarily unavailable. Try again shortly.',
    );
  }
  if (decision.allowed) return;

  if (decision.blockedBy === 'daily') {
    const retryAfterSeconds = secondsUntil(decision.status.daily.resetsAt, now);
    throw new ProductError(
      429,
      'DAILY_LIMIT_REACHED',
      'Daily new-summary limit reached. Already cached videos still work.',
      retryAfterSeconds,
    );
  }
  const free = decision.status.free;
  const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(free.shared.resetsAt) - now) / 1000));
  if (decision.blockedBy === 'global') {
    throw new ProductError(
      429,
      'FREE_GLOBAL_LIMIT_REACHED',
      `The shared pool of ${free.shared.limit} free summaries is used up for this month. Use the main password or wait for the monthly reset.`,
      retryAfterSeconds,
    );
  }
  throw new ProductError(
    429,
    'FREE_USER_LIMIT_REACHED',
    `You have used all ${free.user.limit} free summaries for this month. Use the main password or wait for the monthly reset.`,
    retryAfterSeconds,
  );
}

async function generationQuotaRequestFor(
  request: Request,
  env: WorkerEnv,
  now: number,
): Promise<GenerationQuotaRequest> {
  const password = env.APP_PASSWORD?.trim();
  if (!password) {
    throw new ProductError(
      500,
      'SERVER_MISCONFIGURED',
      'The app password is not configured on the server.',
    );
  }
  const userKey = await freeQuotaUserKey(request.headers.get('cf-connecting-ip'), password);
  return generationQuotaRequest(
    now,
    userKey,
    configuredLimit(env.DAILY_SUMMARY_LIMIT) ?? DEFAULT_DAILY_SUMMARY_LIMIT,
    configuredLimit(env.FREE_USER_MONTHLY_LIMIT) ?? DEFAULT_FREE_USER_MONTHLY_LIMIT,
    configuredLimit(env.FREE_GLOBAL_MONTHLY_LIMIT) ?? DEFAULT_FREE_GLOBAL_MONTHLY_LIMIT,
  );
}

function generationQuotaClient(env: WorkerEnv, deps: WorkerDeps): GenerationQuotaClient {
  if (deps.generationQuota) return deps.generationQuota;
  if (!env.GENERATION_QUOTA) {
    throw new ProductError(
      500,
      'SERVER_MISCONFIGURED',
      'The generation quota service is not configured on the server.',
    );
  }
  return new DurableGenerationQuotaClient(env.GENERATION_QUOTA);
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

export async function passwordMatches(
  supplied: string | null,
  expected: string | undefined,
): Promise<boolean> {
  if (!expected || expected.trim() === '') {
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
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(a, b);
  }
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ProductError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.');
  }
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ProductError(413, 'REQUEST_TOO_LARGE', 'Request body is too large.');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ProductError(400, 'INVALID_JSON', 'Request body is not valid JSON.');
  }
}

async function serveAsset(request: Request, env: WorkerEnv): Promise<Response> {
  const requestUrl = new URL(request.url);
  const assetUrl = new URL(requestUrl.pathname + requestUrl.search, 'https://assets.local');
  const assetRequest = new Request(assetUrl, { method: request.method });
  const assetResponse = await env.ASSETS.fetch(assetRequest);
  const response = new Response(assetResponse.body, assetResponse);
  const pathname = requestUrl.pathname;
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  response.headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  if ((response.headers.get('content-type') ?? '').includes('text/html')) {
    response.headers.set('Cache-Control', 'no-cache');
    response.headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https://i.ytimg.com; connect-src 'self' https://api.github.com; " +
        "manifest-src 'self'; " +
        "worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
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
  const timeoutMs = configuredLimit(env.END_TO_END_TIMEOUT_MS) ?? DEFAULT_END_TO_END_TIMEOUT_MS;
  const fingerprint = JSON.stringify([model, timeoutMs, geminiKey, transcriptKey]);
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
      }),
    };
  }
  return cachedService.service;
}

function configuredLimit(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100_000 ? parsed : undefined;
}

function secondsUntil(timestamp: string, now: number): number {
  return Math.max(1, Math.ceil((Date.parse(timestamp) - now) / 1000));
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
      'Strict-Transport-Security': 'max-age=31536000',
      ...extraHeaders,
    },
  });
}
