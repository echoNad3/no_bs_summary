import { describe, expect, it } from 'vitest';
import { assembleCoverage, sourceBlocks, sourcePassages } from '../src/summary/coverage.js';
import { serializeSummaryPoints, summarySchema } from '../src/summary/provider.js';
import { isStoredSummaryResult, isSummaryResult } from '../apps/shared/api-client.js';

const source =
  'First story is here. Second story is here. Third story is here. Fourth story is here. Fifth story is here. Sixth story is here.';
function plan(count = 3) {
  const names = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];
  return {
    content_type: 'other' as 'other' | 'simple_story',
    scan: [{ block: 1, topic_ids: Array.from({ length: count }, (_, i) => i + 1), excluded: '' }],
    topics: names.slice(0, count).map((name, i) => ({
      id: i + 1,
      subject: `${name} event`,
      evidence: { passage: 1 },
      attributed: false,
      text: `${name} event occurred and has a concrete outcome.`,
    })),
    groups: Array.from({ length: Math.min(count, 5) }, (_, i) => ({
      label: `${names[i]} event`,
      topic_ids: i === 4 && count === 6 ? [5, 6] : [i + 1],
    })),
    verdict: 'WATCH' as const,
    reason: 'Specific events stay clear without repeated commentary.',
  };
}

describe('source-backed coverage assembly', () => {
  it.each([3, 4, 5, 6])('renders every one of %i topic texts exactly once', (count) => {
    const value = plan(count);
    const result = assembleCoverage(value, [source]);
    expect(result.points).toHaveLength(Math.min(count, 5));
    const prose = result.points.map((point) => point.body).join(' ');
    for (const topic of value.topics) expect(prose.split(topic.text)).toHaveLength(2);
    expect(
      summarySchema.safeParse({
        verdict: result.verdict,
        reason: result.reason,
        summary: serializeSummaryPoints(result.points),
      }).success,
    ).toBe(true);
  });
  it('splits whole topic units into five groups without a second model call', () => {
    const value = plan(6);
    value.groups = [
      { label: 'Related events', topic_ids: [1, 2] },
      { label: 'Other developments', topic_ids: [3, 4] },
      { label: 'Final developments', topic_ids: [5, 6] },
    ];
    const result = assembleCoverage(value, [source]);
    expect(result.points).toHaveLength(5);
    expect(result.points.map((point) => point.body).join(' ')).toBe(
      value.topics.map((topic) => topic.text).join(' '),
    );
  });
  it.each(['missing', 'duplicate', 'unknown', 'duplicate-topic', 'missing-scan', 'bad-anchor'])(
    'rejects %s coverage instead of silently dropping content',
    (fault) => {
      const value = plan(6);
      if (fault === 'missing') value.groups[4]!.topic_ids = [5];
      if (fault === 'duplicate') value.groups[4]!.topic_ids = [5, 5];
      if (fault === 'unknown') value.groups[4]!.topic_ids = [5, 99];
      if (fault === 'duplicate-topic') value.topics[5]!.id = 5;
      if (fault === 'missing-scan') value.scan = [];
      if (fault === 'bad-anchor') value.topics[0]!.evidence.passage = 999;
      expect(() => assembleCoverage(value, [source])).toThrow();
    },
  );
  it('derives evidence passages from the complete source without model-created quotes', () => {
    const passages = sourcePassages([source, 'Another complete source block.']);
    expect(passages.map((passage) => passage.text).join(' ')).toBe(
      `${source} Another complete source block.`,
    );
    expect(passages[1]).toEqual({ id: 2, block: 2, text: 'Another complete source block.' });
    const value = plan();
    value.topics[0]!.evidence.passage = 2;
    expect(() => assembleCoverage(value, [source])).toThrow('existing source passage');
  });
  it('carries scientific attribution metadata into displayed prose', () => {
    const value = plan();
    value.topics[0]!.attributed = true;
    expect(assembleCoverage(value, [source]).points[0]!.body).toBe(
      `The speaker reports: ${value.topics[0]!.text}`,
    );
    value.topics[0]!.text = 'The speaker explains a tentative result.';
    expect(assembleCoverage(value, [source]).points[0]!.body).toBe(value.topics[0]!.text);
  });
  it('keeps a simple story to three balanced paragraphs without dropping its fourth unit', () => {
    const value = plan(4);
    value.content_type = 'simple_story';
    const result = assembleCoverage(value, [source]);
    expect(result.points).toHaveLength(3);
    for (const topic of value.topics)
      expect(result.points.map((point) => point.body).join(' ')).toContain(topic.text);
  });
  it('derives missing scan membership from the known supporting passage', () => {
    const value = plan();
    value.scan[0]!.topic_ids = [2, 3];
    expect(assembleCoverage(value, [source]).points[0]!.body).toBe(value.topics[0]!.text);
  });
  it('displays indispensable details and caveats alongside the topic instead of discarding them', () => {
    const value = {
      ...plan(),
      topics: plan().topics.map((topic) => ({ ...topic, detail: '', caveat: '' })),
    };
    value.topics[0]!.detail = 'The response took thirty minutes.';
    value.topics[0]!.caveat = 'The allegation remains disputed.';
    const prose = assembleCoverage(value, [source])
      .points.map((point) => point.body)
      .join(' ');
    expect(prose).toContain('The response took thirty minutes.');
    expect(prose).toContain('The allegation remains disputed.');
  });
  it('attributes health-lesson text even if the model forgets its attribution flag', () => {
    const value = { ...plan(), content_type: 'lesson' as const };
    const result = assembleCoverage(value, [source + ' The clinical study discusses hormones.']);
    expect(result.points.every((point) => point.body.startsWith('The speaker reports:'))).toBe(
      true,
    );
  });
  it('leads a combined paragraph with substance while preserving its introductory topic text', () => {
    const value = plan(6);
    value.topics[0]!.text = 'The course introduces simple subjects.';
    value.topics[1]!.text = 'Variables retain values for later use.';
    const result = assembleCoverage(value, [source]);
    expect(result.points[0]!.body.startsWith('Variables retain values')).toBe(true);
    expect(result.points.map((point) => point.body).join(' ')).toContain(value.topics[0]!.text);
  });
  it('preserves the full source while bounding scan size for a long course', () => {
    const words = Array.from({ length: 50_000 }, (_, i) => `word${i}`);
    const blocks = sourceBlocks(words.join(' '));
    expect(blocks.length).toBeLessThanOrEqual(24);
    expect(blocks.join(' ')).toBe(words.join(' '));
  });
});

describe('current versus saved legacy format', () => {
  const result = {
    outputVersion: 3,
    verdict: 'WATCH',
    reason: 'Specific facts stay clear.',
    summary: serializeSummaryPoints(assembleCoverage(plan(), [source]).points),
    videoId: 'dQw4w9WgXcQ',
    language: 'en',
    source: 'LIVE',
    timing: { summaryMs: 10 },
    retries: { transcript: 0, summary: 0 },
  };
  it('reads version two saved output while rejecting it from the current network', () => {
    const legacy = { ...result, outputVersion: 2, summary: '- **Old result:** One compact point.' };
    expect(isStoredSummaryResult(legacy)).toBe(true);
    expect(isSummaryResult(legacy)).toBe(false);
    expect(isSummaryResult(result)).toBe(true);
  });
  it.each([1, 2, 6])('rejects %i current paragraphs in both public validators', (count) => {
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
