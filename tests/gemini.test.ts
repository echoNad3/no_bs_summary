import { ApiError } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';
import type { RunContext } from '../src/run-context.js';
import { GeminiSummaryProvider } from '../src/summary/gemini.js';
import type { GeminiCreateFn } from '../src/summary/gemini.js';

const VALID_OUTPUT = JSON.stringify({
  verdict: 'SKIP',
  reason: 'One obvious point stretched to fifteen minutes.',
  summary: 'The creator claims X helps with Y but offers no evidence.',
});

function ctx(remainingMs = 30000): RunContext {
  return {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + remainingMs,
    retried: false,
  };
}

function provider(createFn: GeminiCreateFn): GeminiSummaryProvider {
  return new GeminiSummaryProvider('test-key', 'gemini-3.1-flash-lite', createFn);
}

describe('GeminiSummaryProvider', () => {
  it('sends one stateless, minimal-thinking, structured-JSON request', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: VALID_OUTPUT });
    const summary = await provider(create).summarize('the transcript', ctx());

    expect(summary.verdict).toBe('SKIP');
    expect(create).toHaveBeenCalledTimes(1);

    const params = create.mock.calls[0]?.[0];
    expect(params.model).toBe('gemini-3.1-flash-lite');
    expect(params.store).toBe(false);
    expect(params.generation_config.thinking_level).toBe('minimal');
    expect(params.generation_config.temperature).toBeLessThanOrEqual(0.3);
    expect(params.response_format.mime_type).toBe('application/json');
    expect(params.response_format.schema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['verdict', 'reason', 'summary']),
    });
    expect(params.input).toContain('the transcript');

    const options = create.mock.calls[0]?.[1];
    expect(options.maxRetries).toBe(0); // our own one-retry rule is the only retry policy
    expect(options.fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects a reply that is not JSON', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: 'plain text, no JSON' });
    await expect(provider(create).summarize('t', ctx())).rejects.toThrow('not valid JSON');
  });

  it('rejects JSON in the wrong shape', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({ verdict: 'MAYBE', reason: 'x', summary: 'y' }),
    });
    await expect(provider(create).summarize('t', ctx())).rejects.toThrow('unexpected format');
  });

  it('rejects an empty reply', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: undefined });
    await expect(provider(create).summarize('t', ctx())).rejects.toThrow('no text');
  });

  it('retries once on a rate limit (429) and reports it', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ message: 'rate limited', status: 429 }))
      .mockResolvedValueOnce({ output_text: VALID_OUTPUT });
    const context = ctx();
    const summary = await provider(create).summarize('t', context);
    expect(summary.verdict).toBe('SKIP');
    expect(context.retried).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('never retries an auth error (401)', async () => {
    const create = vi.fn().mockRejectedValue(new ApiError({ message: 'bad key', status: 401 }));
    const context = ctx();
    await expect(provider(create).summarize('t', context)).rejects.toThrow('bad key');
    expect(context.retried).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the deadline has passed', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(new ApiError({ message: 'server error', status: 500 }));
    const context = ctx(-1); // deadline already over
    await expect(provider(create).summarize('t', context)).rejects.toThrow('server error');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
