import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults when values are missing or empty', () => {
    const config = loadConfig({
      SUPADATA_API_KEY: '',
      TRANSCRIPT_PROVIDER: '',
      GEMINI_MODEL: '',
      END_TO_END_TIMEOUT_MS: '',
    } as NodeJS.ProcessEnv);
    expect(config.SUPADATA_API_KEY).toBeUndefined();
    expect(config.TRANSCRIPT_PROVIDER).toBe('all');
    expect(config.GEMINI_MODEL).toBe('gemini-3.1-flash-lite');
    expect(config.END_TO_END_TIMEOUT_MS).toBe(15000);
  });

  it('reads real values', () => {
    const config = loadConfig({
      SUPADATA_API_KEY: 'sk-1',
      TRANSCRIPTAPI_API_KEY: 'sk-2',
      GEMINI_API_KEY: 'sk-3',
      TRANSCRIPT_PROVIDER: 'supadata',
      GEMINI_MODEL: 'gemini-x',
      END_TO_END_TIMEOUT_MS: '9000',
    } as NodeJS.ProcessEnv);
    expect(config.TRANSCRIPT_PROVIDER).toBe('supadata');
    expect(config.GEMINI_MODEL).toBe('gemini-x');
    expect(config.END_TO_END_TIMEOUT_MS).toBe(9000);
  });

  it('rejects an unknown provider choice with a readable error', () => {
    expect(() => loadConfig({ TRANSCRIPT_PROVIDER: 'banana' } as NodeJS.ProcessEnv)).toThrow(
      /\.env/,
    );
  });

  it('rejects a non-numeric timeout', () => {
    expect(() => loadConfig({ END_TO_END_TIMEOUT_MS: 'fast' } as NodeJS.ProcessEnv)).toThrow(
      /\.env/,
    );
  });
});
