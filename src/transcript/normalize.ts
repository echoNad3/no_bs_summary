import type { TranscriptSegment } from './provider.js';

/**
 * Cleans up raw caption segments without changing their meaning or order:
 * - collapses runs of whitespace inside each segment into single spaces
 * - drops segments that are empty after cleanup
 * - removes a segment only when its text is exactly the same as the
 *   previous segment's text (captions often repeat lines back-to-back)
 *
 * No rewriting, no summarizing, no clever guessing.
 */
export function normalizeSegments(rawSegments: TranscriptSegment[]): {
  text: string;
  segments: TranscriptSegment[];
} {
  const segments: TranscriptSegment[] = [];
  let previousText: string | undefined;

  for (const raw of rawSegments) {
    const text = raw.text.replace(/\s+/g, ' ').trim();
    if (text === '') continue;
    if (text === previousText) continue; // exact consecutive duplicate
    segments.push({ text, startMs: raw.startMs, durationMs: raw.durationMs });
    previousText = text;
  }

  const text = segments.map((segment) => segment.text).join(' ');
  return { text, segments };
}

/** Throws a clear error if a transcript is empty or obviously unusable. */
export function assertUsableTranscript(text: string, provider: string): void {
  if (text.trim() === '') {
    throw new Error(`${provider} returned an empty transcript (no usable caption text).`);
  }
}
