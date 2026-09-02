import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const extensionDir = path.join(projectRoot, 'dist', 'extension');
const outputPath = path.join(projectRoot, 'dist', 'no-bs-summary-extension.zip');
const fixedMtime = new Date('2000-01-01T12:00:00.000Z');

const entries = await collectFiles(extensionDir);
if (!entries.includes('manifest.json')) {
  throw new Error('Extension build is missing manifest.json at the ZIP root.');
}

const files = {};
for (const relativePath of entries) {
  const contents = await readFile(path.join(extensionDir, ...relativePath.split('/')));
  files[relativePath] = [new Uint8Array(contents), { mtime: fixedMtime }];
}

const archive = zipSync(files, { level: 9 });
await writeFile(outputPath, archive);

const digest = createHash('sha256').update(archive).digest('hex');
console.log(`Extension package: ${outputPath}`);
console.log(`Files: ${entries.length} · Size: ${(archive.byteLength / 1024).toFixed(1)} KiB`);
console.log(`SHA-256: ${digest}`);

async function collectFiles(directory, prefix = '') {
  const directoryEntries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of directoryEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path.join(directory, entry.name), relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}
