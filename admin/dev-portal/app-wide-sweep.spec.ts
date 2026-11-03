import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * App-wide sweep of the dev Admin Portal.
 *
 * Route list = live sidebar map (refresh with `node scripts/probe-admin-nav.js` → reports/admin-nav.json),
 * falling back to the snapshot below. For each route: page loads (no login bounce), no error screen,
 * no uncaught JS errors, no 5xx API responses; then every in-page sub-link and tab is visited
 * with the same checks (soft assertions, so one bad sub-page doesn't hide the rest).
 */
const SNAPSHOT: Array<{ href: string; text: string }> = [
  ['#/customer/directory', 'Customer Management'], ['#/investment-management', 'Investments'],
  ['#/investment-management/approval-queue', 'Approval queue'], ['#/investment-management/requests', 'On-behalf requests'],
  ['#/investment-management/break-requests', 'Break requests'], ['#/investment-management/withdrawal-requests', 'On-behalf withdrawals'],
  ['#/investment-management/top-up-requests', 'On-behalf top-ups'], ['#/investment-management/rollover-requests', 'On-behalf rollovers'],
  ['#/investment-management/unlock-requests', 'Unlock requests'], ['#/investment-management/system-alerts', 'System alerts'],
  ['#/investment-management/auto-rollover', 'Auto-rollover carry-across'], ['#/investment-management/statutory-rate-propagations', 'Statutory tax carry-across'],
  ['#/loan-management/applications', 'Loan applications'], ['#/loan-management/repayments', 'Loan repayments'],
  ['#/loan-management/payroll', 'Payroll reconciliation'], ['#/wallet/board', 'Wallet Management'], ['#/ledger/monitor', 'Transactions & Ledger'],
  ['#/coming-soon/support', 'Support & Tickets'], ['#/operations/communications/campaigns', 'Campaigns'],
  ['#/operations/communications/discovery-banners', 'Discovery banners'], ['#/configurations/product-management', 'All products'],
  ['#/loan-products/purposes', 'Loan purpose'], ['#/loan-products/variants', 'Loan variants'], ['#/loan-products/pre-eligibility', 'Loan pre-eligibility'],
  ['#/investment-products/penalty-ladders', 'Investment penalty ladders'], ['#/investment-products/tax', 'Investment tax (WHT)'],
  ['#/rates/fees', 'Rate & fee tables'], ['#/loan-approvals', 'Approval threshold'], ['#/corridors/list', 'Corridors & partners'],
  ['#/configurations/product-management/document-setup', 'Document setup'], ['#/rewards/rules', 'Rewards & Incentives'],
  ['#/tiers/list', 'Tiering & KYC'], ['#/general-approvals', 'General Approvals'], ['#/reports-and-analytics/dashboards', 'Reports & Analytics'],
  ['#/classifications', 'Field Rules Setup'], ['#/vocabularies', 'Controlled Vocabularies'], ['#/settings/admin-action-thresholds', 'Approval Thresholds'],
  ['#/settings/communications-providers', 'Communications Providers'], ['#/settings/metric-definitions', 'Metric Definitions'],
  ['#/rbac/approvals', 'Pending Approvals'], ['#/rbac/admins', 'Team Management'], ['#/reporting/audit', 'Audit Log'],
].map(([href, text]) => ({ href, text }));

function routes(): Array<{ href: string; text: string }> {
  const file = path.resolve(__dirname, '../../reports/admin-nav.json');
  const live: Array<{ href: string; text: string }> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).links : [];
  // The live map wins: pages taken out of the menu are no longer swept (the snapshot is only a fallback).
  const seen = new Map<string, string>();
  for (const r of live.length ? live : SNAPSHOT) if (!seen.has(r.href)) seen.set(r.href, r.text.replace(/Soon$/, '').trim());
  return [...seen].map(([href, text]) => ({ href, text }));
}

const ERROR_SCREEN = /something went wrong|unexpected error|application error|page not found|cannot read propert|undefined is not|failed to load/i;

function watch(page: Page) {
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 500 && ['xhr', 'fetch'].includes(r.request().resourceType())) serverErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return { pageErrors, serverErrors, reset: () => { pageErrors.length = 0; serverErrors.length = 0; } };
}

async function checkPage(page: Page, label: string, w: ReturnType<typeof watch>) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  expect.soft(page.url(), `${label}: bounced to login`).not.toMatch(/#\/login/);
  // Detail pages render outside <main>, so judge content at page level: the top bar heading plus
  // at least one page/section heading must be present.
  const hasHeading = await page.getByRole('heading').nth(1).isVisible().catch(() => false);
  const mainText = (await page.getByRole('main').innerText().catch(() => '')).trim();
  expect.soft(hasHeading || mainText.length > 0, `${label}: page has no content`).toBe(true);
  const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
  expect.soft(bodyText.match(ERROR_SCREEN)?.[0] ?? null, `${label}: error screen`).toBeNull();
  expect.soft(w.pageErrors, `${label}: uncaught JS errors`).toEqual([]);
  expect.soft(w.serverErrors, `${label}: 5xx API responses`).toEqual([]);
}

test.describe('Dev portal › App-wide sweep', () => {
  for (const r of routes()) {
    test(`${r.text} (${r.href}) renders cleanly with all sub-pages and tabs @sweep`, async ({ page }, info) => {
      const w = watch(page);
      await page.goto(`/${r.href}`);
      await checkPage(page, r.text, w);
      await page.screenshot({ path: info.outputPath('page.png'), fullPage: true });

      // In-page sub-navigation: hash links inside main/header that aren't sidebar items, plus role=tab.
      const subLinks: Array<{ href: string; text: string }> = await page
        .locator('main a[href^="#/"], header a[href^="#/"], [role="tablist"] a[href^="#/"]')
        .evaluateAll((as) => as.map((a) => ({ href: a.getAttribute('href')!, text: (a.textContent || '').replace(/\s+/g, ' ').trim() })));
      const uniqueSub = [...new Map(subLinks.filter((l) => l.href !== r.href && l.text).map((l) => [l.href, l])).values()].slice(0, 15);
      for (const s of uniqueSub) {
        await test.step(`sub-page: ${s.text}`, async () => {
          w.reset();
          await page.goto(`/${s.href}`);
          await page.reload();
          await checkPage(page, `${r.text} › ${s.text}`, w);
        });
      }

      await page.goto(`/${r.href}`);
      await page.reload();
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      const tabs = page.getByRole('main').getByRole('tab');
      const tabCount = Math.min(await tabs.count(), 12);
      for (let i = 0; i < tabCount; i++) {
        const name = (await tabs.nth(i).innerText()).trim();
        if (await tabs.nth(i).isDisabled()) continue; // "COMING SOON" tabs are disabled
        await test.step(`tab: ${name}`, async () => {
          w.reset();
          await tabs.nth(i).click();
          await checkPage(page, `${r.text} › tab ${name}`, w);
        });
      }
      info.annotations.push({ type: 'coverage', description: `${uniqueSub.length} sub-pages, ${tabCount} tabs` });
    });
  }
});
