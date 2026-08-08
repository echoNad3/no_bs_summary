import { ApiError, GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { sleepWithinDeadline } from '../http.js';
import { recordRetry } from '../request-context.js';
import type { RequestContext } from '../request-context.js';
import { SummaryValidationError, summaryResponseSchema, summarySchema } from './provider.js';
import type { Summary, SummaryProvider, SummarySource } from './provider.js';

export const GEMINI_PROMPT_VERSION = 'summary-first-v31-2026-07-15';

export const SYSTEM_INSTRUCTION = `Create the detailed summary product first, then add a small WATCH / SKIM / SKIP extra. Use only the title and transcript.

Product priority:
- The detailed summary is the main product. The verdict is secondary.
- Give enough useful detail that the user usually does not need to watch the video to understand what it says.
- Stay direct and compressed, but do not omit useful information just to make the answer short.
- Let information density determine length. A simple source can have a short summary; a dense or multi-topic source needs a longer one. There is no fixed tiny word or sentence target.

Detailed summary:
- Include the actual important facts, names, events, arguments, examples, numbers, context, and conclusions found in the transcript.
- Preserve concrete specifics. Never replace them with vague phrases such as "covers several topics", "discusses internet drama", "shares some advice", or "talks about different ideas".
- For one coherent topic, use compact paragraphs. For a genuinely multi-topic video, use clearly separated Markdown bullets in the summary field. Start each bullet with a short topic label, for example "- **Roman dodecahedrons:** ...". Put the useful details and conclusion for that topic in the same bullet.
- Separate what happened, what the speaker argues, the evidence or examples they give, and the conclusion when those distinctions matter.
- Present disputed, speculative, promotional, health, or science claims as the speaker's claims, not as established facts.
- The summary contains content, not a review of the video and not an explanation of the verdict.

Verdict and reason:
- WATCH: The video is genuinely entertaining, interesting, useful, informative, well told, or worth experiencing.
- SKIM: It has worthwhile material but also noticeable repetition, padding, boring stretches, weak sections, or unnecessary length.
- SKIP: Reserve this for obvious time-wasters, misleading clickbait, empty rambling, heavy repetition, very little substance, or an advertisement disguised as content.
- Judge the video's quality and viewing experience. Do not base the verdict on whether the detailed summary makes watching unnecessary.
- Give one blunt, natural sentence in the "reason" field. Judge the delivery, entertainment, padding, repetition, and whether the creator drags things out. Name what is good or bad about actually watching it.
- Write like a friend giving a straight answer, not a formal review. Good patterns are "Funny in places, but the stories are uneven and buried under too much commentary" or "The case is interesting, but the host repeats the same point and drags it out with reactions."
- Keep it under 25 words. Start with the actual good or bad part, not "The creator is..." or "The video is...".
- Do not use formal or vague review wording such as "a cohesive narrative", "a variety of topics", "cultural commentary", "varies in quality", "offers a perspective", "presents an exploration", "holds attention", "is essentially", "feels like", "scattered series", or "loosely connected reactions".
- Keep the reason separate from the detailed summary and do not repeat it there.
- Do not force a verdict distribution or reward or punish length by itself.

Voice and honesty:
- Always answer in English, even when the captions are not English.
- Use blunt, natural, everyday English, contractions, short sentences, and concrete verbs.
- Swearing is allowed when it is the clearest natural wording, but never force it.
- Avoid academic wording, polished review language, AI filler, vague praise, and stock blurbs.
- Do not repeat the same descriptive word in a sentence.
- Explain necessary technical terms simply, but keep exact names and terms when losing them would remove useful information.
- Never invent a detail that is missing from the transcript. Do not infer a runtime from transcript length. Include a duration only when it is a meaningful fact explicitly stated in the transcript.
- You have not seen the video. Never claim knowledge of visuals, animation, footage, editing, cameras, on-screen material, demonstrations, or physical cues.
- Do not mention the transcript as your input unless the word is genuinely relevant to what the video contains. Never discuss the prompt, model-facing instructions, supplied text, limitations, or being an AI in the answer.`;

function buildResponseJsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(summaryResponseSchema);
  return jsonSchema;
}

export interface GeminiCreateParams {
  model: string;
  input: string;
  stream?: false;
  store: boolean;
  system_instruction: string;
  generation_config: { thinking_level: 'minimal' | 'low' };
  response_format: {
    type: 'text';
    mime_type: 'application/json';
    schema: Record<string, unknown>;
  };
}

export interface GeminiCreateOptions {
  fetchOptions: { signal: AbortSignal };
  maxRetries: number;
}

