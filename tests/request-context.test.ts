import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestDeadlineReached, withinDeadline } from '../src/request-context.js';
import type { RequestContext } from '../src/request-context.js';

afterEach(() => vi.useRealTimers());

function context(deadlineAt: number): RequestContext {
  return {
    signal: new AbortController().signal,
    deadlineAt,
    modelAttempts: 0,
    transcriptRetries: 0,
    summaryRetries: 0,
  };
}

describe('bounded request waits', () => {
  it('identifies the global deadline even when the clock reports one millisecond early', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const request = context(1_030);
    const pending = withinDeadline(new Promise<never>(() => undefined), request);
    const outcome = pending.catch((cause: unknown) => cause);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_029);

    await vi.advanceTimersByTimeAsync(30);
    const error: unknown = await outcome;
    expect(requestDeadlineReached(request, error)).toBe(true);
    clock.mockRestore();
  });

  it('keeps an earlier stage timeout distinct from the global deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const request = context(1_060);
    const pending = withinDeadline(new Promise<never>(() => undefined), request, 20);
    const outcome = pending.catch((cause: unknown) => cause);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_019);

    await vi.advanceTimersByTimeAsync(20);
    const error: unknown = await outcome;
    expect(requestDeadlineReached(request, error)).toBe(false);
    clock.mockRestore();
  });
});
