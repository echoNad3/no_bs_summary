import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunRecord } from '../src/benchmark.js';
import { collectRuntimeProvenance, saveResults } from '../src/results.js';
import { GEMINI_PROMPT_VERSION } from '../src/summary/gemini.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nbs-results-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('result provenance', () => {
  it('records model, versions, prompt, provider order, hashes, timings and stage retries', async () => {
    const runtime = await collectRuntimeProvenance();
    const record: RunRecord = {
      url: 'https://youtu.be/dQw4w9WgXcQ',
      videoId: 'dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      provider: 'transcriptapi',
      status: 'success',
      transcriptStatus: 'success',
      summaryStatus: 'success',
      source: 'LIVE',
      requestedLanguage: 'en',
      language: 'en',
      transcriptMs: 100,
      summaryMs: 500,
      summaryInputTokens: 1000,
      summaryOutputTokens: 250,
      summaryThoughtTokens: 25,
      summaryTotalTokens: 1275,
      totalMs: 600,
      transcriptChars: 123,
      transcriptSha256: 'a'.repeat(64),
      transcriptRetries: 1,
      summaryRetries: 0,
      withinDeadline: true,
      verdict: 'SKIP',
      reason: 'The summary is enough.',
      summary: 'Useful point.',
    };
    const file = await saveResults(
      dir,
      [record],
      {
        transcriptProvider: 'transcriptapi',
        timeoutMs: 15000,
        useCache: false,
        cacheOnly: false,
        model: 'gemini-3.1-flash-lite',
        summaryEnabled: true,
        promptVersion: GEMINI_PROMPT_VERSION,
        providerOrder: ['transcriptapi'],
        geminiPacingMs: 4500,
      },
      runtime,
    );
    const raw = await fs.readFile(file, 'utf8');
    const saved = JSON.parse(raw) as Record<string, any>;

    expect(saved.settings.timeoutMs).toBe(15000);
    expect(saved.settings.cacheOnly).toBe(false);
    expect(saved.settings.model).toBe('gemini-3.1-flash-lite');
    expect(saved.settings.promptVersion).toBe(GEMINI_PROMPT_VERSION);
    expect(saved.settings.providerOrder).toEqual(['transcriptapi']);
    expect(saved.settings.geminiPacingMs).toBe(4500);
    expect(saved.runtime.node).toBe(process.version);
    expect(saved.runtime.dependencies['@google/genai']).toMatch(/^\d+\.\d+\.\d+/);
    expect(saved.executionOrder).toEqual([
      { index: 0, provider: 'transcriptapi', videoId: 'dQw4w9WgXcQ' },
    ]);
    expect(saved.runs[0]).toMatchObject({
      transcriptSha256: 'a'.repeat(64),
      requestedLanguage: 'en',
      transcriptMs: 100,
      summaryMs: 500,
      summaryInputTokens: 1000,
      summaryOutputTokens: 250,
      summaryThoughtTokens: 25,
      summaryTotalTokens: 1275,
      transcriptRetries: 1,
      summaryRetries: 0,
    });
    expect(raw).not.toContain('full transcript');
    expect(raw).not.toContain('API_KEY');
  });
});
