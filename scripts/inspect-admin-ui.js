#!/usr/bin/env node
/**
 * Dumps a compact accessibility outline (roles + names) of key dev Admin Portal pages and dialogs
 * so tests can be aligned with the CURRENT UI. Output: reports/ui-inspect/<name>.txt (+ .png).
 *   node scripts/inspect-admin-ui.js [filter]
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const outDir = path.resolve(__dirname, '../reports/ui-inspect');
fs.mkdirSync(outDir, { recursive: true });
const filter = process.argv[2];

const INTERESTING = new Set(['button', 'link', 'tab', 'textbox', 'combobox', 'checkbox', 'radio', 'spinbutton', 'searchbox', 'heading', 'row', 'columnheader', 'dialog', 'switch', 'menuitem', 'option', 'listbox']);

function outline(node, depth = 0, lines = [], rowCount = { n: 0 }) {
  if (!node) return lines;
  const { role, name } = node;
  if (INTERESTING.has(role)) {
    if (role === 'row') { rowCount.n++; if (rowCount.n > 4) return lines; }
    lines.push(`${'  '.repeat(Math.min(depth, 6))}${role} "${(name || '').replace(/\s+/g, ' ').slice(0, 110)}"${node.checked !== undefined ? ` checked=${node.checked}` : ''}${node.value ? ` value="${String(node.value).slice(0, 30)}"` : ''}`);
  }
  for (const c of node.children || []) outline(c, depth + (INTERESTING.has(role) ? 1 : 0), lines, rowCount);
  return lines;
}

const steps = [
  { name: 'sidebar-home', go: '#/' },
  { name: 'customer-directory', go: '#/customer/directory' },
  { name: 'customer-360', go: '#/customer/directory', act: async (p) => { await p.getByRole('main').getByRole('link').first().click(); } },
  { name: 'investments', go: '#/investment-management' },
  { name: 'investment-detail', go: '#/investment-management', act: async (p) => { await p.getByRole('main').getByRole('row').nth(1).click(); } },
  { name: 'investment-create-dialog', go: '#/investment-management', act: async (p) => { await p.getByRole('button', { name: /create investment on behalf/i }).click(); } },
  { name: 'approval-queue', go: '#/investment-management/approval-queue' },
  { name: 'requests', go: '#/investment-management/requests' },
  { name: 'break-requests', go: '#/investment-management/break-requests' },
  { name: 'system-alerts', go: '#/investment-management/system-alerts' },
  { name: 'auto-rollover-dialog', go: '#/investment-management/auto-rollover', act: async (p) => { await p.getByRole('button', { name: /carry a default across/i }).click(); } },
  { name: 'statutory-rates', go: '#/investment-management/statutory-rate-propagations' },
  { name: 'audit-log', go: '#/reporting/audit' },
  { name: 'loan-applications', go: '#/loan-management/applications' },
  { name: 'loan-book-dialog', go: '#/loan-management/applications', act: async (p) => { await p.getByRole('button', { name: /book loan on behalf/i }).click(); } },
  { name: 'loan-repayments', go: '#/loan-management/repayments' },
  { name: 'wallet-board', go: '#/wallet/board' },
  { name: 'ledger-monitor', go: '#/ledger/monitor' },
  { name: 'campaigns', go: '#/operations/communications/campaigns' },
  { name: 'banners', go: '#/operations/communications/discovery-banners' },
  { name: 'product-management', go: '#/configurations/product-management' },
  { name: 'new-investment-product', go: '#/configurations/product-management', act: async (p) => { await p.getByRole('button', { name: /new investment product/i }).click(); } },
  { name: 'loan-purposes', go: '#/loan-products/purposes' },
  { name: 'loan-variants', go: '#/loan-products/variants' },
  { name: 'pre-eligibility', go: '#/loan-products/pre-eligibility' },
  { name: 'penalty-ladders', go: '#/investment-products/penalty-ladders' },
  { name: 'corridors', go: '#/corridors/list' },
  { name: 'document-setup', go: '#/configurations/product-management/document-setup' },
  { name: 'pending-approvals', go: '#/rbac/approvals' },
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: path.resolve(__dirname, '../.auth/dev-super-admin.json'), viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  for (const s of steps) {
    if (filter && !s.name.includes(filter)) continue;
    try {
      await page.goto(`${process.env.DEV_ADMIN_URL}/${s.go}`);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
      if (s.act) { await s.act(page); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(800); }
      const snap = await page.accessibility.snapshot({ interestingOnly: true });
      const text = `URL: ${page.url()}\n` + outline(snap).join('\n');
      fs.writeFileSync(path.join(outDir, `${s.name}.txt`), text);
      await page.screenshot({ path: path.join(outDir, `${s.name}.png`) });
      console.log(`ok   ${s.name} (${text.split('\n').length} lines)`);
    } catch (e) {
      console.log(`FAIL ${s.name}: ${e.message.split('\n')[0]}`);
    }
  }
  await browser.close();
})();
