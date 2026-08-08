import { isSummaryResult, type ApiClientError, type SummaryResult } from './api-client.js';
import { extractVideoId } from './youtube-input.js';

export type TextSize = 'normal' | 'large' | 'extra-large';

export interface SavedSummary {
  response: SummaryResult;
  title?: string;
  url: string;
  savedAt: string;
}

export function parseSavedSummary(value: unknown): SavedSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<SavedSummary>;
  if (
    typeof candidate.url !== 'string' ||
    typeof candidate.savedAt !== 'string' ||
    (candidate.title !== undefined && typeof candidate.title !== 'string') ||
    !isSummaryResult(candidate.response)
  ) {
    return undefined;
  }
  try {
    if (extractVideoId(candidate.url) !== candidate.response.videoId) return undefined;
  } catch {
    return undefined;
  }
  return candidate as SavedSummary;
}

export function parseTextSize(value: unknown): TextSize {
  return value === 'large' || value === 'extra-large' ? value : 'normal';
}

export function summaryReadingStats(summary: string): { words: number; minutes: number } {
  const words = summary.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return { words, minutes: Math.max(1, Math.ceil(words / 220)) };
}

export function safeDiagnosticsText(
  surface: 'PWA' | 'Chrome extension',
  error: Error & Partial<Pick<ApiClientError, 'code' | 'status' | 'retryAfterSeconds'>>,
  online: boolean,
  userAgent: string,
): string {
  return [
    'No BS Summary diagnostics',
    `Time: ${new Date().toISOString()}`,
    `Surface: ${surface}`,
    `Error: ${error.name}`,
    `Code: ${error.code ?? 'UNKNOWN'}`,
    `HTTP status: ${error.status ?? 'unknown'}`,
    `Retry after: ${error.retryAfterSeconds ?? 'unknown'}`,
    `Online: ${online}`,
    `Browser: ${userAgent}`,
  ].join('\n');
}
