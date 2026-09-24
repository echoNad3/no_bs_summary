import type { TranscriptStore } from '../transcript/store.js';
import { PipelineError, runSummaryPipeline } from '../pipeline.js';
import {
  createRequestContext,
  requestDeadlineReached,
  requestTimedOut,
  withinDeadline,
} from '../request-context.js';
import type { RequestContext } from '../request-context.js';
import type { SummaryProvider } from '../summary/provider.js';
import type { TranscriptProvider } from '../transcript/provider.js';
import { extractVideoId } from '../youtube.js';
import {
  summarizeRequestSchema,
  summarizeResponseSchema,
  type SummarizeRequest,
  type SummarizeResponse,
} from './schema.js';
import { summaryCacheKey, type SummaryCache, type SummaryCacheIdentity } from './summary-store.js';

export interface SummaryServiceOptions {
  transcriptProvider: TranscriptProvider;
  summaryProvider: SummaryProvider;
  cache: TranscriptStore;
  summaryCache: SummaryCache;
  summaryModel: string;
  summaryPromptVersion: string;
  timeoutMs: number;
}

export interface SummaryRequestOptions {
  /** Runs after a persistent cache miss, before any paid work. */
  beforeGenerate?: () => Promise<void>;
  waitUntil?: (operation: Promise<unknown>) => void;
  onDiagnostic?: (details: {
    summaryCacheHit: boolean;
    joinedInFlight?: boolean;
    transcriptCacheHit?: boolean;
    summaryCacheReadMs?: number;
    quotaMs?: number;
    summaryCacheWriteStatus?: RequestContext['summaryCacheWriteStatus'];
    timing?: SummarizeResponse['timing'];
    retries?: SummarizeResponse['retries'];
    retryReason?: RequestContext['retryReason'];
    providerStatus?: number;
    modelStatus?: string;
    modelTokens?: number;
  }) => void;
}

export class ProductError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
    readonly diagnostics?: { stage?: string; providerStatus?: number; retryReason?: string },
  ) {
    super(message);
    this.name = 'ProductError';
  }
}

export class SummaryService {
  private readonly inFlight = new Map<string, Promise<SummarizeResponse>>();

  constructor(private readonly options: SummaryServiceOptions) {}

  async summarize(
    rawInput: unknown,
    requestOptions: SummaryRequestOptions = {},
  ): Promise<SummarizeResponse> {
    const parsed = summarizeRequestSchema.safeParse(rawInput);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ProductError(400, 'INVALID_REQUEST', issue?.message ?? 'Invalid request.');
    }

    let videoId: string;
    try {
      videoId = extractVideoId(parsed.data.url);
    } catch (error) {
      throw new ProductError(
        400,
        'INVALID_YOUTUBE_URL',
        error instanceof Error ? error.message : 'Invalid YouTube URL.',
      );
    }

