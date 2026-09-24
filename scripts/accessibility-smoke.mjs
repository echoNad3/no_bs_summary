import { AxeBuilder } from '@axe-core/playwright';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const projectDir = process.cwd();
const pwaDir = path.join(projectDir, 'dist', 'pwa');
const extensionDir = path.join(projectDir, 'dist', 'extension');
const screenshotDir = process.env.NBS_UI_SCREENSHOT_DIR;
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nbs-a11y-'));
const defaultSummaryFixture = {
  outputVersion: 2,
  verdict: 'SKIM',
  reason:
    'Interesting medical and structural insights, but buried under self-indulgent, rambling personal anecdotes and repetitive sponsorship filler.',
  summary:
    '- **Main claim:** The speaker argues that underdeveloped jaws can restrict breathing during sleep and contribute to fatigue and poor concentration.\n\n- **Options discussed:** He compares surgery with appliances intended to widen the upper jaw, while acknowledging that evidence for changing adult bone without surgery is disputed.\n\n- **Practical takeaway:** Persistent breathing problems need a qualified professional, not one creator’s experience treated as a universal diagnosis.',
  videoId: 'lz6FLIgzFps',
  language: 'en',
  source: 'LIVE',
  timing: { transcriptMs: 125, summaryMs: 250, totalMs: 375 },
  retries: { transcript: 0, summary: 0 },
};
const summaryFixture = process.env.NBS_SUMMARY_FIXTURE
  ? JSON.parse(await fs.readFile(process.env.NBS_SUMMARY_FIXTURE, 'utf8')).body
  : defaultSummaryFixture;
const server = createStaticServer(pwaDir, summaryFixture);
let browser;
let pwaContext;
let extensionContext;

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Static test server did not start.');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  browser = await chromium.launch({ headless: true });
  pwaContext = await browser.newContext({
    viewport: { width: 412, height: 915 },
    serviceWorkers: 'block',
  });
  await pwaContext.route(
    'https://api.github.com/repos/echoNad3/no_bs_summary/releases/latest',
    async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          tag_name: 'android-v80',
          published_at: '2026-08-10T00:00:00.000Z',
        }),
      });
    },
  );
  const pwaPage = await pwaContext.newPage();
  await pwaPage.goto(baseUrl);
  await pwaPage.locator('#settings-button').click();
  await pwaPage.locator('#settings-dialog').waitFor({ state: 'visible' });
  await assertAccessible(pwaPage, 'PWA settings dialog');
  await pwaPage.locator('#close-settings').click();
  await assertAccessible(pwaPage, 'Android PWA');
  await pwaPage.locator('#url').fill(`https://www.youtube.com/watch?v=${summaryFixture.videoId}`);
  await pwaPage.locator('#summary-form').evaluate((form) => form.requestSubmit());
  await pwaPage.locator('#result').waitFor({ state: 'visible' });
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 412, height: 915 },
  ]) {
    await pwaPage.setViewportSize(viewport);
    await assertSummaryResult(pwaPage, `PWA summary at ${viewport.width}x${viewport.height}`);
    if (screenshotDir && viewport.width === 360) {
      await fs.mkdir(screenshotDir, { recursive: true });
      await pwaPage.screenshot({
        path: path.join(screenshotDir, 'pwa-summary-360x800.png'),
        fullPage: true,
      });
    }
  }
  await pwaPage.locator('#settings-button').click();
  await pwaPage.locator('#text-size').selectOption('extra-large');
  await pwaPage.locator('#close-settings').click();
  await pwaPage.setViewportSize({ width: 360, height: 800 });
  await assertSummaryResult(pwaPage, 'PWA extra-large summary at 360x800');
  await pwaContext.close();
  pwaContext = undefined;
  await browser.close();
  browser = undefined;

  extensionContext = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  let worker = extensionContext.serviceWorkers()[0];
  if (!worker) worker = await extensionContext.waitForEvent('serviceworker', { timeout: 10_000 });
  const extensionId = new URL(worker.url()).host;
  await extensionContext.route('https://www.youtube.com/**', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Accessibility video - YouTube</title><h1>Video</h1>',
    });
  });
  const youtubePage = await extensionContext.newPage();
  await youtubePage.goto(`https://www.youtube.com/watch?v=${summaryFixture.videoId}`);
  const extensionPage = await extensionContext.newPage();
  await extensionPage.setViewportSize({ width: 320, height: 800 });
  await extensionPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await youtubePage.bringToFront();
  await extensionPage.waitForFunction(
    () => document.querySelector('#detected-title')?.textContent === 'Accessibility video',
  );
  await extensionPage.locator('#settings-button').click();
  await extensionPage.locator('#settings-dialog').waitFor({ state: 'visible' });
  await assertAccessible(extensionPage, 'Extension settings dialog');
  await extensionPage.evaluate(() => {
    const dialog = document.querySelector('#settings-dialog');
    if (!(dialog instanceof HTMLDialogElement)) throw new Error('Settings dialog missing.');
    dialog.close();
  });
  await youtubePage.bringToFront();
  await extensionPage.waitForFunction(
    () => document.querySelector('#detected-title')?.textContent === 'Accessibility video',
  );
  await extensionPage.waitForTimeout(250);
  await extensionPage.locator('#settings-dialog').waitFor({ state: 'hidden' });
  await assertAccessible(extensionPage, 'Chrome side panel');

  console.log(
    'Accessibility smoke: the populated PWA and both client shells passed their Axe and layout checks.',
  );
} finally {
  await extensionContext?.close();
  await pwaContext?.close();
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(userDataDir, { recursive: true, force: true });
}

