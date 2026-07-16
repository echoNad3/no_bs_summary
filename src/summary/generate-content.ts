import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { GeminiCreateFn, GeminiCreateParams } from './gemini.js';

interface GenerateContentParams {
  model: string;
  contents: string;
  config: {
    abortSignal: AbortSignal;
    systemInstruction: string;
    thinkingConfig: { thinkingBudget: 0 } | { thinkingLevel: ThinkingLevel.MINIMAL };
    responseMimeType: 'application/json';
    responseJsonSchema: Record<string, unknown>;
  };
}

interface GenerateContentResult {
  text?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
}

export type GenerateContentFn = (params: GenerateContentParams) => Promise<GenerateContentResult>;

/**
 * Benchmark-only bridge for models that are unavailable through Interactions.
 * It consumes the production provider's already-built prompt and JSON schema,
 * so both comparison models receive identical content and validation.
 */
export function createGenerateContentAdapter(
  apiKey: string,
  generateContentFn?: GenerateContentFn,
): GeminiCreateFn {
  let client: GoogleGenAI | undefined;
  const generate =
    generateContentFn ??
    ((params: GenerateContentParams) => {
      client ??= new GoogleGenAI({ apiKey });
      return client.models.generateContent(params);
    });

  return async (params, options) => {
    const response = await generate({
      model: params.model,
      contents: params.input,
      config: {
        abortSignal: options.fetchOptions.signal,
        systemInstruction: params.system_instruction,
        thinkingConfig: generateContentThinkingConfig(params),
        responseMimeType: 'application/json',
        responseJsonSchema: params.response_format.schema,
      },
    });
    const usage = response.usageMetadata;
    return {
      output_text: response.text,
      usage: usage
        ? {
            total_input_tokens: usage.promptTokenCount,
            total_output_tokens: usage.candidatesTokenCount,
            total_thought_tokens: usage.thoughtsTokenCount,
            total_tokens: usage.totalTokenCount,
          }
        : undefined,
    };
  };
}

export function generateContentThinkingLabel(model: string): string {
  return model === 'gemini-2.5-flash' ? 'thinkingBudget=0' : 'thinkingLevel=MINIMAL';
}

function generateContentThinkingConfig(
  params: GeminiCreateParams,
): GenerateContentParams['config']['thinkingConfig'] {
  // Gemini 2.5 Flash uses token budgets on generateContent and explicitly
  // supports zero (thinking disabled), its lowest documented setting.
  return params.model === 'gemini-2.5-flash'
    ? { thinkingBudget: 0 }
    : { thinkingLevel: ThinkingLevel.MINIMAL };
}
