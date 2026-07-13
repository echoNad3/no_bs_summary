import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RunRecord } from './benchmark.js';

/**
 * Saves the full machine-readable results of a run into the results/ folder,
 * one timestamped JSON file per run. Old result files are never overwritten.
 * No API keys are ever written here.
 */
export async function saveResults(
  dir: string,
  records: RunRecord[],
  meta: { transcriptProvider: string; timeoutMs: number; useCache: boolean },
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(dir, `benchmark-${stamp}.json`);
  const payload = {
    createdAt: new Date().toISOString(),
    settings: meta,
    runs: records,
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}
