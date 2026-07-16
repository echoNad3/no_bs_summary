import { extractVideoId } from '../../../src/youtube.js';

export interface TabContext {
  url?: string;
  title?: string;
}

export interface YouTubeTabContext {
  url: string;
  title?: string;
}

export function getYouTubeTabContext(tab: TabContext | undefined): YouTubeTabContext | undefined {
  if (!tab?.url) return undefined;

  try {
    extractVideoId(tab.url);
  } catch {
    return undefined;
  }

  const title = tab.title?.replace(/\s+-\s+YouTube$/iu, '').trim();
  return { url: tab.url, title: title || undefined };
}
