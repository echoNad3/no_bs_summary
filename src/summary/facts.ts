import { z } from 'zod';
import {
  countGeneratedWords,
  countWords,
  SummaryValidationError,
  WORDS_PER_POINT_LIMIT,
} from './provider.js';
import {
  assembleCoverage,
  coverageResponseSchema,
  paragraphCount,
  regroup,
  sourcePassages,
} from './coverage.js';
import type { SourceFragment } from './coverage.js';

const id = z.number().int().positive();
export const factResponseSchema = z.object({
  content_type: coverageResponseSchema.shape.content_type,
  coverage_groups: coverageResponseSchema.shape.coverage_groups,
  excluded: z
    .array(z.object({ start: id, end: id }))
    .max(32)
    .describe(
      'Inclusive source-fragment ID ranges for complete commercial interruptions, INCLUDING a news-like lead-in. Empty if none.',
    ),
  topics: z
    .array(
      z.object({
        id,
        coverage_group_id: id,
        label: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .describe('Short content label, normally 2-4 words; no colon or Markdown.'),
        kind: z.enum(['event', 'attributed']),
        text: z
          .string()
          .trim()
          .min(1)
          .max(1800)
          .describe(
            'One concise source-backed fact card, normally 12-25 words. Concrete actor, action, outcome. Scientific/medical claims or opinions need natural source attribution. Exclude protected qualifications already listed separately.',
          ),
        evidence: z
          .array(id)
          .min(1)
          .max(8)
          .describe(
            'Original source-fragment IDs supporting the card. The app retrieves exact original text. No generated quotations.',
          ),
      }),
    )
    .min(3)
    .max(60),
  qualifications: z
    .array(z.object({ topic_id: id, text: z.string().trim().min(1).max(500), evidence: id }))
    .max(30)
    .describe(
      'Protected material denials, uncertainty and cautions. Select original fragment IDs, never reconstruct source quotes. Appended unchanged to the relevant fact card. Do not duplicate in the card.',
    ),
  verdict: coverageResponseSchema.shape.verdict,
  reason: coverageResponseSchema.shape.reason,
});

export const factCompressionSchema = z.object({
  topics: z
    .array(factResponseSchema.shape.topics.element.pick({ id: true, label: true, text: true }))
    .min(3)
    .max(60),
});

export const missingStorySchema = z.object({
  stories: z
    .array(
      factResponseSchema.shape.topics.element
        .omit({ id: true, coverage_group_id: true })
        .extend({ start: id }),
    )
    .min(1)
    .max(12),
});

type FactDraft = z.infer<typeof factResponseSchema>;

export function fillMissingStories(original: FactDraft, reply: unknown, starts: number[]) {
  const parsed = missingStorySchema.safeParse(reply);
  if (!parsed.success || parsed.data.stories.length !== starts.length)
    throw new SummaryValidationError('Repair must return one fact per missing story.');
  const facts = new Map(parsed.data.stories.map((story) => [story.start, story]));
  const draft = {
    ...original,
    coverage_groups: [...original.coverage_groups],
    topics: [...original.topics],
  };
  let topicId = Math.max(...draft.topics.map((topic) => topic.id));
  let groupId = Math.max(...draft.coverage_groups.map((group) => group.id));
  for (const start of starts) {
    const fact = facts.get(start);
    if (
      !fact ||
      fact.evidence.some((id) => id < start || id > start + 7) ||
      !fact.evidence.some((id) => id <= start + 3)
    )
      throw new SummaryValidationError(
        `The repair for S${start} needs evidence from the missing story's opening.`,
      );
    const { start: _anchor, ...topic } = fact;
    const group = { id: ++groupId, subject: topic.label, kind: 'story' as const };
    const insert = draft.topics.findIndex((item) => Math.min(...item.evidence) > start);
    draft.topics.splice(insert < 0 ? draft.topics.length : insert, 0, {
      ...topic,
      id: ++topicId,
      coverage_group_id: group.id,
    });
    draft.coverage_groups.push(group);
  }
  return draft;
}

