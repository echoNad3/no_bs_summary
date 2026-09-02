const LATEST_RELEASE_API = 'https://api.github.com/repos/echoNad3/no_bs_summary/releases/latest';
const LATEST_RELEASE_CACHE_KEY = 'nbs-latest-apk';

export interface LatestApk {
  build: number;
}

export function readCachedLatestApk(): LatestApk | null {
  try {
    return parseCachedLatestApk(localStorage.getItem(LATEST_RELEASE_CACHE_KEY));
  } catch {
    return null;
  }
}

export function parseCachedLatestApk(cached: string | null): LatestApk | null {
  if (!cached) return null;
  try {
    return parseLatestApk(JSON.parse(cached) as unknown);
  } catch {
    return null;
  }
}

export async function fetchLatestApk(): Promise<LatestApk | null> {
  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!response.ok) return readCachedLatestApk();
    const release = (await response.json()) as {
      tag_name?: unknown;
      name?: unknown;
    };
    const latest = parseLatestApk({
      build: parseBuild(release.tag_name) ?? parseBuild(release.name),
    });
    if (!latest) return readCachedLatestApk();
    cacheLatestApk(latest);
    return latest;
  } catch {
    return readCachedLatestApk();
  }
}

function cacheLatestApk(latest: LatestApk): void {
  try {
    localStorage.setItem(LATEST_RELEASE_CACHE_KEY, JSON.stringify(latest));
  } catch {
    // The live result still works when browser storage is unavailable.
  }
}

export function parseLatestApk(value: unknown): LatestApk | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<LatestApk>;
  return typeof candidate.build === 'number' &&
    Number.isInteger(candidate.build) &&
    candidate.build > 0
    ? { build: candidate.build }
    : null;
}

export function parseBuild(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(?:android-v|Android APK build\s+)(\d+)\s*$/u);
  return match ? Number(match[1]) : null;
}
