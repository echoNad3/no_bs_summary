import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getYouTubeTabContext } from '../apps/extension/src/tab-context.js';
import { DEFAULT_BACKEND_URL, normalizeBackendUrl } from '../apps/extension/src/settings.js';

describe('extension manifest permissions', () => {
  it('can read the current supported YouTube tab while the side panel stays open', async () => {
    const manifest = JSON.parse(
      await fs.readFile('apps/extension/public/manifest.json', 'utf8'),
    ) as { host_permissions: string[] };
    expect(manifest.host_permissions).toEqual(
      expect.arrayContaining([
        'https://youtube.com/*',
        'https://www.youtube.com/*',
        'https://m.youtube.com/*',
        'https://music.youtube.com/*',
        'https://youtu.be/*',
      ]),
    );
  });
});

describe('extension controls', () => {
  it('leads with the detected title and keeps manual inputs in one collapsed fallback', async () => {
    const html = await fs.readFile('apps/extension/sidepanel.html', 'utf8');
    const fallbackStart = html.indexOf('<details id="fallback-controls">');
    const fallbackEnd = html.indexOf('</details>', fallbackStart);

    expect(html).toContain('id="detected-title"');
    expect(fallbackStart).toBeGreaterThan(0);
    expect(html.slice(fallbackStart, fallbackEnd)).toContain('id="url"');
    expect(html.slice(fallbackStart, fallbackEnd)).toContain('id="language"');
    expect(html.slice(fallbackStart, fallbackEnd)).toContain('id="backend-url"');
    expect(html.slice(fallbackStart, fallbackEnd)).toContain('id="password"');
    expect(html.match(/<button\b/gu)).toHaveLength(1);
    expect(html).not.toContain('<details id="fallback-controls" open>');
  });
});

describe('extension settings', () => {
  it('normalizes the backend URL and falls back to the local default on garbage', () => {
    expect(normalizeBackendUrl('https://app.example.workers.dev/')).toBe(
      'https://app.example.workers.dev',
    );
    expect(normalizeBackendUrl('  http://127.0.0.1:8787  ')).toBe('http://127.0.0.1:8787');
    expect(normalizeBackendUrl('')).toBe(DEFAULT_BACKEND_URL);
    expect(normalizeBackendUrl('not a url')).toBe(DEFAULT_BACKEND_URL);
    expect(normalizeBackendUrl('ftp://nope.example')).toBe(DEFAULT_BACKEND_URL);
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
      url: 'https://youtu.be/dQw4w9WgXcQ',
      title: undefined,
    });
  });
});
