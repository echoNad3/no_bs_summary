import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const projectDir = process.cwd();
const outputDir = path.join(projectDir, 'apps', 'pwa', 'public', 'icons');
const sourcePath = path.join(projectDir, 'brand', 'no-bs-summary-logo.svg');
const source = await fs.readFile(sourcePath, 'utf8');
const sourceUrl = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;

await fs.mkdir(outputDir, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(outputDir, 'icon-512.svg'), source, 'utf8'),
  fs.writeFile(
    path.join(outputDir, 'icon-192.svg'),
    source.replace('width="512" height="512"', 'width="192" height="192"'),
    'utf8',
  ),
]);

const browser = await chromium.launch({ headless: true });
try {
  await renderIcon(192, 192, path.join(outputDir, 'icon-192.png'));
  await renderIcon(512, 512, path.join(outputDir, 'icon-512.png'));
  await renderIcon(512, 512, path.join(outputDir, 'icon-512-maskable.png'));

  const androidRes = path.join(projectDir, 'apps', 'android', 'app', 'src', 'main', 'res');
  for (const [density, size] of Object.entries({
    mdpi: 48,
    hdpi: 72,
    xhdpi: 96,
    xxhdpi: 144,
    xxxhdpi: 192,
  })) {
    const targetDir = path.join(androidRes, `mipmap-${density}`);
    await fs.mkdir(targetDir, { recursive: true });
    await renderIcon(size, size, path.join(targetDir, 'ic_launcher.png'));
  }
  await renderIcon(512, 512, path.join(projectDir, 'apps', 'android', 'store_icon.png'));
} finally {
  await browser.close();
}

console.log(`Generated installable PWA icons in ${outputDir}`);

async function renderIcon(size, artworkSize, targetPath) {
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
        background: #0d0f12;
      }
      img { width: ${artworkSize}px; height: ${artworkSize}px; display: block; }
    </style>
    <img src="${sourceUrl}" alt="" />
  `);
  await page.locator('img').evaluate((image) => image.decode());
  await page.screenshot({ path: targetPath, type: 'png' });
  await page.close();
}
