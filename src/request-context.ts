export interface RequestContext {
  signal: AbortSignal;
  deadlineAt: number;
  transcriptRetries: number;
  summaryRetries: number;
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
  return context.signal.aborted || (error instanceof Error && error.name === 'AbortError');
}
