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

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  const extensionId = new URL(worker.url()).host;
  assert.match(extensionId, /^[a-p]{32}$/u);

  const panelBehavior = await worker.evaluate(async () => chrome.sidePanel.getPanelBehavior());
  assert.equal(panelBehavior.openPanelOnActionClick, true);
  report.checks.sidePanelActionConfigured = true;

  const pwaPage = await context.newPage();
  await pwaPage.goto('http://127.0.0.1:8787/');
  await pwaPage.locator('h1').waitFor({ state: 'visible' });
  assert.equal(await pwaPage.locator('h1').innerText(), 'No BS Summary');
  await pwaPage.locator('#url').fill(youtubeUrl);
  await installLoadingRecorder(pwaPage);
  const pwaResponsePromise = waitForSummaryResponse(pwaPage);
  await pwaPage.locator('#submit').click();
  const pwaPayload = await (await pwaResponsePromise).json();
  await pwaPage.locator('#result').waitFor({ state: 'visible', timeout: 20_000 });
  await assertLoadingRecorded(pwaPage);
  const pwaOutput = await readRenderedOutput(pwaPage);
  assertSummaryOutput(pwaOutput);
  await assertDetailedTopics(pwaPage);
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
  assert.equal(await fallbackControls.getAttribute('open'), null);
  assert.equal(await urlInput.isHidden(), true);
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
  assert.equal(await status.innerText(), '');
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
  assert.deepEqual(extensionPayload, pwaPayload);
  assert.deepEqual(extensionOutput, pwaOutput);
  report.checks.loadingState = true;
  report.checks.summarySubmission = true;
  report.checks.cachedPyroLiveResult = true;
  report.checks.verdictReasonSummaryAndTiming = true;
  report.checks.crossClientSavedResult = true;
  report.checks.compactButtonAndCollapsedSuccessControls = true;
  report.output = { pwa: pwaOutput, extension: extensionOutput };

  await youtubePage.goto(secondYoutubeUrl);
  assert.equal(await youtubePage.title(), 'Rick Astley Smoke - YouTube');
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

  await fallbackControls.evaluate((element) => {
    element.open = true;
  });
  await urlInput.fill('https://example.com');
  await submit.click();
  await waitForText(status, 'Not a YouTube link: "https://example.com"');
  assert.equal(await result.isHidden(), true);
  assert.equal(await submit.isEnabled(), true);
  assert.equal(await submit.innerText(), 'Cut the BS');
  report.checks.errorState = true;

  const transcriptRequests = requests.filter((url) => /transcriptapi\.com/iu.test(url));
  report.transcriptApiRequests = transcriptRequests.length;
  assert.deepEqual(transcriptRequests, []);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(requestFailures, []);

  const unexpectedResponses = responses.filter(
    ({ url, status }) => !(url.endsWith('/api/summarize') && status === 400),
  );
  assert.deepEqual(unexpectedResponses, []);
  const unexpectedConsoleErrors = consoleErrors.filter(
    ({ text }) => !/Failed to load resource.*400 \(Bad Request\)/iu.test(text),
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
        state.submitText === 'Working…' &&
        state.statusText === 'Reading captions and cutting the padding…',
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
