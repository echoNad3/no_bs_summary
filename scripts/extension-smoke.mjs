import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const projectDir = process.cwd();
const pwaDir = path.resolve(projectDir, 'dist/pwa');
const extensionDir = path.resolve(projectDir, 'dist/extension');
const resultsDir = path.resolve(projectDir, 'results');
const youtubeUrl = 'https://www.youtube.com/watch?v=EwMSGdE2bOQ';
const secondYoutubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const productionApiUrl = 'https://no-bs-summary.echonad3.workers.dev/api/summarize';
const productionStatusUrl = 'https://no-bs-summary.echonad3.workers.dev/api/status';
let baseUrl = '';
let localApiUrl = '';
let localStatusUrl = '';
const summaryFixture = {
  verdict: 'SKIM',
  reason: 'The useful updates are specific, but the commentary circles around them.',
  summary: [
    "- **Wizard Detective:** The segment explains the project's mystery structure and the clues already shown.\n  **Main appeal:** Its restrained presentation is more interesting than a conventional lore dump.",
    "- **Kane Pixels**: The discussion separates the creator's newer work from the familiar *Backrooms* material and points out the production choices that make the environments feel unusually physical.",
    '- **Backrooms projects:** Several adaptations are compared by how well they preserve uncertainty instead of replacing it with an oversized monster catalogue and repetitive chase scenes.',
    '- **Release updates:** The concrete announcements, delays, and production notes are collected in one place so the useful facts can be skimmed without sitting through every tangent.',
    '- **What to skip:** Repeated reactions, sponsor-like detours, and speculative loops add runtime without changing the core assessment of any project mentioned in the episode.',
  ].join('\n'),
  videoId: 'EwMSGdE2bOQ',
  language: 'en',
  source: 'CACHED',
  timing: { transcriptMs: 8, summaryMs: 14, totalMs: 22 },
  retries: { transcript: 0, summary: 0 },
};
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nbs-extension-smoke-'));
const server = createStaticServer(pwaDir);
const startedAt = new Date().toISOString();

const report = {
  startedAt,
  extensionDir,
  userDataDir,
  isolatedProfile: true,
  transcriptApiRequests: 0,
  checks: {},
  output: undefined,
  diagnostics: undefined,
  manualChromeCheck:
    'Clicking the toolbar action and seeing a native side-panel surface still requires one manual Chrome check; this harness verifies the configured action behavior and the real side-panel document.',
};

let context;
let failure;

