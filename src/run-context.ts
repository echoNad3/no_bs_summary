/**
 * One shared "clock" for a single benchmark run (one video + one provider).
 *
 * Everything in the run — transcript download, a possible retry, and later the
 * Gemini request — must finish before the same deadline. The AbortSignal fires
 * when time is up so no request keeps running in the background.
 */
export interface RunContext {
  signal: AbortSignal;
  /** Wall-clock time (Date.now() ms) when the run must be finished. */
  deadlineAt: number;
  /** Set to true by the HTTP helper if a retry happened during this run. */
  retried: boolean;
}

export function createRunContext(timeoutMs: number): {
  ctx: RunContext;
  dispose: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const ctx: RunContext = {
    signal: controller.signal,
    deadlineAt: Date.now() + timeoutMs,
    retried: false,
  };
  return { ctx, dispose: () => clearTimeout(timer) };
}

/** True if the error came from our deadline firing (the run ran out of time). */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