/** One source-addressing level only. Cues split boundaries, never remove words. */
export function sourceFragments(blocks: string[]): SourceFragment[] {
  const source = blocks.map((block) => block.trim().replace(/\s+/gu, ' ')).join(' ');
  const cues =
    /\b(?:(?:and\s+)?speaking of lawsuits|(?:a\s+)?(?:quick|short) break with (?:a|our|the) sponsor|(?:and\s+)?(?:then\s+)?(?:\w+\s+){0,3}right back (?:to|into)|(?:and\s+)?(?:again[,;:]?\s+)?back to)\b/giu;
  const cuts = [
    ...new Set([0, ...[...source.matchAll(cues)].map((match) => match.index), source.length]),
  ].sort((a, b) => a - b);
  let offset = 0;
  const legacy = sourcePassages(blocks).map((p) => {
    const item = { id: p.id, start: offset, end: offset + p.text.length };
    offset = item.end + 1;
    return item;
  });
  let legacyIndex = 0;
  const fragments: SourceFragment[] = [];
  for (let part = 0; part < cuts.length - 1; part++) {
    const base = cuts[part]!;
    const tokens = [...source.slice(base, cuts[part + 1]).matchAll(/\S+/gu)];
    for (let i = 0; i < tokens.length; i += 40) {
      const first = tokens[i]!;
      const last = tokens[Math.min(i + 39, tokens.length - 1)]!;
      const start = base + first.index;
      const end = base + last.index + last[0].length;
      while (legacyIndex < legacy.length - 1 && legacy[legacyIndex]!.end <= start) legacyIndex++;
      fragments.push({
        id: fragments.length + 1,
        text: source.slice(start, end),
        start,
        end,
        passage: legacy[legacyIndex]!.id,
      });
    }
  }
  return fragments;
}

export function formatSourceFragments(blocks: string[]): string {
  return sourceFragments(blocks)
    .map((fragment) => `[S${fragment.id}] ${fragment.text}`)
    .join('\n');
}

export function factQualificationHints(blocks: string[]): number[] {
  return qualificationIds(sourceFragments(blocks), false);
}

/** Explicit source qualifications must survive compression. This is deliberately
 * narrower than the advisory hints: ordinary negation or legal reporting alone
 * does not make every source fragment a mandatory caveat.
 */
export function requiredQualificationFragments(blocks: string[]): number[] {
  return qualificationIds(sourceFragments(blocks), true);
}

function qualificationIds(fragments: SourceFragment[], required: boolean): number[] {
  const cue = required
    ? /\b(?:(?:no|without|lacks?)\s+(?:(?:concrete|credible|actual|supporting|independent|scientific)\s+)?(?:proof|evidence)|burden of proof|technically speculation|unverified|unconfirmed|denied|disputed)\b/iu
    : /\b(?:denies|denied|disputed|unverified|speculation|no evidence|burden of proof|do not|should not|don't|shouldn't|legal act|threaten(?:ed|ing)?|defamation)\b/iu;
  return fragments.filter(({ text }) => cue.test(text)).map(({ id }) => id);
}

