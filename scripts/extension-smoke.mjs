import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const projectDir = process.cwd();
const extensionDir = path.resolve(projectDir, 'dist/extension');
const resultsDir = path.resolve(projectDir, 'results');
const youtubeUrl = 'https://www.youtube.com/watch?v=EwMSGdE2bOQ';
const secondYoutubeUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const productionApiUrl = 'https://no-bullshit-summary.echonad3.workers.dev/api/summarize';
const productionStatusUrl = 'https://no-bullshit-summary.echonad3.workers.dev/api/status';
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nbs-extension-smoke-'));
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
    origin: 'http://127.0.0.1:8787',
  });
  await pwaPage.goto('http://127.0.0.1:8787/');
  await pwaPage.locator('h1').waitFor({ state: 'visible' });
  assert.equal(await pwaPage.locator('h1').innerText(), 'No BS Summary');
  assert.equal(await pwaPage.locator('#options').getAttribute('open'), '');
  await pwaPage.locator('#password').fill('test-password');
  await pwaPage.locator('#help-button').click();
  assert.equal(await pwaPage.locator('#help-dialog').isVisible(), true);
  await pwaPage.locator('#close-help').click();
  await pwaPage.locator('#text-size').selectOption('large');
  assert.equal(await pwaPage.locator('html').getAttribute('data-text-size'), 'large');
  await pwaPage.locator('#test-connection').click();
  await waitForText(pwaPage.locator('#connection-status'), 'Connected. Local backend ready.');
  await assertNoHorizontalOverflow(pwaPage);
  await pwaPage.locator('#url').fill(youtubeUrl);
  await pwaPage.locator('#video-thumbnail').waitFor({ state: 'visible' });
  await installLoadingRecorder(pwaPage);
  const pwaResponsePromise = waitForSummaryResponse(pwaPage);
  await pwaPage.locator('#submit').click();
  const pwaPayload = await (await pwaResponsePromise).json();
  await pwaPage.locator('#result').waitFor({ state: 'visible', timeout: 20_000 });
  await assertLoadingRecorded(pwaPage);
  assert.equal(await pwaPage.locator('#options').getAttribute('open'), null);
  const pwaOutput = await readRenderedOutput(pwaPage);
  assertSummaryOutput(pwaOutput);
  await assertDetailedTopics(pwaPage);
  await pwaPage.locator('#copy-summary').click();
  assert.match(await pwaPage.evaluate(() => navigator.clipboard.readText()), /SKIM:/u);
  assert.equal(await pwaPage.locator('#copy-summary').innerText(), 'Copied');
  assert.equal(await pwaPage.locator('#open-video').getAttribute('href'), youtubeUrl);
  assert.match(await pwaPage.locator('#reading-stats').innerText(), /^\d+ min read · \d+ words$/u);
  await pwaPage.locator('#share-summary').click();
  assert.match(await pwaPage.evaluate(() => globalThis.__nbsSharedPayload?.text ?? ''), /SKIM:/u);
  await pwaPage.reload();
  await pwaPage.locator('#result').waitFor({ state: 'visible' });
  assert.equal(await pwaPage.locator('#url').inputValue(), youtubeUrl);

  const cancelPage = await context.newPage();
  await cancelPage.goto('http://127.0.0.1:8787/');
  let releaseHeldRequest;
  const heldRequest = new Promise((resolve) => {
    releaseHeldRequest = resolve;
  });
  await cancelPage.route('http://127.0.0.1:8787/api/summarize', async (route) => {
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
        cache: 'cloud',
        dailyGeneration: {
          used: 4,
          limit: 300,
          remaining: 296,
          resetsAt: '2026-08-09T00:00:00.000Z',
        },
        transcriptApiCredits: {
          availableViaApi: false,
          dashboardUrl: 'https://transcriptapi.com/dashboard/billing',
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
  const fallbackControls = sidePanelPage.locator('#fallback-controls');
  await waitForValue(urlInput, youtubeUrl);
  assert.equal(await titleInput.inputValue(), 'PyroLIVE Smoke');
  assert.equal(await detectedTitle.innerText(), 'PyroLIVE Smoke');
  assert.equal(await fallbackControls.getAttribute('open'), '');
  assert.equal(await urlInput.isVisible(), true);
  await sidePanelPage.locator('#password').fill('test-password');
  await sidePanelPage.locator('#video-thumbnail').waitFor({ state: 'visible' });
  await sidePanelPage.locator('#help-button').click();
  assert.equal(await sidePanelPage.locator('#help-dialog').isVisible(), true);
  await sidePanelPage.locator('#close-help').click();
  await sidePanelPage.locator('#text-size').selectOption('extra-large');
  assert.equal(await sidePanelPage.locator('html').getAttribute('data-text-size'), 'extra-large');
  await sidePanelPage.locator('#test-connection').click();
  await waitForText(
    sidePanelPage.locator('#connection-status'),
    'Connected. Cloud cache ready. 296 of 300 new-summary slots remain today.',
  );
  report.checks.currentYouTubeUrlDetected = true;
  report.checks.detectedTitleReplacesUrl = true;

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
  assert.equal(await submit.isEnabled(), true);
  assert.equal(await status.innerText(), 'Summary ready.');
  assert.equal(
    await sidePanelPage
      .locator('body')
      .evaluate((element) => element.classList.contains('has-result')),
    true,
  );
  assert.equal(await fallbackControls.isHidden(), true);
  assert.equal(await sidePanelPage.locator('header').isHidden(), true);
  const [buttonWidth, formWidth] = await Promise.all([
    submit.evaluate((element) => element.getBoundingClientRect().width),
    sidePanelPage
      .locator('#summary-form')
      .evaluate((element) => element.getBoundingClientRect().width),
  ]);
  assert.ok(buttonWidth < formWidth / 2);
  await sidePanelPage.setViewportSize({ width: 320, height: 800 });
  await assertNoHorizontalOverflow(sidePanelPage);
  assert.deepEqual(extensionPayload, pwaPayload);
  assert.deepEqual(extensionOutput, pwaOutput);
  report.checks.loadingState = true;
  report.checks.summarySubmission = true;
  report.checks.cachedPyroLiveResult = true;
  report.checks.verdictReasonSummaryAndTiming = true;
  report.checks.crossClientSavedResult = true;
  report.checks.compactButtonAndCollapsedSuccessControls = true;
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

  await sidePanelPage.locator('#lock-video').click();
  assert.equal(await sidePanelPage.locator('#lock-video').getAttribute('aria-pressed'), 'true');
  await youtubePage.goto(secondYoutubeUrl);
  assert.equal(await youtubePage.title(), 'Rick Astley Smoke - YouTube');
  assert.equal(await urlInput.inputValue(), sameVideoUrl);
  assert.equal(await result.isVisible(), true);
  await sidePanelPage.locator('#lock-video').click();
  await waitForValue(urlInput, secondYoutubeUrl);
  await waitForText(detectedTitle, 'Rick Astley Smoke');
  assert.equal(await result.isHidden(), true);
  assert.equal(
    await sidePanelPage
      .locator('body')
      .evaluate((element) => element.classList.contains('has-result')),
    false,
  );
  assert.equal(await fallbackControls.getAttribute('open'), null);
  report.checks.activeYouTubeTabRefresh = true;
  report.checks.lockedVideoPreserved = true;

  await fallbackControls.evaluate((element) => {
    element.open = true;
  });
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
    `http://127.0.0.1:8787/share?title=Shared+video+-+YouTube&text=${encodeURIComponent(youtubeUrl)}`,
  );
  await waitForValue(sharedPage.locator('#url'), youtubeUrl);
  assert.equal(await sharedPage.locator('#title').inputValue(), 'Shared video');
  assert.equal(new URL(sharedPage.url()).search, '');
  await assertNoHorizontalOverflow(sharedPage);
  report.checks.androidShareTarget = true;

  const desktopPage = await context.newPage();
  await desktopPage.setViewportSize({ width: 1440, height: 1000 });
  await desktopPage.goto('http://127.0.0.1:8787/');
  await desktopPage.locator('h1').waitFor({ state: 'visible' });
  await assertNoHorizontalOverflow(desktopPage);
  report.checks.desktopPwaViewport = true;

  await pwaPage.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await pwaPage.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await pwaPage.locator('h1').innerText(), 'No BS Summary');
  await waitForText(
    pwaPage.locator('#status'),
    'You are offline. The app is ready, but summaries need a connection.',
  );
  assert.equal(await pwaPage.locator('#submit').isDisabled(), true);
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
      !(url === 'http://127.0.0.1:8787/' && /ERR_INTERNET_DISCONNECTED/iu.test(text)),
  );
  assert.deepEqual(unexpectedConsoleErrors, []);
  report.checks.consoleAndNetworkErrors = true;
  report.diagnostics = { consoleErrors, pageErrors, requestFailures, httpErrors: responses };
} catch (error) {
  failure = error;
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  if (context) await context.close();
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

async function waitForSummaryResponse(page, apiUrl = 'http://127.0.0.1:8787/api/summarize') {
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
        state.submitText === 'Working...' &&
        /^Reading captions and cutting the padding\.\.\. \d+s$/u.test(state.statusText),
    ),
    `Loading state was not observed: ${JSON.stringify(states)}`,
  );
}

