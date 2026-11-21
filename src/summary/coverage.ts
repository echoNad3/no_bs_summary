import { z } from 'zod';
import { countWords, SummaryValidationError } from './provider.js';
import { SUMMARY_LABEL_WORD_LIMIT } from './provider.js';
import type { SummaryCandidate } from './provider.js';

const id = z.number().int().positive();
export const SHORT_SOURCE_WORD_LIMIT = 800;
const citation = z.object({
  passage: id,
  statement_id: id.optional(),
  quote: z
    .string()
    .trim()
    .min(3)
    .max(600)
    .describe(
      'Copy 5-12 continuous source words exactly, preserving spelling. Passage ID locates the excerpt; it may cross a passage boundary. Include the actor/action or qualification, not just a name. Do not reconstruct a complete sentence from memory.',
    ),
});
export const coverageResponseSchema = z.object({
  content_type: z.enum(['simple_story', 'news_roundup', 'lesson', 'other']),
  coverage_groups: z
    .array(
      z.object({
        id,
        subject: z.string().trim().min(1).max(120),
        kind: z.enum(['story', 'theme']),
      }),
    )
    .min(1)
    .max(60),
  scan: z
    .array(id)
    .min(1)
    .max(24)
    .describe('Every SOURCE BLOCK ID exactly once, in order. Read all its passages.'),
  excluded: z
    .array(
      z.object({
        start: citation.describe(
          'First words of the commercial interruption, INCLUDING its news-like lead-in.',
        ),
        end: citation.describe(
          'Last words of the commercial interruption, before the main content resumes.',
        ),
      }),
    )
    .max(32)
    .describe(
      'Commercial source spans only. Empty if none. Exact excerpts allow excluding part of a mixed passage without excluding nearby real content.',
    ),
  qualifications: z
    .array(
      z.object({
        topic_id: id,
        text: z.string().trim().min(1).max(500),
        evidence: citation,
      }),
    )
    .max(30)
    .describe(
      'Inventory material source denials, evidence limitations, unverified identities and safety cautions BEFORE condensing topic prose. Link to the relevant planned topic ID. Appended unchanged to that topic; counts in SAME word budget. Do not duplicate in topic text. Empty only when none matter.',
    ),
  topics: z
    .array(
      z.object({
        id,
        coverage_group_id: id,
        kind: z
          .enum(['event', 'attributed'])
          .describe(
            'event for reported actions, statements, legal developments, backlash and other news, including events containing clearly attributed allegations/denials. attributed ONLY when the entire text is an interpretation, allegation or scientific/medical claim requiring a source-led opening.',
          ),
        text: z
          .string()
          .trim()
          .min(1)
          .max(1800)
          .describe(
            'Compact FINAL prose, including indispensable details, relevant denials and uncertainty ONCE. No separate detail/caveat fields. Attributed claims start naturally with their speaker or research source and a reporting verb.',
          ),
        evidence: z
          .array(citation)
          .min(1)
          .max(8)
          .describe(
            'Exact supporting excerpts for the assertion AND any material denial/number/qualification. Do not cite ads, previews or merely nearby names.',
          ),
      }),
    )
    .min(3)
    .max(60),
  groups: z
    .array(
      z.object({ label: z.string().trim().min(1).max(80), topic_ids: z.array(id).min(1).max(60) }),
    )
    .min(3)
    .max(5),
  verdict: z.enum(['WATCH', 'SKIM', 'SKIP']),
  reason: z.string().trim().min(1).max(1200),
});

