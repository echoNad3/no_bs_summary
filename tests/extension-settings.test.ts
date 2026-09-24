import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLastSummary, loadSettings } from '../apps/extension/src/settings.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('extension storage startup', () => {
  it('shows the panel when Chrome storage reads never settle', async () => {
    vi.useFakeTimers();
    const storage = {
      get: () => new Promise<Record<string, unknown>>(() => undefined),
      set: async () => undefined,
      remove: async () => undefined,
    };
    vi.stubGlobal('chrome', { storage: { local: storage, sync: storage } });

    const settings = loadSettings();
    const summary = loadLastSummary();
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(settings).resolves.toEqual({ password: '', textSize: 'normal' });
    await expect(summary).resolves.toBeUndefined();
  });
});
