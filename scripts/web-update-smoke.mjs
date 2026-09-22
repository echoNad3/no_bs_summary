import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const projectDir = process.cwd();
const pwaDir = path.resolve(projectDir, 'dist/pwa');
const resultsDir = path.resolve(projectDir, 'results');
const firstUrl = 'https://www.youtube.com/watch?v=lz6FLIgzFps';
const secondUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const fixture = {
  outputVersion: 2,
  verdict: 'SKIM',
  reason:
    'Interesting medical claims, but the speaker repeats himself and drags the useful comparison out.',
  summary:
    '- **Main claim:** The speaker argues that underdeveloped jaws can restrict breathing during sleep and contribute to fatigue and concentration problems.\n\n- **Options discussed:** He compares surgery with appliances intended to widen the upper jaw, while acknowledging that evidence for changing adult bone without surgery is disputed.\n\n- **Practical takeaway:** Persistent breathing problems need a qualified professional, not one creator’s experience treated as a universal diagnosis.',
  videoId: 'lz6FLIgzFps',
  language: 'en',
  source: 'LIVE',
  timing: { transcriptMs: 10, summaryMs: 20, totalMs: 30 },
  retries: { transcript: 0, summary: 0 },
};

let serviceWorkerVersion = 1;
let holdSummary = false;
let releaseHeldSummary;
let summaryRequests = 0;
const server = createStaticServer();
let browser;
let context;
let failure;
const report = {
  startedAt: new Date().toISOString(),
  checks: {},
};

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Static test server did not start.');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(500);
  await page.goto(baseUrl);
  await page.locator('h1').waitFor({ state: 'visible' });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await page.locator('#url').fill(firstUrl);
  holdSummary = true;
  await page.locator('#submit').click();
  await page.locator('#cancel-request').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'Working…');
  await installUpdateRecorder(page, 'active-request');

  serviceWorkerVersion = 2;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
  await page.waitForFunction(() => globalThis.__nbsControllerChanges >= 1);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => globalThis.__nbsReloadMarker), 'active-request');
  assert.equal(await page.locator('#status').innerText(), 'Working…');
  assert.equal(await page.locator('#url').inputValue(), firstUrl);
  report.checks.noReloadDuringActiveRequest = true;

  const activeNavigation = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  holdSummary = false;
  assert.equal(typeof releaseHeldSummary, 'function');
  releaseHeldSummary();
  await activeNavigation;
  await page.locator('#result').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#url').inputValue(), firstUrl);
  assert.equal(await page.locator('#verdict').innerText(), 'SKIM');
  assert.match(await page.locator('#summary').innerText(), /qualified professional/iu);
  assert.equal(summaryRequests, 1);
  report.checks.resultAndInputRestoredAfterActiveUpdate = true;
  report.checks.noUnexpectedPaidRequest = true;

  await page.locator('#url').fill(secondUrl);
  assert.equal(await page.locator('#result').isHidden(), true);
  await installUpdateRecorder(page, 'idle-update');
  serviceWorkerVersion = 3;
  const idleNavigation = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await page
    .evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    })
    .catch(() => undefined);
  await idleNavigation;
  await page.locator('h1').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#url').inputValue(), secondUrl);
  assert.equal(await page.locator('#result').isHidden(), true);
  assert.equal(summaryRequests, 1);
  report.checks.idleUpdatePreservesDraftWithoutRegeneration = true;
} catch (error) {
  failure = error;
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await context?.close();
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  report.summaryRequests = summaryRequests;
  report.finishedAt = new Date().toISOString();
  await fs.mkdir(resultsDir, { recursive: true });
  const stamp = report.finishedAt.replace(/[:.]/gu, '-');
  const resultPath = path.join(resultsDir, `web-update-smoke-${stamp}.json`);
  await fs.writeFile(resultPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Web update smoke result: ${resultPath}`);
  console.log(JSON.stringify(report, null, 2));
}

if (failure) throw failure;

async function installUpdateRecorder(page, marker) {
  await page.evaluate((value) => {
    globalThis.__nbsControllerChanges = 0;
    globalThis.__nbsReloadMarker = value;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      globalThis.__nbsControllerChanges += 1;
    });
  }, marker);
}

function createStaticServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/sw.js') {
      const worker = await fs.readFile(path.join(pwaDir, 'sw.js'), 'utf8');
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(`${worker}\n// smoke-version-${serviceWorkerVersion}\n`);
      return;
    }
    if (url.pathname === '/api/video-metadata') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ title: 'Update smoke video' }));
      return;
    }
    if (url.pathname === '/api/summarize') {
      summaryRequests += 1;
      if (holdSummary) {
        await new Promise((resolve) => {
          releaseHeldSummary = () => {
            resolve();
          };
        });
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(fixture));
      return;
    }

    const requested =
      url.pathname === '/' || url.pathname === '/share' ? 'index.html' : url.pathname.slice(1);
    const resolved = path.resolve(pwaDir, requested);
    const safeRoot = path.resolve(pwaDir) + path.sep;
    if (resolved !== path.resolve(pwaDir, 'index.html') && !resolved.startsWith(safeRoot)) {
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
