import type { RunContext } from './run-context.js';

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
  retried: boolean;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

/** Parse Retry-After (seconds or HTTP date) into milliseconds to wait. */
function retryAfterMs(response: Response): number {
  const header = response.headers.get('retry-after');
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return 0;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
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
  ctx: RunContext,
): Promise<FetchOutcome> {
  let firstError: unknown;
  let firstResponse: Response | undefined;

  try {
    firstResponse = await fetch(url, { ...init, signal: ctx.signal });
    if (!isRetryableStatus(firstResponse.status)) {
      return { response: firstResponse, retried: false };
    }
  } catch (error) {
    if (!isNetworkError(error)) throw error; // includes AbortError (deadline hit)
    firstError = error;
  }

  // Decide whether a single retry still fits inside the deadline.
  const waitMs = firstResponse ? retryAfterMs(firstResponse) : 0;
  if (Date.now() + waitMs >= ctx.deadlineAt) {
    if (firstResponse) return { response: firstResponse, retried: false };
    throw firstError;
  }

  await sleep(waitMs, ctx.signal);
  ctx.retried = true;

  try {
    const secondResponse = await fetch(url, { ...init, signal: ctx.signal });
    return { response: secondResponse, retried: true };
  } catch (secondError) {
    if (firstError instanceof Error && secondError instanceof Error) {
      secondError.message = `${secondError.message} (first attempt also failed: ${firstError.message})`;
    }
    throw secondError;
  }
}
