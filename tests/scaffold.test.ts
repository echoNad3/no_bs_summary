import { describe, expect, it } from 'vitest';
import { summarySchema } from '../src/summary/provider.js';
import { SupadataProvider } from '../src/transcript/supadata.js';
import { TranscriptApiProvider } from '../src/transcript/transcriptapi.js';
import { GeminiSummaryProvider } from '../src/summary/gemini.js';

describe('scaffold', () => {
  it('summarySchema accepts a valid verdict object', () => {
    const parsed = summarySchema.parse({
      verdict: 'SKIP',
      reason: 'A 15-minute sales pitch stretched around one obvious point.',
      summary: 'The creator claims X helps with Y but offers no evidence.',
    });
    expect(parsed.verdict).toBe('SKIP');
  });

  it('summarySchema rejects an unknown verdict', () => {
    const result = summarySchema.safeParse({
      verdict: 'MAYBE',
      reason: 'x',
      summary: 'y',
    });
    expect(result.success).toBe(false);
  });

  it('provider stubs expose their names and are not implemented yet', async () => {
    const supadata = new SupadataProvider('test-key');
    const transcriptApi = new TranscriptApiProvider('test-key');
    const gemini = new GeminiSummaryProvider('test-key', 'gemini-3.1-flash-lite');

    expect(supadata.name).toBe('supadata');
    expect(transcriptApi.name).toBe('transcriptapi');
    expect(gemini.name).toBe('gemini');

    const signal = new AbortController().signal;
    await expect(supadata.fetchTranscript('dQw4w9WgXcQ', signal)).rejects.toThrow(
      'not implemented',
    );
    await expect(transcriptApi.fetchTranscript('dQw4w9WgXcQ', signal)).rejects.toThrow(
      'not implemented',
    );
    await expect(gemini.summarize('transcript text', signal)).rejects.toThrow('not implemented');
  });
});
