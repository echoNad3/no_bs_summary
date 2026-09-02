import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const projectDir = process.cwd();
const budgets = [
  { label: 'PWA JavaScript', dir: 'dist/pwa', extension: '.js', maxGzipBytes: 12.5 * 1024 },
  { label: 'PWA CSS', dir: 'dist/pwa', extension: '.css', maxGzipBytes: 8 * 1024 },
  {
    label: 'Extension JavaScript',
    dir: 'dist/extension',
    extension: '.js',
    maxGzipBytes: 16 * 1024,
  },
  { label: 'Extension CSS', dir: 'dist/extension', extension: '.css', maxGzipBytes: 8 * 1024 },
];

let failed = false;
for (const budget of budgets) {
  const files = await filesWithExtension(path.join(projectDir, budget.dir), budget.extension);
  if (files.length === 0) throw new Error(`${budget.label}: no ${budget.extension} files found.`);
  const gzipBytes = (
    await Promise.all(files.map(async (file) => gzipSync(await fs.readFile(file)).byteLength))
  ).reduce((total, size) => total + size, 0);
  const maximum = (budget.maxGzipBytes / 1024).toFixed(1);
  const actual = (gzipBytes / 1024).toFixed(2);
  console.log(`${budget.label}: ${actual} KiB gzip / ${maximum} KiB budget`);
  if (gzipBytes > budget.maxGzipBytes) failed = true;
}

if (failed) {
  throw new Error('Frontend bundle budget exceeded. Check for accidental dependency bloat.');
}

async function filesWithExtension(directory, extension) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return filesWithExtension(entryPath, extension);
      return entry.isFile() && path.extname(entry.name) === extension ? [entryPath] : [];
    }),
  );
  return nested.flat();
}
