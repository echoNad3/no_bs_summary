import { z } from 'zod';
import { countWords, startsLikeAiCopy, SummaryValidationError } from './provider.js';
import type { SummaryCandidate } from './provider.js';

const id = z.number().int().positive();
export const coverageResponseSchema = z.object({
  content_type: z.enum(['simple_story', 'news_roundup', 'lesson', 'other']),
  scan: z
    .array(z.object({ block: id, excluded: z.string().max(400) }))
    .min(1)
    .max(24),
  topics: z
    .array(
      z.object({
        id,
        subject: z.string().trim().min(1).max(120),
        evidence: z.object({
          passage: id.describe(
            'The numbered SOURCE PASSAGE containing substantive supporting content, not only an intro preview. Copy its passage ID.',
          ),
        }),
        attributed: z
          .boolean()
          .describe(
            'True for scientific, medical, speculative or disputed claims requiring explicit source attribution.',
          ),
        text: z
          .string()
          .trim()
          .min(1)
          .max(1800)
          .describe(
            'Final public prose: concrete subject, event or concept and essential outcome. Begin directly with the event, concept or instruction, never "The course/video...". For teaching use wording like "Install the interpreter..." or "Variables store..." when supported. This text is displayed directly.',
          ),
        detail: z
          .string()
          .trim()
          .max(500)
          .default('')
          .describe(
            'One brief essential supporting fact: retain a material number or useful named tool and how it is used. Empty only if there is no additional essential detail. Do not repeat text.',
          ),
        caveat: z
          .string()
          .trim()
          .max(500)
          .default('')
          .describe(
            'A brief material denial, uncertainty, limitation or explicit self-treatment warning from the source. Empty when none matters. Never invent a warning or repeat text.',
          ),
      }),
    )
    .min(3)
    .max(60),
  groups: z
    .array(z.object({ label: z.string().trim().min(1).max(80), topic_ids: z.array(id).min(1) }))
    .min(3)
    .max(5),
  verdict: z.enum(['WATCH', 'SKIM', 'SKIP']),
  reason: z.string().trim().min(1).max(1200),
});

export function sourceBlocks(transcript: string): string[] {
  const words = transcript.trim().split(/\s+/u);
  const size = Math.max(700, Math.ceil(words.length / 24));
  const blocks: string[] = [];
  for (let offset = 0; offset < words.length; offset += size) {
    blocks.push(words.slice(offset, offset + size).join(' '));
  }
  return blocks;
}

export function formatSourceBlocks(blocks: string[]): string {
  const passages = sourcePassages(blocks);
  return blocks
    .map(
      (_, index) =>
        `SOURCE BLOCK ${index + 1}:\n${passages
          .filter((passage) => passage.block === index + 1)
          .map((passage) => `SOURCE PASSAGE ${passage.id}: ${passage.text}`)
          .join('\n')}\nEND BLOCK ${index + 1}`,
    )
    .join('\n\n');
}

export function sourcePassages(blocks: string[]): { id: number; block: number; text: string }[] {
  const passages: { id: number; block: number; text: string }[] = [];
  blocks.forEach((block, index) => {
    const words = block.split(/\s+/u);
    for (let offset = 0; offset < words.length; offset += 70)
      passages.push({
        id: passages.length + 1,
        block: index + 1,
        text: words.slice(offset, offset + 70).join(' '),
      });
  });
  return passages;
}