export function sourceBlocks(transcript: string): string[] {
  const words = transcript.trim().split(/\s+/u);
  const size = Math.max(700, Math.ceil(words.length / 24));
  const blocks: string[] = [];
  for (let offset = 0; offset < words.length; offset += size)
    blocks.push(words.slice(offset, offset + size).join(' '));
  return blocks;
}
export function sourcePassages(blocks: string[]): { id: number; block: number; text: string }[] {
  const passages: { id: number; block: number; text: string }[] = [];
  blocks.forEach((block, index) => {
    const words = block.trim().split(/\s+/u);
    for (let offset = 0; offset < words.length; offset += 70)
      passages.push({
        id: passages.length + 1,
        block: index + 1,
        text: words.slice(offset, offset + 70).join(' '),
      });
  });
  return passages;
}
export function formatSourceBlocks(blocks: string[]): string {
  const passages = sourcePassages(blocks);
  return blocks
    .map(
      (_, index) =>
        `SOURCE BLOCK ${index + 1}:\n${passages
          .filter((p) => p.block === index + 1)
          .map((p) => `SOURCE PASSAGE ${p.id}: ${p.text}`)
          .join('\n')}\nEND BLOCK ${index + 1}`,
    )
    .join('\n\n');
}
function normalizeQuote(text: string): string {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => word.toLowerCase()).join(' ');
}
function fail(message: string): never {
  throw new SummaryValidationError(message);
}

export interface SourceFragment {
  id: number;
  text: string;
  start: number;
  end: number;
  passage: number;
}