export type GeminiCreateFn = (
  params: GeminiCreateParams,
  options: GeminiCreateOptions,
) => Promise<{
  output_text?: string | undefined;
  usage?:
    | {
        total_input_tokens?: number | undefined;
        total_output_tokens?: number | undefined;
        total_thought_tokens?: number | undefined;
        total_tokens?: number | undefined;
      }
    | undefined;
}>;

function thinkingConfig(model: string): GeminiCreateParams['generation_config'] {
  return model === 'gemini-2.5-flash' ? { thinking_level: 'low' } : { thinking_level: 'minimal' };
}

function realCreateFn(apiKey: string): GeminiCreateFn {
  let client: GoogleGenAI | undefined;
  return (params, options) => {
    client ??= new GoogleGenAI({ apiKey });
    return client.interactions.create(params, options);
  };
}

function isTransient(error: unknown): boolean {
  const status = httpStatus(error);
  return (
    status === 408 || status === 429 || (status !== undefined && status >= 500 && status < 600)
  );
}

function httpStatus(error: unknown): number | undefined {
  if (error instanceof ApiError) return error.status;
  if (typeof error !== 'object' || error === null) return undefined;

  const candidate = error as { status?: unknown; statusCode?: unknown };
  if (typeof candidate.status === 'number') return candidate.status;
  return typeof candidate.statusCode === 'number' ? candidate.statusCode : undefined;
}

function retryDelay(error: unknown): number {
  if (typeof error !== 'object' || error === null) return 1000;

  const candidate = error as {
    headers?: { get?: (name: string) => string | null };
    message?: unknown;
  };
  const getHeader = candidate.headers?.get;
  if (typeof getHeader === 'function') {
    const retryAfterMs = parsePositiveNumber(getHeader.call(candidate.headers, 'retry-after-ms'));
    if (retryAfterMs !== undefined) return Math.ceil(retryAfterMs);

    const retryAfter = getHeader.call(candidate.headers, 'retry-after');
    const seconds = parsePositiveNumber(retryAfter);
    if (seconds !== undefined) return Math.ceil(seconds * 1000);
    if (retryAfter) {
      const dateDelay = Date.parse(retryAfter) - Date.now();
      if (Number.isFinite(dateDelay) && dateDelay > 0) return Math.ceil(dateDelay);
    }
  }

  if (typeof candidate.message === 'string') {
    const match = candidate.message.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
    const seconds = parsePositiveNumber(match?.[1]);
    if (seconds !== undefined) return Math.ceil(seconds * 1000);
  }

  return 1000;
}