async function readRenderedOutput(page) {
  return {
    verdict: (await page.locator('#verdict').innerText()).trim(),
    reason: (await page.locator('#reason').innerText()).trim(),
    summary: (await page.locator('#summary').innerText()).trim(),
    meta: (await page.locator('#meta').innerText()).trim(),
  };
}

async function assertNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  assert.ok(
    widths.content <= widths.viewport,
    `Horizontal overflow: ${JSON.stringify(widths)} at ${page.url()}`,
  );
}

function assertSummaryOutput({ verdict, reason, summary, meta }) {
  assert.ok(['WATCH', 'SKIM', 'SKIP'].includes(verdict));
  assert.ok(reason.length >= 20);
  assert.ok((reason.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length < 25);
  assert.ok(summary.length >= 500);
  assert.match(summary, /Wizard Detective|Kane Pixels|Backrooms/iu);
  assert.doesNotMatch(
    reason,
    /^(?:the creator|the host|the speaker|the video)\s+(?:is|offers|provides|presents)\b|cohesive narrative|variety of topics|cultural commentary|varies in quality|offers? a perspective|presents? an exploration|holds? (?:the )?(?:viewer'?s )?attention|is essentially|feels like|scattered (?:collection|series)|loosely connected (?:topics|reactions|stories)/iu,
  );
  assert.doesNotMatch(summary, /\*\*/u);
  assert.match(meta, /^cached captions · \d+\.\d+s$/u);
}

async function assertDetailedTopics(page) {
  const topicItems = page.locator('#summary .summary-topics > li');
  assert.ok((await topicItems.count()) >= 3);
}
