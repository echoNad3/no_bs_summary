// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { fetchYouTubeVideoMetadata } from '../src/video-metadata.js';

describe('YouTube video metadata', () => {
  it('uses the fixed oEmbed provider and sanitizes its title', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ title: '  A\n useful\t video title  ', author_name: 'Ignored' }),
      );

    await expect(fetchYouTubeVideoMetadata('dQw4w9WgXcQ', fetcher)).resolves.toEqual({
      title: 'A useful video title',
    });
    const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.origin).toBe('https://www.youtube.com');
    expect(url.pathname).toBe('/oembed');
    expect(url.searchParams.get('url')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(init.headers).toEqual({ Accept: 'application/json' });
  });

  it('rejects invalid IDs without making an outbound request', async () => {
    const fetcher = vi.fn();
    await expect(fetchYouTubeVideoMetadata('not-an-id', fetcher)).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_VIDEO_ID',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps missing, oversized, and malformed provider responses to safe errors', async () => {
    await expect(
      fetchYouTubeVideoMetadata(
        'dQw4w9WgXcQ',
        vi.fn().mockResolvedValue(new Response('', { status: 404 })),
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: 'VIDEO_NOT_FOUND' });

    await expect(
      fetchYouTubeVideoMetadata(
        'dQw4w9WgXcQ',
        vi
          .fn()
          .mockResolvedValue(
            new Response('{"title":"x"}', { headers: { 'content-length': '50000' } }),
          ),
      ),
    ).rejects.toMatchObject({ statusCode: 502, code: 'METADATA_UNAVAILABLE' });

    await expect(
      fetchYouTubeVideoMetadata(
        'dQw4w9WgXcQ',
        vi.fn().mockResolvedValue(new Response('{not json')),
      ),
    ).rejects.toMatchObject({ statusCode: 502, code: 'METADATA_UNAVAILABLE' });
  });
});
