import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SUMMARY_REQUEST_TIMEOUT_MS } from '../apps/shared/api-client.js';
import { countSentences, SUMMARY_CHARACTER_LIMIT, summarySchema } from '../src/summary/provider.js';
import { DEFAULT_END_TO_END_TIMEOUT_MS } from '../src/config.js';

describe('summary schema', () => {
  it('accepts a valid verdict object', () => {
    const parsed = summarySchema.parse({
      verdict: 'SKIP',
      reason: 'A long sales pitch stretched around one obvious point.',
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

  it('allows detailed summaries well beyond the old tiny word limit', () => {
    const detailed = `${Array(220).fill('specific').join(' ')}.`;
    expect(
      summarySchema.safeParse({
        verdict: 'WATCH',
        reason: 'It stays useful and specific.',
        summary: detailed,
      }).success,
    ).toBe(true);
    expect(
      summarySchema.safeParse({
        verdict: 'WATCH',
        reason: 'It stays useful and specific.',
        summary: 'x'.repeat(SUMMARY_CHARACTER_LIMIT + 1),
      }).success,
    ).toBe(false);
  });

  it('lets information density set summary length but keeps the reason to one sentence', () => {
    const detailedSummary =
      'First useful point. Second useful point. Third useful point. Fourth useful point. Fifth useful point. Sixth useful point. Seventh useful point.';
    expect(countSentences(detailedSummary)).toBe(7);
    expect(
      summarySchema.safeParse({
        verdict: 'WATCH',
        reason: 'It is useful and easy to follow.',
        summary: detailedSummary,
      }).success,
    ).toBe(true);
    expect(
      summarySchema.safeParse({
        verdict: 'WATCH',
        reason: 'It is useful. It is also easy to follow.',
        summary: 'One useful point.',
      }).success,
    ).toBe(false);
  });

  it('enforces the advertised under-25-word verdict reason', () => {
    const reason = Array.from({ length: 25 }, (_, index) => `word${index}`).join(' ');
    expect(
      summarySchema.safeParse({ verdict: 'WATCH', reason, summary: 'One useful point.' }).success,
    ).toBe(false);
  });

  it('does not count common abbreviations as extra sentences', () => {
    expect(
      countSentences('Alertness vs. calmness is one axis. Feeling good vs. bad is another axis.'),
    ).toBe(2);
  });

  it('rejects generic AI openings, prompt leakage, and repeated ideas', () => {
    expect(
      summarySchema.safeParse({
        verdict: 'SKIP',
        reason: 'The video wastes time.',
        summary: 'One weak claim.',
      }).success,
    ).toBe(false);
    expect(
      summarySchema.safeParse({
        verdict: 'SKIP',
        reason: 'The prompt asks me to judge a video from a transcript.',
        summary: 'I have no way to evaluate the teaching.',
      }).success,
    ).toBe(false);
    expect(
      summarySchema.safeParse({
        verdict: 'WATCH',
        reason: 'A dialogue-driven narrative builds a conceptual model.',
        summary: 'No definitive evidence fundamentally changes the idea.',
      }).success,
    ).toBe(true);
    expect(
      summarySchema.safeParse({
        verdict: 'SKIP',
        reason: 'Most lessons are basic, but some sections still help.',
        summary: 'Watch only the specific sections you need for loops, files, or classes.',
      }).success,
    ).toBe(false);
    expect(
      summarySchema.safeParse({
        verdict: 'WATCH',
        reason: 'Guided dialogue drills make the lesson worth doing.',
        summary:
          'After reading this summary, would the user still gain meaningful value from watching? Yes.',
      }).success,
    ).toBe(false);
    expect(
      summarySchema.safeParse({
        verdict: 'WATCH',
        reason: 'The instructor provides physical cues for every pose.',
        summary: 'The routine moves through Cat-Cow, Downward Dog, and Warrior poses.',
      }).success,
    ).toBe(true);
    expect(
      summarySchema.safeParse({
        verdict: 'WATCH',
        reason: 'The full sequence matters.',
        summary: 'The lesson builds a working program from variables through classes.',
      }).success,
    ).toBe(false);
    expect(
      summarySchema.safeParse({
        verdict: 'SKIP',
        reason: 'Documentation is an automatic replacement for this structured tutorial.',
        summary: 'The course teaches variables, loops, files, and classes through worked examples.',
      }).success,
    ).toBe(false);
    expect(
      summarySchema.safeParse({
        verdict: 'WATCH',
        reason: 'This is a comprehensive course ideal for beginners.',
        summary: 'Learn Python from variables through classes and files.',
      }).success,
    ).toBe(false);
    expect(
      summarySchema.safeParse({
        verdict: 'WATCH',
        reason: 'Strong visual demonstration makes the lesson worthwhile.',
        summary: 'Backpropagation adjusts weights from prediction errors.',
      }).success,
    ).toBe(true);
    expect(
      summarySchema.safeParse({
        verdict: 'SKIM',
        reason: 'Standard advice buried inside a long sales pitch.',
        summary: 'Standard advice is buried inside a sales pitch with little else.',
      }).success,
    ).toBe(false);
  });

  it('rejects whitespace-only or identical reason and summary text', () => {
    expect(
      summarySchema.safeParse({ verdict: 'SKIP', reason: ' ', summary: 'Useful.' }).success,
    ).toBe(false);
    expect(
      summarySchema.safeParse({ verdict: 'SKIP', reason: 'Same idea.', summary: 'same idea.' })
        .success,
    ).toBe(false);
  });

  it('allows explicit duration facts that belong in a detailed summary', () => {
    expect(
      summarySchema.safeParse({
        verdict: 'WATCH',
        reason: 'The recipe is specific and easy to follow.',
        summary: 'Bake the mixture for twenty minutes, then let it rest for one hour.',
      }).success,
    ).toBe(true);
  });
});

describe('request deadline', () => {
  it('gives the two-provider pipeline enough time and keeps the client deadline longer', async () => {
    const config = await fs.readFile('wrangler.jsonc', 'utf8');
    expect(config).toContain(`"END_TO_END_TIMEOUT_MS": "${DEFAULT_END_TO_END_TIMEOUT_MS}"`);
    expect(DEFAULT_END_TO_END_TIMEOUT_MS).toBe(60_000);
    expect(DEFAULT_SUMMARY_REQUEST_TIMEOUT_MS).toBe(70_000);
    expect(DEFAULT_SUMMARY_REQUEST_TIMEOUT_MS).toBeGreaterThan(DEFAULT_END_TO_END_TIMEOUT_MS);
  });
});
