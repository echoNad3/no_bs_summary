import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cacheKey, TranscriptCache } from '../src/cache.js';
import type { TranscriptResult } from '../src/transcript/provider.js';

const transcript: TranscriptResult = {
  provider: 'supadata',
  videoId: 'dQw4w9WgXcQ',
  language: 'en',
  text: 'hello world',
  segments: [{ text: 'hello world', startMs: 0, durationMs: 1000 }],
};

let dir: string;
let cache: TranscriptCache;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nbs-cache-test-'));
  cache = new TranscriptCache(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('cacheKey', () => {
  it('includes version, provider, video ID and requested language', () => {
    expect(cacheKey('supadata', 'dQw4w9WgXcQ')).toBe('v2-supadata-dQw4w9WgXcQ-default');
    expect(cacheKey('transcriptapi', 'abc12345678', 'en')).toBe('v2-transcriptapi-abc12345678-en');
  });

  it('differs per provider so providers never share cache entries', () => {
    expect(cacheKey('supadata', 'dQw4w9WgXcQ')).not.toBe(cacheKey('transcriptapi', 'dQw4w9WgXcQ'));
  });
});

describe('TranscriptCache', () => {
  it('returns undefined for a missing entry', async () => {
    expect(await cache.read('nope')).toBeUndefined();
  });

  it('writes and reads a transcript back unchanged', async () => {
    const key = cacheKey('supadata', transcript.videoId);
    await cache.write(key, transcript);
    expect(await cache.read(key)).toEqual(transcript);
  });

  it('writes atomically (no leftover temp files)', async () => {
    const key = cacheKey('supadata', transcript.videoId);
    await cache.write(key, transcript);
    const files = await fs.readdir(dir);
    expect(files).toEqual([`${key}.json`]);
  });

  it('atomically replaces an existing cache entry', async () => {
    const key = cacheKey('supadata', transcript.videoId);
    await cache.write(key, transcript);
    const replacement: TranscriptResult = {
      ...transcript,
      text: 'replacement text',
      segments: [{ text: 'replacement text', startMs: 10, durationMs: 500 }],
    };
    await cache.write(key, replacement);
    expect(await cache.read(key)).toEqual(replacement);
    expect(await fs.readdir(dir)).toEqual([`${key}.json`]);
  });

  it('treats a corrupt file as a cache miss', async () => {
    const key = cacheKey('supadata', transcript.videoId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${key}.json`), '{ not valid json', 'utf8');
    expect(await cache.read(key)).toBeUndefined();
  });

  it('rejects empty text, invalid language, inconsistent segments and negative timing', async () => {
    const key = cacheKey('supadata', transcript.videoId);
    await fs.mkdir(dir, { recursive: true });
    const invalidEntries = [
      { ...transcript, text: '' },
      { ...transcript, language: 'not a language' },
      { ...transcript, text: 'does not match segments' },
      {
        ...transcript,
        segments: [{ text: 'hello world', startMs: -1, durationMs: 1000 }],
      },
    ];
    for (const entry of invalidEntries) {
      await fs.writeFile(path.join(dir, `${key}.json`), JSON.stringify(entry), 'utf8');
      expect(await cache.read(key)).toBeUndefined();
    }
  });

  it('rejects a cache entry whose provider or video does not match the requested key', async () => {
    const key = cacheKey('supadata', transcript.videoId);
    await cache.write(key, transcript);
    expect(
      await cache.read(key, { provider: 'transcriptapi', videoId: transcript.videoId }),
    ).toBeUndefined();
    expect(await cache.read(key, { provider: 'supadata', videoId: 'abcdefghijk' })).toBeUndefined();
  });

  it('refuses to write invalid transcript data', async () => {
    const invalid = { ...transcript, text: '' };
    await expect(cache.write(cacheKey('supadata', transcript.videoId), invalid)).rejects.toThrow();
  });

  it('clear() removes everything', async () => {
    const key = cacheKey('supadata', transcript.videoId);
    await cache.write(key, transcript);
    await cache.clear();
    expect(await cache.read(key)).toBeUndefined();
  });
});
