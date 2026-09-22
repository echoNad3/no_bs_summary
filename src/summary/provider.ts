import { z } from 'zod';
import type { RequestContext } from '../request-context.js';

export const REASON_CHARACTER_LIMIT = 1200;
export const REASON_WORD_LIMIT = 20;
export const SUMMARY_CHARACTER_LIMIT = 3000;
export const TOTAL_OUTPUT_WORD_LIMIT = 200;
export const SUMMARY_POINT_LIMIT = 3;
export const SUMMARY_LABEL_WORD_LIMIT = 8;

export interface SummaryPoint {
  label: string;
  body: string;
}

const summaryPointSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .describe('A short plain-text label, normally two to five words, with no colon or Markdown.'),
  body: z
    .string()
    .trim()
    .min(1)
    .max(SUMMARY_CHARACTER_LIMIT)
    .describe('One compact plain-text explanation with no heading, bullet, list, or line break.'),
});

/** Shape sent to Gemini as JSON Schema. Cross-field rules are checked after parsing. */
export const summaryResponseSchema = z.object({
  verdict: z
    .enum(['WATCH', 'SKIM', 'SKIP'])
    .describe('Whether the video is worth watching, worth skimming, or an obvious time-waster.'),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(REASON_CHARACTER_LIMIT)
    .describe(
      'One blunt, natural sentence of at most 20 words judging the video’s delivery, entertainment, padding, repetition, or whether the creator drags things out. Aim for 10-18 words. Start with the actual good or bad part, not “The creator is” or “The video is.” Write like a friend giving a straight answer, not a formal review. Avoid phrases such as “a cohesive narrative,” “a variety of topics,” “cultural commentary,” “varies in quality,” “offers a perspective,” “presents an exploration,” “holds attention,” “is essentially,” “feels like,” “scattered series,” or “loosely connected reactions.” Never mention visuals, animation, footage, editing, cameras, on-screen material, demonstrations, physical cues, or runtime.',
    ),
  points: z
    .array(summaryPointSchema)
    .min(1)
    .max(SUMMARY_POINT_LIMIT)
    .describe(
      'One to three main points. Use fewer when the source is simple. Each point needs a short label and a fuller body. Group related facts instead of creating extra points.',
    ),
});

const publicSummaryShape = z.object({
  verdict: z.enum(['WATCH', 'SKIM', 'SKIP']),
  reason: z.string().trim().min(1).max(REASON_CHARACTER_LIMIT),
  summary: z.string().trim().min(1).max(SUMMARY_CHARACTER_LIMIT),
});

export function countSentences(text: string): number {
  return sentenceSegments(text).length;
}

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}'’-]+/gu)?.length ?? 0;
}

function sentenceSegments(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];

  const marker = '\uE000';
  const protectedText = trimmed
    .replace(/\b(e)\.(g)\./giu, `$1${marker}$2${marker}`)
    .replace(/\b(i)\.(e)\./giu, `$1${marker}$2${marker}`)
    .replace(/\b([A-Z])\.([A-Z])\./gu, `$1${marker}$2${marker}`)
    .replace(/\b(vs|etc|mr|mrs|ms|dr|prof)\./giu, `$1${marker}`);
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  return Array.from(segmenter.segment(protectedText), ({ segment }) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.replaceAll(marker, '.'));
}