export function assembleCoverage(
  raw: unknown,
  blocks: string[],
  fragments?: ReadonlyMap<number, SourceFragment>,
): SummaryCandidate {
  const parsed = coverageResponseSchema.safeParse(raw);
  if (!parsed.success)
    fail(
      `Coverage JSON is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  const value = parsed.data;
  const source = blocks.map((block) => block.trim().replace(/\s+/gu, ' ')).join(' ');
  let quoteIndex: ReturnType<typeof indexLegacyQuotes> | undefined;
  const resolve = (ref: z.infer<typeof citation>, label: string) => {
    if (ref.statement_id !== undefined) {
      const fragment = fragments?.get(ref.statement_id);
      if (
        !fragment ||
        fragment.passage !== ref.passage ||
        fragment.text !== ref.quote ||
        source.slice(fragment.start, fragment.end) !== fragment.text
      )
        return fail(`${label} must bind to an original source fragment.`);
      return { start: fragment.start, end: fragment.end };
    }
    const { passages, starts, ends, comparableSource } = (quoteIndex ??= indexLegacyQuotes(
      blocks,
      source,
    ));
    const passage = passages.get(ref.passage);
    if (!passage)
      return fail(`${label} must reference an existing source passage, not ${ref.passage}.`);
    const quote = normalizeQuote(ref.quote);
    if (quote.split(' ').length < 3)
      return fail(
        `${label} needs at least three source words containing substantive support, not just a name.`,
      );
    const matches: { start: number; end: number }[] = [];
    let cursor = comparableSource.indexOf(quote);
    while (cursor >= 0) {
      const start = starts.get(cursor);
      const end = ends.get(cursor + quote.length);
      if (start !== undefined && end !== undefined) matches.push({ start, end });
      cursor = comparableSource.indexOf(quote, cursor + 1);
    }
    if (matches.length === 0)
      return fail(
        `${label} quote is not an exact excerpt of passage ${ref.passage}. Copy the source's actual words, not a paraphrase.`,
      );
    if (matches.length === 1) return matches[0]!;
    const local = matches.filter(
      (span) => span.start < passage.offset + passage.text.length && span.end > passage.offset,
    );
    if (local.length === 1) return local[0]!;
    return fail(
      `${label} quote is ambiguous; copy a longer unique excerpt, with the correct passage hint.`,
    );
  };
  if (
    value.scan.length !== blocks.length ||
    new Set(value.scan).size !== blocks.length ||
    value.scan.some((block, index) => block !== index + 1)
  )
    fail('Scan every source block exactly once in order, including the middle and ending.');
  const exclusions = value.excluded
    .map((span, index) => {
      const start = resolve(span.start, `Commercial span ${index + 1} start`);
      const end = resolve(span.end, `Commercial span ${index + 1} end`);
      if (end.start < start.start)
        return fail(`Commercial span ${index + 1} ends before it starts.`);
      return { start: commercialLeadStart(source, start.start, end.end), end: end.end };
    })
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < exclusions.length; i++)
    if (exclusions[i]!.start < exclusions[i - 1]!.end)
      fail('Commercial spans must not overlap or duplicate each other.');
  const topics = new Map(value.topics.map((topic) => [topic.id, topic]));
  const coverageGroups = new Map(value.coverage_groups.map((group) => [group.id, group]));
  if (topics.size !== value.topics.length) fail('Every topic must have a unique ID.');
  for (const qualification of value.qualifications) {
    const topic = topics.get(qualification.topic_id);
    if (!topic) fail(`Qualification references unknown topic ${qualification.topic_id}.`);
    const span = resolve(qualification.evidence, `Topic ${qualification.topic_id} qualification`);
    if (exclusions.some((excluded) => span.start < excluded.end && span.end > excluded.start))
      fail(`Topic ${qualification.topic_id} qualification cites excluded commercial text.`);
    if (!normalizeQuote(topic!.text).includes(normalizeQuote(qualification.text)))
      topic!.text += ` ${qualification.text}`;
  }
  if (coverageGroups.size !== value.coverage_groups.length)
    fail('Every independent coverage group must have a unique ID.');
  for (const topic of value.topics)
    if (!coverageGroups.has(topic.coverage_group_id))
      fail(`Topic ${topic.id} references unknown coverage group ${topic.coverage_group_id}.`);
  if (new Set(value.topics.map((topic) => topic.coverage_group_id)).size !== coverageGroups.size)
    fail('Every independent coverage group must contain a topic; remove unused groups.');
  if (
    value.content_type === 'simple_story' &&
    (coverageGroups.size !== 1 || value.coverage_groups[0]!.kind !== 'story')
  )
    fail('A simple_story has exactly one underlying story group, regardless of development count.');
  const healthLesson =
    value.content_type === 'lesson' &&
    /\b(?:clinical|patients?|hormones?|puberty|neuroplasticity|treatment|diagnosis|oxytocin|vasopressin|supplements?)\b/iu.test(
      source,
    );
  const falls =
    /\b(?:falling|fell|dropped|plunged)\s+(\d[\d,]*(?:\.\d+)?)\s*(feet|foot|ft|meters?|metres?)\b/giu;
  const fallKey = (match: RegExpMatchArray) =>
    `${match[1]!.replaceAll(',', '')}:${/^(?:feet|foot|ft)$/iu.test(match[2]!) ? 'ft' : 'm'}`;
  const sourceFalls = new Set([...source.matchAll(falls)].map(fallKey));
  const attributionIssues: number[] = [];
  for (const topic of value.topics) {
    for (const ref of topic.evidence) {
      const span = resolve(ref, `Topic ${topic.id} evidence`);
      if (exclusions.some((excluded) => span.start < excluded.end && span.end > excluded.start))
        fail(
          `Topic ${topic.id} cites excluded commercial text. Remove the promotion INCLUDING its news-like lead-in, while retaining independent main content.`,
        );
    }
    const mentalInterpretation =
      /\b(?:mental health crisis|manic episode|psychosis|psychotic)\b/iu.test(topic.text);
    if (mentalInterpretation && !hasQualifiedMentalInterpretation(topic.text))
      fail(
        `Topic ${topic.id} must attribute the mental-health interpretation to its commentator in the same sentence; reported actions are not a diagnosis.`,
      );
    if (
      /\b(?:groom(?:ing|ed)|sexual (?:misconduct|abuse|assault))\b/iu.test(topic.text) &&
      /\b(?:invest(?:ed|ment|ments)|financial support)\b/iu.test(topic.text)
    )
      fail(
        `Topic ${topic.id} mixes a misconduct allegation with financial support. Split the financial response into its own topic without omitting either; spending is not evidence against a separate allegation.`,
      );
    // An observation explicitly leading to unconfirmed speculation already
    // expresses uncertainty; a mistaken model kind must not require fake prose.
    const explicitUncertainty = /\b(?:speculation|unconfirmed|unverified)\b/iu.test(topic.text);
    if (
      (healthLesson || (topic.kind === 'attributed' && !explicitUncertainty)) &&
      !hasLeadingAttribution(topic.text)
    )
      attributionIssues.push(topic.id);
    if (/\bformer president\b/iu.test(topic.text) && !/\bformer president\b/iu.test(source))
      fail(
        `Topic ${topic.id} adds "former president" even though this status is not in the source.`,
      );
    for (const match of topic.text.matchAll(falls))
      if (!sourceFalls.has(fallKey(match)))
        fail(
          `Topic ${topic.id} asserts a measured fall distance not stated in the source; a ride's height is not the rider's fall distance.`,
        );
  }
  if (attributionIssues.length)
    fail(
      `Topics ${attributionIssues.join(', ')} require explicit source attribution at their beginning, e.g. a named speaker alleges/denies/argues or cited research suggests. Correct ALL listed topics in this pass. Do not add generic reporting prefixes to ordinary events.`,
    );
  const expected = paragraphCount(
    coverageGroups.size,
    countWords(source),
    value.content_type === 'lesson' ? value.topics.length : 0,
  );
  const assignments = value.groups.flatMap((group) => group.topic_ids);
  if (
    assignments.length !== topics.size ||
    new Set(assignments).size !== topics.size ||
    assignments.some((id) => !topics.has(id))
  )
    fail(
      'Every inventoried topic must appear exactly once across paragraph groups, with no omissions, repeats or unknown IDs.',
    );
  const weights = value.groups.map((group) =>
    group.topic_ids.reduce((sum, id) => sum + countWords(topics.get(id)!.text), 0),
  );
  const veryUnevenNews =
    !fragments &&
    coverageGroups.size >= expected &&
    Math.max(...weights) > 2 * Math.min(...weights);
  const groups =
    value.groups.length === expected && !veryUnevenNews ? value.groups : regroup(value, expected);
  for (const group of value.coverage_groups) {
    const positions = groups.flatMap((paragraph, index) =>
      paragraph.topic_ids.some((id) => topics.get(id)!.coverage_group_id === group.id)
        ? [index]
        : [],
    );
    if (!fragments && coverageGroups.size >= expected && positions.length > 1)
      fail(`Coverage group ${group.id} must stay in one paragraph.`);
    if (positions.at(-1)! - positions[0]! + 1 !== positions.length)
      fail(`Coverage group ${group.id} must occupy adjacent paragraphs.`);
  }
  return {
    verdict: value.verdict,
    reason: value.reason,
    points: groups.map((group) => ({
      label: group.label,
      body: group.topic_ids.map((id) => topics.get(id)!.text).join(' '),
    })),
  };
}

