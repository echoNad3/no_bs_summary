import { describe, expect, it, vi } from 'vitest';
import {
  createGenerateContentAdapter,
  generateContentThinkingLabel,
} from '../src/summary/generate-content.js';
import type { GeminiCreateParams } from '../src/summary/gemini.js';

const baseParams: GeminiCreateParams = {
  model: 'gemini-3.1-flash-lite',
  input: 'same prompt',
  store: false,
  system_instruction: 'same system instruction',
  generation_config: { thinking_level: 'minimal' },
  response_format: {
    type: 'text',
    mime_type: 'application/json',
    schema: { type: 'object' },
  },
};

describe('generateContent comparison adapter', () => {
  it('maps the production prompt, schema, signal, response, and usage', async () => {
    const generate = vi.fn().mockResolvedValue({
      text: '{"verdict":"WATCH"}',
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 3,
        totalTokenCount: 123,
      },
    });
    const signal = new AbortController().signal;
    const create = createGenerateContentAdapter('test-key', generate);

    await expect(create(baseParams, { fetchOptions: { signal }, maxRetries: 0 })).resolves.toEqual({
      output_text: '{"verdict":"WATCH"}',
      usage: {
        total_input_tokens: 100,
        total_output_tokens: 20,
        total_thought_tokens: 3,
        total_tokens: 123,
      },
    });
    expect(generate).toHaveBeenCalledWith({
      model: 'gemini-3.1-flash-lite',
      contents: 'same prompt',
      config: {
        abortSignal: signal,
        systemInstruction: 'same system instruction',
        thinkingConfig: { thinkingLevel: 'MINIMAL' },
        responseMimeType: 'application/json',
        responseJsonSchema: { type: 'object' },
      },
    });
  });

  it('uses the documented minimum zero-token thinking budget for Gemini 2.5 Flash', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '{}' });
    const create = createGenerateContentAdapter('test-key', generate);
    const signal = new AbortController().signal;

    await create(
      { ...baseParams, model: 'gemini-2.5-flash', generation_config: { thinking_level: 'low' } },
      { fetchOptions: { signal }, maxRetries: 0 },
    );

    expect(generate.mock.calls[0]?.[0].config.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(generateContentThinkingLabel('gemini-2.5-flash')).toBe('thinkingBudget=0');
  });
});
