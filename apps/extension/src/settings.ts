/**
 * Persistent side-panel settings. The shared app password is user
 * configuration, never a bundled secret. chrome.storage.sync keeps it across
 * devices signed into the same Chrome profile.
 */

// The deployed backend. Self-hosted builds replace this value before building.
export const DEFAULT_BACKEND_URL = 'https://no-bullshit-summary.echonad3.workers.dev';

const STORAGE_KEY = 'nbs-settings';

export interface ExtensionSettings {
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

export async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const storage = syncStorage();
    if (!storage) return { password: '' };
    const stored = await storage.get(STORAGE_KEY);
    const value = stored[STORAGE_KEY] as Partial<ExtensionSettings> | undefined;
    return {
      password: typeof value?.password === 'string' ? value.password : '',
    };
  } catch {
    return { password: '' };
  }
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  try {
    await syncStorage()?.set({ [STORAGE_KEY]: settings });
  } catch {
    // Settings just aren't remembered when storage is unavailable.
  }
}
