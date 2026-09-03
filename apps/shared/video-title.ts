import { fetchVideoMetadata } from './api-client.js';
import type { VideoMetadata } from './api-client.js';
import { extractVideoId } from './youtube-input.js';

type MetadataFetcher = (
  apiBase: string,
  videoId: string,
  options: { signal: AbortSignal },
) => Promise<VideoMetadata>;

export class LatestVideoTitleLookup {
  private version = 0;
  private timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  private controller: AbortController | undefined;

  constructor(
    private readonly apiBase: string,
    private readonly delayMs = 200,
    private readonly fetcher: MetadataFetcher = fetchVideoMetadata,
  ) {}

  request(rawUrl: string, onTitle: (title: string, videoId: string) => void): void {
    this.cancel();

    let videoId: string;
    try {
      videoId = extractVideoId(rawUrl);
    } catch {
      return;
    }

    const version = this.version;
    this.timer = globalThis.setTimeout(() => {
      this.timer = undefined;
      const controller = new AbortController();
      this.controller = controller;
      void this.fetcher(this.apiBase, videoId, { signal: controller.signal })
        .then((metadata) => {
          if (version === this.version && !controller.signal.aborted) {
            onTitle(metadata.title, videoId);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (this.controller === controller) this.controller = undefined;
        });
    }, this.delayMs);
  }

  cancel(): void {
    this.version += 1;
    if (this.timer !== undefined) globalThis.clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort('superseded');
    this.controller = undefined;
  }
}
