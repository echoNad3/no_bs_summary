import { ProductError } from './product/service.js';
import { isVideoId } from './youtube.js';

const METADATA_TIMEOUT_MS = 6_000;
const MAX_METADATA_BYTES = 32 * 1024;
const MAX_TITLE_LENGTH = 200;

export interface VideoMetadata {
  title: string;
}

export async function fetchYouTubeVideoMetadata(
  videoId: string,
  fetcher: typeof fetch = fetch,
): Promise<VideoMetadata> {
  if (!isVideoId(videoId)) {
    throw new ProductError(400, 'INVALID_VIDEO_ID', 'A valid YouTube video ID is required.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), METADATA_TIMEOUT_MS);
  const endpoint = new URL('https://www.youtube.com/oembed');
  endpoint.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`);
  endpoint.searchParams.set('format', 'json');

  try {
    const response = await fetcher(endpoint, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 404) {
      throw new ProductError(404, 'VIDEO_NOT_FOUND', 'This YouTube video is unavailable.');
    }
    if (!response.ok) {
      throw new ProductError(
        502,
        'METADATA_UNAVAILABLE',
        'The video title is temporarily unavailable.',
      );
    }

    const payload = asObject(await readBoundedJson(response));
    const title = cleanTitle(payload?.title);
    if (!title) {
      throw new ProductError(
        502,
        'METADATA_UNAVAILABLE',
        'The video title is temporarily unavailable.',
      );
    }
    return { title };
  } catch (error) {
    if (error instanceof ProductError) throw error;
    if (controller.signal.aborted) {
      throw new ProductError(504, 'METADATA_TIMEOUT', 'The video title lookup took too long.');
    }
    throw new ProductError(
      502,
      'METADATA_UNAVAILABLE',
      'The video title is temporarily unavailable.',
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_METADATA_BYTES) {
    throw new ProductError(
      502,
      'METADATA_UNAVAILABLE',
      'The video title is temporarily unavailable.',
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new ProductError(
      502,
      'METADATA_UNAVAILABLE',
      'The video title is temporarily unavailable.',
    );
  }

  const decoder = new TextDecoder();
  let raw = '';
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_METADATA_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ProductError(
        502,
        'METADATA_UNAVAILABLE',
        'The video title is temporarily unavailable.',
      );
    }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ProductError(
      502,
      'METADATA_UNAVAILABLE',
      'The video title is temporarily unavailable.',
    );
  }
}

function cleanTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const title = value
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return title ? title.slice(0, MAX_TITLE_LENGTH) : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
