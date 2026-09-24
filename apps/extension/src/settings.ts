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
const STORAGE_READ_TIMEOUT_MS = 2_000;
let settingsRevision = 0;
let latestSettings: ExtensionSettings | undefined;
let summaryRevision = 0;
let latestSummary: SavedSummary | undefined;

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
  const localArea = localStorageArea();
  if (localPassword === undefined && legacyPassword && localArea) {
    void localArea
      .set({ [PASSWORD_KEY]: legacyPassword })
      .then(() =>
        syncStorage()?.set({ [STORAGE_KEY]: { textSize: parseTextSize(legacy?.textSize) } }),
      )
      .catch(() => undefined);
  } else if (legacy && 'password' in legacy) {
    void syncStorage()
      ?.set({ [STORAGE_KEY]: { textSize: parseTextSize(legacy.textSize) } })
      .catch(() => undefined);
  }

  return { password, textSize: parseTextSize(legacy?.textSize) };
}

export async function loadLastSummary(): Promise<SavedSummary | undefined> {
  try {
    const storage = localStorageArea();
    if (!storage) return undefined;
    return parseSavedSummary(await readStorageValue(storage, LAST_SUMMARY_KEY));
  } catch {
    return undefined;
  }
}

export async function saveLastSummary(summary: SavedSummary): Promise<void> {
  const revision = ++summaryRevision;
  latestSummary = summary;
  try {
    await localStorageArea()?.set({ [LAST_SUMMARY_KEY]: summary });
  } catch {
    // Restoring the last result is optional when local storage is unavailable.
  } finally {
    if (revision !== summaryRevision && latestSummary) void saveLastSummary(latestSummary);
  }
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  const revision = ++settingsRevision;
  latestSettings = settings;
  const local = localStorageArea();
  try {
    await Promise.all([
      syncStorage()
        ?.set({ [STORAGE_KEY]: { textSize: settings.textSize } })
        .catch(() => undefined),
      settings.password
        ? local?.set({ [PASSWORD_KEY]: settings.password }).catch(() => undefined)
        : local?.remove(PASSWORD_KEY).catch(() => undefined),
    ]);
  } finally {
    // An older Chrome write may finish after a newer one. Restore the latest value.
    if (revision !== settingsRevision && latestSettings) void saveSettings(latestSettings);
  }
}

async function readStorageValue(storage: StorageArea | undefined, key: string): Promise<unknown> {
  if (!storage) return undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const items = await Promise.race([
      storage.get(key),
      new Promise<Record<string, unknown>>((resolve) => {
        timeout = setTimeout(() => resolve({}), STORAGE_READ_TIMEOUT_MS);
      }),
    ]);
    return items[key];
  } catch {
    return undefined;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
