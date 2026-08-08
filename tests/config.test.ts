import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults when values are missing or empty', () => {
    const config = loadConfig({
      GEMINI_MODEL: '',
      END_TO_END_TIMEOUT_MS: '',
    } as NodeJS.ProcessEnv);
    expect(config.GEMINI_MODEL).toBe('gemini-3.1-flash-lite');
    expect(config.END_TO_END_TIMEOUT_MS).toBe(15000);
    expect(config.APP_HOST).toBe('127.0.0.1');
    expect(config.APP_PORT).toBe(8787);
  });

  it('reads real values', () => {
    const config = loadConfig({
      TRANSCRIPTAPI_API_KEY: 'sk-2',
      GEMINI_API_KEY: 'sk-3',
      GEMINI_MODEL: 'gemini-x',
      END_TO_END_TIMEOUT_MS: '9000',
      APP_HOST: 'localhost',
      APP_PORT: '9999',
    } as NodeJS.ProcessEnv);
    expect(config.TRANSCRIPTAPI_API_KEY).toBe('sk-2');
    expect(config.GEMINI_MODEL).toBe('gemini-x');
    expect(config.END_TO_END_TIMEOUT_MS).toBe(9000);
    expect(config.APP_HOST).toBe('localhost');
    expect(config.APP_PORT).toBe(9999);
  });

  it('rejects a non-numeric timeout', () => {
    expect(() => loadConfig({ END_TO_END_TIMEOUT_MS: 'fast' } as NodeJS.ProcessEnv)).toThrow(
      /\.env/,
    );
  });

  it('rejects an invalid server port', () => {
    expect(() => loadConfig({ APP_PORT: '70000' } as NodeJS.ProcessEnv)).toThrow(/\.env/);
  });
});
