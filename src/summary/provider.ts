import { z } from 'zod';
import type { RunContext } from '../run-context.js';

/**
 * The structured verdict returned by the summary model.
 * Validated with Zod before anything else touches it.
 */
export const summarySchema = z.object({
  verdict: z.enum(['WATCH', 'SKIM', 'SKIP']),
  reason: z.string().min(1),
  summary: z.string().min(1),
});

export type Summary = z.infer<typeof summarySchema>;

/**
 * A summary backend. Implementations must:
 * - make exactly one model request per transcript (no chunking, no passes)
 * - request structured JSON output and validate it with `summarySchema`
 * - respect the run context so requests stop at the end-to-end deadline
 */
export interface SummaryProvider {
  /** Stable machine-readable name, e.g. "gemini". */
  readonly name: string;
  summarize(transcriptText: string, ctx: RunContext): Promise<Summary>;
}
