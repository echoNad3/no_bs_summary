import 'dotenv/config';
import { z } from 'zod';

/**
 * Reads and checks the settings from the .env file.
 * Fails at startup with a plain-language error if something is wrong.
 * API keys are optional here: a provider without a key is reported as
 * "skipped" by the benchmark instead of crashing the whole run.
 */

/** Treat empty strings in .env as "not set". */
const optionalKey = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().optional(),
);

const envSchema = z.object({
  TRANSCRIPTAPI_API_KEY: optionalKey,
  GEMINI_API_KEY: optionalKey,
  GEMINI_MODEL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().default('gemini-3.1-flash-lite'),
  ),
  END_TO_END_TIMEOUT_MS: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce.number().int().positive().default(15000),
  ),
  GEMINI_PACING_MS: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce.number().int().nonnegative().default(4500),
  ),
  APP_HOST: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).default('127.0.0.1'),
  ),
  APP_PORT: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce.number().int().min(1).max(65535).default(8787),
  ),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `There is a problem with the settings in your .env file:\n${problems}\n` +
        `Open the .env file and compare it with .env.example.`,
    );
  }
  return result.data;
}
