import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { videoIdSchema } from '../transcript/provider.js';
import { summarizeResponseSchema, type SummarizeResponse } from './schema.js';

export const SUMMARY_CACHE_VERSION = 1;

const summaryCacheIdentitySchema = z.object({
  videoId: videoIdSchema,
  model: z.string().trim().min(1).max(200),
  promptVersion: z.string().trim().min(1).max(200),
});

const cachedSummarySchema = z.object({
  identity: summaryCacheIdentitySchema,
  response: summarizeResponseSchema,
});

export type SummaryCacheIdentity = z.infer<typeof summaryCacheIdentitySchema>;

/** Replaceable backend storage contract. A hosted store can implement this without client changes. */
export interface SummaryCache {
  read(identity: SummaryCacheIdentity): Promise<SummarizeResponse | undefined>;
  write(identity: SummaryCacheIdentity, response: SummarizeResponse): Promise<void>;
}

export function summaryCacheKey(rawIdentity: SummaryCacheIdentity): string {
  const identity = summaryCacheIdentitySchema.parse(rawIdentity);
  return [
    `v${SUMMARY_CACHE_VERSION}`,
    'summary',
    identity.videoId,
    hashKeyPart(identity.model),
    hashKeyPart(identity.promptVersion),
  ].join('-');
}

/** Development implementation. Production hosting can replace it with durable shared storage. */
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
      const cached = cachedSummarySchema.parse(JSON.parse(raw));
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
    const entry = cachedSummarySchema.parse({ identity: rawIdentity, response });
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

function hashKeyPart(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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
