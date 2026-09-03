// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkBackend, fetchVideoMetadata, summarizeVideo } from '../apps/shared/api-client.js';

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
  it('loads and validates a video title through the same backend', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ title: 'A real video title' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVideoMetadata('https://app.example/', 'dQw4w9WgXcQ')).resolves.toEqual({
      title: 'A real video title',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example/api/video-metadata?id=dQw4w9WgXcQ',
      expect.objectContaining({ method: 'GET' }),
    );

    fetchMock.mockResolvedValueOnce(Response.json({ title: '' }));
    await expect(fetchVideoMetadata('', 'dQw4w9WgXcQ')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

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
        {
          url: 'https://youtu.be/dQw4w9WgXcQ',
          title: 'Local display title',
          language: 'en',
        },
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
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      language: 'en',
    });
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
          access: 'owner',
          dailyGeneration: {
            used: 4,
            limit: 100,
            remaining: 96,
            resetsAt: '2026-08-09T00:00:00.000Z',
          },
          freeGeneration: {
            user: {
              used: 1,
              limit: 5,
              remaining: 4,
              resetsAt: '2026-09-01T00:00:00.000Z',
            },
            shared: {
              used: 8,
              limit: 50,
              remaining: 42,
              resetsAt: '2026-09-01T00:00:00.000Z',
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      checkBackend('https://app.example/', { password: 'shared secret' }),
    ).resolves.toMatchObject({
      access: 'owner',
      dailyGeneration: { remaining: 96 },
      freeGeneration: { user: { remaining: 4 }, shared: { remaining: 42 } },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example/api/status',
      expect.objectContaining({
        method: 'GET',
        headers: { 'x-app-password': 'shared secret' },
      }),
    );
  });

  it('rejects missing or internally inconsistent generation counters', async () => {
    const status = {
      status: 'ok',
      access: 'owner',
      dailyGeneration: {
        used: 4,
        limit: 100,
        remaining: 296,
        resetsAt: '2026-08-09T00:00:00.000Z',
      },
      freeGeneration: {
        user: { used: 1, limit: 5, remaining: 4, resetsAt: '2026-09-01T00:00:00.000Z' },
        shared: {
          used: 8,
          limit: 50,
          remaining: 42,
          resetsAt: '2026-09-01T00:00:00.000Z',
        },
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...status, freeGeneration: null }))
      .mockResolvedValueOnce(
        Response.json({
          ...status,
          dailyGeneration: { ...status.dailyGeneration, remaining: 999 },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkBackend('https://app.example/')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(checkBackend('https://app.example/')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
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
