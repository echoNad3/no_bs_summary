/**
 * Persistent side-panel settings. The shared app password is user
 * configuration, never a bundled secret. chrome.storage.sync keeps it across
 * devices signed into the same Chrome profile.
 */

// The deployed backend. Self-hosted builds replace this value before building.
export const DEFAULT_BACKEND_URL = 'https://no-bs-summary.echonad3.workers.dev';

const STORAGE_KEY = 'nbs-settings';
const LAST_SUMMARY_KEY = 'nbs-last-summary';

export interface ExtensionSettings {
  password: string;
  textSize: TextSize;
}

/**
 * Structural view of chrome.storage.sync so this module type-checks and
 * unit-tests outside an extension context (mirrors tab-context.ts).
 */
interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function syncStorage(): StorageArea | undefined {
  const candidate = globalThis as {
    chrome?: { storage?: { sync?: StorageArea } };
  };
  return candidate.chrome?.storage?.sync;
}

function localStorageArea(): StorageArea | undefined {
  const candidate = globalThis as {
    chrome?: { storage?: { local?: StorageArea } };
  };
  return candidate.chrome?.storage?.local;
}

export async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const storage = syncStorage();
    if (!storage) return { password: '', textSize: 'normal' };
    const stored = await storage.get(STORAGE_KEY);
    const value = stored[STORAGE_KEY] as Partial<ExtensionSettings> | undefined;
    return {
      password: typeof value?.password === 'string' ? value.password : '',
      textSize: parseTextSize(value?.textSize),
    };
  } catch {
    return { password: '', textSize: 'normal' };
  }
}

export async function loadLastSummary(): Promise<SavedSummary | undefined> {
  try {
    const storage = localStorageArea();
    if (!storage) return undefined;
    const stored = await storage.get(LAST_SUMMARY_KEY);
    return parseSavedSummary(stored[LAST_SUMMARY_KEY]);
  } catch {
    return undefined;
  }
}

export async function saveLastSummary(summary: SavedSummary): Promise<void> {
  try {
    await localStorageArea()?.set({ [LAST_SUMMARY_KEY]: summary });
  } catch {
    // Restoring the last result is optional when local storage is unavailable.
  }
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  try {
    await syncStorage()?.set({ [STORAGE_KEY]: settings });
  } catch {
    // Settings just aren't remembered when storage is unavailable.
  }
}
import { parseSavedSummary, parseTextSize } from '../../shared/client-state.js';
import type { SavedSummary, TextSize } from '../../shared/client-state.js';