// Only the old quote contract needs a whole-transcript word index. Current
// fragment IDs are resolved directly against the captions.
function indexLegacyQuotes(blocks: string[], source: string) {
  let offset = 0;
  const passages = new Map(
    sourcePassages(blocks).map((passage) => {
      const located = { ...passage, offset };
      offset += passage.text.length + 1;
      return [passage.id, located] as const;
    }),
  );
  const starts = new Map<number, number>();
  const ends = new Map<number, number>();
  const words: string[] = [];
  let normalizedOffset = 0;
  for (const match of source.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = match[0].toLowerCase();
    starts.set(normalizedOffset, match.index);
    ends.set(normalizedOffset + word.length, match.index + match[0].length);
    words.push(word);
    normalizedOffset += word.length + 1;
  }
  return { passages, starts, ends, comparableSource: words.join(' ') };
}

/** A recruitment ad may hide its pitch behind a legal-news lead-in. Expand only
 * an already-declared commercial span with all three recruitment signals and a
 * nearby explicit segue. This never keyword-bans independent legal reporting.
 */
function commercialLeadStart(source: string, start: number, end: number): number {
  const ad = source.slice(start, end);
  if (
    !/\b(?:qualify|eligible|claimants?|claims)\b/iu.test(ad) ||
    !/\b(?:recover(?:y)?|compensation|entitled)\b/iu.test(ad) ||
    !/\b(?:qr|scan|description|quiz|link)\b/iu.test(ad)
  )
    return start;
  const before = [...source.slice(0, start).matchAll(/\S+/gu)];
  const windowStart = before[Math.max(0, before.length - 180)]?.index ?? 0;
  const prefix = source.slice(windowStart, start);
  const cues = [
    ...prefix.matchAll(
      /\b(?:(?:and\s+)?speaking of lawsuits|(?:a\s+)?(?:quick|short) break with (?:a|our|the) sponsor|a word from (?:our|a|the) sponsor)\b/giu,
    ),
  ];
  return cues.length ? windowStart + cues.at(-1)!.index! : start;
}

