const LATEST_RELEASE_API = 'https://api.github.com/repos/echoNad3/no_bs_summary/releases/latest';
const LATEST_RELEASE_CACHE_KEY = 'nbs-latest-apk';

export interface LatestApk {
  build: number;
  publishedAt: number;
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
  const manifest = await fetchLatestManifest();
  if (manifest) {
    cacheLatestApk(manifest);
    return manifest;
  }

  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!response.ok) return readCachedLatestApk();
    const release = (await response.json()) as {
      tag_name?: unknown;
      name?: unknown;
      published_at?: unknown;
    };
    const publishedAt =
      typeof release.published_at === 'string' ? Date.parse(release.published_at) : Number.NaN;
    const latest = parseLatestApk({
      build: parseBuild(release.tag_name) ?? parseBuild(release.name),
      publishedAt,
    });
    if (!latest) return readCachedLatestApk();
    cacheLatestApk(latest);
    return latest;
  } catch {
    return readCachedLatestApk();
  }
}

async function fetchLatestManifest(): Promise<LatestApk | null> {
  const browser = globalThis as { document?: { baseURI: string } };
  if (!browser.document) return null;
  try {
    const url = new URL('android-release.json', browser.document.baseURI);
    url.searchParams.set('t', String(Date.now()));
    const response = await fetch(url, { cache: 'no-store' });
    return response.ok ? parseLatestApk(await response.json()) : null;
  } catch {
    return null;
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
    candidate.build > 0 &&
    typeof candidate.publishedAt === 'number' &&
    Number.isFinite(candidate.publishedAt)
    ? { build: candidate.build, publishedAt: candidate.publishedAt }
    : null;
}

export function parseBuild(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(?:android-v|Android APK build\s+)(\d+)\s*$/u);
  return match ? Number(match[1]) : null;
}
