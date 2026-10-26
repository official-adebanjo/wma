#!/usr/bin/env node
/**
 * Probes the live dev Admin Portal (using the saved session) and writes the current sidebar
 * map — every group expanded, every link with its hash route — to reports/admin-nav.json.
 *   node scripts/probe-admin-nav.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

(async () => {
  const base = process.env.DEV_ADMIN_URL;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: path.resolve(__dirname, '../.auth/dev-super-admin.json'), viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/#/`);
  await page.waitForLoadState('networkidle').catch(() => {});
  if (page.url().includes('#/login')) throw new Error('Session expired — rerun: npx playwright test --project=admin-dev-setup');

  // Expand every collapsible group (labels look like "Expand <Group>").
  for (let i = 0; i < 30; i++) {
    const exp = page.locator('[aria-label^="Expand "]').first();
    if (!(await exp.isVisible().catch(() => false))) break;
    await exp.click();
    await page.waitForTimeout(150);
  }
  const nav = page.locator('nav, aside').first();
  const links = await nav.locator('a[href]').evaluateAll((as) =>
    as.map((a) => ({ text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') })),
  );
  const groups = await page.locator('[aria-label^="Collapse "]').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label').replace('Collapse ', '')));
  const out = { probedAt: new Date().toISOString(), groups, links };
  fs.mkdirSync(path.resolve(__dirname, '../reports'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../reports/admin-nav.json'), JSON.stringify(out, null, 2));
  console.log(`groups: ${groups.join(' | ')}`);
  for (const l of links) console.log(`${l.href}\t${l.text}`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