export function qualificationPassages(blocks: string[]): number[] {
  return sourcePassages(blocks)
    .filter((p) =>
      /\b(?:denies|denied|disputed|unverified|speculation|no evidence|burden of proof|do not|should not|don't|shouldn't|legal act|threaten(?:ed|ing)?|defamation)\b/iu.test(
        p.text,
      ),
    )
    .map((p) => p.id);
}

/** Correct a layout-only count error without another generation or rewriting a claim.
 * Prefer whole stories when they fit. The balanced layout may use complete
 * adjacent fact cards. Denials and qualifications stay with their fact.
 */
export function regroup(
  value: z.infer<typeof coverageResponseSchema>,
  expected: number,
  splitStories = false,
) {
  const topics = new Map(value.topics.map((topic) => [topic.id, topic]));
  const flat = value.groups.flatMap((group) => group.topic_ids);
  const order = [...new Set(flat.map((id) => topics.get(id)!.coverage_group_id))];
  const units = order.flatMap((groupId) => {
    const ids = flat.filter((id) => topics.get(id)!.coverage_group_id === groupId);
    if (order.length >= expected && !splitStories)
      return [{ ids, label: value.coverage_groups.find((group) => group.id === groupId)!.subject }];
    return ids.map((id) => ({
      ids: [id],
      label: value.groups.find((group) => group.topic_ids.includes(id))!.label,
    }));
  });
  if (units.length < expected)
    return fail('Not enough substantive units for the required paragraphs; never invent filler.');
  const prefix = [0];
  for (const unit of units)
    prefix.push(
      prefix.at(-1)! + unit.ids.reduce((sum, id) => sum + countWords(topics.get(id)!.text), 0),
    );
  const target = prefix.at(-1)! / expected;
  const costs = Array.from({ length: expected + 1 }, () =>
    Array<number>(units.length + 1).fill(Infinity),
  );
  const previous = Array.from({ length: expected + 1 }, () =>
    Array<number>(units.length + 1).fill(-1),
  );
  costs[0]![0] = 0;
  for (let part = 1; part <= expected; part++)
    for (let end = part; end <= units.length; end++)
      for (let start = part - 1; start < end; start++) {
        const cutsStory =
          splitStories &&
          start > 0 &&
          topics.get(units[start - 1]!.ids[0]!)!.coverage_group_id ===
            topics.get(units[start]!.ids[0]!)!.coverage_group_id;
        const cost =
          costs[part - 1]![start]! +
          (prefix[end]! - prefix[start]! - target) ** 2 +
          (cutsStory ? (target / 4) ** 2 : 0);
        if (cost < costs[part]![end]!) {
          costs[part]![end] = cost;
          previous[part]![end] = start;
        }
      }
  const groups: { label: string; topic_ids: number[] }[] = [];
  let end = units.length;
  for (let part = expected; part > 0; part--) {
    const start = previous[part]![end]!;
    if (start < 0) return fail('Cannot form the required nonempty paragraphs.');
    const selected = units.slice(start, end);
    const topic_ids = selected.flatMap((unit) => unit.ids);
    const original = value.groups.find(
      (group) =>
        group.topic_ids.length === topic_ids.length &&
        group.topic_ids.every((id, index) => id === topic_ids[index]),
    );
    const cleanLabel = (label: string) => label.replace(/[:*#•]/gu, '').trim();
    const [first, second] = [...new Set(selected.map((unit) => cleanLabel(unit.label)))];
    const joined = second ? `${first} and ${second}` : first;
    // Keep a whole second label only when it fits. A chopped name makes a
    // worse heading than the first story's title alone.
    const fitsLabel = (label: string) =>
      label.length <= 80 && countWords(label) <= SUMMARY_LABEL_WORD_LIMIT;
    const proposed = original
      ? cleanLabel(original.label)
      : joined && fitsLabel(joined)
        ? joined
        : (first ?? '');
    const words = proposed.split(/\s+/u);
    while (words.length && !fitsLabel(words.join(' '))) words.pop();
    if (/^(?:and|or|of|for|with|to)$/iu.test(words.at(-1) ?? '')) words.pop();
    const label =
      words.join(' ').replace(/\s+and\s+other(?: news| stories)?$/iu, '') || 'Key details';
    groups.unshift({ label, topic_ids });
    end = start;
  }
  return groups;
}
export function paragraphCount(
  independentGroups: number,
  sourceWordCount: number,
  lessonTopics = 0,
): number {
  const lessonFloor =
    sourceWordCount >= 6000 && lessonTopics >= 8
      ? 5
      : sourceWordCount >= 3000 && lessonTopics >= 6
        ? 4
        : 3;
  return sourceWordCount <= SHORT_SOURCE_WORD_LIMIT
    ? 3
    : Math.min(5, Math.max(lessonFloor, independentGroups));
}
function hasLeadingAttribution(text: string): boolean {
  // Check attribution actually displayed in prose, not a second declaration that can disagree.
  const match =
    /^((?:[\p{L}\p{N}][\p{L}\p{N}'’.,&-]*\s+){1,10})(?:alleges|alleged|claims|claimed|denies|denied|argues|argued|reports|reported|says|said|warns|warned|explains|explained|suggests|suggested|states|stated|cautions|cautioned|recommends|recommended|notes|noted|describes|described|proposes|proposed|compares|compared|finds|found|shows|showed|show|suggest|report|argue|accuses|accused|announced|posted|wrote|requested|asked|countered|disputed|criticized|dismissed|responded|insisted|details|detailed|debates|debated|announces|points out|pointed out|point out|note|claim|describe|explain|recommend|warn|demonstrate|demonstrates|demonstrated|identify|identified|reviewed|developed|studied|speculates|speculated|attributes|attributed|interprets|interpreted|believes|believed)\b/iu.exec(
      text.trim(),
    );
  return Boolean(
    match &&
    !/^(?:a|an|the|this|these|those)$/iu.test(match[1]!.trim()) &&
    !/\b(?:on|of|about|with|amid|his|her|their|to)$/iu.test(match[1]!.trim()),
  );
}

function hasQualifiedMentalInterpretation(text: string): boolean {
  for (const match of text.matchAll(
    /\b(?:mental health crisis|manic episode|psychosis|psychotic)\b/giu,
  )) {
    const before = text.slice(0, match.index);
    const sentence = before.slice(
      Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?')) + 1,
    );
    if (
      hasLeadingAttribution(sentence) ||
      /\b(?:the (?:host|speaker)|observers?|commentators?|peers|friends|critics)\s+(?:view(?:ed|s)?|saw|see|interpret(?:ed|s)?|describ(?:ed|es)|suggest(?:ed|s)?|claim(?:ed|s)?|argu(?:ed|es)|express(?:ed|es) concern|believ(?:ed|es))\b/iu.test(
        sentence,
      )
    )
      continue;
    return false;
  }
  return true;
}
