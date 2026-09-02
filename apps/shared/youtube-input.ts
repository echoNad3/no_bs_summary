import { extractVideoId } from '../../src/youtube.js';

export function firstYouTubeUrl(text: string): string {
  const match = text.match(
    /https:\/\/(?:youtu\.be\/|(?:www\.|m\.|music\.)?youtube\.com\/(?:watch|shorts\/|live\/))[^\s<]+/iu,
  );
  if (!match) return '';
  return match[0].replace(/[)\]},.;!?'”’]+$/u, '');
}

export { extractVideoId } from '../../src/youtube.js';

export function youtubeThumbnailUrl(rawUrl: string): string | undefined {
  try {
    return `https://i.ytimg.com/vi/${extractVideoId(rawUrl)}/hqdefault.jpg`;
  } catch {
    return undefined;
  }
}
