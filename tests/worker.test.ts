import { describe, expect, it, vi } from 'vitest';
import { ProductError } from '../src/product/service.js';
import { KvSummaryCache } from '../src/product/kv-summary-cache.js';
import type { KvNamespaceLike } from '../src/product/kv-summary-cache.js';
import {
  legacySummaryCacheKey,
  summaryCacheKey,
  type SummaryCacheIdentity,
} from '../src/product/summary-store.js';
import type { SummarizeResponse } from '../src/product/schema.js';
import { MemoryTranscriptStore, cacheKey } from '../src/transcript/store.js';
import {
  blockedReason,
  makeGenerationQuotaStatus,
  type GenerationQuotaClient,
  type GenerationQuotaRequest,
  type QuotaAccess,
} from '../src/generation-quota.js';
import {
  handleRequest,
  passwordMatches,
  SlidingWindowRateLimiter,
  type WorkerEnv,
} from '../src/worker.js';

const identity: SummaryCacheIdentity = {
  videoId: 'EwMSGdE2bOQ',
  language: 'en',
  model: 'gemini-3.1-flash-lite',
  promptVersion: 'summary-first-v29-2026-07-14',
};

const response: SummarizeResponse = {
  verdict: 'WATCH',
  reason: 'The host keeps a long list of topics funny and easy to follow.',
  summary: 'Wizard Detective, Kane Pixels, and several Backrooms projects are the main topics.',
  videoId: 'EwMSGdE2bOQ',
  language: 'en',
  source: 'CACHED',
  timing: { transcriptMs: 8, summaryMs: 3210, totalMs: 3218 },
  retries: { transcript: 0, summary: 0 },
};

class FakeKv implements KvNamespaceLike {
  readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

function makeEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    ASSETS: {
      fetch: async () =>
        new Response('<h1>PWA</h1>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    },
    SUMMARIES: new FakeKv(),
    GEMINI_API_KEY: 'test-gemini-key',
    TRANSCRIPTAPI_API_KEY: 'test-transcript-key',
    APP_PASSWORD: 'correct horse',
    ...overrides,
  };
}

function summarizeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://app.example.workers.dev/api/summarize', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-app-password': 'correct horse',
      ...headers,
    },
    body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
  });
}

const okService = () => ({ summarize: vi.fn().mockResolvedValue(response) });

class FakeGenerationQuota implements GenerationQuotaClient {
  dailyUsed = 0;
  globalUsed = 0;
  readonly users = new Map<string, number>();
  consumeCalls = 0;

  async read(input: GenerationQuotaRequest) {
    return makeGenerationQuotaStatus(
      this.dailyUsed,
      this.users.get(input.userKey) ?? 0,
      this.globalUsed,
      input,
    );
  }

  async consume(input: GenerationQuotaRequest, access: QuotaAccess) {
    this.consumeCalls += 1;
    const status = await this.read(input);
    const blockedBy = blockedReason(status, access);
    if (blockedBy) return { allowed: false, blockedBy, status } as const;
    this.dailyUsed += 1;
    if (access === 'free') {
      this.globalUsed += 1;
      this.users.set(input.userKey, (this.users.get(input.userKey) ?? 0) + 1);
    }
    return { allowed: true, status: await this.read(input) } as const;
  }
}

const generatingService = () => ({
  summarize: vi.fn(async (_input: unknown, options?: { beforeGenerate?: () => Promise<void> }) => {
    await options?.beforeGenerate?.();
    return response;
  }),
});

