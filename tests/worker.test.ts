import { describe, expect, it, vi } from 'vitest';
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
  consumeDailyBudget,
  handleRequest,
  passwordMatches,
  readDailyBudget,
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

describe('daily live-generation budget', () => {
  it('counts only explicit generation attempts and exposes the UTC reset', async () => {
    const env = makeEnv({ DAILY_SUMMARY_LIMIT: '2' });
    const now = Date.parse('2026-08-08T12:00:00.000Z');

    await expect(readDailyBudget(env, now)).resolves.toMatchObject({
      used: 0,
      limit: 2,
      remaining: 2,
      resetsAt: '2026-08-09T00:00:00.000Z',
    });
    await consumeDailyBudget(env, now);
    await consumeDailyBudget(env, now);
    await expect(consumeDailyBudget(env, now)).rejects.toMatchObject({
      statusCode: 429,
      code: 'DAILY_LIMIT_REACHED',
      retryAfterSeconds: 43_200,
    });
  });
});

describe('worker request handling', () => {
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

  it('tests the password and reports cloud-cache generation budget status', async () => {
    const env = makeEnv({ DAILY_SUMMARY_LIMIT: '7' });
    const statusRequest = (password: string) =>
      new Request('https://app.example.workers.dev/api/status', {
        headers: { 'x-app-password': password },
      });

    expect((await handleRequest(statusRequest('wrong'), env)).status).toBe(401);
    const result = await handleRequest(statusRequest('correct horse'), env, {
      now: () => Date.parse('2026-08-08T12:00:00.000Z'),
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      status: 'ok',
      cache: 'cloud',
      dailyGeneration: { used: 0, limit: 7, remaining: 7 },
      transcriptApiCredits: { availableViaApi: false },
    });
  });

  it('requires the app password on summarize', async () => {
    const env = makeEnv();
    const service = okService();

    const missing = await handleRequest(summarizeRequest({ 'x-app-password': '' }), env, {
      service,
    });
    expect(missing.status).toBe(401);
    const wrong = await handleRequest(summarizeRequest({ 'x-app-password': 'nope' }), env, {
      service,
    });
    expect(wrong.status).toBe(401);
    expect(service.summarize).not.toHaveBeenCalled();

    const accepted = await handleRequest(summarizeRequest(), env, { service });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual(response);
    expect(service.summarize).toHaveBeenCalledWith({ url: 'https://youtu.be/dQw4w9WgXcQ' });
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
    const env = makeEnv();
    const page = await handleRequest(new Request('https://app.example.workers.dev/'), env);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('PWA');
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
