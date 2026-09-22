import { z } from 'zod';
import { summarySchema } from '../summary/provider.js';
import { languageSchema } from '../transcript/provider.js';

export const SUMMARY_OUTPUT_VERSION = 2 as const;

export const summarizeRequestSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  language: languageSchema.default('en'),
  regenerate: z.boolean().optional().default(false),
});

export const summarizeResponseSchema = summarySchema.extend({
  outputVersion: z.literal(SUMMARY_OUTPUT_VERSION),
  videoId: z.string(),
  language: languageSchema,
  source: z.enum(['LIVE', 'CACHED']),
  timing: z.object({
    transcriptMs: z.number().int().nonnegative().optional(),
    summaryMs: z.number().int().nonnegative(),
    totalMs: z.number().int().nonnegative().optional(),
  }),
  retries: z.object({
    transcript: z.number().int().nonnegative(),
    summary: z.number().int().nonnegative(),
  }),
});

export type SummarizeRequest = z.infer<typeof summarizeRequestSchema>;
export type SummarizeResponse = z.infer<typeof summarizeResponseSchema>;
