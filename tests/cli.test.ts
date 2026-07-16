import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../src/cli.js';

describe('parseCliArgs', () => {
  it('uses cache by default and supports each documented flag', () => {
    expect(parseCliArgs([])).toEqual({
      useCache: true,
      cacheOnly: false,
      clearCache: false,
    });
    expect(parseCliArgs(['--no-cache'])).toEqual({
      useCache: false,
      cacheOnly: false,
      clearCache: false,
    });
    expect(parseCliArgs(['--cache-only'])).toEqual({
      useCache: true,
      cacheOnly: true,
      clearCache: false,
    });
    expect(parseCliArgs(['--clear-cache'])).toEqual({
      useCache: true,
      cacheOnly: false,
      clearCache: true,
    });
  });

  it('rejects unknown or conflicting flags instead of silently using cache', () => {
    expect(() => parseCliArgs(['--no-cahce'])).toThrow('Unknown command option');
    expect(() => parseCliArgs(['video-id'])).toThrow('Unknown command option');
    expect(() => parseCliArgs(['--no-cache', '--clear-cache'])).toThrow('by itself');
    expect(() => parseCliArgs(['--no-cache', '--cache-only'])).toThrow('not both');
    expect(() => parseCliArgs(['--cache-only', '--clear-cache'])).toThrow('by itself');
    expect(() => parseCliArgs(['--reverse-providers'])).toThrow('Unknown command option');
  });
});
