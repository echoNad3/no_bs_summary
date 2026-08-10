import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const projectDir = process.cwd();
const sourcePath = path.join(projectDir, 'brand', 'no-bs-summary-logo.svg');
const outputDir = path.join(projectDir, 'apps', 'extension', 'public', 'icons');
const source = await fs.readFile(sourcePath, 'utf8');
const sourceUrl = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;

await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  for (const size of [16, 32, 48, 128]) {
    const artworkSize = size === 128 ? 96 : size;
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`
      <!doctype html>
      <style>
        html, body {
          width: ${size}px;
          height: ${size}px;
          margin: 0;
          display: grid;
          place-items: center;
          overflow: hidden;
          background: transparent;
        }
        img { width: ${artworkSize}px; height: ${artworkSize}px; display: block; }
      </style>
      <img src="${sourceUrl}" alt="" />
    `);
    await page.locator('img').evaluate((image) => image.decode());
    await page.screenshot({
      path: path.join(outputDir, `icon-${size}.png`),
      type: 'png',
      omitBackground: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`Generated extension icons in ${outputDir}`);
