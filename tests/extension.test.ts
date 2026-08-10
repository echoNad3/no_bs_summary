import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getYouTubeTabContext } from '../apps/extension/src/tab-context.js';
import { DEFAULT_BACKEND_URL } from '../apps/extension/src/settings.js';

describe('extension manifest permissions', () => {
  it('can read the current supported YouTube tab while the side panel stays open', async () => {
    const manifest = JSON.parse(
      await fs.readFile('apps/extension/public/manifest.json', 'utf8'),
    ) as {
      name: string;
      version: string;
      permissions: string[];
      host_permissions: string[];
      icons: Record<string, string>;
      action: { default_title: string; default_icon: Record<string, string> };
    };
    expect(manifest.name).toBe('No BS Summary');
    expect(manifest.version).toBe('0.4.0');
    expect((manifest as { minimum_chrome_version?: string }).minimum_chrome_version).toBe('114');
    expect(manifest.host_permissions).toEqual(
      expect.arrayContaining([
        `${DEFAULT_BACKEND_URL}/*`,
        'https://youtube.com/*',
        'https://www.youtube.com/*',
        'https://m.youtube.com/*',
        'https://music.youtube.com/*',
        'https://youtu.be/*',
      ]),
    );
    expect(manifest.host_permissions.every((permission) => permission.startsWith('https://'))).toBe(
      true,
    );
    expect(manifest.permissions).toEqual(['sidePanel', 'storage']);
    expect(manifest.icons).toEqual({
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    });
    expect(manifest.action.default_icon).toEqual({
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
    });
    expect(manifest.action.default_title).toBe('Open No BS Summary');
  });
});

describe('extension controls', () => {
  it('leads with the current video and keeps settings out of the main flow', async () => {
    const html = await fs.readFile('apps/extension/sidepanel.html', 'utf8');
    const settingsStart = html.indexOf('<dialog id="settings-dialog"');
    const settingsEnd = html.indexOf('</dialog>', settingsStart);

    expect(html).toContain('id="detected-title"');
    expect(settingsStart).toBeGreaterThan(0);
    expect(html).toContain('class="manual-link-field"');
    expect(html).toContain('id="url"');
    expect(html.slice(settingsStart, settingsEnd)).not.toContain('id="url"');
    expect(html.slice(settingsStart, settingsEnd)).not.toContain('id="language"');
    expect(html.slice(settingsStart, settingsEnd)).toContain('id="password"');
    expect(html).toContain('id="copy-summary"');
    expect(html).toContain('id="show-password"');
    expect(html).not.toContain('id="lock-video"');
    expect(html).not.toContain('id="help-dialog"');
    expect(html).toContain('id="settings-button"');
    expect(html).toContain('id="save-settings"');
    expect(html).toContain('class="control-icon"');
    expect(html).not.toContain('data-disclosure');
  });
});

describe('extension settings', () => {
  it('ships against the production HTTPS backend', () => {
    expect(DEFAULT_BACKEND_URL).toBe('https://no-bullshit-summary.echonad3.workers.dev');
  });
});

describe('extension active-tab context', () => {
  it('keeps a supported YouTube URL and cleans the browser title', () => {
    expect(
      getYouTubeTabContext({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=40',
        title: 'Useful video - YouTube',
      }),
    ).toEqual({
      videoId: 'dQw4w9WgXcQ',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=40',
      title: 'Useful video',
    });
  });

  it('rejects non-YouTube and unsupported YouTube pages', () => {
    expect(getYouTubeTabContext({ url: 'https://example.com/video' })).toBeUndefined();
    expect(getYouTubeTabContext({ url: 'https://www.youtube.com/' })).toBeUndefined();
  });

  it('does not require a title', () => {
    expect(getYouTubeTabContext({ url: 'https://youtu.be/dQw4w9WgXcQ' })).toEqual({
      videoId: 'dQw4w9WgXcQ',
      url: 'https://youtu.be/dQw4w9WgXcQ',
      title: undefined,
    });
  });
});