export const summarySchema = publicSummaryShape.superRefine((value, ctx) => {
  if (value.reason.trim() === '') {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'reason must contain text' });
  }
  if (countSentences(value.reason) > 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'reason must be one sentence',
    });
  }
  if (countWords(value.reason) > REASON_WORD_LIMIT) {
    ctx.addIssue({
      code: 'custom',
      path: ['reason'],
      message: `reason must be at most ${REASON_WORD_LIMIT} words`,
    });
  }
  if (value.reason.trim().toLowerCase() === value.summary.trim().toLowerCase()) {
    ctx.addIssue({
      code: 'custom',
      path: ['summary'],
      message: 'reason and summary must not be identical',
    });
  }
  const points = parseCanonicalSummaryPoints(value.summary);
  if (!points) {
    ctx.addIssue({
      code: 'custom',
      path: ['summary'],
      message: 'summary must contain one to three labeled points with no extra sections',
    });
    return;
  }

  const pointIssue = validateSummaryPoints(points);
  if (pointIssue) {
    ctx.addIssue({ code: 'custom', path: ['summary'], message: pointIssue });
  }
  if (countGeneratedWords(value.verdict, value.reason, points) > TOTAL_OUTPUT_WORD_LIMIT) {
    ctx.addIssue({
      code: 'custom',
      path: ['summary'],
      message: `verdict, reason, labels, and bodies must total at most ${TOTAL_OUTPUT_WORD_LIMIT} words`,
    });
  }
  const pointText = points.map(({ label, body }) => `${label} ${body}`).join(' ');
  if (startsLikeAiCopy(points[0]?.body ?? '') || startsLikeBadReason(value.reason)) {
    ctx.addIssue({
      code: 'custom',
      path: ['summary'],
      message: 'output must start with substance, not generic video-summary wording',
    });
  }
  if (hasRepeatedWord(`${value.reason} ${pointText}`)) {
    ctx.addIssue({
      code: 'custom',
      path: ['summary'],
      message: 'output must not repeat the same word back to back',
    });
  }
  if (containsVagueReason(value.reason)) {
    ctx.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'reason must name the actual value or waste instead of using a vague phrase',
    });
  }
  if (assumesWrittenMaterialAutomaticallyReplacesVideo(value.reason)) {
    ctx.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'reason must not assume documentation or an article replaces structured teaching',
    });
  }
  if (leaksPromptQuestion(`${value.reason} ${pointText}`)) {
    ctx.addIssue({
      code: 'custom',
      path: ['summary'],
      message: 'output must answer the task without repeating the prompt question',
    });
  }
  if (containsModelLeakage(`${value.reason} ${pointText}`)) {
    ctx.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'output must not expose model-facing prompts, instructions, or identity',
    });
  }
  if (
    value.verdict === 'SKIP' &&
    saysSomeSectionsAreWorthWatching(`${value.reason} ${pointText}`)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['verdict'],
      message: 'verdict must be SKIM when the output says selected sections are worth watching',
    });
  }
  if (repeatsReasonInSummary(value.reason, pointText)) {
    ctx.addIssue({
      code: 'custom',
      path: ['summary'],
      message: 'summary must not restate the reason',
    });
  }
});

const CANONICAL_POINT = /^- \*\*([^*\r\n]+):\*\* ([^\r\n]+)$/u;

export function serializeSummaryPoints(points: SummaryPoint[]): string {
  return points.map(({ label, body }) => `- **${label.trim()}:** ${body.trim()}`).join('\n\n');
}

export function parseCanonicalSummaryPoints(summary: string): SummaryPoint[] | undefined {
  const sections = summary.trim().split(/\r?\n\s*\r?\n/gu);
  if (sections.length < 1 || sections.length > SUMMARY_POINT_LIMIT) return undefined;
  const points: SummaryPoint[] = [];
  for (const section of sections) {
    const match = CANONICAL_POINT.exec(section);
    if (!match) return undefined;
    points.push({ label: match[1]!.trim(), body: match[2]!.trim() });
  }
  return points;
}

export function countGeneratedWords(
  verdict: 'WATCH' | 'SKIM' | 'SKIP',
  reason: string,
  points: SummaryPoint[],
): number {
  return countWords(
    [verdict, reason, ...points.flatMap(({ label, body }) => [label, body])].join(' '),
  );
}

