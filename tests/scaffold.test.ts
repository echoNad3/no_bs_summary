import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SUMMARY_REQUEST_TIMEOUT_MS } from '../apps/shared/api-client.js';
import { DEFAULT_END_TO_END_TIMEOUT_MS } from '../src/config.js';
import {
  countGeneratedWords,
  countSentences,
  parseCanonicalSummaryPoints,
  serializeSummaryPoints,
  SUMMARY_CHARACTER_LIMIT,
  summaryResponseSchema,
  summarySchema,
  type SummaryPoint,
} from '../src/summary/provider.js';

function output(summary: string, reason = 'Specific and useful without wasting time.') {
  return { verdict: 'WATCH' as const, reason, summary };
}

function point(label: string, body: string): string {
  return serializeSummaryPoints([{ label, body }]);
}

describe('summary schema', () => {
  it('accepts one, two, and three labeled points but rejects zero or four', () => {
    for (const count of [1, 2, 3]) {
      const points = Array.from({ length: count }, (_, index) => ({
        label: `Point ${index + 1}`,
        body: `Useful detail ${index + 1}.`,
      }));
      expect(summarySchema.safeParse(output(serializeSummaryPoints(points))).success).toBe(true);
    }
    expect(summarySchema.safeParse(output('')).success).toBe(false);
    const four = Array.from({ length: 4 }, (_, index) => ({
      label: `Point ${index + 1}`,
      body: `Useful detail ${index + 1}.`,
    }));
    expect(summarySchema.safeParse(output(serializeSummaryPoints(four))).success).toBe(false);
    expect(
      summaryResponseSchema.safeParse({ verdict: 'WATCH', reason: 'Useful.', points: [] }).success,
    ).toBe(false);
    expect(
      summaryResponseSchema.safeParse({ verdict: 'WATCH', reason: 'Useful.', points: four })
        .success,
    ).toBe(false);
  });

  it('enforces 200 generated words including verdict, reason, labels, and bodies', () => {
    const reason = 'Clear useful answer';
    const label = 'Main point';
    const fixedWords = countGeneratedWords('WATCH', reason, [{ label, body: '' }]);
    const atLimitBody = Array.from(
      { length: 200 - fixedWords },
      (_, index) => `detail${index}`,
    ).join(' ');
    const atLimit = [{ label, body: atLimitBody }];
    expect(countGeneratedWords('WATCH', reason, atLimit)).toBe(200);
    expect(summarySchema.safeParse(output(serializeSummaryPoints(atLimit), reason)).success).toBe(
      true,
    );
    const overLimit = [{ label, body: `${atLimitBody} extra` }];
    expect(countGeneratedWords('WATCH', reason, overLimit)).toBe(201);
    expect(summarySchema.safeParse(output(serializeSummaryPoints(overLimit), reason)).success).toBe(
      false,
    );
  });

  it('allows a genuinely short result without padding', () => {
    const summary = point('Answer', 'No. The claimed shortcut does not work.');
    expect(summarySchema.safeParse(output(summary, 'Quick and conclusive.')).success).toBe(true);
  });

  it('rejects empty labels or bodies, long labels, nested lists, and stray text', () => {
    const invalid = [
      '- **:** Body.',
      '- **Answer:** ',
      '- **This label has far too many unnecessary words in it:** Body.',
      '- **Answer:** First line.\n- Nested point.',
      'Intro text.\n\n- **Answer:** Body.',
      '- **Answer:** Body.\n\nClosing recap.',
    ];
    for (const summary of invalid) {
      expect(summarySchema.safeParse(output(summary)).success).toBe(false);
    }
  });

  it('round-trips labels and bodies without changing punctuation or numbers', () => {
    const points: SummaryPoint[] = [
      { label: "Creator's result", body: 'Ray reached 11.9% body fat on day 100.' },
      { label: 'What changed', body: 'Training, food, and recovery—not steroids—did the work.' },
    ];
    expect(parseCanonicalSummaryPoints(serializeSummaryPoints(points))).toEqual(points);
  });

  it('keeps the reason to one sentence and twenty words', () => {
    expect(
      summarySchema.safeParse(output(point('Answer', 'Useful.'), 'Clear. Also entertaining.'))
        .success,
    ).toBe(false);
    const reason = Array.from({ length: 21 }, (_, index) => `word${index}`).join(' ');
    expect(summarySchema.safeParse(output(point('Answer', 'Useful.'), reason)).success).toBe(false);
    expect(
      countSentences('Alertness vs. calmness is one axis. Feeling good vs. bad is another.'),
    ).toBe(2);
  });

  it('rejects malformed, oversized, generic, leaked, or duplicated output', () => {
    expect(summarySchema.safeParse({ verdict: 'MAYBE', reason: 'x', summary: 'y' }).success).toBe(
      false,
    );
    expect(
      summarySchema.safeParse(output(point('Answer', 'x'.repeat(SUMMARY_CHARACTER_LIMIT + 1))))
        .success,
    ).toBe(false);
    expect(
      summarySchema.safeParse(output(point('Answer', 'This video explains one weak claim.')))
        .success,
    ).toBe(false);
    expect(
      summarySchema.safeParse(
        output(point('Answer', 'After reading this summary, would the user still gain value?')),
      ).success,
    ).toBe(false);
    expect(
      summarySchema.safeParse(
        output(
          point('Sales pitch', 'Standard advice is buried inside a sales pitch with little else.'),
          'Standard advice buried inside a long sales pitch.',
        ),
      ).success,
    ).toBe(false);
  });

  it('preserves explicit duration facts and cautious claims', () => {
    expect(
      summarySchema.safeParse(
        output(
          point(
            'Recipe timing',
            'Bake the mixture for twenty minutes, then let it rest for one hour.',
          ),
          'Specific and easy to follow.',
        ),
      ).success,
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
