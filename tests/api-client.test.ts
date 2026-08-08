// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkBackend, summarizeVideo } from '../apps/shared/api-client.js';

const validResponse = {
  verdict: 'WATCH',
  reason: 'It gets to the point.',
  summary: 'Useful detail.',
  videoId: 'dQw4w9WgXcQ',
  language: 'en',
  source: 'CACHED',
  timing: { summaryMs: 10 },
  retries: { transcript: 0, summary: 0 },
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('browser API client', () => {
  it('normalizes the backend URL and sends the shared password', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      summarizeVideo(
        'https://app.example/',
        { url: 'https://youtu.be/dQw4w9WgXcQ', language: 'en' },
        { password: 'shared secret' },
      ),
    ).resolves.toEqual(validResponse);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example/api/summarize',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-app-password': 'shared secret' }),
      }),
    );
  });

  it('distinguishes a caller cancellation from a network failure', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const pending = summarizeVideo(
      '',
      { url: 'https://youtu.be/dQw4w9WgXcQ', language: 'en' },
      { signal: controller.signal },
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
  });

  it('stops a hung request after the client deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );

    const pending = summarizeVideo(
      '',
      { url: 'https://youtu.be/dQw4w9WgXcQ', language: 'en' },
      { timeoutMs: 25 },
    );
    const rejection = expect(pending).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
  });

  it('tests the saved password and reads the backend generation budget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          cache: 'cloud',
          dailyGeneration: {
            used: 4,
            limit: 300,
            remaining: 296,
            resetsAt: '2026-08-09T00:00:00.000Z',
          },
          transcriptApiCredits: {
            availableViaApi: false,
            dashboardUrl: 'https://transcriptapi.com/billing',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      checkBackend('https://app.example/', { password: 'shared secret' }),
    ).resolves.toMatchObject({ dailyGeneration: { remaining: 296 } });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example/api/status',
      expect.objectContaining({
        method: 'GET',
        headers: { 'x-app-password': 'shared secret' },
      }),
    );
  });

  it('keeps HTTP status and retry timing on public API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'RATE_LIMITED', message: 'Try again in 12 seconds.' },
          }),
          { status: 429, headers: { 'retry-after': '12' } },
        ),
      ),
    );

    await expect(
      summarizeVideo('', { url: 'https://youtu.be/dQw4w9WgXcQ', language: 'en' }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429, retryAfterSeconds: 12 });
  });
});
