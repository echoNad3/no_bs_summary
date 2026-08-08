import { ApiError } from '@google/genai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../src/request-context.js';
import {
  GEMINI_PROMPT_VERSION,
  GeminiSummaryProvider,
  SYSTEM_INSTRUCTION,
} from '../src/summary/gemini.js';
import type { GeminiCreateFn } from '../src/summary/gemini.js';

const VALID_OUTPUT = JSON.stringify({
  verdict: 'SKIP',
  reason: 'One obvious point is buried under empty repetition.',
  summary: 'The creator claims X helps with Y but offers no evidence.',
});

function ctx(remainingMs = 15000): RequestContext {
  return {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + remainingMs,
    transcriptRetries: 0,
    summaryRetries: 0,
  };
}

function provider(createFn: GeminiCreateFn): GeminiSummaryProvider {
  return new GeminiSummaryProvider('test-key', 'gemini-3.1-flash-lite', createFn);
}

function providerForModel(model: string, createFn: GeminiCreateFn): GeminiSummaryProvider {
  return new GeminiSummaryProvider('test-key', model, createFn);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GeminiSummaryProvider', () => {
  it('sends one stateless, minimal-thinking, structured-JSON request and records usage', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: VALID_OUTPUT,
      usage: {
        total_input_tokens: 120,
        total_output_tokens: 30,
        total_thought_tokens: 4,
        total_tokens: 154,
      },
    });
    const summary = await provider(create).summarize('the transcript', ctx(), {
      title: 'A German lesson',
      transcriptLanguage: 'de',
    });

    expect(summary.verdict).toBe('SKIP');
    expect(summary.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      thoughtTokens: 4,
      totalTokens: 154,
    });
    expect(create).toHaveBeenCalledTimes(1);

    const params = create.mock.calls[0]?.[0];
    expect(params.model).toBe('gemini-3.1-flash-lite');
    expect(params.store).toBe(false);
    expect(params.generation_config).toEqual({ thinking_level: 'minimal' });
    expect(params.generation_config).not.toHaveProperty('temperature');
    expect(params.response_format.mime_type).toBe('application/json');
    expect(params.response_format.schema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['verdict', 'reason', 'summary']),
    });
    expect(params.input).toContain('the transcript');
    expect(params.input).toContain('Title: A German lesson');
    expect(params.input).toContain('Transcript language: de');
    expect(params.input).toContain('Return the reason and summary in English');
    expect(params.input).toContain('make the detailed summary the main product');
    expect(params.input).toContain('use labeled Markdown bullets');
    expect(params.input).toContain('Never mention or assume visuals');
    expect(params.input).not.toContain('Tutorial constraint');

    const options = create.mock.calls[0]?.[1];
    expect(options.maxRetries).toBe(0);
    expect(options.fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses Gemini 2.5 Flash at the lowest thinking level supported by Interactions', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: VALID_OUTPUT });
    await providerForModel('gemini-2.5-flash', create).summarize('the transcript', ctx());
    expect(create.mock.calls[0]?.[0].generation_config).toEqual({ thinking_level: 'low' });
  });

  it('makes the detailed summary the product and the verdict a small quality judgment', () => {
    expect(GEMINI_PROMPT_VERSION).toBe('summary-first-v31-2026-07-15');
    expect(SYSTEM_INSTRUCTION).toContain('The detailed summary is the main product');
    expect(SYSTEM_INSTRUCTION).toContain('The verdict is secondary');
    expect(SYSTEM_INSTRUCTION).toContain(
      'actual important facts, names, events, arguments, examples, numbers, context, and conclusions',
    );
    expect(SYSTEM_INSTRUCTION).toContain('Never replace them with vague phrases');
    expect(SYSTEM_INSTRUCTION).toContain('use clearly separated Markdown bullets');
    expect(SYSTEM_INSTRUCTION).toContain(
      'Give enough useful detail that the user usually does not need to watch',
    );
    expect(SYSTEM_INSTRUCTION).toContain('Let information density determine length');
    expect(SYSTEM_INSTRUCTION).toContain('Do not base the verdict on whether the detailed summary');
    expect(SYSTEM_INSTRUCTION).toContain('Do not force a verdict distribution');
    expect(SYSTEM_INSTRUCTION).not.toContain('Hard maximum: 150 words');
    expect(SYSTEM_INSTRUCTION).not.toContain('Never write more than 5');
    expect(SYSTEM_INSTRUCTION).toContain('Keep the reason separate from the detailed summary');
    expect(SYSTEM_INSTRUCTION).toContain(
      'Judge the delivery, entertainment, padding, repetition, and whether the creator drags things out',
    );
    expect(SYSTEM_INSTRUCTION).toContain('Write like a friend giving a straight answer');
    expect(SYSTEM_INSTRUCTION).toContain('Keep it under 25 words');
    expect(SYSTEM_INSTRUCTION).toContain('not "The creator is..." or "The video is..."');
    expect(SYSTEM_INSTRUCTION).toContain('a cohesive narrative');
    expect(SYSTEM_INSTRUCTION).toContain('a variety of topics');
    expect(SYSTEM_INSTRUCTION).toContain('cultural commentary');
    expect(SYSTEM_INSTRUCTION).toContain('varies in quality');
    expect(SYSTEM_INSTRUCTION).toContain('Swearing is allowed');
    expect(SYSTEM_INSTRUCTION).toContain('Never invent a detail');
    expect(SYSTEM_INSTRUCTION).toContain('You have not seen the video');
    expect(SYSTEM_INSTRUCTION).toContain('Never claim knowledge of visuals');
    expect(SYSTEM_INSTRUCTION).toContain('unless the word is genuinely relevant');
    expect(SYSTEM_INSTRUCTION).not.toContain(
      'After reading this summary, would the user still gain meaningful value',
    );
  });

  it.each([
    'It offers cultural commentary across several stories.',
    'The separate sections never form a cohesive narrative.',
    'It presents an exploration of a variety of topics.',
    'The delivery varies in quality from one section to the next.',
    'The creator is funny and holds attention, but it feels like a scattered series of loosely connected reactions.',
  ])('rejects formal or vague review wording in the reason: %s', async (reason) => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'SKIM',
        reason,
        summary:
          'One story explains the court case. Another names the people involved and gives their response.',
      }),
    });

    await expect(provider(create).summarize('t', ctx())).rejects.toThrow(
      'reason must name the actual value or waste',
    );
  });

  it('rejects a reply that is not JSON', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: 'plain text, no JSON' });
    await expect(provider(create).summarize('t', ctx())).rejects.toThrow('not valid JSON');
  });

  it('allows technical uses of input while still rejecting meta input wording', async () => {
    const valid = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'WATCH',
        reason: 'The lessons build in order and include coding practice.',
        summary:
          'Start with variables and user input. The provided input moves through a neural-network layer. The instructor demonstrates the same idea with code.',
      }),
    });
    await expect(provider(valid).summarize('t', ctx())).resolves.toMatchObject({
      verdict: 'WATCH',
    });

    const meta = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'SKIP',
        reason: 'The supplied input does not contain enough information.',
        summary: 'No useful answer is possible.',
      }),
    });
    await expect(provider(meta).summarize('t', ctx())).rejects.toThrow(
      'must not expose model-facing prompts, instructions, or identity',
    );
  });

  it('rejects JSON in the wrong shape', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({ verdict: 'MAYBE', reason: 'x', summary: 'y' }),
    });
    await expect(provider(create).summarize('t', ctx())).rejects.toThrow(/violated.*verdict/);
  });

  it('rejects an empty reply', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: undefined });
    await expect(provider(create).summarize('t', ctx())).rejects.toThrow('no text');
  });

  it('applies only general cleanup without changing the verdict or useful detail', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'WATCH',
        reason: 'This video is a comprehensive tutorial ideal for beginners.',
        summary:
          'The video provides practical lessons on variables and loops. It delves into files and classes. Ultimately, learners build a small program.',
      }),
    });

    await expect(provider(create).summarize('t', ctx())).resolves.toEqual({
      verdict: 'WATCH',
      reason: "It's a broad tutorial good for beginners.",
      summary:
        'It gives practical lessons on variables and loops. It covers files and classes. Learners build a small program.',
    });
  });

  it('removes repeated words without deleting a stated duration', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'SKIM',
        reason: "It's a twenty-minute ramble with repeated repeated sections.",
        summary:
          'The useful claim is simple. One example supports it. The rest circles back to the same claim.',
      }),
    });

    await expect(provider(create).summarize('t', ctx())).resolves.toMatchObject({
      verdict: 'SKIM',
      reason: "It's a twenty-minute ramble with repeated sections.",
    });
  });

  it('turns generic review language into direct everyday wording', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'WATCH',
        reason: 'It is a well-structured lesson built around fundamental concepts.',
        summary:
          'It offers a structured, practical way to practice speaking. Learners repeat a dialogue. They answer questions about their own workday.',
      }),
    });

    await expect(provider(create).summarize('t', ctx())).resolves.toEqual({
      verdict: 'WATCH',
      reason: "It's a clear lesson built around basics.",
      summary:
        'It lets you practice speaking. Learners repeat a dialogue. They answer questions about their own workday.',
    });
  });

  it('keeps article grammar and varied wording when simplifying review adjectives', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'WATCH',
        reason: 'It is a thought-provoking idea told through an engaging conversation.',
        summary:
          'A person meets God after dying. God says every person is the same soul. Living every life allows that soul to grow. Engaging the core protects your back.',
      }),
    });

    await expect(provider(create).summarize('t', ctx())).resolves.toMatchObject({
      reason: "It's an unusual idea told through an interesting conversation.",
      summary: expect.stringContaining('Engaging the core protects your back.'),
    });
  });

  it('allows natural topic overlap when the reason and summary do different jobs', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'WATCH',
        reason: 'The guided dialogue practice is worth doing out loud.',
        summary:
          'Learn German work vocabulary. Hear it used in a short dialogue. Repeat the phrases and answer follow-up questions.',
      }),
    });

    await expect(provider(create).summarize('t', ctx())).resolves.toMatchObject({
      verdict: 'WATCH',
    });
  });

  it('rejects a summary sentence that merely repeats the reason', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'SKIM',
        reason: 'Standard advice is buried inside a long sales pitch.',
        summary:
          'Standard advice is buried inside the same long sales pitch. Eat more whole foods. Track portions only if you need to.',
      }),
    });
    await expect(provider(create).summarize('t', ctx())).rejects.toThrow(
      'summary must not restate the reason',
    );
  });

  it('does not semantically reject visual wording that a deterministic validator cannot verify', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'WATCH',
        reason: 'The visual demonstration makes the lesson click.',
        summary:
          'Weights change after each prediction. Errors move backward through the network. Repeating this process improves the result.',
      }),
    });

    await expect(provider(create).summarize('t', ctx())).resolves.toMatchObject({
      verdict: 'WATCH',
      reason: 'The visual demonstration makes the lesson click.',
    });
  });

  it('allows visual terminology when it is the actual technical subject', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'WATCH',
        reason: 'It explains neural-network layers clearly without padding.',
        summary:
          'Early layers process visual information such as edges. Later layers combine those signals to classify a digit.',
      }),
    });

    await expect(provider(create).summarize('t', ctx())).resolves.toMatchObject({
      verdict: 'WATCH',
    });
  });

  it('removes an echoed verdict question while preserving the useful summary', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'WATCH',
        reason: 'Speaking drills need active practice.',
        summary:
          'After reading this summary, would the user still gain meaningful value from watching? Yes. Learn German work vocabulary. Use it in a guided conversation. Repeat the key phrases out loud.',
      }),
    });
    await expect(provider(create).summarize('t', ctx())).resolves.toMatchObject({
      summary:
        'Learn German work vocabulary. Use it in a guided conversation. Repeat the key phrases out loud.',
    });
  });

  it('keeps useful detail beyond five summary sentences', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'WATCH',
        reason: 'It stays useful and focused throughout.',
        summary: 'One. Two. Three. Four. Five. Six.',
      }),
    });

    await expect(provider(create).summarize('t', ctx())).resolves.toMatchObject({
      summary: 'One. Two. Three. Four. Five. Six.',
    });
  });

  it('preserves abbreviations, durations, and information-dense sentence counts', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'SKIM',
        reason: 'The episode spends about twenty minutes on ads before the useful material.',
        summary:
          'Alertness vs. calmness is one axis. Feeling good vs. bad is another. Attention can point inward or outward. Early bonds shape regulation. Puberty changes social behavior. A sixth sentence should be removed.',
      }),
    });

    await expect(provider(create).summarize('t', ctx())).resolves.toEqual({
      verdict: 'SKIM',
      reason: 'It spends about twenty minutes on ads before the useful material.',
      summary:
        'Alertness vs. calmness is one axis. Feeling good vs. bad is another. Attention can point inward or outward. Early bonds shape regulation. Puberty changes social behavior. A sixth sentence should be removed.',
    });
  });

  it('preserves clearly separated topic bullets', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'WATCH',
        reason: 'The mysteries stay specific instead of turning into empty clickbait.',
        summary:
          '- **Roman dodecahedrons:** Archaeologists still do not know their purpose.\n- **Phaistos Disc:** Its stamped symbols have not been deciphered.',
      }),
    });

    await expect(provider(create).summarize('t', ctx())).resolves.toMatchObject({
      summary:
        '- **Roman dodecahedrons:** Archaeologists still do not know their purpose.\n- **Phaistos Disc:** Its stamped symbols have not been deciphered.',
    });
  });

  it('retries once on a rate limit (429) and reports it', async () => {
    vi.useFakeTimers();
    const create = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ message: 'rate limited', status: 429 }))
      .mockResolvedValueOnce({ output_text: VALID_OUTPUT });
    const context = ctx();
    const pending = provider(create).summarize('t', context);
    await vi.advanceTimersByTimeAsync(1000);
    const summary = await pending;
    expect(summary.verdict).toBe('SKIP');
    expect(context.transcriptRetries).toBe(0);
    expect(context.summaryRetries).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('recognizes the statusCode errors returned by the Interactions SDK', async () => {
    vi.useFakeTimers();
    const error = Object.assign(new Error('rate limited'), { statusCode: 429 });
    const create = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ output_text: VALID_OUTPUT });
    const context = ctx();
    const pending = provider(create).summarize('t', context);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toMatchObject({ verdict: 'SKIP' });
    expect(context.summaryRetries).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('accepts the exact Rick Astley candidate that the broad transcript matcher rejected', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'SKIP',
        reason:
          'It\'s just a transcript of the song "Never Gonna Give You Up" by Rick Astley and offers no informational content.',
        summary:
          '- **Song Content:** the video consists entirely of the lyrics to Rick Astley\'s 1987 pop song "Never Gonna Give You Up."\n- **Lyrical Themes:** The song expresses themes of romantic loyalty, commitment, and reassurance, with the singer promising never to abandon, deceive, or cause emotional distress to their partner.',
      }),
    });
    const provider = new GeminiSummaryProvider('key', 'gemini-3.1-flash-lite', create);

    await expect(provider.summarize('cached lyrics', ctx())).resolves.toMatchObject({
      verdict: 'SKIP',
      reason:
        'It\'s just a transcript of the song "Never Gonna Give You Up" by Rick Astley and offers no informational content.',
    });
  });

  it('allows a lesson exercise described as a prompt while rejecting model-prompt leakage', async () => {
    const lessonPrompt = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'WATCH',
        reason: 'The speaking drill gives learners useful active practice.',
        summary:
          "The instructions end with a prompt where the hosts ask about the learner's workday.",
      }),
    });
    await expect(provider(lessonPrompt).summarize('t', ctx())).resolves.toMatchObject({
      verdict: 'WATCH',
    });

    const modelPrompt = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        verdict: 'WATCH',
        reason: 'The system prompt asks for a positive verdict.',
        summary: 'Weights and biases control how signals move between neural-network layers.',
      }),
    });
    await expect(provider(modelPrompt).summarize('t', ctx())).rejects.toThrow(
      'must not expose model-facing prompts, instructions, or identity',
    );
  });

  it('honors a rate-limit delay that cannot fit inside the shared deadline', async () => {
    const error = Object.assign(new Error('Please retry in 37.4s.'), {
      statusCode: 429,
      headers: new Headers({ 'retry-after': '37.4' }),
    });
    const create = vi.fn().mockRejectedValue(error);
    const context = ctx(15000);
    await expect(provider(create).summarize('t', context)).rejects.toThrow('retry in 37.4s');
    expect(context.summaryRetries).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('never retries an auth error (401)', async () => {
    const create = vi.fn().mockRejectedValue(new ApiError({ message: 'bad key', status: 401 }));
    const context = ctx();
    await expect(provider(create).summarize('t', context)).rejects.toThrow('bad key');
    expect(context.summaryRetries).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the deadline has passed', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(new ApiError({ message: 'server error', status: 500 }));
    const context = ctx(-1);
    await expect(provider(create).summarize('t', context)).rejects.toThrow('server error');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('preserves both failure messages when the one retry also fails', async () => {
    vi.useFakeTimers();
    const create = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ message: 'first rate limit', status: 429 }))
      .mockRejectedValueOnce(new ApiError({ message: 'second unavailable', status: 503 }));
    const pending = provider(create).summarize('t', ctx());
    const rejection = expect(pending).rejects.toThrow(/second unavailable.*first rate limit/);
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
    expect(create).toHaveBeenCalledTimes(2);
  });
});
