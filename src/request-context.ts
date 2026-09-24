export interface RequestContext {
  signal: AbortSignal;
  deadlineAt: number;
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
      transcriptRetries: 0,
      summaryRetries: 0,
    },
    dispose: () => clearTimeout(timer),
  };
}

export function requestTimedOut(error: unknown, context: RequestContext): boolean {
  return requestDeadlineReached(context) || (error instanceof Error && error.name === 'AbortError');
}

export function requestDeadlineReached(context: RequestContext): boolean {
  return context.signal.aborted || Date.now() >= context.deadlineAt;
}

/** Settle even if a storage binding or provider ignores its abort signal. */
export function withinDeadline<T>(
  operation: Promise<T>,
  context: RequestContext,
  maxStageMs = Number.POSITIVE_INFINITY,
): Promise<T> {
  const remaining = Math.min(context.deadlineAt - Date.now(), maxStageMs);
  if (context.signal.aborted || remaining <= 0) {
    return Promise.reject(new DOMException('The request deadline was reached.', 'AbortError'));
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
    const onAbort = () =>
      finish(() => reject(new DOMException('The request deadline was reached.', 'AbortError')));
    const timer = setTimeout(onAbort, remaining);
    context.signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
