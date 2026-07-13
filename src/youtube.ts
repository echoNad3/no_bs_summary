/**
 * Turns any supported YouTube link into the 11-character video ID.
 *
 * Supported forms:
 *   https://www.youtube.com/watch?v=VIDEOID   (extra query params are ignored)
 *   https://youtu.be/VIDEOID
 *   https://www.youtube.com/shorts/VIDEOID
 *   https://www.youtube.com/live/VIDEOID
 *
 * Anything else is rejected with a clear error — never silently skipped.
 */

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com']);

export function extractVideoId(rawUrl: string): string {
  const trimmed = rawUrl.trim();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Not a valid web address: "${trimmed}"`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Not a normal web link (must start with https://): "${trimmed}"`);
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let candidate: string | undefined;

  if (host === 'youtu.be') {
    candidate = url.pathname.split('/').filter(Boolean)[0];
  } else if (YOUTUBE_HOSTS.has(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/watch') {
      candidate = url.searchParams.get('v') ?? undefined;
    } else if ((parts[0] === 'shorts' || parts[0] === 'live') && parts[1]) {
      candidate = parts[1];
    } else {
      throw new Error(
        `This YouTube link type is not supported (only normal videos, youtu.be links, Shorts and live links work): "${trimmed}"`,
      );
    }
  } else {
    throw new Error(`Not a YouTube link: "${trimmed}"`);
  }

  if (!candidate || !VIDEO_ID_PATTERN.test(candidate)) {
    throw new Error(`Could not find a valid video ID in this link: "${trimmed}"`);
  }

  return candidate;
}
