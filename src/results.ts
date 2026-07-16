import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RunRecord } from './benchmark.js';

export interface RuntimeProvenance {
  node: string;
  benchmarkPackage: { name: string; version: string };
  dependencies: Record<string, string>;
}

export interface ResultSettings {
  transcriptProvider: string;
  timeoutMs: number;
  useCache: boolean;
  cacheOnly: boolean;
  model: string;
  summaryEnabled: boolean;
  promptVersion: string;
  providerOrder: string[];
  geminiPacingMs: number;
  /** Present for comparison-only transports; production remains Interactions. */
  geminiTransport?: string;
  thinkingSetting?: string;
}

export async function collectRuntimeProvenance(
  projectDir = process.cwd(),
): Promise<RuntimeProvenance> {
  const rootPackage = asPackageJson(
    JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8')),
    'project package.json',
  );
  const declared = {
    ...(rootPackage.dependencies ?? {}),
    ...(rootPackage.devDependencies ?? {}),
  };
  const dependencies: Record<string, string> = {};

  for (const name of Object.keys(declared).sort()) {
    const installed = asPackageJson(
      JSON.parse(
        await fs.readFile(
          path.join(projectDir, 'node_modules', ...name.split('/'), 'package.json'),
          'utf8',
        ),
      ),
      `installed package ${name}`,
    );
    dependencies[name] = installed.version;
  }

  return {
    node: process.version,
    benchmarkPackage: { name: rootPackage.name, version: rootPackage.version },
    dependencies,
  };
}

export async function saveResults(
  dir: string,
  records: RunRecord[],
  settings: ResultSettings,
  runtime: RuntimeProvenance,
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, '-');
  const filePath = path.join(dir, `benchmark-${stamp}.json`);
  const payload = {
    createdAt,
    settings,
    runtime,
    executionOrder: records.map((record, index) => ({
      index,
      provider: record.provider,
      videoId: record.videoId,
    })),
    runs: records,
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), {
    encoding: 'utf8',
    flag: 'wx',
  });
  return filePath;
}

interface PackageJson {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function asPackageJson(value: unknown, label: string): PackageJson {
  if (!value || typeof value !== 'object') throw new Error(`${label} is not a JSON object.`);
  const candidate = value as Partial<PackageJson>;
  if (typeof candidate.name !== 'string' || typeof candidate.version !== 'string') {
    throw new Error(`${label} does not contain a valid name and version.`);
  }
  return candidate as PackageJson;
}
