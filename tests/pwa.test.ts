import { describe, expect, it } from 'vitest';
import { firstYouTubeUrl, readSharedValues } from '../apps/pwa/src/share.js';

describe('PWA share target parsing', () => {
  it('prefers the shared URL and keeps the shared title', () => {
    expect(
      readSharedValues(
        '?title=Useful+video&text=ignore+me&url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ',
      ),
    ).toEqual({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      title: 'Useful video',
      wasShared: true,
    });
  });

  it('extracts a YouTube URL from shared text and trims punctuation', () => {
    expect(firstYouTubeUrl('Watch this: https://www.youtube.com/watch?v=dQw4w9WgXcQ).')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
  });

  it('does not mark a normal launch as shared', () => {
    expect(readSharedValues('')).toEqual({ url: '', title: '', wasShared: false });
  });
});
