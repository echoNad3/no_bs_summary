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

export interface DailyGenerationStatus {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}

export interface BackendStatus {
  status: 'ok';
  cache: 'cloud' | 'local';
  dailyGeneration: DailyGenerationStatus | null;
  transcriptApiCredits: {
    availableViaApi: false;
    dashboardUrl: string;
  };
}

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
  /** Client-side ceiling; intentionally longer than the backend's 15 second deadline. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export async function summarizeVideo(
  apiBase: string,
  input: SummarizeInput,
  options: SummarizeOptions = {},
): Promise<SummaryResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.password) headers['x-app-password'] = options.password;

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
        body: JSON.stringify(input),
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
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
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
    typeof candidate.reason === 'string' &&
    typeof candidate.summary === 'string' &&
    typeof candidate.videoId === 'string' &&
    typeof candidate.language === 'string' &&
    (candidate.source === 'LIVE' || candidate.source === 'CACHED') &&
    typeof timing?.summaryMs === 'number' &&
    typeof retries?.transcript === 'number' &&
    typeof retries.summary === 'number'
  );
}

function isBackendStatus(value: unknown): value is BackendStatus {
  const candidate = asObject(value);
  const daily = asObject(candidate?.dailyGeneration);
  const credits = asObject(candidate?.transcriptApiCredits);
  const validDaily =
    candidate?.dailyGeneration === null ||
    (typeof daily?.used === 'number' &&
      typeof daily.limit === 'number' &&
      typeof daily.remaining === 'number' &&
      typeof daily.resetsAt === 'string');
  return (
    candidate?.status === 'ok' &&
    (candidate.cache === 'cloud' || candidate.cache === 'local') &&
    validDaily &&
    credits?.availableViaApi === false &&
    typeof credits.dashboardUrl === 'string'
  );
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
