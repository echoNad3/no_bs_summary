import { extractVideoId } from '../../../src/youtube.js';

export interface TabContext {
  url?: string;
  title?: string;
}

export interface YouTubeTabContext {
  videoId: string;
  url: string;
  title?: string;
}

export function getYouTubeTabContext(tab: TabContext | undefined): YouTubeTabContext | undefined {
  if (!tab?.url) return undefined;

  try {
    const videoId = extractVideoId(tab.url);
    const title = tab.title?.replace(/\s+-\s+YouTube$/iu, '').trim();
    return { videoId, url: tab.url, title: title || undefined };
  } catch {
    return undefined;
  }
}
