import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithOneRetry } from '../src/http.js';
import type { RunContext } from '../src/run-context.js';

function ctx(remainingMs = 15000): RunContext {
  return {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + remainingMs,
    transcriptRetries: 0,
    summaryRetries: 0,
  };
}

const POLICY = {
  isRetryableStatus: (status: number) => status === 408 || status === 429 || status >= 500,
  defaultDelayMs: 0,
};

function json(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchWithOneRetry', () => {
  it('does not retry on success', async () => {
    const mock = vi.fn().mockResolvedValue(json(200));
    vi.stubGlobal('fetch', mock);
    const outcome = await fetchWithOneRetry('https://x.test', {}, ctx(), POLICY);
    expect(outcome.response.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('retries once after a 500', async () => {
    const mock = vi.fn().mockResolvedValueOnce(json(500)).mockResolvedValueOnce(json(200));
    vi.stubGlobal('fetch', mock);
    const context = ctx();
    const outcome = await fetchWithOneRetry('https://x.test', {}, context, POLICY);
    expect(outcome.response.status).toBe(200);
    expect(context.transcriptRetries).toBe(1);
    expect(context.summaryRetries).toBe(0);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('retries at most once', async () => {
    const mock = vi.fn().mockResolvedValue(json(503));
    vi.stubGlobal('fetch', mock);
    const outcome = await fetchWithOneRetry('https://x.test', {}, ctx(), POLICY);
    expect(outcome.response.status).toBe(503);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('never retries auth errors (401)', async () => {
    const mock = vi.fn().mockResolvedValue(json(401));
    vi.stubGlobal('fetch', mock);
    const outcome = await fetchWithOneRetry('https://x.test', {}, ctx(), POLICY);
    expect(outcome.response.status).toBe(401);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('never retries payment errors (402) or not-found (404)', async () => {
    for (const status of [402, 404]) {
      const mock = vi.fn().mockResolvedValue(json(status));
      vi.stubGlobal('fetch', mock);
      const outcome = await fetchWithOneRetry('https://x.test', {}, ctx(), POLICY);
      expect(outcome.response.status).toBe(status);
      expect(mock).toHaveBeenCalledTimes(1);
    }
  });

  it('honours Retry-After when it fits the deadline', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(429, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(json(200));
    vi.stubGlobal('fetch', mock);
    const outcome = await fetchWithOneRetry('https://x.test', {}, ctx(), POLICY);
    expect(outcome.response.status).toBe(200);
  });

  it('skips the retry when Retry-After does not fit the deadline', async () => {
    const mock = vi.fn().mockResolvedValueOnce(json(429, {}, { 'retry-after': '60' }));
    vi.stubGlobal('fetch', mock);
    const outcome = await fetchWithOneRetry('https://x.test', {}, ctx(500), POLICY);
    expect(outcome.response.status).toBe(429); // original error is not hidden
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('retries once after a network failure', async () => {
    const mock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json(200));
    vi.stubGlobal('fetch', mock);
    const outcome = await fetchWithOneRetry('https://x.test', {}, ctx(), POLICY);
    expect(outcome.response.status).toBe(200);
  });

  it('keeps the original error message when the retry also fails', async () => {
    const mock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('first failure'))
      .mockRejectedValueOnce(new TypeError('second failure'));
    vi.stubGlobal('fetch', mock);
    await expect(fetchWithOneRetry('https://x.test', {}, ctx(), POLICY)).rejects.toThrow(
      'first failure',
    );
  });

  it('does not retry when the deadline aborts the request', async () => {
    const mock = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    vi.stubGlobal('fetch', mock);
    await expect(fetchWithOneRetry('https://x.test', {}, ctx(), POLICY)).rejects.toThrow('aborted');
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
