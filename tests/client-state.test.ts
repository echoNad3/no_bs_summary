import { describe, expect, it } from 'vitest';
import {
  parseSavedSummary,
  parseTextSize,
  safeDiagnosticsText,
} from '../apps/shared/client-state.js';
import { ApiClientError } from '../apps/shared/api-client.js';
import { firstYouTubeUrl, youtubeThumbnailUrl } from '../apps/shared/youtube-input.js';

const saved = {
  response: {
    verdict: 'WATCH',
    reason: 'Worth it.',
    summary: 'Useful detail.',
    videoId: 'dQw4w9WgXcQ',
    language: 'en',
    source: 'CACHED',
    timing: { summaryMs: 10 },
    retries: { transcript: 0, summary: 0 },
  },
  title: 'A video',
  url: 'https://youtu.be/dQw4w9WgXcQ',
  savedAt: '2026-08-08T12:00:00.000Z',
};

describe('client quality-of-life state', () => {
  it('restores only structurally valid summaries matching their YouTube URL', () => {
    expect(parseSavedSummary(saved)).toEqual(saved);
    expect(parseSavedSummary({ ...saved, url: 'https://youtu.be/EwMSGdE2bOQ' })).toBeUndefined();
    expect(
      parseSavedSummary({ ...saved, response: { summary: 'missing fields' } }),
    ).toBeUndefined();
  });

  it('normalizes text-size preferences', () => {
    expect(parseTextSize('large')).toBe('large');
    expect(parseTextSize('anything')).toBe('normal');
  });

  it('creates diagnostics without URL, password, captions, or summary content', () => {
    const report = safeDiagnosticsText(
      'PWA',
      new ApiClientError('Too many requests.', 'RATE_LIMITED', 429, 12),
      true,
      'Test Browser',
    );
    expect(report).toContain('Code: RATE_LIMITED');
    expect(report).toContain('Retry after: 12');
    expect(report).not.toMatch(/youtu|password|caption|Useful detail/iu);
  });

  it('handles ReVanced-style mobile and short YouTube share URLs', () => {
    expect(firstYouTubeUrl('Watch this https://m.youtube.com/watch?v=dQw4w9WgXcQ now')).toBe(
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    expect(firstYouTubeUrl('Watch [https://youtu.be/dQw4w9WgXcQ].')).toBe(
      'https://youtu.be/dQw4w9WgXcQ',
    );
    expect(youtubeThumbnailUrl('https://youtu.be/dQw4w9WgXcQ?si=tracking')).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    );
  });
});