describe('KvSummaryCache', () => {
  it('round-trips the complete response and misses on corrupt or mismatched entries', async () => {
    const kv = new FakeKv();
    const cache = new KvSummaryCache(kv);

    await expect(cache.read(identity)).resolves.toBeUndefined();
    await cache.write(identity, response);
    await expect(cache.read(identity)).resolves.toEqual(response);
    await expect(cache.read({ ...identity, videoId: 'dQw4w9WgXcQ' })).resolves.toBeUndefined();

    const { language: _language, ...legacyIdentity } = identity;
    kv.store.delete(summaryCacheKey(identity));
    kv.store.set(
      legacySummaryCacheKey(identity),
      JSON.stringify({ identity: legacyIdentity, response }),
    );
    await expect(cache.read(identity)).resolves.toEqual(response);
    await expect(cache.read({ ...identity, language: 'de' })).resolves.toBeUndefined();

    kv.store.delete(legacySummaryCacheKey(identity));
    kv.store.set(summaryCacheKey(identity), 'not json');
    await expect(cache.read(identity)).resolves.toBeUndefined();
  });
});

describe('MemoryTranscriptStore', () => {
  it('stores transcripts per key and enforces the entry cap', async () => {
    const store = new MemoryTranscriptStore();
    const transcript = {
      provider: 'transcriptapi',
      videoId: 'dQw4w9WgXcQ',
      language: 'en',
      text: 'Never gonna give you up.',
    };

    await store.write(cacheKey('transcriptapi', 'dQw4w9WgXcQ', 'en'), transcript);
    await expect(store.read(cacheKey('transcriptapi', 'dQw4w9WgXcQ', 'en'))).resolves.toEqual(
      transcript,
    );
    await expect(
      store.read(cacheKey('transcriptapi', 'dQw4w9WgXcQ', 'en'), {
        provider: 'other',
        videoId: 'dQw4w9WgXcQ',
      }),
    ).resolves.toBeUndefined();

    for (let index = 0; index < 20; index += 1) {
      await store.write(`key-${index}`, { ...transcript, text: `Entry ${index}.` });
    }
    await expect(store.read(cacheKey('transcriptapi', 'dQw4w9WgXcQ', 'en'))).resolves.toBe(
      undefined,
    );
    await expect(store.read('key-19')).resolves.toMatchObject({ text: 'Entry 19.' });
  });
});

describe('password check', () => {
  it('accepts only the exact password and fails closed when unset', async () => {
    await expect(passwordMatches('correct horse', 'correct horse')).resolves.toBe(true);
    await expect(passwordMatches('wrong', 'correct horse')).resolves.toBe(false);
    await expect(passwordMatches(null, 'correct horse')).resolves.toBe(false);
    await expect(passwordMatches('anything', undefined)).rejects.toMatchObject({
      code: 'SERVER_MISCONFIGURED',
    });
    await expect(passwordMatches('anything', '  ')).rejects.toMatchObject({
      code: 'SERVER_MISCONFIGURED',
    });
  });
});

describe('rate limiter', () => {
  it('allows a burst then blocks until the window slides past', () => {
    const limiter = new SlidingWindowRateLimiter();
    const start = 1_000_000;
    for (let index = 0; index < 20; index += 1) {
      expect(limiter.allow('1.2.3.4', start + index)).toBe(true);
    }
    expect(limiter.allow('1.2.3.4', start + 20)).toBe(false);
    expect(limiter.allow('5.6.7.8', start + 20)).toBe(true);
    expect(limiter.retryAfterSeconds('1.2.3.4', start + 20)).toBe(60);
    expect(limiter.allow('1.2.3.4', start + 61_000)).toBe(true);
  });
});