export function assembleCoverage(raw: unknown, blocks: string[]): SummaryCandidate {
  const parsed = coverageResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SummaryValidationError(
      `Coverage JSON is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  }
  const value = parsed.data;
  const fail = (message: string): never => {
    throw new SummaryValidationError(message);
  };
  const topics = new Map(value.topics.map((topic) => [topic.id, topic]));
  const passages = new Map(sourcePassages(blocks).map((passage) => [passage.id, passage]));
  const source = blocks.join(' ');
  const healthLesson =
    value.content_type === 'lesson' &&
    /\b(?:clinical|patients?|hormones?|puberty|neuroplasticity|treatment|diagnosis|oxytocin|vasopressin|supplements?)\b/iu.test(
      source,
    );
  if (topics.size !== value.topics.length) fail('Every topic must have a unique ID.');
  const scans = new Map(value.scan.map((scan) => [scan.block, scan]));
  if (
    scans.size !== blocks.length ||
    value.scan.length !== blocks.length ||
    value.scan.some((scan) => scan.block > blocks.length)
  ) {
    fail('Scan every source block exactly once, including the middle and ending.');
  }
  for (const topic of value.topics) {
    topic.text = [topic.text, topic.detail, topic.caveat].filter(Boolean).join(' ');
    if (/\bformer president\b/iu.test(topic.text) && !/\bformer president\b/iu.test(source))
      fail(
        `Topic ${topic.id} adds "former president" even though this status is not in the source. Preserve the source's stated role.`,
      );
    const passage = passages.get(topic.evidence.passage);
    if (!passage) return fail(`Topic ${topic.id} must reference an existing source passage.`);
    if (
      (topic.attributed || healthLesson) &&
      !/^(?:the (?:speaker|host|video|report|cited (?:research|study|studies))|researchers|studies|witnesses)\b/iu.test(
        topic.text,
      )
    ) {
      topic.text = `The speaker reports: ${topic.text}`;
    }
  }
  const expected =
    value.content_type === 'simple_story' && topics.size <= 4
      ? 3
      : Math.min(5, Math.max(3, topics.size));
  const assignments = value.groups.flatMap((group) => group.topic_ids);
  if (
    assignments.length !== topics.size ||
    new Set(assignments).size !== topics.size ||
    assignments.some((topic) => !topics.has(topic))
  ) {
    fail(
      'Every inventoried topic must appear exactly once across the paragraph groups; no omissions, duplicate assignments or unknown IDs.',
    );
  }
  // Partition complete topic texts into P balanced paragraphs. This changes
  // grouping only; every topic and every source claim stays intact.
  const weights = assignments.map((id) => countWords(topics.get(id)!.text));
  const prefix = [0];
  for (const weight of weights) prefix.push(prefix.at(-1)! + weight);
  const target = prefix.at(-1)! / expected;
  const cost = Array.from({ length: expected + 1 }, () =>
    Array<number>(assignments.length + 1).fill(Infinity),
  );
  const previous = Array.from({ length: expected + 1 }, () =>
    Array<number>(assignments.length + 1).fill(-1),
  );
  cost[0]![0] = 0;
  for (let group = 1; group <= expected; group += 1) {
    for (let end = group; end <= assignments.length; end += 1) {
      for (let start = group - 1; start < end; start += 1) {
        const candidate = cost[group - 1]![start]! + (prefix[end]! - prefix[start]! - target) ** 2;
        if (candidate < cost[group]![end]!) {
          cost[group]![end] = candidate;
          previous[group]![end] = start;
        }
      }
    }
  }
  const groups: { label: string; topic_ids: number[] }[] = [];
  let end = assignments.length;
  for (let group = expected; group > 0; group -= 1) {
    const start = previous[group]![end]!;
    if (start < 0) return fail('Cannot form the required nonempty paragraphs.');
    const ids = assignments.slice(start, end);
    const original = value.groups.find(
      (value) =>
        value.topic_ids.length === ids.length &&
        value.topic_ids.every((id, index) => id === ids[index]),
    );
    const shortSubject = (id: number) =>
      topics
        .get(id)!
        .subject.replace(/[:*#•]/gu, '')
        .split(/\s+/u)
        .slice(0, ids.length > 1 ? 3 : 5)
        .join(' ');
    const label = original?.label ?? ids.slice(0, 2).map(shortSubject).join(' / ');
    groups.unshift({ label, topic_ids: ids });
    end = start;
  }
  const first = groups[0]!;
  if (startsLikeAiCopy(topics.get(first.topic_ids[0]!)!.text)) {
    const substantive = first.topic_ids.findIndex((id) => !startsLikeAiCopy(topics.get(id)!.text));
    if (substantive > 0) {
      const [id] = first.topic_ids.splice(substantive, 1);
      first.topic_ids.unshift(id!);
    }
  }
  return {
    verdict: value.verdict,
    reason: value.reason,
    points: groups.map((group) => ({
      label: group.label,
      body: group.topic_ids.map((topic) => topics.get(topic)!.text).join(' '),
    })),
  };
}