async function assertAccessible(page, label) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  if (violations.length === 0) return;
  const detail = violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}\n` +
        violation.nodes
          .map((node) => `  ${node.target.join(' ')}: ${node.failureSummary}`)
          .join('\n'),
    )
    .join('\n');
  throw new Error(`${label} has accessibility violations:\n${detail}`);
}

async function assertSummaryResult(page, label) {
  await assertAccessible(page, label);
  if (!(await page.locator('#result').isVisible())) {
    throw new Error(`${label} disappeared while it was being checked.`);
  }
  const result = await page.locator('#result').evaluate((element) => {
    const verdict = element.querySelector('#verdict')?.textContent?.trim() ?? '';
    const reason = element.querySelector('#reason')?.textContent?.trim() ?? '';
    const summary = element.querySelector('#summary')?.textContent?.trim() ?? '';
    const points = element.querySelectorAll('#summary > .summary-topics > li');
    const emptyBlocks = [...element.querySelectorAll('#summary > *')].filter(
      (block) => !block.textContent?.trim(),
    ).length;
    const wordCount = `${verdict} ${reason} ${summary}`.trim().split(/\s+/u).filter(Boolean).length;
    return {
      wordCount,
      pointCount: points.length,
      emptyBlocks,
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  if (result.wordCount > 200) {
    throw new Error(`${label} rendered ${result.wordCount} words; expected at most 200.`);
  }
  if (result.pointCount < 1 || result.pointCount > 3 || result.emptyBlocks > 0) {
    throw new Error(
      `${label} rendered ${result.pointCount} points and ${result.emptyBlocks} empty blocks.`,
    );
  }
  if (result.documentWidth > result.viewportWidth) {
    throw new Error(
      `${label} overflows horizontally (${result.documentWidth}px > ${result.viewportWidth}px).`,
    );
  }
}

function createStaticServer(root, fixture) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/summarize') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(fixture));
      return;
    }
    if (url.pathname === '/api/video-metadata') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({ title: 'Looksmaxxers are accidentally solving this epidemic' }),
      );
      return;
    }
    const requested =
      url.pathname === '/' || url.pathname === '/share' ? 'index.html' : url.pathname.slice(1);
    const resolved = path.resolve(root, requested);
    const safeRoot = path.resolve(root) + path.sep;
    if (resolved !== path.resolve(root, 'index.html') && !resolved.startsWith(safeRoot)) {
      response.writeHead(400).end();
      return;
    }
    try {
      const body = await fs.readFile(resolved);
      response.setHeader('Content-Type', contentType(resolved));
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
}

function contentType(file) {
  switch (path.extname(file)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
    case '.webmanifest':
      return 'application/json';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}
