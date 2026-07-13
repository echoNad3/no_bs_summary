import { describe, expect, it } from 'vitest';
import { assertUsableTranscript, normalizeSegments } from '../src/transcript/normalize.js';

describe('normalizeSegments', () => {
  it('collapses whitespace and keeps order', () => {
    const { text, segments } = normalizeSegments([
      { text: '  hello \n world ', startMs: 0, durationMs: 1000 },
      { text: 'second   line', startMs: 1000, durationMs: 1000 },
    ]);
    expect(text).toBe('hello world second line');
    expect(segments.map((segment) => segment.text)).toEqual(['hello world', 'second line']);
  });

  it('removes only exact consecutive duplicates', () => {
    const { segments } = normalizeSegments([
      { text: 'same line', startMs: 0, durationMs: 1 },
      { text: 'same  line', startMs: 1, durationMs: 1 }, // same after whitespace cleanup
      { text: 'different', startMs: 2, durationMs: 1 },
      { text: 'same line', startMs: 3, durationMs: 1 }, // not consecutive — kept
    ]);
    expect(segments.map((segment) => segment.text)).toEqual([
      'same line',
      'different',
      'same line',
    ]);
  });

  it('drops segments that are empty after cleanup', () => {
    const { segments } = normalizeSegments([
      { text: '   ', startMs: 0, durationMs: 1 },
      { text: 'real', startMs: 1, durationMs: 1 },
    ]);
    expect(segments).toHaveLength(1);
  });
});

describe('assertUsableTranscript', () => {
  it('rejects an empty transcript', () => {
    expect(() => assertUsableTranscript('', 'TestProvider')).toThrow('empty transcript');
  });

  it('accepts a normal transcript', () => {
    expect(() => assertUsableTranscript('some words', 'TestProvider')).not.toThrow();
  });
});
