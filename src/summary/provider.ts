import { z } from 'zod';
import type { RunContext } from '../run-context.js';

export const REASON_CHARACTER_LIMIT = 1200;
export const SUMMARY_CHARACTER_LIMIT = 12000;

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
      'One blunt, natural sentence under 25 words judging the video’s delivery, entertainment, padding, repetition, or whether the creator drags things out. Start with the actual good or bad part, not “The creator is” or “The video is.” Write like a friend giving a straight answer, not a formal review. Avoid phrases such as “a cohesive narrative,” “a variety of topics,” “cultural commentary,” “varies in quality,” “offers a perspective,” “presents an exploration,” “holds attention,” “is essentially,” “feels like,” “scattered series,” or “loosely connected reactions.” Never mention visuals, animation, footage, editing, cameras, on-screen material, demonstrations, physical cues, or runtime.',
    ),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(SUMMARY_CHARACTER_LIMIT)
    .describe(
      'The detailed summary is the main product. Preserve the important facts, names, events, arguments, numbers, context, and conclusions in direct English. Use clearly separated Markdown topic bullets for a genuinely multi-topic video. Let information density determine length. Attribute disputed claims, never invent details or unseen visuals, and do not repeat or review the verdict reason.',
    ),
});

export function countSentences(text: string): number {
  return sentenceSegments(text).length;
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

export const summarySchema = summaryResponseSchema.superRefine((value, ctx) => {
  if (value.reason.trim() === '') {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'reason must contain text' });
  }
  if (value.summary.trim() === '') {
    ctx.addIssue({ code: 'custom', path: ['summary'], message: 'summary must contain text' });
  }
  if (countSentences(value.reason) > 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'reason must be one sentence',
    });
  }
  if (value.reason.trim().toLowerCase() === value.summary.trim().toLowerCase()) {
    ctx.addIssue({
      code: 'custom',
      path: ['summary'],
      message: 'reason and summary must not be identical',
    });
  }
  if (startsLikeAiCopy(value.reason) || startsLikeAiCopy(value.summary)) {
    ctx.addIssue({
      code: 'custom',
      path: ['summary'],
      message: 'output must start with substance, not generic video-summary wording',
    });
  }
  if (containsPolishedAiWording(`${value.reason} ${value.summary}`)) {
    ctx.addIssue({
      code: 'custom',
      path: ['summary'],
      message: 'output contains polished AI-style wording',
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
  if (leaksPromptQuestion(`${value.reason} ${value.summary}`)) {
    ctx.addIssue({
      code: 'custom',
      path: ['summary'],
      message: 'output must answer the task without repeating the prompt question',
    });
  }
  if (containsModelLeakage(`${value.reason} ${value.summary}`)) {
    ctx.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'output must not expose model-facing prompts, instructions, or identity',
    });
  }
  if (
    value.verdict === 'SKIP' &&
    saysSomeSectionsAreWorthWatching(`${value.reason} ${value.summary}`)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['verdict'],
      message: 'verdict must be SKIM when the output says selected sections are worth watching',
    });
  }
  if (repeatsReasonInSummary(value.reason, value.summary)) {
    ctx.addIssue({
      code: 'custom',
      path: ['summary'],
      message: 'summary must not restate the reason',
    });
  }
});

function startsLikeAiCopy(text: string): boolean {
  return /^(?:this is\b|(?:the|this)\s+(?:video|episode|content|segment|course|podcast|tutorial)\b)/iu.test(
    text.trim(),
  );
}

function containsPolishedAiWording(text: string): boolean {
  return /\b(?:comprehensive|delves? into|ideal for|in conclusion|ultimately|highly effective|well-paced|well-structured|thought-provoking|unique perspective|fundamental concepts?|perfect for|narrative piece|narrative impact|narrative experience|dialogue-driven narrative|conceptual model|audio experience|useful framework|definitive evidence|fundamentally|serves as a mechanism|collective sum|the value lies in|core value|culminating in|offers? more value|offers? a practical way|benefits? from|could be condensed|feel its impact|cannot replicate|provides? essential practice|primary purpose|meaningful value)\b/iu.test(
    text,
  );
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
  summarize(transcriptText: string, ctx: RunContext, source?: SummarySource): Promise<Summary>;
}

export interface SummarySource {
  title: string;
  transcriptLanguage: string;
}