function parsePositiveNumber(value: string | undefined | null): number | undefined {
  if (value === undefined || value === null || value.trim() === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export class GeminiSummaryProvider implements SummaryProvider {
  readonly name = 'gemini';
  private readonly create: GeminiCreateFn;

  constructor(
    apiKey: string,
    private readonly model: string,
    createFn?: GeminiCreateFn,
  ) {
    this.create = createFn ?? realCreateFn(apiKey);
  }

  async summarize(
    transcriptText: string,
    ctx: RequestContext,
    source: SummarySource = { title: 'Unknown title', transcriptLanguage: 'unknown' },
  ): Promise<Summary> {
    const params: GeminiCreateParams = {
      model: this.model,
      input:
        `Title: ${source.title}\n` +
        `Transcript language: ${source.transcriptLanguage}\n` +
        `Return the reason and summary in English.\n` +
        `Final-answer constraint: make the detailed summary the main product. Preserve important specifics and use labeled Markdown bullets for genuinely separate topics. Use plain everyday English. Make the one-sentence reason bluntly judge the delivery, entertainment, padding, repetition, and whether the creator drags things out. Keep it under 25 words. Start with the actual good or bad part, not "The creator is" or "The video is". Write it like a friend giving a straight answer, not a formal review. Never use "a cohesive narrative", "a variety of topics", "cultural commentary", "varies in quality", "offers a perspective", "presents an exploration", "holds attention", "is essentially", "feels like", "scattered series", or "loosely connected reactions" as the reason. Do not mention the transcript as your input unless the word is genuinely relevant to the video's content. Never discuss the prompt, model-facing instructions, supplied text, limitations, or missing information. Never mention or assume visuals, animation, footage, editing, cameras, on-screen material, demonstrations, or physical cues. Never estimate runtime from transcript length.\n\n` +
        `Transcript:\n${transcriptText}`,
      stream: false,
      store: false,
      system_instruction: SYSTEM_INSTRUCTION,
      // Gemini 3.1 Flash-Lite supports minimal; Interactions supports low as
      // Gemini 2.5 Flash's lowest thinking level.
      generation_config: thinkingConfig(this.model),
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: buildResponseJsonSchema(),
      },
    };
    const options: GeminiCreateOptions = {
      fetchOptions: { signal: ctx.signal },
      maxRetries: 0,
    };

    let interaction: Awaited<ReturnType<GeminiCreateFn>>;
    try {
      interaction = await this.create(params, options);
    } catch (firstError) {
      const retryDelayMs = retryDelay(firstError);
      if (
        !isTransient(firstError) ||
        ctx.signal.aborted ||
        Date.now() + retryDelayMs >= ctx.deadlineAt
      ) {
        throw firstError;
      }
      await sleepWithinDeadline(retryDelayMs, ctx.signal);
      recordRetry(ctx, 'summary');
      try {
        interaction = await this.create(params, options);
      } catch (secondError) {
        const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
        const secondMessage =
          secondError instanceof Error ? secondError.message : String(secondError);
        const combined = new Error(
          `${secondMessage} (first Gemini attempt also failed: ${firstMessage})`,
          { cause: secondError },
        );
        if (secondError instanceof Error) combined.name = secondError.name;
        throw combined;
      }
    }

    const text = interaction.output_text;
    if (text === undefined || text.trim() === '') {
      throw new Error('Gemini returned no text.');
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('Gemini returned something that was not valid JSON.');
    }

    const rawParsed = summaryResponseSchema.safeParse(json);
    if (!rawParsed.success) {
      throw summaryRuleError(rawParsed.error.issues);
    }

    const candidate = {
      ...rawParsed.data,
      reason: cleanStyle(rawParsed.data.reason),
      summary: cleanStyle(rawParsed.data.summary),
    };
    const usage = extractUsage(interaction.usage);
    const parsed = summarySchema.safeParse(candidate);
    if (!parsed.success) {
      throw summaryRuleError(parsed.error.issues, candidate, usage);
    }
    return usage ? { ...parsed.data, usage } : parsed.data;
  }
}

function extractUsage(usage: Awaited<ReturnType<GeminiCreateFn>>['usage']): Summary['usage'] {
  if (!usage) return undefined;
  const inputTokens = nonnegativeInteger(usage.total_input_tokens);
  const outputTokens = nonnegativeInteger(usage.total_output_tokens);
  const thoughtTokens = nonnegativeInteger(usage.total_thought_tokens) ?? 0;
  const totalTokens = nonnegativeInteger(usage.total_tokens);
  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) {
    return undefined;
  }
  return { inputTokens, outputTokens, thoughtTokens, totalTokens };
}

function nonnegativeInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function cleanStyle(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(
    /^(?:after reading this summary,?\s+would the user still gain meaningful value from watching\?|is (?:this|the) video worth (?:watching|skimming)\?)\s*(?:yes|no)[.?!]?\s*/iu,
    '',
  );
  cleaned = cleaned
    .replace(
      /^(?:the|this)\s+(?:video|episode|content|segment|course|podcast|tutorial)\s+is\s+/iu,
      "It's ",
    )
    .replace(
      /^(?:the|this)\s+(?:video|episode|content|segment|course|podcast|tutorial)\s+was\s+/iu,
      'It was ',
    )
    .replace(
      /^(?:the|this)\s+(?:video|episode|content|segment|course|podcast|tutorial)\s+/iu,
      'It ',
    )
    .replace(/^this is\s+/iu, "It's ")
    .replace(/^it is\s+/iu, "It's ")
    .replace(/^it offers an\s+/iu, "It's an ")
    .replace(/^it offers a\s+/iu, "It's a ")
    .replace(/\bcomprehensive\b/giu, 'broad')
    .replace(/\bideal for\b/giu, 'good for')
    .replace(/\bprovides\b/giu, 'gives')
    .replace(/\bproviding\b/giu, 'giving')
    .replace(/\bdelves? into\b/giu, 'covers')
    .replace(/\bfoundational\b/giu, 'basic')
    .replace(/\bhighly effective\b/giu, 'effective')
    .replace(/\bhighly practical\b/giu, 'practical')
    .replace(/\bsignificantly\b/giu, '')
    .replace(/\bwell-paced\b/giu, 'focused')
    .replace(/\bperfect for\b/giu, 'for')
    .replace(/\bwell-structured\b/giu, 'clear')
    .replace(/\bstructured,?\s+(?:and\s+)?practical\b/giu, 'clear')
    .replace(/\ba thought-provoking\b/giu, 'an unusual')
    .replace(/\bthought-provoking\b/giu, 'unusual')
    .replace(/\bphilosophical perspective\b/giu, 'idea')
    .replace(/\bquick-hitting\b/giu, 'short')
    .replace(/\bcompelling\b/giu, 'memorable')
    .replace(/\bunique perspective on\b/giu, 'different take on')
    .replace(/\bunique perspective\b/giu, 'different take')
    .replace(/\bfundamental concepts?\b/giu, 'basics')
    .replace(/\bfundamental\b/giu, 'basic')
    .replace(/\bfundamentals\b/giu, 'basics')
    .replace(/\bdevelopment environment\b/giu, 'coding setup')
    .replace(/\bincredibly\b/giu, '')
    .replace(/\bhelpful,\s*focused\b/giu, 'focused')
    .replace(/\ban engaging\b/giu, 'an interesting')
    .replace(/\b(?:narrative piece|narrative impact|narrative experience)\b/giu, 'story')
    .replace(/\bdialogue-driven narrative(?: performance)?\b/giu, 'story told through dialogue')
    .replace(/\buseful framework\b/giu, 'idea')
    .replace(/\bconceptual model\b/giu, 'clear picture')
    .replace(/\bfundamentally\b/giu, '')
    .replace(/\bdefinitive evidence\b/giu, 'solid proof')
    .replace(/\bregarding\b/giu, 'about')
    .replace(/\bthe value lies in\b/giu, 'it works because of')
    .replace(/\boffers? more value than\b/giu, 'works better than')
    .replace(/\bbenefits? from\b/giu, 'works better with')
    .replace(/\bcould be condensed into\b/giu, 'could fit into')
    .replace(/\bprimary purpose\b/giu, 'main point')
    .replace(/\bmeaningful value\b/giu, 'real value')
    .replace(/\bit offers? a clear way to\b/giu, 'it lets you')
    .replace(/^it's a clear way to\b/iu, 'It lets you')
    .replace(/\bdictates?\b/giu, 'controls')
    .replace(/\bacademic\s+/giu, '')
    .replace(/\bdefinitively\s+/giu, '')
    .replace(/\bwell-organized\b/giu, 'clear')
    .replace(/\ba episode\b/giu, 'an episode')
    .replace(
      /(^|[.!?]\s+)(?:in conclusion|ultimately),?\s+(\p{Ll})/giu,
      (_match, prefix, letter: string) => `${prefix}${letter.toUpperCase()}`,
    )
    .replace(/\b(?:in conclusion|ultimately),?\s*/giu, '')
    .replace(/^covers\s+/iu, 'It covers ')
    .replace(/^focuses on\s+/iu, 'It focuses on ')
    .replace(/^presents\s+/iu, 'It presents ')
    .replace(/^discusses\s+/iu, 'It discusses ')
    .replace(/^outlines\s+/iu, 'It outlines ')
    .replace(
      /^(?:this\s+)?(?:gives|provides)\s+(?:a\s+)?(?:clear\s+)?(?:explanation|overview)\s+of\s+how\s+/iu,
      'It explains how ',
    )
    .replace(/^explains\s+how\s+/iu, 'It explains how ')
    .replace(/^(?:gives|provides)\s+/iu, 'It gives ')
    .replace(/[^\S\r\n]{2,}/gu, ' ')
    .replace(/[ \t]+(\r?\n)/gu, '$1')
    .replace(/,\s*,/gu, ',')
    .replace(/\s+([,.;:])/gu, '$1')
    .replace(/\b([\p{L}]+),\s+([^,]+),\s+and\s+\1\b/giu, '$1 and $2')
    .replace(/\b([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*)\s+\1\b/giu, '$1')
    .replace(/\b(a|an)\s*,\s+/giu, '$1 ');
  cleaned = cleaned.replace(/\ba idea\b/giu, 'an idea');
  return cleaned.length === 0 ? cleaned : cleaned[0]!.toUpperCase() + cleaned.slice(1);
}

function summaryRuleError(
  issues: z.core.$ZodIssue[],
  candidate?: ConstructorParameters<typeof SummaryValidationError>[1],
  usage?: ConstructorParameters<typeof SummaryValidationError>[2],
): Error {
  const details = issues
    .map((issue) => `${issue.path?.join('.') || 'output'}: ${issue.message}`)
    .join('; ');
  return new SummaryValidationError(
    `Gemini returned JSON that violated the summary rules (${details}).`,
    candidate,
    usage,
  );
}
