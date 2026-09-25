export interface RequestContext {
  signal: AbortSignal;
  deadlineAt: number;
  stage?: string;
  stageStartedAt?: number;
  transcriptMs?: number;
  modelAttempts: number;
  transcriptRetries: number;
  summaryRetries: number;
  retryReason?: 'transport' | 'repair';
  providerStatus?: number;
  modelStatus?: string;
  modelTokens?: number;
  summaryCacheReadMs?: number;
  quotaMs?: number;
  summaryCacheWriteStatus?: 'saved' | 'failed' | 'pending';
}

export type RetryStage = 'transcript' | 'summary';

class DeadlineAbortError extends Error {
  constructor(readonly deadlineAt: number) {
    super('The request deadline was reached.');
    this.name = 'AbortError';
  }
}

export function recordRetry(context: RequestContext, stage: RetryStage): void {
  if (stage === 'transcript') context.transcriptRetries += 1;
  else context.summaryRetries += 1;
}

export function createRequestContext(timeoutMs: number): {
  context: RequestContext;
  dispose: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    context: {
      signal: controller.signal,
      deadlineAt: Date.now() + timeoutMs,
      modelAttempts: 0,
      transcriptRetries: 0,
      summaryRetries: 0,
    },
    dispose: () => clearTimeout(timer),
  };
}

export function markStage(context: RequestContext, stage: string): void {
  context.stage = stage;
  context.stageStartedAt = Date.now();
}

export function requestTimedOut(error: unknown, context: RequestContext): boolean {
  return requestDeadlineReached(context) || (error instanceof Error && error.name === 'AbortError');
}

export function requestDeadlineReached(context: RequestContext, error?: unknown): boolean {
  return (
    context.signal.aborted ||
    Date.now() >= context.deadlineAt ||
    (error instanceof DeadlineAbortError && error.deadlineAt === context.deadlineAt)
  );
}

/** Settle even if a storage binding or provider ignores its abort signal. */
export function withinDeadline<T>(
  operation: Promise<T>,
  context: RequestContext,
  maxStageMs = Number.POSITIVE_INFINITY,
): Promise<T> {
  const now = Date.now();
  const effectiveDeadlineAt = Math.min(context.deadlineAt, now + maxStageMs);
  const remaining = effectiveDeadlineAt - now;
  if (context.signal.aborted || remaining <= 0) {
    return Promise.reject(new DeadlineAbortError(effectiveDeadlineAt));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      context.signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(new DeadlineAbortError(effectiveDeadlineAt)));
    const timer = setTimeout(onAbort, remaining);
    context.signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
