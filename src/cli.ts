export interface CliOptions {
  useCache: boolean;
  cacheOnly: boolean;
  clearCache: boolean;
}

const ALLOWED_FLAGS = new Set(['--no-cache', '--cache-only', '--clear-cache']);

export function parseCliArgs(args: string[]): CliOptions {
  const unknown = args.filter((arg) => !ALLOWED_FLAGS.has(arg));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown command option${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. ` +
        `Allowed options are --no-cache and --clear-cache.`,
    );
  }
  const flags = new Set(args);
  if (flags.has('--clear-cache') && flags.size > 1) {
    throw new Error('Use --clear-cache by itself.');
  }
  if (flags.has('--cache-only') && flags.has('--no-cache')) {
    throw new Error('Use either --cache-only or --no-cache, not both.');
  }
  return {
    useCache: !flags.has('--no-cache'),
    cacheOnly: flags.has('--cache-only'),
    clearCache: flags.has('--clear-cache'),
  };
}
