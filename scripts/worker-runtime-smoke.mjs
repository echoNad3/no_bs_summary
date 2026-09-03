import assert from 'node:assert/strict';
import { unstable_dev } from 'wrangler';

const worker = await unstable_dev('src/worker.ts', {
  config: 'wrangler.jsonc',
  local: true,
  persist: false,
  ip: '127.0.0.1',
  port: 0,
  logLevel: 'error',
  vars: {
    APP_PASSWORD: 'test-owner-password',
    GEMINI_API_KEY: 'test-gemini-key',
    TRANSCRIPTAPI_API_KEY: 'test-transcript-key',
  },
  experimental: {
    disableExperimentalWarning: true,
    disableDevRegistry: true,
    showInteractiveDevSession: false,
  },
});

try {
  const healthResponse = await worker.fetch('/api/health');
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.status, 'ok');
  assert.equal(health.provider, 'transcriptapi');
  assert.equal(typeof health.promptVersion, 'string');

  const freeResponse = await worker.fetch('/api/status');
  assert.equal(freeResponse.status, 200);
  const free = await freeResponse.json();
  assert.equal(free.access, 'free');
  assertCounter(free.freeGeneration.user, { used: 0, limit: 5, remaining: 5 });
  assertCounter(free.freeGeneration.shared, { used: 0, limit: 50, remaining: 50 });

  const ownerResponse = await worker.fetch('/api/status', {
    headers: { 'x-app-password': 'test-owner-password' },
  });
  assert.equal(ownerResponse.status, 200);
  const owner = await ownerResponse.json();
  assert.equal(owner.access, 'owner');
  assertCounter(owner.dailyGeneration, { used: 0, limit: 100, remaining: 100 });

  const pageResponse = await worker.fetch('/');
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get('content-security-policy') ?? '', /default-src 'self'/u);

  console.log('Worker runtime smoke: health, quotas, owner access, and app shell passed.');
} finally {
  await worker.stop();
}

function assertCounter(actual, expected) {
  assert.deepEqual(
    { used: actual.used, limit: actual.limit, remaining: actual.remaining },
    expected,
  );
  assert.equal(Number.isFinite(Date.parse(actual.resetsAt)), true);
}
