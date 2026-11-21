import type { z } from 'zod';
import { coverageResponseSchema, paragraphCount } from '../../src/summary/coverage.js';
import { countWords } from '../../src/summary/provider.js';

export type CoveragePlan = z.input<typeof coverageResponseSchema>;
export const shortSyntheticSource =
  'First event occurred. Second event occurred. Third event occurred. Fourth event occurred. Fifth event occurred. Sixth event occurred.';
export const syntheticSource = shortSyntheticSource + ' Additional synthetic context.'.repeat(270);
export const secondBlockPassage = Math.ceil(countWords(syntheticSource) / 70) + 1;

/** Synthetic structural fixtures, not assertions that a model understood real video claims. */
export function coveragePlan(
  units = 3,
  independentGroups = units,
  sourceWordCount = countWords(syntheticSource),
): CoveragePlan {
  const count = paragraphCount(independentGroups, sourceWordCount);
  const topics = Array.from({ length: units }, (_, index) => ({
    id: index + 1,
    coverage_group_id: Math.min(independentGroups, index + 1),
    kind: 'event' as const,
    evidence: [{ passage: 1, quote: 'First event occurred.' }],
    text: `Development ${index + 1} occurred with a concrete outcome.`,
  }));
  const groups = Array.from({ length: count }, (_, index) => ({
    label: `Part ${index + 1}`,
    topic_ids: [] as number[],
  }));
  for (const topic of topics) {
    const position =
      independentGroups >= count
        ? Math.min(count - 1, topic.coverage_group_id - 1)
        : Math.min(count - 1, Math.floor(((topic.id - 1) * count) / units));
    groups[position]!.topic_ids.push(topic.id);
  }
  return {
    content_type: independentGroups === 1 ? 'simple_story' : 'other',
    coverage_groups: Array.from({ length: independentGroups }, (_, index) => ({
      id: index + 1,
      subject: `Independent story ${index + 1}`,
      kind: 'story',
    })),
    scan: [1],
    excluded: [],
    qualifications: [],
    topics,
    groups,
    verdict: 'WATCH',
    reason: 'Specific events stay clear without repeated commentary.',
  };
}
