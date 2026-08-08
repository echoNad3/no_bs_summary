import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  cachedSummaryEntrySchema,
  legacyCachedSummaryEntrySchema,
  legacySummaryCacheKey,
  summaryCacheIdentitySchema,
  summaryCacheKey,
} from './summary-store.js';
import type { SummaryCache, SummaryCacheIdentity } from './summary-store.js';
import type { SummarizeResponse } from './schema.js';

export { SUMMARY_CACHE_VERSION, summaryCacheKey } from './summary-store.js';
export type { SummaryCache, SummaryCacheIdentity } from './summary-store.js';

export class FileSummaryCache implements SummaryCache {
  constructor(private readonly dir: string) {}

  async read(rawIdentity: SummaryCacheIdentity): Promise<SummarizeResponse | undefined> {
    const identity = summaryCacheIdentitySchema.parse(rawIdentity);
    for (const candidate of [
      { path: this.filePath(identity), legacy: false },
      { path: this.legacyFilePath(identity), legacy: true },
    ]) {
      let raw: string;
      try {
        raw = await fs.readFile(candidate.path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }

      try {
        if (candidate.legacy) {
          const cached = legacyCachedSummaryEntrySchema.parse(JSON.parse(raw));
          if (
            cached.identity.videoId === identity.videoId &&
            cached.identity.model === identity.model &&
            cached.identity.promptVersion === identity.promptVersion &&
            cached.response.language.toLowerCase() === identity.language.toLowerCase()
          ) {
            return cached.response;
          }
        } else {
          const cached = cachedSummaryEntrySchema.parse(JSON.parse(raw));
          if (currentEntryMatches(cached, identity)) return cached.response;
        }
      } catch {
        // Try the migration key.
      }
    }
    return undefined;
  }

  async write(rawIdentity: SummaryCacheIdentity, response: SummarizeResponse): Promise<void> {
    const entry = cachedSummaryEntrySchema.parse({ identity: rawIdentity, response });
    await fs.mkdir(this.dir, { recursive: true });
    const target = this.filePath(entry.identity);
    const temp = `${target}.tmp-${randomBytes(4).toString('hex')}`;
    try {
      await fs.writeFile(temp, JSON.stringify(entry, null, 2), 'utf8');
      await replaceFile(temp, target);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }

  private filePath(identity: SummaryCacheIdentity): string {
    return path.join(this.dir, `${summaryCacheKey(identity)}.json`);
  }

  private legacyFilePath(identity: SummaryCacheIdentity): string {
    return path.join(this.dir, `${legacySummaryCacheKey(identity)}.json`);
  }
}

function currentEntryMatches(
  cached: ReturnType<typeof cachedSummaryEntrySchema.parse>,
  identity: SummaryCacheIdentity,
): boolean {
  return (
    cached.identity.videoId === identity.videoId &&
    cached.identity.language.toLowerCase() === identity.language.toLowerCase() &&
    cached.identity.model === identity.model &&
    cached.identity.promptVersion === identity.promptVersion &&
    cached.response.language.toLowerCase() === identity.language.toLowerCase()
  );
}

async function replaceFile(source: string, target: string): Promise<void> {
  try {
    await fs.rename(source, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM') throw error;
    await fs.rm(target, { force: true });
    await fs.rename(source, target);
  }
}