describe('worker request handling', () => {
  it('returns cacheable video metadata without consuming summary credits', async () => {
    const generationQuota = new FakeGenerationQuota();
    const metadataFetcher = vi.fn().mockResolvedValue(Response.json({ title: 'Actual title' }));
    const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;
    const result = await handleRequest(
      new Request('https://app.example.workers.dev/api/video-metadata?id=dQw4w9WgXcQ', {
        headers: { origin: extensionOrigin },
      }),
      makeEnv(),
      { generationQuota, metadataFetcher },
    );

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ title: 'Actual title' });
    expect(result.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(result.headers.get('access-control-allow-origin')).toBe(extensionOrigin);
    expect(result.headers.get('vary')).toBe('Origin');
    expect(generationQuota.consumeCalls).toBe(0);
  });

  it('validates and separately rate-limits video metadata requests', async () => {
    const metadataFetcher = vi.fn().mockResolvedValue(Response.json({ title: 'Actual title' }));
    const metadataRateLimiter = new SlidingWindowRateLimiter(1);
    const deps = { metadataFetcher, metadataRateLimiter, now: () => 1_000_000 };
    const invalid = await handleRequest(
      new Request('https://app.example.workers.dev/api/video-metadata?id=invalid'),
      makeEnv(),
      { metadataFetcher, metadataRateLimiter: new SlidingWindowRateLimiter(1) },
    );
    expect(invalid.status).toBe(400);

    const request = () =>
      new Request('https://app.example.workers.dev/api/video-metadata?id=dQw4w9WgXcQ');
    expect((await handleRequest(request(), makeEnv(), deps)).status).toBe(200);
    const blocked = await handleRequest(request(), makeEnv(), deps);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect(await blocked.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('serves health without a password and rejects unknown API routes', async () => {
    const env = makeEnv();
    const health = await handleRequest(
      new Request('https://app.example.workers.dev/api/health'),
      env,
    );
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', provider: 'transcriptapi' });

    const unknown = await handleRequest(
      new Request('https://app.example.workers.dev/api/nope'),
      env,
    );
    expect(unknown.status).toBe(404);
  });

  it('reports free limits without a password and owner budgets with the exact password', async () => {
    const env = makeEnv({ DAILY_SUMMARY_LIMIT: '7' });
    const generationQuota = new FakeGenerationQuota();
    const statusRequest = (password: string) =>
      new Request('https://app.example.workers.dev/api/status', {
        headers: { 'x-app-password': password },
      });

    const freeResult = await handleRequest(statusRequest('wrong'), env, {
      generationQuota,
      now: () => Date.parse('2026-08-08T12:00:00.000Z'),
    });
    expect(freeResult.status).toBe(200);
    expect(await freeResult.json()).toMatchObject({
      access: 'free',
      dailyGeneration: null,
      freeGeneration: {
        user: { used: 0, limit: 5, remaining: 5 },
        shared: { used: 0, limit: 50, remaining: 50 },
      },
    });
    const result = await handleRequest(statusRequest('correct horse'), env, {
      generationQuota,
      now: () => Date.parse('2026-08-08T12:00:00.000Z'),
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      status: 'ok',
      access: 'owner',
      dailyGeneration: { used: 0, limit: 7, remaining: 7 },
      freeGeneration: {
        user: { used: 0, limit: 5, remaining: 5 },
        shared: { used: 0, limit: 50, remaining: 50 },
      },
    });
  });

  it('fails closed when the generation quota service is unavailable', async () => {
    const env = makeEnv({ DAILY_SUMMARY_LIMIT: '7' });
    const generationQuota = new FakeGenerationQuota();
    vi.spyOn(generationQuota, 'read').mockRejectedValue(new Error('quota unavailable'));
    const statusRequest = (password: string) =>
      new Request('https://app.example.workers.dev/api/status', {
        headers: { 'x-app-password': password },
      });

    const ownerResult = await handleRequest(statusRequest('correct horse'), env, {
      generationQuota,
      now: () => Date.parse('2026-08-08T12:00:00.000Z'),
    });
    expect(ownerResult.status).toBe(503);
    expect(await ownerResult.json()).toMatchObject({
      error: { code: 'QUOTA_UNAVAILABLE' },
    });

    const freeResult = await handleRequest(statusRequest('wrong'), env, { generationQuota });
    expect(freeResult.status).toBe(503);
    expect(await freeResult.json()).toMatchObject({
      error: { code: 'QUOTA_UNAVAILABLE' },
    });
  });

  it('applies monthly limits only to free access while every live generation uses the daily pool', async () => {
    const env = makeEnv();
    const service = generatingService();
    const generationQuota = new FakeGenerationQuota();

    const missing = await handleRequest(summarizeRequest({ 'x-app-password': '' }), env, {
      service,
      generationQuota,
    });
    expect(missing.status).toBe(200);
    const wrong = await handleRequest(summarizeRequest({ 'x-app-password': 'nope' }), env, {
      service,
      generationQuota,
    });
    expect(wrong.status).toBe(200);
    expect(generationQuota.consumeCalls).toBe(2);

    const accepted = await handleRequest(summarizeRequest(), env, { service, generationQuota });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual(response);
    expect(generationQuota.consumeCalls).toBe(3);
    expect(generationQuota.dailyUsed).toBe(3);
    expect(generationQuota.globalUsed).toBe(2);
    expect(service.summarize).toHaveBeenLastCalledWith(
      { url: 'https://youtu.be/dQw4w9WgXcQ' },
      expect.objectContaining({ beforeGenerate: expect.any(Function) }),
    );
  });

  it('blocks owner and free generation at the atomic daily ceiling', async () => {
    const env = makeEnv({ DAILY_SUMMARY_LIMIT: '2' });
    const service = generatingService();
    const generationQuota = new FakeGenerationQuota();
    generationQuota.dailyUsed = 2;
    const now = () => Date.parse('2026-08-08T12:00:00.000Z');

    for (const password of ['correct horse', '']) {
      const blocked = await handleRequest(summarizeRequest({ 'x-app-password': password }), env, {
        service,
        generationQuota,
        now,
      });
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('retry-after')).toBe('43200');
      expect(await blocked.json()).toMatchObject({ error: { code: 'DAILY_LIMIT_REACHED' } });
    }
    expect(generationQuota.globalUsed).toBe(0);
  });

  it('blocks a free network at 5 and all free networks at the shared 50 ceiling', async () => {
    const env = makeEnv();
    const service = generatingService();
    const userQuota = new FakeGenerationQuota();
    const freeRequest = (ip: string) =>
      summarizeRequest({ 'x-app-password': '', 'cf-connecting-ip': ip });

    for (let index = 0; index < 5; index += 1) {
      expect(
        (
          await handleRequest(freeRequest('198.51.100.1'), env, {
            service,
            generationQuota: userQuota,
          })
        ).status,
      ).toBe(200);
    }
    const userBlocked = await handleRequest(freeRequest('198.51.100.1'), env, {
      service,
      generationQuota: userQuota,
    });
    expect(userBlocked.status).toBe(429);
    expect(await userBlocked.json()).toMatchObject({
      error: { code: 'FREE_USER_LIMIT_REACHED' },
    });

    const globalQuota = new FakeGenerationQuota();
    globalQuota.globalUsed = 50;
    const globalBlocked = await handleRequest(freeRequest('198.51.100.2'), env, {
      service,
      generationQuota: globalQuota,
    });
    expect(globalBlocked.status).toBe(429);
    expect(await globalBlocked.json()).toMatchObject({
      error: { code: 'FREE_GLOBAL_LIMIT_REACHED' },
    });
  });

  it('fails closed with a safe error when the password secret is missing', async () => {
    const env = makeEnv({ APP_PASSWORD: undefined });
    const result = await handleRequest(summarizeRequest(), env, { service: okService() });
    expect(result.status).toBe(500);
    const body = (await result.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SERVER_MISCONFIGURED');
  });

  it('applies CORS rules: extension and localhost allowed, web origins denied', async () => {
    const env = makeEnv();
    const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;

    const allowed = await handleRequest(summarizeRequest({ origin: extensionOrigin }), env, {
      service: okService(),
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(extensionOrigin);

    const sameOrigin = await handleRequest(
      summarizeRequest({ origin: 'https://app.example.workers.dev' }),
      env,
      { service: okService() },
    );
    expect(sameOrigin.status).toBe(200);

    const denied = await handleRequest(summarizeRequest({ origin: 'https://evil.example' }), env, {
      service: okService(),
    });
    expect(denied.status).toBe(403);

    const preflight = await handleRequest(
      new Request('https://app.example.workers.dev/api/summarize', {
        method: 'OPTIONS',
        headers: { origin: extensionOrigin },
      }),
      env,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('X-App-Password');
  });

  it('rejects bad bodies and hides internal error details', async () => {
    const env = makeEnv();
    const noJson = await handleRequest(
      new Request('https://app.example.workers.dev/api/summarize', {
        method: 'POST',
        headers: { 'x-app-password': 'correct horse' },
        body: '{}',
      }),
      env,
      { service: okService() },
    );
    expect(noJson.status).toBe(415);

    const invalid = await handleRequest(
      new Request('https://app.example.workers.dev/api/summarize', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-password': 'correct horse' },
        body: 'not json',
      }),
      env,
      { service: okService() },
    );
    expect(invalid.status).toBe(400);

    const tooLarge = await handleRequest(
      new Request('https://app.example.workers.dev/api/summarize', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-password': 'correct horse' },
        body: 'é'.repeat(9_000),
      }),
      env,
      { service: okService() },
    );
    expect(tooLarge.status).toBe(413);

    const failing = await handleRequest(summarizeRequest(), env, {
      service: { summarize: vi.fn().mockRejectedValue(new Error('secret-key')) },
    });
    expect(failing.status).toBe(500);
    expect(await failing.text()).not.toContain('secret-key');
  });

  it('logs safe structured diagnostics for server-side product failures', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await handleRequest(summarizeRequest(), makeEnv(), {
      service: {
        summarize: vi
          .fn()
          .mockRejectedValue(
            new ProductError(
              504,
              'DEADLINE_EXCEEDED',
              'This video took too long to process. Try again.',
            ),
          ),
      },
    });

    expect(result.status).toBe(504);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('"event":"request_failed"'));
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('"code":"DEADLINE_EXCEEDED"'));
    errorLog.mockRestore();
  });

  it('enforces per-client limits with an exact retry countdown', async () => {
    const env = makeEnv();
    const limiter = new SlidingWindowRateLimiter();
    let clock = 1_000_000;
    const deps = { service: okService(), rateLimiter: limiter, now: () => clock };

    for (let index = 0; index < 20; index += 1) {
      expect((await handleRequest(summarizeRequest(), env, deps)).status).toBe(200);
    }
    const capped = await handleRequest(summarizeRequest(), env, deps);
    expect(capped.status).toBe(429);
    const body = (await capped.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(capped.headers.get('retry-after')).toBe('60');
  });

  it('serves assets with security headers and a CSP on HTML', async () => {
    let assetRequestUrl = '';
    let assetAuthorization: string | null = '';
    const env = makeEnv({
      ASSETS: {
        fetch: async (request) => {
          assetRequestUrl = request.url;
          assetAuthorization = request.headers.get('authorization');
          return new Response('<html>PWA</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          });
        },
      },
    });
    const page = await handleRequest(
      new Request('https://app.example.workers.dev/?source=share', {
        headers: { authorization: 'Bearer must-not-reach-static-assets' },
      }),
      env,
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('PWA');
    expect(assetRequestUrl).toBe('https://assets.local/?source=share');
    expect(assetAuthorization).toBeNull();
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(page.headers.get('content-security-policy')).toContain(
      "connect-src 'self' https://api.github.com",
    );
    expect(page.headers.get('permissions-policy')).toContain('camera=()');
    expect(page.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(page.headers.get('cache-control')).toBe('no-cache');

    const nonHtmlEnv = makeEnv({
      ASSETS: {
        fetch: async () =>
          new Response('body{}', {
            status: 200,
            headers: { 'content-type': 'text/css' },
          }),
      },
    });
    const css = await handleRequest(
      new Request('https://app.example.workers.dev/assets/index-AbCd1234.css'),
      nonHtmlEnv,
    );
    expect(css.headers.get('content-security-policy')).toBeNull();
    expect(css.headers.get('x-content-type-options')).toBe('nosniff');
    expect(css.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });
});
