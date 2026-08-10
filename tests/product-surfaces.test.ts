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
    const [theme, sharedCss, pwaCss, extensionCss, pwaHtml, extensionHtml] = await Promise.all(
      [
        'apps/shared/theme.css',
        'apps/shared/app.css',
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
    expect(theme).toContain('--space-6: 24px');
    expect(theme).toContain('--tap: 48px');
    expect(sharedCss).toContain('width: min(100%, 460px)');
    expect(sharedCss).toContain('border-radius: var(--radius-card)');
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
      version: '0.5.0',
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

  it('ships the required privacy policy without adding it to the primary UI', async () => {
    const [privacy, pwaHtml] = await Promise.all([
      fs.readFile('apps/pwa/public/privacy.html', 'utf8'),
      fs.readFile('apps/pwa/index.html', 'utf8'),
    ]);

    expect(pwaHtml).not.toContain('href="/privacy"');
    expect(privacy).toMatch(/Chrome\s+Web Store User Data Policy/u);
    expect(privacy).toContain('The URL and title of the active YouTube video.');
    expect(privacy).toContain('shared app password');
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
    expect(worker).toContain("const CACHE = 'nbs-shell-v8'");
    expect(worker).toContain("event.data?.type === 'SKIP_WAITING'");
    expect(worker).toContain('/\\.(?:css|js)$/u');
    expect(worker).toContain("'/icons/icon-192.svg'");
    expect(worker).toContain('precacheAppShell');
  });

  it('keeps secondary controls in Settings and removes explanatory clutter', async () => {
    const [pwa, extension] = await Promise.all([
      fs.readFile('apps/pwa/index.html', 'utf8'),
      fs.readFile('apps/extension/sidepanel.html', 'utf8'),
    ]);

    for (const html of [pwa, extension]) {
      expect(html).toContain('id="cancel-request"');
      expect(html).toContain('id="retry-request"');
      expect(html).toContain('id="copy-diagnostics"');
      expect(html).toContain('id="test-connection"');
      expect(html).toContain('id="save-settings"');
      expect(html).toContain('id="text-size"');
      expect(html).toContain('id="video-thumbnail"');
      expect(html).toContain('class="control-icon"');
      expect(html).toContain('id="settings-button"');
      expect(html).not.toContain('id="help-button"');
      expect(html).not.toContain('id="language"');
      expect(html).not.toContain('id="reading-stats"');
      expect(html).not.toContain('id="meta"');
      expect(html).not.toContain('&#x24d8;');
      expect(html).not.toMatch(/YouTube, without the padding|Cached summaries reopen instantly/iu);
      expect(html).not.toMatch(
        /These preferences stay on this device|Must match the server password/iu,
      );
    }
    expect(pwa).toContain('id="share-summary"');
    expect(pwa).toContain('id="app-update-action"');
    expect(pwa).toContain('id="android-update-status"');
    expect(pwa).toContain('id="install-pwa"');
    expect(pwa).toContain(
      'https://chromewebstore.google.com/detail/no-bs-summary/fnphiadakmbpimdclfohfpbbliejhnmc',
    );
    expect(pwa).toContain('https://github.com/echoNad3/no_bullshit_summary');
    expect(pwa).toContain('https://transcriptapi.com/billing');
    expect(extension).not.toContain('id="lock-video"');
    expect(extension).toContain('class="manual-link-field"');
    expect(extension).toContain(
      'https://chromewebstore.google.com/detail/no-bs-summary/fnphiadakmbpimdclfohfpbbliejhnmc',
    );
  });

  it('keeps one canonical logo source and current palette across product surfaces', async () => {
    const [source, icon192, icon512, splash] = await Promise.all([
      fs.readFile('brand/no-bs-summary-logo.svg', 'utf8'),
      fs.readFile('apps/pwa/public/icons/icon-192.svg', 'utf8'),
      fs.readFile('apps/pwa/public/icons/icon-512.svg', 'utf8'),
      fs.readFile('apps/android/app/src/main/res/drawable/splash_logo_vector.xml', 'utf8'),
    ]);
    for (const asset of [source, icon192, icon512]) {
      expect(asset).toContain('#f5f7fa');
      expect(asset).toContain('#ff8a61');
      expect(asset).not.toContain('#e86437');
      expect(asset).not.toContain('#f1eee7');
    }
    expect(splash).toContain('#F5F7FA');
    expect(splash).toContain('#FF8A61');
  });
});
