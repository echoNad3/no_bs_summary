import { ApiError, GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { RunContext } from '../run-context.js';
import { summarySchema } from './provider.js';
import type { Summary, SummaryProvider } from './provider.js';

/**
 * Gemini adapter using the official @google/genai SDK (Interactions API).
 *
 * One request per transcript. No chunking, no second passes, no tools.
 * store=false keeps this stateless; thinking stays minimal and temperature
 * low so results are fast and repeatable. The response must be JSON matching
 * summarySchema — the JSON schema sent to Gemini is generated from that same
 * Zod schema, so there is a single source of truth.
 */

const SYSTEM_INSTRUCTION = `You judge YouTube videos by their transcript and write the shortest useful summary.

Output rules:
- Use simple, direct English, no matter what language the transcript is in.
- Get to the point immediately. No introductions, no conclusions, no generic advice, no filler.
- "summary" must be the shortest text that still contains every useful idea from the video. A long video does not deserve a long summary.
- "reason" is exactly one short, blunt sentence.
- "reason" and "summary" together must stay under 200 words.

Judgment rules:
- When the video really contains repetition, padding, clickbait, disguised advertising, empty yapping or unsupported claims, name that directly. Swearing is allowed when it sounds natural — never force it.
- Do not force a negative verdict. Give genuinely useful videos fair credit.
- Never invent information. Judge only from the transcript.
- You have not seen the video itself. Never claim to have seen visuals, demonstrations or on-screen information.
- If the transcript itself is unclear, say that instead of pretending certainty.
- Never mention being an AI.

Verdicts:
- WATCH: the video has enough useful information, explanation or demonstration that watching a meaningful portion of it is worthwhile.
- SKIM: the video has some useful material, but watching the entire thing is unnecessary.
- SKIP: the summary already contains essentially everything useful, or the video is mostly repetition, padding, clickbait, empty discussion or advertising.`;

/** JSON schema for Gemini's structured output, generated from summarySchema. */
function buildResponseJsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(summarySchema);
  return jsonSchema;
}

/** The exact request this provider sends (all snake_case, per SDK types). */
export interface GeminiCreateParams {
  model: string;
  input: string;
  stream?: false;
  store: boolean;
  system_instruction: string;
  generation_config: { thinking_level: 'minimal'; temperature: number };
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

/** Injectable for tests; the real one calls ai.interactions.create. */
export type GeminiCreateFn = (
  params: GeminiCreateParams,
  options: GeminiCreateOptions,
) => Promise<{ output_text?: string | undefined }>;

function realCreateFn(apiKey: string): GeminiCreateFn {
  let client: GoogleGenAI | undefined;
  return (params, options) => {
    client ??= new GoogleGenAI({ apiKey });
    return client.interactions.create(params, options);
  };
}

/** Temporary trouble (timeout, rate limit, server error) — worth one retry. */
function isTransient(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 408 || error.status === 429 || error.status >= 500)
  );
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

  async summarize(transcriptText: string, ctx: RunContext): Promise<Summary> {
    const params: GeminiCreateParams = {
      model: this.model,
      input: `Transcript:\n\n${transcriptText}`,
      stream: false,
      store: false,
      system_instruction: SYSTEM_INSTRUCTION,
      generation_config: { thinking_level: 'minimal', temperature: 0.2 },
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: buildResponseJsonSchema(),
      },
    };
    // SDK-internal retries are disabled (maxRetries: 0) so OUR one-retry
    // rule below stays the only retry policy and gets reported honestly.
    const options: GeminiCreateOptions = {
      fetchOptions: { signal: ctx.signal },
      maxRetries: 0,
    };

    let interaction: { output_text?: string | undefined };
    try {
      interaction = await this.create(params, options);
    } catch (error) {
      if (!isTransient(error) || Date.now() >= ctx.deadlineAt) throw error;
      ctx.retried = true;
      interaction = await this.create(params, options);
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

    const parsed = summarySchema.safeParse(json);
    if (!parsed.success) {
      throw new Error('Gemini returned JSON in an unexpected format.');
    }
    return parsed.data;
  }
}
