import { createHash } from 'node:crypto';
import { z } from 'zod';
import { languageSchema, videoIdSchema } from '../transcript/provider.js';
import { summarizeResponseSchema, type SummarizeResponse } from './schema.js';

export const SUMMARY_CACHE_VERSION = 2;

export const legacySummaryCacheIdentitySchema = z.object({
  videoId: videoIdSchema,
  model: z.string().trim().min(1).max(200),
  promptVersion: z.string().trim().min(1).max(200),
});

export const summaryCacheIdentitySchema = z.object({
  videoId: videoIdSchema,
  language: languageSchema,
  model: z.string().trim().min(1).max(200),
  promptVersion: z.string().trim().min(1).max(200),
});

export const cachedSummaryEntrySchema = z.object({
  identity: summaryCacheIdentitySchema,
  response: summarizeResponseSchema,
});

export const legacyCachedSummaryEntrySchema = z.object({
  identity: legacySummaryCacheIdentitySchema,
  response: summarizeResponseSchema,
});

export type SummaryCacheIdentity = z.infer<typeof summaryCacheIdentitySchema>;
export type CachedSummaryEntry = z.infer<typeof cachedSummaryEntrySchema>;

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
    identity.language.toLowerCase(),
    hashKeyPart(identity.model),
    hashKeyPart(identity.promptVersion),
  ].join('-');
}

export function legacySummaryCacheKey(rawIdentity: SummaryCacheIdentity): string {
  const identity = summaryCacheIdentitySchema.parse(rawIdentity);
  return [
    'v1',
    'summary',
    identity.videoId,
    hashKeyPart(identity.model),
    hashKeyPart(identity.promptVersion),
  ].join('-');
}

function hashKeyPart(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
