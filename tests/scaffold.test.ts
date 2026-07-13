import { describe, expect, it } from 'vitest';
import { GeminiSummaryProvider } from '../src/summary/gemini.js';
import { summarySchema } from '../src/summary/provider.js';
import type { RunContext } from '../src/run-context.js';

function testContext(): RunContext {
  return {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 15000,
    retried: false,
  };
}

describe('summary schema and Gemini stub', () => {
  it('summarySchema accepts a valid verdict object', () => {
    const parsed = summarySchema.parse({
      verdict: 'SKIP',
      reason: 'A 15-minute sales pitch stretched around one obvious point.',
      summary: 'The creator claims X helps with Y but offers no evidence.',
    });
    expect(parsed.verdict).toBe('SKIP');
  });

  it('summarySchema rejects an unknown verdict', () => {
    const result = summarySchema.safeParse({
      verdict: 'MAYBE',
      reason: 'x',
      summary: 'y',
    });
    expect(result.success).toBe(false);
  });

  it('Gemini provider is a stub until Phase 3', async () => {
    const gemini = new GeminiSummaryProvider('test-key', 'gemini-3.1-flash-lite');
    expect(gemini.name).toBe('gemini');
    await expect(gemini.summarize('transcript text', testContext())).rejects.toThrow(
      'not implemented',
    );
  });
});