const NEWS_TRANSITION =
  /\b(?:finally today|in (?:other|separate|another piece of) news|(?:jumping|moving|switching) (?:from that )?to other news|(?:also|next) today,? (?:you've got|we have) (?:the news|a story)|(?:our|the) next story|(?:then )?also with that.{0,100}\btransparency)\b/iu;

function transitionIds(fragments: SourceFragment[]): number[] {
  return fragments
    .filter((fragment, index) => {
      if (NEWS_TRANSITION.test(fragment.text)) return true;
      const next = fragments[index + 1]?.text ?? '';
      return !NEWS_TRANSITION.test(next) && NEWS_TRANSITION.test(`${fragment.text} ${next}`);
    })
    .map((fragment) => fragment.id);
}

type FragmentRange = { start: number; end: number };

function recruitmentAds(fragments: SourceFragment[]): FragmentRange[] {
  const ranges: FragmentRange[] = [];
  for (let index = 0; index < fragments.length; index++) {
    const opening = fragments[index]!;
    if (!/^(?:and )?speaking of lawsuits\b/iu.test(opening.text)) continue;
    const closing = fragments
      .slice(index + 1, index + 12)
      .findIndex((fragment) => /^(?:and )?(?:again[,;:]? )?back to\b/iu.test(fragment.text));
    if (closing < 0) continue;
    const ad = fragments
      .slice(index, index + closing + 1)
      .map((f) => f.text)
      .join(' ');
    if (
      /\b(?:eligible|qualif(?:y|ies)|see if you have a case)\b/iu.test(ad) &&
      /\b(?:compensation|recover(?:y)?|entitled|payout)\b/iu.test(ad) &&
      /\b(?:qr code|take (?:a|the) (?:quiz|survey)|link in (?:the|my) description)\b/iu.test(ad)
    )
      ranges.push({ start: opening.id, end: opening.id + closing });
  }
  return ranges;
}

function inRanges(id: number, ranges: FragmentRange[]): boolean {
  return ranges.some(({ start, end }) => id >= start && id <= end);
}

export function prepareFactSource(blocks: string[]) {
  const fragments = sourceFragments(blocks);
  const ads = recruitmentAds(fragments);
  const included = fragments.filter(({ id }) => !inRanges(id, ads));
  const source = included.map((fragment) => fragment.text).join(' ');
  const onlineDispute =
    /\b(?:allegations?|accusations?|defamation|grooming|cheating)\b/iu.test(source) &&
    /\b(?:stream(?:er|ing|s)?|instagram|youtube|tiktok|podcast|social media)\b/iu.test(source);
  const outcomes = onlineDispute
    ? included.filter(({ text }) => DISPUTE_OUTCOME.test(text)).map(({ id }) => id)
    : [];
  return {
    fragments,
    ads,
    promptText: included.map(({ id, text }) => `[S${id}] ${text}`).join('\n'),
    transitions: transitionIds(fragments).filter((id) => !inRanges(id, ads)),
    required: qualificationIds(included, true),
    hints: qualificationIds(included, false),
    onlineDispute,
    outcomes,
  };
}

const DISPUTE_OUTCOME =
  /\b(?:sold (?:his|her|their|a) (?:\w+ ){0,2}(?:chain|house|home|car|belongings?)|hand(?:ed|ing|s) out (?:money|cash|\$?[\d,]+|(?:\w+ ){0,2}bills)|gave away (?:money|cash|possessions))\b/iu;

const CLINICAL_SPECULATION =
  /\b(?:mental[- ]health crisis|manic(?: episode)?|psychosis|psychotic|schizophreni\w*|bipolar(?: disorder)?|mental breakdown)\b/iu;
const SPECULATIVE_SUFFIX =
  /(?:,\s*(?:and\s+)?|\s+and\s+)(?:claiming|suggesting|saying|adding|speculating|alleging|believing|suspecting|implying|blaming|claimed|suggested|said|alleged|speculated)\b/giu;

function removeClinicalSpeculation(text: string): string {
  return (text.match(/[^.!?]+(?:[.!?]+|$)/gu) ?? [text])
    .map((part) => {
      if (!CLINICAL_SPECULATION.test(part)) return part;
      const boundary = [...part.matchAll(SPECULATIVE_SUFFIX)].findLast((match) =>
        CLINICAL_SPECULATION.test(part.slice(match.index)),
      );
      return boundary ? `${part.slice(0, boundary.index).trimEnd()}.` : '';
    })
    .join('')
    .trim();
}

const RELATIVE_DATE =
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(days?|weeks?|months?|years?)\s+(before|after|prior to)\b/iu;
const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

function cleanUnsupportedDate(text: string, evidence: string): string {
  const openingDate = RELATIVE_DATE.exec(text);
  if (openingDate?.index === 0) {
    const comma = text.indexOf(',');
    const count = NUMBER_WORDS.indexOf(openingDate[1]!.toLowerCase());
    const amount = count < 0 ? Number(openingDate[1]) : count;
    const unit = openingDate[2]!.toLowerCase().replace(/s$/u, '');
    const direction = openingDate[3]!.toLowerCase() === 'after' ? 'after' : 'before|prior to';
    const sourceDate = new RegExp(
      `\\b(?:${amount}${NUMBER_WORDS[amount] ? `|${NUMBER_WORDS[amount]}` : ''}) ${unit}s? (?:${direction})\\b`,
      'iu',
    );
    if (comma >= 0 && comma < 65 && !sourceDate.test(evidence))
      text = text
        .slice(comma + 1)
        .trimStart()
        .replace(/^\p{Ll}/u, (letter) => letter.toUpperCase());
  }
  return text;
}

function keepSeparateUnfollows(text: string, evidence: string): string {
  // The captions first describe a team action and then explicitly add an
  // unfollow by one individual. A merged subject cannot inherit both actions.
  const separate =
    /\b(?:team|crew) unfollowed\b[^.!?]{0,90}\band\s+[\p{L}'’-]+\s+[^.!?]{0,35}\bunfollowed\b[^.!?]{0,55}\balso unfollowing\s+([\p{L}'’-]+)/iu.exec(
      evidence,
    );
  if (!separate) return text;
  const name = separate[1]!.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return text.replace(/\b(?:team|crew)\b[^.!?]{0,60}\bunfollowed\b[^.!?]+/giu, (clause) =>
    clause
      .replace(new RegExp(`(unfollowed )(?:both )?${name} and (?!then\\b)`, 'iu'), '$1')
      .replace(new RegExp(`(unfollowed )(?:both )?([^,;.!?]{1,32}?) and ${name}\\b`, 'iu'), '$1$2'),
  );
}

export function assembleFactCards(
  raw: unknown,
  blocks: string[],
  prepared = prepareFactSource(blocks),
) {
  const parsed = factResponseSchema.safeParse(raw);
  if (!parsed.success)
    throw new SummaryValidationError(
      `Fact cards are invalid: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  const value = parsed.data;
  // Unlabelled clips in personal online disputes cannot establish who made a
  // speculative clinical assessment. Retain the independent reported action.
  const personalDispute =
    value.content_type !== 'lesson' &&
    value.content_type !== 'news_roundup' &&
    prepared.onlineDispute;
  if (personalDispute) {
    for (const topic of value.topics) {
      if (!CLINICAL_SPECULATION.test(topic.text)) continue;
      const text = removeClinicalSpeculation(topic.text);
      if (!text) {
        // A standalone interpretation is not a substantive story when the
        // same group already has sourced observations and other developments.
        if (
          value.topics.length > 3 &&
          value.topics.some(
            (other) =>
              other.id !== topic.id &&
              other.coverage_group_id === topic.coverage_group_id &&
              !CLINICAL_SPECULATION.test(other.text),
          ) &&
          !value.qualifications.some((qualification) => qualification.topic_id === topic.id)
        ) {
          value.topics = value.topics.filter((other) => other.id !== topic.id);
          continue;
        }
        throw new SummaryValidationError(
          `Topic ${topic.id} is unsupported clinical speculation. State the sourced action instead, keeping any independent denial or other material development.`,
        );
      }
      topic.text = text;
    }
    if (value.qualifications.some((q) => CLINICAL_SPECULATION.test(q.text)))
      throw new SummaryValidationError(
        'A qualification includes unverified clinical speculation. Retain the actual denial or evidence limitation only.',
      );
  }
  // Joining independently generated cards must never run two sentences together.
  // Formatting only: preserve words, names, numbers and qualifications verbatim.
  const sentence = (text: string) => (/[.!?]["'’”)]?$/u.test(text) ? text : `${text}.`);
  value.topics.forEach((topic) => {
    topic.text = sentence(topic.text);
  });
  value.qualifications.forEach((q) => {
    q.text = sentence(q.text);
  });
  const topicIds = new Set(value.topics.map((topic) => topic.id));
  const groupIds = new Set(value.coverage_groups.map((group) => group.id));
  if (topicIds.size !== value.topics.length || groupIds.size !== value.coverage_groups.length)
    throw new SummaryValidationError('Fact and coverage-group IDs must be unique.');
  if (value.topics.some((topic) => !groupIds.has(topic.coverage_group_id)))
    throw new SummaryValidationError('A fact references an unknown coverage group.');
  if (new Set(value.topics.map((topic) => topic.coverage_group_id)).size !== groupIds.size)
    throw new SummaryValidationError(
      'Every independent coverage group needs a fact; restore its missing content or remove an unsupported group.',
    );
  if (value.qualifications.some((q) => !topicIds.has(q.topic_id)))
    throw new SummaryValidationError('A qualification references an unknown fact.');
  if (value.content_type === 'simple_story' && value.coverage_groups.length > 1) {
    // A narrative can have several phases without becoming several stories.
    const primary = value.coverage_groups[0]!;
    value.coverage_groups = [{ ...primary, kind: 'story' }];
    for (const topic of value.topics) topic.coverage_group_id = primary.id;
  }
  const fragments = new Map(prepared.fragments.map((fragment) => [fragment.id, fragment]));
  const reference = (id: number) => {
    const fragment = fragments.get(id);
    if (!fragment)
      throw new SummaryValidationError(`Reference S${id} must be an original source fragment.`);
    return { passage: fragment.passage, quote: fragment.text, statement_id: id };
  };
  for (const topic of value.topics) {
    const evidence = topic.evidence.map((id) => fragments.get(id)?.text ?? '').join(' ');
    topic.text = keepSeparateUnfollows(cleanUnsupportedDate(topic.text, evidence), evidence);
  }
  value.qualifications.forEach((q) => reference(q.evidence));
  const issues: string[] = [];
  const missingStories: number[] = [];
  for (const qualification of value.qualifications) {
    if (
      /^technically speculation[,.;]\s+but I (?:feel|think|believe)\b/iu.test(qualification.text) &&
      /\btechnically speculation\b/iu.test(fragments.get(qualification.evidence)!.text)
    )
      qualification.text = 'The host says this identification remains speculation.';
    if (/\bI (?:feel|think|believe)\b/u.test(qualification.text))
      issues.push(
        `Qualification for topic ${qualification.topic_id} copies first-person source commentary. State its actual qualification in third person, e.g. the host notes this remains unconfirmed speculation; preserve its scope and evidence ID.`,
      );
    const topic = value.topics.find((t) => t.id === qualification.topic_id)!;
    const groupTopics = value.topics.filter((t) => t.coverage_group_id === topic.coverage_group_id);
    const groupEvidence = groupTopics.flatMap((t) => t.evidence);
    if (
      qualification.evidence < Math.min(...groupEvidence) - 1 ||
      qualification.evidence > Math.max(...groupEvidence) + 1
    )
      issues.push(
        `Qualification for topic ${topic.id} belongs outside its story's cited source range. Attach it to the correct story and fact.`,
      );
    // Captions may misspell names, so only check two-word names already used in
    // another story, and consider nearby context as well as this story's citations.
    const otherTopics = value.topics.filter((t) => t.coverage_group_id !== topic.coverage_group_id);
    const localContext = [
      qualification.evidence - 1,
      qualification.evidence,
      qualification.evidence + 1,
    ]
      .map((i) => fragments.get(i)?.text ?? '')
      .join(' ');
    const citedContext = [
      ...groupEvidence,
      qualification.evidence - 1,
      qualification.evidence,
      qualification.evidence + 1,
    ]
      .map((i) => fragments.get(i)?.text ?? '')
      .join(' ');
    for (const [name, surname] of qualification.text.matchAll(
      /\b\p{Lu}[\p{L}'’-]+ (\p{Lu}[\p{L}'’-]+)\b/gu,
    )) {
      if (
        otherTopics.some((t) => t.text.includes(name)) &&
        !groupTopics.some((t) => t.text.includes(name)) &&
        !citedContext.toLowerCase().includes(surname!.toLowerCase())
      ) {
        // Repair this only when the cited story explicitly names one donor
        // and the nearby captions identify that same person's denial.
        const donors = [
          ...new Set(
            [
              ...citedContext.matchAll(
                /\bdonor (?:and loyalist )?(\p{Lu}[\p{L}'’-]+ (\p{Lu}[\p{L}'’-]+))/gu,
              ),
            ]
              .filter(([, , last]) => {
                const escaped = last!.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
                return new RegExp(`\\b${escaped}\\b[^.!?]{0,100}\\bdenied\\b`, 'iu').test(
                  localContext,
                );
              })
              .map(([, full]) => full!),
          ),
        ];
        if (
          donors.length === 1 &&
          qualification.text.startsWith(name + ' ') &&
          /\bdenied\b/iu.test(qualification.text)
        ) {
          qualification.text = donors[0]! + qualification.text.slice(name.length);
          continue;
        }
        issues.push(
          `Qualification for topic ${topic.id} uses a name from an unrelated story. Verify the actor of the denial or use the role stated in the cited source.`,
        );
      }
    }
  }
  for (const required of prepared.required) {
    if (value.excluded.some((span) => required >= span.start && required <= span.end)) continue;
    // A statement can wrap the 40-word boundary. A qualification may cite its
    // adjacent fragment, but a caveat elsewhere in the source cannot cover it.
    if (!value.qualifications.some((q) => Math.abs(q.evidence - required) <= 1))
      issues.push(
        `Preserve the explicit denial, uncertainty or evidence limitation around S${required} as a qualification with its original source ID and the correct actor/scope. Do not replace it with reactions or a different caveat.`,
      );
  }
  if (value.content_type === 'news_roundup') {
    const cited = new Set(value.topics.flatMap((topic) => topic.evidence));
    for (const start of prepared.transitions) {
      if (value.excluded.some((span) => start >= span.start && start <= span.end)) continue;
      if (![start, start + 1, start + 2, start + 3].some((fragment) => cited.has(fragment)))
        missingStories.push(start);
    }
  }
  if (
    personalDispute &&
    prepared.outcomes.length &&
    !value.topics.some(
      (topic) =>
        /\b(?:sold|sell(?:s|ing)?|hand(?:ed|ing|s) out|gave away|giv(?:es|ing) away)\b/iu.test(
          topic.text,
        ) &&
        topic.evidence.some((id) =>
          prepared.outcomes.some((outcome) => Math.abs(id - outcome) <= 1),
        ),
    )
  ) {
    issues.push(
      `Preserve the sourced action in the discussion at S${prepared.outcomes[0]}. Report what happened without inferring mental health or motive.`,
    );
  }
  const data = {
    content_type: value.content_type,
    coverage_groups: value.coverage_groups,
    scan: blocks.map((_, i) => i + 1),
    excluded: [
      ...prepared.ads,
      ...value.excluded.filter(
        (span) => !prepared.ads.some((ad) => span.start <= ad.end && span.end >= ad.start),
      ),
    ]
      .sort((a, b) => a.start - b.start)
      .map((span) => {
        if (span.end < span.start)
          throw new SummaryValidationError('A commercial range ends before it starts.');
        return { start: reference(span.start), end: reference(span.end) };
      }),
    qualifications: value.qualifications.map((q) => ({ ...q, evidence: reference(q.evidence) })),
    topics: value.topics.map((topic) => ({ ...topic, evidence: topic.evidence.map(reference) })),
    groups: value.topics.map((topic) => ({ label: topic.label, topic_ids: [topic.id] })),
    verdict: value.verdict,
    reason: value.reason,
  };
  // Layout uses whole fact cards or whole independent stories, never rewrites prose.
  // Include protected qualifications in balancing weights before the final assembly.
  const weighted = {
    ...data,
    topics: data.topics.map((topic) => ({
      ...topic,
      text: [
        topic.text,
        ...value.qualifications.filter((q) => q.topic_id === topic.id).map((q) => q.text),
      ].join(' '),
    })),
  };
  const paragraphs = paragraphCount(
    value.coverage_groups.length,
    countWords(blocks.join(' ')),
    value.content_type === 'lesson' ? value.topics.length : 0,
  );
  let groups = regroup(weighted, paragraphs);
  const wordsByTopic = new Map(weighted.topics.map((topic) => [topic.id, countWords(topic.text)]));
  const imbalance = (layout: typeof groups) => {
    const words = layout.map((group) =>
      group.topic_ids.reduce((sum, id) => sum + wordsByTopic.get(id)!, 0),
    );
    return Math.max(...words) / Math.min(...words);
  };
  const wholeStoryRatio = imbalance(groups);
  if (value.coverage_groups.length >= paragraphs && wholeStoryRatio > 2) {
    const balanced = regroup(weighted, paragraphs, true);
    if (imbalance(balanced) < wholeStoryRatio * 0.8) groups = balanced;
  }
  let result;
  try {
    result = assembleCoverage({ ...data, groups }, blocks, fragments);
  } catch (error) {
    if (!(error instanceof SummaryValidationError)) throw error;
    issues.push(error.message);
  }
  const onlyMissingStories = issues.length === 0 && missingStories.length > 0;
  for (const start of missingStories)
    issues.push(
      `The roundup starts another story around S${start}, but no emitted story cites its opening. Add the distinct news and its outcome using evidence there.`,
    );
  if (issues.length) {
    // When provenance and length both need repair, report both in the one
    // available retry without locking the fields that need factual corrections.
    if (result) {
      const limit = WORDS_PER_POINT_LIMIT * result.points.length;
      const total = countGeneratedWords(result.verdict, result.reason, result.points);
      if (total > limit)
        issues.push(
          `The assembled summary has ${total} words and must total at most ${limit} words. Shorten its fact and qualification prose while fixing the other issues.`,
        );
    }
    throw new SummaryValidationError(
      issues.join('\n'),
      onlyMissingStories ? result : undefined,
      undefined,
      onlyMissingStories && issues.length === missingStories.length ? missingStories : undefined,
    );
  }
  return result!;
}

/** Keep provenance and caveats in code. The shortening pass edits prose only. */
export function applyFactCompression(
  original: z.infer<typeof factResponseSchema>,
  compressed: unknown,
) {
  const parsed = factCompressionSchema.safeParse(compressed);
  if (!parsed.success)
    throw new SummaryValidationError('Compression must return topic text and labels.');
  const changes = new Map(parsed.data.topics.map((topic) => [topic.id, topic]));
  if (
    parsed.data.topics.length !== original.topics.length ||
    changes.size !== original.topics.length ||
    original.topics.some((topic) => !changes.has(topic.id))
  )
    throw new SummaryValidationError(
      'Compression must return each original topic ID exactly once.',
    );
  return {
    ...original,
    topics: original.topics.map((topic) => ({ ...topic, ...changes.get(topic.id)! })),
  };
}
