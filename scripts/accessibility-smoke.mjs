import { AxeBuilder } from '@axe-core/playwright';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const projectDir = process.cwd();
const pwaDir = path.join(projectDir, 'dist', 'pwa');
const extensionDir = path.join(projectDir, 'dist', 'extension');
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nbs-a11y-'));
const server = createStaticServer(pwaDir);
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
  pwaContext = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const pwaPage = await pwaContext.newPage();
  await pwaPage.goto(baseUrl);
  await assertAccessible(pwaPage, 'Android PWA');
  await pwaPage.locator('#help-button').click();
  await assertAccessible(pwaPage, 'PWA instructions dialog');
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
  const extensionPage = await extensionContext.newPage();
  await extensionPage.setViewportSize({ width: 320, height: 800 });
  await extensionPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await assertAccessible(extensionPage, 'Chrome side panel');
  await extensionPage.locator('#help-button').click();
  await assertAccessible(extensionPage, 'Extension instructions dialog');

  console.log('Accessibility smoke: no Axe violations in the tested surfaces.');
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
