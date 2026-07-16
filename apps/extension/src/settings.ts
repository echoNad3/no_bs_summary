/**
 * Persistent side-panel settings. The backend URL and shared app password are
 * user configuration, never bundled secrets. chrome.storage.sync keeps them
 * across devices signed into the same Chrome profile.
 */

// Replace with the deployed workers.dev URL once production exists; the local
// backend stays the development default.
export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8787';

const STORAGE_KEY = 'nbs-settings';

export interface ExtensionSettings {
  backendUrl: string;
  password: string;
}

/**
 * Structural view of chrome.storage.sync so this module type-checks and
 * unit-tests outside an extension context (mirrors tab-context.ts).
 */
interface SyncStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function syncStorage(): SyncStorageArea | undefined {
  const candidate = globalThis as {
    chrome?: { storage?: { sync?: SyncStorageArea } };
  };
  return candidate.chrome?.storage?.sync;
}

/** Trims and strips trailing slashes; falls back to the default on garbage. */
export function normalizeBackendUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/u, '');
  if (trimmed === '') return DEFAULT_BACKEND_URL;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return DEFAULT_BACKEND_URL;
    return trimmed;
  } catch {
    return DEFAULT_BACKEND_URL;
  }
}

export async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const storage = syncStorage();
    if (!storage) return { backendUrl: DEFAULT_BACKEND_URL, password: '' };
    const stored = await storage.get(STORAGE_KEY);
    const value = stored[STORAGE_KEY] as Partial<ExtensionSettings> | undefined;
    return {
      backendUrl: normalizeBackendUrl(
        typeof value?.backendUrl === 'string' ? value.backendUrl : '',
      ),
      password: typeof value?.password === 'string' ? value.password : '',
    };
  } catch {
    return { backendUrl: DEFAULT_BACKEND_URL, password: '' };
  }
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  try {
    await syncStorage()?.set({ [STORAGE_KEY]: settings });
  } catch {
    // Settings just aren't remembered when storage is unavailable.
  }
}
