import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getYouTubeTabContext } from '../apps/extension/src/tab-context.js';

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
    expect(html.match(/<button\b/gu)).toHaveLength(1);
    expect(html).not.toContain('<details id="fallback-controls" open>');
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
