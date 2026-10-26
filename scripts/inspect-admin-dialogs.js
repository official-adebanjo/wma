#!/usr/bin/env node
/** Dumps the accessibility outline of each create/edit DIALOG only (current UI). Output: reports/ui-inspect/dlg-*.txt */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const outDir = path.resolve(__dirname, '../reports/ui-inspect');
const KEEP = new Set(['button', 'link', 'tab', 'textbox', 'combobox', 'checkbox', 'radio', 'spinbutton', 'searchbox', 'heading', 'switch', 'option', 'listbox', 'row', 'cell', 'columnheader']);
const outline = (n, d = 0, l = []) => {
  if (!n) return l;
  if (KEEP.has(n.role)) l.push(`${'  '.repeat(Math.min(d, 5))}${n.role} "${(n.name || '').replace(/\s+/g, ' ').slice(0, 120)}"${n.checked !== undefined ? ` checked=${n.checked}` : ''}`);
  for (const c of n.children || []) outline(c, d + (KEEP.has(n.role) ? 1 : 0), l);
  return l;
};

const click = (name) => async (p) => p.getByRole('button', { name, exact: true }).first().click();
const steps = [
  { name: 'customer-view', go: '#/customer/directory', act: async (p) => p.getByRole('button', { name: 'View' }).first().click(), page: true },
  { name: 'review-queues', go: '#/customer/directory', act: async (p) => p.getByRole('link', { name: 'Review Queues' }).click(), page: true },
  { name: 'inv-create-customer', go: '#/investment-management', act: async (p) => {
    await click('Create investment on behalf')(p);
    await p.getByRole('textbox', { name: 'Customer' }).fill('rfs19');
    await p.waitForTimeout(2500);
  } },
  { name: 'inv-create-form', go: '#/investment-management', act: async (p) => {
    await click('Create investment on behalf')(p);
    await p.getByRole('textbox', { name: 'Customer' }).fill('rfs19');
    await p.waitForTimeout(2500);
    await p.getByRole('button').filter({ hasText: /USMAN|AHMADU|rfs19/i }).first().click();
    await p.waitForTimeout(1500);
    await p.getByText(/rwin/i).last().click();
    await p.waitForTimeout(1000);
  } },
  { name: 'inv-detail-withdraw', go: '#/investment-management', act: async (p) => {
    await p.getByRole('button', { name: 'View' }).first().click(); await p.waitForTimeout(1500); await click('Withdraw on behalf')(p);
  } },
  { name: 'inv-detail-topup', go: '#/investment-management', act: async (p) => {
    await p.getByRole('button', { name: 'View' }).first().click(); await p.waitForTimeout(1500); await click('Top up on behalf')(p);
  } },
  { name: 'approval-inspect', go: '#/investment-management/approval-queue', act: async (p) => p.getByRole('button', { name: 'Inspect' }).first().click() },
  { name: 'req-view', go: '#/investment-management/requests', act: async (p) => p.getByRole('button', { name: 'View' }).first().click(), page: true },
  { name: 'audit-row', go: '#/reporting/audit', act: async (p) => p.getByRole('main').getByRole('row').nth(1).click() },
  { name: 'loan-book-form', go: '#/loan-management/applications', act: async (p) => {
    await click('Book loan on behalf')(p);
    await p.getByRole('textbox', { name: 'Customer' }).fill('ibrahim');
    await p.waitForTimeout(2500);
    await p.getByRole('button').filter({ hasText: /IBRAHIM PETER/i }).first().click();
    await p.waitForTimeout(1500);
  } },
  { name: 'loan-repayments-drawer', go: '#/loan-management/repayments', act: async (p) => p.getByRole('button', { name: 'Repayments' }).first().click() },
  { name: 'ledger-customer', go: '#/ledger/monitor', act: async (p) => p.getByRole('main').getByRole('button', { name: /[A-Z][a-z]+ [A-Z][a-z]+/ }).nth(0).click() },
  { name: 'banner-open', go: '#/operations/communications/discovery-banners', act: async (p) => p.getByRole('button', { name: 'Open' }).first().click() },
  { name: 'new-inv-product-step2', go: '#/configurations/product-management', act: async (p) => {
    await click('New investment product')(p);
    await p.getByRole('radio', { name: /RWIN 2\.0/ }).check();
    await p.getByRole('textbox', { name: /Product name/ }).fill('probe-only');
    await click('Continue')(p);
    await p.waitForTimeout(1500);
  }, page: true },
  { name: 'new-loan-product', go: '#/configurations/product-management', act: async (p) => { await click('Loan products')(p); await p.waitForTimeout(800); await click('New loan product')(p); } },
  { name: 'new-purpose', go: '#/loan-products/purposes', act: click('New purpose') },
  { name: 'new-variant', go: '#/loan-products/variants', act: click('Add variant'), page: true },
  { name: 'new-pre-eligibility', go: '#/loan-products/pre-eligibility', act: click('New pre-eligibility'), page: true },
  { name: 'new-ladder', go: '#/investment-products/penalty-ladders', act: click('New ladder'), page: true },
  { name: 'new-document', go: '#/configurations/product-management/document-setup', act: click('New document') },
  { name: 'wallet-providers', go: '#/wallet/board', act: async (p) => { await p.getByRole('link', { name: 'Payment Providers' }).click(); await p.waitForTimeout(1000); await click('Add provider')(p); } },
  { name: 'wallet-routing', go: '#/wallet/board', act: async (p) => p.getByRole('link', { name: 'Routing Policy' }).click(), page: true },
  { name: 'wallet-config', go: '#/wallet/board', act: async (p) => p.getByRole('link', { name: 'Wallet Config' }).click(), page: true },
  { name: 'manual-ledger', go: '#/wallet/board', act: async (p) => p.getByRole('link', { name: 'Manual Ledger' }).click(), page: true },
  { name: 'billers-add', go: '#/ledger/monitor', act: async (p) => { await p.getByRole('link', { name: 'Billers' }).click(); await p.waitForTimeout(1000); await click('Add biller')(p); } },
  { name: 'investment-tax', go: '#/investment-products/tax', act: async () => {}, page: true },
];

(async () => {
  const filter = process.argv[2];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: path.resolve(__dirname, '../.auth/dev-super-admin.json'), viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  for (const s of steps) {
    if (filter && !s.name.includes(filter)) continue;
    try {
      await page.goto(`${process.env.DEV_ADMIN_URL}/${s.go}`);
      await page.reload();
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
      await s.act(page);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const dlg = page.getByRole('dialog').last();
      const useDialog = false; void dlg;
      const root = useDialog ? await dlg.elementHandle() : await page.locator('body').elementHandle();
      void root; const snap = await page.accessibility.snapshot({ interestingOnly: true });
      const text = `URL: ${page.url()}  scope=${useDialog ? 'dialog' : 'main'}\n` + outline(snap).join('\n');
      fs.writeFileSync(path.join(outDir, `dlg-${s.name}.txt`), text);
      await page.screenshot({ path: path.join(outDir, `dlg-${s.name}.png`) });
      console.log(`ok   ${s.name} [${useDialog ? 'dialog' : 'main'}] ${text.split('\n').length} lines`);
    } catch (e) {
      console.log(`FAIL ${s.name}: ${e.message.split('\n')[0].slice(0, 160)}`);
    }
  }
  await browser.close();
})();
