import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';

const output = await build({
  entryPoints: ['tests/fixtures/worker-lifecycle.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  external: ['node:*', 'cloudflare:*'],
});
const worker = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: output.outputFiles[0].text,
    compatibilityDate: '2026-08-29',
    compatibilityFlags: ['nodejs_compat'],
  }),
);

try {
  const abandoned = await worker.dispatchFetch('http://local/abandon');
  assert.equal(abandoned.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 800));

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const retry = await worker.dispatchFetch('http://local/retry');
    const payload = await retry.json();
    assert.equal(
      retry.status,
      200,
      `same-video retry ${attempt} failed: ${JSON.stringify(payload)}`,
    );
    assert.equal(payload.result.videoId, '-ujJNlvFCxM');
    assert.equal(payload.modelCalls, attempt + 1);
    assert.equal(payload.transcriptCalls, 1);
  }

  console.log('Worker lifecycle smoke: abandoned request cannot poison later same-video retries.');
} finally {
  await worker.dispose();
}
