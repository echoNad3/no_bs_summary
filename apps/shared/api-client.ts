export type Verdict = 'WATCH' | 'SKIM' | 'SKIP';

export interface SummarizeInput {
  url: string;
  title?: string;
  language: string;
}

export interface SummaryResult {
  verdict: Verdict;
  reason: string;
  summary: string;
  videoId: string;
  language: string;
  source: 'LIVE' | 'CACHED';
  timing: {
    transcriptMs?: number;
    summaryMs: number;
    totalMs?: number;
  };
  retries: { transcript: number; summary: number };
}

export interface GenerationUsageStatus {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}

export interface FreeGenerationStatus {
  user: GenerationUsageStatus;
  shared: GenerationUsageStatus;
}

interface BackendStatusBase {
  status: 'ok';
  freeGeneration: FreeGenerationStatus;
}

export type BackendStatus = BackendStatusBase &
  (
    | { access: 'owner'; dailyGeneration: GenerationUsageStatus }
    | { access: 'free'; dailyGeneration: null }
  );

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly code = 'REQUEST_FAILED',
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export interface SummarizeOptions {
  signal?: AbortSignal;
  /** Shared app password for the hosted backend. Sent only when non-empty. */
  password?: string;
  /** Client-side ceiling; keeps a 10-second transport buffer above the backend deadline. */
  timeoutMs?: number;
}

export const DEFAULT_SUMMARY_REQUEST_TIMEOUT_MS = 70_000;

export async function summarizeVideo(
  apiBase: string,
  input: SummarizeInput,
  options: SummarizeOptions = {},
): Promise<SummaryResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.password) headers['x-app-password'] = options.password;

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_SUMMARY_REQUEST_TIMEOUT_MS;
  const timeout = globalThis.setTimeout(() => controller.abort('timeout'), timeoutMs);
  const cancelFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) cancelFromCaller();
  else options.signal?.addEventListener('abort', cancelFromCaller, { once: true });

  try {
    let response: Response;
    try {
      const normalizedBase = apiBase.replace(/\/+$/u, '');
      response = await fetch(`${normalizedBase}/api/summarize`, {
        method: 'POST',
        headers,
        // Titles are presentation-only. Keeping them out of the shared backend
        // prevents the first caller from poisoning a cached summary with a
        // misleading or instruction-like title.
        body: JSON.stringify({ url: input.url, language: input.language }),
        signal: controller.signal,
      });
    } catch {
      if (options.signal?.aborted) {
        throw new ApiClientError('Request cancelled.', 'REQUEST_CANCELLED');
      }
      if (controller.signal.aborted) {
        throw new ApiClientError('The summary took too long. Try again.', 'REQUEST_TIMEOUT');
      }
      throw new ApiClientError(
        'The summary service is not reachable. Check your connection and try again.',
        'BACKEND_UNREACHABLE',
      );
    }

    let payload: unknown;
    try {
      payload = await readJson(response);
    } catch (error) {
      if (options.signal?.aborted) {
        throw new ApiClientError('Request cancelled.', 'REQUEST_CANCELLED');
      }
      if (controller.signal.aborted) {
        throw new ApiClientError('The summary took too long. Try again.', 'REQUEST_TIMEOUT');
      }
      throw error;
    }
    if (!response.ok) {
      const error = asObject(asObject(payload)?.error);
      throw new ApiClientError(
        typeof error?.message === 'string' ? error.message : `Request failed (${response.status}).`,
        typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED',
        response.status,
        retryAfterSeconds(response),
      );
    }
    if (!isSummaryResult(payload)) {
      throw new ApiClientError('The backend returned an invalid response.', 'INVALID_RESPONSE');
    }
    return payload;
  } finally {
    globalThis.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancelFromCaller);
  }
}

export async function checkBackend(
  apiBase: string,
  options: Pick<SummarizeOptions, 'password' | 'timeoutMs'> = {},
): Promise<BackendStatus> {
  const headers: Record<string, string> = {};
  if (options.password) headers['x-app-password'] = options.password;
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort('timeout'),
    options.timeoutMs ?? DEFAULT_SUMMARY_REQUEST_TIMEOUT_MS,
  );

  try {
    let response: Response;
    try {
      const normalizedBase = apiBase.replace(/\/+$/u, '');
      response = await fetch(`${normalizedBase}/api/status`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        throw new ApiClientError('The connection test took too long.', 'REQUEST_TIMEOUT');
      }
      throw new ApiClientError(
        'The summary service is not reachable. Check your connection and try again.',
        'BACKEND_UNREACHABLE',
      );
    }

    let payload: unknown;
    try {
      payload = await readJson(response);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ApiClientError('The connection test took too long.', 'REQUEST_TIMEOUT');
      }
      throw error;
    }
    if (!response.ok) {
      const error = asObject(asObject(payload)?.error);
      throw new ApiClientError(
        typeof error?.message === 'string' ? error.message : `Request failed (${response.status}).`,
        typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED',
        response.status,
        retryAfterSeconds(response),
      );
    }
    if (!isBackendStatus(payload)) {
      throw new ApiClientError('The backend returned an invalid status.', 'INVALID_RESPONSE');
    }
    return payload;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ApiClientError('The backend returned invalid JSON.', 'INVALID_RESPONSE');
  }
}

export function isSummaryResult(value: unknown): value is SummaryResult {
  const candidate = asObject(value);
  const timing = asObject(candidate?.timing);
  const retries = asObject(candidate?.retries);
  return (
    (candidate?.verdict === 'WATCH' ||
      candidate?.verdict === 'SKIM' ||
      candidate?.verdict === 'SKIP') &&
    isNonemptyString(candidate.reason) &&
    isNonemptyString(candidate.summary) &&
    typeof candidate.videoId === 'string' &&
    /^[A-Za-z0-9_-]{11}$/u.test(candidate.videoId) &&
    typeof candidate.language === 'string' &&
    /^(?:asr-)?[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(candidate.language) &&
    (candidate.source === 'LIVE' || candidate.source === 'CACHED') &&
    isNonnegativeInteger(timing?.summaryMs) &&
    isOptionalNonnegativeInteger(timing?.transcriptMs) &&
    isOptionalNonnegativeInteger(timing?.totalMs) &&
    isNonnegativeInteger(retries?.transcript) &&
    isNonnegativeInteger(retries?.summary)
  );
}

function isBackendStatus(value: unknown): value is BackendStatus {
  const candidate = asObject(value);
  const daily = asObject(candidate?.dailyGeneration);
  const free = asObject(candidate?.freeGeneration);
  const freeUser = asObject(free?.user);
  const freeShared = asObject(free?.shared);
  return (
    candidate?.status === 'ok' &&
    (candidate.access === 'owner' || candidate.access === 'free') &&
    (candidate.access === 'owner'
      ? isGenerationStatus(daily)
      : candidate.dailyGeneration === null) &&
    isGenerationStatus(freeUser) &&
    isGenerationStatus(freeShared)
  );
}

function isGenerationStatus(value: Record<string, unknown> | undefined): boolean {
  return (
    isNonnegativeInteger(value?.used) &&
    isPositiveInteger(value?.limit) &&
    isNonnegativeInteger(value?.remaining) &&
    value.remaining === Math.max(0, value.limit - value.used) &&
    typeof value.resetsAt === 'string' &&
    Number.isFinite(Date.parse(value.resetsAt))
  );
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isOptionalNonnegativeInteger(value: unknown): boolean {
  return value === undefined || isNonnegativeInteger(value);
}

function retryAfterSeconds(response: Response): number | undefined {
  const parsed = Number(response.headers.get('retry-after'));
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
