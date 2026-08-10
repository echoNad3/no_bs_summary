import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const projectDir = process.cwd();
const extensionDir = path.join(projectDir, 'dist', 'extension');
const storeDir = path.join(projectDir, 'store');
const iconPath = path.join(projectDir, 'apps', 'pwa', 'public', 'icons', 'icon-512.svg');
const productionApiUrl = 'https://no-bs-summary.echonad3.workers.dev/api/summarize';
const youtubeUrl = 'https://www.youtube.com/watch?v=storePrev01';
const videoTitle = 'The honest guide to building useful small software';
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nbs-store-assets-'));

const previewResponse = {
  verdict: 'WATCH',
  reason: 'Clear, practical advice with concrete trade-offs and almost no padding.',
  summary:
    '- **Why small tools win:** Focused software can solve one annoying problem well without accounts, dashboards, or a pile of settings. The speaker argues that fewer moving parts make a tool easier to understand, maintain, and trust.\n\n' +
    '- **What to build:** Start with the exact action a user wants to complete, keep the interface close to that action, and automate only the repetitive work. Add features only when real use exposes a repeated gap.\n\n' +
    '- **Trade-offs:** A narrow tool serves fewer people, but it costs less to run and is less likely to break. The conclusion is to optimize for repeated usefulness instead of feature count.',
  videoId: 'storePrev01',
  language: 'en',
  source: 'CACHED',
  timing: { transcriptMs: 18, summaryMs: 1582, totalMs: 1600 },
  retries: { transcript: 0, summary: 0 },
};

await fs.access(path.join(extensionDir, 'manifest.json'));
await fs.mkdir(storeDir, { recursive: true });

let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });

  await context.route('https://www.youtube.com/**', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: youtubePreviewHtml(videoTitle),
    });
  });
  await context.route(productionApiUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(previewResponse),
    });
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  const extensionId = new URL(worker.url()).host;
  assert.match(extensionId, /^[a-p]{32}$/u);

  const youtubePage = await context.newPage();
  await youtubePage.setViewportSize({ width: 890, height: 800 });
  await youtubePage.goto(youtubeUrl);
  await youtubePage.locator('h1').waitFor({ state: 'visible' });

  const panelPage = await context.newPage();
  await panelPage.setViewportSize({ width: 390, height: 800 });
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await youtubePage.bringToFront();
  await panelPage.waitForFunction(
    (expected) => document.querySelector('#detected-title')?.textContent === expected,
    videoTitle,
  );
  await panelPage.locator('#password').fill('store-preview');
  await panelPage.locator('#close-settings').click();
  await panelPage.locator('#submit').click();
  await panelPage.locator('#result').waitFor({ state: 'visible' });

  const [youtubePng, panelPng] = await Promise.all([
    youtubePage.screenshot({ type: 'png', animations: 'disabled' }),
    panelPage.screenshot({ type: 'png', animations: 'disabled' }),
  ]);

  const composer = await context.newPage();
  await composer.setViewportSize({ width: 1280, height: 800 });
  await composer.setContent(`
    <!doctype html>
    <style>
      html, body { width: 1280px; height: 800px; margin: 0; overflow: hidden; background: #161616; }
      img { position: absolute; top: 0; height: 800px; display: block; }
      .video { left: 0; width: 890px; }
      .panel { right: 0; width: 390px; box-shadow: -10px 0 30px rgb(0 0 0 / 35%); }
    </style>
    <img class="video" src="data:image/png;base64,${youtubePng.toString('base64')}" alt="" />
    <img class="panel" src="data:image/png;base64,${panelPng.toString('base64')}" alt="" />
  `);
  await composer.screenshot({
    path: path.join(storeDir, 'screenshot-1280x800.png'),
    type: 'png',
  });

  const iconSvg = await fs.readFile(iconPath, 'utf8');
  const iconUrl = `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}`;
  await composer.setViewportSize({ width: 440, height: 280 });
  await composer.setContent(`
    <!doctype html>
    <style>
      html, body { width: 440px; height: 280px; margin: 0; overflow: hidden; }
      body {
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at 76% 18%, rgb(232 100 55 / 45%), transparent 34%),
          radial-gradient(circle at 14% 92%, rgb(232 100 55 / 22%), transparent 42%),
          #161616;
      }
      .halo {
        width: 190px;
        height: 190px;
        display: grid;
        place-items: center;
        border-radius: 46px;
        background: rgb(255 255 255 / 4%);
        box-shadow: 0 30px 70px rgb(0 0 0 / 45%);
      }
      img { width: 150px; height: 150px; display: block; }
    </style>
    <div class="halo"><img src="${iconUrl}" alt="" /></div>
  `);
  await composer.locator('img').evaluate((image) => image.decode());
  await composer.screenshot({
    path: path.join(storeDir, 'small-promo-440x280.png'),
    type: 'png',
  });
} finally {
  if (context) await context.close();
  await fs.rm(userDataDir, { recursive: true, force: true });
}

console.log(`Generated Chrome Web Store images in ${storeDir}`);

function youtubePreviewHtml(title) {
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>${title} - YouTube</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; color: #0f0f0f; background: #fff; font: 14px Arial, sans-serif; }
          nav { height: 64px; display: flex; align-items: center; gap: 18px; padding: 0 24px; border-bottom: 1px solid #eee; }
          .menu { font-size: 24px; }
          .brand { display: flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 800; }
          .play-mark { width: 30px; height: 22px; border-radius: 7px; background: #ff0033; position: relative; }
          .play-mark::after { content: ''; position: absolute; left: 12px; top: 6px; border: 5px solid transparent; border-left: 8px solid white; }
          .search { width: 360px; height: 38px; margin-left: auto; border: 1px solid #ccc; border-radius: 22px; background: #fafafa; }
          main { padding: 24px 30px; }
          .player { height: 500px; display: grid; place-items: center; border-radius: 14px; background: radial-gradient(circle at 50% 30%, #363636, #090909 62%); }
          .player-icon { width: 78px; height: 78px; border-radius: 50%; display: grid; place-items: center; color: white; background: rgb(255 255 255 / 16%); font-size: 34px; }
          h1 { margin: 18px 0 12px; font-size: 22px; line-height: 1.3; }
          .meta { display: flex; align-items: center; gap: 12px; color: #606060; }
          .avatar { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #e86437, #161616); }
          .channel { color: #0f0f0f; font-weight: 700; }
          .pill { margin-left: auto; padding: 10px 18px; border-radius: 20px; color: white; background: #0f0f0f; font-weight: 700; }
        </style>
      </head>
      <body>
        <nav>
          <span class="menu">☰</span>
          <span class="brand"><span class="play-mark"></span>YouTube</span>
          <span class="search"></span>
        </nav>
        <main>
          <div class="player"><span class="player-icon">▶</span></div>
          <h1>${title}</h1>
          <div class="meta">
            <span class="avatar"></span>
            <span><span class="channel">Useful Software</span><br />128K subscribers</span>
            <span class="pill">Subscribe</span>
          </div>
        </main>
      </body>
    </html>`;
}
