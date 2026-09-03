// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LatestVideoTitleLookup } from '../apps/shared/video-title.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('latest video title lookup', () => {
  it('debounces input and only applies the newest video title', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (_base: string, videoId: string) => ({
      title: `Title for ${videoId}`,
    }));
    const onTitle = vi.fn();
    const lookup = new LatestVideoTitleLookup('https://app.example', 25, fetcher);

    lookup.request('https://youtu.be/EwMSGdE2bOQ', onTitle);
    lookup.request('https://youtu.be/dQw4w9WgXcQ', onTitle);
    await vi.advanceTimersByTimeAsync(25);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://app.example',
      'dQw4w9WgXcQ',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(onTitle).toHaveBeenCalledWith('Title for dQw4w9WgXcQ', 'dQw4w9WgXcQ');
  });

  it('ignores failures and does not request metadata for invalid links', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    const onTitle = vi.fn();
    const lookup = new LatestVideoTitleLookup('', 10, fetcher);

    lookup.request('https://example.com', onTitle);
    await vi.advanceTimersByTimeAsync(20);
    expect(fetcher).not.toHaveBeenCalled();

    lookup.request('https://youtu.be/dQw4w9WgXcQ', onTitle);
    await vi.advanceTimersByTimeAsync(10);
    expect(onTitle).not.toHaveBeenCalled();
  });
});
