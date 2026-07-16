import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiServer } from '../src/server.js';

let staticDir: string;
let servers: ReturnType<typeof createApiServer>[] = [];

beforeEach(async () => {
  staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nbs-server-test-'));
  await fs.writeFile(path.join(staticDir, 'index.html'), '<h1>Local MVP</h1>', 'utf8');
});

afterEach(async () => {
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  servers = [];
  await fs.rm(staticDir, { recursive: true, force: true });
});

async function start(
  service = {
    summarize: vi
      .fn()
      .mockResolvedValue({ verdict: 'SKIP', reason: 'Padding.', summary: 'One fact.' }),
  },
) {
  const server = createApiServer({ service, staticDir });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, service };
}

describe('local API server', () => {
  it('serves health and the built PWA shell', async () => {
    const { base } = await start();
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', provider: 'transcriptapi' });
    const page = await fetch(`${base}/share?url=https://youtu.be/dQw4w9WgXcQ`);
    expect(await page.text()).toContain('Local MVP');
  });

  it('accepts JSON requests and returns service errors without secrets', async () => {
    const { base, service } = await start();
    const response = await fetch(`${base}/api/summarize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
    });
    expect(response.status).toBe(200);
    expect(service.summarize).toHaveBeenCalledWith({ url: 'https://youtu.be/dQw4w9WgXcQ' });

    const failing = await start({ summarize: vi.fn().mockRejectedValue(new Error('secret-key')) });
    const failed = await fetch(`${failing.base}/api/summarize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain('secret-key');
  });

  it('rejects unsupported content types, oversized bodies, unknown routes and web origins', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/api/summarize`, { method: 'POST', body: '{}' })).status).toBe(415);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
    expect(
      (await fetch(`${base}/api/health`, { headers: { origin: 'https://example.com' } })).status,
    ).toBe(403);

    const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;
    const extensionHealth = await fetch(`${base}/api/health`, {
      headers: { origin: extensionOrigin },
    });
    expect(extensionHealth.status).toBe(200);
    expect(extensionHealth.headers.get('access-control-allow-origin')).toBe(extensionOrigin);

    const preflight = await fetch(`${base}/api/summarize`, {
      method: 'OPTIONS',
      headers: { origin: extensionOrigin },
    });
    expect(preflight.status).toBe(204);
    expect(
      (
        await fetch(`${base}/api/summarize`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'x'.repeat(20_000) }),
        })
      ).status,
    ).toBe(413);
  });
});
