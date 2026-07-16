import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunContext } from '../src/run-context.js';
import { SupadataProvider } from '../src/transcript/supadata.js';
import { TranscriptApiProvider } from '../src/transcript/transcriptapi.js';

const ID = 'dQw4w9WgXcQ';

function ctx(): RunContext {
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

describe('SupadataProvider', () => {
  it('requests native mode with segments and normalizes the response', async () => {
    const mock = vi.fn().mockResolvedValue(
      json(200, {
        content: [
          { text: ' hello ', offset: 0, duration: 1000, lang: 'en' },
          { text: 'hello', offset: 1000, duration: 1000, lang: 'en' }, // consecutive duplicate
          { text: 'world', offset: 2000, duration: 1000, lang: 'en' },
        ],
        lang: 'en',
        availableLangs: ['en', 'de'],
      }),
    );
    vi.stubGlobal('fetch', mock);

    const result = await new SupadataProvider('key').fetchTranscript(ID, ctx());

    const calledUrl = String(mock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('mode=native');
    expect(calledUrl).toContain('text=false');
    expect(calledUrl).toContain('lang=en');
    expect(calledUrl).toContain(encodeURIComponent(`https://www.youtube.com/watch?v=${ID}`));
    const headers = (mock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('key');

    expect(result.provider).toBe('supadata');
    expect(result.videoId).toBe(ID);
    expect(result.language).toBe('en');
    expect(result.text).toBe('hello world');
    expect(result.segments).toHaveLength(2);
    expect(result.metadata).toEqual({ availableLangs: ['en', 'de'] });
  });

  it('fails clearly on an async job answer (202)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(202, { jobId: 'j1' })));
    await expect(new SupadataProvider('key').fetchTranscript(ID, ctx())).rejects.toThrow(
      'async job',
    );
  });

  it('fails clearly when no captions exist (206)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 206 })));
    await expect(new SupadataProvider('key').fetchTranscript(ID, ctx())).rejects.toThrow(
      'no existing captions',
    );
  });

  it('fails clearly on a bad API key without leaking it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(403, {})));
    const error = await new SupadataProvider('secret-key')
      .fetchTranscript(ID, ctx())
      .catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('API key');
    expect((error as Error).message).not.toContain('secret-key');
  });

  it('rejects a response in an unexpected shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { nope: true })));
    await expect(new SupadataProvider('key').fetchTranscript(ID, ctx())).rejects.toThrow(
      'unexpected format',
    );
  });

  it('rejects an empty transcript', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(200, { content: [], lang: 'en', availableLangs: ['en'] })),
    );
    await expect(new SupadataProvider('key').fetchTranscript(ID, ctx())).rejects.toThrow(
      'unexpected format',
    );
  });

  it('requires documented language fields and valid timing values', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          json(200, {
            content: [{ text: 'missing language', offset: 0, duration: 1, lang: 'en' }],
            availableLangs: ['en'],
          }),
        )
        .mockResolvedValueOnce(
          json(200, {
            content: [{ text: 'bad timing', offset: -1, duration: 1, lang: 'en' }],
            lang: 'en',
            availableLangs: ['en'],
          }),
        ),
    );
    const provider = new SupadataProvider('key');
    await expect(provider.fetchTranscript(ID, ctx())).rejects.toThrow('unexpected format');
    await expect(provider.fetchTranscript(ID, ctx())).rejects.toThrow('unexpected format');
  });

  it('retries a documented Supadata infrastructure failure once', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(500, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(
        json(200, {
          content: [{ text: 'ok', offset: 0, duration: 1, lang: 'en' }],
          lang: 'en',
          availableLangs: ['en'],
        }),
      );
    vi.stubGlobal('fetch', mock);
    const context = ctx();
    await new SupadataProvider('key').fetchTranscript(ID, context);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(context.transcriptRetries).toBe(1);
  });

  it('does not retry Supadata plan-limit errors', async () => {
    const mock = vi.fn().mockResolvedValue(json(429, {}));
    vi.stubGlobal('fetch', mock);
    await expect(new SupadataProvider('key').fetchTranscript(ID, ctx())).rejects.toThrow('429');
    expect(mock).toHaveBeenCalledTimes(1);
  });
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
