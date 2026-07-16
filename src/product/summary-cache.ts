import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  cachedSummaryEntrySchema,
  summaryCacheIdentitySchema,
  summaryCacheKey,
} from './summary-store.js';
import type { SummaryCache, SummaryCacheIdentity } from './summary-store.js';
import type { SummarizeResponse } from './schema.js';

/**
 * Local filesystem implementation of the summary storage contract. The
 * contract, schemas, and key derivation live in summary-store.ts so the
 * Cloudflare Worker's KV implementation can share them without node:fs.
 */

export { SUMMARY_CACHE_VERSION, summaryCacheKey } from './summary-store.js';
export type { SummaryCache, SummaryCacheIdentity } from './summary-store.js';

/** Development implementation. Production hosting replaces it with KvSummaryCache. */
export class FileSummaryCache implements SummaryCache {
  constructor(private readonly dir: string) {}

  async read(rawIdentity: SummaryCacheIdentity): Promise<SummarizeResponse | undefined> {
    const identity = summaryCacheIdentitySchema.parse(rawIdentity);
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath(identity), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }

    try {
      const cached = cachedSummaryEntrySchema.parse(JSON.parse(raw));
      if (
        cached.identity.videoId !== identity.videoId ||
        cached.identity.model !== identity.model ||
        cached.identity.promptVersion !== identity.promptVersion
      ) {
        return undefined;
      }
      return cached.response;
    } catch {
      return undefined;
    }
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