    const identity: SummaryCacheIdentity = {
      videoId,
      language: parsed.data.language,
      model: this.options.summaryModel,
      promptVersion: this.options.summaryPromptVersion,
    };
    const key = summaryCacheKey(identity);
    const { context, dispose } = createRequestContext(this.options.timeoutMs);
    try {
      if (!parsed.data.regenerate) {
        const cached = await this.readSavedSummary(identity, context);
        if (cached) {
          requestOptions.onDiagnostic?.({
            summaryCacheHit: true,
            summaryCacheReadMs: context.summaryCacheReadMs,
          });
          return cached;
        }
      }

      const inFlight = this.inFlight.get(key);
      if (inFlight) {
        try {
          const joined = await withinDeadline(inFlight, context);
          requestOptions.onDiagnostic?.({
            summaryCacheHit: false,
            joinedInFlight: true,
            summaryCacheReadMs: context.summaryCacheReadMs,
          });
          return joined;
        } catch (error) {
          if (requestTimedOut(error, context)) throw deadlineProductError();
          throw error;
        }
      }

      const pending = this.generateAndSave(parsed.data, videoId, identity, requestOptions, context);
      this.inFlight.set(key, pending);
      try {
        const result = await pending;
        requestOptions.onDiagnostic?.({
          summaryCacheHit: false,
          transcriptCacheHit: result.source === 'CACHED',
          summaryCacheReadMs: context.summaryCacheReadMs,
          quotaMs: context.quotaMs,
          summaryCacheWriteStatus: context.summaryCacheWriteStatus,
          timing: result.timing,
          retries: result.retries,
          retryReason: context.retryReason,
          providerStatus: context.providerStatus,
          modelStatus: context.modelStatus,
          modelTokens: context.modelTokens,
        });
        return result;
      } finally {
        if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
      }
    } finally {
      dispose();
    }
  }

  private async readSavedSummary(
    identity: SummaryCacheIdentity,
    context: RequestContext,
  ): Promise<SummarizeResponse | undefined> {
    const startedAt = Date.now();
    try {
      return await withinDeadline(this.options.summaryCache.read(identity), context, 2_000);
    } catch (error) {
      if (requestTimedOut(error, context)) {
        if (requestDeadlineReached(context)) throw deadlineProductError();
        throw new ProductError(
          503,
          'SUMMARY_CACHE_FAILED',
          'Saved summaries are temporarily unavailable. Try again.',
        );
      }
      throw new ProductError(503, 'SUMMARY_CACHE_FAILED', 'Could not read the saved summary.');
    } finally {
      context.summaryCacheReadMs = Math.max(0, Date.now() - startedAt);
    }
  }

  private async generateAndSave(
    input: SummarizeRequest,
    videoId: string,
    identity: SummaryCacheIdentity,
    requestOptions: SummaryRequestOptions,
    context: RequestContext,
  ): Promise<SummarizeResponse> {
    if (requestOptions.beforeGenerate) {
      const startedAt = Date.now();
      try {
        await withinDeadline(requestOptions.beforeGenerate(), context, 5_000);
      } catch (error) {
        if (requestTimedOut(error, context)) {
          if (requestDeadlineReached(context)) throw deadlineProductError();
          throw new ProductError(
            503,
            'QUOTA_UNAVAILABLE',
            'Generation limits are temporarily unavailable. Try again shortly.',
          );
        }
        throw error;
      } finally {
        context.quotaMs = Math.max(0, Date.now() - startedAt);
      }
    }

    let generated: SummarizeResponse;
    try {
      generated = await runSummaryPipeline(
        {
          videoId,
          language: input.language,
        },
        {
          transcriptProvider: this.options.transcriptProvider,
          summaryProvider: this.options.summaryProvider,
          transcriptCache: this.options.cache,
          timeoutMs: this.options.timeoutMs,
          context,
        },
      );
    } catch (error) {
      if (error instanceof PipelineError) {
        throw productErrorFromPipeline(error, context);
      }
      throw error;
    }

    const response = summarizeResponseSchema.parse(generated);

    const write = this.options.summaryCache.write(identity, response);
    try {
      await withinDeadline(write, context, 800);
      context.summaryCacheWriteStatus = 'saved';
    } catch (error) {
      // Paid work already succeeded. Returning the result is more useful than
      // making the user pay again because an optional cache write failed.
      console.warn(
        JSON.stringify({
          event: 'summary_cache_write_failed',
          videoId,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      context.summaryCacheWriteStatus = requestTimedOut(error, context) ? 'pending' : 'failed';
      if (requestTimedOut(error, context)) requestOptions.waitUntil?.(write.catch(() => undefined));
    }
    return response;
  }
}

function deadlineProductError(): ProductError {
  return new ProductError(
    504,
    'DEADLINE_EXCEEDED',
    'This video took too long to process. Try again.',
  );
}

function productErrorFromPipeline(error: PipelineError, context: RequestContext): ProductError {
  const diagnostics = {
    stage: error.stage,
    providerStatus: context.providerStatus ?? statusFromCause(error.cause),
    retryReason: context.retryReason,
  };
  if (error.stage === 'deadline') {
    return new ProductError(
      504,
      'DEADLINE_EXCEEDED',
      'This video took too long to process. Try again.',
      undefined,
      diagnostics,
    );
  }
  if (error.stage === 'summary-timeout') {
    return new ProductError(
      504,
      'SUMMARY_TIMEOUT',
      'The summary service took too long. Try again.',
      undefined,
      diagnostics,
    );
  }
  if (error.stage === 'transcript-timeout') {
    return new ProductError(
      504,
      'TRANSCRIPT_TIMEOUT',
      'Captions took too long to load. Try again.',
      undefined,
      diagnostics,
    );
  }
  if (error.stage === 'transcript') {
    const noCaptions = /no captions|captions available/iu.test(error.message);
    return new ProductError(
      502,
      'TRANSCRIPT_FAILED',
      noCaptions
        ? 'No captions are available for this video.'
        : "Could not get this video's captions. Try again.",
      undefined,
      diagnostics,
    );
  }
  if (error.stage === 'summary') {
    if (diagnostics.providerStatus === 429) {
      return new ProductError(
        503,
        'MODEL_RATE_LIMITED',
        'The summary service hit its model limit. Try again shortly.',
        undefined,
        diagnostics,
      );
    }
    if (diagnostics.providerStatus === 503) {
      return new ProductError(
        503,
        'MODEL_BUSY',
        'The summary service is busy. Try again shortly.',
        undefined,
        diagnostics,
      );
    }
    return new ProductError(
      502,
      'SUMMARY_FAILED',
      'Could not create a valid short summary. Try again.',
      undefined,
      diagnostics,
    );
  }
  return new ProductError(503, 'TRANSCRIPT_CACHE_FAILED', error.message, undefined, diagnostics);
}

function statusFromCause(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const candidate = error as Error & { status?: unknown; statusCode?: unknown };
  if (typeof candidate.status === 'number') return candidate.status;
  if (typeof candidate.statusCode === 'number') return candidate.statusCode;
  return statusFromCause(error.cause);
}
