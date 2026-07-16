import { createHash } from 'node:crypto';
import { z } from 'zod';
import { videoIdSchema } from '../transcript/provider.js';
import { summarizeResponseSchema, type SummarizeResponse } from './schema.js';

/**
 * Runtime-neutral summary storage contract shared by the local filesystem
 * cache (summary-cache.ts) and the Cloudflare Worker's KV implementation
 * (kv-summary-cache.ts). This file must stay free of node:fs; node:crypto is
 * fine because the Worker runs with the nodejs_compat flag.
 */

export const SUMMARY_CACHE_VERSION = 1;

export const summaryCacheIdentitySchema = z.object({
  videoId: videoIdSchema,
  model: z.string().trim().min(1).max(200),
  promptVersion: z.string().trim().min(1).max(200),
});

export const cachedSummaryEntrySchema = z.object({
  identity: summaryCacheIdentitySchema,
  response: summarizeResponseSchema,
});

export type SummaryCacheIdentity = z.infer<typeof summaryCacheIdentitySchema>;
export type CachedSummaryEntry = z.infer<typeof cachedSummaryEntrySchema>;

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

function hashKeyPart(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
