import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { cachedTranscriptSchema } from './transcript/store.js';
import type { CacheIdentity, TranscriptStore } from './transcript/store.js';
import type { TranscriptResult } from './transcript/provider.js';

export { CACHE_VERSION, cacheKey } from './transcript/store.js';
export type { CacheIdentity, TranscriptStore } from './transcript/store.js';

export class TranscriptCache implements TranscriptStore {
  constructor(private readonly dir: string) {}

  private filePath(key: string): string {
    return path.join(this.dir, `${key}.json`);
  }

  async read(key: string, expected?: CacheIdentity): Promise<TranscriptResult | undefined> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath(key), 'utf8');
    } catch {
      return undefined;
    }
    try {
      const parsed = cachedTranscriptSchema.parse(JSON.parse(raw));
      if (
        expected &&
        (parsed.provider !== expected.provider || parsed.videoId !== expected.videoId)
      ) {
        return undefined;
      }
      return parsed as TranscriptResult;
    } catch {
      return undefined;
    }
  }

  async write(key: string, transcript: TranscriptResult): Promise<void> {
    const validated = cachedTranscriptSchema.parse(transcript);
    await fs.mkdir(this.dir, { recursive: true });
    const target = this.filePath(key);
    const temp = `${target}.tmp-${randomBytes(4).toString('hex')}`;
    try {
      await fs.writeFile(temp, JSON.stringify(validated, null, 2), 'utf8');
      await fs.rename(temp, target);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
}