try {
  await fs.access(path.join(extensionDir, 'manifest.json'));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Static test server did not start.');
  baseUrl = `http://127.0.0.1:${address.port}`;
  localApiUrl = `${baseUrl}/api/summarize`;
  localStatusUrl = `${baseUrl}/api/status`;

  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });

  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const responses = [];
  const requests = [];

  const watchPage = (page) => {
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleErrors.push({ type: message.type(), text: message.text(), url: page.url() });
      }
    });
    page.on('pageerror', (error) => pageErrors.push({ message: error.message, url: page.url() }));
    page.on('request', (request) => requests.push(request.url()));
    page.on('requestfailed', (request) =>
      requestFailures.push({
        url: request.url(),
        errorText: request.failure()?.errorText ?? 'unknown',
      }),
    );
    page.on('response', (response) => {
      if (response.status() >= 400)
        responses.push({ url: response.url(), status: response.status() });
    });
  };

  for (const page of context.pages()) watchPage(page);
  context.on('page', watchPage);

  await context.route('https://www.youtube.com/**', async (route) => {
    const isSecondVideo = route.request().url().includes('dQw4w9WgXcQ');
    const title = isSecondVideo ? 'Rick Astley Smoke' : 'PyroLIVE Smoke';
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>${title} - YouTube</title><h1>${title}</h1>`,
    });
  });

  await context.route('https://i.ytimg.com/**', async (route) => {
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#242933"/></svg>',
    });
  });

  await context.route(
    'https://api.github.com/repos/echoNad3/no_bs_summary/releases/latest',
    async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          tag_name: 'android-v80',
          name: 'Android APK build 80',
          published_at: '2026-08-10T00:00:00.000Z',
        }),
      });
    },
  );

  await context.route(localApiUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(summaryFixture),
    });
  });
  await context.route(localStatusUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        access: 'owner',
        dailyGeneration: {
          used: 0,
          limit: 300,
          remaining: 300,
          resetsAt: '2026-08-30T00:00:00.000Z',
        },
        freeGeneration: {
          user: {
            used: 0,
            limit: 5,
            remaining: 5,
            resetsAt: '2026-09-01T00:00:00.000Z',
          },
          shared: {
            used: 0,
            limit: 50,
            remaining: 50,
            resetsAt: '2026-09-01T00:00:00.000Z',
          },
        },
      }),
    });
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  const extensionId = new URL(worker.url()).host;
  assert.match(extensionId, /^[a-p]{32}$/u);

  const panelBehavior = await worker.evaluate(async () => chrome.sidePanel.getPanelBehavior());
  assert.equal(panelBehavior.openPanelOnActionClick, true);
  report.checks.sidePanelActionConfigured = true;

  const pwaPage = await context.newPage();
  await pwaPage.setViewportSize({ width: 412, height: 915 });
  await pwaPage.addInitScript(() => {
    globalThis.__nbsSharedPayload = undefined;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (payload) => {
        globalThis.__nbsSharedPayload = payload;
      },
    });
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: baseUrl,
  });
  await pwaPage.goto(`${baseUrl}/`);
  await pwaPage.locator('h1').waitFor({ state: 'visible' });
  assert.equal(await pwaPage.locator('h1').innerText(), 'No BS Summary');
  const pwaSettings = pwaPage.locator('#settings-dialog');
  assert.equal(await pwaSettings.isVisible(), false);
  await pwaPage.locator('#settings-button').click();
  assert.equal(await pwaSettings.isVisible(), true);
  await pwaPage.locator('#password').fill('test-password');
  await pwaPage.locator('#text-size').selectOption('large');
  assert.equal(await pwaPage.locator('html').getAttribute('data-text-size'), 'large');
  await pwaPage.locator('#test-connection').click();
  await waitForText(pwaPage.locator('#connection-status'), 'Connected · 300/300 daily remaining');
  assert.equal(await pwaPage.locator('#connection-status').getAttribute('data-state'), 'success');
  await waitForText(pwaPage.locator('#free-user-usage'), '5/5 left');
  await waitForText(pwaPage.locator('#free-shared-usage'), '50/50 left');
  assert.equal(
    await pwaPage.locator('#settings-dialog a[href*="transcriptapi.com/billing"]').isVisible(),
    true,
  );
  assert.equal(
    await pwaPage.locator('#settings-dialog a[href*="github.com/echoNad3"]').isVisible(),
    true,
  );
  await waitForText(pwaPage.locator('#android-update-status'), 'APK available.');
  await pwaPage.locator('#close-settings').click();
  await assertHeaderControlsAligned(pwaPage);
  await assertNoHorizontalOverflow(pwaPage);
  await pwaPage.locator('#url').fill(youtubeUrl);
  await pwaPage.locator('#video-thumbnail').waitFor({ state: 'visible' });
  await installLoadingRecorder(pwaPage);
  const pwaResponsePromise = waitForSummaryResponse(pwaPage);
  await pwaPage.locator('#submit').click();
  const pwaPayload = await (await pwaResponsePromise).json();
  await pwaPage.locator('#result').waitFor({ state: 'visible', timeout: 20_000 });
  await assertLoadingRecorded(pwaPage);
  assert.equal(await pwaSettings.isHidden(), true);
  const pwaOutput = await readRenderedOutput(pwaPage);
  assertSummaryOutput(pwaOutput);
  await assertDetailedTopics(pwaPage);
  await assertInlineFormatting(pwaPage);
  await pwaPage.locator('#copy-summary').click();
  assert.match(await pwaPage.evaluate(() => navigator.clipboard.readText()), /SKIM:/u);
  assert.equal(await pwaPage.locator('#copy-summary').innerText(), 'Copied');
  assert.equal(await pwaPage.locator('#open-video').getAttribute('href'), youtubeUrl);
  assert.equal(await pwaPage.locator('#reading-stats').count(), 0);
  assert.equal(await pwaPage.locator('#meta').count(), 0);
  await pwaPage.locator('#share-summary').click();
  assert.match(await pwaPage.evaluate(() => globalThis.__nbsSharedPayload?.text ?? ''), /SKIM:/u);
  await pwaPage.reload();
  await pwaPage.locator('#result').waitFor({ state: 'visible' });
  assert.equal(await pwaPage.locator('#url').inputValue(), youtubeUrl);

  const cancelPage = await context.newPage();
  await cancelPage.goto(`${baseUrl}/`);
  let releaseHeldRequest;
  const heldRequest = new Promise((resolve) => {
    releaseHeldRequest = resolve;
  });
  await cancelPage.route(localApiUrl, async (route) => {
    await heldRequest;
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(pwaPayload),
      });
    } catch {
      // The request is expected to be aborted by the Cancel button.
    }
  });
  await cancelPage.locator('#url').fill(youtubeUrl);
  await cancelPage.locator('#submit').click();
  await cancelPage.locator('#cancel-request').waitFor({ state: 'visible' });
  await cancelPage.locator('#cancel-request').click();
  await waitForText(cancelPage.locator('#status'), 'Cancelled.');
  assert.equal(await cancelPage.locator('#submit').isEnabled(), true);
  assert.equal(await cancelPage.locator('#cancel-request').isHidden(), true);
  releaseHeldRequest();
  await cancelPage.close();
  report.checks.androidViewport = true;
  report.checks.copyAndOpenActions = true;
  report.checks.instructionsTextSizeAndConnection = true;
  report.checks.thumbnailAndNativeShare = true;
  report.checks.pwaLastResultRestored = true;
  report.checks.cancelRequest = true;
  report.checks.pwaSummarySubmission = true;

  // Keep the extension on its shipped production URL while returning the same
  // already-proven local payload. This avoids both paid calls and release-only
  // localhost permissions.
  await context.route(productionApiUrl, async (route) => {
    const input = route.request().postDataJSON();
    if (input?.url === 'https://example.com') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          error: {
            code: 'INVALID_VIDEO_URL',
            message: 'Not a YouTube link: "https://example.com"',
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(pwaPayload),
    });
  });
  await context.route(productionStatusUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        status: 'ok',
        access: 'owner',
        dailyGeneration: {
          used: 4,
          limit: 300,
          remaining: 296,
          resetsAt: '2026-08-09T00:00:00.000Z',
        },
        freeGeneration: {
          user: {
            used: 1,
            limit: 5,
            remaining: 4,
            resetsAt: '2026-09-01T00:00:00.000Z',
          },
          shared: {
            used: 8,
            limit: 50,
            remaining: 42,
            resetsAt: '2026-09-01T00:00:00.000Z',
          },
        },
      }),
    });
  });

  const youtubePage = await context.newPage();
  await youtubePage.goto(youtubeUrl);
  assert.equal(await youtubePage.title(), 'PyroLIVE Smoke - YouTube');

  const sidePanelPage = await context.newPage();
  await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await sidePanelPage.locator('h1').waitFor({ state: 'visible' });
  assert.equal(await sidePanelPage.locator('h1').innerText(), 'No BS Summary');
  report.checks.sidePanelDocumentOpened = true;

  await youtubePage.bringToFront();
  const urlInput = sidePanelPage.locator('#url');
  const titleInput = sidePanelPage.locator('#title');
  const detectedTitle = sidePanelPage.locator('#detected-title');
  const settingsDialog = sidePanelPage.locator('#settings-dialog');
  await waitForValue(urlInput, youtubeUrl);
  assert.equal(await titleInput.inputValue(), 'PyroLIVE Smoke');
  assert.equal(await detectedTitle.innerText(), 'PyroLIVE Smoke');
  assert.equal(await settingsDialog.isVisible(), false);
  assert.equal(await urlInput.isHidden(), true);
  await sidePanelPage.locator('#settings-button').click();
  assert.equal(await settingsDialog.isVisible(), true);
  await sidePanelPage.locator('#password').fill('test-password');
  await sidePanelPage.locator('#video-thumbnail').waitFor({ state: 'visible' });
  await sidePanelPage.locator('#text-size').selectOption('extra-large');
  assert.equal(await sidePanelPage.locator('html').getAttribute('data-text-size'), 'extra-large');
  await sidePanelPage.locator('#test-connection').click();
  await waitForText(
    sidePanelPage.locator('#connection-status'),
    'Connected · 296/300 daily remaining',
  );
  assert.equal(
    await sidePanelPage.locator('#connection-status').getAttribute('data-state'),
    'success',
  );
  await waitForText(sidePanelPage.locator('#free-user-usage'), '4/5 left');
  await waitForText(sidePanelPage.locator('#free-shared-usage'), '42/50 left');
  assert.equal(
    await sidePanelPage
      .locator('#settings-dialog a[href*="transcriptapi.com/billing"]')
      .isVisible(),
    true,
  );
  assert.equal(
    await sidePanelPage.locator('#settings-dialog a[href*="github.com/echoNad3"]').isVisible(),
    true,
  );
  await sidePanelPage.locator('#close-settings').click();
  await assertHeaderControlsAligned(sidePanelPage);
  report.checks.currentYouTubeUrlDetected = true;
  report.checks.detectedTitleReplacesUrl = true;
  report.checks.alignedHeaderIcons = true;

  report.checks.productionBackendConfigured = true;

  const submit = sidePanelPage.locator('#submit');
  const status = sidePanelPage.locator('#status');
  await installLoadingRecorder(sidePanelPage);
  const extensionResponsePromise = waitForSummaryResponse(sidePanelPage, productionApiUrl);
  await submit.click();
  const extensionPayload = await (await extensionResponsePromise).json();

  const result = sidePanelPage.locator('#result');
  await result.waitFor({ state: 'visible', timeout: 20_000 });
  await assertLoadingRecorded(sidePanelPage);
  const extensionOutput = await readRenderedOutput(sidePanelPage);
  assertSummaryOutput(extensionOutput);
  await assertDetailedTopics(sidePanelPage);
  await assertInlineFormatting(sidePanelPage);
  assert.equal(await submit.isEnabled(), true);
  assert.equal(await status.innerText(), 'Summary ready.');
  assert.equal(
    await sidePanelPage
      .locator('body')
      .evaluate((element) => element.classList.contains('has-result')),
    true,
  );
  assert.equal(await settingsDialog.isHidden(), true);
  assert.equal(await sidePanelPage.locator('header').isVisible(), true);
  const [buttonWidth, formWidth] = await Promise.all([
    submit.evaluate((element) => element.getBoundingClientRect().width),
    sidePanelPage
      .locator('#summary-form')
      .evaluate((element) => element.getBoundingClientRect().width),
  ]);
  assert.ok(buttonWidth > formWidth * 0.8);
  await sidePanelPage.setViewportSize({ width: 320, height: 800 });
  await assertNoHorizontalOverflow(sidePanelPage);
  assert.deepEqual(extensionPayload, pwaPayload);
  assert.deepEqual(extensionOutput, pwaOutput);
  report.checks.loadingState = true;
  report.checks.summarySubmission = true;
  report.checks.cachedPyroLiveResult = true;
  report.checks.verdictReasonAndSummary = true;
  report.checks.crossClientSavedResult = true;
  report.checks.stableComposerLayout = true;
  report.checks.narrowSidePanel = true;
  report.checks.extensionInstructionsTextSizeAndConnection = true;
  report.output = { pwa: pwaOutput, extension: extensionOutput };

  await sidePanelPage.reload();
  await result.waitFor({ state: 'visible' });
  assert.equal(await urlInput.inputValue(), youtubeUrl);
  report.checks.extensionLastResultRestored = true;

  const sameVideoUrl = `${youtubeUrl}&t=30`;
  await youtubePage.goto(sameVideoUrl);
  await waitForValue(urlInput, sameVideoUrl);
  assert.equal(await result.isVisible(), true);
  assert.equal(
    await sidePanelPage
      .locator('body')
      .evaluate((element) => element.classList.contains('has-result')),
    true,
  );
  report.checks.sameVideoNavigationKeepsResult = true;

  const secondYoutubePage = await context.newPage();
  await secondYoutubePage.goto(secondYoutubeUrl);
  await secondYoutubePage.bringToFront();
  assert.equal(await secondYoutubePage.title(), 'Rick Astley Smoke - YouTube');
  await waitForValue(urlInput, secondYoutubeUrl);
  await waitForText(detectedTitle, 'Rick Astley Smoke');
  assert.equal(await result.isHidden(), true);
  assert.equal(
    await sidePanelPage
      .locator('body')
      .evaluate((element) => element.classList.contains('has-result')),
    false,
  );
  assert.equal(await settingsDialog.isHidden(), true);
  await youtubePage.bringToFront();
  await waitForValue(urlInput, sameVideoUrl);
  assert.equal(await result.isVisible(), true);
  assert.equal(
    await sidePanelPage
      .locator('body')
      .evaluate((element) => element.classList.contains('has-result')),
    true,
  );
  await secondYoutubePage.close();
  report.checks.activeYouTubeTabRefresh = true;
  report.checks.savedSummaryRestoredOnTabReturn = true;

  await youtubePage.goto('https://www.youtube.com/');
  await youtubePage.bringToFront();
  await waitForText(detectedTitle, 'No YouTube video detected');
  await urlInput.waitFor({ state: 'visible' });
  await urlInput.fill('https://example.com');
  await submit.click();
  await waitForText(status, 'Not a YouTube link: "https://example.com"');
  assert.equal(await sidePanelPage.locator('#error-actions').isVisible(), true);
  await sidePanelPage.evaluate(() => {
    globalThis.__nbsCopiedDiagnostics = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          globalThis.__nbsCopiedDiagnostics = text;
        },
      },
    });
  });
  await sidePanelPage.locator('#copy-diagnostics').click();
  assert.equal(await sidePanelPage.locator('#copy-diagnostics').innerText(), 'Copied diagnostics');
  const copiedDiagnostics = await sidePanelPage.evaluate(
    () => globalThis.__nbsCopiedDiagnostics ?? '',
  );
  assert.match(copiedDiagnostics, /Code: INVALID_VIDEO_URL/u);
  assert.doesNotMatch(copiedDiagnostics, /example\.com/u);
  const retryResponse = sidePanelPage.waitForResponse(
    (response) => response.url() === productionApiUrl && response.status() === 400,
  );
  await sidePanelPage.locator('#retry-request').click();
  await retryResponse;
  assert.equal(await result.isHidden(), true);
  assert.equal(await submit.isEnabled(), true);
  assert.equal(await submit.innerText(), 'Cut the BS');
  report.checks.errorState = true;
  report.checks.safeDiagnostics = true;

  const sharedPage = await context.newPage();
  await sharedPage.setViewportSize({ width: 412, height: 915 });
  await sharedPage.goto(
    `${baseUrl}/share?title=Shared+video+-+YouTube&text=${encodeURIComponent(youtubeUrl)}`,
  );
  await waitForValue(sharedPage.locator('#url'), youtubeUrl);
  assert.equal(await sharedPage.locator('#title').inputValue(), 'Shared video');
  assert.equal(new URL(sharedPage.url()).search, '');
  await assertNoHorizontalOverflow(sharedPage);
  report.checks.androidShareTarget = true;

  const desktopPage = await context.newPage();
  await desktopPage.setViewportSize({ width: 1440, height: 1000 });
  await desktopPage.goto(`${baseUrl}/`);
  await desktopPage.locator('h1').waitFor({ state: 'visible' });
  await assertNoHorizontalOverflow(desktopPage);
  const desktopShellWidth = await desktopPage
    .locator('.app-shell')
    .evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(desktopShellWidth >= 700 && desktopShellWidth <= 740, `${desktopShellWidth}`);
  report.checks.desktopPwaViewport = true;

  await pwaPage.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await pwaPage.waitForFunction(() => !navigator.onLine);
  await waitForText(pwaPage.locator('#status'), 'Offline. Summaries need a connection.');
  assert.equal(await pwaPage.locator('#submit').isDisabled(), true);
  await pwaPage.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await pwaPage.locator('h1').innerText(), 'No BS Summary');
  assert.equal(await pwaPage.locator('html').getAttribute('data-text-size'), 'large');
  await context.setOffline(false);
  report.checks.firstOfflineLaunch = true;

  const transcriptRequests = requests.filter((url) => /transcriptapi\.com/iu.test(url));
  report.transcriptApiRequests = transcriptRequests.length;
  assert.deepEqual(transcriptRequests, []);
  assert.deepEqual(pageErrors, []);
  const unexpectedRequestFailures = requestFailures.filter(
    ({ url, errorText }) =>
      !url.startsWith('http://local.adguard.org/') &&
      !(url.endsWith('/api/summarize') && errorText === 'net::ERR_ABORTED'),
  );
  assert.deepEqual(unexpectedRequestFailures, []);

  const unexpectedResponses = responses.filter(
    ({ url, status }) => !(url.endsWith('/api/summarize') && status === 400),
  );
  assert.deepEqual(unexpectedResponses, []);
  const unexpectedConsoleErrors = consoleErrors.filter(
    ({ text, url }) =>
      !/Failed to load resource.*400 \(Bad Request\)/iu.test(text) &&
      !(url === `${baseUrl}/` && /ERR_INTERNET_DISCONNECTED/iu.test(text)),
  );
  assert.deepEqual(unexpectedConsoleErrors, []);
  report.checks.consoleAndNetworkErrors = true;
  report.diagnostics = { consoleErrors, pageErrors, requestFailures, httpErrors: responses };
} catch (error) {
  failure = error;
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  if (context) await context.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await fs.rm(userDataDir, { recursive: true, force: true });
  report.profileRemoved = true;
  report.finishedAt = new Date().toISOString();
  await fs.mkdir(resultsDir, { recursive: true });
  const stamp = report.finishedAt.replace(/[:.]/gu, '-');
  const resultFile = path.join(resultsDir, `extension-smoke-${stamp}.json`);
  await fs.writeFile(resultFile, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Extension smoke result: ${resultFile}`);
  console.log(JSON.stringify(report, null, 2));
}

