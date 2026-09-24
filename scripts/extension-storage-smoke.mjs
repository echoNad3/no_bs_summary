import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const compiled = await build({
  entryPoints: [path.resolve('apps/extension/src/sidepanel.ts')],
  bundle: true,
  format: 'iife',
  loader: { '.css': 'empty' },
  write: false,
});
const script = compiled.outputFiles[0].text;
const html = readFileSync('apps/extension/sidepanel.html', 'utf8').replace(
  /<script\b[^>]*>[\s\S]*?<\/script>/gu,
  '',
);
const defaultResult = {
  outputVersion: 2,
  verdict: 'SKIP',
  reason: 'The useful point is buried under repetition.',
  summary: '- **Main point:** One useful fact.',
  videoId: '8Yt_R9GnzLU',
  language: 'en',
  source: 'LIVE',
  timing: { summaryMs: 10 },
  retries: { transcript: 0, summary: 0 },
};
const result = process.env.NBS_SUMMARY_FIXTURE
  ? JSON.parse(readFileSync(process.env.NBS_SUMMARY_FIXTURE, 'utf8')).body
  : defaultResult;

const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ['read-hang', 'settings-hang', 'result-save-hang']) {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.abort());
    await page.clock.install();
    await page.setContent(html);
    await page.evaluate(
      ({ mode, result }) => {
        window.summaryRequests = 0;
        const storage = {
          get: async () => (mode === 'read-hang' ? new Promise(() => {}) : {}),
          set: async (items) => {
            if (
              (mode === 'settings-hang' && 'nbs-settings' in items) ||
              (mode === 'result-save-hang' && 'nbs-last-summary' in items)
            ) {
              await new Promise(() => {});
            }
          },
          remove: async () => {},
        };
        window.chrome = {
          storage: { local: storage, sync: storage },
          tabs: {
            onActivated: { addListener() {} },
            onUpdated: { addListener() {} },
            query: async () => [
              {
                id: 1,
                url: 'https://www.youtube.com/watch?v=8Yt_R9GnzLU',
                title: 'Test video - YouTube',
              },
            ],
          },
        };
        window.fetch = async (url) => {
          if (String(url).endsWith('/api/summarize')) {
            window.summaryRequests += 1;
            return Response.json(result);
          }
          return Response.json(
            { error: { code: 'MOCK', message: 'Mock status' } },
            { status: 503 },
          );
        };
      },
      { mode, result },
    );
    await page.addScriptTag({ content: script });
    if (mode === 'read-hang') await page.clock.runFor(2_500);
    await page.waitForFunction(
      () => document.querySelector('#url').value.includes('8Yt_R9GnzLU'),
      null,
      { timeout: 5_000 },
    );
    await page.locator('#submit').click();
    await page.waitForFunction(() => !document.querySelector('#result').hidden, null, {
      timeout: 5_000,
    });
    await page.clock.fastForward(71_000);
    const state = await page.evaluate(() => ({
      requests: window.summaryRequests,
      busy: document.querySelector('#submit').disabled,
      resultVisible: !document.querySelector('#result').hidden,
      status: document.querySelector('#status').textContent,
    }));
    assert.equal(state.requests, 1, `${mode}: request was blocked ${JSON.stringify(state)}`);
    assert.equal(state.busy, false, `${mode}: panel stayed busy ${JSON.stringify(state)}`);
    assert.equal(state.resultVisible, true, `${mode}: result was hidden ${JSON.stringify(state)}`);
    assert.equal(
      state.status,
      'Summary ready.',
      `${mode}: result did not finish ${JSON.stringify(state)}`,
    );
    await page.close();
  }
  console.log('Extension storage smoke: pending reads and writes do not block summaries.');
} finally {
  await browser.close();
}
