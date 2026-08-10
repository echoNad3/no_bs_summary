const RELEASE_API = 'https://api.github.com/repos/echoNad3/no_bullshit_summary/releases/latest';
const CACHE_KEY = 'nbs-latest-apk';

export interface LatestApk {
  build: number;
  publishedAt: number;
}

export function parseBuild(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/(?:android-v|build\s+)(\d+)\s*$/iu);
  return match ? Number(match[1]) : null;
}

export function parseLatestApk(value: unknown): LatestApk | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<LatestApk>;
  return typeof candidate.build === 'number' &&
    Number.isInteger(candidate.build) &&
    candidate.build > 0 &&
    typeof candidate.publishedAt === 'number' &&
    Number.isFinite(candidate.publishedAt)
    ? { build: candidate.build, publishedAt: candidate.publishedAt }
    : null;
}

export function readCachedLatestApk(): LatestApk | null {
  try {
    return parseLatestApk(JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

export async function fetchLatestApk(): Promise<LatestApk | null> {
  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!response.ok) return readCachedLatestApk();
    const release = (await response.json()) as {
      tag_name?: unknown;
      name?: unknown;
      published_at?: unknown;
    };
    const latest = parseLatestApk({
      build: parseBuild(release.tag_name) ?? parseBuild(release.name),
      publishedAt:
        typeof release.published_at === 'string' ? Date.parse(release.published_at) : Number.NaN,
    });
    if (!latest) return readCachedLatestApk();
    localStorage.setItem(CACHE_KEY, JSON.stringify(latest));
    return latest;
  } catch {
    return readCachedLatestApk();
  }
}
