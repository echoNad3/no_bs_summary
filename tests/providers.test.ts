import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../src/request-context.js';
import { TranscriptApiProvider } from '../src/transcript/transcriptapi.js';

const ID = 'dQw4w9WgXcQ';

function ctx(): RequestContext {
  return {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 15000,
    transcriptRetries: 0,
    summaryRetries: 0,
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TranscriptApiProvider', () => {
  it('requests v2 JSON and converts seconds to milliseconds', async () => {
    const mock = vi.fn().mockResolvedValue(
      json(200, {
        video_id: ID,
        language: 'en',
        transcript: [
          { text: 'first line', start: 0.5, duration: 1.25 },
          { text: 'second line', start: 1.75, duration: 2 },
        ],
      }),
    );
    vi.stubGlobal('fetch', mock);

    const result = await new TranscriptApiProvider('key').fetchTranscript(ID, ctx());

    const calledUrl = String(mock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('/api/v2/youtube/transcript');
    expect(calledUrl).toContain(`video_url=${ID}`);
    expect(calledUrl).toContain('language=en');
    expect(calledUrl).toContain('format=json');
    expect(calledUrl).toContain('include_timestamp=true');
    expect(calledUrl).toContain('send_metadata=false');
    const headers = (mock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer key');

    expect(result.text).toBe('first line second line');
    expect(result.segments?.[0]).toEqual({ text: 'first line', startMs: 500, durationMs: 1250 });
    expect(result.language).toBe('en');
  });

  it('fails clearly when no captions exist (404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(404, {})));
    await expect(new TranscriptApiProvider('key').fetchTranscript(ID, ctx())).rejects.toThrow(
      'no captions',
    );
  });

  it('fails clearly when credits run out (402)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(402, {})));
    await expect(new TranscriptApiProvider('key').fetchTranscript(ID, ctx())).rejects.toThrow(
      'credits',
    );
  });

  it('rejects a response in an unexpected shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { transcript: 'not-a-list' })));
    await expect(new TranscriptApiProvider('key').fetchTranscript(ID, ctx())).rejects.toThrow(
      'unexpected format',
    );
  });

  it('rejects transcript data for a different video', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(200, {
          video_id: 'abcdefghijk',
          language: 'en',
          transcript: [{ text: 'wrong video', start: 0, duration: 1 }],
        }),
      ),
    );
    await expect(new TranscriptApiProvider('key').fetchTranscript(ID, ctx())).rejects.toThrow(
      'different video',
    );
  });

  it('requests the configured language and rejects a different language family', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        json(200, {
          video_id: ID,
          language: 'asr-de',
          transcript: [{ text: 'Guten Tag', start: 0, duration: 1 }],
        }),
      )
      .mockResolvedValueOnce(
        json(200, {
          video_id: ID,
          language: 'en',
          transcript: [{ text: 'wrong language', start: 0, duration: 1 }],
        }),
      );
    vi.stubGlobal('fetch', mock);
    const provider = new TranscriptApiProvider('key');

    const result = await provider.fetchTranscript(ID, ctx(), 'de');
    expect(String(mock.mock.calls[0]?.[0])).toContain('language=de');
    expect(result.language).toBe('asr-de');
    await expect(provider.fetchTranscript(ID, ctx(), 'de')).rejects.toThrow(
      'instead of requested de',
    );
  });

  it('requires the documented language and valid non-negative timing values', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          json(200, {
            video_id: ID,
            transcript: [{ text: 'missing language', start: 0, duration: 1 }],
          }),
        )
        .mockResolvedValueOnce(
          json(200, {
            video_id: ID,
            language: 'en',
            transcript: [{ text: 'bad timing', start: -1, duration: 1 }],
          }),
        ),
    );
    const provider = new TranscriptApiProvider('key');
    await expect(provider.fetchTranscript(ID, ctx())).rejects.toThrow('unexpected format');
    await expect(provider.fetchTranscript(ID, ctx())).rejects.toThrow('unexpected format');
  });

  it('retries documented 503 once but does not retry a 500', async () => {
    const retry503 = vi
      .fn()
      .mockResolvedValueOnce(json(503, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(
        json(200, {
          video_id: ID,
          language: 'en',
          transcript: [{ text: 'ok', start: 0, duration: 1 }],
        }),
      );
    vi.stubGlobal('fetch', retry503);
    const retryContext = ctx();
    await new TranscriptApiProvider('key').fetchTranscript(ID, retryContext);
    expect(retry503).toHaveBeenCalledTimes(2);
    expect(retryContext.transcriptRetries).toBe(1);

    const noRetry500 = vi.fn().mockResolvedValue(json(500, {}));
    vi.stubGlobal('fetch', noRetry500);
    await expect(new TranscriptApiProvider('key').fetchTranscript(ID, ctx())).rejects.toThrow(
      '500',
    );
    expect(noRetry500).toHaveBeenCalledTimes(1);
  });

  it('preserves the first HTTP failure when the retry ends in a permanent error', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(503, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(json(404, {}));
    vi.stubGlobal('fetch', mock);
    await expect(new TranscriptApiProvider('key').fetchTranscript(ID, ctx())).rejects.toThrow(
      /no captions.*First attempt failed with HTTP 503/,
    );
  });
});
