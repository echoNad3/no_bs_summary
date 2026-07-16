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

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly code = 'REQUEST_FAILED',
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export async function summarizeVideo(
  apiBase: string,
  input: SummarizeInput,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/summarize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    });
  } catch {
    throw new ApiClientError(
      'The local backend is not reachable. Start it with npm start and try again.',
      'BACKEND_UNREACHABLE',
    );
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const error = asObject(asObject(payload)?.error);
    throw new ApiClientError(
      typeof error?.message === 'string' ? error.message : `Request failed (${response.status}).`,
      typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED',
    );
  }
  if (!isSummaryResult(payload)) {
    throw new ApiClientError('The backend returned an invalid response.', 'INVALID_RESPONSE');
  }
  return payload;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ApiClientError('The backend returned invalid JSON.', 'INVALID_RESPONSE');
  }
}

function isSummaryResult(value: unknown): value is SummaryResult {
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

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
