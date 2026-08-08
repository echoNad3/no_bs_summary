import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SummaryResult } from '../apps/shared/api-client.js';
import { summaryClipboardText } from '../apps/shared/summary-actions.js';
import { parseSummaryBlocks } from '../apps/shared/summary-format.js';

describe('local MVP manifests', () => {
  it('declares an installable PWA with an Android URL share target', async () => {
    const manifest = JSON.parse(
      await fs.readFile('apps/pwa/public/manifest.webmanifest', 'utf8'),
    ) as Record<string, unknown>;

    expect(manifest).toMatchObject({
      name: 'No BS Summary',
      short_name: 'No BS',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#0d0f12',
      theme_color: '#0d0f12',
      prefer_related_applications: false,
      share_target: {
        action: '/share',
        method: 'GET',
        enctype: 'application/x-www-form-urlencoded',
        params: { title: 'title', text: 'text', url: 'url' },
      },
    });
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: '192x192', type: 'image/png', purpose: 'any' }),
        expect.objectContaining({ sizes: '512x512', type: 'image/png', purpose: 'any' }),
        expect.objectContaining({ sizes: '512x512', type: 'image/png', purpose: 'maskable' }),
      ]),
    );
  });

  it('keeps both product surfaces dark-only with shared design tokens and no light flash', async () => {
    const [theme, pwaCss, extensionCss, pwaHtml, extensionHtml] = await Promise.all(
      [
        'apps/shared/theme.css',
        'apps/pwa/src/styles.css',
        'apps/extension/src/styles.css',
        'apps/pwa/index.html',
        'apps/extension/sidepanel.html',
      ].map((file) => fs.readFile(file, 'utf8')),
    );

    expect(theme).toContain('color-scheme: dark');
    expect(theme).toContain('--color-bg: #0d0f12');
    expect(theme).toContain('--color-text: #f5f7fa');
    expect(theme).toContain('--color-border:');
    expect(pwaCss).toContain("@import '../../shared/theme.css'");
    expect(extensionCss).toContain("@import '../../shared/theme.css'");
    expect(`${pwaCss}\n${extensionCss}`).not.toMatch(/#(?:fffdf8|f1eee7|161616)\b/iu);

    for (const html of [pwaHtml, extensionHtml]) {
      expect(html).toContain('<meta name="color-scheme" content="dark" />');
      expect(html).toContain('background: #0d0f12');
      expect(html).not.toMatch(/theme[- ]toggle|light mode/iu);
    }
  });

  it('keeps the extension minimal and limited to production plus supported YouTube tabs', async () => {
    const manifestText = await fs.readFile('apps/extension/public/manifest.json', 'utf8');
    const manifest = JSON.parse(manifestText) as Record<string, unknown>;

    expect(manifest).toMatchObject({
      manifest_version: 3,
      name: 'No BS Summary',
      version: '0.3.0',
      minimum_chrome_version: '114',
      permissions: ['sidePanel', 'storage'],
      background: { service_worker: 'background.js', type: 'module' },
      side_panel: { default_path: 'sidepanel.html' },
    });
    expect(manifest.host_permissions).toEqual(
      expect.arrayContaining([
        'https://no-bullshit-summary.echonad3.workers.dev/*',
        'https://youtube.com/*',
        'https://www.youtube.com/*',
        'https://m.youtube.com/*',
        'https://music.youtube.com/*',
        'https://youtu.be/*',
      ]),
    );
    expect(manifestText).not.toContain('http://127.0.0.1');
    expect(manifestText).not.toMatch(/TRANSCRIPTAPI_API_KEY|GEMINI_API_KEY/u);
  });

  it('ships the privacy policy and links it from the hosted app', async () => {
    const [privacy, pwaHtml] = await Promise.all([
      fs.readFile('apps/pwa/public/privacy.html', 'utf8'),
      fs.readFile('apps/pwa/index.html', 'utf8'),
    ]);

    expect(pwaHtml).toContain('href="/privacy"');
    expect(privacy).toMatch(/Chrome\s+Web Store User Data Policy/u);
    expect(privacy).toContain('The URL and title of the active YouTube video.');
    expect(privacy).toContain('The shared app password you enter.');
    expect(privacy).toMatch(/Full transcripts and the app password are not\s+stored/u);
  });

  it('turns a multi-topic detailed summary into separate labeled blocks', () => {
    expect(
      parseSummaryBlocks(
        '- **First topic:** Specific facts stay together.\n\n- **Second topic:** The conclusion stays separate.',
      ),
    ).toEqual([
      { kind: 'topic', label: 'First topic', body: 'Specific facts stay together.' },
      { kind: 'topic', label: 'Second topic', body: 'The conclusion stays separate.' },
    ]);
  });

  it('copies a clean, useful summary with context and no markdown decoration', () => {
    const response: SummaryResult = {
      verdict: 'WATCH',
      reason: 'Specific, useful, and concise.',
      summary: '- **First topic:** One fact.\n\n- **Second topic:** Another fact.',
      videoId: 'dQw4w9WgXcQ',
      language: 'en',
      source: 'CACHED',
      timing: { summaryMs: 10 },
      retries: { transcript: 0, summary: 0 },
    };

    expect(
      summaryClipboardText(response, {
        title: 'Useful video',
        url: 'https://youtu.be/dQw4w9WgXcQ',
      }),
    ).toBe(
      'Useful video\n\nWATCH: Specific, useful, and concise.\n\nFirst topic: One fact.\n\nSecond topic: Another fact.\n\nhttps://youtu.be/dQw4w9WgXcQ\n\nSummarized with No BS Summary',
    );
  });

  it('precaches the built JS and CSS needed for a first offline launch', async () => {
    const worker = await fs.readFile('apps/pwa/public/sw.js', 'utf8');
    expect(worker).toContain("const CACHE = 'nbs-shell-v3'");
    expect(worker).toContain("event.data?.type === 'SKIP_WAITING'");
    expect(worker).toContain('/\\.(?:css|js)$/u');
    expect(worker).toContain("'/icons/icon-192.svg'");
    expect(worker).toContain('precacheAppShell');
  });

  it('ships the approved recovery, readability, preview, and help controls', async () => {
    const [pwa, extension] = await Promise.all([
      fs.readFile('apps/pwa/index.html', 'utf8'),
      fs.readFile('apps/extension/sidepanel.html', 'utf8'),
    ]);

    for (const html of [pwa, extension]) {
      expect(html).toContain('id="help-button"');
      expect(html).toContain('id="cancel-request"');
      expect(html).toContain('id="retry-request"');
      expect(html).toContain('id="copy-diagnostics"');
      expect(html).toContain('id="test-connection"');
      expect(html).toContain('id="text-size"');
      expect(html).toContain('id="video-thumbnail"');
      expect(html).toContain('id="reading-stats"');
    }
    expect(pwa).toContain('id="share-summary"');
    expect(extension).toContain('id="lock-video"');
  });
});
