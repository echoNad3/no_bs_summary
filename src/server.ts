import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TranscriptCache } from './cache.js';
import { loadConfig, type Config } from './config.js';
import { ProductError, SummaryService } from './product/service.js';
import { FileSummaryCache } from './product/summary-cache.js';
import { GEMINI_PROMPT_VERSION, GeminiSummaryProvider } from './summary/gemini.js';
import { TranscriptApiProvider } from './transcript/transcriptapi.js';

const MAX_BODY_BYTES = 16 * 1024;
const DEFAULT_STATIC_DIR = path.resolve('dist/pwa');

export interface ApiServerOptions {
  service: Pick<SummaryService, 'summarize'>;
  staticDir?: string;
}

export function createApiServer(options: ApiServerOptions) {
  return createHttpServer(async (request, response) => {
    try {
      await routeRequest(request, response, options);
    } catch (error) {
      const failure = error instanceof ProductError ? error : undefined;
      if (failure?.retryAfterSeconds !== undefined) {
        response.setHeader('Retry-After', String(failure.retryAfterSeconds));
      }
      writeJson(response, failure?.statusCode ?? 500, {
        error: {
          code: failure?.code ?? 'INTERNAL_ERROR',
          message: failure?.message ?? 'Unexpected server error.',
        },
      });
    }
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ApiServerOptions,
): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (!applyCors(request, response)) {
    writeJson(response, 403, { error: { code: 'ORIGIN_DENIED', message: 'Origin not allowed.' } });
    return;
  }

  if (method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (method === 'GET' && url.pathname === '/api/health') {
    writeJson(response, 200, {
      status: 'ok',
      provider: 'transcriptapi',
      promptVersion: GEMINI_PROMPT_VERSION,
    });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/status') {
    writeJson(response, 200, {
      status: 'ok',
      cache: 'local',
      dailyGeneration: null,
      transcriptApiCredits: {
        availableViaApi: false,
        dashboardUrl: 'https://transcriptapi.com/billing',
      },
    });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/summarize') {
    const input = await readJsonBody(request);
    writeJson(response, 200, await options.service.summarize(input));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'API route not found.' } });
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    writeJson(response, 405, {
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' },
    });
    return;
  }

  await servePwa(response, method, url.pathname, options.staticDir ?? DEFAULT_STATIC_DIR);
}

function applyCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  const allowed =
    /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/u.test(origin) ||
    /^chrome-extension:\/\/[a-p]{32}$/u.test(origin);
  if (!allowed) return false;
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Password');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return true;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ProductError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.');
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new ProductError(413, 'REQUEST_TOO_LARGE', 'Request body is too large.');
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ProductError(400, 'INVALID_JSON', 'Request body is not valid JSON.');
  }
}

async function servePwa(
  response: ServerResponse,
  method: string,
  pathname: string,
  staticDir: string,
): Promise<void> {
  const requested = pathname === '/' || pathname === '/share' ? 'index.html' : pathname.slice(1);
  const safePath = path.resolve(staticDir, requested);
  const root = path.resolve(staticDir) + path.sep;
  if (safePath !== path.resolve(staticDir, 'index.html') && !safePath.startsWith(root)) {
    writeJson(response, 400, { error: { code: 'INVALID_PATH', message: 'Invalid path.' } });
    return;
  }

  let content: Buffer;
  let servedPath = safePath;
  try {
    content = await fs.readFile(safePath);
  } catch {
    if (!path.extname(pathname)) {
      try {
        servedPath = path.resolve(staticDir, 'index.html');
        content = await fs.readFile(servedPath);
      } catch {
        writeJson(response, 503, {
          error: { code: 'PWA_NOT_BUILT', message: 'Run npm run build before starting the app.' },
        });
        return;
      }
    } else {
      writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'File not found.' } });
      return;
    }
  }

  response.statusCode = 200;
  response.setHeader('Content-Type', mimeType(servedPath));
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  if (mimeType(servedPath).startsWith('text/html')) {
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https://i.ytimg.com; connect-src 'self' https://api.github.com; " +
        "manifest-src 'self'; " +
        "worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
  } else if (pathname === '/sw.js' || pathname.endsWith('.webmanifest')) {
    response.setHeader('Cache-Control', 'no-cache');
  } else if (/^\/assets\/.+-[A-Za-z0-9_-]+\.(?:css|js)$/u.test(pathname)) {
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (pathname.startsWith('/icons/')) {
    response.setHeader('Cache-Control', 'public, max-age=604800');
  } else {
    response.setHeader('Cache-Control', 'public, max-age=3600');
  }
  if (method === 'HEAD') response.end();
  else response.end(content);
}

function mimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.webmanifest':
      return 'application/manifest+json';
    default:
      return 'application/octet-stream';
  }
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  if (response.headersSent) return;
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function createService(config: Config): SummaryService {
  if (!config.TRANSCRIPTAPI_API_KEY || !config.GEMINI_API_KEY) {
    throw new Error(
      'The local API requires TRANSCRIPTAPI_API_KEY and GEMINI_API_KEY in .env. Keys stay on the server.',
    );
  }
  return new SummaryService({
    transcriptProvider: new TranscriptApiProvider(config.TRANSCRIPTAPI_API_KEY),
    summaryProvider: new GeminiSummaryProvider(config.GEMINI_API_KEY, config.GEMINI_MODEL),
    cache: new TranscriptCache(path.resolve('.cache')),
    summaryCache: new FileSummaryCache(path.resolve('.cache', 'summaries')),
    summaryModel: config.GEMINI_MODEL,
    summaryPromptVersion: GEMINI_PROMPT_VERSION,
    timeoutMs: config.END_TO_END_TIMEOUT_MS,
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createApiServer({ service: createService(config) });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.APP_PORT, config.APP_HOST, () => resolve());
  });
  console.log(`Local app: http://${config.APP_HOST}:${config.APP_PORT}`);
}

const isEntryPoint = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isEntryPoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
