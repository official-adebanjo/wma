#!/usr/bin/env node
/**
 * One-off: rasterise report-assets/favicon.svg into the PNG/ICO icons the results page links to.
 * Re-run only when the SVG changes; the outputs are committed in report-assets/.
 *
 *   node scripts/make-favicons.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const dir = path.resolve(__dirname, '../report-assets');
const svg = fs.readFileSync(path.join(dir, 'favicon.svg'), 'utf8');

async function png(page, size, { padding = 0, background = 'transparent' } = {}) {
  const inner = size - padding * 2;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${background}">
    <div style="width:${size}px;height:${size}px;display:grid;place-items:center">
      <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${inner}" height="${inner}">
    </div></body></html>`);
  return page.screenshot({ omitBackground: background === 'transparent', clip: { x: 0, y: 0, width: size, height: size } });
}

/** ICO container holding PNG images (supported by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const sizes = [16, 32, 48];
  const icoImages = [];
  for (const size of sizes) icoImages.push({ size, data: await png(page, size) });
  fs.writeFileSync(path.join(dir, 'favicon.ico'), ico(icoImages));
  // iOS home screen: opaque, with a little breathing room (iOS rounds the corners itself).
  fs.writeFileSync(path.join(dir, 'apple-touch-icon.png'), await png(page, 180, { padding: 12, background: '#1f3a6d' }));
  fs.writeFileSync(path.join(dir, 'icon-192.png'), await png(page, 192));
  fs.writeFileSync(path.join(dir, 'icon-512.png'), await png(page, 512));
  await browser.close();
  for (const f of fs.readdirSync(dir)) console.log(f.padEnd(22), fs.statSync(path.join(dir, f)).size, 'bytes');
})();
