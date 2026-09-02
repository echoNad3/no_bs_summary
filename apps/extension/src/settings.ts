import { parseSavedSummary, parseTextSize } from '../../shared/client-state.js';
import type { SavedSummary, TextSize } from '../../shared/client-state.js';

/**
 * Persistent side-panel settings. Text size may sync across Chrome profiles;
 * the owner password stays on this device in chrome.storage.local.
 */

// The deployed backend. Self-hosted builds replace this value before building.
export const DEFAULT_BACKEND_URL = 'https://no-bs-summary.echonad3.workers.dev';

const STORAGE_KEY = 'nbs-settings';
const PASSWORD_KEY = 'nbs-app-password';
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
  remove(key: string): Promise<void>;
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
  const [synced, local] = await Promise.all([
    readStorageValue(syncStorage(), STORAGE_KEY),
    readStorageValue(localStorageArea(), PASSWORD_KEY),
  ]);
  const legacy = synced as Partial<ExtensionSettings> | undefined;
  const localPassword = typeof local === 'string' ? local : undefined;
  const legacyPassword = typeof legacy?.password === 'string' ? legacy.password : '';
  const password = localPassword ?? legacyPassword;
  let passwordStoredLocally = localPassword !== undefined;

  const localArea = localStorageArea();
  if (!passwordStoredLocally && legacyPassword && localArea) {
    try {
      await localArea.set({ [PASSWORD_KEY]: legacyPassword });
      passwordStoredLocally = true;
    } catch {
      // Keep the synced copy until a later migration succeeds.
    }
  }
  if (legacy && 'password' in legacy && passwordStoredLocally) {
    await syncStorage()
      ?.set({ [STORAGE_KEY]: { textSize: parseTextSize(legacy.textSize) } })
      .catch(() => undefined);
  }

  return { password, textSize: parseTextSize(legacy?.textSize) };
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
  const local = localStorageArea();
  await Promise.all([
    syncStorage()
      ?.set({ [STORAGE_KEY]: { textSize: settings.textSize } })
      .catch(() => undefined),
    settings.password
      ? local?.set({ [PASSWORD_KEY]: settings.password }).catch(() => undefined)
      : local?.remove(PASSWORD_KEY).catch(() => undefined),
  ]);
}

async function readStorageValue(storage: StorageArea | undefined, key: string): Promise<unknown> {
  try {
    return storage ? (await storage.get(key))[key] : undefined;
  } catch {
    return undefined;
  }
}
