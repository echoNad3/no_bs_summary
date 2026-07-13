import { describe, expect, it } from 'vitest';
import { summarySchema } from '../src/summary/provider.js';

describe('summary schema', () => {
  it('accepts a valid verdict object', () => {
    const parsed = summarySchema.parse({
      verdict: 'SKIP',
      reason: 'A 15-minute sales pitch stretched around one obvious point.',
      summary: 'The creator claims X helps with Y but offers no evidence.',
    });
    expect(parsed.verdict).toBe('SKIP');
  });

  it('rejects an unknown verdict', () => {
    const result = summarySchema.safeParse({
      verdict: 'MAYBE',
      reason: 'x',
      summary: 'y',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty reason or summary', () => {
    expect(summarySchema.safeParse({ verdict: 'WATCH', reason: '', summary: 'y' }).success).toBe(
      false,
    );
    expect(summarySchema.safeParse({ verdict: 'WATCH', reason: 'x', summary: '' }).success).toBe(
      false,
    );
  });
});
