import { recordRetry } from './request-context.js';
import type { RequestContext } from './request-context.js';

/**
 * fetch() with at most ONE retry, and only for problems that are usually
 * temporary: network hiccups, HTTP 408 (timeout), 429 (slow down) and
 * 5xx (server trouble). Everything else — wrong key, no credits, bad
 * request, "no transcript" — is never retried.
 *
 * The retry must fit inside the run's deadline. If the server sends a
 * Retry-After header ("wait N seconds"), we only wait when that still fits;
 * otherwise the original failed response is returned as-is.
 */

export interface FetchOutcome {
  response: Response;
  /** Safe diagnostic detail from the first failed attempt. Never contains request headers. */
  firstFailure?: string;
}

export interface RetryPolicy {
  isRetryableStatus(status: number): boolean;
  /** Used when the provider does not send Retry-After. */
  defaultDelayMs: number;
}

/** Parse Retry-After (seconds or HTTP date) into milliseconds to wait. */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export function sleepWithinDeadline(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('The run deadline was reached.', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isNetworkError(error: unknown): boolean {
  // fetch throws TypeError for network-level failures (DNS, connection reset…).
  return error instanceof TypeError;
}

export async function fetchWithOneRetry(
  url: string,
  init: RequestInit,
  ctx: RequestContext,
  policy: RetryPolicy,
): Promise<FetchOutcome> {
  let firstError: unknown;
  let firstResponse: Response | undefined;
  let firstFailure: string | undefined;

  try {
    firstResponse = await fetch(url, { ...init, signal: ctx.signal });
    if (!policy.isRetryableStatus(firstResponse.status)) {
      return { response: firstResponse };
    }
    firstFailure = `HTTP ${firstResponse.status}`;
  } catch (error) {
    if (!isNetworkError(error)) throw error; // includes AbortError (deadline hit)
    firstError = error;
    firstFailure = error instanceof Error ? error.message : String(error);
  }

  // Decide whether a single retry still fits inside the deadline.
  const waitMs = firstResponse
    ? (retryAfterMs(firstResponse) ?? policy.defaultDelayMs)
    : policy.defaultDelayMs;
  if (ctx.signal.aborted || Date.now() + waitMs >= ctx.deadlineAt) {
    if (firstResponse) return { response: firstResponse };
    throw firstError;
  }

  await sleepWithinDeadline(waitMs, ctx.signal);
  recordRetry(ctx, 'transcript');

  try {
    const secondResponse = await fetch(url, { ...init, signal: ctx.signal });
    return { response: secondResponse, firstFailure };
  } catch (secondError) {
    const secondMessage = secondError instanceof Error ? secondError.message : String(secondError);
    const combined = new Error(
      `${secondMessage} (first attempt also failed: ${firstFailure ?? 'unknown failure'})`,
      { cause: secondError },
    );
    if (secondError instanceof Error) combined.name = secondError.name;
    throw combined;
  }
}
