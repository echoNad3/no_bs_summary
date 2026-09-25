import { getService, type WorkerEnv } from '../../src/worker.js';
import type { SummaryService } from '../../src/product/service.js';
import type { SummaryCache } from '../../src/product/summary-store.js';
import type { SummaryProvider } from '../../src/summary/provider.js';
import type { TranscriptProvider } from '../../src/transcript/provider.js';

const videoId = '-ujJNlvFCxM';
const input = { url: `https://youtu.be/${videoId}` };
let transcriptCalls = 0;
let modelCalls = 0;

const env = {
  ASSETS: { fetch: async () => new Response('unused') },
  GEMINI_API_KEY: 'fixture-key',
  TRANSCRIPTAPI_API_KEY: 'fixture-key',
  SUMMARIES: { get: async () => null, put: async () => undefined },
} satisfies WorkerEnv;

function service(): SummaryService {
  const instance = getService(env);
  // Replace external providers on the real Worker factory's request-owned service.
  // This fixture never calls paid providers or persistent storage.
  const options = (
    instance as unknown as {
      options: {
        transcriptProvider: TranscriptProvider;
        summaryProvider: SummaryProvider;
        summaryCache: SummaryCache;
        timeoutMs: number;
      };
    }
  ).options;
  options.timeoutMs = 500;
  options.transcriptProvider = {
    name: 'transcriptapi',
    fetchTranscript: async () => {
      transcriptCalls += 1;
      return { provider: 'transcriptapi', videoId, language: 'en', text: 'A useful source.' };
    },
  };
  options.summaryProvider = {
    name: 'gemini',
    summarize: async () => {
      modelCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 200));
      return {
        verdict: 'WATCH',
        reason: 'Useful and clear.',
        summary: '- **Point:** A useful source.',
      };
    },
  };
  options.summaryCache = { read: async () => undefined, write: async () => undefined };
  return instance;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const instance = service();
    const path = new URL(request.url).pathname;
    if (path === '/abandon') {
      // Emulate an invocation ending while its model call is still pending.
      void instance.summarize(input).catch(() => undefined);
      return new Response('invocation ended');
    }
    try {
      const result = await instance.summarize(input);
      return Response.json({ result, transcriptCalls, modelCalls });
    } catch (error) {
      return Response.json(
        {
          code: error instanceof Error && 'code' in error ? error.code : 'UNEXPECTED',
          transcriptCalls,
          modelCalls,
        },
        { status: 504 },
      );
    }
  },
};