export function validateSummaryPoints(points: SummaryPoint[]): string | undefined {
  if (points.length < 1 || points.length > SUMMARY_POINT_LIMIT) {
    return `summary must contain one to ${SUMMARY_POINT_LIMIT} points`;
  }
  for (const point of points) {
    if (!point.label.trim() || !point.body.trim()) return 'every point needs a label and body';
    if (countWords(point.label) > SUMMARY_LABEL_WORD_LIMIT) {
      return `point labels must use at most ${SUMMARY_LABEL_WORD_LIMIT} words`;
    }
    if (/[:*\r\n]|^\s*(?:[-•#]|\d+[.)])/u.test(point.label)) {
      return 'point labels must be short plain text without Markdown or colons';
    }
    if (/\r|\n|\*\*|^\s*(?:[-*•#]|\d+[.)]\s+)/u.test(point.body)) {
      return 'point bodies must not contain headings, nested lists, or line breaks';
    }
  }
  return undefined;
}

function startsLikeAiCopy(text: string): boolean {
  return /^(?:this is\b|(?:the|this)\s+(?:video|episode|content|segment|course|podcast|tutorial)\b)/iu.test(
    text.trim(),
  );
}

function startsLikeBadReason(text: string): boolean {
  return /^(?:(?:the|this)\s+video|the\s+creator|this\s+is)\b/iu.test(text.trim());
}

function hasRepeatedWord(text: string): boolean {
  return /\b([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*)\s+\1\b/iu.test(text);
}

function containsVagueReason(text: string): boolean {
  return /^(?:the creator|the host|the speaker|the video)\s+(?:is|offers|provides|presents)\b|\b(?:the )?(?:full sequence|experience) matters\b|\b(?:a )?cohesive narrative\b|\b(?:a )?variety of topics\b|\bcultural commentary\b|\bvaries in quality\b|\boffers? (?:a|an) (?:perspective|exploration)\b|\bpresents? (?:a|an) exploration\b|\bholds? (?:the )?(?:viewer'?s )?attention\b|\bis essentially\b|\bfeels like\b|\b(?:a )?scattered (?:collection|series)\b|\bloosely connected (?:topics|reactions|stories)\b|\b(?:a )?collection of random (?:topics|stories|reactions)\b/iu.test(
    text,
  );
}

function assumesWrittenMaterialAutomaticallyReplacesVideo(text: string): boolean {
  return /\b(?:documentation|docs|article|written guide)\b/iu.test(text);
}

function leaksPromptQuestion(text: string): boolean {
  return /\bafter reading this summary\b|\bwould the user still gain meaningful value\b|\bjudge both useful information\b/iu.test(
    text,
  );
}

function containsModelLeakage(text: string): boolean {
  return /\bthe user\s+(?:asked|told|instructed)\s+me\b|\b(?:the|this)\s+prompt\b[^.!?]{0,40}\b(?:says?|said|asks?|asked|tells?|told|requires?|required|instructs?|instructed)\b|\b(?:system|developer)\s+(?:prompt|instructions?|message)\b|\bmy instructions?\b|\bas an AI\b|\bI\s+(?:(?:was|am)\s+(?:asked|told|instructed)\s+to|cannot|can't|have no way|was only given)\b|\b(?:the|given|provided|supplied)\s+input\b[^.!?]{0,50}\b(?:does not|doesn't|lacks?|missing|insufficient|not enough)\b/iu.test(
    text,
  );
}

function saysSomeSectionsAreWorthWatching(text: string): boolean {
  return /\b(?:watch|view)\s+(?:only\s+)?(?:the\s+)?(?:specific|selected|relevant|useful)\s+(?:parts?|sections?)\b|\b(?:parts?|sections?)\s+(?:you|the user)\s+(?:need|want)\b/iu.test(
    text,
  );
}

function repeatsReasonInSummary(reason: string, summary: string): boolean {
  const reasonWords = contentWords(reason);
  if (reasonWords.size < 4) return false;

  return summary.split(/[.!?]+/u).some((sentence) => {
    const summaryWords = contentWords(sentence);
    if (summaryWords.size < 4) return false;
    let shared = 0;
    for (const word of reasonWords) if (summaryWords.has(word)) shared += 1;
    return shared >= 4 && shared / Math.min(reasonWords.size, summaryWords.size) >= 0.75;
  });
}

function contentWords(text: string): Set<string> {
  const ignored = new Set([
    'about',
    'after',
    'again',
    'actual',
    'content',
    'from',
    'gives',
    'into',
    'lesson',
    'makes',
    'only',
    'that',
    'their',
    'there',
    'these',
    'they',
    'this',
    'through',
    'useful',
    'video',
    'watching',
    'worth',
    'with',
  ]);
  return new Set(
    text
      .toLowerCase()
      .match(/[a-z0-9']+/g)
      ?.filter((word) => word.length >= 4 && !ignored.has(word)) ?? [],
  );
}

export interface SummaryUsage {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
}

export type Summary = z.infer<typeof summarySchema> & { usage?: SummaryUsage };
export type SummaryCandidate = z.infer<typeof summaryResponseSchema>;

/** Keeps a rejected model response auditable without treating it as product output. */
export class SummaryValidationError extends Error {
  constructor(
    message: string,
    readonly candidate?: SummaryCandidate,
    readonly usage?: SummaryUsage,
  ) {
    super(message);
    this.name = 'SummaryValidationError';
  }
}

export interface SummaryProvider {
  readonly name: string;
  summarize(transcriptText: string, ctx: RequestContext, source?: SummarySource): Promise<Summary>;
}

export interface SummarySource {
  transcriptLanguage: string;
}