if (failure) throw failure;

function createStaticServer(root) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
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

async function waitForValue(locator, expected, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    if ((await locator.inputValue()) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.equal(await locator.inputValue(), expected);
}

async function waitForText(locator, expected, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    if ((await locator.innerText()) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.equal(await locator.innerText(), expected);
}

async function waitForSummaryResponse(page, apiUrl = localApiUrl) {
  return page.waitForResponse(
    (response) => response.url() === apiUrl && response.status() === 200,
    { timeout: 20_000 },
  );
}

async function installLoadingRecorder(page) {
  await page.evaluate(() => {
    globalThis.__nbsLoadingStates = [];
    const form = document.getElementById('summary-form');
    const submit = document.getElementById('submit');
    const status = document.getElementById('status');
    if (!form || !submit || !status) throw new Error('Loading-state elements are missing.');
    const record = () => {
      globalThis.__nbsLoadingStates.push({
        busy: form.getAttribute('aria-busy'),
        disabled: submit.disabled,
        submitText: submit.textContent,
        statusText: status.textContent,
      });
    };
    new MutationObserver(record).observe(form.parentElement ?? form, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    record();
  });
}

async function assertLoadingRecorded(page) {
  const states = await page.evaluate(() => globalThis.__nbsLoadingStates ?? []);
  assert.ok(
    states.some(
      (state) =>
        state.busy === 'true' &&
        state.disabled === true &&
        state.submitText === 'Working…' &&
        state.statusText === 'Working…',
    ),
    `Loading state was not observed: ${JSON.stringify(states)}`,
  );
}

async function readRenderedOutput(page) {
  return {
    verdict: (await page.locator('#verdict').innerText()).trim(),
    reason: (await page.locator('#reason').innerText()).trim(),
    summary: (await page.locator('#summary').innerText()).trim(),
  };
}

async function assertNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    return {
      viewport,
      content: document.documentElement.scrollWidth,
      overflowers: [...document.querySelectorAll('body *')]
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${
              element.classList.length ? `.${[...element.classList].join('.')}` : ''
            }`,
            left: Math.round(box.left),
            right: Math.round(box.right),
            width: Math.round(box.width),
          };
        })
        .filter((box) => box.left < 0 || box.right > viewport)
        .slice(0, 10),
    };
  });
  assert.ok(
    widths.content <= widths.viewport,
    `Horizontal overflow: ${JSON.stringify(widths)} at ${page.url()}`,
  );
}

async function assertHeaderControlsAligned(page) {
  const controls = await page.locator('.app-header > .icon-button').evaluateAll((elements) =>
    elements.map((element) => {
      const control = element.getBoundingClientRect();
      const icon = element.querySelector('.control-icon')?.getBoundingClientRect();
      return {
        x: control.x,
        y: control.y,
        width: control.width,
        height: control.height,
        controlCenterX: control.x + control.width / 2,
        controlCenterY: control.y + control.height / 2,
        iconCenterX: icon ? icon.x + icon.width / 2 : null,
        iconCenterY: icon ? icon.y + icon.height / 2 : null,
      };
    }),
  );

  assert.equal(controls.length, 1);
  for (const control of controls) {
    assert.ok(Math.abs(control.width - control.height) < 0.5, JSON.stringify(controls));
    assert.ok(
      control.iconCenterX !== null &&
        control.iconCenterY !== null &&
        Math.abs(control.controlCenterX - control.iconCenterX) < 0.5 &&
        Math.abs(control.controlCenterY - control.iconCenterY) < 0.5,
      `Header icon is not centered: ${JSON.stringify(controls)}`,
    );
  }
}

function assertSummaryOutput({ verdict, reason, summary }) {
  assert.ok(['WATCH', 'SKIM', 'SKIP'].includes(verdict));
  assert.ok(reason.length >= 20);
  assert.ok((reason.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length < 25);
  assert.ok(summary.length >= 500);
  assert.match(summary, /Wizard Detective|Kane Pixels|Backrooms/iu);
  assert.doesNotMatch(
    reason,
    /^(?:the creator|the host|the speaker|the video)\s+(?:is|offers|provides|presents)\b|cohesive narrative|variety of topics|cultural commentary|varies in quality|offers? a perspective|presents? an exploration|holds? (?:the )?(?:viewer'?s )?attention|is essentially|feels like|scattered (?:collection|series)|loosely connected (?:topics|reactions|stories)/iu,
  );
  assert.doesNotMatch(summary, /\*/u);
}

async function assertDetailedTopics(page) {
  const topicItems = page.locator('#summary .summary-topics > li');
  assert.ok((await topicItems.count()) >= 3);
  const firstTopicBoldText = await topicItems.first().locator('strong').allInnerTexts();
  assert.deepEqual(firstTopicBoldText, ['Wizard Detective: ', 'Main appeal:']);
}

async function assertInlineFormatting(page) {
  assert.deepEqual(await page.locator('#summary em').allInnerTexts(), ['Backrooms']);
}
