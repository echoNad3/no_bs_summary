import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const projectDir = process.cwd();
const outputDir = path.join(projectDir, 'apps', 'pwa', 'public', 'icons');
const sourcePath = path.join(outputDir, 'icon-512.svg');
const source = await fs.readFile(sourcePath, 'utf8');
const sourceUrl = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;

await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  await renderIcon(192, 192, 'icon-192.png');
  await renderIcon(512, 512, 'icon-512.png');
  await renderIcon(512, 410, 'icon-512-maskable.png');
} finally {
  await browser.close();
}

console.log(`Generated installable PWA icons in ${outputDir}`);

async function renderIcon(size, artworkSize, filename) {
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
        background: #161616;
      }
      img { width: ${artworkSize}px; height: ${artworkSize}px; display: block; }
    </style>
    <img src="${sourceUrl}" alt="" />
  `);
  await page.locator('img').evaluate((image) => image.decode());
  await page.screenshot({ path: path.join(outputDir, filename), type: 'png' });
  await page.close();
}
