import { describe, expect, it } from 'vitest';
import {
  assembleCoverage,
  paragraphCount,
  sourceBlocks,
  sourcePassages,
} from '../src/summary/coverage.js';
import { countWords, serializeSummaryPoints, summarySchema } from '../src/summary/provider.js';
import { isStoredSummaryResult, isSummaryResult } from '../apps/shared/api-client.js';
import {
  coveragePlan,
  syntheticSource as source,
  shortSyntheticSource,
  secondBlockPassage,
} from './fixtures/coverage-semantic.js';

describe('quoted source coverage', () => {
  it.each([
    [6, 1, 3],
    [9, 9, 5],
    [6, 4, 4],
    [3, 3, 3],
  ])('preserves %i topics in %i stories across %i paragraphs', (units, stories, paragraphs) => {
    const value = coveragePlan(units, stories);
    const result = assembleCoverage(value, [source]);
    expect(result.points).toHaveLength(paragraphs);
    for (const topic of value.topics)
      expect(
        result.points
          .map((p) => p.body)
          .join(' ')
          .split(topic.text),
      ).toHaveLength(2);
    expect(
      summarySchema.safeParse({ ...result, summary: serializeSummaryPoints(result.points) })
        .success,
    ).toBe(true);
  });
  it.each([550, 799, 800, 801])('enforces the short-source ceiling at %i words', (words) => {
    const text = Array.from({ length: words }, (_, i) => `word${i}`).join(' ');
    const value = coveragePlan(9, 9, words);
    value.topics.forEach((topic) => {
      topic.evidence = [{ passage: 1, quote: 'word0 word1 word2' }];
    });
    expect(countWords(text)).toBe(words);
    const result = assembleCoverage(value, [text]);
    expect(result.points).toHaveLength(words <= 800 ? 3 : 5);
    for (const topic of value.topics)
      expect(
        result.points
          .map((p) => p.body)
          .join(' ')
          .split(topic.text),
      ).toHaveLength(2);
  });
  it('regroups five paragraphs for a short transcript without losing or rewriting text', () => {
    const value = coveragePlan(5, 5);
    const result = assembleCoverage(value, [shortSyntheticSource]);
    expect(result.points).toHaveLength(3);
    expect(result.points.map((p) => p.body).join(' ')).toBe(
      value.topics.map((t) => t.text).join(' '),
    );
    expect([1, 2, 3, 4, 5, 9].map((n) => paragraphCount(n, 550))).toEqual([3, 3, 3, 3, 3, 3]);
    expect([1, 2, 3, 4, 5, 9].map((n) => paragraphCount(n, 1000))).toEqual([3, 3, 3, 4, 5, 5]);
  });
  it('keeps a thin source concise without padding', () => {
    const value = coveragePlan();
    value.topics.forEach((t, i) => {
      t.text = `Fact ${i + 1}.`;
    });
    expect(assembleCoverage(value, [shortSyntheticSource]).points.map((p) => p.body)).toEqual([
      'Fact 1.',
      'Fact 2.',
      'Fact 3.',
    ]);
  });
  it.each([
    'missing',
    'duplicate',
    'unknown',
    'duplicate-topic',
    'missing-scan',
    'duplicate-scan',
    'out-of-order-scan',
    'bad-anchor',
    'invented-quote',
    'unknown-group',
    'unused-group',
    'duplicate-group',
  ])('rejects %s without discarding content', (fault) => {
    const value = coveragePlan(6, 6);
    if (fault === 'missing') value.groups[4]!.topic_ids = [5];
    if (fault === 'duplicate') value.groups[4]!.topic_ids = [5, 5];
    if (fault === 'unknown') value.groups[4]!.topic_ids = [5, 99];
    if (fault === 'duplicate-topic') value.topics[5]!.id = 5;
    if (fault === 'missing-scan') value.scan = [];
    if (fault === 'duplicate-scan') value.scan = [1, 1];
    if (fault === 'out-of-order-scan') value.scan = [2];
    if (fault === 'bad-anchor') value.topics[0]!.evidence[0]!.passage = 999;
    if (fault === 'invented-quote')
      value.topics[0]!.evidence[0]!.quote = 'An invented source quotation.';
    if (fault === 'unknown-group') value.topics[0]!.coverage_group_id = 999;
    if (fault === 'unused-group')
      value.coverage_groups.push({ id: 7, subject: 'Unused', kind: 'story' });
    if (fault === 'duplicate-group') value.coverage_groups[5]!.id = 5;
    expect(() => assembleCoverage(value, [source])).toThrow();
  });
  it('expands an underspecified layout using whole stories, never splitting their qualifications', () => {
    const value = coveragePlan(9, 6);
    value.groups = [
      { label: 'First', topic_ids: [1, 2, 3] },
      { label: 'Middle', topic_ids: [4, 5] },
      { label: 'Last', topic_ids: [6, 7, 8, 9] },
    ];
    const result = assembleCoverage(value, [source]);
    expect(result.points).toHaveLength(5);
    expect(result.points.at(-1)!.body).toBe(
      value.topics
        .slice(5)
        .map((t) => t.text)
        .join(' '),
    );
    for (const topic of value.topics)
      expect(
        result.points
          .map((p) => p.body)
          .join(' ')
          .split(topic.text),
      ).toHaveLength(2);
  });
  it('accepts word-for-word evidence despite punctuation, case or a crossed passage boundary', () => {
    const text = Array.from({ length: 150 }, (_, i) => `Word${i}`).join(' ');
    const value = coveragePlan();
    value.topics.forEach((t) => {
      t.evidence = [{ passage: 2, quote: 'word68, WORD69; word70!' }];
    });
    expect(assembleCoverage(value, [text]).points).toHaveLength(3);
    value.topics[0]!.evidence[0]!.quote = 'word68 invented word70';
    expect(() => assembleCoverage(value, [text])).toThrow('exact excerpt');
  });
  it('rejects ambiguous quotes rather than guessing which occurrence supports a claim', () => {
    const value = coveragePlan();
    value.topics.forEach((t) => {
      t.evidence = [{ passage: 1, quote: 'Repeated source phrase.' }];
    });
    expect(() =>
      assembleCoverage(value, ['Repeated source phrase. Repeated source phrase.']),
    ).toThrow('ambiguous');
  });
  const mixed =
    'Kai threatens legal action. Speaking of lawsuits, a jury ordered damages. Join our claim service and scan the QR code. Back to the dispute. The host criticizes the speculation.';
  function mixedPlan() {
    const value = coveragePlan();
    value.excluded = [
      {
        start: { passage: 1, quote: 'Speaking of lawsuits' },
        end: { passage: 1, quote: 'scan the QR code.' },
      },
    ];
    value.topics[0]!.text = 'Kai threatens legal action.';
    value.topics[0]!.evidence = [{ passage: 1, quote: 'Kai threatens legal action.' }];
    value.topics[1]!.text = 'The dispute continues.';
    value.topics[1]!.evidence = [{ passage: 1, quote: 'Back to the dispute.' }];
    value.topics[2]!.text = 'The host criticizes the speculation.';
    value.topics[2]!.evidence = [{ passage: 1, quote: 'The host criticizes the speculation.' }];
    return value;
  }
  it('retains real content on both sides of an ad within the SAME source passage', () => {
    const value = mixedPlan();
    expect(assembleCoverage(value, [mixed]).points.map((p) => p.body)).toEqual(
      value.topics.map((t) => t.text),
    );
  });
  it.each([
    'a jury ordered damages.',
    'Join our claim service',
    'legal action. Speaking of lawsuits',
  ])('rejects commercial lead-in, pitch or partly overlapping evidence: %s', (quote) => {
    const value = mixedPlan();
    value.topics[0]!.evidence = [{ passage: 1, quote }];
    expect(() => assembleCoverage(value, [mixed])).toThrow('excluded commercial text');
  });
  it('rejects invented, reversed, overlapping or nonexistent exclusion boundaries', () => {
    const value = mixedPlan();
    value.excluded[0]!.start.quote = 'A fabricated ad introduction';
    expect(() => assembleCoverage(value, [mixed])).toThrow('exact excerpt');
    value.excluded = mixedPlan().excluded;
    [value.excluded[0]!.start, value.excluded[0]!.end] = [
      value.excluded[0]!.end,
      value.excluded[0]!.start,
    ];
    expect(() => assembleCoverage(value, [mixed])).toThrow('before it starts');
    value.excluded = [...mixedPlan().excluded, ...mixedPlan().excluded];
    expect(() => assembleCoverage(value, [mixed])).toThrow('overlap');
    value.excluded = mixedPlan().excluded;
    value.excluded[0]!.start.passage = 999;
    expect(() => assembleCoverage(value, [mixed])).toThrow('existing source passage');
  });
  it('does not keyword-ban legitimate reporting about lawsuits or QR codes', () => {
    const value = mixedPlan();
    value.excluded = [];
    value.topics[0]!.text = 'A jury ordered damages.';
    value.topics[0]!.evidence = [{ passage: 1, quote: 'a jury ordered damages.' }];
    expect(assembleCoverage(value, [mixed]).points[0]!.body).toBe('A jury ordered damages.');
  });
  it('closes a recruitment promotion over its news-like lead-in, preserving the prior legal threat', () => {
    const text =
      'Kai threatens legal action. Speaking of lawsuits, a jury ordered damages. Our service invites eligible claimants to recover compensation. Scan the QR code to join. Back to the dispute. The host criticizes the speculation.';
    const value = mixedPlan();
    value.excluded = [
      {
        start: { passage: 1, quote: 'Our service invites eligible claimants' },
        end: { passage: 1, quote: 'Scan the QR code to join.' },
      },
    ];
    expect(assembleCoverage(value, [text]).points[0]!.body).toBe('Kai threatens legal action.');
    value.topics[1]!.evidence = [{ passage: 1, quote: 'a jury ordered damages.' }];
    expect(() => assembleCoverage(value, [text])).toThrow('excluded commercial text');
  });
  it('keeps a distinct legal report before a later explicit sponsor transition', () => {
    const text =
      'Speaking of lawsuits, a jury ordered damages. A quick break with our sponsor. Our service invites eligible claimants to recover compensation. Scan the QR code to join. Back to the dispute. The host criticizes the speculation.';
    const value = mixedPlan();
    value.topics[0]!.text = 'A jury ordered damages.';
    value.topics[0]!.evidence = [{ passage: 1, quote: 'a jury ordered damages.' }];
    value.excluded = [
      {
        start: { passage: 1, quote: 'Our service invites eligible claimants' },
        end: { passage: 1, quote: 'Scan the QR code to join.' },
      },
    ];
    expect(assembleCoverage(value, [text]).points[0]!.body).toBe('A jury ordered damages.');
  });
  it('attaches a protected source denial to its claim once, including after regrouping', () => {
    const value = coveragePlan(5, 5);
    value.qualifications = [
      {
        topic_id: 1,
        text: 'The subject denied the allegation.',
        evidence: { passage: 1, quote: 'The subject denied the allegation.' },
      },
    ];
    value.qualifications.push({ ...value.qualifications[0]! });
    const result = assembleCoverage(value, [
      shortSyntheticSource + ' The subject denied the allegation.',
    ]);
    expect(result.points).toHaveLength(3);
    expect(result.points[0]!.body).toContain(
      value.topics[0]!.text + ' The subject denied the allegation.',
    );
    expect(
      result.points
        .map((p) => p.body)
        .join(' ')
        .split('The subject denied the allegation.'),
    ).toHaveLength(2);
  });
  it('rejects unknown, invented or commercial qualification evidence', () => {
    const value = mixedPlan();
    value.qualifications = [
      {
        topic_id: 99,
        text: 'An alleged denial.',
        evidence: { passage: 1, quote: 'a jury ordered damages.' },
      },
    ];
    expect(() => assembleCoverage(value, [mixed])).toThrow('unknown topic');
    value.qualifications[0]!.topic_id = 1;
    expect(() => assembleCoverage(value, [mixed])).toThrow('qualification cites excluded');
    value.qualifications[0]!.evidence.quote = 'The invented official denial.';
    expect(() => assembleCoverage(value, [mixed])).toThrow('exact excerpt');
  });
  it('requires clause-local attribution for mental-health interpretations, even in reported events', () => {
    const value = coveragePlan();
    value.topics[0]!.text =
      'Reggie sold his chain and displayed signs of a severe mental health crisis.';
    expect(() => assembleCoverage(value, [source])).toThrow('mental-health interpretation');
    value.topics[0]!.text =
      'Reggie sold his chain, which observers viewed as signs of a mental health crisis.';
    expect(assembleCoverage(value, [source]).points[0]!.body).toBe(value.topics[0]!.text);
    value.topics[0]!.text =
      'Reggie had a mental health crisis. The host suggested selling the chain.';
    expect(() => assembleCoverage(value, [source])).toThrow('mental-health interpretation');
  });
  it('separates financial support from misconduct allegations without removing either development', () => {
    const value = coveragePlan();
    value.topics[0]!.text = 'Reggie alleged grooming, while Kai stated he invested millions.';
    expect(() => assembleCoverage(value, [source])).toThrow('financial support');
    value.topics[0]!.text = 'Reggie alleged grooming, which Kai denied.';
    value.topics[1]!.text = 'On financial support, Kai stated he invested millions.';
    expect(
      assembleCoverage(value, [source])
        .points.map((p) => p.body)
        .join(' '),
    ).toContain(value.topics[1]!.text);
  });
  it('balances very uneven news layouts using complete independent stories', () => {
    const value = coveragePlan(9, 9);
    const result = assembleCoverage(value, [source]);
    expect(result.points).toHaveLength(5);
    const lengths = result.points.map((p) => countWords(p.body));
    expect(Math.max(...lengths)).toBeLessThanOrEqual(2 * Math.min(...lengths));
    for (const topic of value.topics)
      expect(
        result.points
          .map((p) => p.body)
          .join(' ')
          .split(topic.text),
      ).toHaveLength(2);
  });
  it('resolves offsets across block and passage boundaries without dropping source', () => {
    const value = coveragePlan();
    value.scan = [1, 2];
    const ad = 'Sponsored offer begins. Pay for our service. Sponsored offer ends.';
    value.excluded = [
      {
        start: { passage: secondBlockPassage, quote: 'Sponsored offer begins.' },
        end: { passage: secondBlockPassage, quote: 'Sponsored offer ends.' },
      },
    ];
    expect(assembleCoverage(value, [source, ad]).points).toHaveLength(3);
    value.topics[0]!.evidence = [{ passage: secondBlockPassage, quote: 'Pay for our service.' }];
    expect(() => assembleCoverage(value, [source, ad])).toThrow('excluded commercial text');
  });
  it('accepts typographic quote variants but never a paraphrase', () => {
    const value = coveragePlan();
    value.topics.forEach((t) => {
      t.evidence = [{ passage: 1, quote: "The speaker's own account." }];
    });
    expect(assembleCoverage(value, ['The speaker’s own account.']).points).toHaveLength(3);
    value.topics[0]!.evidence[0]!.quote = 'A different account.';
    expect(() => assembleCoverage(value, ['The speaker’s own account.'])).toThrow('exact excerpt');
  });
  it.each([
    'Reggie alleges a disputed claim.',
    'A former associate accuses the streamer of misconduct.',
    'Kai Cenat denies a disputed claim.',
    'The host argues that evidence is insufficient.',
    'The cited research suggests a tentative explanation.',
    'Recent scientific studies demonstrate a tentative effect.',
  ])('keeps natural attribution without injecting text: %s', (text) => {
    const value = coveragePlan();
    value.topics[0]!.kind = 'attributed';
    value.topics[0]!.text = text;
    expect(assembleCoverage(value, [source]).points[0]!.body).toBe(text);
  });
  it('rejects a bare disputed claim and preserves conservative health attribution', () => {
    const value = coveragePlan();
    value.topics[0]!.kind = 'attributed';
    expect(() => assembleCoverage(value, [source])).toThrow('explicit source attribution');
    value.topics[0]!.kind = 'event';
    value.content_type = 'lesson';
    expect(() =>
      assembleCoverage(value, [source + ' A clinical study discusses hormones.']),
    ).toThrow('explicit source attribution');
    value.topics.forEach((t) => {
      t.text = `The cited research suggests ${t.text}`;
    });
    expect(
      assembleCoverage(value, [source + ' A clinical study discusses hormones.']).points,
    ).toHaveLength(3);
  });
  it('does not match a reporting verb inside a longer word', () => {
    const value = coveragePlan();
    value.topics[0]!.kind = 'attributed';
    value.topics[0]!.text = 'Kai Cenat deniesomething else.';
    expect(() => assembleCoverage(value, [source])).toThrow('explicit source attribution');
  });
  it('preserves coherent unequal groups, labels and topic order', () => {
    const value = coveragePlan(6, 1);
    value.groups = [
      { label: 'Main development', topic_ids: [2, 1, 3, 4] },
      { label: 'Escalation', topic_ids: [5] },
      { label: 'Outcome', topic_ids: [6] },
    ];
    const result = assembleCoverage(value, [source]);
    expect(result.points.map((p) => p.label)).toEqual(value.groups.map((g) => g.label));
    expect(result.points[0]!.body).toBe(
      [2, 1, 3, 4].map((n) => value.topics[n - 1]!.text).join(' '),
    );
  });
  it('rejects splitting whole independent stories when enough groups exist', () => {
    const value = coveragePlan(6, 4);
    value.groups[0]!.topic_ids.push(value.groups[3]!.topic_ids.pop()!);
    expect(() => assembleCoverage(value, [source])).toThrow('one paragraph');
  });
  it('rejects interleaving the paragraphs of two stories', () => {
    const value = coveragePlan(6, 2);
    value.topics.forEach((t, i) => {
      t.coverage_group_id = i < 4 ? 1 : 2;
    });
    expect(assembleCoverage(value, [source]).points).toHaveLength(3);
    value.groups = [
      { label: 'First', topic_ids: [1, 2] },
      { label: 'Second', topic_ids: [5, 6] },
      { label: 'First again', topic_ids: [3, 4] },
    ];
    expect(() => assembleCoverage(value, [source])).toThrow('adjacent');
  });
  it('preserves lesson themes and rejects contradictory simple-story metadata', () => {
    const value = coveragePlan(6, 6);
    value.content_type = 'lesson';
    value.coverage_groups.forEach((g) => {
      g.kind = 'theme';
    });
    expect(assembleCoverage(value, [source]).points).toHaveLength(5);
    value.content_type = 'simple_story';
    expect(() => assembleCoverage(value, [source])).toThrow('one underlying story');
  });
  it('retains the numeric/status guards and public opening validation', () => {
    const value = coveragePlan();
    value.topics[0]!.text = 'A man died after falling 200 feet.';
    expect(() => assembleCoverage(value, [source + ' The ride reaches 200 feet.'])).toThrow(
      'fall distance not stated',
    );
    expect(assembleCoverage(value, [source + ' The man fell 200 feet.']).points[0]!.body).toBe(
      value.topics[0]!.text,
    );
    value.topics[0]!.text = 'The former president gave a statement.';
    expect(() => assembleCoverage(value, [source])).toThrow('former president');
    value.topics[0]!.text = 'The course introduces simple subjects.';
    const result = assembleCoverage(value, [source]);
    expect(result.points[0]!.body).toBe(value.topics[0]!.text);
    expect(
      summarySchema.safeParse({ ...result, summary: serializeSummaryPoints(result.points) })
        .success,
    ).toBe(false);
  });
  it('preserves all 50,000 source words in bounded blocks and numbered passages', () => {
    const text = Array.from({ length: 50000 }, (_, i) => `word${i}`).join(' ');
    const blocks = sourceBlocks(text);
    expect(blocks.length).toBeLessThanOrEqual(24);
    expect(
      sourcePassages(blocks)
        .map((p) => p.text)
        .join(' '),
    ).toBe(text);
  });
});
describe('current and saved legacy output', () => {
  const result = {
    outputVersion: 3,
    verdict: 'WATCH',
    reason: 'Specific facts stay clear.',
    summary: serializeSummaryPoints(assembleCoverage(coveragePlan(), [source]).points),
    videoId: 'dQw4w9WgXcQ',
    language: 'en',
    source: 'LIVE',
    timing: { summaryMs: 10 },
    retries: { transcript: 0, summary: 0 },
  };
  it('reads legacy output but rejects it from the current network', () => {
    const legacy = { ...result, outputVersion: 2, summary: '- **Old result:** One point.' };
    expect(isStoredSummaryResult(legacy)).toBe(true);
    expect(isSummaryResult(legacy)).toBe(false);
    expect(isSummaryResult(result)).toBe(true);
  });
  it.each([1, 2, 6])('rejects %i current paragraphs', (count) => {
    const summary = serializeSummaryPoints(
      Array.from({ length: count }, (_, i) => ({
        label: `Unit ${i}`,
        body: `Concrete result ${i}.`,
      })),
    );
    expect(isSummaryResult({ ...result, summary })).toBe(false);
    expect(summarySchema.safeParse({ ...result, summary }).success).toBe(false);
  });
});
