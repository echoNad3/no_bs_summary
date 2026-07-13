import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunContext } from '../src/run-context.js';
import { SupadataProvider } from '../src/transcript/supadata.js';
import { TranscriptApiProvider } from '../src/transcript/transcriptapi.js';

const ID = 'dQw4w9WgXcQ';

function ctx(): RunContext {
  return {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 15000,
    retried: false,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { content: [], lang: 'en' })));
    await expect(new SupadataProvider('key').fetchTranscript(ID, ctx())).rejects.toThrow(
      'empty transcript',
    );
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
    expect(calledUrl).toContain('format=json');
    expect(calledUrl).not.toContain('send_metadata=true');
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
});
