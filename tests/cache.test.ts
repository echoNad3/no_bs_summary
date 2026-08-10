import { describe, expect, it } from 'vitest';
import { cacheKey, MemoryTranscriptStore } from '../src/transcript/store.js';
import type { TranscriptResult } from '../src/transcript/provider.js';

const transcript: TranscriptResult = {
  provider: 'transcriptapi',
  videoId: 'dQw4w9WgXcQ',
  language: 'en',
  text: 'hello world',
  segments: [{ text: 'hello world', startMs: 0, durationMs: 1000 }],
};

describe('transcript memory cache', () => {
  it('keys entries by provider, video, and requested language', () => {
    expect(cacheKey('transcriptapi', 'dQw4w9WgXcQ')).toBe('v2-transcriptapi-dQw4w9WgXcQ-default');
    expect(cacheKey('transcriptapi', 'abc12345678', 'en')).toBe('v2-transcriptapi-abc12345678-en');
  });

  it('validates, stores, and reads an entry', async () => {
    const cache = new MemoryTranscriptStore();
    const key = cacheKey('transcriptapi', transcript.videoId, 'en');
    await cache.write(key, transcript);
    await expect(cache.read(key)).resolves.toEqual(transcript);
    await expect(
      cache.read(key, { provider: 'other', videoId: transcript.videoId }),
    ).resolves.toBeUndefined();
  });

  it('rejects malformed transcript data', async () => {
    const cache = new MemoryTranscriptStore();
    await expect(cache.write('bad', { ...transcript, text: '' })).rejects.toThrow();
  });

  it('keeps the warm-isolate cache bounded', async () => {
    const cache = new MemoryTranscriptStore();
    for (let index = 0; index < 17; index += 1) {
      const videoId = `video${String(index).padStart(6, '0')}`;
      await cache.write(String(index), { ...transcript, videoId });
    }
    await expect(cache.read('0')).resolves.toBeUndefined();
    await expect(cache.read('16')).resolves.toBeDefined();
  });
});
