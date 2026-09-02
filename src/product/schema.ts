import { z } from 'zod';
import { summarySchema } from '../summary/provider.js';
import { languageSchema } from '../transcript/provider.js';

export const summarizeRequestSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  language: languageSchema.default('en'),
});

export const summarizeResponseSchema = summarySchema.extend({
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
